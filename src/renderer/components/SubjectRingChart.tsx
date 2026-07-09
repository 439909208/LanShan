import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { getSubjectColor, getSubjectIcon, formatShortDuration } from '../utils'

interface RingChartProps {
  data: { subject: string; seconds: number }[]
}

/** Read a CSS variable value from :root */
function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function SubjectRingChart({ data }: RingChartProps): React.ReactElement {
  const total = data.reduce((sum, d) => sum + d.seconds, 0)
  const chartData = data.filter(d => d.seconds > 0)

  if (chartData.length === 0) {
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
    <div className="flex items-center flex-1 gap-5 min-h-0">
      {/* Ring chart */}
      <div className="w-52 h-52 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              dataKey="seconds"
              strokeWidth={0}
            >
              {chartData.map((entry) => (
                <Cell key={entry.subject} fill={getSubjectColor(entry.subject)} />
              ))}
            </Pie>
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
        {chartData.sort((a, b) => b.seconds - a.seconds).map((entry) => {
          const pct = Math.round((entry.seconds / total) * 100)
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
                    backgroundColor: getSubjectColor(entry.subject),
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
  )
}
