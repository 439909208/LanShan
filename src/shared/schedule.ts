// ─── 专注日程共享逻辑（主进程调度器 + 渲染端设置页共用）───

/** 专注日程时段：s/e 均为 HH:MM（只存学习时段；休息时段无需设置，软件自动忽略） */
export interface ScheduleSlot {
  s: string
  e: string
}

/** 默认日程：用户日常 9 个学习时段 */
export const DEFAULT_FOCUS_SCHEDULE: ScheduleSlot[] = [
  { s: '07:00', e: '08:00' },
  { s: '08:15', e: '09:15' },
  { s: '09:30', e: '10:30' },
  { s: '10:45', e: '11:45' },
  { s: '14:00', e: '15:00' },
  { s: '15:15', e: '16:15' },
  { s: '16:30', e: '17:30' },
  { s: '19:30', e: '20:30' },
  { s: '20:45', e: '21:45' },
]

/** HH:MM → 当日分钟数（0-1439）；非法返回 -1 */
export function toMinutes(t: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(t)
  if (!m) return -1
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h > 23 || min > 59) return -1
  return h * 60 + min
}

/** 解析设置里存的时间段 JSON（非法项自动丢弃）；未设置/格式错误返回空数组 */
export function parseSchedule(raw: string | undefined): ScheduleSlot[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is ScheduleSlot =>
      !!x && typeof x.s === 'string' && typeof x.e === 'string' &&
      toMinutes(x.s) >= 0 && toMinutes(x.e) > toMinutes(x.s))
  } catch {
    return []
  }
}

/** 当前时刻处于哪个学习时段（含开始、不含结束）；不在时段内返回 null */
export function findActiveSlot(slots: ScheduleSlot[], minute: number): ScheduleSlot | null {
  return slots.find(x => {
    const s = toMinutes(x.s)
    const e = toMinutes(x.e)
    return s >= 0 && e > s && minute >= s && minute < e
  }) ?? null
}

/** 下一个尚未开始的时段（"下次专注"预览用）；今天已无后续时段返回 null */
export function findNextSlot(slots: ScheduleSlot[], minute: number): ScheduleSlot | null {
  return slots.find(x => {
    const s = toMinutes(x.s)
    return s >= 0 && s > minute
  }) ?? null
}

/** 距离下一次学习时段开始的分钟数（休息倒计时用）；今天已无后续时段返回 null */
export function minutesUntilNext(slots: ScheduleSlot[], minute: number): number | null {
  const next = findNextSlot(slots, minute)
  if (!next) return null
  return toMinutes(next.s) - minute
}

/** 严格模式 + 当前处于学习时段 → 时段锁定（禁止切宽松/关闭日程/提前结束专注）。
 *  调用方需自行确认日程已启用（mode 传 'strict' 且时段命中才返回 true） */
export function isScheduleLocked(slots: ScheduleSlot[], minute: number, mode: string): boolean {
  if (mode !== 'strict') return false
  return findActiveSlot(slots, minute) !== null
}

/** 某 HH:MM 在 base 所在日期的时间戳（日程进入时计算精确结束时间用）；非法返回 0 */
export function slotEndTime(t: string, base: Date = new Date()): number {
  const min = toMinutes(t)
  if (min < 0) return 0
  const d = new Date(base)
  d.setHours(Math.floor(min / 60), min % 60, 0, 0)
  return d.getTime()
}
