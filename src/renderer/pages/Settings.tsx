import { useState, useEffect, useRef } from 'react'
import { getSubjectIcon, formatShortDuration } from '../utils'
import { DEFAULT_FOCUS_SCHEDULE, ScheduleSlot, parseSchedule, toMinutes, findActiveSlot, findNextSlot, minutesUntilNext, isScheduleLocked } from '../../shared/schedule'

export default function Settings(): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [surplus, setSurplus] = useState<{ subject: string; gross: number; available: number }[]>([])

  useEffect(() => {
    window.lanshan.getSettings().then(setSettings)
    const today = new Date().toLocaleDateString('sv-SE')
    window.lanshan.getMakeupAvailability(today).then((av: any[]) => setSurplus(av))
  }, [])

  const updateSetting = (key: string, value: string | number | boolean) => {
    window.lanshan.setSetting(key, value)
    setSettings(prev => ({ ...prev, [key]: String(value) }))
  }

  const toggleTheme = () => {
    const newTheme = settings.theme === 'light' ? 'dark' : 'light'
    updateSetting('theme', newTheme)
    // Apply immediately
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(newTheme)
    // Notify App
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: newTheme }))
  }

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      {/* 双栏网格：左列外观/暑假/目标/补签/测试，右列盈余/提醒/算法/规则/其他（lg=1024px 起双栏） */}
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <div className="space-y-5">
      {/* Appearance */}
      <div className="card">
        <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
          🎨 外观
        </h3>
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-base font-medium">深色 / 浅色</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              当前：{settings.theme === 'light' ? '浅色模式' : '深色模式'}
            </p>
          </div>
          <div
            className={`toggle ${settings.theme === 'light' ? 'active' : ''}`}
            onClick={toggleTheme}
          />
        </div>
      </div>

      {/* 主页显示：数据字号 + 卡片边框（拖动滑块实时生效，返回主页即可看到效果） */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
            🏠 主页显示
          </h3>
          <button
            onClick={() => {
              updateSetting('home_font_scale', 1)
              updateSetting('home_border_width', 1)
              updateSetting('home_border_radius', 16)
              updateSetting('home_card_padding', 24)
              const el = document.documentElement
              el.style.setProperty('--dash-font-scale', '1')
              el.style.setProperty('--dash-border-width', '1px')
              el.style.setProperty('--dash-border-radius', '16px')
              el.style.setProperty('--dash-card-padding', '24px')
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
          >
            恢复默认
          </button>
        </div>
        <SliderRow
          label="数据字号"
          hint="主页数据卡、图表文字按比例缩放"
          min={0.7} max={1.5} step={0.05}
          value={parseFloat(settings.home_font_scale || '1') || 1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => {
            updateSetting('home_font_scale', Math.round(v * 100) / 100)
            document.documentElement.style.setProperty('--dash-font-scale', String(Math.round(v * 100) / 100))
          }}
        />
        <SliderRow
          label="卡片边框粗细"
          hint="所有页面卡片统一生效（边框、圆角、内边距）"
          min={0} max={4} step={0.5}
          value={parseFloat(settings.home_border_width || '1') || 1}
          format={(v) => `${v}px`}
          onChange={(v) => {
            updateSetting('home_border_width', v)
            document.documentElement.style.setProperty('--dash-border-width', `${v}px`)
          }}
        />
        <SliderRow
          label="卡片圆角"
          min={0} max={28} step={2}
          value={parseFloat(settings.home_border_radius || '16') || 16}
          format={(v) => `${v}px`}
          onChange={(v) => {
            updateSetting('home_border_radius', v)
            document.documentElement.style.setProperty('--dash-border-radius', `${v}px`)
          }}
        />
        <SliderRow
          label="卡片内边距"
          min={8} max={40} step={2}
          value={parseFloat(settings.home_card_padding || '24') || 24}
          format={(v) => `${v}px`}
          onChange={(v) => {
            updateSetting('home_card_padding', v)
            document.documentElement.style.setProperty('--dash-card-padding', `${v}px`)
          }}
        />
      </div>

      {/* Summer Break Dates */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          🏖 暑假设置
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>开始</span>
            <input
              type="text"
              className="rounded-lg px-3 py-2 text-sm w-20 text-center transition-all"
              placeholder="07-10"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
              value={settings.summer_start || '07-10'}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9-]/g, '')
                if (v.length <= 5) updateSetting('summer_start', v)
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>结束</span>
            <input
              type="text"
              className="rounded-lg px-3 py-2 text-sm w-20 text-center transition-all"
              placeholder="08-31"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
              value={settings.summer_end || '08-31'}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9-]/g, '')
                if (v.length <= 5) updateSetting('summer_end', v)
              }}
            />
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>格式 MM-DD</span>
        </div>
      </div>

      {/* 专注日程 */}
      <FocusScheduleCard settings={settings} updateSetting={updateSetting} />

      {/* Daily Targets */}
      <div className="card">
        <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
          📐 每日学习目标
        </h3>
        {['物理', '数学', '英语'].map(subject => (
          <div key={subject} className="flex items-center gap-4 mb-4 last:mb-0">
            <span className="w-14 text-base font-medium">{subject}</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="12"
              className="rounded-lg px-4 py-2 text-base w-28 text-center transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
              value={settings[`target_${subject}`] ? Math.round(parseInt(settings[`target_${subject}`]) / 3600 * 10) / 10 : 2}
              onChange={(e) => updateSetting(`target_${subject}`, Math.round(parseFloat(e.target.value) * 3600))}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>小时 / 天</span>
          </div>
        ))}
        <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          挑战目标自动 = 基础目标 × 1.5
        </p>
      </div>

      {/* 补签范围 */}
      <div className="card">
        <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
          📝 补签范围
        </h3>
        <div className="flex gap-2">
          {[
            { key: 'all', label: '所有日期' },
            { key: 'month', label: '当月' },
            { key: 'week', label: '近 7 天' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => updateSetting('makeup_scope', opt.key)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                (settings['makeup_scope'] ?? 'all') === opt.key
                  ? { background: 'var(--accent)', color: 'white' }
                  : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          这里选择<b>哪些日期的空缺可以补签</b>；盈余统计见下方。
        </p>
      </div>

      {/* Test Toast */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          🔔 测试
        </h3>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('seal-unlock', {
              detail: { cumulative: ['total-30h'], daily: [] }
            }))
          }}
          className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          🎉 测试刻章弹窗
        </button>
      </div>
        </div>

        <div className="space-y-5">
      {/* 盈余统计 */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          💰 盈余统计
        </h3>
        {surplus.map(s => (
          <div key={s.subject} className="flex items-center justify-between py-1.5 text-sm">
            <span className="flex items-center gap-2">
              <span>{getSubjectIcon(s.subject)}</span> {s.subject}
            </span>
            <span className="tabular-nums" style={{ color: '#fbbf24' }}>
              累计盈余 {formatShortDuration(s.gross)}
              {s.available < s.gross && `（可用 ${formatShortDuration(s.available)}）`}
            </span>
          </div>
        ))}
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          所有日期里，某天某科超过目标的时间都会累积为该科的盈余储备，
          可在补签范围内用于填补空缺（仪表盘进度条末尾的金光 = 当天该科的盈余）。
        </p>
      </div>

      {/* Reminder Settings */}
      <div className="card">
        <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
          🔔 智能提醒
        </h3>

        <div
          className="flex items-center justify-between py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="pr-4">
            <p className="text-base font-medium">⚠ 休闲超时提醒</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              连续刷休闲 {settings.entertainment_threshold ? Math.round(parseInt(settings.entertainment_threshold) / 60) : 30} 分钟后托盘气泡提示
            </p>
          </div>
          <div
            className={`toggle ${settings.entertainment_reminder === 'true' ? 'active' : ''}`}
            onClick={() => updateSetting('entertainment_reminder', settings.entertainment_reminder !== 'true')}
          />
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="pr-4">
            <p className="text-base font-medium">🌙 晚间空窗提醒</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>晚上未检测到学习时提醒（默认关闭）</p>
          </div>
          <div
            className={`toggle ${settings.evening_reminder === 'true' ? 'active' : ''}`}
            onClick={() => updateSetting('evening_reminder', settings.evening_reminder !== 'true')}
          />
        </div>
      </div>

      {/* Algorithm Mode */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          ⚙️ 时间轴算法
        </h3>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium">合并模式</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {settings.algorithm_mode === 'chain' ? '链式吸收（新）：小段链式左吸收，无初始分组' : '经典（旧）：同科目合并 + 短片段吸附'}
            </p>
          </div>
          <select
            value={settings.algorithm_mode || 'legacy'}
            onChange={(e) => updateSetting('algorithm_mode', e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
          >
            <option value="legacy">经典（旧）</option>
            <option value="chain">链式吸收（新）</option>
          </select>
        </div>
      </div>

      {/* Classification Rules */}
      <ClassificationRules />

      {/* Other Settings */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          其他
        </h3>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium">🚀 开机自启</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>系统启动时自动打开</p>
          </div>
          <div
            className={`toggle ${settings.auto_start === 'true' ? 'active' : ''}`}
            onClick={() => {
              const v = settings.auto_start !== 'true'
              updateSetting('auto_start', v)
              window.lanshan.setAutoStart(v)
            }}
          />
        </div>
        <div className="border-t pt-3 mt-2" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => window.lanshan.exportData()}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-left flex items-center gap-2"
            style={{ background: 'var(--accent-bg)', color: 'var(--text-primary)' }}
          >
            📤 导出数据 (JSON)
          </button>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}

/** 分类规则管理组件 */
function ClassificationRules(): React.ReactElement {
  const [rules, setRules] = useState<any[]>([])
  const [newSubject, setNewSubject] = useState('物理')
  const [newKeyword, setNewKeyword] = useState('')
  const [newField, setNewField] = useState('all')
  const [newPri, setNewPri] = useState('5')

  useEffect(() => { loadRules() }, [])

  async function loadRules(): Promise<void> {
    const r = await window.lanshan.getClassificationRules()
    setRules(r)
  }

  async function add(): Promise<void> {
    if (!newKeyword.trim()) return
    await window.lanshan.addClassificationRule(newSubject, newKeyword.trim(), newField, parseInt(newPri, 10))
    setNewKeyword('')
    await loadRules()
  }

  async function remove(id: number): Promise<void> {
    await window.lanshan.deleteClassificationRule(id)
    await loadRules()
  }

  return (
    <div className="card">
      <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
        📋 分类规则
      </h3>
      
      {/* Add form */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={newSubject} onChange={e => setNewSubject(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-xs" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }}>
          {['物理','数学','英语','休闲'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="关键词"
          className="rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[80px]" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }} />
        <select value={newField} onChange={e => setNewField(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-xs" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }}>
          <option value="all">全部字段</option>
          <option value="title">仅标题</option>
          <option value="app">仅进程名</option>
          <option value="url">仅 URL</option>
        </select>
        <input value={newPri} onChange={e => setNewPri(e.target.value)} placeholder="优先级" type="number" min="1" max="100"
          className="rounded-lg px-2 py-1.5 text-xs w-16 text-center" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }} />
        <button onClick={add} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background:'var(--accent)', color:'white' }}>
          + 添加
        </button>
      </div>

      {/* Rules list */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {rules.map(r => (
          <div key={r.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs" style={{ background:'var(--bg-elevated)' }}>
            <span className="font-medium w-10">{r.subject}</span>
            <span className="w-20 truncate" style={{ color:'var(--text-secondary)' }}>{r.keyword}</span>
            <span className="w-14" style={{ color:'var(--text-muted)' }}>{r.match_field === 'title' ? '标题' : r.match_field === 'app' ? '进程' : r.match_field === 'all' ? '全部' : 'URL'}</span>
            <span className="w-6 text-center" style={{ color:'var(--text-muted)' }}>{r.priority}</span>
            <button onClick={() => remove(r.id)} className="ml-auto text-xs" style={{ color:'#ef4444' }}>✕</button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-xs py-4 text-center" style={{ color:'var(--text-muted)' }}>暂无自定义规则</p>}
      </div>
      {/* Export / Import rules */}
      <div className="flex gap-2 mt-3">
        <button onClick={async () => {
          const path = await window.lanshan.exportRules()
          alert('分类规则已导出到：' + path)
        }} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ background:'var(--accent-bg)', color:'var(--accent)' }}>
          📤 导出规则
        </button>
        <button onClick={async () => {
          const n = await window.lanshan.importRules()
          await loadRules()
          alert('已导入 ' + n + ' 条规则')
        }} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ background:'var(--accent-bg)', color:'var(--accent)' }}>
          📥 导入规则
        </button>
      </div>
    </div>
  )
}

/** 专注日程：到点自动进入/结束专注的学习时段管理（宽松/严格模式 + 文本解析 + 手动添加） */
function FocusScheduleCard({ settings, updateSetting }: {
  settings: Record<string, string>
  updateSetting: (key: string, value: string | number | boolean) => void
}): React.ReactElement {
  const enabled = settings.focus_schedule_enabled === 'true'
  const mode = settings.focus_schedule_mode === 'strict' ? 'strict' : 'loose'
  // 时段列表存本地 state（允许编辑中间态，如清空一个输入框），写回时原样保存，
  // 主进程调度器解析时自动丢弃非法行；设置异步加载完成后只同步一次。
  const lastSaved = useRef('')
  const [slots, setSlots] = useState<ScheduleSlot[]>(() =>
    settings.focus_schedule === undefined ? DEFAULT_FOCUS_SCHEDULE : parseSchedule(settings.focus_schedule))
  const [draft, setDraft] = useState('')
  const [parseMsg, setParseMsg] = useState('')
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })

  useEffect(() => {
    if (settings.focus_schedule === undefined || settings.focus_schedule === lastSaved.current) return
    lastSaved.current = settings.focus_schedule
    setSlots(parseSchedule(settings.focus_schedule))
  }, [settings.focus_schedule])

  // 预览每 30 秒刷新
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }, 30_000)
    return () => clearInterval(t)
  }, [])

  const saveSlots = (next: ScheduleSlot[]): void => {
    setSlots(next)
    const json = JSON.stringify(next)
    lastSaved.current = json
    updateSetting('focus_schedule', json)
  }

  /** 粘贴整张日程表 → 自动提取学习时段、忽略休息行；解析结果替换当前列表 */
  const parseFromText = (): void => {
    const found: ScheduleSlot[] = []
    let ignored = 0
    let skipped = 0
    for (const rawLine of draft.split('\n')) {
      const line = rawLine.replace(/(\d{1,2}):(\d{2}):\d{2}/g, '$1:$2').trim()  // 兼容 HH:MM:SS
      if (!line) continue
      // 休息行直接忽略（标注同时含"学习"和"休息"时按学习处理）
      if (/休息/.test(line) && !/学习/.test(line)) { ignored++; continue }
      const m = line.match(/(\d{1,2}):(\d{2})(?!:\d)\s*[-~至到]\s*(\d{1,2}):(\d{2})(?!:\d)/)
      if (!m) { skipped++; continue }
      const s = m[1].padStart(2, '0') + ':' + m[2]
      const e = m[3].padStart(2, '0') + ':' + m[4]
      const si = toMinutes(s)
      const ei = toMinutes(e)
      if (si < 0 || ei < 0 || ei <= si) { skipped++; continue }
      found.push({ s, e })
    }
    if (found.length === 0) {
      setParseMsg('未识别到有效学习时段，请检查格式（每行如：07:00 - 08:00 学习）')
      return
    }
    saveSlots(found)
    setParseMsg(`已识别 ${found.length} 个学习时段${ignored ? `，忽略休息 ${ignored} 行` : ''}${skipped ? `，跳过 ${skipped} 行` : ''}，已替换当前日程`)
  }

  const active = findActiveSlot(slots, nowMin)
  const next = findNextSlot(slots, nowMin)
  const until = minutesUntilNext(slots, nowMin)
  // 严格模式 + 当前处于学习时段 → 锁定：不能切宽松、不能关闭日程、不能提前结束专注
  const locked = enabled && isScheduleLocked(slots, nowMin, mode)

  return (
    <div className="card">
      <h3 className="text-base font-medium mb-5" style={{ color: 'var(--text-secondary)' }}>
        📅 专注日程
      </h3>

      {/* 启用开关 */}
      <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="pr-4">
          <p className="text-base font-medium">日程模式</p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            到点自动进入专注、到点自动结束；休息时段无需设置
          </p>
        </div>
        <div
          className={`toggle ${enabled ? 'active' : ''}`}
          onClick={locked ? undefined : () => updateSetting('focus_schedule_enabled', !enabled)}
        />
      </div>

      {/* 宽松 / 严格模式 */}
      <div className="flex gap-2 mt-4">
        {[
          { key: 'loose', label: '宽松', desc: '手动提前结束后，本时段不再自动进入，下个时段照常' },
          { key: 'strict', label: '严格', desc: '手动结束后 5 秒自动重新进入，直到时段结束' },
        ].map(opt => {
          // 时段锁定：不能从严格切回宽松
          const off = locked && opt.key === 'loose'
          return (
            <button
              key={opt.key}
              onClick={off ? undefined : () => updateSetting('focus_schedule_mode', opt.key)}
              disabled={off}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                off
                  ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'not-allowed', opacity: 0.6 }
                  : mode === opt.key
                    ? { background: 'var(--accent)', color: 'white' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {locked ? (
        <p className="text-xs mt-2" style={{ color: '#fbbf24' }}>
          🔒 当前处于学习时段（严格模式锁定）：不能切换宽松模式、关闭/修改日程或提前结束专注，时段结束自动解锁
        </p>
      ) : (
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          {mode === 'strict'
            ? '严格模式：手动结束后 5 秒自动重新进入，直到时段结束；时段内锁定以上操作'
            : '宽松模式：手动提前结束后，本时段不再自动进入，下个时段照常'}
        </p>
      )}

      {/* 状态预览 */}
      {enabled && (
        <p className="text-xs mt-3 px-3 py-2 rounded-lg" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          {active
            ? `🔒 当前学习时段 ${active.s} - ${active.e} · 专注中`
            : next && until !== null
              ? `☕ 休息中 · 距下次专注还有约 ${until} 分钟（${next.s} 开始）`
              : '✅ 今天的学习时段已全部结束'}
        </p>
      )}

      {/* 手动时段列表：按开始时间排序显示，相邻时段之间标注休息间隔 */}
      <div className="mt-4">
        {slots
          .map((x, idx) => ({ x, idx }))
          .sort((a, b) => toMinutes(a.x.s) - toMinutes(b.x.s))
          .map(({ x: slot, idx: i }, rowIdx, sorted) => {
            const si = toMinutes(slot.s)
            const ei = toMinutes(slot.e)
            const invalid = si < 0 || ei < 0 || ei <= si
            // 与下一个学习时段的时间差 = 休息时间（下一个时段无效时不标注）
            const nextRow = sorted[rowIdx + 1]
            const nextValid = !!nextRow && toMinutes(nextRow.x.s) >= 0 && toMinutes(nextRow.x.e) > toMinutes(nextRow.x.s)
            const gap = !invalid && nextValid ? toMinutes(nextRow!.x.s) - ei : null
            return (
              <div key={i}>
                <div className="flex items-center gap-2 py-0.5">
                  <input
                    type="time"
                    value={slot.s}
                    disabled={locked}
                    onChange={(e) => saveSlots(slots.map((x, j) => (j === i ? { ...x, s: e.target.value } : x)))}
                    className="rounded-lg px-2 py-1.5 text-sm w-28 transition-all"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: invalid ? '1px solid rgba(239,68,68,0.5)' : '1px solid var(--border-light)',
                      color: 'var(--text-primary)',
                      opacity: locked ? 0.5 : 1,
                      cursor: locked ? 'not-allowed' : undefined,
                    }}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
                  <input
                    type="time"
                    value={slot.e}
                    disabled={locked}
                    onChange={(e) => saveSlots(slots.map((x, j) => (j === i ? { ...x, e: e.target.value } : x)))}
                    className="rounded-lg px-2 py-1.5 text-sm w-28 transition-all"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: invalid ? '1px solid rgba(239,68,68,0.5)' : '1px solid var(--border-light)',
                      color: 'var(--text-primary)',
                      opacity: locked ? 0.5 : 1,
                      cursor: locked ? 'not-allowed' : undefined,
                    }}
                  />
                  <span className="text-xs flex-1 font-medium" style={{ color: invalid ? '#ef4444' : 'var(--text-secondary)' }}>
                    {invalid ? '结束需晚于开始' : `⏱ 共 ${ei - si} 分钟`}
                  </span>
                  <button
                    onClick={() => saveSlots(slots.filter((_, j) => j !== i))}
                    disabled={locked}
                    className="text-xs"
                    style={{ color: '#ef4444', opacity: locked ? 0.3 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                  >✕</button>
                </div>
                {/* 休息标注：垂直在上下两个时段之间，水平对齐"⏱ 共 X 分钟"列（与时段行同结构占位）；只有数字特殊标出 */}
                {gap !== null && (
                  <div className="flex items-center gap-2 -mt-1 select-none">
                    <div className="w-28 shrink-0" />
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)', visibility: 'hidden' }}>→</span>
                    <div className="w-28 shrink-0" />
                    <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      ↓{' '}
                      {gap > 0
                        ? <>休息 <b style={{ color: '#fbbf24', fontWeight: 600 }}>{gap}</b> 分钟</>
                        : gap === 0
                          ? '连续无休息'
                          : <>重叠 <b style={{ color: '#ef4444', fontWeight: 600 }}>{-gap}</b> 分钟</>}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        {slots.length === 0 && (
          <p className="text-xs py-2 text-center" style={{ color: 'var(--text-muted)' }}>
            暂无学习时段，可手动添加或粘贴日程表导入
          </p>
        )}
      </div>
      <button
        onClick={() => saveSlots([...slots, { s: '', e: '' }])}
        disabled={locked}
        className="mt-2 w-full px-4 py-2 rounded-lg text-sm font-medium transition-all"
        style={locked
          ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'not-allowed', border: '1px solid var(--border)' }
          : { background: 'var(--accent-bg)', color: 'var(--accent)' }}
      >
        + 添加学习时段
      </button>

      {/* 粘贴日程表解析 */}
      <div className="mt-4">
        <p className="text-sm font-medium mb-1.5">📋 粘贴日程表快速导入</p>
        <textarea
          value={draft}
          disabled={locked}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder={'整张日程表粘进来，自动提取学习时段、忽略休息行，例如：\n07:00 - 08:00  60分钟  学习\n08:00 - 08:15  15分钟  休息'}
          className="w-full rounded-lg px-3 py-2 text-xs leading-relaxed transition-all resize-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', opacity: locked ? 0.5 : 1 }}
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={parseFromText}
            disabled={locked}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={locked
              ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'not-allowed', border: '1px solid var(--border)' }
              : { background: 'var(--accent)', color: 'white' }}
          >
            解析为日程
          </button>
          {parseMsg && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{parseMsg}</span>}
        </div>
      </div>

      <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
        解析结果会替换当前时段列表；休息时段无需设置，软件只在学习时段自动进入/结束专注
      </p>
    </div>
  )
}

/** 设置滑块：标签 + 当前值 + range 输入（值变化即时回调，由调用方负责持久化与 CSS 变量写入） */
function SliderRow({ label, hint, min, max, step, value, onChange, format }: {
  label: string
  hint?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
}): React.ReactElement {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{format(value)}</span>
      </div>
      <input
        type="range"
        className="settings-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  )
}
