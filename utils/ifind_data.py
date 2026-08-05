"""
iFinD 数据接口模块
通过 iFinD HTTP API 获取指数融资余额（EDB）
"""

import time
import requests
import urllib3
import ssl
import pandas as pd
from pathlib import Path
from utils.logger import log

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
ssl._create_default_https_context = ssl._create_unverified_context

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. Token 管理
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_session = requests.Session()
_session.verify = False
_access_token = None
_token_expiry = 0


def _get_refresh_token() -> str:
    """从配置文件读取 refresh_token"""
    fp = Path(__file__).resolve().parent.parent / "ifind_token.txt"
    if fp.exists():
        return fp.read_text(encoding="utf-8").strip()
    raise FileNotFoundError(f"iFinD refresh_token 文件不存在: {fp}")


def _ensure_token():
    """确保 access_token 有效"""
    global _access_token, _token_expiry
    if _access_token and time.time() < _token_expiry:
        return

    refresh_token = _get_refresh_token()
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/get_access_token",
        headers={"Content-Type": "application/json", "refresh_token": refresh_token},
        timeout=15,
    )
    data = resp.json()
    if data.get("errorcode") != 0:
        raise RuntimeError(f"iFinD token 获取失败: {data}")

    _access_token = data["data"]["access_token"]
    # 提前5分钟过期
    _token_expiry = time.time() + 6.5 * 24 * 3600
    log.info(f"iFinD token 已获取，有效期至 {data['data'].get('expired_time')}")


def _headers() -> dict:
    _ensure_token()
    return {"Content-Type": "application/json", "access_token": _access_token}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 融资余额（EDB）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_MARGIN_CACHE = {}
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "ifind_margin_cache"


def _load_from_disk(code: str) -> pd.DataFrame:
    """从磁盘缓存加载"""
    fp = _CACHE_DIR / f"{code}.csv"
    if not fp.exists():
        return None
    try:
        df = pd.read_csv(fp)
        df["date"] = pd.to_datetime(df["date"])
        return df
    except Exception:
        return None


def _save_to_disk(code: str, df: pd.DataFrame):
    """保存到磁盘缓存"""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fp = _CACHE_DIR / f"{code}.csv"
    df.to_csv(fp, index=False)


def _fetch_chunk(code: str, startdate: str, enddate: str) -> list:
    """单次请求 iFinD EDB"""
    para = {
        "codes": code,
        "startdate": startdate.replace("-", ""),
        "enddate": enddate.replace("-", ""),
        "functionpara": {"Days": "Tradedays", "Fill": "Previous"},
        "indipara": [{
            "indicator": "ths_margin_trading_balance_index",
            "indiparams": [""]
        }],
    }
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/date_sequence",
        json=para,
        headers=_headers(),
        timeout=30,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        return []
    tables = r.get("tables", [])
    if not tables:
        return []
    return tables[0].get("table", {}).get("ths_margin_trading_balance_index", [])


