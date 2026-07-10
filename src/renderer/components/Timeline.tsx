import { useState, useEffect, useRef, useCallback } from 'react'
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

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4]
const DEFAULT_ZOOM_INDEX = 2 // 1x
const HOUR_MARKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

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
  const [zoomIndex, setZoomIndex] = useState(() => {
    const saved = localStorage.getItem('timeline-zoom')
    return saved ? parseInt(saved, 10) : DEFAULT_ZOOM_INDEX
  })
  const [detailSeg, setDetailSeg] = useState<TimelineSegment | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedDateRef = useRef<string>('')
  const timeCenterRef = useRef<number>(12 * 60) // minutes from 00:00, for zoom center

  const zoom = ZOOM_LEVELS[zoomIndex]
  const pxPerHour = 60 * zoom
  const timelineWidth = 24 * pxPerHour

  useEffect(() => {
    loadSegments()
  }, [date])

  // Save/restore scroll position per date
  useEffect(() => {
    if (loadedDateRef.current === date && scrollRef.current) {
      const saved = localStorage.getItem(`timeline-scroll-${date}`)
      if (saved) {
        scrollRef.current.scrollLeft = parseInt(saved, 10)
      }
    }
    loadedDateRef.current = date
  }, [date, segments])

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      localStorage.setItem(`timeline-scroll-${date}`, String(scrollRef.current.scrollLeft))
    }
  }, [date])

  async function loadSegments(): Promise<void> {
    try {
      const segs: TimelineSegment[] = await window.lanshan.getMergedSegments(date)
      setSegments(segs)
    } catch (err) {
      console.error('Failed to load segments:', err)
    }
  }

  const isStudy = (s: string) => s !== '休闲' && s !== '未分类' && s !== '其他'
  const filteredSegments = segments.filter(s =>
    filter === 'study' ? isStudy(s.subject) : true
  )
  const displaySegments = filteredSegments.filter(s => !s.is_exploded)
  const totalDuration = displaySegments.reduce((sum, s) => sum + s.duration, 0)

  async function handleClassify(segmentId: number, subject: string): Promise<void> {
    try {
      await window.lanshan.reclassifySegment(segmentId, subject)
      setClassifySegId(null)
      setDetailSeg(null)
      await loadSegments()
    } catch (err) {
      console.error('Failed to reclassify:', err)
    }
  }

  function zoomIn() {
    if (scrollRef.current) {
      const viewLeft = scrollRef.current.scrollLeft
      const viewWidth = scrollRef.current.clientWidth
      timeCenterRef.current = ((viewLeft + viewWidth / 2) / (24 * pxPerHour)) * 1440
    }
    setZoomIndex(i => {
      const next = Math.min(i + 1, ZOOM_LEVELS.length - 1)
      localStorage.setItem('timeline-zoom', String(next))
      return next
    })
  }
  function zoomOut() {
    if (scrollRef.current) {
      const viewLeft = scrollRef.current.scrollLeft
      const viewWidth = scrollRef.current.clientWidth
      timeCenterRef.current = ((viewLeft + viewWidth / 2) / (24 * pxPerHour)) * 1440
    }
    setZoomIndex(i => {
      const next = Math.max(i - 1, 0)
      localStorage.setItem('timeline-zoom', String(next))
      return next
    })
  }
  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else zoomOut()
    } else if (scrollRef.current) {
      // Plain scroll wheel → horizontal scroll
      scrollRef.current.scrollLeft += e.deltaY * 2
    }
  }

  // Restore scroll position after zoom to keep center point
  useEffect(() => {
    if (scrollRef.current && segments.length > 0) {
      const newPxPerHour = 60 * zoom
      const centerPx = (timeCenterRef.current / 1440) * 24 * newPxPerHour
      scrollRef.current.scrollLeft = Math.max(0, centerPx - scrollRef.current.clientWidth / 2)
    }
  }, [zoom])

  const secondaryColor = cssVar('--text-secondary') || '#94a3b8'
  const borderColor = cssVar('--border') || '#1e293b'
  const elevatedBg = cssVar('--bg-elevated') || '#0f172a'
  const cardBg = cssVar('--bg-card') || '#1e293b'
  const borderLight = cssVar('--border-light') || '#334155'
  const textColor = cssVar('--text-primary') || '#f1f5f9'

  return (
    <div>
      {/* Controls row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button onClick={() => setFilter('study')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{ background: filter === 'study' ? 'var(--accent-bg)' : 'transparent',
                     color: filter === 'study' ? 'var(--accent)' : secondaryColor }}>
            仅学习
          </button>
          <button onClick={() => setFilter('all')}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{ background: filter === 'all' ? 'var(--accent-bg)' : 'transparent',
                     color: filter === 'all' ? 'var(--accent)' : secondaryColor }}>
            全部
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {displaySegments.length} 段 · {formatShortDuration(totalDuration)}
          </span>
          <div className="flex items-center gap-0.5 rounded-lg" style={{ background: elevatedBg, border: `1px solid ${borderColor}` }}>
            <button onClick={zoomOut} disabled={zoomIndex === 0}
              className="px-2 py-1 text-xs transition-all disabled:opacity-30"
              style={{ color: secondaryColor }}>−</button>
            <span className="text-xs tabular-nums px-1" style={{ color: secondaryColor }}>{zoom}x</span>
            <button onClick={zoomIn} disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className="px-2 py-1 text-xs transition-all disabled:opacity-30"
              style={{ color: secondaryColor }}>+</button>
          </div>
        </div>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        className="relative overflow-x-auto overflow-y-hidden rounded-xl"
        style={{ height: '220px', background: elevatedBg, border: `1px solid ${borderColor}` }}
      >
        <div className="relative" style={{ width: `${timelineWidth}px`, height: '220px' }}>
          {/* Hour marks — top labels */}
          {HOUR_MARKS.map((h) => {
            const x = (h / 24) * timelineWidth
            return (
              <div key={h} className="absolute top-0 h-full pointer-events-none" style={{ left: `${x}px` }}>
                <div className="absolute top-0 w-px h-full" style={{ background: borderColor, opacity: h % 2 === 0 ? 0.5 : 0.2 }} />
                <span className="absolute top-0.5 left-1 text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            )
          })}
          {/* Bottom border */}
          <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: borderColor }} />

          {/* Segments */}
          {displaySegments.map((seg) => {
            const startMin = parseTime(seg.start_time)
            const endMin = parseTime(seg.end_time)
            const x = (startMin / 1440) * timelineWidth
            const w = Math.max(((Math.max(endMin - startMin, 1)) / 1440) * timelineWidth, 4)
            const color = getSubjectColor(seg.subject)
            const isAmbiguous = seg.subject === '未分类'
            const isFun = seg.subject === '休闲'
            const isLockScreen = seg.app === 'LockApp.exe' || (seg.title && seg.title.indexOf('锁屏') !== -1)

            return (
              <div
                key={seg.id}
                className="absolute rounded transition-all cursor-pointer hover:brightness-110"
                style={{
                  left: `${x}px`,
                  width: `${w}px`,
                  height: '80px',
                  top: '24px',
                  background: isLockScreen
                    ? `repeating-linear-gradient(45deg, ${color}22, ${color}22 6px, transparent 6px, transparent 12px)`
                    : isFun
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
                  } else {
                    setDetailSeg(seg)
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
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredSeg && (
        <div className="fixed z-50 pointer-events-none"
          style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`, transform: 'translate(-50%, -100%)' }}
        >
          <div className="rounded-xl px-4 py-3 shadow-xl min-w-[160px]"
            style={{ background: cardBg, border: `1px solid ${borderLight}` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getSubjectColor(hoveredSeg.subject) }} />
              <span className="text-xs font-medium">{getSubjectIcon(hoveredSeg.subject)} {hoveredSeg.subject}</span>
            </div>
            <div className="text-xs space-y-0.5" style={{ color: secondaryColor }}>
              <p className="tabular-nums">{formatTime(hoveredSeg.start_time)} — {formatTime(hoveredSeg.end_time)}</p>
              <p className="tabular-nums font-semibold text-base" style={{ color: textColor }}>
                {formatShortDuration(hoveredSeg.duration)}
              </p>
              <p className="truncate max-w-[200px] text-xs" style={{ color: 'var(--text-muted)' }}>
                {hoveredSeg.title}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal — click any segment */}
      {detailSeg && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDetailSeg(null)} />
          <div className="fixed z-50 rounded-xl p-5 shadow-xl"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
                     background: cardBg, border: `1px solid ${borderLight}`, width: 440, maxWidth: '90vw' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: getSubjectColor(detailSeg.subject) }} />
                {getSubjectIcon(detailSeg.subject)} {detailSeg.subject}
              </h3>
              <button onClick={() => setDetailSeg(null)} className="text-lg leading-none" style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>
            <div className="text-sm space-y-2" style={{ color: secondaryColor }}>
              <p className="tabular-nums">⏱ {formatTime(detailSeg.start_time)} — {formatTime(detailSeg.end_time)}</p>
              <p className="tabular-nums font-semibold text-lg" style={{ color: textColor }}>{formatShortDuration(detailSeg.duration)}</p>
              <p className="truncate" title={detailSeg.title}>📄 {detailSeg.title}</p>
              <p className="truncate" style={{ color: 'var(--text-muted)' }}>💻 {detailSeg.app}</p>
            </div>
            {/* Merged constituents — children of this segment */}
            {(() => {
              const children = segments.filter(s => s.parent_id === detailSeg.id)
              if (children.length === 0) return null
              return (
                <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${borderLight}` }}>
                  <p className="text-xs mb-2 font-medium" style={{ color: secondaryColor }}>
                    合并了 {children.length} 项：
                  </p>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {children.map(c => (
                      <div key={c.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded"
                        style={{ background: elevatedBg }}>
                        <span className="tabular-nums w-14 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {formatShortDuration(c.duration)}
                        </span>
                        <span className="truncate">{c.title}</span>
                        <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{c.app}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
            {/* Re-classify */}
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${borderLight}` }}>
              <p className="text-xs mb-2" style={{ color: secondaryColor }}>重新分类为：</p>
              <div className="flex flex-wrap gap-1.5">
                {['物理', '数学', '英语', '休闲', '其他'].map(s => (
                  <button key={s} onClick={() => handleClassify(detailSeg.id, s)}
                    className="px-2.5 py-1 rounded-lg text-xs transition-all"
                    style={{ background: elevatedBg, color: textColor }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = borderLight }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = elevatedBg }}>
                    {getSubjectIcon(s)} {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Classification popup for unclassified segments */}
      {classifySegId && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setClassifySegId(null)} />
          <div className="fixed z-50 rounded-xl p-2 shadow-xl"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                     background: cardBg, border: `1px solid ${borderLight}` }}
          >
            <p className="text-sm px-2 pt-1 pb-2" style={{ color: secondaryColor }}>标记为哪个科目？</p>
            {['物理', '数学', '英语', '化学', '生物', '语文'].map(s => (
              <button key={s} onClick={() => handleClassify(classifySegId, s)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
                style={{ color: textColor }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = borderLight }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <span>{getSubjectIcon(s)}</span> {s}
              </button>
            ))}
            <button onClick={() => setClassifySegId(null)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all mt-1 pt-2"
              style={{ color: secondaryColor, borderTop: `1px solid ${borderLight}` }}>取消</button>
          </div>
        </>
      )}
    </div>
  )
}
