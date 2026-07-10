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
    var SELECTED_DATE = null;  // 日期回溯：选中的日期，null=最新

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
        for (var code in DATA) {
            if (!DATA.hasOwnProperty(code)) continue;
            var dd = DATA[code];
            if (dd && dd.allDates && dd.allDates.length > 0) {
                var last = dd.allDates[dd.allDates.length - 1];
                if (last > latest) latest = last;
            }
        }
        return latest || getLatestTradeDate();
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

    function findClosestTradeIdx(dates, targetDate) {
        var idx = -1;
        for (var i = 0; i < dates.length; i++) {
            if (dates[i] > targetDate) break;
            idx = i;
        }
        return idx;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 数据加载（前端本地计算）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function fetchLocal() {
        showLoading(true);

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
                showLoading(false);
                SELECTED_DATE = null;
                updateDatePickerMax();
                renderAll();
                if (errors.length > 0) {
                    console.warn("数据获取警告:", errors);
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
        if (i < 0) return idxData;

        var score = idxData.allScores[i];
        var scoreRounded = score !== null ? score : 0;
        var emo = AppConfig.getEmotion(scoreRounded);

        return {
            code: idxData.code,
            display: idxData.display,
            group: idxData.group,
            score: scoreRounded,
            state: AppConfig.getMarketState(score !== null ? score / 100 : null).name,
            stateColor: AppConfig.getMarketState(score !== null ? score / 100 : null).color,
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
        if (el) { el.max = formatDate(new Date()); el.value = ""; }
    }

    function onDateChange() {
        var el = document.getElementById("datePicker");
        var displayEl = document.getElementById("backtrackInfo");
        var clearBtn = document.getElementById("clearDateBtn");
        if (!el || !displayEl) return;

        var val = el.value;
        if (val) {
            SELECTED_DATE = val;
            displayEl.textContent = "回溯至: " + formatDateCN(val);
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
        renderPosters();
        renderAllPage();
    }

    function renderPosters() {
        var v = vis();
        var ds = getDisplayDateStr();
        var extreme = findExtremeSectors();

        setText("homeDate", ds);
        ["posterDate1", "posterDate2", "posterDate3", "posterDate4", "posterDate5", "posterDate6", "posterDate7"].forEach(function (id) {
            setText(id, ds);
        });

        // 海报1：主要指数
        var mainV = v.filter(function (x) { return x.group === "main" && DATA[x.code]; });
        document.getElementById("mainCards").innerHTML = mainV.map(function (x) {
            var d = getDisplayData(x.code);
            if (!d) return '';
            var ec = d.emotionColor || "#34C759";
            return '<div class="idx-card" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="idx-name">' + x.display + '</div>' +
                '<div class="idx-right"><div class="idx-temp" style="color:' + ec + '">' + d.score + '°</div>' +
                '<div class="idx-tag" style="background:' + ec + '">' + (d.emotion || "中性") + '</div></div></div>';
        }).join("") || '<div style="text-align:center;color:#86868B;padding:20px">加载中...</div>';

        // 海报2：站在光里
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

        html += '<div class="d-cards"><div class="d-card"><div class="v" style="color:' + ec + '">' + d.score + '℃</div><div class="l">市场温度</div></div>';
        html += '<div class="d-card"><div class="v" style="color:' + ec + '">' + el + '</div><div class="l">市场状态</div></div>';
        html += '<div class="d-card"><div class="v" style="font-size:18px">' + d.close + '</div><div class="l">' + x.display + '收盘</div>';
        if (d.ret !== null) html += '<div class="c ' + (d.ret >= 0 ? "up" : "dn") + '">' + (d.ret >= 0 ? "+" : "") + d.ret + '%</div>';
        html += '</div></div>';

        // 走势图
        html += '<div class="d-section"><h3>市场温度 & ' + x.display + '走势</h3><div class="d-chart"><canvas id="detailChart"></canvas></div></div>';

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

        setTimeout(function () { renderCalendar(base); renderYearTable(base); }, 10);

        setTimeout(function () {
            var ctx = document.getElementById("detailChart");
            if (!ctx || !d.dates) return;
            if (DETAIL_CHART) { DETAIL_CHART.destroy(); DETAIL_CHART = null; }

            var labels = d.dates.map(function (dt) { return dt.slice(5); });
            DETAIL_CHART = new Chart(ctx, {
                type: "line",
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: "市场温度",
                            data: d.scores,
                            borderColor: "#FF9500",
                            backgroundColor: "rgba(255,149,0,0.08)",
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                            borderWidth: 2,
                            yAxisID: "y",
                        },
                        {
                            label: x.display,
                            data: d.closes,
                            borderColor: "#007AFF",
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.3,
                            fill: false,
                            yAxisID: "y1",
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    scales: {
                        y: { min: 0, max: 100, position: "left", grid: { color: "#F5F5F7" },
                            ticks: { callback: function (v) { return v + "℃"; }, font: { size: 10 } } },
                        y1: { position: "right", grid: { drawOnChartArea: false },
                            ticks: { callback: function (v) { return v.toLocaleString(); }, font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
                    },
                    plugins: {
                        legend: { labels: { usePointStyle: true, pointStyle: "circle", padding: 12, font: { size: 11 } } },
                    },
                },
            });
        }, 80);
    }

    // ━━━ 30个交易日温度日历（仅交易日，6列×5行）━━━
    function renderCalendar(base) {
        var container = document.getElementById("calGrid");
        if (!container || !base.allDates) return;

        var n = base.allDates.length;
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

        var n = base.allDates.length;
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

    // ━━━ Tab 切换 ━━━
    function switchTab(name) {
        CURRENT_TAB = name;
        document.querySelectorAll(".page").forEach(function (p) { p.classList.remove("active"); });
        document.querySelectorAll(".btab").forEach(function (b) { b.classList.remove("active"); });
        var map = { home: "pageHome", all: "pageAll", detail: "pageDetail" };
        var el = document.getElementById(map[name]);
        if (el) el.classList.add("active");
        var tabs = document.querySelectorAll(".btab");
        var idx = { home: 0, all: 1, detail: 2 };
        if (tabs[idx[name]]) tabs[idx[name]].classList.add("active");
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
                    DATA = {};
                    fetchLocal();
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

        // 创建临时海报 DOM
        var poster = document.createElement("div");
        poster.style.cssText = "position:fixed;left:-9999px;top:0;width:420px;min-height:560px;background:#FFF;border-radius:16px;display:flex;flex-direction:column;padding:24px 20px 20px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;z-index:-1";
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
            '<div id="calPosterGrid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;flex:1"></div>' +
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
                    cell.style.cssText = "border-radius:6px;padding:4px 2px;text-align:center;display:flex;flex-direction:column;justify-content:center;background:" + ec + ";color:" + (textClass === "dt" ? "#1D1D1F" : "#fff") + ";min-height:33px";
                    cell.innerHTML =
                        '<div style="font-size:8px;font-weight:500;line-height:1">' + monthLabel + '/' + dayLabel + '</div>' +
                        '<div style="font-size:11px;font-weight:700;line-height:1">' + (score !== null ? score : '-') + '</div>';
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

    // ━━━ 初始化 ━━━
    function init() {
        tickClock();
        setInterval(tickClock, 30000);
        fetchLocal();
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
        fetchLocal: fetchLocal,
        showToast: showToast,
        onDateChange: onDateChange,
        clearDateFilter: clearDateFilter,
        sortYearTable: sortYearTable,
    };
})();
