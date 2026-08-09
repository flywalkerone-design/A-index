import json
import unittest
from datetime import datetime
from pathlib import Path


APP_DIR = Path(__file__).resolve().parents[1]
WEB_DATA = APP_DIR / "www" / "data" / "chart_data.json"
ANDROID_DATA = APP_DIR / "android" / "app" / "src" / "main" / "assets" / "www" / "data" / "chart_data.json"


class ChartDataIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(WEB_DATA.read_text(encoding="utf-8"))

    def assert_valid_dates(self, rows):
        dates = [row["date"] for row in rows]
        self.assertEqual(dates, sorted(dates))
        self.assertEqual(len(dates), len(set(dates)))
        self.assertTrue(dates)
        for date in dates:
            parsed = datetime.strptime(date, "%Y-%m-%d")
            self.assertLess(parsed.weekday(), 5, date)

    def test_all_chart_series_use_unique_sorted_trade_dates(self):
        self.assert_valid_dates(self.data["market"])
        self.assert_valid_dates(self.data["margin"])
        self.assert_valid_dates(self.data["etf"]["rows"])

    def test_margin_peak_and_drawdown_are_exact(self):
        running_peak = None
        for row in self.data["margin"]:
            balance = row["balance"]
            running_peak = balance if running_peak is None else max(running_peak, balance)
            self.assertAlmostEqual(row["peak"], running_peak, places=2)
            self.assertAlmostEqual(
                row["drawdown"], max(0.0, running_peak - balance), delta=0.011
            )
            self.assertIsInstance(row["net_buy"], (int, float))

    def test_margin_never_leads_market_data(self):
        self.assertLessEqual(self.data["margin"][-1]["date"], self.data["market"][-1]["date"])

    def test_android_chart_data_matches_web(self):
        self.assertEqual(WEB_DATA.read_bytes(), ANDROID_DATA.read_bytes())


if __name__ == "__main__":
    unittest.main()
