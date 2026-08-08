import { app, BrowserWindow, shell, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { initDatabase, exportRules, importRules, closeDatabase, getSettings, setSetting, getDailyStats, getDailyBreakdown, getTotalSecondsToday, getConsecutiveDays, getMaxConsecutiveDays, getSubjectTotal, getTotalSecondsAllTime, getMergedSegments, getMergedSegmentDate, getWeekStats, getYearHeatmapData, reclassifySegment, reclassifyByTitle, reclassifyByTitleInRange, splitSegment, mergeAdjacentSegments, getDb, updateDailyStats, getClassificationRules, addClassificationRule, deleteClassificationRule, reclassifyRawEventsByKeyword, getRawTitleStats, SUBJECTS, CORE_SUBJECTS, Subject, getTraySubject, setTraySubject, getUTCRange, getMakeupFills, getMakeupAvailability, applyMakeup, undoMakeup } from './database'
import { getSealDefs, getSealsOverview, getDailySealRecords, getNewSeals, setSealSlot, clearSealSlot, backfillDailySealHistory } from './seals'
import { createTray, refreshTray } from './tray'
import { startSync, stopSync, syncActivityWatch, syncFullToday, rebuildMergedSegments, rebuildMergedSegmentsInRange } from './sync'
import { getSubjectColor, getSubjectIcon } from './classifier'
import { initFocus, shutdownFocus, setFocusHooks, startFocusSession, stopFocusSession, getFocusState, setFocusWhitelist, getFocusHidden, setFocusHidden, getFocusOrder, setFocusOrder, getFocusColor, setFocusColor, getRunningApps, resolveAppPath, getAppIcon, getWindowUrl, launchFocusApp, restoreTaskbarNow, FocusApp } from './focus'
import { initSchedule, stopSchedule, isScheduleLocked } from './schedule'

// 全局异常兜底：任何未捕获异常/未处理拒绝都不让主进程直接崩溃（曾导致专注中闪退、任务栏残留）
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常:', err)
  // 尽力恢复任务栏，避免异常退出后任务栏残留隐藏
  void restoreTaskbarNow()
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝:', reason)
})
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // 窗口与正常软件一致：横向比例（宽>高）。页面内容纵向排列由渲染端负责。
  // 最大化 = 全屏（覆盖任务栏，用户要求），Esc 退出全屏。
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(1440, workArea.width - 80)
  const winH = Math.min(900, workArea.height - 60)
  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 900,
    minHeight: 600,
    maxWidth: workArea.width,
    maxHeight: workArea.height,
    // 无边框：去掉系统标题栏/最小化/最大化/关闭三键，窗口控制内置到软件界面（更清晰统一）
    frame: false,
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

  // 最大化状态广播给渲染端（内置最大化按钮图标切换用）。
  // 与常规软件一致：最大化 = 铺满工作区（任务栏保留显示）
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized', false)
  })

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
  ipcMain.handle('get-makeup-fills', (_event, year: number, month: number) => getMakeupFills(year, month))
  ipcMain.handle('get-makeup-availability', (_event, date: string) => getMakeupAvailability(date))
  ipcMain.handle('apply-makeup', (_event, date: string, subject: Subject) => applyMakeup(date, subject))
  ipcMain.handle('undo-makeup', (_event, date: string, subject: Subject) => undoMakeup(date, subject))

  // 刻章系统：定义 / 总览（含回放）/ 每日记录 / 佩戴位 / 新刻章轮询
  ipcMain.handle('get-seal-defs', () => getSealDefs())
  ipcMain.handle('get-seals-overview', (_event, date?: string) => getSealsOverview(date))
  ipcMain.handle('get-daily-seal-records', (_event, date: string) => getDailySealRecords(date))
  ipcMain.handle('get-new-seals', () => getNewSeals())
  ipcMain.handle('set-seal-slot', (_event, slot: number, sealId: string) => setSealSlot(slot, sealId))
  ipcMain.handle('clear-seal-slot', (_event, slot: number) => clearSealSlot(slot))

  // Window controls（无边框内置按钮）：最大化 = 铺满工作区（与常规软件一致，任务栏保留）
  ipcMain.handle('minimize-window', () => mainWindow?.minimize())
  ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('sync-now', async () => {
    await syncFullToday()
    return true
  })

  // Focus mode (专注模式)
  ipcMain.handle('get-focus-state', () => getFocusState())
  ipcMain.handle('start-focus', (_event, durationMin: number) => startFocusSession(durationMin))
  ipcMain.handle('stop-focus', () => {
    // 严格模式学习时段内锁定：拒绝提前结束专注（时段结束自动解锁）
    if (isScheduleLocked()) {
      console.log('[focus] 严格模式学习时段内，拒绝手动结束专注')
      return
    }
    try {
      stopFocusSession()
    } catch (err) {
      console.error('[focus] stop-focus 异常:', err)
      // 兜底：即使异常也要确保锁被拆掉
      try { stopFocusSession() } catch { /* 忽略 */ }
    }
  })
  ipcMain.handle('set-focus-whitelist', (_event, entries: FocusApp[]) => setFocusWhitelist(entries))
  ipcMain.handle('get-focus-hidden', () => getFocusHidden())
  ipcMain.handle('set-focus-hidden', (_event, keys: string[]) => setFocusHidden(keys))
  ipcMain.handle('get-focus-order', () => getFocusOrder())
  ipcMain.handle('set-focus-order', (_event, keys: string[]) => setFocusOrder(keys))
  ipcMain.handle('get-focus-color', () => getFocusColor())
  ipcMain.handle('set-focus-color', (_event, color: string) => setFocusColor(color))
  ipcMain.handle('get-running-apps', () => getRunningApps())
  ipcMain.handle('resolve-app-path', (_event, name: string) => resolveAppPath(name))
  ipcMain.handle('get-app-icon', (_event, name: string, path: string) => getAppIcon(name, path))
  ipcMain.handle('get-window-url', (_event, app: FocusApp) => getWindowUrl(app))
  ipcMain.handle('launch-focus-app', (_event, name: string, titleMatch?: string) => launchFocusApp(name, titleMatch))
  ipcMain.handle('quit-app', async () => {
    // 严格模式学习时段内锁定：禁止退出应用（退出会绕过专注锁定）
    if (isScheduleLocked()) {
      console.log('[focus] 严格模式学习时段内，拒绝退出应用')
      return
    }
    // 专注桌面的逃生口：结束专注 + 完全退出应用
    try {
      stopFocusSession()
    } catch (err) {
      console.error('[focus] quit-app 异常:', err)
    }
    // 必须等任务栏恢复完成再退出（stopFocusSession 内是异步的，进程退出太快会来不及恢复）
    try {
      await restoreTaskbarNow()
    } catch (err) {
      console.error('[focus] 恢复任务栏失败:', err)
    }
    app.quit()
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
    const { getSettings } = require('./database')
    const { getSealsOverview } = require('./seals')
    const data = JSON.stringify({
      exported_at: new Date().toISOString(),
      settings: getSettings(),
      seals: getSealsOverview(),
    }, null, 2)
    writeFileSync(path, data, 'utf-8')
    return true
  })
  ipcMain.handle('close-window', () => mainWindow?.hide())
}

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase()

  // 刻章系统 v5：首次升级回填全部历史日期的每日刻章记录
  const backfilled = backfillDailySealHistory()
  if (backfilled > 0) console.log('[seal] Backfilled', backfilled, 'daily seal records')

  // Register IPC handlers
  registerIpcHandlers()

  // Create the main window
  createWindow()

  // Create system tray (must be after app is ready)
  const tray = createTray(mainWindow!)
  
  // Start background sync
  startSync()

  // Focus mode: 注入主窗口钩子 + 恢复未完成的专注会话
  setFocusHooks({ getMainWindow: () => mainWindow, isScheduleLocked })
  initFocus()
  // 专注日程模式：到点自动进入/结束专注（initFocus 之后启动，衔接崩溃恢复的会话）
  initSchedule()

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
  stopSchedule()
  shutdownFocus()  // 保留持久化会话，重启后由 initFocus 恢复
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
