import { useState, useEffect, useCallback, useRef } from 'react'

interface ToastItem {
  id: string
  icon: string
  name: string
  congrats: string
}

const CONGRATS: Record<string, string> = {
  'total-30h': '种子破土而出，澜山之旅开始了 🌱',
  'total-100h': '枝叶渐繁，你已经走了很远 🌿',
  'total-250h': '一棵树，稳稳立在澜山之上 🌲',
  'streak-3': '火种已燃，保持住 🔥',
  'streak-7': '一周不灭，这团火很稳 💎',
  'streak-14': '十四天，铁打的纪律 ⚡',
  'phy-20': '物理入门，手感来了 ⚡',
  'phy-60': '物理上道了 ⚡',
  'phy-100': '物理差点被你学完了 ⚡',
  'math-15': '数学起步 📐',
  'math-50': '数学过半，渐入佳境 📐',
  'math-85': '数学硬骨头啃下来了 📐',
  'eng-20': '英语开张 📖',
  'eng-70': '英语词汇开始有感觉了 📖',
  'eng-120': '英语冲到了山顶 📖',
  'daily-6h': '今天真的在澜山上走了一大段 🌊',
  'daily-9h': '登顶了！今天值得记住 ⛰️',
  'over-phy-10': '物理都让你学出火星子了 ⚡🔥',
  'over-math-10': '数学超额上瘾了 📐🔥',
  'over-eng-10': '英语停不下来 📖🔥',
  'triple-over': '三科全满！今天封神 🏆',
  'triple-3': '三天三满贯 🔥🔥🔥',
}

const ICONS: Record<string, string> = {
  'total-30h':'🌱','total-100h':'🌿','total-250h':'🌲',
  'streak-3':'🔥','streak-7':'💎','streak-14':'⚡',
  'phy-20':'⚡','phy-60':'⚡','phy-100':'⚡',
  'math-15':'📐','math-50':'📐','math-85':'📐',
  'eng-20':'📖','eng-70':'📖','eng-120':'📖',
  'daily-6h':'🌊','daily-9h':'⛰️',
  'over-phy-10':'⚡🔥','over-math-10':'📐🔥','over-eng-10':'📖🔥',
  'triple-over':'🏆','triple-3':'🔥🔥🔥',
}

export default function AchievementToast(): React.ReactElement {
  const [queue, setQueue] = useState<ToastItem[]>([])
  const [current, setCurrent] = useState<ToastItem | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Listen for new unlocks
  useEffect(() => {
    const handler = (e: Event) => {
      const ids = (e as CustomEvent).detail as string[]
      const items: ToastItem[] = ids.map(id => ({
        id,
        icon: ICONS[id] || '🏆',
        name: id,
        congrats: CONGRATS[id] || '成就已解锁！',
      }))
      setQueue(prev => [...prev, ...items])
    }
    window.addEventListener('achievement-unlock', handler)
    return () => window.removeEventListener('achievement-unlock', handler)
  }, [])

  // Process queue one at a time
  useEffect(() => {
    if (current || queue.length === 0) return
    const next = queue[0]
    setCurrent(next)
    setQueue(prev => prev.slice(1))
    timerRef.current = setTimeout(() => {
      setCurrent(null)
    }, 3000)
    return () => clearTimeout(timerRef.current)
  }, [queue, current])

  if (!current) return <></>

  return (
    <div
      className="fixed z-[60] pointer-events-none animate-slide-in"
      style={{ right: 16, bottom: 16, transform: 'translateX(0)', opacity: 1 }}
    >
      <div className="bg-[#1e293b] border-l-4 border-[#10b981] rounded-xl px-5 py-3 shadow-xl max-w-[280px]">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{current.icon}</span>
          <div>
            <p className="text-sm font-semibold text-[#f1f5f9]">{current.name}</p>
            <p className="text-xs text-[#94a3b8] mt-0.5">{current.congrats}</p>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        .animate-slide-in {
          animation: slideIn 300ms ease-out, slideOut 300ms ease-in 2700ms forwards;
        }
      `}</style>
    </div>
  )
}
