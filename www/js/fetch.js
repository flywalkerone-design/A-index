/**
 * A股市场温度计 - 数据获取模块
 *
 * 两种模式：
 *   Android: 直接调 iFinD API（Java 层处理 token 和 HTTP）
 *   浏览器:  通过 proxy.py 代理（开发模式）
 */

var Fetch = (function () {
    "use strict";

    var IS_ANDROID = !!(window.Android && window.Android.isAndroid());

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // localStorage 缓存
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function cacheKey(prefix, code, start, end) {
        return "ifind_" + prefix + "_" + code + "_" + start + "_" + end;
    }

    function getCached(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function setCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            // localStorage 满了，清理旧缓存
            clearOldCache();
        }
    }

    function clearOldCache() {
        try {
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf("ifind_") === 0) keys.push(k);
            }
            // 删除一半旧缓存
            keys.sort();
            for (var j = 0; j < Math.floor(keys.length / 2); j++) {
                localStorage.removeItem(keys[j]);
            }
        } catch (e) { /* ignore */ }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 指数历史行情
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取指数历史行情
     * @param {string} ifindCode - iFinD代码，如 "000001.SH"
     * @param {string} startDate - "YYYY-MM-DD"
     * @param {string} endDate   - "YYYY-MM-DD"
     * @returns {Promise<Object>} { dates, close, volume, amount, pe, ... }
     */
    function fetchIndexHistory(ifindCode, startDate, endDate) {
        // 检查缓存
        var ck = cacheKey("hist", ifindCode, startDate, endDate);
        var cached = getCached(ck);
        if (cached && cached.dates && cached.dates.length > 0) {
            return Promise.resolve(cached);
        }

        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                var raw = Android.fetchIndexHistory(ifindCode, startDate, endDate);
                try {
                    var data = JSON.parse(raw);
                    if (data.error) {
                        resolve({ error: data.error });
                        return;
                    }
                    // 单位转换：iFinD amount=元 → 亿元, volume=股 → 万手
                    if (data.amount) {
                        data.amount = data.amount.map(function (v) {
                            return v !== null ? Math.round(v / 1e8 * 100) / 100 : null;
                        });
                    }
                    if (data.volume) {
                        data.volume = data.volume.map(function (v) {
                            return v !== null ? Math.round(v / 10000 * 100) / 100 : null;
                        });
                    }
                    // 缓存结果
                    if (data.dates && data.dates.length > 0) {
                        setCache(ck, data);
                    }
                    resolve(data);
                } catch (e) {
                    resolve({ error: "解析失败: " + e.message });
                }
            });
        } else {
            // 浏览器模式：走 proxy
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/index_history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: startDate, end: endDate }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 融资余额
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取融资余额
     * @param {string} ifindCode
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>} { dates, margin_balance }
     */
    function fetchMargin(ifindCode, startDate, endDate) {
        var ck = cacheKey("margin", ifindCode, startDate, endDate);
        var cached = getCached(ck);
        if (cached && cached.dates && cached.dates.length > 0) {
            return Promise.resolve(cached);
        }

        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                var raw = Android.fetchMargin(ifindCode, startDate, endDate);
                try {
                    var data = JSON.parse(raw);
                    if (data.error) {
                        resolve({ error: data.error });
                        return;
                    }
                    if (data.dates && data.dates.length > 0) {
                        setCache(ck, data);
                    }
                    resolve(data);
                } catch (e) {
                    resolve({ error: "解析失败: " + e.message });
                }
            });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/margin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: startDate, end: endDate }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Token 管理
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function checkToken() {
        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                try {
                    var raw = Android.checkToken();
                    resolve(JSON.parse(raw));
                } catch (e) {
                    resolve({ valid: false, error: e.message });
                }
            });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/token/status")
                .then(function (r) { return r.json(); });
        }
    }

    function updateToken(token) {
        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                try {
                    Android.setRefreshToken(token);
                    // 测试新 token
                    var raw = Android.checkToken();
                    var result = JSON.parse(raw);
                    if (result.valid) {
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: result.error || "token无效" });
                    }
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/token/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: token }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. 原始数据获取 + 对齐
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取单个指数的原始数据（行情+融资），供前端本地计算
     * @param {Object} idxConfig - { code, ifind, name, margin }
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>} { dates, close, volume, amount, pe, margin_balance }
     */
    function fetchRawData(idxConfig, startDate, endDate) {
        return new Promise(function (resolve, reject) {
            fetchIndexHistory(idxConfig.ifind, startDate, endDate)
                .then(function (historyData) {
                    if (!historyData || historyData.error || !historyData.dates || historyData.dates.length === 0) {
                        resolve(null);
                        return;
                    }

                    var result = {
                        dates: historyData.dates,
                        close: historyData.close || [],
                        volume: historyData.volume || [],
                        amount: historyData.amount || [],
                        pe: historyData.pe || [],
                        margin_balance: null,
                    };

                    if (idxConfig.margin) {
                        fetchMargin(idxConfig.ifind, startDate, endDate)
                            .then(function (marginData) {
                                if (marginData && !marginData.error && marginData.dates && marginData.margin_balance) {
                                    result.margin_balance = alignMarginData(
                                        result.dates, marginData.dates, marginData.margin_balance
                                    );
                                }
                                resolve(result);
                            })
                            .catch(function () {
                                resolve(result);
                            });
                    } else {
                        resolve(result);
                    }
                })
                .catch(function (err) {
                    reject(err);
                });
        });
    }

    function alignMarginData(tradeDates, marginDates, marginValues) {
        var marginMap = {};
        for (var i = 0; i < marginDates.length; i++) {
            marginMap[marginDates[i]] = marginValues[i];
        }
        var aligned = new Array(tradeDates.length).fill(null);
        for (var i = 0; i < tradeDates.length; i++) {
            if (marginMap[tradeDates[i]] !== undefined) {
                aligned[i] = marginMap[tradeDates[i]];
            }
        }
        return aligned;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 完整流水线：获取 + 计算
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取单个指数数据并计算全部指标和温度
     * @param {Object} idxConfig
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>}
     */
    function fetchAndCalculate(idxConfig, startDate, endDate) {
        return fetchRawData(idxConfig, startDate, endDate)
            .then(function (raw) {
                if (!raw) return null;

                // T-1 截止
                var today = new Date();
                var todayStr = formatDate(today);
                var cutoffDate;
                if (today.getDay() >= 1 && today.getDay() <= 5) {
                    cutoffDate = todayStr;
                } else {
                    var fri = new Date(today);
                    fri.setDate(fri.getDate() - (fri.getDay() - 5 + 7) % 7);
                    cutoffDate = formatDate(fri);
                }

                var filtered = filterByDate(raw, cutoffDate);
                if (!filtered || filtered.dates.length === 0) return null;

                var useMargin = idxConfig.margin && filtered.margin_balance &&
                    countNotNull(filtered.margin_balance) >= 2;
                var data = Indicators.calcAll(filtered, useMargin);
                data = Scoring.calcTemperature(data, useMargin);

                var n = data.close.length;
                data.data_ok = new Array(n).fill(false);
                for (var i = 0; i < n; i++) {
                    var ok = data.rank_close[i] !== null &&
                        data.rank_turnover[i] !== null &&
                        data.rank_pe[i] !== null &&
                        data.rank_rsi[i] !== null;
                    if (useMargin) ok = ok && data.rank_margin[i] !== null;
                    data.data_ok[i] = ok;
                }

                data.code = idxConfig.code;
                data.display = idxConfig.display;
                data.group = idxConfig.group;
                data.useMargin = useMargin;

                return data;
            });
    }

    function filterByDate(data, cutoffDate) {
        var indices = [];
        for (var i = 0; i < data.dates.length; i++) {
            if (data.dates[i] < cutoffDate) indices.push(i);
        }
        if (indices.length === 0) return null;

        var result = {};
        result.dates = indices.map(function (i) { return data.dates[i]; });
        result.close = indices.map(function (i) { return data.close[i]; });
        result.volume = data.volume ? indices.map(function (i) { return data.volume[i]; }) : null;
        result.amount = data.amount ? indices.map(function (i) { return data.amount[i]; }) : null;
        result.pe = data.pe ? indices.map(function (i) { return data.pe[i]; }) : null;
        result.margin_balance = data.margin_balance
            ? indices.map(function (i) { return data.margin_balance[i]; }) : null;
        return result;
    }

    function countNotNull(arr) {
        var count = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== null && !isNaN(arr[i])) count++;
        }
        return count;
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
    }

    // ━━━ 公开接口 ━━━
    return {
        checkToken: checkToken,
        updateToken: updateToken,
        fetchIndexHistory: fetchIndexHistory,
        fetchMargin: fetchMargin,
        fetchRawData: fetchRawData,
        fetchAndCalculate: fetchAndCalculate,
    };
})();