def fetch_margin_ifind(code: str, startdate: str, enddate: str) -> pd.DataFrame:
    """
    通过 iFinD EDB 获取指数融资余额（增量模式：缓存 + 只抓新数据）

    参数:
        code: iFinD代码，如 "000685.SH", "H11059.CSI", "899050.BJ"
        startdate: 开始日期 "YYYY-MM-DD"
        enddate: 结束日期 "YYYY-MM-DD"

    返回:
        DataFrame: date, margin_balance
    """
    from datetime import datetime, timedelta

    def _download_range(fetch_start: str, fetch_end: str) -> pd.DataFrame:
        """按区间下载融资余额，保持原有日期生成逻辑。"""
        log.info(f"iFinD 获取 {code} 融资余额 ({fetch_start} ~ {fetch_end})...")
        t0 = time.time()

        start = datetime.strptime(fetch_start, "%Y-%m-%d")
        end = datetime.strptime(fetch_end, "%Y-%m-%d")

        all_vals = []
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=550), end)
            vals = _fetch_chunk(code, chunk_start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d"))
            if not vals:
                break
            all_vals.extend(vals)
            if len(vals) < 10:
                break
            chunk_start = chunk_start + timedelta(days=len(vals))

        if not all_vals:
            return pd.DataFrame(columns=["date", "margin_balance"])

        dates = []
        d = start
        while d <= end:
            dates.append(d)
            d += timedelta(days=1)

        n = min(len(dates), len(all_vals))
        new_df = pd.DataFrame({
            "date": dates[:n],
            "margin_balance": [float(v) if v is not None else float("nan") for v in all_vals[:n]],
        })
        new_df = new_df.drop_duplicates(subset="date", keep="last").reset_index(drop=True)

        elapsed = time.time() - t0
        log.info(f"  新增 {len(new_df)} 条 ({elapsed:.1f}s)")
        return new_df

    # 1. 加载磁盘缓存
    cached = _load_from_disk(code)
    requested_start = datetime.strptime(startdate, "%Y-%m-%d")
    requested_end = datetime.strptime(enddate, "%Y-%m-%d")

    # 2. 找出缓存未覆盖的前后区间
    fetch_ranges = []
    if cached is not None and not cached.empty:
        cached = cached.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)
        first_cached = cached["date"].min()
        last_cached = cached["date"].max()
        if requested_start < first_cached:
            fetch_ranges.append((requested_start, first_cached - timedelta(days=1)))
        if last_cached < requested_end:
            fetch_ranges.append((last_cached + timedelta(days=1), requested_end))
    else:
        fetch_ranges.append((requested_start, requested_end))

    # 3. 下载缺口并合并缓存
    new_parts = []
    for fetch_start, fetch_end in fetch_ranges:
        if fetch_start <= fetch_end:
            part = _download_range(fetch_start.strftime("%Y-%m-%d"), fetch_end.strftime("%Y-%m-%d"))
            if not part.empty:
                new_parts.append(part)

    frames = []
    if cached is not None and not cached.empty:
        frames.append(cached)
    frames.extend(new_parts)

    if not frames:
        return pd.DataFrame(columns=["date", "margin_balance"])

    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)

    _save_to_disk(code, df)

    # 返回请求范围
    mask = (df["date"] >= startdate) & (df["date"] <= enddate)
    return df[mask].copy()


def fetch_all_margin_ifind(indexes: list, startdate: str, enddate: str) -> dict:
    """
    批量获取所有指数的融资余额

    参数:
        indexes: [{"code": "000001.SH", "name": "上证指数", ...}, ...]
        startdate: 开始日期
        enddate: 结束日期

    返回:
        {code: DataFrame} 字典
    """
    result = {}
    for idx in indexes:
        code = idx["code"]
        name = idx["name"]
        try:
            df = fetch_margin_ifind(code, startdate, enddate)
            if not df.empty:
                result[code] = df
                log.info(f"  {name}: {len(df)} 条融资余额")
            else:
                log.warning(f"  {name}: 无融资余额数据")
        except Exception as e:
            log.warning(f"  {name} 融资余额获取失败: {e}")
    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 指数历史行情（中证接口缺失时兜底）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def _fetch_history_chunk(code: str, startdate: str, enddate: str) -> pd.DataFrame:
    """单次请求 iFinD 历史行情。"""
    para = {
        "codes": code,
        "indicators": "preClose,open,high,low,close,changeRatio,volume,amount,turnover_ratio,pe_ttm_index",
        "startdate": startdate.replace("-", ""),
        "enddate": enddate.replace("-", ""),
        "functionpara": {
            "Fill": "Blank",
            "CPS": "1",
            "Currency": "RMB",
        },
    }
    resp = _session.post(
        "https://quantapi.51ifind.com/api/v1/cmd_history_quotation",
        json=para,
        headers=_headers(),
        timeout=30,
    )
    r = resp.json()
    if r.get("errorcode") != 0:
        log.warning(f"iFinD 历史行情获取失败 {code}: {r}")
        return pd.DataFrame()

    tables = r.get("tables", [])
    if not tables:
        return pd.DataFrame()

    item = tables[0]
    times = item.get("time", [])
    table = item.get("table", {})
    if not times or not table:
        return pd.DataFrame()

    df = pd.DataFrame({"date": pd.to_datetime(times)})
    for col, values in table.items():
        df[col] = values
    return df


