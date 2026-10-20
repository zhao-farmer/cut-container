/* ============================================================
 *  编辑器框架 · 编辑器页面（CutContainer 的 dom 工厂）
 *
 *  这是"框架的一部分"：整个剪映风格编辑页都在容器内部（Shadow DOM）渲染。
 *  本文件只负责：样式注入 / 本地存储水合 / 静态骨架 / 四个模块的组装与
 *  数据流连接；四个页面模块各自独立成文件夹：
 *
 *    materials/  左侧素材库     （素材原始数据）
 *    player/     中部播放器     （mediabunny 封装 + 状态）
 *    detail/     右侧详情       （草稿/素材/轨道/播放器状态）
 *    timeline/   底部时间轴轨道 （pixi.js，轨道操作数据）
 *
 *  外部框架（Vue/React/Svelte/Solid）只通过 props 传两类数据：
 *    materials —— 素材原始数据
 *    tracks    —— 轨道操作数据
 *  框架拿到后：渲染 + 持久化到 localStorage；下次挂载优先水合本地数据。
 * ============================================================ */
import editorBaseCss from './css/base.css?inline'
import editorMaterialsCss from './css/materials.css?inline'
import editorPlayerCss from './css/player.css?inline'
import editorDetailCss from './css/detail.css?inline'
import editorTimelineCss from './css/timeline.css?inline'
import { bindSplitters } from './splitters'
import { editorStorage, isMaterialsData, isTrackObjectList } from './utils/storage'
import type {
  AnyTrackItem,
  AudioContent,
  AudioKind,
  CaptionContent,
  CaptionCue,
  CaptionItem,
  ClipTransform,
  MaterialItem,
  MaterialsData,
  TextContent,
  TrackItem,
  TrackObject,
  TrackObjectType
} from './types'
import { CAPTION_TEXT_DEFAULTS, DEFAULT_TEXT_ITEM, TRACK_LAYER, TRACK_NAME, resolveTextStyle } from './types'
import { isVisualType, logicalCanvasSize, normalizeTransform, TEXT_SCALE_BOUNDS, type TransformBounds } from './transform'
import { createMaterialsPanel, type AddTrackPayload, type AnyAddTrackPayload } from './materials'
import { installDomI18n, resolveLang, setLang, t } from './lang'
import { getDragPayload } from './materials/dragPayload'
import { createPlayerStage } from './player'
import { createStereoTap, VerticalLevelMeter } from './levelMeter'
import type { StereoTap } from './levelMeter'
import { parseCaption } from './codec/captionParse'
import {
  createDetailPanel,
  draftCanvasSize,
  type DetailData,
  type DetailTextProps
} from './detail'
import {
  createTimelineTrack,
  type TimelineSelection,
  type TimelineTrackHandle
} from './timeline'
import { createTimelineToolbar, timelineToolbarHtml } from './timeline/ui/toolbar'
import { FRAME_ICON, UPLOAD_ICON } from './utils/icons'
import { fetchCatalog, fetchRemoteConfig, loadAppConfig, deleteCatalogItem } from './services/backend'
import { mergeCatalogIntoMaterials } from './services/catalog'
import { addRemoteFonts } from './utils/customFonts'
import { restoreLocalMedia } from './utils/localMediaStore'
import { openClipMenu, setClipClipboard, getClipClipboard } from './timeline/manage/clipMenu'
import { bindTimelineShortcuts } from './timeline/manage/keyboard'

const PLAYER_TITLE_SUFFIX = ' · 时间线01'

/**
 * 编辑器样式：按区域拆分在 ./css 下（总背景 / 素材 / 播放器 / 详情 / 轨道），
 * 这里按序拼接后注入 Shadow DOM —— 顺序即层叠顺序，与拆分前单文件一致。
 */
const editorCss = [
  editorBaseCss,
  editorMaterialsCss,
  editorPlayerCss,
  editorDetailCss,
  editorTimelineCss
].join('\n')


/** 时间线帧率（必须与 TimelineTrack DEFAULT_TIMELINE_CONFIG.fps 一致：30fps） */
const TIMELINE_FPS = 30

/** 秒 → 最近帧时间（1/30s 网格）：所有子项起点 / 终点都落在坐标轴的帧上 */
const snapToFrame = (sec: number): number => Math.max(0, Math.round(sec * TIMELINE_FPS) / TIMELINE_FPS)

/**
 * 标记时间规范化：丢弃非有限值 → 帧对齐 → 按帧序号去重 → 升序。
 * 标记自身锚定固定帧单位（剪映语义），不允许落在两帧之间。
 */
function normalizeMarkerTimes(list: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const raw of list) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue
    const frameIdx = Math.round(raw * TIMELINE_FPS)
    if (seen.has(frameIdx)) continue
    seen.add(frameIdx)
    out.push(frameIdx / TIMELINE_FPS)
  }
  return out.sort((a, b) => a - b)
}

/**
 * 把工作副本中每个子项的起点 / 时长 / 素材入点对齐到帧网格（原地修改）。
 * 返回是否发生过修正（用于决定是否需要回写 localStorage）。
 */
function quantizeTrackItems(list: TrackObject[]): boolean {
  let changed = false
  const q = (v: number): number => {
    const nv = snapToFrame(v)
    if (nv !== v) changed = true
    return nv
  }
  for (const tr of list) {
    for (const it of tr.items) {
      it.start = q(it.start)
      it.duration = q(it.duration)
      if (typeof it.sourceStart === 'number') it.sourceStart = q(it.sourceStart)
    }
  }
  return changed
}

/**
 * 判断轨道上是否已存在与 [start, start+duration) 时间区间重叠的子项。
 * 端点相接（前一项终点恰好等于下一项起点）不算重叠；eps 为一帧。
 */
function trackHasOverlap(track: TrackObject, start: number, duration: number): boolean {
  const eps = 1 / TIMELINE_FPS
  return track.items.some(it => start < it.start + it.duration - eps && start + duration > it.start + eps)
}

/**
 * 主轨磁吸：新片段进入主轨时的追加起点＝最后一个可见片段的结尾（帧对齐），
 * 空主轨 / 无子项为 0。主轨磁吸开启时，无论指针 / 播放头在哪个时刻，
 * 新进入主轨的子项都立刻排在队伍末尾。
 */
function mainTrackAppendStart(track: TrackObject): number {
  const last = track.items
    .filter(it => it.visible !== false)
    .slice()
    .sort((a, b) => a.start - b.start)
    .pop()
  return last ? Math.max(0, snapToFrame(last.start + last.duration)) : 0
}

/**
 * 主轨磁吸：从主轨摘走一个片段（删除 / 移出）后，其后的片段整体左移补位，
 * 主轨始终无空隙。
 */
function rippleCloseAfterRemove(track: TrackObject, removedStart: number, removedDur: number) {
  const eps = 1 / TIMELINE_FPS
  for (const it of track.items) {
    if (it.start >= removedStart - eps) it.start = snapToFrame(it.start - removedDur)
  }
}

/* ---------- 封面图：源画面 → 居中正方形 JPEG dataURL ---------- */
const COVER_MAX_EDGE = 720

/** drawImage 源按中心裁成正方形并缩到 maxEdge 内，输出 jpeg dataURL */
function squareCoverDataUrl(source: CanvasImageSource, sw: number, sh: number): string {
  const side = Math.min(sw, sh)
  const out = Math.min(COVER_MAX_EDGE, Math.round(side))
  const c = document.createElement('canvas')
  c.width = out
  c.height = out
  c.getContext('2d')!.drawImage(
    source,
    (sw - side) / 2,
    (sh - side) / 2,
    side,
    side,
    0,
    0,
    out,
    out
  )
  return c.toDataURL('image/jpeg', 0.85)
}

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

/** 视频 seek 到指定时刻截帧（首帧兜底），返回正方形封面 dataURL */
function captureVideoCover(url: string, atSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    let done = false
    const timer = window.setTimeout(fail(new Error('视频取帧超时')), 12000)
    function cleanup() {
      window.clearTimeout(timer)
      v.removeAttribute('src')
      try {
        v.load()
      } catch {
        /* noop */
      }
    }
    function fail(err: Error) {
      return () => {
        if (done) return
        done = true
        cleanup()
        reject(err)
      }
    }
    v.addEventListener('loadedmetadata', () => {
      const dur = Number.isFinite(v.duration) ? v.duration : 0
      v.currentTime = Math.min(Math.max(0, atSec), Math.max(0, dur - 0.05))
    })
    v.addEventListener('seeked', () => {
      if (done) return
      if (!v.videoWidth || !v.videoHeight) {
        fail(new Error('视频无可用画面'))()
        return
      }
      done = true
      try {
        resolve(squareCoverDataUrl(v, v.videoWidth, v.videoHeight))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('截帧失败'))
      } finally {
        cleanup()
      }
    })
    v.addEventListener('error', fail(new Error('视频加载失败')))
    v.src = url
  })
}

/**
 * 新建一条与 payload 同类型的轨道并推入列表：
 * - 音频叠到现存音频轨之下（负层递减，永远在主轨下方）；
 * - 画面 / 装饰轨一律叠到当前所有轨道的最上方（现存最大层 +1）——
 *   不区分视频 / 图片 / 贴纸 / 文字，后添加的轨道行与画面层级都在最顶（剪映口径）；
 * - 主轨（layer0）尚不存在时，第一条视频 / 图片载荷新建的轨即主轨（媒体素材均可入主轨）。
 */
function createTrackForPayload(list: TrackObject[], payload: AnyAddTrackPayload): TrackObject {
  // 字幕与普通文本共用同一种文本轨：字幕载荷新建出来的轨道即文本轨
  const trackType: TrackObjectType = payload.type === 'caption' ? 'text' : payload.type
  let layer = TRACK_LAYER[trackType]
  if (payload.type === 'audio') {
    const audios = list.filter(t => t.type === 'audio')
    layer = audios.length ? Math.min(...audios.map(t => t.layer)) - 1 : TRACK_LAYER.audio
  } else {
    const topLayer = list.reduce((m, t) => Math.max(m, t.layer), 0)
    layer = topLayer + 1
    // 主轨（layer0）尚不存在时，第一条视频 / 图片载荷新建的轨即主轨（媒体素材均可入主轨）
    if (
      (payload.type === 'video' || payload.type === 'image') &&
      !list.some(t => t.layer === 0)
    ) {
      layer = 0
    }
  }
  const track: TrackObject = {
    id: `tr-${trackType}-${Date.now().toString(36)}`,
    type: trackType,
    name: TRACK_NAME[trackType],
    layer,
    items: []
  }
  list.push(track)
  return track
}

/** 字幕片段默认纵向位置（逻辑像素，短边 1080 口径；约 85% 高度，贴画面下方） */
const CAPTION_DEFAULT_Y = 380

/** 轨道既有子项 → 新建同类型轨道用的载荷（块体拖拽到空白 / 重叠区时复用避让逻辑） */
function payloadOfTrackItem(it: AnyTrackItem): AnyAddTrackPayload {
  return {
    type: it.type,
    name: it.name,
    duration: it.duration,
    materialId: it.materialId,
    source: it.source
  } as AnyAddTrackPayload
}

/** 外部未传素材时的空八分类骨架 */
const EMPTY_MATERIALS: MaterialsData = {
  material: [],
  audio: [],
  text: { defaults: [DEFAULT_TEXT_ITEM], templates: [] },
  caption: [],
  sticker: [],
  filter: [],
  effect: [],
  transition: []
}

