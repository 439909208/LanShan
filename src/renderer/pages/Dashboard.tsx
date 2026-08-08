import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSubjectIcon, getSubjectTierIcon, formatDuration, formatShortDuration } from '../utils'

const C_COLORS: Record<string, string> = {
  '物理': '#facc15',
  '数学': '#3b82f6',
  '英语': '#ef4444',
  '休闲': '#ec4899',
  '其他': '#9ca3af',
}
import SubjectRingChart from '../components/SubjectRingChart'
import WeekTrendChart from '../components/WeekTrendChart'
import HeatmapGrid from '../components/HeatmapGrid'
import AchievementList from '../components/AchievementList'
import AchievementModal from '../components/AchievementModal'
import Timeline from '../components/Timeline'

interface SubjectProgress {
  subject: string
  totalSeconds: number
  targetSeconds: number
  achieved: boolean
  exceeded: boolean
  color: string
  icon: string
}

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate()
  const todayStr = new Date().toLocaleDateString('sv-SE')
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const isToday = selectedDate === todayStr
  const [coreSubjects, setCoreSubjects] = useState<string[]>([])
  const [progress, setProgress] = useState<SubjectProgress[]>([])
  const [totalToday, setTotalToday] = useState(0)
  const [consecutiveDays, setConsecutiveDays] = useState(0)
  const [maxConsecutive, setMaxConsecutive] = useState(0)
  const [totalAllTime, setTotalAllTime] = useState(0)
  const [ringData, setRingData] = useState<{ subject: string; seconds: number }[]>([])
  const [weekData, setWeekData] = useState<any[]>([])
  const [prevWeekData, setPrevWeekData] = useState<any[]>([])
  const [showAchievements, setShowAchievements] = useState(false)
  // 每个框高度可拖拽自定义：null = 默认 flex 比例，拖拽后 = 固定 px（localStorage 持久化）
  // keys: ring/heat/achieve（左列）, data/trend/timeline（右列）, miniRow（数据卡内第一行）
  const [cardHs, setCardHs] = useState<Record<string, number | null>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('dashboard-card-hs') || '{}') as Record<string, number | null>
      if (v && typeof v === 'object') return v
    } catch { /* 忽略损坏数据 */ }
    return {}
  })
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  /** 通用拖拽：按住把手上下拖动，实时回调高度，松手持久化 */
  function startDrag(
    getStartH: () => number,
    onDrag: (h: number) => void,
    onEnd: () => void
  ): (e: React.MouseEvent) => void {
    return (e: React.MouseEvent): void => {
      e.preventDefault()
      dragRef.current = { startY: e.clientY, startH: getStartH() }
      const onMove = (ev: MouseEvent): void => {
        if (!dragRef.current) return
        const h = Math.min(600, Math.max(100, dragRef.current.startH + (ev.clientY - dragRef.current.startY)))
        onDrag(Math.round(h))
      }
      const onUp = (): void => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        onEnd()
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  /** 大框把手：调整某个框的高度（同列其他框自动让位） */
  function onCardHandleDown(key: string, e: React.MouseEvent): void {
    const card = (e.currentTarget as HTMLElement).parentElement
    if (!card) return
    startDrag(
      () => card.getBoundingClientRect().height,
      (h) => setCardHs(prev => ({ ...prev, [key]: h })),
      () => setCardHs(prev => { localStorage.setItem('dashboard-card-hs', JSON.stringify(prev)); return prev })
    )(e)
  }

  /** 数据统计卡内两行把手：调整 3+3 小卡两行比例 */
  function onMiniRowHandleDown(e: React.MouseEvent): void {
    const row = (e.currentTarget as HTMLElement).parentElement?.querySelector(':scope > .grid') as HTMLElement | null
    if (!row) return
    startDrag(
      () => row.getBoundingClientRect().height,
      (h) => setCardHs(prev => ({ ...prev, miniRow: h })),
      () => setCardHs(prev => { localStorage.setItem('dashboard-card-hs', JSON.stringify(prev)); return prev })
    )(e)
  }

  /** 框样式：拖过 = 固定高度，未拖 = 默认 flex 比例 */
  function cardStyle(key: string, defaultFlex: string | number): React.CSSProperties {
    return cardHs[key] != null ? { flex: 'none', height: cardHs[key] as number } : { flex: defaultFlex }
  }

  /** 拖拽把手 UI（悬停显示小横条） */
  function Handle({ onMouseDown, title }: { onMouseDown: (e: React.MouseEvent) => void; title: string }): React.ReactElement {
    return (
      <div
        onMouseDown={onMouseDown}
        className="absolute bottom-0 inset-x-0 h-2.5 cursor-ns-resize flex items-center justify-center select-none z-10"
        title={title}
      >
        <div className="w-12 h-1 rounded-full opacity-0 group-hover:opacity-70 transition-opacity" style={{ background: 'var(--text-muted)' }} />
      </div>
    )
  }

  useEffect(() => {
    loadData()
    if (!isToday) return
    const dataInterval = setInterval(loadData, 30000)
    const unlockInterval = setInterval(async () => {
      const ids = await window.lanshan.getNewUnlocks()
      if (ids.length > 0) {
        window.dispatchEvent(new CustomEvent('achievement-unlock', { detail: ids }))
      }
    }, 30000)
    return () => {
      clearInterval(dataInterval)
      clearInterval(unlockInterval)
    }
  }, [selectedDate])

  async function loadData(): Promise<void> {
    try {
      // Rebuild daily_stats for past dates (fixes missing 休闲/其他)
      if (!isToday) await window.lanshan.rebuildDailyStats(selectedDate)
      const settings = await window.lanshan.getSettings()
      const [coreList, stats, totalTodayVal, consec, maxConsec, totalAll, week, prevWeek, achievements] = await Promise.all([
        window.lanshan.getCoreSubjects(),
        window.lanshan.getDailyStats(selectedDate),
        window.lanshan.getTotalSecondsToday(selectedDate),
        window.lanshan.getConsecutiveDays(),
        window.lanshan.getMaxConsecutiveDays(),
        window.lanshan.getTotalSecondsAllTime(),
        window.lanshan.getWeekStats(7),
        window.lanshan.getWeekStats(14),
        window.lanshan.getAchievements(),
      ])

      setCoreSubjects(coreList)
      setTotalToday(totalTodayVal)
      setConsecutiveDays(consec)
      setMaxConsecutive(maxConsec)
      setTotalAllTime(totalAll)
      setWeekData(week)
      setPrevWeekData(prevWeek)

      const progressData: SubjectProgress[] = coreList.map((subject: string) => {
        const stat = stats.find((s: any) => s.subject === subject)
        const totalSec = stat?.total_seconds || 0
        const targetSec = parseInt(settings[`target_${subject}`] || '7200', 10)
        return {
          subject,
          totalSeconds: totalSec,
          targetSeconds: targetSec,
          achieved: totalSec >= targetSec,
          exceeded: totalSec >= targetSec * 1.5,
          color: C_COLORS[subject] || '#64748b',
          icon: getSubjectTierIcon(subject, achievements),
        }
      })
      setProgress(progressData)

      const ringEntries = stats
        .filter((s: any) => s.total_seconds > 0)
        .map((s: any) => ({
          subject: s.subject as string,
          seconds: s.total_seconds as number,
        }))
      setRingData(ringEntries)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* 日期导航 */}
      <div className="flex items-center gap-3 px-1 py-2 flex-shrink-0">
        <button onClick={() => {
          const d = new Date(selectedDate); d.setDate(d.getDate() - 1);
          setSelectedDate(d.toLocaleDateString('sv-SE'))
        }} className="px-3 py-1 rounded-lg text-sm font-medium hover:opacity-70"
          style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }}>
          ◀
        </button>
        <input type="date" value={selectedDate}
          onChange={e => { const v = e.target.value; if (v <= todayStr) setSelectedDate(v) }}
          max={todayStr}
          className="rounded-lg px-3 py-1.5 text-sm" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }} />
        <button onClick={() => {
          const d = new Date(selectedDate); d.setDate(d.getDate() + 1);
          const next = d.toLocaleDateString('sv-SE');
          if (next <= todayStr) setSelectedDate(next)
        }} disabled={isToday}
          className="px-3 py-1 rounded-lg text-sm font-medium hover:opacity-70 disabled:opacity-30"
          style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }}>
          ▶
        </button>
        {!isToday && (
          <button onClick={() => setSelectedDate(todayStr)}
            className="px-3 py-1 rounded-lg text-sm font-medium"
            style={{ background:'var(--accent)', color:'white' }}>
            今天
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-5 h-full">
        {/* 左侧：环形图 + 热力图 + 成就（每个框底部把手可拖拽调高） */}
        <div className="flex flex-col gap-5 h-full overflow-y-auto">
          <div className="card flex flex-col min-h-0 overflow-hidden relative group" style={cardStyle('ring', '1.5')}>
            <h3 className="text-sm font-medium mb-3 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              使用情况
            </h3>
            <div className="flex-1 min-h-0">
              <SubjectRingChart data={ringData} />
            </div>
            <Handle onMouseDown={(e) => onCardHandleDown('ring', e)} title="拖动调整高度" />
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden relative group" style={cardStyle('heat', '2.3')}>
            <h3 className="text-sm font-medium mb-3 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              🔥 热力图
            </h3>
            <div className="flex-1 min-h-0">
              <HeatmapGrid />
            </div>
            <Handle onMouseDown={(e) => onCardHandleDown('heat', e)} title="拖动调整高度" />
          </div>
          <div
            className="card flex flex-col min-h-0 overflow-hidden cursor-pointer transition-all hover:border-[var(--border-light)] relative group"
            style={cardStyle('achieve', '1.2')}
            onClick={() => setShowAchievements(true)}
          >
            <div className="flex items-center justify-between flex-shrink-0 mb-2">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                🏆 已解锁成就
              </h3>
              <span className="text-xs" style={{ color: 'var(--accent)' }}>查看全部 →</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AchievementList compact />
            </div>
            <Handle onMouseDown={(e) => onCardHandleDown('achieve', e)} title="拖动调整高度" />
          </div>
        </div>

        {/* 右侧：数据卡片 + 进度卡片 + 趋势图 — 占 2 列（每个框底部把手可拖拽调高） */}
        <div className="col-span-2 flex flex-col gap-5">
          {/* 数据统计卡：框可拖高；框内 6 个小卡两行之间也可拖动调整比例，内容随高度自动缩放 */}
          <div
            className="card flex flex-col min-h-0 overflow-hidden relative group"
            style={{ ...cardStyle('data', '1.5'), containerType: 'size' }}
          >
            <div className="grid grid-cols-3 gap-3 flex-1 pt-2 relative" style={cardHs['miniRow'] != null ? { flex: 'none', height: cardHs['miniRow'] as number } : undefined}>
              <MiniCard icon="📊" value={formatDuration(totalToday)} label={isToday ? '今日学习' : selectedDate + ' 学习'} />
              <MiniCard icon="🔥" value={`${consecutiveDays} 天`} label="连续打卡" sub={`最长 ${maxConsecutive} 天`} />
              <MiniCard icon="🏆" value={formatShortDuration(totalAllTime)} label="累计总时长" />
            </div>
            <div className="grid grid-cols-3 gap-3 flex-1 pb-2">
              {progress.map((p) => (
                <SubjectCard key={p.subject} progress={p} />
              ))}
            </div>
            {/* 框内两行把手（3+3 小卡比例） */}
            <div
              onMouseDown={onMiniRowHandleDown}
              className="absolute left-0 right-0 h-2.5 cursor-ns-resize flex items-center justify-center select-none z-10"
              style={{ top: 'calc(50% + 2px)' }}
              title="拖动调整上下两行小卡比例"
            >
              <div className="w-12 h-1 rounded-full opacity-0 group-hover:opacity-70 transition-opacity" style={{ background: 'var(--text-muted)' }} />
            </div>
            <Handle onMouseDown={(e) => onCardHandleDown('data', e)} title="拖动调整框高度（6 个小卡自动适应）" />
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden relative group" style={cardStyle('trend', '2.3')}>
            <div className="flex items-baseline justify-between mb-3 flex-shrink-0">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                本周趋势
              </h3>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {weekData.length === 7 ? `${fmtMonthDay(weekData[0].date)}（周一）– ${fmtMonthDay(weekData[6].date)}（周日）` : ''}
              </span>
            </div>
            <div className="flex-1 min-h-0 relative">
              <WeekTrendChart
                data={weekData}
                prevWeekData={prevWeekData}
                coreSubjects={coreSubjects}
              />
            </div>
            <Handle onMouseDown={(e) => onCardHandleDown('trend', e)} title="拖动调整高度" />
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden relative group" style={cardStyle('timeline', '1.2')}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              🕐 {isToday ? '今日时间轴' : selectedDate + ' 时间轴'}
            </h3>
            <Timeline date={selectedDate} />
            <Handle onMouseDown={(e) => onCardHandleDown('timeline', e)} title="拖动调整高度" />
          </div>
        </div>
      </div>
      {showAchievements && <AchievementModal onClose={() => setShowAchievements(false)} />}
    </div>
  )
}

