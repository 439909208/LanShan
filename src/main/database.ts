import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { simulateMakeups, addDays, diffDays, dateStr, MAKEUP_WINDOW_DAYS, MAKEUP_FILL_ALL } from './makeup'
import type { MakeupFill } from './makeup'
import { DEFAULT_FOCUS_SCHEDULE } from '../shared/schedule'

let db: SqlJsDatabase | null = null
const DATA_DIR = join(app.getPath('home'), '澜山数据')
const DB_PATH = join(DATA_DIR, 'lanshan.db')
const OLD_DB_PATH = join(app.getPath('userData'), 'lanshan.db')
const BACKUP_DIR = join(DATA_DIR, 'backups')

export type Subject = '物理' | '数学' | '英语' | '化学' | '生物' | '语文' | '休闲' | '其他'

export const SUBJECTS: Subject[] = ['物理', '数学', '英语', '化学', '生物', '语文', '休闲', '其他']
export const CORE_SUBJECTS: Subject[] = ['物理', '数学', '英语']

export interface RawEvent {
  id?: number
  aw_id: string
  timestamp: Date
  duration: number
  app: string
  title: string
  url: string | null
  subject: Subject | null
}

export interface MergedSegment {
  id?: number
  date: string
  start_time: string
  end_time: string
  duration: number
  subject: Subject
  title: string
  app: string
  is_exploded?: boolean
  parent_id?: number | null
}

export interface DailyStat {
  date: string
  subject: Subject
  total_seconds: number
  target_seconds: number
  achieved: boolean
  exceeded: boolean
}

export interface ClassificationRule {
  id?: number
  subject: Subject
  keyword: string
  match_field: 'title' | 'app' | 'url' | 'all'
  priority: number
}

export interface Settings {
  [key: string]: string | number | boolean
}

const DEFAULT_RULES: Omit<ClassificationRule, 'id'>[] = [
  { subject: '物理', keyword: '夏梦迪', match_field: 'all', priority: 10 },
  { subject: '物理', keyword: '赵玉峰', match_field: 'all', priority: 10 },
  { subject: '物理', keyword: '黄夫人', match_field: 'all', priority: 10 },
  { subject: '物理', keyword: '物理', match_field: 'all', priority: 5 },
  { subject: '数学', keyword: '小火车', match_field: 'all', priority: 10 },
  { subject: '数学', keyword: 'Tomath', match_field: 'all', priority: 10 },
  { subject: '数学', keyword: '凉学长', match_field: 'all', priority: 10 },
  { subject: '数学', keyword: '一数', match_field: 'all', priority: 10 },
  { subject: '数学', keyword: '数学', match_field: 'all', priority: 5 },
  { subject: '英语', keyword: '陶然', match_field: 'all', priority: 10 },
  { subject: '英语', keyword: 'FREE高考英语', match_field: 'all', priority: 10 },
  { subject: '英语', keyword: '英语', match_field: 'all', priority: 5 },
  { subject: '英语', keyword: 'English', match_field: 'all', priority: 5 },
  { subject: '英语', keyword: '词汇', match_field: 'all', priority: 5 },
  { subject: '英语', keyword: '单词', match_field: 'all', priority: 5 },
  { subject: '休闲', keyword: 'steam', match_field: 'app', priority: 10 },
  { subject: '休闲', keyword: '游戏', match_field: 'all', priority: 10 },
  { subject: '休闲', keyword: '抖音', match_field: 'all', priority: 10 },
]

const DEFAULT_SETTINGS: Record<string, string | number | boolean> = {
  target_物理: 7200,    // 2 hours in seconds
  target_数学: 7200,
  target_英语: 9000,    // 2.5 hours
  entertainment_threshold: 1800,  // 30 min
  entertainment_reminder: true,
  evening_reminder: false,
  weekly_report: true,
  weekly_report_time: '22:00',
  theme: 'light',
  auto_start: false,
  tray_subject: '',  // current tray subject, '' = unset
  summer_start: '07-10',
  summer_end: '08-31',
  focus_whitelist: '[]',  // 专注白名单 JSON：[{ name, path?, title? }]
  focus_schedule_enabled: false,  // 专注日程模式开关（到点自动进入/结束专注）
  focus_schedule_mode: 'loose',  // 宽松：手动退出后本时段不重入；strict：手动退出后 30 秒重入
  focus_schedule: JSON.stringify(DEFAULT_FOCUS_SCHEDULE),  // 学习时段 JSON：[{ s: 'HH:MM', e: 'HH:MM' }]
  home_font_scale: 1,        // 主页数据字号倍率（0.7–1.5）
  home_border_width: 1,      // 卡片边框粗细（px，0–4）
  home_border_radius: 16,    // 卡片圆角（px，0–28）
  home_card_padding: 24,     // 卡片内边距（px，8–40）
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }

  // Migrate old database if legacy location exists but new doesn't
  if (existsSync(OLD_DB_PATH) && !existsSync(DB_PATH)) {
    const buf = readFileSync(OLD_DB_PATH)
    writeFileSync(DB_PATH, buf)
    console.log('[db] Migrated from', OLD_DB_PATH)
  }

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Enable WAL mode for concurrent access
  db.run('PRAGMA journal_mode=WAL')
  
  createTables()

  seedDefaults()
  cleanupOldUnclassified()
  migrateSealsV5()

  // Migrate old '娱乐' subject data to '休闲' (v3)
  db?.run("UPDATE merged_segments SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE raw_events SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE daily_stats SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE classification_rules SET subject = '休闲' WHERE subject = '娱乐'")

  // Add user_subject column if missing (v4)
  try {
    db?.run("ALTER TABLE merged_segments ADD COLUMN user_subject TEXT")
  } catch {
    // Column already exists — ignore
  }

  save()
}

