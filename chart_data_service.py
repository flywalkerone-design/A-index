"""Data tab chart data — primary source: iFinD API, fallback: Excel."""

from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from utils.ifind_data import _ensure_token, _session, _headers
from utils.logger import log

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent / "数据文件"

DATA_START_DATE = "2024-01-01"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# iFinD API 数据获取
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 11 只宽基 ETF（6位代码 -> iFinD .OF 代码）
ETF_IFIND_CODES = [
    "510300.OF", "510050.OF", "588000.OF", "512100.OF",
    "159915.OF", "510310.OF", "510500.OF", "510330.OF",
    "588080.OF", "159919.OF", "159845.OF",
]

# 融资余额：上证指数 + 深证A股，求和得沪深合计
MARGIN_CODES = ["000001.SH", "399107.SZ"]


def _date_sequence_chunk(codes, indicator, start, end, extra_params=None):
    """调用 date_sequence API，返回 {date_str: value} 列表"""
    para = {
        "codes": codes,
        "startdate": start.replace("-", ""),
        "enddate": end.replace("-", ""),
        "functionpara": {"Days": "Tradedays", "Fill": "Previous"},
        "indipara": [{"indicator": indicator, "indiparams": [""]}],
    }
    if extra_params:
        para["functionpara"].update(extra_params)

    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/date_sequence",
        json=para, headers=_headers(), timeout=60,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        log.warning(f"date_sequence error: {r.get('errmsg')} (codes={codes})")
        return []

    result = []
    for table in r.get("tables", []):
        thscode = table.get("thscode", "")
        times = table.get("time", [])
        vals = table.get("table", {}).get(indicator, [])
        for i, t in enumerate(times):
            date_str = str(t)[:10]
            val = vals[i] if i < len(vals) else None
            result.append({"date": date_str, "code": thscode, "value": val})
    return result


def _fetch_margin_ifind_direct(start, end):
    """获取融资余额 + 融资买入额 + 融资偿还额（一次请求多指标）"""
    from datetime import datetime as dt

    all_rows = []
    chunk_start = dt.strptime(start, "%Y-%m-%d")
    chunk_end = dt.strptime(end, "%Y-%m-%d")

    # 同时请求三个指标：余额、买入额、偿还额
    indicators = [
        {"indicator": "ths_margin_trading_balance_index", "indiparams": [""]},
        {"indicator": "ths_margin_buy_value_index", "indiparams": [""]},
        {"indicator": "ths_margin_repayment_value_index", "indiparams": [""]},
    ]

    for code in MARGIN_CODES:
        code_rows = []
        cs = chunk_start
        while cs <= chunk_end:
            ce = min(cs + timedelta(days=550), chunk_end)
            rows = _date_sequence_multi_indicator(code, indicators, cs.strftime("%Y-%m-%d"), ce.strftime("%Y-%m-%d"))
            if not rows:
                break
            code_rows.extend(rows)
            if len(rows) < 10:
                break
            cs = ce + timedelta(days=1)

        # 去重（chunk 边界可能重叠）
        seen = set()
        for r in code_rows:
            if r["date"] not in seen:
                seen.add(r["date"])
                all_rows.append(r)

    return all_rows


def _date_sequence_multi_indicator(code, indicators, start, end):
    """调用 date_sequence API，一次请求多个指标"""
    para = {
        "codes": code,
        "startdate": start.replace("-", ""),
        "enddate": end.replace("-", ""),
        "functionpara": {"Days": "Tradedays", "Fill": "Previous"},
        "indipara": indicators,
    }

    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/date_sequence",
        json=para, headers=_headers(), timeout=60,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        log.warning(f"date_sequence error: {r.get('errmsg')} (code={code})")
        return []

    result = []
    for table in r.get("tables", []):
        thscode = table.get("thscode", "")
        times = table.get("time", [])
        tbl = table.get("table", {})
        for i, t in enumerate(times):
            date_str = str(t)[:10]
            row = {"date": date_str, "code": thscode}
            for ind in indicators:
                key = ind["indicator"]
                vals = tbl.get(key, [])
                row[key] = vals[i] if i < len(vals) else None
            result.append(row)
    return result


