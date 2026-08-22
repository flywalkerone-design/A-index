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

## ⭐ 温度计算核心逻辑（APP 与 Windows APP 通用，勿轻易改动）

1. **温度只在「所有因子数据都齐全」的日期计算**（收盘价、换手率、PE、RSI、融资余额 5 项，缺一项则该日无温度）。
2. **融资余额是 T+1 公布的**：最新一个交易日的融资余额还没出，所以该日通常不算温度。例如 2026-08-22（周六）构建快照时，08-20 是数据完整最后一天，08-21 的融资余额要等下周一。
3. **全局统一截止日**：所有指数统一显示到「所有指数都有完整数据」的最后一天（取各指数最后一个完整数据日的最小值），不按指数各自的最新日展示。实现见 `build_frozen_snapshot.py` 的 `global data cutoff` 逻辑。
4. 判断「融资余额是否已公布」用 `Fill: Blank`（不要用 `Fill: Previous`——会把前一交易日数据填充成"有数据"，从而算出假温度）。融资缓存 schema 升级过（v2→v3）。

## 数据源注意点

- 指数 PE 用 iFinD 行情字段 `pe_ttm_index`；用户 Excel 用 `ths_pe_ttm_sr_index`（剔除规则100/TTM基准日100）。两者最新日一致，**历史日口径有差**（亏损行业如光伏差异很大），属数据源固有差异，不是 bug。
- 指数融资余额历史：**中证自由现金流系列**（932365、932368）在 API 与 iFind 客户端间有 20~40% 的历史差异；**国证自由现金流（980092）无此问题**。当前 APP 用的是 980092（国证），勿换回中证的。
- 快照增量缓存有个坑：只补缓存两头、中间 PE 空洞永不自动补。已用 `build_frozen_snapshot.py` + 一次性 backfill 处理过（`data/index_cache/*.csv` 里 PE 曾大段缺失导致 27/38 指数 PE 分位失真）。新增指数后如需完整 PE 历史，先跑 PE 补洞再重建。

## ⚠️ 已知问题

- 签名安全隐患已解决：不再硬编码 release 密钥/密码，改为 CI 每次构建生成独立 keystore（见「构建 APK」）。

- APK 安装显示名已改为**动态生成**：`android/app/build.gradle.kts` 用 `resValue("string","app_name","指数温度计 "+displayVersion)` 生成，跟随版本日期（如「指数温度计 0822」），不再写死。
