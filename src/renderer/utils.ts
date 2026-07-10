const SUBJECT_COLORS: Record<string, string> = {
  '物理': '#f59e0b',
  '数学': '#3b82f6',
  '英语': '#22c55e',
  '休闲': '#ec4899',
  '其他': '#9ca3af',
  '未分类': '#64748b',
}

const SUBJECT_ICONS: Record<string, string> = {
  '物理': '🔋',
  '数学': '🔢',
  '英语': '🔤',
  '休闲': '🎮',
  '其他': '📋',
  '未分类': '❓',
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
  return `${m}m`
}

export function formatShortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
}
