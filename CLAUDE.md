# CLAUDE.md — A股市场温度计 / 指数拥挤度

Android APP 项目。原生 Android（Gradle + WebView），行情数据来自 iFinD（quantapi.51ifind.com）。

## 目录位置

- 本地：`E:\claude code\A股市场温度计\温度计APP`
- GitHub：`flywalkerone-design/A-index`（public，main 分支）
- **远端 `origin/main` 是权威**（曾领先本地多个提交）。操作前先 `git fetch` 核对分叉，勿盲目 force-push。

## 技术栈与架构

- 前端资源在 `www/`（HTML/JS/CSS/JSON）。构建时由 CI 同步到 `android/app/src/main/assets/www/`（该目录是冗余副本，构建时会被覆盖，不要直接改那里）。
- `android/app/src/main/java/com/stocktemp/app/MainActivity.java` 通过 `@JavascriptInterface` 桥接 iFinD API。
- 当前是「frozen snapshot 0815」变体：applicationId `com.stocktemp.app.v0815`，versionName `0815`，`isFrozenBuild()` 返回 true，数据来自 `www/data/frozen_data_0815.json`。

## 构建 APK

- 参数：AGP 8.2.2 + Gradle 8.5 + JDK 17 + compileSdk 34 / minSdk 24 / targetSdk 34。
- CI：`.github/workflows/build-apk.yml`，push 到 main/tag 或手动触发，构建 **release APK**。
- **构建规则**：
  - **只在用户主动要求时构建，不自动触发。**
  - **每个版本独立签名**：CI 每次构建用 `keytool` 生成全新 keystore（密码取 `github.run_id`），各版本签名互不相同 → 多版本可并存、老版本可回退。
  - **版本号日期化**：applicationId 以日期结尾（`com.stocktemp.app.v0822`）、versionName 取日期（`0822`）；同一天多次构建用 workflow_dispatch 的 `version_seq` 输入（V1/V2/V3 后缀）。
- APK 产物去 GitHub Actions 页面下载（artifact 名 `index-crowding-<日期>`，需登录 GitHub）。
- 仓库 Gradle wrapper 不完整（缺 gradle-wrapper.jar 和 unix `gradlew`），CI 用 `gradle-version` 直接装 Gradle。本地不要依赖 `./gradlew`，Windows 用 `gradlew.bat`。
- **CI 只走原生 Android，不走 Buildozer**。仓库里另有 Kivy/Buildozer 路径（main.py / buildozer.spec / Flask / server.py），那是旧方案。

## 数据与 Token

- iFinD token：`ifind_token.txt`，有效期约 7 天，过期需更新。
- 更新方式：APP 内 ⚙️设置 → 🔑Token管理，或直接编辑 `ifind_token.txt`。

## ⚠️ 已知问题

- 签名安全隐患已解决：不再硬编码 release 密钥/密码，改为 CI 每次构建生成独立 keystore（见「构建 APK」）。
