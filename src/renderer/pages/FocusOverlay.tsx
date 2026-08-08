import { useState, useEffect, useMemo } from 'react'
import { formatCountdown, formatDuration, getSubjectColor, getSubjectIcon, focusEntryKey, sortWhitelistByOrder } from '../utils'

/** 背景主题：氛围色 → 深色渐变背景（与 🎨 色板一一对应） */
const BG_THEMES: Record<string, string> = {
  '#ecfdf5': 'linear-gradient(140deg, #022c22 0%, #064e3b 45%, #0f766e 100%)', // 深绿（默认）
  '#fbbf24': 'linear-gradient(140deg, #2b1f06 0%, #4a3408 45%, #7c5310 100%)', // 深金
  '#2dd4bf': 'linear-gradient(140deg, #02242c 0%, #06454e 45%, #0f6e66 100%)', // 深青
  '#60a5fa': 'linear-gradient(140deg, #0a1428 0%, #122a4a 45%, #1e4a7c 100%)', // 深蓝
  '#a78bfa': 'linear-gradient(140deg, #1a1028 0%, #2a1a4a 45%, #4a2a7c 100%)', // 深紫
  '#fb7185': 'linear-gradient(140deg, #2a0a12 0%, #4a1420 45%, #7c1e30 100%)', // 深粉
}

/** 今日战况：总时长 + 连续天数 + 各科目标进度 */
interface TodayStats {
  totalSeconds: number
  consecutive: number
  subjects: { subject: string; seconds: number; target: number }[]
}

