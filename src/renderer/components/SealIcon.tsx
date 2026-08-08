/**
 * 刻章图标库：38 枚刻章全部为自绘 SVG（线稿风格，currentColor 着色，深浅主题自适应）。
 *
 * 设计原则：每枚图标直接用"看得懂的内容"表达——
 *  - 累计学习：芽 → 小树（两层冠）→ 大树（三层松冠）
 *  - 物理：牛顿摆 1/2/3 球（动量实验，一眼物理）
 *  - 数学：坐标轴 + 直线 / 抛物线 / 正弦波（卷面上的数学）
 *  - 英语：字母 A / AB / ABC
 *  - 连击：火焰 1/2/3 簇；三连绝世：三星连珠
 *  - 单日爆发：山+日（一日澜山）/ 山+旗（登顶）/ 奖杯（大满贯）
 *  - 逆袭：马头（黑马）/ 利剑（绝地）
 *  - 暴击：中文科目字 + 闪电；狂热者：中文科目字 + 火焰
 *  - 晨行三档：日出递进（露头 → 升起 → 光芒万丈）
 *  - 夜航三档：星星 1/2/3 颗
 *  - 专注三档：靶心 1/2/3 环
 */
import type { ReactElement } from 'react'

interface SealIconProps {
  id: string
  size?: number | string
  className?: string
}

/** 4 角星（火花/星星），中心 (x,y)，半经 s */
function Star4({ x, y, s = 1 }: { x: number; y: number; s?: number }): ReactElement {
  const d = `M${x} ${y - 3 * s}L${x + 0.9 * s} ${y - 0.9 * s}L${x + 3 * s} ${y}L${x + 0.9 * s} ${y + 0.9 * s}L${x} ${y + 3 * s}L${x - 0.9 * s} ${y + 0.9 * s}L${x - 3 * s} ${y}L${x - 0.9 * s} ${y - 0.9 * s}Z`
  return <path d={d} fill="currentColor" stroke="none" />
}

/** 五角星（实心），中心 (x,y)，外径 r，尖朝上 */
function Star5({ x, y, r }: { x: number; y: number; r: number }): ReactElement {
  const inner = r * 0.38
  let d = ''
  for (let i = 0; i < 10; i++) {
    const ang = ((-90 + i * 36) * Math.PI) / 180
    const rr = i % 2 === 0 ? r : inner
    const px = x + rr * Math.cos(ang)
    const py = y + rr * Math.sin(ang)
    d += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ' ' + py.toFixed(2)
  }
  return <path d={d + 'Z'} fill="currentColor" stroke="none" />
}

/** 中文单字（印章刻字风格），默认居中 */
function Char({ c, x = 12, y = 12.5, size = 11 }: { c: string; x?: number; y?: number; size?: number }): ReactElement {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      textAnchor="middle"
      dominantBaseline="central"
      fill="currentColor"
      stroke="none"
      style={{ fontWeight: 700 }}
    >
      {c}
    </text>
  )
}

/** 小闪电（右上角，暴击角标） */
function MiniBolt(): ReactElement {
  return <path d="M15.6 2.2l-3 5h2.3l-1.2 5 5-7h-2.7z" fill="currentColor" stroke="none" />
}

/** 小火焰（右上角，狂热者角标） */
function MiniFlame(): ReactElement {
  return (
    <path
      d="M18 3.2c1.08 2.4 2.4 3.68 2.4 5.6a2.4 2.4 0 0 1-4.8 0c0-1.92 1.08-3.2 2.4-5.6z"
      fill="currentColor"
      stroke="none"
    />
  )
}

/** 火焰（泪滴形，描边），中心 (cx, cy)，高 h */
function Flame({ cx, cy, h = 8.4, w = 5.2 }: { cx: number; cy: number; h?: number; w?: number }): ReactElement {
  return (
    <path
      d={`M${cx} ${cy - h}c${w * 0.45} ${h * 0.62} ${w} ${h * 0.95} ${w} ${h * 1.45}a${w} ${w} 0 0 1 ${-w * 2} 0c0-${h * 0.5} ${w * 0.45}-${h * 0.83} ${w}-${h * 1.45}z`}
    />
  )
}

/** 月牙（开口朝左） */
function Crescent({ x = 12, y = 12, r = 7 }: { x?: number; y?: number; r?: number }): ReactElement {
  return (
    <path
      d={`M${x + 0.835 * r} ${y - 0.55 * r}A${r} ${r} 0 0 1 ${x + 0.835 * r} ${y + 0.55 * r}A${0.62 * r} ${0.62 * r} 0 0 1 ${x + 0.835 * r} ${y - 0.55 * r}Z`}
    />
  )
}

