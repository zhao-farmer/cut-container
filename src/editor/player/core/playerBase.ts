/* ============================================================
 *  播放器内核 · 基类（mixin 拆分的状态骨架）
 *
 *  原 MediaBunnyPlayer 是 ~3000 行的高内聚上帝类。为在「行为零改动」
 *  前提下物理拆文件，采用 TypeScript mixin 模式：
 *  - PlayerBase 集中声明全部实例字段（mixin 间通过继承共享 this）；
 *  - 各功能方法以 abstract 签名声明，实现按子系统分布在
 *    ui/ stage/ timeline/ playback/ 各 mixin 中（方法体原样搬迁）；
 *  - 与 mediabunny 编解码 / Web Audio 相关的状态与逻辑在
 *    editor/codec/playerResources.ts 与 playerMixer.ts。
 * ============================================================ */
import type { Input, VideoSampleSink, AudioSampleSink } from 'mediabunny'
import type { ClipTransform, TextAlign, TextContent, TextVAlign } from '../../types'
import type { TransformBounds } from '../../transform'
import type { FullscreenBar } from '../fullscreenBar'
import type { TransformOverlay } from '../transformOverlay'
import type { GridLevelMeter, StereoTap } from '../../levelMeter'
import { PlayerResources } from '../../codec/playerResources'
import { isGifClip as isGifClipFn } from '../../codec/playerResources'
import { PlayerMixer } from '../../codec/playerMixer'
import { RATIO_FIT, TC_FPS } from './constants'
import type { RatioOption } from './constants'
import { formatTimecode, snapToFrame } from '../../utils/time'
import type {
  EmitFn,
  LayerBox,
  LayerEntry,
  PlayerCommand,
  TextEditMeta,
  TlClip,
  TlLayerPump,
  ViewRect
} from './types'

export type PixiNS = typeof import('pixi.js')

/** 抽象构造器类型（mixin 入参） */
export type AbstractCtor<T = object> = abstract new (...args: any[]) => T

export abstract class PlayerBase {
  protected rootEl!: HTMLElement
  protected emit!: EmitFn
  protected docTitle = ''
  /** 以下 4 个箭头函数字段由对应 mixin 提供（保持 this 绑定、可精确 removeEventListener） */
  protected onFullscreenChange!: () => void
  protected onStagePanDown!: (e: PointerEvent) => void
  protected onStagePanMove!: (e: PointerEvent) => void
  protected onStagePanUp!: (e: PointerEvent) => void

  // DOM 节点
  protected stageEl!: HTMLDivElement
  protected playBtn!: HTMLButtonElement
  protected timeCurEl!: HTMLSpanElement
  protected timeDurEl!: HTMLSpanElement
  protected fitBtn!: HTMLButtonElement
  protected ratioBtn!: HTMLButtonElement
  protected originalBtn!: HTMLButtonElement
  /** 放大预览时右下角的导航小窗（整帧 + 视口框） */
  protected navEl!: HTMLDivElement
  protected navFrameEl!: HTMLDivElement
  protected navViewEl!: HTMLDivElement
  /** 缩放弹层中的滑块（+/− 按钮联动时回写） */
  protected zoomRange: HTMLInputElement | null = null
  /** 全屏简易播放控制条（独立组件，详见 fullscreenBar.ts） */
  protected fsBar!: FullscreenBar

  // pixi
  protected pixi: PixiNS | null = null
  protected app: import('pixi.js').Application | null = null
  protected videoSprite: import('pixi.js').Sprite | null = null
  protected videoMask: import('pixi.js').Graphics | null = null
  /** 比例视图矩形内的黑底（矩形外画布透明，露出播放器面板的深灰底） */
  protected viewBg: import('pixi.js').Graphics | null = null
  protected videoSource: import('pixi.js').CanvasSource | null = null
  protected videoTexture: import('pixi.js').Texture | null = null
  protected offCanvas: HTMLCanvasElement | null = null
  protected offCtx: CanvasRenderingContext2D | null = null
  protected resizeObs: ResizeObserver | null = null
  protected pixiReady = false

  // mediabunny 单素材实例
  protected input: Input | null = null
  protected videoSink: VideoSampleSink | null = null
  protected audioSink: AudioSampleSink | null = null
  protected duration = 0
  protected hasAudio = false
  protected hasVideo = false
  protected displayWidth = 0
  protected displayHeight = 0

