/* ============================================================
 *  播放器内核 · 公共类型
 *  从原 mediaBunnyPlayer.ts 抽出，供 base / 各 mixin / codec 共用。
 * ============================================================ */
import type { ClipTransform, TextAlign, TextContent, TrackObject } from '../../types'

export type EmitFn = (name: string, detail: any) => void

export interface MediaBunnyPlayerOptions {
  /** 视频地址（http URL） */
  src?: string
  /** 或本地文件（File/Blob），优先于 src */
  file?: Blob
  title?: string
  /** 时间线轨道：提供后进入"合成播放"模式（初始静帧为时间线 0 时刻） */
  timelineTracks?: TrackObject[] | null
}

/** 时间线上的一个可播放片段（从 TrackObject 展平而来） */
export interface TlClip {
  /** item.id（同一 item 只可能在一条轨上，天然唯一） */
  id: string
  url: string
  kind: 'video' | 'image' | 'audio' | 'sticker' | 'text' | 'caption'
  /** 素材容器格式（如 'gif'），用于在 image 类内区分动图 */
  format?: string
  /** 素材原生宽 / 高（px，来自上传探测元数据；内置素材可能缺省，运行时由解码器/图片兜底） */
  natW?: number
  natH?: number
  /** 时间线起点 / 终点（秒） */
  start: number
  end: number
  /** 素材入点（秒） */
  sourceStart: number
  /** 轨道层级：越大越靠上（画面取最高层，音频全部参与混音） */
  layer: number
  /** 画面可见（item.visible && !track.hidden） */
  visible: boolean
  /** 轨道静音 */
  muted: boolean
  /** 片段级静音（TrackItem.muted，与轨道静音相互独立） */
  itemMuted: boolean
  /** 不透明度 0-1（视觉片段） */
  opacity: number
  /** 音量倍率 0-2（音频 / 视频原声） */
  volume: number
  /** 淡入 / 淡出时长（秒） */
  fadeIn: number
  fadeOut: number
  /** 画面变换（已归一化；视觉片段恒有值） */
  transform: ClipTransform
  /** 文本内容（kind='text' / 'caption'：字幕片段复用文本渲染管线） */
  text?: TextContent
}

/** 文本型片段：字幕（caption）与普通文本共用渲染 / 编辑管线 */
export function isTextClipKind(c: { kind: TlClip['kind'] }): boolean {
  return c.kind === 'text' || c.kind === 'caption'
}

/** 某视觉层当前在屏幕上的包围盒（CSS 像素，原点为舞台左上角），供操作框 / 命中测试使用 */
export interface LayerBox {
  clipId: string
  /** 中心 */
  cx: number
  cy: number
  /** 未旋转的宽 / 高 */
  w: number
  h: number
  /** 旋转角（弧度） */
  rotation: number
  /** 四角点（含旋转，顺序：左上 / 右上 / 右下 / 左下） */
  corners: Array<{ x: number; y: number }>
}

/**
 * 编辑态一个视觉图层：独立离屏 surface + pixi Sprite，按 clipId 池化复用。
 */
export interface LayerEntry {
  clipId: string
  sprite: import('pixi.js').Sprite
  source: import('pixi.js').CanvasSource
  texture: import('pixi.js').Texture
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** 当前表面像素尺寸 */
  natW: number
  natH: number
  /** 表面类型为文本时的内容指纹（变了才重画） */
  textKey: string
  /**
   * 文本字形在表面自然像素中的包围盒，用于贴合字形的操作框 / 命中区。
   * ox / oy 为盒心相对表面中心的偏移（靠文本框边缘 / 竖排对齐时字形不再居中）。
   */
  textBox?: { w: number; h: number; ox?: number; oy?: number }
  /** 文本表面最新内容是否已完成 SVG 光栅化并入画布 */
  textReady: boolean
  /** 文本光栅化代次（快速连续改字 / 重建表面时丢弃过期图像） */
  textToken: number
  /** 本轮渲染是否可见（不可见的层下一帧被回收） */
  visible: boolean
}

/** 文字原位编辑所需的展示信息（屏幕坐标系，由播放器换算） */
export interface TextEditMeta {
  content: string
  color: string
  fontFamily: string
  /** 加粗（编辑框字重同步） */
  bold?: boolean
  /** 斜体（编辑框字形同步） */
  italic?: boolean
  /** 下划线（编辑框同步） */
  underline?: boolean
  /** 竖排（编辑框切换 vertical-rl 书写模式） */
  vertical?: boolean
  /** 块内各行水平对齐（与渲染端「整块居中、align 收齐各行」一致） */
  align?: TextAlign
  /** 屏幕像素字间距（已含画面 fit 缩放与片段 scale） */
  letterSpacing?: number
  /** 屏幕像素行高（fs*1.25+行间距，已缩放） */
  lineHeight?: number
  /** 屏幕像素描边宽（0 / 缺省＝无描边，已缩放） */
  strokeWidth?: number
  /** 描边颜色（已合成描边透明度） */
  strokeColor?: string
  /** 屏幕像素字号（已含画面 fit 缩放与片段 scale） */
  screenFontSize: number
}

/**
 * 播放态单个可见视频片段的帧泵：顺序拉帧、一次只缓存一帧，
 * 到点后画入该片段的图层 surface。primary＝最低层级（主轨）泵，
 * 其迟到帧驱动整条时间线顺延，其余叠轨泵仅尽力呈现、不影响时钟。
 */
export interface TlLayerPump {
  clipId: string
  /** false＝片段退出 / 停止 / seek，拉帧循环立即作废 */
  alive: boolean
  iter: AsyncGenerator<any, void> | null
  /** 拉帧中标志（避免并发 pump） */
  pulling: boolean
  pending: {
    // mediabunny 帧对象（具备 draw / close / displayWidth / timestamp）
    frame: any
    frameTl: number
    w: number
    h: number
    held: boolean
    slipDue: number
  } | null
  /** 到点呈现一帧后触发拉下一条帧 */
  pump: () => void
}

export interface PlayerCommand {
  /** 单调递增 id，保证每条命令只处理一次 */
  id: number
  type: 'play' | 'pause' | 'seek' | 'load'
  time?: number
  src?: string
  file?: Blob
}

/** 比例视图矩形（CSS 像素，原点为舞台左上角） */
export interface ViewRect {
  vx: number
  vy: number
  vw: number
  vh: number
}
