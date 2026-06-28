"""
A股温度计 - 数据服务层
封装：iFinD数据获取 → 指标计算 → 温度评分 → JSON输出
"""

import sys
import time
import warnings
from pathlib import Path
from datetime import datetime, timedelta

import pandas as pd
import numpy as np

warnings.filterwarnings("ignore")

# 路径设置
APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))

from config import (
    INDEXES, DATA_START_DATE, MARKET_STATES,
    RSI_PERIOD, PERCENTRANK_WINDOW, LOW_FREQ_WINDOW, MA_PERIODS
)
from utils.ifind_data import (
    fetch_index_history_ifind, fetch_margin_ifind,
    _ensure_token, _get_refresh_token
)
from utils.indicators import calc_all_indicators
from utils.scoring import calc_market_temperature

# Token 文件路径
TOKEN_FILE = APP_DIR / "ifind_token.txt"
DATA_CACHE_DIR = APP_DIR / "data" / "cache"


def _emotion(score):
    """温度 → 情绪（5级，海报用）"""
    v = max(0, min(100, score))
    if v < 10: return {"label": "冰点", "color": "#007AFF"}
    if v < 20: return {"label": "恐惧", "color": "#5AC8FA"}
    if v < 80: return {"label": "中性", "color": "#34C759"}
    if v < 90: return {"label": "贪婪", "color": "#FF9500"}
    return {"label": "狂热", "color": "#FF3B30"}


def _get_state(score):
    """温度 → 市场状态（7级，详情页用）"""
    for low, high, name, color in MARKET_STATES:
        if low <= score < high:
            return name, color
    return "狂热", "#FF0000"


def check_token():
    """检查token是否有效"""
    if not TOKEN_FILE.exists():
        return {"valid": False, "error": "token文件不存在", "path": str(TOKEN_FILE)}
    try:
        _ensure_token()
        return {"valid": True, "message": "token有效"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


def update_token(new_token):
    """更新token文件"""
    TOKEN_FILE.write_text(new_token.strip(), encoding="utf-8")
    # 清除内存缓存
    import utils.ifind_data as ifd
    ifd._access_token = None
    ifd._token_expiry = 0
    # 验证新token
    try:
        _ensure_token()
        return {"success": True, "message": "token更新成功并验证通过"}
    except Exception as e:
        return {"success": False, "error": f"token已保存但验证失败: {e}"}


def fetch_single_index(idx_config, start_date, end_date):
    """获取单个指数的完整数据（行情+融资+指标+温度）"""
    code = idx_config["code"]
    ifind_code = idx_config["ifind_code"]
    use_margin = idx_config.get("margin", True)

    # 1. 获取行情数据
    df = fetch_index_history_ifind(ifind_code, start_date, end_date)
    if df is None or df.empty:
        return None

    # 2. T-1 截止（去掉最新一天可能不完整的数据）
    today = datetime.now().date()
    if today.weekday() < 5:  # 工作日
        df = df[df["date"].dt.date < today]
    else:  # 周末
        df = df[df["date"].dt.date < today - timedelta(days=today.weekday() - 4)]

    if df.empty:
        return None

    # 3. 获取融资余额
    if use_margin:
        try:
            margin_df = fetch_margin_ifind(ifind_code, start_date, end_date)
            if margin_df is not None and not margin_df.empty:
                df = df.merge(margin_df, on="date", how="left")
            else:
                use_margin = False
        except Exception:
            use_margin = False

    if "margin_balance" not in df.columns:
        df["margin_balance"] = np.nan
        use_margin = False

    # 4. 计算指标
    df = calc_all_indicators(df, use_margin=use_margin)

    # 5. 计算温度
    df = calc_market_temperature(df, use_margin=use_margin)

    # 6. 标记有效数据
    rank_cols = ["rank_close", "rank_turnover", "rank_pe", "rank_rsi"]
    if use_margin:
        rank_cols.append("rank_margin")
    df["data_ok"] = df[rank_cols].notna().all(axis=1)

    return df


def fetch_all_data():
    """获取全部指数数据，返回前端可用的JSON结构"""
    # 确保token有效
    _ensure_token()

    # 计算日期范围（需要额外365天给PERCENTRANK窗口）
    start = (datetime.now() - timedelta(days=365 * 2 + 30)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    indices = []
    errors = []

    for idx_cfg in INDEXES:
        code = idx_cfg["code"]
        try:
            df = fetch_single_index(idx_cfg, start, end)
            if df is None or df.empty:
                errors.append(f"{code}: 无数据")
                continue

            # 取有效数据的最新行
            valid = df[df["data_ok"]] if "data_ok" in df.columns else df
            if valid.empty:
                valid = df
            latest = valid.iloc[-1]

            score = round(float(latest["market_score_low_freq"]) * 100)
            state_name, state_color = _get_state(score)
            emo = _emotion(score)

            # 最近180天走势数据
            df_chart = df.tail(180)
            dates = [d.strftime("%Y-%m-%d") for d in df_chart["date"]]
            scores = [round(float(s) * 100) if not pd.isna(s) else None
                      for s in df_chart["market_score_low_freq"]]
            closes = [round(float(c), 2) if not pd.isna(c) else None
                      for c in df_chart["close"]]

            # 百分位排名
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

        except Exception as e:
            errors.append(f"{code}: {e}")

    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "indices": indices,
        "errors": errors,
        "fetchTime": datetime.now().strftime("%H:%M:%S"),
    }
