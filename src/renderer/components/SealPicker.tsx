import { useState } from 'react'
import type { SealDefLike, CumulativeLike } from '../sealTypes'
import SealIcon from './SealIcon'

interface SealPickerProps {
  slot: number
  defs: SealDefLike[]
  /** 已解锁的累积刻章（可佩戴） */
  unlockedCumulative: CumulativeLike[]
  /** 今天已获得的每日刻章 id（可佩戴） */
  todayEarned: string[]
  /** 该格当前佩戴（null = 空） */
  worn: { seal_id: string; date: string | null } | null
  onClose: () => void
  onChanged: () => void
}

/**
 * 佩戴选择器：点选即佩戴（替换当前），点当前已佩戴的刻章 = 摘下。
 * 累积刻章永久可戴；每日刻章仅当天已获得的可戴。
 */
export default function SealPicker({ slot, defs, unlockedCumulative, todayEarned, worn, onClose, onChanged }: SealPickerProps): React.ReactElement {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const defMap = new Map(defs.map(d => [d.id, d]))

  async function wear(sealId: string): Promise<void> {
    setMsg(null)
    const res = await window.lanshan.setSealSlot(slot, sealId)
    if (res.ok) {
      onChanged()
    } else {
      setMsg({ ok: false, text: res.message })
    }
  }

  async function unwear(): Promise<void> {
    await window.lanshan.clearSealSlot(slot)
    onChanged()
  }

  const wornDef = worn ? defMap.get(worn.seal_id) : undefined

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker-panel" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-bold">第 {slot + 1} 格 · 佩戴刻章</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-[var(--bg-card-hover)] text-sm" style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        {wornDef && (
          <div className="flex items-center justify-between mt-3 px-3 py-2 rounded-xl flex-shrink-0"
            style={{ background: 'var(--seal-paper-b, #ffdfce)', border: '1px solid rgba(192,57,43,.25)' }}>
            <span className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--seal-red, #c0392b)' }}>
                <SealIcon id={wornDef.id} size={18} />
              </span>
              <span className="font-medium">{wornDef.name}</span>
              {worn?.date && <span className="text-xs" style={{ color: 'var(--seal-red, #c0392b)' }}>今日刻章</span>}
            </span>
            <button onClick={unwear} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-75"
              style={{ background: 'rgba(192,57,43,.12)', color: 'var(--seal-red, #c0392b)' }}>
              摘下
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-5">
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>🪨 累积刻章（已解锁 · 永久可戴）</p>
            {unlockedCumulative.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>还没有解锁的累积刻章</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {unlockedCumulative.map(c => {
                  const d = defMap.get(c.id)
                  if (!d) return null
                  const isWorn = worn?.seal_id === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => wear(c.id)}
                      className={`seal-pick-item ${isWorn ? 'on' : ''}`}
                      title={d.desc}
                    >
                      <SealIcon id={d.id} size={20} />
                      <span className="seal-pick-name">{d.name}</span>
                      {isWorn && <span className="seal-pick-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>☀️ 今日刻章（当天获得 · 仅今天可戴）</p>
            {todayEarned.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>今天还没有获得每日刻章，去学习吧！</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {todayEarned.map(id => {
                  const d = defMap.get(id)
                  if (!d) return null
                  const isWorn = worn?.seal_id === id
                  return (
                    <button
                      key={id}
                      onClick={() => wear(id)}
                      className={`seal-pick-item ${isWorn ? 'on' : ''}`}
                      title={d.desc}
                    >
                      <SealIcon id={d.id} size={20} />
                      <span className="seal-pick-name">{d.name}</span>
                      {isWorn && <span className="seal-pick-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {msg && (
          <p className="mt-3 text-xs flex-shrink-0" style={{ color: msg.ok ? 'var(--accent)' : '#ef4444' }}>{msg.text}</p>
        )}
        <p className="mt-3 text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          点击刻章佩戴到本格（替换当前）；每日刻章过零点自动摘下，记录保留在刻章册。
        </p>
      </div>
    </div>
  )
}