function createTables(): void {
  if (!db) throw new Error('Database not initialized')

  db.run(`
    CREATE TABLE IF NOT EXISTS classification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      keyword TEXT NOT NULL,
      match_field TEXT NOT NULL DEFAULT 'title',
      priority INTEGER NOT NULL DEFAULT 5
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aw_id TEXT UNIQUE NOT NULL,
      timestamp TEXT NOT NULL,
      duration INTEGER NOT NULL,
      app TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      subject TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS merged_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      app TEXT NOT NULL,
      is_exploded INTEGER DEFAULT 0,
      parent_id INTEGER,
      user_subject TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      total_seconds INTEGER DEFAULT 0,
      target_seconds INTEGER DEFAULT 7200,
      achieved INTEGER DEFAULT 0,
      exceeded INTEGER DEFAULT 0,
      UNIQUE(date, subject)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      unlocked INTEGER DEFAULT 0,
      unlocked_at TEXT,
      progress INTEGER DEFAULT 0,
      progress_max INTEGER DEFAULT 1
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // 补签（盈余回填）：手动/自动补签记录 + 用户标记"保持空白"的日期
  db.run(`
    CREATE TABLE IF NOT EXISTS makeup_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      amount INTEGER NOT NULL,
      source_date TEXT NOT NULL,
      manual INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS makeup_undone (
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      PRIMARY KEY (date, subject)
    )
  `)

  // 每日刻章逐日记录（回放数据源：今天实时判定写入，历史日期查看时按数据重算）
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_seal_records (
      date TEXT NOT NULL,
      seal_id TEXT NOT NULL,
      earned_at TEXT NOT NULL,
      PRIMARY KEY (date, seal_id)
    )
  `)

  // 佩戴位（4×2 八个格子）：date=NULL 为累积刻章（永久），date=获得日 为每日刻章（仅当天）
  db.run(`
    CREATE TABLE IF NOT EXISTS seal_slots (
      slot INTEGER PRIMARY KEY,
      seal_id TEXT NOT NULL,
      date TEXT
    )
  `)

  // Indexes for performance
  db.run('CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp)')
  db.run('CREATE INDEX IF NOT EXISTS idx_merged_date ON merged_segments(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_makeup_fills_date ON makeup_fills(date)')
}

function seedDefaults(): void {
  if (!db) return

  // Seed classification rules if table is empty
  const ruleCount = db.exec('SELECT COUNT(*) as c FROM classification_rules')
  if (ruleCount.length === 0 || (ruleCount[0].values[0] && Number(ruleCount[0].values[0][0]) === 0)) {
    const stmt = db.prepare('INSERT INTO classification_rules (subject, keyword, match_field, priority) VALUES (?, ?, ?, ?)')
    for (const rule of DEFAULT_RULES) {
      stmt.run([rule.subject, rule.keyword, rule.match_field, rule.priority])
    }
    stmt.free()
  }

  // Seed settings if empty
  const settingCount = db.exec('SELECT COUNT(*) as c FROM settings')
  if (settingCount.length === 0 || (settingCount[0].values[0] && Number(settingCount[0].values[0][0]) === 0)) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      stmt.run([key, String(value)])
    }
    stmt.free()
  }

}

/**
 * 清理旧版本（v1）中错误标记为未分类的非学习条目。
 * 只保留匹配模糊关键词的视频播放类未分类条目。
 */
function cleanupOldUnclassified(): void {
  if (!db) return
  const ver = getSetting('db_version')
  if (ver === '2') return

  const keywords = ['视频播放', '百度网盘', 'baidunetdisk', 'video player', 'videoplayer']
  const cond = keywords.map(k => `(LOWER(title) LIKE '%${k}%' OR LOWER(app) LIKE '%${k}%')`).join(' OR ')

  db.run(`DELETE FROM raw_events WHERE subject = '未分类'`)
  db.run(`DELETE FROM merged_segments WHERE subject = '未分类'`)
  db.run("DELETE FROM daily_stats WHERE subject = '未分类'")

  setSetting('db_version', '2')
  console.log('[db] Cleaned up old unclassified entries (db v2)')
}

/**
 * 刻章系统 v5 迁移：
 * achievements 表从 38 枚扁平成就收敛为 16 枚累积刻章（保留同名刻章的已解锁状态与解锁时间），
 * 每日刻章不再存 achievements——由 daily_seal_records 逐日记录（历史日期查看时按数据重算回放）。
 */
