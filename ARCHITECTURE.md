# 澜山 — 项目架构说明

> 版本：0.1.0 | 最后更新：2026-07-11

---

## 1. 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 28+ |
| 构建 | electron-vite |
| 前端 | React 18 + TypeScript + React Router |
| 样式 | Tailwind CSS (utility-first) |
| 数据库 | sql.js (SQLite 编译到 WebAssembly，内存运行，定时持久化到文件) |
| 数据源 | ActivityWatch v0.13+ (本地 HTTP API `localhost:5600`) |

---

## 2. 目录结构

```
澜山/
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.ts           # 应用入口：创建窗口、注册 IPC、启动同步
│   │   ├── database.ts        # 数据库层：建表、CRUD、统计查询
│   │   ├── sync.ts            # 同步引擎：AW 拉取 → 分类 → 合并 → 存储
│   │   ├── classifier.ts      # 分类器：根据规则判定科目
│   │   ├── activitywatch.ts   # AW HTTP 客户端：fetchEvents、bucket 发现
│   │   └── tray.ts            # 系统托盘：图标、科目切换菜单
│   │
│   ├── preload/
│   │   └── index.ts           # contextBridge：暴露 lanshan API 给渲染进程
│   │
│   └── renderer/              # React 渲染进程
│       ├── main.tsx           # React 入口
│       ├── App.tsx            # 根组件：路由、主题、顶部导航
│       ├── env.d.ts           # window.lanshan 类型声明
│       ├── index.css          # 全局样式 + CSS 变量
│       ├── utils.ts           # 格式化、图标映射
│       ├── pages/
│       │   ├── Dashboard.tsx  # 主仪表盘：科目卡片、环形图、时间轴
│       │   ├── Settings.tsx   # 设置页：分类规则、常规设置
│       │   ├── Achievements.tsx # 成就页
│       │   └── Heatmap.tsx    # 年度热力图
│       └── components/
│           ├── Timeline.tsx         # 时间轴：缩放、拆分、合并、重分类
│           ├── SubjectRingChart.tsx # SVG 环形图：5 科目分布
│           ├── WeekTrendChart.tsx   # 近 7 天趋势柱状图
│           ├── HeatmapGrid.tsx      # 年度热力图组件
│           ├── AchievementList.tsx  # 成就列表
│           ├── AchievementModal.tsx # 成就弹窗
│           ├── AchievementToast.tsx # 成就解锁通知
│           └── Toast.tsx           # 通用 Toast 通知
│
├── electron.vite.config.ts    # 构建配置
├── package.json
└── resources/                 # 图标等静态资源
```

---

## 3. 进程架构

```
┌─────────────────────────────────────────────────┐
│                   Electron                       │
│                                                  │
│  ┌────────── 主进程 (main) ────────────────┐    │
│  │                                          │    │
│  │  index.ts  ←── 应用生命周期               │    │
│  │    ├─ initDatabase()    初始化 sql.js     │    │
│  │    ├─ registerIpcHandlers()  注册 ~40 IPC │    │
│  │    ├─ createWindow()    创建 BrowserWindow│    │
│  │    ├─ createTray()      系统托盘          │    │
│  │    └─ startSync()       启动 30s 定时同步 │    │
│  │                                          │    │
│  │  sync.ts  ←── 同步引擎                   │    │
│  │  database.ts  ←── SQLite CRUD            │    │
│  │  classifier.ts  ←── 科目判定             │    │
│  │  activitywatch.ts  ←── AW HTTP           │    │
│  │  tray.ts  ←── 托盘管理                   │    │
│  └──────────────────────────────────────────┘    │
│           │ contextBridge (preload)               │
│           ▼                                       │
│  ┌────────── 渲染进程 (renderer) ───────────┐    │
│  │  React App                                │    │
│  │    ├─ Dashboard   → 仪表盘                │    │
│  │    ├─ Settings    → 设置                  │    │
│  │    └─ Achievements → 成就                 │    │
│  │                                           │    │
│  │  所有数据通过 window.lanshan.* IPC 获取    │    │
│  └───────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**关键设计**：渲染进程不能直接访问数据库或文件系统。所有数据操作通过 IPC (ipcMain.handle / ipcRenderer.invoke) 进行。preload 层用 `contextBridge.exposeInMainWorld` 暴露类型安全的 API。

---

## 4. 数据库设计（SQLite，sql.js）

### 4.1 表结构

```
raw_events          原始事件（一条 = AW 的一个窗口事件）
├── id              INTEGER PRIMARY KEY
├── aw_id           TEXT UNIQUE     ← AW 事件 ID，用于去重
├── timestamp       TEXT            ← ISO 时间戳
├── duration        INTEGER         ← 秒
├── app             TEXT            ← 进程名
├── title           TEXT            ← 窗口标题
├── url             TEXT            ← URL（浏览器事件）
└── subject         TEXT            ← 科目（物理/数学/英语/休闲/其他/NULL）

