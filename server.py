"""
A股温度计 - Flask本地服务
启动后访问 http://localhost:5000
"""

import sys
from pathlib import Path
from flask import Flask, jsonify, request, send_file

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

from data_service import fetch_all_data, check_token, update_token, TOKEN_FILE

app = Flask(__name__)

# 数据缓存
_cache = {"data": None, "time": 0}


@app.route("/")
def index():
    """返回前端页面"""
    return send_file(APP_DIR / "A股温度计_自定义版.html")


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
