plugins {
    id("com.android.application")
}

// ━━ 每次构建独立签名 + 版本日期化（由 CI 用 -P 参数传入）━━
// buildDate: MMDD（如 0822）；buildSeq: 同一天第几个版本（V1/V2/V3，默认 1）
// signKeystore / signStorePass / signKeyAlias / signKeyPass: 本次构建生成的独立 keystore（CI 每次用 keytool 新建）
val buildDate = (project.findProperty("buildDate") as String?) ?: "dev"
val buildSeq = (project.findProperty("buildSeq") as String?) ?: "1"
val signKeystore = (project.findProperty("signKeystore") as String?) ?: ""
val signStorePass = (project.findProperty("signStorePass") as String?) ?: ""
val signKeyAlias = (project.findProperty("signKeyAlias") as String?) ?: "release"
val signKeyPass = (project.findProperty("signKeyPass") as String?) ?: ""

android {
    namespace = "com.stocktemp.app"
    compileSdk = 34

    defaultConfig {
        // 每个版本独立 applicationId（日期后缀），配合独立签名实现多版本并存、老版本可回退
        applicationId = "com.stocktemp.app.v" + buildDate
        minSdk = 24
        targetSdk = 34
        versionCode = (buildDate.toIntOrNull() ?: 0) * 10 + (buildSeq.toIntOrNull() ?: 1)
        versionName = if (buildSeq == "1") buildDate else buildDate + "V" + buildSeq
    }

    // 独立签名：仅当 CI 传入 keystore 时才配置（每次构建一把新密钥）
    if (signKeystore.isNotEmpty()) {
        signingConfigs {
            create("release") {
                storeFile = file(signKeystore)
                storePassword = signStorePass
                keyAlias = signKeyAlias
                keyPassword = signKeyPass
            }
        }
    }

    buildTypes {
        release {
            if (signKeystore.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
            // WebView + JS 桥应用，混淆有风险，关闭以保稳定
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    // 打包时包含 assets/www/ 下的所有文件
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.webkit:webkit:1.8.0")
}