function migrateSealsV5(): void {
  if (!db) return
  if (getSetting('ach_version') === '5') return

  // 16 枚累积刻章（id → 阈值）
  const CUMULATIVE: [string, number][] = [
    ['total-30h', 30 * 3600], ['total-100h', 100 * 3600], ['total-250h', 250 * 3600],
    ['streak-3', 3], ['streak-7', 7], ['streak-14', 14],
    ['phy-20', 20 * 3600], ['phy-60', 60 * 3600], ['phy-100', 100 * 3600],
    ['math-15', 15 * 3600], ['math-50', 50 * 3600], ['math-85', 85 * 3600],
    ['eng-20', 20 * 3600], ['eng-70', 70 * 3600], ['eng-120', 120 * 3600],
    ['triple-3', 3],
  ]

  // 保留旧表中同名累积刻章的解锁状态
  const old = new Map<string, { unlocked: number; unlocked_at: string | null }>()
  const rows = db.exec('SELECT id, unlocked, unlocked_at FROM achievements')
  for (const r of rows?.[0]?.values || []) {
    old.set(r[0] as string, { unlocked: r[1] as number, unlocked_at: r[2] as string | null })
  }

  db.run('DELETE FROM achievements')
  const stmt = db.prepare('INSERT INTO achievements (id, unlocked, unlocked_at, progress, progress_max) VALUES (?, ?, ?, 0, ?)')
  for (const [id, max] of CUMULATIVE) {
    const o = old.get(id)
    stmt.run([id, o?.unlocked ?? 0, o?.unlocked_at ?? null, max])
  }
  stmt.free()
  setSetting('ach_version', '5')
  console.log('[db] Seal v5 migration complete — achievements → 16 cumulative seals')
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function save(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)

  // Daily backup — write once per day, keep forever
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
  const today = new Date().toISOString().split('T')[0]
  const backupPath = join(BACKUP_DIR, `lanshan-${today}.db`)
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, buffer)
  }

  writeFileSync(DB_PATH, buffer)
}

// ---- Query helpers ----

export function getSetting(key: string): string | undefined {
  const result = db?.exec(`SELECT value FROM settings WHERE key = '${key.replace(/'/g, "''")}'`)
  if (result && result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as string
  }
  return undefined
}

export function setSetting(key: string, value: string | number | boolean): void {
  db?.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)])
  save()
}

export function getSettings(): Record<string, string> {
  const result = db?.exec('SELECT key, value FROM settings')
  const settings: Record<string, string> = {}
  if (result) {
    for (const row of result[0]?.values || []) {
      settings[row[0] as string] = row[1] as string
    }
  }
  return settings
}

/** 将本地日期（如 2026-07-10）转换为 UTC 时间范围，用于查询 raw_events 中的 UTC ISO 时间戳 */
export function getUTCRange(localDate: string): [string, string] {
  const start = new Date(`${localDate}T00:00:00+08:00`).toISOString()
  const end = new Date(`${localDate}T00:00:00+08:00`)
  end.setDate(end.getDate() + 1)
  return [start, end.toISOString()]
}

export function getTargetSeconds(subject: Subject): number {
  const val = getSetting(`target_${subject}`)
  return val ? parseInt(val, 10) : 7200
}

export function getTraySubject(): Subject | null {
  const val = getSetting('tray_subject')
  if (val && (SUBJECTS as string[]).includes(val)) {
    return val as Subject
  }
  return null
}

export function setTraySubject(subject: Subject | null): void {
  setSetting('tray_subject', subject ?? '')
}

export function getClassificationRules(): ClassificationRule[] {
  const result = db?.exec('SELECT id, subject, keyword, match_field, priority FROM classification_rules ORDER BY priority DESC')
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    id: row[0] as number,
    subject: row[1] as Subject,
    keyword: row[2] as string,
    match_field: row[3] as 'title' | 'app' | 'url' | 'all',
    priority: row[4] as number,
  }))
}

export function addClassificationRule(subject: Subject, keyword: string, matchField: string, priority: number): void {
  db?.run(
    'INSERT INTO classification_rules (subject, keyword, match_field, priority) VALUES (?, ?, ?, ?)',
    [subject, keyword, matchField, priority]
  )
  save()
}

export function deleteClassificationRule(id: number): void {
  db?.run('DELETE FROM classification_rules WHERE id = ?', [id])
  save()
}

export function reclassifyRawEventsByKeyword(keyword: string, newSubject: Subject, matchField: string): number {
  const like = `%${keyword}%`
  let sql: string
  let params: (string | number)[]

  if (matchField === 'all') {
    sql = 'UPDATE raw_events SET subject = ? WHERE (title LIKE ? OR app LIKE ? OR url LIKE ?)'
    params = [newSubject, like, like, like]
  } else if (matchField === 'title') {
    sql = 'UPDATE raw_events SET subject = ? WHERE title LIKE ?'
    params = [newSubject, like]
  } else if (matchField === 'app') {
    sql = 'UPDATE raw_events SET subject = ? WHERE app LIKE ?'
    params = [newSubject, like]
  } else if (matchField === 'url') {
    sql = 'UPDATE raw_events SET subject = ? WHERE url LIKE ?'
    params = [newSubject, like]
  } else {
    return 0
  }

  db?.run(sql, params)
  save()

  const result = db?.exec('SELECT changes()')
  return (result?.[0]?.values?.[0]?.[0] as number) || 0
}

export function insertRawEvent(event: Omit<RawEvent, 'id'>): void {
  db?.run(
    `INSERT INTO raw_events (aw_id, timestamp, duration, app, title, url, subject)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(aw_id) DO UPDATE SET
       timestamp = excluded.timestamp,
       duration = excluded.duration,
       app = excluded.app,
       title = excluded.title,
       url = excluded.url`,
    [event.aw_id, event.timestamp.toISOString(), event.duration, event.app, event.title, event.url, event.subject]
  )
}

