@echo off
setlocal
echo ========================================
echo   Gradle Wrapper 初始化脚本
echo ========================================
echo.
echo 此脚本将下载 Gradle Wrapper JAR 文件
echo 首次使用时需要运行此脚本
echo.

:: 检查 Java
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Java！请先安装 JDK 17
    echo 下载: https://adoptium.net/
    pause
    exit /b 1
)

:: 检查是否已有 wrapper
if exist "gradle\wrapper\gradle-wrapper.jar" (
    echo [信息] Gradle Wrapper 已存在，跳过下载
    echo.
    goto :build
)

:: 检查是否有 gradle 命令
where gradle >nul 2>&1
if %errorlevel% equ 0 (
    echo [信息] 使用系统 Gradle 生成 Wrapper...
    call gradle wrapper --gradle-version 8.5
    goto :build
)

:: 没有系统 gradle，手动下载 wrapper JAR
echo [信息] 下载 Gradle Wrapper JAR...
set "WRAPPER_URL=https://services.gradle.org/distributions/gradle-8.5-bin.zip"
set "WRAPPER_JAR=gradle\wrapper\gradle-wrapper.jar"

:: 创建目录
if not exist "gradle\wrapper" mkdir "gradle\wrapper"

:: 使用 PowerShell 下载
powershell -Command ^
    "$url = 'https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar'; " ^
    "Invoke-WebRequest -Uri $url -OutFile '%WRAPPER_JAR%'"

if not exist "%WRAPPER_JAR%" (
    echo [警告] 自动下载失败
    echo.
    echo 请手动操作：
    echo 1. 安装 Android Studio: https://developer.android.com/studio
    echo 2. 在 Android Studio 中打开 android/ 目录
    echo 3. Android Studio 会自动下载 Gradle Wrapper
    echo.
    echo 或者安装 Gradle: https://gradle.org/install/
    echo 然后运行: gradle wrapper --gradle-version 8.5
    pause
    exit /b 1
)

echo [信息] Gradle Wrapper JAR 下载成功 ✓

:build
echo.
echo [信息] 现在可以运行 build.bat 构建 APK 了
echo.
pause
