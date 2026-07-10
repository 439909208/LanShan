import { Notification } from 'electron'
import { fetchEventsSince, AWEvent } from './activitywatch'
import { classifyEvent } from './classifier'
import {
  insertRawEvent,
  clearMergedSegments,
  insertMergedSegment,
  updateDailyStats,
  save,
  getDb,
  Subject,
  MergedSegment,
  getTargetSeconds,
  checkAndUnlockAchievements,
  getSetting,
  setSetting,
  getMergedSegments,
} from './database'

let syncInterval: ReturnType<typeof setInterval> | null = null

const SYNC_INTERVAL_MS = 30_000  // every 30 seconds
const MERGE_GAP_SECONDS = 300      // 5 minutes — same-subject events within this gap merge into one segment
const NOISE_THRESHOLD_SECONDS = 30 // skip events shorter than 30s
const GAP_SECONDS = 300            // 5 min gap = blank space
const INTERLUDE_THRESHOLD = 300    // 5 min non-study = interlude

/**
 * Start the background sync loop.
 */
export function startSync(): void {
  if (syncInterval) return
  syncLoop() // run immediately
  syncInterval = setInterval(syncLoop, SYNC_INTERVAL_MS)
  console.log('[sync] Started background sync every 30s')
}

/**
 * Stop the background sync loop.
 */
export function stopSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
    console.log('[sync] Stopped')
  }
}

async function syncLoop(): Promise<void> {
  try {
    await syncActivityWatch()
    checkEntertainmentReminder()
    checkEveningReminder()
  } catch (err) {
    console.error('[sync] Error in sync loop:', err)
  }
}

/**
 * Main sync function: fetch recent events from ActivityWatch, classify, merge, store.
 */
export async function syncActivityWatch(): Promise<void> {
  const now = new Date()
  const today = new Date().toLocaleDateString('sv-SE')
  // Fetch last 2 hours to cover recent activity + catch any delayed events
  const start = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const end = now.toISOString()

  const events = await fetchEventsSince(start, end)
  if (events.length === 0) return

  // Process and store raw events
  for (const awEvent of events) {
    const duration = awEvent.duration
    if (duration < NOISE_THRESHOLD_SECONDS) continue

    const title = awEvent.data?.title || ''
    const app = awEvent.data?.app || ''
    const url = awEvent.data?.url || null

    const result = classifyEvent(title, app, url)
    if (!result) continue  // 不相关条目，跳过不入库

    const { subject } = result

    insertRawEvent({
      aw_id: String(awEvent.id),
      timestamp: new Date(awEvent.timestamp),
      duration,
      app,
      title,
      url,
      subject,
    })
  }

  // Rebuild merged segments for today
  rebuildMergedSegments(today)

  // Check for newly unlocked achievements
  const newUnlocks = checkAndUnlockAchievements()
  if (newUnlocks.length > 0) {
    console.log('[achievement] New unlocks:', newUnlocks)
  }

  save()
}

/** 拉取今天全天数据（手动刷新时调用） */
export async function syncFullToday(): Promise<void> {
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE')
  const start = `${today}T00:00:00+08:00`
  const end = now.toISOString()

  // Clear today's old data so new classification rules take effect
  const db = getDb()
  db?.run(`DELETE FROM raw_events WHERE timestamp >= ? AND timestamp <= ?`, [`${today}T00:00:00`, `${today}T23:59:59`])
  clearMergedSegments(today)
  db?.run("DELETE FROM daily_stats WHERE date = ?", [today])

  console.log('[sync-full] Fetching from', start, 'to', end)

  const events = await fetchEventsSince(start, end)
  console.log('[sync-full] AW returned', events.length, 'events')

  let noiseDropped = 0
  let classifiedDropped = 0
  let stored = 0
  const droppedSamples: string[] = []

  for (const awEvent of events) {
    const duration = awEvent.duration
    if (duration < NOISE_THRESHOLD_SECONDS) {
      noiseDropped++
      continue
    }

    const title = awEvent.data?.title || ''
    const app = awEvent.data?.app || ''
    const url = awEvent.data?.url || null
    const result = classifyEvent(title, app, url)
    if (!result) {
      classifiedDropped++
      if (droppedSamples.length < 10) {
        droppedSamples.push('[' + app + '] ' + title + ' (' + duration + 's)')
      }
      continue
    }
    insertRawEvent({
      aw_id: String(awEvent.id),
      timestamp: new Date(awEvent.timestamp),
      duration, app, title, url,
      subject: result.subject,
    })
    stored++
  }

  console.log('[sync-full] noise:', noiseDropped, 'classified-dropped:', classifiedDropped, 'stored:', stored)
  if (droppedSamples.length > 0) {
    console.log('[sync-full] Dropped samples:', droppedSamples)
  }

  rebuildMergedSegments(today)

  const segs = getMergedSegments(today)
  const totalSec = segs.reduce((s, seg) => s + seg.duration, 0)
  console.log('[sync-full] Merged segments:', segs.length, 'total:', totalSec, 's =', Math.round(totalSec / 60), 'min')

  save()
}

