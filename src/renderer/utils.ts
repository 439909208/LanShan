const SUBJECT_COLORS: Record<string, string> = {
  '物理': '#facc15',
  '数学': '#3b82f6',
  '英语': '#ef4444',
  '休闲': '#ec4899',
  '其他': '#9ca3af',
}

const SUBJECT_ICONS: Record<string, string> = {
  '物理': '🔋',
  '数学': '🔢',
  '英语': '🔤',
  '休闲': '🎮',
  '其他': '📋',
}

/** 三阶图标映射：初涉 → 半程 → 凌顶 */
const TIER_ICONS: Record<string, [string, string, string]> = {
  '物理': ['🔋', '⚡', '⚛️'],
  '数学': ['🔢', '📊', '🧮'],
  '英语': ['🔤', '📝', '🌐'],
}

/** 科目ID前缀映射 */
const TIER_PREFIX: Record<string, string> = {
  '物理': 'phy', '数学': 'math', '英语': 'eng',
}

/** 各阶段阈值ID */
const TIER_1_IDS: Record<string, string[]> = {
  'phy': ['phy-60'], 'math': ['math-50'], 'eng': ['eng-70'],
}
const TIER_2_IDS: Record<string, string[]> = {
  'phy': ['phy-100'], 'math': ['math-85'], 'eng': ['eng-120'],
}

export function getSubjectColor(subject: string): string {
  return SUBJECT_COLORS[subject] || '#64748b'
}

export function getSubjectIcon(subject: string): string {
  return SUBJECT_ICONS[subject] || '❓'
}

/**
 * 根据已解锁成就返回对应科目的层级图标。
 * 无成就 → 初涉（默认），有半程成就 → 半程，有凌顶成就 → 凌顶
 */
export function getSubjectTierIcon(
  subject: string,
  achievements: { id: string; unlocked: boolean }[]
): string {
  const tiers = TIER_ICONS[subject]
  if (!tiers) return getSubjectIcon(subject)
  const prefix = TIER_PREFIX[subject]
  if (!prefix) return tiers[0]

  const unlocked = achievements.filter(a => a.unlocked)
  if (unlocked.some(a => TIER_2_IDS[prefix]?.includes(a.id))) return tiers[2]
  if (unlocked.some(a => TIER_1_IDS[prefix]?.includes(a.id))) return tiers[1]
  return tiers[0]
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '0m'
}

export function formatShortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h${m}m${s}s`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

/** 倒计时格式：mm:ss 或 h:mm:ss */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 白名单条目标识 key（进程名|关键词，与主进程一致） */
export function focusEntryKey(a: { name: string; titleMatch?: string }): string {
  return a.name.toLowerCase() + '|' + (a.titleMatch || '').toLowerCase()
}

/**
 * 按专注桌面自定义顺序排序白名单（拖拽排序持久化）。
 * 未在顺序列表中的条目排在后面，保持原相对顺序。
 */
export function sortWhitelistByOrder<T extends { name: string; titleMatch?: string }>(items: T[], orderKeys: string[]): T[] {
  const idx = new Map(orderKeys.map((k, i) => [k, i]))
  return [...items].sort((a, b) => {
    const ia = idx.has(focusEntryKey(a)) ? idx.get(focusEntryKey(a))! : Number.MAX_SAFE_INTEGER
    const ib = idx.has(focusEntryKey(b)) ? idx.get(focusEntryKey(b))! : Number.MAX_SAFE_INTEGER
    return ia - ib
  })
}
