package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;
import static org.junit.Assert.*;

// Regressions for the WebView localhost referrer rejection and error documents cached as artwork.
public class BilibiliArtworkTest {
    private static final byte[] JPEG = { (byte) 255, (byte) 216, (byte) 255, (byte) 224, 0, 16, 'J', 'F', 'I', 'F', 0, 1 };

    @Test public void onlyHandlesOfficialPublicArtwork() throws Exception {
        assertEquals("https://i2.hdslb.com/bfs/archive/a.jpg", BilibiliArtwork.checkedUrl("http://i2.hdslb.com/bfs/archive/a.jpg").toString());
        for (String url : new String[] { "https://hdslb.com.evil.invalid/bfs/a.jpg", "https://evil.invalid/bfs/a.jpg",
                "https://user:password@i0.hdslb.com/bfs/a.jpg", "https://i0.hdslb.com:8443/bfs/a.jpg",
                "https://i0.hdslb.com/api", "file:///bfs/a.jpg", "https://localhost/bfs/a.jpg" }) {
            assertFalse(BilibiliArtwork.handles(url));
        }
    }

    @Test public void usesBilibiliReferrerAndBrowserUserAgentWithoutCredentials() throws Exception {
        BilibiliArtwork artwork = new BilibiliArtwork(new OkHttpClient.Builder().addInterceptor(chain -> {
            assertEquals("https://www.bilibili.com/", chain.request().header("Referer"));
            assertTrue(chain.request().header("User-Agent").contains("Chrome/"));
            assertNull(chain.request().header("Cookie"));
            assertNull(chain.request().header("Authorization"));
            assertNull(chain.request().header("Origin"));
            assertEquals("https", chain.request().url().scheme());
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .header("Content-Type", "image/jpeg").body(ResponseBody.create(MediaType.get("image/jpeg"), JPEG)).build();
        }).build());
        try (Response response = artwork.open("http://i2.hdslb.com/bfs/archive/a.jpg")) {
            assertArrayEquals(JPEG, response.body().bytes());
        }
    }

    @Test public void rejectsHtmlEvenWhenServerLabelsItAnImage() {
        for (String mime : new String[] { "text/html", "image/jpeg" }) {
            BilibiliArtwork artwork = new BilibiliArtwork(new OkHttpClient.Builder().addInterceptor(chain ->
                    new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                            .header("Content-Type", mime).body(ResponseBody.create(MediaType.get(mime), "<html>Access denied</html>")).build()).build());
            try { artwork.open("https://i0.hdslb.com/bfs/a.jpg"); fail("An error document was accepted"); }
            catch (IOException expected) { assertEquals("invalid-artwork-content", expected.getMessage()); }
        }
    }

    @Test public void transientFailureDoesNotDisableLaterAttempts() throws Exception {
        AtomicInteger count = new AtomicInteger();
        BilibiliArtwork artwork = new BilibiliArtwork(new OkHttpClient.Builder().addInterceptor(chain ->
                new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                        .code(count.getAndIncrement() == 0 ? 403 : 200).message("Test")
                        .header("Content-Type", "image/jpeg").body(ResponseBody.create(MediaType.get("image/jpeg"), JPEG)).build()).build());
        try { artwork.open("https://i0.hdslb.com/bfs/a.jpg"); fail("A rejected request was accepted"); }
        catch (IOException expected) { assertEquals("artwork-http-403", expected.getMessage()); }
        try (Response response = artwork.open("https://i0.hdslb.com/bfs/a.jpg")) { assertArrayEquals(JPEG, response.body().bytes()); }
        assertEquals(2, count.get());
    }

    @Test public void revalidatesRedirectHostBeforeMakingAnotherRequest() {
        AtomicInteger count = new AtomicInteger();
        BilibiliArtwork artwork = new BilibiliArtwork(new OkHttpClient.Builder().addInterceptor(chain -> {
            count.incrementAndGet();
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(302).message("Redirect")
                    .header("Location", "https://evil.invalid/bfs/a.jpg").body(ResponseBody.create(null, "")).build();
        }).build());
        try { artwork.open("https://i0.hdslb.com/bfs/a.jpg"); fail("Unsafe redirect followed"); }
        catch (IOException expected) { assertEquals("invalid-artwork-url", expected.getMessage()); }
        assertEquals(1, count.get());
    }

    @Test public void followsOfficialArtworkRedirects() throws Exception {
        BilibiliArtwork artwork = new BilibiliArtwork(new OkHttpClient.Builder().addInterceptor(chain -> {
            boolean redirect = chain.request().url().host().equals("i0.hdslb.com");
            Response.Builder response = new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(redirect ? 302 : 200).message("Test").header("Content-Type", "image/jpeg")
                    .body(ResponseBody.create(MediaType.get("image/jpeg"), JPEG));
            if (redirect) response.header("Location", "https://i2.hdslb.com/bfs/a.jpg");
            return response.build();
        }).build());
        try (Response response = artwork.open("https://i0.hdslb.com/bfs/a.jpg")) {
            assertEquals("i2.hdslb.com", response.request().url().host());
        }
    }
}
