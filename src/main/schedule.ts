import { Notification } from 'electron'
import { getSetting, setSetting } from './database'
import { startFocusSession, stopFocusSession, getFocusState } from './focus'
import {
  DEFAULT_FOCUS_SCHEDULE, ScheduleSlot, parseSchedule, findActiveSlot, findNextSlot, minutesUntilNext, slotEndTime,
  isScheduleLocked as lockedCheck,
} from '../shared/schedule'

// ─── 专注日程模式：按用户设置的学习时段自动进入/结束专注 ───
// 只处理"学习时段"：到点自动进入、到点自动结束；休息时段不需要任何操作。
// 调度采用 10 秒轮询（与 sync.ts 到点提醒同一模式），进入后由专注会话自身的
// 1 秒倒计时在 endAt（= 时段结束时刻）精确到点自然结束，休息时段自动回到正常桌面。

const POLL_MS = 10_000
/** 严格模式：手动退出后的冷却时间，避免刚结束又被立刻锁回 */
const STRICT_REENTER_MS = 5_000

let pollTimer: ReturnType<typeof setInterval> | null = null
/** 当前专注会话是否由日程启动（只有日程启动的会话才允许被日程兜底结束/重入） */
let scheduleOwns = false
/** 上一次轮询时的专注状态（用于识别"时段内手动退出"） */
let prevActive = false
/** 最近一次"时段内手动退出"的时间戳（严格模式冷却用） */
let manualExitAt = 0
/** 宽松模式去重：已自动进入过的「日期+时段起点」，防止手动退出后本时段重入 */
const autoStartedKeys = new Set<string>()

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE')  // YYYY-MM-DD
}

function poll(): void {
  if (getSetting('focus_schedule_enabled') !== 'true') {
    scheduleOwns = false
    prevActive = getFocusState().active
    return
  }
  // 老用户数据库没有日程键 → 懒写入默认日程（新库由 DEFAULT_SETTINGS 预置）
  if (getSetting('focus_schedule') === undefined) {
    try { setSetting('focus_schedule', JSON.stringify(DEFAULT_FOCUS_SCHEDULE)) } catch { /* 忽略 */ }
  }
  const slots = parseSchedule(getSetting('focus_schedule'))
  const now = new Date()
  const minute = now.getHours() * 60 + now.getMinutes()
  const cur = findActiveSlot(slots, minute)
  const state = getFocusState()

  if (state.active) {
    // 会话进行中：手动启动的会话（scheduleOwns=false）一律不干预；
    // 日程启动的会话若已过时段则兜底结束（正常由倒计时自然结束）
    if (cur) {
      // 时段内：宽松模式标记"本时段已处理"，防止手动会话结束后重入
      if (getSetting('focus_schedule_mode') !== 'strict') {
        autoStartedKeys.add(todayKey() + '-' + cur.s)
      }
    } else if (scheduleOwns) {
      stopFocusSession()
      scheduleOwns = false
    }
    prevActive = true
    return
  }

  // 无会话
  const wasActive = prevActive
  prevActive = false
  const endedBySchedule = wasActive && scheduleOwns  // 日程启动的会话刚结束（自然结束/被手动结束）
  scheduleOwns = false
  if (!cur) {
    // 会话刚结束且当前不在学习时段 → 休息提醒：距下次专注开始剩余时间
    if (endedBySchedule) notifyBreak(slots, minute)
    return
  }
  const key = todayKey() + '-' + cur.s
  if (getSetting('focus_schedule_mode') === 'strict') {
    // 严格模式：时段内刚结束（手动退出）→ 冷却后重新进入，直到时段结束
    if (wasActive) manualExitAt = Date.now()
    if (Date.now() - manualExitAt < STRICT_REENTER_MS) return
  } else if (autoStartedKeys.has(key)) {
    // 宽松模式：本时段已自动进入过 → 手动退出后不再重入，下个时段照常
    return
  }
  autoStartedKeys.add(key)
  scheduleOwns = true
  const endAt = slotEndTime(cur.e, now)
  void startFocusSession(60, endAt).then(ok => {
    if (ok) {
      try {
        new Notification({ title: '📅 日程专注开始', body: `学习时段 ${cur.s} - ${cur.e}，已自动进入专注` }).show()
      } catch { /* 通知失败不影响进入 */ }
    } else {
      scheduleOwns = false
    }
  })
}

/** 休息提醒：日程启动的专注会话结束后，提示距下次专注开始的剩余时间 */
function notifyBreak(slots: ScheduleSlot[], minute: number): void {
  try {
    const until = minutesUntilNext(slots, minute)
    if (until === null) {
      new Notification({ title: '☕ 休息时间', body: '今天的学习时段已全部结束，好好休息吧～' }).show()
    } else {
      const next = findNextSlot(slots, minute)!
      new Notification({ title: '☕ 休息时间', body: `距下次专注还有约 ${until} 分钟（${next.s} 开始），休息一下吧` }).show()
    }
  } catch { /* 通知失败不影响 */ }
}

/** 严格模式 + 当前处于学习时段 → 时段锁定（禁止切宽松/关闭日程/提前结束专注）。
 *  stop-focus IPC 与全局逃生快捷键据此拒绝；由 index.ts 注入 focus hooks 使用 */
export function isScheduleLocked(): boolean {
  if (getSetting('focus_schedule_enabled') !== 'true') return false
  if (getSetting('focus_schedule_mode') !== 'strict') return false
  const slots = parseSchedule(getSetting('focus_schedule'))
  const d = new Date()
  return lockedCheck(slots, d.getHours() * 60 + d.getMinutes(), 'strict')
}

/** 启动日程调度（应用就绪后调用一次；启动立即检查——若正处于学习时段内则马上进入） */
export function initSchedule(): void {
  stopSchedule()
  pollTimer = setInterval(poll, POLL_MS)
  poll()
}

/** 停止日程调度（应用退出前清理） */
export function stopSchedule(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
