/* ============================================================
 *  编辑器框架 · 模块二：中部播放器
 *  框架自有 MediaBunnyPlayer 的薄封装：
 *  - 维护对外展示用的"播放器视图状态"（状态/时间/时长/分辨率）
 *  - 状态变化通过 onState 推给右详情模块（高频 timeupdate 同路径）
 *  - mediabunny 原始事件同时经 emit 向外部框架透传
 * ============================================================ */
import { MediaBunnyPlayer } from './core/mediaBunnyPlayer'
import { fmtTime } from '../utils/time'
import type { ClipTransform, TextAlign, TextContent, TextVAlign, TrackObject } from '../types'
import type { TransformBounds } from '../transform'
import type { StereoTap } from '../levelMeter'

export interface PlayerViewState {
  status: string
  time: string
  duration: string
  size: string
}

export interface PlayerStageHandle {
  setTitle: (title: string) => void
  /** 播放器左上角标题（素材预览时「正在预览 …」；null 恢复「播放器」） */
  setHeaderTitle: (title: string | null) => void
  /** 素材预览进度条显隐（时间线模式隐藏） */
  setPreviewScrub: (show: boolean) => void
  load: (src: string) => void
  /** 注入时间线轨道 → 进入合成播放模式（画面合成 + Web Audio 混音） */
  setTracks: (tracks: TrackObject[] | null) => void
  /** 悬停预览：把 t 时刻画面上屏但不动播放头；null＝恢复播放头位置静帧 */
  scrub: (time: number | null) => void
  handleCommand: (cmd: any) => void
  getState: () => PlayerViewState
  // —— 画面变换 / 编辑态选中 ——
  /** 设置播放器内选中片段（时间轴 → 播放器；含跨区间入点预览） */
  setSelectedClip: (clipId: string | null) => void
  /** 播放器点选片段回调（播放器 → 时间轴同步） */
  onClipPick: (cb: ((clipId: string | null) => void) | null) => void
  /** 操作框 live 拖拽 / 结束提交回调注册 */
  onTransformEdit: (
    cbs: {
      live?: (clipId: string, t: ClipTransform) => void
      commit?: (clipId: string, t: ClipTransform) => void
    } | null
  ) => void
  /** 画面内文字原位编辑 live / 提交回调注册（与右栏文字面板共用同一条落盘链路） */
  onTextEdit: (
    cbs: {
      live?: (clipId: string, patch: Partial<TextContent>) => void
      commit?: (clipId: string) => void
    } | null
  ) => void
  /** 面板 / 外部实时写变换（拖拽过程不落盘）；b 为该入口的缩放范围 */
  updateTransform: (clipId: string, t: ClipTransform, b?: TransformBounds) => void
  /** 批量写变换（切比例时一次重排） */
  updateTransforms: (entries: Array<{ clipId: string; transform: ClipTransform; bounds?: TransformBounds }>) => void
  /** 比例切换后：按新比例重排并重绘文字表面（不重建轨道 / 不重新预载） */
  refreshAfterRatio: () => void
  /** 面板高频轻量改片段（不透明度 / 文字样式 / 音频参数）：不重设轨道、不停播放 */
  updateClipLive: (
    clipId: string,
    patch: {
      opacity?: number
      text?: Partial<TextContent>
      volume?: number
      fadeIn?: number
      fadeOut?: number
      muted?: boolean
    }
  ) => void
  /** 文字位置快速对齐（h / v 可为 null 表示该轴不动）：返回新 transform（非文字片段 null） */
  alignClipPosition: (
    clipId: string,
    h: TextAlign | null,
    v: TextVAlign | null,
    b?: TransformBounds
  ) => ClipTransform | null
  /** 外部音源接管 / 释放底栏格子电平表（音乐试听：格子表与竖井表同源） */
  setLevelTap: (tap: StereoTap | null) => void
  /** 监听活动电平 tap（时间线播放 / 音乐试听 → 外部竖井电平表） */
  setTapListener: (fn: ((tap: StereoTap | null) => void) | null) => void
  /**
   * 导出当前时间线成片（MP4：H.264 画面 + AAC 混音）。
   * 宽高用草稿画布尺寸，fps 与时间轴帧率一致（30）；逐帧捕获 pixi 画布，
   * 期间播放器临时切全分辨率并在结束后自动恢复。
   */
  exportVideo: (params: {
    width: number
    height: number
    fps: number
    onProgress?: (phase: 'video' | 'audio' | 'mux', ratio: number) => void
    signal?: { cancelled: boolean }
  }) => Promise<ArrayBuffer>
  destroy: () => void
}

