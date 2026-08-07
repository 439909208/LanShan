/**
 * 补签功能端到端测试辅助脚本
 *
 * 用法（务必先关闭澜山应用，sql.js 是内存库，应用运行时写入会被覆盖）：
 *   node scripts/makeup-seed-test.ts          # 注入演示数据
 *   node scripts/makeup-seed-test.ts --clean  # 还原被改动的数据
 *
 * 做什么：
 *   1. 在窗口内找第一个"数学有缺口"的日子 D（没学或没学够）
 *   2. 在 D 前一天 S 注入 2 小时数学盈余（真实原值备份到 marker 文件）
 *   3. 打开应用 → 手动点 D 的格子 → 点「补签」按钮（纯手动模式，无自动回填）
 */
import initSqlJs from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { simulateMakeups, addDays, MAKEUP_WINDOW_DAYS, MAKEUP_FILL_ALL } from '../src/main/makeup.ts'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DATA_DIR = process.env.LANSHAHN_DATA_DIR || join(HOME, '澜山数据')
const DB_PATH = join(DATA_DIR, 'lanshan.db')
const MARKER = join(DATA_DIR, 'makeup-seed-marker.json')

const SUBJECT = '数学'

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ''}` : `${m}m`
}

async function main() {
  const clean = process.argv.includes('--clean')
  const purgeAuto = process.argv.includes('--purge-auto')

  if (!existsSync(DB_PATH)) {
    console.error('✗ 未找到数据库文件：' + DB_PATH)
    console.error('  请先运行一次应用（npm run dev）生成数据库，再执行本脚本。')
    process.exit(1)
  }

  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(DB_PATH))

  // ── --purge-auto：清除历史自动补签记录（手动模式切换用）──
  if (purgeAuto) {
    db.run('DELETE FROM makeup_fills WHERE manual = 0')
    db.run('DELETE FROM makeup_undone')
    writeFileSync(DB_PATH, Buffer.from(db.export()))
    console.log('✓ 已清除所有自动补签记录与留白标记，恢复纯手动模式。')
    return
  }

  // 老库可能还没有补签表（表由应用启动时创建）——这里补建，保证脚本可用
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

  // ── --clean：还原 ──
  if (clean) {
    if (!existsSync(MARKER)) {
      console.log('没有找到 marker 文件，无需还原（或已被清理过）。')
      return
    }
    const m = JSON.parse(readFileSync(MARKER, 'utf-8'))
    if (m.originalS) {
      db.run(
        'INSERT INTO daily_stats (date, subject, total_seconds, target_seconds, achieved, exceeded) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(date, subject) DO UPDATE SET total_seconds = excluded.total_seconds, target_seconds = excluded.target_seconds, achieved = excluded.achieved, exceeded = excluded.exceeded',
        [m.S, SUBJECT, m.originalS.total, m.originalS.target, m.originalS.achieved ? 1 : 0, m.originalS.exceeded ? 1 : 0]
      )
      console.log(`✓ 已还原 ${m.S} 的数学数据（原 ${fmt(m.originalS.total)}）`)
    } else {
      db.run("DELETE FROM daily_stats WHERE date = ? AND subject = ?", [m.S, SUBJECT])
      console.log(`✓ 已删除注入的 ${m.S} 数学盈余行`)
    }
    // 清掉演示日产生的补签/留白标记
    db.run('DELETE FROM makeup_fills WHERE date = ?', [m.D])
    db.run('DELETE FROM makeup_undone WHERE date = ?', [m.D])
    writeFileSync(DB_PATH, Buffer.from(db.export()))
    console.log('✓ 已清理演示日的补签记录，可以重新打开应用了。')
    return
  }

  // ── 注入 ──
  const today = new Date()

  // 1. 找演示日 D：窗口内第一个"数学有缺口"的日子（从昨天往前找 6 天）
  const targetRow = db.exec("SELECT value FROM settings WHERE key = 'target_数学'")
  const target = targetRow.length && targetRow[0].values.length ? parseInt(targetRow[0].values[0][0] as string, 10) : 7200

  let D: string | null = null
  let DExisting: { total: number; target: number; achieved: boolean; exceeded: boolean } | null = null
  for (let i = 1; i <= 6; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = localDateStr(d)
    const row = db.exec("SELECT total_seconds, target_seconds, achieved, exceeded FROM daily_stats WHERE date = ? AND subject = ?", [ds, SUBJECT])
    if (row.length && row[0].values.length) {
      const r = row[0].values[0]
      const st = { total: r[0] as number, target: r[1] as number, achieved: Boolean(r[2]), exceeded: Boolean(r[3]) }
      if (st.total < st.target) { D = ds; DExisting = st; break } // 学了但没达标 → 演示部分补
    } else {
      D = ds; DExisting = null; break // 完全空白 → 演示全补
    }
  }

  if (!D) {
    console.error('✗ 最近 7 天内每一天的数学都已达标，没有可演示的空缺日。')
    console.error('  可以：a) 换成别的科目（改脚本 SUBJECT）；b) 过两天等有空白日再来；c) 手动把某天的 daily_stats 删掉')
    process.exit(1)
  }

  // 2. 注入盈余：D 前一天 S，数学 = 目标 + 1h
  const sDate = new Date(D + 'T00:00:00')
  sDate.setDate(sDate.getDate() - 1)
  const S = localDateStr(sDate)
  const sRow = db.exec("SELECT total_seconds, target_seconds, achieved, exceeded FROM daily_stats WHERE date = ? AND subject = ?", [S, SUBJECT])
  const originalS = sRow.length && sRow[0].values.length
    ? { total: sRow[0].values[0][0] as number, target: sRow[0].values[0][1] as number, achieved: Boolean(sRow[0].values[0][2]), exceeded: Boolean(sRow[0].values[0][3]) }
    : null

  const newTotal = target * 2 // 盈余 = 整目标时长，保证演示日能被补满亮起
  const achieved = 1
  const exceeded = newTotal >= target * 1.5 ? 1 : 0
  db.run(
    'INSERT INTO daily_stats (date, subject, total_seconds, target_seconds, achieved, exceeded) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(date, subject) DO UPDATE SET total_seconds = excluded.total_seconds, target_seconds = excluded.target_seconds, achieved = excluded.achieved, exceeded = excluded.exceeded',
    [S, SUBJECT, newTotal, target, achieved, exceeded]
  )

  // 3. 写回 + 记录 marker
  writeFileSync(DB_PATH, Buffer.from(db.export()))
  writeFileSync(MARKER, JSON.stringify({ S, D, subject: SUBJECT, originalS }))

  // 4. 自检：用与应用相同的逻辑（generateNew=false = 只查可用量，无自动补签）
  const todayStr = localDateStr(today)
  const from = addDays(todayStr, -(MAKEUP_WINDOW_DAYS - 1))
  const stats = db.exec(
    'SELECT date, total_seconds, target_seconds FROM daily_stats WHERE date >= ? AND date <= ? AND subject = ? ORDER BY date',
    [from, todayStr, SUBJECT]
  )
  const dayStats = stats.length
    ? stats[0].values.map(r => ({ date: r[0] as string, total: r[1] as number, target: r[2] as number }))
    : []
  const existingFills = db.exec('SELECT date, amount, source_date FROM makeup_fills WHERE date >= ? AND date <= ?', [from, todayStr])
  const existing = existingFills.length
    ? existingFills[0].values.map(r => ({ date: r[0] as string, subject: SUBJECT, amount: r[1] as number, sourceDate: r[2] as string, manual: false }))
    : []
  const undoneRows = db.exec('SELECT date FROM makeup_undone')
  const undone = new Set(undoneRows.length ? undoneRows[0].values.map(r => r[0] as string) : [])

  // 读取补签范围设置，与应用的 getMakeupScope 保持一致（只影响哪些空缺可补，不影响盈余统计）
  const scopeRow = db.exec("SELECT value FROM settings WHERE key = 'makeup_scope'")
  const scope = (scopeRow[0]?.values?.[0]?.[0] as string) ?? 'all'
  const fillFrom = scope === 'week'
    ? addDays(todayStr, -(MAKEUP_WINDOW_DAYS - 1))
    : scope === 'month' ? todayStr.slice(0, 7) + '-01' : MAKEUP_FILL_ALL

  const sim = simulateMakeups({
    stats: dayStats,
    existing,
    undoneDates: undone,
    today: todayStr,
    defaultTarget: target,
    validDays: -1,
    fillFrom,
    startDate: from,
    generateNew: false, // 纯手动模式：只计算可用量，不生成补签
  })
  const dResult = sim.find(r => r.date === D)
  const needForD = DExisting ? DExisting.target - DExisting.total : target
  const availForD = dResult?.balanceAfter ?? 0
  if (availForD >= needForD) {
    console.log(`  ✓ 自检通过：${D} 可用盈余 ${fmt(availForD)} ≥ 缺口 ${fmt(needForD)}，可手动补满`)
  } else {
    console.log(`  ⚠ 自检：${D} 可用盈余 ${fmt(availForD)}，缺口 ${fmt(needForD)}——只能部分补（仍可演示）`)
  }

  console.log('=== 演示数据已注入 ===')
  console.log(`  ${S}（演示日前一天）: 注入数学盈余 ${fmt(newTotal - target)}（总 ${fmt(newTotal)}，目标 ${fmt(target)}）`)
  console.log(`  ${D}（演示日）: 数学${DExisting ? `只学了 ${fmt(DExisting.total)}（缺口 ${fmt(DExisting.target - DExisting.total)}）` : '完全空白'}`)
  console.log('')
  console.log('下一步：打开应用，手动补签演示：')
  console.log(`  1. 点击 ${D} 的格子 → 弹窗底部「✚ 补签」区块`)
  console.log(`  2. 数学那行点「补签（可用 ${fmt(availForD)}）」→ 格子亮起 + 出现 ● 圆点`)
  console.log(`  3. 悬停该格：tooltip 显示「✚ 补签 …（来源 ${S} · 手动）」`)
  console.log(`  4. 再点一次该格 → 点「撤销补签」→ 格子变回空白（撤销后自动回填不会再填它）`)
  console.log('')
  console.log('测试完还原数据（先关闭应用）：node scripts/makeup-seed-test.ts --clean')
}

try {
  await main()
} catch (e) {
  console.error('✗ 失败:', (e as Error).message)
  process.exitCode = 1
}
