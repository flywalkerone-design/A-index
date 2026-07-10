/**
 * A股市场温度计 - 指标计算引擎
 * 100%还原 Python indicators.py 逻辑：
 *   1. 移动平均线 MA5/MA20/MA60
 *   2. 日涨跌幅
 *   3. RSI（Wilder平滑，周期=6）
 *   4. PERCENTRANK.INC 滚动百分位排名（窗口=180）
 */

var Indicators = (function () {
    "use strict";

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 辅助：数组求和/均值
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function sum(arr) {
        var s = 0;
        for (var i = 0; i < arr.length; i++) s += arr[i];
        return s;
    }

    function mean(arr) {
        if (arr.length === 0) return NaN;
        return sum(arr) / arr.length;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 移动平均线（辅助展示用）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function calcMA(closes, periods) {
        periods = periods || AppConfig.MA_PERIODS;
        var result = {};
        periods.forEach(function (p) {
            var ma = new Array(closes.length).fill(null);
            for (var i = 0; i < closes.length; i++) {
                var start = Math.max(0, i - p + 1);
                var count = i - start + 1;
                if (count >= 1) {
                    var s = 0;
                    for (var j = start; j <= i; j++) {
                        s += closes[j];
                    }
                    ma[i] = s / count;
                }
            }
            result["MA" + p] = ma;
        });
        return result;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 日涨跌幅（百分比）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function calcDailyReturn(closes) {
        var ret = new Array(closes.length).fill(null);
        for (var i = 1; i < closes.length; i++) {
            if (closes[i - 1] !== null && closes[i - 1] !== 0) {
                ret[i] = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
            }
        }
        return ret;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. RSI 相对强弱指标（Wilder平滑，周期=6）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function calcRSI(closes, period) {
        period = period || AppConfig.RSI_PERIOD;
        var n = closes.length;
        var rsi = new Array(n).fill(null);

        // 计算涨跌幅（跳过空数据）
        var delta = new Array(n).fill(0);
        for (var i = 1; i < n; i++) {
            if (closes[i] !== null && closes[i] !== undefined &&
                closes[i - 1] !== null && closes[i - 1] !== undefined &&
                !isNaN(closes[i]) && !isNaN(closes[i - 1])) {
                delta[i] = closes[i] - closes[i - 1];
            }
        }

        // Wilder EMA 平滑法：alpha = 1/period
        // avg_gain[0] = 前period个gain的简单平均
        // avg_gain[i] = (avg_gain[i-1] * (period-1) + gain[i]) / period
        var alpha = 1.0 / period;
        var avgGain = null;
        var avgLoss = null;
        var gainSum = 0;
        var lossSum = 0;

        for (var i = 1; i <= period; i++) {
            var g = delta[i] > 0 ? delta[i] : 0;
            var l = delta[i] < 0 ? -delta[i] : 0;
            gainSum += g;
            lossSum += l;
        }

        avgGain = gainSum / period;
        avgLoss = lossSum / period;

        // RSI 从第 period 个数据点开始
        if (avgLoss === 0) {
            rsi[period] = avgGain > 0 ? 100 : null;  // 无波动时返回null（匹配Python）
        } else {
            rsi[period] = 100 - (100 / (1 + avgGain / avgLoss));
        }

        // 继续用 Wilder EMA 计算后续值
        for (var i = period + 1; i < n; i++) {
            var g = delta[i] > 0 ? delta[i] : 0;
            var l = delta[i] < 0 ? -delta[i] : 0;
            avgGain = (avgGain * (period - 1) + g) / period;
            avgLoss = (avgLoss * (period - 1) + l) / period;

            if (avgLoss === 0) {
                rsi[i] = avgGain > 0 ? 100 : 50;
            } else {
                rsi[i] = 100 - (100 / (1 + avgGain / avgLoss));
            }
        }

        return rsi;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. PERCENTRANK.INC 滚动百分位排名
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 完全复刻 Excel PERCENTRANK.INC 函数
     *
     * PERCENTRANK.INC(array, x) =
     *   COUNTIF(array, < x) / (COUNT(array) - 1)
     *
     * 等价于：排名百分位，0 表示最小值，1 表示最大值
     * 如 array=[1,2,3,4,5], x=3 → 2/(5-1) = 0.5
     *
     * @param {number[]} series - 数据序列
     * @param {number} window - 滚动窗口大小
     * @returns {number[]} 百分位排名序列 (0.0 ~ 1.0)
     */
    function percentrankInc(series, window) {
        var n = series.length;
        var result = new Array(n).fill(null);

        for (var i = 0; i < n; i++) {
            // 需要至少2个数据点
            if (i < 1) continue;

            var winSize = Math.min(i + 1, window);
            var start = i + 1 - winSize;

            // 收集窗口内的有效值
            var values = [];
            for (var j = start; j <= i; j++) {
                if (series[j] !== null && !isNaN(series[j])) {
                    values.push(series[j]);
                }
            }

            if (values.length < 2) {
                result[i] = null;
                continue;
            }

            var current = series[i];
            if (current === null || isNaN(current)) {
                result[i] = null;
                continue;
            }

            // COUNTIF(array, < x)
            var countBelow = 0;
            for (var k = 0; k < values.length; k++) {
                if (values[k] < current) countBelow++;
            }

            result[i] = countBelow / (values.length - 1);
        }

        return result;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 计算全部百分位排名
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * @param {Object} data - { close, amount, pe, RSI, margin_balance }
     * @param {boolean} useMargin - 是否计算融资余额百分位
     * @returns {Object} { rank_close, rank_turnover, rank_pe, rank_rsi, rank_margin }
     */
    function calcAllPercentileRanks(data, useMargin) {
        var window = AppConfig.PERCENTRANK_WINDOW;

        var ranks = {};
        ranks.rank_close = percentrankInc(data.close, window);
        ranks.rank_turnover = percentrankInc(data.amount, window);

        // PE 百分位
        if (data.pe && countValid(data.pe) >= 2) {
            ranks.rank_pe = percentrankInc(data.pe, window);
        } else {
            ranks.rank_pe = new Array(data.close.length).fill(null);
        }

        // RSI 百分位
        ranks.rank_rsi = percentrankInc(data.RSI, window);

        // 融资余额百分位（仅主指数）
        if (useMargin && data.margin_balance && countValid(data.margin_balance) >= 2) {
            ranks.rank_margin = percentrankInc(data.margin_balance, window);
        } else {
            ranks.rank_margin = new Array(data.close.length).fill(null);
        }

        return ranks;
    }

    // 辅助：计算有效值数量
    function countValid(arr) {
        var count = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== null && !isNaN(arr[i])) count++;
        }
        return count;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 6. 一键计算全部指标
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 完整指标计算流程，与 Python calc_all_indicators 一致
     *
     * @param {Object} raw - 原始数据 { dates, close, volume, amount, pe, margin_balance }
     * @param {boolean} useMargin - 是否使用融资余额
     * @returns {Object} 增量添加了 MA, daily_return, RSI, rank_* 的数据对象
     */
    function calcAll(raw, useMargin) {
        if (typeof useMargin === "undefined") useMargin = true;

        var data = {};
        // 复制原始数据
        data.dates = raw.dates;
        data.close = raw.close.slice();
        data.volume = raw.volume ? raw.volume.slice() : null;
        data.amount = raw.amount ? raw.amount.slice() : null;
        data.pe = raw.pe ? raw.pe.slice() : null;
        data.margin_balance = raw.margin_balance ? raw.margin_balance.slice() : null;

        // 1. 均线
        var ma = calcMA(data.close);
        data.MA5 = ma.MA5;
        data.MA20 = ma.MA20;
        data.MA60 = ma.MA60;

        // 2. 日涨跌幅
        data.daily_return = calcDailyReturn(data.close);

        // 3. RSI
        data.RSI = calcRSI(data.close, AppConfig.RSI_PERIOD);

        // 4. 百分位排名
        var ranks = calcAllPercentileRanks(data, useMargin);
        data.rank_close = ranks.rank_close;
        data.rank_turnover = ranks.rank_turnover;
        data.rank_pe = ranks.rank_pe;
        data.rank_rsi = ranks.rank_rsi;
        data.rank_margin = ranks.rank_margin;

        return data;
    }

    // ━━━ 公开接口 ━━━
    return {
        calcMA: calcMA,
        calcDailyReturn: calcDailyReturn,
        calcRSI: calcRSI,
        percentrankInc: percentrankInc,
        calcAllPercentileRanks: calcAllPercentileRanks,
        calcAll: calcAll,
    };
})();
