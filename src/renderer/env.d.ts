/// <reference types="vite/client" />

/** 专注白名单条目：进程名（如 chrome.exe）+ 可选路径/显示名/窗口标题关键词 */
interface FocusApp {
  name: string
  path?: string
  title?: string
  /** 窗口标题关键词：设置后仅当前台窗口标题包含该关键词时才放行（窗口级锁定） */
  titleMatch?: string
  /** 锁窗口时记录的网址：点击图标时直接用浏览器导航到该地址（精确跳转） */
  url?: string
  /** 仅显示模式：点击图标只把浏览器/窗口调出来（不导航新开页面） */
  switchOnly?: boolean
}

/** 专注状态 */
interface FocusState {
  active: boolean
  endAt: number
  durationMin: number
  remainingSec: number
  whitelist: FocusApp[]
}

/** 专注倒计时推送 */
interface FocusTick {
  active: boolean
  endAt: number
  durationMin: number
  remainingSec: number
}

interface LanshanApi {
  getSettings: () => Promise<Record<string, string>>
  setSetting: (key: string, value: string | number | boolean) => Promise<void>
  getTraySubject: () => Promise<string | null>
  setTraySubject: (subject: string | null) => Promise<void>
  getDailyStats: (date: string) => Promise<any[]>
  rebuildDailyStats: (date: string) => Promise<void>
  getTotalSecondsToday: (date: string) => Promise<number>
  getConsecutiveDays: () => Promise<number>
  getMaxConsecutiveDays: () => Promise<number>
  getSubjectTotal: (subject: string) => Promise<number>
  getTotalSecondsAllTime: () => Promise<number>
  getMergedSegments: (date: string) => Promise<any[]>
  getWeekStats: (days: number) => Promise<any[]>
  getYearHeatmap: (year: number) => Promise<any[]>
  getMakeupFills: (year: number, month: number) => Promise<any[]>
  getMakeupAvailability: (date: string) => Promise<any[]>
  applyMakeup: (date: string, subject: string) => Promise<{ ok: boolean; message: string; amount: number }>
  undoMakeup: (date: string, subject: string) => Promise<void>
  getDailyBreakdown: (date: string) => Promise<any[]>

  // 刻章系统：定义 / 总览（含回放）/ 每日记录 / 佩戴位 / 新刻章轮询
  getSealDefs: () => Promise<any[]>
  getSealsOverview: (date?: string) => Promise<{
    cumulative: { id: string; unlocked: boolean; unlocked_at: string | null; progress: number; progress_max: number }[]
    daily: { id: string; earned: boolean; hint: string }[]
    slots: { slot: number; seal_id: string; date: string | null }[]
    dailyEverIds: string[]
  }>
  getDailySealRecords: (date: string) => Promise<string[]>
  getNewSeals: () => Promise<{ cumulative: string[]; daily: string[] }>
  setSealSlot: (slot: number, sealId: string) => Promise<{ ok: boolean; message: string }>
  clearSealSlot: (slot: number) => Promise<void>
  getSubjectColor: (subject: string) => Promise<string>
  getSubjectIcon: (subject: string) => Promise<string>
  getSubjects: () => Promise<string[]>
  getCoreSubjects: () => Promise<string[]>
  getClassificationRules: () => Promise<any[]>
  addClassificationRule: (subject: string, keyword: string, matchField: string, priority: number) => Promise<void>
  deleteClassificationRule: (id: number) => Promise<void>
  exportRules: () => Promise<string>
  importRules: () => Promise<number>
  reclassifySegment: (segmentId: number, newSubject: string) => Promise<void>
  reclassifyByTitle: (date: string, title: string, newSubject: string) => Promise<void>
  reclassifyByTitleInRange: (date: string, startTime: string, endTime: string, title: string, newSubject: string) => Promise<void>
  splitSegment: (segmentId: number, splitTime: string) => Promise<void>
  mergeAdjacentSegments: (id1: number, id2: number) => Promise<boolean>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  setAutoStart: (enable: boolean) => Promise<void>
  exportData: () => Promise<boolean>
  syncNow: () => Promise<boolean>

  // Focus mode (专注模式)
  getFocusState: () => Promise<FocusState>
  startFocus: (durationMin: number) => Promise<boolean>
  stopFocus: () => Promise<void>
  setFocusWhitelist: (entries: FocusApp[]) => Promise<void>
  getFocusHidden: () => Promise<string[]>
  setFocusHidden: (keys: string[]) => Promise<void>
  getFocusOrder: () => Promise<string[]>
  setFocusOrder: (keys: string[]) => Promise<void>
  getFocusColor: () => Promise<string>
  setFocusColor: (color: string) => Promise<void>
  getRunningApps: () => Promise<FocusApp[]>
  resolveAppPath: (name: string) => Promise<string>
  getAppIcon: (name: string, path: string) => Promise<string>
  getWindowUrl: (app: FocusApp) => Promise<string>
  launchFocusApp: (name: string, titleMatch?: string) => Promise<void>
  quitApp: () => Promise<void>
  onFocusTick: (cb: (data: FocusTick) => void) => () => void
}

declare global {
  interface Window {
    lanshan: LanshanApi
  }
}