merged_segments     合并后的时间段（一条 = Timeline 上一个色块）
├── id              INTEGER PRIMARY KEY
├── date            TEXT            ← 日期 (YYYY-MM-DD)
├── start_time      TEXT            ← ISO 开始时间
├── end_time        TEXT            ← ISO 结束时间
├── duration        INTEGER         ← 秒
├── subject         TEXT            ← 主体科目
├── title           TEXT            ← 标题（取 duration 最长的）
├── app             TEXT            ← 应用
├── is_exploded     INTEGER         ← 0=父段 1=子成分（详情展开用）
└── parent_id       INTEGER         ← 父段 ID (is_exploded=1 时)

daily_stats         每日科目统计（一行 = 某天某科目的总秒数）
├── id              INTEGER PRIMARY KEY
├── date            TEXT            ← 日期
├── subject         TEXT            ← 科目
├── total_seconds   INTEGER         ← 总秒数
├── target_seconds  INTEGER         ← 目标秒数（默认 7200 = 2h）
├── achieved        INTEGER         ← 0/1 是否达标
├── exceeded        INTEGER         ← 0/1 是否超额（≥ 目标 × 1.5）
└── UNIQUE(date, subject)

classification_rules  用户自定义的分类规则
├── id              INTEGER PRIMARY KEY
├── subject         TEXT            ← 目标科目
├── keyword         TEXT            ← 匹配关键词
├── match_field     TEXT            ← 'title' | 'app' | 'url' | 'all'
└── priority        INTEGER         ← 优先级（越大越优先）

achievements        成就系统
settings            键值对设置
```

### 4.2 数据量级

- **raw_events**：每天约 200-500 条（取决于 AW 采集粒度）
- **merged_segments**：每天约 10-30 条（合并后）
- **daily_stats**：每天 1-5 行（每个有数据的科目一行）
- **持久化**：sql.js 内存数据库，每次写操作后调用 `save()` 序列化到文件

---

## 5. 核心数据流

### 5.1 整体流水线

```
ActivityWatch (localhost:5600)
        │
        │  HTTP GET /api/0/buckets/{id}/events
        ▼
  fetchEventsSince()
        │
        │  AWEvent[]{ id, timestamp, duration, data: {title, app, url} }
        ▼
  classifyEvent(title, app, url)
        │
        │  查 classification_rules 表 → 匹配关键词 → 返回 Subject
        ▼
  raw_events 表  ← INSERT (UPSERT by aw_id)
        │
        ├──────────────────────────────────┐
        ▼                                  ▼
  mergeSegments()                    SUM by subject
  连续同类事件合并                     GROUP BY subject
  短片段(<5min)吸收到邻居              (直接从 raw_events 聚合)
        │                                  │
        ▼                                  ▼
  merged_segments 表                 daily_stats 表
  (Timeline 显示用)                  (SubjectCard 统计用)
```

### 5.2 两条分支的关键区别

| | merged_segments | daily_stats |
|---|---|---|
| **用途** | Timeline 时间轴可视化 | SubjectCard 科目卡片统计 |
| **数据来源** | raw_events → mergeSegments() | raw_events → SUM GROUP BY |
| **是否允许丢失** | 允许短片段吸收（显示优化） | **不允许**，必须精确 |
| **更新频率** | 全量同步时全量重建 | 每次同步 + 每次手动操作后重建 |
| **⚠️ 历史 Bug** | 旧代码在吸收后过滤不同科目 constituent → 时长蒸发 | 旧代码从 merged_segments 取数 → 被污染 |

---

## 6. 同步引擎详解

### 6.1 两种同步模式

| 模式 | 触发方式 | 拉取范围 | 行为 |
|---|---|---|---|
| **后台同步** `syncActivityWatch()` | 定时器每 30s | 最近 2 小时 | 增量：跳过已存事件，只处理新的；**不重建** merged_segments |
| **全量同步** `syncFullToday()` | 手动点"刷新"按钮 | 今天 00:00 → 现在 | 全量：处理所有 AW 事件、**全量重建** merged_segments 和 daily_stats |

### 6.2 syncActivityWatch（后台增量同步）

```
1. fetchEventsSince(now-2h, now) → AW 事件列表
2. 读取 existingIds (raw_events 中已有的 aw_id)
3. 遍历事件：
   - duration < NOISE_THRESHOLD (0s) → 跳过
   - aw_id 已在 existingIds → 跳过（保留原分类）
   - classifyEvent(title, app, url)
     - 返回 null → 跳过（不相关，不入库）
     - 返回 subject → insertRawEvent()
