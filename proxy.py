"""
A股温度计 - CORS 代理服务器（带磁盘缓存）
============================================
职责：
  1. 静态文件服务
  2. 代理 iFinD API 请求（加 CORS 头）
  3. 磁盘缓存：历史数据只在首次或过期时调用 API
  4. 增量更新：只请求缺失的日期范围，节省 API 调用次数

缓存策略：
  - 行情数据：data/index_cache/{code}.csv（首次全量，后续增量）
  - 融资余额：data/ifind_margin_cache/{code}.csv（已有逻辑）
  - API 结果内存缓存：5分钟
  - 缓存有效期：交易日18:00后当天有效，否则用昨天的缓存
"""

import sys
import time
import csv
import io
from pathlib import Path
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

app = Flask(__name__)
CORS(app)

# ━━━ 缓存目录 ━━━
CACHE_DIR = APP_DIR / "data" / "index_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ━━━ 缓存 ━━━
_data_cache = {"data": None, "time": 0}           # 内存缓存
_json_cache_file = APP_DIR / "data" / "api_data_cache.json"  # 磁盘缓存


def _save_json_cache(data):
    """将 /api/data 的结果保存到磁盘"""
    import json
    try:
        _json_cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(_json_cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print(f"[CACHE] /api/data 结果已保存到磁盘")
    except Exception as e:
        print(f"[CACHE] 保存失败: {e}")


def _load_json_cache():
    """从磁盘加载上次成功的 /api/data 结果"""
    import json
    if not _json_cache_file.exists():
        return None
    try:
        with open(_json_cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"[CACHE] 从磁盘加载 /api/data 缓存")
        return data
    except Exception:
        return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 静态文件服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.route("/")
def index():
    return send_file(APP_DIR / "www" / "index.html")

@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_file(APP_DIR / "www" / "js" / filename)

@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_file(APP_DIR / "www" / "css" / filename)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Token 管理
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from data_service import check_token, update_token

@app.route("/api/token/status")
def api_token_status():
    return jsonify(check_token())

@app.route("/api/token/update", methods=["POST"])
def api_token_update():
    data = request.get_json()
    if not data or "token" not in data:
        return jsonify({"success": False, "error": "缺少token参数"}), 400
    return jsonify(update_token(data["token"]))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# /api/data 兼容接口（Python端计算）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.route("/api/data")
def api_data():
    force = request.args.get("force", "0") == "1"
    now = time.time()

    # 1. 内存缓存（5分钟）
    if not force and _data_cache["data"] and (now - _data_cache["time"]) < 300:
        return jsonify(_data_cache["data"])

    try:
        from data_service import fetch_all_data
        result = fetch_all_data()

        # 判断是否真正获取到了数据
        has_data = len(result.get("indices", [])) > 0

        if has_data:
            # 成功：更新内存缓存 + 写磁盘
            _data_cache["data"] = result
            _data_cache["time"] = now
            _save_json_cache(result)
            return jsonify(result)
        else:
            # API返回了但全是错误，尝试磁盘缓存
            cached = _load_json_cache()
            if cached:
                cached["_from_cache"] = True
                cached["_cache_error"] = "; ".join(result.get("errors", [])[:3])
                return jsonify(cached)
            return jsonify(result)

    except Exception as e:
        # 异常：尝试从磁盘缓存加载
        cached = _load_json_cache()
        if cached:
            cached["_from_cache"] = True
            cached["_cache_error"] = str(e)
            return jsonify(cached)
        return jsonify({"error": str(e), "indices": [], "date": "", "errors": [str(e)]}), 500

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# iFinD API 访问层
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import requests as http_requests
import urllib3
urllib3.disable_warnings()

_session = http_requests.Session()
_session.verify = False
_token_cache = {"access_token": None, "expiry": 0}

def _get_access_token():
    if _token_cache["access_token"] and time.time() < _token_cache["expiry"]:
        return _token_cache["access_token"]

    token_file = APP_DIR / "ifind_token.txt"
    if not token_file.exists():
        raise FileNotFoundError("iFinD token 文件不存在")

    refresh_token = token_file.read_text(encoding="utf-8").strip()
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/get_access_token",
        headers={"Content-Type": "application/json", "refresh_token": refresh_token},
        timeout=15,
    )
    data = resp.json()
    if data.get("errorcode") != 0:
        raise RuntimeError(f"iFinD token 获取失败: {data}")

    _token_cache["access_token"] = data["data"]["access_token"]
    _token_cache["expiry"] = time.time() + 6.5 * 24 * 3600
    return _token_cache["access_token"]


