/**
 * A股市场温度计 - 主应用逻辑
 *
 * Android: 直接调 iFinD API，完全本地运行
 * 浏览器: 通过 proxy.py 代理（开发模式）
 */

var App = (function () {
    "use strict";

    // ━━━ 状态 ━━━
    var DATA = {};          // code -> index data
    var CURRENT_TAB = "home";
    var DETAIL_CHART = null;
    var DATA_CHARTS = {};
    var CHART_DATA = null;
    var CHART_DATA_LOADING = null;
    var CHART_DATA_TIME = 0;
    var CHART_DATA_TTL = 5 * 60 * 1000; // 5分钟内不重复请求
    var CHART_RANGES = {};
    var DETAIL_CODE = null;
    var MARGIN_SORT_KEY = "date";
    var MARGIN_SORT_ASC = false; // 默认日期倒序（最新在前）
    var POSTER_LAYOUT_KEY = "a_stock_poster_layout_v1";
    var POSTER_EDITING = false;
    var ACTIVE_CHART_LANDSCAPE = null;
    var SELECTED_DATE = null;  // 日期回溯：选中的日期，null=最新
    var DATA_CACHE_KEY = "a_stock_data_snapshot_v5";
    var REFRESH_IN_PROGRESS = false;
    var HAMMER_MANAGERS = [];  // chartjs-plugin-zoom 两指平移用的 Hammer 实例

    // ━━━ 配置管理 ━━━
    var SK = "a_stock_cfg_v6";
    var cfg = loadCfg();

    function loadCfg() {
        try {
            var s = localStorage.getItem(SK);
            if (s) {
                var c = JSON.parse(s);
                if (c.en && c.ord) return c;
            }
        } catch (e) { /* ignore */ }
        var allCodes = AppConfig.INDEXES.map(function (x) { return x.code; });
        return {
            en: allCodes.slice(),
            ord: allCodes.slice(),
            extremeEn: allCodes.slice(),  // 极端板块海报可选名单
        };
    }

    function vis() {
        return cfg.ord
            .filter(function (c) { return cfg.en.indexOf(c) >= 0; })
            .map(function (c) { return AppConfig.getIndexByCode(c); })
            .filter(Boolean);
    }

    // 极端板块专属可见列表
    function extremeVis() {
        return vis().filter(function (x) {
            return (cfg.extremeEn || []).indexOf(x.code) >= 0;
        });
    }

    // ━━━ 时钟 ━━━
    function tickClock() {
        var el = document.getElementById("clock");
        if (el) {
            var d = new Date();
            el.textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
        }
    }

    // ━━━ 日期工具 ━━━
    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
    }

    function formatDateCN(dateStr) {
        var parts = dateStr.split("-");
        return parseInt(parts[1]) + "月" + parseInt(parts[2]) + "日";
    }

    function formatDateFullCN(dateStr) {
        var parts = dateStr.split("-");
        return parts[0] + "年" + parseInt(parts[1]) + "月" + parseInt(parts[2]) + "日";
    }

    // 从已加载数据中获取最新交易日（所有指数的 allDates 最新值）
    function latestDataDateStr() {
        if (SELECTED_DATE) return SELECTED_DATE;
        var latest = "";
        var earliestLatest = "";
        for (var code in DATA) {
            if (!DATA.hasOwnProperty(code)) continue;
            var dd = DATA[code];
            if (dd && dd.allDates && dd.allDates.length > 0) {
                var lastIndex = dd.allDates.length - 1;
                while (lastIndex >= 0 && dd.allScores && dd.allScores[lastIndex] === null) lastIndex--;
                if (lastIndex < 0) continue;
                var last = dd.allDates[lastIndex];
                if (last > latest) latest = last;
                if (!earliestLatest || last < earliestLatest) earliestLatest = last;
            }
        }
        return earliestLatest || latest || getLatestTradeDate();
    }

    function getLatestTradeDate() {
        var d = new Date();
        // T-1: 工作日往前1天，周末往前到周五
        var dow = d.getDay();
        if (dow === 0) d.setDate(d.getDate() - 2);      // 周日→周五
        else if (dow === 6) d.setDate(d.getDate() - 1); // 周六→周五
        else d.setDate(d.getDate() - 1);                 // 工作日→昨天
        if (d.getDay() === 0 || d.getDay() === 6) {
            // 二次检查（跨年后等情况）
            while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        }
        return formatDate(d);
    }

    function previousTradeDate(dateStr) {
        var d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() - 1);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        return formatDate(d);
    }

    function dataNeedsRefresh(current) {
        for (var i = 0; i < AppConfig.INDEXES.length; i++) {
            var idx = AppConfig.INDEXES[i];
            var item = DATA[idx.code];
            if (!item || !item.allDates || !item.allDates.length) return true;
            var validIndex = item.allDates.length - 1;
            while (validIndex >= 0 && item.allScores && item.allScores[validIndex] === null) validIndex--;
            var target = idx.margin ? previousTradeDate(current) : current;
            if (validIndex < 0 || item.allDates[validIndex] < target) return true;
        }
        return false;
    }

    function findClosestTradeIdx(dates, targetDate) {
        var idx = -1;
        for (var i = 0; i < dates.length; i++) {
            if (dates[i] > targetDate) break;
            idx = i;
        }
        return idx;
    }

    function commonDataDate(targetDate) {
        var result = targetDate || "9999-12-31";
        var found = false;
        for (var i = 0; i < AppConfig.INDEXES.length; i++) {
            var item = DATA[AppConfig.INDEXES[i].code];
            if (!item || !item.allDates || !item.allDates.length) continue;
            var index = findClosestTradeIdx(item.allDates, result);
            while (index >= 0 && item.allScores && item.allScores[index] === null) index--;
            if (index < 0) return null;
            var date = item.allDates[index];
            if (date < result) result = date;
            found = true;
        }
        return found && result !== "9999-12-31" ? result : null;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 数据加载（前端本地计算）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function loadDataSnapshot() {
        try {
            var raw = localStorage.getItem(DATA_CACHE_KEY);
            if (!raw) return false;
            var snapshot = JSON.parse(raw);
            if (!snapshot || snapshot.version !== 1 || !snapshot.data) return false;
            var codes = Object.keys(snapshot.data);
            if (!codes.length) return false;
            DATA = snapshot.data;
            return true;
        } catch (e) {
            return false;
        }
    }

    function saveDataSnapshot() {
        if (!Object.keys(DATA).length) return;
        try {
            localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
                version: 1,
                savedAt: Date.now(),
                data: DATA,
            }));
        } catch (e) {
            // 快照过大时保留原始接口缓存，不影响本次展示。
        }
    }

    function clearDataSnapshot() {
        try { localStorage.removeItem(DATA_CACHE_KEY); } catch (e) { /* ignore */ }
    }

    function renderCachedData() {
        showLoading(false);
        updateDatePickerMax();
        renderAll();
        if (CURRENT_TAB === "data" && CHART_DATA) renderDataCharts();
    }

    function fetchLocal(force) {
        force = !!force;
        var hasData = Object.keys(DATA).length > 0;
        var latest = hasData ? latestDataDateStr() : "";
        var current = getLatestTradeDate();

        if (hasData) {
            renderCachedData();
            if (!force && !dataNeedsRefresh(current)) return;
            if (!force) showToast("已显示历史结果，正在后台检查更新");
        } else {
            showLoading(true);
        }

        if (REFRESH_IN_PROGRESS) return;
        REFRESH_IN_PROGRESS = true;

        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 365 * 2 - 30);
        var start = formatDate(startDate);
        var end = formatDate(new Date());

        var indexes = AppConfig.INDEXES;
        var completed = 0;
        var total = indexes.length;
        var errors = [];

        function onDone() {
            completed++;
            updateLoadingProgress(completed, total);
            if (completed >= total) {
                REFRESH_IN_PROGRESS = false;
                showLoading(false);
                SELECTED_DATE = null;
                updateDatePickerMax();
                renderAll();
                saveDataSnapshot();
                if (CURRENT_TAB === "data" && CHART_DATA) renderDataCharts();
                if (errors.length > 0) {
                    console.warn("数据获取警告:", errors);
                    if (force) showToast("数据更新完成，部分指数暂无新数据");
                } else if (force) {
                    showToast("市场数据已更新");
                }
            }
        }

        indexes.forEach(function (idx) {
            Fetch.fetchAndCalculate(idx, start, end)
                .then(function (data) {
                    if (data) {
                        DATA[idx.code] = buildIndexResult(data, idx);
                    } else {
                        errors.push(idx.code + ": 无数据");
                    }
                    onDone();
                })
                .catch(function (err) {
                    errors.push(idx.code + ": " + err.message);
                    onDone();
                });
        });
    }

    function buildIndexResult(data, idxConfig) {
        var n = data.close.length;

        var validIdx = n - 1;
        for (var i = n - 1; i >= 0; i--) {
            if (data.data_ok[i]) { validIdx = i; break; }
        }

        var score = data.market_score_low_freq[validIdx];
        var scoreRounded = score !== null ? Math.round(score * 100) : 0;
        var state = AppConfig.getMarketState(score);
        var emo = AppConfig.getEmotion(scoreRounded);

        var ranks = {
            close: data.rank_close[validIdx] !== null ? Math.round(data.rank_close[validIdx] * 100) : 0,
            turnover: data.rank_turnover[validIdx] !== null ? Math.round(data.rank_turnover[validIdx] * 100) : 0,
            pe: data.rank_pe[validIdx] !== null ? Math.round(data.rank_pe[validIdx] * 100) : 0,
            rsi: data.rank_rsi[validIdx] !== null ? Math.round(data.rank_rsi[validIdx] * 100) : 0,
        };
        if (data.rank_margin && data.rank_margin[validIdx] !== null) {
            ranks.margin = Math.round(data.rank_margin[validIdx] * 100);
        }

        var allDates = data.dates.slice();
        var allScores = data.market_score_low_freq.map(function (s) {
            return s !== null ? Math.round(s * 100) : null;
        });
        var allCloses = data.close.map(function (c) {
            return c !== null ? Math.round(c * 100) / 100 : null;
        });
        var allRet = data.daily_return ? data.daily_return.map(function (r) {
            return r !== null ? Math.round(r * 100) / 100 : null;
        }) : null;

        var chartLen = Math.min(180, n);
        var startIdx = n - chartLen;
        var dates180 = allDates.slice(startIdx);
        var scores180 = allScores.slice(startIdx);
        var closes180 = allCloses.slice(startIdx);

        return {
            code: idxConfig.code,
            display: idxConfig.display,
            group: idxConfig.group,
            score: scoreRounded,
            state: state.name,
            stateColor: state.color,
            emotion: emo.label,
            emotionColor: emo.color,
            close: data.close[validIdx] ? Math.round(data.close[validIdx] * 100) / 100 : 0,
            ret: data.daily_return && data.daily_return[validIdx] ? Math.round(data.daily_return[validIdx] * 100) / 100 : 0,
            rsi: data.RSI[validIdx] ? Math.round(data.RSI[validIdx] * 10) / 10 : 0,
            pe: data.pe && data.pe[validIdx] ? Math.round(data.pe[validIdx] * 100) / 100 : 0,
            amount: data.amount && data.amount[validIdx] ? Math.round(data.amount[validIdx] * 100) / 100 : 0,
            ma5: data.MA5[validIdx] ? Math.round(data.MA5[validIdx] * 100) / 100 : 0,
            ma20: data.MA20[validIdx] ? Math.round(data.MA20[validIdx] * 100) / 100 : 0,
            ma60: data.MA60[validIdx] ? Math.round(data.MA60[validIdx] * 100) / 100 : 0,
            ranks: ranks,
            validIdx: validIdx,
            allDates: allDates,
            allScores: allScores,
            allCloses: allCloses,
            allRet: allRet,
            dates: dates180,
            scores: scores180,
            closes: closes180,
        };
    }

    function getDataForDate(idxData, targetDate) {
        if (!targetDate) return idxData;
        var i = findClosestTradeIdx(idxData.allDates, targetDate);
        while (i >= 0 && idxData.allScores && idxData.allScores[i] === null) i--;
        if (i < 0) {
            return {
                code: idxData.code, display: idxData.display, group: idxData.group,
                score: null, state: "暂无数据", stateColor: "#86868B", emotion: "暂无温度", emotionColor: "#86868B",
                close: null, ret: null, rsi: null, pe: null, amount: null, ma5: null, ma20: null, ma60: null,
                ranks: {}, allDates: idxData.allDates, allScores: idxData.allScores,
                allCloses: idxData.allCloses, allRet: idxData.allRet, dates: idxData.dates,
                scores: idxData.scores, closes: idxData.closes,
            };
        }

        var score = idxData.allScores[i];
        var scoreRounded = score !== null && score !== undefined ? score : null;
        var emo = scoreRounded === null ? { label: "暂无温度", color: "#86868B" } : AppConfig.getEmotion(scoreRounded);

        return {
            code: idxData.code,
            display: idxData.display,
            group: idxData.group,
            score: scoreRounded,
            state: scoreRounded === null ? "暂无数据" : AppConfig.getMarketState(scoreRounded / 100).name,
            stateColor: scoreRounded === null ? "#86868B" : AppConfig.getMarketState(scoreRounded / 100).color,
            emotion: emo.label,
            emotionColor: emo.color,
            close: idxData.allCloses[i] || 0,
            ret: idxData.allRet ? (idxData.allRet[i] !== null ? idxData.allRet[i] : null) : null,
            rsi: null, pe: null, amount: null,
            ma5: null, ma20: null, ma60: null,
            ranks: {},
            allDates: idxData.allDates,
            allScores: idxData.allScores,
            allCloses: idxData.allCloses,
            allRet: idxData.allRet,
            dates: idxData.dates,
            scores: idxData.scores,
            closes: idxData.closes,
        };
    }

    function getDisplayData(code) {
        var d = DATA[code];
        if (!d) return null;
        if (SELECTED_DATE) return getDataForDate(d, SELECTED_DATE);
        return d;
    }

    // ━━━ 日期回溯 ━━━
    function updateDatePickerMax() {
        var el = document.getElementById("datePicker");
        if (el) {
            el.max = commonDataDate(getLatestTradeDate()) || formatDate(new Date());
            el.value = "";
        }
    }

    function onDateChange() {
        var el = document.getElementById("datePicker");
        var displayEl = document.getElementById("backtrackInfo");
        var clearBtn = document.getElementById("clearDateBtn");
        if (!el || !displayEl) return;

        var val = el.value;
        if (val) {
            SELECTED_DATE = commonDataDate(val) || val;
            el.value = SELECTED_DATE;
            displayEl.textContent = "回溯至: " + formatDateCN(SELECTED_DATE);
            displayEl.style.display = "inline";
            if (clearBtn) clearBtn.classList.add("show");
        } else {
            SELECTED_DATE = null;
            displayEl.style.display = "none";
            if (clearBtn) clearBtn.classList.remove("show");
        }
        renderPosters();
        renderAllPage();
    }

    function clearDateFilter() {
        SELECTED_DATE = null;
        var el = document.getElementById("datePicker");
        if (el) el.value = "";
        var displayEl = document.getElementById("backtrackInfo");
        if (displayEl) displayEl.style.display = "none";
        var clearBtn = document.getElementById("clearDateBtn");
        if (clearBtn) clearBtn.classList.remove("show");
        renderPosters();
        renderAllPage();
    }

    function getDisplayDateStr() {
        return formatDateFullCN(latestDataDateStr());
    }

    function updateMarginNotice() {
        var notices = [
            document.getElementById("marginNotice"),
            document.getElementById("allMarginNotice"),
        ];
        var current = getLatestTradeDate();
        var show = !SELECTED_DATE && dataNeedsRefresh(current);

        notices.forEach(function (el) {
            if (!el) return;
            el.style.display = show ? "block" : "none";
            el.innerHTML = show ? "<strong>融资余额未更新</strong>，今日温度暂不出值。" : "";
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 极端板块检测：以最新交易日为起点，近5个交易日全部满足条件才纳入
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function findExtremeSectors() {
        var all = extremeVis();
        var extreme = { cold: [], hot: [] };

        all.forEach(function (x) {
            if (!DATA[x.code]) return;
            var d = getDisplayData(x.code);
            if (!d || !d.allScores || d.allScores.length < 5) return;
            var scores = d.allScores;
            var latest5 = scores.slice(-5);
            var validScores = latest5.filter(function (s) { return s !== null; });
            if (validScores.length < 5) return;

            var allLow = validScores.every(function (s) { return s < 10; });
            var allHigh = validScores.every(function (s) { return s > 90; });

            if (allLow) {
                var si = scores.length - 5;
                var last5 = [];
                for (var i = si; i < scores.length && i < d.allDates.length; i++) {
                    last5.push({ date: d.allDates[i], score: scores[i] });
                }
                extreme.cold.push({ config: x, data: d, streak: last5 });
            }
            if (allHigh) {
                var siH = scores.length - 5;
                var last5H = [];
                for (var j = siH; j < scores.length && j < d.allDates.length; j++) {
                    last5H.push({ date: d.allDates[j], score: scores[j] });
                }
                extreme.hot.push({ config: x, data: d, streak: last5H });
            }
        });

        return extreme;
    }

    // 扫描全部28个指数（不受extremeEn限制），返回code数组供设置面板用
    function findExtremeSectorsAll() {
        var all = vis();
        var coldAll = [], hotAll = [];

        all.forEach(function (x) {
            if (!DATA[x.code]) return;
            var d = getDisplayData(x.code);
            if (!d || !d.allScores || d.allScores.length < 5) return;
            var scores = d.allScores;
            var latest5 = scores.slice(-5);
            var validScores = latest5.filter(function (s) { return s !== null; });
            if (validScores.length < 5) return;

            if (validScores.every(function (s) { return s < 10; })) coldAll.push(x.code);
            if (validScores.every(function (s) { return s > 90; })) hotAll.push(x.code);
        });

        return { coldAll: coldAll, hotAll: hotAll };
    }

    // 色阶映射（0=蓝→100=红）
    function tempColor(score) {
        if (score === null || score === undefined) return "#E5E5EA";
        // 使用情绪色
        return AppConfig.getEmotion(score).color;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 渲染
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function renderAll() {
        ensurePosterLayout();
        renderPosters();
        renderAllPage();
    }

    function readPosterLayout() {
        try {
            var saved = JSON.parse(localStorage.getItem(POSTER_LAYOUT_KEY) || "null");
            return saved && saved.order ? saved : { order: [], collapsed: {} };
        } catch (e) {
            return { order: [], collapsed: {} };
        }
    }

    function savePosterLayout() {
        var items = Array.prototype.slice.call(document.querySelectorAll("#pageHome > .poster-item"));
        var collapsed = {};
        items.forEach(function (item) { collapsed[item.getAttribute("data-poster-id")] = item.classList.contains("is-collapsed"); });
        try {
            localStorage.setItem(POSTER_LAYOUT_KEY, JSON.stringify({
                order: items.map(function (item) { return item.getAttribute("data-poster-id"); }),
                collapsed: collapsed,
            }));
        } catch (e) { /* ignore storage errors */ }
    }

    function ensurePosterLayout() {
        var page = document.getElementById("pageHome");
        if (!page) return;
        var ids = ["posterLight", "posterCombined", "posterSector", "posterSmart", "posterExtremeCold", "posterExtremeHot"];
        ids.forEach(function (id) {
            var card = document.getElementById(id);
            if (!card || card.parentElement.classList.contains("poster-item")) return;
            var download = card.nextElementSibling;
            var wrapper = document.createElement("section");
            wrapper.className = "poster-item";
            wrapper.setAttribute("data-poster-id", id);
            card.parentElement.insertBefore(wrapper, card);
            var tools = document.createElement("div");
            tools.className = "poster-tools";
            tools.innerHTML = '<button type="button" class="poster-up" title="海报上移" aria-label="海报上移">↑</button>' +
                '<button type="button" class="poster-down" title="海报下移" aria-label="海报下移">↓</button>' +
                '<button type="button" class="poster-collapse" title="折叠海报" aria-label="折叠海报" aria-expanded="true">⌃</button>';
            tools.querySelector(".poster-up").onclick = function () { movePoster(id, -1); };
            tools.querySelector(".poster-down").onclick = function () { movePoster(id, 1); };
            tools.querySelector(".poster-collapse").onclick = function () { togglePoster(id); };
            wrapper.appendChild(tools);
            wrapper.appendChild(card);
            if (download && download.classList.contains("dl-btn")) wrapper.appendChild(download);
        });

        var saved = readPosterLayout();
        var wrappers = {};
        Array.prototype.slice.call(page.children).filter(function (item) {
            return item.classList && item.classList.contains("poster-item");
        }).forEach(function (item) {
            wrappers[item.getAttribute("data-poster-id")] = item;
        });
        var order = saved.order.filter(function (id) { return wrappers[id]; });
        ids.forEach(function (id) { if (order.indexOf(id) < 0 && wrappers[id]) order.push(id); });
        order.forEach(function (id) { page.appendChild(wrappers[id]); });
        order.forEach(function (id, index) {
            var item = wrappers[id];
            var collapsed = !!(saved.collapsed && saved.collapsed[id]);
            item.classList.toggle("is-collapsed", collapsed);
            item.querySelector(".poster-collapse").textContent = collapsed ? "⌄" : "⌃";
            item.querySelector(".poster-collapse").setAttribute("aria-expanded", collapsed ? "false" : "true");
            item.querySelector(".poster-collapse").setAttribute("title", collapsed ? "展开海报" : "折叠海报");
            item.querySelector(".poster-up").disabled = index === 0;
            item.querySelector(".poster-down").disabled = index === order.length - 1;
        });
    }

    function movePoster(id, direction) {
        ensurePosterLayout();
        var item = document.querySelector('#pageHome > .poster-item[data-poster-id="' + id + '"]');
        if (!item) return;
        var items = Array.prototype.slice.call(document.querySelectorAll("#pageHome > .poster-item"));
        var index = items.indexOf(item);
        var target = items[index + direction];
        if (!target) return;
        if (direction < 0) item.parentElement.insertBefore(item, target);
        else item.parentElement.insertBefore(target, item);
        savePosterLayout();
        ensurePosterLayout();
    }

    function togglePoster(id) {
        ensurePosterLayout();
        var item = document.querySelector('#pageHome > .poster-item[data-poster-id="' + id + '"]');
        if (!item) return;
        item.classList.toggle("is-collapsed");
        savePosterLayout();
        ensurePosterLayout();
    }

    function togglePosterEdit() {
        POSTER_EDITING = !POSTER_EDITING;
        var page = document.getElementById("pageHome");
        var button = document.getElementById("posterEditBtn");
        if (page) page.classList.toggle("poster-editing", POSTER_EDITING);
        if (button) {
            button.textContent = POSTER_EDITING ? "完成" : "✎ 编辑";
            button.title = POSTER_EDITING ? "完成海报编辑" : "编辑海报布局";
            button.setAttribute("aria-label", button.title);
        }
    }

    function resetPosterLayout() {
        try { localStorage.removeItem(POSTER_LAYOUT_KEY); } catch (e) { /* ignore */ }
        window.location.reload();
    }

    function renderPosters() {
        var v = vis();
        var ds = getDisplayDateStr();
        var extreme = findExtremeSectors();

        updateMarginNotice();
        setText("homeDate", ds);
        ["posterDate2", "posterDate3", "posterDate4", "posterDate5", "posterDate6", "posterDate7"].forEach(function (id) {
            setText(id, ds);
        });

        // 主要指数仍在合并海报中展示，主页不再单独保留一张主要指数海报。
        var mainV = v.filter(function (x) { return x.group === "main" && DATA[x.code]; });
        // 海报：站在光里
        var lightV = v.filter(function (x) { return x.group === "light" && DATA[x.code]; })
            .sort(function (a, b) {
                var da = getDisplayData(a.code), db = getDisplayData(b.code);
                return (da ? da.score : 0) - (db ? db.score : 0);
            });
        document.getElementById("lightGrid").innerHTML = renderBlockGridHtml(lightV);

        // 海报3：主要指数+主题行业 合并
        var secV = v.filter(function (x) { return x.group === "sector" && DATA[x.code]; })
            .sort(function (a, b) {
                var da = getDisplayData(a.code), db = getDisplayData(b.code);
                return (da ? da.score : 0) - (db ? db.score : 0);
            });
        document.getElementById("combinedMainGrid").innerHTML = mainV.map(function (x) {
            var d = getDisplayData(x.code);
            if (!d) return '';
            var ec = d.emotionColor || "#34C759";
            var tc = (ec === "#5AC8FA" || ec === "#34C759") ? "dt" : "lt";
            return '<div class="g-block ' + tc + '" style="background:' + ec + '" onclick="App.showDetail(\'' + x.code + '\')"><div class="bn">' + x.display + '</div><div class="bt">' + d.score + '</div></div>';
        }).join("");
        document.getElementById("combinedSectorGrid").innerHTML = renderBlockGridHtml(secV);

        // 海报4：主题行业
        document.getElementById("sectorGrid").innerHTML = renderBlockGridHtml(secV);

        // 海报5：SmartBeta
        var smartV = v.filter(function (x) { return x.group === "smartbeta" && DATA[x.code]; });
        document.getElementById("smartCards").innerHTML = renderCardListHtml(smartV);

        // 海报6：连续5日冰点板块（温度<10）
        var coldCount = extreme.cold.length;
        document.getElementById("coldPosterTitle").textContent =
            coldCount > 0 ? "连续5日冰点 · " + coldCount + "个板块" : "连续5日冰点";
        document.getElementById("coldPosterGrid").innerHTML = extreme.cold.length > 0
            ? renderExtremeGridHtml(extreme.cold, "cold")
            : '<div style="text-align:center;color:#86868B;padding:20px;font-size:12px">当前无连续5日冰点板块</div>';

        // 海报7：连续5日狂热板块（温度>90）
        var hotCount = extreme.hot.length;
        document.getElementById("hotPosterTitle").textContent =
            hotCount > 0 ? "连续5日狂热 · " + hotCount + "个板块" : "连续5日狂热";
        document.getElementById("hotPosterGrid").innerHTML = extreme.hot.length > 0
            ? renderExtremeGridHtml(extreme.hot, "hot")
            : '<div style="text-align:center;color:#86868B;padding:20px;font-size:12px">当前无连续5日狂热板块</div>';
    }

    function renderAllPage() {
        var v = vis();
        var extreme = findExtremeSectors();

        var mainV = v.filter(function (x) { return x.group === "main" && DATA[x.code]; });
        document.getElementById("allMain").innerHTML = renderCardListHtml(mainV);

        var lightV = v.filter(function (x) { return x.group === "light" && DATA[x.code]; })
            .sort(function (a, b) {
                var da = getDisplayData(a.code), db = getDisplayData(b.code);
                return (da ? da.score : 0) - (db ? db.score : 0);
            });
        document.getElementById("allLight").innerHTML = renderBlockGridHtml(lightV);

        var secV = v.filter(function (x) { return x.group === "sector" && DATA[x.code]; })
            .sort(function (a, b) {
                var da = getDisplayData(a.code), db = getDisplayData(b.code);
                return (da ? da.score : 0) - (db ? db.score : 0);
            });
        document.getElementById("allSector").innerHTML = renderBlockGridHtml(secV);

        var smartV = v.filter(function (x) { return x.group === "smartbeta" && DATA[x.code]; });
        document.getElementById("allSmart").innerHTML = renderCardListHtml(smartV);

        // 极端板块（全部tab）
        document.getElementById("allExtreme").innerHTML = renderAllExtremeHtml(extreme);
    }

    function renderCardListHtml(items) {
        return items.map(function (x) {
            var d = getDisplayData(x.code);
            if (!d) return '';
            var ec = d.emotionColor || "#34C759";
            return '<div class="idx-card" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="idx-name">' + x.display + '</div>' +
                '<div class="idx-right"><div class="idx-temp" style="color:' + ec + '">' + d.score + '°</div>' +
                '<div class="idx-tag" style="background:' + ec + '">' + (d.emotion || "中性") + '</div></div></div>';
        }).join("");
    }

    function renderBlockGridHtml(items) {
        return items.map(function (x) {
            var d = getDisplayData(x.code);
            if (!d) return '';
            var ec = d.emotionColor || "#34C759";
            var tc = (ec === "#5AC8FA" || ec === "#34C759") ? "dt" : "lt";
            return '<div class="g-block ' + tc + '" style="background:' + ec + '" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="bn">' + x.display + '</div><div class="bt">' + d.score + '</div></div>';
        }).join("");
    }

    // 极端板块 5日色阶展示（海报最多显示8个，超出提示）
    function renderExtremeGridHtml(items, type) {
        var MAX = 8;
        var display = items.slice(0, MAX);
        var html = display.map(function (e) {
            return '<div class="extreme-row" onclick="App.showDetail(\'' + e.config.code + '\')">' +
                '<div class="extreme-name">' + e.config.display + '</div>' +
                '<div class="extreme-temps">' +
                e.streak.map(function (pt) {
                    return '<span class="extreme-badge" style="background:' + tempColor(pt.score) + '">' + pt.score + '</span>';
                }).join("") +
                '</div></div>';
        }).join("");
        if (items.length > MAX) {
            html += '<div style="text-align:center;color:#86868B;font-size:11px;padding:8px">…还有 ' +
                (items.length - MAX) + ' 个板块，可在设置中调整</div>';
        }
        return html;
    }

    function renderAllExtremeHtml(extreme) {
        var html = "";

        if (extreme.cold.length > 0) {
            var coldCount = extreme.cold.length;
            html += '<div class="section-title" style="color:#007AFF">❄️ 连续5日冰点（温度<10）· ' + coldCount + '个板块</div>';
            extreme.cold.forEach(function (e) {
                html += '<div class="extreme-row" onclick="App.showDetail(\'' + e.config.code + '\')">';
                html += '<div class="extreme-name">' + e.config.display + '</div>';
                html += '<div class="extreme-temps">';
                e.streak.forEach(function (pt) {
                    html += '<span class="extreme-badge" style="background:' + tempColor(pt.score) + '">' + pt.score + '</span>';
                });
                html += '</div></div>';
            });
        }

        if (extreme.hot.length > 0) {
            var hotCount = extreme.hot.length;
            html += '<div class="section-title" style="color:#FF3B30;margin-top:12px">🔥 连续5日狂热（温度>90）· ' + hotCount + '个板块</div>';
            extreme.hot.forEach(function (e) {
                html += '<div class="extreme-row" onclick="App.showDetail(\'' + e.config.code + '\')">';
                html += '<div class="extreme-name">' + e.config.display + '</div>';
                html += '<div class="extreme-temps">';
                e.streak.forEach(function (pt) {
                    html += '<span class="extreme-badge" style="background:' + tempColor(pt.score) + '">' + pt.score + '</span>';
                });
                html += '</div></div>';
            });
        }

        if (!html) {
            html = '<div style="text-align:center;color:#86868B;padding:16px;font-size:13px">当前无极端板块</div>';
        }

        return html;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 详情页
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function showDetail(code) {
        var x = AppConfig.getIndexByCode(code);
        if (!x || !DATA[code]) return;
        CAL_POSTER_CODE = code;  // 记录当前详情指数
        var d = getDisplayData(code);
        var base = DATA[code];
        var ec = d.emotionColor || "#34C759";
        var el = d.emotion || "中性";

        var html = '<button class="detail-back" onclick="App.switchTab(\'home\')">← 返回</button>';
        html += '<div class="page-title">' + x.display + '</div>';

        // 温度条
        html += '<div class="d-temp-bar"><div class="d-bar"></div>';
        html += '<div class="d-nums"><span style="left:0%">0</span><span style="left:10%">10</span><span style="left:20%">20</span><span style="left:80%">80</span><span style="left:90%">90</span><span style="left:100%">100</span></div>';
        html += '<div class="d-labels"><span class="dl1">冰点</span><span class="dl2">恐惧</span><span class="dl3">中性</span><span class="dl4">贪婪</span><span class="dl5">狂热</span></div></div>';

        html += '<div class="d-cards"><div class="d-card"><div class="v" style="color:' + ec + '">' + (d.score === null ? "-" : d.score) + '℃</div><div class="l">市场温度</div></div>';
        html += '<div class="d-card"><div class="v" style="color:' + ec + '">' + el + '</div><div class="l">市场状态</div></div>';
        html += '<div class="d-card"><div class="v" style="font-size:18px">' + d.close + '</div><div class="l">' + x.display + '收盘</div>';
        if (d.ret !== null) html += '<div class="c ' + (d.ret >= 0 ? "up" : "dn") + '">' + (d.ret >= 0 ? "+" : "") + d.ret + '%</div>';
        html += '</div></div>';

        // 走势图（去掉滑轨，手势与数据Tab统一）
        html += '<div class="d-section" id="detailChartSection"><h3>市场温度 & ' + x.display + '走势<button class="chart-view-btn" onclick="App.toggleChartLandscape(\'detail\')" title="横屏查看此图" aria-label="横屏查看此图">⤢</button><button class="chart-reset-btn" onclick="App.resetChartZoom(\'detail\')" title="重置缩放" aria-label="重置缩放">⟲</button></h3><div class="d-chart"><canvas id="detailChart"></canvas></div><p style="font-size:11px;color:#86868B;margin-top:4px">单指查看每日数值，双指拖动平移、捏合缩放。</p></div>';

        // 近30个交易日温度日历（只显示交易日，无周末）
        html += '<div class="d-section"><h3>近30个交易日温度</h3>';
        html += '<div id="calPosterWrap">';
        html += '<div class="cal-trade-grid" id="calGrid"></div>';
        html += '</div>';
        html += '<button class="dl-btn" style="margin-top:8px" onclick="App.downloadCalPoster()">📥 分享30日温度海报</button></div>';

        // 近1年数据表格
        html += '<div class="d-section"><h3>近1年数据 <span style="font-weight:400;font-size:11px;color:#86868B;float:right" id="sortHint">点击表头排序</span></h3>';
        html += '<div style="max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch">';
        html += '<table class="d-table" id="yearTable"><thead><tr>' +
            '<th class="clickable" onclick="App.sortYearTable(\'date\')">日期 ▾</th>' +
            '<th class="clickable" onclick="App.sortYearTable(\'temp\')">温度 ▾</th>' +
            '<th class="clickable" onclick="App.sortYearTable(\'close\')">收盘 ▾</th>' +
            '<th class="clickable" onclick="App.sortYearTable(\'ret\')">涨跌幅 ▾</th>' +
            '</tr></thead><tbody id="yearTableBody"></tbody></table>';
        html += '</div></div>';

        document.getElementById("detailContent").innerHTML = html;
        switchTab("detail");

        setTimeout(function () { renderCalendar(d); renderYearTable(d); }, 10);

        DETAIL_CODE = code;
        setTimeout(function () { renderDetailChart(); }, 80);
    }

    function rangeControlHtml(key) {
        return '<div class="chart-range" id="range-' + key + '">' +
            '<div class="chart-range-head"><span>区间</span><span class="chart-range-value">拖动选择</span></div>' +
            '<div class="chart-range-track">' +
            '<input class="range-start" type="range" min="0" max="1" value="0" oninput="App.updateChartRange(\'' + key + '\')" aria-label="区间起点">' +
            '<input class="range-end" type="range" min="0" max="1" value="1" oninput="App.updateChartRange(\'' + key + '\')" aria-label="区间终点">' +
            '</div></div>';
    }

    function ensureChartRange(key, count) {
        if (!count) return { start: 0, end: 0 };
        var state = CHART_RANGES[key];
        if (!state || state.count !== count) {
            var windowSize = Math.min(180, count);
            state = { start: count - windowSize, end: count - 1, count: count };
            CHART_RANGES[key] = state;
        }
        state.start = Math.max(0, Math.min(state.start, count - 1));
        state.end = Math.max(state.start, Math.min(state.end, count - 1));
        var control = document.getElementById("range-" + key);
        if (control) {
            if (!control.querySelector(".range-start")) {
                control.innerHTML = '<div class="chart-range-head"><span>区间</span><span class="chart-range-value">拖动选择</span></div>' +
                    '<div class="chart-range-track">' +
                    '<input class="range-start" type="range" min="0" max="1" value="0" oninput="App.updateChartRange(\'' + key + '\')" aria-label="区间起点">' +
                    '<input class="range-end" type="range" min="0" max="1" value="1" oninput="App.updateChartRange(\'' + key + '\')" aria-label="区间终点">' +
                    '</div>';
            }
            var start = control.querySelector(".range-start");
            var end = control.querySelector(".range-end");
            start.max = String(count - 1);
            end.max = String(count - 1);
            start.value = String(state.start);
            end.value = String(state.end);
            var value = control.querySelector(".chart-range-value");
            if (value) value.textContent = "";
        }
        return state;
    }

    function updateChartRange(key) {
        var control = document.getElementById("range-" + key);
        if (!control) return;
        var startInput = control.querySelector(".range-start");
        var endInput = control.querySelector(".range-end");
        var start = parseInt(startInput.value, 10);
        var end = parseInt(endInput.value, 10);
        if (start > end) {
            if (document.activeElement === startInput) end = start;
            else start = end;
        }
        CHART_RANGES[key] = { start: start, end: end, count: parseInt(startInput.max, 10) + 1 };
        if (key === "detail") {
            renderDetailChart();
        } else {
            renderSingleDataChart(key);
        }
    }

    function updateRangeLabel(key, dates, state) {
        var control = document.getElementById("range-" + key);
        if (!control || !dates.length) return;
        var value = control.querySelector(".chart-range-value");
        if (value) value.textContent = dates[state.start] + " 至 " + dates[state.end];
    }

    function renderDetailChart() {
        var base = DETAIL_CODE ? DATA[DETAIL_CODE] : null;
        var x = DETAIL_CODE ? AppConfig.getIndexByCode(DETAIL_CODE) : null;
        var ctx = document.getElementById("detailChart");
        if (!ctx || !base || !base.allDates || !x) return;
        if (DETAIL_CHART) { DETAIL_CHART.destroy(); DETAIL_CHART = null; }
        destroyHammerManagers();
        var state = ensureChartRange("detail", base.allDates.length);
        var dates = base.allDates.slice(state.start, state.end + 1);
        var scores = base.allScores.slice(state.start, state.end + 1);
        var closes = base.allCloses.slice(state.start, state.end + 1);
        DETAIL_CHART = new Chart(ctx, {
            type: "line",
            data: { labels: dates.map(function (dt) { return dt.slice(5); }), datasets: [
                { label: "市场温度", data: scores, borderColor: "#FF9500", backgroundColor: "rgba(255,149,0,.12)", fill: true, tension: .28, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.4, yAxisID: "y" },
                { label: x.display, data: closes, borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,.05)", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .28, fill: true, yAxisID: "y1" },
            ] },
            options: chartLineOptions("市场温度（℃）", x.display + "点位", true),
        });
        setupTwoFingerGestures(DETAIL_CHART, ctx);
    }

    function renderSingleDataChart(key) {
        if (!CHART_DATA || typeof Chart === "undefined") return;
        var charts = document.getElementById("dataCharts");
        if (charts) charts.style.display = "block";
        if (DATA_CHARTS[key]) {
            DATA_CHARTS[key].destroy();
            DATA_CHARTS[key] = null;
        }
        if (key === "market") renderMarketChart(CHART_DATA.market || []);
        if (key === "margin") renderMarginChart(CHART_DATA.margin || []);
        if (key === "marginFlow") renderMarginFlowChart(CHART_DATA.margin || []);
        if (key === "etf") renderEtfChart(CHART_DATA.etf || { rows: [] });
    }

    // ━━━ 30个交易日温度日历（仅交易日，5列×6行）━━━
    function renderCalendar(base) {
        var container = document.getElementById("calGrid");
        if (!container || !base.allDates) return;

        var endIndex = SELECTED_DATE ? findClosestTradeIdx(base.allDates, SELECTED_DATE) : base.allDates.length - 1;
        var n = Math.max(0, endIndex + 1);
        var count = Math.min(30, n);
        var start = n - count;

        var html = "";
        for (var i = start; i < n; i++) {
            var dt = base.allDates[i] || "";
            var score = base.allScores[i];
            var parts = dt.split("-");
            var dayLabel = parts[2] ? parseInt(parts[2], 10) : "";
            var monthLabel = parts[1] ? parseInt(parts[1], 10) : "";
            var ec = "#E5E5EA";
            if (score !== null) ec = tempColor(score);
            var textClass = (ec === "#5AC8FA" || ec === "#34C759") ? "dt" : "lt";

            html += '<div class="cal-trade-cell ' + textClass + '" style="background:' + ec + '" title="' + dt + ': ' + (score !== null ? score + '℃' : '-') + '">' +
                '<div class="cal-trade-label">' + monthLabel + '/' + dayLabel + '</div>' +
                '<div class="cal-trade-temp">' + (score !== null ? score : '-') + '</div></div>';
        }

        container.innerHTML = html;
    }

    // ━━━ 近1年数据表格 ━━━
    var YEAR_TABLE_DATA = null;
    var YEAR_SORT_KEY = "date";
    var YEAR_SORT_ASC = false;

    function renderYearTable(base) {
        if (!base || !base.allDates) return;

        var endIndex = SELECTED_DATE ? findClosestTradeIdx(base.allDates, SELECTED_DATE) : base.allDates.length - 1;
        var n = Math.max(0, endIndex + 1);
        var count = Math.min(252, n);
        var start = n - count;

        YEAR_TABLE_DATA = [];
        for (var i = start; i < n; i++) {
            YEAR_TABLE_DATA.push({
                date: base.allDates[i],
                temp: base.allScores[i],
                close: base.allCloses[i],
                ret: base.allRet ? base.allRet[i] : null,
            });
        }

        YEAR_TABLE_DATA.sort(function (a, b) { return b.date.localeCompare(a.date); });
        YEAR_SORT_KEY = "date";
        YEAR_SORT_ASC = false;

        renderYearTableRows();
    }

    function renderYearTableRows() {
        var tbody = document.getElementById("yearTableBody");
        if (!tbody || !YEAR_TABLE_DATA) return;

        var html = "";
        YEAR_TABLE_DATA.forEach(function (row) {
            var ec = row.temp !== null ? tempColor(row.temp) : "#86868B";
            var retStr = row.ret !== null ? (row.ret >= 0 ? "+" : "") + row.ret + "%" : "-";
            var retColor = row.ret !== null ? (row.ret >= 0 ? "color:#FF3B30" : "color:#34C759") : "";
            html += '<tr>' +
                '<td>' + row.date + '</td>' +
                '<td><span class="temp-dot" style="background:' + ec + '"></span>' + (row.temp !== null ? row.temp : '-') + '</td>' +
                '<td>' + (row.close !== null ? row.close.toLocaleString() : '-') + '</td>' +
                '<td style="' + retColor + '">' + retStr + '</td></tr>';
        });
        tbody.innerHTML = html;

        var hint = document.getElementById("sortHint");
        if (hint) {
            var colNames = { date: "日期", temp: "温度", close: "收盘", ret: "涨跌幅" };
            hint.textContent = "按" + colNames[YEAR_SORT_KEY] + (YEAR_SORT_ASC ? "升序" : "降序") + " | 点击切换";
        }
    }

    function sortYearTable(key) {
        if (!YEAR_TABLE_DATA) return;

        if (YEAR_SORT_KEY === key) {
            YEAR_SORT_ASC = !YEAR_SORT_ASC;
        } else {
            YEAR_SORT_KEY = key;
            YEAR_SORT_ASC = (key === "temp" || key === "close");
        }

        YEAR_TABLE_DATA.sort(function (a, b) {
            var va = a[key], vb = b[key];
            if (va === null || va === undefined) va = YEAR_SORT_ASC ? Infinity : -Infinity;
            if (vb === null || vb === undefined) vb = YEAR_SORT_ASC ? Infinity : -Infinity;
            if (va === vb) return 0;
            var cmp = va < vb ? -1 : 1;
            return YEAR_SORT_ASC ? cmp : -cmp;
        });

        renderYearTableRows();
    }

    // ━━━ 数据 Tab 图表 ━━━
    function chartDataUrl() {
        var android = window.Android && window.Android.isAndroid && window.Android.isAndroid();
        if (android) {
            var server = localStorage.getItem("chart_data_server");
            if (server) return server.replace(/\/+$/, "") + "/api/chart_data";
            return "data/chart_data.json";
        }
        return AppConfig.PROXY_BASE + "/api/chart_data";
    }

    function loadChartText(url) {
        return new Promise(function (resolve, reject) {
            var isLocalAsset = !/^https?:/i.test(url);
            // Android 原生桥：file:// 页面下 fetch 不支持 file://，优先用 readAsset 读取 assets
            if (isLocalAsset && window.Android && window.Android.readAsset) {
                var assetPath = url.indexOf("www/") === 0 ? url : ("www/" + url);
                try {
                    var raw = window.Android.readAsset(assetPath);
                    resolve(raw);
                } catch (e) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
                return;
            }
            // XHR 兼容 file://（status 可能为 0），其次 fetch
            if (typeof XMLHttpRequest !== "undefined") {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
                            resolve(xhr.responseText);
                        } else {
                            reject(new Error("加载失败 status=" + xhr.status));
                        }
                    }
                };
                xhr.onerror = function () { reject(new Error("网络错误")); };
                try { xhr.send(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
            } else {
                fetch(url).then(function (r) {
                    if (!r.ok) throw new Error("接口返回 " + r.status);
                    return r.text();
                }).then(resolve).catch(reject);
            }
        });
    }

    // ━━━ 从 iFinD API 直接获取图表数据（Android 端实时获取）━━━
    var ETF_IFIND_CODES = ["510300.OF", "510050.OF", "588000.OF", "512100.OF",
        "159915.OF", "510310.OF", "510500.OF", "510330.OF",
        "588080.OF", "159919.OF", "159845.OF"];
    var MARGIN_API_CODES = ["000001.SH", "399107.SZ"];

    function fetchChartDataFromAPI() {
        var IS_ANDROID = !!(window.Android && window.Android.isAndroid && window.Android.isAndroid());
        if (!IS_ANDROID) return Promise.reject(new Error("not android"));

        var startDate = new Date();
        startDate.setDate(startDate.getDate() - 365 * 2 - 30);
        var start = formatDate(startDate);
        var end = formatDate(new Date());

        return Promise.all([
            fetchMarketChartAPI(start, end),
            fetchMarginChartAPI(start, end),
            fetchEtfChartAPI(start, end),
        ]).then(function (results) {
            return {
                market: results[0],
                margin: results[1],
                etf: results[2],
                updated_at: new Date().toLocaleString("zh-CN"),
            };
        });
    }

    function fetchMarketChartAPI(start, end) {
        // 复用已有的 Fetch.fetchIndexHistory 获取上证指数行情
        return Fetch.fetchIndexHistory("000001.SH", start, end).then(function (data) {
            if (!data || data.error || !data.dates || !data.dates.length) return [];
            var rows = [];
            var amounts = data.amount || [];
            for (var i = 0; i < data.dates.length; i++) {
                var amt = amounts[i];
                var window = [];
                for (var j = Math.max(0, i - 19); j <= i; j++) {
                    if (amounts[j] !== null && amounts[j] !== undefined && !isNaN(amounts[j])) window.push(amounts[j]);
                }
                var ma20 = window.length ? window.reduce(function (a, b) { return a + b; }, 0) / window.length : null;
                rows.push({
                    date: data.dates[i],
                    amount: amt !== null && amt !== undefined ? Math.round(amt * 100) / 100 : null,
                    amount_ma20: ma20 !== null ? Math.round(ma20 * 100) / 100 : null,
                });
            }
            return rows;
        });
    }

    function fetchMarginChartAPI(start, end) {
        // 分别获取 SH 和 SZ 融资余额，再汇总
        var promises = MARGIN_API_CODES.map(function (code) {
            return Fetch.fetchMargin(code, start, end).then(function (data) {
                if (!data || data.error || !data.dates) return {};
                var map = {};
                for (var i = 0; i < data.dates.length; i++) {
                    var v = data.margin_balance ? data.margin_balance[i] : null;
                    map[data.dates[i]] = v !== null && v !== undefined && !isNaN(v) ? v / 1e8 : null;
                }
                return map;
            }).catch(function () { return {}; });
        });

        return Promise.all(promises).then(function (maps) {
            var shMap = maps[0] || {};
            var szMap = maps[1] || {};
            var dateSet = {};
            Object.keys(shMap).forEach(function (d) { dateSet[d] = true; });
            Object.keys(szMap).forEach(function (d) { dateSet[d] = true; });
            var sortedDates = Object.keys(dateSet).sort();

            var rows = [];
            var prevBalance = null;
            var peak = null;
            var latestIdx = sortedDates.length - 1;

            for (var i = 0; i < sortedDates.length; i++) {
                var d = sortedDates[i];
                var sh = shMap[d];
                var sz = szMap[d];
                var parts = [];
                if (sh !== null && sh !== undefined) parts.push(sh);
                if (sz !== null && sz !== undefined) parts.push(sz);
                var total = parts.length ? parts.reduce(function (a, b) { return a + b; }, 0) : null;

                // T+1 调整
                var isMissing = total === null || total <= 0;
                var isLatestJump = (i === latestIdx && prevBalance !== null && total !== null && total < prevBalance * 0.8);
                var adjusted = false;
                if (isMissing || isLatestJump) {
                    total = prevBalance;
                    adjusted = true;
                }

                if (total !== null) {
                    peak = peak !== null ? Math.max(peak, total) : total;
                }
                var drawdown = (peak !== null && total !== null) ? Math.max(0, peak - total) : 0;
                var netBuy = 0;
                if (adjusted && prevBalance !== null) {
                    netBuy = 0;
                } else if (total !== null && prevBalance !== null) {
                    netBuy = Math.round((total - prevBalance) * 100) / 100;
                }

                rows.push({
                    date: d,
                    balance: total !== null ? Math.round(total * 100) / 100 : null,
                    peak: peak !== null ? Math.round(peak * 100) / 100 : null,
                    drawdown: Math.round(drawdown * 100) / 100,
                    net_buy: netBuy,
                    t_plus_one_adjusted: adjusted,
                });

                if (total !== null) prevBalance = total;
            }
            return rows;
        });
    }

    function fetchEtfChartAPI(start, end) {
        var codes = ETF_IFIND_CODES.join(",");
        return new Promise(function (resolve) {
            try {
                var raw = window.Android.fetchDateSequence(codes, "ths_netcashflow_fund", start, end);
                var resp = JSON.parse(raw);
                if (resp.error || !resp.tables || !resp.tables.length) {
                    resolve({ rows: [] });
                    return;
                }
                var daily = {};
                for (var t = 0; t < resp.tables.length; t++) {
                    var table = resp.tables[t];
                    var times = table.time || [];
                    var vals = (table.table || {})[ "ths_netcashflow_fund"] || [];
                    for (var i = 0; i < times.length; i++) {
                        var v = vals[i];
                        if (v !== null && v !== undefined && !isNaN(v)) {
                            var yi = v / 1e8;
                            daily[times[i]] = (daily[times[i]] || 0) + yi;
                        }
                    }
                }
                var rows = Object.keys(daily).sort().map(function (d) {
                    return { date: d, total: Math.round(daily[d] * 100) / 100 };
                });
                resolve({ rows: rows });
            } catch (e) {
                resolve({ rows: [] });
            }
        });
    }

    function loadChartData(force) {
        var now = Date.now();
        if (!force && CHART_DATA && (now - CHART_DATA_TIME) < CHART_DATA_TTL) {
            return Promise.resolve(CHART_DATA);
        }
        if (force) {
            CHART_DATA = null;
            destroyDataCharts();
        }
        if (CHART_DATA_LOADING) return CHART_DATA_LOADING;

        var IS_ANDROID = !!(window.Android && window.Android.isAndroid && window.Android.isAndroid());

        // Android 端优先从 iFinD API 实时获取，失败则回退静态 JSON
        var dataPromise;
        if (IS_ANDROID && window.Android.fetchDateSequence) {
            dataPromise = fetchChartDataFromAPI().catch(function (apiErr) {
                console.warn("API 获取图表数据失败，回退静态 JSON:", apiErr);
                return loadChartText("data/chart_data.json").then(function (text) { return JSON.parse(text); });
            });
        } else {
            var primary = chartDataUrl();
            var fallback = "data/chart_data.json";
            dataPromise = loadChartText(primary)
                .then(function (text) { return JSON.parse(text); })
                .catch(function () {
                    return loadChartText(fallback).then(function (text) { return JSON.parse(text); });
                });
        }

        CHART_DATA_LOADING = dataPromise
            .then(function (data) {
                if (data && data.error) throw new Error(data.error);
                CHART_DATA = data;
                CHART_DATA_TIME = Date.now();
                CHART_DATA_LOADING = null;
                renderDataCharts();
                return data;
            })
            .catch(function (error) {
                CHART_DATA_LOADING = null;
                var status = document.getElementById("dataChartStatus");
                if (status) status.textContent = "图表数据加载失败：" + error.message;
                throw error;
            });
        return CHART_DATA_LOADING;
    }

    function destroyDataCharts() {
        destroyHammerManagers();
        Object.keys(DATA_CHARTS).forEach(function (key) {
            if (DATA_CHARTS[key]) DATA_CHARTS[key].destroy();
        });
        DATA_CHARTS = {};
    }

    function chartLineOptions(yLabel, y1Label, detail, xRange) {
        var xConfig = { grid: { display: false }, ticks: { maxTicksLimit: detail ? 10 : 9, font: { size: 9 }, color: "#98A2B3", maxRotation: 0 } };
        if (xRange) { xConfig.min = xRange.min; xConfig.max = xRange.max; }
        var scales = {
            x: xConfig,
            y: { position: "left", grid: { color: "rgba(148,163,184,.16)" }, border: { display: false }, ticks: { font: { size: 9 }, color: "#667085" }, title: { display: true, text: yLabel, color: "#667085", font: { size: 9, weight: "600" } } },
        };
        if (y1Label) {
            scales.y1 = { position: "right", grid: { drawOnChartArea: false }, border: { display: false }, ticks: { font: { size: 9 }, color: "#667085" }, title: { display: true, text: y1Label, color: "#667085", font: { size: 9, weight: "600" } } };
        }
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: scales,
            elements: { line: { capBezierPoints: true }, point: { hitRadius: 12 } },
            animation: { duration: 450, easing: "easeOutQuart" },
            plugins: {
                legend: { labels: { usePointStyle: true, pointStyle: "circle", padding: 12, color: "#344054", font: { size: 10, weight: "600" } } },
                tooltip: { backgroundColor: "rgba(15,23,42,.92)", padding: 10, cornerRadius: 8, displayColors: true, titleFont: { size: 11 }, bodyFont: { size: 10 } },
                zoom: {
                    pan: { enabled: false },
                    zoom: { wheel: { enabled: false }, pinch: { enabled: true }, mode: "x" },
                    limits: { x: { minRange: 10 } },
                },
            },
        };
    }

    function dataChartOptions(yLabel, y1Label, xRange) {
        return chartLineOptions(yLabel, y1Label, false, xRange);
    }

    // ━━━ 双指手势：pinch 缩放 + 2指平移（单指留给 tooltip）━━━
    function setupTwoFingerGestures(chart, canvas) {
        if (!window.Hammer || !chart || !canvas) return;
        try {
            var mc = new Hammer.Manager(canvas, { touchAction: "none" });
            var pan = new Hammer.Pan({ event: "pan", pointers: 2, threshold: 5 });
            var pinch = new Hammer.Pinch({ event: "pinch", threshold: 0.05 });
            mc.add([pan, pinch]);
            pinch.recognizeWith(pan);

            var lastX = 0;
            var isPinching = false;

            mc.on("panstart", function () {
                if (!isPinching) lastX = 0;
            });
            mc.on("pan", function (e) {
                if (isPinching) return;  // pinch 进行中，抑制 pan
                var deltaX = e.deltaX - lastX;
                lastX = e.deltaX;
                if (deltaX !== 0 && chart.pan) {
                    // 向右拖看更早数据（方向取反与数据轴一致）
                    chart.pan({ x: -deltaX }, undefined, "x");
                }
            });

            mc.on("pinchstart", function () {
                isPinching = true;
            });
            mc.on("pinchend", function () {
                // 延迟恢复 pan，避免手指抬起瞬间误触发
                setTimeout(function () { isPinching = false; }, 150);
            });

            HAMMER_MANAGERS.push(mc);
        } catch (e) { /* Hammer not available */ }
    }

    function destroyHammerManagers() {
        HAMMER_MANAGERS.forEach(function (mc) { try { mc.destroy(); } catch (e) {} });
        HAMMER_MANAGERS = [];
    }

    function renderMarketChart(rows) {
        var winSize = Math.min(180, rows.length);
        var xRange = { min: Math.max(0, rows.length - winSize), max: rows.length - 1 };
        var labels = rows.map(function (row) { return row.date.slice(5); });
        var priceMap = {};
        var base = DATA["000001"];
        if (base && base.allDates) {
            base.allDates.forEach(function (date, index) { priceMap[date] = base.allCloses[index]; });
        }
        var price = rows.map(function (row) { return priceMap[row.date] === undefined ? null : priceMap[row.date]; });
        DATA_CHARTS.market = new Chart(document.getElementById("marketChart"), {
            data: {
                labels: labels,
                datasets: [
                    { type: "line", label: "上证指数", data: price, borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,0.08)", yAxisID: "y", pointRadius: 0, borderWidth: 1.8, tension: 0.25 },
                    { type: "line", label: "成交额 20 日均线", data: rows.map(function (row) { return row.amount_ma20; }), borderColor: "#FF9500", backgroundColor: "rgba(255,149,0,0.08)", yAxisID: "y1", pointRadius: 0, borderWidth: 2.2, tension: 0.25, fill: true },
                ],
            },
            options: dataChartOptions("指数点位", "成交额（亿元）", xRange),
        });
        setupTwoFingerGestures(DATA_CHARTS.market, document.querySelector("#marketChart"));
    }

    function renderMarginChart(rows) {
        var winSize = Math.min(180, rows.length);
        var xRange = { min: Math.max(0, rows.length - winSize), max: rows.length - 1 };
        var labels = rows.map(function (row) { return row.date.slice(5); });
        DATA_CHARTS.margin = new Chart(document.getElementById("marginChart"), {
            type: "line",
            data: { labels: labels, datasets: [
                { label: "融资余额", data: rows.map(function (row) { return row.balance; }), borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,.07)", fill: true, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.2, tension: 0.25 },
                { label: "阶段峰值", data: rows.map(function (row) { return row.peak; }), borderColor: "#FF3B30", borderDash: [6, 5], pointRadius: 0, borderWidth: 1.6, tension: 0.15 },
                { label: "当前回撤", data: rows.map(function (row) { return row.drawdown; }), borderColor: "#AF52DE", pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, tension: 0.25, yAxisID: "y1" },
            ] },
            options: dataChartOptions("融资余额（亿元）", "当前回撤（亿元）", xRange),
        });
        setupTwoFingerGestures(DATA_CHARTS.margin, document.querySelector("#marginChart"));
    }

    function renderMarginFlowChart(rows) {
        var winSize = Math.min(180, rows.length);
        var xRange = { min: Math.max(0, rows.length - winSize), max: rows.length - 1 };
        DATA_CHARTS.marginFlow = new Chart(document.getElementById("marginFlowChart"), {
            type: "line",
            data: { labels: rows.map(function (row) { return row.date.slice(5); }), datasets: [
                { label: "单日净买入", data: rows.map(function (row) { return row.net_buy; }), borderColor: "#34C759", backgroundColor: "rgba(52,199,89,.08)", fill: true, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, tension: 0.2 },
                { label: "融资余额", data: rows.map(function (row) { return row.balance; }), borderColor: "#007AFF", pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.8, tension: 0.25, yAxisID: "y1" },
            ] },
            options: dataChartOptions("单日净买入（亿元）", "融资余额（亿元）", xRange),
        });
        setupTwoFingerGestures(DATA_CHARTS.marginFlow, document.querySelector("#marginFlowChart"));
    }

    function renderEtfChart(etf) {
        var rows = etf.rows || [];
        var winSize = Math.min(180, rows.length);
        var xRange = { min: Math.max(0, rows.length - winSize), max: rows.length - 1 };
        var labels = rows.map(function (row) { return row.date.slice(5); });
        var datasets = [{
            label: "合计净流入",
            data: rows.map(function (row) { return row.total; }),
            borderColor: "#1D1D1F",
            backgroundColor: "rgba(29,29,31,0.08)",
            borderWidth: 2.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: true,
        }];
        DATA_CHARTS.etf = new Chart(document.getElementById("etfChart"), {
            type: "line",
            data: { labels: labels, datasets: datasets },
            options: dataChartOptions("净流入（亿元）", null, xRange),
        });
        setupTwoFingerGestures(DATA_CHARTS.etf, document.querySelector("#etfChart"));
    }

    function renderDataCharts() {
        var status = document.getElementById("dataChartStatus");
        var charts = document.getElementById("dataCharts");
        if (typeof Chart === "undefined") {
            if (status) { status.style.display = "block"; status.textContent = "图表库未加载，请确认 js/vendor/chart.umd.min.js 存在。"; }
            return;
        }
        if (!CHART_DATA) {
            if (status) { status.style.display = "block"; status.textContent = "图表数据尚未加载"; }
            return;
        }
        destroyDataCharts();
        if (charts) charts.style.display = "block";
        renderMarketChart(CHART_DATA.market || []);
        renderMarginChart(CHART_DATA.margin || []);
        renderMarginFlowChart(CHART_DATA.margin || []);
        renderEtfChart(CHART_DATA.etf || { rows: [] });
        if (status) status.style.display = "none";
        var update = document.getElementById("dataUpdatedAt");
        if (update && CHART_DATA.market && CHART_DATA.market.length) {
            var rangeText = "数据范围：" + CHART_DATA.market[0].date + " 至 " + CHART_DATA.market[CHART_DATA.market.length - 1].date;
            if (CHART_DATA.updated_at) rangeText += " · 更新于 " + CHART_DATA.updated_at;
            update.textContent = rangeText;
        }
        renderMarginTable(CHART_DATA.margin || []);
    }

    function openDataPage() {
        var status = document.getElementById("dataChartStatus");
        if (status && !CHART_DATA) status.style.display = "block";
        loadChartData().then(function () {
            renderDataCharts();
        }).catch(function () {});
    }

    // ━━━ 融资余额每日净买入列表 ━━━
    function renderMarginTable(rows) {
        var container = document.getElementById("marginTableWrap");
        if (!container) return;
        if (!rows || !rows.length) { container.innerHTML = ""; return; }

        var sorted = rows.slice().sort(function (a, b) {
            var va = a[MARGIN_SORT_KEY], vb = b[MARGIN_SORT_KEY];
            if (va === null || va === undefined) va = MARGIN_SORT_ASC ? Infinity : -Infinity;
            if (vb === null || vb === undefined) vb = MARGIN_SORT_ASC ? Infinity : -Infinity;
            if (va === vb) return 0;
            return (va < vb ? -1 : 1) * (MARGIN_SORT_ASC ? 1 : -1);
        });

        var display = sorted.slice(0, 30);
        var sortIcon = function (key) {
            if (MARGIN_SORT_KEY !== key) return "";
            return MARGIN_SORT_ASC ? " ▲" : " ▼";
        };
        var th = function (key, label) {
            return '<th onclick="App.sortMarginTable(\'' + key + '\')" class="' +
                (MARGIN_SORT_KEY === key ? "sort-active" : "") + '">' + label + sortIcon(key) + "</th>";
        };

        var html = '<table class="margin-table"><thead><tr>' +
            th("date", "日期") + th("balance", "融资余额(亿)") + th("net_buy", "净买入(亿)") +
            "</tr></thead><tbody>";
        display.forEach(function (row) {
            var cls = row.net_buy >= 0 ? "pos" : "neg";
            var nb = row.net_buy !== null ? (row.net_buy >= 0 ? "+" : "") + row.net_buy.toFixed(2) : "—";
            var bal = row.balance !== null ? row.balance.toFixed(2) : "—";
            html += '<tr><td>' + row.date + '</td><td>' + bal + '</td><td class="' + cls + '">' + nb + '</td></tr>';
        });
        html += "</tbody></table>";
        html += '<div style="text-align:center;font-size:10px;color:#AEAEB2;padding:6px 0">共 ' + rows.length + ' 条，显示前 30 条</div>';
        container.innerHTML = html;
    }

    function sortMarginTable(key) {
        if (MARGIN_SORT_KEY === key) {
            MARGIN_SORT_ASC = !MARGIN_SORT_ASC;
        } else {
            MARGIN_SORT_KEY = key;
            MARGIN_SORT_ASC = false;
        }
        renderMarginTable(CHART_DATA.margin || []);
    }

    function refreshChartData() {
        showToast("正在刷新图表数据...");
        loadChartData(true).then(function () {
            renderDataCharts();
            showToast("图表数据已更新");
        }).catch(function () {
            showToast("图表数据更新失败");
        });
    }

    function resetChartZoom(key) {
        var chart = key === "detail" ? DETAIL_CHART : DATA_CHARTS[key];
        if (chart && chart.resetZoom) chart.resetZoom();
    }

    // ━━━ Tab 切换 ━━━
    function switchTab(name) {
        CURRENT_TAB = name;
        document.querySelectorAll(".page").forEach(function (p) { p.classList.remove("active"); });
        document.querySelectorAll(".btab").forEach(function (b) { b.classList.remove("active"); });
        var map = { home: "pageHome", all: "pageAll", data: "pageData", detail: "pageDetail" };
        var el = document.getElementById(map[name]);
        if (el) el.classList.add("active");
        var tabs = document.querySelectorAll(".btab");
        var idx = { home: 0, all: 1, data: 2 };
        if (tabs[idx[name]]) tabs[idx[name]].classList.add("active");
        if (name === "data") openDataPage();
    }

    // ━━━ 设置面板 ━━━
    function openSettings() {
        document.getElementById("settingsOverlay").classList.add("show");
        renderSettings();
        checkTokenStatus();
    }

    function closeSettings(e) {
        if (e && e.target !== document.getElementById("settingsOverlay")) return;
        document.getElementById("settingsOverlay").classList.remove("show");
    }

    function renderSettings() {
        var groups = [
            { k: "main", l: "主要指数" },
            { k: "light", l: "站在光里" },
            { k: "sector", l: "主题行业" },
            { k: "smartbeta", l: "SmartBeta" },
        ];
        var html = "";
        groups.forEach(function (g) {
            var items = AppConfig.INDEXES.filter(function (x) { return x.group === g.k; });
            var allOn = items.every(function (x) { return cfg.en.indexOf(x.code) >= 0; });
            html += '<div class="s-group"><div class="s-group-title"><span>' + g.l + ' (' +
                items.filter(function (x) { return cfg.en.indexOf(x.code) >= 0; }).length + '/' + items.length +
                ')</span><button onclick="App.toggleGrp(\'' + g.k + '\')">' +
                (allOn ? "取消全选" : "全选") + '</button></div><div class="s-items">';
            items.forEach(function (x) {
                var on = cfg.en.indexOf(x.code) >= 0;
                html += '<div class="s-item ' + (on ? "on" : "") + '" onclick="App.toggleIdx(\'' + x.code + '\')">' +
                    '<div class="ck">' + (on ? "✓" : "") + '</div><span>' + x.display + '</span></div>';
            });
            html += "</div></div>";
        });

        // 极端板块海报 — 按实际检测结果分组显示
        // 计算全部28个指数的极端情况（不受extremeEn限制）
        var allExt = findExtremeSectorsAll();
        var coldCodes = allExt.coldAll || [];
        var hotCodes = allExt.hotAll || [];

        html += '<div class="s-group" style="margin-top:16px;padding-top:16px;border-top:1px solid #E5E5EA">';
        html += '<div class="s-group-title"><span>⚠️ 极端板块海报</span></div>';

        // 冰点组
        if (coldCodes.length > 0) {
            html += '<div style="font-size:11px;color:#007AFF;font-weight:600;margin-bottom:4px">❄️ 连续5日冰点（<10）· ' + coldCodes.length + '个</div>';
            html += '<div class="s-items">';
            coldCodes.forEach(function (cc) {
                var on = (cfg.extremeEn || []).indexOf(cc) >= 0;
                var idx = AppConfig.getIndexByCode(cc);
                html += '<div class="s-item ' + (on ? "on" : "") + '" onclick="App.toggleExtremeIdx(\'' + cc + '\')">' +
                    '<div class="ck">' + (on ? "✓" : "") + '</div><span>' + (idx ? idx.display : cc) + '</span></div>';
            });
            html += "</div>";
        } else {
            html += '<div style="font-size:11px;color:#86868B;margin-bottom:6px">❄️ 当前无连续5日冰点板块</div>';
        }

        // 狂热组
        if (hotCodes.length > 0) {
            html += '<div style="font-size:11px;color:#FF3B30;font-weight:600;margin:8px 0 4px">🔥 连续5日狂热（>90）· ' + hotCodes.length + '个</div>';
            html += '<div class="s-items">';
            hotCodes.forEach(function (hc) {
                var on = (cfg.extremeEn || []).indexOf(hc) >= 0;
                var idx = AppConfig.getIndexByCode(hc);
                html += '<div class="s-item ' + (on ? "on" : "") + '" onclick="App.toggleExtremeIdx(\'' + hc + '\')">' +
                    '<div class="ck">' + (on ? "✓" : "") + '</div><span>' + (idx ? idx.display : hc) + '</span></div>';
            });
            html += "</div>";
        } else {
            html += '<div style="font-size:11px;color:#86868B;margin:6px 0">🔥 当前无连续5日狂热板块</div>';
        }

        html += '<div style="font-size:10px;color:#86868B;margin-top:4px">勾选后该板块才会出现在海报中</div>';
        html += "</div>";

        html += '<div class="s-group" style="margin-top:16px;padding-top:16px;border-top:1px solid #E5E5EA">';
        html += '<div class="s-group-title"><span>🔑 iFinD Token管理</span></div>';
        html += '<div id="tokenStatus" style="font-size:12px;color:#86868B;margin-bottom:8px">检查中...</div>';
        html += '<div style="display:flex;gap:8px"><input type="text" id="tokenInput" placeholder="粘贴新token..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #E5E5EA;font-size:13px;outline:none">';
        html += '<button onclick="App.updateToken()" style="padding:8px 14px;border-radius:8px;background:#007AFF;color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">更新</button></div>';
        html += '<div style="font-size:10px;color:#AEAEB2;margin-top:4px">token有效期约7天，过期后需重新获取</div>';
        html += '</div>';

        document.getElementById("settingsBody").innerHTML = html;
    }

    function toggleIdx(c) {
        var i = cfg.en.indexOf(c);
        if (i >= 0) cfg.en.splice(i, 1); else cfg.en.push(c);
        renderSettings();
    }

    function toggleGrp(g) {
        var codes = AppConfig.INDEXES.filter(function (x) { return x.group === g; }).map(function (x) { return x.code; });
        var allOn = codes.every(function (c) { return cfg.en.indexOf(c) >= 0; });
        if (allOn) {
            cfg.en = cfg.en.filter(function (c) { return codes.indexOf(c) < 0; });
        } else {
            codes.forEach(function (c) { if (cfg.en.indexOf(c) < 0) cfg.en.push(c); });
        }
        renderSettings();
    }

    function toggleExtremeIdx(c) {
        if (!cfg.extremeEn) cfg.extremeEn = AppConfig.INDEXES.map(function (x) { return x.code; });
        var i = cfg.extremeEn.indexOf(c);
        if (i >= 0) cfg.extremeEn.splice(i, 1); else cfg.extremeEn.push(c);
        renderSettings();
    }

    function saveCfg() {
        localStorage.setItem(SK, JSON.stringify(cfg));
        showToast("✅ 已保存");
        renderAll();
        closeSettings();
    }

    function resetCfg() {
        var allCodes = AppConfig.INDEXES.map(function (x) { return x.code; });
        cfg = {
            en: allCodes.slice(),
            ord: allCodes.slice(),
            extremeEn: allCodes.slice(),
        };
        localStorage.setItem(SK, JSON.stringify(cfg));
        showToast("🔄 已恢复默认");
        renderSettings();
    }

    // ━━━ Token 管理 ━━━
    function checkTokenStatus() {
        Fetch.checkToken()
            .then(function (res) {
                var el = document.getElementById("tokenStatus");
                if (!el) return;
                if (res.valid) {
                    el.innerHTML = '<span style="color:#34C759">✅ token有效</span>';
                } else {
                    el.innerHTML = '<span style="color:#FF3B30">❌ ' + (res.error || "token无效") + '</span>';
                }
            })
            .catch(function () {
                var el = document.getElementById("tokenStatus");
                if (el) el.textContent = "无法连接服务";
            });
    }

    function updateToken() {
        var input = document.getElementById("tokenInput");
        if (!input || !input.value.trim()) { showToast("请输入token"); return; }
        Fetch.updateToken(input.value.trim())
            .then(function (res) {
                if (res.success) {
                    showToast("✅ token更新成功");
                    input.value = "";
                    checkTokenStatus();
                    clearDataSnapshot();
                    DATA = {};
                    fetchLocal(true);
                } else {
                    showToast("❌ " + (res.error || "更新失败"));
                }
            })
            .catch(function () { showToast("❌ 连接失败"); });
    }

    // ━━━ UI 辅助 ━━━
    function showLoading(show) {
        var el = document.getElementById("loadingOverlay");
        if (el) el.classList.toggle("hidden", !show);
    }

    function updateLoadingProgress(current, total) {
        var el = document.getElementById("loadingText");
        if (el) el.textContent = "正在计算 " + current + "/" + total + "...";
    }

    function showToast(msg) {
        var t = document.getElementById("toast");
        t.textContent = msg;
        t.style.display = "block";
        setTimeout(function () { t.style.display = "none"; }, 1500);
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    // ━━━ 下载海报（同小红书方案：直接截元素，不裁剪不复制）━━━
    var IS_ANDROID = !!(window.Android && window.Android.isAndroid());

    function downloadPoster(id, name) {
        var el = document.getElementById(id);
        if (!el) return;
        var btn = el.nextElementSibling;
        if (!btn || !btn.classList.contains("dl-btn")) {
            btn = el.parentElement.querySelector(".dl-btn");
        }
        if (btn) { btn.textContent = "⏳ 生成中..."; btn.disabled = true; }

        var overlay = document.getElementById("downloadOverlay");
        if (overlay) overlay.classList.add("show");

        setTimeout(function () {
            html2canvas(el, {
                scale: 2,
                useCORS: true,
                allowTaint: false,
                backgroundColor: "#FFFFFF",
                logging: false
            }).then(function (canvas) {
                if (overlay) overlay.classList.remove("show");

                var filename = name + "_" + new Date().toISOString().slice(0, 10) + ".png";

                if (IS_ANDROID) {
                    try {
                        var base64 = canvas.toDataURL("image/png").split(",")[1];
                        var result = Android.saveImage(base64, filename);
                        if (result === "ok") {
                            doneBtn(btn, name);
                        } else {
                            if (btn) { btn.textContent = "❌ 失败"; btn.disabled = false; }
                            showToast("保存失败: " + (result || "未知错误"));
                        }
                    } catch (e) {
                        if (btn) { btn.textContent = "❌ 失败"; btn.disabled = false; }
                        showToast("保存失败: " + e.message);
                    }
                } else {
                    try {
                        canvas.toBlob(function (blob) {
                            if (!blob) {
                                fallbackDownload(canvas, name, btn);
                                return;
                            }
                            var url = URL.createObjectURL(blob);
                            downloadFile(url, filename);
                            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
                            doneBtn(btn, name);
                        }, "image/png", 0.95);
                    } catch (e) {
                        fallbackDownload(canvas, name, btn);
                    }
                }
            }).catch(function (err) {
                if (overlay) overlay.classList.remove("show");
                if (btn) { btn.textContent = "❌ 失败"; btn.disabled = false; }
                showToast("生成海报失败: " + err.message);
            });
        }, 100);
    }

    function downloadFile(url, filename) {
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        var evt = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
        a.dispatchEvent(evt);
        setTimeout(function () { document.body.removeChild(a); }, 500);
    }

    // ━━━ 30日日历海报下载 ━━━
    var CAL_POSTER_CODE = null;

    function downloadCalPoster() {
        if (!CAL_POSTER_CODE) return;
        var x = AppConfig.getIndexByCode(CAL_POSTER_CODE);
        var base = DATA[CAL_POSTER_CODE];
        if (!x || !base || !base.allDates) return;

        var overlay = document.getElementById("downloadOverlay");
        if (overlay) overlay.classList.add("show");

        // 创建临时海报 DOM（3:4 竖长比例，与其他海报一致）
        var poster = document.createElement("div");
        poster.style.cssText = "position:fixed;left:-9999px;top:0;width:420px;height:560px;background:#FFF;border-radius:16px;display:flex;flex-direction:column;padding:24px 20px 20px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;z-index:-1;overflow:hidden";
        poster.id = "calPosterTemp";

        var ds = formatDateFullCN(base.allDates[base.allDates.length - 1]);

        poster.innerHTML =
            '<div style="text-align:center;margin-bottom:14px">' +
            '<h2 style="font-size:26px;font-weight:700;color:#1D1D1F;margin:0 0 4px">' + x.display + '</h2>' +
            '<div style="font-size:12px;color:#86868B">近30个交易日温度 · ' + ds + '</div>' +
            '</div>' +
            '<div style="width:100%;height:16px;border-radius:8px;margin-bottom:4px;background:linear-gradient(to right,#007AFF 0%,#007AFF 10%,#5AC8FA 10%,#5AC8FA 20%,#34C759 20%,#34C759 80%,#FF9500 80%,#FF9500 90%,#FF3B30 90%,#FF3B30 100%)"></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:8px;color:#86868B;margin-bottom:6px">' +
            '<span>0</span><span>10</span><span>20</span><span>80</span><span>90</span><span>100</span></div>' +
            '<div style="font-size:11px;font-weight:600;color:#86868B;margin:8px 0 6px">近30个交易日</div>' +
            '<div id="calPosterGrid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;flex:1;align-content:space-between"></div>' +
            '<div style="text-align:center;margin-top:10px;font-size:10px;color:#86868B">今日市场情绪播报 | 投资有风险，入市需谨慎</div>' +
            '<div style="text-align:center;font-size:11px;color:#1D1D1F;font-weight:500">觉得有用欢迎点赞关注</div>';

        document.body.appendChild(poster);

        // 填充日历格
        setTimeout(function () {
            var grid = document.getElementById("calPosterGrid");
            if (grid) {
                var n = base.allDates.length;
                var count = Math.min(30, n);
                var start = n - count;
                for (var i = start; i < n; i++) {
                    var dt = base.allDates[i] || "";
                    var score = base.allScores[i];
                    var parts = dt.split("-");
                    var dayLabel = parts[2] ? parseInt(parts[2], 10) : "";
                    var monthLabel = parts[1] ? parseInt(parts[1], 10) : "";
                    var ec = score !== null ? tempColor(score) : "#E5E5EA";
                    var textClass = (ec === "#5AC8FA" || ec === "#34C759") ? "dt" : "lt";
                    var cell = document.createElement("div");
                    cell.style.cssText = "border-radius:8px;padding:6px 3px;text-align:center;display:flex;flex-direction:column;justify-content:center;background:" + ec + ";color:" + (textClass === "dt" ? "#1D1D1F" : "#fff") + ";min-height:52px";
                    cell.innerHTML =
                        '<div style="font-size:9px;font-weight:500;line-height:1">' + monthLabel + '/' + dayLabel + '</div>' +
                        '<div style="font-size:12px;font-weight:700;line-height:1">' + (score !== null ? score : '-') + '</div>';
                    grid.appendChild(cell);
                }
            }

            // 用 html2canvas 截图
            setTimeout(function () {
                html2canvas(poster, {
                    scale: 2, useCORS: true, allowTaint: false,
                    backgroundColor: "#FFFFFF", logging: false
                }).then(function (canvas) {
                    document.body.removeChild(poster);
                    if (overlay) overlay.classList.remove("show");

                    var filename = "A股温度计_" + x.display + "_30日_" + new Date().toISOString().slice(0, 10) + ".png";

                    if (IS_ANDROID) {
                        try {
                            var base64 = canvas.toDataURL("image/png").split(",")[1];
                            Android.saveImage(base64, filename);
                            showToast("✅ 海报已保存");
                        } catch (e) {
                            showToast("保存失败: " + e.message);
                        }
                    } else {
                        try {
                            canvas.toBlob(function (blob) {
                                if (!blob) return;
                                var url = URL.createObjectURL(blob);
                                downloadFile(url, filename);
                                setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
                                showToast("✅ 海报已下载");
                            }, "image/png", 0.95);
                        } catch (e) {
                            var url = canvas.toDataURL("image/png");
                            downloadFile(url, filename);
                        }
                    }
                }).catch(function () {
                    document.body.removeChild(poster);
                    if (overlay) overlay.classList.remove("show");
                    showToast("生成失败，请重试");
                });
            }, 50);
        }, 50);
    }

    function fallbackDownload(canvas, name, btn) {
        try {
            var url = canvas.toDataURL("image/png");
            downloadFile(url, name + "_" + new Date().toISOString().slice(0, 10) + ".png");
            doneBtn(btn, name);
        } catch (e2) {
            if (btn) { btn.textContent = "❌ 失败"; btn.disabled = false; }
            showToast("下载失败，请重试");
        }
    }

    function doneBtn(btn, name) {
        if (!btn) return;
        btn.textContent = "✅ 下载完成";
        btn.disabled = false;
        btn.classList.add("done");
        setTimeout(function () {
            btn.classList.remove("done");
            btn.textContent = "📥 下载" + name.split("_").slice(1).join("_") + "海报";
        }, 2000);
    }

    function resizeChart(key) {
        var chart = key === "detail" ? DETAIL_CHART : DATA_CHARTS[key];
        if (chart) chart.resize();
    }

    function toggleChartLandscape(key) {
        var sectionId = key === "detail" ? "detailChartSection" : "dataSection-" + key;
        var section = document.getElementById(sectionId);
        if (!section) return;

        var opening = !section.classList.contains("chart-landscape");
        document.querySelectorAll(".chart-landscape").forEach(function (other) {
            other.classList.remove("chart-landscape");
            var otherButton = other.querySelector(".chart-view-btn");
            if (otherButton) {
                otherButton.textContent = "⤢";
                otherButton.title = "横屏查看此图";
                otherButton.setAttribute("aria-label", "横屏查看此图");
            }
        });

        if (opening) {
            section.classList.add("chart-landscape");
            var button = section.querySelector(".chart-view-btn");
            if (button) {
                button.textContent = "↙";
                button.title = "退出横屏查看";
                button.setAttribute("aria-label", "退出横屏查看");
            }
            ACTIVE_CHART_LANDSCAPE = key;
        } else {
            ACTIVE_CHART_LANDSCAPE = null;
        }

        if (window.Android && window.Android.setLandscape) {
            try { window.Android.setLandscape(opening); } catch (e) { /* browser preview */ }
        }
        setTimeout(function () { resizeChart(key); }, 180);
    }

    // ━━━ 初始化 ━━━
    function init() {
        tickClock();
        setInterval(tickClock, 30000);
        ensurePosterLayout();
        loadDataSnapshot();
        fetchLocal(false);
    }

    // ━━━ 公开接口 ━━━
    return {
        init: init,
        switchTab: switchTab,
        showDetail: showDetail,
        openSettings: openSettings,
        closeSettings: closeSettings,
        toggleIdx: toggleIdx,
        toggleGrp: toggleGrp,
        toggleExtremeIdx: toggleExtremeIdx,
        saveCfg: saveCfg,
        resetCfg: resetCfg,
        updateToken: updateToken,
        downloadPoster: downloadPoster,
        downloadCalPoster: downloadCalPoster,
        movePoster: movePoster,
        togglePoster: togglePoster,
        resetPosterLayout: resetPosterLayout,
        updateChartRange: updateChartRange,
        togglePosterEdit: togglePosterEdit,
        toggleChartLandscape: toggleChartLandscape,
        fetchLocal: fetchLocal,
        refreshData: function () {
            showToast("正在刷新市场数据...");
            fetchLocal(true);
        },
        showToast: showToast,
        onDateChange: onDateChange,
        clearDateFilter: clearDateFilter,
        sortYearTable: sortYearTable,
        refreshChartData: refreshChartData,
        sortMarginTable: sortMarginTable,
        resetChartZoom: resetChartZoom,
    };
})();
