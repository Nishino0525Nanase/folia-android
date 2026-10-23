package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;
import static org.junit.Assert.*;

// Cover the native request and byte validation without account credentials or external network access.
public class BilibiliAudioProbeTest {
    @Test public void acceptsOfficialHttpAndNonstandardHttpsPorts() throws Exception {
        assertEquals("http", BilibiliAudioProbe.checkedUrl("http://cn-test.bilivideo.com/audio.m4s").scheme());
        assertEquals(4483, BilibiliAudioProbe.checkedUrl("https://xy-test.mcdn.bilivideo.cn:4483/audio.m4s").port());
    }

    @Test public void rejectsNonMediaHostsAndCredentials() {
        for (String value : new String[] { "https://evil.invalid/audio", "https://bilivideo.com.evil.invalid/audio",
                "https://127.0.0.1/audio", "https://user:secret@cn-test.bilivideo.com/audio", "file:///audio.m4s" }) {
            try { BilibiliAudioProbe.checkedUrl(value); fail("Unexpectedly accepted unsafe URL"); }
            catch (IOException expected) { assertEquals("invalid-audio-host", expected.getMessage()); }
        }
    }

    private BilibiliAudioProbe probe(int status, byte[] body) {
        return new BilibiliAudioProbe(new OkHttpClient.Builder().addInterceptor(chain -> {
            assertNull(chain.request().header("Cookie"));
            assertNull(chain.request().header("Authorization"));
            assertEquals("bytes=0-31", chain.request().header("Range"));
            assertEquals("https://www.bilibili.com/", chain.request().header("Referer"));
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Probe")
                    .body(ResponseBody.create(MediaType.get("audio/mp4"), body)).build();
        }).build());
    }

    @Test public void acceptsPartialMp4AndOmitsAccountHeaders() throws Exception {
        probe(206, new byte[] { 0, 0, 0, 24, 'f', 't', 'y', 'p', 'd', 'a', 's', 'h' })
                .verify("https://cn-test.bilivideo.com/audio.m4s");
    }

    @Test public void rejectsErrorStatusAndNonAudioBodies() {
        for (int status : new int[] { 200, 302, 403 }) {
            try { probe(status, "<html>not an audio stream</html>".getBytes()).verify("https://cn-test.bilivideo.com/audio.m4s"); fail("Unexpectedly accepted response"); }
            catch (IOException expected) { assertEquals(status == 200 ? "invalid-audio-content" : "audio-http-" + status, expected.getMessage()); }
        }
    }
}
