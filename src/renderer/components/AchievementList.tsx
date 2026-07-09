import { useState, useEffect } from 'react'
import { getSubjectIcon, formatShortDuration } from '../utils'

interface AchievementItem {
  id: string
  unlocked: boolean
  unlocked_at: string | null
  progress: number
  progress_max: number
}

const META: Record<string, { icon: string; name: string; group: string; hidden?: boolean }> = {
  'total-30h': { icon:'🌱', name:'破土', group:'累计学习' },
  'total-100h': { icon:'🌿', name:'抽枝', group:'累计学习' },
  'total-250h': { icon:'🌲', name:'成木', group:'累计学习' },
  'streak-3': { icon:'🔥', name:'三日火', group:'连续打卡' },
  'streak-7': { icon:'💎', name:'七日焰', group:'连续打卡' },
  'streak-14': { icon:'⚡', name:'双周燃', group:'连续打卡' },
  'phy-20': { icon:'🔋', name:'物理·初涉', group:'物理' },
  'phy-60': { icon:'⚡', name:'物理·半程', group:'物理' },
  'phy-100': { icon:'⚛️', name:'物理·凌顶', group:'物理' },
  'math-15': { icon:'🔢', name:'数学·初涉', group:'数学' },
  'math-50': { icon:'📊', name:'数学·半程', group:'数学' },
  'math-85': { icon:'🧮', name:'数学·凌顶', group:'数学' },
  'eng-20': { icon:'🔤', name:'英语·初涉', group:'英语' },
  'eng-70': { icon:'📝', name:'英语·半程', group:'英语' },
  'eng-120': { icon:'🌐', name:'英语·凌顶', group:'英语' },
  'daily-6h': { icon:'🌊', name:'一日澜山', group:'单日爆发' },
  'daily-8h': { icon:'⛰️', name:'登顶', group:'单日爆发' },
  'morning-5': { icon:'🌄', name:'初曙', group:'晨行者' },
  'morning-10': { icon:'🌅', name:'晨光', group:'晨行者' },
  'morning-18': { icon:'☀️', name:'黎常', group:'晨行者' },
  'night-5': { icon:'🌇', name:'晚灯', group:'夜航人' },
  'night-10': { icon:'🌙', name:'夜烛', group:'夜航人' },
  'night-18': { icon:'🌌', name:'星伴', group:'夜航人' },
  'focus-2h-3': { icon:'🎯', name:'入定', group:'极限专注' },
  'focus-2h-7': { icon:'🧘', name:'忘我', group:'极限专注' },
  'focus-3h-3': { icon:'🌊', name:'化境', group:'极限专注' },
  'comeback-6h': { icon:'🐴', name:'黑马', group:'逆袭' },
  'comeback-8h': { icon:'⚔️', name:'绝地', group:'逆袭' },
  'burst-phy': { icon:'⚛️💥', name:'物理暴击', group:'单科暴击' },
  'burst-math': { icon:'🧮💥', name:'数学暴击', group:'单科暴击' },
  'burst-eng': { icon:'🔤💥', name:'英语暴击', group:'单科暴击' },
  'balanced': { icon:'⚖️', name:'稳行者', group:'均衡日' },
  'dawn-dusk': { icon:'🌗', name:'朝暮行', group:'朝暮行' },
  'over-phy-10': { icon:'⚛️🔥', name:'物理狂热者', group:'物理', hidden: true },
  'over-math-10': { icon:'🧮🔥', name:'数学狂热者', group:'数学', hidden: true },
  'over-eng-10': { icon:'🔤🔥', name:'英语狂热者', group:'英语', hidden: true },
  'triple-over': { icon:'🏆', name:'大满贯日', group:'单日爆发', hidden: true },
  'triple-3': { icon:'🔥🔥🔥', name:'三连绝世', group:'单日爆发', hidden: true },
}

const GROUP_ORDER = ['累计学习','连续打卡','物理','数学','英语','单日爆发','晨行者','夜航人','极限专注','逆袭','单科暴击','均衡日','朝暮行']

function formatDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  const today = new Date()
  if (dt.toDateString() === today.toDateString()) return '今天'
  return dt.toLocaleDateString('zh-CN')
}

function fmtProg(seconds: number): string {
  if (seconds > 3600) return formatShortDuration(seconds)
  if (seconds > 60) return `${Math.floor(seconds / 60)}m`
  return `${seconds}s`
}

export default function AchievementList({ compact }: { compact?: boolean }): React.ReactElement {
  const [items, setItems] = useState<AchievementItem[]>([])

  useEffect(() => {
    window.lanshan.getAchievements().then(setItems)
  }, [])

  const unlocked = items.filter(i => i.unlocked)
  const locked = items.filter(i => !i.unlocked)

  // Compact mode: show all unlocked sorted by time desc, trim if overflow
  if (compact) {
    if (unlocked.length === 0) {
      return <div className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>还没有解锁的成就</div>
    }
    const sorted = [...unlocked].sort((a, b) => {
      if (!a.unlocked_at) return 1
      if (!b.unlocked_at) return -1
      return b.unlocked_at.localeCompare(a.unlocked_at)
    })
    return (
      <div className="space-y-1.5">
        {sorted.map(item => {
          const m = META[item.id]
          if (!m) return null
          return (
            <div key={item.id} className="flex items-center gap-2 py-1 px-2 rounded-lg" style={{ background: 'var(--accent-bg)' }}>
              <span className="text-sm">{m.icon}</span>
              <span className="text-xs truncate flex-1">{m.name}</span>
              {item.unlocked_at && <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(item.unlocked_at)}</span>}
              <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>✓</span>
            </div>
          )
        })}
      </div>
    )
  }

  // Full mode: grouped
  return (
    <div className="space-y-6">
      {GROUP_ORDER.map(group => {
        const groupItems = items.filter(i => {
          const m = META[i.id]
          if (!m || m.group !== group) return false
          if (m.hidden && !i.unlocked) return false // hidden: only show if unlocked
          return true
        })
        if (groupItems.length === 0) return null
        return (
          <div key={group}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{group}</h3>
            <div className="grid grid-cols-3 gap-3">
              {groupItems.map(item => {
                const m = META[item.id]
                if (!m) return null
                const pct = Math.min(Math.round((item.progress / item.progress_max) * 100), 100)
                return (
                  <div key={item.id} className="rounded-xl py-3 px-3 border-l-4 transition-all"
                    style={{
                      background: 'var(--bg-elevated)',
                      borderColor: item.unlocked ? '#22c55e' : 'var(--border-light)',
                      opacity: item.unlocked ? 1 : item.progress > 0 ? 0.85 : 0.5,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{m.hidden && !item.unlocked ? '❓' : m.icon}</span>
                      <span className="text-xs font-semibold truncate">{m.hidden && !item.unlocked ? '???' : m.name}</span>
                      {item.unlocked && <span className="text-xs ml-auto" style={{ color: '#22c55e' }}>✓</span>}
                    </div>
                    {!item.unlocked && (
                      <div className="mt-1.5">
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {item.progress_max > 3600
                            ? `${fmtProg(item.progress)} / ${fmtProg(item.progress_max)}`
                            : `${Math.round(item.progress)} / ${item.progress_max}`}
                        </p>
                      </div>
                    )}
                    {item.unlocked && item.unlocked_at && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(item.unlocked_at)} 解锁
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
