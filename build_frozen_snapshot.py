"""Build a reproducible, offline APK data snapshot for a given trade date."""

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from config import INDEXES, MARKET_STATES
from data_service import _emotion, fetch_single_index
import utils.ifind_data as ifind_data


def state_for_score(score):
    for low, high, name, color in MARKET_STATES:
        if low <= score < high:
            return name, color
    return MARKET_STATES[-1][2], MARKET_STATES[-1][3]


def serialize_index(frame, config):
    valid = frame[frame["data_ok"]]
    if valid.empty:
        raise ValueError("no complete factor row")

    latest = valid.iloc[-1]
    score_column = "market_score_low_freq"
    score = round(float(latest[score_column]) * 100)
    state, state_color = state_for_score(score)
    chart = frame.tail(180)

    def pct(x):
        return round(float(x) * 1000) / 10 if pd.notna(x) else None

    ranks = {
        "close": round(float(latest["rank_close"]) * 100),
        "turnover": round(float(latest["rank_turnover"]) * 100),
        "pe": round(float(latest["rank_pe"]) * 100),
        "rsi": round(float(latest["rank_rsi"]) * 100),
        "margin": round(float(latest["rank_margin"]) * 100),
    }
    return {
        "code": config["code"],
        "date": latest["date"].strftime("%Y-%m-%d"),
        "display": config.get("display_name", config["name"]),
        "group": config["group"],
        "score": score,
        "state": state,
        "stateColor": state_color,
        "emotion": _emotion(score)["label"],
        "emotionColor": _emotion(score)["color"],
        "close": round(float(latest["close"]), 2),
        "ret": round(float(latest.get("daily_return", 0)), 2),
        "rsi": round(float(latest.get("RSI", 0)), 1),
        "pe": round(float(latest.get("pe", 0)), 2),
        "amount": round(float(latest.get("amount", 0)), 2),
        "ma5": round(float(latest.get("MA5", 0)), 2),
        "ma20": round(float(latest.get("MA20", 0)), 2),
        "ma60": round(float(latest.get("MA60", 0)), 2),
        "ranks": ranks,
        "dates": [date.strftime("%Y-%m-%d") for date in chart["date"]],
        "scores": [
            round(float(value) * 100) if pd.notna(value) else None
            for value in chart[score_column]
        ],
        "closes": [round(float(value), 2) if pd.notna(value) else None for value in chart["close"]],
        # 逐日涨跌幅（供详情页近1年表格显示）
        "ret_series": [round(float(v), 2) if pd.notna(v) else None for v in chart["daily_return"]] if "daily_return" in chart.columns else [],
        # 逐日因子百分位（0-100，1 位小数），与 dates 对齐，供详情页因子表回溯
        "rank_close": [pct(v) for v in chart["rank_close"]],
        "rank_turnover": [pct(v) for v in chart["rank_turnover"]],
        "rank_pe": [pct(v) for v in chart["rank_pe"]],
        "rank_rsi": [pct(v) for v in chart["rank_rsi"]],
        "rank_margin": [pct(v) for v in chart["rank_margin"]] if "rank_margin" in chart.columns else [],
        "turnover": [round(float(v), 2) if pd.notna(v) else None for v in chart["turnover_ratio"]] if "turnover_ratio" in chart.columns else [],
        "pe_series": [round(float(v), 2) if pd.notna(v) else None for v in chart["pe"]] if "pe" in chart.columns else [],
        "rsi_series": [round(float(v), 1) if pd.notna(v) else None for v in chart["RSI"]] if "RSI" in chart.columns else [],
        "margin_series": [round(float(v), 2) if pd.notna(v) else None for v in chart["margin_balance"]] if "margin_balance" in chart.columns else [],
    }


def reject_network(*_args, **_kwargs):
    raise RuntimeError("offline snapshot build attempted an iFinD request")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", required=True, help="Snapshot cutoff, YYYY-MM-DD")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    as_of = datetime.strptime(args.as_of, "%Y-%m-%d")
    # The checked-in local cache starts on 2024-07-16.  Starting before that
    # would make the cache loader request a two-day gap from iFinD.
    start = max(as_of - timedelta(days=365 * 2 + 30), datetime(2024, 7, 16)).strftime("%Y-%m-%d")
    original_post = ifind_data._post
    ifind_data._post = reject_network
    try:
        indices = []
        errors = []
        for config in INDEXES:
            try:
                # Some newly added thematic indices have a shorter local
                # history. Use their actual cache start so the offline build
                # does not turn an unavailable prefix into an HTTP request.
                cache_path = Path("data/index_cache") / f"{config['ifind_code']}.v2.csv"
                local_start = start
                if cache_path.exists():
                    cache_dates = pd.read_csv(cache_path, usecols=["date"])["date"]
                    cache_start = pd.to_datetime(cache_dates, errors="coerce").min()
                    if pd.notna(cache_start):
                        local_start = max(datetime.strptime(start, "%Y-%m-%d"), cache_start.to_pydatetime()).strftime("%Y-%m-%d")
                frame = fetch_single_index(config, local_start, args.as_of)
                if frame is None or frame.empty:
                    raise ValueError("no cached data")
                indices.append(serialize_index(frame, config))
            except Exception as exc:
                errors.append(f"{config['code']}: {exc}")
    finally:
        ifind_data._post = original_post

    if errors:
        raise RuntimeError("offline snapshot incomplete: " + "; ".join(errors))

    result = {
        "snapshot_date": args.as_of,
        "source": "local-cache-offline",
        "indices": indices,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {output}: {len(indices)} indices, cutoff={args.as_of}")


if __name__ == "__main__":
    main()
