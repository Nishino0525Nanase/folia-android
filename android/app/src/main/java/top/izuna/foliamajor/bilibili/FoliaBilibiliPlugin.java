package top.izuna.foliamajor.bilibili;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import android.util.AtomicFile;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.Call;
import okhttp3.Cookie;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

// Android owns the account cookies. Only an opaque handle and public response data cross the bridge.
@CapacitorPlugin(name = "FoliaBilibili")
public class FoliaBilibiliPlugin extends Plugin {
    private final ExecutorService requests = Executors.newFixedThreadPool(3);
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS).callTimeout(18, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false).build();
    private final Map<String, BilibiliRequest> cancellable = new ConcurrentHashMap<>();
    private final ThreadLocal<BilibiliRequest> running = new ThreadLocal<>();
    private final Object lock = new Object();
    private int generation = 0;
    private String pendingKey = "";
    private long pendingUntil = 0;
    private JSONObject session;

    private static final class Failure extends Exception {
        final int status;
        final String code;
        Failure(int status, String code) { this.status = status; this.code = code; }
    }

    private AtomicFile sessionFile() { return new AtomicFile(new File(getContext().getNoBackupFilesDir(), "bilibili-session.json")); }

    private JSONObject session() throws Exception {
        if (session == null) {
            session = new JSONObject();
            AtomicFile file = sessionFile();
            if (file.getBaseFile().exists()) {
                try { session = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)); }
                catch (Exception ignored) { file.delete(); }
            }
        }
        return session;
    }

    private void forget() {
        session = new JSONObject();
        sessionFile().delete();
    }

    private String cookieFor(String handle) throws Exception {
        synchronized (lock) {
            JSONObject saved = session();
            if (handle.isEmpty() || !handle.equals(saved.optString("handle"))) throw new Failure(401, "session-expired");
            if (saved.optLong("expiresAt") <= System.currentTimeMillis()) {
                forget();
                throw new Failure(401, "session-expired");
            }
            return saved.getString("cookie");
        }
    }

    // Endpoints are selected here, never supplied by the renderer. Redirects cannot carry cookies elsewhere.
    private JSONObject get(String path, JSONObject params, String cookie, Map<String, Cookie> received) throws Exception {
        String host = path.startsWith("/x/passport-login/") ? "passport.bilibili.com" : "api.bilibili.com";
        HttpUrl.Builder url = new HttpUrl.Builder().scheme("https").host(host).encodedPath(path);
        java.util.Iterator<String> keys = params.keys();
        while (keys.hasNext()) { String key = keys.next(); url.addQueryParameter(key, params.getString(key)); }
        Request.Builder request = new Request.Builder().url(url.build()).get()
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")
                .header("Referer", "https://www.bilibili.com/");
        if (!cookie.isEmpty()) request.header("Cookie", cookie);
        Call http = client.newCall(request.build());
        BilibiliRequest work = running.get();
        if (work != null) work.attach(http);
        try (Response response = http.execute()) {
            if (!response.isSuccessful()) throw new Failure(response.code(), "upstream-http");
            if (received != null) {
                for (String value : response.headers("Set-Cookie")) {
                    Cookie parsed = Cookie.parse(url.build(), value);
                    if (parsed != null && parsed.name().matches("SESSDATA|bili_jct|DedeUserID|DedeUserID__ckMd5")
                            && (parsed.domain().equals("bilibili.com") || parsed.domain().equals(host))) received.put(parsed.name(), parsed);
                }
            }
            JSONObject body = new JSONObject(response.body() == null ? "{}" : response.body().string());
            int code = body.optInt("code", Integer.MIN_VALUE);
            if (code != 0) throw new Failure(code == -101 ? 401 : code == -412 || code == -352 ? 403 : 502, String.valueOf(code));
            JSONObject data = body.optJSONObject("data");
            if (data == null) throw new Failure(502, "invalid-response");
            return data;
        }
    }

    private JSONObject params(JSObject input, String... names) throws Exception {
        JSONObject result = new JSONObject();
        for (String name : names) if (input.has(name)) result.put(name, input.getString(name));
        return result;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        BilibiliRequest work = cancellable.get(call.getString("requestId", ""));
        if (work != null) work.cancel();
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String operation = call.getString("operation", "");
        String handle = call.getString("session", "");
        JSObject input = call.getObject("params", new JSObject());
        final int attempt;
        synchronized (lock) {
            if ("qrStart".equals(operation)) { generation++; pendingKey = ""; pendingUntil = 0; }
            if ("qrCancel".equals(operation)) {
                String key = input.optString("key");
                if (key.equals(pendingKey)) { generation++; pendingKey = ""; }
                try { if (!key.isEmpty() && key.equals(session().optString("loginKey"))) forget(); }
                catch (Exception ignored) { /* No credential is returned on cancellation. */ }
                call.resolve(new JSObject().put("ok", true).put("data", new JSONObject()));
                return;
            }
            attempt = generation;
        }
        String requestId = call.getString("requestId", "");
        BilibiliRequest work = new BilibiliRequest();
        if (!requestId.isEmpty()) cancellable.put(requestId, work);
        requests.execute(() -> {
            running.set(work);
            try {
                if (work.isCancelled()) throw new Failure(499, "request-cancelled");
                JSONObject data;
                String newHandle = null;
                switch (operation) {
                    case "qrStart":
                        data = get("/x/passport-login/web/qrcode/generate", new JSONObject(), "", null);
                        synchronized (lock) {
                            if (attempt != generation) throw new Failure(409, "login-cancelled");
                            pendingKey = data.getString("qrcode_key");
                            pendingUntil = System.currentTimeMillis() + 180000;
                            data.put("expiresAt", pendingUntil);
                        }
                        break;
                    case "qrPoll": {
                        String key = input.optString("key");
                        synchronized (lock) {
                            if (key.isEmpty() || !key.equals(pendingKey) || pendingUntil <= System.currentTimeMillis()) throw new Failure(410, "qr-expired");
                            if (key.equals(session().optString("loginKey"))) {
                                data = new JSONObject().put("code", 0);
                                newHandle = session().getString("handle");
                                break;
                            }
                        }
                        Map<String, Cookie> cookies = new HashMap<>();
                        JSONObject poll = get("/x/passport-login/web/qrcode/poll", new JSONObject().put("qrcode_key", key), "", cookies);
                        int code = poll.getInt("code");
                        data = new JSONObject().put("code", code);
                        if (code == 0) {
                            if (!cookies.containsKey("SESSDATA")) throw new Failure(502, "missing-session-cookie");
                            StringBuilder header = new StringBuilder();
                            for (Cookie cookie : cookies.values()) {
                                if (cookie.expiresAt() <= System.currentTimeMillis()) continue;
                                if (header.length() > 0) header.append("; ");
                                header.append(cookie.name()).append('=').append(cookie.value());
                            }
                            // Check the actual account before reporting confirmation.
                            JSONObject account = get("/x/web-interface/nav", new JSONObject(), header.toString(), null);
                            if (!account.optBoolean("isLogin")) throw new Failure(401, "session-unverified");
                            synchronized (lock) {
                                if (attempt != generation || !key.equals(pendingKey)) throw new Failure(410, "qr-expired");
                                // Two polls can overlap when the WebView resumes; keep the first committed handle.
                                if (key.equals(session().optString("loginKey"))) {
                                    newHandle = session().getString("handle");
                                    break;
                                }
                                newHandle = "native:" + UUID.randomUUID();
                                JSONObject saved = new JSONObject().put("handle", newHandle).put("cookie", header.toString())
                                        .put("loginKey", key).put("expiresAt", Math.min(cookies.get("SESSDATA").expiresAt(), System.currentTimeMillis() + 30L * 86400000));
                                AtomicFile file = sessionFile();
                                FileOutputStream output = file.startWrite();
                                try { output.write(saved.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); }
                                catch (Exception error) { file.failWrite(output); throw error; }
                                session = saved;
                            }
                        }
                        break;
                    }
                    case "logout":
                        synchronized (lock) {
                            if (!handle.isEmpty() && handle.equals(session().optString("handle"))) forget();
                        }
                        data = new JSONObject();
                        break;
                    case "nav":
                        data = get("/x/web-interface/nav", new JSONObject(), cookieFor(handle), null);
                        break;
                    case "folders": {
                        String cookie = cookieFor(handle);
                        JSONObject account = get("/x/web-interface/nav", new JSONObject(), cookie, null);
                        data = get("/x/v3/fav/folder/created/list-all", new JSONObject().put("up_mid", String.valueOf(account.getLong("mid"))), cookie, null);
                        data.put("ownerId", String.valueOf(account.getLong("mid")));
                        break;
                    }
                    case "tracks": {
                        String cookie = cookieFor(handle);
                        JSONObject account = get("/x/web-interface/nav", new JSONObject(), cookie, null);
                        data = get("/x/v3/fav/resource/list", params(input, "media_id", "pn", "ps"), cookie, null);
                        if (data.getJSONObject("info").getJSONObject("upper").getLong("mid") != account.getLong("mid")) throw new Failure(403, "folder-not-owned");
                        break;
                    }
                    case "view":
                        data = get("/x/web-interface/view", params(input, "bvid", "aid"), handle.isEmpty() ? "" : cookieFor(handle), null);
                        break;
                    case "playurl":
                        data = get("/x/player/playurl", params(input, "bvid", "cid", "fnval", "fnver", "fourk"), handle.isEmpty() ? "" : cookieFor(handle), null);
                        break;
                    case "audioProbe":
                        try { data = new JSONObject().put("url", new BilibiliAudioProbe(client).verify(input.optString("url"), work::attach)); }
                        catch (java.io.IOException error) {
                            String code = error.getMessage();
                            // Only fixed diagnostic codes cross the bridge, never a signed URL from an I/O exception.
                            throw new Failure(502, code != null && code.matches("audio-http-[0-9]{3}|invalid-audio-host|invalid-audio-content|audio-redirect-limit") ? code : "audio-unreachable");
                        }
                        break;
                    default: throw new Failure(400, "unsupported-operation");
                }
                JSObject result = new JSObject().put("ok", true).put("data", data);
                if (newHandle != null) result.put("session", newHandle);
                call.resolve(result);
            } catch (Failure error) {
                call.resolve(new JSObject().put("ok", false).put("status", error.status).put("code", error.code));
            } catch (Exception error) {
                // Never log cookies, response bodies, poll keys or native handles.
                call.resolve(new JSObject().put("ok", false).put("status", 0).put("code", "native-request-failed"));
            } finally {
                running.remove();
                if (!requestId.isEmpty()) cancellable.remove(requestId, work);
            }
        });
    }
}