/**
 * Rebuild merged segments for a given date from raw events.
 */
export function rebuildMergedSegments(date: string): void {
  const db = getDb()
  
  // Get all classified raw events for this date, sorted by timestamp
  const result = db.exec(`
    SELECT timestamp, duration, app, title, subject
    FROM raw_events
    WHERE timestamp >= ? AND timestamp < ?
    ORDER BY timestamp ASC
  `, [date, getNextDate(date)])

  if (!result || result.length === 0) return

  const rows = result[0].values.map(row => ({
    timestamp: new Date(row[0] as string),
    duration: row[1] as number,
    app: row[2] as string,
    title: row[3] as string,
    subject: row[4] as Subject,
  }))

  // Clear old merged segments for this date
  clearMergedSegments(date)

  // Merge algorithm
  const merged = mergeSegments(rows)

  // Clear old merged segments for this date
  clearMergedSegments(date)
  
  // Insert parent segments + exploded children
  for (const segment of merged) {
    const safeTitle = String(segment.title ?? '')
    const safeApp = String(segment.app ?? '')
    db?.run(
      'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)',
      [date, segment.start_time, segment.end_time, segment.duration, segment.subject, safeTitle, safeApp]
    )
    if (segment.constituents.length > 1) {
      const idRow = db?.exec('SELECT last_insert_rowid()')
      const parentId = idRow?.[0]?.values?.[0]?.[0] as number
      if (parentId != null) {
        const stmt = db.prepare(
          'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
        )
        for (const c of segment.constituents) {
          stmt.run([date, segment.start_time, segment.end_time, c.duration, segment.subject, String(c.title ?? ''), String(c.app ?? ''), parentId])
        }
        stmt.free()
      }
    }
  }

  // Update daily stats for each subject
  const subjectTotals = new Map<Subject, number>()
  for (const segment of merged) {
    const current = subjectTotals.get(segment.subject) || 0
    subjectTotals.set(segment.subject, current + segment.duration)
  }

  for (const [subject, totalSeconds] of subjectTotals) {
    if (subject === '未分类' || subject === '其他') continue
    updateDailyStats(date, subject, totalSeconds)
  }
}

interface RawEntry {
  timestamp: Date
  duration: number
  app: string
  title: string
  subject: Subject
}

interface MergedEntry {
  start_time: string
  end_time: string
  duration: number
  subject: Subject
  title: string
  app: string
  constituents: { title: string; app: string; duration: number }[]
}