export function createPlayerStage(
  stageEl: HTMLElement,
  opts: { src: string; title: string; timelineTracks?: TrackObject[] | null },
  onState: (state: PlayerViewState) => void,
  emit: (name: string, detail: any) => void
): PlayerStageHandle {
  const state: PlayerViewState = {
    status: '未加载',
    time: '00:00',
    duration: '00:00',
    size: ''
  }
  const publish = () => onState({ ...state })

  const mediaPlayer = new MediaBunnyPlayer(
    stageEl,
    { src: opts.src, title: opts.title, timelineTracks: opts.timelineTracks ?? null },
    (name, detail) => {
      const d = detail || {}
      if (name === 'media:ready' || name === 'media:metadata') {
        state.status = '已就绪'
        if (typeof d.duration === 'number') state.duration = fmtTime(d.duration)
        if (d.width && d.height) state.size = `${d.width}×${d.height}`
        publish()
      } else if (name === 'media:play') {
        state.status = '播放中'
        publish()
      } else if (name === 'media:pause') {
        state.status = '已暂停'
        publish()
      } else if (name === 'media:ended') {
        state.status = '已结束'
        publish()
      } else if (name === 'media:timeupdate') {
        state.time = fmtTime(d.currentTime)
        publish()
      }
      // 向外透传（外部框架可订阅，但不强制）
      emit(name, detail)
    }
  )

  return {
    setTitle(title: string) {
      mediaPlayer.setTitle(title)
    },
    setHeaderTitle(title: string | null) {
      mediaPlayer.setHeaderTitle(title)
    },
    setPreviewScrub(show: boolean) {
      mediaPlayer.setPreviewScrub(show)
    },
    load(src: string) {
      mediaPlayer.handleCommand({ id: Date.now() + Math.random(), type: 'load', src })
    },
    setTracks(tracks: TrackObject[] | null) {
      mediaPlayer.setTimelineTracks(tracks)
    },
    scrub(time: number | null) {
      mediaPlayer.scrub(time)
    },
    handleCommand(cmd: any) {
      mediaPlayer.handleCommand(cmd)
    },
    getState() {
      return { ...state }
    },
    setSelectedClip(clipId: string | null) {
      mediaPlayer.setSelectedClipId(clipId)
    },
    onClipPick(cb) {
      mediaPlayer.onClipSelect = cb
    },
    onTransformEdit(cbs) {
      mediaPlayer.onTransformLive = cbs?.live ?? null
      mediaPlayer.onTransformCommit = cbs?.commit ?? null
    },
    onTextEdit(cbs) {
      mediaPlayer.onTextLive =
        (cbs?.live as ((clipId: string, patch: Partial<TextContent>) => void) | undefined) ?? null
      mediaPlayer.onTextCommit = cbs?.commit ?? null
    },
    updateTransform(clipId: string, t: ClipTransform, b?: TransformBounds) {
      mediaPlayer.updateClipTransform(clipId, t, b)
    },
    updateTransforms(entries) {
      mediaPlayer.updateClipTransforms(entries)
    },
    refreshAfterRatio() {
      mediaPlayer.refreshAfterRatio()
    },
    updateClipLive(
      clipId: string,
      patch: {
        opacity?: number
        text?: Partial<TextContent>
        volume?: number
        fadeIn?: number
        fadeOut?: number
        muted?: boolean
      }
    ) {
      mediaPlayer.updateClipLive(clipId, patch)
    },
    alignClipPosition(
      clipId: string,
      h: TextAlign | null,
      v: TextVAlign | null,
      b?: TransformBounds
    ) {
      return mediaPlayer.alignClipPosition(clipId, h, v, b)
    },
    setLevelTap(tap: StereoTap | null) {
      mediaPlayer.setExternalLevelTap(tap)
    },
    setTapListener(fn: ((tap: StereoTap | null) => void) | null) {
      mediaPlayer.setTapListener(fn)
    },
    exportVideo(params) {
      return mediaPlayer.exportTimeline(params)
    },
    destroy() {
      mediaPlayer.destroy()
    }
  }
}

export default createPlayerStage
