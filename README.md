# A股温度计 APP

## 打包成Android APK

### 方法一：Google Colab（推荐，免费云端Linux）

1. 打开 [Google Colab](https://colab.research.google.com)
2. 新建笔记本，依次执行以下代码块：

```python
# 第1步：安装buildozer
!pip install buildozer
!sudo apt-get install -y git zip unzip openjdk-17-jdk python3-pip autoconf libtool pkg-config zlib1g-dev libncurses5-dev libncursesw5-dev libtinfo5 cmake libffi-dev libssl-dev
```

```python
# 第2步：上传项目文件
# 先把整个 温度计APP 文件夹压缩成 zip，然后上传
from google.colab import files
uploaded = files.upload()  # 选择 温度计APP.zip
```

```python
# 第3步：解压并进入目录
!unzip -o 温度计APP.zip -d /content/stocktemp
%cd /content/stocktemp/温度计APP
```

```python
# 第4步：打包APK（首次约需30-60分钟）
!buildozer android debug
```

```python
# 第5步：下载APK
from google.colab import files
files.download('bin/stocktemp-1.0.0-debug.apk')
```

3. 把下载的APK传到手机安装即可

### 方法二：本地Linux（WSL或虚拟机）

```bash
# 安装依赖
sudo apt-get update
sudo apt-get install -y git zip unzip openjdk-17-jdk python3-pip autoconf libtool pkg-config zlib1g-dev libncurses5-dev libncursesw5-dev libtinfo5 cmake libffi-dev libssl-dev
pip install buildozer

# 进入项目目录
cd /path/to/温度计APP

# 打包（首次约30-60分钟）
buildozer android debug

# APK输出在 bin/ 目录下
```

### 方法三：Windows用户快速方案

如果你不想打包APK，可以直接在手机上用 **Termux** 运行：

```bash
# 1. 从 F-Droid 下载安装 Termux: https://f-droid.org/packages/com.termux/

# 2. 在Termux中安装Python
pkg install python

# 3. 安装依赖
pip install flask pandas numpy requests loguru

# 4. 把 温度计APP 文件夹复制到手机存储
#    例如放在 /sdcard/温度计APP/

# 5. 运行
cd /sdcard/温度计APP
python server.py

# 6. 手机浏览器访问 http://localhost:5000
```

---

## PC端测试

```bash
pip install flask pandas numpy requests loguru
cd "E:\claude code\A股市场温度计\温度计APP"
python server.py
# 浏览器访问 http://localhost:5000
```

## 文件结构

```
温度计APP/
├── main.py              # Android入口（Kivy + WebView）
├── buildozer.spec       # APK打包配置
├── server.py            # Flask API服务
├── data_service.py      # 数据获取+计算
├── config.py            # 指数配置
├── ifind_token.txt      # iFinD token
├── A股温度计_自定义版.html  # 前端页面
└── utils/
    ├── ifind_data.py    # iFinD API
    ├── indicators.py    # 技术指标
    ├── scoring.py       # 温度计算
    └── logger.py        # 日志
```

## Token管理

- APP内：⚙️设置 → 🔑Token管理 → 粘贴新token
- 手动：编辑 `ifind_token.txt` 文件
- 有效期约7天，过期后需更新