export function insertMergedSegment(segment: Omit<MergedSegment, 'id'>): void {
  db?.run(
    'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [segment.date, segment.start_time, segment.end_time, segment.duration, segment.subject, segment.title, segment.app, segment.is_exploded ? 1 : 0, segment.parent_id ?? null]
  )
}

export function clearMergedSegments(date: string): void {
  db?.run('DELETE FROM merged_segments WHERE date = ?', [date])
}

/** Delete merged segments that overlap with the given time range on the given date. */
export function clearMergedSegmentsInRange(date: string, startTime: string, endTime: string): void {
  db?.run(
    'DELETE FROM merged_segments WHERE date = ? AND start_time < ? AND end_time > ?',
    [date, endTime, startTime]
  )
}

export function getMergedSegments(date: string): MergedSegment[] {
  const result = db?.exec('SELECT id, date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id FROM merged_segments WHERE date = ? ORDER BY start_time', [date])
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    id: row[0] as number,
    date: row[1] as string,
    start_time: row[2] as string,
    end_time: row[3] as string,
    duration: row[4] as number,
    subject: row[5] as Subject,
    title: row[6] as string,
    app: row[7] as string,
    is_exploded: Boolean(row[8]),
    parent_id: row[9] as number | null,
  }))
}

export function getDailyStats(date: string): DailyStat[] {
  const result = db?.exec('SELECT date, subject, total_seconds, target_seconds, achieved, exceeded FROM daily_stats WHERE date = ?', [date])
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    date: row[0] as string,
    subject: row[1] as Subject,
    total_seconds: row[2] as number,
    target_seconds: row[3] as number,
    achieved: Boolean(row[4]),
    exceeded: Boolean(row[5]),
  }))
}

export function updateDailyStats(date: string, subject: Subject, totalSeconds: number): void {
  const target = getTargetSeconds(subject)
  const achieved = totalSeconds >= target
  const exceeded = totalSeconds >= target * 1.5
  db?.run(
    `INSERT INTO daily_stats (date, subject, total_seconds, target_seconds, achieved, exceeded)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, subject) DO UPDATE SET
       total_seconds = excluded.total_seconds,
       target_seconds = excluded.target_seconds,
       achieved = excluded.achieved,
       exceeded = excluded.exceeded`,
    [date, subject, totalSeconds, target, achieved ? 1 : 0, exceeded ? 1 : 0]
  )
  save()
}

export function getDailyBreakdown(date: string): {
  subject: Subject
  total_seconds: number
  target_seconds: number
  achieved: boolean
  exceeded: boolean
}[] {
  return getDailyStats(date)
}

export function getTotalSecondsToday(date: string): number {
  const [start, end] = getUTCRange(date)
  const result = db?.exec("SELECT COALESCE(SUM(duration), 0) FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IN ('物理','数学','英语')", [start, end])
  if (result && result.length > 0 && result[0].values[0]) {
    return result[0].values[0][0] as number
  }
  return 0
}

export function getRawTitleStats(date: string): { title: string; duration: number; subject: Subject }[] {
  const [utcStart, utcEnd] = getUTCRange(date)
  const result = db?.exec(
    "SELECT title, COALESCE(SUM(duration), 0) as sec, subject FROM raw_events WHERE timestamp >= ? AND timestamp < ? AND subject IS NOT NULL GROUP BY title, subject ORDER BY sec DESC",
    [utcStart, utcEnd]
  )
  if (!result || !result[0]) return []
  return result[0].values.map(row => ({
    title: row[0] as string,
    duration: row[1] as number,
    subject: row[2] as Subject,
  }))
}

export function reclassifySegment(segmentId: number, newSubject: Subject): void {
  // Only change the outer display label — keep inner titles unchanged.
  const result = db?.exec(
    'SELECT id FROM merged_segments WHERE id = ? AND is_exploded = 0',
    [segmentId]
  )
  if (!result || !result[0]?.values?.length) return

  // Calculate the duration for the chosen subject from children
  const durRow = db?.exec(
    'SELECT COALESCE(SUM(duration), 0) FROM merged_segments WHERE parent_id = ? AND subject = ?',
    [segmentId, newSubject]
  )
  const newDuration = durRow?.[0]?.values?.[0]?.[0] as number ?? 0

  // Only update the parent segment — nothing else
  db?.run(
    'UPDATE merged_segments SET subject = ?, user_subject = ?, duration = ? WHERE id = ?',
    [newSubject, newSubject, newDuration, segmentId]
  )

  save()
}

/**
 * Reclassify all merged segments (and their raw_events) with a matching title on a given date.
 * Returns the number of segments affected.
 */
export function reclassifyByTitle(date: string, title: string, newSubject: Subject): number {
  // Find all merged_segments on this date with the given title
  const segments = db?.exec(
    'SELECT id, start_time, end_time, subject FROM merged_segments WHERE date = ? AND title = ?',
    [date, title]
  )
  if (!segments || segments.length === 0 || segments[0].values.length === 0) return 0

  let count = 0
  for (const row of segments[0].values) {
    const segId = row[0] as number
    const startTime = row[1] as string
    const endTime = row[2] as string
    const oldSubject = row[3] as string

    // Update the merged_segment itself
    db?.run('UPDATE merged_segments SET subject = ? WHERE id = ?', [newSubject, segId])
    // Also update its exploded children if any
    db?.run('UPDATE merged_segments SET subject = ? WHERE parent_id = ?', [newSubject, segId])

    // Update raw_events with matching title within this segment's time range
    db?.run(
      'UPDATE raw_events SET subject = ? WHERE timestamp >= ? AND timestamp <= ? AND title = ?',
      [newSubject, startTime, endTime, title]
    )
    count++
  }

  save()
  return count
}

