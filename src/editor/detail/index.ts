/* ============================================================
 *  编辑器框架 · 模块三：右侧详情（无手动页签，按选中类型自动切换）
 *
 *  右栏没有任何可点击的页签按钮——显示哪一类视图完全由当前
 *  选中片段决定，四类内容各自独立文件：
 *    空选            → panes/draft.ts   草稿参数（名称 + 工程参数）
 *    视频 / 图片 / 贴纸 → panes/picture.ts 画面（位置大小 / 混合 / 音量控制 / 裁剪）
 *    文字            → panes/text.ts    文字（内容 / 字体 / 位置 / 混合 / 描边 / 背景 / 发光 / 阴影）
 *    音频            → panes/audio.ts   音频（音量控制；音量 / 淡入淡出）
 *
 *  本文件只负责：对外类型与 createDetailPanel 装配、选中态分发、
 *  视图共享工具（行结构 / 时间格式化）与时长裁剪只读组。
 *  文字各选项组与音量控制组拆分在 sections/ 下，按选项组独立成文件。
 *  数据由 editorPage 维护；选中片段后 setSelection() 按类型自动切视图。
 * ============================================================ */
import type { ClipTransform, MaterialsData, TextAlign, TextBackground, TextBlend, TextGlow, TextShadow, TextStroke, TextVAlign, TrackObjectType } from '../types'
import { normalizeTransform, TEXT_SCALE_BOUNDS, type TransformBounds } from '../transform'
import { renderDraft, bindDraft, setDraftExportEnabled, draftCanvasSize } from './panes/draft'
import { renderPicture, bindPicture, syncPictureTransform, syncPictureValues } from './panes/picture'
import { renderText, bindText, syncTextTransform, syncTextValues } from './panes/text'
import { renderAudio, bindAudio, syncAudioValues } from './panes/audio'

/** 按比例换算草稿画布像素（editorPage 收播放器 ratio:change 时使用） */
export { draftCanvasSize }

export interface DetailData {
  title: string
  materials: MaterialsData
  materialsSavedAt: string | null
  /** 当前工程比例标签（随播放器比例菜单联动；「适应（原始）」跟随主轨资源） */
  ratioLabel: string
  /** 画布像素宽 / 高（「适应（原始）」为主轨第一个资源大小，固定预设按短边 1080） */
  canvasW: number
  canvasH: number
}

/** 片段时长裁剪信息（对齐 asconfig「时长裁剪」折叠组，全部只读） */
export interface ClipTiming {
  /** 素材原时长（秒） */
  sourceDuration: number
  /** 素材分辨率（有则展示） */
  width?: number
  height?: number
  /** 时间线播放起点 / 终点（秒） */
  start: number
  end: number
  /** 素材入点＝起点裁剪量（秒） */
  sourceStart: number
}

/** 声音设置（视频原声 / 音频片段，均可编辑） */
export interface ClipAudioProps {
  /** 音量倍率 0-2（面板按 0-200% 编辑） */
  volume: number
  /** 淡入 / 淡出时长（秒） */
  fadeIn: number
  fadeOut: number
  /** 片段静音 */
  muted: boolean
}

/** 文字属性（字体设置 + 可选描边 / 阴影，均可编辑） */
export interface DetailTextProps {
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
  /** 竖排（true 时对齐方式取 valign：上 / 中 / 下；横排取 align：左 / 中 / 右） */
  vertical: boolean
  stroke: TextStroke
  shadow: TextShadow
  /** 混合（整体不透明度） */
  blend: TextBlend
  /** 背景底板 */
  background: TextBackground
  /** 外发光 */
  glow: TextGlow
}

/** 当前选中的片段（EditorPage 维护并下发；字段按 type 取用） */
export interface DetailSelection {
  id: string
  type: TrackObjectType
  /** 画面页（视频 / 图片 / 贴纸） */
  transform?: ClipTransform
  /** 不透明度 0-1（画面页） */
  opacity?: number
  /** 片段名（音频 / 文字页展示用） */
  name?: string
  /** 文字页内容 */
  text?: DetailTextProps
  /** 声音设置（视频原声 / 音频片段） */
  audio?: ClipAudioProps
  /** 时长裁剪只读信息（画面 / 音频） */
  timing?: ClipTiming
}

/** @deprecated 兼容旧命名，等价 DetailSelection */
export type PictureSelection = DetailSelection

/** 选中片段引用盒（视图绑定长生命周期，同 id 重同步时整体换对象） */
export interface DetailSelectionRef {
  current: DetailSelection | null
}

