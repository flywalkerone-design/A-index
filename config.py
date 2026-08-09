"""
A股市场温度计 - 全局配置
所有路径、参数、常量集中管理
"""

from pathlib import Path

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 路径配置（全部基于项目根目录，不写死绝对路径）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT_ROOT = Path(__file__).resolve().parent          # 项目根目录
DATA_DIR = PROJECT_ROOT / "data"                        # 数据目录
OUTPUT_DIR = PROJECT_ROOT / "output"                    # 输出目录
CHARTS_DIR = OUTPUT_DIR / "charts"                      # 图表目录
REPORTS_DIR = OUTPUT_DIR / "reports"                    # 日报目录
LOGS_DIR = OUTPUT_DIR / "logs"                          # 日志目录
HTML_DIR = PROJECT_ROOT                                  # HTML报告直接放项目根目录
EXCEL_PATH = DATA_DIR / "market_data.xlsx"              # Excel数据文件

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 数据源配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
INDEX_SYMBOL = "sh000985"           # 中证全指代码（腾讯源）
INDEX_NAME = "上证指数"             # 指数名称
CSINDEX_CODE = "000001"             # 中证指数代码（用于PE数据）
MARGIN_SOURCE = "sse"               # 融资融券数据来源：sse / szse
DATA_START_DATE = "2024-01-01"      # 数据起始日期（与Excel对齐）

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 多指数配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
INDEXES = [
    # 主要指数（固定显示在顶部）
    {"code": "000001", "ifind_code": "000001.SH", "name": "上证指数", "display_name": "上证指数", "margin": True, "group": "main"},
    {"code": "399102", "ifind_code": "399102.SZ", "name": "创业板综", "display_name": "创业板", "margin": True, "group": "main"},
    {"code": "000680", "ifind_code": "000680.SH", "name": "科创综指", "display_name": "科创综指", "margin": True, "group": "main"},
    {"code": "899050", "ifind_code": "899050.BJ", "name": "北证50", "display_name": "北证50", "margin": True, "group": "main"},
    # 站在光里（2×6 固定板块）
    {"code": "931723", "ifind_code": "931723.CSI", "name": "光通信", "display_name": "CPO", "margin": True, "group": "light"},
    {"code": "000685", "ifind_code": "000685.SH", "name": "科创芯片", "display_name": "科创芯片", "margin": True, "group": "light"},
    {"code": "950125", "ifind_code": "950125.SH", "name": "科创半导体材料设备", "display_name": "半导体设备", "margin": True, "group": "light"},
    {"code": "885959", "ifind_code": "885959.TI", "name": "PCB概念", "display_name": "PCB", "margin": True, "group": "light"},
    {"code": "886042", "ifind_code": "886042.TI", "name": "存储芯片", "display_name": "存储", "margin": True, "group": "light"},
    {"code": "886084", "ifind_code": "886084.TI", "name": "光纤概念", "display_name": "光纤", "margin": True, "group": "light"},
    # 主题行业（4×4 色块，剩余指数）
    {"code": "H11059", "ifind_code": "H11059.CSI", "name": "工业有色", "display_name": "工业有色", "margin": True, "group": "sector"},
    {"code": "931994", "ifind_code": "931994.CSI", "name": "电网设备", "display_name": "电网设备", "margin": True, "group": "sector"},
    {"code": "930986", "ifind_code": "930986.CSI", "name": "金融科技", "display_name": "金融科技", "margin": True, "group": "sector"},
    {"code": "399998", "ifind_code": "399998.SZ", "name": "中证煤炭", "display_name": "煤炭", "margin": True, "group": "sector"},
    {"code": "H30590", "ifind_code": "H30590.CSI", "name": "机器人", "display_name": "机器人", "margin": True, "group": "sector"},
    {"code": "931594", "ifind_code": "931594.CSI", "name": "卫星产业", "display_name": "卫星", "margin": True, "group": "sector"},
    {"code": "399808", "ifind_code": "399808.SZ", "name": "中证新能", "display_name": "新能源", "margin": True, "group": "sector"},
    {"code": "931152", "ifind_code": "931152.CSI", "name": "CS创新药", "display_name": "创新药", "margin": True, "group": "sector"},
    {"code": "886099", "ifind_code": "886099.TI", "name": "AI智能体", "display_name": "AI应用", "margin": True, "group": "sector"},
    {"code": "881267", "ifind_code": "881267.TI", "name": "能源金属", "display_name": "锂矿", "margin": True, "group": "sector"},
    {"code": "930901", "ifind_code": "930901.CSI", "name": "动漫游戏", "display_name": "动漫游戏", "margin": True, "group": "sector"},
    {"code": "000813", "ifind_code": "000813.CSI", "name": "细分化工", "display_name": "化工", "margin": True, "group": "sector"},
    {"code": "885525", "ifind_code": "885525.TI", "name": "白酒概念", "display_name": "白酒", "margin": True, "group": "sector"},
    {"code": "931719", "ifind_code": "931719.CSI", "name": "CS电池", "display_name": "电池", "margin": True, "group": "sector"},
    {"code": "931238", "ifind_code": "931238.CSI", "name": "SSH黄金股票", "display_name": "黄金股", "margin": True, "group": "sector"},
    {"code": "881145", "ifind_code": "881145.TI", "name": "电力", "display_name": "电力", "margin": True, "group": "sector"},
    # SmartBeta（策略因子）
    {"code": "H30269", "ifind_code": "H30269.CSI", "name": "红利低波", "display_name": "红利低波", "margin": True, "group": "smartbeta"},
    {"code": "931752", "ifind_code": "931752.CSI", "name": "中证自由现金流", "display_name": "自由现金流", "margin": True, "group": "smartbeta"},
    {"code": "883418", "ifind_code": "883418.TI", "name": "微盘股", "display_name": "微盘股", "margin": True, "group": "smartbeta"},
]

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 指标参数（与 Excel 温度计完全一致）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
RSI_PERIOD = 6                      # RSI计算周期（Excel: 6）
PERCENTRANK_WINDOW = 180            # PERCENTRANK.INC 滚动窗口（180个交易日）
LOW_FREQ_WINDOW = 120               # 低频温度二次排名窗口（120个温度值）
MA_PERIODS = [5, 20, 60]            # 均线周期（辅助展示用）

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 温度评分权重（Excel: 6指标等权）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORE_WEIGHTS = {
    "rank_close": 1/5,              # 收盘价百分位
    "rank_turnover": 1/5,           # 成交额百分位
    "rank_pe": 1/5,                 # PE百分位
    "rank_rsi": 1/5,                # RSI百分位
    "rank_margin": 1/5,             # 融资余额百分位
}

