/* ============================================================
 *  CutContainer · 编辑器框架
 *  外部框架（Vue/React/Svelte/Solid）与框架内部页面之间的数据契约
 * ============================================================
 *  外部框架只允许传递两类数据：
 *    1. materials —— 素材库数据（八个分类的素材原始数据）
 *    2. tracks    —— 轨道操作数据（素材在时间线上的排布操作）
 *  框架内部页面拿到数据后负责渲染并持久化到 localStorage。
 * ============================================================ */

/* ---------- 素材（material）：视频 / 图片 / 动图 ---------- */

/** 媒体素材细分类型 */
export type MediaKind = 'video' | 'image' | 'gif'

export interface MaterialItem {
  /** 唯一 id，轨道元素通过它关联素材 */
  id: string
  /** 素材名称（含文件名后缀；展示与入轨使用） */
  name: string
  /** 视频 / 图片 / 动图 */
  kind: MediaKind
  /** 可访问地址（后端素材目录 / 本地上传）；播放与展示统一使用它 */
  url: string
  /** 文件来源：后端目录 / 后端上传 = remote_file，本地文件 = local_file */
  source?: 'remote_file' | 'local_file'
  /** 后端文件地址（source=remote_file 时等于 url） */
  remote_file?: string
  /** 本地文件地址（source=local_file 时等于 url，通常是 blob:） */
  local_file?: string
  /** 视频时长（秒），图片/动图可不填 */
  duration?: number
  /** 媒体原始宽（px），上传时探测；内置素材可能缺省 */
  width?: number
  /** 媒体原始高（px），上传时探测；内置素材可能缺省 */
  height?: number
  /** 副标题（如 '1920 × 1080'） */
  sub?: string
}

/* ---------- 音频（audio）：音乐 / 音效 ---------- */

export type AudioKind = 'music' | 'sfx'

export interface AudioItem {
  id: string
  name: string
  /** music=背景音乐，sfx=音效 */
  type: AudioKind
  url: string
  duration?: number
  /** 副标题（如 'MP3 · 轻快'） */
  sub?: string
}

/* ---------- 文本（text）：默认文本 + 模板文本 ---------- */

/** 模板矢量描边（设计字号口径，入轨时等比换算到逻辑字号） */
export interface TextTemplateStroke {
  color: string
  /** 粗细（设计字号下的 px） */
  width: number
  /** 不透明度 0-1，缺省 1 */
  opacity?: number
}

/** 模板矢量投影 / 发光层（设计字号口径 px；多层＝CSS text-shadow 叠层语义） */
export interface TextTemplateShadow {
  color: string
  /** 不透明度 0-1，缺省 1 */
  opacity?: number
  /** 模糊半径（设计字号下的 px） */
  blur: number
  /** 水平 / 垂直偏移（设计字号下的 px，右下为正） */
  dx: number
  dy: number
}

/**
 * 模板的 SVG 矢量样式描述：素材面板预览与播放器光栅化共用同一份数据，
 * 描边走 SVG stroke（paint-order），投影 / 发光走多层 SVG filter。
 */
export interface TextTemplateStyle {
  fontFamily?: string
  /** 面板预览设计字号（px），入轨按默认逻辑字号 48 等比换算描边 / 阴影 / 字距 */
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  color?: string
  /** 字间距（设计字号下的 px） */
  letterSpacing?: number
  stroke?: TextTemplateStroke
  /**
   * 投影 / 发光层：第一层为可在详情面板编辑的主阴影，
   * 其余层作为附加发光（霓虹等）随模板保留、面板不单独编辑。
   */
  shadows?: TextTemplateShadow[]
}

export interface TextItem {
  id: string
  name: string
  /** 文本内容 */
  content: string
  /** 副标题（样式描述，如 '大号加粗'） */
  sub?: string
  /** 是否为模板文本（已设置好矢量样式的 SVG 文本）；缺省为默认文本 */
  template?: boolean
  /** 模板的 SVG 矢量样式（预览 / 入轨渲染共用） */
  style?: TextTemplateStyle
  /** 保留字段（历史模板 class，当前未使用） */
  className?: string
}

export interface TextItems {
  /** 默认文本：可直接拖入轨道的基础文本 */
  defaults: TextItem[]
  /** 模板文本：已设置好字体/颜色/描边等样式的文本 */
  templates: TextItem[]
}