4. 从 raw_events 重新 SUM → updateDailyStats()
   （只更新 daily_stats，不改 merged_segments——避免覆盖手动拆分/合并）
5. save() 持久化
6. 检查成就解锁
```

### 6.3 syncFullToday（全量同步）

```
1. 清除今天 daily_stats
2. fetchEventsSince(今天00:00, now)
3. 遍历所有事件 → classifyEvent → insertRawEvent (UPSERT by aw_id)
   → 不跳过已存事件：duration/timestamp 始终与 AW 保持同步
   → subject 由 ON CONFLICT 保留（不覆盖手动分类）
4. 兜底重分类：raw_events 中 subject∈('其他','未分类') 的事件，
   用最新规则重新判定，如果匹配到具体科目则 UPDATE
5. rebuildMergedSegments(today)
   ├── 从 raw_events 读取今天所有事件
   ├── mergeSegments() 合并
   ├── 写入 merged_segments 表
   └── 从 raw_events SUM → updateDailyStats()  ← 关键！不经过 merged_segments
6. save()
```

### 6.4 关键常量

| 常量 | 值 | 说明 |
|---|---|---|
| `SYNC_INTERVAL_MS` | 30,000 | 后台同步间隔（30 秒） |
| `MERGE_GAP_SECONDS` | 300 | 同科目事件间隔 ≤5min 合并为一段 |
| `NOISE_THRESHOLD_SECONDS` | 0 | 不过滤任何时长的 AW 事件 |
| `MIN_SEGMENT_SEC` | 300 | 短于 5min 的段可能被相邻段吸收 |
| `HEATMAP_MIN_TITLE_SEC` | 120 | 热力图详情页隐藏 ≤2min 的标题组 |
| `GAP_FILL_SEC` | 600 | 同科目段 ≤10min 空白自动补全合并 |

### 6.5 数据一致性规则

- **duration 不冻结**：同步不跳过已存事件，每次 UPSERT 都会刷新 duration/timestamp，确保长时间运行的窗口（如视频播放）的最终时长与 AW 一致。
- **手动分类不被覆盖**：`insertRawEvent` 的 `ON CONFLICT DO UPDATE` 不包含 `subject` 列，UPSERT 只更新元数据，保留用户手动设置的科目。
- **桶类型隔离**：`findWindowBuckets` 只使用 `window` 类型桶（finalized 时长），不与 `currentwindow` 混合，防止同窗口在不同桶中重复计数。
- **diag 日志**：`syncFullToday` 输出 AW 原始 per-title 汇总和 raw_events per-title 汇总，便于排查数据差异。

---

## 7. 合并算法 mergeSegments() 详解

位置：`src/main/sync.ts:441`

### 7.1 输入

从 raw_events 读取：`{ timestamp, duration, app, title, subject }[]`，按 timestamp 升序。

### 7.2 阶段 1：按科目分组（第 459-546 行）

```
遍历事件：
  如果与当前段同科目且间隔 ≤5min → 追加到当前段
  否则 → 保存当前段，开始新段

每个段记录：
  - subject: 科目
  - start/end: 开始/结束时间
  - duration: 所有构成事件的 duration 之和
  - constituents[]: 每个原始事件的 {subject, title, app, duration}
  - title: 取 titleDurations 中 duration 最长的标题
```

### 7.3 阶段 2：短片段吸收（第 548-581 行）

```
while 有变化：
  遍历所有段：
    如果 duration ≥ 300s → 跳过
    找到最近的邻居（优先同科目 → 分数 × 0.1）
    将短片段合并到邻居：
      - 调整邻居的 start/end
      - 邻居.duration += 片段.duration
      - 邻居.constituents.push(...片段.constituents)
      - 删除短片段
