/**
 * 刻章系统（v5）
 * =============
 * 统一命名：勋章 → 刻章（印章/收藏格/盖印仪式感）
 *
 * 两类刻章：
 *  - 累积刻章（16 枚）：只看「截至当日」的累计数据，解锁一次永久在册、永久可佩戴
 *  - 每日刻章（22 枚）：全部是当天事件——当天时间/数据符合条件即获得、仅当天可佩戴，
 *    跨天从佩戴格消失；每一天的获得记录写入 daily_seal_records，可像时间轴一样任意回放
 *
 * 判定口径：
 *  - 累积侧支持「截至日期」参数（回放任意历史日时显示当时进度）
 *  - 每日侧对过去日期用该日数据确定性重算（与 rebuildDailyStats 同模式）
 *  - 今天只增不减（防止数据回退把当天已获得的刻章抹掉）
 */

import {
  getDb,
  getDailyStats,
  getMergedSegments,
  save,
  Subject,
} from './database'

export type SealType = 'cumulative' | 'daily'

export interface SealDef {
  id: string
  type: SealType
  group: string
  name: string
  icon: string
  desc: string
  congrats: string
  /** 进度展示单位（累积刻章用：小时阈值 / 天数阈值） */
  unit?: 'hours' | 'days'
}

interface CumulativeDef extends SealDef {
  type: 'cumulative'
  metric: 'totalHours' | 'subjectHours' | 'streakDays' | 'tripleStreakDays'
  subject?: Subject
  threshold: number
}

interface DailyDef extends SealDef {
  type: 'daily'
  metric:
    | 'dayCoreHours'    // 当天核心三科总时长 ≥ threshold 秒
    | 'daySubjectHours' // 当天某科时长 ≥ threshold 秒
    | 'daySubjectExceeded' // 当天某科超额（daily_stats.exceeded）
    | 'balanced'        // 三科全部达标且均未超额
    | 'tripleOver'      // 三科全部超额
    | 'dawnDusk'        // 当天晨行(开始<7:30) + 夜航(结束>21:50)
    | 'morning'         // 当天开始学习（本地时间）< threshold 分钟
    | 'night'           // 当天结束学习（本地时间）> threshold 分钟
    | 'focusSegment'    // 当天最长连续专注段 ≥ threshold 秒
    | 'comeback'        // 前一天 < 1h 且当天核心三科 ≥ threshold 秒
  subject?: Subject
  threshold: number
}

export interface CumulativeSealState {
  id: string
  unlocked: boolean
  unlocked_at: string | null
  progress: number
  progress_max: number
}

export interface DailySealStatus {
  id: string
  earned: boolean
  hint: string
}

export interface SealSlot {
  slot: number
  seal_id: string
  date: string | null
}

export interface SealsOverview {
  cumulative: CumulativeSealState[]
  daily: DailySealStatus[]
  slots: SealSlot[]
  /** 历史上获得过的每日刻章 id（去重，用于"已集"统计） */
  dailyEverIds: string[]
}

// ============================================================
// 刻章定义（唯一数据源，渲染进程通过 IPC 获取）
// ============================================================

const CORE: Subject[] = ['物理', '数学', '英语']
const HOUR = 3600

/** 晨行/夜航基准档（朝暮行同此口径） */
const BASE_MORNING_MIN = 7 * 60 + 30   // 7:30
const BASE_NIGHT_MIN = 21 * 60 + 50    // 21:50

