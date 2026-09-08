/**
 * 指数拥挤度 - 数据获取模块
 *
 * 两种模式：
 *   Android: 直接调 iFinD API（Java 层处理 token 和 HTTP）
 *   浏览器:  通过 proxy.py 代理（开发模式）
 */

// ━━━ 原生异步桥 ━━━
// MainActivity 的 4 个网络方法已改异步：调用立即返回，结果经
// window.__ifindOnResult(id, json) 回传。这样 JS 主线程不被 152 次网络请求
// 阻塞——刷新期间页面可滑动、进度条能实时更新。
(function () {
    var seq = 0;
    var map = {};
    window.__ifindOnResult = function (id, raw) {
        var h = map[id];
        if (!h) return;
        delete map[id];
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        h(parsed);
    };
    window.__ifindCall = function (method, args) {
        return new Promise(function (resolve) {
            var id = "c" + (++seq);
            map[id] = resolve;
            var a = (args || []).slice();
            a.push(id);
            if (!window.Android || !window.Android[method]) {
                delete map[id];
                resolve(null);
                return;
            }
            try {
                window.Android[method].apply(window.Android, a);
            } catch (e) {
                delete map[id];
                resolve(null);
            }
        });
    };
})();

var Fetch = (function () {
    "use strict";

    var IS_ANDROID = !!(window.Android && window.Android.isAndroid());
    var CACHE_TTL_MS = 5 * 60 * 1000;
    var CACHE_OVERLAP_DAYS = 10;
    // 原生文件缓存：Android 端历史序列（每指数每序列可达2年）远超 localStorage 配额，
    // 落盘后刷新才能真正增量（只拉尾段），否则配额满→清缓存→反复整段重下。
    var HAS_NATIVE_CACHE = !!(window.Android && window.Android.cacheRead &&
        window.Android.cacheWrite && window.Android.cacheKeys && window.Android.cacheRemove);

    // ━━━ 存储后端（Android=文件 / 其余=localStorage）━━━
    function rawGet(key) {
        try {
            if (HAS_NATIVE_CACHE) {
                var s = Android.cacheRead(key);
                if (!s) return null;
                return JSON.parse(s);
            }
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function pruneSiblings(key) {
        // 键内含日期区间（ifind_<prefix>_<code>_<start>_<end>），起始日期每天顺移会积累大量旧键。
        // 每次写完仅保留本键（含合并后的全量历史），删掉同(prefix,code)的旧键，避免文件缓存无限增长。
        try {
            var m = key.match(/^(.*?)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/);
            if (!m) return;
            var base = m[1];
            var keys = JSON.parse(Android.cacheKeys(base) || "[]");
            for (var i = 0; i < keys.length; i++) {
                if (keys[i] !== key) Android.cacheRemove(keys[i]);
            }
        } catch (e) { /* ignore */ }
    }

    function rawSet(key, data) {
        try {
            if (HAS_NATIVE_CACHE) {
                Android.cacheWrite(key, JSON.stringify(data));
                pruneSiblings(key);
                return;
            }
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            // 写入失败仅清理本键，不再删一半缓存（避免反复整段重下）
            try {
                if (HAS_NATIVE_CACHE) Android.cacheRemove(key);
                else localStorage.removeItem(key);
            } catch (e2) { /* ignore */ }
        }
    }

    function rawKeys(prefix) {
        var out = [];
        try {
            if (HAS_NATIVE_CACHE) {
                return JSON.parse(Android.cacheKeys(prefix) || "[]");
            }
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(prefix) === 0) out.push(k);
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    function rawRemove(key) {
        try {
            if (HAS_NATIVE_CACHE) Android.cacheRemove(key);
            else localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // localStorage 缓存
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function cacheKey(prefix, code, start, end) {
        return "ifind_" + prefix + "_" + code + "_" + start + "_" + end;
    }

    function getCached(key) {
        return rawGet(key);
    }

    function setCache(key, data) {
        rawSet(key, data);
    }

    function findCached(prefix, code, startDate) {
        var best = null;
        var base = "ifind_" + prefix + "_" + code + "_";
        var keys = rawKeys(base);
        for (var i = 0; i < keys.length; i++) {
            var item = rawGet(keys[i]);
            if (!item || !item.dates || !item.dates.length) continue;
            if (item.dates[0] <= startDate && (!best || item.dates[item.dates.length - 1] > best.dates[best.dates.length - 1])) best = item;
        }
        return best;
    }

    function mergeSeries(oldData, newData) {
        if (!oldData || !oldData.dates || !oldData.dates.length) return newData;
        if (!newData || !newData.dates || !newData.dates.length) return oldData;
        var out = {};
        var dateSet = {};
        oldData.dates.forEach(function (date) { dateSet[date] = true; });
        newData.dates.forEach(function (date) { dateSet[date] = true; });
        var dates = Object.keys(dateSet).sort();
        var arrayKeys = {};
        Object.keys(oldData).forEach(function (key) {
            if (key !== "dates" && Array.isArray(oldData[key])) arrayKeys[key] = true;
            else if (!Array.isArray(oldData[key])) out[key] = oldData[key];
        });
        Object.keys(newData).forEach(function (key) {
            if (key !== "dates" && Array.isArray(newData[key])) arrayKeys[key] = true;
            else if (!Array.isArray(newData[key])) out[key] = newData[key];
        });
        out.dates = dates;
        Object.keys(arrayKeys).forEach(function (key) {
            var values = {};
            if (Array.isArray(oldData[key])) {
                oldData.dates.forEach(function (date, index) { values[date] = oldData[key][index]; });
            }
            if (Array.isArray(newData[key])) {
                newData.dates.forEach(function (date, index) { values[date] = newData[key][index]; });
            }
            out[key] = dates.map(function (date) {
                return Object.prototype.hasOwnProperty.call(values, date) ? values[date] : null;
            });
        });
        return out;
    }

    function cachedRangeFetch(prefix, code, startDate, endDate, fetcher) {
        var key = cacheKey(prefix, code, startDate, endDate);
        var exact = getCached(key);
        if (exact && exact.dates && exact.dates.length && exact._cachedAt &&
            Date.now() - exact._cachedAt < CACHE_TTL_MS) return Promise.resolve(exact);
        var old = exact || findCached(prefix, code, startDate);
        var requestStart = old && old.dates && old.dates.length
            ? addDays(old.dates[old.dates.length - 1], -CACHE_OVERLAP_DAYS) : startDate;
        if (requestStart < startDate) requestStart = startDate;
        return fetcher(requestStart, endDate).then(function (fresh) {
            if (!fresh || fresh.error || !fresh.dates || !fresh.dates.length) return fresh;
            var merged = mergeSeries(old, fresh);
            merged._cachedAt = Date.now();
            setCache(key, merged);
            return merged;
        });
    }

    function clearOldCache() {
        try {
            var keys = rawKeys("ifind_");
            keys.sort();
            for (var j = 0; j < Math.floor(keys.length / 2); j++) {
                rawRemove(keys[j]);
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
        var ck = cacheKey("hist4", ifindCode, startDate, endDate);
        var cached = getCached(ck);
        if (cached && cached.dates && cached.dates.length > 0 && cached._cachedAt &&
            Date.now() - cached._cachedAt < CACHE_TTL_MS) {
            return Promise.resolve(cached);
        }
        var previous = cached || findCached("hist4", ifindCode, startDate);
        var requestStart = previous && previous.dates.length
            ? addDays(previous.dates[previous.dates.length - 1], -CACHE_OVERLAP_DAYS) : startDate;
        if (requestStart < startDate) requestStart = startDate;

        if (IS_ANDROID && window.__ifindCall) {
            return window.__ifindCall("fetchIndexHistory", [ifindCode, requestStart, endDate])
                .then(function (data) {
                    if (!data) return { error: "无响应" };
                    if (data.error) return data;
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
                        data = mergeSeries(previous, data);
                        data._cachedAt = Date.now();
                        setCache(ck, data);
                    }
                    return data;
                });
        } else {
            // 浏览器模式：走 proxy
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/index_history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: requestStart, end: endDate }),
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (!data || data.error || !data.dates || !data.dates.length) return data;
                var merged = mergeSeries(previous, data);
                merged._cachedAt = Date.now();
                setCache(ck, merged);
                return merged;
            });
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
        var ck = cacheKey("margin2", ifindCode, startDate, endDate);
        var cached = getCached(ck);
        if (cached && cached.dates && cached.dates.length > 0 && cached._cachedAt &&
            Date.now() - cached._cachedAt < CACHE_TTL_MS) {
            return Promise.resolve(cached);
        }
        var previous = cached || findCached("margin2", ifindCode, startDate);
        var requestStart = previous && previous.dates.length
            ? addDays(previous.dates[previous.dates.length - 1], -CACHE_OVERLAP_DAYS) : startDate;
        if (requestStart < startDate) requestStart = startDate;

        if (IS_ANDROID && window.__ifindCall) {
            return window.__ifindCall("fetchMargin", [ifindCode, requestStart, endDate])
                .then(function (data) {
                    if (!data) return { error: "无响应" };
                    if (data.error) return data;
                    if (data.dates && data.dates.length > 0) {
                        data = mergeSeries(previous, data);
                        data._cachedAt = Date.now();
                        setCache(ck, data);
                    }
                    return data;
                });
        } else {
            return fetch(AppConfig.PROXY_BASE + "/api/proxy/margin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: ifindCode, start: requestStart, end: endDate }),
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (!data || data.error || !data.dates || !data.dates.length) return data;
                var merged = mergeSeries(previous, data);
                merged._cachedAt = Date.now();
                setCache(ck, merged);
                return merged;
            });
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
        return cachedRangeFetch("turnover2", ifindCode, startDate, endDate,
            function (requestStart, requestEnd) {
                if (IS_ANDROID && window.__ifindCall) {
                    return window.__ifindCall("fetchDateSequence",
                        [ifindCode, "ths_turnover_ratio_index", requestStart, requestEnd, null])
                        .then(function (data) {
                            if (!data || data.error) return { dates: [], turnover_ratio: [] };
                            var tables = data.tables || [];
                            if (tables.length === 0 || !tables[0].table) {
                                return { dates: [], turnover_ratio: [] };
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
                            if (!hasValid) return { dates: [], turnover_ratio: [] };
                            return { dates: dates, turnover_ratio: parsed };
                        });
                }
                return fetch(AppConfig.PROXY_BASE + "/api/proxy/turnover", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: ifindCode, start: requestStart, end: requestEnd }),
                }).then(function (r) { return r.json(); });
            });
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
        return cachedRangeFetch("rsi2", ifindCode, startDate, endDate,
            function (requestStart, requestEnd) {
                if (IS_ANDROID && window.__ifindCall) {
                    return window.__ifindCall("fetchDateSequence",
                        [ifindCode, "ths_rsi_index", requestStart, requestEnd,
                        JSON.stringify(["6", "100"])])
                        .then(function (data) {
                            if (!data || data.error) return { dates: [], rsi: [] };
                            var tables = data.tables || [];
                            if (tables.length === 0 || !tables[0].table) {
                                return { dates: [], rsi: [] };
                            }
                            var tbl = tables[0].table;
                            var rsiVals = tbl["ths_rsi_index"] || [];
                            var dates = tables[0].time || [];
                            var hasValid = false;
                            var parsed = rsiVals.map(function (v) {
                                if (v === null || v === "null" || (typeof v === "number" && isNaN(v))) return null;
                                hasValid = true;
                                return v;
                            });
                            if (!hasValid) return { dates: [], rsi: [] };
                            return { dates: dates, rsi: parsed };
                        });
                }
                return fetch(AppConfig.PROXY_BASE + "/api/proxy/rsi", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: ifindCode, start: requestStart, end: requestEnd }),
                }).then(function (r) { return r.json(); });
            });
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
        for (var i = 0; i < tradeDates.length; i++) {
            var value = marginMap[tradeDates[i]];
            if (value !== undefined && value !== null && !isNaN(value)) {
                aligned[i] = value;
            }
        }
        return rejectMarginOutliers(aligned);
    }

    function rejectMarginOutliers(values) {
        var cleaned = values.slice();
        for (var i = 1; i < values.length; i++) {
            var previous = values[i - 1];
            var current = values[i];
            if (previous === null || current === null || previous === 0) continue;
            if (Math.abs(current / previous - 1) <= 0.2) continue;
            var next = null;
            for (var j = i + 1; j < values.length; j++) {
                if (values[j] !== null && !isNaN(values[j])) { next = values[j]; break; }
            }
            if (next === null || Math.abs(next / previous - 1) < 0.1) {
                cleaned[i] = null;
            }
        }
        return cleaned;
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
     * 获取单个指数数据并计算全部指标和指数拥挤度
     * @param {Object} idxConfig
     * @param {string} startDate
     * @param {string} endDate
     * @returns {Promise<Object>}
     */
    function fetchAndCalculate(idxConfig, startDate, endDate) {
        return fetchRawData(idxConfig, startDate, endDate)
            .then(function (raw) {
                if (!raw || !validateRawData(raw)) return null;

                // 先剔除尚未完成 T+1 披露的市场日期，再按真实融资日期收口。
                var filtered = filterByDate(raw, stableCutoffDate());
                if (!filtered) return null;
                var useMargin = !!idxConfig.margin;
                if (useMargin) {
                    if (!filtered.margin_balance || countNotNull(filtered.margin_balance) < 2) return null;
                    var lastMarginIdx = -1;
                    for (var i = filtered.margin_balance.length - 1; i >= 0; i--) {
                        if (filtered.margin_balance[i] !== null && !isNaN(filtered.margin_balance[i])) {
                            lastMarginIdx = i;
                            break;
                        }
                    }
                    if (lastMarginIdx < 0) return null;
                    filtered = filterByDate(filtered, addDays(filtered.dates[lastMarginIdx], 1));
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

    function validateRawData(raw) {
        if (!raw.dates || raw.dates.length < 2) return false;
        var length = raw.dates.length;
        var required = [raw.close, raw.amount, raw.turnover_ratio, raw.pe];
        for (var i = 0; i < required.length; i++) {
            if (!Array.isArray(required[i]) || required[i].length !== length) return false;
        }
        for (var j = 0; j < length; j++) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.dates[j])) return false;
            if (j > 0 && raw.dates[j] <= raw.dates[j - 1]) return false;
        }
        return true;
    }

    function stableCutoffDate() {
        var date = new Date();
        var day = date.getDay();
        if (day === 6) date.setDate(date.getDate() - 1);
        else if (day === 0) date.setDate(date.getDate() - 2);
        return formatDate(date);
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
