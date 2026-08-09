"""
A股市场温度计 - 温度评分系统
100%还原 Excel 算法：
  1. 6个百分位排名等权平均 → market_score（O列「市场温度」）
  2. 对 market_score 再做 PERCENTRANK.INC（窗口=120）→ market_score_low_freq（P列「市场温度-低频」）
  3. 根据温度值判定市场状态（冰点/恐惧/偏冷/中性/偏热/过热/狂热）
"""

import sys
from pathlib import Path

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import SCORE_WEIGHTS, MARKET_STATES, LOW_FREQ_WINDOW, SECTOR_PARAMS
from utils.indicators import percentrank_inc
from utils.logger import log


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 计算市场温度（等权平均，对应 Excel O 列）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_market_score(df: pd.DataFrame, use_margin: bool = True) -> pd.DataFrame:
    """
    百分位排名等权平均 → market_score（0~1）

    永远使用5因子：rank_close, rank_turnover, rank_pe, rank_rsi, rank_margin
    缺失数据不填充、不跳过，该天 market_score 为 NaN

    参数:
        df: 包含 rank_* 列的 DataFrame
        use_margin: 是否包含融资余额因子

    返回:
        新增 market_score 列的 DataFrame
    """
    df = df.copy()

    rank_cols = ["rank_close", "rank_turnover", "rank_pe", "rank_rsi"]
    if use_margin:
        rank_cols.append("rank_margin")
    missing = [column for column in rank_cols if column not in df.columns]
    if missing:
        log.error(f"缺少必要排名列，无法计算市场温度: {missing}")
        df["market_score"] = np.nan
        return df

    # 等权平均，任何因子缺失则该天为 NaN（不跳过、不填充）
    df["market_score"] = df[rank_cols].mean(axis=1, skipna=False)

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 低频温度（二次 PERCENTRANK，对应 Excel P 列）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_low_freq_temperature(df: pd.DataFrame) -> pd.DataFrame:
    """
    对 market_score 做 PERCENTRANK.INC 二次排名（窗口=120）

    对应 Excel:
        P6 = PERCENTRANK.INC(O6:O125, O6)

    参数:
        df: 包含 market_score 列的 DataFrame

    返回:
        新增 market_score_low_freq 列的 DataFrame
    """
    df = df.copy()
    window = LOW_FREQ_WINDOW

    df["market_score_low_freq"] = percentrank_inc(df["market_score"], window)

    log.info(f"低频温度计算完成（窗口={window}）")

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 市场状态判定
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_market_state(score: float) -> tuple:
    """
    根据温度分值判定市场状态
    温度范围 0~1 映射到 0~100 后与 MARKET_STATES 匹配

    返回: (状态名称, 颜色代码)
    """
    if pd.isna(score):
        return "未知", "#888888"

    score_100 = score * 100  # 0~1 → 0~100

    for low, high, name, color in MARKET_STATES:
        if low <= score_100 < high:
            return name, color
    if score_100 < 0:
        return MARKET_STATES[0][2], MARKET_STATES[0][3]
    return MARKET_STATES[-1][2], MARKET_STATES[-1][3]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 统一评分入口
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_market_temperature(df: pd.DataFrame, use_margin: bool = True) -> pd.DataFrame:
    """
    完整温度计算流程：
        等权平均 → market_score
        二次排名 → market_score_low_freq
        状态判定 → market_state, state_color

    参数:
        df: 包含相关列的 DataFrame
        use_margin: 是否使用5因子模型

    返回:
        新增 market_score, market_score_low_freq, market_state, state_color 列
    """
    log.info("开始计算市场温度...")

    # Step 1: 等权平均
    df = calc_market_score(df, use_margin=use_margin)

    # Step 2: 二次 PERCENTRANK
    df = calc_low_freq_temperature(df)

    # Step 3: 市场状态判定（基于低频温度）
    state_info = df["market_score_low_freq"].apply(
        lambda s: pd.Series(get_market_state(s), index=["market_state", "state_color"])
    )
    df = pd.concat([df, state_info], axis=1)

    # 统计输出
    latest_score = df["market_score_low_freq"].iloc[-1]
    latest_state = df["market_state"].iloc[-1]
    log.info(f"市场温度计算完成")
    log.info(f"  温度（原始）: {df['market_score'].iloc[-1]:.4f}")
    log.info(f"  温度（低频）: {latest_score:.4f}  ({latest_score*100:.1f}℃)")
    log.info(f"  市场状态: {latest_state}")

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 获取温度详情（用于日报）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_score_details(df: pd.DataFrame, use_margin: bool = True) -> dict:
    """
    获取最新一天的温度评分详情

    返回:
        dict，包含温度值、状态、各指标分值
    """
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest

    score_raw = latest["market_score"]
    score_low = latest["market_score_low_freq"]

    details = {
        "score_raw": score_raw,
        "score": score_low,
        "score_pct": score_low * 100,  # 0~100 温度值
        "state": latest["market_state"],
        "color": latest["state_color"],
        "prev_score": prev["market_score_low_freq"],
        "prev_score_pct": prev["market_score_low_freq"] * 100,
        "score_change": round((score_low - prev["market_score_low_freq"]) * 100, 1),
        "date": latest["date"].strftime("%Y-%m-%d") if hasattr(latest["date"], "strftime") else str(latest["date"]),
        "components": {}
    }

    # 各指标排名详情
    if use_margin:
        indicators = {
            "rank_close": ("收盘价百分位", 1/5),
            "rank_turnover": ("成交额百分位", 1/5),
            "rank_pe": ("PE百分位", 1/5),
            "rank_rsi": ("RSI百分位", 1/5),
            "rank_margin": ("融资余额百分位", 1/5),
        }
    else:
        indicators = {
            "rank_close": ("收盘价百分位", 1/4),
            "rank_turnover": ("成交额百分位", 1/4),
            "rank_pe": ("PE百分位", 1/4),
            "rank_rsi": ("RSI百分位", 1/4),
        }

    for col, (name, weight) in indicators.items():
        val = latest.get(col, np.nan)
        prev_val = prev.get(col, np.nan)

        # 特殊格式化
        if col == "price_dev_pct":
            fmt_val = f"{val:+.1f}%" if not pd.isna(val) else None
            fmt_prev = f"{prev_val:+.1f}%" if not pd.isna(prev_val) else None
        elif col == "turnover_ratio":
            fmt_val = f"{val:.2f}x" if not pd.isna(val) else None
            fmt_prev = f"{prev_val:.2f}x" if not pd.isna(prev_val) else None
        else:
            fmt_val = round(val, 3) if not pd.isna(val) else None
            fmt_prev = round(prev_val, 3) if not pd.isna(prev_val) else None

        details["components"][col] = {
            "name": name,
            "value": fmt_val,
            "prev_value": fmt_prev,
            "weight": weight,
        }

    return details


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 独立测试
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    from utils.fetch_data import fetch_all_data, merge_data
    from utils.indicators import calc_all_indicators

    print("scoring.py 独立测试")
    print("=" * 40)

    data = fetch_all_data()
    df = merge_data(data)
    df = calc_all_indicators(df)
    df = calc_market_temperature(df)

    details = get_score_details(df)
    print(f"\n日期: {details['date']}")
    print(f"温度（原始）: {details['score_raw']:.4f}")
    print(f"温度（低频）: {details['score']:.4f}  →  {details['score_pct']:.1f}℃")
    print(f"市场状态: {details['state']}")
    print(f"较昨日: {details['score_change']:+.1f}℃")
    print(f"\n各指标排名详情:")
    for k, v in details["components"].items():
        print(f"  {v['name']}: {v['value']} (权重{v['weight']:.1%})")
