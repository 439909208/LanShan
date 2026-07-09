import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { initDatabase, closeDatabase, getSettings, setSetting, getDailyStats, getDailyBreakdown, getTotalSecondsToday, getConsecutiveDays, getMaxConsecutiveDays, getSubjectTotal, getTotalSecondsAllTime, getMergedSegments, getWeekStats, getYearHeatmapData, getAchievementProgress, reclassifySegment, getPendingUnlocks, getClassificationRules, addClassificationRule, deleteClassificationRule, SUBJECTS, CORE_SUBJECTS, Subject, getTraySubject, setTraySubject } from './database'
import { createTray, refreshTray } from './tray'
import { startSync, stopSync, syncActivityWatch, syncFullToday } from './sync'
import { getSubjectColor, getSubjectIcon } from './classifier'
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '澜山',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// Register IPC handlers for renderer communication
function registerIpcHandlers(): void {
  ipcMain.handle('get-settings', () => getSettings())
  ipcMain.handle('set-setting', (_event, key: string, value: string | number | boolean) => {
    setSetting(key, value)
    // Refresh tray if subject changed
    if (key === 'tray_subject') {
      refreshTray()
    }
  })
  ipcMain.handle('get-tray-subject', () => getTraySubject())
  ipcMain.handle('set-tray-subject', (_event, subject: Subject | null) => {
    setTraySubject(subject)
    refreshTray()
  })

  ipcMain.handle('get-daily-stats', (_event, date: string) => getDailyStats(date))
  ipcMain.handle('get-total-seconds-today', (_event, date: string) => getTotalSecondsToday(date))
  ipcMain.handle('get-consecutive-days', () => getConsecutiveDays())
  ipcMain.handle('get-max-consecutive-days', () => getMaxConsecutiveDays())
  ipcMain.handle('get-subject-total', (_event, subject: Subject) => getSubjectTotal(subject))
  ipcMain.handle('get-total-seconds-all-time', () => getTotalSecondsAllTime())
  ipcMain.handle('get-merged-segments', (_event, date: string) => getMergedSegments(date))
  ipcMain.handle('get-week-stats', (_event, days: number) => getWeekStats(days))
  ipcMain.handle('get-subject-color', (_event, subject: Subject) => getSubjectColor(subject))
  ipcMain.handle('get-subject-icon', (_event, subject: Subject) => getSubjectIcon(subject))
  ipcMain.handle('get-subjects', () => SUBJECTS)
  ipcMain.handle('get-core-subjects', () => CORE_SUBJECTS)
  ipcMain.handle('reclassify-segment', (_event, segmentId: number, newSubject: Subject) => {
    reclassifySegment(segmentId, newSubject)
  })
  ipcMain.handle('get-daily-breakdown', (_event, date: string) => getDailyBreakdown(date))
  ipcMain.handle('get-year-heatmap', (_event, year: number) => getYearHeatmapData(year))
  ipcMain.handle('get-achievements', () => getAchievementProgress())

  // Window controls
  ipcMain.handle('minimize-window', () => mainWindow?.minimize())
  ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('get-new-unlocks', () => getPendingUnlocks())
  ipcMain.handle('sync-now', async () => {
    await syncFullToday()
    return true
  })
  ipcMain.handle('get-classification-rules', () => getClassificationRules())
  ipcMain.handle('add-classification-rule', (_event, subject: Subject, keyword: string, matchField: string, priority: number) => {
    addClassificationRule(subject, keyword, matchField, priority)
  })
  ipcMain.handle('delete-classification-rule', (_event, id: number) => {
    deleteClassificationRule(id)
  })
  ipcMain.handle('set-auto-start', (_event, enable: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enable })
  })
  ipcMain.handle('export-data', async () => {
    const path = dialog.showSaveDialogSync({
      defaultPath: 'lanshan-data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!path) return false
    const { getSettings, getAllDailyStats, getAchievementProgress } = require('./database')
    const data = JSON.stringify({
      exported_at: new Date().toISOString(),
      settings: getSettings(),
      achievements: getAchievementProgress(),
    }, null, 2)
    writeFileSync(path, data, 'utf-8')
    return true
  })
  ipcMain.handle('close-window', () => mainWindow?.hide())
}

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase()

  // Register IPC handlers
  registerIpcHandlers()

  // Create the main window
  createWindow()

  // Create system tray (must be after app is ready)
  const tray = createTray(mainWindow!)
  
  // Start background sync
  startSync()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // On Windows, we don't quit when all windows are closed
  // We keep running in the tray
})

app.on('before-quit', () => {
  (app as any).isQuitting = true
  stopSync()
  closeDatabase()
})

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
