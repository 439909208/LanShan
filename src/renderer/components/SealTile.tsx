import type { SealDefLike } from '../sealTypes'
import SealIcon, { Padlock } from './SealIcon'

interface SealTileProps {
  def: SealDefLike
  /** 已获得（累积已解锁 / 每日当天已获 / 回放日已获） */
  got?: boolean
  /** 盖印动画（新获得时播放） */
  stamp?: boolean
  /** 进度百分比 0-100（未获得的累积刻章） */
  pct?: number
  /** 小字状态（解锁日期 / 当前进度 / 提示文案） */
  statusText?: string
  /** 角标文字（如"今"） */
  ribbon?: string
  /** 灰显（曾获得但今天未获得） */
  dim?: boolean
  onClick?: () => void
}

/**
 * 刻章收藏格单格：圆形印泥章（SVG 线稿图标）+ 名称 + 条件。
 * 获得 = 朱红印章；未获得 = 灰色剪影 + 锁。
 */
export default function SealTile({ def, got, stamp, pct, statusText, ribbon, dim, onClick }: SealTileProps): React.ReactElement {
  const achieved = Boolean(got)
  return (
    <div
      className={`seal-tile ${achieved ? 'got' : 'locked'} ${dim ? 'dim' : ''} ${stamp ? 'seal-stamp' : ''}`}
      onClick={onClick}
      title={def.desc}
    >
      {ribbon && <span className="seal-ribbon">{ribbon}</span>}
      <div className="seal-medallion">
        <SealIcon id={def.id} size={26} />
        {!achieved && (
          <span className="seal-lock">
            <Padlock size={11} />
          </span>
        )}
      </div>
      <p className="seal-name">{def.name}</p>
      <p className="seal-desc">{def.desc}</p>
      {!achieved && pct != null && pct > 0 && pct < 100 && (
        <div className="seal-progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      {statusText && <p className="seal-status">{statusText}</p>}
    </div>
  )
}
