import { useState, useEffect, useCallback } from 'react'

interface Toast { id: number; icon: string; name: string; desc: string }

const META: Record<string, { icon: string; name: string; desc: string }> = {
  'total-30h': { icon: '🌱', name: '破土', desc: '累计学习 30 小时' },
  'total-100h': { icon: '🌿', name: '抽枝', desc: '累计学习 100 小时' },
  'total-250h': { icon: '🌲', name: '成木', desc: '累计学习 250 小时' },
  'streak-3': { icon: '🔥', name: '三日火', desc: '连续打卡 3 天' },
  'streak-7': { icon: '💎', name: '七日焰', desc: '连续打卡 7 天' },
  'streak-14': { icon: '⚡', name: '双周燃', desc: '连续打卡 14 天' },
  'phy-20': { icon: '🔋', name: '物理·初涉', desc: '物理 20 小时' },
  'phy-60': { icon: '⚡', name: '物理·半程', desc: '物理 60 小时' },
  'phy-100': { icon: '⚛️', name: '物理·凌顶', desc: '物理 100 小时' },
  'math-15': { icon: '🔢', name: '数学·初涉', desc: '数学 15 小时' },
  'math-50': { icon: '📊', name: '数学·半程', desc: '数学 50 小时' },
  'math-85': { icon: '🧮', name: '数学·凌顶', desc: '数学 85 小时' },
  'eng-20': { icon: '🔤', name: '英语·初涉', desc: '英语 20 小时' },
  'eng-70': { icon: '📝', name: '英语·半程', desc: '英语 70 小时' },
  'eng-120': { icon: '🌐', name: '英语·凌顶', desc: '英语 120 小时' },
  'daily-6h': { icon: '🌊', name: '一日澜山', desc: '单日 6 小时' },
  'daily-8h': { icon: '⛰️', name: '登顶', desc: '单日 8 小时' },
  'morning-5': { icon: '🌄', name: '初曙', desc: '5 天 7:00前学习' },
  'morning-10': { icon: '🌅', name: '晨光', desc: '10 天 7:00前学习' },
  'morning-18': { icon: '☀️', name: '黎常', desc: '18 天 7:00前学习' },
  'night-5': { icon: '🌇', name: '晚灯', desc: '5 天 22:00后学习' },
  'night-10': { icon: '🌙', name: '夜烛', desc: '10 天 22:00后学习' },
  'night-18': { icon: '🌌', name: '星伴', desc: '18 天 22:00后学习' },
  'focus-2h-3': { icon: '🎯', name: '入定', desc: '3 天专注 ≥2h' },
  'focus-2h-7': { icon: '🧘', name: '忘我', desc: '7 天专注 ≥2h' },
  'focus-3h-3': { icon: '🌊', name: '化境', desc: '3 天专注 ≥3h' },
  'comeback-6h': { icon: '🐴', name: '黑马', desc: '逆袭 6h+' },
  'comeback-8h': { icon: '⚔️', name: '绝地', desc: '绝地反击 8h+' },
  'burst-phy': { icon: '⚛️💥', name: '物理暴击', desc: '单日物理 ≥4h' },
  'burst-math': { icon: '🧮💥', name: '数学暴击', desc: '单日数学 ≥4h' },
  'burst-eng': { icon: '🔤💥', name: '英语暴击', desc: '单日英语 ≥4h' },
  'balanced': { icon: '⚖️', name: '稳行者', desc: '三科均衡达标' },
  'dawn-dusk': { icon: '🌗', name: '朝暮行', desc: '同一日晨行+夜航' },
  'over-phy-10': { icon: '⚛️🔥', name: '物理狂热者', desc: '物理超额 10 天' },
  'over-math-10': { icon: '🧮🔥', name: '数学狂热者', desc: '数学超额 10 天' },
  'over-eng-10': { icon: '🔤🔥', name: '英语狂热者', desc: '英语超额 10 天' },
  'triple-over': { icon: '🏆', name: '大满贯日', desc: '三科全超额' },
  'triple-3': { icon: '🔥🔥🔥', name: '三连绝世', desc: '连续 3 天三科全超' },
}

export default function ToastContainer(): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const ids: string[] = Array.isArray(detail) ? detail : detail.ids || [detail.id]
      const items: Toast[] = ids.map(id => {
        const m = META[id]
        return {
          id: Date.now() + Math.random(),
          icon: m?.icon || '🏆',
          name: m?.name || id,
          desc: m?.desc || '新成就解锁！',
        }
      })
      setToasts(prev => [...prev, ...items])
      // Auto-dismiss each after 3s
      items.forEach(t => {
        setTimeout(() => setToasts(p => p.filter(x => x.id !== t.id)), 3000)
      })
    }
    window.addEventListener('achievement-unlock', handler)
    return () => window.removeEventListener('achievement-unlock', handler)
  }, [])

  if (toasts.length === 0) return <></>

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="slide-in rounded-xl px-4 py-3 shadow-lg min-w-[220px] border-l-4 border-[#10b981]"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--accent)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{t.icon}</span>
            <div>
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.desc}</p>
            </div>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes si { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .slide-in { animation: si 0.3s ease-out; }
      `}</style>
    </div>
  )
}