```

### 7.4 阶段 3：同科目间隙填充（第 584-603 行）

```
如果两个同科目段之间空白 < 10min → 合并（视觉连续性）
```

### 7.5 阶段 4：主导科目重算（第 605-623 行）

合并的最后一步**重新确定段的 subject 和 duration**，不依赖第一个事件的科目：

```
遍历所有段：
  按 subject 分组 constituents → 求每个科目的总时长
  取总时长最大的科目作为段的 subject
  段的 duration = 该科目所有 constituent 的总和

目的：
  - 当段的第一个事件是"休闲"但主体内容是"英语"时 → 段正确标记为"英语"
  - 被吸收的短片段不改变段的主体科目
  - 段的 duration 反映主体科目的实际总时长（而非所有科目的和）

注意：精确的科目总时长来自 daily_stats（直接 SUM raw_events）。
merged_segments 的 duration 仅用于 Timeline 可视化。
```

---

## 8. 分类系统

### 8.1 classifyEvent() 判定逻辑

位置：`src/main/classifier.ts:40`

```
输入：title (窗口标题), app (进程名), url (可选)
输出：{ subject, method } | null

优先级：
  1. 关键词匹配（查 classification_rules 表，按 priority 降序）
     - match_field='all'：在 title + app + url 中模糊搜索
     - match_field='title'/'app'/'url'：仅在指定字段搜索
     - 匹配到 → 返回对应 subject

  2. 模糊条目 （isAmbiguous）
     - app/title 匹配 "视频播放/百度网盘/baidunetdisk" 等
     - 有托盘科目 → 用托盘科目覆盖
     - 无托盘科目 → 返回 '其他'

  3. 兜底
     - 返回 '其他' (method='fallback')

返回 null 的情况：无
（所有事件都有分类——匹配规则/模糊/兜底三选一）
```

### 8.2 科目枚举

```
'物理' | '数学' | '英语' | '休闲' | '其他'
 CORE_SUBJECTS = ['物理', '数学', '英语']
```

### 8.3 分类规则存储

规则存在 `classification_rules` 表中（不在代码里硬编码）。用户通过设置页管理。添加规则后会自动对现有 raw_events 中匹配的事件重新分类（`reclassifyRawEventsByKeyword`）。

---

## 9. IPC 通信一览

所有渲染进程 → 主进程的通信通过 `window.lanshan.*` （preload 暴露）。

### 9.1 数据读取

| API | 返回 | 数据来源 |
|---|---|---|
| `getDailyStats(date)` | `DailyStat[]` | `daily_stats` 表 |
| `getTotalSecondsToday(date)` | `number` | `raw_events` SUM（三核心科目） |
| `getMergedSegments(date)` | `MergedSegment[]` | `merged_segments` 表 |
| `getWeekStats(days)` | `DayStat[]` | `daily_stats` 多日聚合 |
| `getYearHeatmap(year)` | `HeatmapCell[]` | `daily_stats` 年度聚合 |

### 9.2 数据修改

| API | 行为 | daily_stats 重建方式 |
|---|---|---|
| `syncNow()` | 全量同步 | `rebuildMergedSegments` → 从 raw_events SUM |
| `reclassifySegment(id, subj)` | 重分类单个段 | 从 raw_events SUM |
| `reclassifyByTitle(date, title, subj)` | 按标题批量重分类 | 从 raw_events SUM |
| `splitSegment(id, time)` | 拆分时间段 | 从 raw_events SUM |
| `mergeAdjacentSegments(id1, id2)` | 合并相邻段 | 从 raw_events SUM |
| `addClassificationRule(...)` | 添加规则 | `rebuildMergedSegments(today)` |
| `rebuildDailyStats(date)` | 重建某天统计 | 从 raw_events SUM（历史日期专用） |

> **关键原则**：所有 daily_stats 重建都必须从 `raw_events` SUM，绝不从 `merged_segments` 取数。

---

## 10. UI 组件数据流

### 10.1 Dashboard 页面

```
Dashboard
├── 日期导航栏 （◀ 日期选择 ▶ 今天）
│   └── 切换日期 → loadData()
│       ├── 非今天 → await rebuildDailyStats(date)  ← 从 raw_events 现场重建
│       └── await 并行拉取所有数据
│
├── SubjectRingChart  （SVG 环形图）
│   ├── 数据源：ringData（从 daily_stats 计算）
│   ├── 始终显示 5 个标签（物理/数学/英语/休闲/其他）
│   ├── 可自由开关每个科目的显示
│   └── 开关状态持久化到 localStorage
│
├── SubjectCard × 3  （核心科目进度卡片）
│   └── 数据源：progress（从 daily_stats 计算）
│
├── WeekTrendChart  （近 7 天趋势）
│   └── 数据源：weekData（从 getWeekStats 计算）
│
├── Timeline  （时间轴）
│   ├── 数据源：getMergedSegments(selectedDate)
│   ├── 支持缩放、拖拽
│   ├── 支持操作：重分类、拆分、合并
│   └── 段详情：展开 is_exploded 子段
│
└── HeatmapGrid  （年度热力图）
    └── 数据源：getYearHeatmap()
