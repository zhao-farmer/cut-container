/* ============================================================
 *  时间轴 · 通用小工具：夹止 / uid / 总时长 / 源时长
 *  时间格式化函数（formatRuler / formatHint / formatTimecode）
 *  已归集到 ../utils/time。
 * ============================================================ */
import type { TrackObject, AnyTrackItem } from '../../types'
import type { TimelineConfig } from './config'

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const uid = () => `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function totalDuration(tracks: TrackObject[], cfg: TimelineConfig): number {
  let max = 0
  for (const t of tracks) for (const it of t.items) max = Math.max(max, it.start + it.duration)
  return max > 0 ? max : cfg.defaultDuration
}

/** 图片轨上的 GIF（数据层 type 仍是 image，用 source.format 区分） */
export function isGifItem(item: AnyTrackItem): boolean {
  return item.type === 'image' && (item.source as { format?: string }).format === 'gif'
}

/**
 * 素材源总时长（右拖裁上限）：
 * 视频 / 音频受真实时长限制，不可拉长（超过即无声 / 黑屏）；
 * 静态图片与 GIF 可无限停留延长（GIF 超出自身时长后定格在最后一帧，
 * 时间轴 requestCell 越界自动钳尾），与图片语义一致，返回 Infinity。
 */
export function sourceDurationOf(item: AnyTrackItem): number {
  if (item.type === 'video' || item.type === 'audio') {
    const d = (item.source as { duration?: number }).duration
    return typeof d === 'number' && d > 0 ? d : item.duration
  }
  return Infinity
}
