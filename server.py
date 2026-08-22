"""
A股温度计 - Flask本地服务
启动后访问 http://localhost:5000
"""

import sys
import math
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request, send_file

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

from data_service import fetch_all_data, check_token, update_token, TOKEN_FILE
from chart_data_service import load_chart_data
from utils.ifind_data import fetch_index_history_ifind, fetch_margin_ifind, fetch_turnover_ifind, fetch_rsi_ifind

app = Flask(__name__)

# 数据缓存
_cache = {"data": None, "time": 0}
_chart_cache = {"data": None, "time": 0}


@app.route("/")
def index():
    """返回前端页面"""
    return send_file(APP_DIR / "www" / "index.html")


# 冻结版浏览器预览：注入 window.Android stub，让 App 走内置 frozen_data 快照，
# 无需 iFinD token 即可预览（数据 Tab 图表、因子表、海报等）。
_PREVIEW_STUB = """<script>
window.Android = {
    isAndroid: function () { return true; },
    isFrozenBuild: function () { return true; },
    hasRefreshToken: function () { return false; },
    setLandscape: function () {},
    setRefreshToken: function () {},
    fetchIndexHistory: function () { return '{"error":"NO_TOKEN"}'; },
    fetchMargin: function () { return '{"error":"NO_TOKEN"}'; },
    fetchMarginMarketStats: function () { return '{"error":"NO_TOKEN"}'; },
    fetchDateSequence: function () { return '{"error":"NO_TOKEN"}'; },
    checkToken: function () { return '{"valid":false,"error":"preview"}'; },
    // 不提供 saveImage：让浏览器走原生 canvas.toBlob 下载，便于预览时保存海报
    showToast: function (m) { console.log("[toast]", m); }
};
</script>
"""


@app.route("/preview")
def preview():
    """冻结版预览页（注入 window.Android 冻结 stub）"""
    html = (APP_DIR / "www" / "index.html").read_text(encoding="utf-8")
    marker = '<script src="js/config.js'
    if marker in html:
        html = html.replace(marker, _PREVIEW_STUB + marker, 1)
    return html


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_file(APP_DIR / "www" / "js" / filename)


@app.route("/data/<path:filename>")
def serve_data(filename):
    return send_file(APP_DIR / "www" / "data" / filename)


@app.route("/api/data")
def api_data():
    """获取全部指数数据"""
    import time
    force = request.args.get("force", "0") == "1"
    now = time.time()

    # 缓存5分钟，避免重复请求
    if not force and _cache["data"] and (now - _cache["time"]) < 300:
        return jsonify(_cache["data"])

    try:
        result = fetch_all_data()
        _cache["data"] = result
        _cache["time"] = now
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e), "indices": [], "date": "", "errors": [str(e)]}), 500


@app.route("/api/token/status")
def api_token_status():
    """检查token状态"""
    return jsonify(check_token())


@app.route("/api/chart_data")
def api_chart_data():
    import time
    now = time.time()
    if _chart_cache["data"] and (now - _chart_cache["time"]) < 300:
        return jsonify(_chart_cache["data"])
    try:
        result = load_chart_data()
        result["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        _chart_cache["data"] = result
        _chart_cache["time"] = now
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _json_number(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


@app.route("/api/proxy/index_history", methods=["POST"])
def api_proxy_index_history():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    start = body.get("start", "2024-01-01")
    end = body.get("end", datetime.now().strftime("%Y-%m-%d"))
    if not code:
        return jsonify({"error": "缺少指数代码", "dates": [], "close": []}), 400
    try:
        df = fetch_index_history_ifind(code, start, end)
        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "close": [_json_number(value) for value in df["close"]],
            "volume": [_json_number(value) for value in df["volume"]],
            "amount": [_json_number(value) for value in df["amount"]],
            "pe": [_json_number(value) for value in df["pe"]],
        })
    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "close": []}), 500


@app.route("/api/proxy/margin", methods=["POST"])
def api_proxy_margin():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    if not code:
        return jsonify({"error": "缺少指数代码", "dates": [], "margin_balance": []}), 400
    try:
        df = fetch_margin_ifind(code, body.get("start", ""), body.get("end", ""))
        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "margin_balance": [_json_number(value) for value in df["margin_balance"]],
        })
    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "margin_balance": []}), 500


@app.route("/api/proxy/turnover", methods=["POST"])
def proxy_turnover():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    start = body.get("start", "")
    end = body.get("end", "")
    if not code:
        return jsonify({"error": "missing code", "dates": [], "turnover_ratio": []}), 400

    try:
        df = fetch_turnover_ifind(code, start, end)
        if df is None or df.empty:
            return jsonify({"dates": [], "turnover_ratio": []})

        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "turnover_ratio": [None if v != v else float(v) for v in df["turnover_ratio"]],
        })
    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "turnover_ratio": []}), 500


@app.route("/api/proxy/rsi", methods=["POST"])
def proxy_rsi():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    start = body.get("start", "")
    end = body.get("end", "")
    if not code:
        return jsonify({"error": "missing code", "dates": [], "rsi": []}), 400

    try:
        df = fetch_rsi_ifind(code, start, end)
        if df is None or df.empty:
            return jsonify({"dates": [], "rsi": []})

        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "rsi": [None if v != v else float(v) for v in df["rsi"]],
        })
    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "rsi": []}), 500


@app.route("/api/token/update", methods=["POST"])
def api_token_update():
    """更新token"""
    data = request.get_json()
    if not data or "token" not in data:
        return jsonify({"success": False, "error": "缺少token参数"}), 400
    return jsonify(update_token(data["token"]))


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  A股温度计 APP")
    print("  访问: http://localhost:5000")
    print("=" * 50 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False)