def _fetch_index_from_ifind(code, start, end):
    """从 iFinD 获取指数行情（原始API调用）"""
    access_token = _get_access_token()
    para = {
        "codes": code,
        "indicators": "preClose,open,high,low,close,changeRatio,volume,amount,pe_ttm_index",
        "startdate": start.replace("-", ""),
        "enddate": end.replace("-", ""),
        "functionpara": {"Fill": "Blank", "CPS": "1", "Currency": "RMB"},
    }
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/cmd_history_quotation",
        json=para,
        headers={"Content-Type": "application/json", "access_token": access_token},
        timeout=30,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        raise RuntimeError(f"iFinD 行情获取失败: {r}")

    tables = r.get("tables", [])
    if not tables:
        return {"dates": [], "close": [], "volume": [], "amount": [], "pe": []}

    item = tables[0]
    times = item.get("time", [])
    table = item.get("table", {})

    dates = [t[:10] if len(t) >= 10 else t for t in times]
    close = [float(c) if c is not None else None for c in table.get("close", [])]
    amount_raw = table.get("amount", [])
    amount = [round(float(a) / 1e8, 4) if a is not None else None for a in amount_raw]
    volume_raw = table.get("volume", [])
    volume = [round(float(v) / 10000, 2) if v is not None else None for v in volume_raw]
    pe = [float(p) if p is not None else None for p in table.get("pe_ttm_index", table.get("pe", []))]

    return {"dates": dates, "close": close, "volume": volume, "amount": amount, "pe": pe}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 磁盘缓存管理（行情数据）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def _cache_path(code):
    """缓存文件路径：data/index_cache/{code}.csv"""
    return CACHE_DIR / f"{code}.csv"


def _load_cache(code):
    """从磁盘加载缓存，返回 {dates, close, volume, amount, pe} 或 None"""
    fp = _cache_path(code)
    if not fp.exists():
        return None
    try:
        dates, close, volume, amount, pe = [], [], [], [], []
        with open(fp, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                dates.append(row["date"])
                close.append(float(row["close"]) if row.get("close") else None)
                volume.append(float(row["volume"]) if row.get("volume") else None)
                amount.append(float(row["amount"]) if row.get("amount") else None)
                pe.append(float(row["pe"]) if row.get("pe") else None)
        if not dates:
            return None
        return {"dates": dates, "close": close, "volume": volume, "amount": amount, "pe": pe}
    except Exception:
        return None


def _save_cache(code, data):
    """保存数据到磁盘缓存"""
    fp = _cache_path(code)
    with open(fp, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "close", "volume", "amount", "pe"])
        for i in range(len(data["dates"])):
            writer.writerow([
                data["dates"][i],
                data["close"][i] if data["close"][i] is not None else "",
                data["volume"][i] if data["volume"][i] is not None else "",
                data["amount"][i] if data["amount"][i] is not None else "",
                data["pe"][i] if data["pe"][i] is not None else "",
            ])


def _merge_data(existing, new_data):
    """合并已有数据和新数据（按日期去重，新数据优先）"""
    if not existing:
        return new_data
    if not new_data:
        return existing

    # 用日期做key，新数据覆盖旧数据
    merged = {}
    for i, d in enumerate(existing["dates"]):
        merged[d] = {
            "close": existing["close"][i],
            "volume": existing["volume"][i],
            "amount": existing["amount"][i],
            "pe": existing["pe"][i],
        }
    for i, d in enumerate(new_data["dates"]):
        merged[d] = {
            "close": new_data["close"][i],
            "volume": new_data["volume"][i],
            "amount": new_data["amount"][i],
            "pe": new_data["pe"][i],
        }

    # 按日期排序
    sorted_dates = sorted(merged.keys())
    return {
        "dates": sorted_dates,
        "close": [merged[d]["close"] for d in sorted_dates],
        "volume": [merged[d]["volume"] for d in sorted_dates],
        "amount": [merged[d]["amount"] for d in sorted_dates],
        "pe": [merged[d]["pe"] for d in sorted_dates],
    }


