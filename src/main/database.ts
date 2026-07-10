import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let db: SqlJsDatabase | null = null
const DATA_DIR = join(app.getPath('home'), '澜山数据')
const DB_PATH = join(DATA_DIR, 'lanshan.db')
const OLD_DB_PATH = join(app.getPath('userData'), 'lanshan.db')
const BACKUP_DIR = join(DATA_DIR, 'backups')

export type Subject = '物理' | '数学' | '英语' | '化学' | '生物' | '语文' | '休闲' | '其他' | '未分类'

export const SUBJECTS: Subject[] = ['物理', '数学', '英语', '化学', '生物', '语文', '休闲', '其他', '未分类']
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

export interface AchievementProgress {
  id: string
  unlocked: boolean
  unlocked_at: string | null
  progress: number
  progress_max: number
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

  // Force achievement table rebuild if ach_version < 4
  const achVer = getSetting('ach_version')
  if (achVer !== '4') {
    db?.run('DELETE FROM achievements')
    const all = [
      { id:'total-30h',m:30*3600 },{ id:'total-100h',m:100*3600 },{ id:'total-250h',m:250*3600 },
      { id:'streak-3',m:3 },{ id:'streak-7',m:7 },{ id:'streak-14',m:14 },
      { id:'phy-20',m:20*3600 },{ id:'phy-60',m:60*3600 },{ id:'phy-100',m:100*3600 },
      { id:'math-15',m:15*3600 },{ id:'math-50',m:50*3600 },{ id:'math-85',m:85*3600 },
      { id:'eng-20',m:20*3600 },{ id:'eng-70',m:70*3600 },{ id:'eng-120',m:120*3600 },
      { id:'daily-6h',m:6*3600 },{ id:'daily-8h',m:8*3600 },
      { id:'morning-5',m:5 },{ id:'morning-10',m:10 },{ id:'morning-18',m:18 },
      { id:'night-5',m:5 },{ id:'night-10',m:10 },{ id:'night-18',m:18 },
      { id:'focus-2h-3',m:3 },{ id:'focus-2h-7',m:7 },{ id:'focus-3h-3',m:3 },
      { id:'comeback-6h',m:1 },{ id:'comeback-8h',m:1 },
      { id:'burst-phy',m:1 },{ id:'burst-math',m:1 },{ id:'burst-eng',m:1 },
      { id:'balanced',m:1 },{ id:'dawn-dusk',m:1 },
      { id:'over-phy-10',m:10 },{ id:'over-math-10',m:10 },{ id:'over-eng-10',m:10 },
      { id:'triple-over',m:1 },{ id:'triple-3',m:3 },
    ]
    const stmt = db.prepare('INSERT INTO achievements (id, unlocked, progress, progress_max) VALUES (?, 0, 0, ?)')
    for (const a of all) stmt.run([a.id, a.m])
    stmt.free()
    setSetting('ach_version', '4')
    console.log('[db] Achievement table rebuilt — 38 v4 achievements')
  }

  seedDefaults()
  cleanupOldUnclassified()
  migrateAchievementsV2()

  // Migrate old '娱乐' subject data to '休闲' (v3)
  db?.run("UPDATE merged_segments SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE raw_events SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE daily_stats SET subject = '休闲' WHERE subject = '娱乐'")
  db?.run("UPDATE classification_rules SET subject = '休闲' WHERE subject = '娱乐'")

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
      parent_id INTEGER
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

  // Indexes for performance
  db.run('CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp)')
  db.run('CREATE INDEX IF NOT EXISTS idx_merged_date ON merged_segments(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)')
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

  db.run(`DELETE FROM raw_events WHERE subject = '未分类' AND NOT (${cond})`)
  db.run(`DELETE FROM merged_segments WHERE subject = '未分类' AND NOT (${cond})`)
  db.run("DELETE FROM daily_stats WHERE subject = '未分类'")

  setSetting('db_version', '2')
  console.log('[db] Cleaned up old unclassified entries (db v2)')
}

