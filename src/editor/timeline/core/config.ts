/* ============================================================
 *  时间轴 · 配置单一数据源（TimelineTrack 拆分）
 *  默认值 + Partial 覆盖、缩放等级换算
 * ============================================================ */
import type { TrackObjectType } from '../../types'
import { CELL_W } from '../../codec/timelineMedia'

/* ============================================================
 *  时间轴配置（参考 asconfig TimelineEditor.vue 的 config 单一数据源）
 *  下列值即当前剪映风格外观 / 行为的默认值；外部可经 createTimelineTrack
 *  第 4 个参数传入 Partial<TimelineConfig> 覆盖任意项（resolveTimelineConfig 合并）。
 * ============================================================ */
export interface TimelineConfig {
  /* —— 帧率 / 时间 —— */
  /** 帧率（本工程草稿 30fps；参考实现为 24） */
  fps: number
  /** 空时间轴的默认时长（秒），播放头钳制下限 */
  defaultDuration: number
  /** 单个素材最短时长（秒），拖裁 / 分割下限 */
  minClipDuration: number
  /** 图片拖入时间轴的默认时长（帧），供外部添加素材时读取 */
  imageInitialFrames: number

  /* —— 时间标尺（参考 timelineHeight / scaleSpace / markerColor / timelineTextColor） —— */
  /** 标尺区域高度 */
  timelineHeight: number
  /** 水平基准线距标尺顶部的距离（线上方留白，剪映式） */
  scaleSpace: number
  /** 主刻度自基准线向下的高度（默认近乎垂到标尺底：timelineHeight - scaleSpace - 1） */
  rulerMajorHeight: number
  /** 中刻度 / 短刻度自基准线向下的高度 */
  rulerMidHeight: number
  rulerMinorHeight: number
  /** 主 / 中 / 短刻度颜色 */
  markerColor: number
  rulerMidColor: number
  rulerMinorColor: number
  /** 秒 / 分时间文字颜色与字号 */
  timelineTextColor: number
  rulerFontSize: number
  /** 帧文字颜色与字号 */
  frameTextColor: number
  frameFontSize: number
  /** 磁吸开启时标尺右端指示点 */
  accentColor: number

  /* —— 泳道 —— */
  /** 主视频轨泳道高度 */
  mainTrackHeight: number
  /** 普通资源轨（图片 / 音频）泳道高度 */
  trackHeight: number
  /** 装饰轨（贴纸 / 文本 / 字幕 / 滤镜 / 特效 / 转场）泳道高度 */
  decorTrackHeight: number
  /** 相邻泳道间距（透全局黑形成行间分隔） */
  lineDistance: number
  /** 所有泳道统一底色 */
  trackBackgroundColor: number
  /** 泳道顶部分隔线颜色（统一 alpha 0.6，自时间 0 起笔） */
  laneDividerColor: number

  /* —— 素材块 —— */
  /** 素材块兜底底色（按类型色板缺失时） */
  trackContentColor: number
  /** 各轨道类型的素材块底色 */
  trackBaseColors: Record<TrackObjectType, number>
  /** 素材轨（video/image，轨道头为「素材」图标）：块满高，媒体画面区距块顶/底的内边距（主轴 70=15+40+15、图片轴 50=15+20+15） */
  clipMediaInsetY: number
  /** 非素材轨（audio / 贴纸 / 文本等）：块在泳道内的上下内边距合计，媒体铺满块 */
  clipPadOther: number
  clipRadius: number
  /**
   * 相邻素材块之间的视觉间隙（px，参考 asconfig config.elementGap）。
   * 仅渲染收窄：吸附后两块在时间数据上仍逐帧相接（start=前一块 end），
   * 块体右侧少画 elementGap 像素，露出泳道底色形成分隔缝。
   */
  elementGap: number
  clipBorderColor: number
  clipLabelColor: number
  clipFontSize: number
  /** 选中描边 / 拖裁柄颜色 */
  selectionColor: number
  /** 隐藏轨道素材块透明度 */
  hiddenTrackAlpha: number
  /** 缩略格逻辑宽度（= 最高缩放级单帧像素宽）；抽帧瓦片与图片 cover 瓦片同宽 */
  trackMediaWidth: number
  /** 视频内嵌音频波形底色 / 柱色 */
  videoWaveBg: number
  mediaLineColor: number
  /** 独立音频块波形底色 / 柱色 */
  audioWaveBg: number
  audioLineColor: number

