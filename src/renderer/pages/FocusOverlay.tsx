import { useState, useEffect } from 'react'
import { formatCountdown } from '../utils'

/** 专注桌面：全屏覆盖层，白名单软件图标 + 大倒计时，只有点这里的软件才能用 */
export default function FocusOverlay(): React.ReactElement {
  const [state, setState] = useState<FocusState | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')

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
    const unsubscribe = window.lanshan.onFocusTick((tick) => {
      setState(prev => prev ? { ...prev, ...tick } : prev)
    })
    const clock = setInterval(() => setNow(Date.now()), 1000)
    // 键盘逃生：Esc 或 Ctrl+Shift+F10 直接结束专注（不弹确认，保证能退出）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.ctrlKey && e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        window.lanshan.stopFocus().catch(() => { /* 主进程侧还有全局快捷键兜底 */ })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { unsubscribe(); clearInterval(clock); window.removeEventListener('keydown', onKey) }
  }, [])

  function tileLabel(a: FocusApp): string {
    const base = a.title === '澜山' ? '澜山' : a.name.replace(/\.exe$/i, '')
    // 窗口级条目显示关键词，便于区分同一软件的多个学科窗口
    return a.titleMatch ? `${base}·${a.titleMatch}` : base
  }

  async function launch(a: FocusApp): Promise<void> {
    // 按「进程名 + 关键词」精确跳转到对应窗口（避免切到不匹配窗口被盖回）
    await window.lanshan.launchFocusApp(a.name, a.titleMatch)
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
  const finished = state !== null && !state.active

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{
        background: 'linear-gradient(140deg, #022c22 0%, #064e3b 45%, #0f766e 100%)',
        color: '#ecfdf5',
      }}
    >
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-10 pt-8 select-none">
        <div className="flex items-center gap-2.5 text-lg font-medium" style={{ color: 'rgba(236,253,245,0.85)' }}>
          <span className="text-2xl">🍅</span>
          专注中
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{timeText}</div>
          <div className="text-sm mt-0.5" style={{ color: 'rgba(236,253,245,0.6)' }}>{dateText}</div>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex flex-col items-center justify-center px-10 select-none">
        {finished ? (
          <>
            <div className="text-7xl mb-4">🎉</div>
            <div className="text-3xl font-bold">专注完成！</div>
            <p className="mt-2 text-base" style={{ color: 'rgba(236,253,245,0.7)' }}>
              本次共专注 {state.durationMin} 分钟
            </p>
          </>
        ) : (
          <>
            <div className="tabular-nums font-bold tracking-tight" style={{ fontSize: 'min(16vh, 9rem)', lineHeight: 1 }}>
              {formatCountdown(state?.remainingSec ?? 0)}
            </div>
            <p className="mt-3 text-base" style={{ color: 'rgba(236,253,245,0.7)' }}>
              剩余时间 · 点击下方图标使用软件
            </p>
          </>
        )}

        {/* 白名单图标网格 */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-12 max-w-4xl">
          {(state?.whitelist || []).map(a => {
            const icon = icons[a.name.toLowerCase()]
            const label = tileLabel(a)
            return (
              <button
                key={a.name + (a.titleMatch || '')}
                onClick={() => launch(a)}
                className="flex flex-col items-center gap-2 w-28 py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                {icon ? (
                  <img src={icon} alt={label} className="w-12 h-12 rounded-xl" draggable={false} />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-semibold"
                    style={{ background: 'rgba(255,255,255,0.14)' }}
                  >
                    {label === '澜山' ? '🍃' : label.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm max-w-full truncate px-1" title={label} style={{ color: 'rgba(236,253,245,0.9)' }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 底部 */}
      <div className="flex items-center justify-between px-10 pb-8 select-none">
        <p className="text-xs" style={{ color: 'rgba(236,253,245,0.5)' }}>
          {error ? <span style={{ color: '#fca5a5' }}>⚠ {error}</span> : '其他软件已被暂时遮蔽（未关闭，仍在后台运行）· Esc 或 Ctrl+Shift+F10 可结束'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={quitApp}
            className="px-5 py-2.5 rounded-xl text-sm transition-all hover:bg-white/20"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(236,253,245,0.8)' }}
          >
            退出应用
          </button>
          <button
            onClick={endFocus}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all hover:bg-white/20"
            style={{ background: 'rgba(239,68,68,0.85)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            ⏹ 结束专注
          </button>
        </div>
      </div>
    </div>
  )
}