/** 注入四个视图的共享上下文（行结构 / 格式化工具 + 时长裁剪只读组） */
export interface DetailViewCtx {
  callbacks: DetailCallbacks
  row: (k: string, vHtml: string) => string
  escapeHtml: (s: string) => string
  fmtClock: (s: number | undefined | null) => string
  clampNum: (v: number, min: number, max: number) => number
  renderTimingGroup: (sel: DetailSelection) => string
}

/** 面板回调（数据由 EditorPage 维护） */
export interface DetailCallbacks {
  onTitleChange: (title: string) => void
  /** 面板控件拖拽 / 输入中的实时值（不入栈 / 不落盘）；bounds 为该入口的缩放范围 */
  onTransformLive?: (t: ClipTransform, bounds?: TransformBounds) => void
  /** 一次编辑结束（松手 / 失焦 / 回车 / 开关切换 / 重置） */
  onTransformCommit?: (t: ClipTransform, bounds?: TransformBounds) => void
  /** 不透明度拖动中（仅实时上屏）/ 一次编辑结束（入栈落盘） */
  onOpacityLive?: (v: number) => void
  onOpacityCommit?: (v: number) => void
  /**
   * 音频片段参数（音量 dB / 淡入 / 淡出）实时调整：
   * 轨道滑杆 / 面板滑杆 / spin 按钮 input 事件高频回调，外层轻量更新，first=true 时拍撤销快照。
   * 面板与轨道手势共用同一对回调。
   */
  onAudioLive?: (itemId: string, patch: Partial<ClipAudioProps>, first: boolean) => void
  /** 音频片段一次编辑结束（松手 / 失焦 / 回车）：一次性入栈落盘 */
  onAudioCommit?: (itemId: string) => void
  /** 文字属性输入中（实时重绘，不落盘）/ 一次编辑结束（入栈落盘） */
  onTextLive?: (patch: Partial<DetailTextProps>) => void
  onTextCommit?: () => void
  /** 文字位置快速对齐：单轴按钮（左 / 水平居中 / 右 · 顶 / 垂直居中 / 底），null 轴不动 */
  onClipAlign?: (h: TextAlign | null, v: TextVAlign | null) => void
  /** 视图随选中类型切换（外部据此更新顶部提示：草稿参数 / 画面 / 文字 / 音频） */
  onViewChange?: (label: string) => void
  /** 草稿参数底部的「导出视频」按钮 */
  onExportVideo?: () => void
}

export interface DetailPanelHandle {
  /** 数据变更后整体重绘（当前视图由选中态决定） */
  render: () => void
  /** 设置 / 清除选中片段（按类型自动切 画面 / 文字 / 音频，null 回草稿参数） */
  setSelection: (sel: DetailSelection | null) => void
  /** 外部（播放器操作框）高频回显当前变换，只刷控件值不重建 DOM */
  syncTransform: (t: ClipTransform, bounds?: TransformBounds) => void
  /** 时间线是否有可导出片段（空工程 / 全部隐藏时按钮置灰） */
  setExportEnabled: (enabled: boolean) => void
  destroy: () => void
}

/** 四类视图（无手动页签，仅用于内部分发与顶部提示） */
export type DetailViewKind = 'draft' | 'picture' | 'text' | 'audio'

/** 视图 → 顶部提示文案 */
const VIEW_LABELS: Record<DetailViewKind, string> = {
  draft: '草稿参数',
  picture: '画面',
  text: '文字',
  audio: '音频'
}

/** 选中片段类型 → 落地视图 */
function viewOf(sel: DetailSelection | null): DetailViewKind {
  if (!sel) return 'draft'
  if (sel.type === 'text' || sel.type === 'caption') return 'text'
  if (sel.type === 'audio') return 'audio'
  return 'picture'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  )
}