def _fetch_market_from_ifind(start, end):
    """上证指数日成交额 + 20日均线"""
    from utils.ifind_data import fetch_index_history_ifind

    df = fetch_index_history_ifind("000001.SH", start, end)
    if df is None or df.empty:
        return []

    rows = []
    amounts = df["amount"].tolist()
    for i in range(len(df)):
        amt = amounts[i]
        window = [a for a in amounts[max(0, i - 19):i + 1] if pd.notna(a)]
        ma20 = sum(window) / len(window) if window else None
        rows.append({
            "date": df.iloc[i]["date"].strftime("%Y-%m-%d"),
            "amount": round(float(amt), 2) if pd.notna(amt) else None,
            "amount_ma20": round(float(ma20), 2) if ma20 else None,
        })
    return rows


def _fetch_margin_from_ifind(start, end):
    """沪深两市融资余额合计 + 峰值/回撤/净买入

    净买入优先使用 iFinD 直接指标（融资买入额 - 融资偿还额），
    若指标不可用则回退到余额差值法。
    """
    raw = _fetch_margin_ifind_direct(start, end)
    if not raw:
        return []

    # 检查是否有买入额/偿还额数据
    has_buy_data = any(r.get("ths_margin_buy_value_index") is not None for r in raw)

    # 按日期聚合：SH + SZ 求和
    daily = {}
    for r in raw:
        d = r["date"]
        if d not in daily:
            daily[d] = {"sh_bal": None, "sz_bal": None, "sh_buy": None, "sz_buy": None, "sh_rep": None, "sz_rep": None}
        if r["code"] == "000001.SH":
            daily[d]["sh_bal"] = float(r["ths_margin_trading_balance_index"]) if r.get("ths_margin_trading_balance_index") is not None else None
            daily[d]["sh_buy"] = float(r["ths_margin_buy_value_index"]) if r.get("ths_margin_buy_value_index") is not None else None
            daily[d]["sh_rep"] = float(r["ths_margin_repayment_value_index"]) if r.get("ths_margin_repayment_value_index") is not None else None
        elif r["code"] == "399107.SZ":
            daily[d]["sz_bal"] = float(r["ths_margin_trading_balance_index"]) if r.get("ths_margin_trading_balance_index") is not None else None
            daily[d]["sz_buy"] = float(r["ths_margin_buy_value_index"]) if r.get("ths_margin_buy_value_index") is not None else None
            daily[d]["sz_rep"] = float(r["ths_margin_repayment_value_index"]) if r.get("ths_margin_repayment_value_index") is not None else None

    # 排序
    sorted_dates = sorted(daily.keys())
    rows = []
    for d in sorted_dates:
        item = daily[d]
        parts_bal = [v for v in [item["sh_bal"], item["sz_bal"]] if v is not None]
        total = sum(parts_bal) / 1e8 if parts_bal else None  # 元 -> 亿元

        # 净买入：优先用买入额-偿还额
        net_buy = None
        if has_buy_data:
            buy_parts = [v for v in [item["sh_buy"], item["sz_buy"]] if v is not None]
            rep_parts = [v for v in [item["sh_rep"], item["sz_rep"]] if v is not None]
            if buy_parts and rep_parts:
                net_buy = round((sum(buy_parts) - sum(rep_parts)) / 1e8, 2)

        rows.append({"date": d, "balance": total, "_direct_net_buy": net_buy})

    # T+1 调整：最新交易日余额可能未发布或异常跳变
    prev_balance = None
    latest_idx = len(rows) - 1
    for i, item in enumerate(rows):
        b = item["balance"]
        is_missing = b is None or b <= 0
        is_latest_jump = (
            i == latest_idx
            and prev_balance is not None
            and b is not None
            and b < prev_balance * 0.8
        )
        if is_missing or is_latest_jump:
            item["balance"] = prev_balance
            item["t_plus_one_adjusted"] = True
        else:
            item["t_plus_one_adjusted"] = False
        if item["balance"] is not None:
            prev_balance = item["balance"]

    # 计算峰值、回撤、净买入
    peak = None
    prev_balance = None
    for item in rows:
        b = item["balance"]
        if b is not None:
            peak = max(peak, b) if peak is not None else b
        item["peak"] = peak
        item["drawdown"] = max(0.0, peak - b) if (peak is not None and b is not None) else 0.0

        # 净买入：优先用直接指标，回退到余额差值
        if item.get("t_plus_one_adjusted") and prev_balance is not None:
            item["net_buy"] = 0.0
        elif item["_direct_net_buy"] is not None:
            item["net_buy"] = item["_direct_net_buy"]
        elif b is not None and prev_balance is not None:
            item["net_buy"] = round(b - prev_balance, 2)
        else:
            item["net_buy"] = 0.0

        # 清理临时字段
        del item["_direct_net_buy"]

        if b is not None:
            prev_balance = b

    return rows


