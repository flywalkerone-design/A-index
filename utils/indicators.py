"""
A股市场温度计 - 指标计算模块
100%还原 Excel 温度计算逻辑：
  1. 5个原始指标（收盘价/成交额/PE/RSI/融资余额）
  2. 对每个指标做 PERCENTRANK.INC 滚动百分位排名（窗口=180）
  3. 等权平均 → 市场温度
  4. 对温度再做一次 PERCENTRANK.INC（窗口=120）→ 低频温度
"""

import sys
from pathlib import Path

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import RSI_PERIOD, PERCENTRANK_WINDOW, LOW_FREQ_WINDOW, MA_PERIODS, SECTOR_PARAMS
from utils.logger import log


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 0. 移动平均线（辅助展示用）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_ma(df: pd.DataFrame, periods: list = None) -> pd.DataFrame:
    """计算移动平均线（用于图表展示）"""
    periods = periods or MA_PERIODS
    df = df.copy()
    for p in periods:
        df[f"MA{p}"] = df["close"].rolling(window=p, min_periods=1).mean()
    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 日涨跌幅
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_daily_return(df: pd.DataFrame) -> pd.DataFrame:
    """计算日涨跌幅（百分比，如 2.198 表示 +2.198%）"""
    df = df.copy()
    df["daily_return"] = df["close"].pct_change() * 100
    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. RSI 相对强弱指标（Wilder平滑，周期=6）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_rsi(df: pd.DataFrame, period: int = None) -> pd.DataFrame:
    """
    计算 RSI 相对强弱指标
    Excel 中标注 [参数]6，使用 Wilder 的 EMA 平滑法
    """
    period = period or RSI_PERIOD
    df = df.copy()

    closes = pd.to_numeric(df["close"], errors="coerce").to_numpy(dtype=float)
    rsi = np.full(len(closes), np.nan)
    if len(closes) <= period:
        df["RSI"] = rsi
        return df

    delta = np.diff(closes)
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()

    if avg_loss == 0:
        rsi[period] = 100.0 if avg_gain > 0 else np.nan
    else:
        rsi[period] = 100 - (100 / (1 + avg_gain / avg_loss))

    for index in range(period + 1, len(closes)):
        gain = gains[index - 1]
        loss = losses[index - 1]
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            rsi[index] = 100.0 if avg_gain > 0 else 50.0
        else:
            rsi[index] = 100 - (100 / (1 + avg_gain / avg_loss))

    df["RSI"] = rsi

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. PERCENTRANK.INC 滚动百分位排名
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def percentrank_inc(series: pd.Series, window: int) -> pd.Series:
    """
    完全复刻 Excel PERCENTRANK.INC 函数

    PERCENTRANK.INC(array, x) =
      COUNTIF(array, < x) / (COUNT(array) - 1)

    等价于：排名百分位，0 表示最小值，1 表示最大值
    如 array=[1,2,3,4,5], x=3 → 2/(5-1) = 0.5

    参数:
        series: 数据序列
        window: 滚动窗口大小

    返回:
        百分位排名序列 (0.0 ~ 1.0)
    """
    def _percentrank(arr):
        """计算 arr[-1] 在 arr 中的 PERCENTRANK.INC"""
        current = arr[-1]
        if np.isnan(current):
            return np.nan
        values = arr[~np.isnan(arr)]
        n = len(values)
        if n < 2:
            return np.nan
        # COUNTIF(array, < x)
        count_below = np.sum(values < current)
        return count_below / (n - 1)

    return series.rolling(window=window, min_periods=2).apply(_percentrank, raw=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 行业指数专用指标
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_price_deviation(df: pd.DataFrame) -> pd.DataFrame:
    """
    计算价格偏离度：(close / MA120 - 1) * 100

    正值表示在均线上方，负值表示在下方
    用于行业指数替代 rank_close（180天PERCENTRANK）
    """
    df = df.copy()
    ma_period = SECTOR_PARAMS["price_ma_period"]
    df["price_ma120"] = df["close"].rolling(window=ma_period, min_periods=ma_period // 2).mean()
    df["price_dev_pct"] = (df["close"] / df["price_ma120"] - 1) * 100
    return df


def calc_turnover_ratio(df: pd.DataFrame) -> pd.DataFrame:
    """
    计算成交额比值：amount / MA60(amount)

    1.0 = 正常水平，>1.0 = 放量，<1.0 = 缩量
    用于行业指数替代 rank_turnover（180天PERCENTRANK）
    """
    df = df.copy()
    ma_period = SECTOR_PARAMS["turnover_ma_period"]
    df["turnover_ma60"] = df["amount"].rolling(window=ma_period, min_periods=ma_period // 3).mean()
    df["turnover_ratio"] = df["amount"] / df["turnover_ma60"]
    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. 计算百分位排名（含行业专用路径）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_all_percentile_ranks(df: pd.DataFrame, use_margin: bool = True) -> pd.DataFrame:
    """
    计算 PERCENTRANK.INC 滚动排名（窗口=180）

    主指数（5因子）：close, turnover, pe, rsi, margin
    行业指数（4因子）：close, turnover, pe, rsi

    返回:
        新增 rank_* 列的 DataFrame
    """
    df = df.copy()
    window = PERCENTRANK_WINDOW

    log.info(f"开始计算 PERCENTRANK.INC 滚动排名（窗口={window}）...")

    # 1. 收盘价百分位
    df["rank_close"] = percentrank_inc(df["close"], window)

    # 2. 换手率百分位（当前模型口径）
    if "turnover_ratio" in df.columns and df["turnover_ratio"].notna().sum() >= 2:
        df["rank_turnover"] = percentrank_inc(df["turnover_ratio"], window)
    else:
        df["rank_turnover"] = np.nan
        log.warning("换手率数据不足，rank_turnover 填充 NaN")

    # 3. PE百分位
    if "pe" in df.columns and df["pe"].notna().sum() >= 2:
        df["rank_pe"] = percentrank_inc(df["pe"], window)
    else:
        df["rank_pe"] = np.nan
        log.warning("PE 数据不足，rank_pe 填充 NaN")

    # 4. RSI百分位
    df["rank_rsi"] = percentrank_inc(df["RSI"], window)

    # 5. 融资余额百分位（仅主指数）
    if use_margin:
        if "margin_balance" in df.columns and df["margin_balance"].notna().sum() >= 2:
            df["rank_margin"] = percentrank_inc(df["margin_balance"], window)
        else:
            df["rank_margin"] = np.nan
            log.warning("融资余额数据不足，rank_margin 填充 NaN")

    log.info("PERCENTRANK.INC 滚动排名计算完成")

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 7. 统一计算入口
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def calc_all_indicators(df: pd.DataFrame, use_margin: bool = True) -> pd.DataFrame:
    """
    一键计算全部指标

    参数:
        df: 原始数据 DataFrame（来自 merge_data）
        use_margin: 是否计算融资余额百分位（行业指数用 False）
    """
    log.info("开始计算全部技术指标...")

    # 0. 均线（辅助展示）
    df = calc_ma(df)

    # 1. 日涨跌幅
    df = calc_daily_return(df)
    log.info("  日涨跌幅计算完成")

    # 2. RSI：优先 iFinD，指标不支持时使用本地 Wilder RSI(6)
    if "rsi_ifind" in df.columns and df["rsi_ifind"].notna().sum() >= 2:
        df["RSI"] = pd.to_numeric(df["rsi_ifind"], errors="coerce")
    else:
        df = calc_rsi(df)
    log.info(f"  RSI({RSI_PERIOD}) 计算完成")

    # 3. 百分位排名
    df = calc_all_percentile_ranks(df, use_margin=use_margin)

    log.info(f"全部指标计算完成，数据共 {len(df)} 行, {len(df.columns)} 列")
    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 独立测试
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    from utils.fetch_data import fetch_all_data, merge_data

    print("indicators.py 独立测试")
    print("=" * 40)

    data = fetch_all_data()
    df = merge_data(data)
    df = calc_all_indicators(df)

    print(f"\n列名: {df.columns.tolist()}")
    show_cols = ["date", "close", "volume", "pe", "RSI",
                 "margin_balance",
                 "rank_close", "rank_turnover", "rank_pe",
                 "rank_rsi", "rank_margin"]
    available = [c for c in show_cols if c in df.columns]
    print(f"\n最近5天:")
    print(df[available].tail().to_string(index=False))
