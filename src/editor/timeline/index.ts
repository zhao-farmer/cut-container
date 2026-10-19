/* ============================================================
 *  编辑器框架 · 模块四：底部时间轴轨道（pixi.js v8）
 *
 *  目录划分与 player/ 对齐（core / ui / canvas 三类）：
 *    index.ts    对外入口（createTimelineTrack 装配）
 *    core/       配置 / 类型 / 纯工具（config.ts、types.ts、helpers.ts）
 *    ui/         轨道头列与顶部工具条（headBar.ts、toolbar.ts、tools.ts、
 *                states.ts、playerOps.ts）
 *    canvas/     pixi 画布与交互引擎（渲染、几何、拖拽、拖裁、落点、波形、
 *                帧向量、命中测试等）
 *
 *  数据模型：TrackObject[]（layer：主轨 0 / 上方正数层 / 音频负数层）。
 *  参考 asconfig/src/components/TimelineEditor/TimelineEditor.vue：
 *    - 视频：mediabunny 按时间点抽帧，轨道上铺连续封面缩略格，
 *      视频内嵌音轨在素材块下半部画真实波形；
 *    - 音频：解码文件后画 dB 非线性映射波形（超 -6dB 橙色）；
 *    - 图片 / 贴纸 / GIF：cover 烘焙瓦片横向平铺；
 *    - 操作：点选、左右白柄拖裁（改素材入点）、整块拖动换位、
 *      磁吸参考线、播放头拖动定位、分割 / 向左右裁剪 / 删除，
 *      所有数据变更经 onCommit 上抛（由外层落盘 + 记历史）。
 * ============================================================ */
import { type TrackObject } from '../types'
import * as PIXI from 'pixi.js'
import { createMediaStore, type MediaStore } from '../codec/timelineMedia'
import { WaveformRenderer } from './canvas/waveformRenderer'

/* ---------- 纯类型 / 配置 / 图形 / 工具模块（core · canvas · ui 分组） ---------- */
import type { TimelineSelection, TimelineCallbacks, TimelineTrackHandle } from './core/types'
export type {
  TimelineSelection,
  TimelineOp,
  OpResult,
  TimelineCallbacks,
  TimelineTrackHandle
} from './core/types'
import { resolveTimelineConfig, pxPerSecForLevel } from './core/config'
import type { TimelineConfig } from './core/config'
import { clamp, totalDuration } from './core/helpers'
import type { ClipView } from './canvas/clipView'
import { createTimelineState } from './canvas/context'
import type { TimelineCtx, HeadEls } from './canvas/context'
import { createGeometry } from './canvas/geometry'
import { createDndLayout } from './canvas/dndLayout'
import { createHeadBar } from './ui/headBar'
import { createLayers, createRenderer } from './canvas/render'
import { createOps } from './canvas/ops'
import { createTrim } from './canvas/trim'
import { createDrag } from './canvas/drag'
import { createAddModule } from './canvas/addModule'
import { bindCanvasInteractions } from './canvas/interactions'

