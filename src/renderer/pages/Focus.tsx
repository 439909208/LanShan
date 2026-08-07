import { useState, useEffect } from 'react'
import { formatCountdown } from '../utils'

const PRESETS = [25, 45, 60]

/** 白名单条目的显示名（去掉 .exe） */
function displayName(a: FocusApp): string {
  return a.title === '澜山' ? '澜山' : a.name.replace(/\.exe$/i, '')
}

export default function Focus(): React.ReactElement {
  const [state, setState] = useState<FocusState | null>(null)
  const [runningApps, setRunningApps] = useState<FocusApp[]>([])
  const [preset, setPreset] = useState(25)
  const [customMin, setCustomMin] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualMatch, setManualMatch] = useState('')
  const [message, setMessage] = useState('')
  // 窗口级锁定的内联编辑状态
  const [lockEdit, setLockEdit] = useState<string | null>(null)
  const [lockInput, setLockInput] = useState('')
  // 运行列表按进程分组 + 展开状态
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  /** 窗口列表按进程名分组 */
  const groupedApps = (() => {
    const m = new Map<string, FocusApp[]>()
    for (const a of runningApps) {
      const k = a.name.toLowerCase()
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(a)
    }
    return [...m.entries()]
  })()

  function toggleExpand(name: string): void {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
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
    refreshRunningApps()
    const unsubscribe = window.lanshan.onFocusTick((tick) => {
      setState(prev => prev ? { ...prev, ...tick } : prev)
    })
    return unsubscribe
  }, [])

  async function refreshRunningApps(): Promise<void> {
    setRunningApps(await window.lanshan.getRunningApps())
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

  /** 确认窗口级锁定：仅标题包含关键词的窗口放行（同一进程可加多个不同关键词条目） */
  function confirmLock(app: FocusApp): void {
    const keyword = lockInput.trim()
    if (!keyword) {
      setMessage('请输入标题关键词（例如：高考物理）')
      return
    }
    if (!state) return
    const next = [
      // 保留其他条目（包括同名不同关键词），仅去掉完全重复的
      ...state.whitelist.filter(a => !(a.name.toLowerCase() === app.name.toLowerCase() && (a.titleMatch || '') === keyword)),
      { name: app.name, path: app.path, title: app.title, titleMatch: keyword },
    ]
    updateWhitelist(next)
    setLockEdit(null)
    setLockInput('')
    setMessage(`已锁定 ${displayName(app)}：仅标题包含「${keyword}」的窗口放行`)
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

  return (
    <div className="space-y-5 max-w-2xl">
      {/* 专注计时 */}
      <div className="card">
        <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
          🍅 专注计时
        </h3>
        {state?.active ? (
          <div className="text-center py-2">
            <div
              className="tabular-nums text-6xl font-bold tracking-tight"
              style={{ color: 'var(--accent)' }}
            >
              {formatCountdown(state.remainingSec)}
            </div>
            <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
              专注中 · 已坚持 {state.durationMin - Math.ceil(state.remainingSec / 60)} / {state.durationMin} 分钟
              · 白名单 {whitelist.length} 个软件
            </p>
            <button
              onClick={stopFocus}
              className="mt-5 px-6 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              ⏹ 结束专注
            </button>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map(m => (
                <button
                  key={m}
                  onClick={() => { setPreset(m); setCustomMin('') }}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={
                    selectedMin === m
                      ? { background: 'var(--accent)', color: 'white' }
                      : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }
                  }
                >
                  {m} 分钟
                </button>
              ))}
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="number"
                  min="1"
                  max="600"
                  placeholder="自定义"
                  className="rounded-lg px-3 py-2 text-sm w-24 text-center transition-all"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-light)',
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
              className="mt-5 px-8 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              🚀 开始专注
            </button>
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              开始后主窗口隐藏，全屏专注桌面弹出：只有白名单里的软件可用，其他软件会被盖住（不会关闭，仍在后台运行）
            </p>
          </div>
        )}
      </div>

      {/* 白名单 */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          📋 专注白名单
        </h3>

        {/* 当前白名单 */}
        <div className="flex flex-wrap gap-2 mb-5">
          {whitelist.map(a => (
            <div
              key={a.name + (a.titleMatch || '')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--accent-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              <span className="font-medium">
                {a.titleMatch ? '🔒' : '📱'} {displayName(a)}
                {a.titleMatch && (
                  <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>「{a.titleMatch}」</span>
                )}
              </span>
              <button onClick={() => removeApp(a.name, a.titleMatch)} className="text-xs" style={{ color: '#ef4444' }}>✕</button>
            </div>
          ))}
          {whitelist.length === 0 && (
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
            className="rounded-lg px-3 py-2 text-sm flex-1 min-w-0 transition-all"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
            }}
          />
          <input
            value={manualMatch}
            onChange={(e) => setManualMatch(e.target.value)}
            placeholder="标题关键词（可选，锁定窗口）"
            className="rounded-lg px-3 py-2 text-sm w-48 transition-all"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={addManual}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            + 添加
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          填了标题关键词 = 窗口级锁定（仅标题包含该关键词的窗口放行）；不填 = 整个应用放行
        </p>

        {/* 正在运行的程序 */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">正在运行的程序（每个窗口一行）</p>
          <button
            onClick={refreshRunningApps}
            className="text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            🔄 刷新
          </button>
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {groupedApps.map(([name, wins]) => {
            const covered = appCovered(name)
            const noWindow = wins.length === 1 && !wins[0].title
            const isOpen = expanded.has(name)
            return (
              <div key={name} className="rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
                {/* 进程行 */}
                <div className="flex items-center gap-2 py-1.5 px-2 text-sm">
                  <button
                    onClick={() => toggleExpand(name)}
                    disabled={noWindow}
                    className="w-5 text-center text-xs transition-all"
                    style={{ color: 'var(--text-muted)', opacity: noWindow ? 0.3 : 1 }}
                    title={isOpen ? '收起窗口' : '展开窗口'}
                  >
                    {noWindow ? '' : isOpen ? '▾' : '▸'}
                  </button>
                  <span className="font-medium w-28 truncate" title={name}>{displayName({ name })}</span>
                  <span className="flex-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {noWindow ? '无窗口（后台运行）' : `${wins.length} 个窗口`}
                  </span>
                  {covered ? (
                    <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>✓ 已放行</span>
                  ) : (
                    <button
                      onClick={() => addRunningApp(wins[0])}
                      className="px-3 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      + 应用
                    </button>
                  )}
                </div>
                {/* 展开的窗口列表 */}
                {isOpen && !noWindow && wins.map(win => {
                  const wKey = win.name + '|' + (win.title || '')
                  const wc = winCovered(win)
                  if (lockEdit === wKey) {
                    return (
                      <div key={wKey} className="flex items-center gap-2 py-1.5 pl-8 pr-2 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                        <span className="font-medium w-28 truncate" title={win.title}>{displayName(win)}</span>
                        <input
                          value={lockInput}
                          onChange={(e) => setLockInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') confirmLock(win); if (e.key === 'Escape') setLockEdit(null) }}
                          placeholder="标题关键词，如：高考物理"
                          autoFocus
                          className="flex-1 rounded-lg px-2 py-1 text-xs transition-all"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        />
                        <button
                          onClick={() => confirmLock(win)}
                          className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                          style={{ background: 'var(--accent)', color: 'white' }}
                        >
                          锁定
                        </button>
                        <button onClick={() => setLockEdit(null)} className="px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }}>取消</button>
                      </div>
                    )
                  }
                  return (
                    <div key={wKey} className="flex items-center gap-2 py-1.5 pl-8 pr-2 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
                      <span className="flex-1 truncate" title={win.title} style={{ color: 'var(--text-secondary)' }}>
                        {win.title || ''}
                      </span>
                      {wc ? (
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>✓ 已锁定</span>
                      ) : (
                        <button
                          onClick={() => startLock(win)}
                          className="px-3 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                        >
                          🔒 锁窗口
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {runningApps.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>没有检测到带窗口的程序，点「刷新」重试</p>
          )}
        </div>
      </div>

      {/* 说明 */}
      <div className="card">
        <h3 className="text-base font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
          ℹ️ 专注模式说明
        </h3>
        <ul className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>🪟 非白名单软件只会被<b>盖住</b>，不会关闭——微信、QQ、下载都还在后台正常运行</li>
          <li>🔒 <b>窗口级锁定</b>：只有标题包含关键词的窗口放行（如 B 站只放行「高考物理」）</li>
          <li>🏠 <b>主界面规则</b>：点专注桌面条目 = 显示软件主界面（固定 30 秒），30 秒后自动覆盖</li>
          <li>💥 <b>不匹配即结束</b>：检测到不匹配关键词的视频窗口，直接结束其进程（保留主界面）</li>
          <li>🍃 白名单为空时自动包含澜山；澜山进程永远不会被拦截</li>
          <li>⏱ 中途崩溃/重启会恢复锁屏，时间没到专注桌面会重新弹出</li>
          <li>🔓 Esc 或 Ctrl+Shift+F10 随时可结束专注</li>
          <li>🌐 浏览器内的网页无法按网站屏蔽（属于后续版本）</li>
        </ul>
        {message && (
          <p className="text-xs mt-4" style={{ color: 'var(--accent)' }}>{message}</p>
        )}
      </div>
    </div>
  )
}