export const CUMULATIVE_DEFS: CumulativeDef[] = [
  // ── 累计学习（山上的树：破土 → 抽枝 → 成木）
  { id: 'total-30h', type: 'cumulative', group: '累计学习', name: '破土', icon: '🌱', metric: 'totalHours', threshold: 30 * HOUR,
    unit: 'hours',
    desc: '累计学习 30 小时', congrats: '种子破土而出，澜山之旅开始了 🌱' },
  { id: 'total-100h', type: 'cumulative', group: '累计学习', name: '抽枝', icon: '🌿', metric: 'totalHours', threshold: 100 * HOUR,
    unit: 'hours',
    desc: '累计学习 100 小时', congrats: '枝叶渐繁，你已经走了很远 🌿' },
  { id: 'total-250h', type: 'cumulative', group: '累计学习', name: '成木', icon: '🌲', metric: 'totalHours', threshold: 250 * HOUR,
    unit: 'hours',
    desc: '累计学习 250 小时', congrats: '一棵树，稳稳立在澜山之上 🌲' },

  // ── 连续打卡（解锁一次永久；进度显示当前连续天数，会回落但已解锁不消失）
  { id: 'streak-3', type: 'cumulative', group: '连续打卡', name: '三日火', icon: '🔥', metric: 'streakDays', threshold: 3,
    unit: 'days',
    desc: '连续打卡 3 天', congrats: '火种已燃，保持住 🔥' },
  { id: 'streak-7', type: 'cumulative', group: '连续打卡', name: '七日焰', icon: '💎', metric: 'streakDays', threshold: 7,
    unit: 'days',
    desc: '连续打卡 7 天', congrats: '一周不灭，这团火很稳 💎' },
  { id: 'streak-14', type: 'cumulative', group: '连续打卡', name: '双周燃', icon: '⚡', metric: 'streakDays', threshold: 14,
    unit: 'days',
    desc: '连续打卡 14 天', congrats: '十四天，铁打的纪律 ⚡' },

  // ── 物理（初涉 → 半程 → 凌顶，登山意象）
  { id: 'phy-20', type: 'cumulative', group: '物理', name: '物理·初涉', icon: '🔋', metric: 'subjectHours', subject: '物理', threshold: 20 * HOUR,
    unit: 'hours',
    desc: '物理累计 20 小时', congrats: '物理入门，手感来了 ⚡' },
  { id: 'phy-60', type: 'cumulative', group: '物理', name: '物理·半程', icon: '⚡', metric: 'subjectHours', subject: '物理', threshold: 60 * HOUR,
    unit: 'hours',
    desc: '物理累计 60 小时', congrats: '物理上道了，夏梦迪看了都说好 ⚡' },
  { id: 'phy-100', type: 'cumulative', group: '物理', name: '物理·凌顶', icon: '⚛️', metric: 'subjectHours', subject: '物理', threshold: 100 * HOUR,
    unit: 'hours',
    desc: '物理累计 100 小时', congrats: '物理差点被你学完了 ⚛️' },

  // ── 数学
  { id: 'math-15', type: 'cumulative', group: '数学', name: '数学·初涉', icon: '🔢', metric: 'subjectHours', subject: '数学', threshold: 15 * HOUR,
    unit: 'hours',
    desc: '数学累计 15 小时', congrats: '数学起步，小火车的节奏 🔢' },
  { id: 'math-50', type: 'cumulative', group: '数学', name: '数学·半程', icon: '📊', metric: 'subjectHours', subject: '数学', threshold: 50 * HOUR,
    unit: 'hours',
    desc: '数学累计 50 小时', congrats: '数学过半，渐入佳境 📊' },
  { id: 'math-85', type: 'cumulative', group: '数学', name: '数学·凌顶', icon: '🧮', metric: 'subjectHours', subject: '数学', threshold: 85 * HOUR,
    unit: 'hours',
    desc: '数学累计 85 小时', congrats: '数学硬骨头啃下来了 🧮' },

  // ── 英语
  { id: 'eng-20', type: 'cumulative', group: '英语', name: '英语·初涉', icon: '🔤', metric: 'subjectHours', subject: '英语', threshold: 20 * HOUR,
    unit: 'hours',
    desc: '英语累计 20 小时', congrats: '英语开张，陶然陪你 🔤' },
  { id: 'eng-70', type: 'cumulative', group: '英语', name: '英语·半程', icon: '📝', metric: 'subjectHours', subject: '英语', threshold: 70 * HOUR,
    unit: 'hours',
    desc: '英语累计 70 小时', congrats: '英语词汇开始有感觉了 📝' },
  { id: 'eng-120', type: 'cumulative', group: '英语', name: '英语·凌顶', icon: '🌐', metric: 'subjectHours', subject: '英语', threshold: 120 * HOUR,
    unit: 'hours',
    desc: '英语累计 120 小时', congrats: '英语冲到了山顶 🌐' },

  // ── 大满贯（连续第 3 个大满贯日，解锁一次永久）
  { id: 'triple-3', type: 'cumulative', group: '大满贯', name: '三连绝世', icon: '🔥🔥🔥', metric: 'tripleStreakDays', threshold: 3,
    unit: 'days',
    desc: '连续 3 天大满贯日', congrats: '三天三满贯，这是人干的事吗 🔥🔥🔥' },
]

