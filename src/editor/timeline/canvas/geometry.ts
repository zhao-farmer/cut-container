/* ============================================================
 *  时间轴画布 · 几何辅助（泳道高度 / 时间坐标换算 / 素材块内部几何）
 *  原 TimelineTrack 工厂内的纯计算闭包，统一经 ctx 读 cfg / s
 * ============================================================ */
import type { TrackObject, AnyTrackItem } from '../../types'
import type { ClipGeom } from '../core/types'
import { getFrameByPosition } from './frameVector'
import type { TimelineCtx } from './context'

export interface GeometryApi {
  /** 泳道高度：主轨 70 / 素材轨 50 / 装饰轨 25 */
  laneHOf: (t: TrackObject | null) => number
  /** 全部泳道（含缺失时仍占位的空主轨）叠放总高度 */
  stackHeightOf: (tracks: TrackObject[]) => number
  /** 时间秒 → 屏幕 x（含当前横滚 offX） */
  timeToX: (t: number, scale: number) => number
  /** 秒 → 最近帧时间（1/fps 网格） */
  frameSnap: (sec: number) => number
  /** 屏幕 x → 帧吸附后的时间（走内存帧向量） */
  xToFrameTime: (screenX: number) => number
  /** 素材块内部几何（媒体区 / 波形带 / 装饰块内边距） */
  clipGeomFor: (
    x: number,
    w: number,
    laneY: number,
    laneH: number,
    isMediaLane: boolean,
    item: AnyTrackItem
  ) => ClipGeom
}

export function createGeometry(ctx: TimelineCtx): GeometryApi {
  const { cfg, s } = ctx
  // originX 在轨道头列收起 / 展开时会被改写（全空工程 headWidth → 0），必须每次现取

  const laneHOf = (t: TrackObject | null) =>
    !t || t.layer === 0
      ? cfg.mainTrackHeight
      : t.type === 'video' || t.type === 'image' || t.type === 'audio'
        ? cfg.trackHeight
        : cfg.decorTrackHeight

  function stackHeightOf(tracks: TrackObject[]): number {
    const heights = tracks.map(t => laneHOf(t))
    if (!tracks.some(t => t.layer === 0)) heights.push(cfg.mainTrackHeight)
    return heights.reduce((sum, h) => sum + h, 0) + cfg.lineDistance * (heights.length - 1)
  }

  const timeToX = (t: number, scale: number) => ctx.originX + t * scale - s.offX

  const frameSnap = (sec: number) => Math.round(sec * cfg.fps) / cfg.fps

  const xToFrameTime = (screenX: number) =>
    getFrameByPosition(screenX - ctx.originX + s.offX) / cfg.fps

  /**
   * 计算素材块内部几何：媒体轨（主轨 70 / image 轨 50）与音频块满高
   * （视频底部 15 波形带；音频 15 名称 / 余下波形；图片底部留空），
   * 装饰类轨保留上下内边距。常规 lane 布局与块体拖拽浮块共用同一规则。
   */
  const clipGeomFor = (
    x: number,
    w: number,
    laneY: number,
    laneH: number,
    isMediaLane: boolean,
    item: AnyTrackItem
  ): ClipGeom => {
    // 视觉宽度比时间分配宽度少 elementGap：相邻素材吸附后时间上逐帧相接，
    // 渲染上块体右侧留出 1px 泳道底色缝隙（参考 asconfig elementGap）；
    // 时间 / 吸附 / 重叠判定一律用原始 w，不受影响。
    const vw = Math.max(1, w - cfg.elementGap)
    const isFullHeight = isMediaLane || item.type === 'audio'
    let outerY: number
    let outerH: number
    let mediaY: number
    let mediaH: number
    if (isFullHeight) {
      // 媒体（视频 / 图片 / GIF）与音频在所属泳道一律铺满行高：
      // 图片 / GIF 进 70 高主轨即变大到 70（与视频一致），在 50 高素材轨为 50。
      outerY = laneY
      outerH = laneH
      if (item.type === 'audio') {
        mediaY = outerY + cfg.clipMediaInsetY
        mediaH = outerH - cfg.clipMediaInsetY
      } else {
        mediaY = outerY + cfg.clipMediaInsetY
        mediaH = outerH - cfg.clipMediaInsetY * 2
      }
    } else {
      outerY = laneY + cfg.clipPadOther / 2
      outerH = laneH - cfg.clipPadOther
      mediaY = outerY
      mediaH = outerH
    }
    if (isMediaLane && item.type === 'video') {
      return {
        x,
        y: outerY,
        w: vw,
        h: outerH,
        mediaY,
        mediaH,
        waveY: outerY + outerH - cfg.clipMediaInsetY,
        waveH: cfg.clipMediaInsetY,
        mediaLane: isMediaLane
      }
    }
    if (item.type === 'audio') {
      return {
        x,
        y: outerY,
        w: vw,
        h: outerH,
        mediaY,
        mediaH,
        waveY: outerY + cfg.clipMediaInsetY,
        waveH: outerH - cfg.clipMediaInsetY,
        mediaLane: isMediaLane
      }
    }
    return {
      x,
      y: outerY,
      w: vw,
      h: outerH,
      mediaY,
      mediaH,
      waveY: outerY,
      waveH: 0,
      mediaLane: isMediaLane
    }
  }

  return { laneHOf, stackHeightOf, timeToX, frameSnap, xToFrameTime, clipGeomFor }
}
