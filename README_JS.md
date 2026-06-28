# A股温度计 - JavaScript 前端版

## 架构说明

### 两种工作模式

本应用支持两种工作模式，可在界面上实时切换：

#### 模式1：Python计算（默认）
```
浏览器/WebView → proxy.py（本地）→ Python计算引擎 → 返回JSON → 前端渲染
```
- 前端只负责UI渲染，所有计算在Python端完成
- 与原版行为完全一致
- 适合快速验证

#### 模式2：前端计算
```
浏览器/WebView → proxy.py（本地）→ iFinD API → 返回原始数据 → 前端JS计算 → 渲染
```
- 指标计算（RSI、PERCENTRANK.INC等）全部在JavaScript中完成
- proxy.py只做CORS代理转发，零计算逻辑
- 更接近"纯前端APP"的目标

### 文件结构

```
温度计APP/
├── proxy.py                    # CORS代理 + 静态文件服务
├── requirements-js.txt         # Python依赖
├── ifind_token.txt             # iFinD token
├── www/                        # 前端文件
│   ├── index.html              # 主页面
│   └── js/
│       ├── config.js           # 配置（28个指数、参数、状态映射）
│       ├── indicators.js       # 指标计算引擎（RSI、PERCENTRANK.INC）
│       ├── scoring.js          # 温度评分系统
│       ├── fetch.js            # 数据获取模块
│       └── app.js              # 主应用逻辑
├── utils/                      # 原Python计算模块（保留，模式1使用）
│   ├── ifind_data.py
│   ├── indicators.py
│   ├── scoring.py
│   └── logger.py
├── data_service.py             # 原数据服务（保留，模式1使用）
├── config.py                   # 原Python配置（保留）
└── main.py                     # 原Kivy入口（保留，参考用）
```

## 快速开始

### 1. 安装依赖
```bash
pip install -r requirements-js.txt
```

### 2. 确保 iFinD token 有效
```bash
# 检查 ifind_token.txt 是否存在且未过期
python -c "from utils.ifind_data import _ensure_token; _ensure_token(); print('OK')"
```

### 3. 启动服务器
```bash
python proxy.py
```

### 4. 打开浏览器
访问 http://localhost:5000

- 默认使用"Python计算"模式
- 点击"⚡ 前端计算"切换到纯JS计算模式

## JS 计算引擎说明

### indicators.js - 指标计算
完全复刻 Python `utils/indicators.py` 的逻辑：

| 函数 | 说明 | 对应Python函数 |
|------|------|---------------|
| `calcMA()` | 移动平均线 MA5/20/60 | `calc_ma()` |
| `calcDailyReturn()` | 日涨跌幅 | `calc_daily_return()` |
| `calcRSI()` | RSI（Wilder平滑，周期=6） | `calc_rsi()` |
| `percentrankInc()` | PERCENTRANK.INC 滚动百分位排名 | `percentrank_inc()` |
| `calcAllPercentileRanks()` | 5个因子的百分位排名 | `calc_all_percentile_ranks()` |
| `calcAll()` | 一键计算全部指标 | `calc_all_indicators()` |

### scoring.js - 温度评分
完全复刻 Python `utils/scoring.py` 的逻辑：

| 函数 | 说明 | 对应Python函数 |
|------|------|---------------|
| `calcMarketScore()` | 5因子等权平均 | `calc_market_score()` |
| `calcLowFreqTemperature()` | 二次PERCENTRANK（窗口=120） | `calc_low_freq_temperature()` |
| `calcTemperature()` | 完整温度计算流程 | `calc_market_temperature()` |
| `getScoreDetails()` | 获取温度详情 | `get_score_details()` |

## 打包为 Android APK

### 方案A：WebView壳 + 本地proxy
1. 使用现有 `main.py`（Kivy + WebView）
2. 将 `www/` 目录嵌入APK
3. 启动时自动运行 `proxy.py` 在后台

### 方案B：WebView壳 + 远程proxy
1. 将 `proxy.py` 部署到云服务器
2. 修改 `config.js` 中的 `PROXY_BASE` 为远程地址
3. WebView壳只需加载远程URL

### 方案C：纯离线（需要其他数据源）
1. 替换数据获取源（如使用免费的AkShare数据）
2. 数据预处理后存入本地JSON
3. 完全离线运行

## 注意事项

1. **iFinD token 有效期约7天**，过期后需要更新
2. **CORS限制**：浏览器无法直接访问 iFinD API，必须通过 proxy.py 中转
3. **计算精度**：JS版与Python版的计算结果完全一致（PERCENTRANK.INC已精确复刻）
4. **性能**：28个指数的前端计算模式首次加载约需30-60秒（取决于网络）
