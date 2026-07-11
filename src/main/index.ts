import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { initDatabase, exportRules, importRules, closeDatabase, getSettings, setSetting, getDailyStats, getDailyBreakdown, getTotalSecondsToday, getConsecutiveDays, getMaxConsecutiveDays, getSubjectTotal, getTotalSecondsAllTime, getMergedSegments, getMergedSegmentDate, getWeekStats, getYearHeatmapData, getAchievementProgress, reclassifySegment, reclassifyByTitle, reclassifyByTitleInRange, splitSegment, mergeAdjacentSegments, getDb, updateDailyStats, getPendingUnlocks, getClassificationRules, addClassificationRule, deleteClassificationRule, reclassifyRawEventsByKeyword, getRawTitleStats, SUBJECTS, CORE_SUBJECTS, Subject, getTraySubject, setTraySubject, getUTCRange } from './database'
import { createTray, refreshTray } from './tray'
import { startSync, stopSync, syncActivityWatch, syncFullToday, rebuildMergedSegments, rebuildMergedSegmentsInRange } from './sync'
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
  ipcMain.handle('rebuild-daily-stats', (_event, date: string) => {
    const db = getDb()
    const [utcStart, utcEnd] = getUTCRange(date)
    db?.run('DELETE FROM daily_stats WHERE date = ?', [date])
    const sums = db?.exec(
      "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
      [utcStart, utcEnd]
    )
    if (sums && sums[0]) {
      for (const row of sums[0].values) {
        updateDailyStats(date, row[0] as Subject, row[1] as number)
      }
    }
  })
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
    const segDate = getMergedSegmentDate(segmentId)
    reclassifySegment(segmentId, newSubject)
    // Don't call rebuildMergedSegments (would undo manual split/merge). Just recalculate daily_stats.
    if (segDate) {
      const db = getDb()
      db?.run('DELETE FROM daily_stats WHERE date = ?', [segDate])
      const [utcStart, utcEnd] = getUTCRange(segDate)
      const sums = db?.exec(
        "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
        [utcStart, utcEnd]
      )
      if (sums && sums[0]) {
        for (const row of sums[0].values) {
          updateDailyStats(segDate, row[0] as Subject, row[1] as number)
        }
      }
    }
  })
  ipcMain.handle('reclassify-by-title', (_event, date: string, title: string, newSubject: Subject) => {
    reclassifyByTitle(date, title, newSubject)
    // Don't call rebuildMergedSegments. Just recalculate daily_stats.
    const db = getDb()
    db?.run('DELETE FROM daily_stats WHERE date = ?', [date])
    const [utcStart, utcEnd] = getUTCRange(date)
    const sums = db?.exec(
      "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
      [utcStart, utcEnd]
    )
    if (sums && sums[0]) {
      for (const row of sums[0].values) {
        updateDailyStats(date, row[0] as Subject, row[1] as number)
      }
    }
  })
  ipcMain.handle('reclassify-by-title-in-range', (_event, date: string, startTime: string, endTime: string, title: string, newSubject: Subject) => {
    reclassifyByTitleInRange(date, startTime, endTime, title, newSubject)
    // Rebuild merged segments in this range to reflect updated raw_events
    rebuildMergedSegmentsInRange(date, startTime, endTime)
    // Recalculate daily_stats from raw_events for accurate SubjectCard
    const db = getDb()
    db?.run('DELETE FROM daily_stats WHERE date = ?', [date])
    const [utcStart, utcEnd] = getUTCRange(date)
    const sums = db?.exec(
      "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
      [utcStart, utcEnd]
    )
    if (sums && sums[0]) {
      for (const row of sums[0].values) {
        updateDailyStats(date, row[0] as Subject, row[1] as number)
      }
    }
  })
  ipcMain.handle('split-segment', (_event, segmentId: number, splitTime: string) => {
    const segDate = splitSegment(segmentId, splitTime)
    if (segDate) {
      // Recalculate daily_stats from raw_events (don't use rebuildMergedSegments, which would undo the split)
      const db = getDb()
      db?.run('DELETE FROM daily_stats WHERE date = ?', [segDate])
      const [utcStart, utcEnd] = getUTCRange(segDate)
      const sums = db?.exec(
        "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
        [utcStart, utcEnd]
      )
      if (sums && sums[0]) {
        for (const row of sums[0].values) {
          updateDailyStats(segDate, row[0] as Subject, row[1] as number)
        }
      }
    }
  })
  ipcMain.handle('merge-adjacent-segments', (_event, id1: number, id2: number) => {
    const segDate = getMergedSegmentDate(id1)
    const ok = mergeAdjacentSegments(id1, id2)
    if (ok && segDate) {
      const db = getDb()
      db?.run('DELETE FROM daily_stats WHERE date = ?', [segDate])
      const [utcStart, utcEnd] = getUTCRange(segDate)
      const sums = db?.exec(
        "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
        [utcStart, utcEnd]
      )
      if (sums && sums[0]) {
        for (const row of sums[0].values) {
          updateDailyStats(segDate, row[0] as Subject, row[1] as number)
        }
      }
    }
  })
  ipcMain.handle('get-daily-breakdown', (_event, date: string) => getDailyBreakdown(date))
  ipcMain.handle('get-raw-title-stats', (_event, date: string) => getRawTitleStats(date))
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
    const updated = reclassifyRawEventsByKeyword(keyword, subject, matchField)
    console.log('[rule] reclassified', updated, 'existing raw_events for keyword:', keyword)
    const today = new Date().toLocaleDateString('sv-SE')
    rebuildMergedSegments(today)
  })
  ipcMain.handle('delete-classification-rule', (_event, id: number) => {
    deleteClassificationRule(id)
    const today = new Date().toLocaleDateString('sv-SE')
    rebuildMergedSegments(today)
  })
  ipcMain.handle('export-rules', () => exportRules())
  ipcMain.handle('import-rules', () => importRules())
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