/**
 * Reclassify raw_events AND merged_segments within a specific time range
 * that match the given title. Called when user reclassifies a title-group
 * in the timeline detail modal.
 */
export function reclassifyByTitleInRange(date: string, startTime: string, endTime: string, title: string, newSubject: Subject): number {
  // 1. Update raw_events
  const result = db?.run(
    'UPDATE raw_events SET subject = ? WHERE timestamp >= ? AND timestamp <= ? AND title = ?',
    [newSubject, startTime, endTime, title]
  )

  // 2. Update exploded children in merged_segments (same title, same time range)
  db?.run(
    'UPDATE merged_segments SET subject = ? WHERE date = ? AND is_exploded = 1 AND title = ? AND start_time >= ? AND end_time <= ?',
    [newSubject, date, title, startTime, endTime]
  )

  // 3. Recalculate affected parent segments' subject (take the dominant child subject)
  const parents = db?.exec(
    `SELECT DISTINCT parent_id FROM merged_segments
     WHERE date = ? AND is_exploded = 1 AND title = ? AND start_time >= ? AND end_time <= ?`,
    [date, title, startTime, endTime]
  )
  if (parents && parents[0]) {
    for (const row of parents[0].values) {
      const pid = row[0] as number
      if (pid == null) continue
      const dom = db?.exec(
        'SELECT subject FROM merged_segments WHERE parent_id = ? GROUP BY subject ORDER BY SUM(duration) DESC LIMIT 1',
        [pid]
      )
      if (dom && dom[0] && dom[0].values.length > 0) {
        db?.run('UPDATE merged_segments SET subject = ? WHERE id = ? AND is_exploded = 0', [dom[0].values[0][0], pid])
      }
    }
  }

  save()
  return result?.[0]?.changes ?? 0
}

/**
 * Split a merged segment at the given time point into two segments.
 * The original segment and its children are deleted; two new parent segments
 * (with their respective children) are inserted.
 * Returns the date string on success, null on failure.
 */
export function splitSegment(segmentId: number, splitTime: string): string | null {
  // Get the original segment
  const result = db?.exec(
    'SELECT date, start_time, end_time, duration, subject, title, app FROM merged_segments WHERE id = ? AND is_exploded = 0',
    [segmentId]
  )
  if (!result || result.length === 0 || result[0].values.length === 0) return null

  const row = result[0].values[0]
  const date = row[0] as string
  const startTime = row[1] as string
  const endTime = row[2] as string
  const duration = row[3] as number
  const subject = row[4] as Subject
  const title = row[5] as string
  const app = row[6] as string

  // Validate split time is strictly within range
  if (splitTime <= startTime || splitTime >= endTime) return null

  // Calculate time ratio for children distribution
  const totalMs = new Date(endTime).getTime() - new Date(startTime).getTime()
  const splitMs = new Date(splitTime).getTime() - new Date(startTime).getTime()
  const ratio = splitMs / totalMs

  // Get exploded children of this segment
  const children = db?.exec(
    'SELECT duration, subject, title, app FROM merged_segments WHERE parent_id = ? ORDER BY rowid',
    [segmentId]
  )

  // Delete original parent + children
  db?.run('DELETE FROM merged_segments WHERE id = ?', [segmentId])
  db?.run('DELETE FROM merged_segments WHERE parent_id = ?', [segmentId])

  // Insert front segment (duration 1 placeholder, recalculated below)
  db?.run(
    'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)',
    [date, startTime, splitTime, 1, subject, title, app]
  )
  const frontIdRow = db?.exec('SELECT last_insert_rowid()')
  const frontId = frontIdRow?.[0]?.values?.[0]?.[0] as number

  // Insert back segment (duration 1 placeholder, recalculated below)
  db?.run(
    'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)',
    [date, splitTime, endTime, 1, subject, title, app]
  )
  const backIdRow = db?.exec('SELECT last_insert_rowid()')
  const backId = backIdRow?.[0]?.values?.[0]?.[0] as number

  // Distribute children by time ratio
  if (children && children[0] && children[0].values.length > 0) {
    let accumulated = 0
    const totalChildDuration = children[0].values.reduce((s: number, c: any[]) => s + (c[0] as number), 0)
    for (const c of children[0].values) {
      const childDuration = c[0] as number
      const childSubject = c[1] as Subject || subject
      const childTitle = c[2] as string || title
      const childApp = c[3] as string || app

      if (totalChildDuration > 0 && accumulated / totalChildDuration < ratio) {
        db?.run(
          'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
          [date, startTime, splitTime, childDuration, childSubject, childTitle, childApp, frontId]
        )
        accumulated += childDuration
      } else {
        db?.run(
          'INSERT INTO merged_segments (date, start_time, end_time, duration, subject, title, app, is_exploded, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
          [date, splitTime, endTime, childDuration, childSubject, childTitle, childApp, backId]
        )
      }
    }
  }

  // Recalculate front/back duration from actual children (same-subject only).
  // If no same-subject children on one side, use time-proportional duration to avoid visual gap.
  const frontSum = db?.exec('SELECT COALESCE(SUM(duration),0) FROM merged_segments WHERE parent_id = ? AND subject = ?', [frontId, subject])
  const backSum = db?.exec('SELECT COALESCE(SUM(duration),0) FROM merged_segments WHERE parent_id = ? AND subject = ?', [backId, subject])
  let actualFront = frontSum?.[0]?.values?.[0]?.[0] as number || 0
  let actualBack = backSum?.[0]?.values?.[0]?.[0] as number || 0
  if (actualFront === 0) actualFront = Math.max(1, Math.round(duration * ratio))
  if (actualBack === 0) actualBack = Math.max(1, duration - actualFront)
  db?.run('UPDATE merged_segments SET duration = ? WHERE id = ?', [actualFront, frontId])
  db?.run('UPDATE merged_segments SET duration = ? WHERE id = ?', [actualBack, backId])

  save()
  return date
}

