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

    // ━━━ 配置管理 ━━━
    var SK = "a_stock_cfg_v4";
    var cfg = loadCfg();

    function loadCfg() {
        try {
            var s = localStorage.getItem(SK);
            if (s) {
                var c = JSON.parse(s);
                if (c.en && c.ord) return c;
            }
        } catch (e) { /* ignore */ }
        return {
            en: AppConfig.INDEXES.map(function (x) { return x.code; }),
            ord: AppConfig.INDEXES.map(function (x) { return x.code; }),
        };
    }

    function vis() {
        return cfg.ord
            .filter(function (c) { return cfg.en.indexOf(c) >= 0; })
            .map(function (c) { return AppConfig.getIndexByCode(c); })
            .filter(Boolean);
    }

    // ━━━ 时钟 ━━━
    function tickClock() {
        var el = document.getElementById("clock");
        if (el) {
            var d = new Date();
            el.textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
        }
    }

    // ━━━ 日期 ━━━
    function todayStr() {
        var d = new Date();
        return d.getFullYear() + "年" + String(d.getMonth() + 1).padStart(2, "0") +
            "月" + String(d.getDate()).padStart(2, "0") + "日";
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

    /**
     * 将前端计算结果转换为与 Python /api/data 一致的格式
     */
    function buildIndexResult(data, idxConfig) {
        var n = data.close.length;
        var last = n - 1;

        // 找最后一个 data_ok 的行
        var validIdx = last;
        for (var i = last; i >= 0; i--) {
            if (data.data_ok[i]) { validIdx = i; break; }
        }

        var score = data.market_score_low_freq[validIdx];
        var scoreRounded = score !== null ? Math.round(score * 100) : 0;
        var state = AppConfig.getMarketState(score);
        var emo = AppConfig.getEmotion(scoreRounded);

        // 百分位排名
        var ranks = {
            close: data.rank_close[validIdx] !== null ? Math.round(data.rank_close[validIdx] * 100) : 0,
            turnover: data.rank_turnover[validIdx] !== null ? Math.round(data.rank_turnover[validIdx] * 100) : 0,
            pe: data.rank_pe[validIdx] !== null ? Math.round(data.rank_pe[validIdx] * 100) : 0,
            rsi: data.rank_rsi[validIdx] !== null ? Math.round(data.rank_rsi[validIdx] * 100) : 0,
        };
        if (data.rank_margin && data.rank_margin[validIdx] !== null) {
            ranks.margin = Math.round(data.rank_margin[validIdx] * 100);
        }

        // 最近180天走势数据
        var chartLen = Math.min(180, n);
        var startIdx = n - chartLen;
        var dates = data.dates.slice(startIdx);
        var scores = data.market_score_low_freq.slice(startIdx).map(function (s) {
            return s !== null ? Math.round(s * 100) : null;
        });
        var closes = data.close.slice(startIdx).map(function (c) {
            return c !== null ? Math.round(c * 100) / 100 : null;
        });

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
            ret: data.daily_return[validIdx] ? Math.round(data.daily_return[validIdx] * 100) / 100 : 0,
            rsi: data.RSI[validIdx] ? Math.round(data.RSI[validIdx] * 10) / 10 : 0,
            pe: data.pe && data.pe[validIdx] ? Math.round(data.pe[validIdx] * 100) / 100 : 0,
            amount: data.amount && data.amount[validIdx] ? Math.round(data.amount[validIdx] * 100) / 100 : 0,
            ma5: data.MA5[validIdx] ? Math.round(data.MA5[validIdx] * 100) / 100 : 0,
            ma20: data.MA20[validIdx] ? Math.round(data.MA20[validIdx] * 100) / 100 : 0,
            ma60: data.MA60[validIdx] ? Math.round(data.MA60[validIdx] * 100) / 100 : 0,
            ranks: ranks,
            dates: dates,
            scores: scores,
            closes: closes,
        };
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
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
        var ds = todayStr();

        setText("homeDate", ds);
        ["posterDate1", "posterDate2", "posterDate3", "posterDate4"].forEach(function (id) {
            setText(id, ds);
        });

        // 主要指数
        var mainV = v.filter(function (x) { return x.group === "main" && DATA[x.code]; });
        document.getElementById("mainCards").innerHTML = mainV.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            return '<div class="idx-card" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="idx-name">' + x.display + '</div>' +
                '<div class="idx-right"><div class="idx-temp" style="color:' + ec + '">' + d.score + '°</div>' +
                '<div class="idx-tag" style="background:' + ec + '">' + (d.emotion || "中性") + '</div></div></div>';
        }).join("") || '<div style="text-align:center;color:#86868B;padding:20px">加载中...</div>';

        // 站在光里
        var lightV = v.filter(function (x) { return x.group === "light" && DATA[x.code]; })
            .sort(function (a, b) { return DATA[a.code].score - DATA[b.code].score; });
        document.getElementById("lightGrid").innerHTML = lightV.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            var tc = (ec === "#5AC8FA" || ec === "#34C759") ? "lt" : "dt";
            return '<div class="g-block ' + tc + '" style="background:' + ec + '" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="bn">' + x.display + '</div><div class="bt">' + d.score + '</div></div>';
        }).join("");

        // 主题行业
        var secV = v.filter(function (x) { return x.group === "sector" && DATA[x.code]; })
            .sort(function (a, b) { return DATA[a.code].score - DATA[b.code].score; });
        document.getElementById("sectorGrid").innerHTML = secV.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            var tc = (ec === "#5AC8FA" || ec === "#34C759") ? "lt" : "dt";
            return '<div class="g-block ' + tc + '" style="background:' + ec + '" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="bn">' + x.display + '</div><div class="bt">' + d.score + '</div></div>';
        }).join("");

        // SmartBeta
        var smartV = v.filter(function (x) { return x.group === "smartbeta" && DATA[x.code]; });
        document.getElementById("smartCards").innerHTML = smartV.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            return '<div class="idx-card" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="idx-name">' + x.display + '</div>' +
                '<div class="idx-right"><div class="idx-temp" style="color:' + ec + '">' + d.score + '°</div>' +
                '<div class="idx-tag" style="background:' + ec + '">' + (d.emotion || "中性") + '</div></div></div>';
        }).join("");
    }

    function renderAllPage() {
        var v = vis();

        var mainV = v.filter(function (x) { return x.group === "main" && DATA[x.code]; });
        document.getElementById("allMain").innerHTML = renderCardList(mainV);

        var lightV = v.filter(function (x) { return x.group === "light" && DATA[x.code]; })
            .sort(function (a, b) { return DATA[a.code].score - DATA[b.code].score; });
        document.getElementById("allLight").innerHTML = renderBlockGrid(lightV);

        var secV = v.filter(function (x) { return x.group === "sector" && DATA[x.code]; })
            .sort(function (a, b) { return DATA[a.code].score - DATA[b.code].score; });
        document.getElementById("allSector").innerHTML = renderBlockGrid(secV);

        var smartV = v.filter(function (x) { return x.group === "smartbeta" && DATA[x.code]; });
        document.getElementById("allSmart").innerHTML = renderCardList(smartV);
    }

    function renderCardList(items) {
        return items.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            return '<div class="idx-card" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="idx-name">' + x.display + '</div>' +
                '<div class="idx-right"><div class="idx-temp" style="color:' + ec + '">' + d.score + '°</div>' +
                '<div class="idx-tag" style="background:' + ec + '">' + (d.emotion || "中性") + '</div></div></div>';
        }).join("");
    }

    function renderBlockGrid(items) {
        return items.map(function (x) {
            var d = DATA[x.code];
            var ec = d.emotionColor || "#34C759";
            var tc = (ec === "#5AC8FA" || ec === "#34C759") ? "lt" : "dt";
            return '<div class="g-block ' + tc + '" style="background:' + ec + '" onclick="App.showDetail(\'' + x.code + '\')">' +
                '<div class="bn">' + x.display + '</div><div class="bt">' + d.score + '</div></div>';
        }).join("");
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 详情页
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function showDetail(code) {
        var x = AppConfig.getIndexByCode(code);
        if (!x || !DATA[code]) return;
        var d = DATA[code];
        var ec = d.emotionColor || "#34C759";
        var el = d.emotion || "中性";

        // 百分位排名
        var rk = d.ranks || {};
        var rankItems = [
            ["收盘价", (rk.close || 0) + "%"],
            ["成交额", (rk.turnover || 0) + "%"],
            ["PE", (rk.pe || 0) + "%"],
            ["RSI", (rk.rsi || 0) + "%"]
        ];
        if (rk.margin !== undefined) rankItems.push(["融资余额", rk.margin + "%"]);
        var rh = rankItems.map(function (r) {
            return '<div class="d-rank-pill"><div class="rn">' + r[0] + '</div><div class="rv">' + r[1] + '</div></div>';
        }).join("");

        var html = '<button class="detail-back" onclick="App.switchTab(\'home\')">← 返回</button>';
        html += '<div class="page-title">' + x.display + '</div>';

        // 温度条
        html += '<div class="d-temp-bar"><div class="d-bar"></div>';
        html += '<div class="d-nums"><span style="left:0%">0</span><span style="left:10%">10</span><span style="left:20%">20</span><span style="left:80%">80</span><span style="left:90%">90</span><span style="left:100%">100</span></div>';
        html += '<div class="d-labels"><span class="dl1">冰点</span><span class="dl2">恐惧</span><span class="dl3">中性</span><span class="dl4">贪婪</span><span class="dl5">狂热</span></div></div>';

        html += '<div class="d-cards"><div class="d-card"><div class="v" style="color:' + ec + '">' + d.score + '℃</div><div class="l">市场温度</div></div>';
        html += '<div class="d-card"><div class="v" style="color:' + ec + '">' + el + '</div><div class="l">市场状态</div></div>';
        html += '<div class="d-card"><div class="v" style="font-size:18px">' + d.close + '</div><div class="l">' + x.display + '收盘</div><div class="c ' + (d.ret >= 0 ? "up" : "dn") + '">' + (d.ret >= 0 ? "+" : "") + d.ret + '%</div></div></div>';

        // 走势图
        html += '<div class="d-section"><h3>市场温度 & ' + x.display + '走势</h3><div class="d-chart"><canvas id="detailChart"></canvas></div></div>';

        html += '<div class="d-section"><h3>技术指标</h3><table class="d-table">' +
            '<tr><th>RSI(6)</th><td>' + d.rsi + '</td></tr>' +
            '<tr><th>PE(静态)</th><td>' + d.pe + '</td></tr>' +
            '<tr><th>涨跌幅</th><td>' + (d.ret >= 0 ? "+" : "") + d.ret + '%</td></tr>' +
            '<tr><th>成交额</th><td>' + d.amount + ' 亿</td></tr></table></div>';

        html += '<div class="d-section"><h3>百分位排名</h3><div class="d-rank" style="grid-template-columns:repeat(' +
            Math.min(rankItems.length, 4) + ',1fr)">' + rh + '</div></div>';

        document.getElementById("detailContent").innerHTML = html;
        switchTab("detail");

        // 渲染走势图
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
                        y: {
                            min: 0, max: 100, position: "left",
                            grid: { color: "#F5F5F7" },
                            ticks: { callback: function (v) { return v + "℃"; }, font: { size: 10 } },
                        },
                        y1: {
                            position: "right",
                            grid: { drawOnChartArea: false },
                            ticks: { callback: function (v) { return v.toLocaleString(); }, font: { size: 10 } },
                        },
                        x: {
                            grid: { display: false },
                            ticks: { maxTicksLimit: 8, font: { size: 10 } },
                        },
                    },
                    plugins: {
                        legend: {
                            labels: { usePointStyle: true, pointStyle: "circle", padding: 12, font: { size: 11 } },
                        },
                    },
                },
            });
        }, 80);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Tab 切换
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function switchTab(name) {
        CURRENT_TAB = name;
        document.querySelectorAll(".page").forEach(function (p) { p.classList.remove("active"); });
        document.querySelectorAll(".btab").forEach(function (b) { b.classList.remove("active"); });
        var map = { home: "pageHome", all: "pageAll", detail: "pageDetail" };
        document.getElementById(map[name]).classList.add("active");
        var tabs = document.querySelectorAll(".btab");
        var idx = { home: 0, all: 1, detail: 2 };
        tabs[idx[name]].classList.add("active");
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 设置面板
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

        // Token管理
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

    function saveCfg() {
        localStorage.setItem(SK, JSON.stringify(cfg));
        showToast("✅ 已保存");
        renderAll();
        closeSettings();
    }

    function resetCfg() {
        cfg = {
            en: AppConfig.INDEXES.map(function (x) { return x.code; }),
            ord: AppConfig.INDEXES.map(function (x) { return x.code; }),
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
                    // 重新加载数据
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
        if (el) el.style.display = show ? "flex" : "none";
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

    // ━━━ 下载海报 ━━━
    function downloadPoster(id, name) {
        var el = document.getElementById(id);
        var btn = el.nextElementSibling;
        if (!btn || !btn.classList.contains("dl-btn")) {
            btn = el.parentElement.querySelector(".dl-btn");
        }
        if (btn) { btn.textContent = "⏳ 生成中..."; btn.disabled = true; }

        var origParent = el.parentNode;
        var origNext = el.nextSibling;
        document.body.appendChild(el);
        el.style.position = "absolute";
        el.style.left = "-9999px";
        el.style.top = "0";
        el.style.width = "540px";
        el.style.aspectRatio = "3/4";

        html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#FFFFFF" })
            .then(function (canvas) {
                var tw = 1080, th = 1440, out = document.createElement("canvas");
                out.width = tw; out.height = th;
                var ctx = out.getContext("2d");
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, tw, th);
                ctx.drawImage(canvas, 0, 0, tw, th);

                el.style.position = ""; el.style.left = ""; el.style.top = "";
                el.style.width = ""; el.style.aspectRatio = "";
                if (origNext) origParent.insertBefore(el, origNext); else origParent.appendChild(el);

                var a = document.createElement("a");
                a.download = name + "_" + new Date().toISOString().slice(0, 10) + ".png";
                a.href = out.toDataURL("image/png");
                a.click();

                if (btn) {
                    btn.textContent = "✅ 下载完成";
                    btn.disabled = false;
                    btn.classList.add("done");
                    setTimeout(function () {
                        btn.classList.remove("done");
                        btn.textContent = "📥 下载" + name.split("_")[1] + "海报";
                    }, 2000);
                }
            })
            .catch(function () {
                el.style.position = ""; el.style.left = ""; el.style.top = "";
                el.style.width = ""; el.style.aspectRatio = "";
                if (origNext) origParent.insertBefore(el, origNext); else origParent.appendChild(el);
                if (btn) { btn.textContent = "❌ 失败"; btn.disabled = false; }
            });
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
        saveCfg: saveCfg,
        resetCfg: resetCfg,
        updateToken: updateToken,
        downloadPoster: downloadPoster,
        fetchLocal: fetchLocal,
        showToast: showToast,
    };
})();