/** 牛顿摆（物理）：初涉=单摆 → 半程=带架双摆 → 凌顶=完整框架三球（装置完整度质变） */
function Pendulum({ mode }: { mode: 1 | 2 | 3 }): ReactElement {
  if (mode === 1) {
    return (
      <>
        <path d="M12 4v9.5" />
        <circle cx="12" cy="15.7" r="2.2" fill="currentColor" stroke="none" />
      </>
    )
  }
  if (mode === 2) {
    return (
      <>
        <path d="M5.5 4.5h13" />
        <path d="M9.5 4.5v9" />
        <path d="M14.5 4.5v9" />
        <circle cx="9.5" cy="15.6" r="2.1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="15.6" r="2.1" fill="currentColor" stroke="none" />
      </>
    )
  }
  return (
    <>
      <path d="M5.5 4.5v1.8" />
      <path d="M18.5 4.5v1.8" />
      <path d="M5.5 4.5h13" />
      <path d="M5.5 6.3h13" />
      <path d="M8 4.5v9" />
      <path d="M12 4.5v9" />
      <path d="M16 4.5v9" />
      <circle cx="8" cy="15.6" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.6" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="15.6" r="2.1" fill="currentColor" stroke="none" />
    </>
  )
}

/** 坐标轴（数学），X/Y 带箭头 */
function Axes(): ReactElement {
  return (
    <>
      <path d="M5.5 19.5V4.8" />
      <path d="M4.8 5.8l.7-1.6.7 1.6" />
      <path d="M5.5 19.5h13.2" />
      <path d="M17.6 18.8l1.6.7-1.6.7" />
    </>
  )
}