/**
 * Merge two adjacent segments with the same subject into one.
 * Children of id2 are moved under id1; id2 is deleted.
 * Returns true on success.
 */
export function mergeAdjacentSegments(id1: number, id2: number): boolean {
  const r1 = db?.exec(
    'SELECT date, start_time, end_time, subject FROM merged_segments WHERE id = ? AND is_exploded = 0',
    [id1]
  )
  const r2 = db?.exec(
    'SELECT date, start_time, end_time, subject FROM merged_segments WHERE id = ? AND is_exploded = 0',
    [id2]
  )
  if (!r1 || !r2 || r1[0].values.length === 0 || r2[0].values.length === 0) return false

  const s1 = r1[0].values[0]
  const s2 = r2[0].values[0]
  const date1 = s1[0] as string
  const date2 = s2[0] as string
  const subject1 = s1[3] as Subject
  const subject2 = s2[3] as Subject

  // Must be same date to merge
  if (date1 !== date2) return false

  const newStart = (s1[1] as string) < (s2[1] as string) ? s1[1] as string : s2[1] as string
  const newEnd = (s1[2] as string) > (s2[2] as string) ? s1[2] as string : s2[2] as string

  // Move all children of id2 under id1
  db?.run('UPDATE merged_segments SET parent_id = ? WHERE parent_id = ?', [id1, id2])
  // Unify all children's subject to match parent (supports cross-subject merge)
  db?.run('UPDATE merged_segments SET subject = ? WHERE parent_id = ?', [subject1, id1])
  // Update id1's time range
  db?.run('UPDATE merged_segments SET start_time = ?, end_time = ? WHERE id = ?', [newStart, newEnd, id1])
  // Delete id2
  db?.run('DELETE FROM merged_segments WHERE id = ?', [id2])

  // Recalculate duration from all children
  const sum = db?.exec(
    'SELECT COALESCE(SUM(duration),0) FROM merged_segments WHERE parent_id = ?',
    [id1]
  )
  const actualDuration = sum?.[0]?.values?.[0]?.[0] as number || 1
  db?.run('UPDATE merged_segments SET duration = ? WHERE id = ?', [actualDuration, id1])

  save()
  return true
}

/** Get the date of a merged segment by its ID */
export function getMergedSegmentDate(segmentId: number): string | null {
  const result = db?.exec('SELECT date FROM merged_segments WHERE id = ?', [segmentId])
  if (result && result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as string
  }
  return null
}

export function getConsecutiveDays(): number {
  // Count consecutive days with study activity going backward from today
  const result = db?.exec(`
    SELECT date FROM daily_stats
    WHERE total_seconds > 0
    GROUP BY date
    ORDER BY date DESC
  `)
  if (!result || result.length === 0) return 0

  const dates = result[0].values.map(row => row[0] as string)
  let streak = 0
  const today = new Date()
  
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today)
    expected.setDate(expected.getDate() - i)
    const expectedStr = expected.toISOString().split('T')[0]
    if (dates[i] === expectedStr) {
      streak++
    } else {
      break
    }
  }
  return streak
}

export function getMaxConsecutiveDays(): number {
  const result = db?.exec(`
    SELECT date FROM daily_stats
    WHERE total_seconds > 0
    GROUP BY date
    ORDER BY date ASC
  `)
  if (!result || result.length === 0) return 0

  const dates = result[0].values.map(row => row[0] as string)
  let maxStreak = 0
  let currentStreak = 1

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1])
    const curr = new Date(dates[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 1) {
      currentStreak++
    } else {
      maxStreak = Math.max(maxStreak, currentStreak)
      currentStreak = 1
    }
  }
  maxStreak = Math.max(maxStreak, currentStreak)
  return maxStreak
}

export function getSubjectTotal(subject: Subject): number {
  const result = db?.exec(
    'SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE subject = ?',
    [subject]
  )
  if (result && result.length > 0 && result[0].values[0]) {
    return result[0].values[0][0] as number
  }
  return 0
}

export function getTotalSecondsAllTime(): number {
  const result = db?.exec("SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats WHERE subject IN ('物理','数学','英语')")
  if (result && result.length > 0 && result[0].values[0]) {
    return result[0].values[0][0] as number
  }
  return 0
}

