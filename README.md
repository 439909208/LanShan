# 🍃 Lanshan — Study Time Tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A Windows desktop study companion that quietly tracks your study time in the background and presents a clean, motivating statistics dashboard.

> Note: the application UI is currently in Chinese (⚡ 物理 = Physics, 📐 数学 = Math, 📖 英语 = English).

## ✨ Features

- 📊 **Dashboard** — per-subject progress cards (dual-tier targets + gold glow when today's session has surplus), subject ring chart, 7-day trend chart
- 🔥 **Heatmap** — month view colored by how many subject targets were met, hover/click interactions, surplus makeup support
- 🍅 **Focus Mode** — fullscreen focus desktop with window-level locking; non-whitelisted windows are closed automatically; Esc / global hotkey escape hatch
- 💰 **Makeup System** — over-target time accumulates into a per-subject surplus pool; manually fill gaps in the heatmap; filled cells show a dot marker
- 🏆 **Achievements** — 38 achievements (incl. hidden ones), auto-unlock with toast notifications
- 🖱 **Tray Quick Switch** — switch the current subject from the system tray; the tray icon color follows; overrides ambiguous entries
- 🕐 **Daily Timeline** — horizontal 24h scrolling view, smart segment merging, manual reclassification of unclassified entries
- 🌗 **Light / Dark Theme** — CSS-variable dual themes
- 📋 **Classification Rules** — custom keyword rules (title / process / URL) in Settings
- 🔒 **Fully Local** — SQLite storage, nothing leaves your machine

## 🚀 Quick Start

```bash
npm install
npm run dev
```

> Prerequisite: install and run [ActivityWatch](https://activitywatch.net/) (served at `localhost:5600`).

## 📦 Packaging

```bash
npm run pack
```

The portable build is emitted as `release/澜山.exe` — no installation needed.

## 🏗 Architecture

### Dual-process design

```
┌─────────────────────────┐     IPC      ┌─────────────────────────┐
│   Electron Main Process │◄───────────►│   React Renderer        │
│                         │             │                         │
│  ├─ ActivityWatch sync  │             │  ├─ Dashboard           │
│  ├─ SQLite database     │             │  ├─ Heatmap             │
│  ├─ System tray         │             │  ├─ Achievements        │
│  ├─ Classification eng. │             │  ├─ Timeline            │
│  ├─ Reminder service    │             │  ├─ Focus mode          │
│  ├─ Focus overlay       │             │  └─ Settings            │
│  ├─ Makeup engine       │             └─────────────────────────┘
│  └─ PowerShell helper   │
└─────────────────────────┘
```

### Data flow

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
Frontend rendering (Recharts) / achievement checks / heatmap computation
```

### Classification system

```
Priority: title keyword > tray subject > fuzzy detection > skip

Title keywords:  "Physics Lecture 03"   → ⚡ Physics
                 "Math Homework"        → 📐 Math
                 "English Listening"    → 📖 English

Tray override:   Video player + tray set to Physics → ⚡ Physics

Fuzzy detection: Video player + no tray subject → ❓ Unclassified (mark manually)

Skipped:         chat apps, file explorer, lock screen, etc. → not recorded
```

### Focus Mode (🍅)

- Fullscreen focus desktop covers all displays; taskbar hidden; whitelisted apps remain usable
- Window-level locking: only windows whose title matches the configured keyword are allowed (e.g. only the video titled "Physics Lecture")
- Non-matching video windows are closed automatically (graceful WM_CLOSE first, forced kill as fallback); the main UI gets a 30-second grace period
- Escape hatches: end/exit button, Esc, and a Ctrl+Shift+F10 global hotkey
- Session persistence: quitting cleanly restores the lock screen; crash recovery cleans up automatically and restores the taskbar

### Makeup & Surplus (💰)

- Whenever a subject's daily total exceeds its target, the surplus enters that subject's pool (accumulated across all dates)
- The fill range is configurable: all dates / current month / last 7 days (Settings; affects only which gaps can be filled)
- Manual makeup: click a heatmap cell → fill per subject in the dialog; filled cells show a dot and the tooltip reveals the source date
- The surplus layer never modifies the raw stats; the gold glow at the end of a progress bar shows today's surplus for that subject

### Achievement system (38 total)

| Group | Achievements | Dimension |
|-------|--------------|-----------|
| 🌱 Cumulative | Sprout(30h) → Branch(100h) → Tree(250h) | total study time |
| 🔥 Streak | 3-day → 7-day → 14-day | consecutive days |
| ⚡ Physics / 📐 Math / 📖 English | Novice → Halfway → Master | per-subject totals |
| 🌊 Single-day burst | Mountain(6h) → Summit(8h) | single-day total |
| 🌄 Morning lark | Dawn(5d) → Sunrise(10d) → Habit(18d) | first study before 07:00 |
| 🌙 Night owl | Lamp(5d) → Candle(10d) → Stars(18d) | last study after 22:00 |
| 🎯 Deep focus | Focused(3d≥2h) → Absorbed(7d≥2h) → Trance(3d≥3h) | longest continuous session |
| 🐴 Comeback | Dark horse(6h+) → Last stand(8h+) | low day followed by big day |
| 💥 Subject crit | Physics/Math/English crit | single subject ≥ 4h in a day |
| ⚖️ Balanced day | Steady walker | all three met without exceeding |
| 🌗 Dawn-dusk | Dawn-dusk | morning + night on the same day |
| 🎁 Hidden | Fanatic ×3 / Grand slam / Triple streak | revealed after unlock |

### Timeline merging rules

```
① Adjacent merge: same subject + gap < 2min → merge into one segment
② Noise filter:   duration < 30s → drop
③ Gap keeping:    > 5min between study segments → show as blank
④ Interleave:     brief non-study (< 5min) inside a study block → folded, expandable
```

## 🛠 Tech Stack

- **Framework**: Electron 43 + React 19 + TypeScript
- **Build**: Vite + electron-vite
- **Styling**: TailwindCSS 4
- **Charts**: Recharts
- **Storage**: SQLite (sql.js)
- **Data source**: ActivityWatch REST API (`localhost:5600`)
- **Packaging**: electron-builder (portable)

## 📖 Detailed Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture, data flow, merging algorithm, database design, and troubleshooting guide.

## 📄 License

[MIT](LICENSE)