def _fetch_etf_from_ifind(start, end):
    """11 只宽基 ETF 净流入合计（一次批量请求）"""
    codes = ",".join(ETF_IFIND_CODES)

    # 分段请求（每段 ~500 天）
    from datetime import datetime as dt
    all_rows = []
    cs = dt.strptime(start, "%Y-%m-%d")
    end_dt = dt.strptime(end, "%Y-%m-%d")
    while cs <= end_dt:
        ce = min(cs + timedelta(days=550), end_dt)
        rows = _date_sequence_chunk(
            codes, "ths_netcashflow_fund",
            cs.strftime("%Y-%m-%d"), ce.strftime("%Y-%m-%d"),
        )
        all_rows.extend(rows)
        if len(rows) < 10:
            break
        cs = ce + timedelta(days=1)

    if not all_rows:
        return {"rows": []}

    # 按日期汇总
    daily = {}
    for r in all_rows:
        d = r["date"]
        v = r["value"]
        if v is not None:
            val_yi = float(v) / 1e8  # 元 -> 亿元
            daily[d] = daily.get(d, 0) + val_yi

    rows = [{"date": d, "total": round(v, 2)} for d, v in sorted(daily.items())]
    return {"rows": rows}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Excel fallback（保留原逻辑）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _number(value):
    if value is None or pd.isna(value):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if pd.notna(value) else None


def _date(value):
    parsed = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(parsed) else parsed.strftime("%Y-%m-%d")


def _read_market_sheet(path):
    sheet = pd.read_excel(path, sheet_name="同花顺全A", header=None)
    rows = []
    for _, row in sheet.iloc[4:].iterrows():
        date = _date(row.iloc[0])
        amount = _number(row.iloc[1])
        if date is None or amount is None:
            continue
        rows.append({
            "date": date,
            "amount": amount / 1e8,
            "amount_ma20": (
                _number(row.iloc[2]) / 1e8
                if _number(row.iloc[2]) is not None
                else None
            ),
        })
    rows.reverse()
    values = [item["amount"] for item in rows]
    for index, item in enumerate(rows):
        if item["amount_ma20"] is None:
            window = values[max(0, index - 19): index + 1]
            item["amount_ma20"] = sum(window) / len(window)
    return rows


