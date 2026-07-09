import { useState, useEffect } from 'react'
import AchievementList from './AchievementList'

interface Props { onClose: () => void }

function MountainScene(unlocked: number): React.ReactElement {
  const level = unlocked >= 17 ? 6 : unlocked >= 14 ? 5 : unlocked >= 10 ? 4 : unlocked >= 7 ? 3 : unlocked >= 3 ? 2 : unlocked >= 1 ? 1 : 0
  const peaks = [
    { h: 180, color: '#64748b', label: '荒山' },
    { h: 160, color: '#64748b', label: '嫩芽', plant: '🌱' },
    { h: 140, color: '#86efac', label: '灌木', plant: '🌿🌱' },
    { h: 120, color: '#4ade80', label: '绿意', plant: '🌿🌿🌱' },
    { h: 100, color: '#22c55e', label: '成林', plant: '🌲🌿🌱' },
    { h: 80, color: '#16a34a', label: '苍翠', plant: '🌲🌲🌿🌱' },
    { h: 60, color: '#15803d', label: '澜山', plant: '🌲🌲🌲🌿🌱' },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full relative">
      {/* Mountain SVG */}
      <svg viewBox="0 0 300 220" className="w-full max-w-[240px]">
        {/* Sky */}
        <rect width="300" height="220" fill="var(--bg-primary)" rx="12" />
        {/* Background mountain */}
        <path d="M0 220 L60 100 L120 160 L180 80 L240 130 L300 100 L300 220 Z" fill={peaks[Math.min(level, peaks.length - 1)].color} opacity={0.3} />
        {/* Main mountain */}
        <path d="M30 220 L150 60 L270 220 Z" fill={peaks[Math.min(level, peaks.length - 1)].color} opacity={0.6} />
        {/* Foreground hill */}
        <ellipse cx="150" cy="220" rx="160" ry="40" fill={peaks[Math.min(level, peaks.length - 1)].color} opacity={0.4} />
      </svg>
      {/* Plants overlay */}
      {level >= 1 && <span className="absolute" style={{ bottom: '28%', left: '38%', fontSize: 20 }}>{peaks[level].plant?.split('')[0]}</span>}
      {level >= 3 && <span className="absolute" style={{ bottom: '22%', right: '35%', fontSize: 24 }}>{peaks[level].plant?.split('')[1]}</span>}
      {level >= 5 && <span className="absolute" style={{ bottom: '18%', left: '30%', fontSize: 28 }}>{peaks[level].plant?.split('')[0]}</span>}
      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{peaks[level].label}</p>
    </div>
  )
}

export default function AchievementModal({ onClose }: Props): React.ReactElement {
  const [items, setItems] = useState<any[]>([])
  const [unlocked, setUnlocked] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    window.lanshan.getAchievements().then((data: any[]) => {
      setItems(data)
      setUnlocked(data.filter((i: any) => i.unlocked).length)
      setTotal(data.length)
    })
  }, [])

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-50 m-4 rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-sm flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            ← 返回
          </button>
          <span className="text-base font-semibold">成就</span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{unlocked}/{total}</span>
        </div>

        {/* Content */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Mountain */}
          <div className="w-[35%] flex-shrink-0 border-r flex flex-col items-center justify-center p-4" style={{ borderColor: 'var(--border)' }}>
            {MountainScene(unlocked)}
            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>已解锁 {unlocked}/{total}</p>
          </div>

          {/* Right: Achievement list */}
          <div className="flex-1 overflow-y-auto p-5">
            <AchievementList />
          </div>
        </div>
      </div>
    </>
  )
}
