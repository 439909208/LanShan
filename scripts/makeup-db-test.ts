/**
 * 补签数据库层 SQL 验证（内存 sql.js，捕获 SQL 语法错误）
 * 运行：node scripts/makeup-db-test.ts
 * 说明：database.ts 依赖 electron 无法在纯 node 中运行，
 * 这里用与 database.ts 完全一致的 SQL 语句走一遍增删查流程。
 */
import initSqlJs from 'sql.js'

const CORE = ['物理', '数学', '英语']

try {
  await main()
  console.log('✓ 数据库层 SQL 全部通过（建表/查询/插入/撤销/settings）')
} catch (e) {
  console.error('✗ 失败:', (e as Error).message)
  process.exitCode = 1
}

async function main() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  // ── 建表（与 database.ts initSchema 一致）──
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
  db.run('CREATE INDEX IF NOT EXISTS idx_makeup_fills_date ON makeup_fills(date)')
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // ── 造数据：8月3日 数学超时 2h；8月5日 数学空白 ──
  db.run(
    "INSERT INTO daily_stats (date, subject, total_seconds, target_seconds, achieved, exceeded) VALUES ('2026-08-03', '数学', 14400, 7200, 1, 1)"
  )
  db.run(
    "INSERT INTO daily_stats (date, subject, total_seconds, target_seconds, achieved, exceeded) VALUES ('2026-08-04', '数学', 7200, 7200, 1, 0)"
  )

  // ── getCoreStatsRange 的 SQL ──
  const stats = db.exec(
    "SELECT date, subject, total_seconds, target_seconds FROM daily_stats WHERE date >= '2026-08-03' AND date <= '2026-08-05' AND subject IN (?, ?, ?) ORDER BY date",
    CORE
  )
  if (stats.length === 0 || stats[0].values.length !== 2) throw new Error('getCoreStatsRange 查询异常')

  // ── 自动回填插入（ensureMakeupsRefreshed 的写入路径）──
  db.run(
    'INSERT INTO makeup_fills (date, subject, amount, source_date, manual, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ['2026-08-05', '数学', 7200, '2026-08-03', new Date().toISOString()]
  )

  // ── getMakeupFills 的 SQL ──
  const fills = db.exec("SELECT date, subject, amount, source_date, manual FROM makeup_fills WHERE date LIKE ? ORDER BY date, subject", ['2026-08%'])
  if (fills.length === 0 || fills[0].values.length !== 1) throw new Error('getMakeupFills 查询异常')
  const fill = fills[0].values[0]
  if (fill[0] !== '2026-08-05' || fill[1] !== '数学' || fill[2] !== 7200 || fill[4] !== 0) {
    throw new Error('补签记录字段不符: ' + JSON.stringify(fill))
  }

  // ── getUndoneSet 的 SQL ──
  db.run('INSERT OR REPLACE INTO makeup_undone (date, subject) VALUES (?, ?)', ['2026-08-05', '数学'])
  const undone = db.exec('SELECT date FROM makeup_undone')
  if (undone.length === 0 || undone[0].values.length !== 1) throw new Error('makeup_undone 查询异常')

  // ── 手动补签（applyMakeup 写入路径）──
  // 业务上手动补签只发生在"该科仍有缺口"时，先清掉自动回填的记录再插入手动记录
  db.run('DELETE FROM makeup_undone WHERE date = ? AND subject = ?', ['2026-08-05', '数学'])
  db.run("DELETE FROM makeup_fills WHERE date = '2026-08-05' AND subject = '数学'")
  db.run(
    'INSERT INTO makeup_fills (date, subject, amount, source_date, manual, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ['2026-08-05', '数学', 3600, '2026-08-03', new Date().toISOString()]
  )
  const manualFills = db.exec("SELECT manual FROM makeup_fills WHERE date = '2026-08-05' AND subject = '数学'")
  if (manualFills[0].values.length !== 1 || manualFills[0].values[0][0] !== 1) throw new Error('手动补签标记异常')

  // ── 撤销（undoMakeup 写入路径）──
  db.run("DELETE FROM makeup_fills WHERE date = '2026-08-05' AND subject = '数学'")
  db.run('INSERT OR REPLACE INTO makeup_undone (date, subject) VALUES (?, ?)', ['2026-08-05', '数学'])
  const afterUndo = db.exec("SELECT COUNT(*) FROM makeup_fills WHERE date = '2026-08-05'")
  if (afterUndo[0].values[0][0] !== 0) throw new Error('撤销后补签记录应清空')

  // ── settings 读写 ──
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['makeup_last_refresh', '2026-08-10'])
  const refresh = db.exec("SELECT value FROM settings WHERE key = 'makeup_last_refresh'")
  if (refresh[0].values[0][0] !== '2026-08-10') throw new Error('settings 读写异常')
}
