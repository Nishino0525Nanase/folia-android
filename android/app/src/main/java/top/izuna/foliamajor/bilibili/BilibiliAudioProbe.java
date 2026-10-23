package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

// Test a small media range without account cookies before giving a CDN route to the player.
final class BilibiliAudioProbe {
    private final OkHttpClient client;

    BilibiliAudioProbe(OkHttpClient base) {
        client = base.newBuilder().connectTimeout(3, TimeUnit.SECONDS).callTimeout(4, TimeUnit.SECONDS)
                .followRedirects(false).followSslRedirects(false).build();
    }

    static HttpUrl checkedUrl(String value) throws IOException {
        HttpUrl url = HttpUrl.parse(value);
        if (url != null && url.username().isEmpty() && url.password().isEmpty() && url.fragment() == null) {
            for (String domain : new String[] { "bilivideo.com", "bilivideo.cn", "bilivideo.net" }) {
                if (url.host().equals(domain) || url.host().endsWith("." + domain)) return url;
            }
        }
        throw new IOException("invalid-audio-host");
    }

    String verify(String value) throws IOException { return verify(value, call -> {}); }

    String verify(String value, Consumer<Call> track) throws IOException {
        HttpUrl url = checkedUrl(value);
        long started = System.nanoTime();
        for (int redirects = 0; redirects <= 3; redirects++) {
            Request request = new Request.Builder().url(url)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36")
                    .header("Referer", "https://www.bilibili.com/").header("Range", "bytes=0-31").build();
            Call call = client.newCall(request);
            long remaining = TimeUnit.SECONDS.toNanos(4) - (System.nanoTime() - started);
            if (remaining <= 0) throw new IOException("audio-unreachable");
            call.timeout().timeout(remaining, TimeUnit.NANOSECONDS);
            track.accept(call);
            try (Response response = call.execute()) {
                if (response.isRedirect() && response.header("Location") != null) {
                    HttpUrl next = url.resolve(response.header("Location"));
                    if (next == null) throw new IOException("invalid-audio-host");
                    url = checkedUrl(next.toString());
                    continue;
                }
                if (response.code() != 200 && response.code() != 206) throw new IOException("audio-http-" + response.code());
                if (response.body() == null || !response.body().source().request(12)) throw new IOException("invalid-audio-content");
                byte[] head = response.body().source().readByteArray(12);
                if (head[4] != 'f' || head[5] != 't' || head[6] != 'y' || head[7] != 'p') throw new IOException("invalid-audio-content");
                return url.toString();
            }
        }
        throw new IOException("audio-redirect-limit");
    }
}