export const DAILY_DEFS: DailyDef[] = [
  // ── 单日爆发
  { id: 'daily-6h', type: 'daily', group: '单日爆发', name: '一日澜山', icon: '🌊', metric: 'dayCoreHours', threshold: 6 * HOUR,
    unit: 'hours',
    desc: '当天学习 ≥ 6 小时', congrats: '今天真的在澜山上走了一大段 🌊' },
  { id: 'daily-8h', type: 'daily', group: '单日爆发', name: '登顶', icon: '⛰️', metric: 'dayCoreHours', threshold: 8 * HOUR,
    unit: 'hours',
    desc: '当天学习 ≥ 8 小时', congrats: '登顶了！今天值得记住 ⛰️' },
  { id: 'triple-over', type: 'daily', group: '单日爆发', name: '大满贯日', icon: '🏆', metric: 'tripleOver', threshold: 1,
    desc: '当天三科全部超额', congrats: '三科全满！今天封神 🏆' },

  // ── 逆袭（前一天 < 1h 且当天爆发，唯一需要前一天数据的每日刻章）
  { id: 'comeback-6h', type: 'daily', group: '逆袭', name: '黑马', icon: '🐴', metric: 'comeback', threshold: 6 * HOUR,
    unit: 'hours',
    desc: '前一天 < 1h 且当天 ≥ 6 小时', congrats: '乾坤未定，黑马回来了 🐴' },
  { id: 'comeback-8h', type: 'daily', group: '逆袭', name: '绝地', icon: '⚔️', metric: 'comeback', threshold: 8 * HOUR,
    unit: 'hours',
    desc: '前一天 < 1h 且当天 ≥ 8 小时', congrats: '绝地反击，2022 年的你看了会笑 ⚔️' },

  // ── 单科暴击
  { id: 'burst-phy', type: 'daily', group: '单科暴击', name: '物理暴击', icon: '⚛️💥', metric: 'daySubjectHours', subject: '物理', threshold: 4 * HOUR,
    unit: 'hours',
    desc: '当天物理 ≥ 4 小时', congrats: '今天物理杀疯了 ⚡⚡' },
  { id: 'burst-math', type: 'daily', group: '单科暴击', name: '数学暴击', icon: '🧮💥', metric: 'daySubjectHours', subject: '数学', threshold: 4 * HOUR,
    unit: 'hours',
    desc: '当天数学 ≥ 4 小时', congrats: '数学被你按在地上摩擦 📐📐' },
  { id: 'burst-eng', type: 'daily', group: '单科暴击', name: '英语暴击', icon: '🔤💥', metric: 'daySubjectHours', subject: '英语', threshold: 4 * HOUR,
    unit: 'hours',
    desc: '当天英语 ≥ 4 小时', congrats: '英语单词见了你都躲 📖📖' },

  // ── 均衡日（三科全部达标且均未超额）
  { id: 'balanced', type: 'daily', group: '均衡日', name: '稳行者', icon: '⚖️', metric: 'balanced', threshold: 1,
    desc: '当天三科达标且均未超额', congrats: '今天不偏科，一步一个脚印 ⚖️' },

  // ── 晨行三档（当天开始学习时间，本地时间）
  { id: 'morning-730', type: 'daily', group: '晨行', name: '初曙', icon: '🌄', metric: 'morning', threshold: 7 * 60 + 30,
    desc: '当天 7:30 前开始学习', congrats: '天蒙蒙亮，你已经在路上了 🌄' },
  { id: 'morning-700', type: 'daily', group: '晨行', name: '晨光', icon: '🌅', metric: 'morning', threshold: 7 * 60,
    desc: '当天 7:00 前开始学习', congrats: '清晨的光为你而来 🌅' },
  { id: 'morning-630', type: 'daily', group: '晨行', name: '黎明', icon: '☀️', metric: 'morning', threshold: 6 * 60 + 30,
    desc: '当天 6:30 前开始学习', congrats: '黎明时分，你是最早的登山人 ☀️' },

  // ── 夜航三档（当天结束学习时间，本地时间）
  { id: 'night-2150', type: 'daily', group: '夜航', name: '晚灯', icon: '🌇', metric: 'night', threshold: 21 * 60 + 50,
    desc: '当天 21:50 后仍在学习', congrats: '万家灯火中，有一盏是你在学 🌇' },
  { id: 'night-2220', type: 'daily', group: '夜航', name: '夜烛', icon: '🌙', metric: 'night', threshold: 22 * 60 + 20,
    desc: '当天 22:20 后仍在学习', congrats: '夜深了，烛火还亮着 🌙' },
  { id: 'night-2250', type: 'daily', group: '夜航', name: '星伴', icon: '🌌', metric: 'night', threshold: 22 * 60 + 50,
    desc: '当天 22:50 后仍在学习', congrats: '星星都认得你了 🌌' },

  // ── 极限专注（当天最长连续专注段，相邻 < 5min 视为连续）
  { id: 'focus-2h', type: 'daily', group: '极限专注', name: '入定', icon: '🎯', metric: 'focusSegment', threshold: 2 * HOUR,
    unit: 'hours',
    desc: '当天有连续专注段 ≥ 2 小时', congrats: '手机没碰过，真的进去了 🎯' },
  { id: 'focus-3h', type: 'daily', group: '极限专注', name: '忘我', icon: '🧘', metric: 'focusSegment', threshold: 3 * HOUR,
    unit: 'hours',
    desc: '当天有连续专注段 ≥ 3 小时', congrats: '经常忘我，这是心流 🧘' },
  { id: 'focus-4h', type: 'daily', group: '极限专注', name: '化境', icon: '🌊', metric: 'focusSegment', threshold: 4 * HOUR,
    unit: 'hours',
    desc: '当天有连续专注段 ≥ 4 小时', congrats: '四小时像四分钟，这就是境界 🌊' },

  // ── 狂热者（当天该科超额 ≥ 目标×1.5）
  { id: 'over-phy', type: 'daily', group: '狂热者', name: '物理狂热者', icon: '⚛️🔥', metric: 'daySubjectExceeded', subject: '物理', threshold: 1,
    desc: '当天物理超额（≥ 目标×1.5）', congrats: '物理都让你学出火星子了 ⚡🔥' },
  { id: 'over-math', type: 'daily', group: '狂热者', name: '数学狂热者', icon: '🧮🔥', metric: 'daySubjectExceeded', subject: '数学', threshold: 1,
    desc: '当天数学超额（≥ 目标×1.5）', congrats: '数学超额上瘾了 📐🔥' },
  { id: 'over-eng', type: 'daily', group: '狂热者', name: '英语狂热者', icon: '🔤🔥', metric: 'daySubjectExceeded', subject: '英语', threshold: 1,
    desc: '当天英语超额（≥ 目标×1.5）', congrats: '英语停不下来 📖🔥' },

  // ── 朝暮行（同一天晨行 + 夜航）
  { id: 'dawn-dusk', type: 'daily', group: '朝暮行', name: '朝暮行', icon: '🌗', metric: 'dawnDusk', threshold: 1,
    desc: '当天同时晨行 + 夜航', congrats: '朝朝暮暮都在澜山上——你的诗成真了 🌗' },
]

