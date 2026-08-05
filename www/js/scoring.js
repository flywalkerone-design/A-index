/**
 * A股市场温度计 - 温度评分系统
 * 100%还原 Python scoring.py 逻辑：
 *   1. 5个百分位排名等权平均 → market_score（O列「市场温度」）
 *   2. 对 market_score 再做 PERCENTRANK.INC（窗口=120）→ market_score_low_freq（P列）
 *   3. 根据温度值判定市场状态（冰点/恐惧/偏冷/中性/偏热/过热/狂热）
 */

var Scoring = (function () {
    "use strict";

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 计算市场温度（等权平均）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 百分位排名等权平均 → market_score（0~1）
     * 与 Python calc_market_score 完全一致
     *
     * @param {Object} data - 包含 rank_* 数组的数据对象
     * @param {boolean} useMargin - 是否包含融资余额因子
     * @returns {number[]} market_score 数组
     */
    function calcMarketScore(data, useMargin) {
        var n = data.close.length;
        var score = new Array(n).fill(null);

        var rankCols = useMargin
            ? ["rank_close", "rank_turnover", "rank_pe", "rank_rsi", "rank_margin"]
            : ["rank_close", "rank_turnover", "rank_pe", "rank_rsi"];

        for (var i = 0; i < n; i++) {
            var sum = 0;
            var count = 0;
            var allValid = true;

            for (var k = 0; k < rankCols.length; k++) {
                var col = rankCols[k];
                if (data[col] && data[col][i] !== null && !isNaN(data[col][i])) {
                    sum += data[col][i];
                    count++;
                } else {
                    allValid = false;
                    break;
                }
            }

            // 等权平均，任何因子缺失则该天为 NaN（不跳过、不填充）
            if (allValid && count === rankCols.length) {
                score[i] = sum / count;
            } else {
                score[i] = null;
            }
        }

        return score;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 低频温度（二次 PERCENTRANK）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 对 market_score 做 PERCENTRANK.INC 二次排名（窗口=120）
     * 与 Python calc_low_freq_temperature 完全一致
     *
     * @param {number[]} marketScore - market_score 数组
     * @returns {number[]} market_score_low_freq 数组
     */
    function calcLowFreqTemperature(marketScore) {
        return Indicators.percentrankInc(marketScore, AppConfig.LOW_FREQ_WINDOW);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 统一评分入口
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 完整温度计算流程
     * 与 Python calc_market_temperature 完全一致
     *
     * @param {Object} data - 包含 rank_* 的数据对象
     * @param {boolean} useMargin - 是否使用5因子模型
     * @returns {Object} 添加了 market_score, market_score_low_freq, market_state, state_color
     */
    function calcTemperature(data, useMargin) {
        // Step 1: 等权平均
        data.market_score = calcMarketScore(data, useMargin);

        // Step 2: 二次 PERCENTRANK
        data.market_score_low_freq = calcLowFreqTemperature(data.market_score);

        // Step 3: 市场状态判定
        var n = data.close.length;
        data.market_state = new Array(n).fill(null);
        data.state_color = new Array(n).fill(null);

        for (var i = 0; i < n; i++) {
            var s = data.market_score_low_freq[i];
            var state = AppConfig.getMarketState(s);
            data.market_state[i] = state.name;
            data.state_color[i] = state.color;
        }

        return data;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. 获取温度详情（用于详情页）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取最新一天的温度评分详情
     * 与 Python get_score_details 一致
     *
     * @param {Object} data - 计算完温度的数据对象
     * @param {boolean} useMargin
     * @returns {Object} 温度详情
     */
    function getScoreDetails(data, useMargin) {
        var n = data.close.length;
        var last = n - 1;
        var prev = n - 2;

        var scoreRaw = data.market_score[last];
        var scoreLow = data.market_score_low_freq[last];
        var prevScore = prev >= 0 ? data.market_score_low_freq[prev] : scoreLow;

        var details = {
            score_raw: scoreRaw,
            score: scoreLow,
            score_pct: scoreLow !== null ? scoreLow * 100 : null,
            state: data.market_state[last],
            color: data.state_color[last],
            prev_score: prevScore,
            prev_score_pct: prevScore !== null ? prevScore * 100 : null,
            score_change: (scoreLow !== null && prevScore !== null)
                ? Math.round((scoreLow - prevScore) * 100 * 10) / 10 : 0,
            date: data.dates[last],
            components: {},
        };

        // 各指标排名详情
        var indicators = useMargin
            ? {
                rank_close: { name: "收盘价百分位", weight: 0.2 },
                rank_turnover: { name: "换手率百分位", weight: 0.2 },
                rank_pe: { name: "PE TTM百分位", weight: 0.2 },
                rank_rsi: { name: "RSI百分位", weight: 0.2 },
                rank_margin: { name: "融资余额百分位", weight: 0.2 },
            }
            : {
                rank_close: { name: "收盘价百分位", weight: 0.25 },
                rank_turnover: { name: "换手率百分位", weight: 0.25 },
                rank_pe: { name: "PE TTM百分位", weight: 0.25 },
                rank_rsi: { name: "RSI百分位", weight: 0.25 },
            };

        for (var col in indicators) {
            if (!indicators.hasOwnProperty(col)) continue;
            var info = indicators[col];
            var val = data[col] ? data[col][last] : null;
            var prevVal = data[col] && prev >= 0 ? data[col][prev] : null;

            details.components[col] = {
                name: info.name,
                value: val !== null && !isNaN(val) ? Math.round(val * 1000) / 1000 : null,
                prev_value: prevVal !== null && !isNaN(prevVal) ? Math.round(prevVal * 1000) / 1000 : null,
                weight: info.weight,
            };
        }

        return details;
    }

    // ━━━ 公开接口 ━━━
    return {
        calcMarketScore: calcMarketScore,
        calcLowFreqTemperature: calcLowFreqTemperature,
        calcTemperature: calcTemperature,
        getScoreDetails: getScoreDetails,
    };
})();
