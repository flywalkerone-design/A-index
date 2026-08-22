/**
 * A股市场温度计 - 全局配置
 * 与 Python config.py 完全一致
 */

var AppConfig = (function () {
    "use strict";

    // ━━━ API 代理地址（仅浏览器开发模式使用）━━━
    // Android APP 中 fetch.js 直接调 iFinD API，不经过 proxy
    var PROXY_BASE = "http://127.0.0.1:5000";

    // ━━━ 38个指数配置（与 Python INDEXES 完全一致）━━━
    var INDEXES = [
        // 主要指数
        { code: "000001", ifind: "000001.SH", name: "上证指数", display: "上证指数", group: "main", margin: true },
        { code: "399102", ifind: "399102.SZ", name: "创业板综", display: "创业板", group: "main", margin: true },
        { code: "000680", ifind: "000680.SH", name: "科创综指", display: "科创综指", group: "main", margin: true },
        { code: "899050", ifind: "899050.BJ", name: "北证50", display: "北证50", group: "main", margin: true },
        { code: "000300", ifind: "000300.SH", name: "沪深300", display: "沪深300", group: "main", margin: true },
        { code: "000905", ifind: "000905.SH", name: "中证500", display: "中证500", group: "main", margin: true },
        { code: "000852", ifind: "000852.SH", name: "中证1000", display: "中证1000", group: "main", margin: true },
        { code: "932000", ifind: "932000.CSI", name: "中证2000", display: "中证2000", group: "main", margin: true },
        // 站在光里
        { code: "931723", ifind: "931723.CSI", name: "光通信", display: "CPO", group: "light", margin: true },
        { code: "000685", ifind: "000685.SH", name: "科创芯片", display: "科创芯片", group: "light", margin: true },
        { code: "950125", ifind: "950125.SH", name: "科创半导体材料设备", display: "半导体设备", group: "light", margin: true },
        { code: "885959", ifind: "885959.TI", name: "PCB概念", display: "PCB", group: "light", margin: true },
        { code: "886042", ifind: "886042.TI", name: "存储芯片", display: "存储", group: "light", margin: true },
        { code: "886084", ifind: "886084.TI", name: "光纤概念", display: "光纤", group: "light", margin: true },
        // 主题行业
        { code: "H11059", ifind: "H11059.CSI", name: "工业有色", display: "工业有色", group: "sector", margin: true },
        { code: "931994", ifind: "931994.CSI", name: "电网设备", display: "电网设备", group: "sector", margin: true },
        { code: "930986", ifind: "930986.CSI", name: "金融科技", display: "金融科技", group: "sector", margin: true },
        { code: "399998", ifind: "399998.SZ", name: "中证煤炭", display: "煤炭", group: "sector", margin: true },
        { code: "H30590", ifind: "H30590.CSI", name: "机器人", display: "机器人", group: "sector", margin: true },
        { code: "931594", ifind: "931594.CSI", name: "卫星产业", display: "卫星", group: "sector", margin: true },
        { code: "931151", ifind: "931151.CSI", name: "中证光伏产业", display: "光伏", group: "sector", margin: true },
        { code: "931152", ifind: "931152.CSI", name: "CS创新药", display: "创新药", group: "sector", margin: true },
        { code: "886099", ifind: "886099.TI", name: "AI智能体", display: "AI应用", group: "sector", margin: true },
        { code: "881267", ifind: "881267.TI", name: "能源金属", display: "锂矿", group: "sector", margin: true },
        { code: "930901", ifind: "930901.CSI", name: "动漫游戏", display: "动漫游戏", group: "sector", margin: true },
        { code: "000813", ifind: "000813.CSI", name: "细分化工", display: "化工", group: "sector", margin: true },
        { code: "885525", ifind: "885525.TI", name: "白酒概念", display: "白酒", group: "sector", margin: true },
        { code: "931719", ifind: "931719.CSI", name: "CS电池", display: "电池", group: "sector", margin: true },
        { code: "931238", ifind: "931238.CSI", name: "SSH黄金股票", display: "黄金股", group: "sector", margin: true },
        { code: "881145", ifind: "881145.TI", name: "电力", display: "电力", group: "sector", margin: true },
        { code: "000949", ifind: "000949.CSI", name: "中证农业", display: "农业", group: "sector", margin: true },
        { code: "931946", ifind: "931946.CSI", name: "中证畜牧养殖", display: "猪猪", group: "sector", margin: true },
        { code: "930601", ifind: "930601.CSI", name: "中证软件服务", display: "软件", group: "sector", margin: true },
        { code: "399975", ifind: "399975.SZ", name: "证券公司", display: "证券", group: "sector", margin: true },
        // SmartBeta
        { code: "H30269", ifind: "H30269.CSI", name: "红利低波", display: "红利低波", group: "smartbeta", margin: true },
        { code: "980092", ifind: "980092.SZ", name: "国证自由现金流", display: "自由现金流", group: "smartbeta", margin: true },
        { code: "883418", ifind: "883418.TI", name: "微盘股", display: "微盘股", group: "smartbeta", margin: true },
        { code: "980081", ifind: "980081.SZ", name: "价值100", display: "价值100", group: "smartbeta", margin: true },
    ];

    // ━━━ 指标参数（与 Excel 温度计完全一致）━━━
    var RSI_PERIOD = 6;
    var PERCENTRANK_WINDOW = 180;
    var LOW_FREQ_WINDOW = 120;
    var MA_PERIODS = [5, 20, 60];

    // ━━━ 市场状态区间 ━━━
    var MARKET_STATES = [
        { low: 0,  high: 10,  name: "冰点", color: "#00BFFF" },
        { low: 10, high: 20,  name: "恐惧", color: "#1E90FF" },
        { low: 20, high: 40,  name: "偏冷", color: "#32CD32" },
        { low: 40, high: 60,  name: "中性", color: "#FFD700" },
        { low: 60, high: 80,  name: "偏热", color: "#FF8C00" },
        { low: 80, high: 90,  name: "过热", color: "#FF4500" },
        { low: 90, high: 101, name: "狂热", color: "#FF0000" },
    ];

    // ━━━ 行业指数专用参数 ━━━
    var SECTOR_PARAMS = {
        price_ma_period: 120,
        price_dev_range: 30,
        turnover_ma_period: 60,
        turnover_ratio_max: 3.0,
        rsi_period: 14,
        percentrank_pe_window: 365,
        percentrank_rsi_window: 365,
    };

    // ━━━ 自定义指数（localStorage 持久化）━━━
    var CUSTOM_SK = "a_stock_custom_indexes_v1";

    function normalizeIfindCode(value) {
        var code = String(value || "").trim().toUpperCase();
        if (!code || code.indexOf(".") >= 0) return code;
        if (/^93\d{4}$/.test(code) || /^H\d{5}$/.test(code)) return code + ".CSI";
        if (/^399\d{3}$/.test(code) || /^159\d{3}$/.test(code)) return code + ".SZ";
        if (/^88\d{4}$/.test(code)) return code + ".TI";
        if (/^899\d{3}$/.test(code)) return code + ".BJ";
        if (/^[56]\d{5}$/.test(code) || /^95\d{4}$/.test(code)) return code + ".SH";
        return code;
    }

    function getCustomIndexes() {
        try {
            var s = localStorage.getItem(CUSTOM_SK);
            if (s) {
                var indexes = JSON.parse(s);
                var changed = false;
                indexes.forEach(function (index) {
                    var normalized = normalizeIfindCode(index.ifind);
                    if (normalized !== index.ifind) {
                        index.ifind = normalized;
                        changed = true;
                    }
                });
                if (changed) localStorage.setItem(CUSTOM_SK, JSON.stringify(indexes));
                return indexes;
            }
        } catch (e) { /* ignore */ }
        return [];
    }

    function saveCustomIndexes(arr) {
        try { localStorage.setItem(CUSTOM_SK, JSON.stringify(arr)); } catch (e) { /* ignore */ }
    }

    function getAllIndexes() {
        return INDEXES.concat(getCustomIndexes());
    }

    // ━━━ 辅助函数 ━━━
    function getIndexByCode(code) {
        var all = getAllIndexes();
        for (var i = 0; i < all.length; i++) {
            if (all[i].code === code) return all[i];
        }
        return null;
    }

    function getIndexesByGroup(group) {
        return getAllIndexes().filter(function (idx) { return idx.group === group; });
    }

    function getMarketState(score) {
        if (score === null || score === undefined || isNaN(score)) {
            return { name: "未知", color: "#888888" };
        }
        var v = score * 100;
        for (var i = 0; i < MARKET_STATES.length; i++) {
            var s = MARKET_STATES[i];
            if (v >= s.low && v < s.high) return { name: s.name, color: s.color };
        }
        if (v < 0) return { name: MARKET_STATES[0].name, color: MARKET_STATES[0].color };
        return { name: MARKET_STATES[MARKET_STATES.length - 1].name, color: MARKET_STATES[MARKET_STATES.length - 1].color };
    }

    // ━━━ 5级情绪（海报用，与Python data_service._emotion一致）━━━
    function getEmotion(score) {
        var v = Math.max(0, Math.min(100, score));
        if (v < 10) return { label: "冰点", color: "#007AFF" };
        if (v < 20) return { label: "恐惧", color: "#5AC8FA" };
        if (v < 80) return { label: "中性", color: "#34C759" };
        if (v < 90) return { label: "贪婪", color: "#FF9500" };
        return { label: "狂热", color: "#FF3B30" };
    }

    // ━━━ 公开接口 ━━━
    return {
        PROXY_BASE: PROXY_BASE,
        INDEXES: INDEXES,
        CUSTOM_SK: CUSTOM_SK,
        getCustomIndexes: getCustomIndexes,
        saveCustomIndexes: saveCustomIndexes,
        normalizeIfindCode: normalizeIfindCode,
        getAllIndexes: getAllIndexes,
        RSI_PERIOD: RSI_PERIOD,
        PERCENTRANK_WINDOW: PERCENTRANK_WINDOW,
        LOW_FREQ_WINDOW: LOW_FREQ_WINDOW,
        MA_PERIODS: MA_PERIODS,
        MARKET_STATES: MARKET_STATES,
        SECTOR_PARAMS: SECTOR_PARAMS,
        getIndexByCode: getIndexByCode,
        getIndexesByGroup: getIndexesByGroup,
        getMarketState: getMarketState,
        getEmotion: getEmotion,
    };
})();
