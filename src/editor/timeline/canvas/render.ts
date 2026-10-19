/* ============================================================
 *  时间轴画布 · 右侧画布栏 · 渲染模块
 *  - createLayers：pixi 持久化图层（自下而上）与播放区遮罩
 *  - createRenderer：布局 / 滚动条几何 / 全量 draw / rAF 合帧 /
 *    横滚缩略格节流 / 预览轴画面上抛节流
 *  渲染只读状态盒 s（含 s.clipDrag / s.dndView 等手势预览态），
 *  自身不修改数据；落点解析经 dnd，左侧行同步经 head。
 * ============================================================ */
import type { TrackObject } from '../../types'
import type { Lane } from '../core/types'
import { clamp, totalDuration } from '../core/helpers'
import { formatRuler } from '../../utils/time'
import { t } from '../../lang'
import { pxPerSecForLevel } from '../core/config'
import { coverEditIconSvg } from '../../utils/icons'
import {
  dashedRoundRectPath,
  drawFilmIcon,
  COVER_BTN_SIZE,
  COVER_BTN_RADIUS,
  COVER_DASH_ON,
  COVER_DASH_OFF,
  COVER_ICON_SIZE,
  COVER_CLOSE_R,
  EMPTY_MAIN_LANE_FILL,
  EMPTY_DROP_RADIUS,
  EMPTY_DASH_ON,
  EMPTY_DASH_OFF,
  EMPTY_DROP_FILL_ALPHA,
  EMPTY_DROP_LINE_ALPHA,
  EMPTY_DROP_ICON_ALPHA,
  EMPTY_DROP_TEXT_COLOR,
  EMPTY_LANE_ICON_ALPHA,
  EMPTY_ICON_INSET,
  EMPTY_ICON_TEXT_GAP,
  FILM_ICON_W,
  FILM_ICON_H
} from './graphics'
import { getTimeScaleInfo } from './timeScale'
import { ClipView } from './clipView'
import { initFrameVector } from './frameVector'
import {
  DND_SLOT_COLOR,
  DND_LANE_DIM,
  DND_LANE_DIM_ALPHA,
  DND_LANE_HL,
  DND_LANE_HL_ALPHA,
  DND_SNAP_COLOR,
  MARKER_HALF_W,
  MARKER_BODY_H,
  MARKER_H,
  MARKER_BOTTOM_PAD,
  MARKER_CORNER_R,
  MARKER_HOVER_COLOR
} from './constants'
import type { TimelineCtx, LayerSet, TimelineState, ClipDrag } from './context'
import type { DndLayoutApi } from './dndLayout'

/**
 * 横滚拖拽时缩略格窗口增删 / 抽帧的节流间隔（对齐参考 scrollMainTrackMidea
 * → throttleByParams 200ms）：滚动中最多每 200ms 重算一次窗口，停滚后补一次。
 */
const MEDIA_CELL_THROTTLE_MS = 200
/**
 * 预览轴悬停画面上抛节流：悬停预览要多层静帧（视频片段走 getSample 解码），
 * 鼠标快速划过时每帧都解一遍会把沿途帧全部解码（旧结果虽有 token 作废不上屏，
 * 解码开销仍发生）。与缩略格窗口同策略：移动中最多 200ms 上抛一次（leading），
 * 停下 200ms 后补最终位置（trailing）；黄线本身仍逐帧即时跟随，不受此节流影响。
 */
const PREVIEW_THROTTLE_MS = 200

/** 持久化 pixi 图层（自下而上）+ 播放区遮罩；遮罩几何每帧由 draw 重画 */
export function createLayers(
  PIXI: typeof import('pixi.js'),
  app: import('pixi.js').Application
): LayerSet {
  // 持久化图层（自下而上：全局底 / 标尺 / 泳道 / 素材块 / 拖入占位（裁在泳道区内）/ 参考线与播放头）
  const bgLayer = new PIXI.Container()
  const laneLayer = new PIXI.Container()
  const rulerLayer = new PIXI.Container()
  const clipsLayer = new PIXI.Container()
  // 纵向滚动时泳道 / 素材块只能在「播放区」（标尺线之下、横向滚动条之上）内可见：
  // 标尺与横向滚动条是舞台级固定层，内容层统一用播放区矩形遮罩裁切，
  // 参考 asconfig 中 timelineContainer / scrollbarContainer 与 globalTrackContainer 分离。
  // 横向两层同口径（分区见用户标注：0..headWidth 是轨道头 div，headWidth 起为 canvas）：
  // 泳道底色与素材块都自画布左缘 headWidth 起可见；时间 0 / 封面随世界横滚，
  // 素材块只能存在于时间 ≥ 0（由拖放时间钳制保证），画布内不再有固定裁断列。
  const laneMask = new PIXI.Graphics()
  const playMask = new PIXI.Graphics()
  laneLayer.mask = laneMask
  clipsLayer.mask = playMask
  // 拖入占位（灰槽 / 浮动青块 / 名称）：被泳道区矩形遮罩裁切，指针刚进入
  // 时间轴顶部（标尺带）时，青块自泳道区上沿半露，同剪映入场效果
  const dndGhostLayer = new PIXI.Container()
  const dndGhostMask = new PIXI.Graphics()
  dndGhostLayer.mask = dndGhostMask
  // 块体拖拽时真实 ClipView 的遮罩（越出泳道区顶线半露），仅拖拽期间挂到该块容器
  const dragClipMask = new PIXI.Graphics()
  // 块体拖拽专用置顶层：被拖的真实块（连同画面帧 / 波形）挂到这里，
  // 必须高于灰槽 / 其他块，拖动时永远完整可见不被遮挡（fxLayer 的磁吸绿线仍在其上贯穿）
  const dragLayer = new PIXI.Container()
  const fxLayer = new PIXI.Container()
  // 封面按钮层：纵向随主轨泳道移动、横向随世界滚动，
  // 用整个画布播放区矩形遮罩裁切（滑入标尺带 / 横滚条区域或画布左缘外的部分不可见）。
  // 层级放在素材块层之下——主轨左缘把手左拖预览时，被拖块 / 前片会临时滑到负时间轴
  // （越过坐标轴进入封面所在的轨道头一侧），此时素材块必须盖住封面，封面不得上浮；
  // 静止态封面右缘在时间原点左侧、与 t≥0 的素材块不相交，降层无视觉差。
  // 封面命中走 s.coverRect 手动命中测试，不依赖显示层级，点击不受影响。
  const coverLayer = new PIXI.Container()
  const coverMask = new PIXI.Graphics()
  coverLayer.mask = coverMask
  // 标尺无底色、处于展示最底层（仅高于不透明背景层）；播放头在 fxLayer 仍贯穿标尺
  app.stage.addChild(bgLayer, rulerLayer, laneLayer, coverLayer, clipsLayer, dndGhostLayer, dragLayer, fxLayer)
  return {
    bgLayer, laneLayer, rulerLayer, clipsLayer, laneMask, playMask,
    dndGhostLayer, dndGhostMask, dragClipMask, dragLayer, fxLayer, coverLayer, coverMask
  }
}

