import { useState, useEffect, useRef } from 'react'
import { formatCountdown, sortWhitelistByOrder } from '../utils'

const PRESETS = [25, 45, 60]

/** 专注页整体等比缩放基准：内容在 960×900 下完整显示（含倒计时环、白名单、说明三卡）。
 *  窗口（含全屏/最大化）变化时整体按比例缩放，倒计时等所有元素等比放大/缩小，比例始终协调 */
const BASE_W = 960
const BASE_H = 900

/** 白名单条目的显示名（去掉 .exe） */
function displayName(a: FocusApp): string {
  return a.title === '澜山' ? '澜山' : a.name.replace(/\.exe$/i, '')
}

/** 鼠标跟随光晕：把光标位置写入 CSS 变量（radial-gradient 跟随） */
function onGlow(e: React.MouseEvent<HTMLElement>): void {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px')
  e.currentTarget.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px')
}

/** HUD 风格卡片头部：状态灯 + 等宽标题 + 右侧数据 */
function CardHeader({ label, right }: { label: string; right?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
        <span className="mono text-[11px] font-semibold tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
          {label}
        </span>
      </div>
      {right && (
        <span className="mono text-[10px] tracking-[0.15em] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {right}
        </span>
      )}
    </div>
  )
}

export default function Focus(): React.ReactElement {
  const [state, setState] = useState<FocusState | null>(null)
  const [runningApps, setRunningApps] = useState<FocusApp[]>([])
  const [preset, setPreset] = useState(25)
  const [customMin, setCustomMin] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualMatch, setManualMatch] = useState('')
  const [message, setMessage] = useState('')
  // 专注模式说明展开/收起
  const [guideOpen, setGuideOpen] = useState(false)
  // 窗口级锁定的内联编辑状态
  const [lockEdit, setLockEdit] = useState<string | null>(null)
  const [lockInput, setLockInput] = useState('')
  // 专注桌面图标顺序（拖拽排序）
  const [orderKeys, setOrderKeys] = useState<string[]>([])
  // 鼠标跟随光效（与专注桌面共用 focus_glow 设置）
  const [glowOn, setGlowOn] = useState(true)
  // 「寻找软件」开关：开启时自动扫描运行程序（5 秒轮询），关闭时停止，省性能
  const [scanOn, setScanOn] = useState(true)
  // 整体等比缩放：按窗口可用空间计算 scale（轮询检测，setScale 同值自动跳过渲染）
  const rootRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const compute = (): void => {
      setScale(Math.min(el.clientWidth / BASE_W, el.clientHeight / BASE_H))
    }
    compute()
    const t = setInterval(compute, 400)
    return () => clearInterval(t)
  }, [])

  /** 条目标识 key（与主进程/专注桌面一致：进程名|关键词） */
  function entryKey(a: { name: string; titleMatch?: string }): string {
    return a.name.toLowerCase() + '|' + (a.titleMatch || '').toLowerCase()
  }

  /** 切换浏览器条目的点击行为：🖥 显示回来（不新开页）/ 🔗 网址跳转 */
  function toggleSwitchMode(a: FocusApp): void {
    if (!state) return
    updateWhitelist(state.whitelist.map(x => entryKey(x) === entryKey(a) ? { ...x, switchOnly: !x.switchOnly } : x))
  }

  /** 该进程是否已有应用级条目（整体放行） */
  function appCovered(name: string): boolean {
    return whitelist.some(w => w.name.toLowerCase() === name.toLowerCase() && !w.titleMatch)
  }

  /** 某窗口是否已被窗口级条目锁定 */
  function winCovered(win: FocusApp): boolean {
    return whitelist.some(w =>
      w.name.toLowerCase() === win.name.toLowerCase() && w.titleMatch &&
      win.title?.toLowerCase().includes(w.titleMatch.toLowerCase())
    )
  }

  useEffect(() => {
    window.lanshan.getFocusState().then(setState)
    window.lanshan.getFocusOrder().then(setOrderKeys)
    // 鼠标光效开关（与专注桌面共用）
    window.lanshan.getSettings().then(s => { if (s['focus_glow'] === '0') setGlowOn(false) })
    const unsubscribe = window.lanshan.onFocusTick((tick) => {
      setState(prev => prev ? { ...prev, ...tick } : prev)
    })
    return unsubscribe
  }, [])

  // 「寻找软件」开关：开启时立即扫描 + 每 5 秒自动刷新；关闭或离开页面自动停止
  useEffect(() => {
    if (!scanOn) return
    refreshRunningApps()
    const t = setInterval(refreshRunningApps, 5000)
    return () => clearInterval(t)
  }, [scanOn])

  async function refreshRunningApps(): Promise<void> {
    const next = await window.lanshan.getRunningApps()
    // 数据无变化时不触发重渲染（避免每 5 秒无意义刷新）
    setRunningApps(prev => {
      if (prev.length === next.length && prev.every((a, i) => a.name === next[i].name && a.title === next[i].title)) {
        return prev
      }
      return next
    })
  }

  function updateWhitelist(next: FocusApp[]): void {
    window.lanshan.setFocusWhitelist(next)
    setState(prev => prev ? { ...prev, whitelist: next } : prev)
  }

  function addRunningApp(app: FocusApp): void {
    if (!state) return
    const key = app.name.toLowerCase()
    if (state.whitelist.some(a => a.name.toLowerCase() === key && !a.titleMatch)) {
      setMessage(`${displayName(app)} 已整体放行，无需重复添加（可继续「锁窗口」添加学科）`)
      return
    }
    updateWhitelist([...state.whitelist, app])
    setMessage(`已添加 ${displayName(app)}（整个应用放行）`)
  }

  /** 打开窗口级锁定的关键词编辑行 */
  function startLock(app: FocusApp): void {
    setLockEdit(app.name + '|' + (app.title || ''))
    setLockInput(app.title || '')
  }

  /** 确认窗口级锁定：仅标题包含关键词的窗口放行（同一进程可加多个不同关键词条目）。
   *  同时记录该窗口的网址：之后点专注桌面图标可直接跳转到这个页面（浏览器场景） */
  async function confirmLock(app: FocusApp): Promise<void> {
    const keyword = lockInput.trim()
    if (!keyword) {
      setMessage('请输入标题关键词（例如：高考物理）')
      return
    }
    if (!state) return
    const url = await window.lanshan.getWindowUrl(app)
    const next = [
      // 保留其他条目（包括同名不同关键词），仅去掉完全重复的
      ...state.whitelist.filter(a => !(a.name.toLowerCase() === app.name.toLowerCase() && (a.titleMatch || '') === keyword)),
      // switchOnly 默认 true：点击图标只把浏览器调出来（不新开页面），可随时切回"网址跳转"
      { name: app.name, path: app.path, title: app.title, titleMatch: keyword, url: url || undefined, switchOnly: true },
    ]
    updateWhitelist(next)
    setLockEdit(null)
    setLockInput('')
    setMessage(url
      ? `已锁定 ${displayName(app)}：点击图标将显示浏览器（可在白名单里切换为网址跳转）`
      : `已锁定 ${displayName(app)}：仅标题包含「${keyword}」的窗口放行（未获取到网址，将打开主界面）`)
  }

  function removeApp(name: string, titleMatch?: string): void {
    if (!state) return
    updateWhitelist(state.whitelist.filter(a =>
      !(a.name.toLowerCase() === name.toLowerCase() && (a.titleMatch || '') === (titleMatch || ''))
    ))
  }

  async function addManual(): Promise<void> {
    const raw = manualName.trim()
    if (!raw) return
    let name = raw
    let path = ''
    if (raw.includes('\\') || raw.includes('/')) {
      // 用户粘贴了完整路径
      name = raw.split(/[\\/]/).pop() || raw
      path = raw
    } else {
      if (!name.toLowerCase().endsWith('.exe')) name += '.exe'
      path = await window.lanshan.resolveAppPath(name)
      if (!path) {
        setMessage(`找不到 ${name} 的安装路径，请粘贴完整的 exe 路径`)
        return
      }
    }
    const match = manualMatch.trim()
    if (state?.whitelist.some(a => a.name.toLowerCase() === name.toLowerCase() && (a.titleMatch || '') === match)) {
      setMessage(`${name} 已在白名单中`)
      return
    }
    if (!match && state?.whitelist.some(a => a.name.toLowerCase() === name.toLowerCase() && !a.titleMatch)) {
      setMessage(`${name} 已整体放行`)
      return
    }
    const next = [...(state?.whitelist || []), {
      name,
      path: path || undefined,
      titleMatch: match || undefined,
    }]
    updateWhitelist(next)
    setManualName('')
    setManualMatch('')
    setMessage(match ? `已添加 ${name}（窗口级：${match}）` : `已添加 ${name}`)
  }

  async function startFocus(): Promise<void> {
    if (state?.active) return
    const mins = customMin ? parseInt(customMin, 10) : preset
    if (!mins || mins <= 0) {
      setMessage('请输入有效的专注时长')
      return
    }
    await window.lanshan.startFocus(mins)
    // 主窗口会被隐藏，专注桌面接管
  }

  async function stopFocus(): Promise<void> {
    await window.lanshan.stopFocus()
  }

  const whitelist = state?.whitelist || []
  const selectedMin = customMin ? parseInt(customMin, 10) : preset
  // 全部白名单（隐藏/显示在专注桌面里操作），按专注桌面自定义顺序排列
  const sortedWhitelist = sortWhitelistByOrder(whitelist, orderKeys)
  // 激活中进度（燃料条用）
  const totalSec = Math.max(1, (state?.durationMin ?? 0) * 60)
  const progressPct = state?.active ? Math.min(1, Math.max(0, 1 - (state.remainingSec || 0) / totalSec)) : 0

  return (
    // 整体等比缩放：内容固定在 960×900 基准布局，窗口/全屏变化时整体按比例缩放（视觉居中）
    <div ref={rootRef} className="w-full h-full overflow-hidden flex items-center justify-center">
      <div style={{ width: BASE_W * scale, height: BASE_H * scale }}>
        <div style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div className="w-full h-full flex flex-col gap-4">
      {/* 页面标题行（固定高度） */}
      <div className="flex items-center justify-between select-none shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full" style={{ background: state?.active ? '#ef4444' : 'var(--accent)', boxShadow: `0 0 10px ${state?.active ? 'rgba(239,68,68,0.8)' : 'var(--accent)'}` }} />
          <h2 className="mono text-sm font-bold tracking-[0.25em]" style={{ color: 'var(--text-secondary)' }}>
            专注模式 FOCUS MODE
          </h2>
        </div>
        <span
          className="mono text-[10px] px-2 py-0.5 rounded border tracking-[0.15em]"
          style={
            state?.active
              ? { color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }
              : { color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--bg-elevated)' }
          }
        >
          {state?.active ? '● 专注中' : '○ 未开始'}
        </span>
      </div>

      {/* 专注计时（弹性高度，内容垂直居中，超高时卡片内滚动） */}
      <div
        className={'card relative overflow-y-auto flex-[1.1] min-h-0 flex flex-col ' + (glowOn ? 'hud-glow' : '')}
        onMouseMove={glowOn ? onGlow : undefined}
      >
        {/* 顶部渐变亮线 */}
        <span
          className="absolute top-0 left-8 right-8 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.5 }}
        />
        <CardHeader label="TIMER · 专注计时" right={state?.active ? `TARGET ${state.durationMin} MIN` : 'READY'} />
        <div className="flex-1 min-h-0 flex flex-col justify-center">
        {state?.active ? (
          <div className="text-center">
            {/* 大倒计时：渐变数字 + 发光 */}
            <div
              className="mono tabular-nums font-bold tracking-tight"
              style={{
                fontSize: 'clamp(4rem, 5vw, 6rem)',
                lineHeight: 1.1,
                background: 'linear-gradient(180deg, #34d399, #059669)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 2px 14px rgba(16,185,129,0.25))',
              }}
            >
              {formatCountdown(state.remainingSec)}
            </div>
            {/* 分段燃料条 */}
            <div className="flex gap-1 max-w-sm mx-auto mt-4">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  className="h-1.5 flex-1 rounded-full transition-all duration-700"
                  style={i / 12 < progressPct
                    ? { background: 'linear-gradient(90deg, #10b981, #34d399)', boxShadow: '0 0 6px rgba(16,185,129,0.5)' }
                    : { background: 'var(--progress-track)' }}
                />
              ))}
            </div>
            <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
              专注中 · 已坚持 {state.durationMin - Math.ceil(state.remainingSec / 60)} / {state.durationMin} 分钟
              · 白名单 {whitelist.length} 个软件
            </p>
            <button
              onClick={stopFocus}
              className="mt-5 px-7 py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, #f87171, #dc2626)', color: 'white', boxShadow: '0 4px 16px rgba(239,68,68,0.35)' }}
            >
              ⏹ 结束专注
            </button>
          </div>
        ) : (
          <div>
            {/* 时长预设：分段选择器 */}
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map(m => (
                <button
                  key={m}
                  onClick={() => { setPreset(m); setCustomMin('') }}
                  className="mono px-4 py-2 rounded-lg text-sm font-medium tracking-wide transition-all"
                  style={
                    selectedMin === m
                      ? { background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white', boxShadow: '0 3px 12px rgba(16,185,129,0.35)' }
                      : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
                  }
                >
                  {m} MIN
                </button>
              ))}
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="number"
                  min="1"
                  max="600"
                  placeholder="自定义"
                  className="mono rounded-lg px-3 py-2 text-sm w-24 text-center transition-all border focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] focus:outline-none"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  value={customMin}
                  onChange={(e) => setCustomMin(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>分钟</span>
              </div>
            </div>
            <button
              onClick={startFocus}
              className="mt-5 px-9 py-3 rounded-xl text-sm font-bold tracking-widest transition-all hover:brightness-110 hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white', boxShadow: '0 6px 20px rgba(16,185,129,0.35)' }}
            >
              🚀 开始专注
            </button>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              开始后主窗口隐藏，全屏专注桌面弹出：只有白名单里的软件可用，其他软件会被盖住（不会关闭，仍在后台运行）
            </p>
          </div>
        )}
        </div>
      </div>

      {/* 白名单（弹性比例最大：正在运行的程序栏延展占更多高度，列表优先内部滚动） */}
      <div className={'card relative overflow-y-auto flex-[1.9] min-h-0 flex flex-col ' + (glowOn ? 'hud-glow' : '')} onMouseMove={glowOn ? onGlow : undefined}>
        <span
          className="absolute top-0 left-8 right-8 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.5 }}
        />
        <CardHeader label="WHITELIST · 专注白名单" right={`${whitelist.length} APPS`} />

        {/* 当前白名单（图标显不显示在专注桌面里操作） */}
        <div className="flex flex-wrap gap-2 mb-3 shrink-0">
          {sortedWhitelist.map(a => (
            <div
              key={a.name + (a.titleMatch || '')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all hover:shadow-[0_2px_10px_rgba(16,185,129,0.2)]"
              style={{ background: 'var(--accent-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <span className="font-medium">
                {a.titleMatch ? '🔒' : '📱'} {displayName(a)}
                {a.titleMatch && (
                  <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>「{a.titleMatch}」</span>
                )}
              </span>
              {a.url && (
                <button
                  onClick={() => toggleSwitchMode(a)}
                  className="text-xs px-1 rounded transition-all hover:opacity-70"
                  title={a.switchOnly
                    ? `当前：显示回来（点击图标只调出浏览器，不新开页面）· ${a.url}`
                    : `当前：网址跳转（点击图标直接打开该网址，可能新开页面）· ${a.url}`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {a.switchOnly ? '🖥' : '🔗'}
                </button>
              )}
              <button onClick={() => removeApp(a.name, a.titleMatch)} className="text-xs" title="从白名单移除" style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
          ))}
          {sortedWhitelist.length === 0 && (
            <p className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>白名单为空（开始专注时会自动加入澜山）</p>
          )}
        </div>

        {/* 手动添加 */}
        <div className="flex items-center gap-2 mb-2">
          <input
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addManual() }}
            placeholder="输入进程名如 chrome.exe，或粘贴完整 exe 路径"
            className="rounded-lg px-3 py-2 text-sm flex-1 min-w-0 transition-all border focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <input
            value={manualMatch}
            onChange={(e) => setManualMatch(e.target.value)}
            placeholder="标题关键词（可选，锁定窗口）"
            className="rounded-lg px-3 py-2 text-sm w-48 transition-all border focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={addManual}
            className="px-4 py-2 rounded-lg text-sm font-bold tracking-wider transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white', boxShadow: '0 3px 12px rgba(16,185,129,0.3)' }}
          >
            + 添加
          </button>
        </div>
        <p className="text-xs mb-4 shrink-0" style={{ color: 'var(--text-muted)' }}>
          填了标题关键词 = 窗口级锁定（仅标题包含该关键词的窗口放行）；不填 = 整个应用放行
        </p>

        {/* 正在运行的程序（每个窗口一行，直接平铺；🔍 开关控制自动扫描） */}
        <div className="flex items-center justify-between mb-2 shrink-0">
          <p className="text-sm font-medium">
            正在运行的程序（{runningApps.length}）
            {!scanOn && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>已暂停</span>}
          </p>
          <button
            onClick={() => setScanOn(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={scanOn
              ? { background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white', boxShadow: '0 2px 8px rgba(16,185,129,0.3)' }
              : { background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            title={scanOn ? '自动扫描中（每 5 秒），点击关闭' : '已关闭，点击开启自动寻找软件'}
          >
            🔍 寻找软件 {scanOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex-1 min-h-[80px] overflow-y-auto space-y-1 rounded-lg">
          {runningApps.map(win => {
            const wKey = win.name + '|' + (win.title || '')
            const covered = appCovered(win.name)
            const wc = winCovered(win)
            const noWindow = !win.title
            // 窗口级锁定的内联编辑行
            if (lockEdit === wKey) {
              return (
                <div key={wKey} className="flex items-center gap-2 py-1.5 px-2 text-xs rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                  <span className="font-medium w-28 truncate" title={win.title}>{displayName(win)}</span>
                  <input
                    value={lockInput}
                    onChange={(e) => setLockInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmLock(win); if (e.key === 'Escape') setLockEdit(null) }}
                    placeholder="标题关键词，如：高考物理"
                    autoFocus
                    className="flex-1 rounded-lg px-2 py-1 text-xs transition-all border focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] focus:outline-none"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={() => confirmLock(win)}
                    className="px-3 py-1 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white' }}
                  >
                    锁定
                  </button>
                  <button onClick={() => setLockEdit(null)} className="px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }}>取消</button>
                </div>
              )
            }
            return (
              <div
                key={wKey}
                className="flex items-center gap-2 py-1.5 px-2 text-sm rounded-lg transition-colors hover:bg-[var(--bg-card-hover)]"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <span className="w-5 text-center text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {noWindow ? '⚙' : '🪟'}
                </span>
                <span className="flex-1 truncate" title={win.title || win.name} style={{ color: 'var(--text-secondary)' }}>
                  {win.title || displayName(win)}
                </span>
                {noWindow && (
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>后台运行</span>
                )}
                {covered ? (
                  <span className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: 'var(--accent)' }}>✓ 已放行</span>
                ) : wc ? (
                  <span className="text-xs whitespace-nowrap flex-shrink-0" style={{ color: 'var(--accent)' }}>✓ 已锁定</span>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => addRunningApp(win)}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                      style={{ background: 'linear-gradient(135deg, #34d399, #059669)', color: 'white' }}
                    >
                      + 应用
                    </button>
                    <button
                      onClick={() => startLock(win)}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                      style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                    >
                      🔒 锁窗口
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {runningApps.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>没有检测到带窗口的程序，点「刷新」重试</p>
          )}
        </div>
      </div>

      {/* 专注模式说明：小按钮收起，点击展开全部说明 */}
      <div className="shrink-0">
        <button
          onClick={() => setGuideOpen(v => !v)}
          className={'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all ' + (glowOn ? 'hud-glow' : '')}
          onMouseMove={glowOn ? onGlow : undefined}
          style={{
            background: guideOpen ? 'var(--accent-bg)' : 'var(--bg-elevated)',
            color: guideOpen ? 'var(--accent)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="inline-block transition-transform duration-200" style={{ transform: guideOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
          ℹ️ 专注模式说明
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{guideOpen ? '点击收起' : '点击展开'}</span>
        </button>
        {guideOpen && (
          <div className="card relative overflow-hidden mt-2">
            <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
              <li>🪟 非白名单软件只会被<b>盖住</b>，不会关闭——微信、QQ、下载都还在后台正常运行</li>
              <li>🔒 <b>窗口级锁定</b>：只有标题包含关键词的窗口放行（如 B 站只放行「高考物理」）</li>
              <li>🏠 <b>主界面规则</b>：点专注桌面条目 = 显示软件主界面（固定 30 秒），30 秒后自动覆盖</li>
              <li>💥 <b>不匹配即覆盖</b>：不匹配关键词的窗口一律盖住（不会关闭）；仅哔哩哔哩的不匹配视频窗口会被关闭</li>
              <li>🍃 白名单为空时自动包含澜山；澜山进程永远不会被拦截</li>
              <li>⏱ 中途崩溃/重启会恢复锁屏，时间没到专注桌面会重新弹出</li>
              <li>🔓 Esc 或 Ctrl+Shift+F10 随时可结束专注</li>
              <li>🌐 浏览器内的网页无法按网站屏蔽（属于后续版本）</li>
            </ul>
          </div>
        )}
        {message && (
          <p className="text-xs mt-2" style={{ color: 'var(--accent)' }}>{message}</p>
        )}
      </div>
          </div>
        </div>
      </div>
    </div>
  )
}