def _read_margin_sheet(path):
    sheet = pd.read_excel(path, sheet_name="融资融券 (2)", header=None)
    rows = []
    for _, row in sheet.iloc[7:].iterrows():
        date = _date(row.iloc[0])
        if date is None:
            continue
        rows.append({
            "date": date,
            "balance": _number(row.iloc[1]),
            "peak": _number(row.iloc[2]),
            "drawdown": _number(row.iloc[3]),
            "net_buy": _number(row.iloc[4]),
        })
    rows.reverse()
    previous_balance = None
    latest_index = len(rows) - 1
    for index, item in enumerate(rows):
        reported_balance = item["balance"]
        is_missing = reported_balance is None or reported_balance <= 0
        is_latest_jump = (
            index == latest_index
            and previous_balance is not None
            and reported_balance is not None
            and reported_balance < previous_balance * 0.8
        )
        if is_missing or is_latest_jump:
            item["balance"] = previous_balance
            item["t_plus_one_adjusted"] = True
        else:
            item["t_plus_one_adjusted"] = False
        if item["balance"] is not None:
            previous_balance = item["balance"]
    peak_balance = None
    previous_balance = None
    for item in rows:
        balance = item["balance"]
        if balance is not None:
            peak_balance = max(peak_balance, balance) if peak_balance is not None else balance
        if item["peak"] is None and peak_balance is not None:
            item["peak"] = peak_balance
        if item["peak"] is not None and balance is not None:
            item["drawdown"] = max(0.0, item["peak"] - balance)
        if item["t_plus_one_adjusted"] and previous_balance is not None:
            item["net_buy"] = 0.0
        elif item["net_buy"] is None and balance is not None and previous_balance is not None:
            item["net_buy"] = balance - previous_balance
        if balance is not None:
            previous_balance = balance
    return rows


WIDEBASE_ETF_CODES = {
    "510300", "510050", "588000", "512100",
    "159915", "510310", "510500", "510330",
    "588080", "159919", "159845",
}


def _read_etf_sheet(path):
    sheet = pd.read_excel(path, sheet_name="ETF净流入", header=None)
    code_row = sheet.iloc[2] if len(sheet) > 2 else None
    target_cols = []
    if code_row is not None:
        for col_idx in range(1, len(code_row)):
            raw = str(code_row.iloc[col_idx]) if pd.notna(code_row.iloc[col_idx]) else ""
            code = raw.strip().split(".")[0]
            if code in WIDEBASE_ETF_CODES:
                target_cols.append(col_idx)
    if not target_cols:
        target_cols = list(range(1, 8))
    rows = []
    seen_dates = set()
    for _, row in sheet.iloc[4:].iterrows():
        date = _date(row.iloc[0])
        if date is None or date in seen_dates:
            continue
        seen_dates.add(date)
        flows = []
        for col_idx in target_cols:
            if col_idx >= len(row):
                continue
            value = _number(row.iloc[col_idx])
            flows.append(None if value is None else value / 1e8)
        total = sum(v for v in flows if v is not None) if flows else None
        rows.append({"date": date, "total": total})
    rows.sort(key=lambda r: r["date"])
    return {"rows": rows}


def _load_from_excel(data_dir):
    """Excel fallback"""
    if data_dir is None:
        data_dir = DATA_DIR
    data_dir = Path(data_dir)
    market_file = data_dir / "上证走势与融资余额.xlsx"
    etf_file = data_dir / "ETF规模净流入统计.xlsx"
    if not market_file.exists() or not etf_file.exists():
        raise FileNotFoundError("数据文件目录中缺少 Excel 数据文件")
    return {
        "market": _read_market_sheet(market_file),
        "margin": _read_margin_sheet(market_file),
        "etf": _read_etf_sheet(etf_file),
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 主入口
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def load_chart_data(data_dir=None):
    """从 iFinD API 加载数据 Tab 图表数据（失败时回退 Excel）"""
    end = datetime.now().strftime("%Y-%m-%d")
    start = DATA_START_DATE

    try:
        _ensure_token()
        log.info("从 iFinD API 加载图表数据...")

        market = _fetch_market_from_ifind(start, end)
        margin = _fetch_margin_from_ifind(start, end)
        etf = _fetch_etf_from_ifind(start, end)

        log.info(
            f"图表数据加载完成: market={len(market)}条, "
            f"margin={len(margin)}条, etf={len(etf.get('rows', []))}条"
        )
        return {"market": market, "margin": margin, "etf": etf}

    except Exception as e:
        log.warning(f"iFinD API 失败，回退 Excel: {e}")
        return _load_from_excel(data_dir)
