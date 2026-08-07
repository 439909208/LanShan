/**
 * 专注模式会话注入/清理脚本（冒烟测试用）
 *
 * 用法（务必先关闭澜山应用，sql.js 是内存库，应用运行时写入会被覆盖）：
 *   node scripts/focus-seed-test.ts           # 注入一个 3 分钟后到期的专注会话
 *   node scripts/focus-seed-test.ts --clean   # 清理会话残留（注入测试后必跑）
 *
 * 注入后启动应用（npm run dev）→ 应用应恢复锁屏：全屏专注桌面弹出、主窗口隐藏。
 * 验证完毕关掉应用，再跑 --clean 恢复。
 */
import initSqlJs from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DB_PATH = join(HOME, '澜山数据', 'lanshan.db')

const SESSION_KEYS = ['focus_session_end', 'focus_session_duration', 'focus_session_whitelist']

async function main() {
  const clean = process.argv.includes('--clean')
  if (!existsSync(DB_PATH)) {
    console.error('✗ 未找到数据库文件：' + DB_PATH)
    process.exit(1)
  }
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(DB_PATH))

  if (clean) {
    for (const key of SESSION_KEYS) {
      db.run('DELETE FROM settings WHERE key = ?', [key])
    }
    writeFileSync(DB_PATH, Buffer.from(db.export()))
    console.log('✓ 已清理专注会话残留：' + SESSION_KEYS.join(', '))
    return
  }

  const endAt = new Date(Date.now() + 3 * 60 * 1000).toISOString()
  for (const [key, value] of [
    ['focus_session_end', endAt],
    ['focus_session_duration', '3'],
    ['focus_session_whitelist', '[]'],
  ] as const) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  }
  writeFileSync(DB_PATH, Buffer.from(db.export()))
  console.log('✓ 已注入专注会话：', endAt, '（3 分钟后到期，白名单为空→自动含澜山）')
  console.log('  现在启动应用，应看到全屏专注桌面弹出。')
}

main()
