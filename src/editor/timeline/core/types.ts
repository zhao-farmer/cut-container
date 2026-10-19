/* ============================================================
 *  时间轴 · 对外 / 对内类型（TimelineTrack 拆分）
 * ============================================================ */
import type { TrackObject } from '../../types'
import type { AnyAddTrackPayload } from '../../materials'

/** pixi.js 命名空间类型（值在工厂内动态 import，这里只做标注） */
export type PixiNS = typeof import('pixi.js')

export interface TimelineSelection {
  trackId: string
  itemId: string
}

export type TimelineOp = 'split' | 'trim-left' | 'trim-right' | 'delete'

export interface OpResult {
  ok: boolean
  msg?: string
}

export interface TimelineCallbacks {
  /** 数据变更（移动 / 拖裁 / 分割 / 裁剪 / 删除），外层负责落盘与历史栈 */
  onCommit?: (next: TrackObject[], label: string) => void
  onSelect?: (sel: TimelineSelection | null) => void
  /** 右键片段（已自动选中）：弹出复制 / 剪切 / 删除菜单 */
  onClipContextMenu?: (sel: TimelineSelection, e: MouseEvent) => void
  /** 播放头定位（拖动结束 / 点击刻度区），外层可接到播放器 seek */
  onSeek?: (time: number) => void
  /**
   * 预览轴悬停（非播放态且预览轴开启）：鼠标移到哪一帧就把该时刻时间上抛，
   * 外层接到播放器做画面预览（不移动播放头）；null＝鼠标离开 / 预览失效，恢复播放头画面。
   */
  onPreview?: (time: number | null) => void
  /**
   * 素材库素材拖放到时间轴：起始秒（已帧吸附）+ 目标轨 id。
   * trackId 非空＝放入指定既有轨；null 时 createNew 区分：
   *   false＝媒体落入空主轨（进/建 layer0 主轨）；true＝空白 / 重叠 / 不兼容，始终新建一条同类型轨
   */
  onDropMaterial?: (
    payload: AnyAddTrackPayload,
    startSec: number,
    trackId: string | null,
    createNew: boolean
  ) => void
  /**
   * 轨道上既有子项被重新投放（块体拖拽，可上下左右跨轨）：
   * 外层负责把该 item 从源轨移走、落入 targetTrackId（null＝空主轨语义，找同类型轨）
   * 或新建同类型轨；源轨已空时删除该轨。startSec 已帧吸附。
   */
  onMoveItem?: (
    sourceTrackId: string,
    itemId: string,
    startSec: number,
    targetTrackId: string | null,
    createNew: boolean
  ) => void
  /**
   * Alt+← / Alt+→ 逐帧微调选中子项起点。按住连发时仅首帧 withHistory=true
   * （压一次撤销点），后续 repeat 帧为 false（实时替换，不压栈）。
   */
  onNudgeItem?: (trackId: string, itemId: string, startSec: number, withHistory: boolean) => void
  /**
   * 点击主轨时间 0 处的「封面」按钮（pixi 绘制的 40×40 图标块，随横滚移动）。
   * action='open'：点击面板 / 缩略图主体，打开封面设置弹窗；
   * action='remove'：点击已设封面缩略图右上角的 × 角标，直接移除封面。
   */
  onCover?: (action: 'open' | 'remove') => void
  /**
   * 标记列表在时间轴内部被改动（右键标尺小旗删除）。
   * times 为帧对齐 / 去重 / 升序后的新数组，外层负责持久化。
   */
  onMarkersChange?: (times: number[]) => void
  /**
   * 音频片段参数在轨道上被手势实时调整（音量白线 / 淡入淡出小球）：
   * 高频拖动回调，外层就地改工作副本 + 播放器轻量上屏，不落盘不入栈；
   * first=true 为该次手势首个 live，外层需先拍一份撤销快照。
   */
  onAudioLive?: (
    itemId: string,
    patch: { volume?: number; fadeIn?: number; fadeOut?: number },
    first: boolean
  ) => void
  /** 音频手势松手：外层把手势内累计的变更一次性入栈并落盘 */
  onAudioCommit?: (itemId: string) => void
  /**
   * 视频片段内嵌音轨探测完成（时间轴懒解码波形时触发，每个片段只回调一次）：
   * hasAudio=false 表示该视频源不含音轨，外层据此决定右侧面板是否显示音量控制组。
   */
  onClipAudioProbed?: (itemId: string, hasAudio: boolean) => void
}

export interface TimelineTrackHandle {
  setData: (data: TrackObject[] | null) => void
  /**
   * 轻量重绘（rAF 合帧）：外层就地改了同一引用数据（面板滑杆实时联动等）
   * 又不想走 setData 的重驱动时调用；不重建视图、不重排数据。
   */
  redraw: () => void
  /** 设置 / 清除封面缩略图（dataURL；null＝恢复笔形占位） */
  setCover: (image: string | null) => void
  setZoom: (level: number) => void
  getZoom: () => number
  setSnap: (on: boolean) => void
  /** 主轨磁吸开关：开启后主轨片段首尾相吸、删除 / 移走自动补位 */
  setMainSnap: (on: boolean) => void
  /** 预览轴开关：开启后鼠标在画布上移动时显示跟随的黄色竖线 */
  setPreviewAxis: (on: boolean) => void
  /**
   * 播放态同步：播放中预览轴失效（黄线隐藏、不上抛悬停预览）；
   * 非播放态且预览轴开启时，鼠标悬停位置的画面才输出到播放器。
   */
  setPlaying: (playing: boolean) => void
  getSelection: () => TimelineSelection | null
  /** 程序化选中（拖拽落轨后选中新子项） */
  select: (trackId: string, itemId: string) => void
  /** 清除选中（删除片段后调用） */
  clearSelection: () => void
  getPlayhead: () => number
  /**
   * 程序化设置播放头位置（秒）——用于播放器播放进度反向联动。
   * 与拖动不同：不触发 onSeek（避免 seek 回环），只重绘。
   * follow=true 时播放头走出可视区会自动横向滚动时间线跟随。
   */
  setPlayhead: (time: number, follow?: boolean) => void
  /** 播放头变淡（素材选中预览时 0.3）；false 恢复正常 */
  setPlayheadDimmed: (dim: boolean) => void
  /**
   * 设置时间线标记（秒数组）。内部会做帧对齐 / 去重 / 排序：
   * 标记自身锚定固定帧单位，标尺绘制白色小旗；吸附开启时素材首尾对齐标记帧出蓝线。
   */
  setMarkers: (times: number[]) => void
  applyOp: (op: TimelineOp) => OpResult
  destroy: () => void
}

export interface Lane {
  track: TrackObject | null
  y: number
  h: number
  isMain: boolean
}

export interface ClipGeom {
  x: number
  y: number
  w: number
  h: number
  mediaY: number
  mediaH: number
  waveY: number
  waveH: number
  /** 是否为媒体轨（主轨 layer0 70 高 / 素材轨 image 50 高）：满高 15 名称样式 */
  mediaLane: boolean
}
