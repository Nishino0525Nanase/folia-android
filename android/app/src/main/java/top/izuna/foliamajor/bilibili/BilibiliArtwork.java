package top.izuna.foliamajor.bilibili;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Cache;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

// Public artwork has its own cache and request headers; account cookies never reach the image CDN.
public final class BilibiliArtwork {
    private static final long MAX_BYTES = 8L * 1024 * 1024;
    private static BilibiliArtwork shared;
    private final OkHttpClient client;

    public static synchronized BilibiliArtwork shared(File cacheDir) {
        if (shared == null) shared = new BilibiliArtwork(new OkHttpClient.Builder()
                .cache(new Cache(new File(cacheDir, "bilibili-artwork-v1"), 32L * 1024 * 1024)).build());
        return shared;
    }

    BilibiliArtwork(OkHttpClient base) {
        client = base.newBuilder().followRedirects(false).followSslRedirects(false)
                .cookieJar(okhttp3.CookieJar.NO_COOKIES)
                .connectTimeout(5, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS)
                .callTimeout(10, TimeUnit.SECONDS)
                .addNetworkInterceptor(chain -> {
                    Response response = chain.proceed(chain.request());
                    if (response.isSuccessful()) {
                        try { validate(response); }
                        catch (IOException error) { response.close(); throw error; }
                    }
                    // Error responses must not become persistent blank posters.
                    return response.isSuccessful() ? response : response.newBuilder().header("Cache-Control", "no-store").build();
                }).build();
    }

    static HttpUrl checkedUrl(String raw) throws IOException {
        HttpUrl url = HttpUrl.parse(raw);
        if (url == null || !(url.host().equals("hdslb.com") || url.host().endsWith(".hdslb.com"))
                || !url.username().isEmpty() || !url.password().isEmpty()
                || url.port() != (url.isHttps() ? 443 : 80)
                || !url.encodedPath().startsWith("/bfs/")) throw new IOException("invalid-artwork-url");
        return url.newBuilder().scheme("https").port(443).build();
    }

    public static boolean handles(String raw) {
        try { checkedUrl(raw); return true; }
        catch (IOException ignored) { return false; }
    }

    private static void validate(Response response) throws IOException {
        if (response.body() == null || response.body().contentLength() > MAX_BYTES) throw new IOException("invalid-artwork-content");
        String type = response.header("Content-Type", "").toLowerCase(java.util.Locale.ROOT);
        byte[] head = response.peekBody(16).bytes();
        boolean jpeg = head.length >= 3 && (head[0] & 255) == 255 && (head[1] & 255) == 216 && (head[2] & 255) == 255;
        boolean png = head.length >= 8 && head[0] == (byte) 137 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G'
                && head[4] == 13 && head[5] == 10 && head[6] == 26 && head[7] == 10;
        String signature = new String(head, java.nio.charset.StandardCharsets.ISO_8859_1);
        boolean gif = signature.startsWith("GIF87a") || signature.startsWith("GIF89a");
        boolean webp = signature.startsWith("RIFF") && signature.length() >= 12 && signature.substring(8, 12).equals("WEBP");
        boolean avif = signature.length() >= 12 && signature.substring(4, 8).equals("ftyp")
                && (signature.substring(8, 12).equals("avif") || signature.substring(8, 12).equals("avis"));
        if (!type.startsWith("image/") || !(jpeg || png || gif || webp || avif)) throw new IOException("invalid-artwork-content");
    }

    // The caller closes the response/stream. Bytes stream to WebView instead of being base64-copied through JavaScript.
    Response open(String raw) throws IOException {
        HttpUrl url = checkedUrl(raw);
        for (int redirects = 0; redirects <= 3; redirects++) {
            Request request = new Request.Builder().url(url).get()
                    .header("Referer", "https://www.bilibili.com/")
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")
                    .header("Accept", "image/avif,image/webp,image/*;q=0.8").build();
            Response response = client.newCall(request).execute();
            if (response.isRedirect()) {
                String location = response.header("Location");
                HttpUrl next = location == null ? null : url.resolve(location);
                response.close();
                if (next == null) throw new IOException("invalid-artwork-redirect");
                url = checkedUrl(next.toString());
                continue;
            }
            try {
                if (!response.isSuccessful()) throw new IOException("artwork-http-" + response.code());
                validate(response);
                return response;
            } catch (IOException error) { response.close(); throw error; }
        }
        throw new IOException("artwork-redirect-limit");
    }
}
