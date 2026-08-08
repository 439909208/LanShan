/** 刻章定义（主进程 getSealDefs 返回的原始结构） */
export interface SealDefLike {
  id: string
  type: 'cumulative' | 'daily'
  group: string
  name: string
  icon: string
  desc: string
  congrats: string
  /** 累积刻章的进度展示单位（小时阈值 / 天数阈值） */
  unit?: 'hours' | 'days'
}

/** 累积刻章状态（getSealsOverview().cumulative 元素） */
export interface CumulativeLike {
  id: string
  unlocked: boolean
  unlocked_at: string | null
  progress: number
  progress_max: number
}

/** 每日刻章状态（getSealsOverview().daily 元素） */
export interface DailyLike {
  id: string
  earned: boolean
  hint: string
}

/** 佩戴位（getSealsOverview().slots 元素） */
export interface SlotLike {
  slot: number
  seal_id: string
  date: string | null
}

/** 秒 → "3h05m" / "45m" */
export function fmtProg(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return `${h}h${String(m).padStart(2, '0')}m`
  }
  if (sec >= 60) return `${Math.floor(sec / 60)}m`
  return `${Math.round(sec)}s`
}

/** ISO → "今天" / "7月13日" */
export function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (dt.toDateString() === new Date().toDateString()) return '今天'
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}