  // 播放状态
  protected currentTime = 0
  protected playing = false
  protected loading = false
  // 画面填充（预览缩放，仅影响预览画面，不影响导出 / 时间线数据）：
  // canvasZoom＝在「适应窗口」基础上的放大倍数（1＝适应，最大 4＝400%）；
  // canvasPanX/Y＝相对居中位置的屏幕像素偏移，放大后拖拽画面 / 导航小窗平移
  protected canvasZoom = 1
  protected canvasPanX = 0
  protected canvasPanY = 0
  /** 画面平移手势（放大后拖拽空白画面） */
  protected panGesture: { id: number; x0: number; y0: number; panX0: number; panY0: number; moved: boolean } | null = null
  /** 平移真正发生位移后置 true，吞掉随后误触的播放/暂停 click */
  protected panSwallowClick = false
  /** 当前画面比例：fit＝适应（原始，主轨第一个资源）；其余为固定预设 */
  protected ratioOption: RatioOption = RATIO_FIT
  /** 播放画质档位（0 原画质 / 1 清晰 / 2 流畅 / 3 低清） */
  protected qualityIndex = 0

  // 底栏弹层
  protected popEl: HTMLDivElement | null = null
  protected popOwner: HTMLElement | null = null
  protected popDocDown: ((e: PointerEvent) => void) | null = null
  protected popKeyDown: ((e: KeyboardEvent) => void) | null = null

  // 单素材播放循环取消令牌
  protected runToken = 0
  protected rafId: number | null = null
  // 当前活跃的解码迭代器（停止/seek 时需显式终止，避免多个迭代器争抢同一解码器）
  protected videoIter: AsyncGenerator<any, void> | null = null
  protected audioIter: AsyncGenerator<any, void> | null = null

  // —— 时间线合成模式 ——
  /** null＝单素材模式；非 null（即使空数组）＝时间线模式 */
  protected tlClips: TlClip[] | null = null
  protected tlDuration = 0
  /** 图层表面代次：画质切换全量销毁图层后 +1，播放循环据此让「只画一次」的静态层重画 */
  protected layersEpoch = 0
  /** setTimelineTracks 后后台异步预载全部资源的 Promise（点播放时若未完成则继续等） */
  protected tlPreloading: Promise<void> | null = null
  /** 播放前资源准备中（loading 态：音频全片段预解码 / 解码器预打开 / 图片预载），再点一次=取消 */
  protected tlPreparing = false
  /** 预览轴 scrub 令牌：悬停预览的异步静帧只接受最新一次（seek / 停止 / 起播即作废） */
  protected tlScrubToken = 0
  /**
   * 播放中点轨道后的「0.5s 保护」续播定时器：点击后先在指针位置定格，
   * 0.5s 后才重新起播；期间再次点击会重新计时，暂停 / 停止 / 轨道更新则取消。
   */
  protected tlResumeTimer: ReturnType<typeof setTimeout> | null = null
  /** app.ticker 主循环回调（每次播放注册、停止 / 结束时移除） */
  protected tlTickerFn: (() => void) | null = null
  /** 无 pixi（未就绪兜底）时的节拍句柄（rAF / setTimeout） */
  protected tlRafId: number | null = null
  /**
   * 播放态多层合成：clipId → 帧泵。每个当前可见的视频片段各自顺序拉帧，
   * 到点画入对应图层 surface；主轨泵（primary）迟到时驱动时间线顺延。
   */
  protected tlLayerPumps = new Map<string, TlLayerPump>()
  /** clipId → clip 快速索引（setTimelineTracks 时同步） */
  protected tlClipById = new Map<string, TlClip>()

  // —— 编辑态多层合成 / 画面变换 ——
  /** clipId → 图层（离屏 surface + sprite），仅编辑态静帧使用 */
  protected layers = new Map<string, LayerEntry>()
  /** 全部编辑态图层共用的视图矩形遮罩（溢出比例框的部分裁切） */
  protected layersMask: import('pixi.js').Graphics | null = null
  /** 当前各可见层屏幕包围盒（供操作框 / 命中测试） */
  protected layerBoxes: LayerBox[] = []
  /** 包围盒变化监听（操作框控制器注册） */
  protected boxesListeners = new Set<() => void>()
  protected boxesRafId: number | null = null
  /** 暂停态 GIF 贴纸独立循环动画泵（rAF 句柄；GIF 动画不依赖时间线时钟） */
  protected gifIdleRaf: number | null = null
  /** 暂停态 GIF 泵的作废令牌（重渲染 / 起播 / 切轨即 ++） */
  protected gifIdleToken = 0
  /** 外部选中的片段 id（时间轴 / 画面点选同步） */
  protected selectedClipId: string | null = null
  /** 正在画面内原位编辑文字的 clipId（其文字表面临时隐藏，由 DOM 输入框接管显示）；null＝未在编辑 */
  protected editingTextId: string | null = null
  /** 画面操作框覆盖层 */
  protected overlay: TransformOverlay | null = null
  /** 画面内点选片段回调（EditorPage 用来同步时间轴选中） */
  onClipSelect: ((clipId: string | null) => void) | null = null
  /** 操作框 live 拖拽回调（不落盘 / 不入栈，仅同步面板） */
  onTransformLive: ((clipId: string, t: ClipTransform) => void) | null = null
  /** 操作框结束拖拽回调（EditorPage 统一提交 / 入栈 / 落盘） */
  onTransformCommit: ((clipId: string, t: ClipTransform) => void) | null = null
  /** 画面内文字原位编辑 live 回调（与右栏文字面板共用同一条落盘链路） */
  onTextLive: ((clipId: string, patch: Partial<TextContent>) => void) | null = null
  /** 画面内文字原位编辑结束回调（EditorPage 统一提交 / 入栈 / 落盘） */
  onTextCommit: ((clipId: string) => void) | null = null

