import type { ClipTransform, TrackObjectType } from './types'

/**
 * 画面变换纯函数模块（播放器 / 右侧面板 / EditorPage 共用）。
 * 坐标系：工程逻辑像素，比例视图短边固定 1080（见 spec FR-1）。
 */

/** 逻辑画布短边（px）：横屏 1920×1080、竖屏 1080×1920 */
export const LOGICAL_SHORT_SIDE = 1080

/** 缩放滑杆 / 输入允许范围（手势 / 图片面板等全局默认） */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 4

/** 文字面板缩放范围：0% – 500%，100% 位于滑杆正中央 */
export const TEXT_SCALE_BOUNDS: TransformBounds = { min: 0, max: 5 }

/** 单次归一化使用的缩放下限 / 上限（不同入口可不同，如文字面板允许 0%） */
export interface TransformBounds {
  min: number
  max: number
}

/** 位置输入范围（逻辑像素，足够大即可） */
export const POSITION_MAX = 6000

/** 可做画面变换的视觉片段类型（字幕复用文本管线，同样可拖动 / 缩放） */
export const VISUAL_TYPES: ReadonlySet<TrackObjectType> = new Set([
  'video',
  'image',
  'sticker',
  'text',
  'caption'
])

export function isVisualType(type: TrackObjectType | string): boolean {
  return VISUAL_TYPES.has(type as TrackObjectType)
}

export function createDefaultTransform(): ClipTransform {
  return { scale: 1, scaleX: 1, scaleY: 1, uniform: true, x: 0, y: 0, rotation: 0, flipH: false, flipV: false }
}

/** 默认变换的共享引用（只读使用，勿改） */
export const DEFAULT_TRANSFORM: ClipTransform = createDefaultTransform()

/** 数值兜底：非法 / NaN 取 fallback，并限制范围 */
function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 归一化任意来源的 transform（旧数据 / 面板输入 / 持久化读取）。
 * - 缺字段 → 默认值
 * - uniform=true 时以 scale 为准，强制 scaleX=scaleY=scale
 * - b 可覆盖缩放范围（文字面板 0 – 5；不传走全局 0.1 – 4）
 */
export function normalizeTransform(
  t?: Partial<ClipTransform> | null,
  b?: TransformBounds
): ClipTransform {
  const smin = b?.min ?? SCALE_MIN
  const smax = b?.max ?? SCALE_MAX
  if (!t) return { ...DEFAULT_TRANSFORM }
  const uniform = t.uniform !== false
  const scale = num(t.scale, 1, smin, smax)
  const flipH = !!t.flipH
  const flipV = !!t.flipV
  if (uniform) {
    return { scale, scaleX: scale, scaleY: scale, uniform: true, x: num(t.x, 0, -POSITION_MAX, POSITION_MAX), y: num(t.y, 0, -POSITION_MAX, POSITION_MAX), rotation: num(t.rotation, 0, -36000, 36000), flipH, flipV }
  }
  const scaleX = num(t.scaleX, scale, smin, smax)
  const scaleY = num(t.scaleY, scale, smin, smax)
  return {
    scale,
    scaleX,
    scaleY,
    uniform: false,
    x: num(t.x, 0, -POSITION_MAX, POSITION_MAX),
    y: num(t.y, 0, -POSITION_MAX, POSITION_MAX),
    rotation: num(t.rotation, 0, -36000, 36000),
    flipH,
    flipV
  }
}

/** 取片段的实际横向 / 纵向缩放（等比时两轴相同） */
export function effectiveScale(t: ClipTransform): { sx: number; sy: number } {
  return t.uniform ? { sx: t.scale, sy: t.scale } : { sx: t.scaleX, sy: t.scaleY }
}

/**
 * 素材入轨后的「初始适配系数」（相对 contain/cover 铺满比例视图框的比例）。
 * 仿剪映：
 * - 主轨（layer ≤ 0）视频 / 图片：1.0 铺满；
 * - 叠轨（layer > 0）视频 / 图片 / GIF：0.66 画中画居中，避免全屏遮挡下层资源；
 * - 贴纸：0.36，点缀尺寸；
 * - 文字 / 字幕：1.0（其表面是整幅逻辑画布，字形按字号自然呈现，不铺满）。
 * transform.scale 的 100% 即对应该素材的初始尺寸（与剪映语义一致）。
 */
export function baseFitOf(type: TrackObjectType | string, layer: number): number {
  if (type === 'text' || type === 'caption') return 1
  if (type === 'sticker') return STICKER_BASE_FIT
  if (type === 'video' || type === 'image') return layer <= 0 ? 1 : OVERLAY_BASE_FIT
  return 1
}

/** 叠轨画面素材（画中画）初始尺寸系数 */
export const OVERLAY_BASE_FIT = 0.66
/** 贴纸初始尺寸系数 */
export const STICKER_BASE_FIT = 0.36

/** 打开等比：以当前横向缩放收敛为统一 scale */
export function withUniformEnabled(t: ClipTransform, b?: TransformBounds): ClipTransform {
  const scale = t.uniform ? t.scale : (t.scaleX + t.scaleY) / 2
  return normalizeTransform({ ...t, uniform: true, scale }, b)
}

/** 关闭等比：用当前 scale 初始化两轴 */
export function withUniformDisabled(t: ClipTransform, b?: TransformBounds): ClipTransform {
  return normalizeTransform({ ...t, uniform: false, scaleX: t.scale, scaleY: t.scale }, b)
}

/** 设置统一缩放（滑杆 / 百分比，等比态） */
export function withScale(t: ClipTransform, scale: number): ClipTransform {
  return normalizeTransform({ ...t, scale })
}

/** 设置单轴缩放（非等比态） */
export function withAxisScale(t: ClipTransform, axis: 'x' | 'y', value: number): ClipTransform {
  return normalizeTransform({ ...t, [axis === 'x' ? 'scaleX' : 'scaleY']: value })
}

export function withPosition(t: ClipTransform, axis: 'x' | 'y', value: number): ClipTransform {
  return normalizeTransform({ ...t, [axis]: value })
}

export function withRotation(t: ClipTransform, rotation: number): ClipTransform {
  return normalizeTransform({ ...t, rotation })
}

export function resetTransform(): ClipTransform {
  return createDefaultTransform()
}

export function isDefaultTransform(t: ClipTransform | null | undefined): boolean {
  if (!t) return true
  const n = normalizeTransform(t)
  return n.scale === 1 && n.scaleX === 1 && n.scaleY === 1 && n.x === 0 && n.y === 0 && n.rotation === 0 && n.uniform === true
}

/**
 * 逻辑像素 → 屏幕显示像素的换算系数。
 * 比例视图短边 = LOGICAL_SHORT_SIDE 对应舞台比例框短边。
 */
export function logicalToScreenScale(viewShortSidePx: number): number {
  return viewShortSidePx / LOGICAL_SHORT_SIDE
}

/**
 * 计算给定比例视图下的逻辑画布尺寸（短边 1080）。
 * @param ratio 宽/高
 */
export function logicalCanvasSize(ratio: number): { width: number; height: number } {
  if (ratio >= 1) return { width: Math.round(LOGICAL_SHORT_SIDE * ratio), height: LOGICAL_SHORT_SIDE }
  return { width: LOGICAL_SHORT_SIDE, height: Math.round(LOGICAL_SHORT_SIDE / ratio) }
}
