/* ============================================================
 *  播放器内核 · 常量
 *  从原 mediaBunnyPlayer.ts 抽出：时间码帧率、画面比例预设、
 *  画质四档、预览缩放 / 导航小窗参数。
 *  （底栏图标统一在 utils/icons.ts 的 PLAYER_ICONS / FS_ICONS）
 * ============================================================ */

/** 时间码帧率（与时间轴 TIMELINE_FPS 一致，底栏按 HH:MM:SS:FF 显示帧号） */
export const TC_FPS = 30

/** 画面比例固定预设项（另有一个特殊项 fit＝适应（原始）） */
export interface RatioOption {
  key: string
  label: string
  ratio: number | null
}
export const RATIO_PRESETS: RatioOption[] = [
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '2.35:1', label: '2.35:1', ratio: 2.35 },
  { key: '2:1', label: '2:1', ratio: 2 },
  { key: '1.85:1', label: '1.85:1', ratio: 1.85 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  // 剪映「5.8寸」：1125×2436
  { key: '5.8', label: '5.8寸', ratio: 1125 / 2436 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '1:2', label: '1:2', ratio: 1 / 2 }
]
/** 比例菜单中的分组分隔线位置（位于该 key 行之前） */
export const RATIO_DIVIDERS_BEFORE = ['16:9', '9:16']
/** 适应（原始）：视图 / 画布取主轨第一个资源的原生大小；没有主轨资源时 1600×9000 */
export const RATIO_FIT: RatioOption = { key: 'fit', label: '适应（原始）', ratio: null }
/** 主轨没有可参照资源时的默认画布 / 视图大小 */
export const DEFAULT_ORIGIN_SIZE = { w: 1600, h: 9000 } as const

/**
 * 播放画质：预览管线的三个降负载杠杆（仅影响预览，不影响导出）。
 * - maxEdge：中间离屏缓冲长边上限（0＝原生），降低 VideoFrame 绘制 + GPU 纹理上传 + 合成填充开销
 * - resolution：pixi 渲染分辨率（devicePixelRatio 倍率），降低屏幕侧填充率
 * - maxFps：预览呈现帧率上限（0＝随源不限），低档位直接减少绘制/上传/合成次数；
 *   帧泵是「呈现一帧后才拉下一帧」的串行背压模型，呈现变慢后解码取帧节奏同步放缓
 * 采样方式统一为 LINEAR。
 */
export interface QualityOption {
  key: string
  label: string
  /** 底栏画质按钮的短名（原画 / 清晰 / 流畅 / 低清），菜单里仍用完整 label */
  short: string
  sub: string
  maxEdge: number
  resolution: (dpr: number) => number
  maxFps: number
}
export const QUALITY_OPTIONS: QualityOption[] = [
  { key: 'origin', label: '原画质', short: '原画', sub: '保持原片清晰度', maxEdge: 0, resolution: dpr => dpr, maxFps: 0 },
  { key: 'clear', label: '清晰画质', short: '清晰', sub: '播放流畅，不影响导出质量', maxEdge: 720, resolution: dpr => Math.min(dpr, 1.5), maxFps: 0 },
  { key: 'smooth', label: '流畅画质', short: '流畅', sub: '播放更流畅，不影响导出质量', maxEdge: 480, resolution: () => 1, maxFps: 30 },
  { key: 'low', label: '低清画质', short: '低清', sub: '播放最流畅，不影响导出质量', maxEdge: 360, resolution: () => 1, maxFps: 20 }
]

/** 画面填充：预览缩放下限（1＝适应窗口）/ 上限（400%）/ 步进（10%） */
export const CANVAS_ZOOM_MIN = 1
export const CANVAS_ZOOM_MAX = 4
export const CANVAS_ZOOM_STEP = 0.1
/** 放大后右下角导航小窗内帧框的最大尺寸（CSS 像素） */
export const NAV_PREVIEW_W = 150
export const NAV_PREVIEW_H = 90

/** 比例小图标：16×16 框内按比例居中的描边矩形 */
export function ratioGlyph(ratio: number): string {
  const BOX = 16
  const w = ratio >= 1 ? BOX : Math.max(5, Math.round(BOX * ratio))
  const h = ratio >= 1 ? Math.max(5, Math.round(BOX / ratio)) : BOX
  return `<span class="jy-pop-glyph"><i style="width:${w}px;height:${h}px"></i></span>`
}
