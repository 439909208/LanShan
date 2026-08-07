/**
 * 补签（盈余回填）模块 — 纯函数，不依赖数据库。
 *
 * 设计初衷（防"破罐破摔"）：
 * 热力图格子空了会让人产生"既然已经断了，后面也没必要坚持"的心理。
 * 本模块允许把真实学过的超额时长"回填"到最近 7 天内的空缺日，
 * 让空白从"永久的疤痕"变成"可修复的欠账"。
 *
 * 规则：
 * - 只针对核心科目（物理/数学/英语）各自独立计算
 * - 某天某科实际时长超过目标 → 产生盈余，进 FIFO 池
 * - 盈余自产生日起 7 天内有效（MAKEUP_VALID_DAYS）
 * - 只有最近 7 天内的空缺可以补（MAKEUP_WINDOW_DAYS）
 * - 先进先出：最早产生的盈余优先补最早的缺口
 * - 允许部分补（盈余用完为止）
 * - 补签只影响热力图展示层，绝不改动 daily_stats 原始数据
 */

export const MAKEUP_WINDOW_DAYS = 7 // 空缺可补的时间窗（默认：今天往前 7 天）
export const MAKEUP_VALID_DAYS = 7  // 盈余自产生日起的有效期（默认；<=0 表示永久有效）
export const MAKEUP_FILL_ALL = '0000-01-01' // 补签范围=所有日期（任何一天都可补）

/** 一次补签记录 */
export interface MakeupFill {
  date: string       // 被补的那天
  subject: string
  amount: number     // 补签秒数
  sourceDate: string // 盈余来源日（展示用，实际消耗按 FIFO）
  manual: boolean    // 手动补签（true）或自动回填（false）
}

/** 单日单科统计（daily_stats 的行） */
export interface DayStat {
  date: string
  total: number
  target: number
}

export interface SimOpts {
  stats: DayStat[]                    // 单科目、按日期升序
  existing: MakeupFill[]              // 已持久化的补签（强制消耗盈余）
  undoneDates: ReadonlySet<string>    // 用户明确要求保持空白的日期
  today: string                       // 窗口锚点（'YYYY-MM-DD'）
  defaultTarget: number               // 无记录日期的目标时长（秒）
  generateNew?: boolean               // 生成新补签（刷新=true；查可用量=false）
  validDays?: number                  // 盈余有效期（天），<=0 表示永久有效（默认 MAKEUP_VALID_DAYS）
  fillFrom?: string                   // 补签范围起始日：该日之前的空缺不可补（"当月"=月初、"近7天"=今天-6；不设置=所有日期可补）
  startDate?: string                  // 模拟起点，覆盖默认计算
}

export interface MakeupDayResult {
  date: string
  total: number         // 当日实际时长（秒）
  need: number          // 缺口 = max(0, target - total)
  existingAmount: number // 该日已持久化补签秒数
  newAmount: number      // 本次新生成补签秒数
  balanceAfter: number   // 该日处理完后池中剩余盈余
  grossAfter: number     // 截至该日的累计盈余（历史超额总和，不随补签减少）
  fillable: boolean      // 该日是否在补签范围内（fillFrom 之后）
  poolAtEnd: { source: string; amount: number }[] // 处理完后的盈余池（手动补签时取 poolAtEnd[0] 作为来源日）
  newFills: MakeupFill[]
}

export function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return dateStr(d)
}

/** from 到 to 相隔的天数（to 晚于 from 为正） */
export function diffDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

/**
 * 盈余分配模拟。
 * 以 today 为锚点，从 today-13 走到 today（更早的盈余不可能补到窗口内，
 * 更早的缺口也不再需要补）。返回逐日结果。
 */
