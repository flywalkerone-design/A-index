"""Load the user-provided workbook data used by the Data tab."""

from pathlib import Path

import pandas as pd


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent / "数据文件"


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

    # 融资余额是 T+1 发布的。接口在最新交易日可能返回 0、空值，
    # 或者把尚未确认的余额映射成异常跳变；图表应延续上一有效交易日。
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

        # 余额被 T+1 保护修正时，净买入也必须同步修正，避免产生假断崖。
        if item["t_plus_one_adjusted"] and previous_balance is not None:
            item["net_buy"] = 0.0
        elif item["net_buy"] is None and balance is not None and previous_balance is not None:
            item["net_buy"] = balance - previous_balance

        if balance is not None:
            previous_balance = balance
    return rows


def _read_etf_sheet(path):
    sheet = pd.read_excel(path, sheet_name="ETF净流入", header=None)
    rows = []

    for _, row in sheet.iloc[4:].iterrows():
        date = _date(row.iloc[0])
        if date is None:
            continue
        flows = []
        for index in range(1, 8):
            value = _number(row.iloc[index])
            flows.append(None if value is None else value / 1e8)
        total = _number(row.iloc[8])
        if total is None:
            total = sum(value for value in flows if value is not None)
        rows.append({"date": date, "total": total})

    rows.reverse()
    return {"rows": rows}


def load_chart_data(data_dir=DATA_DIR):
    market_file = data_dir / "上证走势与融资余额.xlsx"
    etf_file = data_dir / "ETF规模净流入统计.xlsx"
    if not market_file.exists() or not etf_file.exists():
        raise FileNotFoundError("数据文件目录中缺少两个 Excel 数据文件")

    return {
        "market": _read_market_sheet(market_file),
        "margin": _read_margin_sheet(market_file),
        "etf": _read_etf_sheet(etf_file),
    }
