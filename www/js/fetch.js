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

    function findCached(prefix, code, startDate) {
        var best = null;
        var base = "ifind_" + prefix + "_" + code + "_";
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key || key.indexOf(base) !== 0) continue;
                var item = getCached(key);
                if (!item || !item.dates || !item.dates.length) continue;
                if (item.dates[0] <= startDate && (!best || item.dates[item.dates.length - 1] > best.dates[best.dates.length - 1])) best = item;
            }
        } catch (e) { /* ignore */ }
        return best;
    }

    function mergeSeries(oldData, newData) {
        if (!oldData || !oldData.dates || !oldData.dates.length) return newData;
        if (!newData || !newData.dates || !newData.dates.length) return oldData;
        var out = {};
        Object.keys(oldData).forEach(function (key) { out[key] = Array.isArray(oldData[key]) ? oldData[key].slice() : oldData[key]; });
        for (var i = 0; i < newData.dates.length; i++) {
            if (newData.dates[i] <= oldData.dates[oldData.dates.length - 1]) continue;
            Object.keys(newData).forEach(function (key) {
                if (Array.isArray(newData[key])) {
                    if (!out[key]) out[key] = [];
                    out[key].push(newData[key][i]);
                }
            });
        }
        return out;
    }

    function cachedRangeFetch(prefix, code, startDate, endDate, fetcher) {
        var key = cacheKey(prefix, code, startDate, endDate);
        var exact = getCached(key);
        if (exact && exact.dates && exact.dates.length && exact.dates[exact.dates.length - 1] >= endDate) return Promise.resolve(exact);
        var old = findCached(prefix, code, startDate);
        if (old && old.dates[old.dates.length - 1] >= endDate) return Promise.resolve(old);
        var requestStart = old && old.dates && old.dates.length ? addDays(old.dates[old.dates.length - 1], 1) : startDate;
        return fetcher(requestStart, endDate).then(function (fresh) {
            if (!fresh || fresh.error || !fresh.dates || !fresh.dates.length) return fresh;
            var merged = mergeSeries(old, fresh);
            setCache(key, merged);
            return merged;
        });
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
        var ck = cacheKey("hist3", ifindCode, startDate, endDate);
        var cached = getCached(ck);
        if (cached && cached.dates && cached.dates.length > 0) {
            return Promise.resolve(cached);
        }
        var previous = findCached("hist3", ifindCode, startDate);
        if (previous && previous.dates[previous.dates.length - 1] >= endDate) return Promise.resolve(previous);
        var requestStart = previous && previous.dates.length
            ? addDays(previous.dates[previous.dates.length - 1], 1) : startDate;

        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                var raw = Android.fetchIndexHistory(ifindCode, requestStart, endDate);
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
                        setCache(ck, mergeSeries(previous, data));
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
                body: JSON.stringify({ code: ifindCode, start: requestStart, end: endDate }),
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
        var previous = findCached("margin", ifindCode, startDate);
        if (previous && previous.dates[previous.dates.length - 1] >= endDate) return Promise.resolve(previous);
        var requestStart = previous && previous.dates.length
            ? addDays(previous.dates[previous.dates.length - 1], 1) : startDate;

        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                var raw = Android.fetchMargin(ifindCode, requestStart, endDate);
                try {
                    var data = JSON.parse(raw);
                    if (data.error) {
                        resolve({ error: data.error });
                        return;
                    }
                    if (data.dates && data.dates.length > 0) {
                        setCache(ck, mergeSeries(previous, data));
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
                body: JSON.stringify({ code: ifindCode, start: requestStart, end: endDate }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3a. 换手率（iFinD date_sequence: ths_turnover_ratio_index）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取换手率指标
     * @param {string} ifindCode
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>} { dates, turnover_ratio } 或 { dates: [], turnover_ratio: [] }
     */
    function fetchTurnoverRatio(ifindCode, startDate, endDate) {
        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                try {
                    var raw = Android.fetchDateSequence(
                        ifindCode, "ths_turnover_ratio_index", startDate, endDate, null
                    );
                    var data = JSON.parse(raw);
                    if (data.error) {
                        resolve({ dates: [], turnover_ratio: [] });
                        return;
                    }
                    var tables = data.tables || [];
                    if (tables.length === 0 || !tables[0].table) {
                        resolve({ dates: [], turnover_ratio: [] });
                        return;
                    }
                    var tbl = tables[0].table;
                    var vals = tbl["ths_turnover_ratio_index"] || [];
                    var dates = tables[0].time || [];

                    var hasValid = false;
                    var parsed = vals.map(function (v) {
                        if (v === null || v === "null" || (typeof v === "number" && isNaN(v))) return null;
                        hasValid = true;
                        return v;
                    });

                    if (!hasValid) {
                        resolve({ dates: [], turnover_ratio: [] });
                        return;
                    }

                    resolve({ dates: dates, turnover_ratio: parsed });
                } catch (e) {
                    resolve({ dates: [], turnover_ratio: [] });
                }
            });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/turnover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: startDate, end: endDate }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3b. RSI 指标（iFinD date_sequence）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /**
     * 获取 RSI 指标（ths_rsi_index, 参数 [6, 100]）
     * @param {string} ifindCode
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>} { dates, rsi } 或 { dates: [], rsi: [] }
     */
    function fetchRSI(ifindCode, startDate, endDate) {
        if (IS_ANDROID) {
            return new Promise(function (resolve) {
                try {
                    var raw = Android.fetchDateSequence(
                        ifindCode, "ths_rsi_index", startDate, endDate,
                        JSON.stringify(["6", "100"])
                    );
                    var data = JSON.parse(raw);
                    if (data.error) {
                        resolve({ dates: [], rsi: [] });
                        return;
                    }
                    var tables = data.tables || [];
                    if (tables.length === 0 || !tables[0].table) {
                        resolve({ dates: [], rsi: [] });
                        return;
                    }
                    var tbl = tables[0].table;
                    var rsiVals = tbl["ths_rsi_index"] || [];
                    var dates = tables[0].time || [];

                    // 检查是否有有效值
                    var hasValid = false;
                    var parsed = rsiVals.map(function (v) {
                        if (v === null || v === "null" || (typeof v === "number" && isNaN(v))) return null;
                        hasValid = true;
                        return v;
                    });

                    if (!hasValid) {
                        resolve({ dates: [], rsi: [] });
                        return;
                    }

                    resolve({ dates: dates, rsi: parsed });
                } catch (e) {
                    resolve({ dates: [], rsi: [] });
                }
            });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/rsi", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: startDate, end: endDate }),
            }).then(function (r) { return r.json(); });
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Token 管理
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
                        turnover_ratio: null,
                        pe: historyData.pe || [],
                        margin_balance: null,
                        rsi_ifind: null,
                    };

                    // 并行拉取换手率、融资余额和RSI
                    var promises = [];

                    // 换手率必须走 date_sequence（cmd_history_quotation 不返回 TI 概念指数的换手率）
                    promises.push(
                        fetchTurnoverRatio(idxConfig.ifind, startDate, endDate)
                            .then(function (tData) {
                                if (tData && !tData.error && tData.dates && tData.turnover_ratio && tData.dates.length > 0) {
                                    result.turnover_ratio = alignRSIData(
                                        result.dates, tData.dates, tData.turnover_ratio
                                    );
                                }
                            })
                            .catch(function () { /* ignore */ })
                    );

                    if (idxConfig.margin) {
                        promises.push(
                            fetchMargin(idxConfig.ifind, startDate, endDate)
                                .then(function (marginData) {
                                    if (marginData && !marginData.error && marginData.dates && marginData.margin_balance) {
                                        result.margin_balance = alignMarginData(
                                            result.dates, marginData.dates, marginData.margin_balance
                                        );
                                    }
                                })
                                .catch(function () { /* ignore */ })
                        );
                    }

                    // 总是尝试拉取 iFinD RSI
                    promises.push(
                        fetchRSI(idxConfig.ifind, startDate, endDate)
                            .then(function (rsiData) {
                                if (rsiData && !rsiData.error && rsiData.dates && rsiData.rsi && rsiData.dates.length > 0) {
                                    result.rsi_ifind = alignRSIData(result.dates, rsiData.dates, rsiData.rsi);
                                }
                            })
                            .catch(function () { /* ignore */ })
                    );

                    Promise.all(promises).then(function () {
                        resolve(result);
                    });
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
        var lastKnown = null;
        for (var i = 0; i < tradeDates.length; i++) {
            if (marginMap[tradeDates[i]] !== undefined && marginMap[tradeDates[i]] !== null && !isNaN(marginMap[tradeDates[i]])) {
                lastKnown = marginMap[tradeDates[i]];
            }
            aligned[i] = lastKnown;
        }
        return aligned;
    }

    function alignRSIData(tradeDates, rsiDates, rsiValues) {
        var rsiMap = {};
        for (var i = 0; i < rsiDates.length; i++) {
            rsiMap[rsiDates[i]] = rsiValues[i];
        }
        var aligned = new Array(tradeDates.length).fill(null);
        for (var i = 0; i < tradeDates.length; i++) {
            var v = rsiMap[tradeDates[i]];
            if (v !== undefined && v !== null && !isNaN(v)) {
                aligned[i] = v;
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

                // 融资余额未更新时，截止到最近一个有效融资交易日之后一天。
                // 如果勾了 margin 但 iFinD 没返回融资数据，降级为无融资模式
                var filtered = raw;
                var useMargin = idxConfig.margin && filtered.margin_balance &&
                    countNotNull(filtered.margin_balance) >= 1;
                if (useMargin) {
                    var lastMarginIdx = -1;
                    for (var i = filtered.margin_balance.length - 1; i >= 0; i--) {
                        if (filtered.margin_balance[i] !== null && !isNaN(filtered.margin_balance[i])) {
                            lastMarginIdx = i;
                            break;
                        }
                    }
                    if (lastMarginIdx < 0) {
                        useMargin = false;
                        filtered = filterByDate(raw, formatDate(new Date()));
                    } else {
                        filtered = filterByDate(raw, addDays(filtered.dates[lastMarginIdx], 1));
                    }
                } else {
                    filtered = filterByDate(raw, formatDate(new Date()));
                }
                if (!filtered || filtered.dates.length === 0) return null;

                filtered.pe = fillForward(filtered.pe);
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
        result.turnover_ratio = data.turnover_ratio ? indices.map(function (i) { return data.turnover_ratio[i]; }) : null;
        result.pe = data.pe ? indices.map(function (i) { return data.pe[i]; }) : null;
        result.margin_balance = data.margin_balance
            ? indices.map(function (i) { return data.margin_balance[i]; }) : null;
        result.rsi_ifind = data.rsi_ifind
            ? indices.map(function (i) { return data.rsi_ifind[i]; }) : null;
        return result;
    }

    function countNotNull(arr) {
        var count = 0;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== null && !isNaN(arr[i])) count++;
        }
        return count;
    }

    function fillForward(arr) {
        if (!arr || !arr.length) return arr;
        var first = null;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) { first = arr[i]; break; }
        }
        if (first === null) return arr;
        var last = first;
        for (var j = 0; j < arr.length; j++) {
            if (arr[j] !== null && arr[j] !== undefined && !isNaN(arr[j])) last = arr[j];
            else arr[j] = last;
        }
        return arr;
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
    }

    function addDays(dateStr, days) {
        var d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + days);
        return formatDate(d);
    }

    // ━━━ 公开接口 ━━━
    return {
        checkToken: checkToken,
        updateToken: updateToken,
        fetchIndexHistory: fetchIndexHistory,
        fetchMargin: fetchMargin,
        fetchTurnoverRatio: fetchTurnoverRatio,
        fetchRSI: fetchRSI,
        fetchRawData: fetchRawData,
        fetchAndCalculate: fetchAndCalculate,
    };
})();
