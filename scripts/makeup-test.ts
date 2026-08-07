/**
 * 补签分配算法验证脚本（合成数据，不碰数据库）
 * 运行：node scripts/makeup-test.ts
 *
 * 说明：窗口内"空白日"不止目标日一个——为了让盈余"流到"目标日，
 * 中间的天都要给已达标数据（need=0），否则它们会先被回填（按设计：最早缺口优先）。
 */
import { simulateMakeups, addDays, diffDays, dateStr } from '../src/main/makeup.ts'
import type { DayStat, MakeupFill } from '../src/main/makeup.ts'

const TARGET = 2 * 3600 // 每科每日目标 2h
const TODAY = '2026-08-10'
let failures = 0

function day(offset: number, total: number, target: number = TARGET): DayStat {
  return { date: addDays(TODAY, offset), total, target }
}
/** 已达标（无缺口、无盈余）的天 */
function study(offset: number): DayStat {
  return day(offset, TARGET)
}

function run(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`✗ ${name}`)
    console.error(`  ${(e as Error).message}`)
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

function findResult(results: ReturnType<typeof simulateMakeups>, offset: number) {
  const date = addDays(TODAY, offset)
  const r = results.find(x => x.date === date)
  assert(!!r, `缺少第 ${offset} 天的结果`)
  return r!
}

// ── 1. 基础回填：昨天盈余 2h → 今天空白补满 ──
run('基础回填：盈余补满当天缺口', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 2 * 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.need === TARGET, `今天缺口应为 ${TARGET}，实际 ${t.need}`)
  assert(t.newAmount === TARGET, `应补满 ${TARGET}，实际 ${t.newAmount}`)
  assert(t.newFills[0]?.sourceDate === addDays(TODAY, -1), '盈余来源应为昨天')
  assert(t.balanceAfter === 0, `盈余应耗尽，剩余 ${t.balanceAfter}`)
})

// ── 2. FIFO：最早盈余优先 ──
run('FIFO：最早的盈余先被消耗', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), day(-2, TARGET + 3600), day(-1, TARGET + 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.newAmount === 2 * 3600, `应补 2h，实际 ${t.newAmount}`)
  assert(t.newFills[0]?.sourceDate === addDays(TODAY, -2), '应优先用两天前的盈余')
  assert(t.balanceAfter === 0, '盈余应耗尽')
})

// ── 3. 过期：盈余第 8 天就补不了了 ──
run('过期：盈余仅 7 天内有效', () => {
  // day(-8) 盈余 1h（今天 diff=8，已过期）；day(-7) 盈余 1h（diff=7，还能补）
  const res = simulateMakeups({
    stats: [day(-8, TARGET + 3600), day(-7, TARGET + 3600), study(-6), study(-5), study(-4), study(-3), study(-2), study(-1)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.newAmount === 3600, `今天只能补到 day(-7) 的 1h，实际 ${t.newAmount}`)
  assert(t.newFills[0]?.sourceDate === addDays(TODAY, -7), '来源应为 day(-7)')
})

// ── 4. 窗口：7 天前的缺口补不了 ──
run('窗口：只有最近 7 天的缺口可补', () => {
  // day(-8) 空白（不在窗口内），day(-1) 盈余 2h → day(-8) 不应产生补签
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 2 * 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const d8 = findResult(res, -8)
  assert(d8.need === TARGET, `day(-8) 应有缺口，实际 ${d8.need}`)
  assert(d8.newAmount === 0, '窗口外的缺口不应被补')
  const t = findResult(res, 0)
  assert(t.newAmount === TARGET, '盈余应留给窗口内最近的缺口')
})

// ── 5. 部分补：盈余不够就补一部分 ──
run('部分补：盈余不足时部分回填', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.newAmount === 3600, `只应补 1h，实际 ${t.newAmount}`)
  assert(t.need - t.existingAmount - t.newAmount === 3600, '仍缺 1h 未补')
})

// ── 6. 已持久化补签强制消耗，不双重花费 ──
run('已有补签优先消耗盈余（不双重花费）', () => {
  // day(-3) 盈余 2h；day(-2) 缺口 1h 且已有 1h 补签（历史，缺口已满）；day0 缺口 1h
  const existing: MakeupFill[] = [{ date: addDays(TODAY, -2), subject: '数学', amount: 3600, sourceDate: addDays(TODAY, -3), manual: false }]
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), day(-3, TARGET + 2 * 3600), day(-2, TARGET - 3600), study(-1)],
    existing,
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const d2 = findResult(res, -2)
  assert(d2.existingAmount === 3600, 'day(-2) 已有补签 1h 应被计入')
  assert(d2.newAmount === 0, '缺口已被历史补签填满，不应新增')
  const t = findResult(res, 0)
  assert(t.newAmount === 3600, `day(0) 应补到剩余 1h，实际 ${t.newAmount}`)
  assert(t.balanceAfter === 0, '总消耗不得超过总盈余')
})

