import { useState, useEffect, useMemo, useRef } from 'react'
import { formatCountdown, formatDuration, getSubjectColor, getSubjectIcon, focusEntryKey, sortWhitelistByOrder } from '../utils'
import { DEFAULT_FOCUS_SCHEDULE, parseSchedule, isScheduleLocked } from '../../shared/schedule'

/** 背景主题：氛围色 → 深色渐变背景（与 🎨 色板一一对应） */
const BG_THEMES: Record<string, string> = {
  '#ecfdf5': 'linear-gradient(140deg, #022c22 0%, #064e3b 45%, #0f766e 100%)', // 深绿（默认）
  '#fbbf24': 'linear-gradient(140deg, #2b1f06 0%, #4a3408 45%, #7c5310 100%)', // 深金
  '#2dd4bf': 'linear-gradient(140deg, #02242c 0%, #06454e 45%, #0f6e66 100%)', // 深青
  '#60a5fa': 'linear-gradient(140deg, #0a1428 0%, #122a4a 45%, #1e4a7c 100%)', // 深蓝
  '#a78bfa': 'linear-gradient(140deg, #1a1028 0%, #2a1a4a 45%, #4a2a7c 100%)', // 深紫
  '#fb7185': 'linear-gradient(140deg, #2a0a12 0%, #4a1420 45%, #7c1e30 100%)', // 深粉
}

/** 今日战况：总时长 + 连续天数 + 各科目标进度 */
interface TodayStats {
  totalSeconds: number
  consecutive: number
  subjects: { subject: string; seconds: number; target: number }[]
}

/** 近 7 日数据（周一到周日） */
interface WeekDay {
  date: string
  total: number
}

/** 已专注进度燃料条的分段数 */
const GAUGE_SEGMENTS = 16

/** 环境音类型 */
type NoiseKind = 'off' | 'rain' | 'ocean' | 'fire' | 'white'

const NOISE_OPTIONS: { kind: Exclude<NoiseKind, 'off'>; label: string; icon: string }[] = [
  { kind: 'rain', label: '雨声', icon: '🌧' },
  { kind: 'ocean', label: '海浪', icon: '🌊' },
  { kind: 'fire', label: '篝火', icon: '🔥' },
  { kind: 'white', label: '白噪', icon: '⚪' },
]

/** 休息提醒间隔选项（分钟），0 = 关闭 */
const REMIND_OPTIONS = [0, 25, 45, 60]

const REMIND_TEXTS = [
  '💧 喝口水，顺便让眼睛休息一下',
  '🧘 站起来伸个懒腰，活动一下肩颈',
  '🌿 深呼吸三次，调整状态继续',
  '👀 眺望远处 20 秒，放松睫状肌',
]

/** 激励语录 */
const QUOTES = [
  '专注是送给未来的自己最好的礼物。',
  '每一次坚持，都在悄悄拉开差距。',
  '沉下心来的每一分钟，都算数。',
  '把注意力放在当下，结果自然发生。',
  '真正的自律，是把小事重复做到极致。',
  '你现在流的每一滴汗，都在浇灌未来。',
  '慢一点没关系，只要一直在前进。',
  '心无旁骛，万夫莫开。',
  '今日的积累，是明日从容的底气。',
  '关掉喧嚣，世界会还你一片安静的力量。',
  '学得进去的每一刻，都值得被记录。',
  '专注当下，未来自有答案。',
]

/** ─── Web Audio 环境音引擎（实时合成，无需音频文件） ─── */
class NoiseEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private nodes: AudioNode[] = []
  private kind: NoiseKind = 'off'

  /** 惰性创建 AudioContext（Electron 默认允许无手势自动播放） */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.5
        this.master.connect(this.ctx.destination)
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** 生成 2 秒循环噪声 buffer：white / pink（保罗·凯尔特）/ brown（随机游走） */
  private noiseBuffer(ctx: AudioContext, type: 'white' | 'pink' | 'brown'): AudioBuffer {
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    if (type === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
      }
    } else {
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      }
    }
    return buf
  }

  /** 播放指定环境音（先停掉旧的） */
  play(kind: Exclude<NoiseKind, 'off'>, volume: number): void {
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    this.stop()
    this.kind = kind
    this.master.gain.value = Math.max(0, Math.min(1, volume))

    const loop = (type: 'white' | 'pink' | 'brown'): AudioBufferSourceNode => {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer(ctx, type)
      src.loop = true
      return src
    }
    const lowpass = (freq: number): BiquadFilterNode => {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = freq
      return f
    }
    const lfo = (freq: number, depth: number): OscillatorNode => {
      const o = ctx.createOscillator()
      o.frequency.value = freq
      const g = ctx.createGain()
      g.gain.value = depth
      o.connect(g)
      o.start()
      this.nodes.push(o, g)
      return g
    }

    if (kind === 'rain') {
      // 粉红噪声 + 低通 → 细密雨声
      const src = loop('pink')
      const f = lowpass(1400)
      src.connect(f).connect(this.master)
      src.start()
      this.nodes.push(src, f)
    } else if (kind === 'ocean') {
      // 布朗噪声 + 低通 + 0.08Hz 涨落 → 海浪
      const src = loop('brown')
      const f = lowpass(420)
      const g = ctx.createGain()
      g.gain.value = 0.55
      lfo(0.08, 0.45).connect(g.gain)
      src.connect(f).connect(g).connect(this.master)
      src.start()
      this.nodes.push(src, f, g)
    } else if (kind === 'fire') {
      // 粉红噪声 + 低通 + 不规则爆裂调制 → 篝火
      const src = loop('pink')
      const f = lowpass(650)
      const g = ctx.createGain()
      g.gain.value = 0.7
      lfo(0.35, 0.3).connect(g.gain)
      src.connect(f).connect(g).connect(this.master)
      src.start()
      this.nodes.push(src, f, g)
    } else {
      // 白噪音（高频衰减一点更柔和）
      const src = loop('white')
      const f = lowpass(9000)
      src.connect(f).connect(this.master)
      src.start()
      this.nodes.push(src, f)
    }
  }

  /** 停止播放并清理节点 */
  stop(): void {
    for (const n of this.nodes) {
      try {
        if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop()
        n.disconnect()
      } catch { /* 已断开忽略 */ }
    }
    this.nodes = []
    this.kind = 'off'
  }

  /** 调整音量（播放中实时生效） */
  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v))
  }

  /** 播放提示音序列（[频率, 时长秒]），用于提醒/完成音效 */
  playToneSeq(notes: [number, number][]): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + 0.02
    notes.forEach(([freq, dur], i) => {
      const t = t0 + i * 0.09
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.16, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(g).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    })
  }
}

/** 全局唯一引擎（组件间共享，避免重复建 AudioContext） */
let engineSingleton: NoiseEngine | null = null
function getEngine(): NoiseEngine {
  if (!engineSingleton) engineSingleton = new NoiseEngine()
  return engineSingleton
}

