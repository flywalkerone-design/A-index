"""
A股市场温度计 - 日志模块
基于 loguru，支持控制台 + 文件双输出
"""

import sys
from pathlib import Path
from loguru import logger

# 引入配置
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import LOGS_DIR, LOG_LEVEL, LOG_RETENTION, LOG_ROTATION


def setup_logger():
    """
    初始化日志系统
    - 控制台输出：带颜色，方便开发调试
    - 文件输出：持久化存储，方便追溯
    """
    # 移除默认处理器
    logger.remove()

    # 控制台输出（简洁格式）
    logger.add(
        sys.stdout,
        level=LOG_LEVEL,
        format="<green>{time:HH:mm:ss}</green> | "
               "<level>{level:^7}</level> | "
               "<cyan>{module}</cyan> - <level>{message}</level>",
        colorize=True,
    )

    # 确保日志目录存在
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # 文件输出（详细格式，按日期轮转）
    log_file = LOGS_DIR / "market_temp_{time:YYYY-MM-DD}.log"
    logger.add(
        str(log_file),
        level=LOG_LEVEL,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:^7} | {module}:{line} - {message}",
        rotation=LOG_ROTATION,       # 单文件最大10MB
        retention=LOG_RETENTION,     # 保留30天
        encoding="utf-8",
    )

    return logger


# 模块加载时自动初始化
log = setup_logger()
