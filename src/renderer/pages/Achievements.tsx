import { useState, useEffect } from 'react'
import { formatShortDuration, getSubjectIcon } from '../utils'

interface AchievementItem {
  id: string; unlocked: boolean; unlocked_at: string | null; progress: number; progress_max: number
}

const META: Record<string,{icon:string;name:string;desc:string;hidden?:boolean;order:number}> = {
  'total-30h':{icon:'🌱',name:'破土',desc:'累计学习 30 小时',order:1},
  'total-100h':{icon:'🌿',name:'抽枝',desc:'累计学习 100 小时',order:2},
  'total-250h':{icon:'🌲',name:'成木',desc:'累计学习 250 小时',order:3},
  'streak-3':{icon:'🔥',name:'三日火',desc:'连续打卡 3 天',order:4},
  'streak-7':{icon:'💎',name:'七日焰',desc:'连续打卡 7 天',order:5},
  'streak-14':{icon:'⚡',name:'双周燃',desc:'连续打卡 14 天',order:6},
  'phy-20':{icon:'🔋',name:'物理·初涉',desc:'物理累计 20 小时',order:7},
  'phy-60':{icon:'⚡',name:'物理·半程',desc:'物理累计 60 小时',order:8},
  'phy-100':{icon:'⚛️',name:'物理·凌顶',desc:'物理累计 100 小时',order:9},
  'math-15':{icon:'🔢',name:'数学·初涉',desc:'数学累计 15 小时',order:10},
  'math-50':{icon:'📊',name:'数学·半程',desc:'数学累计 50 小时',order:11},
  'math-85':{icon:'🧮',name:'数学·凌顶',desc:'数学累计 85 小时',order:12},
  'eng-20':{icon:'🔤',name:'英语·初涉',desc:'英语累计 20 小时',order:13},
  'eng-70':{icon:'📝',name:'英语·半程',desc:'英语累计 70 小时',order:14},
  'eng-120':{icon:'🌐',name:'英语·凌顶',desc:'英语累计 120 小时',order:15},
  'daily-6h':{icon:'🌊',name:'一日澜山',desc:'单日 ≥ 6 小时',order:16},
  'daily-8h':{icon:'⛰️',name:'登顶',desc:'单日 ≥ 8 小时',order:17},
  'morning-5':{icon:'🌄',name:'初曙',desc:'5 天 7:00前',order:18},
  'morning-10':{icon:'🌅',name:'晨光',desc:'10 天 7:00前',order:19},
  'morning-18':{icon:'☀️',name:'黎常',desc:'18 天 7:00前',order:20},
  'night-5':{icon:'🌇',name:'晚灯',desc:'5 天 22:00后',order:21},
  'night-10':{icon:'🌙',name:'夜烛',desc:'10 天 22:00后',order:22},
  'night-18':{icon:'🌌',name:'星伴',desc:'18 天 22:00后',order:23},
  'focus-2h-3':{icon:'🎯',name:'入定',desc:'3 天专注 ≥2h',order:24},
  'focus-2h-7':{icon:'🧘',name:'忘我',desc:'7 天专注 ≥2h',order:25},
  'focus-3h-3':{icon:'🌊',name:'化境',desc:'3 天专注 ≥3h',order:26},
  'comeback-6h':{icon:'🐴',name:'黑马',desc:'逆袭 6h+',order:27},
  'comeback-8h':{icon:'⚔️',name:'绝地',desc:'绝地反击 8h+',order:28},
  'burst-phy':{icon:'⚛️💥',name:'物理暴击',desc:'单日物理 ≥4h',order:29},
  'burst-math':{icon:'🧮💥',name:'数学暴击',desc:'单日数学 ≥4h',order:30},
  'burst-eng':{icon:'🔤💥',name:'英语暴击',desc:'单日英语 ≥4h',order:31},
  'balanced':{icon:'⚖️',name:'稳行者',desc:'三科均衡达标',order:32},
  'dawn-dusk':{icon:'🌗',name:'朝暮行',desc:'同一天晨行+夜航',order:33},
  'over-phy-10':{icon:'⚛️🔥',name:'物理狂热者',desc:'物理超额 10 天',hidden:true,order:34},
  'over-math-10':{icon:'🧮🔥',name:'数学狂热者',desc:'数学超额 10 天',hidden:true,order:35},
  'over-eng-10':{icon:'🔤🔥',name:'英语狂热者',desc:'英语超额 10 天',hidden:true,order:36},
  'triple-over':{icon:'🏆',name:'大满贯日',desc:'三科全超额',hidden:true,order:37},
  'triple-3':{icon:'🔥🔥🔥',name:'三连绝世',desc:'连续 3 天三科全超',hidden:true,order:38},
}

function fmt(s: number): string {
  return s > 3600 ? formatShortDuration(s) : s > 60 ? `${Math.floor(s/60)}m` : `${s}s`
}

export default function Achievements(): React.ReactElement {
  const [items, setItems] = useState<AchievementItem[]>([])

  useEffect(() => {
    window.lanshan.getAchievements().then(setItems)
    const i = setInterval(() => window.lanshan.getAchievements().then(setItems), 30000)
    return () => clearInterval(i)
  }, [])

  if (items.length === 0) {
    return <div className="flex items-center justify-center h-64 text-sm" style={{color:'var(--text-muted)'}}>暂无成就数据</div>
  }

  const unlocked = items.filter(i => i.unlocked)
  // Sort purely by defined order
  const sorted = [...items].sort((a, b) => {
    return (META[a.id]?.order || 99) - (META[b.id]?.order || 99)
  })

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">🏆 成就</h2>
        <span className="text-sm" style={{color:'var(--text-muted)'}}>已解锁 {unlocked.length}/{items.length}</span>
      </div>

      <div className="card py-3 px-5">
        <div className="h-2 rounded-full overflow-hidden" style={{background:'var(--bg-elevated)'}}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{width:`${items.length ? Math.round(unlocked.length/items.length*100) : 0}%`, background:'linear-gradient(90deg,#10b981,#34d399)'}}
          />
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map(item => {
          const m = META[item.id]
          if (!m) return null
          const isHidden = m.hidden && !item.unlocked
          const pct = Math.min(Math.round((item.progress / item.progress_max) * 100), 100)
          const name = isHidden ? '???' : m.name
          const desc = isHidden ? '隐藏成就，达成后揭晓' : m.desc
          const icon = isHidden ? '❓' : m.icon

          return (
            <div key={item.id} className="card flex items-center gap-4 py-3 px-5 transition-all"
              style={{opacity: item.unlocked ? 1 : isHidden ? 0.4 : 0.7}}
            >
              <span className="text-2xl flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{name}</p>
                  {item.unlocked && <span className="text-xs" style={{color:'var(--accent)'}}>✓</span>}
                </div>
                <p className="text-xs mt-0.5" style={{color:'var(--text-muted)'}}>{desc}</p>
                {!item.unlocked && item.progress > 0 && (
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{background:'var(--bg-elevated)'}}>
                    <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background:'var(--accent)'}} />
                  </div>
                )}
              </div>
              <span className="text-xs flex-shrink-0" style={{color:'var(--text-muted)'}}>
                {item.unlocked
                  ? (item.unlocked_at ? new Date(item.unlocked_at).toLocaleDateString('zh-CN') : '已解锁')
                  : item.progress > 0
                    ? (item.progress_max > 3600 ? `${fmt(item.progress)}/${fmt(item.progress_max)}` : `${Math.round(item.progress)}/${item.progress_max}`)
                    : '未解锁'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
