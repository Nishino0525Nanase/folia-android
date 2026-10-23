package top.izuna.foliamajor.bilibili;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

// Known WBI vector plus public-header contracts used by both the API and media requests.
public class BilibiliVideoRequestTest {
    @Test public void signsSortedParametersWithTheCurrentImageKeys() throws Exception {
        String key = BilibiliVideoRequest.mixinKey("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png");
        assertEquals("ea1db124af3c7062474693fa704f4ff8", key);
        Map<String, String> params = new HashMap<>();
        params.put("foo", "114"); params.put("bar", "514"); params.put("baz", "1919810");
        Map<String, String> signed = BilibiliVideoRequest.sign(params, key, 1702204169L);
        assertEquals("6149fdadf571698ca7e6a567265cd0ee", signed.get("w_rid"));
        assertEquals("1702204169", signed.get("wts"));
        assertFalse(params.containsKey("wts"));
        assertNotEquals(signed.get("w_rid"), BilibiliVideoRequest.sign(params, key, 1702204170L).get("w_rid"));
    }

    @Test public void filtersSignedValuesWithoutCarryingAnOldSignature() throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("foo", "1!1'4()*"); params.put("w_rid", "stale");
        Map<String, String> signed = BilibiliVideoRequest.sign(params, "key", 10);
        assertEquals("114", signed.get("foo"));
        assertNotEquals("stale", signed.get("w_rid"));
    }

    @Test public void mediaHeadersContainVideoRefererButNoAccountCredentials() {
        Map<String, String> headers = BilibiliVideoRequest.headers("BV1FT6dBtEff");
        assertEquals("https://www.bilibili.com/video/BV1FT6dBtEff/", headers.get("Referer"));
        assertNotNull(headers.get("User-Agent"));
        assertFalse(headers.containsKey("Cookie"));
        assertFalse(headers.containsKey("Authorization"));
        assertEquals("https://www.bilibili.com/", BilibiliVideoRequest.headers("https://evil.invalid").get("Referer"));
    }
}
