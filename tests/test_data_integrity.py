import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from data_service import _reject_margin_outliers, fetch_all_data
from utils.ifind_data import _parse_date_sequence
from utils.indicators import calc_rsi, percentrank_inc
from utils.scoring import calc_market_score


class DataIntegrityTests(unittest.TestCase):
    @staticmethod
    def _result_frame(date, data_ok=True):
        return pd.DataFrame({
            "date": [pd.Timestamp(date)],
            "data_ok": [data_ok],
            "market_score_low_freq": [0.5],
            "rank_close": [0.5],
            "rank_turnover": [0.5],
            "rank_pe": [0.5],
            "rank_rsi": [0.5],
            "rank_margin": [0.5],
            "close": [100.0],
            "daily_return": [1.0],
            "RSI": [50.0],
            "pe": [20.0],
            "amount": [1000.0],
            "MA5": [99.0],
            "MA20": [98.0],
            "MA60": [97.0],
        })

    def test_date_sequence_uses_api_trade_dates(self):
        frame = _parse_date_sequence(
            {
                "time": ["2026-08-06", "2026-08-07"],
                "table": {"indicator": [10, 20]},
            },
            "indicator",
            "value",
        )
        self.assertEqual(frame["date"].dt.strftime("%Y-%m-%d").tolist(), ["2026-08-06", "2026-08-07"])
        self.assertEqual(frame["value"].tolist(), [10, 20])

    def test_date_sequence_rejects_length_mismatch(self):
        frame = _parse_date_sequence(
            {
                "time": ["2026-08-06", "2026-08-07"],
                "table": {"indicator": [10]},
            },
            "indicator",
            "value",
        )
        self.assertTrue(frame.empty)

    def test_percentrank_ignores_missing_values(self):
        result = percentrank_inc(pd.Series([1.0, np.nan, 3.0]), 3)
        self.assertEqual(result.iloc[-1], 1.0)

    def test_unconfirmed_margin_jump_is_rejected(self):
        transient = _reject_margin_outliers(pd.Series([100.0, 50.0, 102.0]))
        trailing = _reject_margin_outliers(pd.Series([100.0, 70.0]))
        confirmed = _reject_margin_outliers(pd.Series([100.0, 70.0, 69.0]))
        self.assertTrue(pd.isna(transient.iloc[1]))
        self.assertTrue(pd.isna(trailing.iloc[1]))
        self.assertEqual(confirmed.tolist(), [100.0, 70.0, 69.0])

    def test_margin_factor_is_required_when_enabled(self):
        frame = pd.DataFrame({
            "rank_close": [0.2],
            "rank_turnover": [0.4],
            "rank_pe": [0.6],
            "rank_rsi": [0.8],
        })
        with_margin = calc_market_score(frame, use_margin=True)
        without_margin = calc_market_score(frame, use_margin=False)
        self.assertTrue(pd.isna(with_margin["market_score"].iloc[0]))
        self.assertAlmostEqual(without_margin["market_score"].iloc[0], 0.5)

    def test_local_rsi_has_stable_wilder_seed(self):
        closes = pd.DataFrame({"close": [1, 2, 3, 2, 4, 5, 4, 6]})
        result = calc_rsi(closes, period=3)
        self.assertTrue(pd.isna(result["RSI"].iloc[2]))
        self.assertAlmostEqual(result["RSI"].iloc[3], 66.6666666667, places=6)

    def test_api_date_is_common_valid_data_date(self):
        indexes = [
            {"code": "A", "name": "A", "display_name": "A", "group": "main"},
            {"code": "B", "name": "B", "display_name": "B", "group": "main"},
        ]
        frames = [self._result_frame("2026-08-06"), self._result_frame("2026-08-05")]
        with patch("data_service._ensure_token"), \
                patch("data_service.INDEXES", indexes), \
                patch("data_service.fetch_single_index", side_effect=frames):
            result = fetch_all_data()
        self.assertEqual(result["date"], "2026-08-05")
        self.assertEqual([item["date"] for item in result["indices"]], ["2026-08-06", "2026-08-05"])

    def test_incomplete_factor_rows_are_not_published(self):
        indexes = [{"code": "A", "name": "A", "display_name": "A", "group": "main"}]
        with patch("data_service._ensure_token"), \
                patch("data_service.INDEXES", indexes), \
                patch("data_service.fetch_single_index", return_value=self._result_frame("2026-08-06", False)):
            result = fetch_all_data()
        self.assertEqual(result["date"], "")
        self.assertEqual(result["indices"], [])
        self.assertTrue(any("无完整因子数据" in error for error in result["errors"]))


if __name__ == "__main__":
    unittest.main()
