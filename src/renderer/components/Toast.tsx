import { useState, useEffect } from 'react'
import type { SealDefLike } from '../sealTypes'
import SealIcon from './SealIcon'

interface Toast { id: number; sealId: string; name: string; desc: string }

/**
 * 全局刻章 toast：监听 seal-unlock 事件（detail: { cumulative: string[], daily: string[] }）。
 * 刻章定义走主进程 IPC（唯一数据源），红印样式 + 盖印动画。
 */
export default function ToastContainer(): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [defs, setDefs] = useState<Map<string, SealDefLike>>(new Map())

  useEffect(() => {
    window.lanshan.getSealDefs().then(ds => setDefs(new Map(ds.map(d => [d.id, d]))))
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      let ids: string[] = []
      if (Array.isArray(detail)) {
        ids = detail
      } else if (detail && typeof detail === 'object') {
        const d = detail as { cumulative?: string[]; daily?: string[] }
        ids = [...(d.cumulative || []), ...(d.daily || [])]
      }
      if (ids.length === 0) return
      const items: Toast[] = ids.map(id => {
        const m = defs.get(id)
        return {
          id: Date.now() + Math.random(),
          sealId: id,
          name: m?.name || id,
          desc: m?.congrats || m?.desc || '获得新刻章！',
        }
      })
      setToasts(prev => [...prev, ...items])
      // 依次淡出（后到的自动排队）
      items.forEach(t => {
        setTimeout(() => setToasts(p => p.filter(x => x.id !== t.id)), 3500)
      })
    }
    window.addEventListener('seal-unlock', handler)
    return () => window.removeEventListener('seal-unlock', handler)
  }, [defs])

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="seal-toast rounded-xl px-4 py-3 shadow-lg min-w-[220px]"
          style={{ background: 'var(--bg-card)', borderLeft: '4px solid var(--seal-red, #c0392b)' }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: 'var(--seal-red, #c0392b)', display: 'inline-flex' }}>
              <SealIcon id={t.sealId} size={26} />
            </span>
            <div>
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.desc}</p>
            </div>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes seal-toast-in {
          0% { transform: translateX(120%) scale(0.9); opacity: 0; }
          60% { transform: translateX(-6px) scale(1.02); opacity: 1; }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
        .seal-toast { animation: seal-toast-in 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
      `}</style>
    </div>
  )
}