/**
 * 把载荷构造为具体类型的轨道子项并追加到轨道。
 * 用泛型保留 type 与 source 的关联（AnyAddTrackPayload 是分发联合，
 * 直接在普通函数里构造会丢失 type↔source 的对应关系导致 TS 报错）。
 */
function appendItem<K extends TrackObjectType>(
  track: TrackObject,
  payload: AddTrackPayload<K>,
  start: number
): TrackItem<K> {
  const item: TrackItem<K> = {
    id: `op-${payload.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: payload.type,
    name: payload.name,
    // 起点 / 时长都吸附到帧网格：子项左右缘与坐标轴帧一一对应
    start: snapToFrame(start),
    duration: snapToFrame(payload.duration),
    materialId: payload.materialId,
    visible: true,
    status: 1,
    source: payload.source
  }
  // item 在泛型内部保持 type↔source 关联；进入 AnyTrackItem[] 时做一次受控断言
  track.items.push(item as AnyTrackItem)
  return item
}

export function createEditorPage(
  rootEl: HTMLElement,
  props: Record<string, any>,
  emit: (name: string, detail: any) => void
) {
  // ---------- 样式注入（Shadow DOM 内） ----------
  const styleEl = document.createElement('style')
  styleEl.textContent = editorCss
  rootEl.appendChild(styleEl)
  // 导出进度遮罩用 absolute 居中于编辑器区域（需要根节点作为定位上下文）
  if (getComputedStyle(rootEl).position === 'static') rootEl.style.position = 'relative'

  // ---------- 数据：默认本地存储水合优先；外部配置要求 replaceStorage 时以 props 为准 ----------
  // createApp().loadConfig() 从外部 JSON 加载工程数据时，props 应覆盖本地旧缓存，
  // 否则用户新配置会被上一次编辑的 localStorage 遮蔽。
  const replaceStorage = props.replaceStorage === true
  const usePropMaterials = replaceStorage && isMaterialsData(props.materials)
  const usePropTracks = replaceStorage && isTrackObjectList(props.tracks)
  const storedM = usePropMaterials ? null : editorStorage.loadMaterials()
  const storedT = usePropTracks ? null : editorStorage.loadTracks()
  // 旧版本字幕独占 caption 轨：字幕现已与普通文本共用同一条文本轨，
  // 加载时把旧 caption 轨道类型并入 text（caption 子项保留自身类型 / 底色 / 前缀图标）
  if (storedT) {
    for (const t of storedT.data) {
      if (t.type === 'caption') t.type = 'text'
    }
  }
  // 主轨封面（dataURL 或 null）：由时间轴封面按钮弹窗设置，独立于 tracks 存储
  let coverImage: string | null = editorStorage.loadCover()?.data.image ?? null

  // 时间线标记（秒，帧对齐 / 排序 / 去重后的工作副本）：独立于 tracks 存储，
  // 标尺显示 7×11px 青色盾牌；自动吸附开启时素材首尾对齐标记帧出蓝色吸附线。
  const markers: number[] = normalizeMarkerTimes(editorStorage.loadMarkers()?.data ?? [])
  if (markers.length > 0) editorStorage.saveMarkers(markers)

  // 本地水合与外部 props 都必须通过严格形状校验，任一不过即逐级兜底，杜绝脏数据挂载崩溃
  const materialsSource: MaterialsData = isMaterialsData(storedM?.data)
    ? storedM.data
    : isMaterialsData(props.materials)
      ? props.materials
      : EMPTY_MATERIALS
  // 默认文本归一：产品口径只保留唯一内建项「默认文本」（旧本地缓存的
  // 标题 / 副标题 / 正文 / 字幕条在此收敛）。
  // 模板文本是外部内建数据（用户不可在面板内编辑 / 新增），始终以最新 props
  // 为准，避免旧缓存里的历史样式描述（如 CSS 键值时代）遮蔽新版矢量样式。
  const legacyDefaults = materialsSource.text?.defaults ?? []
  const propTemplates = isMaterialsData(props.materials) ? props.materials.text?.templates : null
  const templates =
    propTemplates && propTemplates.length > 0
      ? propTemplates
      : (materialsSource.text?.templates ?? [])
  const materials: MaterialsData = {
    ...materialsSource,
    text: { defaults: [DEFAULT_TEXT_ITEM], templates }
  }
  // 兼容旧缓存 / 外部 props：补齐 remote_file / local_file / url 三者
  // - source: remote_file（后端目录 / 上传）或 local_file（本地文件）
  // - url: 播放与展示统一使用它
  for (const m of materials.material) {
    if (!m.url) m.url = m.remote_file || m.local_file || ''
    if (!m.source) {
      m.source = m.local_file && !m.remote_file
        ? 'local_file'
        : m.url.startsWith('blob:') || m.url.startsWith('data:')
          ? 'local_file'
          : 'remote_file'
    }
    if (m.source === 'remote_file' && !m.remote_file) m.remote_file = m.url
    if (m.source === 'local_file' && !m.local_file) m.local_file = m.url
  }
  const defaultsDirty =
    legacyDefaults.length !== 1 ||
    legacyDefaults[0]?.id !== DEFAULT_TEXT_ITEM.id
  // 模板与缓存不一致（内建模板更新）时顺带回写，完成旧缓存自愈
  const templatesDirty =
    !!storedM?.data &&
    JSON.stringify(storedM.data.text?.templates ?? []) !== JSON.stringify(templates)
  if (defaultsDirty || templatesDirty) {
    editorStorage.saveMaterials(materials)
  }
  const storedTracks = isTrackObjectList(storedT?.data)
    ? storedT.data
    : isTrackObjectList(props.tracks)
      ? props.tracks
      : null

  // 时间线工作副本：轨道对象数组（localStorage tracks 的形状）。
  // 素材库「添加」就地变更它，再统一落盘 / 驱动 pixi；无数据时为空数组。
  const trackObjects: TrackObject[] = storedTracks ? [...storedTracks.map(t => ({ ...t, items: [...t.items] }))] : []
  // 水合后统一做帧对齐：既有数据（如 5.056s 的视频）起点 / 终点也一一落在坐标轴帧上；
  // 有修正或数据本就来自外部 props 时，回写一次 localStorage
  const tracksQuantized = trackObjects.length > 0 && quantizeTrackItems(trackObjects)

  /** 是否有可导出的片段（隐藏片段不计，与导出函数守卫一致） */
  const hasExportableContent = () =>
    trackObjects.some(tr => tr.items.some(it => it.visible !== false))

  const detailData: DetailData = {
    title: props.title || '未命名草稿',
    materials,
    materialsSavedAt: storedM?.savedAt ?? null,
    // 默认「适应（原始）」：主轨有资源时取第一个资源大小，没有时 1600×900（16:9）
    ratioLabel: '适应（原始）',
    canvasW: 1600,
    canvasH: 900
  }

  // 首次运行（本地无缓存）：外部传入的数据立即落盘
  if (!storedM && isMaterialsData(props.materials)) detailData.materialsSavedAt = editorStorage.saveMaterials(materials)
  if (!storedT && storedTracks && storedTracks.length > 0) editorStorage.saveTracks(trackObjects)
  if (storedT && tracksQuantized) editorStorage.saveTracks(trackObjects)

  // ---------- 静态骨架（四个模块的挂载点 + 三条分隔条） ----------
  const shell = document.createElement('div')
  shell.className = 'ed-shell'
  shell.innerHTML = `
    <div class="ed-main">
      <aside class="ed-left">
        <div class="ed-tabs" data-role="tabs"></div>
        <div class="ed-tabpanel" data-role="tabpanel"></div>
      </aside>

      <div class="ed-split-h" data-split="left"></div>

      <main class="ed-center">
        <div class="ed-stage" data-role="stage"></div>
      </main>

      <div class="ed-split-h" data-split="right"></div>

      <aside class="ed-right">
        <div class="ed-panel-head" data-role="detail-head">草稿参数</div>
        <div class="ed-right-body" data-role="detail"></div>
      </aside>
    </div>

    <div class="ed-split-v" data-split="timeline"></div>

    <!-- 底部行：轨道模块 + 第五模块（竖井电平表），同高并排、可左右拉宽 -->
    <div class="ed-bottom">
    <section class="ed-timeline">
      ${timelineToolbarHtml()}
      <div class="ed-tl-canvas" data-role="track"></div>
    </section>

    <!-- 第五模块：竖井电平表（与轨道模块同高并排，中间分隔条可左右拉宽，常驻） -->
    <div class="ed-split-h" data-split="vumeter"></div>
    <aside class="ed-vumeter" data-role="vumeter"></aside>
    </div>
  `
  rootEl.appendChild(shell)

  // ---------- 语言：英文模式下把 Shadow DOM 中的中文文案替换为英文 ----------
  const lang = resolveLang(props.lang)
  // 同步全局语言，供 canvas 绘制的文案（时间轴空态 / 封面）读取同一语言
  setLang(lang)
  shell.classList.toggle('lang-en', lang === 'en')
  // 面板的右键菜单 / 重命名弹窗挂在 ShadowRoot 上（不在 shell 内），
  // 因此监听范围取整个 ShadowRoot；非 Shadow DOM 环境退回 rootEl。
  const i18nRoot = rootEl.getRootNode() instanceof ShadowRoot ? (rootEl.getRootNode() as ShadowRoot) : rootEl
  const disposeI18n = installDomI18n(i18nRoot, lang)

  const $ = <T extends HTMLElement>(role: string) => shell.querySelector<T>(`[data-role="${role}"]`)!

  // ---------- 上三区拖拽光标：素材库复制（＋），播放器 / 草稿区禁止放入（⊘） ----------
  // 只有底部轨道区真正接收落轨；这里 drop 仅吞掉默认行为（避免浏览器跳转/打开文件），
  // 不产生数据。preventDefault + dropEffect=none 即呈现 not-allowed 且 drop 不生效。
  const dndZones: Array<{ sel: string; effect: 'copy' | 'none' }> = [
    { sel: '.ed-left', effect: 'copy' },
    { sel: '.ed-center', effect: 'none' },
    { sel: '.ed-right', effect: 'none' }
  ]
  for (const { sel, effect } of dndZones) {
    const zone = shell.querySelector<HTMLElement>(sel)
    if (!zone) continue
    zone.addEventListener('dragenter', e => {
      if (getDragPayload()) e.preventDefault()
    })
    zone.addEventListener('dragover', e => {
      if (getDragPayload() && e.dataTransfer) {
        e.preventDefault()
        e.dataTransfer.dropEffect = effect
      }
    })
    zone.addEventListener('drop', e => {
      if (getDragPayload()) e.preventDefault()
    })
  }

  // ---------- 模块二：播放器（素材库点击载入依赖它） ----------
  // 右侧详情已改为四分类信息页，不再展示播放器实时状态，onState 传空函数。
  const firstVideo = materials.material.find(m => m.kind === 'video' && m.url)
  // 播放器播放进度 → 反向联动时间轴播放头（与下方轨道位置保持一致）。
  // 素材选中预览状态（需先于 onPlayerEvent 声明：预览期间播放器事件不得驱动时间线）
  let previewMaterial: MaterialItem | null = null
  /** 进入预览前的时间线状态（位置 / 播放态 / 选中），退出时原样恢复 */
  let previewSession: {
    time: number
    wasPlaying: boolean
    selection: TimelineSelection | null
  } | null = null

  // tlHandle 在下方时间轴异步初始化后赋值，回调触发时必然已就绪。
  const onPlayerEvent = (name: string, detail: any) => {
    // 播放器比例菜单 → 右栏「草稿参数」的比例 / 画布宽高联动
    if (name === 'ratio:change') {
      // 「适应（原始）」发主轨第一个资源的确切大小；固定预设发宽高比。
      if (detail && typeof detail.key === 'string') {
        // 比例变化时按新旧画布尺寸等比换算元素位置：
        // 16:9 左上角的文字到 4:3 仍保持相对画布的位置，而不是落到新视口外。
        if (
          typeof detail.oldRatio === 'number' &&
          typeof detail.ratio === 'number' &&
          detail.oldRatio > 0 &&
          detail.ratio > 0 &&
          detail.oldRatio !== detail.ratio
        ) {
          rescaleTransformsForRatio(detail.oldRatio, detail.ratio)
        }
        detailData.ratioLabel = typeof detail.label === 'string' ? detail.label : detailData.ratioLabel
        const size = detail.size
        if (size && Number(size.w) > 0 && Number(size.h) > 0) {
          detailData.canvasW = Math.round(size.w)
          detailData.canvasH = Math.round(size.h)
        } else if (typeof detail.ratio === 'number') {
          const { w, h } = draftCanvasSize(detail.key, detail.ratio)
          detailData.canvasW = w
          detailData.canvasH = h
        }
        rerenderDetail()
      }
      emit(name, detail)
      return
    }
    // 底栏格子电平表＝竖井电平表开关：连同分隔条一起显隐（时间轴区自动伸缩）
    if (name === 'level:toggle-vu') {
      shell.classList.toggle('is-vu-hidden')
      return
    }
    if (
      !previewMaterial &&
      tlHandle &&
      (name === 'media:play' ||
        name === 'media:timeupdate' ||
        name === 'media:pause' ||
        name === 'media:ended') &&
      detail &&
      typeof detail.currentTime === 'number'
    ) {
      tlHandle.setPlayhead(detail.currentTime, true)
    }
    // 播放态同步给时间轴：播放中预览轴失效，暂停 / 结束后悬停预览恢复
    // 预览单素材期间不同步，避免预览播放影响时间线的播放态 / 播放头
    if (tlHandle && !previewMaterial) {
      if (name === 'media:play') tlHandle.setPlaying(true)
      else if (name === 'media:pause' || name === 'media:ended') tlHandle.setPlaying(false)
    }
    emit(name, detail)
  }
  const playerStage = createPlayerStage(
    $<HTMLElement>('stage'),
    {
      src: firstVideo?.url ?? '',
      title: `${detailData.title}${PLAYER_TITLE_SUFFIX}`,
      // 始终进入时间线模式：没有轨道时保持空工程，避免库在 file:// / 无后端场景
      // 默认去加载 /sample.mp4（会触发跨源 fetch 报错）
      timelineTracks: trackObjects
    },
    () => {},
    onPlayerEvent
  )

  // ---------- 竖井电平表（第五模块，常驻）：时间线播放 / 音乐试听统一由 player 的活动 tap 驱动 ----------
  const vuMeter = new VerticalLevelMeter($<HTMLElement>('vumeter'))
  playerStage.setTapListener(tap => {
    if (tap) vuMeter.start(tap)
    else vuMeter.stop()
  })
  // 试听元素的 Web Audio 接管图（每个试听元素仅能 createMediaElementSource 一次；ctx 复用单例）
  let auditionCtx: AudioContext | null = null
  let auditionSource: MediaElementAudioSourceNode | null = null
  let auditionTap: StereoTap | null = null
  function teardownAuditionGraph() {
    try {
      auditionSource?.disconnect()
    } catch {
      /* 节点已随 context 释放 */
    }
    auditionTap?.dispose()
    auditionSource = null
    auditionTap = null
  }
  function handleAudition(el: HTMLAudioElement | null, _kind: AudioKind) {
    if (el) {
      // 音频面板试听（音乐 / 音效）统一接管电平：底栏格子表 + 右下角竖井表联动
      teardownAuditionGraph()
      try {
        if (!auditionCtx) auditionCtx = new AudioContext()
        if (auditionCtx.state === 'suspended') void auditionCtx.resume()
        auditionSource = auditionCtx.createMediaElementSource(el)
        auditionTap = createStereoTap(auditionCtx, auditionSource)
        auditionSource.connect(auditionCtx.destination)
        // 格子表与竖井表同源一份试听数据（竖表经 player 的 tap 监听自动切换）
        playerStage.setLevelTap(auditionTap)
      } catch (err) {
        console.warn('[editor] 试听电平表接线失败:', err)
        teardownAuditionGraph()
      }
    } else {
      // 停止 / 播完 / 切分类 / 切 tab / 页面销毁：拆图，格子表还原时间线源；竖表缓落或切回时间线 tap
      teardownAuditionGraph()
      playerStage.setLevelTap(null)
    }
  }

  // ---------- 模块一：左侧素材库 ----------
  const materialsPanel = createMaterialsPanel(
    $<HTMLElement>('tabs'),
    $<HTMLElement>('tabpanel'),
    materials,
    m => {
      if (m.url) playerStage.load(m.url)
    },
    {
      // 外部可配置素材库只展示哪些选项卡（如只开前四项：material/audio/text/caption）
      tabs: Array.isArray(props.tabs) ? props.tabs : undefined,
      // 面板内上传 / 提取导致素材变更：落盘并刷新右侧详情
      onChange: next => {
        detailData.materials = next
        detailData.materialsSavedAt = editorStorage.saveMaterials(next)
        rerenderDetail()
      },
      // 素材 / 文本 ＋：排到同轨末尾，总时长随之延长
      onAddTrack: op => addTrackOp(op),
      // 字幕文件：按对白区间批量入轨（一条 cue 一个字幕片段）
      onAddCaptionClips: (item, cues, raw) => addCaptionClipsOp(item, cues, raw),
      // 音乐试听 → 播放器右侧竖井电平表（音效不出现）
      onAudition: handleAudition,
      // 素材卡片选中 → 播放器进入单资源预览
      onSelect: m => setMaterialPreview(m),
      // 素材库重命名 / 删除 → 同步时间轴里的同名片段 / 清理被删素材的片段
      onRenameItem: (id, name) => handleMaterialRenamed(id, name),
      onDeleteItem: id => handleMaterialDeleted(id)
    }
  )

  // ---------- 模块三：右侧详情（清除缓存入口已上移到标题栏「文件」菜单） ----------
  // 右栏无手动页签：顶部提示随选中类型切换（草稿参数 / 画面 / 文字 / 音频）
  const detailHead = $<HTMLElement>('detail-head')
  /** 导出入口前向引用：详情面板创建早于 onExportVideo 定义 */
  let triggerExport: (() => void) | null = null
  const detailPanel = createDetailPanel($<HTMLElement>('detail'), detailData, {
    onViewChange: label => {
      detailHead.textContent = label
    },
    onExportVideo: () => triggerExport?.(),
    onTitleChange: title => {
      // 回写数据层：右栏页签切换等场景重绘时保留已编辑的草稿名
      detailData.title = title
      playerStage.setTitle(`${title}${PLAYER_TITLE_SUFFIX}`)
    },
    // 右侧「画面」/「文字」面板实时编辑：作用于当前时间轴选中片段（缩放范围随入口）
    onTransformLive: (t, bounds) => {
      if (tlSelection) applyTransformLive(tlSelection.itemId, t, 'panel', bounds)
    },
    onTransformCommit: (t, bounds) => {
      if (!tlSelection) return
      applyTransformLive(tlSelection.itemId, t, 'panel', bounds)
      commitTransform('调整画面')
    },
    // 不透明度：拖动只实时上屏（不切轨不停播），松手 / 失焦入栈落盘
    onOpacityLive: v => {
      if (tlSelection) applyClipPropLive(tlSelection.itemId, { opacity: v })
    },
    onOpacityCommit: () => commitClipPatch('调整不透明度'),
    // 独立音频片段基础组滑杆：拖动中实时轻量预览（改 item + 播放器 + 时间轴回显），
    // 松手统一入栈落盘；与轨道手势共用 audioGestureLive/Commit
    onAudioLive: (itemId, patch, first) => audioGestureLive(itemId, patch, first),
    onAudioCommit: itemId => audioGestureCommit(itemId),
    // 文字：键入实时重绘播放器文字表面，失焦 / 切换属性时入栈落盘
    onTextLive: patch => {
      if (tlSelection) applyClipPropLive(tlSelection.itemId, { text: patch })
    },
    onTextCommit: () => commitClipPatch('编辑文字'),
    // 文字位置六按钮（左 / 水平居中 / 右 · 顶 / 垂直居中 / 底）：单轴改 x 或 y，走变换历史链路
    onClipAlign: (h, v) => {
      if (!tlSelection) return
      const nt = playerStage.alignClipPosition(tlSelection.itemId, h, v, TEXT_SCALE_BOUNDS)
      if (!nt) return
      applyTransformLive(tlSelection.itemId, nt, 'panel', TEXT_SCALE_BOUNDS)
      commitTransform('调整位置')
    }
  })

  // 空工程 / 全部片段隐藏时，「导出视频」按钮置灰
  detailPanel.setExportEnabled(hasExportableContent())

  // 播放器画面内点选 / 操作框拖拽 → 回传时间轴与右侧面板
  playerStage.onClipPick(clipId => {
    const hit = locateTrackItem(clipId)
    if (!hit) return
    tlSelection = { trackId: hit.track.id, itemId: hit.item.id }
    refreshOpButtons()
    // 高亮时间轴对应片段（内部可能再抛 onSelect，幂等）
    tlHandle?.select(hit.track.id, hit.item.id)
    syncSelectionToPanels()
  })
  playerStage.onTransformEdit({
    live: (clipId, t) => applyTransformLive(clipId, t, 'player'),
    commit: () => commitTransform('调整画面')
  })
  // 播放器画面内双击文字原位编辑：与右栏文字面板共用 applyClipPropLive 快照 / 落盘链路
  playerStage.onTextEdit({
    live: (clipId, patch) => applyClipPropLive(clipId, { text: patch }),
    commit: () => commitClipPatch('编辑文字')
  })

  /** 低频数据变更后重绘右侧详情 */
  function rerenderDetail() {
    detailPanel.render()
  }

  // ---------- 可选后端：素材目录 / 远程字体 / 草稿配置（默认关闭） ----------
  // public/app-config.json 的 backend.enabled=true 时才请求 imitate-node；
  // 关闭（默认）或请求失败时，保持上面的本地数据与上传行为不变。
  void (async () => {
    const cfg = await loadAppConfig()
    if (!cfg.enabled) return
    const [items, remote] = await Promise.all([fetchCatalog(), fetchRemoteConfig()])
    if (items.length > 0) {
      // 用户删除过的素材 id：后端目录再次下发时跳过，保证删除后刷新不再出现
      const skipIds = new Set(editorStorage.loadDeletedMaterials())
      const { added, fonts } = mergeCatalogIntoMaterials(materials, items, { skipIds })
      if (added > 0) {
        detailData.materials = materials
        detailData.materialsSavedAt = editorStorage.saveMaterials(materials)
        materialsPanel.setMaterials(materials)
        rerenderDetail()
      }
      if (fonts.length > 0) {
        const n = await addRemoteFonts(fonts)
        if (n > 0) rerenderDetail()
      }
    }
    // 远端草稿参数：仅在本地没有任何轨道数据（全新工程）时应用，避免覆盖用户草稿
    const draft = remote?.draft as { title?: unknown; canvasW?: unknown; canvasH?: unknown } | undefined
    if (draft && trackObjects.length === 0) {
      let changed = false
      if (typeof draft.title === 'string' && draft.title.trim()) {
        detailData.title = draft.title.trim()
        playerStage.setTitle(`${detailData.title}${PLAYER_TITLE_SUFFIX}`)
        changed = true
      }
      // 画布默认由「适应（原始）」根据主轨第一个资源决定；远端草稿只同步标题，
      // 不再用固定 canvasW/H 覆盖该规则（主轨没有资源时统一 1600×900）。
      if (changed) rerenderDetail()
    }
  })()

  // ---------- 模块四：底部轨道（异步初始化，数据驱动） ----------
  let tlHandle: TimelineTrackHandle | null = null
  let destroyed = false

  // ---------- 本机导入的媒体：IndexedDB 恢复 blob: 地址（未上传后端的素材刷新后仍可用） ----------
  void (async () => {
    const changed = await restoreLocalMedia(materials)
    if (!changed || destroyed) return
    detailData.materials = materials
    detailData.materialsSavedAt = editorStorage.saveMaterials(materials)
    materialsPanel.setMaterials(materials)
    rerenderDetail()
    // 轨道里引用了这些素材的片段同步换用新的对象 URL
    const urlById = new Map<string, string>()
    for (const m of [...materials.material, ...materials.audio, ...materials.sticker]) urlById.set(m.id, m.url)
    let trackChanged = false
    for (const tr of trackObjects) {
      for (const it of tr.items) {
        const nextUrl = it.materialId ? urlById.get(it.materialId) : undefined
        const src = it.source as { url?: string } | undefined
        if (nextUrl && src && typeof src.url === 'string' && src.url.startsWith('blob:')) {
          src.url = nextUrl
          trackChanged = true
        }
      }
    }
    if (trackChanged) {
      editorStorage.saveTracks(trackObjects)
      ;(tlHandle as TimelineTrackHandle | null)?.setData(trackObjects)
      applyTracksToPlayer()
    }
  })()

  // ---------- 素材选中预览：播放器只显示选中的那一个素材 ----------
  /** 单素材临时轨道：图片 / 动图按 5s 默认停留，视频用真实时长 */
  function previewTracksOf(m: MaterialItem): TrackObject[] {
    const isVideo = m.kind === 'video'
    const type: TrackObjectType = isVideo ? 'video' : 'image'
    const duration = isVideo ? m.duration || 5 : m.kind === 'gif' ? m.duration || 5 : 5
    const format = m.url.split('?')[0].split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : 'png')
    const item = {
      id: 'preview-clip',
      type,
      name: m.name,
      start: 0,
      duration,
      materialId: m.id,
      visible: true,
      status: 1 as const,
      source: {
        url: m.url,
        name: m.name,
        format,
        duration,
        width: m.width ?? 0,
        height: m.height ?? 0
      }
    } as AnyTrackItem
    return [
      {
        id: 'preview-track',
        type,
        name: '预览',
        layer: 0,
        items: [item]
      }
    ]
  }

  /**
   * 进入 / 退出素材预览：
   *  - 进入：暂停时间线并在播放器里只加载该素材（图片 / 动图 5s），
   *    标题改为「正在预览 …」，时间轴播放头淡化到 0.3，右栏暂显草稿参数；
   *  - 切换素材：预览时间归零，时间线现场（位置 / 选中 / 播放态）保持不变；
   *  - 退出：恢复真实轨道、播放头、标题、右栏选中与进入前的播放态。
   */
  function setMaterialPreview(m: MaterialItem | null) {
    if (m && previewMaterial?.id === m.id) return
    if (!m) {
      if (!previewMaterial) return
      const session = previewSession
      previewSession = null
      previewMaterial = null
      playerStage.setHeaderTitle(null)
      playerStage.setPreviewScrub(false)
      tlHandle?.setPlayheadDimmed(false)
      // 恢复真实时间线轨道
      applyTracksToPlayer()
      // 回到进入预览前的时间线位置与选中项（预览期间不改动它们）
      const t = session?.time ?? 0
      playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'seek', time: t })
      if (tlSelection) {
        playerStage.setSelectedClip(tlSelection.itemId)
        syncSelectionToPanels()
      } else {
        playerStage.setSelectedClip(null)
        detailPanel.setSelection(null)
      }
      // 进入预览前正在播放 → 恢复播放
      if (session?.wasPlaying) {
        playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'play' })
      }
      return
    }

    if (!previewMaterial) {
      // 只有第一次进入时记录现场；预览内切换素材不覆盖
      previewSession = {
        time: tlHandle?.getPlayhead() ?? 0,
        wasPlaying: playerStage.getState().status === '播放中',
        selection: tlSelection
      }
    }
    previewMaterial = m
    // 暂停时间线；不清时间线选中，右栏只是临时显示草稿参数（退出时恢复）
    playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'pause' })
    detailPanel.setSelection(null)
    tlHandle?.setPlayheadDimmed(true)
    const kindLabel = m.kind === 'video' ? '视频' : m.kind === 'gif' ? '动图' : '图片'
    playerStage.setHeaderTitle(`正在预览 · ${kindLabel} ${m.name}`)
    playerStage.setPreviewScrub(true)
    playerStage.setTracks(previewTracksOf(m))
    // 预览期间时间轴不处于播放态（暂停事件在预览中被过滤，这里显式同步）
    tlHandle?.setPlaying(false)
    // 重新选择资源：预览时间归零
    playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'seek', time: 0 })
  }

  /** 素材库重命名：时间轴里引用该素材的片段同步改名（预览标题同步） */
  function handleMaterialRenamed(id: string, name: string) {
    let trackChanged = false
    for (const tr of trackObjects) {
      for (const it of tr.items) {
        if (it.materialId === id && it.name !== name) {
          it.name = name
          trackChanged = true
        }
      }
    }
    if (trackChanged) {
      editorStorage.saveTracks(trackObjects)
      ;(tlHandle as TimelineTrackHandle | null)?.setData(trackObjects)
      // 预览中不重设播放器，退出预览时会用最新的真实轨道
      if (!previewMaterial) applyTracksToPlayer()
      refreshOpButtons()
      syncSelectionToPanels()
    }
    if (previewMaterial?.id === id) {
      previewMaterial = { ...previewMaterial, name }
      const kindLabel =
        previewMaterial.kind === 'video' ? '视频' : previewMaterial.kind === 'gif' ? '动图' : '图片'
      playerStage.setHeaderTitle(`正在预览 · ${kindLabel} ${name}`)
    }
  }

  /** 素材库删除：连同时间轴里引用该素材的片段一起移除（可撤销） */
  function handleMaterialDeleted(id: string) {
    // 记录已删除 id（本地兜底）并尽力同步删除后端目录条目，
    // 避免刷新后目录接口把该素材重新加回素材库
    const deletedIds = editorStorage.loadDeletedMaterials()
    if (!deletedIds.includes(id)) {
      deletedIds.push(id)
      editorStorage.saveDeletedMaterials(deletedIds)
    }
    void deleteCatalogItem(id)

    const used = trackObjects.some(tr => tr.items.some(it => it.materialId === id))
    if (!used) return
    pushUndo()
    for (const tr of trackObjects) tr.items = tr.items.filter(it => it.materialId !== id)
    if (tlSelection && !locateTrackItem(tlSelection.itemId)) {
      tlSelection = null
      playerStage.setSelectedClip(null)
      detailPanel.setSelection(null)
    }
    editorStorage.saveTracks(trackObjects)
    ;(tlHandle as TimelineTrackHandle | null)?.setData(trackObjects)
    if (!previewMaterial) applyTracksToPlayer()
    refreshOpButtons()
    if (tlSelection) syncSelectionToPanels()
    toast('已删除素材及其时间轴片段')
  }

  /** 复制当前选中片段到时间轴剪贴板 */
  function copyTimelineClip(): boolean {
    if (!tlSelection) return false
    const hit = locateTrackItem(tlSelection.itemId)
    if (!hit) return false
    setClipClipboard({
      trackType: hit.track.type,
      item: JSON.parse(JSON.stringify(hit.item)) as AnyTrackItem
    })
    toast('已复制片段')
    return true
  }

  /** 删除当前选中片段（优先走时间轴操作：主轨删除自动补位 + 入撤销栈） */
  function deleteTimelineClip(): boolean {
    if (!tlSelection) return false
    const selectedId = tlSelection.itemId
    const result = tlHandle?.applyOp('delete')
    if (!result?.ok) {
      // 时间轴内部选中已失效时兜底：直接按 id 从工作副本移除
      const hit = locateTrackItem(selectedId)
      if (!hit) return false
      pushUndo()
      const next = JSON.parse(JSON.stringify(trackObjects)) as TrackObject[]
      for (const tr of next) tr.items = tr.items.filter(it => it.id !== selectedId)
      replaceTracks(next.filter(tr => tr.items.length > 0))
    }
    tlSelection = null
    tlHandle?.clearSelection()
    playerStage.setSelectedClip(null)
    detailPanel.setSelection(null)
    refreshOpButtons()
    toast('已删除片段')
    return true
  }

  /** 剪切 = 复制 + 删除 */
  function cutTimelineClip(): boolean {
    if (!copyTimelineClip()) return false
    return deleteTimelineClip()
  }

  /** 粘贴剪贴板片段：放在播放头处，找不到同类型轨时新建一条 */
  function pasteTimelineClip(): boolean {
    const clip = getClipClipboard()
    if (!clip) {
      toast('剪贴板为空')
      return false
    }
    const type = clip.trackType
    const item = JSON.parse(JSON.stringify(clip.item)) as AnyTrackItem
    item.id = `op-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    item.start = snapToFrame(tlHandle?.getPlayhead() ?? 0)

    const next = JSON.parse(JSON.stringify(trackObjects)) as TrackObject[]
    const sameType = next.filter(t => t.type === type)
    const EPS = 1 / 1000
    const overlaps = (t: TrackObject) =>
      t.items.some(it => it.start < item.start + item.duration - EPS && it.start + it.duration > item.start + EPS)
    // 优先放到同类型且该时间段空闲的轨道；全部轨道都重叠时另起一行
    let track = sameType.find(t => !overlaps(t))
    if (!track) {
      const maxLayer = sameType.reduce((m, t) => Math.max(m, t.layer), TRACK_LAYER[type])
      track = {
        id: `tr-${type}-${Date.now().toString(36)}`,
        type,
        name: TRACK_NAME[type],
        layer: maxLayer + 1,
        items: []
      }
      next.push(track)
    }
    track.items.push(item)
    track.items.sort((a, b) => a.start - b.start)

    pushUndo()
    replaceTracks(next)
    tlSelection = { trackId: track.id, itemId: item.id }
    tlHandle?.select(track.id, item.id)
    refreshOpButtons()
    syncSelectionToPanels()
    toast('已粘贴片段')
    return true
  }

  /** 时间轴快捷键：Ctrl/Cmd+C / X / V、Delete / Backspace（输入框内不拦截） */
  const unbindTimelineShortcuts = bindTimelineShortcuts({
    canAct: () => !!tlSelection && !previewMaterial,
    copy: copyTimelineClip,
    cut: cutTimelineClip,
    paste: pasteTimelineClip,
    remove: deleteTimelineClip
  })

  /** 点击「素材面板 / 播放器」以外区域（含时间轴任意处）→ 取消素材预览 */
  function onDocPointerDown(e: PointerEvent) {    if (!previewMaterial) return
    const inside = e.composedPath().some(n => {
      if (!(n instanceof HTMLElement)) return false
      // 素材面板（点空白 / 换素材由面板自己处理）与播放器（预览画面 / 控制条）内不取消
      return n.classList.contains('ed-left') || n.classList.contains('ed-stage')
    })
    if (inside) return
    materialsPanel.clearSelection()
  }
  document.addEventListener('pointerdown', onDocPointerDown, true)

  /**
   * 视频源「是否真实含音轨」探测缓存（key＝媒体 url）。
   * 时间轴懒解码内嵌音轨时回调一次；右侧画面面板据此决定音量控制组显隐，
   * 无音轨的视频（如屏幕录像 / 无声素材）不显示该组。
   */
  const clipHasAudioCache = new Map<string, boolean>()
  const sourceUrl = (item: AnyTrackItem): string =>
    (item.source as { url?: string } | null)?.url ?? ''
  const unbindSplitters = bindSplitters(shell)

  /** 工具条轻提示（与素材库 toast 同款 .ed-toast） */
  function toast(msg: string) {
    const t = document.createElement('div')
    t.className = 'ed-toast'
    t.textContent = msg
    rootEl.appendChild(t)
    requestAnimationFrame(() => t.classList.add('show'))
    window.setTimeout(() => {
      t.classList.remove('show')
      window.setTimeout(() => t.remove(), 250)
    }, 1600)
  }

  // ---------- 时间线历史栈（撤销 / 恢复，深拷贝快照，最多 50 步）；工具条交互拆到 toolbar/ 模块 ----------
  const undoStack: TrackObject[][] = []
  const redoStack: TrackObject[][] = []
  const HISTORY_MAX = 50
  let tlSelection: TimelineSelection | null = null
  /** 主轨磁吸开关（默认开启，与按钮初始 is-on 及时间轴内部默认一致） */
  let mainSnap = true

  const cloneTracks = (ts: TrackObject[]): TrackObject[] => JSON.parse(JSON.stringify(ts))

  /** 用新数组替换工作副本并落盘 + 驱动 pixi + 同步合成播放器 */
  function replaceTracks(next: TrackObject[]) {
    trackObjects.length = 0
    trackObjects.push(...next)
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    syncSelectionToPanels()
  }

  /**
   * 比例变化时按旧 / 新逻辑画布尺寸等比换算元素位置。
   * 逻辑画布短边固定 1080：16:9 = 1920×1080，4:3 = 1440×1080。
   * 例如 16:9 左上角的文字 x=-800，在 4:3 下变为 x=-600，仍在画面内。
   */
  function rescaleTransformsForRatio(oldRatio: number, newRatio: number) {
    if (!(oldRatio > 0) || !(newRatio > 0)) return
    const oldSize = logicalCanvasSize(oldRatio)
    const newSize = logicalCanvasSize(newRatio)
    const fx = newSize.width / oldSize.width
    const fy = newSize.height / oldSize.height
    if (Math.abs(fx - 1) < 1e-6 && Math.abs(fy - 1) < 1e-6) return
    const entries: Array<{ clipId: string; transform: ClipTransform; bounds?: TransformBounds }> = []
    for (const track of trackObjects) {
      for (const item of track.items) {
        if (!isVisualType(item.type) || !item.transform) continue
        const b =
          item.type === 'text' || item.type === 'caption' ? TEXT_SCALE_BOUNDS : undefined
        const next = normalizeTransform(
          {
            ...item.transform,
            x: item.transform.x * fx,
            y: item.transform.y * fy
          },
          b
        )
        item.transform = next
        entries.push({ clipId: item.id, transform: next, bounds: b })
      }
    }
    if (entries.length > 0) {
      // 批量写入一次布局，避免逐片段重复 O(n) 重排
      playerStage.updateTransforms(entries)
      editorStorage.saveTracks(trackObjects)
    }
    // 文本层逻辑画布随比例变化：只重绘文字表面，不 seek 视频 / 不重新预载
    playerStage.refreshAfterRatio()
  }

  /**
   * 把工作副本同步给播放器。
   * setTimelineTracks 内部会静默停止播放、不发 pause 事件，这里同步时间轴播放态，
   * 避免「播放中增删片段 / 拖拽 / 粘贴」后时间轴误以为仍在播放，导致预览轴被禁用。
   */
  function applyTracksToPlayer() {
    playerStage.setTracks(trackObjects)
    if (!previewMaterial) tlHandle?.setPlaying(false)
    detailPanel.setExportEnabled(hasExportableContent())
  }

  /** 按片段 id 定位轨道项（播放器 / 面板回传均为 clipId） */
  function locateTrackItem(itemId: string | null | undefined): { track: TrackObject; item: AnyTrackItem } | null {
    if (!itemId) return null
    for (const track of trackObjects) {
      const item = track.items.find(i => i.id === itemId)
      if (item) return { track, item }
    }
    return null
  }

  /**
   * 时间轴选中态 → 播放器操作框 + 右侧信息模块同步。
   * 视频 / 图片 / 贴纸 →「画面」（操作框 + 变换）；文字 →「文字」（仍可在播放器操作）；
   * 音频 →「音频」（无操作框）；空选 / 其它类型 →「草稿参数」并回收操作框。
   */
  function syncSelectionToPanels() {
    const hit = locateTrackItem(tlSelection?.itemId)
    if (!hit) {
      playerStage.setSelectedClip(null)
      detailPanel.setSelection(null)
      return
    }
    const item = hit.item
    if (item.type === 'audio') {
      playerStage.setSelectedClip(null)
      const src = item.source as AudioContent
      detailPanel.setSelection({
        id: item.id,
        type: 'audio',
        name: src.name || item.name,
        audio: {
          volume: item.volume ?? 1,
          fadeIn: item.fadeIn ?? 0,
          fadeOut: item.fadeOut ?? 0,
          muted: item.muted ?? false
        },
        timing: {
          sourceDuration: src.duration,
          start: item.start,
          end: item.start + item.duration,
          sourceStart: item.sourceStart ?? 0
        }
      })
    } else if (item.type === 'text' || item.type === 'caption') {
      // 文字 / 字幕在播放器中可拖拽变换，右侧展示字体设置 / 位置设置 / 描边 / 阴影四段
      const ts = resolveTextStyle(
        item.type === 'caption'
          ? {
              ...CAPTION_TEXT_DEFAULTS,
              ...(item.source as TextContent),
              content: (item.source as { content?: string }).content || item.name || ''
            }
          : (item.source as TextContent)
      )
      playerStage.setSelectedClip(item.id)
      detailPanel.setSelection({
        id: item.id,
        type: 'text',
        name: item.name,
        transform: normalizeTransform(item.transform, TEXT_SCALE_BOUNDS),
        text: {
          content: ts.content,
          color: ts.color,
          fontSize: ts.fontSize,
          fontFamily: ts.fontFamily,
          bold: ts.bold,
          italic: ts.italic,
          underline: ts.underline,
          letterSpacing: ts.letterSpacing,
          lineSpacing: ts.lineSpacing,
          align: ts.align,
          valign: ts.valign,
          vertical: ts.vertical,
          stroke: { ...ts.stroke },
          shadow: { ...ts.shadow },
          blend: { ...ts.blend },
          background: { ...ts.background },
          glow: { ...ts.glow }
        }
      })
    } else if (isVisualType(item.type)) {
      const t = normalizeTransform(item.transform)
      const src = item.source as { duration?: number; width?: number; height?: number }
      const isVideo = item.type === 'video'
      // 音量控制组：仅视频且时间轴已真实探测到内嵌音轨时才出现；
      // 探测未完成 / 明确无音轨（缓存 false）均不渲染
      const hasAudio = isVideo && clipHasAudioCache.get(sourceUrl(item)) === true
      playerStage.setSelectedClip(item.id)
      detailPanel.setSelection({
        id: item.id,
        type: item.type,
        transform: t,
        opacity: item.opacity ?? 1,
        audio: hasAudio
          ? {
              volume: item.volume ?? 1,
              fadeIn: item.fadeIn ?? 0,
              fadeOut: item.fadeOut ?? 0,
              muted: item.muted ?? false
            }
          : undefined,
        timing: {
          sourceDuration: src.duration ?? item.duration,
          width: src.width,
          height: src.height,
          start: item.start,
          end: item.start + item.duration,
          sourceStart: item.sourceStart ?? 0
        }
      })
    } else {
      // 字幕 / 滤镜 / 特效 / 转场等暂无专属信息模块
      playerStage.setSelectedClip(null)
      detailPanel.setSelection(null)
    }
  }

  /**
   * 画面变换（操作框 / 右侧面板）一次手势的历史管理：
   * live 阶段就地改工作副本、不落盘；手势内首次 live 拍快照，
   * commit 时快照入 undo 并一次性落盘 + 重驱动 pixi / 时间轴。
   */
  let xformGesture = false
  let xformSnapshot: TrackObject[] | null = null
  function beginXformGesture() {
    if (!xformGesture) {
      xformGesture = true
      xformSnapshot = cloneTracks(trackObjects)
    }
  }

  /** 实时变换：来源为面板则更新播放器，来源为播放器则回显面板 */
  /** 调整文字时暂停播放：否则播放头会走出 3s 文字片段，文字自然从画面消失 */
  function pauseForTextAdjust(type: string) {
    if (type === 'text' || type === 'caption') {
      // 暂停是幂等的：未播放时不会产生副作用
      playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'pause' })
    }
  }

  function applyTransformLive(
    clipId: string,
    t: ClipTransform,
    from: 'panel' | 'player',
    b?: TransformBounds
  ) {
    const hit = locateTrackItem(clipId)
    if (!hit) return
    pauseForTextAdjust(hit.item.type)
    const nt = normalizeTransform(t, b)
    hit.item.transform = nt
    beginXformGesture()
    if (from === 'panel') playerStage.updateTransform(clipId, nt, b)
    else detailPanel.syncTransform(nt, hit.item.type === 'text' || hit.item.type === 'caption' ? TEXT_SCALE_BOUNDS : undefined)
  }

  /** 手势结束：快照入栈（一次拖拽 / 一次编辑一条历史）并提交 */
  function commitTransform(_label: string) {
    if (xformGesture && xformSnapshot) {
      undoStack.push(xformSnapshot)
      if (undoStack.length > HISTORY_MAX) undoStack.shift()
      redoStack.length = 0
    }
    xformGesture = false
    xformSnapshot = null
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    refreshOpButtons()
    // setTracks 后播放器可能重算静帧，面板保持同片段选中
    syncSelectionToPanels()
  }

  /**
   * 片段属性实时编辑（不透明度 / 文字内容）：复用变换手势的快照机制——
   * 首次 live 拍快照，只改工作副本并走播放器轻量接口（不重设轨道 / 不停播放），
   * commit 时由 commitClipPatch 统一入栈落盘。
   */
  function applyClipPropLive(
    clipId: string,
    patch: { opacity?: number; text?: Partial<DetailTextProps> }
  ) {
    const hit = locateTrackItem(clipId)
    if (!hit) return
    beginXformGesture()
    const item = hit.item
    const playerPatch: { opacity?: number; text?: Partial<DetailTextProps> } = {}
    if (patch.opacity !== undefined && isVisualType(item.type) && item.type !== 'text' && item.type !== 'caption') {
      const v = Math.min(1, Math.max(0, patch.opacity))
      item.opacity = v
      playerPatch.opacity = v
    }
    if (patch.text && (item.type === 'text' || item.type === 'caption')) {
      pauseForTextAdjust(item.type)
      Object.assign(item.source as TextContent, patch.text)
      playerPatch.text = patch.text
    }
    playerStage.updateClipLive(clipId, playerPatch)
  }

  /** 不透明度 / 文字一次编辑结束：与变换手势同一套入栈 + 落盘流程 */
  function commitClipPatch(label: string) {
    commitTransform(label)
  }

  /**
   * 轨道音频手势实时（音量白线竖拖 / 淡入淡出小球横拖；独立音频块与视频内嵌音轨共用）：
   * 高频回调，首次变动拍撤销快照，手势内只改工作副本 + 播放器轻量上屏 + 面板 dB/时长回显，
   * 不落盘不重设轨道；松手由 audioGestureCommit 一次性入栈落盘。
   */
  function audioGestureLive(
    itemId: string,
    patch: { volume?: number; fadeIn?: number; fadeOut?: number },
    first: boolean
  ) {
    const hit = locateTrackItem(itemId)
    if (!hit) return
    const item = hit.item
    if (item.type !== 'audio' && item.type !== 'video') return
    if (first) beginXformGesture()
    if (patch.volume !== undefined) item.volume = Math.min(10, Math.max(0, patch.volume))
    if (patch.fadeIn !== undefined) item.fadeIn = Math.max(0, patch.fadeIn)
    if (patch.fadeOut !== undefined) item.fadeOut = Math.max(0, patch.fadeOut)
    playerStage.updateClipLive(itemId, patch)
    // 时间轴画布重绘：s.data 与 trackObjects 同引用，就地改值后需主动重画，
    // 白线 / 波形振幅 / 淡变三角才会在拖动每一帧跟手（否则要等松手 setData）
    tlHandle?.redraw()
    // 正在编辑的片段恰好是右侧面板当前选中项时，同片段刷值（不重建 DOM、不抢焦点）：
    // 独立音频页无前缀、视频画面页 p 前缀，两组 sync 都在 syncSelectionToPanels 内完成
    if (tlSelection?.itemId === itemId) syncSelectionToPanels()
  }

  /** 轨道音频手势松手：快照（若有）入栈 + 落盘 + 时间轴 / 播放器重驱动收敛 */
  function audioGestureCommit(itemId: string) {
    if (!locateTrackItem(itemId)) return
    commitTransform('调整音量/淡入淡出')
  }

  /**
   * 在当前播放头所在帧切换标记（剪映「标记」语义：标记锚定固定帧单位）：
   * 该帧已有标记 → 移除；否则新增。标记独立持久化并同步给时间轴渲染 / 吸附。
   */
  function togglePlayheadMarker() {
    if (!tlHandle) return
    const t = snapToFrame(tlHandle.getPlayhead())
    const idx = markers.findIndex(m => Math.abs(m - t) < 1 / TIMELINE_FPS / 2)
    if (idx >= 0) {
      markers.splice(idx, 1)
      toast('已移除标记')
    } else {
      markers.push(t)
      markers.sort((a, b) => a - b)
      toast('已添加标记')
    }
    editorStorage.saveMarkers(markers)
    tlHandle.setMarkers(markers)
  }

  /** 变更前压栈：当前状态入 undo，清空 redo */
  function pushUndo() {
    undoStack.push(cloneTracks(trackObjects))
    if (undoStack.length > HISTORY_MAX) undoStack.shift()
    redoStack.length = 0
  }

  // ---------- 工具栏接线：工具模块（撤销/恢复/分割/删除/标记+M 键）、
  //            状态模块（主轨磁吸/自动磁吸/预览轴/缩放）、播放器操作（占位）。
  //            历史栈、主轨磁吸重排落盘等数据语义仍留在本页。 ----------
  const timelineToolbar = createTimelineToolbar(shell, {
    getSelection: () => tlSelection,
    undo: () => {
      const prev = undoStack.pop()
      if (!prev) return
      redoStack.push(cloneTracks(trackObjects))
      replaceTracks(prev)
      refreshOpButtons()
    },
    redo: () => {
      const next = redoStack.pop()
      if (!next) return
      undoStack.push(cloneTracks(trackObjects))
      replaceTracks(next)
      refreshOpButtons()
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    applyOp: op => (tlHandle ? tlHandle.applyOp(op) : { ok: false }),
    toggleMarker: togglePlayheadMarker,
    toast,
    hasOpenModal: () => !!rootEl.querySelector('.ed-modal-mask'),
    onMainSnapChange: next => {
      // 开启的一瞬间：主轨上的子项立即按当前时间顺序首尾贴近重排（消除全部空隙）。
      // 仅在确实发生位移时记一个可撤销历史点；关闭只切换开关，不改动数据。
      if (next) {
        const main = trackObjects.find(t => t.layer === 0)
        if (main && main.items.length) {
          const ordered = main.items.slice().sort((a, b) => a.start - b.start)
          const plan: { it: AnyTrackItem; start: number }[] = []
          let cursor = 0
          let changed = false
          for (const it of ordered) {
            const ns = snapToFrame(cursor)
            if (Math.abs(ns - it.start) > 1 / TIMELINE_FPS / 2) changed = true
            plan.push({ it, start: ns })
            cursor = snapToFrame(ns + it.duration)
          }
          if (changed) {
            pushUndo()
            for (const { it, start } of plan) it.start = start
            // 保持 items 数组本身也按起点排序，与落轨 / 移动后的规范顺序一致
            main.items = ordered
            editorStorage.saveTracks(trackObjects)
            tlHandle?.setData(trackObjects)
            applyTracksToPlayer()
            refreshOpButtons()
          }
        }
      }
      mainSnap = next
      tlHandle?.setMainSnap(next)
    },
    onSnapChange: on => tlHandle?.setSnap(on),
    onPreviewChange: on => {
      tlHandle?.setPreviewAxis(on)
      // 关闭瞬间播放器若正显示悬停帧，恢复到播放头位置
      if (!on) playerStage.scrub(null)
    },
    onZoomChange: lv => tlHandle?.setZoom(lv),
    getZoom: () => tlHandle?.getZoom() ?? null
  })
  /** 按选中态 / 历史栈刷新工具条禁用态（实现位于 toolbar/tools 模块） */
  function refreshOpButtons() {
    timelineToolbar.refreshOpButtons()
  }
  refreshOpButtons()

  /** 封面按钮弹窗：仅「上传封面 / 首帧封面」两个来源按钮；
   *  已有封面的移除走时间轴缩略图右上角 × 角标，弹窗内不放预览与移除入口 */
  function openCoverModal() {
    const mask = document.createElement('div')
    mask.className = 'ed-modal-mask'
    mask.innerHTML = `
      <div class="ed-modal ed-cover-panel" role="dialog" aria-modal="true" aria-label="设置封面">
        <div class="ed-modal-head">
          <span class="ed-modal-title">设置封面</span>
          <button type="button" class="ed-modal-x" data-act="close" aria-label="关闭">×</button>
        </div>
        <div class="ed-cover-body">
          <button type="button" class="ed-cover-opt" data-act="upload">
            <span class="ed-cover-opt-icon">${UPLOAD_ICON}</span>
            <span><span class="ed-cover-opt-main">上传封面</span><span class="ed-cover-opt-sub">从本地选择一张图片</span></span>
          </button>
          <button type="button" class="ed-cover-opt" data-act="frame">
            <span class="ed-cover-opt-icon">${FRAME_ICON}</span>
            <span><span class="ed-cover-opt-main">首帧封面</span><span class="ed-cover-opt-sub">截取主轨第一个素材的首帧画面</span></span>
          </button>
        </div>
      </div>`
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.style.display = 'none'
    mask.appendChild(fileInput)

    // 主轨（layer 0）第一个可见子项；不存在则首帧选项不可用
    const mainTrack = trackObjects.find(t => t.layer === 0) ?? null
    const firstItem =
      mainTrack?.items
        .filter(it => it.visible !== false)
        .slice()
        .sort((a, b) => a.start - b.start)[0] ?? null
    const frameBtn = mask.querySelector<HTMLButtonElement>('[data-act="frame"]')!
    if (!firstItem) {
      frameBtn.disabled = true
      frameBtn.querySelector('.ed-cover-opt-sub')!.textContent = '主轨暂无素材'
    }

    function close() {
      mask.remove()
      document.removeEventListener('keydown', onKey)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    function applyCover(dataUrl: string) {
      coverImage = dataUrl
      editorStorage.saveCover({ image: dataUrl })
      tlHandle?.setCover(dataUrl)
      toast('封面已设置')
      close()
    }

    mask.addEventListener('click', e => {
      const target = e.target as HTMLElement
      if (target === mask) {
        close()
        return
      }
      const act = target.closest<HTMLElement>('[data-act]')?.dataset.act
      if (!act) return
      if (act === 'close') {
        close()
      } else if (act === 'upload') {
        fileInput.click()
      } else if (act === 'frame' && firstItem) {
        const src = firstItem.source as { url?: string }
        if (!src.url) {
          toast('该素材无可截取的画面')
          return
        }
        const busy = '截取中…'
        const sub = frameBtn.querySelector<HTMLElement>('.ed-cover-opt-sub')!
        const origin = sub.textContent
        frameBtn.disabled = true
        sub.textContent = busy
        const done = () => {
          frameBtn.disabled = false
          sub.textContent = origin
        }
        if (firstItem.type === 'video') {
          captureVideoCover(src.url, firstItem.sourceStart ?? 0)
            .then(applyCover)
            .catch(() => toast('主轨首帧截取失败'))
            .finally(done)
        } else {
          // 图片 / GIF：取静态首帧（canvas 绘制 GIF 时浏览器画第 1 帧）
          loadImageEl(src.url)
            .then(img => applyCover(squareCoverDataUrl(img, img.naturalWidth, img.naturalHeight)))
            .catch(() => toast('封面图片读取失败'))
            .finally(done)
        }
      }
    })
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const objUrl = URL.createObjectURL(file)
      loadImageEl(objUrl)
        .then(img => applyCover(squareCoverDataUrl(img, img.naturalWidth, img.naturalHeight)))
        .catch(() => toast('图片读取失败'))
        .finally(() => URL.revokeObjectURL(objUrl))
    })
    document.addEventListener('keydown', onKey)
    rootEl.appendChild(mask)
  }

  createTimelineTrack($<HTMLElement>('track'), trackObjects, {
    // 时间线内部的移动 / 拖裁 / 分割 / 裁剪 / 删除：提交前状态入栈
    onCommit: next => {
      pushUndo()
      replaceTracks(next)
      refreshOpButtons()
    },
    onSelect: sel => {
      tlSelection = sel
      refreshOpButtons()
      syncSelectionToPanels()
    },
    // 时间轴片段右键：复制 / 剪切 / 删除
    onClipContextMenu: (_sel, e) => {
      openClipMenu(rootEl, e.clientX, e.clientY, {
        copy: copyTimelineClip,
        cut: cutTimelineClip,
        remove: deleteTimelineClip
      })
    },
    // 播放头定位 → 转发给播放器 seek
    onSeek: time => {
      playerStage.handleCommand({ id: Date.now() + Math.random(), type: 'seek', time })
    },
    // 预览轴悬停 → 播放器把该帧画面上屏（不动播放头）；null＝恢复播放头画面
    onPreview: time => {
      playerStage.scrub(time)
    },
    // 素材库拖拽落轨：按帧吸附时刻放置。trackId 非空＝指定既有轨；
    // null + createNew ＝ 空白 / 时间重叠 / 类型不兼容，始终新建同类型轨；
    // null 非 createNew ＝ 媒体落入空主轨（进 / 建 layer0 主轨）
    onDropMaterial: (payload, startSec, trackId, createNew) => {
      dropMaterialOp(payload, startSec, trackId, createNew)
    },
    // 轨道上既有块重新投放（可上下左右跨轨）：从源轨摘走、落入目标轨 / 新轨，空轨删除
    onMoveItem: (sourceTrackId, itemId, startSec, targetTrackId, createNew) => {
      moveItemOp(sourceTrackId, itemId, startSec, targetTrackId, createNew)
    },
    // Alt+←/→ 逐帧微调：按住连发只在首帧压栈
    onNudgeItem: (trackId, itemId, startSec, withHistory) => {
      nudgeItemOp(trackId, itemId, startSec, withHistory)
    },
    // 主轨前缀「封面」按钮：缩略图主体→打开设置弹窗；右上角 × →直接移除封面
    onCover: action => {
      if (action === 'remove') {
        coverImage = null
        editorStorage.saveCover({ image: null })
        tlHandle?.setCover(null)
        toast('封面已移除')
      } else {
        openCoverModal()
      }
    },
    // 时间轴内部改动标记（右键小旗删除）：同步工作副本并落盘
    onMarkersChange: times => {
      markers.length = 0
      markers.push(...times)
      editorStorage.saveMarkers(markers)
    },
    onAudioLive: audioGestureLive,
    onAudioCommit: audioGestureCommit,
    // 视频内嵌音轨探测完成（时间轴懒解码波形时触发一次）：按 url 缓存结果，
    // 若该视频正被选中，重灌右侧面板——音量控制组出现（含音轨）或保持隐藏（无音轨）
    onClipAudioProbed: (itemId, hasAudio) => {
      const hit = locateTrackItem(itemId)
      if (!hit || hit.item.type !== 'video') return
      clipHasAudioCache.set(sourceUrl(hit.item), hasAudio)
      if (tlSelection?.itemId === itemId) syncSelectionToPanels()
    }
  }).then(h => {
    if (destroyed) {
      h.destroy()
      return
    }
    tlHandle = h
    // 反向同步当前刻度等级（默认 9）
    timelineToolbar.setZoomLevel(h.getZoom())
    // 水合本地标记到 pixi 标尺
    h.setMarkers(markers)
    // 水合本地封面到 pixi 按钮
    if (coverImage) h.setCover(coverImage)
    // 时间轴就绪前播放器若已点选片段，补一次时间轴高亮
    if (tlSelection) h.select(tlSelection.trackId, tlSelection.itemId)
  })

  /**
   * 素材库 ＋：把一个子项以**当前播放头（指针）位置为起点**放入对应类型轨道。
   * 起点取自时间线播放头（自身已按帧吸附），appendItem 再统一做帧对齐，
   * 故子项起点 / 终点都与坐标轴帧一一对应。
   * 目标轨解析：媒体素材且当前选中媒体轨 → 选中轨；否则同类型首条轨；都不存在 → 默认层新建。
   * **若新区间与目标轨既有子项时间重叠，则不在原轨叠加，而是新建一条同类型轨道**
   * （画面 / 装饰轨叠到最上层、音频叠到最下层），子项放入新轨——与拖拽落轨语义一致。
   * 素材轨（图片轨）与主轨等价：当前选中二者之一时，视频 / 图片 / GIF
   * 都直接加到选中轨（两条轨道均可放图片、GIF、mp4）。
   * 就地变更 trackObjects，随后落盘 localStorage 并驱动 pixi 重绘。
   */
  function addTrackOp(payload: AnyAddTrackPayload) {
    // 添加素材也是一次可撤销的数据变更
    pushUndo()
    const isMediaPayload = payload.type === 'video' || payload.type === 'image'
    const selectedTrack = trackObjects.find(t => t.id === tlSelection?.trackId) ?? null
    const selectedIsMedia =
      !!selectedTrack && (selectedTrack.type === 'video' || selectedTrack.type === 'image')
    // 媒体素材且当前选中媒体轨 → 进选中轨；否则按素材类型找专属轨。
    // 字幕与文本共用文本轨：caption 载荷优先找文本轨（兼容旧字幕轨）。
    // 额外：text/caption payload 若当前选中子项就是 text/caption → 追加到该子项所在轨，
    //      与贴图 payload 选中贴图轨就追加进去的风格一致。
    const textLikePayload = payload.type === 'text' || payload.type === 'caption'
    const selectedItem = tlSelection ? locateTrackItem(tlSelection.itemId) : null
    const selectedItemIsTextLike = !!selectedItem && (selectedItem.item.type === 'text' || selectedItem.item.type === 'caption')
    let track: TrackObject | undefined =
      isMediaPayload && selectedIsMedia
        ? selectedTrack
        : textLikePayload && selectedItemIsTextLike
          ? selectedItem!.track
          : trackObjects.find(t =>
              textLikePayload ? t.type === 'text' || t.type === 'caption' : t.type === payload.type
            )
    // 起点＝当前指针（播放头）所在帧，不再追加到轨道末尾
    let start = snapToFrame(tlHandle?.getPlayhead() ?? 0)
    const duration = snapToFrame(payload.duration)
    if (track) {
      if (mainSnap && track.layer === 0) {
        // 主轨磁吸：新子项一律追加到主轨末尾（与播放头位置无关），主轨不留缝
        start = mainTrackAppendStart(track)
      } else if (trackHasOverlap(track, start, duration)) {
        // 目标轨该时间段已被占用 → 新建一条同类型轨道避让
        track = createTrackForPayload(trackObjects, payload)
      }
    } else {
      // 同类型轨尚不存在：新建轨道。视觉 / 装饰类新轨一律在最上方
      // （首条视频 / 图片且无主轨时为 layer0 主轨），音频叠到最下。
      track = createTrackForPayload(trackObjects, payload)
    }
    // 新建出的空主轨（首个视频）同样从 0 开始排
    if (mainSnap && track.layer === 0) start = mainTrackAppendStart(track)
    appendItem(track, payload, start)
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    refreshOpButtons()
  }

  /**
   * 字幕文件批量入轨：一条 cue 生成一个字幕片段（区间取自 srt / ass 时间轴）。
   * 1) 整体偏移到当前播放头位置（cue 原本的绝对时间码不再直接用作轨道起点）；
   * 2) 目标轨优先顺序：当前选中的 text/caption 子项所在轨 → 既有不冲突 text/caption 轨 → 新建 text 轨；
   * 3) 与普通文本同轨（caption 轨并入 text 轨），一次落盘 / 一次轨道同步。
   */
  function addCaptionClipsOp(item: CaptionItem, cues: CaptionCue[], raw?: string) {
    if (!cues.length) return
    pushUndo()
    // ass 样式（字体 / 颜色 / 描边 / 字号）按当前工程画布比例换算后随 cue 入轨；
    // srt 无样式，保持字幕默认白字黑边
    const styledCues =
      item.format === 'ass' && raw
        ? parseCaption('ass', raw, detailData.canvasH > 0 ? detailData.canvasW / detailData.canvasH : 9 / 16)
        : cues
    const list = styledCues
      .map(c => ({ cue: c, start: Math.max(0, c.start), duration: Math.max(0.04, c.end - c.start), text: c.text }))
      .sort((a, b) => a.start - b.start)
    // 整体偏移：让第一条 cue 对齐当前播放头，后续 cue 保持相对间隔
    const playhead = snapToFrame(tlHandle?.getPlayhead() ?? 0)
    const offset = playhead - list[0].start
    for (const c of list) c.start = Math.max(0, c.start + offset)
    // 找一条与全部 cue 都不冲突的既有文本轨（字幕与普通文本同轨，兼容旧字幕轨）。
    // 优先命中：当前选中的 text/caption 子项所在轨（若冲突回退新建）。
    let sel: TrackObject | null = null
    const hit = tlSelection ? locateTrackItem(tlSelection.itemId) : null
    if (hit && (hit.item.type === 'text' || hit.item.type === 'caption')) {
      if (list.every(c => !trackHasOverlap(hit.track, c.start, c.duration))) sel = hit.track
    }
    let track: TrackObject | undefined =
      sel ??
      trackObjects.find(
        t =>
          (t.type === 'text' || t.type === 'caption') &&
          list.every(c => !trackHasOverlap(t, c.start, c.duration))
      )
    if (!track) {
      track = createTrackForPayload(trackObjects, {
        type: 'caption',
        name: item.name,
        duration: list[list.length - 1].start + list[list.length - 1].duration,
        materialId: item.id,
        source: { url: item.url, name: item.name, format: item.format, duration: list[0].duration, content: list[0].text }
      })
    }
    let first: TrackItem<'caption'> | null = null
    for (const c of list) {
      // ass cue 携带的样式并入片段 source（渲染展平时优先于字幕默认白字黑边）
      const s = c.cue.style
      const source: CaptionContent = {
        url: item.url,
        name: item.name,
        format: item.format,
        duration: c.duration,
        content: c.text,
        ...(s?.color ? { color: s.color } : {}),
        ...(s?.fontSize ? { fontSize: s.fontSize } : {}),
        ...(s?.fontFamily ? { fontFamily: s.fontFamily } : {}),
        ...(s?.bold !== undefined ? { bold: s.bold } : {}),
        ...(s?.italic !== undefined ? { italic: s.italic } : {}),
        ...(s?.stroke
          ? {
              stroke: {
                enabled: true,
                color: s.stroke.color,
                opacity: s.stroke.opacity ?? 1,
                width: s.stroke.width
              }
            }
          : {})
      }
      const ci = appendItem(track, {
        type: 'caption',
        name: c.text,
        duration: c.duration,
        materialId: item.id,
        source
      }, c.start)
      // 字幕默认贴画面下方（逻辑像素，短边 1080 口径，约 85% 高度）
      ci.transform = normalizeTransform({ y: CAPTION_DEFAULT_Y }, TEXT_SCALE_BOUNDS)
      first ??= ci
    }
    track.items.sort((a, b) => a.start - b.start)
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    if (first) tlHandle?.select(track.id, first.id)
    refreshOpButtons()
  }

  /**
   * 素材库拖拽落轨：在指定时刻（时间线已做帧吸附）放入目标轨。
   * - trackId 非空：放入指定既有轨；
   * - createNew：空白区 / 与命中轨子项时间重叠 / 类型不兼容 → 始终新建一条同类型轨，
   *   层级与既有轨道避让（视频 / 图片等画面轨叠到最上方素材层，音频叠到最下方）；
   * - 其余 trackId 为 null：媒体落入空主轨（进 / 建 layer0 主轨）。
   * 落位后子项按起点排序并立即成为选中项。
   */
  function dropMaterialOp(
    payload: AnyAddTrackPayload,
    startSec: number,
    trackId: string | null,
    createNew = false
  ) {
    pushUndo()
    let track: TrackObject | undefined
    if (!createNew) {
      track = (trackId && trackObjects.find(t => t.id === trackId)) || undefined
      if (!track) {
        // 空主轨泳道（trackId=null 非新建）：进 layer0 主轨；不存在则由
        // createTrackForPayload 新建 layer0 主轨。不能回退到「同类型首条轨」——
        // 他轨已有视频轨时那会错误落进上层轨，空主轨永远建不出来。
        track = trackObjects.find(t => t.layer === 0)
      }
    }
    if (!track) {
      // 新建轨道：层级避让（画面 / 装饰叠到最上层、音频叠到最下层）
      track = createTrackForPayload(trackObjects, payload)
    }
    // startSec 已由时间线按帧吸附，appendItem 内部再统一做起点 / 时长帧对齐。
    // 主轨磁吸：落进主轨（含空主轨 / 首个视频新建出的 layer0 轨）一律追加到末尾，
    // 与时间轴浮块的队尾灰槽预告同口径（拖动期浮块跟鼠标、不实时跳位）。
    let placeStart = Math.max(0, snapToFrame(startSec))
    if (mainSnap && track.layer === 0) {
      placeStart = mainTrackAppendStart(track)
    }
    const item = appendItem(track, payload, placeStart)
    track.items.sort((a, b) => a.start - b.start)
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    tlHandle?.select(track.id, item.id)
    refreshOpButtons()
  }

  /**
   * 轨道上既有块重新投放（块体拖拽，可跨轨）：
   * - 把 item 从源轨摘除（保留 id / sourceStart 等全部字段）；
   * - createNew 或无可用目标轨 → 新建同类型轨（层级避让）；
   * - targetTrackId 非空 → 指定既有轨；为空（空主轨语义）→ 同类型首条轨；
   * - 投放后重新排序；源轨（及任何）已无子项的轨道立即删除。
   */
  function moveItemOp(
    sourceTrackId: string,
    itemId: string,
    startSec: number,
    targetTrackId: string | null,
    createNew: boolean
  ) {
    const from = trackObjects.find(t => t.id === sourceTrackId)
    if (!from) return
    const idx = from.items.findIndex(i => i.id === itemId)
    if (idx < 0) return
    const item = from.items[idx]
    // 主轨磁吸：记录摘走前的位置 / 时长，跨轨移出主轨时供剩余片段左移补位
    const fromMain = from.layer === 0
    const removedStart = item.start
    const removedDur = snapToFrame(item.duration)
    pushUndo()
    from.items.splice(idx, 1)

    let to: TrackObject | undefined
    if (!createNew) {
      to = (targetTrackId && trackObjects.find(t => t.id === targetTrackId)) || undefined
      if (!to) {
        // 空主轨语义（trackId=null 且非新建＝落入空主轨泳道）：进 layer0 主轨；
        // 主轨对象此前因清空被删，这里找不到则交由下方 createTrackForPayload 建 layer0 主轨。
        // 不能按「同类型首条轨」回退——那会命中来源视频 / 素材轨自己，素材看似移不下去。
        to = trackObjects.find(t => t.layer === 0)
      }
    }
    if (!to) to = createTrackForPayload(trackObjects, payloadOfTrackItem(item))

    // 主轨磁吸：仅在「移出主轨」时让原主轨补位；主轨内重排下方统一按中点 pack，
    // 摘掉的空隙会被重排自然消掉，不需要 ripple。
    if (mainSnap && fromMain && to !== from) {
      rippleCloseAfterRemove(from, removedStart, removedDur)
    }
    // 主轨内部重排（to===from）：拖动期不做排列，松手才按时间顺序排列——
    // 先把被拖块临时放在拖动终点，稍后以「时间中点」决定先后并整轨 pack；
    // 从其他轨新进入主轨：一律追加队尾；主轨磁吸关闭 / 非主轨：自由落点。
    const withinMainReorder = mainSnap && to.layer === 0 && to === from
    item.start =
      mainSnap && to.layer === 0 && to !== from
        ? mainTrackAppendStart(to)
        : snapToFrame(startSec)
    to.items.push(item)
    if (withinMainReorder) {
      // 中点排序（与时间轴 mainTrackReorderStart 灰槽预告同口径）后从头首尾相接
      const ordered = to.items
        .slice()
        .sort(
          (a, b) =>
            a.start + snapToFrame(a.duration) / 2 - (b.start + snapToFrame(b.duration) / 2)
        )
      let cursor = 0
      for (const it of ordered) {
        it.start = snapToFrame(cursor)
        cursor = snapToFrame(cursor + it.duration)
      }
      to.items = ordered
    } else {
      to.items.sort((a, b) => a.start - b.start)
    }

    // 原轨道没有子项了 → 这条轨道取消（顺带清掉任何空轨）
    for (let i = trackObjects.length - 1; i >= 0; i--) {
      if (trackObjects[i].items.length === 0) trackObjects.splice(i, 1)
    }

    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    if (trackObjects.includes(to)) tlHandle?.select(to.id, item.id)
    refreshOpButtons()
  }

  /**
   * Alt+←/→ 逐帧微调选中子项起点（时间线已做好相邻间隙夹逼与帧吸附）。
   * withHistory=false 为按住连发的后续帧：不压撤销栈，整次按住只记一个历史点。
   */
  function nudgeItemOp(
    trackId: string,
    itemId: string,
    startSec: number,
    withHistory: boolean
  ) {
    const tr = trackObjects.find(t => t.id === trackId)
    if (!tr) return
    const it = tr.items.find(i => i.id === itemId)
    if (!it) return
    const ns = snapToFrame(startSec)
    if (ns === it.start) return
    if (withHistory) pushUndo()
    it.start = ns
    editorStorage.saveTracks(trackObjects)
    tlHandle?.setData(trackObjects)
    applyTracksToPlayer()
    if (withHistory) refreshOpButtons()
  }

  rerenderDetail()

  // ---------- 成片导出（顶部「文件 → 导出视频」经 window 全局事件驱动） ----------
  // 播放器逐帧捕获 pixi 画布（codec/timelineExporter，mediabunny CanvasSource），
  // Web Audio 离线混音后封装为 MP4 并触发下载。
  let exporting = false
  const onExportVideo = async () => {
    if (exporting || destroyed) return
    if (!hasExportableContent()) {
      toast(t('export.empty'))
      return
    }

    exporting = true
    const mask = document.createElement('div')
    mask.className = 'ed-export-mask'
    mask.innerHTML = `
      <div class="ed-export-card">
        <div class="ed-export-title">正在导出视频</div>
        <div class="ed-export-desc" data-role="ex-desc">准备中…</div>
        <div class="ed-export-bar"><i data-role="ex-bar"></i></div>
        <div class="ed-export-foot">
          <span class="ed-export-pct" data-role="ex-pct">0%</span>
          <button type="button" class="ed-export-cancel" data-role="ex-cancel">取消</button>
        </div>
      </div>`
    rootEl.appendChild(mask)
    const $ex = <T extends HTMLElement>(role: string) =>
      mask.querySelector<T>(`[data-role="${role}"]`)!
    const descEl = $ex<HTMLElement>('ex-desc')
    const barEl = $ex<HTMLElement>('ex-bar')
    const pctEl = $ex<HTMLElement>('ex-pct')
    const cancelBtn = $ex<HTMLButtonElement>('ex-cancel')
    const signal = { cancelled: false }
    // 阶段权重：混音 0-12%，逐帧渲染 12-92%，封装 92-100%
    // 混音与逐帧渲染现在并行：画面阶段一旦开始，后续的 audio 进度（仍在后台跑）
    // 一律忽略，避免进度条回退 / 文案来回跳。
    let videoStarted = false
    const setProgress = (phase: 'video' | 'audio' | 'mux', ratio: number) => {
      if (phase === 'audio' && videoStarted) return
      if (phase === 'video') videoStarted = true
      const pct =
        phase === 'audio'
          ? Math.round(ratio * 12)
          : phase === 'video'
            ? 12 + Math.round(ratio * 80)
            : 92 + Math.round(ratio * 8)
      barEl.style.width = `${Math.min(100, pct)}%`
      pctEl.textContent = `${Math.min(100, pct)}%`
      descEl.textContent =
        phase === 'audio'
          ? '正在混合音轨…'
          : phase === 'video'
            ? `正在渲染画面… ${Math.round(ratio * 100)}%`
            : '正在封装 MP4…'
    }
    cancelBtn.addEventListener('click', () => {
      signal.cancelled = true
      cancelBtn.disabled = true
      cancelBtn.textContent = '取消中…'
    })

    try {
      const cw = Math.max(2, Math.round(detailData.canvasW || 1080))
      const ch = Math.max(2, Math.round(detailData.canvasH || 1920))
      const buffer = await playerStage.exportVideo({
        width: cw - (cw % 2),
        height: ch - (ch % 2),
        fps: TIMELINE_FPS,
        onProgress: setProgress,
        signal
      })

      const blob = new Blob([buffer], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)
      const d = new Date()
      const p2 = (n: number) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
      const safeTitle = (detailData.title || '未命名草稿').replace(/[\\/:*?"<>|]/g, '_')
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeTitle}_${stamp}.mp4`
      rootEl.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      if (signal.cancelled || (e as Error)?.message === 'abort') {
        // 用户主动取消：静默收口
      } else {
        window.alert(`导出失败：${(e as Error)?.message || String(e)}`)
      }
    } finally {
      mask.remove()
      exporting = false
    }
  }
  triggerExport = () => {
    void onExportVideo()
  }
  window.addEventListener('uc-editor:export-video', onExportVideo)

  /** Ctrl/Cmd + E：与「文件 → 导出视频」、草稿参数底部按钮同一导出入口 */
  const onExportShortcut = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    if (e.key.toLowerCase() !== 'e') return
    if (e.isComposing) return
    e.preventDefault()
    void onExportVideo()
  }
  window.addEventListener('keydown', onExportShortcut)

  // ---------- 外部 props 更新 ----------
  return {
    /** 当前工程快照（导出轨道配置回调使用） */
    getSnapshot() {
      return {
        title: detailData.title,
        materials: JSON.parse(JSON.stringify(detailData.materials)),
        tracks: JSON.parse(JSON.stringify(trackObjects))
      }
    },
    update(newProps: Record<string, any>) {
      let changed = false

      if (isMaterialsData(newProps.materials)) {
        const next = newProps.materials
        detailData.materials = next
        detailData.materialsSavedAt = editorStorage.saveMaterials(next)
        materialsPanel.setMaterials(next)
        changed = true
      }
      if (isTrackObjectList(newProps.tracks)) {
        // 清空并回填工作数组（保持引用不变，pixi 句柄仍持有同一数组）
        trackObjects.length = 0
        trackObjects.push(...newProps.tracks.map(t => ({ ...t, items: [...t.items] })))
        // 外部数据同样做帧对齐，保证子项起止与坐标轴帧一一对应
        quantizeTrackItems(trackObjects)
        // 外部整体替换数据，旧历史不再适用
        undoStack.length = 0
        redoStack.length = 0
        tlSelection = null
        editorStorage.saveTracks(trackObjects)
        tlHandle?.setData(trackObjects)
        applyTracksToPlayer()
        refreshOpButtons()
        syncSelectionToPanels()
        changed = true
      }
      if (typeof newProps.title === 'string' && newProps.title !== detailData.title) {
        detailData.title = newProps.title
        playerStage.setTitle(`${newProps.title}${PLAYER_TITLE_SUFFIX}`)
        changed = true
      }
      if (newProps.command) playerStage.handleCommand(newProps.command)
      if (changed) rerenderDetail()
    },
    destroy() {
      destroyed = true
      disposeI18n()
      unbindTimelineShortcuts()
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      window.removeEventListener('uc-editor:export-video', onExportVideo)
      window.removeEventListener('keydown', onExportShortcut)
      unbindSplitters()
      timelineToolbar.destroy()
      materialsPanel.destroy()
      tlHandle?.destroy()
      tlHandle = null
      playerStage.setTapListener(null)
      vuMeter.destroy()
      playerStage.destroy()
      if (auditionCtx) {
        void auditionCtx.close().catch(() => {})
        auditionCtx = null
      }
    }
  }
}

export default createEditorPage
