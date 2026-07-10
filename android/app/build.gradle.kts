plugins {
    id("com.android.application")
}

android {
    namespace = "com.stocktemp.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.stocktemp.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 5
        versionName = "1.5.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
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
