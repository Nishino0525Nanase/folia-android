# Folia 个人安卓构建

这是供 Nishino0525Nanase 使用的非官方构建，版本 **0.7.21.9**，应用 ID 为 `io.github.nishino0525nanase.folia`。播放器、歌词动画与原生媒体控制均来自开源项目，保留 AGPL-3.0 许可证。

## 来源

- 主项目：[chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)，Folia 0.7.21。
- Android 适配：[maimai993/folia-sonnet](https://github.com/maimai993/folia-sonnet)，基础提交 `44193e589e4ddfce0cd91dea5c95d9380ab4d02d`。
- 个人源码仓库：[Nishino0525Nanase/folia-android](https://github.com/Nishino0525Nanase/folia-android)。

## 此构建调整

- 独立应用 ID 和独立签名，可与其他签名版本共存；保留原生 Java namespace，平台桥接路径无需更改。
- 以音乐应用分类，名称为“Folia 个人版”。
- 关闭社区 APK 自动更新，设置页指向稳定下载页；后续版本继续使用相同签名。
- 沿用原版画布、胶囊播放器与页面入口；手机轻触可展开播放控制，右下按钮直接打开原来的音效/背景控制台，控制台歌曲旁的更多按钮打开页面与操作菜单，保留原版主题、背景和歌词动画。
- 手机首次打开且没有保存资料库界面选择时默认显示经典曲库；保留已有选择，无内容的无限墙提供搜索、连接音乐源和本地导入入口。
- 按已安装 QQ 接口库 3.3.3 的双 ID 文件名格式生成播放请求，保留原有音质回退和权限拒绝处理。
- 网易云游客注册与歌曲地址改用已安装接口库 4.41.1 的 XEAPI 协议；其余原生接口保留原路径，仍尊重账号与歌曲播放权限。协议来源的 MIT 声明随源码及安装包保留。
- 未配置本机 AI 密钥且云缓存关闭时，使用封面配色并静默完成自动换色。用户显式开启云缓存并选择云端主题后，可免密钥读取已有主题；未命中或连接失败时回退封面配色，手动操作显示具体信息。生成新主题仍需自己的 API Key，保留原有原生生成链路。
- 手机搜索提交后收起键盘，搜索和队列提供 44px 触摸目标；保存弹窗防止重复提交并等待保存完成。
- 暂停时降低视觉更新频率，隐藏页面停止视觉循环，返回时立即按实际时钟恢复；保留原生频谱通路与播放控制。
- 手机默认隐现背景按容器 CSS 像素限制两层 Shader 分辨率；搜索覆盖时冻结装饰背景，关闭后恢复，不改变音乐与歌词时钟。主题及样式预览的暂停状态传给渲染器。
- 搜索页提供 B站视频链接导入与导入记录，支持公开可用音轨及分P；通过同一个公开 HTTPS 服务解析与播放，平台限制仍原样反馈，并提供原视频入口。
- B站新增二维码登录、自己的收藏夹浏览与收藏夹引用导入；音频播放凭据短时有效，导入记录不保存播放票据或平台 Cookie，退出登录后清理本机会话。
- 无歌词的曲目可手动选择其他平台歌词或导入歌词文件，保留原视频音源；手机歌词匹配窗口采用单列布局和 44px 触摸目标。
- AI 主题云缓存默认关闭，用户仍可在设置里显式开启。
- 关于页标明两级上游来源和 AGPL-3.0，保留其他上游署名。
- 修复上游 `package-lock.json` 与依赖清单不同步的问题。

## 构建

需要 Node.js 24+、JDK 21、Android SDK 36.1 与 Build Tools 36.1.0。使用项目的 Gradle 8.14.3 wrapper。

```bash
npm ci --ignore-scripts
FOLIA_BUILD_REPO=Nishino0525Nanase/folia-android npm run cap:sync:android
cd android
bash ./gradlew assembleRelease
```

发布签名配置使用 `android/keystore.properties.example`。签名密钥、密码和 `keystore.properties` 属于私密构建配置，不应提交到公开仓库或源码压缩包。没有签名配置时 release 产物为未签名包，不能直接安装。

Android 构建为 `VITE_BILIBILI_API_BASE` 设置默认值 `https://folia-elvis.blushbox8.chatgpt.site/api/bilibili`；可用同名环境变量明确覆盖。B站请求使用普通 HTTPS，不走其他音源的原生接口。可选提交花名查询默认关闭，只有 `FOLIA_RESOLVE_COMMIT_NAME=true` 时才联网查询。

## 使用

首次打开后可导入本地音乐，或在应用中登录所需的音乐平台。在线源通过已有原生桥发送请求，歌曲能否播放仍取决于账号权限、地区和平台接口状态。会员歌曲不会因本项目而获得额外权限。

本构建不内置 AI 密钥或个人账号。AI 主题生成需要另行配置；本地文件、设置和登录态存放在手机应用数据中。安卓容器与网页版所依赖的网络能力不同，纯静态网页不会包含原生请求桥。

后台听音频沿用原有媒体前台服务、媒体通知与 WebView 音频播放链路；切到后台时停止画面渲染，不主动暂停音频。它依赖应用及 WebView 继续存活，不能保证被系统终止进程后仍可继续播放或通过锁屏按钮恢复。熄屏、后台切歌、耳机控制和音频焦点仍需在实际手机上验证。

## 个人仓库工作流

已移除上游专用的桌面发布、Docker 发布、定时同步及自动议题维护流程，避免个人 Fork 推送时误触发上游发布行为。保留 PR 单元测试，并提供手动运行的 `Android Personal · Debug APK` 工作流：Node.js 24、JDK 21、SDK 36.1，执行 `npm ci --ignore-scripts`、`cap:sync:android` 和 `assembleDebug`，上传可安装的 **debug 测试包**。CI 不保存发布签名密钥；debug 包不用于覆盖本次独立签名的 release 安装包，各次 CI 的临时 debug 签名也可能不同。

## 稳定下载地址

[获取最新版 Android APK](https://folia-elvis.blushbox8.chatgpt.site/download)。0.7.21.9 可直接覆盖安装个人版 0.7.21.1 至 0.7.21.8，无需卸载；网页地址仍可在手机浏览器使用。
