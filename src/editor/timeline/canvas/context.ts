/* ============================================================
 *  时间轴画布 · 共享上下文与状态盒
 *
 *  工厂 createTimelineTrack 拆成「工具栏 / 左侧按钮栏 / 右侧画布栏」三块后，
 *  画布栏内部再分 add（添加）/ drag（拖动）/ trim（左右拉取）/ render（渲染）
 *  / interactions（指针路由）/ ops（分割删除等）等模块。模块之间不共享闭包，
 *  统一经 TimelineCtx 读常量 / 服务、经 TimelineState（s）读写可变状态：
 *    - 渲染只「读」s（s.clipDrag / s.dndView / view.temp 等）
 *    - 交互模块「写」s，避免模块间互相引用形成循环依赖
 * ============================================================ */
import type { TrackObject } from '../../types'
import type { AnyAddTrackPayload } from '../../materials/materialsPanel'
import type { TimelineSelection, TimelineCallbacks, ClipGeom } from '../core/types'
import type { TimelineConfig } from '../core/config'
import type { MediaStore } from '../../codec/timelineMedia'
import type { WaveformRenderer } from './waveformRenderer'
import type { ClipView } from './clipView'
import type { GeometryApi } from './geometry'

/** 素材库 / 块体拖入时的原始指针信息（draw 内 resolveDnd 读它算出落点预览） */
export interface DndRaw {
  payload: AnyAddTrackPayload
  x: number
  y: number
  /** 块体拖拽：按下点相对块左缘的横向像素（缺省 0＝指针即块左缘，素材库拖入语义） */
  grabOffX?: number
  /** 块体拖拽：按下点相对块顶的纵向比例 0..1（缺省 0.5＝指针即块中心） */
  grabRatioY?: number
  /**
   * 块体拖拽：被拖块是否来自主轨（layer0）。主轨磁吸开启时，
   * 主轨内部重排仍走「就近贴边」；从外部（素材库 / 其他轨）进入主轨一律追加到末尾。
   * 素材库 HTML5 拖入无此字段，语义等同「新进入主轨」。
   */
  fromMain?: boolean
  /**
   * 块体拖拽：来源泳道高度（主轨 70 / 素材媒体轨 50 / 装饰轨 25）。
   * 拖动态浮块全程保持该高度——鼠标在主轨与素材轨之间上下切换时浮块不伸缩，
   * 目标行只以灰色底槽（带高＝目标轨高度）预告落点，松手提交后才变为目标轨高度。
   */
  srcH?: number
}

/** 拖放落点解析结果（每帧随指针重算，松手取终态提交） */
export interface DndView {
  /** 当前位置是否可放置：进入时间轴后恒可（落既有轨或新建轨） */
  valid: boolean
  /** 占位块与命中行纵向重叠是否过半（锁定槽位：该行显示灰色底槽） */
  locked: boolean
  /** 锁定的目标既有轨 id；null＝未落入任何既有轨（空白 / 重叠 / 不兼容 → 新建轨） */
  trackId: string | null
  /** 目标是否为空主轨（媒体落此＝进入 layer0 主轨） */
  targetMain: boolean
  /** 松手时新建一条同类型轨道（空白区，或与命中轨子项时间重叠 / 类型不兼容） */
  createNew: boolean
  /** 类型兼容、进入时间轴即常亮的既有轨 id（与该时刻是否有子项重叠无关） */
  placeIds: string[]
  /** 空主轨此刻是否可放（媒体素材恒可）：轨道头高亮条常亮 */
  mainPlaceable: boolean
  /** 帧吸附后的放置起始秒 */
  start: number
  /** 自动磁吸命中的边（时间秒，开头/结尾可同时存在）；仅磁吸开启时非空 */
  snapLines: number[]
  /** 青色占位块几何（随光标浮动，出界部分由渲染面 / 头列自然裁切为"半个"） */
  gx: number
  gy: number
  gw: number
  gh: number
  /**
   * 主轨磁吸：新片段进入主轨时，松手后将追加到的「队尾落点」画布 x。
   * 非空时拖动态在该位置画灰色占位槽（浮块本身仍跟随鼠标，不跳位）；
   * null＝无队尾预览（主轨外，或主轨内部重排走就近贴边、槽位即 gx）。
   */
  slotGx: number | null
  /**
   * 块体拖拽时真实浮块的高度，全程恒定＝来源泳道行高（raw.srcH：
   * 主轨 70 / 素材媒体轨 50 / 装饰轨 25）；素材库拖入时 clipH＝gh＝按类型
   * 的新建行高。浮块不随鼠标切到主轨 / 素材轨而变高；与目标行带高 bandH 的
   * 差值即松手后的伸缩量，由灰色底槽提前预告。
   */
  clipH: number
  /** 命中行几何（整行高亮 / 灰底槽位，高度随目标轨：主轨 70 / 素材轨 50）；未命中行时为浮动新建轨几何 */
  bandY: number
  bandH: number
  isAudio: boolean
  guideX: number
  name: string
}