def fetch_index_history_ifind(code: str, startdate: str, enddate: str) -> pd.DataFrame:
    """
    通过 iFinD 历史行情获取指数数据（带磁盘缓存 + 增量更新）。

    返回列与 fetch_index_data 保持一致：
        date, open, high, low, close, change_pct, volume, amount, stock_count, pe
    """
    from datetime import datetime, timedelta

    # ━━━ 1. 加载磁盘缓存 ━━━
    INDEX_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "index_cache"
    INDEX_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_fp = INDEX_CACHE_DIR / f"{code}.csv"

    cached = None
    if cache_fp.exists():
        try:
            cached = pd.read_csv(cache_fp)
            cached["date"] = pd.to_datetime(cached["date"])
            cached = cached.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)
            log.info(f"  从缓存加载 {code}: {len(cached)} 行 ({cached['date'].iloc[0].strftime('%Y-%m-%d')} ~ {cached['date'].iloc[-1].strftime('%Y-%m-%d')})")
        except Exception:
            cached = None

    # ━━━ 2. 确定需要下载的范围 ━━━
    requested_start = datetime.strptime(startdate, "%Y-%m-%d")
    requested_end = datetime.strptime(enddate, "%Y-%m-%d")

    fetch_ranges = []
    if cached is not None and not cached.empty:
        first_cached = cached["date"].min()
        last_cached = cached["date"].max()
        if requested_start < first_cached:
            fetch_ranges.append((requested_start, first_cached - timedelta(days=1)))
        if last_cached < requested_end:
            fetch_ranges.append((last_cached + timedelta(days=1), requested_end))
    else:
        fetch_ranges.append((requested_start, requested_end))

    # ━━━ 3. 下载缺口 ━━━
    new_parts = []
    for fs, fe in fetch_ranges:
        if fs > fe:
            continue
        log.info(f"iFinD 获取指数行情: {code} ({fs.strftime('%Y-%m-%d')} ~ {fe.strftime('%Y-%m-%d')})")
        t0 = time.time()

        chunks = []
        chunk_start = fs
        while chunk_start <= fe:
            chunk_end = min(chunk_start + timedelta(days=540), fe)
            df_chunk = _fetch_history_chunk(
                code,
                chunk_start.strftime("%Y-%m-%d"),
                chunk_end.strftime("%Y-%m-%d"),
            )
            if not df_chunk.empty:
                chunks.append(df_chunk)
            if len(df_chunk) < 10:
                break
            chunk_start = chunk_end + timedelta(days=1)

        if chunks:
            part = pd.concat(chunks, ignore_index=True)
            part = part.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)
            # 格式转换（新数据，缓存数据已在上次保存时转换过）
            part = part.rename(columns={"changeRatio": "change_pct", "pe_ttm_index": "pe"})
            for col in ["open", "high", "low", "close", "change_pct", "volume", "amount", "turnover_ratio", "pe"]:
                if col in part.columns:
                    part[col] = pd.to_numeric(part[col], errors="coerce")
            if "amount" in part.columns:
                part["amount"] = part["amount"] / 1e8
            if "volume" in part.columns:
                part["volume"] = part["volume"] / 10000
            part["stock_count"] = None
            new_parts.append(part)
            log.info(f"  新增 {len(part)} 条 ({time.time()-t0:.1f}s)")

    # ━━━ 4. 合并缓存 + 新数据 ━━━
    frames = []
    if cached is not None and not cached.empty:
        frames.append(cached)
    frames.extend(new_parts)

    if not frames:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close",
                                     "change_pct", "volume", "amount", "pe"])

    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)

    # ━━━ 5. 列对齐（转换已在新数据步骤完成，缓存数据已转换过）━━━
    df = df.loc[:, ~df.columns.duplicated(keep="last")]
    if "stock_count" not in df.columns:
        df["stock_count"] = None
    keep_cols = ["date", "open", "high", "low", "close", "change_pct",
                 "volume", "amount", "turnover_ratio", "stock_count", "pe"]
    df = df[[c for c in keep_cols if c in df.columns]]

    # ━━━ 6. 保存到磁盘缓存 ━━━
    try:
        df.to_csv(cache_fp, index=False)
        log.info(f"  缓存已保存: {cache_fp.name} ({len(df)} 行)")
    except Exception as e:
        log.warning(f"  缓存保存失败: {e}")

    log.info(f"iFinD 指数行情获取成功，共 {len(df)} 行")
    if not df.empty:
        log.info(f"  范围: {df['date'].iloc[0].strftime('%Y-%m-%d')} ~ {df['date'].iloc[-1].strftime('%Y-%m-%d')}")
        log.info(f"  最新成交额: {df['amount'].iloc[-1]:.2f} 亿元")
        log.info(f"  最新PE: {df['pe'].iloc[-1]:.2f}")

    return df


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. RSI 指标（date_sequence 接口）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def fetch_rsi_ifind(code: str, startdate: str, enddate: str) -> pd.DataFrame:
    """
    通过 iFinD date_sequence 获取 RSI 指标。
    使用 ths_rsi_index，参数 [6, 100]（周期=6, 计算周期=100）。

    返回:
        DataFrame: date, rsi
        如果指数不支持该指标，返回空 DataFrame。
    """
    para = {
        "codes": code,
        "startdate": startdate.replace("-", ""),
        "enddate": enddate.replace("-", ""),
        "functionpara": {"Days": "Tradedays", "Fill": "Previous"},
        "indipara": [{
            "indicator": "ths_rsi_index",
            "indiparams": ["6", "100"],
        }],
    }
    try:
        resp = _session.post(
            "https://quantapi.51ifind.com/api/v1/date_sequence",
            json=para,
            headers=_headers(),
            timeout=30,
        )
        r = resp.json()
        if r.get("errorcode") != 0:
            log.warning(f"iFinD RSI 获取失败 {code}: errorcode={r.get('errorcode')}")
            return pd.DataFrame(columns=["date", "rsi"])

        tables = r.get("tables", [])
        if not tables:
            return pd.DataFrame(columns=["date", "rsi"])

        item = tables[0]
        times = item.get("time", [])
        vals = item.get("table", {}).get("ths_rsi_index", [])
        if not times or not vals:
            return pd.DataFrame(columns=["date", "rsi"])

        # 检查是否有有效值（非 None、非 "null" 字符串）
        parsed = []
        for v in vals:
            if v is None or v == "null" or (isinstance(v, str) and v.strip() == ""):
                parsed.append(float("nan"))
            else:
                try:
                    parsed.append(float(v))
                except (TypeError, ValueError):
                    parsed.append(float("nan"))

        has_valid = any(not pd.isna(v) for v in parsed)
        if not has_valid:
            log.info(f"iFinD RSI 对 {code} 无有效数据（可能不支持该指标）")
            return pd.DataFrame(columns=["date", "rsi"])

        df = pd.DataFrame({
            "date": pd.to_datetime(times),
            "rsi": parsed,
        })
        return df
    except Exception as e:
        log.warning(f"iFinD RSI 获取异常 {code}: {e}")
        return pd.DataFrame(columns=["date", "rsi"])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 独立测试
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    print("ifind_data.py 独立测试")
    print("=" * 40)

    indexes = [
        {"code": "000001.SH", "name": "上证指数"},
        {"code": "899050.BJ", "name": "北证50"},
        {"code": "000685.SH", "name": "科创芯片"},
        {"code": "H11059.CSI", "name": "工业有色"},
        {"code": "931994.CSI", "name": "电网设备"},
    ]

    data = fetch_all_margin_ifind(indexes, "2026-06-01", "2026-06-09")
    for code, df in data.items():
        print(f"\n{code}: {len(df)} 条")
        print(df.tail(5).to_string(index=False))