/**
 * 文本面板「默认文本」唯一内建项（产品口径：不再区分标题 / 副标题 / 正文 / 字幕条）。
 * 添加到轨道后画面文字内容即为「默认文本」；水合素材数据时以此归一，
 * 旧本地缓存（标题等四项）自动收敛为这一项。
 */
export const DEFAULT_TEXT_ITEM: TextItem = {
  id: 't-default',
  name: '默认文本',
  content: '默认文本'
}

/* ---------- 字幕（caption）：srt / ass ---------- */

export type CaptionFormat = 'srt' | 'ass'

export interface CaptionItem {
  id: string
  name: string
  format: CaptionFormat
  url: string
  sub?: string
}

/* ---------- 贴纸（sticker）：背景透明的动图 ---------- */

export interface StickerItem {
  id: string
  name: string
  /** 透明背景 GIF（后端素材目录下发） */
  url: string
  sub?: string
}

/* ---------- 滤镜（filter）：pixi 调色滤镜 ---------- */

/** 内置 pixi 滤镜标识，面板据此映射到 ColorMatrix 参数 */
export type FilterKey =
  | 'none'
  | 'blackwhite'
  | 'sepia'
  | 'warm'
  | 'cool'
  | 'vintage'

export interface FilterItem {
  id: string
  name: string
  /** 滤镜缩略图（后端素材目录下发的示例画面烘焙图） */
  thumb: string
  /** pixi 滤镜标识 */
  filter: FilterKey
}

/* ---------- 特效 / 转场（effect / transition）：暂未实现 ---------- */

export interface ComingSoonItem {
  id: string
  name: string
  /** 占位项：帧动画 + 画面调整机制尚未实现 */
  comingSoon: true
}

/* ---------- 素材库总模型：八个分类 ---------- */

export interface MaterialsData {
  /** 素材：视频 / 图片 / 动图（后端素材目录） */
  material: MaterialItem[]
  /** 音频：音乐与音效（后端素材目录） */
  audio: AudioItem[]
  /** 文本：默认文本 + 模板文本 */
  text: TextItems
  /** 字幕：srt / ass（后端素材目录） */
  caption: CaptionItem[]
  /** 贴纸：透明背景动图（后端素材目录） */
  sticker: StickerItem[]
  /** 滤镜：pixi 调色（缩略图来自后端素材目录） */
  filter: FilterItem[]
  /** 特效：帧动画 + 画面调整（未实现） */
  effect: ComingSoonItem[]
  /** 转场：帧动画 + 画面调整（未实现） */
  transition: ComingSoonItem[]
}

/* ============================================================
 *  时间线轨道模型（localStorage `uc-editor:tracks` 存储的就是
 *  TrackObject[] —— 一个轨道对象数组）
 *
 *  每个轨道对象包含三要素：
 *    type   轨道类型：素材库哪一项插入进来的（video/image/audio/...）
 *    layer  轨道层级：主视频轨 = 0，音频轨为负数，主轨上方的素材轨为
 *           正数（数值越大画面越靠上），用于确认上下位置
 *    items  轨道内容：该轨上的每个子项（结构参考 asconfig 的
 *           BaseTractItem + Video/Audio/Image/TextTrackDB 的 source）
 *
 *  说明：asconfig 原版以"帧"计时（start/end/frameCount，baseFps=24），
 *  本工程时间线统一以"秒"计时（start/duration），end 可由两者推导。
 * ============================================================ */

/** 轨道（元素）类型：与素材库可插入的分类一一对应（effect/transition 预留） */
export type TrackObjectType =
  | 'video'
  | 'image'
  | 'audio'
  | 'text'
  | 'caption'
  | 'sticker'
  | 'filter'
  | 'effect'
  | 'transition'

/* ---------- 各类型元素的内容信息（参考 asconfig *Source） ---------- */

/** 视频内容（VideoSource：url/name/format/duration/width/height） */
export interface VideoContent {
  url: string
  name: string
  /** 容器格式（后缀小写，如 mp4） */
  format: string
  duration: number
  width: number
  height: number
}

/** 图片 / 动图内容（ImageSource；duration 为在时间线上的停留秒数） */
export interface ImageContent {
  url: string
  name: string
  format: string
  duration: number
  width: number
  height: number
}

/** 音频内容（AudioSource，附 music/sfx 分类） */
export interface AudioContent {
  url: string
  name: string
  format: string
  duration: number
  audioType: AudioKind
}

