/// <reference types="vite/client" />

interface LanshanApi {
  getSettings: () => Promise<Record<string, string>>
  setSetting: (key: string, value: string | number | boolean) => Promise<void>
  getTraySubject: () => Promise<string | null>
  setTraySubject: (subject: string | null) => Promise<void>
  getDailyStats: (date: string) => Promise<any[]>
  getTotalSecondsToday: (date: string) => Promise<number>
  getConsecutiveDays: () => Promise<number>
  getMaxConsecutiveDays: () => Promise<number>
  getSubjectTotal: (subject: string) => Promise<number>
  getTotalSecondsAllTime: () => Promise<number>
  getMergedSegments: (date: string) => Promise<any[]>
  getWeekStats: (days: number) => Promise<any[]>
  getYearHeatmap: (year: number) => Promise<any[]>
  getDailyBreakdown: (date: string) => Promise<any[]>
  getAchievements: () => Promise<any[]>
  getNewUnlocks: () => Promise<string[]>
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
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  setAutoStart: (enable: boolean) => Promise<void>
  exportData: () => Promise<boolean>
  syncNow: () => Promise<boolean>
  exportRules: () => Promise<string>
  importRules: () => Promise<number>
}

declare global {
  interface Window {
    lanshan: LanshanApi
  }
}
