"""从 iFinD API 重新生成 www/data/chart_data.json

数据来源：iFinD 量化 API（主），Excel 文件（降级备用）
  - market: 上证指数日成交额 + 20日均线
  - margin: 沪深两市融资统计报表 (p03438，含专用净买入字段)
  - etf:    11只宽基ETF净流入合计 (ths_netcashflow_fund)

使用方法：
  python update_chart_data.py                      # 从 iFinD API 获取
  python update_chart_data.py "E:/path/to/数据文件"  # iFinD 失败时用指定 Excel 目录降级
"""
import json
import sys
from pathlib import Path
from datetime import datetime

from chart_data_service import load_chart_data

APP_DIR = Path(__file__).resolve().parent
OUTPUT = APP_DIR / "www" / "data" / "chart_data.json"


def main():
    data_dir = None
    if len(sys.argv) > 1:
        data_dir = Path(sys.argv[1])
        if not data_dir.exists():
            print(f"错误：数据目录不存在: {data_dir}")
            sys.exit(1)

    print("从 iFinD API 获取数据..." + (f" (降级目录: {data_dir})" if data_dir else ""))
    data = load_chart_data(data_dir)
    data["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"已生成: {OUTPUT}")
    if data.get("market"):
        print(f"  market: {len(data['market'])} 条, 最新 {data['market'][-1]['date']}")
    if data.get("margin"):
        print(f"  margin: {len(data['margin'])} 条, 最新 {data['margin'][-1]['date']}")
    rows = data.get("etf", {}).get("rows", [])
    if rows:
        print(f"  etf: {len(rows)} 条, 最新 {rows[-1]['date']}")


if __name__ == "__main__":
    main()
