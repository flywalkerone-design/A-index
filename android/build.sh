#!/bin/bash
set -e
echo "========================================"
echo "  A股温度计 Android APK 构建脚本"
echo "========================================"
echo

# 检查 Java
if ! command -v java &> /dev/null; then
    echo "[错误] 未找到 Java！"
    echo "请安装 JDK 17: https://adoptium.net/"
    exit 1
fi

# 检查 ANDROID_HOME
if [ -z "$ANDROID_HOME" ]; then
    echo "[警告] 未设置 ANDROID_HOME，尝试默认路径..."
    export ANDROID_HOME="$HOME/Android/Sdk"
fi

if [ ! -d "$ANDROID_HOME" ]; then
    echo "[错误] 未找到 Android SDK！"
    echo "请安装 Android Studio 或设置 ANDROID_HOME"
    exit 1
fi

echo "[信息] Java: $(java -version 2>&1 | head -1)"
echo "[信息] Android SDK: $ANDROID_HOME"
echo

# 复制 web 文件
echo "[1/3] 复制网页文件到 assets..."
rm -rf app/src/main/assets/www
mkdir -p app/src/main/assets/www/js
cp -r ../www/* app/src/main/assets/www/
echo "      完成 ✓"

# 构建
echo
echo "[2/3] 构建 Release APK..."
./gradlew assembleRelease
echo "      完成 ✓"

# 复制
echo
echo "[3/3] 复制 APK 到输出目录..."
OUTPUT="../output/apk"
mkdir -p "$OUTPUT"
cp app/build/outputs/apk/release/app-release.apk "$OUTPUT/A股温度计.apk"
echo "      完成 ✓"

echo
echo "========================================"
echo "  构建成功！"
echo "  APK 位置: $OUTPUT/A股温度计.apk"
echo "========================================"
