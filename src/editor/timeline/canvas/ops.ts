/* ============================================================
 *  时间轴画布 · 操作模块（工具条 / 轨道头按钮的数据提交）
 *  - commitDraft：深拷贝当前数据 → 就地修改 → 移除空轨 → onCommit 上抛
 *  - toggleTrack：轨道头 锁定 / 显示 / 原声
 *  - applyOp：工具条 分割 / 向左裁剪 / 向右裁剪 / 删除
 *  （撤销栈由外层 EditorPage 基于 onCommit 维护）
 * ============================================================ */
import type { TrackObject, AnyTrackItem, TrackItem } from '../../types'
import type { TimelineOp, OpResult } from '../core/types'
import { uid } from '../core/helpers'
import type { TimelineCtx } from './context'
import type { TrackAct } from '../ui/headBar'

export interface OpsDeps {
  /** 清除当前选中（轨道锁定 / 隐藏后兜底） */
  select: (sel: null) => void
  draw: () => void
}

export interface OpsApi {
  commitDraft: (mut: (draft: TrackObject[]) => void, label: string) => OpResult
  toggleTrack: (trackId: string, act: TrackAct) => void
  applyOp: (op: TimelineOp) => OpResult
}

export function createOps(ctx: TimelineCtx, deps: OpsDeps): OpsApi {
  const { cfg, s, callbacks } = ctx

  /** 深拷贝当前数据 → 就地修改 → 上抛提交 */
  function commitDraft(mut: (draft: TrackObject[]) => void, label: string): OpResult {
    if (!s.data) return { ok: false, msg: '时间线为空' }
    const next: TrackObject[] = JSON.parse(JSON.stringify(s.data))
    mut(next)
    // 移除空轨道
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].items.length === 0) next.splice(i, 1)
    }
    callbacks.onCommit?.(next, label)
    return { ok: true }
  }

  /** 轨道头三按钮：锁定 / 显示 / 原声（深拷贝后翻转标志，经 onCommit 落盘 + 入历史） */
  function toggleTrack(trackId: string, act: TrackAct) {
    if (!s.data) return
    const track = s.data.find(t => t.id === trackId)
    if (!track) return
    let label = '轨道设置'
    commitDraft(draft => {
      const t = draft.find(x => x.id === trackId)
      if (!t) return
      if (act === 'lock') {
        t.locked = !t.locked
        label = t.locked ? '锁定轨道' : '解锁轨道'
      } else if (act === 'show') {
        t.hidden = !t.hidden
        label = t.hidden ? '隐藏轨道' : '显示轨道'
      } else {
        t.muted = !t.muted
        label = t.muted ? '隐藏原声' : '显示原声'
      }
    }, label)
    // 锁定 / 隐藏后该轨不可交互：清掉落在该轨上的当前选中
    if (act !== 'sound' && s.selection?.trackId === trackId) deps.select(null)
    if (!s.destroyed) deps.draw()
  }

  function applyOp(op: TimelineOp): OpResult {
    if (!s.selection || !s.data) return { ok: false, msg: '请先选中时间线上的素材' }
    const track = s.data.find(t => t.id === s.selection!.trackId)
    const item = track?.items.find(i => i.id === s.selection!.itemId)
    if (!track || !item) return { ok: false, msg: '请先选中时间线上的素材' }

    if (op === 'delete') {
      // 主轨磁吸开启：删掉主轨片段后，其后的主轨片段整体左移补位（不留缝）
      const ripple = s.mainSnap && track.layer === 0
      const removedStart = item.start
      const removedDur = item.duration
      return commitDraft(draft => {
        const tr = draft.find(t => t.id === track.id)!
        tr.items = tr.items.filter(i => i.id !== item.id)
        if (ripple) {
          for (const it of tr.items) {
            if (it.start >= removedStart - 1 / cfg.fps) {
              it.start = Math.max(0, Math.round((it.start - removedDur) * cfg.fps) / cfg.fps)
            }
          }
        }
      }, '删除素材')
    }

    const start = item.start
    const end = item.start + item.duration
    // 工具条操作统一在帧整数上进行：播放头先吸附到帧，起止差值即帧数差 / fps，
    // 分割 / 裁剪出的每个子项起止都严格落在坐标轴帧上
    const fps = cfg.fps
    const sf = Math.round(start * fps)
    const ef = Math.round(end * fps)
    const ssf = Math.round((item.sourceStart ?? 0) * fps)
    const tf = Math.round(s.playhead * fps)
    const t = tf / fps
    if (op === 'split') {
      if (t <= start + 0.05 || t >= end - 0.05) return { ok: false, msg: '播放头不在素材范围内' }
      return commitDraft(draft => {
        const tr = draft.find(tt => tt.id === track.id)!
        const idx = tr.items.findIndex(i => i.id === item.id)
        const left = tr.items[idx]
        left.duration = (tf - sf) / fps
        const right: AnyTrackItem = JSON.parse(JSON.stringify(left))
        right.id = uid()
        right.start = tf / fps
        right.duration = (ef - tf) / fps
        right.sourceStart = (ssf + (tf - sf)) / fps
        tr.items.splice(idx + 1, 0, right)
      }, '分割素材')
    }

    if (op === 'trim-left') {
      if (!(t > start && t < end - cfg.minClipDuration))
        return { ok: false, msg: '播放头位置无法向左裁剪' }
      return commitDraft(draft => {
        const it = draft
          .find(tt => tt.id === track.id)!
          .items.find(i => i.id === item.id)! as TrackItem
        it.duration = (ef - tf) / fps
        it.start = tf / fps
        it.sourceStart = (ssf + (tf - sf)) / fps
      }, '向左裁剪')
    }

    // trim-right
    if (!(t < end && t > start + cfg.minClipDuration))
      return { ok: false, msg: '播放头位置无法向右裁剪' }
    return commitDraft(draft => {
      const it = draft
        .find(tt => tt.id === track.id)!
        .items.find(i => i.id === item.id)!
      it.duration = (tf - sf) / fps
    }, '向右裁剪')
  }

  return { commitDraft, toggleTrack, applyOp }
}
