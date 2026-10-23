package top.izuna.foliamajor.bilibili;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import okhttp3.Response;

// Covers CSS backgrounds, <img>, Image.decode and fetch while preserving Capacitor's local server and navigation.
public final class BilibiliArtworkWebViewClient extends BridgeWebViewClient {
    private final BilibiliArtwork artwork;

    public BilibiliArtworkWebViewClient(Bridge bridge) {
        super(bridge);
        artwork = BilibiliArtwork.shared(bridge.getContext().getCacheDir());
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (request.isForMainFrame() || !request.getMethod().equals("GET") || !BilibiliArtwork.handles(url)) {
            return super.shouldInterceptRequest(view, request);
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        // OkHttp owns the validated persistent image cache; old WebView 403s cannot poison it.
        headers.put("Cache-Control", "no-store");
        try {
            Response response = artwork.open(url);
            FilterInputStream stream = new FilterInputStream(response.body().byteStream()) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { response.close(); }
                }
            };
            String mime = response.header("Content-Type", "image/jpeg").split(";", 2)[0];
            return new WebResourceResponse(mime, null, 200, "OK", headers, stream);
        } catch (IOException error) {
            // Fixed diagnostics only; URLs can contain signed query parameters.
            android.util.Log.w("BilibiliArtwork", "Artwork request failed (" + error.getClass().getSimpleName() + ")");
            return new WebResourceResponse("text/plain", "UTF-8", 502, "Artwork unavailable", headers, new ByteArrayInputStream(new byte[0]));
        }
    }
}