SCORE_WEIGHTS_4F = {
    "rank_close": 1/4,              # 收盘价百分位
    "rank_turnover": 1/4,           # 成交额百分位
    "rank_pe": 1/4,                 # PE百分位
    "rank_rsi": 1/4,                # RSI百分位
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 行业指数专用参数（替代4因子PERCENTRANK）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTOR_PARAMS = {
    "price_ma_period": 120,          # 价格均线周期（计算偏离度）
    "price_dev_range": 30,           # 偏离度映射范围 ±30%
    "turnover_ma_period": 60,        # 成交额均线周期（计算比值）
    "turnover_ratio_max": 3.0,       # 成交额比值映射上限
    "rsi_period": 14,                # 行业RSI计算周期
    "percentrank_pe_window": 365,    # PE排名窗口
    "percentrank_rsi_window": 365,   # RSI排名窗口
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 市场状态区间
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
MARKET_STATES = [
    (0,  10,  "冰点",  "#00BFFF"),   # 深蓝
    (10, 20,  "恐惧",  "#1E90FF"),   # 蓝色
    (20, 40,  "偏冷",  "#32CD32"),   # 绿色
    (40, 60,  "中性",  "#FFD700"),   # 黄色
    (60, 80,  "偏热",  "#FF8C00"),   # 橙色
    (80, 90,  "过热",  "#FF4500"),   # 红橙
    (90, 101, "狂热",  "#FF0000"),   # 红色
]

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 图表样式
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHART_STYLE = {
    "figure_facecolor": "#0D1117",  # 图表背景色（深黑）
    "axes_facecolor":   "#161B22",  # 坐标轴背景色
    "text_color":       "#C9D1D9",  # 文字颜色
    "grid_color":       "#21262D",  # 网格线颜色
    "gold":             "#F0B90B",  # 金色（主色）
    "green":            "#26A69A",  # 绿色（涨）
    "red":              "#EF5350",  # 红色（跌）
    "blue":             "#1E90FF",  # 蓝色
    "font_family":      "SimHei",   # 中文字体
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 日志配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOG_LEVEL = "INFO"                  # 日志级别
LOG_RETENTION = "30 days"           # 日志保留时间
LOG_ROTATION = "10 MB"             # 日志文件大小限制