export interface RendererDeps {
  /** 左侧轨道头行同步（每帧 draw 末尾） */
  syncHead: (lanes: Lane[], hasHBar: boolean, allTracksEmpty: boolean) => void
  /** 素材库拖入 / 块体移动落点解析 */
  resolveDnd: DndLayoutApi['resolve']
  payloadOfItem: DndLayoutApi['payloadOfItem']
  /** 拖裁 / 拖动预览下的世界末端秒（边缘平移扩展世界宽度用） */
  dragWorldEndSec: (cd: ClipDrag, scale: number) => number
}

export interface RendererApi {
  layout: (tracks: TrackObject[], cw: number, ch: number, durationOverride?: number) =>
    { lanes: Lane[]; hasHBar: boolean; viewH: number; stackH: number }
  scrollbarGeom: (cw: number, worldW: number) => {
    x: number; y: number; w: number; h: number; maxOff: number
  }
  draw: () => void
  scheduleDraw: () => void
  flushDraw: () => void
  /** 预览轴画面上抛（null＝撤销悬停预览）；含 leading/trailing 节流 */
  emitPreview: (t: number | null) => void
  /** 撤销 trailing 预览上抛（离开画布 / seek 提交 / 销毁时） */
  cancelPreviewTrail: () => void
}

export function createRenderer(ctx: TimelineCtx, deps: RendererDeps): RendererApi {
  const { host, canvas, app, PIXI, cfg, originX, store, waveform, callbacks, layers, views, s } = ctx
  const {
    bgLayer, laneLayer, rulerLayer, clipsLayer, laneMask, playMask,
    dndGhostLayer, dndGhostMask, dragClipMask, dragLayer, fxLayer, coverLayer, coverMask
  } = layers
  const { laneHOf, timeToX, clipGeomFor } = ctx.geo
  const { syncHead, resolveDnd, payloadOfItem, dragWorldEndSec } = deps

  /** 每帧重建的临时图层：清空并销毁，避免高频拖动时 GPU 几何泄漏 */
  function clearLayer(layer: import('pixi.js').Container) {
    for (const c of layer.removeChildren()) {
      try {
        c.destroy({ children: true })
      } catch {
        /* noop */
      }
    }
  }

  function layout(tracks: TrackObject[], cw: number, ch: number, durationOverride?: number) {
    // 视觉轨行按 layer 降序（数字层＝创建序，新添加的轨道恒在最上方一行）
    const overlays = tracks.filter(t => t.layer > 0).sort((a, b) => b.layer - a.layer)
    const main = tracks.find(t => t.layer === 0) ?? null
    const audios = tracks.filter(t => t.layer < 0).sort((a, b) => b.layer - a.layer)
    const defs: Array<{ track: TrackObject | null; h: number; isMain: boolean }> = [
      ...overlays.map(t => ({ track: t, h: laneHOf(t), isMain: false })),
      { track: main, h: cfg.mainTrackHeight, isMain: true },
      ...audios.map(t => ({ track: t, h: laneHOf(t), isMain: false }))
    ]
    const stackH = defs.reduce((s, d) => s + d.h, 0) + cfg.lineDistance * (defs.length - 1)
    // 拖裁 / 拖动中传入预览末端：横滚条随主轨右拉超出边界即时出现（见 dragWorldEndSec）
    const duration = durationOverride ?? totalDuration(tracks, cfg)
    const hasHBar = originX + duration * pxPerSecForLevel(s.zoom, cfg) + cfg.padX * 2 > cw
    const viewH = ch - cfg.timelineHeight - (hasHBar ? cfg.scrollbarHeight : 0)
    s.offY = clamp(s.offY, Math.min(0, viewH - stackH - 12), 0)
    const baseY =
      stackH <= viewH
        ? cfg.timelineHeight + (viewH - stackH) / 2
        : cfg.timelineHeight + 6 + s.offY
    const lanes: Lane[] = []
    let cursor = baseY
    for (const d of defs) {
      lanes.push({ track: d.track, y: cursor, h: d.h, isMain: d.isMain })
      cursor += d.h + cfg.lineDistance
    }
    return { lanes, hasHBar, viewH, stackH }
  }

  function scrollbarGeom(cw: number, worldW: number) {
    // 参考 asconfig initScrollbar：滚动条轨道代表整个 canvas 画布区 [headWidth, cw]
    // （canvas 左缘即轨道头 div 右界；封面前置区属于 canvas，其下方也在滚动条区域内）。
    // 世界跨度自 canvas 左缘算起（含固定前置段），拇指宽 = 视口/世界 严格比例
    const vw = cw - cfg.headWidth
    const ch = host.clientHeight || 204
    const maxOff = Math.max(0, worldW - cw)
    const span = worldW - cfg.headWidth
    // 严格比例在深缩放时每放大一级拇指就腰斩一半，视觉上每次缩放都在"变"。
    // 设 48px 最小宽（业界惯例），位置仍按拇指视觉宽线性映射 s.offX，拖动语义不变
    const SCROLLBAR_MIN_THUMB = 48
    const thumbW = Math.min(vw, Math.max(SCROLLBAR_MIN_THUMB, (vw * vw) / span))
    const thumbX = cfg.headWidth + (vw - thumbW) * (maxOff === 0 ? 0 : s.offX / maxOff)
    return { x: thumbX, y: ch - cfg.scrollbarHeight, w: thumbW, h: cfg.scrollbarHeight, maxOff }
  }

  const draw = () => {
    if (s.destroyed) return
    const cw = host.clientWidth || 1280
    const ch = host.clientHeight || 204
    const stage = app.stage
    stage.sortableChildren = false

    const bg = new PIXI.Graphics()
    bg.rect(0, 0, cw, ch).fill(cfg.backgroundColor)

    const tracks = s.data ?? []
    const tsInfo = getTimeScaleInfo(s.zoom, cfg)
    const fw = tsInfo.frameWidth
    const scale = fw * cfg.fps
    // 拖裁 / 拖动中世界末端按预览终点实时扩展：主轨末片右拉可持续超出当前
    // 轨道 / 标尺边界（边缘自动平移期间由此提供更大的横滚上界）
    const duration = Math.max(
      totalDuration(tracks, cfg),
      s.clipDrag ? dragWorldEndSec(s.clipDrag, scale) : 0
    )
    const worldW = originX + duration * scale + cfg.padX * 2
    // 手势中不做向下夹止：拖出扩展区后再把块拉回，世界上界收缩不应瞬吸视口
    // （上界由边缘平移循环把关；松手后按真实 totalDuration 自然夹回）
    const maxOffX = s.clipDrag ? Math.max(Math.max(0, worldW - cw), s.offX) : Math.max(0, worldW - cw)
    s.offX = clamp(s.offX, 0, maxOffX)
    s.playhead = clamp(s.playhead, 0, Math.max(duration, cfg.defaultDuration))

    // 内存帧向量（替代参考实现的 initFrameVector WASM 调用）
    initFrameVector(fw, worldW)

    // 块体拖拽（跨轨重新投放）期间：泳道 / 磁吸 / 重叠判定都要"当作被拖块已离开原轨"，
    // 用剔除该子项后的临时轨道做布局；worldW / 播放头钳制仍取完整数据避免画面跳动
    const mvDrag = s.clipDrag && s.clipDrag.mode === 'move' && s.clipDrag.moved ? s.clipDrag : null
    const dragItem = mvDrag ? mvDrag.view.item : null
    const drawTracks =
      mvDrag && dragItem
        ? tracks.map(t =>
            t.id === mvDrag.track.id ? { ...t, items: t.items.filter(i => i.id !== dragItem.id) } : t
          )
        : tracks
    const { lanes, hasHBar } = layout(drawTracks, cw, ch, duration)
    // 空态判定（剪映两态）：所有轨道都没有素材 → 全空投放区；
    // 仅主轨空、他轨有素材 → 主轨位亮一档空带 + 小图标
    const allTracksEmpty = drawTracks.every(t => t.items.length === 0)
    const mainTrackObj = drawTracks.find(t => t.layer === 0) ?? null
    const mainTrackEmpty = !mainTrackObj || mainTrackObj.items.length === 0
    // 素材拖入预览解析（供泳道高亮 / 占位块 / 轨道头同步与 drop 提交共用）；
    // 块体拖拽合成 payload + 指针位置复用同一套解析
    const internalRaw =
      mvDrag && dragItem
        ? {
            payload: payloadOfItem(dragItem),
            x: mvDrag.x,
            y: mvDrag.y,
            grabOffX: mvDrag.grabOffX,
            grabRatioY: mvDrag.grabRatioY,
            fromMain: mvDrag.track.layer === 0,
            // 浮块高度与松手稳态完全一致：媒体块＝泳道全高（主轨 70 / 素材音频 50），
            // 装饰块＝泳道高 - 上下内边距（20px 行高 → 16px），拖动时不再隆起
            srcH:
              dragItem.type === 'video' || dragItem.type === 'image' || dragItem.type === 'audio'
                ? laneHOf(mvDrag.track)
                : laneHOf(mvDrag.track) - cfg.clipPadOther
          }
        : null
    s.dndView = s.dndRaw
      ? resolveDnd(lanes, scale, cw, ch, hasHBar)
      : internalRaw
        ? resolveDnd(lanes, scale, cw, ch, hasHBar, internalRaw)
        : null
    s.moveView = internalRaw ? s.dndView : null
    // 同步左侧 DOM 轨道头列（行位置 / 类型图标 / 底部滚动条阴影）
    syncHead(lanes, hasHBar, allTracksEmpty)

    clearLayer(bgLayer)
    clearLayer(rulerLayer)
    clearLayer(laneLayer)
    clearLayer(dndGhostLayer)
    clearLayer(fxLayer)
    clearLayer(coverLayer)

    // 拖入占位遮罩：仅泳道区（标尺线之下、横向滚动条之上）可见，纵向越过顶线半露
    const maskBottom = ch - (hasHBar ? cfg.scrollbarHeight : 0)
    // 泳道 / 素材块播放区遮罩：纵向滚动只移动内容，标尺与横滚条位置恒定
    // 泳道层遮罩：自画布左缘（轨道头右沿）起铺满播放区，纵滚只在播放区高度内
    laneMask.clear().rect(cfg.headWidth, cfg.timelineHeight, cw - cfg.headWidth, maskBottom - cfg.timelineHeight).fill(0xffffff)
    // 素材层遮罩：整个 canvas 播放视口（自画布左缘起；横滚后素材可出现在时间 0 静止位置左侧）
    playMask
      .clear()
      .rect(cfg.headWidth, cfg.timelineHeight, cw - cfg.headWidth, maskBottom - cfg.timelineHeight)
      .fill(0xffffff)
    // 封面层遮罩：整个画布播放区（标尺下沿 ~ 横滚条上沿），封面横滚滑到哪里都可见
    coverMask
      .clear()
      .rect(cfg.headWidth, cfg.timelineHeight, cw - cfg.headWidth, maskBottom - cfg.timelineHeight)
      .fill(0xffffff)
    // 拖入 / 拖动内容在整个画布播放区内可见
    dndGhostMask
      .clear()
      .rect(cfg.headWidth, cfg.timelineHeight, cw - cfg.headWidth, maskBottom - cfg.timelineHeight)
      .fill(0xffffff)

    // 全屏不透明底必须在最底层，否则会遮住泳道与素材块
    bgLayer.addChild(bg)
    // ---- 时间标尺（剪映风格：无底色；顶部留白，亮基准线，刻度 / 文字全部挂在线下方）----
    // 几何：lineY 以上完全留白；主刻度自基准线垂到接近标尺底，中 / 短刻度依次变短
    const lineY = cfg.scaleSpace
    const H_MAJOR = cfg.rulerMajorHeight
    const H_MID = cfg.rulerMidHeight
    const H_MINOR = cfg.rulerMinorHeight
    const majorXs: number[] = []
    const midXs: number[] = []
    const minorXs: number[] = []
    const labels: Array<{ x: number; text: string; frame: boolean }> = []

    // 刻度始终铺满整个可视区，与素材长短无关（剪映行为）：
    // 位置只由帧索引数学计算（round3 与 frameVector 同源），循环范围仅由视口决定
    const stride = tsInfo.minor
    let startCount = Math.max(0, Math.floor((s.offX - originX) / fw))
    const endCount = Math.ceil((s.offX + cw - originX) / fw)
    startCount -= startCount % stride
    const inFrameDomain = tsInfo.frameLabel > 0
    for (let count = startCount; count <= endCount; count += stride) {
      const x = originX + Math.round(count * fw * 1000) / 1000 - s.offX
      if (x < -20 || x > cw + 20) continue
      const isSecond = count % cfg.fps === 0

      if (inFrameDomain) {
        // 帧域：秒界与帧主刻度点（15f / 10f / 2f）同为长主刻度，分别带 MM:SS / "N f"；
        // 其余按中刻度 / 短刻度
        if (isSecond) {
          majorXs.push(x)
          labels.push({ x, text: formatRuler(Math.round(count / cfg.fps)), frame: false })
        } else if (count % tsInfo.frameLabel === 0) {
          majorXs.push(x)
          labels.push({ x, text: `${count % cfg.fps}f`, frame: true })
        } else if (tsInfo.mid > 0 && count % tsInfo.mid === 0) {
          midXs.push(x)
        } else {
          minorXs.push(x)
        }
      } else {
        // 时间域：主刻度周期带 MM:SS；中刻度 / 短刻度无文字（分钟、秒单位随缩放切换）
        if (count % tsInfo.major === 0) {
          majorXs.push(x)
          labels.push({ x, text: formatRuler(Math.round(count / cfg.fps)), frame: false })
        } else if (tsInfo.mid > 0 && count % tsInfo.mid === 0) {
          midXs.push(x)
        } else {
          minorXs.push(x)
        }
      }
    }

    // 仅画刻度（自 lineY 向下生长），不画标尺底部基准横线
    const tickBatch = (xs: number[], len: number, color: number) => {
      if (!xs.length) return
      const g = new PIXI.Graphics()
      for (const x of xs) g.moveTo(x, lineY).lineTo(x, lineY + len)
      g.stroke({ width: 1, color })
      rulerLayer.addChild(g)
    }
    tickBatch(minorXs, H_MINOR, cfg.rulerMinorColor)
    tickBatch(midXs, H_MID, cfg.rulerMidColor)
    tickBatch(majorXs, H_MAJOR, cfg.markerColor)

    // 文字在刻度线下方（锚点 0.5 高度），与刻度同带
    for (const lb of labels) {
      const label = new PIXI.Text({
        text: lb.text,
        style: {
          fontSize: lb.frame ? cfg.frameFontSize : cfg.rulerFontSize,
          fill: lb.frame ? cfg.frameTextColor : cfg.timelineTextColor,
          fontFamily: 'Consolas, monospace'
        }
      })
      label.anchor.set(0, 0.5)
      label.position.set(lb.x + 3, lineY + 9)
      rulerLayer.addChild(label)
    }

    // 泳道背景与行间分隔线：轨道只存在于时间轴世界里——左缘从时间刻度 0 的世界位置
    // （originX-s.offX，与封面按钮 / 素材同一坐标源）起笔，分隔线同口径；横滚把时间 0
    // 推到画布左缘外后起点被物理裁切，泳道自然铺满视口。静止态 headWidth..时间0 的
    // 封面前缀列不铺泳道底色，透全局背景黑，与右侧轨道视觉断开。相邻泳道另留
    // lineDistance 间隙（透全局黑），与 DOM 头列行间间隙同宽，头列/画布两侧同步分隔。
    // 0..headWidth 物理上在画布外（DOM 轨道头列另管）。
    // 主轨空态两口径（剪映）：全空工程 → 整条位渲染虚线投放区 + 胶片图标 + 引导文案；
    // 他轨有素材 → 亮一档空带 + 同款胶片图标（无文案、无顶边分隔线）。
    const laneStartX = originX - s.offX
    lanes.forEach(lane => {
      if (lane.isMain && mainTrackEmpty) {
        const panelCY = lane.y + lane.h / 2
        if (allTracksEmpty) {
          // 全空投放区：极淡白底圆角面板 + 1:3 点线描边（右缘出画布由 laneMask 裁切）
          const panel = new PIXI.Graphics()
          panel
            .roundRect(laneStartX, lane.y, cw - laneStartX, lane.h, EMPTY_DROP_RADIUS)
            .fill({ color: 0xffffff, alpha: EMPTY_DROP_FILL_ALPHA })
          laneLayer.addChild(panel)
          const border = new PIXI.Graphics()
          dashedRoundRectPath(
            border,
            laneStartX,
            lane.y,
            cw - laneStartX,
            lane.h,
            EMPTY_DROP_RADIUS,
            EMPTY_DASH_ON,
            EMPTY_DASH_OFF
          )
          border.stroke({ width: 1, color: 0xffffff, alpha: EMPTY_DROP_LINE_ALPHA })
          laneLayer.addChild(border)
          const ix = laneStartX + EMPTY_ICON_INSET
          laneLayer.addChild(drawFilmIcon(PIXI, ix, panelCY - FILM_ICON_H / 2, EMPTY_DROP_ICON_ALPHA))
          const hint = new PIXI.Text({
            text: t('timeline.empty'),
            style: {
              fontSize: 14,
              fill: EMPTY_DROP_TEXT_COLOR,
              fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif'
            }
          })
          hint.position.set(ix + FILM_ICON_W + EMPTY_ICON_TEXT_GAP, panelCY - hint.height / 2)
          laneLayer.addChild(hint)
        } else {
          // 主轨空（他轨有素材）：亮一档空带，不画顶边分隔线；仅一枚胶片小图标
          const g = new PIXI.Graphics()
          g.rect(laneStartX, lane.y, cw - laneStartX, lane.h).fill(EMPTY_MAIN_LANE_FILL)
          laneLayer.addChild(g)
          laneLayer.addChild(
            drawFilmIcon(
              PIXI,
              laneStartX + EMPTY_ICON_INSET,
              panelCY - FILM_ICON_H / 2,
              EMPTY_LANE_ICON_ALPHA
            )
          )
        }
        return
      }
      const g = new PIXI.Graphics()
      g.rect(laneStartX, lane.y, cw - laneStartX, lane.h).fill(cfg.trackBackgroundColor)
      g.moveTo(laneStartX, lane.y).lineTo(cw, lane.y).stroke({
        width: 1,
        color: cfg.laneDividerColor,
        alpha: 0.6
      })
      laneLayer.addChild(g)
    })

    // 拖入素材：一进入时间轴，所有"类型兼容"的泳道立即整行提亮（与时间是否重叠无关，
    // 重叠只决定松手时新建轨道），类型不兼容的泳道压暗；行底与泳道同口径自时间 0 起，
    // 0..headWidth 由 DOM 轨道头同步高亮
    const dv = s.dndView
    if (dv) {
      const dimm = new PIXI.Graphics()
      const hl = new PIXI.Graphics()
      const placeSet = new Set(dv.placeIds)
      for (const lane of lanes) {
        const can =
          (lane.track !== null && placeSet.has(lane.track.id)) ||
          (lane.track === null && lane.isMain && dv.mainPlaceable)
        if (can) {
          hl.rect(laneStartX, lane.y, cw - laneStartX, lane.h).fill({ color: DND_LANE_HL, alpha: DND_LANE_HL_ALPHA })
        } else {
          dimm.rect(laneStartX, lane.y, cw - laneStartX, lane.h).fill({ color: DND_LANE_DIM, alpha: DND_LANE_DIM_ALPHA })
        }
      }
      // 空白区不画任何轨道背景：只保留占位块自身自泳道顶边渐进显露
      laneLayer.addChild(dimm)
      laneLayer.addChild(hl)
    }

    // ---------- 素材块（按 lane 顺序，后面的块优先命中） ----------
    // 横滚拖拽中本帧是否允许缩略格窗口增删 / 抽帧（200ms 节流，见 mediaCellsGate）
    const runMediaCells = mediaCellsGate(s.offX)
    // 视图按素材 id 复用（与轨道无关）：被拖块已从布局数据剔除，单独按 item.id 保住
    // 其视图（不销毁），稍后按投放几何渲染；跨轨松手后同 id 视图继续被新泳道复用
    const keepKeys = new Set<string>()
    if (mvDrag && dragItem) keepKeys.add(dragItem.id)
    for (const lane of lanes) {
      if (!lane.track) continue
      const isMain = lane.isMain
      for (const item of lane.track.items) {
        if (item.visible === false) continue
        const key = item.id
        keepKeys.add(key)
        let cv = views.get(key)
        if (!cv) {
          cv = new ClipView(
            PIXI,
            lane.track.id,
            item,
            store,
            waveform,
            () => {
              if (!s.destroyed) scheduleDraw()
            },
            cfg
          )
          // 视频内嵌音轨探测结果转抛外层（决定右侧面板音量控制组显隐）
          cv.onAudioProbed = has => callbacks.onClipAudioProbed?.(item.id, has)
          views.set(key, cv)
        }
        // 上一帧可能正处于块体拖拽（挂在置顶 dragLayer）；常规布局时统一挂回 clipsLayer
        if (cv.view.parent !== clipsLayer) clipsLayer.addChild(cv.view)
        if (cv.view.mask === dragClipMask) cv.view.mask = null
        const rawStart = cv.temp ? cv.start : item.start
        // 主轨磁吸拖裁（被拖块自身有 temp 不受影响，其他轨道完全不动）：
        //  · trimR：编辑点之后的子项预览即平移 delta（夹 0）；
        //  · trimL：编辑点之前的子项整组跟随把手临时平移 prev（不夹 0、
        //    可越过坐标轴），编辑点后预览不动；松手即复位。
        // 媒体格 / 波形源锚定，仅 gx 变化故零重建
        let visStart = rawStart
        const ts = s.trimShift
        if (ts && !cv.temp && isMain) {
          if (ts.prev !== null) {
            if (rawStart < ts.point - 0.5 / cfg.fps) visStart = rawStart + ts.prev
          } else if (rawStart >= ts.point - 0.5 / cfg.fps) {
            visStart = Math.max(0, rawStart + ts.delta)
          }
        }
        const x = timeToX(visStart, scale)
        const w = Math.max(3, (cv.temp ? cv.duration : item.duration) * scale)
        // 媒体轨（主轨 70 / 视频 / 图片轨 50）与音频块满高铺满行高，装饰类轨上下留内边距；
        // 注意：跨轨新建的视频轨 type 也是 'video'，必须与 image 轨同口径，否则块只画 44 高
        const isMediaLane =
          isMain || lane.track.type === 'video' || lane.track.type === 'image' || lane.track.type === 'audio'
        const geom = clipGeomFor(x, w, lane.y, lane.h, isMediaLane, item)
        cv.noteViewport(cw)
        cv.layout(item, lane.track.id, geom)
        cv.setSelected(s.selection?.trackId === lane.track.id && s.selection?.itemId === item.id)
        // 隐藏轨道：半透明展示（参考 toggleShow 的容器 alpha）
        cv.view.alpha = lane.track.hidden ? cfg.hiddenTrackAlpha : 1
        cv.updateMedia({ cw, scale, zoom: s.zoom }, runMediaCells)
      }
    }
    // 移除已不存在的块视图（拖拽结束后 view 可能在 dragLayer，按实际 parent 摘除）
    for (const [key, cv] of views) {
      if (!keepKeys.has(key)) {
        cv.view.parent?.removeChild(cv.view)
        cv.destroy()
        views.delete(key)
      }
    }

    // 块体拖拽：真实 ClipView（含已解析画面帧 / 波形）跟随指针按投放几何渲染，
    // 代替素材库拖入时的青色占位块；纵向越出泳道区顶线部分由 dragClipMask 裁为半露
    if (mvDrag && dragItem && s.moveView?.valid) {
      const mvdv = s.moveView
      const cv = views.get(dragItem.id)
      if (cv) {
        // temp 先于 layout：时长码 / updateMedia 的帧窗口都读 temp
        cv.temp = {
          start: mvdv.start,
          duration: dragItem.duration,
          sourceStart: dragItem.sourceStart ?? 0
        }
        // 几何与松手稳态完全同口径：视频 / 图片(含 GIF) / 音频在任何可接收轨道
        // （主轨 / 既有媒体轨 / 新建轨预览）一律满高媒体几何（含视频底 15 波形带）；
        // 只有装饰类（贴纸 / 文字 / 字幕…）收 clipPadOther 内边距。
        const isMediaPayload =
          dragItem.type === 'video' || dragItem.type === 'image' || dragItem.type === 'audio'
        const geom = clipGeomFor(
          mvdv.gx,
          mvdv.gw,
          isMediaPayload ? mvdv.gy : mvdv.gy - cfg.clipPadOther / 2,
          isMediaPayload ? mvdv.clipH : mvdv.clipH + cfg.clipPadOther,
          isMediaPayload,
          dragItem
        )
        cv.noteViewport(cw)
        cv.layout(dragItem, mvDrag.track.id, geom)
        cv.setSelected(true)
        cv.view.alpha = 1
        cv.updateMedia({ cw, scale, zoom: s.zoom }, runMediaCells)
        // 挂到置顶层：拖动块完整压在灰槽 / 泳道 / 其他所有块之上
        dragLayer.addChild(cv.view)
        dragClipMask
          .clear()
          .rect(cfg.headWidth, cfg.timelineHeight, cw - cfg.headWidth, maskBottom - cfg.timelineHeight)
          .fill(0xffffff)
        cv.view.mask = dragClipMask
      }
    }

    // 素材拖入预览：过半锁定的灰色底槽 → 浮动青色占位块 + 名称 →
    // 自动磁吸绿色竖线（仅在开启磁吸且开头/结尾对齐时出现，无块首常驻定位线）。
    // 块体拖拽时真实 ClipView 已充当浮块，只保留灰槽与磁吸绿线。
    if (dv?.valid) {
      const playBottomDnd = ch - (hasHBar ? cfg.scrollbarHeight : 0)
      const internalDrag = !!mvDrag

      // 既有轨且纵向压入过半：槽位锁定，目标行内铺灰色底槽。
      // 主轨磁吸 + 新片段进入主轨时，底槽不跟鼠标——固定画在队尾落点 slotGx
      // （浮块本身仍随指针移动，提示"松手将追加到最后"）；其余情形槽位即 gx。
      // （槽 / 占位块 / 名称都挂 dndGhostLayer，越出泳道区顶线的部分被遮罩裁掉）
      if (dv.locked && (dv.trackId || dv.targetMain)) {
        const slot = new PIXI.Graphics()
        slot.roundRect(dv.slotGx ?? dv.gx, dv.bandY, dv.gw, dv.bandH, cfg.clipRadius).fill(DND_SLOT_COLOR)
        dndGhostLayer.addChild(slot)
      }

      if (!internalDrag) {
        // 浮动青色占位块（媒体 0x004D52 / 音频 0x103C5C，与正式块同色）
        const ghost = new PIXI.Graphics()
        ghost
          .roundRect(dv.gx, dv.gy, dv.gw, dv.gh, cfg.clipRadius)
          .fill({ color: dv.isAudio ? cfg.trackBaseColors.audio : cfg.trackBaseColors.video, alpha: 0.95 })
        dndGhostLayer.addChild(ghost)
        if (dv.gw >= 40) {
          const label = new PIXI.Text({
            text: dv.name,
            style: { fontSize: cfg.clipFontSize, fill: cfg.clipLabelColor, fontFamily: 'sans-serif' }
          })
          label.anchor.set(0, 0)
          label.position.set(dv.gx + 8, dv.gy + 3)
          dndGhostLayer.addChild(label)
        }
      }

      // 自动磁吸绿线：每个命中的边一条，贯穿标尺下沿至泳道底部（可开头/结尾同时出现）
      for (const t of dv.snapLines) {
        const sx = Math.round(timeToX(t, scale)) + 0.5
        const snapLine = new PIXI.Graphics()
        snapLine
          .moveTo(sx, cfg.scaleSpace + 2)
          .lineTo(sx, playBottomDnd)
          .stroke({ width: 1.5, color: DND_SNAP_COLOR, alpha: 0.95 })
        fxLayer.addChild(snapLine)
      }
    }

    // 封面按钮（pixi）：40×40 圆角方块（剪映式：极淡白底 + 白色虚线描边），
    // 横向锚定世界时间 0 左侧 5px（s.offX=0 时位于前缀段居中），
    // 与素材 / 刻度一起横滚、由画布左缘裁切；纵向跟随主轨泳道。
    // 未设封面为面板 + 笔图标 +「封面」文字，已设封面为圆角缩略图（铺满 40×40）
    // 缩略图右上角常驻半透明圆形 × 角标，点击直接移除封面（悬停提亮）
    // 全空工程不展示封面按钮（剪映：封面随主轨内容出现；投放区态前缀列保持纯黑）
    const coverLane = !allTracksEmpty ? lanes.find(l => l.isMain) ?? null : null
    if (coverLane) {
      const size = COVER_BTN_SIZE
      const bx = originX - s.offX - size - 5
      const by = coverLane.y + (coverLane.h - size) / 2
      s.coverRect = { x: bx, y: by }
      const cover = new PIXI.Container()
      if (s.coverTexture) {
        const sp = new PIXI.Sprite(s.coverTexture)
        sp.width = size
        sp.height = size
        sp.position.set(bx, by)
        sp.alpha = s.coverPressed ? 0.7 : 1
        // 与未设态同一圆角形状裁切缩略图
        const spMask = new PIXI.Graphics()
        spMask.roundRect(bx, by, size, size, COVER_BTN_RADIUS).fill(0xffffff)
        cover.addChild(spMask)
        cover.addChild(sp)
        sp.mask = spMask
        // 右上角 × 移除角标：黑底圆（悬停 / 按压加深）+ 白色叉（round 线帽）
        const ccx = bx + size - 7
        const ccy = by + 7
        const badge = new PIXI.Graphics()
        badge
          .circle(ccx, ccy, COVER_CLOSE_R)
          .fill({ color: 0x000000, alpha: s.coverCloseHover ? 0.78 : 0.5 })
        const cd = 3
        badge
          .moveTo(ccx - cd, ccy - cd)
          .lineTo(ccx + cd, ccy + cd)
          .moveTo(ccx + cd, ccy - cd)
          .lineTo(ccx - cd, ccy + cd)
          .stroke({ width: 1.2, color: 0xffffff, alpha: 0.92, cap: 'round' })
        cover.addChild(badge)
      } else {
        // 面板：淡白填充 + 虚线描边（悬停 / 按压提亮）；
        // 填充与虚线分两个 Graphics，避免 pixi v8 路径累积导致 stroke 连圆角矩形一起描边
        const fillAlpha = s.coverHover || s.coverPressed ? 0.1 : 0.06
        const lineAlpha = s.coverPressed ? 0.5 : s.coverHover ? 0.7 : 0.32
        const panel = new PIXI.Graphics()
        panel.roundRect(bx, by, size, size, COVER_BTN_RADIUS).fill({ color: 0xffffff, alpha: fillAlpha })
        cover.addChild(panel)
        const border = new PIXI.Graphics()
        dashedRoundRectPath(border, bx, by, size, size, COVER_BTN_RADIUS, COVER_DASH_ON, COVER_DASH_OFF)
        border.stroke({ width: 1, color: 0xffffff, alpha: lineAlpha })
        cover.addChild(border)
        // pixi 的 svg() 按 SVG 表现属性着色：path 无 fill 属性时默认黑，
        // 必须把当前色（悬停 / 常态）写进标记（后续 .fill() 不会回填 svg 几何）
        const tone = s.coverHover || s.coverPressed ? 0xffffff : 0xc2c2cc
        const toneHex = '#' + tone.toString(16).padStart(6, '0')
        const alpha = s.coverPressed ? 0.6 : s.coverHover ? 1 : 0.9
        const icon = new PIXI.Graphics()
        icon.svg(coverEditIconSvg(toneHex))
        icon.scale.set(COVER_ICON_SIZE / 1024)
        icon.position.set(bx + (size - COVER_ICON_SIZE) / 2, by + 4)
        icon.alpha = alpha
        cover.addChild(icon)
        const label = new PIXI.Text({
          text: t('timeline.cover'),
          style: { fontSize: 11, fill: tone, fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' }
        })
        label.anchor.set(0.5, 0)
        label.position.set(bx + size / 2, by + 23)
        label.alpha = alpha
        cover.addChild(label)
      }
      coverLayer.addChild(cover)
    } else {
      s.coverRect = null
    }

    // 片段移动 / 拖裁磁吸参考线（青蓝 0x18b9d4 细线，自基准线稍下起贯穿标尺刻度区与全部泳道；
    // 预览轴金黄线另用 cfg.snapGuideColor，不受影响）。
    // +0.5 像素对齐与块体移动磁吸线（resolveDnd）保持一致，避免 1.5px 细线被两列分摊发虚。
    if (s.snapGuide !== null) {
      const gx = Math.round(timeToX(s.snapGuide, scale)) + 0.5
      const line = new PIXI.Graphics()
      line
        .moveTo(gx, cfg.scaleSpace + 2)
        .lineTo(gx, ch - (hasHBar ? cfg.scrollbarHeight : 0))
        .stroke({ width: 1.5, color: DND_SNAP_COLOR, alpha: 0.95 })
      fxLayer.addChild(line)
    }

    // 预览轴（剪映：开启后一根金黄竖线跟随鼠标，自标尺顶部贯穿全部泳道；
    // 按住拖动播放头 / 素材 / 滚动条期间不显示）。x 取整 +0.5 像素对齐，
    // 避免整数坐标上 1px 细线被两列半透明分摊而发虚。
    if (s.previewAxis && s.previewX !== null && !s.seeking && !s.clipDrag && !s.sbDragging) {
      const lx = Math.round(s.previewX) + 0.5
      const pxLine = new PIXI.Graphics()
      // 「靠后一帧」灰色矩形：左缘贴黄线，宽=当前缩放下一帧的物理宽度，
      // 整体坐落在标尺带内（顶 y=scaleSpace+previewFrameOffsetY、高 previewFrameHeight）；
      // 先画矩形再画线压住左缘
      pxLine
        .rect(lx, cfg.scaleSpace + cfg.previewFrameOffsetY, scale / cfg.fps, cfg.previewFrameHeight)
        .fill({ color: cfg.previewFrameColor, alpha: cfg.previewFrameAlpha })
      pxLine
        .moveTo(lx, 2)
        .lineTo(lx, ch - (hasHBar ? cfg.scrollbarHeight : 0))
        .stroke({ width: 1, color: cfg.snapGuideColor, alpha: 0.9 })
      fxLayer.addChild(pxLine)
    }

    // 时间线标记（剪映 marker）：标记属于时间标尺的一部分——7×11px 青色实心五边形「小盾牌」
    // （上平下尖、直角肩），坐在标尺带下沿内侧，坐标锚定世界时间随横滚移动。
    // 只画视口内（x ≥ headWidth）的标记；挂在预览轴之后 / 播放头之前，保证盾牌不被灰矩形盖住。
    {
      const top = cfg.timelineHeight - MARKER_BOTTOM_PAD - MARKER_H
      const shoulderY = top + MARKER_BODY_H
      const tipY = cfg.timelineHeight - MARKER_BOTTOM_PAD
      for (const t of s.markers) {
        const mxr = timeToX(t, scale)
        if (mxr < cfg.headWidth - MARKER_HALF_W - 2 || mxr > cw + MARKER_HALF_W + 2) continue
        // 奇数宽中心对齐到半像素（整数+0.5），左右缘落在整数列，填充正好 7 列不发虚；
        // 必须与播放头竖线同一对齐规则（round+0.5），保证标记帧上竖线严格穿过盾牌中心
        const x = Math.round(mxr) + 0.5
        const g = new PIXI.Graphics()
        const r = MARKER_CORNER_R
        g.moveTo(x - MARKER_HALF_W + r, top)
          .lineTo(x + MARKER_HALF_W - r, top)
          .quadraticCurveTo(x + MARKER_HALF_W, top, x + MARKER_HALF_W, top + r)
          .lineTo(x + MARKER_HALF_W, shoulderY)
          .lineTo(x, tipY)
          .lineTo(x - MARKER_HALF_W, shoulderY)
          .lineTo(x - MARKER_HALF_W, top + r)
          .quadraticCurveTo(x - MARKER_HALF_W, top, x - MARKER_HALF_W + r, top)
          .closePath()
          .fill(s.hoverMarker === t ? MARKER_HOVER_COLOR : cfg.accentColor)
        fxLayer.addChild(g)
      }
    }

    // 播放头（剪映样式：直筒 + 下方半圆手柄；未按住=深色填充白描边，按住拖动=白色实心）
    // 绘制中心统一对齐半像素（round+0.5）：1px 竖线锐利且与标记盾牌严格同轴
    const hx = Math.round(timeToX(s.playhead, scale)) + 0.5
    const playBottom = ch - (hasHBar ? cfg.scrollbarHeight : 0)
    const head = new PIXI.Graphics()
    const headTop = cfg.scaleSpace
    const hw = cfg.playheadHandleWidth / 2
    const rectH = cfg.playheadHandleHeight
    const tr = Math.min(cfg.playheadHandleRadius, hw)
    const headActive = s.grabbedPlayhead
    // 路径：顶部圆角直筒 → 右下 → 下方半圆（两段三次贝塞尔逼近，半径=hw）→ 左下 → 左上圆角闭合。
    // 不用 arc()：pixi 中 0→PI 的半圆弧终点方向与 canvas 约定不一致，会只剩右窄条。
    const arcK = hw * 0.5523
    head
      .moveTo(hx - hw + tr, headTop)
      .lineTo(hx + hw - tr, headTop)
      .quadraticCurveTo(hx + hw, headTop, hx + hw, headTop + tr)
      .lineTo(hx + hw, headTop + rectH)
      .bezierCurveTo(hx + hw, headTop + rectH + arcK, hx + arcK, headTop + rectH + hw, hx, headTop + rectH + hw)
      .bezierCurveTo(hx - arcK, headTop + rectH + hw, hx - hw, headTop + rectH + arcK, hx - hw, headTop + rectH)
      .lineTo(hx - hw, headTop + tr)
      .quadraticCurveTo(hx - hw, headTop, hx - hw + tr, headTop)
      .closePath()
      .fill(headActive ? cfg.playheadActiveFill : cfg.playheadHandleFill)
    if (!headActive) {
      head.stroke({ width: 1.5, color: cfg.timeIndicatorColor, alpha: 0.95 })
    }
    // 竖线自半圆底部起；按住拖动时加亮整条白线
    head
      .moveTo(hx, headTop + rectH + hw)
      .lineTo(hx, playBottom)
      .stroke({ width: 1, color: cfg.timeIndicatorColor, alpha: headActive ? 0.9 : cfg.playheadStemAlpha })
    // 素材选中预览：播放头整体淡化到 0.3，示意当前不在时间线编辑态
    head.alpha = s.playheadDimmed ? 0.3 : 1
    fxLayer.addChild(head)

    // 横向滚动条（参考 initScrollbar：不透明画布底色轨道 + 8px 胶囊拇指）
    if (hasHBar) {
      const sb = new PIXI.Graphics()
      // 轨道铺满整个 canvas 底部（canvas 自 headWidth 起，封面前置区下方也属滚动条区域）
      sb.rect(cfg.headWidth, ch - cfg.scrollbarHeight, cw - cfg.headWidth, cfg.scrollbarHeight).fill(
        cfg.backgroundColor
      )
      const geom = scrollbarGeom(cw, worldW)
      // 拖动时恢复默认色（与参考 pointerdown→scrollDefaultBackground 一致）
      const thumbColor = s.sbHover && !s.sbDragging ? cfg.scrollbarHoverColor : cfg.scrollbarColor
      sb.roundRect(geom.x, geom.y, geom.w, geom.h, 4).fill(thumbColor)
      fxLayer.addChild(sb)
    }

    app.renderer.render(stage)
  }

  /* ---- 高频移动（dragover / pointermove / wheel）合帧重绘 ----
     draw() 为全量重建（标尺文字 / 泳道 / 素材块几何 / 播放头），单次毫秒级。
     鼠标报点（125Hz+）若每个事件同步 draw，会阻塞事件队列导致拖拽明显滞后；
     统一合并到 requestAnimationFrame，一帧至多重绘一次。终态用 flushDraw 立即出画。 */
  function scheduleDraw() {
    if (s.destroyed || s.drawRaf) return
    s.drawRaf = requestAnimationFrame(() => {
      s.drawRaf = 0
      if (!s.destroyed) draw()
    })
  }
  function flushDraw() {
    if (s.drawRaf) {
      cancelAnimationFrame(s.drawRaf)
      s.drawRaf = 0
    }
    if (!s.destroyed) draw()
  }

  /* ---- 横滚时节流缩略格窗口（参考 scrollMainTrackMidea → throttledInit 200ms）----
     滚动条拖拽 / 滚轮 / 平移都会改 s.offX 并每帧 draw；已有缩略格每帧重定位紧随
     世界移动（ClipView 内始终执行），但"销毁离屏格 + 抽新格"只在 200ms 窗口点
     执行一次，避免快速拖动时把沿途整条视频的帧全部抽一遍。停止滚动 200ms 后
     再 trailing 补一次，把最终窗口补齐。 */
  /** draw 内调用：返回本帧是否允许做缩略格窗口增删 / 抽帧 */
  function mediaCellsGate(offXNow: number) {
    const now = performance.now()
    const scrolled = Number.isFinite(s.lastMediaOffX) && offXNow !== s.lastMediaOffX
    let run: boolean
    if (scrolled) {
      run = now - s.lastMediaCellRun >= MEDIA_CELL_THROTTLE_MS
      if (run) s.lastMediaCellRun = now
      if (s.mediaTrailTimer) clearTimeout(s.mediaTrailTimer)
      s.mediaTrailTimer = setTimeout(() => {
        s.mediaTrailTimer = null
        if (!s.destroyed) scheduleDraw()
      }, MEDIA_CELL_THROTTLE_MS)
    } else {
      // 静止 / 缩放 / 数据变化引起的 draw：窗口始终刷新（内部 diff，无变化零请求）
      run = true
    }
    s.lastMediaOffX = offXNow
    return run
  }

  /* ---- 预览轴悬停画面上抛节流（leading + trailing，语义同 mediaCellsGate）----
     黄线 / 灰矩形走 scheduleDraw 逐帧即时；只有"画面预览上抛播放器"走此门：
     快速划过时最多 200ms 解码一帧，停下 200ms 后补鼠标最终停留帧。
     null（离开画布 / 关闭预览轴 / 起播 / seek 提交）立即上抛并撤销 trailing。 */
  function cancelPreviewTrail() {
    if (s.previewTrailTimer) {
      clearTimeout(s.previewTrailTimer)
      s.previewTrailTimer = null
    }
    s.pendingPreviewT = null
  }
  function emitPreview(t: number | null) {
    if (t === null) {
      cancelPreviewTrail()
      s.lastPreviewEmit = 0
      callbacks.onPreview?.(null)
      return
    }
    s.pendingPreviewT = t
    const now = performance.now()
    if (now - s.lastPreviewEmit >= PREVIEW_THROTTLE_MS) {
      s.lastPreviewEmit = now
      callbacks.onPreview?.(t)
    }
    if (s.previewTrailTimer) clearTimeout(s.previewTrailTimer)
    s.previewTrailTimer = setTimeout(() => {
      s.previewTrailTimer = null
      const pt = s.pendingPreviewT
      s.pendingPreviewT = null
      // 定时器期间预览可能已失效（起播 / 关闭 / 离开 / 销毁 / seek 撤销）
      if (pt === null || s.destroyed || s.playing || !s.previewAxis || s.previewX === null) return
      s.lastPreviewEmit = performance.now()
      callbacks.onPreview?.(pt)
    }, PREVIEW_THROTTLE_MS)
  }

  return { layout, scrollbarGeom, draw, scheduleDraw, flushDraw, emitPreview, cancelPreviewTrail }
}