export async function createTimelineTrack(
  host: HTMLElement,
  initial: TrackObject[] | null = null,
  callbacks: TimelineCallbacks = {},
  config: Partial<TimelineConfig> = {}
): Promise<TimelineTrackHandle> {
  // 单一配置数据源：默认值 + 外部 Partial 覆盖（标量逐项覆盖、类型色板按键浅合并）
  const cfg = resolveTimelineConfig(config)
  // 时间 0 在静止（s.offX=0）时的屏幕 x：轨道头列 + 封面前缀段；
  // 所有时间坐标换算（timeToX / 标尺 / worldW / 滚动条 / 缩放锚点）都以此为世界原点，
  // 横滚时时间 0 的实际屏幕位置为 originX - s.offX（封面按钮同步移动）
  const originX = cfg.headWidth + cfg.preGap
  const store: MediaStore = createMediaStore(PIXI)
  const waveform = new WaveformRenderer(PIXI)
  // 画布全部可变状态（缩放 / 滚动 / 选中 / 手势 / 拖放 / 封面 / 节流等）统一装状态盒
  const s = createTimelineState(initial, cfg.levelDefault)


  // 左右布局（参考 asconfig TimelineEditor：.handle-track div + #timeline-main-canvas）：
  // 左侧 headWidth(90) 是 div 轨道头列（headEl，类型图标 + 锁/显示/原声按钮），canvas 只占右侧画布区，宽度 = 容器宽 - headWidth。
  // canvas 内部仍使用「全屏逻辑坐标」（0 = host 左缘）绘制：stage.x = -headWidth 平移，
  // 使全屏 headWidth..cw 的内容落在 canvas 本地 0..(cw-headWidth)；0..headWidth 画到画布外被自然裁掉。
  const initialW = (host.clientWidth || 1280) - cfg.headWidth
  const initialH = host.clientHeight || 204

  // v8：Application 构造与初始化分离，init 为异步；app.view → app.canvas
  const app = new PIXI.Application()
  await app.init({
    width: initialW,
    height: initialH,
    background: cfg.backgroundColor,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })
  app.ticker.stop()
  app.stage.x = -cfg.headWidth
  const canvas = app.canvas as HTMLCanvasElement
  canvas.style.display = 'block'
  canvas.style.touchAction = 'none'
  // 物理上只占右侧画布区（左侧 headWidth 归 headEl div）；宽高由 pixi 按 renderer 尺寸内联
  canvas.style.position = 'absolute'
  canvas.style.left = `${cfg.headWidth}px`
  canvas.style.top = '0'
  host.appendChild(canvas)

  // 拖动时的时间提示（DOM，避免 canvas 文字每帧重建）
  const hintEl = document.createElement('div')
  hintEl.className = 'ed-tl-hint'
  hintEl.style.display = 'none'
  host.appendChild(hintEl)

  /* ===== 左侧按钮栏：轨道头列（类型图标 + 锁 / 显示 / 原声） ===== */
  const head = createHeadBar(host, cfg, s, { toggleTrack: (id, act) => ops.toggleTrack(id, act) })
  const syncHead = head.syncHead

  /* ---------- 主轨「封面」前缀按钮由 pixi 绘制（见 draw 内 coverLayer） ---------- */

  /* ---------------- 素材库 → 时间轴 HTML5 拖放 ----------------
   * 剪映顺序：素材区拖出单张缩略图（复制光标 ＋）；播放器 / 信息区不可放（not-allowed）；
   * 进入时间轴先露出半个青色占位块，完全进入后兼容泳道整行变色（含左侧轨道头），
   * 纵向压入泳道过半时槽位锁定、显示灰色底槽；松手即在该时刻成为轨道子项。
   * 视频 / 图片 / GIF 只认视频 / 图片类泳道，音频只认音频泳道，互不可放。 */

  const layers = createLayers(PIXI, app)
  const views = new Map<string, ClipView>()

  /* ===== 画布共享上下文：常量 / 服务 + 状态盒 s；各功能模块只经 ctx 访问 ===== */
  const headEls: HeadEls = head.els
  const ctxBase: Omit<TimelineCtx, 'geo'> = {
    host, canvas, app, PIXI, cfg, originX, store, waveform, callbacks,
    hintEl, headEls, layers, views, s
  }
  const geo = createGeometry(ctxBase as unknown as TimelineCtx)
  const ctx: TimelineCtx = { ...ctxBase, geo }
  /* 「添加」落点解析（近纯函数） */
  const dnd = createDndLayout(ctx)
  const payloadOfItem = dnd.payloadOfItem
  const resolveDnd = dnd.resolve
  /* 几何辅助（handle 中播放头 / 缩放锚点换算用） */
  const { timeToX, frameSnap } = geo
  /* 右侧画布栏：渲染（布局 / draw / 合帧 / 节流）；dragWorldEndSec 为函数声明提升，可提前引用 */
  const renderer = createRenderer(ctx, {
    syncHead,
    resolveDnd,
    payloadOfItem,
    dragWorldEndSec: (cd, scale) => drag.dragWorldEndSec(cd, scale)
  })
  const draw = renderer.draw
  const scheduleDraw = renderer.scheduleDraw
  const emitPreview = renderer.emitPreview
  /* 操作（分割 / 删除 / 恢复提交）/ 左右拉取 / 拖动 / 添加 / 交互路由 */
  const opsDeps = { select: (_sel: TimelineSelection | null) => {}, draw }
  const ops = createOps(ctx, opsDeps)
  /* drag 先于 interactions：边缘平移经 gesture 桥回调 updateClipDrag */
  const gesture: { updateClipDrag: (lx: number, ly: number) => void } = {
    updateClipDrag: () => {}
  }
  const drag = createDrag(ctx, gesture)
  /* trim 构造早于 interactions，hint 用箭头延迟引用 */
  const trim = createTrim(ctx, ops, { dragHint: t => interactions.dragHint(t) })
  const addModule = createAddModule(ctx, renderer)
  const interactions = bindCanvasInteractions(ctx, { renderer, ops, trim, drag })
  gesture.updateClipDrag = interactions.updateClipDrag
  opsDeps.select = interactions.select

  return {
    setData(next: TrackObject[] | null) {
      s.data = next
      // 选中项若已不存在则清除（不触发 onSelect，由外层随数据刷新）
      if (s.selection && !next?.some(t => t.id === s.selection!.trackId && t.items.some(i => i.id === s.selection!.itemId))) {
        s.selection = null
        callbacks.onSelect?.(null)
      }
      if (!s.destroyed) draw()
    },
    /** 就地改了同一引用数据后的轻量重绘（面板滑杆高频联动，rAF 合帧） */
    redraw() {
      if (!s.destroyed) scheduleDraw()
    },
    setCover(image: string | null) {
      // dataURL → HTMLImage → Texture（Texture.from 不走 Assets 扩展名推断，
      // 对 s.data: URL 最稳）；token 防止快速连续设置时旧图后返回覆盖新图
      const token = ++s.coverLoadToken
      const oldTexture = s.coverTexture
      s.coverTexture = null
      if (oldTexture && !s.destroyed) draw()
      if (!image) {
        oldTexture?.destroy(true)
        return
      }
      const img = new Image()
      img.onload = () => {
        if (s.destroyed || token !== s.coverLoadToken) return
        const tex = PIXI.Texture.from(img)
        s.coverTexture = tex
        oldTexture?.destroy(true)
        draw()
      }
      img.onerror = () => {
        console.warn('[TimelineTrack] 封面图片加载失败')
      }
      img.src = image
    },
    setZoom(level: number) {
      const next = clamp(Math.round(level), cfg.levelMin, cfg.levelMax)
      if (next === s.zoom) return
      const cw = host.clientWidth || 1280
      // 锚点必须取播放区（canvas 元素）的视觉中心，绘制坐标 (headWidth+cw)/2。
      // 旧实现用整幅 cw/2，偏左 headWidth/2（≈45px）：放大时指针下的时间点
      // 持续向右漂移，连带横滚条拇指位置每级都"跳"一下
      const viewCx = (cfg.headWidth + cw) / 2
      const centerSec = (s.offX + viewCx - originX) / pxPerSecForLevel(s.zoom, cfg)
      s.zoom = next
      const newScale = pxPerSecForLevel(s.zoom, cfg)
      const duration = totalDuration(s.data ?? [], cfg)
      const maxOff = Math.max(0, originX + duration * newScale + cfg.padX * 2 - cw)
      s.offX = clamp(originX + centerSec * newScale - viewCx, 0, maxOff)
      if (!s.destroyed) draw()
    },
    getZoom() {
      return s.zoom
    },
    setSnap(on: boolean) {
      s.snap = on
      if (!s.destroyed) draw()
    },
    setMainSnap(on: boolean) {
      s.mainSnap = on
      if (!s.destroyed) draw()
    },
    setPreviewAxis(on: boolean) {
      s.previewAxis = on
      if (!on && s.previewX !== null) {
        s.previewX = null
        // 关闭预览轴：播放器恢复播放头位置画面；撤销在途 trailing
        emitPreview(null)
      }
      if (!s.destroyed) draw()
    },
    setPlaying(v: boolean) {
      if (s.playing === v) return
      s.playing = v
      if (s.playing && s.previewX !== null) {
        // 起播：预览轴立即失效，黄线 / 悬停画面收回（画面由播放帧流接管）
        s.previewX = null
        emitPreview(null)
      }
      if (!s.destroyed) scheduleDraw()
    },
    getSelection() {
      return s.selection
    },
    select(trackId: string, itemId: string) {
      interactions.select({ trackId, itemId })
      if (!s.destroyed) draw()
    },
    clearSelection() {
      interactions.select(null)
      if (!s.destroyed) draw()
    },
    getPlayhead() {
      return s.playhead
    },
    setPlayhead(time: number, follow = false) {
      // 用户正按住标尺 / 播放头 / 泳道空白定位（s.seeking）：此刻播放头位置以指针为
      // 唯一权威，播放器 timeupdate 回写一律忽略——否则播放中按下到松手之间，高频
      // timeupdate 会把 s.playhead 拉回播放位置，pointerup 的 onSeek 读到旧值，
      // 表现为"第一次点击不跳转、要连点两次"（第二次点击已在 0.5s 定格期、无回写才成功）
      if (s.seeking) return
      // 时间的基础单位是帧：外部（播放器）进来的时间一律吸附到帧网格，
      // 保证播放头位置与播放器时间码永远指向同一帧
      s.playhead = clamp(
        frameSnap(time),
        0,
        Math.max(totalDuration(s.data ?? [], cfg), cfg.defaultDuration)
      )
      // 播放跟随：播放头越过视口右内边距 / 左原点时，自动横向滚动时间线，
      // 使播放头始终可见（拖动 seek 不走这里，避免抢占用户滚动位置）
      if (follow) {
        const cw = host.clientWidth || 1280
        const scale = pxPerSecForLevel(s.zoom, cfg)
        const worldW =
          originX + totalDuration(s.data ?? [], cfg) * scale + cfg.padX * 2
        const maxOff = Math.max(0, worldW - cw)
        const hx = timeToX(s.playhead, scale)
        const rightBound = cw - cfg.padX
        if (hx > rightBound) {
          s.offX = clamp(s.offX + (hx - rightBound), 0, maxOff)
        } else if (hx < originX) {
          s.offX = clamp(s.offX - (originX - hx), 0, maxOff)
        }
      }
      if (!s.destroyed) scheduleDraw()
    },
    setPlayheadDimmed(dim: boolean) {
      s.playheadDimmed = dim
      if (!s.destroyed) scheduleDraw()
    },
    setMarkers(times: number[]) {      // 帧对齐 + 按帧序号去重 + 升序：标记只允许落在固定帧单位上
      const seen = new Set<number>()
      const out: number[] = []
      for (const raw of times) {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue
        const frameIdx = Math.round(raw * cfg.fps)
        if (seen.has(frameIdx)) continue
        seen.add(frameIdx)
        out.push(frameIdx / cfg.fps)
      }
      out.sort((a, b) => a - b)
      s.markers = out
      // 悬停标记若已被删除则清除
      if (s.hoverMarker !== null && !s.markers.includes(s.hoverMarker)) s.hoverMarker = null
      if (!s.destroyed) draw()
    },
    applyOp: ops.applyOp,
    destroy() {
      if (s.destroyed) return
      s.destroyed = true
      drag.stopDragPan()
      if (s.drawRaf) {
        cancelAnimationFrame(s.drawRaf)
        s.drawRaf = 0
      }
      if (s.mediaTrailTimer) {
        clearTimeout(s.mediaTrailTimer)
        s.mediaTrailTimer = null
      }
      if (s.previewTrailTimer) {
        clearTimeout(s.previewTrailTimer)
        s.previewTrailTimer = null
      }
      // 指针 / 键盘 / 拖放监听与 ResizeObserver 由模块自行解绑
      interactions.destroy()
      addModule.destroy()
      views.forEach(v => v.destroy())
      views.clear()
      head.destroy()
      hintEl.remove()
      store.destroy()
      try {
        // 遮罩未挂入舞台树，app.destroy 不会回收它的几何，单独销毁
        layers.laneMask.destroy()
        layers.playMask.destroy()
        layers.dndGhostMask.destroy()
        layers.dragClipMask.destroy()
        layers.coverMask.destroy()
        s.coverTexture?.destroy(true)
        // v8：第一参 renderer 选项（removeView），第二参 stage DestroyOptions；
        // 共享纹理已由 store.destroy() 释放
        app.destroy({ removeView: true }, { children: true })
      } catch {
        /* noop */
      }
    }
  }
}

export default createTimelineTrack