/** 素材块拖裁 / 整块拖动 / 音频参数（音量 / 淡入淡出）拖拽的手势状态 */
export interface ClipDrag {
  mode: 'move' | 'trimL' | 'trimR' | 'vol' | 'fadeIn' | 'fadeOut'
  view: ClipView
  origStart: number
  origDur: number
  origSs: number
  /** 音频手势按下时的音量 / 淡变初值（按相对位移增量更新） */
  origVol?: number
  origFade?: number
  /** 音频手势是否已发过首个 live（首次需外层拍撤销快照） */
  audioFirst?: boolean
  /** 按下时的世界逻辑坐标（originX+t*scale 系），拖裁位移一律相对它计算；
   *  与屏幕坐标解耦后，边缘自动平移改变 offX 时虚拟指针仍可继续推进时间 */
  wx0: number
  /** 虚拟指针世界逻辑坐标：真实 move 取 p.x+offX；边缘平移时随 offX 自增，
   *  屏幕位置保持不动而所指时间持续前进（剪映 / asconfig 边缘滚动语义） */
  liveX: number
  liveY: number
  /** 最近一次真实指针事件的 clientX / clientY（平移帧复用，hint 定位不跳） */
  cx: number
  cy: number
  /** 最近指针位置（move 模式块体重新投放时，draw 内 resolveDnd 读它） */
  x: number
  y: number
  /** move 模式：按下点相对块左缘的横向像素（拖动时块不跳，指针停在抓取处） */
  grabOffX: number
  /** move 模式：按下点相对块顶的纵向比例 0..1 */
  grabRatioY: number
  track: TrackObject
  moved: boolean
  /**
   * 主轨磁吸开启且作用于主轨（layer 0）时的拖裁（asconfig addMainTrackItem 口径）：
   * trimR＝尾部波纹；trimL 预览时自身左缘跟手（右缘钉）＋编辑点前子项整组跟随
   * 把手临时位移（可越轴），松手后自身起点复原、增量落右缘、编辑点后子项波纹、
   * 前片复位且数据不变。关闭时退化为普通轨口径：仅同轨邻居边界硬钳制、不联动。
   */
  ripple: boolean
}

/**
 * 画布全部可变状态：原 TimelineTrack 工厂内的所有 `let` 绑定。
 * 跨模块经 s 读写；持久对象（图层 / views Map / DOM）在 TimelineCtx 上。
 */
export interface TimelineState {
  // —— 生命周期 / 数据 ——
  destroyed: boolean
  data: TrackObject[] | null
  // —— 视口：缩放等级 / 横纵滚动偏移 ——
  zoom: number
  offX: number
  offY: number
  // —— 磁吸 / 播放头 / 选中 ——
  snap: boolean
  mainSnap: boolean
  playhead: number
  /** 播放头临时变淡（素材选中预览时 0.3 透明度） */
  playheadDimmed: boolean
  selection: TimelineSelection | null
  snapGuide: number | null
  // —— 预览轴 / 播放态 ——
  previewAxis: boolean
  playing: boolean
  previewX: number | null
  // —— 标记 ——
  markers: number[]
  hoverMarker: number | null
  // —— HTML5 拖放（添加）/ 块体移动落点预览 ——
  dndRaw: DndRaw | null
  dndView: DndView | null
  moveView: DndView | null
  dndDepth: number
  // —— 拖裁 / 拖动手势 ——
  clipDrag: ClipDrag | null
  /**
   * 主轨磁吸拖裁预览位移（仅主轴 layer0）：
   *  - trimR（prev=null）：编辑点之后子项按位置平移 delta；
   *  - trimL（prev≠null）：编辑点之前子项整组临时平移 prev（不夹 0、可越轴，
   *    纯视觉松手复位），编辑点后子项预览不动；delta 仅供松手提交波纹。
   */
  trimShift: { point: number; delta: number; prev: number | null } | null
  /** 边缘自动横滚 rAF */
  panRaf: number
  panLastT: number
  // —— 横向滚动条交互 ——
  sbHover: boolean
  sbDragging: boolean
  dragStartX: number
  dragStartOff: number
  // —— 播放头 / 标尺定位 ——
  seeking: boolean
  grabbedPlayhead: boolean
  // —— 封面按钮 ——
  coverTexture: import('pixi.js').Texture | null
  coverRect: { x: number; y: number } | null
  coverHover: boolean
  coverPressed: boolean
  coverCloseHover: boolean
  coverPressedClose: boolean
  coverLoadToken: number
  // —— 合帧重绘 / 节流 ——
  drawRaf: number
  lastMediaCellRun: number
  lastMediaOffX: number
  mediaTrailTimer: ReturnType<typeof setTimeout> | null
  previewTrailTimer: ReturnType<typeof setTimeout> | null
  lastPreviewEmit: number
  pendingPreviewT: number | null
}