/** 迁移旧数据库中的成就到 v2 版本 */
function migrateAchievementsV2(): void {
  if (!db) return

  // Check if we have exactly 38 achievements with the right IDs
  const count = db.exec('SELECT COUNT(*) FROM achievements')
  const c = (count?.[0]?.values?.[0]?.[0] as number) || 0
  const ver = getSetting('ach_version')
  if (c === 38 && ver === '4') return

  // Force rebuild
  db.run('DELETE FROM achievements')

  // Insert all 38 new achievements
  const all = [
    { id:'total-30h',pm:30*3600 },{ id:'total-100h',pm:100*3600 },{ id:'total-250h',pm:250*3600 },
    { id:'streak-3',pm:3 },{ id:'streak-7',pm:7 },{ id:'streak-14',pm:14 },
    { id:'phy-20',pm:20*3600 },{ id:'phy-60',pm:60*3600 },{ id:'phy-100',pm:100*3600 },
    { id:'math-15',pm:15*3600 },{ id:'math-50',pm:50*3600 },{ id:'math-85',pm:85*3600 },
    { id:'eng-20',pm:20*3600 },{ id:'eng-70',pm:70*3600 },{ id:'eng-120',pm:120*3600 },
    { id:'daily-6h',pm:6*3600 },{ id:'daily-8h',pm:8*3600 },
    { id:'morning-5',pm:5 },{ id:'morning-10',pm:10 },{ id:'morning-18',pm:18 },
    { id:'night-5',pm:5 },{ id:'night-10',pm:10 },{ id:'night-18',pm:18 },
    { id:'focus-2h-3',pm:3 },{ id:'focus-2h-7',pm:7 },{ id:'focus-3h-3',pm:3 },
    { id:'comeback-6h',pm:1 },{ id:'comeback-8h',pm:1 },
    { id:'burst-phy',pm:1 },{ id:'burst-math',pm:1 },{ id:'burst-eng',pm:1 },
    { id:'balanced',pm:1 },{ id:'dawn-dusk',pm:1 },
    { id:'over-phy-10',pm:10 },{ id:'over-math-10',pm:10 },{ id:'over-eng-10',pm:10 },
    { id:'triple-over',pm:1 },{ id:'triple-3',pm:3 },
  ]
  for (const a of all) {
    db.run('INSERT INTO achievements (id, unlocked, progress, progress_max) VALUES (?, 0, 0, ?)', [a.id, a.pm])
  }
  setSetting('db_version', '4')
  console.log('[db] Achievement v4 migration complete — 38 achievements seeded')
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

export function insertRawEvent(event: Omit<RawEvent, 'id'>): void {
  db?.run(
    'INSERT OR IGNORE INTO raw_events (aw_id, timestamp, duration, app, title, url, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
  const result = db?.exec("SELECT COALESCE(SUM(duration), 0) FROM merged_segments WHERE date = ? AND subject IN ('物理','数学','英语') AND is_exploded = 0", [date])
  if (result && result.length > 0 && result[0].values[0]) {
    return result[0].values[0][0] as number
  }
  return 0
}

export function reclassifySegment(segmentId: number, newSubject: Subject): void {
  const result = db?.exec('SELECT date, title, app, start_time FROM merged_segments WHERE id = ?', [segmentId])
  if (!result || result.length === 0 || result[0].values.length === 0) return

  const row = result[0].values[0]
  const date = row[0] as string
  const title = row[1] as string
  const app = row[2] as string

  db?.run('UPDATE merged_segments SET subject = ? WHERE id = ?', [newSubject, segmentId])
  db?.run(
    `UPDATE raw_events SET subject = ?
     WHERE date(timestamp) = ? AND title = ? AND app = ? AND (subject IS NULL OR subject = '未分类')`,
    [newSubject, date, title, app]
  )

  // Add a temp classification rule (skip for '未分类' and '其他' — those are fallbacks, not real classifications)
  if (newSubject !== '未分类' && newSubject !== '其他') {
    const existing = db?.exec(
      "SELECT id FROM classification_rules WHERE keyword = ? AND (match_field = 'all' OR match_field = 'title')",
      [title]
    )
    if (!existing || existing.length === 0 || existing[0].values.length === 0) {
      db?.run(
        "INSERT INTO classification_rules (subject, keyword, match_field, priority) VALUES (?, ?, 'all', ?)",
        [newSubject, title, 8]
      )
    }
  }

  save()
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
  const result = db?.exec('SELECT COALESCE(SUM(total_seconds), 0) FROM daily_stats')
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

export function getWeekStats(days: number): DayStats[] {
  const result: DayStats[] = []
  const today = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]

    const stats = getDailyStats(dateStr)
    const subjects: Record<string, number> = {}
    let total = 0

    for (const s of stats) {
      subjects[s.subject] = (subjects[s.subject] || 0) + s.total_seconds
      total += s.total_seconds
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

export interface AchievementInfo {
  id: string
  unlocked: boolean
  unlocked_at: string | null
  progress: number
  progress_max: number
}

export function getAchievementProgress(): AchievementInfo[] {
  // Compute everything from LIVE data — ignore DB's cached unlocked/progress
  const rows = db?.exec('SELECT id FROM achievements ORDER BY id')
  if (!rows || rows.length === 0) return []

  const totalSeconds = getTotalSecondsAllTime()
  const consecDays = getConsecutiveDays()
  const subjSec: Record<string, number> = {
    '物理': getSubjectTotal('物理'),
    '数学': getSubjectTotal('数学'),
    '英语': getSubjectTotal('英语'),
  }

  // Count exceeded days per subject
  const exceedDays: Record<string, number> = {}
  for (const s of ['物理', '数学', '英语']) {
    const r = db?.exec("SELECT COUNT(*) FROM daily_stats WHERE subject = ? AND exceeded = 1", [s])
    exceedDays[s] = (r?.[0]?.values?.[0]?.[0] as number) || 0
  }

  // Count days where all 3 subjects exceeded
  const grandSlam = db?.exec(
    "SELECT COUNT(*) FROM (SELECT date FROM daily_stats WHERE subject IN ('物理','数学','英语') AND exceeded = 1 GROUP BY date HAVING COUNT(*) >= 3)"
  )
  const grandSlamCount = (grandSlam?.[0]?.values?.[0]?.[0] as number) || 0

  const today = new Date().toISOString().split('T')[0]
  const todayStats = getDailyStats(today)
  const todayTotal = todayStats.reduce((s, d) => s + d.total_seconds, 0)

  const pm: Record<string, number> = {
    'total-30h':30*3600,'total-100h':100*3600,'total-250h':250*3600,
    'streak-3':3,'streak-7':7,'streak-14':14,
    'phy-20':20*3600,'phy-60':60*3600,'phy-100':100*3600,
    'math-15':15*3600,'math-50':50*3600,'math-85':85*3600,
    'eng-20':20*3600,'eng-70':70*3600,'eng-120':120*3600,
    'daily-6h':6*3600,
    'daily-8h':8*3600,
    'morning-5':5,'morning-10':10,'morning-18':18,
    'night-5':5,'night-10':10,'night-18':18,
    'focus-2h-3':3,'focus-2h-7':7,'focus-3h-3':3,
    'comeback-6h':1,'comeback-8h':1,
    'burst-phy':1,'burst-math':1,'burst-eng':1,
    'balanced':1,'dawn-dusk':1,
    'over-phy-10':10,'over-math-10':10,'over-eng-10':10,
    'triple-over':1,'triple-3':3,
  }

  const results: AchievementInfo[] = []
  for (const row of rows[0].values) {
    const id = row[0] as string
    const progressMax = pm[id] || 0
    let progress = 0

    switch (id) {
      case 'total-30h': case 'total-100h': case 'total-250h':
        progress = totalSeconds; break
      case 'streak-3': case 'streak-7': case 'streak-14':
        progress = consecDays; break
      case 'phy-20': case 'phy-60': case 'phy-100':
        progress = subjSec['物理'] || 0; break
      case 'math-15': case 'math-50': case 'math-85':
        progress = subjSec['数学'] || 0; break
      case 'eng-20': case 'eng-70': case 'eng-120':
        progress = subjSec['英语'] || 0; break
      case 'daily-6h': case 'daily-8h': progress = todayTotal; break
      case 'morning-5': case 'morning-10': case 'morning-18':
        progress = countMorningDays(); break
      case 'night-5': case 'night-10': case 'night-18':
        progress = countNightDays(); break
      case 'focus-2h-3': case 'focus-2h-7':
        progress = countFocusDays(120 * 60); break
      case 'focus-3h-3':
        progress = countFocusDays(180 * 60); break
      case 'comeback-6h': progress = countComebackDays(6 * 3600); break
      case 'comeback-8h': progress = countComebackDays(8 * 3600); break
      case 'burst-phy': progress = countBurstDays('物理', 240 * 60) >= 1 ? 1 : 0; break
      case 'burst-math': progress = countBurstDays('数学', 240 * 60) >= 1 ? 1 : 0; break
      case 'burst-eng': progress = countBurstDays('英语', 240 * 60) >= 1 ? 1 : 0; break
      case 'balanced': progress = countBalancedDays() >= 1 ? 1 : 0; break
      case 'dawn-dusk': progress = countDawnDuskDays() >= 1 ? 1 : 0; break
      case 'over-phy-10': progress = exceedDays['物理'] || 0; break
      case 'over-math-10': progress = exceedDays['数学'] || 0; break
      case 'over-eng-10': progress = exceedDays['英语'] || 0; break
      case 'triple-over': progress = grandSlamCount; break
      case 'triple-3': progress = countConsecutiveTripleDays() >= 3 ? 3 : countConsecutiveTripleDays(); break
    }

    const unlocked = progress >= progressMax && progressMax > 0
    const oldRow = db?.exec('SELECT unlocked, unlocked_at FROM achievements WHERE id = ?', [id])
    let unlockedAt: string | null = null
    if (oldRow && oldRow.length > 0 && oldRow[0].values.length > 0) {
      unlockedAt = oldRow[0].values[1] as string | null
      const wasUnlocked = Boolean(oldRow[0].values[0])
      if (unlocked && !wasUnlocked) {
        unlockedAt = new Date().toISOString()
        db?.run('UPDATE achievements SET unlocked=1, unlocked_at=?, progress=? WHERE id=?', [unlockedAt, progress, id])
      } else {
        db?.run('UPDATE achievements SET unlocked=?, progress=? WHERE id=?', [unlocked ? 1 : 0, progress, id])
      }
    }

    results.push({ id, unlocked, unlocked_at: unlockedAt, progress, progress_max: progressMax })
  }

  save()
  return results
}

/** Check all locked achievements and unlock any that meet conditions */
export function checkAndUnlockAchievements(): string[] {
  const newlyUnlocked: string[] = []
  const rows = db?.exec('SELECT id, unlocked, progress, progress_max FROM achievements')
  if (!rows || rows.length === 0) return newlyUnlocked

  const totalSeconds = getTotalSecondsAllTime()
  const consecDays = getConsecutiveDays()
  const today = new Date().toISOString().split('T')[0]
  const todayStats = getDailyStats(today)
  const todayMap: Record<string, number> = {}
  for (const s of todayStats) { todayMap[s.subject] = s.total_seconds }
  const todayTotal = Object.values(todayMap).reduce((a, b) => a + b, 0)

  const subjMap: Record<string, number> = {
    '物理': getSubjectTotal('物理'),
    '数学': getSubjectTotal('数学'),
    '英语': getSubjectTotal('英语'),
  }

  const now = new Date().toISOString()

  // Grand slam count for triple-over — count of days all 3 subjects exceeded
  const grandSlam = db?.exec(
    "SELECT COUNT(*) FROM (SELECT date FROM daily_stats WHERE subject IN ('物理','数学','英语') AND exceeded = 1 GROUP BY date HAVING COUNT(*) >= 3)"
  )
  const grandSlamCount = (grandSlam?.[0]?.values?.[0]?.[0] as number) || 0

  for (const row of rows[0].values) {
    const id = row[0] as string
    const unlocked = Boolean(row[1])
    if (unlocked) continue

    let shouldUnlock = false
    switch (id) {
      case 'total-30h': shouldUnlock = totalSeconds >= 30 * 3600; break
      case 'total-100h': shouldUnlock = totalSeconds >= 100 * 3600; break
      case 'total-250h': shouldUnlock = totalSeconds >= 250 * 3600; break
      case 'streak-3': shouldUnlock = consecDays >= 3; break
      case 'streak-7': shouldUnlock = consecDays >= 7; break
      case 'streak-14': shouldUnlock = consecDays >= 14; break
      case 'phy-20': shouldUnlock = subjMap['物理'] >= 20 * 3600; break
      case 'phy-60': shouldUnlock = subjMap['物理'] >= 60 * 3600; break
      case 'phy-100': shouldUnlock = subjMap['物理'] >= 100 * 3600; break
      case 'math-15': shouldUnlock = subjMap['数学'] >= 15 * 3600; break
      case 'math-50': shouldUnlock = subjMap['数学'] >= 50 * 3600; break
      case 'math-85': shouldUnlock = subjMap['数学'] >= 85 * 3600; break
      case 'eng-20': shouldUnlock = subjMap['英语'] >= 20 * 3600; break
      case 'eng-70': shouldUnlock = subjMap['英语'] >= 70 * 3600; break
      case 'eng-120': shouldUnlock = subjMap['英语'] >= 120 * 3600; break
      case 'daily-6h': shouldUnlock = todayTotal >= 6 * 3600; break
      case 'daily-8h': shouldUnlock = todayTotal >= 8 * 3600; break
      case 'over-phy-10': shouldUnlock = countOverachieveDays('物理') >= 10; break
      case 'over-math-10': shouldUnlock = countOverachieveDays('数学') >= 10; break
      case 'over-eng-10': shouldUnlock = countOverachieveDays('英语') >= 10; break
      case 'morning-5': shouldUnlock = countMorningDays() >= 5; break
      case 'morning-10': shouldUnlock = countMorningDays() >= 10; break
      case 'morning-18': shouldUnlock = countMorningDays() >= 18; break
      case 'night-5': shouldUnlock = countNightDays() >= 5; break
      case 'night-10': shouldUnlock = countNightDays() >= 10; break
      case 'night-18': shouldUnlock = countNightDays() >= 18; break
      case 'focus-2h-3': shouldUnlock = countFocusDays(120 * 60) >= 3; break
      case 'focus-2h-7': shouldUnlock = countFocusDays(120 * 60) >= 7; break
      case 'focus-3h-3': shouldUnlock = countFocusDays(180 * 60) >= 3; break
      case 'comeback-6h': shouldUnlock = countComebackDays(6 * 3600) >= 1; break
      case 'comeback-8h': shouldUnlock = countComebackDays(8 * 3600) >= 1; break
      case 'burst-phy': shouldUnlock = countBurstDays('物理', 240 * 60) >= 1; break
      case 'burst-math': shouldUnlock = countBurstDays('数学', 240 * 60) >= 1; break
      case 'burst-eng': shouldUnlock = countBurstDays('英语', 240 * 60) >= 1; break
      case 'balanced': shouldUnlock = countBalancedDays() >= 1; break
      case 'dawn-dusk': shouldUnlock = countDawnDuskDays() >= 1; break
      case 'triple-over': shouldUnlock = grandSlamCount >= 1; break
      case 'triple-3': shouldUnlock = countConsecutiveTripleDays() >= 3; break
    }

    if (shouldUnlock) {
      db?.run('UPDATE achievements SET unlocked = 1, unlocked_at = ? WHERE id = ?', [now, id])
      newlyUnlocked.push(id)
    }
  }

  if (newlyUnlocked.length > 0) save()
  return newlyUnlocked
}

function countOverachieveDays(subject: string): number {
  const r = db?.exec('SELECT COUNT(*) FROM daily_stats WHERE subject = ? AND exceeded = 1', [subject])
  if (r && r.length > 0 && r[0].values[0]) return r[0].values[0][0] as number
  return 0
}

function countConsecutiveTripleDays(): number {
  const r = db?.exec(`SELECT date FROM daily_stats WHERE subject IN ('物理','数学','英语') GROUP BY date HAVING SUM(CASE WHEN exceeded=1 THEN 1 ELSE 0 END)=3 ORDER BY date ASC`)
  if (!r || r.length === 0) return 0
  const dates = r[0].values.map(x => x[0] as string)
  let maxStreak = 0, cur = 1
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i-1]), curr = new Date(dates[i])
    if ((curr.getTime() - prev.getTime()) / 86400000 === 1) cur++
    else { maxStreak = Math.max(maxStreak, cur); cur = 1 }
  }
  maxStreak = Math.max(maxStreak, cur)
  return maxStreak
}

/** Get IDs of achievements whose progress has reached the threshold but aren't yet unlocked */
export function getPendingUnlocks(): string[] {
  const unlocked: string[] = []
  const rows = db?.exec('SELECT id, unlocked, progress, progress_max FROM achievements')
  if (!rows || rows.length === 0) return unlocked
  const now = new Date().toISOString()
  for (const row of rows[0].values) {
    const id = row[0] as string
    const unlockedFlag = Boolean(row[1])
    if (unlockedFlag) continue
    const progress = row[2] as number
    const progressMax = row[3] as number
    if (progress >= progressMax) {
      db?.run('UPDATE achievements SET unlocked = 1, unlocked_at = ? WHERE id = ?', [now, id])
      unlocked.push(id)
    }
  }
  if (unlocked.length > 0) save()
  return unlocked
}

/** 晨行天数：首段学习 < 07:00 */
export function countMorningDays(): number {
  const r = db?.exec(`SELECT COUNT(DISTINCT date) FROM merged_segments WHERE substr(start_time,12,5) < '07:00' AND subject NOT IN ('休闲','未分类','其他')`)
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 夜航天数：末段学习 > 22:00 */
export function countNightDays(): number {
  const r = db?.exec(`SELECT COUNT(DISTINCT date) FROM merged_segments WHERE substr(end_time,12,5) > '22:00' AND subject NOT IN ('休闲','未分类','其他')`)
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 朝暮行天数：同一天同时满足晨行+夜航 */
export function countDawnDuskDays(): number {
  const morning = new Set<string>()
  const mr = db?.exec(`SELECT DISTINCT date FROM merged_segments WHERE substr(start_time,12,5) < '07:00' AND subject NOT IN ('休闲','未分类','其他')`)
  if (mr) for (const r of mr[0]?.values || []) morning.add(r[0] as string)
  const night = new Set<string>()
  const nr = db?.exec(`SELECT DISTINCT date FROM merged_segments WHERE substr(end_time,12,5) > '22:00' AND subject NOT IN ('休闲','未分类','其他')`)
  if (nr) for (const r of nr[0]?.values || []) night.add(r[0] as string)
  let count = 0
  for (const d of morning) { if (night.has(d)) count++ }
  return count
}

/** 有连续学习段 ≥ minSeconds 的天数 */
export function countFocusDays(minSeconds: number): number {
  const r = db?.exec('SELECT COUNT(DISTINCT date) FROM merged_segments WHERE duration >= ? AND subject NOT IN (\'休闲\',\'未分类\',\'其他\')', [minSeconds])
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 单个科目单日最大秒数 */
export function maxDailySubjectSeconds(subject: string): number {
  const r = db?.exec('SELECT COALESCE(MAX(total_seconds),0) FROM daily_stats WHERE subject = ?', [subject])
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 某科目单日 ≥ minSeconds 的天数 */
export function countBurstDays(subject: string, minSeconds: number): number {
  const r = db?.exec('SELECT COUNT(*) FROM daily_stats WHERE subject = ? AND total_seconds >= ?', [subject, minSeconds])
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 均衡日：三科都>=目标且都<目标×1.5 */
export function countBalancedDays(): number {
  const r = db?.exec(`SELECT COUNT(*) FROM (SELECT date FROM daily_stats WHERE subject IN ('物理','数学','英语') GROUP BY date HAVING SUM(CASE WHEN achieved=1 AND exceeded=0 THEN 1 ELSE 0 END)=3)`)
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
}

/** 逆袭天数：当天学习 >= minSeconds 且前一天学习 < 1h（或没有记录） */
export function countComebackDays(minSeconds: number): number {
  const r = db?.exec(`
    SELECT COUNT(DISTINCT a.date) FROM daily_stats a
    WHERE a.total_seconds >= ?
    AND NOT EXISTS (
      SELECT 1 FROM daily_stats b
      WHERE b.date = date(a.date, '-1 day')
      AND b.total_seconds >= 3600
    )
  `, [minSeconds])
  return (r?.[0]?.values?.[0]?.[0] as number) || 0
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
