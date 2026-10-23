package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okio.Buffer;

// Fetch only bounded subtitle text from Bilibili's CDN; account credentials never leave the API host.
final class BilibiliSubtitleFile {
    static final long MAX_BYTES = 2 * 1024 * 1024;
    private final OkHttpClient client;

    BilibiliSubtitleFile(OkHttpClient client) {
        this.client = client.newBuilder().followRedirects(false).followSslRedirects(false).build();
    }

    static HttpUrl checkedUrl(String value) throws IOException {
        HttpUrl url = HttpUrl.parse(value.startsWith("//") ? "https:" + value : value);
        if (url == null || !url.isHttps() || url.port() != 443 || !url.username().isEmpty() || !url.password().isEmpty()
                || !(url.host().equals("hdslb.com") || url.host().endsWith(".hdslb.com"))
                || !url.encodedPath().startsWith("/bfs/")) throw new IOException("invalid-subtitle-host");
        return url;
    }

    String read(String value, Consumer<Call> attach) throws IOException {
        HttpUrl url = checkedUrl(value);
        for (int redirect = 0; redirect < 3; redirect++) {
            Request.Builder request = new Request.Builder().url(url).get();
            BilibiliVideoRequest.headers("").forEach(request::header);
            Call call = client.newCall(request.build());
            attach.accept(call);
            try (Response response = call.execute()) {
                if (response.isRedirect()) {
                    HttpUrl next = url.resolve(response.header("Location", ""));
                    if (next == null) throw new IOException("invalid-subtitle-host");
                    url = checkedUrl(next.toString());
                    continue;
                }
                if (!response.isSuccessful()) throw new IOException("subtitle-http-" + response.code());
                if (response.body() == null || response.body().contentLength() > MAX_BYTES) throw new IOException("invalid-subtitle-content");
                Buffer buffer = new Buffer();
                while (response.body().source().read(buffer, Math.min(8192, MAX_BYTES + 1 - buffer.size())) != -1) {
                    if (buffer.size() > MAX_BYTES) throw new IOException("invalid-subtitle-content");
                }
                return buffer.readUtf8();
            }
        }
        throw new IOException("subtitle-redirect-limit");
    }
}
