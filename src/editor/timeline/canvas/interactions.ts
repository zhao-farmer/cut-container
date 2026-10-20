/* ============================================================
 *  时间轴画布 · 指针 / 键盘交互路由
 *  命中测试（滚动条 / 封面 / 播放头 / 标记 / 素材块）、播放头定位、
 *  选中、拖动手势分派（拖动 → drag 模块；左右拉取 → trim 模块）、
 *  滚轮平移、右键删标记、Alt+方向键逐帧移动、ResizeObserver。
 * ============================================================ */
import type { TimelineSelection } from '../core/types'
import { clamp, totalDuration } from '../core/helpers'
import { pxPerSecForLevel } from '../core/config'
import { playheadDragCursor, trimLeftCursor, trimRightCursor } from '../../utils/icons'
import { COVER_BTN_SIZE, COVER_CLOSE_R } from './graphics'
import { MARKER_HIT_PX } from './constants'
import type { ClipView } from './clipView'
import type { TimelineCtx } from './context'
import type { RendererApi } from './render'
import type { OpsApi } from './ops'
import type { TrimApi } from './trim'
import type { DragApi, GestureBridge } from './drag'

export interface InteractionDeps {
  renderer: RendererApi
  ops: OpsApi
  trim: TrimApi
  drag: DragApi
}

export interface InteractionsApi {
  /** 外部 handle.select / ops 联动用 */
  select: (sel: TimelineSelection | null) => void
  /** trim 模块手势中更新 hint（无真实事件，用最近 client 坐标） */
  dragHint: (text: string) => void
  destroy: () => void
}