/** 文本内容（TextSource 核心字段：内容 + 字体 / 字号 / 颜色 + BUI / 间距 / 对齐 / 描边 / 阴影） */
/** 文字水平对齐（多行文本行间对齐） */
export type TextAlign = 'left' | 'center' | 'right'
/** 文字垂直对齐（文本块相对定位点的排布方向） */
export type TextVAlign = 'top' | 'middle' | 'bottom'

/** 文字描边 */
export interface TextStroke {
  enabled: boolean
  color: string
  /** 不透明度 0-1 */
  opacity: number
  /** 粗细（逻辑像素） */
  width: number
}

/** 文字阴影 */
export interface TextShadow {
  enabled: boolean
  color: string
  /** 不透明度 0-1 */
  opacity: number
  /** 模糊度 0-100（按字号比例换算为像素半径） */
  blur: number
  /** 距离（逻辑像素） */
  distance: number
  /** 角度（度：0＝向右，顺时针，负值向上；剪映默认 -45） */
  angle: number
}

/** 混合（文字整体不透明度；关闭勾选＝不应用，按完全不透明渲染） */
export interface TextBlend {
  enabled: boolean
  /** 不透明度 0-1 */
  opacity: number
}

/** 文字背景（文本块后面的圆角矩形底板，始终紧贴文字块） */
export interface TextBackground {
  enabled: boolean
  color: string
  /** 不透明度 0-1 */
  opacity: number
  /** 圆角 0-100（相对底板半高，100 为胶囊） */
  radius: number
  /** 高度扩展 0-100（字号百分比的纵向内边距） */
  height: number
  /** 宽度扩展 0-100（字号百分比的横向内边距） */
  width: number
  /** 上下偏移 0-100，50 居中（值越大越靠下） */
  offsetY: number
  /** 左右偏移 0-100，50 居中（值越大越靠右） */
  offsetX: number
}

/**
 * 发光类型：
 *  gem＝璀璨光束（从字形打出的方向性柔光光柱，强度/范围控制光线大小，
 *        垂直/水平角度各 -50°~50° 控制投射方向，面板含两个角度滑杆）；
 *  soft＝普通外发光（单层 feGaussianBlur 高斯模糊，面板仅有颜色 / 强度 / 范围）
 */
export type TextGlowMode = 'gem' | 'soft'

/** 文字发光（外发光光晕，区别于带方向 / 距离的投影） */
export interface TextGlow {
  enabled: boolean
  mode: TextGlowMode
  color: string
  /** 强度 0-100（光晕不透明度） */
  strength: number
  /** 范围 0-100（按字号比例换算为高斯半径） */
  range: number
  /** 垂直角度 -50-50（gem 光束纵向投射方向，负值向下） */
  angleV: number
  /** 水平角度 -50-50（gem 光束横向投射方向，负值向左） */
  angleH: number
}

export interface TextContent {
  content: string
  color: string
  fontSize: number
  fontFamily: string
  /** 加粗 */
  bold?: boolean
  /** 斜体 */
  italic?: boolean
  /** 下划线 */
  underline?: boolean
  /** 字间距（逻辑像素，可负） */
  letterSpacing?: number
  /** 行间距（行与行之间的额外像素，可负） */
  lineSpacing?: number
  /** 水平对齐 */
  align?: TextAlign
  /** 垂直对齐 */
  valign?: TextVAlign
  /** 竖排：文字自上而下、换行列自右而左（横排为 false / 缺省） */
  vertical?: boolean
  /** 描边（可选，enabled 才生效） */
  stroke?: TextStroke
  /** 阴影（可选，enabled 才生效） */
  shadow?: TextShadow
  /**
   * 模板附加投影 / 发光层（主阴影之外，SVG 多层 filter 渲染）：
   * 随花字模板入轨并保留，详情面板只编辑主阴影，不单独编辑这些层。
   */
  extraShadows?: TextShadow[]
  /** 混合（整体不透明度，缺省完全不透明） */
  blend?: TextBlend
  /** 背景底板（可选，enabled 才生效） */
  background?: TextBackground
  /** 外发光（可选，enabled 才生效） */
  glow?: TextGlow
}

/** 归一后的完整文字样式（缺省字段全部补齐，绘制 / 面板共用） */
export interface ResolvedTextStyle {
  content: string
  color: string
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  underline: boolean
  letterSpacing: number
  lineSpacing: number
  align: TextAlign
  valign: TextVAlign
  vertical: boolean
  stroke: TextStroke
  shadow: TextShadow
  /** 模板附加投影 / 发光层（已归一） */
  extraShadows: TextShadow[]
  blend: TextBlend
  background: TextBackground
  glow: TextGlow
}

