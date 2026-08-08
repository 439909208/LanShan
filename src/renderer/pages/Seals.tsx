import { useState, useEffect, useCallback } from 'react'
import type { SealDefLike, CumulativeLike, DailyLike, SlotLike } from '../sealTypes'
import { fmtProg, fmtDate } from '../sealTypes'
import SealTile from '../components/SealTile'
import WearGrid from '../components/WearGrid'
import SealPicker from '../components/SealPicker'
import SealIcon from '../components/SealIcon'

interface OverviewLike {
  cumulative: CumulativeLike[]
  daily: DailyLike[]
  slots: SlotLike[]
  dailyEverIds: string[]
}

const TOTAL_SEALS = 38

/** 累积刻章的展示分组顺序 */
const CUM_GROUP_ORDER = ['累计学习', '连续打卡', '物理', '数学', '英语', '大满贯']
/** 每日刻章的展示分组顺序 */
const DAILY_GROUP_ORDER = ['单日爆发', '逆袭', '单科暴击', '均衡日', '晨行', '夜航', '极限专注', '狂热者', '朝暮行']

/** 统计胶囊 */
function StatPill({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }): React.ReactElement {
  return (
    <div className="stat-pill">
      <span className="text-base">{icon}</span>
      <span className="stat-pill-label">{label}</span>
      <span className="stat-pill-value" style={accent ? { color: 'var(--seal-red, #c0392b)' } : undefined}>{value}</span>
    </div>
  )
}

/**
 * 刻章册主页（收藏格）：累积刻章永久珍藏 + 每日刻章当天盖印。
 * 逐日回放在主页日期导航中提供（与时间轴/每日数据一致）；此处 30s 轮询新刻章驱动盖印动画与全局 toast。
 */
