/* ============================================================
 *  MediaBunnyPlayer · 最终装配类
 *
 *  由各子系统 mixin 组合而成（行为与原单体类逐方法对应、零改动搬迁）：
 *
 *    Shell             底栏 DOM / loading / 全屏 / 电平表对外口
 *      └ Popover         通用弹层
 *        └ ZoomPan       预览缩放 / 平移 / 导航小窗
 *          └ Menus       画面比例 / 播放画质菜单
 *            └ PixiStage pixi 应用 / 视图矩形 / 离屏 surface / 布局
 *              └ Layers  编辑态多层合成 / 静帧 / 操作框几何
 *                └ Tracks        轨道数据展平注入
 *                  └ SinglePlayback  单素材 mediabunny 加载与 A/V 循环
 *                  └ TimelinePlayback 时间线合成播放（帧泵 + ticker）
 *                    └ ExportCapture  成片导出（全分辨率逐帧捕获 + 离线混音）
 *
 *  编解码相关状态与逻辑独立于播放器（codec 文件按消费方前缀区分）：
 *    editor/codec/playerResources.ts        播放器多轨合成资源池（解码器 / 图片 / GIF / 静帧串行链）
 *    editor/codec/playerMixer.ts            播放器唯一的 Web Audio 混音单元
 *    editor/codec/playerMediaSourceDecoder.ts 单源 mediabunny 解码器
 * ============================================================ */
import { ShellMixin } from '../ui/shell'
import { PopoverMixin } from '../ui/popover'
import { ZoomPanMixin } from '../ui/zoomPan'
import { MenusMixin } from '../ui/menus'
import { PixiStageMixin } from '../stage/pixiStage'
import { LayersMixin } from '../timeline/layers'
import { TracksMixin } from '../timeline/tracks'
import { SinglePlaybackMixin } from '../playback/single'
import { TimelinePlaybackMixin } from '../timeline/playback'
import { ExportCaptureMixin } from '../timeline/exportCapture'
import { PlayerBase } from './playerBase'
import type { EmitFn, MediaBunnyPlayerOptions, PlayerCommand } from './types'

const PlayerWithShell = ShellMixin(PlayerBase)
const PlayerWithPopover = PopoverMixin(PlayerWithShell)
const PlayerWithZoomPan = ZoomPanMixin(PlayerWithPopover)
const PlayerWithMenus = MenusMixin(PlayerWithZoomPan)
const PlayerWithStage = PixiStageMixin(PlayerWithMenus)
const PlayerWithLayers = LayersMixin(PlayerWithStage)
const PlayerWithTracks = TracksMixin(PlayerWithLayers)
const PlayerWithSingle = SinglePlaybackMixin(PlayerWithTracks)
const PlayerWithTimeline = TimelinePlaybackMixin(PlayerWithSingle)
const PlayerWithExport = ExportCaptureMixin(PlayerWithTimeline)

export class MediaBunnyPlayer extends PlayerWithExport {
  constructor(rootEl: HTMLElement, options: MediaBunnyPlayerOptions, emit: EmitFn) {
    super()
    this.rootEl = rootEl
    this.emit = emit
    this.docTitle = options.title || ''
    this.buildDOM()
    void this.initPixi()

    // 时间线合成模式：静帧由轨道数据决定；否则单素材加载
    // （默认项目自带同源示例视频 public/sample.mp4，含 H.264 + AAC；
    //  也可 props.src 指定远程地址（需 CORS），或 load({file}) 走 BlobSource）。
    if (options.timelineTracks) {
      this.setTimelineTracks(options.timelineTracks)
    } else if (options.file) {
      this.load({ file: options.file })
    } else {
      this.load({ src: options.src || '/sample.mp4' })
    }
  }

  // ====================== props 命令（父→子）======================
  /** 更新播放器标题（外部草稿名，挂到容器原生提示，不改剪映式固定头标） */
  setTitle(title: string) {
    this.docTitle = title
    this.rootEl.title = title
  }

  /**
   * 父应用通过 props 下发命令，例如：
   *   el.props = { command: { id: Date.now(), type: 'seek', time: 10 } }
   */
  handleCommand(cmd: PlayerCommand) {
    if (!cmd || cmd.id === this.lastCommandId) return
    this.lastCommandId = cmd.id
    switch (cmd.type) {
      case 'play':
        void this.play()
        break
      case 'pause':
        this.pause()
        break
      case 'seek':
        if (typeof cmd.time === 'number') this.seek(cmd.time)
        break
      case 'load':
        if (cmd.file) this.load({ file: cmd.file })
        else if (cmd.src) this.load({ src: cmd.src })
        break
    }
  }

  destroy() {
    this.closePopover()
    this.teardownInput()
    this.stageEl.removeEventListener('pointerdown', this.onStagePanDown)
    this.stageEl.removeEventListener('pointermove', this.onStagePanMove)
    this.stageEl.removeEventListener('pointerup', this.onStagePanUp)
    this.stageEl.removeEventListener('pointercancel', this.onStagePanUp)
    this.externalTap = null
    this.tlStop()
    this.disposeTimelineSources()
    // Web Audio：拆除电平 tap / 混音总线并关闭音频上下文（codec/PlayerMixer）
    this.mixer.dispose()
    this.levelMeter?.destroy()
    this.levelMeter = null
    this.overlay?.destroy()
    this.overlay = null
    document.removeEventListener('fullscreenchange', this.onFullscreenChange)
    this.fsBar?.destroy()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    if (this.app) {
      try { this.app.destroy(false, { children: true }) } catch { /* noop */ }
      this.app = null
    }
    this.videoSprite = null
    this.videoMask = null
    this.viewBg = null
    this.layersMask = null
    this.videoTexture = null
    this.videoSource = null
    this.offCanvas = null
    this.offCtx = null
    this.layerBoxes = []
    this.boxesListeners.clear()
    if (this.boxesRafId !== null) {
      cancelAnimationFrame(this.boxesRafId)
      this.boxesRafId = null
    }
    this.pixiReady = false
  }
}

export default MediaBunnyPlayer
