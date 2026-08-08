# 🍃 澜山 — 学习时长统计工具

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> 🇨🇳 中文 · 🇬🇧 [English](#english)

Windows 桌面学习伴侣，后台默默记录学习时长，打开就是漂亮的统计面板。

## ✨ 功能

- 📊 **仪表盘** — 三科进度条（双档目标 + 当日盈余金光）、科目环形图、7 天趋势折线图
- 🔥 **热力图** — 按科目达标数 3 级着色，按月视图，悬停/点击交互，支持盈余补签
- 🍅 **专注模式** — 全屏专注桌面 + 窗口级锁定，白名单外窗口自动关闭，Esc/快捷键逃生
- 📅 **专注日程** — 按每日学习时段到点自动进入/结束专注，宽松/严格双模式，粘贴日程表一键导入
- 💰 **补签系统** — 超额时长累积为科目盈余池，手动补签最近空缺，格子圆点标记
- 📜 **刻章系统** — 38 枚刻章：累积类（永久珍藏/永久佩戴）+ 每日类（当天盖印/仅当天佩戴），主页 4×2 佩戴格，逐日回放任意历史
- 🖱 **托盘快捷切换** — 右键切换当前科目，图标跟随变色，覆盖模糊条目
- 🕐 **今日时间轴** — 横向 24h 滚动，智能合并，未分类条目可手动标记
- 🌗 **浅色/深色主题** — CSS 变量双主题切换
- 📋 **分类规则管理** — 设置页自定义关键词规则（标题/进程名/URL）
- 🔒 **数据完全本地** — SQLite 存储，不上传任何服务器

## 🚀 快速开始

```bash
npm install
npm run dev
```

> 前提：需要安装并运行 [ActivityWatch](https://activitywatch.net/)（`localhost:5600`）

## 📦 打包

```bash
npm run pack
```

`release/澜山.exe` 即绿色免安装版。

## 🏗 技术架构

### 双进程架构

```
┌─────────────────────────┐     IPC      ┌─────────────────────────┐
│   Electron 主进程       │◄───────────►│   React 渲染进程         │
│                         │             │                         │
│  ├─ ActivityWatch 同步  │             │  ├─ 仪表盘              │
│  ├─ SQLite 数据库       │             │  ├─ 热力图              │
│  ├─ 系统托盘            │             │  ├─ 刻章册              │
│  ├─ 分类引擎            │             │  ├─ 时间轴              │
│  ├─ 提醒服务            │             │  ├─ 专注模式            │
│  ├─ 专注覆盖层          │             │  └─ 设置                │
│  ├─ 日程调度            │
│  ├─ 补签/盈余引擎       │             └─────────────────────────┘
│  └─ PowerShell 辅助     │
└─────────────────────────┘
```

### 数据流

```
ActivityWatch（localhost:5600）
        │ 每 30s / 手动刷新
        ▼
拉取窗口事件（标题 + 进程名 + URL）
        │
        ▼
分类引擎：关键词匹配 → 托盘覆盖 → 模糊检测
        │
        ▼
SQLite raw_events → merged_segments → daily_stats
        │
        ▼
前端 Recharts 渲染 / 刻章判定 / 热力图计算
```

### 分类系统

```
优先级：标题关键词 > 托盘当前科目 > 模糊检测 > 跳过

标题关键词： "数学课程"   → 📐 数学
            "英语听力"   → 📖 英语
            "物理讲座"   → ⚡ 物理

托盘覆盖：   视频播放器 + 托盘设为物理 → ⚡ 物理

模糊检测：   视频播放器 + 无托盘科目 → ❓ 未分类（可手动标记）

跳过：      聊天软件、资源管理器、锁屏等非学习条目 → 不入库
```

### 专注模式（🍅）

- 全屏专注桌面覆盖所有显示器，任务栏隐藏，白名单软件可正常使用
- 窗口级锁定：按标题关键词只放行匹配窗口
- 启动栏：最小化窗口点击直接弹回；点了 ✕ 的程序自动杀进程重启；右键图标可强制重启/删除后台；🪟 面板查看任务栏最小化的程序
- 不匹配的视频窗口自动关闭（WM_CLOSE 优先、强杀兜底），主界面 30 秒宽限期
- 逃生机制：右下角结束/退出按钮、Esc、Ctrl+Shift+F10 全局快捷键
- 会话持久化：正常退出恢复锁屏，崩溃重启自动清理现场，任务栏自动恢复

### 专注日程（📅）

- 设置页配置每日**学习时段**（粘贴整张日程表自动解析 / 手动逐条添加），休息时段无需设置
- 到点自动进入专注、到点自动结束；专注结束发休息提醒（距下次专注开始剩余时间）
- **宽松模式**：手动提前结束后本时段不再自动进入，下个时段照常
- **严格模式**：手动退出 5 秒后自动重新进入；学习时段内锁定——不能切宽松、关闭/修改日程、提前结束专注或退出应用，时段结束自动解锁
- 崩溃/重启安全：无论正常关机还是强制重启，只要开机时仍处于学习时段内都会自动恢复锁屏/重新进入

### 补签与盈余（💰）

- 某天某科超过目标的时间 → 累积进该科盈余池（所有日期），设置页可见统计
- 补签范围可调：所有日期 / 当月 / 近 7 天（设置页切换，只影响哪些空缺可补）
- 手动补签：点击热力图格子 → 弹窗内按科目补签；补过的格子带圆点、tooltip 显示来源
- 盈余只影响展示层，不修改原始统计；进度条末尾金光 = 当天该科盈余

### 刻章系统（38 枚）

**累积刻章（16 枚，永久珍藏/永久佩戴）**——只看「截至当日」的累计数据：

| 分组 | 刻章 | 条件 |
|------|------|---------|
| 🌱 累计学习 | 破土(30h) → 抽枝(100h) → 成木(250h) | 总时长累计 |
| 🔥 连续打卡 | 三日火(3d) → 七日焰(7d) → 双周燃(14d) | 当日连续天数 |
| ⚡ 物理 / 🔢 数学 / 🔤 英语 | 初涉→半程→凌顶 | 单科累计时长 |
| 🏆 大满贯 | 三连绝世 | 当日达成连续第 3 个大满贯日 |

**每日刻章（22 枚，当天条件达成即盖印、仅当天佩戴，记录按日保留可回放）**：

| 分组 | 刻章 | 条件（当天） |
|------|------|---------|
| 🌊 单日爆发 | 一日澜山(6h) → 登顶(8h) → 大满贯日 | 核心三科 ≥ 6h / 8h / 三科全超额 |
| 🐴 逆袭 | 黑马(6h+) → 绝地(8h+) | 前一天 < 1h 且当天爆发 |
| 💥 单科暴击 | 物理/数学/英语暴击 | 单科 ≥ 4h |
| ⚖️ 均衡日 | 稳行者 | 三科都达标且不超额 |
| 🌄 晨行 | 初曙(7:30 前) → 晨光(7:00 前) → 黎明(6:30 前) | 当天开始学习时间 |
| 🌇 夜航 | 晚灯(21:50 后) → 夜烛(22:20 后) → 星伴(22:50 后) | 当天结束学习时间 |
| 🎯 极限专注 | 入定(≥2h) → 忘我(≥3h) → 化境(≥4h) | 当天最长连续专注段 |
| 🔥 狂热者 | 物理/数学/英语狂热者 | 当天该科超额（≥ 目标×1.5） |
| 🌗 朝暮行 | 朝暮行 | 同一天晨行 + 夜航 |

- 佩戴：统计主页左下角 **4×2 八个正方形格子**（图标+名字），累积刻章永久可戴，每日刻章仅当天有效、跨天自动摘下
- 逐日回放：主页日期导航回看任意一天盖下的刻章 + 截至该日的累积进度（与时间轴一致）
- 图标：38 枚刻章全部**自绘 SVG 线稿**（不用 emoji），内容直白、质变式递进——物理=单摆→完整牛顿摆、数学=直线→抛物线→正弦波、英语=书本+词汇量 1000/2500/3500、夜航=2/4/7 颗星、暴击/狂热者=科目字+闪电/火焰

### 时间轴合并规则

```
① 同类相邻：同一科目 + 间隔 < 2min → 合并为一段
② 噪音过滤：持续时间 < 30s → 丢弃
③ 间隙保留：两段学习之间 > 5min → 显示为空白
④ 穿插暂存：学习段中的短暂非学习（<5min）→ 折叠，点击展开可见
```

## 🛠 技术栈

- **框架**: Electron 43 + React 19 + TypeScript
- **构建**: Vite + electron-vite
- **样式**: TailwindCSS 4
- **图表**: Recharts
- **存储**: SQLite（sql.js）
- **数据源**: ActivityWatch REST API（`localhost:5600`）
- **打包**: electron-builder（portable）

## 📖 详细架构

完整的项目架构、数据流、合并算法、数据库设计、排查指南见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 📄 许可证

[MIT](LICENSE)

---

## English

# 🍃 Lanshan — Study Time Tracker

A Windows desktop study companion that quietly tracks your study time in the background and presents a clean, motivating statistics dashboard.

> Note: the application UI is currently in Chinese (⚡ 物理 = Physics, 📐 数学 = Math, 📖 英语 = English).

### ✨ Features

- 📊 **Dashboard** — per-subject progress cards (dual-tier targets + gold glow when today's session has surplus), subject ring chart, 7-day trend chart
- 🔥 **Heatmap** — month view colored by how many subject targets were met, hover/click interactions, surplus makeup support
- 🍅 **Focus Mode** — fullscreen focus desktop with window-level locking; non-whitelisted windows are closed automatically; Esc / global hotkey escape hatch
- 📅 **Focus Schedule** — auto enters/exits focus at your daily study slots; loose / strict modes; paste a whole timetable to import
- 💰 **Makeup System** — over-target time accumulates into a per-subject surplus pool; manually fill gaps in the heatmap; filled cells show a dot marker
- 📜 **Seal System** — 38 seals: cumulative ones (permanent collection & wear) + daily ones (stamped on the day, wearable only that day); 4×2 wear grid on the dashboard; replay any past day
- 🖱 **Tray Quick Switch** — switch the current subject from the system tray; the tray icon color follows; overrides ambiguous entries
- 🕐 **Daily Timeline** — horizontal 24h scrolling view, smart segment merging, manual reclassification of unclassified entries
- 🌗 **Light / Dark Theme** — CSS-variable dual themes
- 📋 **Classification Rules** — custom keyword rules (title / process / URL) in Settings
- 🔒 **Fully Local** — SQLite storage, nothing leaves your machine

### 🚀 Quick Start

```bash
npm install
npm run dev
```

> Prerequisite: install and run [ActivityWatch](https://activitywatch.net/) (served at `localhost:5600`).

### 📦 Packaging

```bash
npm run pack
```

The portable build is emitted as `release/澜山.exe` — no installation needed.

### 🏗 Architecture

#### Dual-process design

```
┌─────────────────────────┐     IPC      ┌─────────────────────────┐
│   Electron Main Process │◄───────────►│   React Renderer        │
│                         │             │                         │
│  ├─ ActivityWatch sync  │             │  ├─ Dashboard           │
│  ├─ SQLite database     │             │  ├─ Heatmap             │
│  ├─ System tray         │             │  ├─ Seal album          │
│  ├─ Classification eng. │             │  ├─ Timeline            │
│  ├─ Reminder service    │             │  ├─ Focus mode          │
│  ├─ Focus overlay       │             │  └─ Settings            │
│  ├─ Schedule engine     │
│  ├─ Makeup engine       │             └─────────────────────────┘
│  └─ PowerShell helper   │
└─────────────────────────┘
```

#### Data flow

```
ActivityWatch (localhost:5600)
        │ every 30s / manual refresh
        ▼
Fetch window events (title + process + URL)
        │
        ▼
Classification engine: keyword match → tray override → fuzzy detection
        │
        ▼
SQLite raw_events → merged_segments → daily_stats
        │
        ▼
Frontend rendering (Recharts) / seal checks / heatmap computation
```

#### Classification system

```
Priority: title keyword > tray subject > fuzzy detection > skip

Title keywords:  "Math course"         → 📐 Math
                 "English listening"   → 📖 English
                 "Physics lecture"     → ⚡ Physics

Tray override:   Video player + tray set to Physics → ⚡ Physics

Fuzzy detection: Video player + no tray subject → ❓ Unclassified (mark manually)

Skipped:         chat apps, file explorer, lock screen, etc. → not recorded
```

#### Focus Mode (🍅)

- Fullscreen focus desktop covers all displays; taskbar hidden; whitelisted apps remain usable
- Window-level locking: only windows whose title matches the configured keyword are allowed
- Non-matching video windows are closed automatically (graceful WM_CLOSE first, forced kill as fallback); the main UI gets a 30-second grace period
- Escape hatches: end/exit button, Esc, and a Ctrl+Shift+F10 global hotkey
- Session persistence: quitting cleanly restores the lock screen; crash recovery cleans up automatically and restores the taskbar

#### Focus Schedule (📅)

- Configure daily **study slots** in Settings (paste a whole timetable to auto-parse, or add rows manually); rest periods need no setup
- Auto-enters focus at each slot start and auto-ends at slot end; a break notification shows the time until the next slot
- **Loose mode**: after a manual early exit the current slot is not re-entered; the next slot works as usual
- **Strict mode**: re-enters 5 seconds after a manual exit; while inside a study slot, switching to loose mode, editing/closing the schedule, ending focus, or quitting the app are all locked until the slot ends
- Crash / reboot safe: whether you shut down cleanly or force-power-off, rebooting inside a study slot restores the lock screen / re-enters automatically

#### Makeup & Surplus (💰)

- Whenever a subject's daily total exceeds its target, the surplus enters that subject's pool (accumulated across all dates)
- The fill range is configurable: all dates / current month / last 7 days (Settings; affects only which gaps can be filled)
- Manual makeup: click a heatmap cell → fill per subject in the dialog; filled cells show a dot and the tooltip reveals the source date
- The surplus layer never modifies the raw stats; the gold glow at the end of a progress bar shows today's surplus for that subject

#### Seal system (38 total)

**Cumulative seals (16, permanent collection & wear)** — judged on data up to (and including) the current day:

| Group | Seals | Condition |
|-------|--------------|-----------|
| 🌱 Cumulative | Sprout(30h) → Branch(100h) → Tree(250h) | total study time |
| 🔥 Streak | 3-day → 7-day → 14-day | current consecutive days |
| ⚡ Physics / 🔢 Math / 🔤 English | Novice → Halfway → Master | per-subject totals |
| 🏆 Grand slam | Triple streak | 3 consecutive grand-slam days |

**Daily seals (22, earned on the day the condition is met, wearable only that day; records kept per day and replayable)**:

| Group | Seals | Condition (that day) |
|-------|--------------|-----------|
| 🌊 Single-day burst | Mountain(6h) → Summit(8h) → Grand slam | core subjects ≥ 6h / 8h / all three exceeded |
| 🐴 Comeback | Dark horse(6h+) → Last stand(8h+) | previous day < 1h followed by a big day |
| 💥 Subject crit | Physics/Math/English crit | single subject ≥ 4h |
| ⚖️ Balanced day | Steady walker | all three met without exceeding |
| 🌄 Morning lark | First light(≤7:30) → Morning light(≤7:00) → Daybreak(≤6:30) | start time that day |
| 🌇 Night owl | Lamp(≥21:50) → Candle(≥22:20) → Stars(≥22:50) | end time that day |
| 🎯 Deep focus | Focused(≥2h) → Absorbed(≥3h) → Trance(≥4h) | longest continuous session |
| 🔥 Fanatic | Physics/Math/English fanatic | that subject exceeded (≥ 1.5× target) |
| 🌗 Dawn-dusk | Dawn-dusk | morning + night on the same day |

- Wear: a **4×2 (8 slots) grid** at the bottom-left of the dashboard (square tiles with names); cumulative seals are permanently wearable, daily seals expire at midnight
- Replay: the dashboard date navigation shows which seals were stamped on any past date, plus cumulative progress as of that date (same pattern as the timeline)
- Icons: all 38 seals are **hand-drawn SVG line icons** (no emoji) — physics = pendulum → full Newton's cradle, math = line → parabola → sine wave, English = book + vocabulary 1000/2500/3500, night = 2/4/7 stars, crits/fanatics = subject character + bolt/flame

#### Timeline merging rules

```
① Adjacent merge: same subject + gap < 2min → merge into one segment
② Noise filter:   duration < 30s → drop
③ Gap keeping:    > 5min between study segments → show as blank
④ Interleave:     brief non-study (< 5min) inside a study block → folded, expandable
```

### 🛠 Tech Stack

- **Framework**: Electron 43 + React 19 + TypeScript
- **Build**: Vite + electron-vite
- **Styling**: TailwindCSS 4
- **Charts**: Recharts
- **Storage**: SQLite (sql.js)
- **Data source**: ActivityWatch REST API (`localhost:5600`)
- **Packaging**: electron-builder (portable)

### 📖 Detailed Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture, data flow, merging algorithm, database design, and troubleshooting guide.

### 📄 License

[MIT](LICENSE)