export function simulateMakeups(opts: SimOpts): MakeupDayResult[] {
  const { stats, existing, undoneDates, today, defaultTarget, generateNew = true } = opts
  const validDays = opts.validDays ?? MAKEUP_VALID_DAYS
  // 补签范围：不设置时默认最近 7 天窗口；fillFrom 为 MAKEUP_FILL_ALL 时所有日期可补
  const fillFrom = opts.fillFrom ?? addDays(today, -(MAKEUP_WINDOW_DAYS - 1))

  const statMap = new Map<string, DayStat>()
  for (const s of stats) statMap.set(s.date, s)

  // 已持久化补签按日聚合（强制消耗）
  const existingByDay = new Map<string, number>()
  for (const f of existing) {
    existingByDay.set(f.date, (existingByDay.get(f.date) ?? 0) + f.amount)
  }

  // FIFO 盈余池
  const pool: { source: string; amount: number }[] = []
  const results: MakeupDayResult[] = []
  let gross = 0 // 累计盈余（历史超额总和）

  // 模拟起点：显式指定 > 永久有效时按 30 天兜底 > 按窗口+有效期推算
  const start = opts.startDate
    ?? (validDays > 0
      ? addDays(today, -(MAKEUP_WINDOW_DAYS + validDays - 1))
      : addDays(today, -(MAKEUP_WINDOW_DAYS - 1)))
  for (let d = start; diffDays(d, today) >= 0; d = addDays(d, 1)) {
    const stat = statMap.get(d)
    const total = stat?.total ?? 0
    const target = stat?.target ?? defaultTarget
    const need = Math.max(0, target - total)
    const inWindow = diffDays(d, today) < MAKEUP_WINDOW_DAYS

    // 1. 当日盈余入池（所有日期的超额都统计；同时累计到 gross）
    if (total > target) {
      const surplus = total - target
      gross += surplus
      pool.push({ source: d, amount: surplus })
    }

    // 2. 已持久化补签强制消耗（历史事实优先，先消耗再过期）
    const existingAmount = existingByDay.get(d) ?? 0
    if (existingAmount > 0) {
      consume(pool, existingAmount)
    }

    // 3. 过期盈余出池（source + validDays < d 的已无法补这一天；永久有效则不过期）
    if (validDays > 0) {
      while (pool.length > 0 && diffDays(pool[0].source, d) > validDays) {
        pool.shift()
      }
    }

    // 4. 补签范围内、未被用户标记为"保持空白"的缺口 → 生成补签
    let newAmount = 0
    const newFills: MakeupFill[] = []
    const fillable = d >= fillFrom
    if (generateNew && fillable && !undoneDates.has(d) && need > existingAmount) {
      const remaining = need - existingAmount
      const canFill = Math.min(remaining, poolBalance(pool))
      if (canFill > 0) {
        const consumed = consumeWithSources(pool, canFill)
        newAmount = consumed.amount
        newFills.push({
          date: d,
          subject: '', // 调用方填充
          amount: consumed.amount,
          sourceDate: consumed.sources[0] ?? d,
          manual: false,
        })
      }
    }

    results.push({
      date: d,
      total,
      need,
      existingAmount,
      newAmount,
      balanceAfter: poolBalance(pool),
      grossAfter: gross,
      fillable,
      poolAtEnd: pool.map(c => ({ ...c })),
      newFills,
    })
  }

  return results
}

function poolBalance(pool: { source: string; amount: number }[]): number {
  return pool.reduce((s, c) => s + c.amount, 0)
}

/** 从池头（最早盈余）开始消耗，返回消耗总量 */
function consume(pool: { source: string; amount: number }[], amount: number): number {
  let remaining = amount
  while (remaining > 0 && pool.length > 0) {
    const c = pool[0]
    if (c.amount <= remaining) {
      remaining -= c.amount
      pool.shift()
    } else {
      c.amount -= remaining
      remaining = 0
    }
  }
  return amount - remaining
}

/** 消耗并记录来源日（展示用） */
function consumeWithSources(
  pool: { source: string; amount: number }[],
  amount: number
): { amount: number; sources: string[] } {
  const sources: string[] = []
  let remaining = amount
  while (remaining > 0 && pool.length > 0) {
    const c = pool[0]
    sources.push(c.source)
    if (c.amount <= remaining) {
      remaining -= c.amount
      pool.shift()
    } else {
      c.amount -= remaining
      remaining = 0
    }
  }
  return { amount: amount - remaining, sources }
}