/** 秒 → mm:ss.cs（厘秒，时长裁剪信息用；四舍五入避免浮点尾差） */
function fmtClock(s: number | undefined | null): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '--:--'
  const totalCs = Math.max(0, Math.round(s * 100))
  const m = Math.floor(totalCs / 6000)
  const sec = Math.floor((totalCs % 6000) / 100)
  const cs = totalCs % 100
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(m)}:${p2(sec)}.${p2(cs)}`
}

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function createDetailPanel(
  host: HTMLElement,
  data: DetailData,
  callbacks: DetailCallbacks
): DetailPanelHandle {
  /** 当前选中片段（视图事件经引用盒读取，同 id 重同步后不持旧对象） */
  const ref: DetailSelectionRef = { current: null }
  /** 草稿参数底部导出按钮是否可用（由 editorPage 随轨道变化同步） */
  let exportEnabled = false

  function row(k: string, vHtml: string) {
    return `<div class="ed-row"><span class="k">${k}</span><span class="v">${vHtml}</span></div>`
  }

  /** 时长裁剪只读折叠组 */
  function renderTimingGroup(sel: DetailSelection): string {
    const tm = sel.timing!
    const clipDur = Math.max(0, tm.end - tm.start)
    const tail = Math.max(0, tm.sourceDuration - tm.sourceStart - clipDur)
    const sizeRow =
      tm.width && tm.height ? row('素材尺寸', `${Math.round(tm.width)} × ${Math.round(tm.height)}`) : ''
    return `
      <div class="ed-pic-group">
        <div class="ed-pic-group-head"><span>时长裁剪</span></div>
        ${sizeRow}
        ${row('素材原时长', fmtClock(tm.sourceDuration))}
        ${row('播放起始', fmtClock(tm.start))}
        ${row('播放结束', fmtClock(tm.end))}
        ${row('当前播放时长', fmtClock(clipDur))}
        ${row('起点裁剪时长', fmtClock(tm.sourceStart))}
        ${row('终点裁剪时长', fmtClock(tail))}
      </div>`
  }

  /** 注入四个视图的共享上下文（工具 + 时长裁剪只读组） */
  const ctx = {
    callbacks,
    row,
    escapeHtml,
    fmtClock,
    clampNum,
    renderTimingGroup
  }

  function render() {
    const sel = ref.current
    const view = viewOf(sel)
    // 没有页签按钮：只有内容容器，视图完全由选中类型决定
    host.innerHTML = `<div class="ed-info-pane"></div>`
    const pane = host.querySelector('.ed-info-pane') as HTMLElement

    if (view === 'draft') {
      pane.classList.add('is-draft')
      pane.innerHTML = renderDraft(row, data, exportEnabled)
      bindDraft(host, data, callbacks.onTitleChange, () => callbacks.onExportVideo?.())
    } else if (view === 'picture') {
      pane.innerHTML = renderPicture(sel!, ctx)
      bindPicture(host, ref, ctx)
    } else if (view === 'text') {
      pane.innerHTML = renderText(sel!, ctx)
      bindText(host, ref, ctx)
    } else {
      pane.innerHTML = renderAudio(sel!, ctx)
      bindAudio(host, ref, ctx)
    }
  }

  function setSelection(sel: DetailSelection | null) {
    // 同一片段重复同步（撤销 / setTracks 后）：只刷数据不重建 DOM，避免抢焦点。
    if (sel && ref.current && sel.id === ref.current.id) {
      // 视频内嵌音轨异步探测完成时，音量控制组出现 / 消失会改变 DOM 结构，
      // 此时必须整体重绘（发生在面板未被用户聚焦操作的时机，可安全重建）
      const audioPresenceChanged = !!sel.audio !== !!ref.current.audio
      ref.current = sel
      if (audioPresenceChanged) {
        render()
        return
      }
      const view = viewOf(sel)
      if (view === 'picture') {
        if (sel.transform) {
          ref.current.transform = normalizeTransform(sel.transform)
          syncPictureTransform(host, sel.transform)
        }
        syncPictureValues(host, sel, host.ownerDocument.activeElement, ctx)
      } else if (view === 'text') {
        if (sel.transform) {
          ref.current.transform = normalizeTransform(sel.transform, TEXT_SCALE_BOUNDS)
          syncTextTransform(host, sel.transform)
        }
        syncTextValues(host, sel, host.ownerDocument.activeElement)
      } else if (view === 'audio') {
        syncAudioValues(host, sel, host.ownerDocument.activeElement, ctx)
      }
      return
    }
    ref.current = sel
    render()
    callbacks.onViewChange?.(VIEW_LABELS[viewOf(sel)])
  }

  function syncTransform(t: ClipTransform, bounds?: TransformBounds) {
    if (!ref.current) return
    const view = viewOf(ref.current)
    if (view !== 'picture' && view !== 'text') return
    // 文字面板允许 0% – 500%；未显式传 bounds 时按视图兜底，避免回灌被默认 0.1 – 4 钳制
    const b = bounds ?? (view === 'text' ? TEXT_SCALE_BOUNDS : undefined)
    const nt = normalizeTransform(t, b)
    ref.current.transform = nt
    // 轻量刷新控件值（不重建 DOM，不抢焦点）；根节点缺失时兜底整体重绘
    const ok = view === 'picture' ? syncPictureTransform(host, nt) : syncTextTransform(host, nt)
    if (!ok) render()
  }

  function setExportEnabled(enabled: boolean) {
    exportEnabled = enabled
    setDraftExportEnabled(host, enabled)
  }

  render()
  callbacks.onViewChange?.(VIEW_LABELS.draft)

  return { render, setSelection, syncTransform, setExportEnabled, destroy() {} }
}

export default createDetailPanel
