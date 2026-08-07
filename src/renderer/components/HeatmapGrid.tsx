import { useState, useEffect, useRef, useCallback } from 'react'
import { formatShortDuration, getSubjectIcon, getSubjectColor } from '../utils'

const DOW = ['一', '二', '三', '四', '五', '六', '日']
const GAP = 3
const CORE = ['物理', '数学', '英语']

interface Breakdown {
  subject: string; total_seconds: number; target_seconds: number; achieved: boolean; exceeded: boolean
}

interface MakeupFillRow {
  date: string; subject: string; amount: number; sourceDate: string; manual: boolean
}

function cssVar(n: string): string {
  if (typeof document === 'undefined') return '#e5e7eb'
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#e5e7eb'
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function formatDateCN(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${['日','一','二','三','四','五','六'][d.getDay()]}`
}

/** 本地日期字符串（YYYY-MM-DD） */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 某科是否达标：真实达标，或补签已填满缺口 */
function isSubjectMet(b: Breakdown, fills?: MakeupFillRow[]): boolean {
  if (b.achieved) return true
  const filled = (fills ?? []).filter(f => f.subject === b.subject).reduce((s, f) => s + f.amount, 0)
  return filled >= Math.max(0, b.target_seconds - b.total_seconds)
}

function calcLevel(bds: Breakdown[] | undefined, fills?: MakeupFillRow[]): number {
  if (!bds || bds.length === 0) return 0
  return bds.filter(b => CORE.includes(b.subject) && isSubjectMet(b, fills)).length
}

export default function HeatmapGrid(): React.ReactElement {
  const colors = [0,1,2,3].map(i => cssVar(`--heatmap-${i}`))
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [cells, setCells] = useState<Map<string, number>>(new Map())
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown[]>>({})
  const [makeup, setMakeup] = useState<Record<string, MakeupFillRow[]>>({})
  const [weeks, setWeeks] = useState<(string | null)[][]>([])
  const [cellPx, setCellPx] = useState(28)
  const [tooltip, setTooltip] = useState<{date:string;x:number;y:number}|null>(null)
  const [clickDate, setClickDate] = useState<string|null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadData() }, [year, month])
  useEffect(() => { buildMonthGrid() }, [cells, breakdowns, makeup, year, month])

  const measure = useCallback(() => {
    const el = rootRef.current
    if (!el || weeks.length === 0) return
    const h = el.clientHeight
    const headerH = 52
    const avail = h - headerH - (weeks.length - 1) * GAP
    const px = Math.max(6, Math.floor(avail / weeks.length))
    setCellPx(px)
  }, [weeks.length])

  useEffect(() => {
    measure()
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  async function loadData(): Promise<void> {
    const [raw, fills] = await Promise.all([
      window.lanshan.getYearHeatmap(year),
      window.lanshan.getMakeupFills(year, month),
    ])
    const secMap = new Map<string, number>()
    const bd: Record<string, Breakdown[]> = {}
    for (const d of raw) {
      secMap.set(d.date, d.total)
      if (d.total > 0) {
        try { bd[d.date] = await window.lanshan.getDailyBreakdown(d.date) as Breakdown[] } catch {}
      }
    }
    const mk: Record<string, MakeupFillRow[]> = {}
    for (const f of fills as MakeupFillRow[]) {
      (mk[f.date] ??= []).push(f)
    }
    // 完全空白但被补签的日期：热力图数据里没有记录，用补签可用性合成 breakdown，
    // 否则格子永远亮不起来（补签机制恰恰主要服务空白日）
    for (const ds of Object.keys(mk)) {
      if (!bd[ds] && mk[ds].length > 0) {
        try {
          const av: { subject: string; total: number; need: number }[] = await window.lanshan.getMakeupAvailability(ds)
          bd[ds] = av.map(a => ({
            subject: a.subject,
            total_seconds: a.total,
            target_seconds: a.need + a.total,
            achieved: false,
            exceeded: false,
          }))
        } catch {}
      }
    }
    setCells(secMap)
    setBreakdowns(bd)
    setMakeup(mk)
  }

  function buildMonthGrid(): void {
    const first = new Date(year, month - 1, 1)
    const startDow = (first.getDay() + 6) % 7
    const cursor = new Date(first)
    cursor.setDate(cursor.getDate() - startDow)
    const rows: (string | null)[][] = []

    while (true) {
      const row: (string | null)[] = []
      let hasThisMonth = false
      for (let d = 0; d < 7; d++) {
        if (cursor.getMonth() + 1 === month && cursor.getFullYear() === year) {
          hasThisMonth = true
          row.push(dateStr(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()))
        } else {
          row.push(null)
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      if (!hasThisMonth && row.every(c => c === null)) break
      rows.push(row)
      if (cursor > new Date(year, month + 1, 0)) break
    }
    setWeeks(rows)
  }

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const today = new Date().toISOString().split('T')[0]
  const gridW = cellPx * 7 + 6 * GAP
  const tooltipBd = tooltip ? breakdowns[tooltip.date] : undefined
  const tooltipFills = tooltip ? makeup[tooltip.date] : undefined
  const tooltipN = tooltipBd?.filter(b => CORE.includes(b.subject) && isSubjectMet(b, tooltipFills)).length || 0
  const tooltipSec = tooltipBd?.reduce((s,b) => s + b.total_seconds, 0) || 0

  return (
    <div ref={rootRef} className="w-full h-full flex flex-col items-center">
      {/* month nav */}
      <div className="flex items-center justify-center gap-2 mb-1 flex-shrink-0">
        <button onClick={prevMonth} className="text-xs px-1" style={{color:'var(--text-secondary)'}}>←</button>
        <span className="text-sm font-semibold">{year}年{month}月</span>
        <button onClick={nextMonth} className="text-xs px-1" style={{color:'var(--text-secondary)'}}>→</button>
      </div>

      <div className="flex flex-col items-center">
        {/* DOW labels */}
      <div
        className="grid mx-auto mb-0.5 flex-shrink-0"
        style={{ gridTemplateColumns: `repeat(7, ${cellPx}px)`, gap: GAP, width: gridW }}
      >
        {DOW.map(d => (
          <span key={d} className="text-center text-[10px] font-medium" style={{color:'var(--text-muted)'}}>{d}</span>
        ))}
      </div>

      {/* cells */}
      <div
        className="grid mx-auto flex-1"
        style={{
          gridTemplateColumns: `repeat(7, ${cellPx}px)`,
          gridTemplateRows: `repeat(${weeks.length}, ${cellPx}px)`,
          gap: GAP,
          width: gridW,
        }}
      >
        {weeks.flat().map((ds, idx) => {
          if (!ds) return <div key={idx} style={{ width: cellPx, height: cellPx }} />
          const fills = makeup[ds]
          const level = calcLevel(breakdowns[ds], fills)
          const isToday = ds === today
          return (
            <div
              key={idx}
              className="rounded-[2px] cursor-pointer transition-all flex-shrink-0 relative"
              style={{
                width: cellPx,
                height: cellPx,
                background: colors[level],
                outline: isToday ? '2px solid var(--accent)' : 'none',
                outlineOffset: '-1px',
              }}
              onMouseEnter={(e) => {
                clearTimeout(hoverTimer.current)
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setTooltip({ date: ds, x: r.left + r.width / 2, y: r.top - 6 })
              }}
              onMouseLeave={() => { hoverTimer.current = setTimeout(() => setTooltip(null), 100) }}
              onClick={() => setClickDate(ds)}
            >
              {fills && fills.length > 0 && (
                <div className="absolute bottom-[2px] right-[2px] w-[5px] h-[5px] rounded-full" style={{ background: 'var(--accent)' }} />
              )}
            </div>
          )
        })}
      </div>

      {/* legend */}
      <div className="flex items-center justify-center gap-0.5 mt-1 flex-shrink-0 text-[9px]" style={{color:'var(--text-muted)'}}>
        0科达标
        {[0,1,2,3].map(i => <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{background:colors[i]}} />)}
        3科全达标
        <span className="ml-2 flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm relative" style={{background:'var(--heatmap-0)'}}>
            <div className="absolute bottom-[1px] right-[1px] w-[4px] h-[4px] rounded-full" style={{background:'var(--accent)'}} />
          </div>
          含补签
        </span>
      </div>

      </div>

      {tooltip && (
        <div className="fixed z-50 pointer-events-none px-3 py-2 rounded-xl shadow-lg"
          style={{
            left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)',
            background: 'var(--bg-card)', border: '1px solid var(--border-light)',
            color: 'var(--text-primary)', maxWidth: 260,
          }}
        >
          <p className="text-xs font-medium mb-1">{formatDateCN(tooltip.date)}</p>
          <p className="text-xs tabular-nums" style={{color:'var(--text-secondary)'}}>总时长：{formatShortDuration(tooltipSec)}</p>
          <p className="text-[11px] mt-1" style={{color:'var(--accent)'}}>达标 {tooltipN}/3 科</p>
          {tooltipBd?.filter(b => CORE.includes(b.subject)).map(b => (
            <p key={b.subject} className="text-[11px] tabular-nums mt-0.5" style={{color:'var(--text-muted)'}}>
              {getSubjectIcon(b.subject)} {b.subject} {formatShortDuration(b.total_seconds)} {isSubjectMet(b, tooltipFills) ? '✓' : b.total_seconds > 0 ? '✗' : '—'}
            </p>
          ))}
          {tooltipFills?.map(f => (
            <p key={f.subject} className="text-[10px] mt-0.5 tabular-nums" style={{color:'var(--accent)'}}>
              ✚ 补签 {formatShortDuration(f.amount)}（来源 {f.sourceDate} · {f.manual ? '手动' : '自动'}）
            </p>
          ))}
        </div>
      )}

      {clickDate && <DayTimelineModal date={clickDate} onClose={() => setClickDate(null)} onMakeupChange={loadData} />}
    </div>
  )
}

function DayTimelineModal({ date, onClose, onMakeupChange }: { date: string; onClose: () => void; onMakeupChange?: () => void }) {
  const [groups, setGroups] = useState<{ title: string; duration: number; subjects: string[] }[]>([])
  const [classifyTitle, setClassifyTitle] = useState<string | null>(null)
  const [addRule, setAddRule] = useState(false)
  const [availability, setAvailability] = useState<{ subject: string; total: number; need: number; existing: number; available: number; fillable: boolean; scope: string }[] | null>(null)
  const [busySubject, setBusySubject] = useState<string | null>(null)
  const [makeupMsg, setMakeupMsg] = useState<string | null>(null)

  async function loadGroups() {
    const stats: { title: string; duration: number; subject: string }[] = await window.lanshan.getRawTitleStats(date)
    const map = new Map<string, { title: string; duration: number; subjects: Set<string> }>()
    for (const row of stats) {
      if (!row.title) continue
      const key = row.title
      const cur = map.get(key)
      if (cur) {
        cur.duration += row.duration
        cur.subjects.add(row.subject)
      } else {
        map.set(key, { title: key, duration: row.duration, subjects: new Set([row.subject]) })
      }
    }
    setGroups(Array.from(map.values())
      .map(g => ({ ...g, subjects: Array.from(g.subjects) }))
      .filter(g => g.duration >= 120)  // 隐藏 ≤ 2 分钟的零星活动
      .sort((a, b) => b.duration - a.duration))
  }

  async function loadAvailability() {
    const av: { subject: string; total: number; need: number; existing: number; available: number; fillable: boolean; scope: string }[] = await window.lanshan.getMakeupAvailability(date)
    setAvailability(av)
  }

  useEffect(() => { loadGroups(); loadAvailability() }, [date])

  async function handleApply(subject: string) {
    setBusySubject(subject)
    const res = await window.lanshan.applyMakeup(date, subject)
    setBusySubject(null)
    setMakeupMsg(res.message)
    await loadAvailability()
    onMakeupChange?.()
  }

  async function handleUndo(subject: string) {
    setBusySubject(subject)
    await window.lanshan.undoMakeup(date, subject)
    setBusySubject(null)
    await loadAvailability()
    onMakeupChange?.()
  }

  async function handleReclassifyByTitle(title: string, newSubject: string) {
    await window.lanshan.reclassifyByTitle(date, title, newSubject)
    if (addRule) {
      await window.lanshan.addClassificationRule(newSubject, title, 'title', 5)
    }
    await loadGroups()
    setClassifyTitle(null)
    setAddRule(false)
  }

  const classifySubjects = ['物理', '数学', '英语', '化学', '生物', '语文', '休闲', '其他']
  const totalSec = groups.reduce((s, g) => s + g.duration, 0)
  const secondaryColor = 'var(--text-secondary)'
  const textColor = 'var(--text-primary)'
  const cardBg = 'var(--bg-card)'
  const borderLight = 'var(--border-light)'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed z-50 rounded-xl p-5 shadow-xl"
        style={{ left:'50%', top:'50%', transform:'translate(-50%,-50%)', background:'var(--bg-card)', border:'1px solid var(--border)', width:520, maxHeight:'80vh', overflow:'auto' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">🕐 {formatDateCN(date)} · {formatShortDuration(totalSec)}</h3>
          <button onClick={onClose} className="text-lg leading-none" style={{color:'var(--text-muted)'}}>✕</button>
        </div>
        {groups.length === 0 ? (
          <p className="text-xs py-8 text-center" style={{color:'var(--text-muted)'}}>
            该天无学习记录{availability?.some(a => a.fillable && a.available > 0) ? '（可用盈余补签）' : ''}
          </p>
        ) : (
          <div className="space-y-1.5">
            {groups.map((g, i) => (
              <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg" style={{background:'var(--bg-elevated)'}}>
                <span className="text-xs font-medium tabular-nums w-14 flex-shrink-0">{formatShortDuration(g.duration)}</span>
                <span className="text-xs truncate flex-1" style={{color:'var(--text-secondary)'}}>{g.title}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {g.subjects.map(s => (
                    <button
                      key={s}
                      onClick={(e) => { e.stopPropagation(); setClassifyTitle(classifyTitle === g.title ? null : g.title) }}
                      className="text-xs px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80"
                      style={{ background: getSubjectColor(s) + '22', color: getSubjectColor(s) }}
                    >
                      {getSubjectIcon(s)} {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 补签（盈余回填）— 未来日期不显示 */}
        {availability && date <= localDateStr(new Date()) && (
          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${borderLight}` }}>
            <p className="text-xs font-medium mb-1.5" style={{color: secondaryColor}}>✚ 补签（盈余回填）</p>
            {makeupMsg && <p className="text-[10px] mb-1" style={{color:'var(--accent)'}}>{makeupMsg}</p>}
            {availability.map(a => {
              const met = a.need - a.existing <= 0
              const canFill = a.fillable && !met && a.available > 0
              const busy = busySubject === a.subject
              return (
                <div key={a.subject} className="flex items-center gap-2 py-1 text-xs">
                  <span className="w-14 flex-shrink-0 font-medium" style={{color: textColor}}>
                    {getSubjectIcon(a.subject)} {a.subject}
                  </span>
                  {met ? (
                    <span className="flex-1" style={{color:'var(--accent)'}}>
                      已达标{a.existing > 0 ? `（含补签 ${formatShortDuration(a.existing)}）` : ''}
                    </span>
                  ) : (
                    <span className="flex-1 tabular-nums" style={{color: secondaryColor}}>
                      还差 {formatShortDuration(a.need - a.existing)}
                    </span>
                  )}
                  {a.existing > 0 && (
                    <button
                      onClick={() => handleUndo(a.subject)}
                      disabled={busy}
                      className="px-2 py-0.5 rounded-full transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ color: secondaryColor, border: `1px solid ${borderLight}` }}
                    >撤销补签</button>
                  )}
                  {canFill && (
                    <button
                      onClick={() => handleApply(a.subject)}
                      disabled={busy}
                      className="px-2 py-0.5 rounded-full transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ background:'var(--accent)', color:'#fff' }}
                    >补签（可用 {formatShortDuration(a.available)}）</button>
                  )}
                  {!met && a.fillable && !canFill && (
                    <span className="text-[10px]" style={{color:'var(--text-muted)'}}>暂无可用盈余</span>
                  )}
                  {!met && !a.fillable && (
                    <span className="text-[10px]" style={{color:'var(--text-muted)'}}>
                      {a.scope === 'month' ? '不在当月补签范围' : a.scope === 'week' ? '不在近7天补签范围' : '不在补签范围'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Classification popup for title */}
        {classifyTitle && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setClassifyTitle(null); setAddRule(false) }} />
            <div className="fixed z-50 rounded-xl p-3 shadow-xl"
              style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                       background: cardBg, border: `1px solid ${borderLight}`, minWidth: 220 }}
            >
              <p className="text-sm px-2 pt-1 pb-2" style={{ color: secondaryColor }}>
                将「{classifyTitle}」标记为：
              </p>
              {classifySubjects.map(s => (
                <button key={s} onClick={() => handleReclassifyByTitle(classifyTitle!, s)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
                  style={{ color: textColor }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = borderLight }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <span>{getSubjectIcon(s)}</span> {s}
                </button>
              ))}
              <label className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: secondaryColor }}>
                <input type="checkbox" checked={addRule} onChange={e => setAddRule(e.target.checked)} />
                同时保存为分类规则（后续同名标题自动分类）
              </label>
              <button onClick={() => { setClassifyTitle(null); setAddRule(false) }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all mt-1 pt-2"
                style={{ color: secondaryColor, borderTop: `1px solid ${borderLight}` }}>取消</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
