"""从 Excel 数据文件重新生成 www/data/chart_data.json

使用方法：
  1. 更新 数据文件/ 下的 Excel 文件（上证走势与融资余额.xlsx、ETF规模净流入统计.xlsx）
  2. 运行: python update_chart_data.py
  3. 重启 server（PC端）或重新打包 APK（手机端）
"""
import json
from pathlib import Path
from datetime import datetime

from chart_data_service import load_chart_data

APP_DIR = Path(__file__).resolve().parent
OUTPUT = APP_DIR / "www" / "data" / "chart_data.json"


def main():
    print("从 Excel 读取数据...")
    data = load_chart_data()
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