export interface DayStats {
  date: string
  subjects: Record<string, number>
  total: number
}

/**
 * 固定自然周统计（周一起始）：7 → 本周（周一~周日，未到的日期补 0），14 → 上周。
 * 日期统一用本地时区字符串（与 sync 存储格式一致）。
 */
export function getWeekStats(days: number): DayStats[] {
  const weekOffset = days >= 14 ? 1 : 0
  const today = new Date()
  const monday = new Date(today)
  // 周一=0 ... 周日=6
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - weekOffset * 7)

  const result: DayStats[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = d.toLocaleDateString('sv-SE')

    const stats = getDailyStats(dateStr)
    const subjects: Record<string, number> = {}
    let total = 0

    for (const s of stats) {
      subjects[s.subject] = (subjects[s.subject] || 0) + s.total_seconds
      if (['物理', '数学', '英语'].includes(s.subject)) {
        total += s.total_seconds
      }
    }

    result.push({ date: dateStr, subjects, total })
  }

  return result
}

/** 获取某一年的热力图数据 — 每天总时长（秒） */
export function getYearHeatmapData(year: number): { date: string; total: number }[] {
  const prefix = String(year)
  const result = db?.exec(
    "SELECT date, SUM(total_seconds) FROM daily_stats WHERE date LIKE ? GROUP BY date ORDER BY date",
    [`${prefix}%`]
  )
  if (!result || result.length === 0) return []

  const map = new Map<string, number>()
  for (const row of result[0].values) {
    map.set(row[0] as string, row[1] as number)
  }

  // Fill in all days of the year
  const data: { date: string; total: number }[] = []
  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().split('T')[0]
    data.push({ date: ds, total: map.get(ds) || 0 })
  }
  return data
}

export function exportRules(): string {
  const rules = getClassificationRules()
  const file = join(DATA_DIR, 'classification-rules.json')
  writeFileSync(file, JSON.stringify(rules, null, 2), 'utf-8')
  return file
}

export function importRules(): number {
  const file = join(DATA_DIR, 'classification-rules.json')
  if (!existsSync(file)) return 0
  const rules: ClassificationRule[] = JSON.parse(readFileSync(file, 'utf-8'))
  for (const r of rules) {
    if (!r.keyword) continue
    addClassificationRule(r.subject, r.keyword, r.match_field || 'all', r.priority || 5)
  }
  return rules.length
}

export function closeDatabase(): void {
  if (db) {
    save()
    db.close()
    db = null
  }
}

// ---- 补签（盈余回填）----
// 只影响热力图展示层，不改动 daily_stats 原始数据。
// 规则见 makeup.ts：盈余仅 7 天内有效，只有最近 7 天的空缺可补，先进先出。

export interface MakeupFillRow {
  date: string
  subject: Subject
  amount: number
  sourceDate: string
  manual: boolean
}

export interface MakeupAvailability {
  subject: Subject
  total: number         // 当日实际时长（秒）
  need: number          // 当日缺口（秒）
  existing: number      // 已补签秒数
  available: number     // 当前可用盈余（秒）
  gross: number         // 截至该日的累计盈余（所有日期超额总和，不随补签减少）
  sourceDate: string    // 可用盈余中最旧的一笔来源日（补签展示用）
  fillable: boolean     // 该日是否在补签范围内
  scope: string         // 当前补签范围：all | month | week
}

/** 读取 [from, to] 内核心科目的日统计 */
function getCoreStatsRange(from: string, to: string): { date: string; subject: Subject; total: number; target: number }[] {
  const result = db?.exec(
    'SELECT date, subject, total_seconds, target_seconds FROM daily_stats WHERE date >= ? AND date <= ? AND subject IN (?, ?, ?) ORDER BY date',
    [from, to, ...CORE_SUBJECTS]
  )
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    date: row[0] as string,
    subject: row[1] as Subject,
    total: row[2] as number,
    target: row[3] as number,
  }))
}

function getFillRows(from: string, to: string): MakeupFillRow[] {
  const result = db?.exec(
    'SELECT date, subject, amount, source_date, manual FROM makeup_fills WHERE date >= ? AND date <= ? ORDER BY date',
    [from, to]
  )
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    date: row[0] as string,
    subject: row[1] as Subject,
    amount: row[2] as number,
    sourceDate: row[3] as string,
    manual: Boolean(row[4]),
  }))
}

function getUndoneSet(): Set<string> {
  const result = db?.exec('SELECT date FROM makeup_undone')
  const set = new Set<string>()
  if (result) {
    for (const row of result[0]?.values || []) set.add(row[0] as string)
  }
  return set
}

/** 补签范围：允许补哪些日期的空缺。makeup_scope = all(所有日期,默认) | month(当月) | week(近7天) */
function getMakeupScope(anchor: string): { scope: string; fillFrom: string } {
  const scope = getSetting('makeup_scope') ?? 'all'
  if (scope === 'week') return { scope, fillFrom: addDays(anchor, -(MAKEUP_WINDOW_DAYS - 1)) }
  if (scope === 'month') return { scope, fillFrom: anchor.slice(0, 7) + '-01' }
  return { scope, fillFrom: MAKEUP_FILL_ALL }
}

/**
 * 模拟起点：从该科目最早有数据的日期开始走（保证所有日期的盈余都统计上）。
 */