function mergeSegments(entries: RawEntry[]): MergedEntry[] {
  if (entries.length === 0) return []

  const merged: MergedEntry[] = []
  let current: {
    subject: Subject
    start: Date
    end: Date
    duration: number
    titleDurations: Map<string, number>
    apps: Set<string>
    constituents: { title: string; app: string; duration: number }[]
  } | null = null

  const isStudy = (subject: Subject): boolean => {
    return subject !== '休闲' && subject !== '未分类' && subject !== '其他'
  }

  for (const entry of entries) {
    if (current === null) {
      const td = new Map<string, number>()
      td.set(entry.title, entry.duration)
      current = {
        subject: entry.subject,
        start: entry.timestamp,
        end: new Date(entry.timestamp.getTime() + entry.duration * 1000),
        duration: entry.duration,
        titleDurations: td,
        apps: new Set([entry.app]),
        constituents: [{ title: entry.title, app: entry.app, duration: entry.duration }],
      }
      continue
    }

    const entryEnd = new Date(entry.timestamp.getTime() + entry.duration * 1000)
    const gap = entry.timestamp.getTime() - current.end.getTime()
    const currentIsStudy = isStudy(current.subject)
    const entryIsStudy = isStudy(entry.subject)

    // Rule: Same subject + adjacent (< 5 min gap) → merge
    if (current.subject === entry.subject && gap >= 0 && gap < MERGE_GAP_SECONDS * 1000) {
      current.end = entryEnd
      current.duration += entry.duration
      current.titleDurations.set(entry.title, (current.titleDurations.get(entry.title) || 0) + entry.duration)
      current.apps.add(entry.app)
      current.constituents.push({ title: entry.title, app: entry.app, duration: entry.duration })
      continue
    }

    // Rule ④: Study segment + short non-study interlude (< 5 min) → absorb into study segment
    if (currentIsStudy && !entryIsStudy && gap >= 0 && gap < INTERLUDE_THRESHOLD * 1000 && entry.duration < INTERLUDE_THRESHOLD) {
      current.end = entryEnd
      current.duration += entry.duration   // short non-study counts toward study time
      current.titleDurations.set(entry.title, (current.titleDurations.get(entry.title) || 0) + entry.duration)
      current.apps.add(entry.app)
      current.constituents.push({ title: entry.title, app: entry.app, duration: entry.duration })
      continue
    }

    // Save current segment — find the title with the longest total duration
    let bestTitle = current.titleDurations.keys().next().value as string
    let bestDur = 0
    for (const [t, d] of current.titleDurations) {
      if (d > bestDur) { bestDur = d; bestTitle = t }
    }
    merged.push({
      start_time: current.start.toISOString(),
      end_time: current.end.toISOString(),
      duration: current.duration,
      subject: current.subject,
      title: bestTitle,
      app: Array.from(current.apps)[0] || '',
      constituents: current.constituents,
    })

    // Start new segment
    const td2 = new Map<string, number>()
    td2.set(entry.title, entry.duration)
    current = {
      subject: entry.subject,
      start: entry.timestamp,
      end: entryEnd,
      duration: entry.duration,
      titleDurations: td2,
      apps: new Set([entry.app]),
      constituents: [{ title: entry.title, app: entry.app, duration: entry.duration }],
    }
  }

  // Push last segment
  if (current) {
    let bestTitle = current.titleDurations.keys().next().value as string
    let bestDur = 0
    for (const [t, d] of current.titleDurations) {
      if (d > bestDur) { bestDur = d; bestTitle = t }
    }
    merged.push({
      start_time: current.start.toISOString(),
      end_time: current.end.toISOString(),
      duration: current.duration,
      subject: current.subject,
      title: bestTitle,
      app: Array.from(current.apps)[0] || '',
      constituents: current.constituents,
    })
  }

  // Post-process: drop segments shorter than 60 seconds
  return merged.filter(s => s.duration >= 60)
}

function getNextDate(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

/** 休闲超时提醒：检测休闲连续时长 ≥ 阈值 → 系统通知 */
function checkEntertainmentReminder(): void {
  const enabled = getSetting('entertainment_reminder')
  if (enabled !== 'true') return
  const threshold = parseInt(getSetting('entertainment_threshold') || '1800', 10)
  const today = new Date().toISOString().split('T')[0]
  const db = getDb()
  // 查今天娱乐合并段
  const segs = db.exec(
    'SELECT duration FROM merged_segments WHERE date = ? AND subject = ? ORDER BY start_time DESC LIMIT 1',
    [today, '休闲']
  )
  if (!segs || segs.length === 0 || segs[0].values.length === 0) return
  const lastDuration = segs[0].values[0][0] as number
  if (lastDuration < threshold) return
  // 2小时内只提醒一次
  const lastRemind = getSetting('last_entertainment_remind')
  if (lastRemind && Date.now() - parseInt(lastRemind, 10) < 7200000) return
  setSetting('last_entertainment_remind', String(Date.now()))
  new Notification({ title: '澜山', body: '已经刷了 ' + Math.round(lastDuration / 60) + ' 分钟啦~要回来吗？🍃' }).show()
}

/** 晚间空窗提醒：21:00 检测今天无学习 → 系统通知，每周最多2次 */
function checkEveningReminder(): void {
  const enabled = getSetting('evening_reminder')
  if (enabled !== 'true') return
  const now = new Date()
  if (now.getHours() < 21) return // 21:00后才检查
  const today = now.toISOString().split('T')[0]
  const db = getDb()
  const total = db.exec('SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE date = ?', [today])
  const secs = (total?.[0]?.values?.[0]?.[0] as number) || 0
  if (secs > 0) return // 有学习就不提醒
  // 每周最多2次
  const weekCount = db.exec(
    "SELECT COUNT(*) FROM settings WHERE key = 'evening_remind_weeks' AND value >= CAST(strftime('%W', 'now') AS INTEGER)"
  )
  // 简单计数：查本周已提醒次数
  const r = db.exec("SELECT value FROM settings WHERE key = 'evening_remind_count'")
  const count = (r?.[0]?.values?.[0]?.[0] as number) || 0
  if (count >= 2) return
  setSetting('evening_remind_count', String(count + 1))
  new Notification({ title: '澜山', body: '今晚还没有学习记录呢~不过累了就好好休息 💤' }).show()
}
