package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.Test;
import static org.junit.Assert.*;

// Real HTTP request construction is checked with an interceptor, without private account/network access.
public class BilibiliSubtitleFileTest {
    @Test public void acceptsOnlyHttpsSubtitleCdnPaths() throws Exception {
        assertEquals("https", BilibiliSubtitleFile.checkedUrl("//aisubtitle.hdslb.com/bfs/subtitle/test.json").scheme());
        for (String url : new String[] { "http://aisubtitle.hdslb.com/bfs/test.json", "https://hdslb.com.evil.invalid/bfs/test.json",
                "https://localhost/bfs/test.json", "https://user:secret@aisubtitle.hdslb.com/bfs/test.json",
                "https://aisubtitle.hdslb.com:8443/bfs/test.json", "https://aisubtitle.hdslb.com/not-subtitles" }) {
            try { BilibiliSubtitleFile.checkedUrl(url); fail("Unsafe subtitle URL accepted"); }
            catch (IOException expected) { assertEquals("invalid-subtitle-host", expected.getMessage()); }
        }
    }

    @Test public void neverSendsCredentialsAndAttachesCancellation() throws Exception {
        int[] calls = { 0 };
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            assertNull(chain.request().header("Cookie")); assertNull(chain.request().header("Authorization"));
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .body(ResponseBody.create(null, "{\"body\":[]}")).build();
        }).build();
        assertEquals("{\"body\":[]}", new BilibiliSubtitleFile(client).read("//aisubtitle.hdslb.com/bfs/subtitle/test.json", call -> calls[0]++));
        assertEquals(1, calls[0]);
    }

    @Test public void rejectsOversizedAndDeniedResponses() throws Exception {
        for (int status : new int[] { 200, 403 }) {
            OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> new Response.Builder()
                    .request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Test")
                    .body(ResponseBody.create(null, new byte[(int) BilibiliSubtitleFile.MAX_BYTES + 1])).build()).build();
            try { new BilibiliSubtitleFile(client).read("//aisubtitle.hdslb.com/bfs/subtitle/test.json", call -> {}); fail("Invalid response accepted"); }
            catch (IOException expected) { assertEquals(status == 403 ? "subtitle-http-403" : "invalid-subtitle-content", expected.getMessage()); }
        }
    }

    @Test public void refusesRedirectOutsideSubtitleCdnBeforeMakingRequest() throws Exception {
        int[] calls = { 0 };
        OkHttpClient client = new OkHttpClient.Builder().addInterceptor(chain -> {
            calls[0]++;
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(302).message("Moved")
                    .header("Location", "https://evil.invalid/test.json").body(ResponseBody.create(null, "")).build();
        }).build();
        try { new BilibiliSubtitleFile(client).read("//aisubtitle.hdslb.com/bfs/subtitle/test.json", call -> {}); fail("Unsafe redirect accepted"); }
        catch (IOException expected) { assertEquals("invalid-subtitle-host", expected.getMessage()); }
        assertEquals(1, calls[0]);
    }
}
