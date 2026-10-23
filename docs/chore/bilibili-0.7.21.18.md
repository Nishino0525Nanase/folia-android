# Android 0.7.21.18：收藏夹图片的实际加载路径

## 原因与修改

0.7.21.17 只把图片 `fetch` 加入原生桥，收藏夹卡片、视频磁贴等仍由 `<img>` / CSS background 直接请求图片，来源是 `https://localhost/`。此外，原生通用 HTTP 桥没有为图片补 B 站 Referer。读取到了封面字段不等于图片加载成功。

2026-10-23 用同一个公开图片实测：`https://i2.hdslb.com/bfs/archive/0225b1f1a790393097ceebb51e89796be806d6bc.jpg`，相同 Chrome UA，Referer 为 `https://localhost/` 时 HTTP 403；改为 `https://www.bilibili.com/` 时 HTTP 200、`image/jpeg`，头部 `ffd8ffe0`，缓存头 `max-age=31536000`。这是开发环境的公开图片请求，不是用户手机或全部收藏夹的验收。

- 原生 `BilibiliArtworkWebViewClient` 继承 Capacitor 的 `BridgeWebViewClient`，只接管 `hdslb.com` 及其子域 `/bfs/` 的 GET 子资源。统一处理 `<img>`、CSS、Image.decode 和 fetch，其他页面、导航及 Capacitor 本地资源仍走原实现。参考 [Android WebViewClient API](https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest))。
- 图片用 B 站来源和浏览器 UA，HTTP 地址升为 HTTPS，不转交页面请求头、Cookie 或登录凭据；重定向逐次校验域名，最多 3 次。
- 32 MiB 原生 HTTP 磁盘缓存，直接向 WebView 流式返回图片，避免每张图经 JS base64 转换。检查 HTTP 状态、图片 MIME 和常见图片文件头，错误页不落入缓存，错误请求不永久禁用该地址。
- 去掉 .17 的图片通用 fetch 代理，让所有界面用同一路径。封面缓存读到旧 HTML/JSON 错误页时删除该条并重取，下载时也拒绝非图片响应。
- 列表或详情没有单独封面的非空收藏夹，读取资源首页，优先用返回的收藏夹封面，再用第一个有效视频封面。最多并行 2 个，整批预算 8 秒，可取消；失败保留收藏夹和计数，下次刷新可再试。空收藏夹保留占位图。不会为了封面解析视频播放地址。

## 验证与边界

回归覆盖来源请求头、不发送凭据、域名和重定向限制、拒绝伪装成图片的 HTML、失败后重试、旧错误图片缓存清理、收藏夹封面补齐与超时、21 个收藏夹分页及 141 条收藏分页。运行 TypeScript 类型检查、上述前端回归及 17 个原生 B 站单元测试，并构建签名 release APK。

没有接入用户的手机或私人收藏夹，无法在开发环境逐张确认其全部封面；返回空封面的资源、已不存在的图片或持续网络拒绝仍可能显示占位图。本版不更改播放鉴权和歌词识别能力。