  /* —— 播放头 —— */
  /** 播放头竖线 / 手柄描边颜色 */
  timeIndicatorColor: number
  /** 播放头手柄内部填充（未选中：深色填充白描边） */
  playheadHandleFill: number
  /** 播放头选中 / 悬停时手柄填充（剪映：白色实心） */
  playheadActiveFill: number
  /**
   * 手柄宽 / 直筒高 / 顶部圆角（顶边贴基准线，整体挂在线下方）。
   * 手柄形状=直筒 + 下方半圆：直筒高 playheadHandleHeight，
   * 下半圆半径 = playheadHandleWidth / 2，总高 = 直筒高 + 半圆半径。
   */
  playheadHandleWidth: number
  playheadHandleHeight: number
  playheadHandleRadius: number
  /** 竖线不透明度（剪映中明显比手柄描边淡） */
  playheadStemAlpha: number
  /** 磁吸参考线颜色（剪映金黄色） */
  snapGuideColor: number
  /** 预览轴「靠后一帧」灰矩形：填充色与不透明度（用半透明白叠在深色底上） */
  previewFrameColor: number
  previewFrameAlpha: number
  /** 预览轴灰矩形顶边距标尺基准线的距离 / 矩形高度（剪映实测 +4 / 24px，不随缩放变） */
  previewFrameOffsetY: number
  previewFrameHeight: number

  /* —— 画布 / 轨道头 —— */
  /** 画布不透明底色 */
  backgroundColor: number
  /** 左侧轨道头列宽度（类型图标 + 锁 / 显示 / 原声三按钮横排） */
  headWidth: number
  /**
   * 主轨「封面」前缀段宽度（参考 asconfig config.preWorldGap 前缀隔离段）：
   * 静止（offX=0）时，时间 0 位于 headWidth + preGap，封面按钮 40×40 放在时间 0
   * 左侧 5px 处。封面与时间 0 都锚定在世界坐标上，横向滚动时与素材 / 刻度一起
   * 左右移动（滚到最左后被画布左缘裁掉）；纵向仍跟随主轨泳道。
   */
  preGap: number
  /** 时间内容右侧留白 */
  padX: number

  /* —— 横向滚动条 —— */
  scrollbarHeight: number
  scrollbarColor: number
  scrollbarHoverColor: number

  /* —— DOM 轨道头按钮（以 CSS 变量下发，支持 'transparent'） —— */
  commonButtonBgColor: string
  commonButtonHoverColor: string

  /* —— 缩放等级 —— */
  levelMin: number
  levelMax: number
  levelDefault: number
}

/**
 * 默认配置（当前剪映风格的全部基线值；键名与参考 asconfig config 对齐，
 * 数值为本工程实测调定值，如 fps=30、trackMediaWidth=46、timelineHeight=26）。
 */