export const SEAL_DEFS: SealDef[] = [...CUMULATIVE_DEFS, ...DAILY_DEFS]

const DEF_MAP: Record<string, SealDef> = {}
for (const d of SEAL_DEFS) DEF_MAP[d.id] = d

export function getSealDefs(): SealDef[] {
  return SEAL_DEFS
}

// ============================================================
// 工具
// ============================================================

export function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/** UTC ISO → 本地时刻（分钟，0-1439） */
function localMinutes(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function prevDateStr(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('sv-SE')
}

/** 秒 → "3h05m" 格式 */
function fmtH(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return `${h}h${String(m).padStart(2, '0')}m`
}

/** 分钟 → "7:30" 格式 */
function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

// ============================================================
// 单日数据（每日刻章判定的数据基础）
// ============================================================

interface DayFacts {
  coreTotal: number                    // 核心三科当天总秒数
  subjectSeconds: Record<string, number>
  achieved: Set<string>
  exceeded: Set<string>
  firstStartMin: number | null         // 首段学习开始（本地分钟）
  lastEndMin: number | null            // 末段学习结束（本地分钟）
  maxFocusSegment: number              // 当天最长连续专注段（秒）
}

function getDayFacts(date: string): DayFacts {
  const facts: DayFacts = {
    coreTotal: 0,
    subjectSeconds: {},
    achieved: new Set(),
    exceeded: new Set(),
    firstStartMin: null,
    lastEndMin: null,
    maxFocusSegment: 0,
  }

  for (const s of getDailyStats(date)) {
    facts.subjectSeconds[s.subject] = s.total_seconds
    if (s.achieved) facts.achieved.add(s.subject)
    if (s.exceeded) facts.exceeded.add(s.subject)
    if (CORE.includes(s.subject)) facts.coreTotal += s.total_seconds
  }

  // 学习段：只看父段（is_exploded=0），排除休闲/其他
  const segments = getMergedSegments(date).filter(
    (s) => !s.is_exploded && s.subject !== '休闲' && s.subject !== '其他'
  )
  for (const seg of segments) {
    const startMin = localMinutes(seg.start_time)
    const endMin = localMinutes(seg.end_time)
    if (facts.firstStartMin === null || startMin < facts.firstStartMin) facts.firstStartMin = startMin
    if (facts.lastEndMin === null || endMin > facts.lastEndMin) facts.lastEndMin = endMin
    if (seg.duration > facts.maxFocusSegment) facts.maxFocusSegment = seg.duration
  }

  return facts
}

function evalDailyDef(def: DailyDef, date: string, f: DayFacts): boolean {
  switch (def.metric) {
    case 'dayCoreHours':
      return f.coreTotal >= def.threshold
    case 'comeback': {
      const prev = getDayFacts(prevDateStr(date)).coreTotal
      return prev < HOUR && f.coreTotal >= def.threshold
    }
    case 'daySubjectHours':
      return (f.subjectSeconds[def.subject!] || 0) >= def.threshold
    case 'daySubjectExceeded':
      return f.exceeded.has(def.subject!)
    case 'balanced':
      return CORE.every((s) => f.achieved.has(s) && !f.exceeded.has(s))
    case 'tripleOver':
      return CORE.every((s) => f.exceeded.has(s))
    case 'dawnDusk':
      return f.firstStartMin !== null && f.lastEndMin !== null
        && f.firstStartMin < BASE_MORNING_MIN && f.lastEndMin > BASE_NIGHT_MIN
    case 'morning':
      return f.firstStartMin !== null && f.firstStartMin < def.threshold
    case 'night':
      return f.lastEndMin !== null && f.lastEndMin > def.threshold
    case 'focusSegment':
      return f.maxFocusSegment >= def.threshold
  }
}

/** 每日刻章的实时提示文案（今天用） */
function dailyHint(def: DailyDef, f: DayFacts): string {
  switch (def.metric) {
    case 'dayCoreHours':
      return `${fmtH(f.coreTotal)} / ${fmtH(def.threshold)}`
    case 'comeback': {
      const prev = getDayFacts(prevDateStr(todayStr())).coreTotal
      const prevOk = prev < HOUR
      return `${fmtH(f.coreTotal)} / ${fmtH(def.threshold)}${prevOk ? '' : '（昨天已 ≥1h）'}`
    }
    case 'daySubjectHours':
      return `${fmtH(f.subjectSeconds[def.subject!] || 0)} / ${fmtH(def.threshold)}`
    case 'daySubjectExceeded':
      return f.exceeded.has(def.subject!) ? '已超额' : f.achieved.has(def.subject!) ? '已达标，未超额' : '未达标'
    case 'balanced': {
      const parts = CORE.map((s) => (f.achieved.has(s) ? '✓' : '✗'))
      return parts.join(' ')
    }
    case 'tripleOver': {
      const parts = CORE.map((s) => (f.exceeded.has(s) ? '✓' : '✗'))
      return `超额 ${parts.join(' ')}`
    }
    case 'dawnDusk':
      return f.firstStartMin !== null && f.lastEndMin !== null
        ? `最早 ${fmtMin(f.firstStartMin)} · 学到 ${fmtMin(f.lastEndMin)}`
        : '—'
    case 'morning':
      return f.firstStartMin !== null ? `最早 ${fmtMin(f.firstStartMin)}` : '今天还没开始学习'
    case 'night':
      return f.lastEndMin !== null ? `已学到 ${fmtMin(f.lastEndMin)}` : '今天还没有学习'
    case 'focusSegment':
      return f.maxFocusSegment > 0 ? `${fmtH(f.maxFocusSegment)} / ${fmtH(def.threshold)}` : '—'
  }
}

// ============================================================
// 每日刻章：判定 / 记录 / 回放
// ============================================================

/**
 * 对某一天求值每日刻章并写入记录表。
 * - 今天：只增不减，返回新获得的 id（驱动 toast）
 * - 过去日期（或 rebuild=true）：用该日数据全量重算并覆盖（与 rebuildDailyStats 同模式）
 */
export function evaluateDailySeals(date: string, opts?: { rebuild?: boolean }): string[] {
  const db = getDb()
  const facts = getDayFacts(date)
  const earned = DAILY_DEFS.filter((d) => evalDailyDef(d, date, facts)).map((d) => d.id)
  const isToday = date === todayStr()

  if (isToday && !opts?.rebuild) {
    const newly: string[] = []
    for (const id of earned) {
      const exists = db.exec('SELECT 1 FROM daily_seal_records WHERE date = ? AND seal_id = ?', [date, id])
      if (!exists || exists.length === 0 || exists[0].values.length === 0) {
        db.run('INSERT INTO daily_seal_records (date, seal_id, earned_at) VALUES (?, ?, ?)', [date, id, new Date().toISOString()])
        newly.push(id)
      }
    }
    if (newly.length > 0) save()
    return newly
  }

  db.run('DELETE FROM daily_seal_records WHERE date = ?', [date])
  for (const id of earned) {
    db.run('INSERT INTO daily_seal_records (date, seal_id, earned_at) VALUES (?, ?, ?)', [date, id, new Date().toISOString()])
  }
  save()
  return []
}

/** 某一天获得的每日刻章 id 列表（过去日期自动重算；今天直接读记录） */
export function getDailySealRecords(date: string): string[] {
  const db = getDb()
  if (date !== todayStr()) evaluateDailySeals(date, { rebuild: true })
  const r = db.exec('SELECT seal_id FROM daily_seal_records WHERE date = ? ORDER BY earned_at', [date])
  return r?.[0]?.values?.map((x) => x[0] as string) || []
}

/** 首次升级时回填全部历史日期（有数据且尚无记录的天；幂等，可安全重复调用） */
export function backfillDailySealHistory(): number {
  const db = getDb()
  const r = db.exec('SELECT DISTINCT date FROM daily_stats ORDER BY date ASC')
  const dates = r?.[0]?.values?.map((x) => x[0] as string) || []
  let count = 0
  for (const d of dates) {
    const has = db.exec('SELECT 1 FROM daily_seal_records WHERE date = ? LIMIT 1', [d])
    if (has && has.length > 0 && has[0].values.length > 0) continue
    evaluateDailySeals(d, { rebuild: true })
    const row = db.exec('SELECT COUNT(*) FROM daily_seal_records WHERE date = ?', [d])
    count += (row?.[0]?.values?.[0]?.[0] as number) || 0
  }
  return count
}

// ============================================================
// 累积刻章：进度（支持截至日期）/ 解锁
// ============================================================

function sumCoreUntil(asOf?: string): number {
  const db = getDb()
  const r = asOf
    ? db.exec("SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE date <= ? AND subject IN ('物理','数学','英语')", [asOf])
    : db.exec("SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE subject IN ('物理','数学','英语')")
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

function sumSubjectUntil(subject: Subject, asOf?: string): number {
  const db = getDb()
  const r = asOf
    ? db.exec('SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE date <= ? AND subject = ?', [asOf, subject])
    : db.exec('SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE subject = ?', [subject])
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 截至某日期的连续打卡天数（含该日） */
function streakAsOf(date: string): number {
  const db = getDb()
  const r = db.exec('SELECT DISTINCT date FROM daily_stats WHERE total_seconds > 0')
  const set = new Set(r?.[0]?.values?.map((x) => x[0] as string) || [])
  let streak = 0
  const d = new Date(date + 'T00:00:00')
  while (set.has(d.toLocaleDateString('sv-SE'))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

/** 截至某日期的连续大满贯天数（三科全超额，含该日） */
function tripleStreakAsOf(date: string): number {
  const db = getDb()
  const r = db.exec(
    "SELECT date FROM daily_stats WHERE subject IN ('物理','数学','英语') AND exceeded = 1 GROUP BY date HAVING COUNT(*) >= 3 ORDER BY date DESC"
  )
  const set = new Set(r?.[0]?.values?.map((x) => x[0] as string) || [])
  let streak = 0
  const d = new Date(date + 'T00:00:00')
  while (set.has(d.toLocaleDateString('sv-SE'))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

/**
 * 累积刻章计算。asOf 传历史日期 = 回放（只读，不写解锁）；不传/今天 = 实时（顺带落库解锁）。
 */
function computeCumulative(asOf?: string): { states: CumulativeSealState[]; newly: string[] } {
  const db = getDb()
  const rows = db.exec('SELECT id, unlocked, unlocked_at FROM achievements')
  // id → {unlocked, unlocked_at}，再按 SEAL_DEFS 定义顺序输出（保证 破土→抽枝→成木 等顺序稳定）
  const stateMap = new Map<string, { unlocked: boolean; unlocked_at: string | null }>()
  for (const r of rows?.[0]?.values || []) {
    stateMap.set(r[0] as string, { unlocked: Boolean(r[1]), unlocked_at: r[2] as string | null })
  }
  const isLive = !asOf || asOf === todayStr()
  const target = asOf ?? todayStr()

  const totalSec = sumCoreUntil(asOf)
  const subjSec: Record<string, number> = {
    '物理': sumSubjectUntil('物理', asOf),
    '数学': sumSubjectUntil('数学', asOf),
    '英语': sumSubjectUntil('英语', asOf),
  }
  const streak = streakAsOf(target)
  const tripleStreak = tripleStreakAsOf(target)

  let dirty = false
  const newly: string[] = []
  const results: CumulativeSealState[] = []
  for (const def of CUMULATIVE_DEFS) {
    const id = def.id
    const old = stateMap.get(id)

    let progress = 0
    switch (def.metric) {
      case 'totalHours': progress = totalSec; break
      case 'subjectHours': progress = subjSec[def.subject!] || 0; break
      case 'streakDays': progress = streak; break
      case 'tripleStreakDays': progress = tripleStreak; break
    }

    const wasUnlocked = old ? old.unlocked : false
    const progressReached = progress >= def.threshold
    // 实时 = DB 状态（解锁永久保留）；回放 = 仅看截至该日的计算值
    const unlocked = isLive ? wasUnlocked || progressReached : progressReached
    let unlockedAt = isLive ? (old?.unlocked_at ?? null) : null
    if (isLive && progressReached && !wasUnlocked) {
      unlockedAt = new Date().toISOString()
      db.run('UPDATE achievements SET unlocked = 1, unlocked_at = ? WHERE id = ?', [unlockedAt, id])
      dirty = true
      newly.push(id)
    }
    results.push({ id, unlocked, unlocked_at: unlockedAt, progress, progress_max: def.threshold })
  }
  if (dirty) save()
  return { states: results, newly }
}

/** 累积刻章进度（回放任意历史日期时传入 asOf，只读不写库） */
export function getCumulativeProgress(asOf?: string): CumulativeSealState[] {
  return computeCumulative(asOf).states
}

/** 同步循环/轮询调用：解锁新达标的累积刻章，返回新解锁 id */
export function checkAndUnlockCumulativeSeals(): string[] {
  return computeCumulative().newly
}

/** 渲染端轮询：新解锁的累积刻章 + 今天新获得的每日刻章 */
export function getNewSeals(): { cumulative: string[]; daily: string[] } {
  return {
    cumulative: checkAndUnlockCumulativeSeals(),
    daily: evaluateDailySeals(todayStr()),
  }
}

// ============================================================
// 佩戴位（4×2 八个格子）
// ============================================================

export function getSealSlots(): SealSlot[] {
  const db = getDb()
  const r = db.exec('SELECT slot, seal_id, date FROM seal_slots ORDER BY slot')
  return r?.[0]?.values?.map((row) => ({
    slot: row[0] as number,
    seal_id: row[1] as string,
    date: row[2] as string | null,
  })) || []
}

/** 佩戴规则：累积刻章需已解锁（永久）；每日刻章需当天已获得（仅当天有效）；同枚不重复 */
export function setSealSlot(slot: number, sealId: string): { ok: boolean; message: string } {
  const db = getDb()
  if (!Number.isInteger(slot) || slot < 0 || slot > 7) return { ok: false, message: '佩戴位无效' }
  const def = DEF_MAP[sealId]
  if (!def) return { ok: false, message: '刻章不存在' }

  if (def.type === 'cumulative') {
    const r = db.exec('SELECT unlocked FROM achievements WHERE id = ?', [sealId])
    if (!r || r.length === 0 || r[0].values.length === 0 || !Boolean(r[0].values[0][0])) {
      return { ok: false, message: `「${def.name}」尚未解锁` }
    }
    db.run('INSERT OR REPLACE INTO seal_slots (slot, seal_id, date) VALUES (?, ?, NULL)', [slot, sealId])
  } else {
    const today = todayStr()
    const r = db.exec('SELECT 1 FROM daily_seal_records WHERE date = ? AND seal_id = ?', [today, sealId])
    if (!r || r.length === 0 || r[0].values.length === 0) {
      return { ok: false, message: `「${def.name}」今天还没有获得` }
    }
    db.run('INSERT OR REPLACE INTO seal_slots (slot, seal_id, date) VALUES (?, ?, ?)', [slot, sealId, today])
  }
  // 同一枚刻章不能同时占两个格子
  db.run('DELETE FROM seal_slots WHERE seal_id = ? AND slot != ?', [sealId, slot])
  save()
  return { ok: true, message: '' }
}

export function clearSealSlot(slot: number): void {
  const db = getDb()
  db.run('DELETE FROM seal_slots WHERE slot = ?', [slot])
  save()
}

/** 跨天清理：移除佩戴格中所有非今天的每日刻章（累积刻章永久保留） */
export function clearExpiredDailySlots(today?: string): number {
  const db = getDb()
  const t = today ?? todayStr()
  db.run('DELETE FROM seal_slots WHERE date IS NOT NULL AND date != ?', [t])
  const r = db.exec('SELECT changes()')
  const n = (r?.[0]?.values?.[0]?.[0] as number) || 0
  if (n > 0) save()
  return n
}

// ============================================================
// 总览（刻章册主页 / 佩戴格共用）
// ============================================================

/**
 * 总览数据。date 传历史日期 = 回放模式：每日刻章为该日记录（自动重算），累积为截至该日进度。
 */
export function getSealsOverview(date?: string): SealsOverview {
  const d = date ?? todayStr()
  const isToday = d === todayStr()
  const records = getDailySealRecords(d)
  const facts = getDayFacts(d)
  const daily = DAILY_DEFS.map((def) => ({
    id: def.id,
    earned: records.includes(def.id),
    hint: isToday ? dailyHint(def, facts) : '',
  }))
  const db = getDb()
  const ever = db.exec('SELECT DISTINCT seal_id FROM daily_seal_records')
  return {
    cumulative: getCumulativeProgress(isToday ? undefined : d),
    daily,
    slots: getSealSlots(),
    dailyEverIds: ever?.[0]?.values?.map((x) => x[0] as string) || [],
  }
}