```

### 10.2 Timeline 关键交互

| 操作 | IPC 调用 | 说明 |
|---|---|---|
| 重分类段 | `reclassifySegment` | 弹出科目选择器，只改父段标签不动子段 |
| 按标题重分类 | `reclassifyByTitle` | 段详情中按标题重分类所有同类事件 |
| 按时段内标题重分类 | `reclassifyByTitleInRange` | 详情弹窗子标题重分类，自动重建 merged_segments 和 daily_stats |
| 拆分 | `splitSegment` | 剪刀模式，在指定时间点拆分 |
| 合并 | `mergeAdjacentSegments` | 选中两个相邻段合并 |

### 10.3 自动刷新

- **今天**：每 30 秒自动 `loadData()` + 检查成就解锁
- **历史日期**：不自动刷新

---

## 11. 系统托盘

位置：`src/main/tray.ts`

```
托盘图标：
  - 颜色：根据当前托盘科目变化
    - 物理=黄色  数学=蓝色  英语=红色
    - 未指定=绿色（默认）
  - 点击菜单：
    - ✓ 物理 / 数学 / 英语 / 休闲 / 其他  ← 切换托盘科目
    - 📋 不指定
    - ─────────
    - 打开澜山
    - 关于
    - 退出
```

托盘科目的作用：当 `classifyEvent` 遇到模糊条目（如"视频播放"）且无关键词匹配时，用托盘科目覆盖。这允许用户通过托盘快速切换"当前在学什么"。

---

## 12. 常见 Bug 排查指南

### 12.1 "科目时长不对"

**检查顺序**：

1. 打开日志看 `[sync-full] DIAG raw_events:` 行 → 确认 raw_events 中的科目分布是否正确
2. 对比 `[sync-full] DIAG merged_segments:` 和 `[sync-full] DIAG daily_stats:` → 三者应该一致
3. 如果不一致：
   - `raw_events` 正确但 `merged_segments` 错误 → 合并算法问题
   - `raw_events` 正确但 `daily_stats` 错误 → 某处用了 merged_segments 重建 daily_stats
   - `raw_events` 本身错误 → 分类规则问题

### 12.2 "历史日期没数据/数据不全"

确认 `Dashboard.loadData()` 中对非今天的日期调用了 `rebuildDailyStats(selectedDate)`。

### 12.3 "时间轴上看到段但时长显示不对"

- 检查 `merged_segments.duration` 是否等于段内所有 constituent 之和
- 如果段的 start/end 跨度正确但 duration 偏小 → 检查是否有 duration 重算逻辑错误
- 如果短科目段"消失"了 → 可能被吸收到相邻段（这是正常的），检查被吸收段的 constituent 仍保留在吸收段里

### 12.4 "分类规则不生效"

1. 确认规则优先级（priority）是否正确
2. 确认 `match_field` 设置（title/app/url/all）
3. 添加规则后会自动调用 `reclassifyRawEventsByKeyword` 重分类现有数据
4. 如果规则匹配两种不同科目 → 优先级高的生效

### 12.5 "热力图详情页时长与 AW 不一致"

1. 终端日志对比 `DIAG AW raw per-title` 和 `DIAG per-title raw_events totals`
   - 两者一致 → raw_events 数据正确，差异来自 AW 自身 UI 的 AFK 过滤或聚合方式不同
   - raw_events 偏小 → 检查是否有事件因空标题被 `loadGroups` 丢弃
   - raw_events 偏大 → 检查 `findWindowBuckets` 是否误用了多种桶类型
2. AW 的 Top Window Titles 可能将同一 app 的多个实例拆分显示，注意向下滚动查看完整列表

---

## 13. 关键设计决策

1. **raw_events 是唯一真相源**：所有统计和显示都从 raw_events 衍生，不允许 merged_segments → daily_stats 的依赖。

2. **merged_segments 允许"说谎"**：为了视觉体验，短片段可以吸收、空白可以填充、同科目可以合并。但 `daily_stats` 绝不能受影响。

3. **增量同步不重建 merged_segments**：避免覆盖用户手动拆分/合并/重分类的结果。只有全量同步和添加/删除分类规则时才重建。

4. **历史日期现场重建 daily_stats**：`daily_stats` 可能因为旧 bug 而不完整，切到历史日期时自动从 raw_events 重建。

5. **窗口关闭 = 隐藏到托盘**：不会真正退出，用户通过托盘菜单退出。

6. **duration 不冻结**：同步不跳过已存事件，确保长时间运行的窗口时长与 AW 一致。

7. **桶类型隔离**：`findWindowBuckets` 只使用 `window` 桶，不与 `currentwindow` 混合防重复。

8. **手动分类保护**：`insertRawEvent` 的 UPSERT 不更新 `subject` 列。

9. **主导科目重算尊重手动覆盖**：`user_subject` 列 + Phase 4 优先使用手动设置。

---

## 附录：新吸收算法设计（2026-07-11 尝试）

> 以下描述的是尝试过但最终因稳定性问题**未合入**的新算法逻辑，保留作为后续参考。

### 设计目标

替换原有复杂的四阶段合并逻辑，改为更简洁的"大段独立 + 小段链式左吸收"模型。

### 核心规则

```
大段 = duration ≥ 300s（5min）— 独立存在，永不消失
小段 = duration < 300s — 需要被大段吸收

