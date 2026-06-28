@echo off
setlocal
echo ========================================
echo   A股温度计 Android APK 构建脚本
echo ========================================
echo.

:: 检查 Java
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Java！
    echo 请安装 JDK 17: https://adoptium.net/
    echo.
    pause
    exit /b 1
)

:: 检查 ANDROID_HOME
if "%ANDROID_HOME%"=="" (
    echo [警告] 未设置 ANDROID_HOME 环境变量
    echo 尝试使用默认路径...
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)

if not exist "%ANDROID_HOME%" (
    echo [错误] 未找到 Android SDK！
    echo 请安装 Android Studio 或设置 ANDROID_HOME
    echo 下载: https://developer.android.com/studio
    echo.
    pause
    exit /b 1
)

echo [信息] Java:
java -version 2>&1
echo [信息] Android SDK: %ANDROID_HOME%
echo.

:: 复制 web 文件到 assets
echo [1/3] 复制网页文件到 assets...
if exist "app\src\main\assets\www" rmdir /s /q "app\src\main\assets\www"
mkdir "app\src\main\assets\www\js" 2>nul
xcopy /s /e /y "..\www\*" "app\src\main\assets\www\" >nul
echo       完成 ✓

:: 构建 APK
echo.
echo [2/3] 构建 Release APK...
call gradlew.bat assembleRelease
if %errorlevel% neq 0 (
    echo.
    echo [错误] 构建失败！
    pause
    exit /b 1
)
echo       完成 ✓

:: 复制 APK 到输出目录
echo.
echo [3/3] 复制 APK 到输出目录...
set "OUTPUT=..\output\apk"
if not exist "%OUTPUT%" mkdir "%OUTPUT%"
copy /y "app\build\outputs\apk\release\app-release.apk" "%OUTPUT%\A股温度计.apk" >nul
echo       完成 ✓

echo.
echo ========================================
echo   构建成功！
echo   APK 位置: %OUTPUT%\A股温度计.apk
echo ========================================
echo.
pause
