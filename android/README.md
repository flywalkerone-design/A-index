# A股温度计 Android APK

**完全本地运行，不需要开电脑。**

## 项目结构

```
android/
├── app/
│   ├── build.gradle.kts          # App 构建配置
│   ├── proguard-rules.pro        # 混淆规则
│   └── src/main/
│       ├── AndroidManifest.xml   # 应用清单
│       ├── assets/www/           # 网页文件（自动同步）
│       ├── java/.../MainActivity.java  # 主 Activity + iFinD API
│       └── res/                  # 资源文件（图标、主题等）
├── build.gradle.kts              # 项目级构建配置
├── settings.gradle.kts           # Gradle 设置
├── gradle.properties             # Gradle 属性
├── gradle/wrapper/               # Gradle Wrapper
├── build.bat / build.sh          # 构建脚本
├── setup_gradle.bat              # Gradle 初始化脚本
└── README.md                     # 本文件
```

## 快速开始

### 方式一：GitHub Actions 自动构建（推荐）

1. 将代码推送到 GitHub
2. 在 GitHub 仓库页面 → Actions → "Build Android APK" → "Run workflow"
3. 等待构建完成，在 Artifacts 下载 APK

### 方式二：Android Studio 构建

1. 安装 [Android Studio](https://developer.android.com/studio)
2. 打开 Android Studio → "Open an existing project" → 选择 `android/` 目录
3. 等待 Gradle 同步完成
4. 菜单 Build → Build Bundle(s) / APK(s) → Build APK(s)
5. APK 生成在 `app/build/outputs/apk/release/`

### 方式三：命令行构建

```bash
# 前提：安装 JDK 17 + Android SDK
cd android
setup_gradle.bat          # 首次初始化 Gradle Wrapper
build.bat                 # 构建 APK
```

## 使用方法

### 1. 安装 APK

将构建好的 APK 传到手机安装。

### 2. 设置 token

1. 打开 app → 点击右上角 ⚙️ 设置
2. 在 "🔑 iFinD Token管理" 中粘贴你的 refresh_token
3. 点击"更新"

token 获取方式：从同花顺 iFinD 客户端获取 refresh_token。

### 3. 开始使用

设置好 token 后，app 会自动加载 28 个指数的数据并计算温度。

**token 有效期约 7 天**，过期后需要重新获取。

## 技术架构

```
┌─────────────────────────────────────────────┐
│  Android 手机（完全本地运行）                 │
│                                             │
│  ┌─ WebView ──────────────────────────────┐ │
│  │  index.html + JS                       │ │
│  │  ├── config.js     (指数配置)           │ │
│  │  ├── indicators.js (RSI/PERCENTRANK)   │ │
│  │  ├── scoring.js    (温度计算)           │ │
│  │  ├── fetch.js      (调用 Java 接口)     │ │
│  │  └── app.js        (UI渲染)            │ │
│  └───────────────┬────────────────────────┘ │
│                  │ JS Bridge                │
│  ┌─ Java ────────┴────────────────────────┐ │
│  │  MainActivity                          │ │
│  │  ├── Token 管理 (SharedPreferences)    │ │
│  │  ├── iFinD HTTP 请求                   │ │
│  │  └── JS 接口 (@JavascriptInterface)    │ │
│  └───────────────┬────────────────────────┘ │
│                  │ HTTPS                   │
└──────────────────┼─────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  iFinD API (quantapi.51ifind.com)           │
│  ├── /get_access_token  (token 交换)        │
│  ├── /cmd_history_quotation (指数行情)       │
│  └── /date_sequence     (融资余额)          │
└─────────────────────────────────────────────┘
```

### 数据流

1. JS `fetch.js` 调用 `Android.fetchIndexHistory(code, start, end)`
2. Java 层自动获取/缓存 access_token，发起 HTTPS 请求
3. 返回 JSON 数据给 JS
4. JS 本地计算 RSI、PERCENTRANK、温度等指标
5. 结果缓存在 localStorage，避免重复请求

## 常见问题

**Q: 提示 "未设置token"？**
A: 在设置中粘贴 iFinD refresh_token。

**Q: 提示 "TOKEN_ERROR"？**
A: token 已过期，需要获取新的 refresh_token。

**Q: 数据加载很慢？**
A: 首次加载需要请求 28 个指数的历史数据，约 1-2 分钟。之后有缓存会很快。

**Q: APK 安装时提示"未知来源"？**
A: 在手机设置 → 安全 → 允许安装未知来源应用。

## 构建配置

| 配置项 | 值 |
|--------|-----|
| applicationId | com.stocktemp.app |
| minSdk | 24 (Android 7.0) |
| targetSdk | 34 (Android 14) |
| versionName | 1.0.0 |
| Java | 17 |
| Gradle | 8.5 |
| AGP | 8.2.2 |