export default function Seals(): React.ReactElement {
  const [defs, setDefs] = useState<SealDefLike[]>([])
  const [live, setLive] = useState<OverviewLike | null>(null)
  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  // 新获得的刻章 id（盖印动画）
  const [stamps, setStamps] = useState<Set<string>>(new Set())

  const refreshLive = useCallback(async () => {
    setLive(await window.lanshan.getSealsOverview())
  }, [])

  useEffect(() => {
    window.lanshan.getSealDefs().then(setDefs)
    void refreshLive()

    // 30s 轮询新刻章（与主页一致）：驱动全局 toast + 本页盖印动画 + 刷新数据
    const poll = setInterval(async () => {
      try {
        const n = await window.lanshan.getNewSeals()
        const ids = [...n.cumulative, ...n.daily]
        if (ids.length > 0) {
          window.dispatchEvent(new CustomEvent('seal-unlock', { detail: n }))
          setStamps(prev => new Set([...prev, ...ids]))
          setTimeout(() => {
            setStamps(prev => {
              const next = new Set(prev)
              ids.forEach(id => next.delete(id))
              return next
            })
          }, 1500)
        }
      } catch { /* 忽略轮询错误 */ }
      void refreshLive()
    }, 30000)
    return () => clearInterval(poll)
  }, [refreshLive])

  if (!defs.length || !live) {
    return <div className="flex items-center justify-center h-64 text-sm" style={{ color: 'var(--text-muted)' }}>刻章册加载中…</div>
  }

  const defMap = new Map(defs.map(d => [d.id, d]))
  const cumUnlocked = live.cumulative.filter(c => c.unlocked).length
  const todayEarned = live.daily.filter(d => d.earned).map(d => d.id)
  const allEver = cumUnlocked + live.dailyEverIds.length
  const everSet = new Set(live.dailyEverIds)

  /** 累积刻章格子 */
  function cumTile(c: CumulativeLike): React.ReactElement {
    const def = defMap.get(c.id)
    if (!def) return <></>
    const pct = Math.min(Math.round((c.progress / c.progress_max) * 100), 100)
    const statusText = c.unlocked
      ? (c.unlocked_at ? `${fmtDate(c.unlocked_at)} 解锁` : '已解锁')
      : (def.unit === 'days'
        ? `当前 ${c.progress} / ${c.progress_max} 天`
        : `当前 ${fmtProg(c.progress)} / ${fmtProg(c.progress_max)}`)
    return (
      <SealTile
        key={c.id}
        def={def}
        got={c.unlocked}
        stamp={stamps.has(c.id)}
        pct={pct}
        statusText={statusText}
      />
    )
  }

  /** 每日刻章格子（今天） */
  function dailyTile(def: SealDefLike, s: DailyLike): React.ReactElement {
    return (
      <SealTile
        key={def.id}
        def={def}
        got={s.earned}
        stamp={stamps.has(def.id)}
        ribbon={s.earned ? '今' : undefined}
        dim={!s.earned && everSet.has(def.id)}
        statusText={!s.earned ? s.hint : undefined}
      />
    )
  }

  /** 分组标题 */
  function GroupTitle({ title, count }: { title: string; count?: number }): React.ReactElement {
    return (
      <p className="seal-group-title">
        <span className="seal-section-dot" />
        {title}
        {count != null && <span className="seal-group-count">{count}</span>}
      </p>
    )
  }

  return (
    <div className="space-y-5 album-bg">
      {/* ─── 册页题头 ─── */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="seal-logo">📜</div>
            <div>
              <h2 className="text-2xl font-bold tracking-wide">刻章册</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                累积 · 永久珍藏　|　每日 · 当天盖印当天佩戴　|　主页日期导航可回看任意一天
              </p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <StatPill icon="🪨" label="累积" value={`${cumUnlocked}/${live.cumulative.length}`} />
            <StatPill icon="☀️" label="今日" value={`${todayEarned.length} 枚`} accent />
            <StatPill icon="📚" label="已集" value={`${allEver}/${TOTAL_SEALS}`} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--progress-track)' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.round((allEver / TOTAL_SEALS) * 100)}%`, background: 'linear-gradient(90deg, #c0392b, #e67e22)' }} />
          </div>
          <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {Math.round((allEver / TOTAL_SEALS) * 100)}%
          </span>
        </div>
      </div>

      {/* ─── 佩戴格 + 今日已获 ─── */}
      <div className="card grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2">
          <h3 className="text-sm font-bold mb-2">🕹️ 佩戴格 · 4×2</h3>
          <div className="h-[190px]">
            <WearGrid defs={defs} slots={live.slots} onSlotClick={(slot) => setPickerSlot(slot)} />
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
            每日刻章仅当天有效，跨天自动摘下；累积刻章永久可戴
          </p>
        </div>
        <div className="xl:col-span-3">
          <h3 className="text-sm font-bold mb-2">☀️ 今日已获 · {todayEarned.length} 枚</h3>
          {todayEarned.length === 0 ? (
            <div className="h-full flex items-center justify-center rounded-xl border border-dashed"
              style={{ borderColor: 'var(--border-light)', minHeight: '140px' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                今天还没有盖下任何刻章——完成下方任一每日条件即可获得
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap content-start gap-2.5">
              {todayEarned.map(id => {
                const def = defMap.get(id)
                if (!def) return null
                return (
                  <span key={id} className={`today-chip ${stamps.has(id) ? 'seal-stamp' : ''}`}>
                    <span style={{ color: 'var(--seal-red, #c0392b)', display: 'inline-flex' }}>
                      <SealIcon id={def.id} size={16} />
                    </span>
                    <span className="text-xs font-semibold">{def.name}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── 累积刻章 ─── */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-base font-bold">🪨 累积刻章</h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            解锁一次 · 永久珍藏 · 永久佩戴 · 进度截至今日
          </span>
        </div>
        <div className="space-y-5">
          {CUM_GROUP_ORDER.map(group => {
            const items = live.cumulative.filter(c => defMap.get(c.id)?.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <GroupTitle title={group} count={items.filter(i => i.unlocked).length} />
                <div className="seal-grid">
                  {items.map(cumTile)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── 每日刻章 ─── */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-base font-bold">☀️ 每日刻章</h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            当天条件达成即盖印 · 仅当天佩戴 · 主页日期导航可回看历史每一天
          </span>
        </div>
        <div className="space-y-5">
          {DAILY_GROUP_ORDER.map(group => {
            const items = live.daily.filter(d => defMap.get(d.id)?.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <GroupTitle title={group} count={items.filter(i => i.earned).length} />
                <div className="seal-grid">
                  {items.map(s => dailyTile(defMap.get(s.id)!, s))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── 刻章森林（预留） ─── */}
      <div className="card text-center py-6 opacity-80">
        <p className="text-2xl mb-1">🌳</p>
        <p className="text-sm font-semibold">刻章森林 · 敬请期待</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          每一枚刻章都是一粒种子——未来的小游戏：种树、浇水、长成你的澜山
        </p>
      </div>

      {pickerSlot !== null && (
        <SealPicker
          slot={pickerSlot}
          defs={defs}
          unlockedCumulative={live.cumulative.filter(c => c.unlocked)}
          todayEarned={todayEarned}
          worn={live.slots.find(s => s.slot === pickerSlot) ?? null}
          onClose={() => setPickerSlot(null)}
          onChanged={() => void refreshLive()}
        />
      )}
    </div>
  )
}