/** 专注桌面：全屏覆盖层，白名单软件图标 + 大倒计时，只有点这里的软件才能用 */
export default function FocusOverlay(): React.ReactElement {
  const [state, setState] = useState<FocusState | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  // 今日战况（真实学习数据）
  const [today, setToday] = useState<TodayStats | null>(null)
  // 隐藏的条目（✕ 隐藏 = 专注桌面不显示，白名单锁定规则保留，可显示回来）
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
  const [restoreOpen, setRestoreOpen] = useState(false)
  // 图标自定义顺序（拖拽排序持久化）
  const [orderKeys, setOrderKeys] = useState<string[]>([])
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  // 氛围色（诗词/扫描光带，可自定义）
  const [poemColor, setPoemColor] = useState('#ecfdf5')
  const [colorOpen, setColorOpen] = useState(false)

  /** 可选氛围色 */
  const POEM_COLORS = ['#ecfdf5', '#fbbf24', '#2dd4bf', '#60a5fa', '#a78bfa', '#fb7185']

  useEffect(() => {
    window.lanshan.getFocusState().then((s) => {
      setState(s)
      // 预取白名单软件的真实图标
      s.whitelist.forEach(a => {
        if (a.path) {
          window.lanshan.getAppIcon(a.name, a.path).then((url) => {
            if (url) setIcons(prev => ({ ...prev, [a.name.toLowerCase()]: url }))
          })
        }
      })
    })
    // 主界面隐藏的条目：专注桌面不显示
    window.lanshan.getFocusHidden().then(keys => setHiddenKeys(new Set(keys)))
    // 自定义顺序：拖拽排序持久化
    window.lanshan.getFocusOrder().then(setOrderKeys)
    // 氛围色（诗词/扫描光带）
    window.lanshan.getFocusColor().then(c => { if (c) setPoemColor(c) })
    const unsubscribe = window.lanshan.onFocusTick((tick) => {
      setState(prev => prev ? { ...prev, ...tick } : prev)
    })
    const clock = setInterval(() => setNow(Date.now()), 1000)
    // 键盘逃生：Esc 或 Ctrl+Shift+F10 直接结束专注（不弹确认，保证能退出）。
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.ctrlKey && e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        window.lanshan.stopFocus().catch(() => { /* 主进程侧还有全局快捷键兜底 */ })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { unsubscribe(); clearInterval(clock); window.removeEventListener('keydown', onKey) }
  }, [])

  /** 今日战况：挂载时加载一次 + 每 30s 轻量轮询（失败静默，不影响倒计时） */
  useEffect(() => {
    let stop = false
    async function load(): Promise<void> {
      try {
        const dateStr = new Date().toLocaleDateString('sv-SE')
        const [core, stats, settings, total, consec] = await Promise.all([
          window.lanshan.getCoreSubjects(),
          window.lanshan.getDailyStats(dateStr),
          window.lanshan.getSettings(),
          window.lanshan.getTotalSecondsToday(dateStr),
          window.lanshan.getConsecutiveDays(),
        ])
        if (stop) return
        setToday({
          totalSeconds: total,
          consecutive: consec,
          subjects: core.map((s: string) => {
            const row = stats.find((r: { subject: string }) => r.subject === s)
            return {
              subject: s,
              seconds: row?.total_seconds || 0,
              target: parseInt(settings[`target_${s}`] || '7200', 10),
            }
          }),
        })
      } catch { /* 数据失败静默降级 */ }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  // 专注完成：庆祝动画全屏展示
  const finished = state !== null && !state.active

  /** 完成庆祝粒子（一次性生成，刷新不重来） */
  const particles = useMemo(() => {
    const colors = ['#34d399', '#2dd4bf', '#fbbf24', '#f472b6', '#60a5fa', '#f8fafc']
    return Array.from({ length: 44 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 6 + Math.random() * 8,
      color: colors[i % colors.length],
      delay: Math.random() * 1.2,
      duration: 2.6 + Math.random() * 2.4,
      rotate: Math.random() * 360,
    }))
  }, [])

  function tileLabel(a: FocusApp): string {
    // 优先显示窗口名（锁窗口时记录的标题）；没有窗口标题才显示进程名
    if (a.title === '澜山') return '澜山'
    if (a.title) return a.title
    return a.name.replace(/\.exe$/i, '')
  }

  async function launch(a: FocusApp): Promise<void> {
    // 按「进程名 + 关键词」精确跳转到对应窗口（避免切到不匹配窗口被盖回）
    await window.lanshan.launchFocusApp(a.name, a.titleMatch)
  }

  /** 更新白名单：同步主进程 + 本地状态 + 新条目预取图标 */
  function updateWhitelist(next: FocusApp[]): void {
    window.lanshan.setFocusWhitelist(next)
    setState(prev => prev ? { ...prev, whitelist: next } : prev)
    for (const a of next) {
      if (a.path) {
        window.lanshan.getAppIcon(a.name, a.path).then((url) => {
          if (url) setIcons(prev => ({ ...prev, [a.name.toLowerCase()]: url }))
        })
      }
    }
  }

  /** 隐藏条目（图标悬停 ✕）：专注桌面不显示，白名单锁定规则保留，可"显示回来" */
  function hideEntry(a: FocusApp): void {
    const key = focusEntryKey(a)
    const next = [...hiddenKeys, key]
    setHiddenKeys(new Set(next))
    window.lanshan.setFocusHidden(next)
  }

  /** 显示回来：把条目从隐藏列表移除（白名单从未动过） */
  function showEntry(a: FocusApp): void {
    const key = focusEntryKey(a)
    const next = [...hiddenKeys].filter(k => k !== key)
    setHiddenKeys(new Set(next))
    window.lanshan.setFocusHidden(next)
  }

  /** 拖拽排序：开始拖 */
  function startDrag(e: React.DragEvent, key: string): void {
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
    setDragKey(key)
  }

  /** 拖拽排序：放到目标条目上 → 移动到目标位置并持久化 */
  function dropOn(targetKey: string, e: React.DragEvent): void {
    e.preventDefault()
    const src = dragKey
    if (!src || src === targetKey) { setDragKey(null); setDragOverKey(null); return }
    const keys = orderedWhitelist.map(focusEntryKey).filter(k => k !== src)
    const idx = keys.indexOf(targetKey)
    keys.splice(idx, 0, src)
    setOrderKeys(keys)
    window.lanshan.setFocusOrder(keys)
    setDragKey(null)
    setDragOverKey(null)
  }

  /** 拖拽结束 */
  function endDrag(): void {
    setDragKey(null)
    setDragOverKey(null)
  }

  /** 选择氛围色（诗词/扫描光带） */
  function pickColor(c: string): void {
    setPoemColor(c)
    window.lanshan.setFocusColor(c)
    setColorOpen(false)
  }

  async function endFocus(): Promise<void> {
    // 点右下角直接结束，不再弹确认（用户要求；误触可用 Esc/Ctrl+Shift+F10 兜底）
    try {
      await window.lanshan.stopFocus()
    } catch (e) {
      setError('结束专注失败：' + String(e) + '（可按 Ctrl+Shift+F10）')
    }
  }

  async function quitApp(): Promise<void> {
    try {
      await window.lanshan.quitApp()
    } catch (e) {
      setError('退出应用失败：' + String(e) + '（可按 Ctrl+Shift+F10）')
    }
  }

  const dateText = new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const timeText = new Date(now).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const whitelist = state?.whitelist || []
  // 隐藏的条目不显示（白名单锁定规则仍生效，可"显示回来"）
  const visibleWhitelist = whitelist.filter(a => !hiddenKeys.has(focusEntryKey(a)))
  const hiddenEntries = whitelist.filter(a => hiddenKeys.has(focusEntryKey(a)))
  // 按用户拖拽的自定义顺序排列
  const orderedWhitelist = sortWhitelistByOrder(visibleWhitelist, orderKeys)
  const elapsedMin = state ? Math.max(0, state.durationMin - Math.ceil((state.remainingSec || 0) / 60)) : 0

  return (
    <div
      className="fixed -top-[1px] inset-x-0 bottom-[-1px] z-[9999] flex flex-col overflow-hidden"
      style={{
        background: BG_THEMES[poemColor] || BG_THEMES['#ecfdf5'],
        color: '#ecfdf5',
        transition: 'background 0.6s ease',
      }}
    >
      {/* 动态背景：漂移光斑 + 科技网格 + 暗角（颜色跟随主题） */}
      <div
        className="focus-blob -top-[12vw] -left-[8vw]"
        style={{ width: '46vw', height: '46vw', background: poemColor + '33', animation: 'focus-blob-1 26s ease-in-out infinite' }}
      />
      <div
        className="focus-blob -bottom-[10vw] -right-[6vw]"
        style={{ width: '38vw', height: '38vw', background: 'rgba(255,255,255,0.10)', animation: 'focus-blob-2 32s ease-in-out infinite' }}
      />
      <div
        className="focus-blob top-[38%] right-[20%]"
        style={{ width: '24vw', height: '24vw', background: 'rgba(255,255,255,0.05)', animation: 'focus-blob-3 22s ease-in-out infinite' }}
      />
      {/* 科技网格线 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* 暗角 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)' }}
      />

      {/* 顶部栏 */}
      <div className="relative z-10 flex items-center justify-between px-10 pt-7 select-none">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🍅</span>
          <span className="text-sm font-semibold tracking-widest" style={{ color: 'rgba(236,253,245,0.92)' }}>专注中</span>
        </div>
        <div className="relative flex items-center gap-4">
          <p className="text-xs" style={{ color: 'rgba(236,253,245,0.45)' }}>↕ 拖动下方图标可自定义顺序</p>
          <button
            onClick={() => setColorOpen(v => !v)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all hover:bg-white/10"
            title="自定义背景颜色"
          >
            🎨
          </button>
        </div>
      </div>

      {/* 主体：时钟 + 倒计时 + 今日战况 + 白名单图标 */}
      <div className="relative z-10 flex-1 flex min-h-0">
        {/* 中央：时钟 + 倒计时 + 今日战况 + 白名单图标（内容不超高时完美居中，超高时贴顶可滚动） */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center px-6 select-none py-3">
          {finished ? (
            <>
              <div className="text-7xl mb-4" style={{ animation: 'focus-breathe 2.2s ease-in-out infinite' }}>🎉</div>
              <div className="text-3xl font-bold">专注完成！</div>
              <p className="mt-2 text-base" style={{ color: 'rgba(236,253,245,0.7)' }}>
                本次共专注 {state.durationMin} 分钟
              </p>
              <TodayBoard today={today} />
            </>
          ) : (
            <>
              {/* 时钟（居中，倒计时上方） */}
              <div className="shrink-0 flex items-center gap-3 mb-6">
                <span
                  className="tabular-nums text-2xl font-semibold"
                  style={{ color: 'rgba(236,253,245,0.92)', textShadow: '0 0 20px rgba(52,211,153,0.35)' }}
                >
                  {timeText}
                </span>
                <span className="text-base" style={{ color: 'rgba(236,253,245,0.55)' }}>{dateText}</span>
              </div>
              {/* 环形倒计时：渐变描边 + 发光，每秒平滑推进 */}
              <div className="relative shrink-0" style={{ width: 300, height: 300 }}>
                <CountdownRing remainingSec={state?.remainingSec ?? 0} durationMin={state?.durationMin ?? 0} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div
                    className="focus-breathe tabular-nums font-bold tracking-tight"
                    style={{
                      fontSize: '4.8rem',
                      lineHeight: 1,
                      background: 'linear-gradient(180deg, #f0fdfa 25%, #6ee7b7 95%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      filter: 'drop-shadow(0 0 26px rgba(52,211,153,0.4))',
                    }}
                  >
                    {formatCountdown(state?.remainingSec ?? 0)}
                  </div>
                  <p className="text-base mt-2.5" style={{ color: 'rgba(236,253,245,0.6)' }}>
                    剩余时间 · 点击下方图标使用软件
                  </p>
                </div>
              </div>
              <p className="shrink-0 text-base mt-4 tabular-nums" style={{ color: 'rgba(236,253,245,0.55)' }}>
                已专注 {elapsedMin} / {state?.durationMin ?? 0} 分钟 · 白名单 {whitelist.length} 个软件
              </p>

              {/* 今日战况：真实学习数据（30s 刷新） */}
              <TodayBoard today={today} />

              {/* 白名单图标：一字排开，5 个一排（悬停 ✕ 隐藏 + 拖拽排序） */}
              <div className="shrink-0 mt-20 w-full max-w-4xl">
                <div className="grid grid-cols-5 gap-6">
                  {orderedWhitelist.map(a => {
                    const key = focusEntryKey(a)
                    return (
                      <AppTile
                        key={key}
                        label={tileLabel(a)}
                        icon={icons[a.name.toLowerCase()]}
                        onLaunch={() => launch(a)}
                        onRemove={() => hideEntry(a)}
                        draggable
                        isDragging={dragKey === key}
                        isDragOver={dragOverKey === key}
                        onDragStart={(e) => startDrag(e, key)}
                        onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key) }}
                        onDrop={(e) => dropOn(key, e)}
                        onDragEnd={endDrag}
                      />
                    )
                  })}
                </div>
                {hiddenEntries.length > 0 && (
                  <div className="flex justify-center mt-5">
                    <button
                      onClick={() => setRestoreOpen(true)}
                      className="px-4 py-2 rounded-xl text-xs font-medium transition-all hover:bg-white/10"
                      style={{ color: 'rgba(236,253,245,0.7)' }}
                    >
                      ↩ 显示回来（{hiddenEntries.length}）
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </div>

      </div>

      {/* 背景颜色选择面板（最外层直接子元素：层级最高，不会被任何图层覆盖） */}
      {colorOpen && (
        <div
          className="fixed right-10 top-16 rounded-2xl p-3 z-[100]"
          style={{ background: 'rgba(8,32,28,0.94)', backdropFilter: 'blur(14px)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
        >
          <p className="text-[11px] mb-2 px-0.5" style={{ color: 'rgba(236,253,245,0.5)' }}>背景颜色</p>
          <div className="flex gap-2">
            {POEM_COLORS.map(c => (
              <button
                key={c}
                onClick={() => pickColor(c)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                title={c}
                style={{
                  background: c,
                  boxShadow: c === poemColor
                    ? '0 0 0 2px rgba(255,255,255,0.9), 0 0 12px ' + c
                    : '0 2px 6px rgba(0,0,0,0.3)',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 右下角悬浮操作按钮（无底部栏，界面更通透） */}
      {error && (
        <div className="absolute bottom-16 right-8 z-20 text-xs select-none" style={{ color: '#fca5a5' }}>
          ⚠ {error}
        </div>
      )}
      <div className="absolute bottom-6 right-8 z-20 flex items-center gap-3 select-none">
        <button
          onClick={quitApp}
          className="px-4 py-2 rounded-xl text-xs font-medium transition-all hover:bg-white/10"
          style={{ color: 'rgba(236,253,245,0.75)' }}
        >
          退出应用
        </button>
        <button
          onClick={endFocus}
          className="px-5 py-2 rounded-xl text-xs font-semibold transition-all hover:bg-white/20"
          style={{ background: 'rgba(239,68,68,0.85)', color: 'white', boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }}
        >
          ⏹ 结束专注
        </button>
      </div>

      {/* 显示回来面板：隐藏的软件可恢复显示 */}
      {restoreOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setRestoreOpen(false)}>
          <div
            className="rounded-3xl w-[420px] max-h-[70vh] overflow-y-auto p-5"
            style={{ background: '#0c211c', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold" style={{ color: 'rgba(236,253,245,0.9)' }}>↩ 显示回来</span>
              <button
                onClick={() => setRestoreOpen(false)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all hover:bg-white/10"
                style={{ color: 'rgba(236,253,245,0.6)' }}
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] mb-3" style={{ color: 'rgba(236,253,245,0.45)' }}>
              被隐藏的软件（白名单锁定规则一直保留），点选即可重新显示
            </p>
            <div className="space-y-1.5">
              {hiddenEntries.map(a => (
                <button
                  key={focusEntryKey(a)}
                  onClick={() => { showEntry(a); setRestoreOpen(false) }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all hover:bg-white/10"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                >
                  <span className="text-base">{a.titleMatch ? '🔒' : '📱'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'rgba(236,253,245,0.9)' }}>{tileLabel(a)}</p>
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: '#34d399' }}>显示</span>
                </button>
              ))}
              {hiddenEntries.length === 0 && (
                <p className="text-xs py-4 text-center" style={{ color: 'rgba(236,253,245,0.45)' }}>没有隐藏的软件</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 完成庆祝粒子 */}
      {finished && (
        <div className="absolute inset-0 pointer-events-none z-20">
          {particles.map(p => (
            <span
              key={p.id}
              className="focus-particle"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                transform: `rotate(${p.rotate}deg)`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 环形倒计时：渐变描边 + 发光，进度 = 已过时长/总时长，每秒平滑推进 */
function CountdownRing({ remainingSec, durationMin }: { remainingSec: number; durationMin: number }): React.ReactElement {
  const total = Math.max(1, durationMin * 60)
  const elapsed = Math.max(0, total - remainingSec)
  const pct = Math.min(1, elapsed / total)
  const R = 138
  const C = 2 * Math.PI * R
  return (
    <svg width="100%" height="100%" viewBox="0 0 300 300" className="-rotate-90">
      <defs>
        <linearGradient id="focusRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
      {/* 内圈装饰细环 */}
      <circle cx="150" cy="150" r="106" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 7" />
      <circle
        cx="150" cy="150" r={R}
        fill="none"
        stroke="url(#focusRingGrad)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - pct)}
        style={{ transition: 'stroke-dashoffset 1s linear', filter: 'drop-shadow(0 0 10px rgba(52,211,153,0.55))' }}
      />
    </svg>
  )
}

/** 今日战况：无容器纯排版（数字 + 分隔线 + 科目进度条），不做任何包裹卡片 */
function TodayBoard({ today }: { today: TodayStats | null }): React.ReactElement {
  if (!today) {
    // 数据未加载时的占位（透明，不闪跳）
    return (
      <div className="shrink-0 mt-8" style={{ width: 'min(92vw, 660px)', height: 160 }} />
    )
  }
  return (
    <div className="shrink-0 mt-8" style={{ width: 'min(92vw, 660px)' }}>
      {/* 上排：统计大数字 */}
      <div className="flex items-center gap-8">
        <div className="flex-1">
          <p className="text-xs tracking-wide" style={{ color: 'rgba(236,253,245,0.5)' }}>📖 今日学习</p>
          <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: 'rgba(236,253,245,0.95)' }}>
            {formatDuration(today.totalSeconds)}
          </p>
        </div>
        <div className="h-10 w-px" style={{ background: 'rgba(255,255,255,0.10)' }} />
        <div className="flex-1">
          <p className="text-xs tracking-wide" style={{ color: 'rgba(236,253,245,0.5)' }}>🔥 连续打卡</p>
          <p className="text-3xl font-bold tabular-nums mt-1">
            {today.consecutive}
            <span className="text-lg font-semibold ml-1.5" style={{ color: 'rgba(236,253,245,0.6)' }}>天</span>
          </p>
        </div>
      </div>
      {/* 分隔线 */}
      <div className="h-px my-3.5" style={{ background: 'rgba(255,255,255,0.08)' }} />
      {/* 下排：科目目标进度 */}
      <div className="space-y-3">
        {today.subjects.map(s => {
          const pct = s.target > 0 ? Math.min(100, (s.seconds / s.target) * 100) : 0
          const done = s.seconds >= s.target
          const color = getSubjectColor(s.subject)
          return (
            <div key={s.subject}>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="flex items-center min-w-0" style={{ color: 'rgba(236,253,245,0.85)' }}>
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0"
                    style={{ background: color + '26' }}
                  >
                    {getSubjectIcon(s.subject)}
                  </span>
                  <span className="truncate">{s.subject} {done && <span style={{ color: '#34d399' }}>✓</span>}</span>
                </span>
                <span className="tabular-nums flex-shrink-0 ml-2 text-sm" style={{ color: 'rgba(236,253,245,0.5)' }}>
                  {formatDuration(s.seconds)}
                  <span className="ml-2 font-semibold" style={{ color: done ? '#34d399' : color }}>
                    {Math.round(pct)}%
                  </span>
                </span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: done
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : `linear-gradient(90deg, ${color}bb, ${color})`,
                    boxShadow: `0 0 10px ${done ? 'rgba(52,211,153,0.6)' : color + '55'}`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 手机桌面风格的软件图标卡片：hover 上浮发光 + 悬停删除 + 拖拽排序 */
function AppTile({ label, icon, onLaunch, onRemove, draggable, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }: {
  label: string
  icon?: string
  onLaunch: () => void
  onRemove: () => void
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}): React.ReactElement {
  return (
    <div className="relative group">
      <button
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={onLaunch}
        className="w-full flex flex-col items-center gap-2 py-4 rounded-[20px] select-none transition-all duration-200 hover:scale-110 hover:-translate-y-1 hover:bg-white/10 hover:shadow-[0_8px_28px_rgba(16,185,129,0.35)] active:scale-95"
        style={{
          background: isDragOver ? 'rgba(52,211,153,0.20)' : undefined,
          backdropFilter: 'blur(10px)',
          boxShadow: isDragOver ? '0 0 0 2px rgba(52,211,153,0.6), 0 8px 24px rgba(0,0,0,0.25)' : undefined,
          opacity: isDragging ? 0.45 : 1,
          cursor: draggable ? 'grab' : 'pointer',
        }}
      >
        {icon ? (
          <img
            src={icon}
            alt={label}
            className="w-14 h-14 rounded-2xl"
            style={{ animation: 'focus-breathe 4s ease-in-out infinite', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))' }}
            draggable={false}
          />
        ) : (
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-semibold">
            {label === '澜山' ? '🍃' : label.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="text-sm max-w-full truncate px-1" title={label} style={{ color: 'rgba(236,253,245,0.9)' }}>
          {label}
        </span>
      </button>
      {/* 悬停显示删除按钮 */}
      <button
        onClick={onRemove}
        title="隐藏（专注桌面不显示，白名单保留，可显示回来）"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(239,68,68,0.9)', color: 'white', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}
      >
        ✕
      </button>
    </div>
  )
}
