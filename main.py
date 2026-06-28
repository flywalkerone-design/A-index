"""
A股温度计 - Android APP入口
Kivy WebView + Flask后台服务
"""

import os
import sys
import threading
import time

# ━━━ Android环境路径设置 ━━━
# 在Android上，应用文件在 ANDROID_PRIVATE 或 ANDROID_APP_PATH 下
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if os.environ.get('ANDROID_PRIVATE'):
    # Buildozer打包后的路径
    APP_DIR = os.environ['ANDROID_PRIVATE']

# 确保APP_DIR在sys.path中（让config/utils能被找到）
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

# 切换工作目录到APP_DIR（确保相对路径正确）
os.chdir(APP_DIR)

from kivy.app import App
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.label import Label
from kivy.clock import Clock
from kivy.core.window import Window

# 尝试导入WebView（Android上可用）
try:
    from jnius import autoclass
    from android.runnable import run_on_ui_thread
    ANDROID = True
except ImportError:
    ANDROID = False

# ━━━ Flask服务（后台线程） ━━━
_server_ready = False


def start_flask_server():
    """在后台线程启动Flask服务"""
    global _server_ready
    try:
        # 延迟导入，确保sys.path已设置
        from server import app as flask_app
        flask_app.logger.disabled = True
        import logging
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)

        _server_ready = True
        flask_app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
    except Exception as e:
        print(f"Flask启动失败: {e}")
        _server_ready = True  # 标记为ready避免无限等待


# ━━━ Kivy应用 ━━━
class TempApp(App):
    def build(self):
        # 启动Flask后台线程
        server_thread = threading.Thread(target=start_flask_server, daemon=True)
        server_thread.start()

        # 等待服务就绪
        for _ in range(100):  # 最多等10秒
            if _server_ready:
                break
            time.sleep(0.1)

        if ANDROID:
            return self._build_android()
        else:
            return self._build_desktop()

    def _build_android(self):
        """Android上使用原生WebView"""
        from android.runnable import run_on_ui_thread
        from jnius import autoclass

        WebView = autoclass('android.webkit.WebView')
        WebViewClient = autoclass('android.webkit.WebViewClient')
        WebSettings = autoclass('android.webkit.WebSettings')
        activity = autoclass('org.kivy.android.PythonActivity').mActivity

        @run_on_ui_thread
        def create_webview():
            wv = WebView(activity)
            settings = wv.getSettings()
            settings.setJavaScriptEnabled(True)
            settings.setDomStorageEnabled(True)
            settings.setCacheMode(WebSettings.LOAD_DEFAULT)
            wv.setWebViewClient(WebViewClient())
            wv.loadUrl('http://127.0.0.1:5000')
            activity.setContentView(wv)

        create_webview()
        # 返回一个占位widget
        from kivy.uix.widget import Widget
        return Widget()

    def _build_desktop(self):
        """桌面测试用：显示提示信息"""
        layout = BoxLayout(orientation='vertical', padding=20)
        layout.add_widget(Label(
            text='A股温度计\n\n服务已启动\n请在浏览器访问:\nhttp://localhost:5000',
            font_size=18,
            halign='center',
            valign='middle'
        ))
        # 自动打开浏览器
        import webbrowser
        Clock.schedule_once(lambda dt: webbrowser.open('http://localhost:5000'), 1.5)
        return layout


if __name__ == '__main__':
    TempApp().run()