/** 描边 / 阴影未开启时的内建默认值（开启勾选时采用） */
export const DEFAULT_TEXT_STROKE: TextStroke = {
  enabled: false,
  color: '#000000',
  opacity: 1,
  width: 8
}
export const DEFAULT_TEXT_SHADOW: TextShadow = {
  enabled: false,
  color: '#000000',
  opacity: 0.9,
  blur: 15,
  distance: 5,
  angle: -45
}
/** 混合默认勾选（不透明度 100%） */
export const DEFAULT_TEXT_BLEND: TextBlend = {
  enabled: true,
  opacity: 1
}
/** 背景默认值（剪映口径：黑底 / 圆角 0 / 高宽各 14% / 偏移居中） */
export const DEFAULT_TEXT_BACKGROUND: TextBackground = {
  enabled: false,
  color: '#000000',
  opacity: 1,
  radius: 0,
  height: 14,
  width: 14,
  offsetY: 50,
  offsetX: 50
}
/** 发光默认值（璀璨镜面光照 / 白色 / 强度 30 / 范围 20 / 角度水平 0·垂直 0） */
export const DEFAULT_TEXT_GLOW: TextGlow = {
  enabled: false,
  mode: 'gem',
  color: '#ffffff',
  strength: 30,
  range: 20,
  angleV: 0,
  angleH: 0
}

/** 把任意来源（旧存档 / 面板 / 模板）的 TextContent 归一为完整样式 */
export function resolveTextStyle(t?: Partial<TextContent> | null): ResolvedTextStyle {
  const fs = typeof t?.fontSize === 'number' && t.fontSize > 0 ? t.fontSize : 48
  const stroke: TextStroke = {
    enabled: !!t?.stroke?.enabled,
    color: t?.stroke?.color ?? DEFAULT_TEXT_STROKE.color,
    opacity: clamp01(t?.stroke?.opacity ?? DEFAULT_TEXT_STROKE.opacity),
    width: numRange(t?.stroke?.width, DEFAULT_TEXT_STROKE.width, 0, 200)
  }
  const shadow: TextShadow = {
    enabled: !!t?.shadow?.enabled,
    color: t?.shadow?.color ?? DEFAULT_TEXT_SHADOW.color,
    opacity: clamp01(t?.shadow?.opacity ?? DEFAULT_TEXT_SHADOW.opacity),
    blur: numRange(t?.shadow?.blur, DEFAULT_TEXT_SHADOW.blur, 0, 100),
    distance: numRange(t?.shadow?.distance, DEFAULT_TEXT_SHADOW.distance, 0, 500),
    angle: numRange(t?.shadow?.angle, DEFAULT_TEXT_SHADOW.angle, -360, 360)
  }
  const extraShadows: TextShadow[] = Array.isArray(t?.extraShadows)
    ? t!.extraShadows!
        .filter((s): s is TextShadow => !!s && typeof s === 'object')
        .map(s => ({
          enabled: true,
          color: typeof s.color === 'string' && s.color ? s.color : DEFAULT_TEXT_SHADOW.color,
          opacity: clamp01(s.opacity ?? 1),
          // 附加发光层为模板专属（面板不编辑）：霓虹等大半径光晕可达字号数倍，
          // 上限放宽到 300%，主阴影仍受 0-100 面板口径约束
          blur: numRange(s.blur, 0, 0, 300),
          distance: numRange(s.distance, 0, 0, 1000),
          angle: numRange(s.angle, 0, -360, 360)
        }))
    : []
  const blend: TextBlend = {
    // 旧数据无此字段时按默认勾选处理
    enabled: t?.blend ? t.blend.enabled !== false : DEFAULT_TEXT_BLEND.enabled,
    opacity: clamp01(t?.blend?.opacity ?? DEFAULT_TEXT_BLEND.opacity)
  }
  const dbg = DEFAULT_TEXT_BACKGROUND
  const background: TextBackground = {
    enabled: !!t?.background?.enabled,
    color:
      typeof t?.background?.color === 'string' && t.background.color
        ? t.background.color
        : dbg.color,
    opacity: clamp01(t?.background?.opacity ?? dbg.opacity),
    radius: numRange(t?.background?.radius, dbg.radius, 0, 100),
    height: numRange(t?.background?.height, dbg.height, 0, 100),
    width: numRange(t?.background?.width, dbg.width, 0, 100),
    offsetY: numRange(t?.background?.offsetY, dbg.offsetY, 0, 100),
    offsetX: numRange(t?.background?.offsetX, dbg.offsetX, 0, 100)
  }
  const dgl = DEFAULT_TEXT_GLOW
  const glow: TextGlow = {
    enabled: !!t?.glow?.enabled,
    mode: t?.glow?.mode === 'soft' ? 'soft' : 'gem',
    color: typeof t?.glow?.color === 'string' && t.glow.color ? t.glow.color : dgl.color,
    strength: numRange(t?.glow?.strength, dgl.strength, 0, 100),
    range: numRange(t?.glow?.range, dgl.range, 0, 100),
    angleV: numRange(t?.glow?.angleV, dgl.angleV, -50, 50),
    angleH: numRange(t?.glow?.angleH, dgl.angleH, -50, 50)
  }
  return {
    content: String(t?.content ?? ''),
    color: typeof t?.color === 'string' && t.color ? t.color : '#ffffff',
    fontSize: fs,
    fontFamily: t?.fontFamily ?? '',
    bold: !!t?.bold,
    italic: !!t?.italic,
    underline: !!t?.underline,
    letterSpacing: numRange(t?.letterSpacing, 0, -200, 500),
    lineSpacing: numRange(t?.lineSpacing, 0, -200, 500),
    align: t?.align === 'left' || t?.align === 'right' ? t.align : 'center',
    valign: t?.valign === 'top' || t?.valign === 'bottom' ? t.valign : 'middle',
    vertical: !!t?.vertical,
    stroke,
    shadow,
    extraShadows,
    blend,
    background,
    glow
  }
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(1, Math.max(0, n))
}

