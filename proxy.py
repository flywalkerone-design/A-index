"""
A股温度计 - browser proxy server
"""

import csv
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

app = Flask(__name__)
CORS(app)

CACHE_DIR = APP_DIR / "data" / "index_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
JSON_CACHE_FILE = APP_DIR / "data" / "api_data_cache.json"
_DATA_CACHE = {"data": None, "time": 0}


def _json_number(value):
    """Return a JSON-safe number; missing or non-finite values become null."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None

from data_service import check_token, fetch_all_data, update_token
from chart_data_service import load_chart_data
from utils.ifind_data import fetch_index_history_ifind, fetch_margin_ifind, fetch_rsi_ifind, fetch_turnover_ifind
from config import INDEXES


def _save_json_cache(data):
    JSON_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    JSON_CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _load_json_cache():
    if not JSON_CACHE_FILE.exists():
        return None
    try:
        return json.loads(JSON_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


@app.route("/")
def index():
    return send_file(APP_DIR / "www" / "index.html")


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_file(APP_DIR / "www" / "js" / filename)


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_file(APP_DIR / "www" / "css" / filename)


@app.route("/api/token/status")
def api_token_status():
    return jsonify(check_token())


@app.route("/api/token/update", methods=["POST"])
def api_token_update():
    data = request.get_json(silent=True) or {}
    token = data.get("token")
    if not token:
        return jsonify({"success": False, "error": "missing token"}), 400
    return jsonify(update_token(token))


@app.route("/api/data")
def api_data():
    force = request.args.get("force", "0") == "1"
    now = datetime.now().timestamp()

    if not force and _DATA_CACHE["data"] and now - _DATA_CACHE["time"] < 300:
        return jsonify(_DATA_CACHE["data"])

    try:
        result = fetch_all_data()
        if result.get("indices"):
            _DATA_CACHE["data"] = result
            _DATA_CACHE["time"] = now
            _save_json_cache(result)
            return jsonify(result)

        cached = _load_json_cache()
        if cached:
            cached["_from_cache"] = True
            cached["_cache_error"] = "; ".join(result.get("errors", [])[:3])
            return jsonify(cached)
        return jsonify(result)
    except Exception as e:
        cached = _load_json_cache()
        if cached:
            cached["_from_cache"] = True
            cached["_cache_error"] = str(e)
            return jsonify(cached)
        return jsonify({"error": str(e), "indices": [], "date": "", "errors": [str(e)]}), 500


@app.route("/api/chart_data")
def api_chart_data():
    try:
        return jsonify(load_chart_data())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _index_cache_path(code):
    return CACHE_DIR / f"{code}.csv"


def _load_cache_status(code):
    fp = _index_cache_path(code)
    if not fp.exists():
        return None
    try:
        with open(fp, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        if not rows:
            return None
        return {
            "days": len(rows),
            "from": rows[0].get("date"),
            "to": rows[-1].get("date"),
        }
    except Exception:
        return None


@app.route("/api/proxy/index_history", methods=["POST"])
def proxy_index_history():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    start = body.get("start", "2024-05-29")
    end = body.get("end", datetime.now().strftime("%Y-%m-%d"))
    if not code:
        return jsonify({"error": "missing code", "dates": [], "close": [], "volume": [], "amount": [], "pe": []}), 400

    try:
        df = fetch_index_history_ifind(code, start, end)
        if df is None or df.empty:
            return jsonify({"dates": [], "close": [], "volume": [], "amount": [], "pe": []})

        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "close": [_json_number(value) for value in df["close"]],
            "volume": [_json_number(value) for value in df["volume"]],
            "amount": [_json_number(value) for value in df["amount"]],
            "turnover_ratio": [_json_number(value) for value in df["turnover_ratio"]] if "turnover_ratio" in df.columns else [],
            "pe": [_json_number(value) for value in df["pe"]],
        })
    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "close": [], "volume": [], "amount": [], "turnover_ratio": [], "pe": []}), 500


@app.route("/api/proxy/margin", methods=["POST"])
def proxy_margin():
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    start = body.get("start", "")
    end = body.get("end", "")
    if not code:
        return jsonify({"error": "missing code", "dates": [], "margin_balance": []}), 400

    try:
        df = fetch_margin_ifind(code, start, end)
        if df is None or df.empty:
            return jsonify({"dates": [], "margin_balance": []})

        return jsonify({
            "dates": [d.strftime("%Y-%m-%d") for d in df["date"]],
            "margin_balance": [None if v != v else float(v) for v in df["margin_balance"]],
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


@app.route("/api/cache/status")
def cache_status():
    result = []
    for idx in INDEXES:
        code = idx["ifind_code"]
        cache = _load_cache_status(code)
        result.append({
            "code": code,
            "name": idx["name"],
            "days": cache["days"] if cache else 0,
            "from": cache["from"] if cache else None,
            "to": cache["to"] if cache else None,
        })
    return jsonify(result)


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  A股温度计 - JS frontend + Python proxy")
    print("  Frontend: http://localhost:5000")
    print("  API:      http://localhost:5000/api/*")
    print("  Cache:    data/index_cache/ + data/api_data_cache.json")
    print("=" * 50 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False)