/** 'YYYY-MM-DD' → 'M月d日' */
function fmtMonthDay(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`
}

/** Mini data card（cqh 在数据统计卡框内自适应缩放：框不变，内容随框自动调整大小） */
function MiniCard({ icon, value, label, sub }: {
  icon: string
  value: string
  label: string
  sub?: string
}): React.ReactElement {
  return (
    <div className="card flex items-center gap-2.5 px-3 h-full min-w-0" style={{ padding: '2.5cqh 12px' }}>
      <span className="flex-shrink-0" style={{ fontSize: '8.4cqh' }}>{icon}</span>
      <div className="min-w-0">
        <p className="font-bold tabular-nums leading-none truncate" style={{ fontSize: '8cqh' }}>{value}</p>
        <p className="mt-1 truncate" style={{ fontSize: '4.6cqh', lineHeight: 1.2, color: 'var(--text-secondary)' }}>{label}</p>
        {sub && <p className="truncate" style={{ fontSize: '3.8cqh', lineHeight: 1.2, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}

/** Subject progress card（cqh 在数据统计卡框内自适应缩放：框不变，内容随框自动调整大小） */
function SubjectCard({ progress }: { progress: SubjectProgress }): React.ReactElement {
  const { subject, totalSeconds, targetSeconds, achieved, exceeded, color, icon } = progress
  const percent = Math.min((totalSeconds / targetSeconds) * 100, 100)
  const remaining = Math.max(targetSeconds - totalSeconds, 0)
  const exceedAmount = Math.max(totalSeconds - targetSeconds, 0)
  const hasTodaySurplus = totalSeconds > targetSeconds

  return (
    <div className="card relative overflow-hidden h-full flex flex-col justify-between px-3 min-w-0" style={{ padding: '2.5cqh 12px' }}>
      {/* 左侧彩色竖条 */}
      <div className="absolute left-0 rounded-r-full" style={{ background: color, width: '1.5cqh', top: '2.5cqh', bottom: '2.5cqh' }} />

      {/* 行1：圆形图标 + 科目 + 状态徽章 */}
      <div className="flex items-center justify-between gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="rounded-full flex items-center justify-center flex-shrink-0"
            style={{ width: '8cqh', height: '8cqh', fontSize: '4cqh', background: color + '20', color }}
          >
            {icon}
          </span>
          <span className="font-semibold truncate" style={{ fontSize: '5.3cqh', lineHeight: 1.1 }}>{subject}</span>
        </div>
        <span
          className="font-medium rounded-full flex-shrink-0"
          style={{
            fontSize: '3.8cqh',
            lineHeight: 1.1,
            padding: '1.5cqh 3cqh',
            background: achieved
              ? (exceeded ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.15)')
              : 'var(--accent-bg)',
            color: achieved ? (exceeded ? '#fbbf24' : '#22c55e') : 'var(--text-muted)',
          }}
        >
          {!achieved && '进行中'}
          {achieved && !exceeded && '已达成'}
          {exceeded && '超额中'}
        </span>
      </div>

      {/* 行2：大时长 */}
      <div className="flex items-baseline gap-1.5 flex-shrink-0">
        <span className="font-bold tabular-nums" style={{ fontSize: '7cqh', lineHeight: 1.1, color: exceeded ? '#fbbf24' : 'var(--text-primary)' }}>
          {formatDuration(totalSeconds)}
        </span>
        <span style={{ fontSize: '3.8cqh', lineHeight: 1.1, color: 'var(--text-secondary)' }}>
          / {formatDuration(targetSeconds)}
        </span>
        {exceeded && <span style={{ fontSize: '5cqh', color: '#fbbf24' }}>✨</span>}
      </div>

      {/* 行3：进度条（盈余金光） */}
      <div className="rounded-full overflow-hidden flex-shrink-0" style={{ height: '2.3cqh', background: 'var(--progress-track)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            background: hasTodaySurplus
              ? `linear-gradient(90deg, ${color} 60%, #fbbf24 100%)`
              : color,
          }}
        />
      </div>

      {/* 行4：状态文字 */}
      <p className="truncate flex-shrink-0" style={{ fontSize: '3.8cqh', lineHeight: 1.1, color: achieved ? (exceeded ? '#fbbf24' : '#22c55e') : 'var(--text-muted)' }}>
        {!achieved && `还差 ${formatDuration(remaining)} 达标`}
        {achieved && !exceeded && '今日目标已达成 ✓'}
        {exceeded && `超额 ${Math.round((totalSeconds / targetSeconds) * 100)}%！`}
        {hasTodaySurplus && ` · 盈余 +${formatDuration(exceedAmount)}`}
      </p>
    </div>
  )
}
