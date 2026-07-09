import { contextBridge, ipcRenderer } from 'electron'
import { Subject } from '../main/database'

const api = {
  // Settings
  getSettings: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-settings'),
  setSetting: (key: string, value: string | number | boolean): Promise<void> => ipcRenderer.invoke('set-setting', key, value),

  // Tray subject
  getTraySubject: (): Promise<Subject | null> => ipcRenderer.invoke('get-tray-subject'),
  setTraySubject: (subject: Subject | null): Promise<void> => ipcRenderer.invoke('set-tray-subject', subject),

  // Stats
  getDailyStats: (date: string): Promise<any[]> => ipcRenderer.invoke('get-daily-stats', date),
  getTotalSecondsToday: (date: string): Promise<number> => ipcRenderer.invoke('get-total-seconds-today', date),
  getConsecutiveDays: (): Promise<number> => ipcRenderer.invoke('get-consecutive-days'),
  getMaxConsecutiveDays: (): Promise<number> => ipcRenderer.invoke('get-max-consecutive-days'),
  getSubjectTotal: (subject: Subject): Promise<number> => ipcRenderer.invoke('get-subject-total', subject),
  getTotalSecondsAllTime: (): Promise<number> => ipcRenderer.invoke('get-total-seconds-all-time'),
  getMergedSegments: (date: string): Promise<any[]> => ipcRenderer.invoke('get-merged-segments', date),
  getWeekStats: (days: number): Promise<any[]> => ipcRenderer.invoke('get-week-stats', days),
  getYearHeatmap: (year: number): Promise<any[]> => ipcRenderer.invoke('get-year-heatmap', year),
  getDailyBreakdown: (date: string): Promise<any[]> => ipcRenderer.invoke('get-daily-breakdown', date),
  getAchievements: (): Promise<any[]> => ipcRenderer.invoke('get-achievements'),
  getNewUnlocks: (): Promise<string[]> => ipcRenderer.invoke('get-new-unlocks'),

  // Display helpers
  getSubjectColor: (subject: Subject): Promise<string> => ipcRenderer.invoke('get-subject-color', subject),
  getSubjectIcon: (subject: Subject): Promise<string> => ipcRenderer.invoke('get-subject-icon', subject),
  getSubjects: (): Promise<Subject[]> => ipcRenderer.invoke('get-subjects'),
  getCoreSubjects: (): Promise<Subject[]> => ipcRenderer.invoke('get-core-subjects'),
  getClassificationRules: (): Promise<any[]> => ipcRenderer.invoke('get-classification-rules'),
  addClassificationRule: (subject: Subject, keyword: string, matchField: string, priority: number): Promise<void> =>
    ipcRenderer.invoke('add-classification-rule', subject, keyword, matchField, priority),
  deleteClassificationRule: (id: number): Promise<void> => ipcRenderer.invoke('delete-classification-rule', id),

  // Actions
  reclassifySegment: (segmentId: number, newSubject: Subject): Promise<void> =>
    ipcRenderer.invoke('reclassify-segment', segmentId, newSubject),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('maximize-window'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('close-window'),
  setAutoStart: (enable: boolean): Promise<void> => ipcRenderer.invoke('set-auto-start', enable),
  exportData: (): Promise<boolean> => ipcRenderer.invoke('export-data'),
  syncNow: (): Promise<boolean> => ipcRenderer.invoke('sync-now'),
}

contextBridge.exposeInMainWorld('lanshan', api)

export type LanshanApi = typeof api