  // —— 电平表 ——
  /** 外部音源接管格子电平表（音乐试听：格子表与竖井表同源）；非空时优先于混音总线 tap */
  protected externalTap: StereoTap | null = null
  /** 活动电平 tap 变化监听（转发给外部竖井电平表：试听音源优先，其次时间线混音） */
  protected tapListener: ((tap: StereoTap | null) => void) | null = null
  /** 播放底栏格子电平表（时间线含音频 / 视频时常驻） */
  protected levelMeter: GridLevelMeter | null = null

  // 命令队列
  protected lastCommandId = 0

  // —— 编解码资源池 / Web Audio 混音器（editor/codec，独立可测）——
  protected resources = new PlayerResources()
  protected mixer = new PlayerMixer()

  // —— 共用小方法（各 mixin 直接调，避免重复纯函数调用点）——

  /** 秒 → 帧网格（1/TC_FPS），实现复用公共 utils/time */
  protected snapTc(s: number): number {
    return snapToFrame(s, TC_FPS)
  }

  /** 秒 → HH:MM:SS:FF，实现复用公共 utils/time 的 formatTimecode */
  protected fmtTC(s: number): string {
    return formatTimecode(s, TC_FPS)
  }

  /** 是否为 GIF 动图片段（image 类、format=gif） */
  protected isGifClip(c: TlClip): boolean {
    return isGifClipFn(c)
  }

  // ====================== abstract：UI / DOM ======================
  protected abstract buildDOM(): void
  protected abstract pickClipFromOverlay(id: string): void
  protected abstract setLoading(v: boolean, text?: string): void
  protected abstract showError(msg: string): void
  protected abstract clearError(): void
  protected abstract updatePlayUI(): void
  protected abstract updateTimeUI(): void
  protected abstract toggleFullscreen(): void
  abstract setExternalLevelTap(tap: StereoTap | null): void
  abstract setTapListener(fn: ((tap: StereoTap | null) => void) | null): void
  protected abstract emitActiveTap(): void

  // ====================== abstract：弹层 ======================
  protected abstract closePopover(): void
  protected abstract openPopover(owner: HTMLElement, build: (box: HTMLDivElement) => void): void

  // ====================== abstract：缩放 / 平移 / 导航 ======================
  protected abstract toggleZoomPopover(): void
  protected abstract buildZoomPopover(box: HTMLDivElement): void
  protected abstract setCanvasZoom(z: number): void
  protected abstract initNavigator(): void
  protected abstract navScale(base: { vw: number; vh: number }): number
  protected abstract panFromNavigator(clientX: number, clientY: number): void
  protected abstract updateNavigator(): void

  // ====================== abstract：比例 / 画质菜单 ======================
  protected abstract toggleRatioMenu(): void
  protected abstract setRatio(opt: RatioOption): void
  protected abstract toggleQualityMenu(): void
  protected abstract applyQuality(index: number): void
  protected abstract qualityMaxFps(): number
  protected abstract applyTickerRate(): void

  // ====================== abstract：pixi 画面 ======================
  protected abstract initPixi(): Promise<void>
  protected abstract ensureVideoSurface(w: number, h: number): void
  protected abstract getBaseViewRect(): ViewRect | null
  protected abstract getViewRect(): ViewRect | null
  protected abstract logicalK(rect: { vw: number; vh: number }): number
  protected abstract originClip(): TlClip | null
  /** 主轨第一个资源的大小；无资源时 1600×9000 */
  protected abstract originSize(): { w: number; h: number }
  protected abstract originRatio(): number
  protected abstract relayoutStage(): void
  protected abstract layoutVideo(): void
  protected abstract presentSurface(
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    transparent?: boolean
  ): void
  protected abstract presentFrame(
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    transparent?: boolean
  ): void
  /** 按当前画质把原始 w/h 限制为中间缓冲尺寸（保持比例取整） */
  protected abstract applyQualityCap(w: number, h: number, hardCap?: number): [number, number]
  protected abstract resetVideoSurface(): void

