import { Subject, getClassificationRules, getTraySubject } from './database'

export interface ClassifyResult {
  subject: Subject
  method: 'keyword' | 'tray' | 'ambiguous'
  matchedKeyword?: string
}

/**
 * 可能含有学习内容的模糊 app/标题列表。
 * 只有当这些条目才需要托盘科目覆盖或手动标记为"未分类"。
 * 其他不匹配关键词的条目一律跳过，不入库。
 */
const AMBIGUOUS_PATTERNS = [
  '视频播放',
  '百度网盘',
  'baidunetdisk',
  'video player',
  'videoplayer',
]

/**
 * 判断一个条目是否属于"模糊条目"（标题太通用，无法判断科目，
 * 但可能是学习内容）。只有这类条目才需要托盘兜底或标记为未分类。
 */
function isAmbiguous(title: string, app: string): boolean {
  const lower = (title + ' ' + app).toLowerCase()
  return AMBIGUOUS_PATTERNS.some(p => lower.includes(p))
}

/**
 * 分类一条窗口活动记录。
 *
 * 优先级：
 * 1. 标题关键词匹配（最高优先级规则优先）
 * 2. 模糊条目且设了托盘科目 → 用托盘科目覆盖
 * 3. 模糊条目但没设托盘 → 标记为未分类（让用户手动标记）
 * 4. 其他条目（不匹配关键词且不模糊）→ 返回 null，跳过不入库
 */
export function classifyEvent(
  title: string,
  app: string,
  url?: string | null
): ClassifyResult | null {
  const rules = getClassificationRules()
  const titleLower = title.toLowerCase()
  const appLower = app.toLowerCase()
  const urlLower = (url || '').toLowerCase()

  // Step 1: 关键词匹配（优先级最高）
  for (const rule of rules) {
    const target =
      rule.match_field === 'title'
        ? titleLower
        : rule.match_field === 'app'
          ? appLower
          : urlLower

    if (target.includes(rule.keyword.toLowerCase())) {
      return {
        subject: rule.subject,
        method: 'keyword',
        matchedKeyword: rule.keyword,
      }
    }
  }

  // Step 2: 模糊条目（如"视频播放"）→ 用托盘科目覆盖或标记为未分类
  if (isAmbiguous(title, app)) {
    const traySubject = getTraySubject()
    if (traySubject) {
      return {
        subject: traySubject,
        method: 'tray',
      }
    }
    return {
      subject: '未分类',
      method: 'ambiguous',
    }
  }

  // Step 3: 不相关条目 → 跳过
  return null
}

/** 获取科目色值 */
export function getSubjectColor(subject: Subject): string {
  const colors: Record<Subject, string> = {
    '物理': '#f59e0b',
    '数学': '#3b82f6',
    '英语': '#22c55e',
    '娱乐': '#ef4444',
    '未分类': '#64748b',
  }
  return colors[subject] || '#64748b'
}

/** 获取科目图标 */
export function getSubjectIcon(subject: Subject): string {
  const icons: Record<Subject, string> = {
    '物理': '🔋',
    '数学': '🔢',
    '英语': '🔤',
    '娱乐': '🎮',
    '未分类': '❓',
  }
  return icons[subject] || '❓'
}

/** 获取科目中文名 */
export function getSubjectName(subject: Subject): string {
  return subject
}