/** 印章内容 */
function SealGlyph({ id }: { id: string }): ReactElement | null {
  switch (id) {
    // ── 累积：累计学习（破土芽 → 小树 → 大树） ──
    case 'total-30h': // 破土：土线上的一株芽
      return (
        <>
          <path d="M12 21v-6.5" />
          <path d="M12 14.5c-2 0-3.4-1.5-3.4-3.5 2 0 3.4 1.5 3.4 3.5z" />
          <path d="M12 14.5c2 0 3.4-1.5 3.4-3.5-2 0-3.4 1.5-3.4 3.5z" />
          <path d="M4 21h16" />
        </>
      )
    case 'total-100h': // 抽枝：长出一朵花（茎 + 五瓣花）
      return (
        <>
          <circle cx="12" cy="8.9" r="1.9" />
          <circle cx="14.95" cy="11.04" r="1.9" />
          <circle cx="13.82" cy="14.98" r="1.9" />
          <circle cx="10.18" cy="14.98" r="1.9" />
          <circle cx="9.05" cy="11.04" r="1.9" />
          <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
          <path d="M12 16.5v4.5" />
          <path d="M4 21h16" />
        </>
      )
    case 'total-250h': // 成木：实心松树剪影（三层三角形树冠 + 树干）
      return (
        <>
          <path
            d="M12 3L15.5 7.5H13.4L17 11.5H14.7L18.5 16H5.5L9.3 11.5H7L10.5 7.5H8.5Z"
            fill="currentColor"
            stroke="none"
          />
          <path d="M11.2 16h1.6v5h-1.6z" fill="currentColor" stroke="none" />
        </>
      )

    // ── 累积：物理（单摆 → 带架双摆 → 完整牛顿摆框架） ──
    case 'phy-20': return <Pendulum mode={1} />
    case 'phy-60': return <Pendulum mode={2} />
    case 'phy-100': return <Pendulum mode={3} />

    // ── 累积：数学（坐标轴 + 直线/抛物线/正弦波） ──
    case 'math-15':
      return (
        <>
          <Axes />
          <path d="M6.5 18.2L16.8 7" />
        </>
      )
    case 'math-50':
      return (
        <>
          <Axes />
          <path d="M6.5 9.8c1.7 3.3 3.3 4.9 5 4.9s3.3-1.6 5-4.9" />
        </>
      )
    case 'math-85':
      return (
        <>
          <Axes />
          <path d="M6.2 12.4c1.2-2.8 2.5-2.8 3.7 0s2.5 2.8 3.7 0 2.5-2.8 3.7 0" />
        </>
      )

    // ── 累积：英语（上方英语书标识科目，下方词汇量数字递进） ──
    case 'eng-20':
      return (
        <>
          <path d="M12 5.8C10.4 4.6 8.4 4.1 6.3 4.1v9.8c2.1 0 4.1.5 5.7 1.6 1.6-1.1 3.6-1.6 5.7-1.6V4.1c-2.1 0-4.1.5-5.7 1.7z" />
          <path d="M12 5.8v9.7" />
          <text x="12" y="17.8" fontSize="10.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" stroke="none" style={{ fontWeight: 700 }}>1000</text>
        </>
      )
    case 'eng-70':
      return (
        <>
          <path d="M12 5.8C10.4 4.6 8.4 4.1 6.3 4.1v9.8c2.1 0 4.1.5 5.7 1.6 1.6-1.1 3.6-1.6 5.7-1.6V4.1c-2.1 0-4.1.5-5.7 1.7z" />
          <path d="M12 5.8v9.7" />
          <text x="12" y="17.8" fontSize="10.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" stroke="none" style={{ fontWeight: 700 }}>2500</text>
        </>
      )
    case 'eng-120':
      return (
        <>
          <path d="M12 5.8C10.4 4.6 8.4 4.1 6.3 4.1v9.8c2.1 0 4.1.5 5.7 1.6 1.6-1.1 3.6-1.6 5.7-1.6V4.1c-2.1 0-4.1.5-5.7 1.7z" />
          <path d="M12 5.8v9.7" />
          <text x="12" y="17.8" fontSize="10.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" stroke="none" style={{ fontWeight: 700 }}>3500</text>
        </>
      )

    // ── 累积：连击（火焰簇数递进） ──
    case 'streak-3':
      return <Flame cx={12} cy={13} />
    case 'streak-7':
      return (
        <>
          <Flame cx={8.6} cy={14.5} h={5.6} w={3.4} />
          <Flame cx={15.8} cy={11.5} h={7.2} w={4.4} />
        </>
      )
    case 'streak-14':
      return (
        <>
          <Flame cx={6.6} cy={15} h={4.8} w={2.9} />
          <Flame cx={12} cy={12.5} h={6.4} w={3.9} />
          <Flame cx={17.6} cy={10.5} h={7.6} w={4.6} />
          <circle cx="8" cy="6.8" r="0.55" fill="currentColor" stroke="none" />
          <circle cx="16.2" cy="7.6" r="0.55" fill="currentColor" stroke="none" />
        </>
      )

    // ── 累积：三连绝世（三星连珠） ──
    case 'triple-3':
      return (
        <>
          <Star4 x={6.5} y={12} s={1.7} />
          <Star4 x={12} y={12} s={2.2} />
          <Star4 x={17.5} y={12} s={1.7} />
        </>
      )

    // ── 每日：单日爆发 ──
    case 'daily-6h': // 一日澜山：太阳 + 山峦
      return (
        <>
          <circle cx="17" cy="6.2" r="2.1" />
          <path d="M2.5 18.5l6.4-9.2 3.9 5.3 2.6-3.6 6.1 7.5z" />
        </>
      )
    case 'daily-8h': // 登顶：山峰 + 旗帜
      return (
        <>
          <path d="M4 19l7.5-11.5L19 19z" />
          <path d="M11.5 7.5v3.5" />
          <path d="M11.5 7.5h4.4l-2.2 2.5z" />
        </>
      )
    case 'triple-over': // 大满贯日：奖杯
      return (
        <>
          <path d="M7 4.5h10v6.5a5 5 0 0 1-10 0z" />
          <path d="M7 5.5H4.2v2a2.8 2.8 0 0 0 2.8 2.8" />
          <path d="M17 5.5h2.8v2a2.8 2.8 0 0 1-2.8 2.8" />
          <path d="M12 15v3.5" />
          <path d="M8.8 21h6.4" />
        </>
      )

    // ── 每日：逆袭 ──
    case 'comeback-6h': // 黑马：「马」字
      return <Char c="马" size={15} />
    case 'comeback-8h': // 绝地：利剑（剑尖 + 剑身 + 护手 + 握把 + 柄球）
      return (
        <>
          <path d="M12 2.5l-2.2 3.2h4.4z" />
          <path d="M10.1 5.7h3.8v7.8h-3.8z" />
          <path d="M7.4 13.5h9.2" />
          <path d="M11.5 13.5v3.4" />
          <path d="M12.5 13.5v3.4" />
          <circle cx="12" cy="19" r="1.2" />
        </>
      )

    // ── 每日：单科暴击（中文科目字 + 闪电） ──
    case 'burst-phy':
      return (
        <>
          <Char c="物" />
          <MiniBolt />
        </>
      )
    case 'burst-math':
      return (
        <>
          <Char c="数" />
          <MiniBolt />
        </>
      )
    case 'burst-eng':
      return (
        <>
          <Char c="英" />
          <MiniBolt />
        </>
      )

    // ── 每日：均衡日 / 朝暮行 ──
    case 'balanced': // 稳行者：天平
      return (
        <>
          <path d="M12 4v16" />
          <path d="M4 5.5h16" />
          <path d="M4 5.5 1.3 10.5h5.4z" />
          <path d="M20 5.5l2.7 5h-5.4z" />
          <path d="M5.5 21h13" />
        </>
      )
    case 'dawn-dusk': // 朝暮行：左日右月
      return (
        <>
          <circle cx="8.2" cy="12" r="3.9" />
          <Crescent x={17.5} y={12} r={4.6} />
        </>
      )

    // ── 每日：晨行三档（日出递进） ──
    case 'morning-730': // 初曙：半轮朝阳贴地平线
      return (
        <>
          <path d="M3 17h18" />
          <path d="M8.6 17a3.4 3.4 0 0 1 6.8 0" />
          <path d="M12 9.4V7.4" />
          <path d="M6.6 12.6l-1.3-1.3" />
          <path d="M17.4 12.6l1.3-1.3" />
        </>
      )
    case 'morning-700': // 晨光：朝阳升起 + 光芒
      return (
        <>
          <circle cx="12" cy="13" r="3.1" />
          <path d="M3 17.5h18" />
          <path d="M12 6.8V4.8" />
          <path d="M5.2 13H3.2" />
          <path d="M20.8 13h-2" />
          <path d="M7 8l1.4 1.4" />
          <path d="M15.6 16.6 17 18" />
        </>
      )
    case 'morning-630': // 黎明：光芒万丈
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 4.6v-2" />
          <path d="M12 21.4v-2" />
          <path d="M4.6 12h-2" />
          <path d="M21.4 12h-2" />
          <path d="M6.4 6.4 5 5" />
          <path d="M19 19l-1.4-1.4" />
          <path d="M17.6 6.4 19 5" />
          <path d="M5 19l1.4-1.4" />
        </>
      )

    // ── 每日：夜航三档（星星大跳跃：2 → 4 → 满天星海） ──
    case 'night-2150': // 晚灯：双星
      return (
        <>
          <Star5 x={9.5} y={10} r={2.4} />
          <Star5 x={15.5} y={14} r={1.5} />
        </>
      )
    case 'night-2220': // 夜烛：四星
      return (
        <>
          <Star5 x={7} y={8} r={1.4} />
          <Star5 x={13.5} y={7} r={1.9} />
          <Star5 x={17} y={11.5} r={1.4} />
          <Star5 x={10.5} y={15} r={2.2} />
        </>
      )
    case 'night-2250': // 星伴：星海（一大星 + 六小星）
      return (
        <>
          <Star5 x={12} y={12} r={2.8} />
          <Star5 x={5.5} y={7} r={1.2} />
          <Star5 x={9} y={4.8} r={1} />
          <Star5 x={15} y={5.2} r={1.2} />
          <Star5 x={18.5} y={9} r={1.1} />
          <Star5 x={16.8} y={14.5} r={1} />
          <Star5 x={7.5} y={15.5} r={1.1} />
        </>
      )

    // ── 每日：极限专注（靶心递进） ──
    case 'focus-2h': // 入定
      return (
        <>
          <circle cx="12" cy="12" r="4.8" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )
    case 'focus-3h': // 忘我
      return (
        <>
          <circle cx="12" cy="12" r="2.9" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )
    case 'focus-4h': // 化境
      return (
        <>
          <circle cx="12" cy="12" r="2.1" />
          <circle cx="12" cy="12" r="4.4" />
          <circle cx="12" cy="12" r="6.7" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )

    // ── 每日：狂热者（中文科目字 + 火焰） ──
    case 'over-phy':
      return (
        <>
          <Char c="物" />
          <MiniFlame />
        </>
      )
    case 'over-math':
      return (
        <>
          <Char c="数" />
          <MiniFlame />
        </>
      )
    case 'over-eng':
      return (
        <>
          <Char c="英" />
          <MiniFlame />
        </>
      )

    default:
      return null
  }
}

/** 锁（未解锁角标） */
export function Padlock({ size = 12, className }: { size?: number; className?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

export default function SealIcon({ id, size = 22, className }: SealIconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <SealGlyph id={id} />
    </svg>
  )
}
