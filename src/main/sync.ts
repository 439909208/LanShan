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
  getDailyStats,
  getUTCRange,
} from './database'

let syncInterval: ReturnType<typeof setInterval> | null = null

const SYNC_INTERVAL_MS = 30_000  // every 30 seconds
const MERGE_GAP_SECONDS = 300      // 5 minutes — same-subject events within this gap merge into one segment
const NOISE_THRESHOLD_SECONDS = 0 // don't drop anything — keep all AW data
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
  if (events.length === 0) { console.log('[sync] No events from AW in last 2h'); return }

  // Diagnostic: log AW data coverage
  if (events.length > 0) {
    const first = new Date(events[0].timestamp)
    const last = new Date(events[events.length - 1].timestamp)
    console.log('[sync] AW returned', events.length, 'events, span:', first.toLocaleTimeString('zh-CN', {hour12:false}),
      '→', last.toLocaleTimeString('zh-CN', {hour12:false}),
      '(', Math.round((last.getTime() - first.getTime()) / 60000), 'min )')
  }

  // Process and store raw events
  // Build set of existing AW event IDs to avoid re-classifying old events
  const db = getDb()
  const existingRows = db?.exec('SELECT aw_id FROM raw_events')
  const existingIds = new Set<string>()
  if (existingRows && existingRows[0]) {
    for (const row of existingRows[0].values) {
      existingIds.add(row[0] as string)
    }
  }

  let minNewTime: string | null = null
  let maxNewTime: string | null = null

  for (const awEvent of events) {
    const duration = awEvent.duration
    if (duration < NOISE_THRESHOLD_SECONDS) continue

    // Skip if already in DB — preserve original classification
    if (existingIds.has(String(awEvent.id))) continue

    const title = awEvent.data?.title || ''
    const app = awEvent.data?.app || ''
    const url = awEvent.data?.url || null

    const result = classifyEvent(title, app, url)
    if (!result) continue  // 不相关条目，跳过不入库

    const { subject } = result

    const ts = new Date(awEvent.timestamp)
    insertRawEvent({
      aw_id: String(awEvent.id),
      timestamp: ts,
      duration,
      app,
      title,
      url,
      subject,
    })
    const tsISO = ts.toISOString()
    if (minNewTime === null || tsISO < minNewTime) minNewTime = tsISO
    if (maxNewTime === null || tsISO > maxNewTime) maxNewTime = tsISO
  }

  // Update daily_stats from raw_events (don't rebuild merged_segments — would overwrite manual split/merge)
  if (minNewTime && maxNewTime) {
    const sums = db.exec(
      'SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject',
      getUTCRange(today)
    )
    if (sums && sums[0]) {
      for (const row of sums[0].values) {
        const subject = row[0] as Subject
        const totalSeconds = row[1] as number
        updateDailyStats(today, subject, totalSeconds)
      }
    }
  }

  // Check for newly unlocked achievements
  const newUnlocks = checkAndUnlockAchievements()
  if (newUnlocks.length > 0) {
    console.log('[achievement] New unlocks:', newUnlocks)
  }

  save()
}