小段链：
  - 连续小段且间隔 ≤ 2min → 属于同一个链
  - 链内间隔 > 2min → 链断裂，分别处理

链的吸收：
  - 链在大段左边：
    gap = 大段.start_time - 链[最后].end_time
    gap ≤ 10min → 整条链吸收进大段（大段向前延伸）
    gap > 10min → 整条链丢弃
  - 链在大段右边：
    gap = 链[最先].start_time - 大段.end_time
    gap ≤ 10min → 整条链吸收进大段（大段向后延伸）
    gap > 10min → 整条链丢弃
  - 链两边都没有大段 → 丢弃

无大段时：
  - 全部小段合并为一个"其他"段（避免时间轴完全空白）
```

### 处理流程

```
每个 raw_event → 独立段（无初始合并）
          ↓
分离大段/小段
          ↓
小段链式排队（gap ≤ 2min 为一链）
          ↓
每链检查到大段的 gap → ≤10min 吸收，>10min 丢弃
          ↓
主导分类重算（constituent 按分类分组取总时长最大）
          ↓
同科目间隙填充（用重算后的分类判断）
          ↓
视觉拉伸（end_time 贴合 <10min 空隙）
```

### 场景示例

```
小段(2m) 小段(3m) 大英语(40m) 小段(2m) 大物理(30m)
   └─chain1──┘      │         └─chain2─┘     │
       gap=5min      │           gap=1min     │
       ≤10min ✓      │           ≤10min ✓     │
       →归大英语     │           →归大英语    │
                     ▼                      ▼
              [大英语 45m]            [大物理 30m]
```

```
凌晨小段(1m) ··· 9h空白 ··· 大英语(40m)
   └─chain─────────────┘
       gap = 大英语.start - 链.end = 9h
       gap > 10min → 丢弃 ✓（不会错误延伸到凌晨）
```

### 为何未合入

1. 与旧代码的 `reclassifySegment` 全量 UPDATE raw_events 兼容性差
2. 链式吸收的时间边界条件有坑（gap 为负值时误判）
3. 与现有的手动重分类逻辑互相干扰

---

## 14. 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.2.0 | 2026-07-11 | duration 不冻结、桶类型隔离、手动分类保护、2min 标题过滤、per-title 诊断日志 |
| 0.1.0 | 2026-07-11 | 初始版本 |
