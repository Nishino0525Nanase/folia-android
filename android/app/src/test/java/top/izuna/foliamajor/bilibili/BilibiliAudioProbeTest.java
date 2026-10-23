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
            assertEquals("bytes=0-", chain.request().header("Range"));
            assertEquals("https://www.bilibili.com/", chain.request().header("Referer"));
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Probe")
                    .body(ResponseBody.create(MediaType.get("audio/mp4"), body)).build();
        }).build());
    }

    @Test public void acceptsPartialMp4AndOmitsAccountHeaders() throws Exception {
        probe(206, new byte[] { 0, 0, 0, 24, 'f', 't', 'y', 'p', 'd', 'a', 's', 'h' })
                .verify("https://cn-test.bilivideo.com/audio.m4s");
    }

    @Test public void mediaProbeUsesTheExactVideoApiHeaders() throws Exception {
        String bvid = "BV1FT6dBtEff";
        String url = "https://cn-test.bilivideo.com/video.mp4?sign=a%2Bb&deadline=2000000000";
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            BilibiliVideoRequest.headers(bvid).forEach((name, value) -> assertEquals(value, chain.request().header(name)));
            assertEquals(url, chain.request().url().toString());
            assertEquals("bytes=0-", chain.request().header("Range"));
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(206).message("Probe")
                    .body(ResponseBody.create(MediaType.get("video/mp4"), new byte[] { 0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm' })).build();
        }).build();
        assertEquals(url, new BilibiliAudioProbe(client).verify(url, bvid, call -> {}));
    }

    @Test public void rejectsErrorStatusAndNonAudioBodies() {
        for (int status : new int[] { 200, 302, 403 }) {
            try { probe(status, "<html>not an audio stream</html>".getBytes()).verify("https://cn-test.bilivideo.com/audio.m4s"); fail("Unexpectedly accepted response"); }
            catch (IOException expected) { assertEquals(status == 200 ? "invalid-audio-content" : "audio-http-" + status, expected.getMessage()); }
        }
    }
    @Test public void followsOnlyMediaRedirectsAndReturnsThePlayableRoute() throws Exception {
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            boolean redirect = chain.request().url().host().equals("first.bilivideo.com");
            Response.Builder result = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(redirect ? 302 : 206).message("Probe").body(ResponseBody.create(MediaType.get("audio/mp4"),
                            new byte[] { 0, 0, 0, 24, 'f', 't', 'y', 'p', 'd', 'a', 's', 'h' }));
            if (redirect) result.header("Location", "https://edge.bilivideo.com/audio.m4s");
            return result.build();
        }).build();
        assertEquals("https://edge.bilivideo.com/audio.m4s", new BilibiliAudioProbe(client).verify("https://first.bilivideo.com/a"));
    }

    @Test public void refusesRedirectsOutsideMediaDomainsBeforeRequestingThem() throws Exception {
        final int[] calls = { 0 };
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls[0]++;
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(302).message("Probe")
                    .header("Location", "https://evil.invalid/audio").body(ResponseBody.create(null, "")).build();
        }).build();
        try { new BilibiliAudioProbe(client).verify("https://first.bilivideo.com/a"); fail("Unsafe redirect accepted"); }
        catch (IOException expected) { assertEquals("invalid-audio-host", expected.getMessage()); }
        assertEquals(1, calls[0]);
    }

    @Test public void cancellationAlsoAppliesToCallsAttachedLater() {
        BilibiliRequest request = new BilibiliRequest();
        request.cancel();
        okhttp3.Call call = new OkHttpClient().newCall(new okhttp3.Request.Builder().url("https://api.bilibili.com/").build());
        request.attach(call);
        assertTrue(call.isCanceled());
    }

}
