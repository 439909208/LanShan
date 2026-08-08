import type { SealDefLike, SlotLike } from '../sealTypes'
import SealIcon from './SealIcon'

interface WearGridProps {
  defs: SealDefLike[]
  slots: SlotLike[]
  onSlotClick: (slot: number) => void
}

/**
 * 我的刻章：4×2 八个正方形佩戴格。
 * 容器自适应：格子边长 = min(38% 高, 21% 宽)，无论卡片多大都能完整放下，无需拖动/滚动。
 */
export default function WearGrid({ defs, slots, onSlotClick }: WearGridProps): React.ReactElement {
  const defMap = new Map(defs.map(d => [d.id, d]))
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ containerType: 'size' }}>
      <div className="grid grid-cols-4 gap-2 justify-center">
        {Array.from({ length: 8 }, (_, i) => {
          const slot = slots.find(s => s.slot === i)
          const def = slot ? defMap.get(slot.seal_id) : undefined
          return (
            <div
              key={i}
              className={`wear-slot ${slot ? 'filled' : ''}`}
              style={{ width: 'min(38cqh, 22cqw)' }}
              onClick={() => onSlotClick(i)}
              title={def ? `${def.name}${slot?.date ? '（今日刻章）' : ''}` : '点击佩戴刻章'}
            >
              {def ? (
                <>
                  <SealIcon id={slot.seal_id} size={18} />
                  {slot?.date && <span className="slot-today">今</span>}
                  <span className="slot-name">{def.name}</span>
                </>
              ) : (
                <span className="slot-plus">＋</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
