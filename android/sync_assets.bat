@echo off
:: 快速同步 www/ 到 assets（不需要完整构建）
echo 同步网页文件到 assets...
if exist "app\src\main\assets\www" rmdir /s /q "app\src\main\assets\www"
mkdir "app\src\main\assets\www\js" 2>nul
xcopy /s /e /y "..\www\*" "app\src\main\assets\www\" >nul
echo 完成 ✓