  // ====================== abstract：单素材加载 / 播放 ======================
  protected abstract load(opts: { src?: string; file?: Blob }): Promise<void>
  protected abstract renderStill(time: number): Promise<void>
  abstract play(): Promise<void>
  abstract pause(): void
  abstract seek(time: number): void
  protected abstract runPlayback(startTime: number): void
  protected abstract handleEnded(): void
  protected abstract stopPlayback(): void
  protected abstract teardownInput(): void

  // ====================== abstract：时间线轨道 ======================
  abstract setTimelineTracks(tracks: import('../../types').TrackObject[] | null): void
  protected abstract pickVisualClip(t: number): TlClip | null
  protected abstract pickVisualClips(t: number): TlClip[]
  protected abstract disposeTimelineSources(): void

  // ====================== abstract：编辑态多层合成 ======================
  /** 成片导出开始 / 结束：静态层（图片 / 贴纸 / 文字）绘制缓存的开启与清理 */
  protected abstract beginExportPaint(): void
  protected abstract endExportPaint(): void
  protected abstract ensureLayerSurface(clipId: string, w: number, h: number): LayerEntry | null
  protected abstract destroyLayer(e: LayerEntry): void
  protected abstract pruneLayers(liveIds: Set<string>): void
  protected abstract hideAllLayers(): void
  protected abstract textLogicalSize(): { width: number; height: number }
  protected abstract paintTextSurface(clip: TlClip): Promise<LayerEntry | null>
  protected abstract applyLayerLayouts(): void
  abstract getLayerBoxes(): LayerBox[]
  abstract getLogicalK(): number
  abstract hitTest(x: number, y: number): string | null
  abstract addBoxesListener(fn: () => void): () => void
  protected abstract scheduleBoxesNotify(): void
  abstract setSelectedClipId(id: string | null): void
  abstract getSelectedClipId(): string | null
  abstract isPlayingState(): boolean
  abstract getClipTransform(clipId: string): ClipTransform | null
  abstract updateClipTransform(
    clipId: string,
    t: ClipTransform,
    b?: TransformBounds
  ): void
  /**
   * 文字位置快速对齐：返回对齐后的新 transform（非文字片段返回 null）。
   * h / v 可为 null，表示该轴保持当前坐标不变（单轴对齐按钮）。
   */
  abstract alignClipPosition(
    clipId: string,
    h: TextAlign | null,
    v: TextVAlign | null,
    b?: TransformBounds
  ): ClipTransform | null
  abstract updateClipLive(
    clipId: string,
    patch: {
      opacity?: number
      text?: Partial<TextContent>
      volume?: number
      fadeIn?: number
      fadeOut?: number
      muted?: boolean
    }
  ): void
  /** 取得文字片段原位编辑所需的内容 / 样式 / 屏幕字号（非文字片段返回 null） */
  abstract getClipEditText(clipId: string): TextEditMeta | null
  /** 进入 / 退出文字原位编辑（进入时隐藏文字表面，由 DOM 输入框接管显示） */
  abstract setTextEditing(clipId: string | null): void
  protected abstract hitTestLayer(x: number, y: number): string | null
  protected abstract pointInBox(x: number, y: number, box: LayerBox): boolean
  abstract scrub(time: number | null): void
  protected abstract renderTimelineStill(t: number, scrubToken?: number, retry?: number): Promise<void>
  /** 停止暂停态 GIF 贴纸循环动画泵 */
  protected abstract stopIdleGif(): void
  /** 为当前可见 GIF 贴纸启动暂停态循环动画（已在跑则重建） */
  protected abstract startIdleGif(clips: TlClip[]): void
  /** 把 GIF 在 clip-local 时刻对应的帧画入图层表面；返回是否实际重绘 */
  protected abstract drawGifFrame(clip: TlClip, localTime: number): Promise<boolean>

  // ====================== abstract：时间线播放 ======================
  protected abstract tlCancelPrepare(): void
  protected abstract tlClearResume(): void
  protected abstract tlStop(): void
  protected abstract killAllLayerPumps(): void
  protected abstract handleTimelineEnded(): void
  protected abstract playTimeline(): Promise<void>

  // ====================== 对外命令 ======================
  abstract setTitle(title: string): void
  abstract handleCommand(cmd: PlayerCommand): void
  abstract destroy(): void
}
