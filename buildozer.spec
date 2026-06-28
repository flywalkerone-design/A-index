[app]

# App基本信息
title = A股温度计
package.name = stocktemp
package.domain = com.stocktemp.app
source.dir = .
source.include_exts = py,html,txt,csv,json
version = 1.0.0

# Python版本
requirements = python3,flask,pandas,numpy,requests,loguru,kivy,android,pyjnius

# Android配置
android.permissions = INTERNET, ACCESS_NETWORK_STATE
android.api = 33
android.minapi = 21
android.ndk = 25b
android.archs = arm64-v8a
android.allow_backup = True

# 包含的文件（打包进APK）
source.include_patterns = utils/*,data/*,A股温度计_自定义版.html,config.py,data_service.py,server.py,ifind_token.txt

# 全屏模式
fullscreen = 0
orientation = portrait

# 图标和启动画面（可选，后续替换）
# icon.filename = %(source.dir)s/icon.png
# presplash.filename = %(source.dir)s/splash.png

# 日志级别
log_level = 1

# Android服务（后台运行）
# android.service_class = com.stocktemp.app.Service

[buildozer]
log_level = 2
warn_on_root = 0
