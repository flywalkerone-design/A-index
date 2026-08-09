"""
A股温度计 - data service layer
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

from config import INDEXES, MARKET_STATES
from utils.ifind_data import (
    _ensure_token,
    fetch_index_history_ifind,
    fetch_margin_ifind,
    fetch_rsi_ifind,
    fetch_turnover_ifind,
)
from utils.indicators import calc_all_indicators
from utils.scoring import calc_market_temperature

TOKEN_FILE = APP_DIR / "ifind_token.txt"


def _reject_margin_outliers(series):
    """将未被下一交易日确认的单日 20% 跳变标记为空值。"""
    values = pd.to_numeric(series, errors="coerce").tolist()
    cleaned = values.copy()
    for index in range(1, len(values)):
        previous = values[index - 1]
        current = values[index]
        if pd.isna(previous) or pd.isna(current) or previous == 0:
            continue
        if abs(current / previous - 1) <= 0.2:
            continue
        next_value = next(
            (value for value in values[index + 1:] if not pd.isna(value)),
            None,
        )
        if next_value is None or abs(next_value / previous - 1) < 0.1:
            cleaned[index] = np.nan
    return pd.Series(cleaned, index=series.index)


def _emotion(score):
    v = max(0, min(100, score))
    if v < 10:
        return {"label": "冰点", "color": "#007AFF"}
    if v < 20:
        return {"label": "恐惧", "color": "#5AC8FA"}
    if v < 80:
        return {"label": "中性", "color": "#34C759"}
    if v < 90:
        return {"label": "贪婪", "color": "#FF9500"}
    return {"label": "狂热", "color": "#FF3B30"}


def _get_state(score):
    for low, high, name, color in MARKET_STATES:
        if low <= score < high:
            return name, color
    return "狂热", "#FF0000"


def check_token():
    if not TOKEN_FILE.exists():
        return {"valid": False, "error": "token文件不存在", "path": str(TOKEN_FILE)}
    try:
        _ensure_token()
        return {"valid": True, "message": "token有效"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


def update_token(new_token):
    TOKEN_FILE.write_text(new_token.strip(), encoding="utf-8")
    import utils.ifind_data as ifd

    ifd._access_token = None
    ifd._token_expiry = 0
    try:
        _ensure_token()
        return {"success": True, "message": "token更新成功并验证通过"}
    except Exception as e:
        return {"success": False, "error": f"token已保存但验证失败: {e}"}


def fetch_single_index(idx_config, start_date, end_date):
    code = idx_config["code"]
    ifind_code = idx_config["ifind_code"]
    use_margin = idx_config.get("margin", True)

    df = fetch_index_history_ifind(ifind_code, start_date, end_date)
    if df is None or df.empty:
        return None

    today = datetime.now().date()
    if today.weekday() < 5:
        df = df[df["date"].dt.date < today]
    else:
        last_trade_day = today - timedelta(days=today.weekday() - 4)
        df = df[df["date"].dt.date < last_trade_day]

    if df.empty:
        return None

    try:
        turnover_df = fetch_turnover_ifind(ifind_code, start_date, end_date)
        if turnover_df is None or turnover_df.empty:
            return None
        df = df.drop(columns=["turnover_ratio"], errors="ignore").merge(
            turnover_df, on="date", how="left"
        )
    except Exception:
        return None

    try:
        rsi_df = fetch_rsi_ifind(ifind_code, start_date, end_date)
        if rsi_df is not None and not rsi_df.empty:
            rsi_df = rsi_df.rename(columns={"rsi": "rsi_ifind"})
            df = df.merge(rsi_df, on="date", how="left")
    except Exception:
        pass

    if use_margin:
        try:
            margin_df = fetch_margin_ifind(ifind_code, start_date, end_date)
            if margin_df is None or margin_df.empty:
                return None
            df = df.merge(margin_df, on="date", how="left")
            df["margin_balance"] = _reject_margin_outliers(df["margin_balance"])
        except Exception:
            return None

    if "pe" in df.columns:
        df["pe"] = df["pe"].ffill()
    if use_margin and "margin_balance" not in df.columns:
        return None

    if use_margin:
        valid_margin = df[df["margin_balance"].notna()]
        if valid_margin.empty:
            return None
        last_margin_date = valid_margin["date"].max()
        df = df[df["date"] <= last_margin_date]
        if df.empty:
            return None

    df = calc_all_indicators(df, use_margin=use_margin)
    df = calc_market_temperature(df, use_margin=use_margin)

    rank_cols = ["rank_close", "rank_turnover", "rank_pe", "rank_rsi"]
    if use_margin:
        rank_cols.append("rank_margin")
    df["data_ok"] = df[rank_cols].notna().all(axis=1)

    return df


def fetch_all_data():
    _ensure_token()

    start = (datetime.now() - timedelta(days=365 * 2 + 30)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    indices = []
    errors = []
    data_dates = []

    for idx_cfg in INDEXES:
        code = idx_cfg["code"]
        try:
            df = fetch_single_index(idx_cfg, start, end)
            if df is None or df.empty:
                errors.append(f"{code}: 无数据")
                continue

            valid = df[df["data_ok"]] if "data_ok" in df.columns else df
            if valid.empty:
                errors.append(f"{code}: 无完整因子数据")
                continue
            latest = valid.iloc[-1]
            latest_date = latest["date"].strftime("%Y-%m-%d")

            score = round(float(latest["market_score_low_freq"]) * 100)
            state_name, state_color = _get_state(score)
            emo = _emotion(score)

            df_chart = df.tail(180)
            dates = [d.strftime("%Y-%m-%d") for d in df_chart["date"]]
            scores = [round(float(s) * 100) if not pd.isna(s) else None for s in df_chart["market_score_low_freq"]]
            closes = [round(float(c), 2) if not pd.isna(c) else None for c in df_chart["close"]]

            ranks = {
                "close": round(float(latest.get("rank_close", 0)) * 100),
                "turnover": round(float(latest.get("rank_turnover", 0)) * 100),
                "pe": round(float(latest.get("rank_pe", 0)) * 100),
                "rsi": round(float(latest.get("rank_rsi", 0)) * 100),
            }
            if "rank_margin" in latest.index and not pd.isna(latest["rank_margin"]):
                ranks["margin"] = round(float(latest["rank_margin"]) * 100)

            indices.append({
                "code": code,
                "date": latest_date,
                "display": idx_cfg.get("display_name", idx_cfg["name"]),
                "group": idx_cfg["group"],
                "score": score,
                "state": state_name,
                "stateColor": state_color,
                "emotion": emo["label"],
                "emotionColor": emo["color"],
                "close": round(float(latest["close"]), 2),
                "ret": round(float(latest.get("daily_return", 0)), 2),
                "rsi": round(float(latest.get("RSI", 0)), 1),
                "pe": round(float(latest.get("pe", 0)), 2),
                "amount": round(float(latest.get("amount", 0)), 2),
                "ma5": round(float(latest.get("MA5", 0)), 2),
                "ma20": round(float(latest.get("MA20", 0)), 2),
                "ma60": round(float(latest.get("MA60", 0)), 2),
                "ranks": ranks,
                "dates": dates,
                "scores": scores,
                "closes": closes,
            })
            data_dates.append(latest_date)
        except Exception as e:
            errors.append(f"{code}: {e}")

    return {
        # 首页代表所有指数都可用的共同日期，不能使用系统日期冒充数据日期。
        "date": min(data_dates) if data_dates else "",
        "indices": indices,
        "errors": errors,
        "fetchTime": datetime.now().strftime("%H:%M:%S"),
    }
