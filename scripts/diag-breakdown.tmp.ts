import initSqlJs from 'sql.js'
import { readFileSync } from 'fs'

const SQL = await initSqlJs()
const db = new SQL.Database(readFileSync('C:/Users/Administrator/澜山数据/lanshan.db'))
const CORE = ['物理', '数学', '英语']

for (const subject of CORE) {
  const rows = db.exec(
    'SELECT date, total_seconds, target_seconds FROM daily_stats WHERE subject = ? AND total_seconds > target_seconds ORDER BY date',
    [subject]
  )
  const list = (rows[0]?.values ?? []) as [string, number, number][]
  const total = list.reduce((s, r) => s + (r[1] - r[2]), 0)
  console.log(`【${subject}】超额天数=${list.length} 累计盈余=${(total / 3600).toFixed(2)}h`)
  for (const [date, tot, tgt] of list) {
    console.log(`  ${date}  实际 ${(tot / 3600).toFixed(2)}h / 目标 ${(tgt / 3600).toFixed(2)}h  → +${((tot - tgt) / 3600).toFixed(2)}h`)
  }
  // 数据覆盖范围
  const range = db.exec('SELECT MIN(date), MAX(date), COUNT(*) FROM daily_stats WHERE subject = ?', [subject])
  console.log(`  数据范围: ${JSON.stringify(range[0]?.values?.[0])}`)
}