def _should_update(code):
    """
    判断是否需要更新缓存
    策略：
      - 缓存不存在 → 需要全量下载
      - 缓存最后日期是今天且当前时间>18:00 → 不需要
      - 缓存最后日期是昨天或更早 → 需要增量更新
      - 缓存最后日期是今天但<18:00 → 不需要（数据可能不完整）
    """
    cached = _load_cache(code)
    if not cached:
        return True, None  # 全量下载

    last_date = cached["dates"][-1]
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    # 如果缓存到今天，且现在是18:00之后，检查是否需要补充最新数据
    if last_date >= today:
        return False, cached  # 已经是最新

    # 缓存到昨天或更早，需要增量更新
    return True, cached


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 代理接口（带缓存）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.route("/api/proxy/index_history", methods=["POST"])
def proxy_index_history():
    """
    获取指数历史行情（带磁盘缓存 + 增量更新）

    流程：
      1. 检查磁盘缓存
      2. 如果缓存最新，直接返回
      3. 如果需要更新，只请求缺失的日期范围
      4. 合并缓存 + 新数据，保存并返回
    """
    try:
        body = request.get_json()
        code = body.get("code")
        requested_start = body.get("start", "2024-05-29")
        requested_end = body.get("end", datetime.now().strftime("%Y-%m-%d"))

        # 检查是否需要更新
        need_update, cached = _should_update(code)

        if not need_update and cached:
            # 缓存命中，裁剪到请求范围
            result = _filter_range(cached, requested_start, requested_end)
            return jsonify(result)

        # 需要更新：确定增量下载范围
        if cached:
            # 增量：从缓存最后日期的下一天开始
            last_cached = cached["dates"][-1]
            fetch_start = (datetime.strptime(last_cached, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            # 全量
            fetch_start = requested_start

        fetch_end = requested_end

        # 只有当 fetch_start <= fetch_end 时才请求API
        new_data = None
        if fetch_start <= fetch_end:
            print(f"[CACHE] {code}: 从API获取 {fetch_start} ~ {fetch_end}")
            new_data = _fetch_index_from_ifind(code, fetch_start, fetch_end)
        else:
            print(f"[CACHE] {code}: 缓存已是最新，无需请求API")

        # 合并
        if new_data and new_data["dates"]:
            merged = _merge_data(cached, new_data)
            _save_cache(code, merged)
            print(f"[CACHE] {code}: 缓存已更新，共 {len(merged['dates'])} 天")
        else:
            merged = cached

        if not merged:
            return jsonify({"dates": [], "close": [], "volume": [], "amount": [], "pe": []})

        # 裁剪到请求范围
        result = _filter_range(merged, requested_start, requested_end)
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "close": []}), 500


def _filter_range(data, start, end):
    """按日期范围过滤数据"""
    if not data or not data["dates"]:
        return {"dates": [], "close": [], "volume": [], "amount": [], "pe": []}

    indices = []
    for i, d in enumerate(data["dates"]):
        if start <= d <= end:
            indices.append(i)

    return {
        "dates": [data["dates"][i] for i in indices],
        "close": [data["close"][i] for i in indices],
        "volume": [data["volume"][i] for i in indices],
        "amount": [data["amount"][i] for i in indices],
        "pe": [data["pe"][i] for i in indices],
    }


@app.route("/api/proxy/margin", methods=["POST"])
def proxy_margin():
    """
    获取融资余额（复用 ifind_data.py 的磁盘缓存逻辑）

    ifind_data.py 已经实现了完整的磁盘缓存 + 增量更新，
    直接调用它即可，不需要重复实现。
    """
    try:
        body = request.get_json()
        code = body.get("code")
        start = body.get("start", "")
        end = body.get("end", "")

        from utils.ifind_data import fetch_margin_ifind
        df = fetch_margin_ifind(code, start, end)

        if df is None or df.empty:
            return jsonify({"dates": [], "margin_balance": []})

        dates = [d.strftime("%Y-%m-%d") for d in df["date"]]
        margin_balance = [float(v) if v == v else None for v in df["margin_balance"]]

        return jsonify({"dates": dates, "margin_balance": margin_balance})

    except Exception as e:
        return jsonify({"error": str(e), "dates": [], "margin_balance": []}), 500


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 缓存状态查看
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.route("/api/cache/status")
def cache_status():
    """查看所有指数的缓存状态"""
    from config import INDEXES
    result = []
    for idx in INDEXES:
        code = idx["ifind_code"]
        cached = _load_cache(code)
        if cached:
            result.append({
                "code": code,
                "name": idx["name"],
                "days": len(cached["dates"]),
                "from": cached["dates"][0],
                "to": cached["dates"][-1],
            })
        else:
            result.append({
                "code": code,
                "name": idx["name"],
                "days": 0,
                "from": None,
                "to": None,
            })
    return jsonify(result)


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  A股温度计 - JS前端 + Python代理")
    print("  前端: http://localhost:5000")
    print("  API:  http://localhost:5000/api/*")
    print("  缓存: data/index_cache/ + data/ifind_margin_cache/")
    print("=" * 50 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False)
