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

# 11 只宽基 ETF（上市基金必须使用交易所后缀，不能使用 .OF）
ETF_IFIND_CODES = [
    "510300.SH", "510050.SH", "588000.SH", "512100.SH",
    "159915.SZ", "510310.SH", "510500.SH", "510330.SH",
    "588080.SH", "159919.SZ", "159845.SZ",
]

MARGIN_REPORT = "p03438"
MARGIN_DATE_FIELD = "p03438_f001"
MARGIN_SH_TOTAL_FIELD = "p03438_f003"
MARGIN_SZ_TOTAL_FIELD = "p03438_f004"
MARGIN_BALANCE_FIELD = "p03438_f005"
MARGIN_NET_BUY_FIELD = "p03438_f013"


def _normalize_api_date(value):
    parsed = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(parsed) else parsed.strftime("%Y-%m-%d")


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
        if len(times) != len(vals):
            log.warning(f"date_sequence length mismatch: {thscode} {indicator}")
            continue
        for date_value, val in zip(times, vals):
            date_str = _normalize_api_date(date_value)
            if date_str is None:
                continue
            result.append({"date": date_str, "code": thscode, "value": val})
    return result


def _fetch_margin_report(start, end):
    """读取市场交易统计报表中的融资余额和专用净买入字段。"""
    para = {
        "reportname": MARGIN_REPORT,
        "functionpara": {
            "sdate": start.replace("-", ""),
            "edate": end.replace("-", ""),
            "sclx": "沪深两市",
            "pl": "日",
        },
        "outputpara": (
            f"{MARGIN_DATE_FIELD}:Y,"
            f"{MARGIN_SH_TOTAL_FIELD}:Y,"
            f"{MARGIN_SZ_TOTAL_FIELD}:Y,"
            f"{MARGIN_BALANCE_FIELD}:Y,"
            f"{MARGIN_NET_BUY_FIELD}:Y"
        ),
    }
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/data_pool",
        json=para, headers=_headers(), timeout=60,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        log.warning(f"data_pool error: {r.get('errmsg')} (report={MARGIN_REPORT})")
        return []

    tables = r.get("tables", [])
    if not tables:
        return []
    table = tables[0].get("table", {})
    dates = table.get(MARGIN_DATE_FIELD, [])
    sh_totals = table.get(MARGIN_SH_TOTAL_FIELD, [])
    sz_totals = table.get(MARGIN_SZ_TOTAL_FIELD, [])
    balances = table.get(MARGIN_BALANCE_FIELD, [])
    net_buys = table.get(MARGIN_NET_BUY_FIELD, [])
    result = []
    for i, raw_date in enumerate(dates):
        date = _normalize_api_date(raw_date)
        if date is None:
            continue
        result.append({
            "date": date,
            "sh_total": sh_totals[i] if i < len(sh_totals) else None,
            "sz_total": sz_totals[i] if i < len(sz_totals) else None,
            "balance": balances[i] if i < len(balances) else None,
            "net_buy": net_buys[i] if i < len(net_buys) else None,
        })
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
    """沪深两市融资余额、历史峰值、回撤和 iFinD 专用净买入。"""
    raw = _fetch_margin_report(start, end)
    if not raw:
        return []

    rows = []
    peak = None
    for item in sorted(raw, key=lambda row: row["date"]):
        if _number(item.get("sh_total")) is None or _number(item.get("sz_total")) is None:
            continue
        b = _number(item.get("balance"))
        net_buy = _number(item.get("net_buy"))
        if b is None:
            continue
        if b is not None:
            peak = max(peak, b) if peak is not None else b
        rows.append({
            "date": item["date"],
            "balance": round(b, 2),
            "peak": round(peak, 2),
            "drawdown": round(max(0.0, peak - b), 2),
            "net_buy": round(net_buy, 2) if net_buy is not None else None,
            "t_plus_one_adjusted": False,
        })

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
        cs = ce + timedelta(days=1)

    if not all_rows:
        return {"rows": []}

    # 按日期汇总；任一目标 ETF 缺失时不输出该日，避免部分合计冒充全量。
    daily = {}
    for r in all_rows:
        d = r["date"]
        value = _number(r["value"])
        code = r.get("code")
        if value is None or code not in ETF_IFIND_CODES:
            continue
        entry = daily.setdefault(d, {"total": 0.0, "codes": set()})
        if code in entry["codes"]:
            continue
        entry["total"] += value / 1e8  # 元 -> 亿元
        entry["codes"].add(code)

    rows = [
        {"date": date, "total": round(entry["total"], 2)}
        for date, entry in sorted(daily.items())
        if len(entry["codes"]) == len(ETF_IFIND_CODES)
    ]
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