function numRange(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** ASS cue 携带的样式（已换算到逻辑画布口径；字段缺省走字幕默认） */
export interface CaptionCueStyle {
  color?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  /** ASS 描边（OutlineColour + Outline 宽度） */
  stroke?: { color: string; width: number; opacity?: number }
}

/** 字幕文件解析出的单条对白（秒，由 srt / ass 时间轴解析） */
export interface CaptionCue {
  start: number
  end: number
  text: string
  /** ass 样式化 cue 才有：解析自该行引用的 V4 Style */
  style?: CaptionCueStyle
}

/**
 * 字幕内容：文件地址 + 入轨时长 + 片段文本。
 * 一条 cue 入轨为一个字幕片段：content 为该条字幕文本，
 * 渲染复用文本管线（缺省的字体 / 颜色字段由 resolveTextStyle 兜底）。
 */
export interface CaptionContent {
  url: string
  name: string
  format: CaptionFormat
  duration: number
  /** 本片段显示的字幕文本（取 cue 文本首行） */
  content: string
  color?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  /** ass 解析出的描边（复用文字描边结构子集） */
  stroke?: TextStroke
}

/**
 * 字幕片段缺省文字样式：白字 + 半透明黑描边（仿剪映字幕默认观感，
 * 浅色画面也可读）。播放器展平与右侧详情面板共用，片段自带字段优先。
 */
export const CAPTION_TEXT_DEFAULTS: Partial<TextContent> = {
  color: '#ffffff',
  fontSize: 48,
  stroke: { enabled: true, color: '#000000', opacity: 0.55, width: 3 }
}

/** 贴纸内容（透明 GIF） */
export interface StickerContent {
  url: string
  name: string
  format: string
  duration: number
  width: number
  height: number
}

/** 滤镜内容（pixi 滤镜标识 + 缩略图） */
export interface FilterContent {
  name: string
  filter: FilterKey
  thumb: string
  duration: number
}

/** 特效内容（能力预留，暂未实现） */
export interface EffectContent {
  name: string
  duration: number
}

/** 转场内容（能力预留，暂未实现） */
export interface TransitionContent {
  name: string
  duration: number
}

/** 类型 → 内容信息 映射表 */
export interface TrackSourceMap {
  video: VideoContent
  image: ImageContent
  audio: AudioContent
  text: TextContent
  caption: CaptionContent
  sticker: StickerContent
  filter: FilterContent
  effect: EffectContent
  transition: TransitionContent
}

/**
 * 画面变换（视频/图片/GIF/贴纸/文本等视觉片段）。
 * 坐标为工程逻辑像素：当前比例视图短边固定 1080（横屏 1920×1080、竖屏 1080×1920），
 * x/y 为相对画面中心的偏移，0=居中；scale=1 对应 contain 铺满比例视图框。
 */
export interface ClipTransform {
  /** 等比缩放（uniform=true 时生效）：1=100% */
  scale: number
  /** 横向缩放（uniform=false 时生效） */
  scaleX: number
  /** 纵向缩放（uniform=false 时生效） */
  scaleY: number
  /** 等比缩放开关 */
  uniform: boolean
  /** 水平偏移（逻辑像素，正向右） */
  x: number
  /** 垂直偏移（逻辑像素，正向下） */
  y: number
  /** 旋转角度（角度制，顺时针为正） */
  rotation: number
  /** 水平翻转（左右镜像） */
  flipH?: boolean
  /** 垂直翻转（上下镜像） */
  flipV?: boolean
}

/** 轨道上的一个子项（参考 asconfig BaseTractItem：id/type/name/start/.../visible/status） */
export interface TrackItem<T extends TrackObjectType = TrackObjectType> {
  /** 元素唯一 id */
  id: string
  /** 元素类型（与所在轨道一致） */
  type: T
  /** 显示名称 */
  name: string
  /** 时间线起点（秒） */
  start: number
  /** 持续时长（秒） */
  duration: number
  /** 关联素材库素材 id（文本等无素材库实体时省略） */
  materialId?: string
  /** 是否可见（对应 BaseTractItem.visible） */
  visible: boolean
  /** 0-处理中 1-成功 2-失败（对应 BaseTractItem.status） */
  status: 0 | 1 | 2
  /**
   * 素材入点（秒）：该子项使用的是素材从 sourceStart 开始的片段。
   * 缺省为 0；分割 / 向左裁剪会改变它（视频/音频按入点取对应帧与波形）。
   */
  sourceStart?: number
  /** 内容信息（结构随 type 而定） */
  source: TrackSourceMap[T]
  /** 画面变换（仅视觉片段；旧数据无字段时按默认值处理） */
  transform?: ClipTransform
  /** 不透明度 0-1（仅视觉片段；缺省 1） */
  opacity?: number
  /** 音量倍率 0-2（仅音频 / 视频原声；缺省 1，面板按 0-200% 编辑） */
  volume?: number
  /** 淡入时长（秒，缺省 0） */
  fadeIn?: number
  /** 淡出时长（秒，缺省 0） */
  fadeOut?: number
  /** 片段级静音（仅音频 / 视频原声；区别于 TrackObject.muted 的整轨静音，缺省 false） */
  muted?: boolean
}

/** 任意类型的轨道子项 */
export type AnyTrackItem = { [K in TrackObjectType]: TrackItem<K> }[TrackObjectType]

/** 轨道对象：localStorage tracks 数组中的每一项 */
export interface TrackObject {
  /** 轨道唯一 id */
  id: string
  /** 轨道类型：素材库哪一项插入进来的 */
  type: TrackObjectType
  /** 轨道名称（如 主视频轨 / 音频轨） */
  name: string
  /** 轨道层级：主轨 0；音频负数；上方素材正数（越大越靠上） */
  layer: number
  /** 轨道内容（子项按 start 先后排列） */
  items: AnyTrackItem[]
  /** 轨道锁定：锁定后素材块不可选中 / 拖动 / 拖裁（默认 false） */
  locked?: boolean
  /** 轨道隐藏：时间轴上半透明展示且不可交互（默认 false） */
  hidden?: boolean
  /** 轨道静音：隐藏该轨原声（默认 false，对齐参考 trackSound 语义） */
  muted?: boolean
}

/** 各类型轨道的默认层级（主轨 0，音频负，上方素材为正） */
export const TRACK_LAYER: Record<TrackObjectType, number> = {
  video: 0,
  image: 1,
  sticker: 2,
  text: 3,
  caption: 4,
  filter: 5,
  effect: 6,
  transition: 7,
  audio: -1
}

/** 各类型轨道的展示名称 */
export const TRACK_NAME: Record<TrackObjectType, string> = {
  video: '主视频轨',
  image: '图片轨',
  sticker: '贴纸轨',
  text: '文本轨',
  caption: '字幕轨',
  filter: '滤镜轨',
  effect: '特效轨',
  transition: '转场轨',
  audio: '音频轨'
}

/** 外部框架可传入的 props */
export interface EditorProps {
  /** 草稿名称 */
  title?: string
  /** 素材库数据（八分类，传入即落盘） */
  materials?: MaterialsData
  /** 轨道数据：轨道对象数组（传入即落盘） */
  tracks?: TrackObject[]
}

/** localStorage 中的版本化包装 */
export interface StoredEnvelope<T> {
  version: number
  savedAt: string
  data: T
}
