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
import WearGrid from '../components/WearGrid'
import SealPicker from '../components/SealPicker'
import SealIcon from '../components/SealIcon'
import Timeline from '../components/Timeline'
import type { SealDefLike, CumulativeLike, DailyLike, SlotLike } from '../sealTypes'

interface SealOverviewLike {
  cumulative: CumulativeLike[]
  daily: DailyLike[]
  slots: SlotLike[]
  dailyEverIds: string[]
}

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
  // 刻章系统：佩戴位总览 + 选择器
  const [sealsData, setSealsData] = useState<SealOverviewLike | null>(null)
  const [sealDefs, setSealDefs] = useState<SealDefLike[]>([])
  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  // 每个框高度可拖拽自定义：null = 默认 flex 比例，拖拽后 = 固定 px（localStorage 持久化）
  // keys: ring/heat/achieve（左列）, data/trend/timeline（右列）, miniRow（数据卡内第一行）
  const [cardHs, setCardHs] = useState<Record<string, number | null>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('dashboard-card-hs') || '{}') as Record<string, number | null>
      if (v && typeof v === 'object') return v
    } catch { /* 忽略损坏数据 */ }
    return {}
  })
  // 左右分栏比例（左栏宽度百分比）：拖中间垂直把手调整，双击恢复默认 1:2（localStorage 持久化）
  const [colSplit, setColSplit] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('dashboard-col-split') || '')
      if (Number.isFinite(v)) return Math.min(45, Math.max(20, v))
    } catch { /* 忽略损坏数据 */ }
    return 33.33
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

  /** 左右分栏把手：拖动调整左/右两栏宽度比例（左栏 20%–45%），松手持久化，双击恢复默认 */
  function onColHandleDown(e: React.MouseEvent): void {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).parentElement
    if (!container) return
    const startX = e.clientX
    const startPct = colSplit
    const totalW = container.getBoundingClientRect().width || 1
    const onMove = (ev: MouseEvent): void => {
      const pct = startPct + ((ev.clientX - startX) / totalW) * 100
      setColSplit(Math.min(45, Math.max(20, pct)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setColSplit(prev => { localStorage.setItem('dashboard-col-split', String(prev)); return prev })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** 恢复左右分栏默认比例 1:2 */
  function resetColSplit(): void {
    setColSplit(33.33)
    localStorage.setItem('dashboard-col-split', '33.33')
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
    // 30s 轮询新刻章：累积新解锁 + 今天新获得的每日刻章 → 驱动盖印 toast
    const unlockInterval = setInterval(async () => {
      try {
        const n = await window.lanshan.getNewSeals()
        if (n.cumulative.length > 0 || n.daily.length > 0) {
          window.dispatchEvent(new CustomEvent('seal-unlock', { detail: n }))
          void loadData()
        }
      } catch { /* 忽略轮询错误 */ }
    }, 30000)
    return () => {
      clearInterval(dataInterval)
      clearInterval(unlockInterval)
    }
  }, [selectedDate])

  // 主页显示设置：把 4 个 CSS 变量写到 documentElement（设置页滑块也会实时更新），
  // 图表组件通过 cssVar() 读到同一份值；值做范围 clamp 防止脏数据。
  useEffect(() => {
    window.lanshan.getSettings().then((s) => {
      const num = (key: string, dflt: number, min: number, max: number): number => {
        const v = parseFloat(s[key] ?? '')
        if (!Number.isFinite(v)) return dflt
        return Math.min(max, Math.max(min, v))
      }
      const el = document.documentElement
      el.style.setProperty('--dash-font-scale', String(num('home_font_scale', 1, 0.7, 1.5)))
      el.style.setProperty('--dash-border-width', `${num('home_border_width', 1, 0, 4)}px`)
      el.style.setProperty('--dash-border-radius', `${num('home_border_radius', 16, 0, 28)}px`)
      el.style.setProperty('--dash-card-padding', `${num('home_card_padding', 24, 8, 40)}px`)
    })
  }, [])

  // 刻章定义（佩戴格展示用，主进程为唯一数据源）
  useEffect(() => {
    window.lanshan.getSealDefs().then(setSealDefs)
  }, [])

  async function loadData(): Promise<void> {
    try {
      // Rebuild daily_stats for past dates (fixes missing 休闲/其他)
      if (!isToday) await window.lanshan.rebuildDailyStats(selectedDate)
      const settings = await window.lanshan.getSettings()
      const [coreList, stats, totalTodayVal, consec, maxConsec, totalAll, week, prevWeek, seals] = await Promise.all([
        window.lanshan.getCoreSubjects(),
        window.lanshan.getDailyStats(selectedDate),
        window.lanshan.getTotalSecondsToday(selectedDate),
        window.lanshan.getConsecutiveDays(),
        window.lanshan.getMaxConsecutiveDays(),
        window.lanshan.getTotalSecondsAllTime(),
        window.lanshan.getWeekStats(7),
        window.lanshan.getWeekStats(14),
        // 刻章总览：今天 = 实时（佩戴位+今日刻章）；历史日期 = 回放（该日刻章 + 截至该日累积进度）
        window.lanshan.getSealsOverview(isToday ? undefined : selectedDate),
      ])

      setCoreSubjects(coreList)
      setTotalToday(totalTodayVal)
      setConsecutiveDays(consec)
      setMaxConsecutive(maxConsec)
      setTotalAllTime(totalAll)
      setWeekData(week)
      setPrevWeekData(prevWeek)
      setSealsData(seals)

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
          icon: getSubjectTierIcon(subject, seals?.cumulative ?? []),
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
    <div className="dash-scale w-full h-full flex flex-col">
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
      <div className="flex gap-5 h-full">
        {/* 左侧：环形图 + 热力图 + 刻章（每个框底部把手可拖拽调高；两栏宽度可拖中间把手调整） */}
        <div className="flex flex-col gap-5 h-full overflow-y-auto min-w-0" style={{ width: `${colSplit}%`, flex: 'none' }}>
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
          <div className="card flex flex-col min-h-0 overflow-hidden relative" style={cardStyle('achieve', '1.2')}>
            <div className="flex items-center justify-between flex-shrink-0 mb-2">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {isToday ? '🕹️ 我的刻章' : `📜 ${selectedDate} 刻章`}
              </h3>
              <button onClick={() => navigate('/seals')} className="text-xs" style={{ color: 'var(--accent)' }}>刻章册 →</button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {sealsData ? (
                isToday ? (
                  <>
                    {/* 佩戴位：4×2 自动适配卡片尺寸（不滚动） */}
                    <div className="flex-1 min-h-0">
                      <WearGrid defs={sealDefs} slots={sealsData.slots} onSlotClick={(slot) => setPickerSlot(slot)} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 flex-shrink-0">
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        今日刻章 {sealsData.daily.filter(d => d.earned).length} 枚
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        已集 {sealsData.cumulative.filter(c => c.unlocked).length + sealsData.dailyEverIds.length} / 38
                      </span>
                    </div>
                  </>
                ) : (
                  /* 历史日期回放：该日盖下的刻章 + 截至该日累积进度（与时间轴/每日数据一致的往回查看） */
                  <div className="overflow-y-auto min-h-0 pr-1">
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      该日刻章 · {sealsData.daily.filter(d => d.earned).length} 枚
                    </p>
                    {sealsData.daily.filter(d => d.earned).length === 0 ? (
                      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>这一天没有获得每日刻章</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {sealsData.daily.filter(d => d.earned).map(s => {
                          const def = sealDefs.find(x => x.id === s.id)
                          if (!def) return null
                          return (
                            <span key={s.id} className="replay-chip">
                              <span style={{ display: 'inline-flex' }}>
                                <SealIcon id={s.id} size={14} />
                              </span>
                              {def.name}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      截至当日累积 · {sealsData.cumulative.filter(c => c.unlocked).length} / {sealsData.cumulative.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sealsData.cumulative.filter(c => c.unlocked).map(c => {
                        const def = sealDefs.find(x => x.id === c.id)
                        if (!def) return null
                        return (
                          <span key={c.id} className="replay-chip got">
                            <span style={{ display: 'inline-flex' }}>
                              <SealIcon id={c.id} size={14} />
                            </span>
                            {def.name}
                          </span>
                        )
                      })}
                      {sealsData.cumulative.filter(c => c.unlocked).length === 0 && (
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>截至该日还没有解锁累积刻章</p>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div className="text-xs py-4 text-center w-full" style={{ color: 'var(--text-muted)' }}>加载中…</div>
              )}
            </div>
          </div>
        </div>

        {/* 左右分栏把手：纯隐形拖拽区（无线条），拖动调整两栏宽度，双击恢复默认 1:2 */}
        <div
          onMouseDown={onColHandleDown}
          onDoubleClick={resetColSplit}
          className="w-2.5 cursor-col-resize select-none flex-shrink-0"
          title="拖动调整左右两栏宽度（双击恢复默认）"
        />

        {/* 右侧：数据卡片 + 进度卡片 + 趋势图 — 占 2 列（每个框底部把手可拖拽调高） */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">
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
      {pickerSlot !== null && sealsData && sealDefs.length > 0 && (
        <SealPicker
          slot={pickerSlot}
          defs={sealDefs}
          unlockedCumulative={sealsData.cumulative.filter(c => c.unlocked)}
          todayEarned={sealsData.daily.filter(d => d.earned).map(d => d.id)}
          worn={sealsData.slots.find(s => s.slot === pickerSlot) ?? null}
          onClose={() => setPickerSlot(null)}
          onChanged={() => void loadData()}
        />
      )}
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
      <span className="flex-shrink-0" style={{ fontSize: 'calc(8.4cqh * var(--dash-font-scale, 1))' }}>{icon}</span>
      <div className="min-w-0">
        <p className="font-bold tabular-nums leading-none truncate" style={{ fontSize: 'calc(8cqh * var(--dash-font-scale, 1))' }}>{value}</p>
        <p className="mt-1 truncate" style={{ fontSize: 'calc(4.6cqh * var(--dash-font-scale, 1))', lineHeight: 1.2, color: 'var(--text-secondary)' }}>{label}</p>
        {sub && <p className="truncate" style={{ fontSize: 'calc(3.8cqh * var(--dash-font-scale, 1))', lineHeight: 1.2, color: 'var(--text-muted)' }}>{sub}</p>}
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
            style={{ width: '8cqh', height: '8cqh', fontSize: 'calc(4cqh * var(--dash-font-scale, 1))', background: color + '20', color }}
          >
            {icon}
          </span>
          <span className="font-semibold truncate" style={{ fontSize: 'calc(5.3cqh * var(--dash-font-scale, 1))', lineHeight: 1.1 }}>{subject}</span>
        </div>
        <span
          className="font-medium rounded-full flex-shrink-0"
          style={{
            fontSize: 'calc(3.8cqh * var(--dash-font-scale, 1))',
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
        <span className="font-bold tabular-nums" style={{ fontSize: 'calc(7cqh * var(--dash-font-scale, 1))', lineHeight: 1.1, color: exceeded ? '#fbbf24' : 'var(--text-primary)' }}>
          {formatDuration(totalSeconds)}
        </span>
        <span style={{ fontSize: 'calc(3.8cqh * var(--dash-font-scale, 1))', lineHeight: 1.1, color: 'var(--text-secondary)' }}>
          / {formatDuration(targetSeconds)}
        </span>
        {exceeded && <span style={{ fontSize: 'calc(5cqh * var(--dash-font-scale, 1))', color: '#fbbf24' }}>✨</span>}
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
      <p className="truncate flex-shrink-0" style={{ fontSize: 'calc(3.8cqh * var(--dash-font-scale, 1))', lineHeight: 1.1, color: achieved ? (exceeded ? '#fbbf24' : '#22c55e') : 'var(--text-muted)' }}>
        {!achieved && `还差 ${formatDuration(remaining)} 达标`}
        {achieved && !exceeded && '今日目标已达成 ✓'}
        {exceeded && `超额 ${Math.round((totalSeconds / targetSeconds) * 100)}%！`}
        {hasTodaySurplus && ` · 盈余 +${formatDuration(exceedAmount)}`}
      </p>
    </div>
  )
}