export function createTimelineState(initial: TrackObject[] | null, levelDefault: number): TimelineState {
  return {
    destroyed: false,
    data: initial,
    zoom: levelDefault,
    offX: 0,
    offY: 0,
    snap: true,
    mainSnap: true,
    playhead: 0,
    playheadDimmed: false,
    selection: null,
    snapGuide: null,
    previewAxis: true,
    playing: false,
    previewX: null,
    markers: [],
    hoverMarker: null,
    dndRaw: null,
    dndView: null,
    moveView: null,
    dndDepth: 0,
    clipDrag: null,
    trimShift: null,
    panRaf: 0,
    panLastT: 0,
    sbHover: false,
    sbDragging: false,
    dragStartX: 0,
    dragStartOff: 0,
    seeking: false,
    grabbedPlayhead: false,
    coverTexture: null,
    coverRect: null,
    coverHover: false,
    coverPressed: false,
    coverCloseHover: false,
    coverPressedClose: false,
    coverLoadToken: 0,
    drawRaf: 0,
    lastMediaCellRun: 0,
    lastMediaOffX: Number.NaN,
    mediaTrailTimer: null,
    previewTrailTimer: null,
    lastPreviewEmit: 0,
    pendingPreviewT: null
  }
}

/** 持久化 pixi 图层（自下而上）与遮罩 */
export interface LayerSet {
  bgLayer: import('pixi.js').Container
  laneLayer: import('pixi.js').Container
  rulerLayer: import('pixi.js').Container
  clipsLayer: import('pixi.js').Container
  laneMask: import('pixi.js').Graphics
  playMask: import('pixi.js').Graphics
  dndGhostLayer: import('pixi.js').Container
  dndGhostMask: import('pixi.js').Graphics
  /** 块体拖拽时真实 ClipView 的遮罩（越出泳道区顶线半露），仅拖拽期间挂上 */
  dragClipMask: import('pixi.js').Graphics
  dragLayer: import('pixi.js').Container
  fxLayer: import('pixi.js').Container
  coverLayer: import('pixi.js').Container
  coverMask: import('pixi.js').Graphics
}

/** 左侧轨道头列 DOM 元素集合 */
export interface HeadEls {
  root: HTMLDivElement
  sb: HTMLDivElement
  rows: HTMLDivElement
  /** 空主轨拖放时的轨道头浮动高亮条 */
  drag: HTMLDivElement
}

/**
 * 画布共享上下文：构造期常量 / 服务（不可变引用）+ 状态盒 s。
 * 各模块工厂函数只在函数体内解引用，构造顺序由 index 统一组装保证。
 */
export interface TimelineCtx {
  host: HTMLElement
  canvas: HTMLCanvasElement
  app: import('pixi.js').Application
  PIXI: typeof import('pixi.js')
  cfg: TimelineConfig
  /** 时间 0 在静止时的屏幕 x：headWidth + preGap */
  originX: number
  store: MediaStore
  waveform: WaveformRenderer
  callbacks: TimelineCallbacks
  hintEl: HTMLDivElement
  headEls: HeadEls
  layers: LayerSet
  /** 素材块持久化视图（itemId → ClipView） */
  views: Map<string, ClipView>
  s: TimelineState
  geo: GeometryApi
}