/** HUD 面板四角装饰括号（科幻控制台元素） */
function HudCorners(): React.ReactElement {
  const c = 'rgba(110,231,183,0.55)'
  return (
    <>
      <span className="absolute -top-px -left-px w-3.5 h-3.5 border-t-2 border-l-2 rounded-tl-sm" style={{ borderColor: c }} />
      <span className="absolute -top-px -right-px w-3.5 h-3.5 border-t-2 border-r-2 rounded-tr-sm" style={{ borderColor: c }} />
      <span className="absolute -bottom-px -left-px w-3.5 h-3.5 border-b-2 border-l-2 rounded-bl-sm" style={{ borderColor: c }} />
      <span className="absolute -bottom-px -right-px w-3.5 h-3.5 border-b-2 border-r-2 rounded-br-sm" style={{ borderColor: c }} />
    </>
  )
}

/** HUD 面板：毛玻璃 + 四角括号 + 状态灯标题行 + 鼠标跟随光晕（可开关） */
function HudPanel({ label, right, className, glow = true, children }: {
  label: string
  right?: string
  className?: string
  glow?: boolean
  children: React.ReactNode
}): React.ReactElement {
  /** 鼠标跟随光晕：把光标位置写入 CSS 变量（radial-gradient 跟随） */
  const onGlow = (e: React.MouseEvent<HTMLElement>): void => {
    if (!glow) return
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px')
    e.currentTarget.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px')
  }
  return (
    <section
      onMouseMove={onGlow}
      className={(glow ? 'hud-glow ' : '') + 'relative rounded-2xl p-5 ' + (className || '')}
      style={{
        background: 'rgba(4,18,14,0.5)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}
    >
      <HudCorners />
      <header className="flex items-center justify-between mb-4 select-none">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
          <span className="mono text-[11px] font-semibold tracking-[0.2em]" style={{ color: 'rgba(110,231,183,0.9)' }}>
            {label}
          </span>
        </div>
        {right && (
          <span className="mono text-[10px] tracking-[0.15em] tabular-nums" style={{ color: 'rgba(236,253,245,0.4)' }}>
            {right}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

/** 专注桌面：全屏覆盖层，白名单软件图标 + 大倒计时，只有点这里的软件才能用 */
export default function FocusOverlay(): React.ReactElement {
  const [state, setState] = useState<FocusState | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  // 今日战况（真实学习数据）
  const [today, setToday] = useState<TodayStats | null>(null)
  // 近 7 日专注（周一到周日）
  const [week, setWeek] = useState<WeekDay[] | null>(null)
  // 隐藏的条目（✕ 隐藏 = 专注桌面不显示，白名单锁定规则保留，可显示回来）
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())
  const [restoreOpen, setRestoreOpen] = useState(false)
  // 图标自定义顺序（拖拽排序持久化）
  const [orderKeys, setOrderKeys] = useState<string[]>([])
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  // 氛围色（诗词/扫描光带，可自定义）
  const [poemColor, setPoemColor] = useState('#ecfdf5')
  const [colorOpen, setColorOpen] = useState(false)
  // 任务栏最小化面板：白名单中窗口最小化在任务栏的程序（点启动栏可直接弹回）
  const [bgOpen, setBgOpen] = useState(false)
  const [bgApps, setBgApps] = useState<FocusApp[]>([])

  /** 手动刷新最小化列表（面板打开时查询一次，之后由用户点刷新按钮更新） */
  const refreshBgApps = (): void => {
    window.lanshan.getBackgroundApps().then(setBgApps).catch(() => setBgApps([]))
  }

  // ── v2 新功能状态 ──
  const [controlOpen, setControlOpen] = useState(false)
  const [noiseKind, setNoiseKind] = useState<NoiseKind>('off')
  const [noiseVol, setNoiseVol] = useState(45)
  const [remindMin, setRemindMin] = useState(45)
  const [sfxOn, setSfxOn] = useState(true)
  const [quoteOn, setQuoteOn] = useState(true)
  const [glowOn, setGlowOn] = useState(true)
  const [remindShow, setRemindShow] = useState<{ id: number; text: string } | null>(null)
  const [quoteIdx, setQuoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [tilePulse, setTilePulse] = useState<string | null>(null)
  const [minPulse, setMinPulse] = useState(0)
  // 剩余秒数的 ref（提醒轮询用，避免 effect 依赖链）
  const remainingRef = useRef(0)
  const lastRemindRef = useRef(0)
  const wasActiveRef = useRef(false)
  // 严格模式学习时段锁定：禁止结束专注（主进程同样会拒绝，这里是 UI 层禁止）
  const [scheduleLocked, setScheduleLocked] = useState(false)
  const scheduleLockedRef = useRef(false)

  /** 可选氛围色 */
  const POEM_COLORS = ['#ecfdf5', '#fbbf24', '#2dd4bf', '#60a5fa', '#a78bfa', '#fb7185']

  useEffect(() => {
    window.lanshan.getFocusState().then((s) => {
      setState(s)
      // 预取白名单软件的真实图标（澜山自身无 path，主进程会用当前 exe 提取）
      s.whitelist.forEach(a => {
        if (a.path || ['electron', 'electron.exe', '澜山.exe'].includes(a.name.toLowerCase())) {
          window.lanshan.getAppIcon(a.name, a.path || '').then((url) => {
            if (url) setIcons(prev => ({ ...prev, [a.name.toLowerCase()]: url }))
          })
        }
      })
    })
    // 主界面隐藏的条目：专注桌面不显示
    window.lanshan.getFocusHidden().then(keys => setHiddenKeys(new Set(keys)))
    // 自定义顺序：拖拽排序持久化
    window.lanshan.getFocusOrder().then(setOrderKeys)
    // 氛围色（诗词/扫描光带）
    window.lanshan.getFocusColor().then(c => { if (c) setPoemColor(c) })
    // v2 偏好设置：环境音 / 提醒 / 音效 / 语录（持久化）
    window.lanshan.getSettings().then(s => {
      const kind = s['focus_noise'] as NoiseKind
      if (kind && kind !== 'off') setNoiseKind(kind)
      const vol = parseInt(s['focus_noise_vol'] || '', 10)
      if (!isNaN(vol) && vol >= 0 && vol <= 100) setNoiseVol(vol)
      const rm = parseInt(s['focus_remind_min'] || '', 10)
      if (REMIND_OPTIONS.includes(rm)) setRemindMin(rm)
      if (s['focus_sfx'] === '0') setSfxOn(false)
      if (s['focus_quote'] === '0') setQuoteOn(false)
      if (s['focus_glow'] === '0') setGlowOn(false)
    })
    const unsubscribe = window.lanshan.onFocusTick((tick) => {
      setState(prev => prev ? { ...prev, ...tick } : prev)
    })
    const clock = setInterval(() => setNow(Date.now()), 1000)
    // 键盘逃生：Esc 或 Ctrl+Shift+F10 直接结束专注（不弹确认，保证能退出）。
    // 严格模式学习时段内锁定：忽略（时段结束自动解锁）。
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.ctrlKey && e.shiftKey && e.key === 'F10')) {
        if (scheduleLockedRef.current) return
        e.preventDefault()
        window.lanshan.stopFocus().catch(() => { /* 主进程侧还有全局快捷键兜底 */ })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { unsubscribe(); clearInterval(clock); window.removeEventListener('keydown', onKey) }
  }, [])

  // 严格模式时段锁定状态：读取设置 + 每 30 秒刷新（与今日战况轮询同步）
  useEffect(() => {
    const refresh = (): void => {
      window.lanshan.getSettings().then(s => {
        const slots = s.focus_schedule === undefined ? DEFAULT_FOCUS_SCHEDULE : parseSchedule(s.focus_schedule)
        const d = new Date()
        const locked = s.focus_schedule_enabled === 'true' &&
          isScheduleLocked(slots, d.getHours() * 60 + d.getMinutes(), s.focus_schedule_mode ?? 'loose')
        setScheduleLocked(locked)
        scheduleLockedRef.current = locked
      }).catch(() => { /* 设置读取失败按未锁定处理 */ })
    }
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [])

  /** 今日战况 + 近 7 日：挂载时加载一次 + 每 30s 轻量轮询（失败静默，不影响倒计时） */
  useEffect(() => {
    let stop = false
    async function load(): Promise<void> {
      try {
        const dateStr = new Date().toLocaleDateString('sv-SE')
        const [core, stats, settings, total, consec, weekStats] = await Promise.all([
          window.lanshan.getCoreSubjects(),
          window.lanshan.getDailyStats(dateStr),
          window.lanshan.getSettings(),
          window.lanshan.getTotalSecondsToday(dateStr),
          window.lanshan.getConsecutiveDays(),
          window.lanshan.getWeekStats(7),
        ])
        if (stop) return
        setToday({
          totalSeconds: total,
          consecutive: consec,
          subjects: core.map((s: string) => {
            const row = stats.find((r: { subject: string }) => r.subject === s)
            return {
              subject: s,
              seconds: row?.total_seconds || 0,
              target: parseInt(settings[`target_${s}`] || '7200', 10),
            }
          }),
        })
        setWeek((weekStats || []).map((w: WeekDay) => ({ date: w.date, total: w.total || 0 })))
      } catch { /* 数据失败静默降级 */ }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  // 专注完成：庆祝动画全屏展示
  const finished = state !== null && !state.active

  // 同步剩余秒到 ref（提醒轮询用）
  useEffect(() => {
    remainingRef.current = state?.remainingSec ?? 0
    wasActiveRef.current = state?.active ?? false
  }, [state])

  /** 完成庆祝粒子（一次性生成，刷新不重来） */
  const particles = useMemo(() => {
    const colors = ['#34d399', '#2dd4bf', '#fbbf24', '#f472b6', '#60a5fa', '#f8fafc']
    return Array.from({ length: 44 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 6 + Math.random() * 8,
      color: colors[i % colors.length],
      delay: Math.random() * 1.2,
      duration: 2.6 + Math.random() * 2.4,
      rotate: Math.random() * 360,
    }))
  }, [])

  // ── 环境音：类型变化时播放/停止，音量实时生效 ──
  useEffect(() => {
    if (noiseKind === 'off') {
      getEngine().stop()
    } else {
      getEngine().play(noiseKind, noiseVol / 100)
    }
    // 卸载时停止
    return () => { if (noiseKind !== 'off') getEngine().stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noiseKind])

  useEffect(() => {
    getEngine().setVolume(noiseVol / 100)
  }, [noiseVol])

  // ── 休息提醒：专注中每 remindMin 分钟弹气泡 + 提示音 ──
  useEffect(() => {
    if (!state?.active || remindMin <= 0) return
    const t = setInterval(() => {
      const total = state.durationMin * 60
      const elapsedMin = Math.max(0, Math.floor((total - remainingRef.current) / 60))
      if (elapsedMin > 0 && elapsedMin % remindMin === 0 && elapsedMin !== lastRemindRef.current) {
        lastRemindRef.current = elapsedMin
        const idx = Math.floor(elapsedMin / remindMin - 1) % REMIND_TEXTS.length
        setRemindShow({ id: Date.now(), text: REMIND_TEXTS[idx] })
        if (sfxOn) getEngine().playToneSeq([[880, 0.08], [660, 0.12]])
      }
    }, 5000)
    return () => clearInterval(t)
  }, [state?.active, remindMin, sfxOn, state?.durationMin])

  // 提醒气泡 5 秒后自动消失
  useEffect(() => {
    if (!remindShow) return
    const t = setTimeout(() => setRemindShow(null), 5000)
    return () => clearTimeout(t)
  }, [remindShow])

  // ── 专注完成：播放完成音效（从 active→finished 的瞬间） ──
  useEffect(() => {
    if (finished && wasActiveRef.current && sfxOn) {
      getEngine().playToneSeq([[523.25, 0.16], [659.25, 0.16], [783.99, 0.32]])
    }
  }, [finished, sfxOn])

  // ── 激励语录：每 3 分钟轮换一句 ──
  useEffect(() => {
    if (!quoteOn) return
    const t = setInterval(() => setQuoteIdx(i => (i + 1) % QUOTES.length), 3 * 60_000)
    return () => clearInterval(t)
  }, [quoteOn])

  // ── 倒计时整分钟：环辉光脉冲 ──
  useEffect(() => {
    const r = state?.remainingSec ?? 0
    if (state?.active && r > 0 && r % 60 === 0) setMinPulse(p => p + 1)
  }, [state?.remainingSec, state?.active])

  function tileLabel(a: FocusApp): string {
    // 优先显示窗口名（锁窗口时记录的标题）；没有窗口标题才显示进程名
    if (a.title === '澜山') return '澜山'
    if (a.title) return a.title
    return a.name.replace(/\.exe$/i, '')
  }

  async function launch(a: FocusApp): Promise<void> {
    // 按「进程名 + 关键词」精确跳转到对应窗口（避免切到不匹配窗口被盖回）
    setTilePulse(focusEntryKey(a))
    setTimeout(() => setTilePulse(null), 500)
    await window.lanshan.launchFocusApp(a.name, a.titleMatch)
  }

  /** 杀死软件的后台进程（强制结束后台，需确认） */
  async function killApp(a: FocusApp): Promise<void> {
    if (!confirm(`确定杀死 ${tileLabel(a)} 的进程吗？未保存的数据（如网盘传输）会丢失。`)) return
    await window.lanshan.killFocusApp(a.name)
  }

  /** 强制重启软件（先杀进程再重新启动，需确认） */
  async function restartApp(a: FocusApp): Promise<void> {
    if (!confirm(`确定强制重启 ${tileLabel(a)} 吗？将先结束其进程，再重新启动。`)) return
    await window.lanshan.restartFocusApp(a.name, a.titleMatch)
  }

  /** 更新白名单：同步主进程 + 本地状态 + 新条目预取图标 */
  function updateWhitelist(next: FocusApp[]): void {
    window.lanshan.setFocusWhitelist(next)
    setState(prev => prev ? { ...prev, whitelist: next } : prev)
    for (const a of next) {
      if (a.path || ['electron', 'electron.exe', '澜山.exe'].includes(a.name.toLowerCase())) {
        window.lanshan.getAppIcon(a.name, a.path || '').then((url) => {
          if (url) setIcons(prev => ({ ...prev, [a.name.toLowerCase()]: url }))
        })
      }
    }
  }

  /** 隐藏条目（图标悬停 ✕）：专注桌面不显示，白名单锁定规则保留，可"显示回来" */
  function hideEntry(a: FocusApp): void {
    const key = focusEntryKey(a)
    const next = [...hiddenKeys, key]
    setHiddenKeys(new Set(next))
    window.lanshan.setFocusHidden(next)
  }

  /** 显示回来：把条目从隐藏列表移除（白名单从未动过） */
  function showEntry(a: FocusApp): void {
    const key = focusEntryKey(a)
    const next = [...hiddenKeys].filter(k => k !== key)
    setHiddenKeys(new Set(next))
    window.lanshan.setFocusHidden(next)
  }

  /** 拖拽排序：开始拖 */
  function startDrag(e: React.DragEvent, key: string): void {
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
    setDragKey(key)
  }

  /** 拖拽排序：放到目标条目上 → 移动到目标位置并持久化 */
  function dropOn(targetKey: string, e: React.DragEvent): void {
    e.preventDefault()
    const src = dragKey
    if (!src || src === targetKey) { setDragKey(null); setDragOverKey(null); return }
    const keys = orderedWhitelist.map(focusEntryKey).filter(k => k !== src)
    const idx = keys.indexOf(targetKey)
    keys.splice(idx, 0, src)
    setOrderKeys(keys)
    window.lanshan.setFocusOrder(keys)
    setDragKey(null)
    setDragOverKey(null)
  }

  /** 拖拽结束 */
  function endDrag(): void {
    setDragKey(null)
    setDragOverKey(null)
  }

  /** 选择氛围色（诗词/扫描光带） */
  function pickColor(c: string): void {
    setPoemColor(c)
    window.lanshan.setFocusColor(c)
    setColorOpen(false)
  }

  async function endFocus(): Promise<void> {
    // 严格模式学习时段内锁定：禁止提前结束（时段结束自动解锁）
    if (scheduleLocked) {
      setError('🔒 严格模式学习时段内不可结束，时段结束自动解锁')
      return
    }
    // 点右下角直接结束，不再弹确认（用户要求；误触可用 Esc/Ctrl+Shift+F10 兜底）
    try {
      await window.lanshan.stopFocus()
    } catch (e) {
      setError('结束专注失败：' + String(e) + '（可按 Ctrl+Shift+F10）')
    }
  }

  async function quitApp(): Promise<void> {
    // 严格模式学习时段内锁定：禁止退出应用（退出会绕过专注锁定）
    if (scheduleLocked) {
      setError('🔒 严格模式学习时段内不可退出应用，时段结束自动解锁')
      return
    }
    try {
      await window.lanshan.quitApp()
    } catch (e) {
      setError('退出应用失败：' + String(e) + '（可按 Ctrl+Shift+F10）')
    }
  }

  /** 环境音开关（顶部栏快捷按钮） */
  function toggleNoise(): void {
    const next: NoiseKind = noiseKind === 'off' ? 'rain' : 'off'
    setNoiseKind(next)
    window.lanshan.setSetting('focus_noise', next)
  }

  function pickNoise(kind: Exclude<NoiseKind, 'off'>): void {
    setNoiseKind(kind)
    window.lanshan.setSetting('focus_noise', kind)
  }

  function pickRemind(min: number): void {
    setRemindMin(min)
    lastRemindRef.current = 0
    window.lanshan.setSetting('focus_remind_min', min)
  }

  const dateText = new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const timeText = new Date(now).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const whitelist = state?.whitelist || []
  // 隐藏的条目不显示（白名单锁定规则仍生效，可"显示回来"）
  const visibleWhitelist = whitelist.filter(a => !hiddenKeys.has(focusEntryKey(a)))
  const hiddenEntries = whitelist.filter(a => hiddenKeys.has(focusEntryKey(a)))
  // 按用户拖拽的自定义顺序排列
  const orderedWhitelist = sortWhitelistByOrder(visibleWhitelist, orderKeys)
  const elapsedMin = state ? Math.max(0, state.durationMin - Math.ceil((state.remainingSec || 0) / 60)) : 0
  // 精确到秒的进度（燃料条用）
  const totalSec = Math.max(1, (state?.durationMin ?? 0) * 60)
  const elapsedSec = Math.max(0, totalSec - (state?.remainingSec ?? 0))
  const progressPct = Math.min(1, elapsedSec / totalSec)

  return (
    <div
      className="fixed -top-[1px] inset-x-0 bottom-[-1px] z-[9999] flex flex-col overflow-hidden"
      style={{
        background: BG_THEMES[poemColor] || BG_THEMES['#ecfdf5'],
        color: '#ecfdf5',
        transition: 'background 0.6s ease',
      }}
    >
      {/* 动态背景：漂移光斑 + 科技网格 + 扫描线 + 暗角（颜色跟随主题） */}
      <div
        className="focus-blob -top-[12vw] -left-[8vw]"
        style={{ width: '46vw', height: '46vw', background: poemColor + '33', animation: 'focus-blob-1 26s ease-in-out infinite' }}
      />
      <div
        className="focus-blob -bottom-[10vw] -right-[6vw]"
        style={{ width: '38vw', height: '38vw', background: 'rgba(255,255,255,0.10)', animation: 'focus-blob-2 32s ease-in-out infinite' }}
      />
      <div
        className="focus-blob top-[38%] right-[20%]"
        style={{ width: '24vw', height: '24vw', background: 'rgba(255,255,255,0.05)', animation: 'focus-blob-3 22s ease-in-out infinite' }}
      />
      {/* 科技网格线 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* 全屏扫描线（HUD 动态感） */}
      <div className="scanline" />
      {/* 暗角 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)' }}
      />

      {/* 顶部栏：状态灯 + 系统名 + 时钟读数 + 控制入口 */}
      <header className="relative z-10 flex items-center justify-between px-10 pt-7 pb-4 select-none">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full focus-ping" style={{ background: '#34d399' }} />
          <span className="mono text-sm font-bold tracking-[0.28em]" style={{ color: 'rgba(236,253,245,0.92)' }}>
            澜山 · FOCUS
          </span>
          <span
            className="mono text-[10px] px-2 py-0.5 rounded border tracking-[0.2em] hidden sm:block"
            style={{ color: 'rgba(110,231,183,0.85)', borderColor: 'rgba(110,231,183,0.35)', background: 'rgba(52,211,153,0.08)' }}
          >
            专注中 · LIVE
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className="mono tabular-nums text-lg font-semibold"
              style={{ color: 'rgba(236,253,245,0.92)', textShadow: '0 0 18px rgba(52,211,153,0.35)' }}
            >
              {timeText}
            </span>
            <span className="text-xs" style={{ color: 'rgba(236,253,245,0.5)' }}>{dateText}</span>
          </div>
          <p className="hidden xl:block text-xs" style={{ color: 'rgba(236,253,245,0.45)' }}>
            ↕ 拖动图标可自定义顺序
          </p>
          {/* 环境音快捷开关 */}
          <button
            onClick={toggleNoise}
            className="relative w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all border"
            title={noiseKind === 'off' ? '开启环境音（雨声）' : '关闭环境音'}
            style={{
              borderColor: noiseKind === 'off' ? 'rgba(255,255,255,0.12)' : 'rgba(52,211,153,0.5)',
              background: noiseKind === 'off' ? 'transparent' : 'rgba(52,211,153,0.12)',
            }}
          >
            {noiseKind === 'off' ? '🔇' : '🔊'}
            {noiseKind !== 'off' && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full sound-ping" style={{ background: '#34d399' }} />
            )}
          </button>
          {/* 控制中心 */}
          <button
            onClick={() => setControlOpen(v => !v)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all border hover:bg-white/10"
            style={{
              borderColor: controlOpen ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.12)',
              background: controlOpen ? 'rgba(52,211,153,0.12)' : 'transparent',
            }}
            title="控制中心（环境音 / 提醒 / 音效）"
          >
            ⚙️
          </button>
          <button
            onClick={() => {
              const next = !bgOpen
              setBgOpen(next)
              if (next) refreshBgApps()
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all border hover:bg-white/10"
            style={{ borderColor: bgOpen ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.12)', background: bgOpen ? 'rgba(52,211,153,0.12)' : 'transparent' }}
            title="任务栏最小化的程序（点启动栏可直接弹回）"
          >
            🪟
          </button>
          <button
            onClick={() => setColorOpen(v => !v)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all border hover:bg-white/10"
            style={{ borderColor: 'rgba(255,255,255,0.12)' }}
            title="自定义背景颜色"
          >
            🎨
          </button>
        </div>
      </header>

      {/* 主体：左栏任务倒计时/今日战况 + 右栏软件启动器 */}
      {finished ? (
        <main className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-6 pb-12">
          <HudPanel label="MISSION COMPLETE · 任务完成" glow={glowOn} className="w-full max-w-xl">
            <div className="text-center">
              <div className="text-6xl mb-4" style={{ animation: 'focus-breathe 2.2s ease-in-out infinite' }}>🎉</div>
              <p className="mono text-xl font-bold tracking-widest">专注完成！</p>
              <p className="mt-2 text-sm" style={{ color: 'rgba(236,253,245,0.7)' }}>
                本次共专注 {state?.durationMin ?? 0} 分钟 · 保持这个节奏，继续加油
              </p>
              <div className="mt-8 text-left">
                <TodayBoard today={today} />
              </div>
            </div>
          </HudPanel>
        </main>
      ) : (
        <main className="relative z-10 flex-1 min-h-0 flex flex-col xl:flex-row gap-6 px-8 lg:px-10 pb-8 overflow-y-auto xl:overflow-hidden">
          {/* 左栏：任务倒计时 + 今日使用情况（3:4 宽高比，两面板平分高度，内容垂直居中） */}
          <div className="xl:w-[560px] shrink-0 flex flex-col gap-6 min-h-0 xl:overflow-y-auto hud-scroll xl:pr-1.5">
            <HudPanel label="TIMER · 任务倒计时" right={`TARGET ${state?.durationMin ?? 0} MIN`} glow={glowOn} className="flex-1 min-h-0 flex flex-col">
              <div className="h-full flex flex-col justify-center">
                <CountdownRing key={minPulse} remainingSec={state?.remainingSec ?? 0} durationMin={state?.durationMin ?? 0} pulse={minPulse > 0} />
                <FuelGauge pct={progressPct} elapsedMin={elapsedMin} totalMin={state?.durationMin ?? 0} appCount={whitelist.length} />
              </div>
            </HudPanel>
            {/* 今日使用情况：数字与科目固定、7日图弹性自适应（90~220px，比例真实不拉长） */}
            <HudPanel label="MISSION · 今日使用情况" right="30S 刷新" glow={glowOn} className="flex-1 min-h-0 flex flex-col">
              <div className="h-full flex flex-col justify-center gap-4">
                <div className="shrink-0">
                  <TodayStatsRow today={today} />
                </div>
                <div className="flex-1 min-h-0 flex flex-col justify-center">
                  <WeekBars week={week} />
                </div>
                <div className="shrink-0">
                  <SubjectProgress subjects={today?.subjects || []} />
                </div>
              </div>
            </HudPanel>
          </div>

          {/* 右栏：软件启动器（白名单图标，可拖拽排序） */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <HudPanel label="LAUNCHER · 软件启动器" right={`${whitelist.length} APPS`} glow={glowOn} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto hud-scroll pr-1.5">
                {orderedWhitelist.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-xs" style={{ color: 'rgba(236,253,245,0.4)' }}>
                      白名单为空（开始专注时会自动加入澜山）
                    </p>
                  </div>
                  ) : (
                    <div className="flex flex-wrap justify-start gap-4">
                    {orderedWhitelist.map(a => {
                      const key = focusEntryKey(a)
                      // 澜山自身不提供杀进程/重启（主进程也会拒绝）
                      const isSelf = ['electron', 'electron.exe', '澜山.exe'].includes(a.name.toLowerCase())
                      return (
                        <AppTile
                          key={key}
                          label={tileLabel(a)}
                          icon={icons[a.name.toLowerCase()]}
                          pulsing={tilePulse === key}
                          onLaunch={() => launch(a)}
                          onKill={isSelf ? undefined : () => killApp(a)}
                          onRestart={isSelf ? undefined : () => restartApp(a)}
                          onRemove={() => hideEntry(a)}
                          draggable
                          isDragging={dragKey === key}
                          isDragOver={dragOverKey === key}
                          onDragStart={(e) => startDrag(e, key)}
                          onDragOver={(e) => { e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key) }}
                          onDrop={(e) => dropOn(key, e)}
                          onDragEnd={endDrag}
                        />
                      )
                    })}
                  </div>
                )}
                {hiddenEntries.length > 0 && (
                  <div className="flex justify-center mt-5">
                    <button
                      onClick={() => setRestoreOpen(true)}
                      className="px-4 py-2 rounded-xl text-xs font-medium transition-all hover:bg-white/10"
                      style={{ color: 'rgba(236,253,245,0.7)' }}
                    >
                      ↩ 显示回来（{hiddenEntries.length}）
                    </button>
                  </div>
                )}
              </div>
            </HudPanel>
          </div>
        </main>
      )}

      {/* 激励语录（左下角，淡入轮换） */}
      {quoteOn && !finished && (
        <div key={quoteIdx} className="quote-fade absolute bottom-7 left-8 z-20 select-none max-w-md pointer-events-none">
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(236,253,245,0.5)' }}>
            ✦ {QUOTES[quoteIdx]}
          </p>
        </div>
      )}

      {/* 休息提醒气泡 */}
      {remindShow && (
        <div className="absolute inset-x-0 bottom-28 z-30 flex justify-center pointer-events-none">
          <div
            key={remindShow.id}
            className="remind-pop px-6 py-3.5 rounded-2xl"
            style={{
              background: 'rgba(4,18,14,0.94)',
              border: '1px solid rgba(52,211,153,0.4)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 24px rgba(52,211,153,0.12)',
            }}
          >
            <p className="text-sm font-medium" style={{ color: 'rgba(236,253,245,0.92)' }}>{remindShow.text}</p>
          </div>
        </div>
      )}

      {/* 背景颜色选择面板 */}
      {colorOpen && (
        <div
          className="fixed right-10 top-20 rounded-xl p-3.5 z-[100]"
          style={{
            background: 'rgba(4,18,14,0.92)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}
        >
          <HudCorners />
          <p className="mono text-[10px] tracking-[0.2em] mb-2.5 px-0.5" style={{ color: 'rgba(236,253,245,0.5)' }}>
            BG THEME · 背景色
          </p>
          <div className="flex gap-2">
            {POEM_COLORS.map(c => (
              <button
                key={c}
                onClick={() => pickColor(c)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                title={c}
                style={{
                  background: c,
                  boxShadow: c === poemColor
                    ? '0 0 0 2px rgba(255,255,255,0.9), 0 0 12px ' + c
                    : '0 2px 6px rgba(0,0,0,0.3)',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 任务栏最小化面板：最小化在任务栏的程序（手动刷新） */}
      {bgOpen && (
        <div
          className="fixed right-10 top-20 w-[300px] rounded-xl p-4 z-[100]"
          style={{
            background: 'rgba(4,18,14,0.94)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}
        >
          <HudCorners />
          <div className="flex items-center justify-between mb-2">
            <span className="mono text-[11px] font-semibold tracking-[0.2em]" style={{ color: 'rgba(110,231,183,0.9)' }}>
              🪟 任务栏最小化
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={refreshBgApps}
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all hover:bg-white/10"
                title="手动刷新"
                style={{ color: 'rgba(236,253,245,0.7)' }}
              >
                🔄
              </button>
              <button
                onClick={() => setBgOpen(false)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all hover:bg-white/10"
                style={{ color: 'rgba(236,253,245,0.6)' }}
              >
                ✕
              </button>
            </div>
          </div>
          <p className="mono text-[10px] leading-relaxed tracking-wider mb-3" style={{ color: 'rgba(236,253,245,0.45)' }}>
            这些程序最小化在任务栏，点启动栏图标可直接弹回。
          </p>
          <div className="space-y-1.5">
            {bgApps.length === 0 ? (
              <p className="text-xs py-2 text-center" style={{ color: 'rgba(236,253,245,0.45)' }}>
                ✓ 没有最小化的程序
              </p>
            ) : bgApps.map(a => (
              <div
                key={focusEntryKey(a)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                <span className="text-base">🗕</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate" style={{ color: 'rgba(236,253,245,0.9)' }}>{tileLabel(a)}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mono text-[10px] leading-relaxed tracking-wider mt-3" style={{ color: 'rgba(110,231,183,0.55)' }}>
            💡 关闭程序请用「最小化」；点了 ✕ 的程序点启动栏会自动重启
          </p>
        </div>
      )}

      {/* 控制中心：环境音 / 休息提醒 / 音效 / 语录 */}
      {controlOpen && (
        <div
          className="fixed right-10 top-20 w-[300px] rounded-xl p-4 z-[100]"
          style={{
            background: 'rgba(4,18,14,0.94)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}
        >
          <HudCorners />
          <div className="flex items-center justify-between mb-3">
            <span className="mono text-[11px] font-semibold tracking-[0.2em]" style={{ color: 'rgba(110,231,183,0.9)' }}>
              CONTROL · 控制中心
            </span>
            <button
              onClick={() => setControlOpen(false)}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all hover:bg-white/10"
              style={{ color: 'rgba(236,253,245,0.6)' }}
            >
              ✕
            </button>
          </div>

          {/* 环境音 */}
          <p className="mono text-[10px] tracking-[0.18em] mb-2" style={{ color: 'rgba(236,253,245,0.45)' }}>
            🎵 环境音 AMBIENCE
          </p>
          <div className="flex gap-1.5 mb-3">
            {NOISE_OPTIONS.map(o => (
              <button key={o.kind} onClick={() => pickNoise(o.kind)} className={`cyber-seg ${noiseKind === o.kind ? 'on' : ''}`}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5 mb-4">
            {/* 播放中的均衡器跳动 */}
            <div className="flex items-end gap-[3px] h-4" style={{ opacity: noiseKind === 'off' ? 0.25 : 1 }}>
              <span className="eq-bar h-full" style={{ animationDelay: '0s' }} />
              <span className="eq-bar h-full" style={{ animationDelay: '0.2s' }} />
              <span className="eq-bar h-full" style={{ animationDelay: '0.4s' }} />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={noiseVol}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                setNoiseVol(v)
                window.lanshan.setSetting('focus_noise_vol', v)
              }}
              className="cyber-slider flex-1"
              title="音量"
            />
            <span className="mono text-[10px] tabular-nums w-8 text-right" style={{ color: 'rgba(236,253,245,0.5)' }}>
              {noiseVol}%
            </span>
          </div>

          {/* 休息提醒 */}
          <p className="mono text-[10px] tracking-[0.18em] mb-2" style={{ color: 'rgba(236,253,245,0.45)' }}>
            💧 休息提醒 REMIND
          </p>
          <div className="flex gap-1.5 mb-4">
            {REMIND_OPTIONS.map(m => (
              <button key={m} onClick={() => pickRemind(m)} className={`cyber-seg ${remindMin === m ? 'on' : ''}`}>
                {m === 0 ? '关闭' : `${m} 分`}
              </button>
            ))}
          </div>

          {/* 音效 / 语录 / 光效开关 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'rgba(236,253,245,0.75)' }}>🖱 鼠标光效</span>
              <button
                onClick={() => {
                  // 副作用不能写在 setState updater 里（React 19 下可能被重放多次）：
                  // 先算好新值，再更新状态 + 持久化
                  const next = !glowOn
                  setGlowOn(next)
                  window.lanshan.setSetting('focus_glow', next ? 1 : 0)
                }}
                className={`cyber-toggle ${glowOn ? 'on' : ''}`}
                title="面板上跟随鼠标的光晕"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'rgba(236,253,245,0.75)' }}>🔔 提示音效</span>
              <button
                onClick={() => {
                  const next = !sfxOn
                  setSfxOn(next)
                  window.lanshan.setSetting('focus_sfx', next ? 1 : 0)
                }}
                className={`cyber-toggle ${sfxOn ? 'on' : ''}`}
                title="提醒/完成提示音"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'rgba(236,253,245,0.75)' }}>✨ 激励语录</span>
              <button
                onClick={() => {
                  const next = !quoteOn
                  setQuoteOn(next)
                  window.lanshan.setSetting('focus_quote', next ? 1 : 0)
                }}
                className={`cyber-toggle ${quoteOn ? 'on' : ''}`}
                title="左下角语录轮换"
              />
            </div>
          </div>
        </div>
      )}

      {/* 右下角悬浮操作按钮（无底部栏，界面更通透） */}
      {error && (
        <div className="absolute bottom-16 right-8 z-20 text-xs select-none" style={{ color: '#fca5a5' }}>
          ⚠ {error}
        </div>
      )}
      <div className="absolute bottom-7 right-8 z-20 flex items-center gap-3 select-none">
        <button
          onClick={quitApp}
          disabled={scheduleLocked}
          className="px-4 py-2 rounded-xl text-xs font-medium transition-all border"
          style={scheduleLocked
            ? { borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)', cursor: 'not-allowed' }
            : { borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(236,253,245,0.75)' }}
        >
          {scheduleLocked ? '🔒 已锁定' : '退出应用'}
        </button>
        <button
          onClick={endFocus}
          disabled={scheduleLocked}
          className="px-6 py-2.5 rounded-xl text-xs font-bold tracking-wider transition-all"
          style={scheduleLocked
            ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)', cursor: 'not-allowed' }
            : { background: 'linear-gradient(135deg, #f87171, #dc2626)', color: 'white', boxShadow: '0 4px 20px rgba(239,68,68,0.4)' }}
        >
          {scheduleLocked ? '🔒 时段内锁定' : '⏹ 结束专注'}
        </button>
      </div>

      {/* 显示回来面板：隐藏的软件可恢复显示 */}
      {restoreOpen && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setRestoreOpen(false)}
        >
          <div
            className="relative rounded-2xl w-[420px] max-h-[70vh] overflow-y-auto hud-scroll p-5"
            style={{
              background: 'rgba(4,18,14,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <HudCorners />
            <div className="flex items-center justify-between mb-1">
              <span className="mono text-sm font-semibold tracking-[0.15em]" style={{ color: 'rgba(236,253,245,0.9)' }}>
                RESTORE · 显示回来
              </span>
              <button
                onClick={() => setRestoreOpen(false)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all hover:bg-white/10"
                style={{ color: 'rgba(236,253,245,0.6)' }}
              >
                ✕
              </button>
            </div>
            <p className="mono text-[10px] tracking-wider mb-3" style={{ color: 'rgba(236,253,245,0.45)' }}>
              被隐藏的软件（白名单锁定规则一直保留），点选即可重新显示
            </p>
            <div className="space-y-1.5">
              {hiddenEntries.map(a => (
                <button
                  key={focusEntryKey(a)}
                  onClick={() => { showEntry(a); setRestoreOpen(false) }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all hover:bg-white/10"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                >
                  <span className="text-base">{a.titleMatch ? '🔒' : '📱'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'rgba(236,253,245,0.9)' }}>{tileLabel(a)}</p>
                  </div>
                  <span className="mono text-xs flex-shrink-0" style={{ color: '#34d399' }}>显示</span>
                </button>
              ))}
              {hiddenEntries.length === 0 && (
                <p className="text-xs py-4 text-center" style={{ color: 'rgba(236,253,245,0.45)' }}>没有隐藏的软件</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 完成庆祝粒子 */}
      {finished && (
        <div className="absolute inset-0 pointer-events-none z-20">
          {particles.map(p => (
            <span
              key={p.id}
              className="focus-particle"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                transform: `rotate(${p.rotate}deg)`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 环形倒计时：外圈刻度 + 渐变描边 + 发光，进度 = 已过时长/总时长，每秒平滑推进。
 *  pulse：整分钟时以正方形环容器为中心做正圆辉光扩散 */
function CountdownRing({ remainingSec, durationMin, pulse }: { remainingSec: number; durationMin: number; pulse?: boolean }): React.ReactElement {
  const total = Math.max(1, durationMin * 60)
  const elapsed = Math.max(0, total - remainingSec)
  const pct = Math.min(1, elapsed / total)
  const R = 126
  const C = 2 * Math.PI * R
  return (
    <div
      className={'relative mx-auto' + (pulse ? ' ring-pulse' : '')}
      style={{ width: 'clamp(290px, 14vw, 380px)', height: 'clamp(290px, 14vw, 380px)' }}
    >
      <svg width="100%" height="100%" viewBox="0 0 300 300" className="-rotate-90">
        <defs>
          <linearGradient id="focusRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        {/* 外圈 60 格刻度（整 5 分钟为长刻度） */}
        {Array.from({ length: 60 }, (_, i) => (
          <line
            key={i}
            x1="150"
            y1="10"
            x2="150"
            y2={i % 5 === 0 ? 24 : 18}
            stroke={i % 5 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)'}
            strokeWidth={i % 5 === 0 ? 2 : 1}
            transform={`rotate(${i * 6} 150 150)`}
          />
        ))}
        <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
        {/* 内圈装饰细环 */}
        <circle cx="150" cy="150" r="104" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 8" />
        <circle
          cx="150" cy="150" r={R}
          fill="none"
          stroke="url(#focusRingGrad)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 1s linear', filter: 'drop-shadow(0 0 10px rgba(52,211,153,0.55))' }}
        />
      </svg>
      {/* 中心：REMAINING 读数 + 大倒计时 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[10px] tracking-[0.3em] mb-1" style={{ color: 'rgba(236,253,245,0.45)' }}>
          REMAINING · 剩余
        </span>
        <div
          className="focus-breathe mono tabular-nums font-bold tracking-tight"
          style={{
            fontSize: 'clamp(3.4rem, 3vw, 4.8rem)',
            lineHeight: 1.05,
            background: 'linear-gradient(180deg, #f0fdfa 25%, #6ee7b7 95%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 26px rgba(52,211,153,0.4))',
          }}
        >
          {formatCountdown(remainingSec)}
        </div>
        <span className="text-xs mt-2" style={{ color: 'rgba(236,253,245,0.55)' }}>
          点击图标使用软件
        </span>
      </div>
    </div>
  )
}

/** 已专注进度燃料条：分段点亮 + 数据芯片 */
function FuelGauge({ pct, elapsedMin, totalMin, appCount }: {
  pct: number
  elapsedMin: number
  totalMin: number
  appCount: number
}): React.ReactElement {
  const lit = Math.round(pct * GAUGE_SEGMENTS)
  return (
    <div className="mt-6 select-none">
      <div className="flex items-center justify-between mb-2">
        <span className="mono text-[10px] tracking-[0.2em]" style={{ color: 'rgba(236,253,245,0.45)' }}>
          FOCUS ELAPSED · 已专注
        </span>
        <span className="mono text-[11px] tabular-nums" style={{ color: 'rgba(236,253,245,0.75)' }}>
          {elapsedMin}<span className="opacity-40 mx-0.5">/</span>{totalMin} MIN
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: GAUGE_SEGMENTS }, (_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-all duration-700"
            style={i < lit
              ? { background: 'linear-gradient(90deg, #10b981, #34d399)', boxShadow: '0 0 6px rgba(52,211,153,0.5)' }
              : { background: 'rgba(255,255,255,0.08)' }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="mono text-[10px] px-2 py-0.5 rounded-md tracking-wider" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(236,253,245,0.6)' }}>
          ⚡ 白名单 {appCount} 个软件
        </span>
        <span className="mono text-[10px] px-2 py-0.5 rounded-md tracking-wider" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(236,253,245,0.6)' }}>
          🎯 目标 {totalMin} 分钟
        </span>
      </div>
    </div>
  )
}

/** 今日使用情况数字读数（今日使用 + 连续打卡） */
function TodayStatsRow({ today }: { today: TodayStats | null }): React.ReactElement {
  if (!today) return <div className="h-16" />
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="mono text-[10px] tracking-[0.18em]" style={{ color: 'rgba(236,253,245,0.45)' }}>📖 今日使用</p>
        <p
          className="mono tabular-nums text-4xl font-bold mt-1.5"
          style={{ color: 'rgba(236,253,245,0.95)', textShadow: '0 0 16px rgba(52,211,153,0.3)' }}
        >
          {formatDuration(today.totalSeconds)}
        </p>
      </div>
      <div>
        <p className="mono text-[10px] tracking-[0.18em]" style={{ color: 'rgba(236,253,245,0.45)' }}>🔥 连续打卡</p>
        <p
          className="mono tabular-nums text-4xl font-bold mt-1.5"
          style={{ color: 'rgba(236,253,245,0.95)', textShadow: '0 0 16px rgba(251,191,36,0.25)' }}
        >
          {today.consecutive}
          <span className="text-xl font-semibold ml-1.5" style={{ color: 'rgba(236,253,245,0.6)' }}>天</span>
        </p>
      </div>
    </div>
  )
}

/** 科目目标进度条 */
function SubjectProgress({ subjects }: { subjects: TodayStats['subjects'] }): React.ReactElement {
  return (
    <div className="space-y-3.5">
      {subjects.map(s => {
        const pct = s.target > 0 ? Math.min(100, (s.seconds / s.target) * 100) : 0
        const done = s.seconds >= s.target
        const color = getSubjectColor(s.subject)
        return (
          <div key={s.subject}>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="flex items-center min-w-0" style={{ color: 'rgba(236,253,245,0.85)' }}>
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0"
                  style={{ background: color + '26' }}
                >
                  {getSubjectIcon(s.subject)}
                </span>
                <span className="truncate">{s.subject} {done && <span style={{ color: '#34d399' }}>✓</span>}</span>
              </span>
              <span className="mono tabular-nums flex-shrink-0 ml-2 text-xs" style={{ color: 'rgba(236,253,245,0.5)' }}>
                {formatDuration(s.seconds)}
                <span className="ml-2 font-semibold" style={{ color: done ? '#34d399' : color }}>
                  {Math.round(pct)}%
                </span>
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  background: done
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : `linear-gradient(90deg, ${color}bb, ${color})`,
                  boxShadow: `0 0 10px ${done ? 'rgba(52,211,153,0.6)' : color + '55'}`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 今日战况组合（完成态面板用） */
function TodayBoard({ today }: { today: TodayStats | null }): React.ReactElement {
  if (!today) {
    // 数据未加载时的占位（透明，不闪跳）
    return <div className="h-40" />
  }
  return (
    <div>
      <TodayStatsRow today={today} />
      <div className="h-px my-3.5" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <SubjectProgress subjects={today.subjects} />
    </div>
  )
}

/** 近 7 日专注迷你柱状图（周一 → 周日，今天高亮发光）。
 *  柱区高度自适应（90~220px，随面板高度伸缩但封顶），柱子按真实比例缩放 */
function WeekBars({ week }: { week: WeekDay[] | null }): React.ReactElement {
  if (!week || week.length === 0) return null
  const max = Math.max(...week.map(d => d.total), 1)
  const todayIdx = (new Date().getDay() + 6) % 7 // 周一=0
  const labels = ['一', '二', '三', '四', '五', '六', '日']
  return (
    <div className="w-full flex-1 min-h-0 flex flex-col justify-center">
      <p className="mono text-[10px] tracking-[0.18em] mb-2" style={{ color: 'rgba(236,253,245,0.45)' }}>
        📊 近 7 日专注 WEEK.FOCUS
      </p>
      <div className="flex items-end gap-1.5 flex-1 min-h-[90px] max-h-[220px]">
        {week.map((d, i) => {
          const isToday = i === todayIdx
          // 百分比基于柱区实际高度，留出底部标签空间，比例真实
          const pct = Math.max(5, Math.min(88, Math.round((d.total / max) * 100)))
          return (
            <div key={d.date} className="flex-1 h-full flex flex-col justify-end items-center gap-1 min-w-0" title={`${d.date} · ${formatDuration(d.total)}`}>
              <div
                className="week-bar w-full rounded-t-md"
                style={{
                  height: `${pct}%`,
                  background: isToday
                    ? 'linear-gradient(180deg, #6ee7b7, #10b981)'
                    : 'linear-gradient(180deg, rgba(110,231,183,0.4), rgba(110,231,183,0.15))',
                  boxShadow: isToday ? '0 0 12px rgba(52,211,153,0.55)' : undefined,
                }}
              />
              <span className="mono text-[9px] leading-none" style={{ color: isToday ? 'rgba(110,231,183,0.95)' : 'rgba(236,253,245,0.35)' }}>
                {labels[i]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 科技风软件图标卡片：正方形方框 + 顶部亮线 + hover 上浮发光 + 点击涟漪（正圆）+ 悬停删除 + 拖拽排序。
 *  右键图标弹出操作菜单：🔄 强制重启 / ⏹ 删除后台（澜山自身不显示） */
function AppTile({ label, icon, pulsing, onLaunch, onKill, onRestart, onRemove, draggable, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }: {
  label: string
  icon?: string
  pulsing?: boolean
  onLaunch: () => void
  onKill?: () => void
  onRestart?: () => void
  onRemove: () => void
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const hasOps = !!(onKill || onRestart)
  return (
    <div className="relative group">
      <button
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={onLaunch}
        onContextMenu={(e) => {
          e.preventDefault()
          if (hasOps) setMenuOpen(v => !v)
        }}
        title={label}
        className="relative w-[clamp(112px,6vw,168px)] h-[clamp(112px,6vw,168px)] flex flex-col items-center justify-center gap-1.5 rounded-xl select-none transition-all duration-200 hover:-translate-y-1.5 hover:bg-white/10 hover:shadow-[0_10px_32px_rgba(16,185,129,0.28)] active:scale-95"
        style={{
          border: '1px solid rgba(255,255,255,0.10)',
          background: isDragOver ? 'rgba(52,211,153,0.16)' : 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(10px)',
          boxShadow: isDragOver ? '0 0 0 2px rgba(52,211,153,0.6), 0 8px 24px rgba(0,0,0,0.25)' : undefined,
          opacity: isDragging ? 0.45 : 1,
          cursor: draggable ? 'grab' : 'pointer',
        }}
      >
        {/* 顶部装饰亮线 */}
        <span
          className="absolute top-0 left-4 right-4 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(110,231,183,0.45), transparent)' }}
        />
        {/* 点击涟漪（正圆） */}
        {pulsing && <span className="tile-ripple" />}
        {icon ? (
          <img
            src={icon}
            alt={label}
            draggable={false}
            className="w-[clamp(56px,3vw,84px)] h-[clamp(56px,3vw,84px)] rounded-lg"
            style={{ animation: 'focus-breathe 4s ease-in-out infinite', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}
          />
        ) : (
          <div
            className="w-[clamp(56px,3vw,84px)] h-[clamp(56px,3vw,84px)] rounded-lg flex items-center justify-center text-[clamp(20px,1.1vw,30px)] font-semibold"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {label === '澜山' ? '🍃' : label.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="mono text-[clamp(10px,0.5vw,13px)] max-w-[clamp(96px,5.2vw,144px)] truncate px-1" title={label} style={{ color: 'rgba(236,253,245,0.9)' }}>
          {label}
        </span>
      </button>
      {/* 右键菜单：强制重启 / 删除后台 */}
      {menuOpen && (
        <>
          {/* 点击空白处关闭菜单 */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            onContextMenu={(e) => { e.preventDefault(); setMenuOpen(false) }}
          />
          <div
            className="absolute right-0 top-full mt-2 z-50 rounded-xl overflow-hidden min-w-[150px]"
            style={{
              background: 'rgba(4,18,14,0.96)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(14px)',
            }}
          >
            {onRestart && (
              <button
                onClick={() => { setMenuOpen(false); onRestart() }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-left transition-colors hover:bg-white/10"
                style={{ color: 'rgba(236,253,245,0.9)' }}
              >
                <span className="text-sm">🔄</span>
                <span className="flex-1">强制重启</span>
              </button>
            )}
            {onKill && (
              <button
                onClick={() => { setMenuOpen(false); onKill() }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-left transition-colors hover:bg-white/10"
                style={{ color: '#fca5a5' }}
              >
                <span className="text-sm">⏹</span>
                <span className="flex-1">删除后台</span>
              </button>
            )}
          </div>
        </>
      )}
      {/* 悬停显示删除按钮 */}
      <button
        onClick={onRemove}
        title="隐藏（专注桌面不显示，白名单保留，可显示回来）"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(239,68,68,0.9)', color: 'white', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}
      >
        ✕
      </button>
    </div>
  )
}
