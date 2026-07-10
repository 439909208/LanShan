import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSubjectIcon, getSubjectTierIcon, formatDuration, formatShortDuration } from '../utils'

const C_COLORS: Record<string, string> = {
  '物理': '#f59e0b',
  '数学': '#3b82f6',
  '英语': '#22c55e',
  '休闲': '#ec4899',
  '其他': '#9ca3af',
  '未分类': '#64748b',
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

  useEffect(() => {
    loadData()
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
  }, [])

  async function loadData(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0]
      const settings = await window.lanshan.getSettings()
      const [coreList, stats, totalTodayVal, consec, maxConsec, totalAll, week, prevWeek, achievements] = await Promise.all([
        window.lanshan.getCoreSubjects(),
        window.lanshan.getDailyStats(today),
        window.lanshan.getTotalSecondsToday(today),
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
      setPrevWeekData(prevWeek.slice(0, 7))

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
    <div className="w-full h-full">
      <div className="grid grid-cols-3 gap-5 h-full">
        {/* 左侧：环形图(2/5) + 热力图(2/5) + 成就(1/5) */}
        <div className="flex flex-col gap-5 h-full overflow-y-auto">
          <div className="card flex flex-col min-h-0 overflow-hidden" style={{ flex: '1.5' }}>
            <h3 className="text-sm font-medium mb-3 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              今日科目分布
            </h3>
            <div className="flex-1 min-h-0">
              <SubjectRingChart data={ringData} />
            </div>
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden" style={{ flex: '2.3' }}>
            <h3 className="text-sm font-medium mb-3 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              🔥 热力图
            </h3>
            <div className="flex-1 min-h-0">
              <HeatmapGrid />
            </div>
          </div>
          <div
            className="card flex flex-col min-h-0 overflow-hidden cursor-pointer transition-all hover:border-[var(--border-light)]"
            style={{ flex: '1.2' }}
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
          </div>
        </div>

        {/* 右侧：数据卡片 + 进度卡片 + 趋势图 — 占 2 列 */}
        <div className="col-span-2 flex flex-col gap-5">
          <div className="card flex flex-col min-h-0 overflow-hidden" style={{ flex: '1.5' }}>
            <div className="grid grid-cols-3 gap-5 flex-1 pt-3">
              <MiniCard icon="📊" value={formatDuration(totalToday)} label="今日学习" />
              <MiniCard icon="🔥" value={`${consecutiveDays} 天`} label="连续打卡" sub={`最长 ${maxConsecutive} 天`} />
              <MiniCard icon="🏆" value={formatShortDuration(totalAllTime)} label="累计总时长" />
            </div>
            <div className="grid grid-cols-3 gap-5 flex-1 pb-3">
              {progress.map((p) => (
                <SubjectCard key={p.subject} progress={p} />
              ))}
            </div>
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden" style={{ flex: '2.3' }}>
            <h3 className="text-sm font-medium mb-3 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              近 7 天趋势
            </h3>
            <div className="flex-1 min-h-0 relative">
              <WeekTrendChart
                data={weekData}
                prevWeekData={prevWeekData}
                coreSubjects={coreSubjects}
              />
            </div>
          </div>
          <div className="card flex flex-col min-h-0 overflow-hidden" style={{ flex: '1.2' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              🕐 今日时间轴
            </h3>
            <Timeline date={new Date().toISOString().split('T')[0]} />
          </div>
        </div>
      </div>
      {showAchievements && <AchievementModal onClose={() => setShowAchievements(false)} />}
    </div>
  )
}

/** Mini data card for the top row */
function MiniCard({ icon, value, label, sub }: {
  icon: string
  value: string
  label: string
  sub?: string
}): React.ReactElement {
  return (
    <div className="card flex items-center gap-5 py-6 px-6 h-full">
      <span className="text-3xl flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-bold tabular-nums leading-tight truncate">{value}</p>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        {sub && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}

/** Subject progress card with colored accent bar */
function SubjectCard({ progress }: { progress: SubjectProgress }): React.ReactElement {
  const { subject, totalSeconds, targetSeconds, achieved, exceeded, color, icon } = progress
  const percent = Math.min((totalSeconds / targetSeconds) * 100, 100)
  const remaining = Math.max(targetSeconds - totalSeconds, 0)
  const exceedAmount = Math.max(totalSeconds - targetSeconds, 0)

  return (
    <div className="card flex flex-col gap-4 py-6 px-6 h-full relative overflow-hidden">
      {/* 左侧彩色竖条 */}
      <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full" style={{ background: color }} />
      
      {/* Header: icon + subject + status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* 圆形图标背景 */}
          <span className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
            style={{ background: color + '20', color }}>
            {icon}
          </span>
          <span className="text-lg font-semibold">{subject}</span>
        </div>
        <span
          className="text-xs font-medium px-2.5 py-1 rounded-full"
          style={{
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

      {/* Duration */}
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color: exceeded ? '#fbbf24' : 'var(--text-primary)' }}>
          {formatDuration(totalSeconds)}
        </span>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          / {formatDuration(targetSeconds)}
        </span>
        {exceeded && <span className="text-xl" style={{ color: '#fbbf24' }}>✨</span>}
      </div>

      {/* Simple progress bar */}
      <div className="h-4 rounded-full overflow-hidden" style={{ background: 'var(--progress-track)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            background: achieved && exceeded
              ? `linear-gradient(90deg, ${color}, #fbbf24)`
              : color,
          }}
        />
      </div>

      {/* Status message */}
      <p
        className="text-xs"
        style={{ color: achieved ? (exceeded ? '#fbbf24' : '#22c55e') : 'var(--text-muted)' }}
      >
        {!achieved && `还差 ${formatDuration(remaining)} 达标`}
        {achieved && !exceeded && '今日目标已达成 ✓'}
        {exceeded && `超额 ${Math.round((totalSeconds / targetSeconds) * 100)}%！+${formatDuration(exceedAmount)}`}
      </p>
    </div>
  )
}
