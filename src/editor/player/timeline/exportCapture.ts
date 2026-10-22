/* ============================================================
 *  播放器时间线 · 成片导出捕获 mixin
 *
 *  对外唯一方法 exportTimeline()：
 *  - 临时把 pixi 渲染器切到草稿画布全分辨率（分辨率 1：1 像素），
 *    强制比例＝画布宽高比、复位预览缩放 / 平移、画质恢复「原画质」，
 *    并隐藏画布与画面操作框（避免导出期间的视觉跳动）；
 *  - 逐帧调用编辑态多层合成静帧 renderTimelineStill(t)（与暂停态 /
 *    seek / 预览同一套渲染口径），手动补渲染后交给 codec/timelineExporter
 *    的 mediabunny CanvasSource 抓帧；
 *  - 可闻片段（音频轨 + 视频原声，剔除静音）交给同一导出器离线混音；
 *  - 无论成功 / 失败 / 取消，finally 完整恢复渲染器尺寸 / 比例 / 缩放 /
 *    画质 / 可见性 / ResizeObserver，并重新渲染当前播放头静帧。
 * ============================================================ */
import { exportTimelineMp4 } from '../../codec/timelineExporter'
import type { ExportMixClip } from '../../codec/timelineExporter'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export interface TimelineExportHandleOptions {
  width: number
  height: number
  fps: number
  onProgress?: (phase: 'video' | 'audio' | 'mux', ratio: number) => void
  signal?: { cancelled: boolean }
  /** 封面图（写入成片元信息 covr），不参与逐帧渲染 */
  cover?: { data: Uint8Array; mimeType: string } | null
  /** 作品标题（写入成片元信息） */
  title?: string
}

export function ExportCaptureMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class ExportCapture extends Base {
    /**
     * 导出当前时间线为 MP4 ArrayBuffer。要求处于时间线合成模式且总时长 > 0。
     * 导出期间播放器定格（不可播放），结束后自动恢复原状态。
     */
    async exportTimeline(opts: TimelineExportHandleOptions): Promise<ArrayBuffer> {
      const clips = this.tlClips
      const app = this.app
      if (!clips || !app || !this.pixiReady) throw new Error('播放器尚未就绪，无法导出')
      if (!(this.tlDuration > 0)) throw new Error('时间线为空，无法导出')

      // 导出期间定格：停掉播放会话 / 帧泵 / 混音
      this.tlStop()

      // 可闻片段：与播放准备同一口径（轨道静音 / 片段静音都剔除）
      const audible: ExportMixClip[] = clips
        .filter(c => !c.muted && !c.itemMuted && (c.kind === 'audio' || c.kind === 'video'))
        .map(c => ({
          id: c.id,
          url: c.url,
          start: c.start,
          end: c.end,
          sourceStart: c.sourceStart,
          volume: c.volume,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut
        }))
      // 区间音频解码需要真实 AudioContext（用户点击「导出视频」的手势栈内创建）
      const decodeCtx = this.mixer.ctx ?? this.mixer.ensureContextSync()

      // —— 保存将被临时改写的状态 ——
      const cssW = this.stageEl.clientWidth || 800
      const cssH = this.stageEl.clientHeight || 450
      const oldResolution = app.renderer.resolution
      const oldRatio = this.ratioOption
      const oldZoom = this.canvasZoom
      const oldPanX = this.canvasPanX
      const oldPanY = this.canvasPanY
      const oldQuality = this.qualityIndex
      const oldTime = this.currentTime
      const canvasStyleVis = app.canvas.style.visibility
      const tfLayer = this.rootEl.querySelector<HTMLElement>('.tf-layer')
      const oldTfVis = tfLayer?.style.visibility ?? ''
      const resizeObs = this.resizeObs

      try {
        // 1) 隐藏画布 / 操作框：渲染器将被放大到成片全分辨率，避免用户看到跳变
        app.canvas.style.visibility = 'hidden'
        if (tfLayer) tfLayer.style.visibility = 'hidden'
        // 导出期间不响应画面区尺寸观察（恢复后重新挂回）
        resizeObs?.disconnect()

        // 2) 切到草稿画布全分辨率（1:1 像素），比例精确匹配，复位缩放平移，
        //    画质回到原画质（静帧取中间缓冲按当前画质限边，导出不取降采样）
        app.renderer.resize(opts.width, opts.height, 1)
        this.ratioOption = { key: '__export__', label: '导出', ratio: opts.width / opts.height }
        this.canvasZoom = 1
        this.canvasPanX = 0
        this.canvasPanY = 0
        this.qualityIndex = 0
        // 渲染器尺寸已变，但导出期间 ResizeObserver 已断开，必须手动重排一次：
        // 让黑底 viewBg 与 layersMask / videoMask 跟随成片分辨率重建。否则遮罩
        // 仍是导出前画面区的小矩形，而图层按新分辨率居中铺满，二者不相交 →
        // 所有图层被整块裁掉，导出画面全黑（音轨正常）。
        this.relayoutStage()

        // 4) 导出专用优化：逐帧顺序解码视频（每帧只解一次，避免 getSample 反复
        //    seek），静态层只画一次；结束后在 finally 里全部释放。
        this.resources.beginStillSequence()
        this.beginExportPaint()

        // 3) 逐帧渲染：与暂停态静帧同一套多层合成，随后手动补一帧渲染上屏
        const prepareFrame = async (t: number) => {
          await this.renderTimelineStill(t)
          app.render()
        }

        return await exportTimelineMp4({
          width: opts.width,
          height: opts.height,
          fps: opts.fps,
          duration: this.tlDuration,
          canvas: app.canvas,
          prepareFrame,
          clips: audible,
          getDecoder: url => this.resources.getDecoder(url),
          decodeCtx,
          onProgress: opts.onProgress,
          signal: opts.signal,
          cover: opts.cover ?? null,
          title: opts.title
        })
      } finally {
        // 顺序取帧游标 / 静态层缓存一律先释放（取消导出时也不留帧）
        this.resources.endStillSequence()
        this.endExportPaint()
        // —— 无条件恢复全部临时改写 ——
        this.ratioOption = oldRatio
        this.canvasZoom = oldZoom
        this.canvasPanX = oldPanX
        this.canvasPanY = oldPanY
        this.qualityIndex = oldQuality
        try {
          app.renderer.resize(cssW, cssH, oldResolution)
        } catch {
          /* 渲染器已销毁等极端情况：无需恢复 */
        }
        app.canvas.style.visibility = canvasStyleVis
        if (tfLayer) tfLayer.style.visibility = oldTfVis
        this.relayoutStage()
        void this.renderTimelineStill(oldTime)
        if (resizeObs) resizeObs.observe(this.stageEl)
      }
    }
  }

  return ExportCapture
}
