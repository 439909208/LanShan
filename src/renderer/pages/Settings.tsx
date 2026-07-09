import { useState, useEffect } from 'react'

export default function Settings(): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    window.lanshan.getSettings().then(setSettings)
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
    <div className="space-y-5 max-w-2xl">
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
            <p className="text-base font-medium">⚠ 娱乐超时提醒</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              连续刷娱乐 {settings.entertainment_threshold ? Math.round(parseInt(settings.entertainment_threshold) / 60) : 30} 分钟后托盘气泡提示
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

      {/* Classification Rules */}
      <ClassificationRules />

      {/* Test Toast */}
      <div className="card">
        <h3 className="text-base font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          🔔 测试
        </h3>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('achievement-unlock', {
              detail: ['total-30h']
            }))
          }}
          className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          🎉 测试成就弹窗
        </button>
      </div>

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
  )
}

/** 分类规则管理组件 */
function ClassificationRules(): React.ReactElement {
  const [rules, setRules] = useState<any[]>([])
  const [newSubject, setNewSubject] = useState('物理')
  const [newKeyword, setNewKeyword] = useState('')
  const [newField, setNewField] = useState('title')
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
          {['物理','数学','英语','娱乐'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="关键词"
          className="rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[80px]" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }} />
        <select value={newField} onChange={e => setNewField(e.target.value)}
          className="rounded-lg px-2 py-1.5 text-xs" style={{ background:'var(--bg-elevated)', color:'var(--text-primary)', border:'1px solid var(--border-light)' }}>
          <option value="title">标题</option>
          <option value="app">进程名</option>
          <option value="url">URL</option>
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
            <span className="w-10" style={{ color:'var(--text-muted)' }}>{r.match_field === 'title' ? '标题' : r.match_field === 'app' ? '进程' : 'URL'}</span>
            <span className="w-6 text-center" style={{ color:'var(--text-muted)' }}>{r.priority}</span>
            <button onClick={() => remove(r.id)} className="ml-auto text-xs" style={{ color:'#ef4444' }}>✕</button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-xs py-4 text-center" style={{ color:'var(--text-muted)' }}>暂无自定义规则</p>}
      </div>
    </div>
  )
}
