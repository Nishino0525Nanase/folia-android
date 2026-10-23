package top.izuna.foliamajor.bilibili;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import okhttp3.HttpUrl;

// Keep video API, media verification and the loopback player's public headers consistent.
final class BilibiliVideoRequest {
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    private static final int[] MIXIN = { 46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
            27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13 };

    static Map<String, String> headers(String bvid) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", USER_AGENT);
        headers.put("Referer", "https://www.bilibili.com/" + (bvid.matches("BV[0-9A-Za-z]{10}") ? "video/" + bvid + "/" : ""));
        headers.put("Origin", "https://www.bilibili.com");
        headers.put("Accept", "*/*");
        return headers;
    }

    private static String imageKey(String value) throws IOException {
        HttpUrl url = HttpUrl.parse(value);
        if (url == null) throw new IOException("invalid-wbi-key");
        String name = url.pathSegments().get(url.pathSegments().size() - 1);
        int dot = name.indexOf('.');
        String key = dot < 0 ? name : name.substring(0, dot);
        if (!key.matches("[0-9a-fA-F]{32}")) throw new IOException("invalid-wbi-key");
        return key;
    }

    static String mixinKey(String imageUrl, String subUrl) throws IOException {
        String raw = imageKey(imageUrl) + imageKey(subUrl);
        StringBuilder result = new StringBuilder();
        for (int index : MIXIN) result.append(raw.charAt(index));
        return result.toString();
    }

    // WBI signs sorted, filtered query values. Timestamp/signature are never reused for another request.
    static Map<String, String> sign(Map<String, String> params, String key, long seconds) throws Exception {
        Map<String, String> signed = new TreeMap<>();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!entry.getKey().equals("w_rid")) signed.put(entry.getKey(), entry.getValue().replaceAll("[!'()*]", ""));
        }
        signed.put("wts", Long.toString(seconds));
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : signed.entrySet()) {
            if (query.length() > 0) query.append('&');
            query.append(URLEncoder.encode(entry.getKey(), "UTF-8").replace("+", "%20")).append('=')
                    .append(URLEncoder.encode(entry.getValue(), "UTF-8").replace("+", "%20"));
        }
        byte[] digest = MessageDigest.getInstance("MD5").digest((query.toString() + key).getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte value : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        signed.put("w_rid", hex.toString());
        return signed;
    }
}
