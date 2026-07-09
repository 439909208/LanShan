import { useState, useEffect, useRef } from 'react'
import { getSubjectColor, getSubjectIcon, formatShortDuration } from '../utils'

interface TimelineSegment {
  id: number
  start_time: string
  end_time: string
  duration: number
  subject: string
  title: string
  app: string
  is_exploded: boolean
  parent_id: number | null
}

interface TimelineProps {
  date: string
}

function parseTime(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function timeToX(minutes: number, width: number): number {
  return (minutes / 1440) * width
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const HOUR_MARKS = [6, 8, 10, 12, 14, 16, 18, 20, 22]
const TIMELINE_WIDTH = 1440 * 2

function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function Timeline({ date }: TimelineProps): React.ReactElement {
  const [segments, setSegments] = useState<TimelineSegment[]>([])
  const [filter, setFilter] = useState<'study' | 'all'>('all')
  const [hoveredSeg, setHoveredSeg] = useState<TimelineSegment | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [classifySegId, setClassifySegId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSegments()
  }, [date])

  async function loadSegments(): Promise<void> {
    try {
      const segs: TimelineSegment[] = await window.lanshan.getMergedSegments(date)
      setSegments(segs)
    } catch (err) {
      console.error('Failed to load segments:', err)
    }
  }

  const isStudy = (s: string) => s !== '娱乐'
  const filteredSegments = segments.filter(s =>
    filter === 'study' ? isStudy(s.subject) : true
  )
  const displaySegments = filteredSegments.filter(s => !s.is_exploded)
  const totalDuration = displaySegments.reduce((sum, s) => sum + s.duration, 0)

  async function handleClassify(segmentId: number, subject: string): Promise<void> {
    try {
      await window.lanshan.reclassifySegment(segmentId, subject)
      setClassifySegId(null)
      await loadSegments()
    } catch (err) {
      console.error('Failed to reclassify:', err)
    }
  }

  const secondaryColor = cssVar('--text-secondary') || '#94a3b8'
  const borderColor = cssVar('--border') || '#1e293b'
  const elevatedBg = cssVar('--bg-elevated') || '#0f172a'
  const cardBg = cssVar('--bg-card') || '#1e293b'
  const borderLight = cssVar('--border-light') || '#334155'
  const textColor = cssVar('--text-primary') || '#f1f5f9'

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('study')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: filter === 'study' ? 'var(--accent-bg)' : 'transparent',
              color: filter === 'study' ? 'var(--accent)' : secondaryColor,
            }}
          >
            仅学习
          </button>
          <button
            onClick={() => setFilter('all')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: filter === 'all' ? 'var(--accent-bg)' : 'transparent',
              color: filter === 'all' ? 'var(--accent)' : secondaryColor,
            }}
          >
            全部
          </button>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {displaySegments.length} 段 · {formatShortDuration(totalDuration)}
        </span>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="relative overflow-x-auto overflow-y-hidden rounded-xl"
        style={{
          height: '240px',
          background: elevatedBg,
          border: `1px solid ${borderColor}`,
        }}
      >
        <div className="relative" style={{ width: `${TIMELINE_WIDTH}px`, height: '240px' }}>
          {/* Hour marks */}
          {HOUR_MARKS.map((h) => {
            const x = timeToX(h * 60, TIMELINE_WIDTH)
            return (
              <div key={h} className="absolute top-0 h-full" style={{ left: `${x}px` }}>
                <div className="absolute top-0 w-px h-full" style={{ background: borderColor }} />
                <span
                  className="absolute top-1 left-1.5 text-[10px] tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            )
          })}

          {/* Segments */}
          {displaySegments.map((seg) => {
            const startMin = parseTime(seg.start_time)
            const endMin = parseTime(seg.end_time)
            const x = timeToX(startMin, TIMELINE_WIDTH)
            const w = Math.max(timeToX(Math.max(endMin - startMin, 1), TIMELINE_WIDTH), 4)
            const color = getSubjectColor(seg.subject)
            const isAmbiguous = seg.subject === '未分类'
            const isFun = seg.subject === '娱乐'

            return (
              <div
                key={seg.id}
                className="absolute top-14 rounded transition-all cursor-pointer"
                style={{
                  left: `${x}px`,
                  width: `${w}px`,
                  height: '80px',
                  background: isFun
                    ? `linear-gradient(135deg, ${color}44, ${color}22)`
                    : isAmbiguous
                      ? `repeating-linear-gradient(45deg, ${color}88, ${color}88 4px, transparent 4px, transparent 8px)`
                      : color,
                  borderLeft: isAmbiguous ? `2px dashed ${color}` : 'none',
                  minWidth: '4px',
                }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setHoveredSeg(seg)
                  setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 8 })
                }}
                onMouseLeave={() => setHoveredSeg(null)}
                onClick={() => {
                  if (seg.subject === '未分类') {
                    setClassifySegId(seg.id)
                  }
                }}
              >
                {w > 80 && !isAmbiguous && (
                  <div className="flex items-center gap-1 px-2 h-full truncate">
                    <span className="text-xs leading-none">{getSubjectIcon(seg.subject)}</span>
                    <span className="text-xs leading-none font-medium text-white/90">
                      {formatShortDuration(seg.duration)}
                    </span>
                  </div>
                )}
                {w > 80 && isAmbiguous && (
                  <div className="flex items-center gap-1 px-2 h-full truncate">
                    <span className="text-xs leading-none text-white/70">❓ 点击标记</span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Bottom tick labels */}
          <div
            className="absolute bottom-0 left-0 right-0 h-5"
            style={{ borderTop: `1px solid ${borderColor}` }}
          >
            {HOUR_MARKS.map((h) => {
              const x = timeToX(h * 60, TIMELINE_WIDTH)
              return (
                <span
                  key={h}
                  className="absolute text-[9px] tabular-nums"
                  style={{ left: `${x + 2}px`, top: '1px', color: 'var(--text-muted)' }}
                >
                  {String(h).padStart(2, '0')}点
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredSeg && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div
            className="rounded-xl px-4 py-3 shadow-xl min-w-[160px]"
            style={{
              background: cardBg,
              border: `1px solid ${borderLight}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getSubjectColor(hoveredSeg.subject) }}
              />
              <span className="text-xs font-medium">
                {getSubjectIcon(hoveredSeg.subject)} {hoveredSeg.subject}
              </span>
            </div>
            <div className="text-xs space-y-0.5" style={{ color: secondaryColor }}>
              <p className="tabular-nums">
                {formatTime(hoveredSeg.start_time)} — {formatTime(hoveredSeg.end_time)}
              </p>
              <p className="tabular-nums font-semibold text-base" style={{ color: textColor }}>
                {formatShortDuration(hoveredSeg.duration)}
              </p>
              <p className="mt-1 truncate max-w-[220px]" title={hoveredSeg.title}>
                📄 {hoveredSeg.title}
              </p>
              <p className="truncate max-w-[220px]" style={{ color: 'var(--text-muted)' }}>
                💻 {hoveredSeg.app}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Classification popup */}
      {classifySegId && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setClassifySegId(null)} />
          <div
            className="fixed z-50 rounded-xl p-2 shadow-xl"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background: cardBg,
              border: `1px solid ${borderLight}`,
            }}
          >
            <p className="text-sm px-2 pt-1 pb-2" style={{ color: secondaryColor }}>
              标记为哪个科目？
            </p>
            {['物理', '数学', '英语', '化学', '生物', '语文'].map((s) => (
              <button
                key={s}
                onClick={() => handleClassify(classifySegId, s)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
                style={{ color: textColor }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = borderLight }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span>{getSubjectIcon(s)}</span>
                {s}
              </button>
            ))}
            <button
              onClick={() => setClassifySegId(null)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all mt-1 pt-2"
              style={{ color: secondaryColor, borderTop: `1px solid ${borderLight}` }}
            >
              取消
            </button>
          </div>
        </>
      )}
    </div>
  )
}
