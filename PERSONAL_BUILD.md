# Folia 个人安卓构建

这是供 Nishino0525Nanase 使用的非官方构建，版本 **0.7.21.6**，应用 ID 为 `io.github.nishino0525nanase.folia`。播放器、歌词动画与原生媒体控制均来自开源项目，保留 AGPL-3.0 许可证。

## 来源

- 主项目：[chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)，Folia 0.7.21。
- Android 适配：[maimai993/folia-sonnet](https://github.com/maimai993/folia-sonnet)，基础提交 `44193e589e4ddfce0cd91dea5c95d9380ab4d02d`。
- 个人源码仓库：[Nishino0525Nanase/folia-android](https://github.com/Nishino0525Nanase/folia-android)。

## 此构建调整

- 独立应用 ID 和独立签名，可与其他签名版本共存；保留原生 Java namespace，平台桥接路径无需更改。
- 以音乐应用分类，名称为“Folia 个人版”。
- 关闭社区 APK 自动更新，设置页指向稳定下载页；后续版本继续使用相同签名。
- 沿用原版画布、胶囊播放器与页面入口；手机轻触可展开播放控制，右下按钮按需打开页面与操作菜单，保留原版主题、背景和歌词动画。
- 手机首次打开且没有保存资料库界面选择时默认显示经典曲库；保留已有选择，无内容的无限墙提供搜索、连接音乐源和本地导入入口。
- 按已安装 QQ 接口库 3.3.3 的双 ID 文件名格式生成播放请求，保留原有音质回退和权限拒绝处理。
- 网易云游客注册与歌曲地址改用已安装接口库 4.41.1 的 XEAPI 协议；其余原生接口保留原路径，仍尊重账号与歌曲播放权限。协议来源的 MIT 声明随源码及安装包保留。
- 未配置本机 AI 密钥时，使用封面配色并静默完成自动换色；填写密钥后仍可选择 AI 生成，配置说明指向真实 AI 服务。
- 手机搜索提交后收起键盘，搜索和队列提供 44px 触摸目标；保存弹窗防止重复提交并等待保存完成。
- 暂停时降低视觉更新频率，隐藏页面停止视觉循环，返回时立即按实际时钟恢复；保留原生频谱通路与播放控制。
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

## 使用

首次打开后可导入本地音乐，或在应用中登录所需的音乐平台。在线源通过已有原生桥发送请求，歌曲能否播放仍取决于账号权限、地区和平台接口状态。会员歌曲不会因本项目而获得额外权限。

本构建不内置 AI 密钥或个人账号。AI 主题生成需要另行配置；本地文件、设置和登录态存放在手机应用数据中。安卓容器与网页版所依赖的网络能力不同，纯静态网页不会包含原生请求桥。

## 个人仓库工作流

已移除上游专用的桌面发布、Docker 发布、定时同步及自动议题维护流程，避免个人 Fork 推送时误触发上游发布行为。保留 PR 单元测试，并提供手动运行的 `Android Personal · Debug APK` 工作流：Node.js 24、JDK 21、SDK 36.1，执行 `npm ci --ignore-scripts`、`cap:sync:android` 和 `assembleDebug`，上传可安装的 **debug 测试包**。CI 不保存发布签名密钥；debug 包不用于覆盖本次独立签名的 release 安装包，各次 CI 的临时 debug 签名也可能不同。

## 稳定下载地址

[获取最新版 Android APK](https://folia-elvis.blushbox8.chatgpt.site/download)。0.7.21.6 可直接覆盖安装个人版 0.7.21.1 至 0.7.21.5，无需卸载；网页地址仍可在手机浏览器使用。