// ── 7. undone：标记保持空白的日子不补，盈余留给后面 ──
run('撤销日不自动回填，盈余留给他日', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 2 * 3600)],
    existing: [],
    undoneDates: new Set([addDays(TODAY, 0)]),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.newAmount === 0, '撤销日不应被自动回填')
  assert(t.balanceAfter === 2 * 3600, '盈余应保留给后续日子')
})

// ── 8. availability：查某天可用盈余（不生成新补签）──
run('可用盈余查询（dryRun）', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 2 * 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
    generateNew: false,
  })
  const t = findResult(res, 0)
  assert(t.newAmount === 0, 'dryRun 不应生成补签')
  assert(t.balanceAfter === 2 * 3600, `可用盈余应为 2h，实际 ${t.balanceAfter}`)
  assert(t.need === TARGET, '缺口信息应完整返回')
})

// ── 9. 跨月日期运算 ──
run('日期工具：跨月/跨年', () => {
  assert(addDays('2026-08-31', 1) === '2026-09-01', '8月31日+1应为9月1日')
  assert(addDays('2026-12-31', 1) === '2027-01-01', '跨年运算')
  assert(diffDays('2026-08-01', '2026-08-08') === 7, '日期差计算')
  assert(dateStr(new Date('2026-08-05T12:00:00Z')) === '2026-08-05', 'dateStr 应返回本地日期')
})

// ── 10. 不达标不产生盈余 ──
run('边界：不达标的天不产生盈余', () => {
  const res = simulateMakeups({
    stats: [study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, 100)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
  })
  const t = findResult(res, 0)
  assert(t.balanceAfter === 0, '不达标不应产生盈余')
})

// ── 11. 全日期：永久有效的盈余（validDays=-1）──
run('全日期：很久以前的盈余也能补', () => {
  const res = simulateMakeups({
    stats: [day(-30, TARGET + 2 * 3600), study(-6), study(-5), study(-4), study(-3), study(-2), study(-1)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
    validDays: -1,
    startDate: addDays(TODAY, -30),
  })
  const t = findResult(res, 0)
  assert(t.newAmount === TARGET, `应补满 ${TARGET}，实际 ${t.newAmount}`)
  assert(t.newFills[0]?.sourceDate === addDays(TODAY, -30), '来源应为 30 天前的盈余')
  assert(t.balanceAfter === 0, `盈余 2h 补掉 2h 缺口后应耗尽，实际 ${t.balanceAfter}`)
})

// ── 12. 累计盈余（gross）：历史超额总和，不随补签减少 ──
run('累计盈余：不随补签减少', () => {
  // day(-30) 盈余 2h + day(-1) 盈余 1h → 累计 3h；day0 补掉 2h 后可用剩 1h，累计仍 3h
  const res = simulateMakeups({
    stats: [day(-30, TARGET + 2 * 3600), study(-6), study(-5), study(-4), study(-3), study(-2), day(-1, TARGET + 3600)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
    validDays: -1,
    startDate: addDays(TODAY, -30),
  })
  const t = findResult(res, 0)
  assert(t.grossAfter === 3 * 3600, `累计盈余应为 3h，实际 ${t.grossAfter}`)
  assert(t.newAmount === TARGET, `今天应补 2h，实际 ${t.newAmount}`)
  assert(t.balanceAfter === 3600, `可用盈余应剩 1h，实际 ${t.balanceAfter}`)
})

// ── 13. 补签范围（fillFrom）：范围外的空缺不可补，但盈余统计不受影响 ──
run('补签范围：范围外的空缺不可补，盈余统计不受影响', () => {
  // day(-30) 盈余 3h（所有日期都统计）；day(-10) 空白在 fillFrom(-6) 之前 → 不可补；day0 空白可补
  const res = simulateMakeups({
    stats: [day(-30, TARGET + 3 * 3600), study(-6), study(-5), study(-4), study(-3), study(-2), study(-1)],
    existing: [],
    undoneDates: new Set(),
    today: TODAY,
    defaultTarget: TARGET,
    validDays: -1,
    fillFrom: addDays(TODAY, -6),
    startDate: addDays(TODAY, -30),
  })
  const d10 = findResult(res, -10)
  assert(d10.grossAfter === 3 * 3600, '盈余统计应为所有日期（3h）')
  assert(d10.fillable === false, '范围外的空缺应标记为不可补')
  assert(d10.newAmount === 0, '范围外的空缺不应产生补签')
  const t = findResult(res, 0)
  assert(t.fillable === true, '范围内的空缺应标记为可补')
  assert(t.newAmount === TARGET, `今天应补 2h，实际 ${t.newAmount}`)
})

if (failures > 0) {
  console.error(`\n${failures} 个用例失败`)
  process.exit(1)
} else {
  console.log('\n全部用例通过 ✅')
}