/** 拉取今天全天数据（手动刷新时调用）— 全量重建，恢复被意外删除的数据 */
export async function syncFullToday(): Promise<void> {
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE')
  const start = `${today}T00:00:00+08:00`
  const end = now.toISOString()

  // Clear merged segments and daily_stats — full rebuild from raw_events
  const db = getDb()
  clearMergedSegments(today)
  db?.run("DELETE FROM daily_stats WHERE date = ?", [today])
  // 清除今天 daily_stats 中的非核心科目脏数据
  db?.run("DELETE FROM daily_stats WHERE date = ? AND subject NOT IN ('物理','数学','英语')", [today])

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
    // 诊断：打印 FREE高考英语 事件的科目分配情况
    if (title.includes('FREE高考英语') || title.includes('零基础')) {
      console.log('[sync-full DIAG]', title, 'duration:', duration, 's =', Math.round(duration / 60), 'min, subject:', result.subject)
    }
  }

  console.log('[sync-full] noise:', noiseDropped, 'classified-dropped:', classifiedDropped, 'stored:', stored)
  if (droppedSamples.length > 0) {
    console.log('[sync-full] Dropped samples:', droppedSamples)
  }

  // 对兜底分类（其他/未分类）的 raw_events 用最新规则重新分类，不影响用户手动修改的科目
  const fallbackRows = db.exec(
    "SELECT aw_id, title, app, url FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IN ('其他', '未分类')",
    getUTCRange(today)
  )
  if (fallbackRows && fallbackRows[0]) {
    let reclassified = 0
    for (const row of fallbackRows[0].values) {
      const [awId, title, app, url] = row as [string, string, string, string | null]
      const newResult = classifyEvent(title, app, url)
      if (newResult && newResult.subject !== '其他' && newResult.subject !== '未分类') {
        db?.run('UPDATE raw_events SET subject = ? WHERE aw_id = ?', [newResult.subject, awId])
        reclassified++
      }
    }
    if (reclassified > 0) {
      console.log('[sync-full] reclassified', reclassified, 'fallback raw_events')
      // 打印按科目的分布
      const dist = db.exec("SELECT subject, COUNT(*) as cnt FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject NOT IN ('其他', '未分类') GROUP BY subject ORDER BY cnt DESC", getUTCRange(today))
      if (dist && dist[0]) {
        for (const row of dist[0].values) {
          console.log('  ', row[0], ':', row[1], 'events')
        }
      }
    }
  }

  // Full rebuild from ALL raw_events — restores any data eaten by previous rebuild-in-range bugs
  rebuildMergedSegments(today)

  const segs = getMergedSegments(today)
  const totalSec = segs.reduce((s, seg) => s + seg.duration, 0)
  console.log('[sync-full] Merged segments:', segs.length, 'total:', totalSec, 's =', Math.round(totalSec / 60), 'min')

  // DIAG: English total by title — find what contributes the extra minutes
  const engTitles = db.exec(
    "SELECT title, COALESCE(SUM(duration),0) as sec FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject = '英语' GROUP BY title ORDER BY sec DESC",
    getUTCRange(today)
  )
  if (engTitles && engTitles[0]) {
    const parts: string[] = []
    for (const row of engTitles[0].values) {
      parts.push('"' + (row[0] as string).substring(0, 60) + '":' + Math.round((row[1] as number) / 60) + 'min')
    }
    console.log('[sync-full] 英语 by title:', parts.join(', '))
  }

  // DIAG: per-subject totals from raw_events vs merged_segments vs daily_stats
  const rawPerSubject = db.exec(
    "SELECT subject, COALESCE(SUM(duration),0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject ORDER BY subject",
    getUTCRange(today)
  )
  if (rawPerSubject && rawPerSubject[0]) {
    const parts: string[] = []
    for (const row of rawPerSubject[0].values) {
      const s = row[0] as string
      parts.push(s + ':' + Math.round((row[1] as number) / 60) + 'min')
    }
    console.log('[sync-full] DIAG raw_events:', parts.join(', '))
  }
  const msPerSubject = db.exec(
    "SELECT subject, COALESCE(SUM(duration),0) FROM merged_segments WHERE date = ? AND is_exploded = 0 GROUP BY subject ORDER BY subject",
    [today]
  )
  if (msPerSubject && msPerSubject[0]) {
    const parts: string[] = []
    for (const row of msPerSubject[0].values) {
      const s = row[0] as string
      parts.push(s + ':' + Math.round((row[1] as number) / 60) + 'min')
    }
    console.log('[sync-full] DIAG merged_segments:', parts.join(', '))
  }
  const dsPerSubject = getDailyStats(today)
  if (dsPerSubject.length > 0) {
    const parts = dsPerSubject.map(d => d.subject + ':' + Math.round(d.total_seconds / 60) + 'min')
    console.log('[sync-full] DIAG daily_stats:', parts.join(', '))
  }

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
  `, getUTCRange(date))

  if (!result || result.length === 0) return

  const rows = result[0].values.map(row => ({
    timestamp: new Date(row[0] as string),
    duration: row[1] as number,
    app: row[2] as string,
    title: row[3] as string,
    subject: row[4] as Subject,
  }))

  // Save manual subject overrides before clearing (user_subject IS NOT NULL)
  type Override = { start: string; end: string; subj: Subject }
  const overrides: Override[] = []
  const oldOverrides = db?.exec(
    "SELECT start_time, end_time, user_subject FROM merged_segments WHERE date = ? AND is_exploded = 0 AND user_subject IS NOT NULL",
    [date]
  )
  if (oldOverrides && oldOverrides[0]) {
    for (const row of oldOverrides[0].values) {
      overrides.push({
        start: row[0] as string,
        end: row[1] as string,
        subj: row[2] as Subject,
      })
    }
  }

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
          stmt.run([date, segment.start_time, segment.end_time, c.duration, c.subject, String(c.title ?? ''), String(c.app ?? ''), parentId])
        }
        stmt.free()
      }
    }

    // Restore manual subject override if this segment overlaps with a saved one
    const newId = db?.exec('SELECT last_insert_rowid()')?.[0]?.values?.[0]?.[0] as number | undefined
    if (newId != null) {
      for (const ov of overrides) {
        if (segment.start_time < ov.end && segment.end_time > ov.start) {
          const durRow = db?.exec(
            'SELECT COALESCE(SUM(duration), 0) FROM merged_segments WHERE parent_id = ? AND subject = ?',
            [newId, ov.subj]
          )
          const userDur = durRow?.[0]?.values?.[0]?.[0] as number ?? 0
          db?.run(
            'UPDATE merged_segments SET subject = ?, user_subject = ?, duration = ? WHERE id = ?',
            [ov.subj, ov.subj, userDur, newId]
          )
          break
        }
      }
    }
  }

  // Update daily stats for each subject
  // Calculate daily_stats directly from raw_events for accurate per-subject totals
  // (merged segments may absorb fragments across subjects for display purposes)
  const rawTotals = db.exec(
    "SELECT subject, COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY subject",
    getUTCRange(date)
  )
  if (rawTotals && rawTotals[0]) {
    for (const row of rawTotals[0].values) {
      const subject = row[0] as Subject
      const totalSeconds = row[1] as number
      updateDailyStats(date, subject, totalSeconds)
    }
  }
}

/**
 * Rebuild merged segments only within a specific time range, preserving segments outside it.
 * Used by auto-sync to avoid overwriting manual split/merge operations.
 */
export function rebuildMergedSegmentsInRange(date: string, startTime: string, endTime: string): void {
  const db = getDb()

  // Delete only merged_segments overlapping this range
  db?.run(
    'DELETE FROM merged_segments WHERE date = ? AND start_time < ? AND end_time > ?',
    [date, endTime, startTime]
  )

  // Get raw events from an expanded range (include margin for gap-fill merging)
  const expandedStart = new Date(new Date(startTime).getTime() - 10 * 60 * 1000).toISOString()
  const expandedEnd = new Date(new Date(endTime).getTime() + 10 * 60 * 1000).toISOString()
  const result = db.exec(`
    SELECT timestamp, duration, app, title, subject
    FROM raw_events
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `, [expandedStart, expandedEnd])

  if (!result || result.length === 0) return

  const rows = result[0].values.map(row => ({
    timestamp: new Date(row[0] as string),
    duration: row[1] as number,
    app: row[2] as string,
    title: row[3] as string,
    subject: row[4] as Subject,
  }))

  const merged = mergeSegments(rows)

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
          stmt.run([date, segment.start_time, segment.end_time, c.duration, c.subject, String(c.title ?? ''), String(c.app ?? ''), parentId])
        }
        stmt.free()
      }
    }
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
  constituents: { subject: Subject; title: string; app: string; duration: number }[]
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
    constituents: { subject: Subject; title: string; app: string; duration: number }[]
  } | null = null

  const isStudy = (subject: Subject): boolean => {
    return subject !== '休闲' && subject !== '其他' && subject !== '未分类'
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
        constituents: [{ subject: entry.subject, title: entry.title, app: entry.app, duration: entry.duration }],
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
      current.constituents.push({ subject: entry.subject, title: entry.title, app: entry.app, duration: entry.duration })
      continue
    }

    // Rule ④: Study segment + short non-study interlude (< 5 min) → absorb into study segment
    if (currentIsStudy && !entryIsStudy && gap >= 0 && gap < INTERLUDE_THRESHOLD * 1000 && entry.duration < INTERLUDE_THRESHOLD) {
      current.end = entryEnd
      current.duration += entry.duration
      current.titleDurations.set(entry.title, (current.titleDurations.get(entry.title) || 0) + entry.duration)
      current.apps.add(entry.app)
      current.constituents.push({ subject: entry.subject, title: entry.title, app: entry.app, duration: entry.duration })
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
      constituents: [{ subject: entry.subject, title: entry.title, app: entry.app, duration: entry.duration }],
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

  // Post-process: absorb fragments < 5 min into the nearest neighbor
  const MIN_SEGMENT_SEC = 300
  const gapBetween = (a: MergedEntry, b: MergedEntry): number => {
    const aEnd = new Date(a.end_time).getTime()
    const bStart = new Date(b.start_time).getTime()
    return Math.abs(bStart - aEnd)
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = merged.length - 1; i >= 0; i--) {
      if (merged[i].duration >= MIN_SEGMENT_SEC) continue
      const frag = merged[i]
      // Find the best neighbor: prefer same-subject, fall back to nearest by time
      let bestIdx = -1
      let bestGap = Infinity
      const tryNeighbor = (idx: number) => {
        const g = gapBetween(merged[i], merged[idx])
        // Same subject gets priority (gap * 0.1 to heavily favor same-subject)
        const score = merged[idx].subject === frag.subject ? g * 0.1 : g
        if (score < bestGap) { bestIdx = idx; bestGap = score }
      }
      if (i > 0) tryNeighbor(i - 1)
      if (i < merged.length - 1) tryNeighbor(i + 1)
      if (bestIdx === -1) continue
      const target = merged[bestIdx]
      // Adjust start/end to span the absorbed fragment (duration included)
      if (frag.start_time < target.start_time) target.start_time = frag.start_time
      if (frag.end_time > target.end_time) target.end_time = frag.end_time
      target.duration += frag.duration
      target.constituents.push(...frag.constituents)
      merged.splice(i, 1)
      changed = true
    }
  }

  // Gap-fill merge: if < 10 min gap between same-subject segments, merge for display continuity
  const GAP_FILL_SEC = 600
  let gapChanged = true
  while (gapChanged) {
    gapChanged = false
    for (let i = merged.length - 1; i >= 1; i--) {
      const prev = merged[i - 1]
      const curr = merged[i]
      if (prev.subject !== curr.subject) continue
      const prevEnd = new Date(prev.end_time).getTime()
      const currStart = new Date(curr.start_time).getTime()
      if (currStart - prevEnd >= GAP_FILL_SEC * 1000) continue
      // Merge: same-subject gap fill (duration included)
      if (curr.end_time > prev.end_time) prev.end_time = curr.end_time
      prev.duration += curr.duration
      prev.constituents.push(...curr.constituents)
      merged.splice(i, 1)
      gapChanged = true
    }
  }

  // Recalculate segment subject and duration based on the dominant subject
  // (the one with the highest total duration across all its constituents).
  // This prevents the first event's subject from incorrectly labelling the segment
  // when a different subject actually dominates (e.g. 休闲 23m + 英语 68m → 英语).
  for (const seg of merged) {
    // Group same-subject constituents and sum their durations
    const bySubject = new Map<string, number>()
    for (const c of seg.constituents) {
      bySubject.set(c.subject, (bySubject.get(c.subject) || 0) + c.duration)
    }
    // Pick the subject with the highest total
    let bestSubject = seg.subject
    let bestDur = 0
    for (const [subj, dur] of bySubject) {
      if (dur > bestDur) { bestDur = dur; bestSubject = subj }
    }
    seg.duration = bestDur
    seg.subject = bestSubject as Subject
  }

  // Final gap-fill: stretch any adjacent segments with < 10 min gap to touch visually
  // (this only adjusts end_time/start_time, not duration, to eliminate visual blanks)
  for (let i = merged.length - 1; i >= 1; i--) {
    const prevEnd = new Date(merged[i - 1].end_time).getTime()
    const currStart = new Date(merged[i].start_time).getTime()
    const gap = currStart - prevEnd
    if (gap > 0 && gap < 600000) {  // 10 minutes
      // Stretch previous segment's end_time to meet current segment's start_time
      merged[i - 1].end_time = merged[i].start_time
    }
  }

  return merged
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
