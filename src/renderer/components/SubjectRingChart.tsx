import { PieChart, Pie, ResponsiveContainer, Tooltip } from 'recharts'
import { getSubjectIcon, formatShortDuration } from '../utils'
import { useState, useEffect } from 'react'

const COLORS: Record<string, string> = {
  '物理': '#facc15',
  '数学': '#3b82f6',
  '英语': '#ef4444',
  '休闲': '#ec4899',
  '其他': '#9ca3af',
}

const ALL_SUBJECTS = ['物理', '数学', '英语', '休闲', '其他']

interface RingChartProps {
  data: { subject: string; seconds: number }[]
}

/** Read a CSS variable value from :root */
function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function SubjectRingChart({ data }: RingChartProps): React.ReactElement {
  // Ensure all 5 subjects are always present
  const merged = ALL_SUBJECTS.map(s => {
    const found = data.find(d => d.subject === s)
    return found || { subject: s, seconds: 0 }
  })
  const allData = merged
  const allDataWithFill = merged.map(d => ({
    ...d,
    fill: COLORS[d.subject] || '#64748b',
  }))

  const allLabels = ALL_SUBJECTS
  const [visibleSubjects, setVisibleSubjects] = useState<string[]>([])

  // data 加载后从 localStorage 恢复 toggle 状态
  const allLabelsKey = allLabels.join(',')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ring-visible-subjects')
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        const valid = parsed.filter(s => allLabels.includes(s))
        if (valid.length > 0) {
          setVisibleSubjects(valid)
          return
        }
      }
    } catch {}
    setVisibleSubjects(allLabels)
  }, [allLabelsKey])

  const toggleSubject = (subject: string) => {
    setVisibleSubjects(prev => {
      let next: string[]
      if (prev.includes(subject)) {
        if (prev.length <= 1) return prev
        next = prev.filter(s => s !== subject)
      } else {
        next = [...prev, subject]
      }
      localStorage.setItem('ring-visible-subjects', JSON.stringify(next))
      return next
    })
  }

  const chartDataWithFill = allDataWithFill.filter(d => visibleSubjects.includes(d.subject) && d.seconds > 0)
  const total = chartDataWithFill.reduce((sum, d) => sum + d.seconds, 0)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        暂无数据
      </div>
    )
  }

  const tooltipBg = cssVar('--bg-card') || '#1e293b'
  const tooltipBorder = cssVar('--border-light') || '#334155'
  const textColor = cssVar('--text-primary') || '#f1f5f9'
  const secondaryColor = cssVar('--text-secondary') || '#94a3b8'
  const mutedColor = cssVar('--text-muted') || '#64748b'
  const elevatedBg = cssVar('--bg-elevated') || '#0f172a'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toggle chips */}
      <div className="flex flex-wrap gap-1.5 mb-2 flex-shrink-0">
        {ALL_SUBJECTS.map(s => {
          const visible = visibleSubjects.includes(s)
          const color = COLORS[s] || '#64748b'
          return (
            <button
              key={s}
              onClick={() => toggleSubject(s)}
              className="text-xs leading-none px-2 py-1 rounded-full transition-all"
              style={{
                background: visible ? color : 'transparent',
                color: visible ? '#fff' : secondaryColor,
                border: `1px solid ${color}`,
                opacity: visible ? 1 : 0.45,
              }}
            >
              {getSubjectIcon(s)} {s}
            </button>
          )
        })}
      </div>

      {/* Ring chart + Legend */}
      <div className="flex items-center flex-1 gap-5 min-h-0">
        {/* Ring chart */}
        <div className="w-52 h-52 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartDataWithFill}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                dataKey="seconds"
                strokeWidth={0}
              />
              <Tooltip
                contentStyle={{
                  background: tooltipBg,
                  border: `1px solid ${tooltipBorder}`,
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [formatShortDuration(value), '时长']}
                labelFormatter={(label: string) => `${getSubjectIcon(label)} ${label}`}
              />
              <text
                x="50%"
                y="48%"
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                fontSize="20"
                fontWeight="bold"
                className="tabular-nums"
              >
                {formatShortDuration(total)}
              </text>
              <text
                x="50%"
                y="64%"
                textAnchor="middle"
                dominantBaseline="middle"
                fill={secondaryColor}
                fontSize="11"
              >
                总计
              </text>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-2 flex-1">
          {ALL_SUBJECTS.filter(s => visibleSubjects.includes(s)).map((s) => {
            const entry = allData.find(d => d.subject === s)!
            if (entry.seconds === 0) return null
            const pct = total > 0 ? Math.round((entry.seconds / total) * 100) : 0
              return (
                <div key={entry.subject} className="flex items-center gap-2.5 text-sm">
                  <span className="text-base">{getSubjectIcon(entry.subject)}</span>
                  <span style={{ color: secondaryColor }} className="w-8">{entry.subject}</span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: elevatedBg }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: COLORS[entry.subject] || '#64748b',
                      }}
                    />
                  </div>
                  <span
                    className="tabular-nums w-14 text-right"
                    style={{ color: secondaryColor }}
                  >
                    {formatShortDuration(entry.seconds)}
                  </span>
                  <span
                    className="tabular-nums w-8 text-right"
                    style={{ color: mutedColor }}
                  >
                    {pct}%
                  </span>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
