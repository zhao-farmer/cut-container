/* ============================================================
 *  时间轴画布 · 「添加」模块（素材库 → 时间轴 HTML5 拖放）
 *  监听挂 host（左侧轨道头列同样可放）：dragenter / dragover /
 *  dragleave / drop / 文档 dragend。落点几何由渲染帧内 resolveDnd
 *  从 s.dndRaw 解析，s.dndView 至多滞后 1 帧；松手提交 onDropMaterial。
 * ============================================================ */
import { getDragPayload, clearDragPayload, setDragBarMode } from '../../materials/dragPayload'
import type { TimelineCtx } from './context'
import type { RendererApi } from './render'

export interface AddModuleApi {
  destroy: () => void
}

export function createAddModule(ctx: TimelineCtx, renderer: RendererApi): AddModuleApi {
  const { host, s, callbacks } = ctx
  const { scheduleDraw, flushDraw } = renderer

  const dndPosOf = (e: DragEvent) => {
    const rect = host.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onHostDragEnter = (e: DragEvent) => {
    const payload = getDragPayload()
    if (!payload || !e.dataTransfer) return
    e.preventDefault()
    s.dndDepth++
    // 进入轨道区：正方形镜像 → pixi 条形占位；首帧同步出画（enter 仅一次，开销可忽略），
    // 之后高频 dragover 走 rAF 合帧，避免全量重绘阻塞鼠标事件造成拖拽滞后
    setDragBarMode(true)
    s.dndRaw = { payload, ...dndPosOf(e) }
    flushDraw()
  }
  const onHostDragOver = (e: DragEvent) => {
    const payload = getDragPayload()
    if (!payload || !e.dataTransfer) return
    // preventDefault 是允许 drop 的前提；dropEffect 驱动 ＋ / 禁止光标
    e.preventDefault()
    setDragBarMode(true)
    const { x, y } = dndPosOf(e)
    s.dndRaw = { payload, x, y }
    scheduleDraw()
    // s.dndView 为上一帧合帧结果（至多滞后 1 帧），valid 在同类区域内恒定，光标无感
    e.dataTransfer.dropEffect = s.dndView?.valid ? 'copy' : 'none'
  }
  const onHostDragLeave = () => {
    s.dndDepth = Math.max(0, s.dndDepth - 1)
    if (s.dndDepth > 0) return
    s.dndRaw = null
    s.dndView = null
    // 离开轨道区：恢复正方形镜像
    setDragBarMode(false)
    flushDraw()
  }
  // 统一收尾：拖出窗口松手 / ESC 取消 / drop 缺 payload 等异常路径也必须清掉，
  // 否则 s.dndRaw 残留会让不兼容泳道一直压暗，只能刷新页面恢复
  const resetDnd = () => {
    s.dndDepth = 0
    s.dndRaw = null
    s.dndView = null
    setDragBarMode(false)
    clearDragPayload()
  }
  const onHostDrop = (e: DragEvent) => {
    e.preventDefault()
    // 先合帧：用最后一次 dragover 的位置同步算出最新 s.dndView，避免松手与最后一帧
    // 同帧到达时取到旧落点
    flushDraw()
    const view = s.dndView
    const payload = getDragPayload()
    resetDnd()
    flushDraw()
    if (payload && view?.valid)
      callbacks.onDropMaterial?.(payload, view.start, view.trackId, view.createNew)
  }
  // 拖出宿主窗口后松手 / ESC：浏览器只在拖拽源派发 dragend，drop/dragleave 都收不到
  const onDocDragEnd = () => {
    if (!s.dndRaw && s.dndDepth === 0) return
    resetDnd()
    flushDraw()
  }

  host.addEventListener('dragenter', onHostDragEnter)
  host.addEventListener('dragover', onHostDragOver)
  host.addEventListener('dragleave', onHostDragLeave)
  host.addEventListener('drop', onHostDrop)
  document.addEventListener('dragend', onDocDragEnd)

  return {
    destroy() {
      host.removeEventListener('dragenter', onHostDragEnter)
      host.removeEventListener('dragover', onHostDragOver)
      host.removeEventListener('dragleave', onHostDragLeave)
      host.removeEventListener('drop', onHostDrop)
      document.removeEventListener('dragend', onDocDragEnd)
    }
  }
}
