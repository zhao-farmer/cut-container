/* ============================================================
 *  时间轴画布 · 「拖动」模块（块体跨轨重新投放）
 *  - updateMove：移动只更新虚拟指针态；落点 / 磁吸 / 灰槽由渲染帧内
 *    resolveDnd 解析（与素材库 HTML5 拖入完全同链路）
 *  - 边缘自动横滚：指针停在视口左右缘 PAN_EDGE 内时 rAF 推动 s.offX，
 *    虚拟指针 liveX 同步前进（屏幕位置钉住、所指时间持续增长），
 *    主轨末片右拉 / 跨轨拖出可一直越过当前轨道 / 标尺边界
 *  - commitMove：松手按终态 DndView 经 onMoveItem 交外层提交
 * ============================================================ */
import { totalDuration, clamp } from '../core/helpers'
import { pxPerSecForLevel } from '../core/config'
import { PAN_EDGE, PAN_VMAX } from './constants'
import type { TimelineCtx, ClipDrag, DndView } from './context'

/** 边缘平移与交互路由共享的回调（消除 drag ↔ interactions 初始化环） */
export interface GestureBridge {
  /** 虚拟指针世界坐标变化后重算拖裁 / 拖动预览 */
  updateClipDrag: (lx: number, ly: number) => void
}

export interface DragApi {
  /** 拖裁预览下的世界末端（秒）：trimR 取预览终点；move 取浮块右缘；其余不扩展 */
  dragWorldEndSec: (cd: ClipDrag, scale: number) => number
  stopDragPan: () => void
  ensureDragPan: () => void
  /** move 分支预览（更新 x/y/moved 与光标）；返回 true 表示处于 move 模式 */
  updateMove: (cd: ClipDrag, lx: number, ly: number) => void
  /** 松手提交块体移动（遮罩复位 / temp 清理 / onMoveItem） */
  commitMove: (cd: ClipDrag, moveDv: DndView | null) => void
}

export function createDrag(ctx: TimelineCtx, bridge: GestureBridge): DragApi {
  const { host, cfg, originX, s, callbacks, canvas } = ctx

  /** 拖裁预览下的世界末端（秒）：trimR 取预览终点；move 取浮块右缘；其余不扩展 */
  function dragWorldEndSec(cd: ClipDrag, scale: number): number {
    let end = totalDuration(s.data ?? [], cfg)
    if (cd.mode === 'trimR') {
      const tmp = cd.view.temp
      const e = tmp ? tmp.start + tmp.duration : cd.origStart + cd.origDur
      if (e > end) end = e
    } else if (cd.mode === 'move' && cd.moved) {
      // 浮块世界左缘 = 虚拟指针世界 x - 抓取偏移（grabOffX 与世界 / 屏幕 px 同单位）
      const e = (cd.liveX - cd.grabOffX - originX) / scale + cd.origDur
      if (Number.isFinite(e) && e > end) end = e
    }
    return end
  }

  function stopDragPan() {
    if (s.panRaf) {
      cancelAnimationFrame(s.panRaf)
      s.panRaf = 0
    }
  }

  function dragPanTick(now: number) {
    s.panRaf = 0
    const cd = s.clipDrag
    if (s.destroyed || !cd) return
    s.panRaf = requestAnimationFrame(dragPanTick)
    const dtMs = Math.min(48, now - s.panLastT)
    s.panLastT = now
    const cw = host.clientWidth || 1280
    // 虚拟指针的屏幕逻辑坐标 = 世界坐标 - s.offX（按住不松手时该值恒定）
    const sx = cd.liveX - s.offX
    let v = 0
    if (sx >= cw - PAN_EDGE) {
      v = PAN_VMAX * (1 - clamp(cw - sx, 0, PAN_EDGE) / PAN_EDGE)
    } else if (sx <= cfg.headWidth + PAN_EDGE) {
      v = -PAN_VMAX * (1 - clamp(sx - cfg.headWidth, 0, PAN_EDGE) / PAN_EDGE)
    }
    if (!v) return
    const scale = pxPerSecForLevel(s.zoom, cfg)
    const liveWorldW = originX + dragWorldEndSec(cd, scale) * scale + cfg.padX * 2
    const maxOff = Math.max(0, liveWorldW - cw)
    const next = clamp(s.offX + (v * dtMs) / 1000, 0, maxOff)
    if (next === s.offX) return
    const d = next - s.offX
    s.offX = next
    // s.offX 右增 d，虚拟指针世界坐标同步 +d：屏幕位置钉在原处，所指时间前进 d/scale
    cd.liveX += d
    bridge.updateClipDrag(cd.liveX, cd.liveY)
  }

  function ensureDragPan() {
    if (!s.panRaf && !s.destroyed) {
      s.panLastT = performance.now()
      s.panRaf = requestAnimationFrame(dragPanTick)
    }
  }

  function updateMove(cd: ClipDrag, lx: number, ly: number) {
    // 块体移动＝"重新投放"（可上下左右跨轨）：落点 / 磁吸 / 灰槽 / 重叠新建轨
    // 全部由 draw 内 resolveDnd 解析（与素材库拖入完全一致），此处仅更新指针态。
    // resolveDnd 读屏幕逻辑坐标，故世界坐标减去当前 s.offX
    cd.x = lx - s.offX
    cd.y = ly
    cd.moved = true
    // 四向移动光标（悬停时保持默认箭头，只有真正拖起来才变）
    if (canvas.style.cursor !== 'move') canvas.style.cursor = 'move'
  }

  function commitMove(cd: ClipDrag, moveDv: DndView | null) {
    // 块体重新投放：真实块交给外层移动到目标轨 / 新建轨，源轨空了删轨
    cd.view.view.mask = null
    cd.view.clearTemp()
    s.moveView = null
    if (cd.moved && moveDv?.valid) {
      callbacks.onMoveItem?.(
        cd.track.id,
        cd.view.item.id,
        moveDv.start,
        moveDv.trackId,
        moveDv.createNew
      )
    }
  }

  return { dragWorldEndSec, stopDragPan, ensureDragPan, updateMove, commitMove }
}