export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  fps: 30,
  defaultDuration: 10,
  minClipDuration: 0.2,
  imageInitialFrames: 5 * 30,

  // 标尺带高度（剪映实测 30px）：下沿包住预览轴「靠后一帧」灰矩形（帧提示整体属于标尺区域）。
  // 几何闭环：scaleSpace(2) + previewFrameOffsetY(2) + previewFrameHeight(19) + 底距 7 = 30
  timelineHeight: 30,
  // 剪映式标尺：基准线距顶 10px，线上方留白；刻度 / 文字全部在线下方
  scaleSpace: 2,
  rulerMajorHeight: 15,
  rulerMidHeight: 9,
  rulerMinorHeight: 8,
  markerColor: 0x6e6e76,
  rulerMidColor: 0x52525a,
  rulerMinorColor: 0x3c3c44,
  timelineTextColor: 0x9a9aa2,
  rulerFontSize: 10,
  frameTextColor: 0x76767e,
  frameFontSize: 9,
  accentColor: 0x18b9d4,

  mainTrackHeight: 70,
  trackHeight: 50,
  // 装饰轨（贴纸 / 文本 / 字幕 / 特效 / 滤镜 / 转场）统一 20px 行高
  decorTrackHeight: 20,
  lineDistance: 2,
  trackBackgroundColor: 0x242428,
  laneDividerColor: 0x2a2a30,

  trackContentColor: 0x004d52,
  trackBaseColors: {
    // 主轨 / 素材轨统一底色（参考 asconfig trackContentColor 0x004D52），
    // 两类轨道均可放视频 / 图片 / GIF
    video: 0x004d52,
    image: 0x004d52,
    // 装饰类底色对齐剪映参考：贴纸琥珀、文本砖红、字幕亮砖红（与文本略区分）、
    // 特效紫、滤镜靛蓝
    sticker: 0xd49028,
    text: 0x9c4834,
    caption: 0xa45c48,
    filter: 0x585494,
    effect: 0x805c8c,
    transition: 0x275258,
    audio: 0x103c5c
  },
  clipMediaInsetY: 15,
  // 装饰块上下内边距：20px 行高 → 块体 16px；音频轨（50px）→ 46px
  clipPadOther: 4,
  clipRadius: 4,
  elementGap: 1,
  clipBorderColor: 0xffffff,
  clipLabelColor: 0xe8e8ec,
  clipFontSize: 9,
  selectionColor: 0xffffff,
  hiddenTrackAlpha: 0.35,
  trackMediaWidth: CELL_W,
  // 视频内嵌音轨：波形带底与块底同色 0x004D52、波形柱 0x00777E（图片/画面下方的音频）
  videoWaveBg: 0x004d52,
  mediaLineColor: 0x00777e,
  audioWaveBg: 0x103c5c,
  audioLineColor: 0x62b8f0,

  timeIndicatorColor: 0xe8e8ec,
  playheadHandleFill: 0x17171a,
  playheadActiveFill: 0xffffff,
  playheadHandleWidth: 10,
  playheadHandleHeight: 8,
  playheadHandleRadius: 2,
  playheadStemAlpha: 0.55,
  snapGuideColor: 0xffc400,
  previewFrameColor: 0xffffff,
  previewFrameAlpha: 0.1,
  // 帧提示（预览轴右侧一帧宽灰矩形）：按剪映比例坐落在 30px 标尺带内（顶 y=4、底 y=23）
  previewFrameOffsetY: 2,
  previewFrameHeight: 19,

  backgroundColor: 0x101012,
  // 轨道头列：类型图标 + 锁定 / 显示 / 原声三按钮横排
  headWidth: 90,
  preGap: 50,
  padX: 12,

  scrollbarHeight: 8,
  scrollbarColor: 0x404040,
  scrollbarHoverColor: 0x999999,

  commonButtonBgColor: 'transparent',
  commonButtonHoverColor: '#3b3b42',

  levelMin: 1,
  levelMax: 13,
  levelDefault: 7
}

/** 数字颜色 → #rrggbb（DOM / CSS 变量用） */
export const numToCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/** 合并外部覆盖：标量逐项覆盖，类型色板按键浅合并 */
export function resolveTimelineConfig(override: Partial<TimelineConfig> = {}): TimelineConfig {
  return {
    ...DEFAULT_TIMELINE_CONFIG,
    ...override,
    trackBaseColors: {
      ...DEFAULT_TIMELINE_CONFIG.trackBaseColors,
      ...(override.trackBaseColors ?? {})
    }
  }
}

/** 单帧像素宽：最高级时一帧恰好一个媒体格（trackMediaWidth），每降一级减半 */
export const frameWidthForLevel = (level: number, cfg: TimelineConfig) =>
  cfg.trackMediaWidth * 2 ** (level - cfg.levelMax)
/** 每秒像素宽 */
export const pxPerSecForLevel = (level: number, cfg: TimelineConfig) => frameWidthForLevel(level, cfg) * cfg.fps
