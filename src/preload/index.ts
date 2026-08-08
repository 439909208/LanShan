import { contextBridge, ipcRenderer } from 'electron'
import { Subject } from '../main/database'
import type { FocusApp, FocusState, FocusTick } from '../main/focus'

const api = {
  // Settings
  getSettings: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-settings'),
  setSetting: (key: string, value: string | number | boolean): Promise<void> => ipcRenderer.invoke('set-setting', key, value),

  // Tray subject
  getTraySubject: (): Promise<Subject | null> => ipcRenderer.invoke('get-tray-subject'),
  setTraySubject: (subject: Subject | null): Promise<void> => ipcRenderer.invoke('set-tray-subject', subject),

  // Stats
  getDailyStats: (date: string): Promise<any[]> => ipcRenderer.invoke('get-daily-stats', date),
  rebuildDailyStats: (date: string): Promise<void> => ipcRenderer.invoke('rebuild-daily-stats', date),
  getTotalSecondsToday: (date: string): Promise<number> => ipcRenderer.invoke('get-total-seconds-today', date),
  getConsecutiveDays: (): Promise<number> => ipcRenderer.invoke('get-consecutive-days'),
  getMaxConsecutiveDays: (): Promise<number> => ipcRenderer.invoke('get-max-consecutive-days'),
  getSubjectTotal: (subject: Subject): Promise<number> => ipcRenderer.invoke('get-subject-total', subject),
  getTotalSecondsAllTime: (): Promise<number> => ipcRenderer.invoke('get-total-seconds-all-time'),
  getMergedSegments: (date: string): Promise<any[]> => ipcRenderer.invoke('get-merged-segments', date),
  getWeekStats: (days: number): Promise<any[]> => ipcRenderer.invoke('get-week-stats', days),
  getYearHeatmap: (year: number): Promise<any[]> => ipcRenderer.invoke('get-year-heatmap', year),
  getMakeupFills: (year: number, month: number): Promise<any[]> => ipcRenderer.invoke('get-makeup-fills', year, month),
  getMakeupAvailability: (date: string): Promise<any[]> => ipcRenderer.invoke('get-makeup-availability', date),
  applyMakeup: (date: string, subject: Subject): Promise<{ ok: boolean; message: string; amount: number }> =>
    ipcRenderer.invoke('apply-makeup', date, subject),
  undoMakeup: (date: string, subject: Subject): Promise<void> => ipcRenderer.invoke('undo-makeup', date, subject),
  getDailyBreakdown: (date: string): Promise<any[]> => ipcRenderer.invoke('get-daily-breakdown', date),
  getRawTitleStats: (date: string): Promise<{ title: string; duration: number; subject: string }[]> => ipcRenderer.invoke('get-raw-title-stats', date),
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
  reclassifyByTitle: (date: string, title: string, newSubject: Subject): Promise<void> =>
    ipcRenderer.invoke('reclassify-by-title', date, title, newSubject),
  reclassifyByTitleInRange: (date: string, startTime: string, endTime: string, title: string, newSubject: Subject): Promise<void> =>
    ipcRenderer.invoke('reclassify-by-title-in-range', date, startTime, endTime, title, newSubject),
  splitSegment: (segmentId: number, splitTime: string): Promise<void> =>
    ipcRenderer.invoke('split-segment', segmentId, splitTime),
  mergeAdjacentSegments: (id1: number, id2: number): Promise<boolean> =>
    ipcRenderer.invoke('merge-adjacent-segments', id1, id2),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('maximize-window'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('close-window'),
  setAutoStart: (enable: boolean): Promise<void> => ipcRenderer.invoke('set-auto-start', enable),
  exportData: (): Promise<boolean> => ipcRenderer.invoke('export-data'),
  syncNow: (): Promise<boolean> => ipcRenderer.invoke('sync-now'),

  // Focus mode (专注模式)
  getFocusState: (): Promise<FocusState> => ipcRenderer.invoke('get-focus-state'),
  startFocus: (durationMin: number): Promise<boolean> => ipcRenderer.invoke('start-focus', durationMin),
  stopFocus: (): Promise<void> => ipcRenderer.invoke('stop-focus'),
  setFocusWhitelist: (entries: FocusApp[]): Promise<void> => ipcRenderer.invoke('set-focus-whitelist', entries),
  getFocusHidden: (): Promise<string[]> => ipcRenderer.invoke('get-focus-hidden'),
  setFocusHidden: (keys: string[]): Promise<void> => ipcRenderer.invoke('set-focus-hidden', keys),
  getFocusOrder: (): Promise<string[]> => ipcRenderer.invoke('get-focus-order'),
  setFocusOrder: (keys: string[]): Promise<void> => ipcRenderer.invoke('set-focus-order', keys),
  getFocusColor: (): Promise<string> => ipcRenderer.invoke('get-focus-color'),
  setFocusColor: (color: string): Promise<void> => ipcRenderer.invoke('set-focus-color', color),
  getRunningApps: (): Promise<FocusApp[]> => ipcRenderer.invoke('get-running-apps'),
  resolveAppPath: (name: string): Promise<string> => ipcRenderer.invoke('resolve-app-path', name),
  getAppIcon: (name: string, path: string): Promise<string> => ipcRenderer.invoke('get-app-icon', name, path),
  getWindowUrl: (app: FocusApp): Promise<string> => ipcRenderer.invoke('get-window-url', app),
  launchFocusApp: (name: string, titleMatch?: string): Promise<void> => ipcRenderer.invoke('launch-focus-app', name, titleMatch),
  quitApp: (): Promise<void> => ipcRenderer.invoke('quit-app'),
  onFocusTick: (cb: (data: FocusTick) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: FocusTick) => cb(data)
    ipcRenderer.on('focus-tick', listener)
    return () => { ipcRenderer.removeListener('focus-tick', listener) }
  },
}

contextBridge.exposeInMainWorld('lanshan', api)

export type LanshanApi = typeof api
