import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { getSubjectColor, getSubjectIcon, formatShortDuration } from '../utils'
import { useState } from 'react'

interface WeekTrendProps {
  data: { date: string; subjects: Record<string, number>; total: number }[]
  prevWeekData: { date: string; subjects: Record<string, number>; total: number }[]
  coreSubjects: string[]
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function cssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function WeekTrendChart({ data, prevWeekData, coreSubjects }: WeekTrendProps): React.ReactElement {
  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview')

  const thisWeekTotal = data.reduce((s, d) => s + d.total, 0)
  const prevWeekTotal = prevWeekData.reduce((s, d) => s + d.total, 0)
  const diff = thisWeekTotal - prevWeekTotal

  const chartData = data.map((d) => {
    const date = new Date(d.date + 'T00:00:00')
    const point: Record<string, any> = {
      label: DAY_NAMES[date.getDay()] || '',
    }
    if (viewMode === 'overview') {
      point['总计'] = d.total
    } else {
      for (const s of coreSubjects) {
        point[s] = d.subjects[s] || 0
      }
    }
    return point
  })

  const lines = viewMode === 'overview'
    ? [{ key: '总计', color: '#10b981' }]
    : coreSubjects.map(s => ({ key: s, color: getSubjectColor(s) }))

  const tooltipBg = cssVar('--bg-card') || '#1e293b'
  const tooltipBorder = cssVar('--border-light') || '#334155'
  const mutedColor = cssVar('--text-muted') || '#64748b'
  const borderColor = cssVar('--border') || '#1e293b'
  const borderLight = cssVar('--border-light') || '#334155'
  const secondaryColor = cssVar('--text-secondary') || '#94a3b8'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm" style={{ color: secondaryColor }}>比上周 </span>
          <span
            className="text-sm font-medium tabular-nums"
            style={{ color: diff >= 0 ? '#22c55e' : secondaryColor }}
          >
            {diff >= 0 ? '+' : ''}{formatShortDuration(diff)} {diff >= 0 ? '↑' : '↓'}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('overview')}
            className={`px-2 py-0.5 rounded text-xs transition-all`}
            style={{
              background: viewMode === 'overview' ? '#10b981' : 'transparent',
              color: viewMode === 'overview' ? 'white' : secondaryColor,
            }}
          >
            总览
          </button>
          <button
            onClick={() => setViewMode('detail')}
            className={`px-2 py-0.5 rounded text-xs transition-all`}
            style={{
              background: viewMode === 'detail' ? '#10b981' : 'transparent',
              color: viewMode === 'detail' ? 'white' : secondaryColor,
            }}
          >
            分科
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={{ stroke: borderLight }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: mutedColor, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={45}
              tickFormatter={(v: number) => formatShortDuration(v)}
            />
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                borderRadius: '8px',
                fontSize: '13px',
              }}
              formatter={(value: number) => [formatShortDuration(value), '时长']}
            />
            <Legend wrapperStyle={{ fontSize: '11px', color: mutedColor }} />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                strokeWidth={2}
                dot={{ fill: line.color, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