function getWalkStartDate(subject: Subject, anchor: string): string {
  const r = db?.exec(
    'SELECT MIN(d) FROM (SELECT MIN(date) d FROM daily_stats WHERE subject = ? UNION ALL SELECT MIN(date) d FROM makeup_fills WHERE subject = ?)',
    [subject, subject]
  )
  const earliest = r?.[0]?.values?.[0]?.[0] as string | undefined
  return earliest && earliest <= anchor ? earliest : addDays(anchor, -30)
}

/** 查询某月所有补签记录（热力图展示用） */
export function getMakeupFills(year: number, month: number): MakeupFillRow[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const result = db?.exec(
    'SELECT date, subject, amount, source_date, manual FROM makeup_fills WHERE date LIKE ? ORDER BY date, subject',
    [`${prefix}%`]
  )
  if (!result || result.length === 0) return []
  return result[0].values.map(row => ({
    date: row[0] as string,
    subject: row[1] as Subject,
    amount: row[2] as number,
    sourceDate: row[3] as string,
    manual: Boolean(row[4]),
  }))
}

/** 查询某天各核心科目的补签可行性（补签弹窗用）
 *  盈余池以"今天"为锚点统一计算：任何日期看到的可用盈余都是同一笔池子余额，
 *  与查看的日期无关（只影响该日的缺口和补签资格）。 */
export function getMakeupAvailability(date: string): MakeupAvailability[] {
  const today = dateStr(new Date())
  const scope = getMakeupScope(today)
  const undone = getUndoneSet()

  // 1) 统一池：每科一个池，以今天为锚点跑一遍模拟
  const pools = new Map<Subject, { available: number; gross: number; sourceDate: string }>()
  for (const subject of CORE_SUBJECTS) {
    const from = getWalkStartDate(subject, today)
    const results = simulateMakeups({
      stats: getCoreStatsRange(from, today).filter(s => s.subject === subject).map(s => ({ date: s.date, total: s.total, target: s.target })),
      existing: getFillRows(from, today).filter(f => f.subject === subject),
      undoneDates: undone,
      today,
      defaultTarget: getTargetSeconds(subject),
      generateNew: false,
      validDays: -1,
      fillFrom: scope.fillFrom,
      startDate: from, // 关键：从最早数据日开始走，否则统一池只会统计最近 7 天的盈余
    })
    const d = results.find(r => r.date === today)
    pools.set(subject, {
      available: d?.balanceAfter ?? 0,
      gross: d?.grossAfter ?? 0,
      sourceDate: d?.poolAtEnd[0]?.source ?? date,
    })
  }

  // 2) 被点日期的缺口与已有补签
  const dayStats = getCoreStatsRange(date, date)
  return CORE_SUBJECTS.map(subject => {
    const stat = dayStats.find(s => s.subject === subject)
    const total = stat?.total ?? 0
    const target = stat?.target ?? getTargetSeconds(subject)
    const existing = getFillRows(date, date).filter(f => f.subject === subject).reduce((s, f) => s + f.amount, 0)
    const pool = pools.get(subject)!
    return {
      subject,
      total,
      need: Math.max(0, target - total),
      existing,
      available: pool.available,
      gross: pool.gross,
      sourceDate: pool.sourceDate,
      fillable: date <= today && date >= scope.fillFrom,
      scope: scope.scope,
    }
  })
}

/** 手动补签：把盈余补到指定日期的指定科目 */
export function applyMakeup(date: string, subject: Subject): { ok: boolean; message: string; amount: number } {
  if (!db) return { ok: false, message: '数据库未初始化', amount: 0 }
  if (!CORE_SUBJECTS.includes(subject)) return { ok: false, message: '仅核心科目可补签', amount: 0 }

  const today = dateStr(new Date())
  if (diffDays(date, today) < 0) {
    return { ok: false, message: '未来日期不能补签', amount: 0 }
  }
  const { fillFrom } = getMakeupScope(today)
  if (date < fillFrom) {
    return { ok: false, message: '该日不在当前补签范围内（设置页可调）', amount: 0 }
  }

  const avail = getMakeupAvailability(date).find(a => a.subject === subject)
  if (!avail) return { ok: false, message: '该科目暂无数据', amount: 0 }
  const remaining = avail.need - avail.existing
  if (remaining <= 0) return { ok: false, message: '该科目当日已达标，无需补签', amount: 0 }
  const amount = Math.min(remaining, avail.available)
  if (amount <= 0) return { ok: false, message: '暂无可用盈余（盈余保留 7 天）', amount: 0 }

  db.run(
    'INSERT INTO makeup_fills (date, subject, amount, source_date, manual, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [date, subject, amount, avail.sourceDate, new Date().toISOString()]
  )
  db.run('DELETE FROM makeup_undone WHERE date = ? AND subject = ?', [date, subject])
  save()
  return { ok: true, message: `已补签 ${Math.round(amount / 60)} 分钟`, amount }
}

/** 撤销某天某科的补签（之后自动回填会跳过该日） */
export function undoMakeup(date: string, subject: Subject): void {
  if (!db) return
  db.run('DELETE FROM makeup_fills WHERE date = ? AND subject = ?', [date, subject])
  db.run('INSERT OR REPLACE INTO makeup_undone (date, subject) VALUES (?, ?)', [date, subject])
  save()
}