export function bindCanvasInteractions(ctx: TimelineCtx, deps: InteractionDeps): InteractionsApi & GestureBridge {
  const { host, canvas, app, cfg, hintEl, s, views, callbacks } = ctx
  const { timeToX, frameSnap, xToFrameTime, clipGeomFor, stackHeightOf } = ctx.geo
  const { renderer, ops, trim, drag } = deps
  const { layout, scrollbarGeom, draw, scheduleDraw, flushDraw, emitPreview, cancelPreviewTrail } = renderer

  /** 播放头拖动光标（tuodonghuabu 自定义图形，回退 ew-resize） */
  const playheadCursor = playheadDragCursor()
  // 选中块左 / 右拖裁边的导向光标（SVG 定义在 utils/icons.ts）
  const trimLCursor = trimLeftCursor()
  const trimRCursor = trimRightCursor()
  /** 上一次悬停的音频块（仅用来区分悬停变化，触发 setHovered） */
  let lastHoverView: ClipView | null = null

  function pointerPos(e: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect()
    // canvas 物理上只占右侧（left=headWidth）：本地坐标 [0, cw-headWidth] 换回
    // 绘制所用的全屏逻辑坐标（+headWidth），下游命中 / 拖拽 / 时间换算全部不改
    const cssW = (host.clientWidth || 1280) - cfg.headWidth
    return {
      x: ((e.clientX - rect.left) / rect.width) * cssW + cfg.headWidth,
      y: ((e.clientY - rect.top) / rect.height) * (host.clientHeight || 204)
    }
  }

  // 释放指针捕获：pointercancel / 捕获已被浏览器自动释放时再调会抛 NotFoundError，
  // 不能让它打断松手提交流程（提交 / 复位都在 release 之后）
  function releaseCapture(e: PointerEvent) {
    try {
      canvas.releasePointerCapture?.(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function hitScrollbar(p: { x: number; y: number }) {
    const cw = host.clientWidth || 1280
    const ch = host.clientHeight || 204
    const worldW =
      ctx.originX + totalDuration(s.data ?? [], cfg) * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2
    if (worldW <= cw) return null
    // div 轨道头列不属于滚动条（canvas 自 headWidth 起，物理上点不到 <headWidth，护栏仅作语义兜底）
    if (p.x < cfg.headWidth) return null
    const geom = scrollbarGeom(cw, worldW)
    if (p.y >= ch - cfg.scrollbarHeight && p.y <= ch) {
      return { geom, onThumb: p.x >= geom.x && p.x <= geom.x + geom.w }
    }
    return null
  }

  /** 封面按钮热区：当前帧主轨泳道上的 40×40，与播放区矩形求交
   *  （纵滚后按钮可能部分 / 完全滑出标尺下沿，越出部分不可点） */
  function hitCover(p: { x: number; y: number }): boolean {
    if (!s.coverRect) return false
    const cw = host.clientWidth || 1280
    const ch = host.clientHeight || 204
    const worldW =
      ctx.originX + totalDuration(s.data ?? [], cfg) * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2
    const top = cfg.timelineHeight
    const bottom = ch - (worldW > cw ? cfg.scrollbarHeight : 0)
    const size = COVER_BTN_SIZE
    return (
      p.x >= s.coverRect.x &&
      p.x <= s.coverRect.x + size &&
      p.y >= Math.max(s.coverRect.y, top) &&
      p.y <= Math.min(s.coverRect.y + size, bottom)
    )
  }

  /** 封面缩略图右上角 × 角标热区：仅已设封面时存在，圆心距按钮上 / 右缘 7px、半径 COVER_CLOSE_R */
  function hitCoverClose(p: { x: number; y: number }): boolean {
    if (!s.coverTexture || !s.coverRect) return false
    const size = COVER_BTN_SIZE
    const cx = s.coverRect.x + size - 7
    const cy = s.coverRect.y + 7
    const dx = p.x - cx
    const dy = p.y - cy
    // 圆判定外扩 1.5px，小目标也容易点中
    return dx * dx + dy * dy <= (COVER_CLOSE_R + 1.5) * (COVER_CLOSE_R + 1.5)
  }

  /** 命中播放头：头部（直筒+半圆，热区横向放宽到 ±6）或贯穿泳道的竖线（±3.5） */
  function hitPlayhead(p: { x: number; y: number }): 'head' | 'stem' | null {
    if (p.x < cfg.headWidth) return null
    const cw = host.clientWidth || 1280
    const ch = host.clientHeight || 204
    const worldW =
      ctx.originX + totalDuration(s.data ?? [], cfg) * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2
    const bottom = ch - (worldW > cw ? cfg.scrollbarHeight : 0)
    const hx = timeToX(s.playhead, pxPerSecForLevel(s.zoom, cfg))
    const top = cfg.scaleSpace
    const hw = cfg.playheadHandleWidth / 2
    const headBottom = top + cfg.playheadHandleHeight + hw
    if (p.y >= top - 2 && p.y <= headBottom + 2 && Math.abs(p.x - hx) <= Math.max(hw, 6)) {
      return 'head'
    }
    if (p.y > headBottom && p.y <= bottom && Math.abs(p.x - hx) <= 3.5) {
      return 'stem'
    }
    return null
  }

  /** 命中标尺标记小旗：仅标尺带内、x 在命中半径内，返回最近的标记时刻 */
  function hitMarker(p: { x: number; y: number }): number | null {
    if (p.x < cfg.headWidth || p.y < 0 || p.y > cfg.timelineHeight) return null
    const scale = pxPerSecForLevel(s.zoom, cfg)
    let best: number | null = null
    let bestD = MARKER_HIT_PX
    for (const t of s.markers) {
      const mx = timeToX(t, scale)
      if (mx < cfg.headWidth - MARKER_HIT_PX) continue
      const d = Math.abs(p.x - mx)
      if (d <= bestD) {
        bestD = d
        best = t
      }
    }
    return best
  }

  /** 删除指定时刻（同帧容差）的标记，并通知外层持久化 */
  function removeMarkerAt(t: number) {
    const idx = s.markers.findIndex(m => Math.abs(m - t) < 1 / cfg.fps / 2)
    if (idx < 0) return
    s.markers = s.markers.filter((_, i) => i !== idx)
    if (s.hoverMarker !== null && !s.markers.includes(s.hoverMarker)) s.hoverMarker = null
    callbacks.onMarkersChange?.(s.markers.slice())
    if (!s.destroyed) draw()
  }

  /** 从最上层块开始命中（锁定 / 隐藏轨道的块不可交互） */
  function hitClip(
    p: { x: number; y: number }
  ): { view: ClipView; part: NonNullable<ReturnType<ClipView['hitTest']>> } | null {
    const blocked = new Set<string>()
    for (const t of s.data ?? []) if (t.locked || t.hidden) blocked.add(t.id)
    const list = Array.from(views.values()).reverse()
    for (const cv of list) {
      if (blocked.has(cv.trackId)) continue
      const part = cv.hitTest(p.x, p.y)
      if (part) return { view: cv, part }
    }
    return null
  }

  function select(sel: TimelineSelection | null) {
    if (s.selection?.trackId === sel?.trackId && s.selection?.itemId === sel?.itemId) return
    s.selection = sel
    callbacks.onSelect?.(sel)
  }

  function showHint(e: PointerEvent, text: string) {
    const rect = host.getBoundingClientRect()
    hintEl.textContent = text
    hintEl.style.display = 'block'
    let left = e.clientX - rect.left + 10
    if (left + 70 > rect.width) left = e.clientX - rect.left - 70
    hintEl.style.left = `${left}px`
    hintEl.style.top = `${Math.max(26, e.clientY - rect.top - 26)}px`
  }
  /** 拖裁手势内更新 hint：边缘自动平移帧没有真实事件，复用最近一次 client 坐标 */
  function dragHint(text: string) {
    const cd = s.clipDrag
    if (!cd) return
    const rect = host.getBoundingClientRect()
    hintEl.textContent = text
    hintEl.style.display = 'block'
    let left = cd.cx - rect.left + 10
    if (left + 70 > rect.width) left = cd.cx - rect.left - 70
    hintEl.style.left = `${left}px`
    hintEl.style.top = `${Math.max(26, cd.cy - rect.top - 26)}px`
  }
  function hideHint() {
    hintEl.style.opacity = '0'
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const p = pointerPos(e)
    // 0. 封面按钮（世界锚定、可能横滚到任意 x，早于左缘护栏）：按下即捕获，松手仍在热区内才触发点击。
    //    已设封面时先判右上角 ×（移除），再判缩略图主体（打开弹窗）
    if (hitCoverClose(p)) {
      s.coverPressedClose = true
      s.coverCloseHover = true
      canvas.style.cursor = 'pointer'
      canvas.setPointerCapture?.(e.pointerId)
      draw()
      return
    }
    if (hitCover(p)) {
      s.coverPressed = true
      s.coverHover = true
      canvas.style.cursor = 'pointer'
      canvas.setPointerCapture?.(e.pointerId)
      draw()
      return
    }
    // 1. 滚动条（参考 initScrollbar：点拇指拖动；点轨道空白则拇指中心跳到光标并立即进入拖动）
    //    滚动条轨道代表整个 canvas（自 headWidth 起，含封面前置区下方），早于前置护栏判定
    const sb = hitScrollbar(p)
    if (sb) {
      s.sbDragging = true
      s.dragStartX = e.clientX
      s.dragStartOff = s.offX
      if (!sb.onThumb) {
        const cw = host.clientWidth || 1280
        const vw = cw - cfg.headWidth
        const w = sb.geom.w
        s.offX = clamp(
          ((p.x - cfg.headWidth - w / 2) / (vw - w)) * sb.geom.maxOff,
          0,
          sb.geom.maxOff
        )
        s.dragStartOff = s.offX
        draw()
      }
      canvas.setPointerCapture?.(e.pointerId)
      return
    }

    // canvas 左缘（轨道头 div 右界）之外不响应；时间 0 / 封面已随世界滚动，
    // headWidth..originX-s.offX 区域内的刻度 / 素材 / 空白均可正常交互
    if (p.x < cfg.headWidth) return

    // 2. 播放头（头部 / 竖线）→ 按住拖动（优先于刻度与素材块）
    if (hitPlayhead(p)) {
      s.seeking = true
      s.grabbedPlayhead = true
      s.playhead = clamp(
        xToFrameTime(p.x),
        0,
        Math.max(totalDuration(s.data ?? [], cfg), cfg.defaultDuration)
      )
      canvas.style.cursor = playheadCursor
      canvas.setPointerCapture?.(e.pointerId)
      draw()
      return
    }

    // 3. 标记小旗 → 跳转播放头到标记帧（松手走常规 onSeek；优先于刻度区空白）
    const markerHit = hitMarker(p)
    if (markerHit !== null) {
      s.seeking = true
      s.playhead = frameSnap(markerHit)
      canvas.style.cursor = 'pointer'
      canvas.setPointerCapture?.(e.pointerId)
      draw()
      return
    }

    // 4. 刻度区空白 → 拖播放头（未抓住播放头本体）
    if (p.y <= cfg.timelineHeight) {
      s.seeking = true
      s.playhead = clamp(
        xToFrameTime(p.x),
        0,
        Math.max(totalDuration(s.data ?? [], cfg), cfg.defaultDuration)
      )
      canvas.setPointerCapture?.(e.pointerId)
      draw()
      return
    }

    // 5. 素材块
    const hit = hitClip(p)
    if (hit) {
      const cv = hit.view
      select({ trackId: cv.trackId, itemId: cv.item.id })
      const track = s.data?.find(t => t.id === cv.trackId) ?? null
      if (!track) return
      // 按下点相对块体的抓取位置（move 跨轨重新投放时保持：点在哪，指针就在哪）
      const cwDown = host.clientWidth || 1280
      const chDown = host.clientHeight || 204
      const scaleDown = pxPerSecForLevel(s.zoom, cfg)
      const { lanes: downLanes } = layout(s.data ?? [], cwDown, chDown)
      const srcLane = downLanes.find(l => l.track?.id === track.id) ?? null
      let grabOffX = 0
      let grabRatioY = 0.5
      if (srcLane) {
        const bx = timeToX(cv.start, scaleDown)
        const bw = Math.max(3, cv.duration * scaleDown)
        const g0 = clipGeomFor(
          bx,
          bw,
          srcLane.y,
          srcLane.h,
          srcLane.isMain ||
            track.type === 'video' ||
            track.type === 'image' ||
            track.type === 'audio',
          cv.item
        )
        grabOffX = p.x - g0.x
      grabRatioY = clamp((p.y - g0.y) / g0.h, 0, 1)
      }
      // 音频参数柄（音量白线竖拖 / 淡入淡出小球横拖）：独立手势，不进入移动 / 拖裁
      if (hit.part === 'vol' || hit.part === 'fadeL' || hit.part === 'fadeR') {
        const it = cv.item as unknown as { volume?: number; fadeIn?: number; fadeOut?: number }
        s.clipDrag = {
          mode: hit.part === 'fadeL' ? 'fadeIn' : hit.part === 'fadeR' ? 'fadeOut' : 'vol',
          view: cv,
          origStart: cv.start,
          origDur: cv.duration,
          origSs: cv.sourceStart,
          origVol: it.volume ?? 1,
          origFade: hit.part === 'fadeR' ? it.fadeOut ?? 0 : it.fadeIn ?? 0,
          audioFirst: false,
          wx0: p.x + s.offX,
          liveX: p.x + s.offX,
          liveY: p.y,
          cx: e.clientX,
          cy: e.clientY,
          x: p.x,
          y: p.y,
          grabOffX: 0,
          grabRatioY: 0.5,
          track,
          moved: false,
          ripple: false
        }
        canvas.style.cursor = hit.part === 'vol' ? 'row-resize' : 'ew-resize'
        canvas.setPointerCapture?.(e.pointerId)
        draw()
        return
      }
      if (hit.part === 'left' || hit.part === 'right') {
        // 主轨磁吸开启：主轨拖裁为插帧 / 抽帧全量波纹；关闭或非主轨＝普通邻居钳制
        const rippleTrim = s.mainSnap && track.layer === 0
        s.clipDrag = {
          mode: hit.part === 'left' ? 'trimL' : 'trimR',
          view: cv,
          origStart: cv.start,
          origDur: cv.duration,
          origSs: cv.sourceStart,
          wx0: p.x + s.offX,
          liveX: p.x + s.offX,
          liveY: p.y,
          cx: e.clientX,
          cy: e.clientY,
          x: p.x,
          y: p.y,
          grabOffX: 0,
          grabRatioY: 0.5,
          track,
          moved: false,
          ripple: rippleTrim
        }
        // 按下即给导向光标（左 / 右不同图形），不必等第一次 move
        canvas.style.cursor = hit.part === 'left' ? trimLCursor : trimRCursor
      } else {
        s.clipDrag = {
          mode: 'move',
          view: cv,
          origStart: cv.start,
          origDur: cv.duration,
          origSs: cv.sourceStart,
          wx0: p.x + s.offX,
          liveX: p.x + s.offX,
          liveY: p.y,
          cx: e.clientX,
          cy: e.clientY,
          x: p.x,
          y: p.y,
          grabOffX,
          grabRatioY,
          track,
          moved: false,
          ripple: false
        }
      }
      canvas.setPointerCapture?.(e.pointerId)
      drag.ensureDragPan()
      draw()
      return
    }

    // 5. 空白：定位（吸附到帧）。与点标尺等价——置 s.seeking 并捕获指针，
    //    松手时才经 onSeek 下发给播放器；按住拖动可连续擦放
    s.seeking = true
    s.playhead = clamp(
      xToFrameTime(p.x),
      0,
      Math.max(totalDuration(s.data ?? [], cfg), cfg.defaultDuration)
    )
    select(null)
    canvas.setPointerCapture?.(e.pointerId)
    draw()
  }

  /**
   * 音频参数手势实时更新：
   * - vol：指针纵向位置 → 音量倍率 0..2（白线跟手，波形增益随动）；
   * - fadeIn / fadeOut：相对按下点的世界横向位移 → 淡变秒数（右拖增淡入、
   *   左拖增淡出），钳到 [0, 片段时长]。
   * 直接改时间轴工作副本上的 item（draw 即读它），同时经 onAudioLive 上抛外层
   * （播放器包络 + 右侧面板回显）；首次变动发 first=true 供外层拍撤销快照。
   */
  function updateAudioDrag(
    cd: NonNullable<typeof s.clipDrag>,
    lx: number,
    ly: number
  ) {
    const cv = cd.view
    const item = cv.item as unknown as {
      volume?: number
      fadeIn?: number
      fadeOut?: number
    }
    const emit = (patch: { volume?: number; fadeIn?: number; fadeOut?: number }) => {
      cd.moved = true
      callbacks.onAudioLive?.(cv.item.id, patch, !cd.audioFirst)
      cd.audioFirst = true
    }
    if (cd.mode === 'vol') {
      // 取当前泳道几何（与按下时同口径），纵向映射不依赖横向坐标
      const cw = host.clientWidth || 1280
      const ch = host.clientHeight || 204
      const { lanes } = layout(s.data ?? [], cw, ch)
      const lane = lanes.find(l => l.track?.id === cd.track.id)
      if (!lane) return
      const scale = pxPerSecForLevel(s.zoom, cfg)
      const g = clipGeomFor(
        timeToX(cv.start, scale),
        Math.max(3, cv.duration * scale),
        lane.y,
        lane.h,
        true,
        cv.item
      )
      const v = cv.yToVolume(g, ly)
      // 音量：dB 空间等距映射 → linear 0..10；按 0.01 步进量化
      const qv = Math.round(v * 100) / 100
      if (qv !== (item.volume ?? 1)) {
        item.volume = qv
        emit({ volume: qv })
      }
      return
    }
    // fadeIn / fadeOut：世界位移换算秒；淡出方向相反
    const scale = pxPerSecForLevel(s.zoom, cfg)
    const dt = (lx - cd.wx0) / scale
    const base = cd.origFade ?? 0
    const raw = cd.mode === 'fadeIn' ? base + dt : base - dt
    const maxFade = Math.min(10, cv.duration)
    // 淡入淡出步进 0.1s，钳到 [0, min(10, 片段时长)]
    const v = Math.round(Math.max(0, Math.min(maxFade, raw)) * 10) / 10
    if (cd.mode === 'fadeIn') {
      if (v !== (item.fadeIn ?? 0)) {
        item.fadeIn = v
        emit({ fadeIn: v })
      }
    } else if (v !== (item.fadeOut ?? 0)) {
      item.fadeOut = v
      emit({ fadeOut: v })
    }
  }

  /**
   * 真实指针移动与边缘自动平移帧共用同一套计算——平移帧中屏幕指针不动，
   * 由 liveX 随 s.offX 增长来推动时间前进（拖出轨道边界后仍可持续拉长）。
   */
  function updateClipDrag(lx: number, ly: number) {
    const cd = s.clipDrag
    if (!cd) return
    if (cd.mode === 'vol' || cd.mode === 'fadeIn' || cd.mode === 'fadeOut') {
      updateAudioDrag(cd, lx, ly)
      scheduleDraw()
      return
    }
    const scale = pxPerSecForLevel(s.zoom, cfg)
    // 位移相对按下点（世界坐标）：原实现误用素材起点做基准，按下瞬间素材会跳到光标处
    const dt = (lx - cd.wx0) / scale
    s.snapGuide = null
    if (cd.mode === 'move') {
      drag.updateMove(cd, lx, ly)
    } else {
      trim.updateTrim(cd, dt)
    }
    // 拖裁中：左 / 右边缘分别显示对应导向光标（按住拖动期间）
    if (cd.mode === 'trimL') canvas.style.cursor = trimLCursor
    else if (cd.mode === 'trimR') canvas.style.cursor = trimRCursor
    scheduleDraw()
  }

  const onPointerMove = (e: PointerEvent) => {
    const p = pointerPos(e)

    // 封面按钮按住中：跟随指针进出热区切换按压高亮，不触发任何轨道交互
    if (s.coverPressedClose) {
      const inside = hitCoverClose(pointerPos(e))
      canvas.style.cursor = 'pointer'
      if (inside !== s.coverCloseHover) {
        s.coverCloseHover = inside
        scheduleDraw()
      }
      return
    }
    if (s.coverPressed) {
      const inside = hitCover(p)
      canvas.style.cursor = 'pointer'
      if (inside !== s.coverHover) {
        s.coverHover = inside
        scheduleDraw()
      }
      return
    }

    if (s.sbDragging) {
      const cw = host.clientWidth || 1280
      const worldW =
        ctx.originX + totalDuration(s.data ?? [], cfg) * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2
      const geom = scrollbarGeom(cw, worldW)
      const dx = e.clientX - s.dragStartX
      s.offX = clamp(
        s.dragStartOff + (dx / (cw - cfg.headWidth - geom.w)) * geom.maxOff,
        0,
        geom.maxOff
      )
      scheduleDraw()
      return
    }

    if (s.seeking) {
      if (s.grabbedPlayhead) canvas.style.cursor = playheadCursor
      s.playhead = clamp(
        xToFrameTime(p.x),
        0,
        Math.max(totalDuration(s.data ?? [], cfg), cfg.defaultDuration)
      )
      scheduleDraw()
      return
    }

    if (s.clipDrag) {
      // 记录虚拟指针（世界坐标）与最近真实 client 坐标，预览 / 边缘平移共用
      s.clipDrag.liveX = p.x + s.offX
      s.clipDrag.liveY = p.y
      s.clipDrag.cx = e.clientX
      s.clipDrag.cy = e.clientY
      updateClipDrag(s.clipDrag.liveX, s.clipDrag.liveY)
      return
    }

    // 预览轴：开启且非播放态时黄线跟随鼠标横向移动（轨道头列与横滚条区域不显示）。
    // 与播放头（指针轴）同以帧为单位：屏幕位置先吸附到最近帧再回映屏幕 x，
    // 故鼠标移动时黄线连带「靠后一帧」灰矩形是整帧整帧地跳，而非连续滑动；
    // 同时把悬停时刻上抛给播放器，把该帧画面放进播放画面（不动播放头）。
    if (s.previewAxis && !s.playing) {
      const maxY = (canvas.clientHeight || 0) - cfg.scrollbarHeight
      let nx: number | null = null
      if (p.x >= cfg.headWidth && p.y >= 0 && p.y <= maxY) {
        nx = timeToX(xToFrameTime(p.x), pxPerSecForLevel(s.zoom, cfg))
      }
      const moved = nx === null ? s.previewX !== null : s.previewX === null || Math.abs(nx - s.previewX) > 0.5
      if (moved) {
        s.previewX = nx
        scheduleDraw()
        // 黄线即时；画面预览（多层静帧 / 视频解码）走 200ms leading+trailing 节流
        emitPreview(nx === null ? null : xToFrameTime(nx))
      }
    }

    // 悬停光标
    // 封面按钮：手型 + 提亮（世界锚定、随横滚移动，优先于播放头 / 刻度判定）。
    // 已设封面时 × 角标优先：在角标上＝「移除封面」，在缩略图其余区域＝「设置封面」
    if (hitCoverClose(p)) {
      canvas.style.cursor = 'pointer'
      canvas.title = '移除封面'
      if (s.coverHover) {
        s.coverHover = false
        draw()
      }
      if (!s.coverCloseHover) {
        s.coverCloseHover = true
        draw()
      }
      return
    }
    if (s.coverCloseHover) {
      s.coverCloseHover = false
      draw()
    }
    if (hitCover(p)) {
      canvas.style.cursor = 'pointer'
      canvas.title = '设置封面'
      if (!s.coverHover) {
        s.coverHover = true
        draw()
      }
      return
    }
    if (s.coverHover) {
      s.coverHover = false
      canvas.title = ''
      draw()
    }
    // 播放头头/竖线：显示拖动光标（仅提示可拖，手柄不变白，按住才变白）
    if (hitPlayhead(p)) {
      canvas.style.cursor = playheadCursor
      if (s.sbHover) {
        s.sbHover = false
        draw()
      }
      if (s.hoverMarker !== null) {
        s.hoverMarker = null
        draw()
      }
      return
    }
    // 标记小旗：手型 + 高亮（点击跳转、右键删除）
    const hm = hitMarker(p)
    if (hm !== null) {
      canvas.style.cursor = 'pointer'
      canvas.title = '点击定位到标记，右键删除'
      if (s.hoverMarker !== hm) {
        s.hoverMarker = hm
        draw()
      }
      return
    }
    if (s.hoverMarker !== null) {
      s.hoverMarker = null
      canvas.title = ''
      draw()
    }
    const hit = hitScrollbar(p)
    if (hit) {
      canvas.style.cursor = 'pointer'
      if (!s.sbHover) {
        s.sbHover = true
        draw()
      }
      return
    }
    const ch = hitClip(p)
    if (ch) {
      // 悬停态切换：只在变化时 setHovered（重绘），其他块类型 setHovered 是空成本
      if (lastHoverView !== ch.view) {
        lastHoverView?.setHovered(false)
        ch.view.setHovered(true)
        lastHoverView = ch.view
      }
      // 选中块左右两侧 6px 拖裁热区：显示对应左 / 右导向光标（hitTest 仅对
      // selected 块返回 'left'/'right'，未选中块任何位置都是 'body'）；
      // 块体其余区域保持默认箭头
      if (ch.part === 'left') canvas.style.cursor = trimLCursor
      else if (ch.part === 'right') canvas.style.cursor = trimRCursor
      else if (ch.part === 'vol') canvas.style.cursor = 'ns-resize'
      else if (ch.part === 'fadeL' || ch.part === 'fadeR') canvas.style.cursor = 'ew-resize'
      else canvas.style.cursor = ''
    } else {
      // 进入非块区域（标尺 / 滚动条 / 空白泳道 / 封面按钮）：清除悬停
      if (lastHoverView) { lastHoverView.setHovered(false); lastHoverView = null }
      canvas.style.cursor = ''
      if (s.sbHover) {
        s.sbHover = false
        draw()
      }
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    // 封面按钮松手：仍在对应热区内才视为点击（按下后移出则取消）
    if (s.coverPressedClose) {
      const inside = hitCoverClose(pointerPos(e))
      s.coverPressedClose = false
      s.coverCloseHover = inside
      releaseCapture(e)
      draw()
      if (inside) callbacks.onCover?.('remove')
      return
    }
    if (s.coverPressed) {
      const inside = hitCover(pointerPos(e))
      s.coverPressed = false
      s.coverHover = inside
      releaseCapture(e)
      draw()
      if (inside) callbacks.onCover?.('open')
      return
    }
    if (s.sbDragging) {
      s.sbDragging = false
      releaseCapture(e)
      return
    }
    if (s.seeking) {
      const wasGrab = s.grabbedPlayhead
      s.seeking = false
      s.grabbedPlayhead = false
      releaseCapture(e)
      // 撤销悬停预览的 trailing：seek 后画面以播放头为准，
      // 不能让挂起的旧悬停帧在 seek 静帧之后上屏
      cancelPreviewTrail()
      callbacks.onSeek?.(s.playhead)
      if (wasGrab) {
        // 松手即恢复深色白描边（重绘）；光标按当前位置复位（仍悬停在播放头上则保持拖动提示）
        canvas.style.cursor = hitPlayhead(pointerPos(e)) ? playheadCursor : ''
        draw()
      }
      return
    }
    if (s.clipDrag) {
      const cd = s.clipDrag
      const isAudio = cd.mode === 'vol' || cd.mode === 'fadeIn' || cd.mode === 'fadeOut'
      drag.stopDragPan()
      if (isAudio) {
        // 音频参数手势：不走移动 / 拖裁提交流程，直接通知外层一次性入栈落盘
        const itemId = cd.view.item.id
        s.clipDrag = null
        s.snapGuide = null
        canvas.style.cursor = ''
        releaseCapture(e)
        callbacks.onAudioCommit?.(itemId)
        draw()
        return
      }
      const wasMove = cd.mode === 'move'
      // 先以最后指针位置合帧，s.moveView 才是松手瞬间的终态落点
      if (wasMove && cd.moved) flushDraw()
      const moveDv = wasMove ? s.moveView : null
      s.clipDrag = null
      s.snapGuide = null
      hideHint()
      canvas.style.cursor = ''
      releaseCapture(e)
      if (wasMove) {
        // 块体重新投放：移动模块交外层 onMoveItem（目标轨 / 新建轨，源轨空了删轨）
        drag.commitMove(cd, moveDv)
      } else {
        // 左右拉取：temp 按帧整数回写（滚动分割点 / 波纹同一撤销点）
        trim.commitTrim(cd)
      }
      // 外层回调通常已同步 setData 触发重绘；未接线时也保证视图复位
      draw()
    }
  }


  const onWheel = (e: WheelEvent) => {
    const cw = host.clientWidth || 1280
    const ch = host.clientHeight || 204
    const tracks = s.data ?? []
    const stackH = stackHeightOf(tracks)
    const worldW =
      ctx.originX + totalDuration(tracks, cfg) * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2
    // 与 layout 同口径：仅实际出现横向滚动条时才扣除条高
    const hasHBar = worldW > cw
    const viewH = ch - cfg.timelineHeight - (hasHBar ? cfg.scrollbarHeight : 0)
    if (stackH > viewH && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const minY = Math.min(0, viewH - stackH - 12)
      const next = clamp(s.offY + (e.deltaY > 0 ? -28 : 28), minY, 0)
      if (next !== s.offY) {
        s.offY = next
        e.preventDefault()
        scheduleDraw()
      }
      return
    }
    const maxOff = Math.max(0, worldW - cw)
    if (maxOff <= 0) return
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.8
    const next = clamp(s.offX + delta, 0, maxOff)
    if (next !== s.offX) {
      s.offX = next
      e.preventDefault()
      scheduleDraw()
    }
  }


  const onPointerLeave = () => {
    // 鼠标离开画布：清除块悬停态（音频覆盖层回到 0.5 常驻透明度）
    if (lastHoverView) { lastHoverView.setHovered(false); lastHoverView = null }
    // 隐藏预览轴黄线 / 封面悬停态（含 × 角标）/ 标记高亮
    if (s.coverPressed) {
      s.coverPressed = false
      s.coverHover = false
      canvas.title = ''
      draw()
    } else if (s.coverHover) {
      s.coverHover = false
      canvas.title = ''
      draw()
    }
    if (s.coverPressedClose || s.coverCloseHover) {
      s.coverPressedClose = false
      s.coverCloseHover = false
      canvas.title = ''
      draw()
    }
    if (s.hoverMarker !== null) {
      s.hoverMarker = null
      canvas.title = ''
      draw()
    }
    if (s.previewX !== null) {
      s.previewX = null
      draw()
      // 恢复播放器播放头位置的静帧（非播放态悬停预览的收尾）；撤销在途 trailing
      emitPreview(null)
    }
  }


  // 右键：标记小旗 → 删除标记；片段 → 选中并弹出复制 / 剪切 / 删除菜单
  const onContextMenu = (e: MouseEvent) => {
    // 时间轴画布上不弹浏览器原生菜单（空白处右键静默）
    e.preventDefault()
    const p = pointerPos(e)
    const marker = hitMarker(p)
    if (marker !== null) {
      removeMarkerAt(marker)
      return
    }
    const hit = hitClip(p)
    if (!hit) return
    const sel = { trackId: hit.view.trackId, itemId: hit.view.item.id }
    select(sel)
    callbacks.onClipContextMenu?.(sel, e)
  }

  /* ---------- 键盘：Alt+← / Alt+→ 选中子项逐帧移动（按住系统连发，首帧压一次历史） ---------- */
  /** 穿透 Shadow DOM 取真正聚焦元素，避免在文本输入框里劫持方向键 */
  const activeEditable = (): Element | null => {
    let el: Element | null = document.activeElement
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.activeElement
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    const ae = activeEditable() as HTMLElement | null
    if (
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable)
    )
      return
    if (!s.selection || s.clipDrag) return
    const sel = s.selection
    const tr = s.data?.find(t => t.id === sel.trackId)
    const it = tr?.items.find(i => i.id === sel.itemId)
    if (!tr || !it || tr.locked || tr.hidden) return
    // 阻止 Alt+←/→ 触发浏览器历史后退 / 前进
    e.preventDefault()
    const frame = 1 / cfg.fps
    // 夹在同轨相邻子项的间隙内（端点相接允许）
    let prevEnd = 0
    let nextStart = Infinity
    for (const o of tr.items) {
      if (o.id === it.id) continue
      const end = o.start + o.duration
      if (end <= it.start + frame / 2 && end > prevEnd) prevEnd = end
      if (o.start >= it.start + it.duration - frame / 2 && o.start < nextStart) nextStart = o.start
    }
    const dir = e.key === 'ArrowLeft' ? -1 : 1
    const ns = Math.max(
      0,
      frameSnap(clamp(it.start + dir * frame, prevEnd, Math.max(prevEnd, nextStart - it.duration)))
    )
    if (Math.abs(ns - it.start) < frame / 2) return
    // e.repeat＝按住连发的后续帧：整次按住只在首帧压一个撤销点
    callbacks.onNudgeItem?.(tr.id, it.id, ns, !e.repeat)
  }

  const ro = new ResizeObserver(() => {
    if (s.destroyed) return
    const w = host.clientWidth - cfg.headWidth
    const h = host.clientHeight
    if (w > 0 && h > 0) {
      app.renderer.resize(w, h)
      draw()
    }
  })

  /* ---------------- 事件绑定 / 解绑 ---------------- */
  function bind() {
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    draw()
    ro.observe(host)
  }

  function destroy() {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    ro.disconnect()
  }

  bind()
  return { updateClipDrag, select, dragHint, destroy }
}
