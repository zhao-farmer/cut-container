/* ============================================================
 *  时间轴 · 单个素材块的持久化视图（TimelineTrack 拆分）
 *  容器与纹理跨重绘复用；缩略格 / 波形 / 瓦片异步增量挂载
 * ============================================================ */
import type { AnyTrackItem } from '../../types'
import type { MediaStore } from '../../codec/timelineMedia'
import type { WaveformRenderer } from './waveformRenderer'
import type { ClipGeom, PixiNS } from '../core/types'
import type { TimelineConfig } from '../core/config'
import { isGifItem, sourceDurationOf } from '../core/helpers'
import { formatTimecode } from '../../utils/time'
import { tabIconDoc } from '../../utils/icons'
import type { Texture } from 'pixi.js'

/** 特效 / 滤镜前缀图标纹理缓存：直接光栅化素材库分类同款白色 SVG，全时间轴共享 */
const chipIconTextureCache = new Map<'effect' | 'filter', Promise<Texture | null>>()

function loadChipIconTexture(T: PixiNS, key: 'effect' | 'filter'): Promise<Texture | null> {
  const cached = chipIconTextureCache.get(key)
  if (cached) return cached
  const task = (async (): Promise<Texture | null> => {
    const doc = tabIconDoc(key, '#ffffff')
    if (!doc) return null
    const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return T.Texture.from(img)
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  chipIconTextureCache.set(key, task)
  return task
}

/**
 * 缩略格窗口在视口左右各预留的格数（对齐参考 asconfig 的 sideMaxNumber）：
 * 侧滚时新格提前 ~MEDIA_SIDE_CELLS×CELL_W px 开始解析，滚入即有画面；
 * 窗口总格数 = 可视格数 + 2×预留，只有可视区附近一小段，不全量铺整条视频。
 */
export const MEDIA_SIDE_CELLS = 4

/** AudioBuffer 有效性：既非 null/undefined，又有真实时长与声道；
 *  MediaBunny sink 对「容器宣称有音轨但实际解码为空」可能返回一个
 *  duration=0 的空 buffer，需排除掉——否则无音轨视频也会被错判为有音轨。 */
function hasValidAudio(buf: AudioBuffer | null | undefined): boolean {
  if (!buf) return false
  if (!(buf.duration > 0)) return false
  if (!(buf.numberOfChannels > 0)) return false
  return true
}

/* —— 音频片段覆盖层（仿剪映音量白线 / 淡入淡出柄）—— */
/** 淡变小球总半径 = 内 2px 黑心 + 外 2px 白描边 */
const FADE_BALL_R = 4
/** 小球球心相对波形区顶部的下移量（贴顶） */
const FADE_BALL_CY = 5
/** fadeIn / fadeOut 为 0 时，小球停靠在边框内侧的最小内缩 */
const FADE_BALL_INSET = FADE_BALL_R + 1
/** 淡变区半透明黑色三角的不透明度 */
const FADE_SHADE_ALPHA = 0.75
/** 鼠标未悬停时，音频覆盖层统一降到这个基础透明度（仅白线常驻；小球 hover 才显） */
const IDLE_OVERLAY_ALPHA = 0.5
/** 音量白线纵向活动区相对波形区上下的内缩 */
const VOL_TRACK_INSET = 4

/**
 * 单个素材块的持久化视图：容器与纹理跨重绘复用。
 * 每次 draw 都先同步重定位已有内容（平移 / 缩放不错位），
 * 缺失的缩略格 / 波形 / 瓦片再异步请求，回来后按当时几何挂载。
 */
export class ClipView {
  readonly key: string
  trackId = ''
  item!: AnyTrackItem
  /** 拖动过程中的临时值，pointerup 提交后清除 */
  temp: { start: number; duration: number; sourceStart: number } | null = null

  private container: import('pixi.js').Container
  private bgG: import('pixi.js').Graphics
  private mediaC: import('pixi.js').Container
  private waveC: import('pixi.js').Container
  private mediaMask: import('pixi.js').Graphics
  private waveMask: import('pixi.js').Graphics
  private label: import('pixi.js').Text
  /** 时长码（HH:MM:SS:FF），跟在名称后；video/image(含gif)/audio 素材块显示 */
  private timeLabel: import('pixi.js').Text
  /** 时长码半透明圆角底板 */
  private timeBg: import('pixi.js').Graphics
  /** 名称与时长码的共同容器（统一挂遮罩，长内容裁在块内） */
  private labelC: import('pixi.js').Container
  /** 名称文字遮罩：宽度小于块宽（从文字起点到块右缘），长文件名裁在块内 */
  private labelMask: import('pixi.js').Graphics
  private selG: import('pixi.js').Graphics
  private geom!: ClipGeom
  private selected = false

  /** 视频缩略格：格序号 → sprite / 该格请求签名（zoom|入点|高） */
  private cells = new Map<number, import('pixi.js').Sprite>()
  private cellKeys = new Map<number, string>()
  private cellWant = ''
  /** 缩略格请求代数：zoom / 入点 / 高度变化时自增，使在途请求失效 */
  private cellGen = 0
  private videoAudioBuf: AudioBuffer | null = null
  private videoAudioTried = false

  /** 独立音频文件解码结果 */
  private audioBuf: AudioBuffer | null = null
  private audioTried = false

  /** 波形 Graphics（视频内嵌音轨 / 独立音频共用） */
  private waveGfx: import('pixi.js').Graphics | null = null
  private waveSig = ''

  /** 图标 / 文字白色半透明底板（装饰轨片段块专用） */
  private chipG: import('pixi.js').Graphics

  /**
   * 音频片段交互覆盖层（仅选中态绘制）：音量白线 + 左右淡入淡出黑心白边小球
   * + 淡入 / 淡出半透明黑色三角区。鼠标未悬停时整体降为 0.5 透明度；
   * 悬停 / 拖拽中加亮到 1.0（剪映常驻半透口径）。
   */
  private audioG: import('pixi.js').Graphics
  /** 鼠标是否悬停在本块上（影响覆盖层整体 alpha） */
  private hovered = false
  /**
   * 视频内嵌音轨探测完成回调（由渲染层注入，转抛外层 TimelineCallbacks）。
   * 每个视频块最多触发一次：true＝真实含音轨（波形 / 音量手势可用）。
   */
  onAudioProbed: ((hasAudio: boolean) => void) | null = null
  /** 类型前缀矢量图标（字幕 A≡；特效 / 滤镜走光栅化 sprite） */
  private prefixG: import('pixi.js').Graphics
  /** 特效 / 滤镜前缀图标的光栅化白色 sprite（懒加载，复用素材库分类图标） */
  private chipIcon: import('pixi.js').Sprite | null = null
  private chipIconType = ''

  /** 图片 / 贴纸 / 滤镜的 cover 平铺瓦片 */
  private tile: import('pixi.js').TilingSprite | null = null
  private tileUrl = ''
  private imgSig = ''

  /** 纯色块类型（text/caption/...）只清空一次媒体区 */
  private solidKey = ''

  private destroyed = false

  constructor(
    private T: PixiNS,
    trackId: string,
    item: AnyTrackItem,
    private store: MediaStore,
    private waveform: WaveformRenderer,
    private invalidate: () => void,
    private cfg: TimelineConfig
  ) {
    // 视图缓存键只用素材 id（item.id 全局唯一）：跨轨移动 / 主轨磁吸重排只改变
    // item 所属轨与几何，素材本身不变——同一 ClipView 必须存活，已解析的视频帧 /
    // 波形 / 图片瓦片才不会推倒重来（layout 每帧用当前 lane.track.id 更新 trackId）。
    this.key = item.id
    this.trackId = trackId
    this.item = item
    this.container = new T.Container()
    this.bgG = new T.Graphics()
    this.mediaC = new T.Container()
    this.waveC = new T.Container()
    this.mediaMask = new T.Graphics()
    this.waveMask = new T.Graphics()
    // v8：Text 构造改为 { text, style } 选项形式
    this.label = new T.Text({
      text: '',
      style: {
        fontSize: cfg.clipFontSize,
        fill: cfg.clipLabelColor,
        fontFamily: 'sans-serif',
        // v8：阴影参数合并为 dropShadow 对象（distance 0 = 原位光晕）
        dropShadow: { color: 0x000000, alpha: 0.55, blur: 2, distance: 0 }
      }
    })
    this.selG = new T.Graphics()
    // 图标 / 文字白色底板 + 类型前缀小图标（仅特效 / 滤镜 / 字幕有，随标签一起被遮罩裁切）
    this.chipG = new T.Graphics()
    // 音频覆盖层（音量白线 / 淡入淡出小球与阴影）
    this.audioG = new T.Graphics()
    this.prefixG = new T.Graphics()
    // 参考 asconfig textHintInfoMask：文字容器单独挂遮罩，mask 图形与文字同级
    this.labelMask = new T.Graphics()
    // 名称 + 时长码（等宽数字）+ 时长码底板同放 labelC，整体挂 mask
    this.labelC = new T.Container()
    this.timeBg = new T.Graphics()
    this.timeLabel = new T.Text({
      text: '',
      style: {
        fontSize: cfg.clipFontSize,
        fill: cfg.clipLabelColor,
        fontFamily: 'Consolas, monospace',
        dropShadow: { color: 0x000000, alpha: 0.55, blur: 2, distance: 0 }
      }
    })
    this.mediaC.addChild(this.mediaMask)
    this.mediaC.mask = this.mediaMask
    this.waveC.addChild(this.waveMask)
    this.waveC.mask = this.waveMask
    this.labelC.addChild(this.chipG, this.prefixG, this.timeBg, this.label, this.timeLabel)
    this.container.addChild(this.bgG, this.mediaC, this.waveC, this.labelMask, this.labelC, this.audioG, this.selG)
    this.labelC.mask = this.labelMask

    // 构造即启动视频内嵌音轨探测（不依赖 draw 时机 / 视口位置）：
    // 探测结果回调外层 TimelineCallbacks.onClipAudioProbed，右侧面板据此
    // 决定是否显示音量控制组。仅 video 类型有音轨概念，GIF / 图片跳过。
    if (item.type === 'video') {
      const url = (item.source as { url: string }).url
      this.videoAudioTried = true
      this.store
        .getVideo(url)
        .getAudio()
        .then(buf => {
          if (this.destroyed) return
          this.videoAudioBuf = buf
          this.onAudioProbed?.(hasValidAudio(buf))
          this.invalidate()
        })
        .catch(() => {})
    }
  }

  get view() {
    return this.container
  }

  get start(): number {
    return this.temp ? this.temp.start : this.item.start
  }

  get duration(): number {
    return this.temp ? this.temp.duration : this.item.duration
  }

  get sourceStart(): number {
    return this.temp ? this.temp.sourceStart : this.item.sourceStart ?? 0
  }

  /**
   * 命中测试：选中态两侧 6px 为拖裁柄；
   * 音频片段 / 含内嵌音轨的视频片段支持淡入淡出小球 / 音量白线命中（点击即选中）。
   */
  hitTest(
    px: number,
    py: number
  ): 'body' | 'left' | 'right' | 'vol' | 'fadeL' | 'fadeR' | null {
    const g = this.geom
    if (py < g.y || py > g.y + g.h || px < g.x || px > g.x + g.w) return null
    // 音频交互柄（常驻命中）：淡入 / 淡出小球 + 音量白线。
    // 视频块只有在底部波形条（g.waveH>0）且真实音轨已探测到位时才放行。
    const audioEditable =
      g.waveH > 0 &&
      (this.item.type === 'audio' ||
        (this.item.type === 'video' && !!this.videoAudioBuf))
    if (audioEditable) {
      const ballCY = g.waveY + FADE_BALL_CY
      const hitR = FADE_BALL_R + 2.5
      const flX = this.fadeInBallX(g)
      const frX = this.fadeOutBallX(g)
      if ((px - flX) ** 2 + (py - ballCY) ** 2 <= hitR * hitR) return 'fadeL'
      if ((px - frX) ** 2 + (py - ballCY) ** 2 <= hitR * hitR) return 'fadeR'
      if (Math.abs(py - this.volToY(g)) <= 5 && px > g.x + 8 && px < g.x + g.w - 8) {
        return 'vol'
      }
    }
    // 选中态两侧 6px 拖裁边（保留 selected 门槛：未选中块不显示拖裁柄）
    if (this.selected && px <= g.x + 6) return 'left'
    if (this.selected && px >= g.x + g.w - 6) return 'right'
    return 'body'
  }

  setSelected(on: boolean) {
    if (on === this.selected) return
    this.selected = on
    this.drawSel()
    // 音频覆盖层（音量线 / 淡变小球）仅选中态绘制，选中变化要立刻重绘
    this.invalidate()
  }

  /** 悬停态切换：影响覆盖层整体 alpha（未悬停≈0.5、悬停≈1.0） */
  setHovered(on: boolean) {
    if (on === this.hovered) return
    this.hovered = on
    this.invalidate()
  }

  private drawSel() {
    const g = this.geom
    this.selG.clear()
    if (!this.selected || !g) return
    // v8：path + stroke/fill 链式 API
    this.selG
      .roundRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1, this.cfg.clipRadius)
      .stroke({ width: 1.5, color: this.cfg.selectionColor, alpha: 0.95 })
    // 左右白色拖裁柄：两个矩形同路径，一次 fill
    this.selG
      .roundRect(g.x - 1, g.y + g.h / 2 - 9, 3, 18, 1.5)
      .roundRect(g.x + g.w - 2, g.y + g.h / 2 - 9, 3, 18, 1.5)
      .fill({ color: this.cfg.selectionColor, alpha: 0.95 })
  }

  /** 片段块前缀图标类型（null＝无前缀；默认文本与贴纸无前缀） */
  private prefixIconKey(type: AnyTrackItem['type']): 'effect' | 'filter' | 'caption' | null {
    if (type === 'effect') return 'effect'
    if (type === 'filter') return 'filter'
    if (type === 'caption') return 'caption'
    return null
  }

  /** 取得（必要时懒建）特效 / 滤镜白色图标 sprite，纹理异步就绪后回调重绘 */
  private ensureChipSprite(key: 'effect' | 'filter'): import('pixi.js').Sprite {
    if (!this.chipIcon) {
      this.chipIcon = new this.T.Sprite()
      this.chipIcon.anchor.set(0.5, 0.5)
      this.labelC.addChild(this.chipIcon)
    }
    this.chipIconType = key
    const sp = this.chipIcon
    loadChipIconTexture(this.T, key).then(tex => {
      // 期间 layout 已切到别的类型 / 视图销毁则放弃，避免旧图标闪入
      if (this.destroyed || !tex || this.chipIconType !== key) return
      sp.texture = tex
      this.invalidate()
    })
    return sp
  }

  /**
   * 画图标白色底板 + 前缀图标（labelC 内绝对画布坐标），返回底板右缘 x。
   * 仿剪映：字幕＝白色 A≡；特效 / 滤镜＝素材库最上方分类图标的白色光栅版。
   */
  private drawPrefixChip(
    key: 'effect' | 'filter' | 'caption',
    x: number,
    y: number,
    size: number
  ): number {
    this.chipG.roundRect(x, y, size, size, 3).fill({ color: 0xffffff, alpha: 0.14 })
    const cx = x + size / 2
    const cy = y + size / 2
    if (key === 'caption') {
      // A 占左侧，右侧叠三条等长横线（A≡ 连体）
      this.prefixG
        .moveTo(cx - 4, cy + 4)
        .lineTo(cx - 1.5, cy - 5)
        .lineTo(cx + 1, cy + 4)
        .moveTo(cx - 3.2, cy + 0.6)
        .lineTo(cx + 0.2, cy + 0.6)
        .moveTo(cx + 1.4, cy - 2.2)
        .lineTo(cx + 4.4, cy - 2.2)
        .moveTo(cx + 1.4, cy + 0.4)
        .lineTo(cx + 4.4, cy + 0.4)
        .moveTo(cx + 1.4, cy + 3)
        .lineTo(cx + 4.4, cy + 3)
        .stroke({ width: 1, color: this.cfg.clipLabelColor, alpha: 0.95, cap: 'round', join: 'round' })
    } else {
      const sp = this.ensureChipSprite(key)
      sp.visible = true
      sp.position.set(cx, cy)
      sp.width = 9.5
      sp.height = 9.5
    }
    return x + size
  }

  /** 同步基础几何（底色 / 标签 / 遮罩），媒体内容由 updateMedia 增量补齐 */
  layout(item: AnyTrackItem, trackId: string, g: ClipGeom) {
    this.item = item
    this.trackId = trackId
    this.geom = g
    const T = this.T
    const cfg = this.cfg
    this.bgG.clear()
    this.bgG
      .roundRect(g.x, g.y, g.w, g.h, cfg.clipRadius)
      .fill({ color: cfg.trackBaseColors[item.type] ?? cfg.trackContentColor, alpha: 0.96 })
    this.bgG
      .roundRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1, cfg.clipRadius)
      .stroke({ width: 1, color: cfg.clipBorderColor, alpha: 0.1 })

    this.mediaMask
      .clear()
      .roundRect(g.x, g.mediaY, g.w, Math.max(1, g.mediaH), cfg.clipRadius)
      .fill(0xffffff)

    // 波形一律占 geom.waveY/waveH：主轨视频=下方 15 带，音频块=媒体区（普通轴 20 居中）
    // waveH=0（如装饰类几何 / 媒体块短暂走非媒体几何）时整个波形容器隐藏——
    // 只摘遮罩会让旧波形 Graphics 残留在上一次的位置
    if (g.waveH > 0) {
      this.waveC.visible = true
      this.waveMask.clear().roundRect(g.x, g.waveY, g.w, g.waveH, cfg.clipRadius).fill(0xffffff)
      this.waveC.mask = this.waveMask
    } else {
      this.waveC.visible = false
      this.waveC.mask = null
      this.waveMask.clear()
    }

    // 轨道块标签恒为单行：文字内容含换行时只取第一行，其余行不显示。
    // 文本 / 字幕片段直接显示其文字内容（旧字幕数据无 content 时退回文件名）。
    const rawText =
      item.type === 'text' || item.type === 'caption'
        ? (item.source as { content?: string }).content ?? item.name
        : item.name
    const text = rawText.split(/\r\n|\n|\r/)[0]
    // 装饰类（贴纸 / 文本 / 字幕 / 特效 / 滤镜 / 转场）走「白色底板芯片」样式：
    // 图标芯片（特效 / 滤镜 / 字幕）+ 文字芯片，各有一层半透明白底；
    // 媒体轨（主轨视频 / 素材轨图片 / 音频）保持贴顶名称 + 右侧时长码样式。
    const isDecor = !g.mediaLane
    const showText = g.w > 20 && !!text
    this.chipG.clear()
    this.prefixG.clear()
    this.chipIconType = ''
    if (this.chipIcon) this.chipIcon.visible = false
    this.timeBg.clear()

    if (!isDecor) {
      this.label.text = g.w > 20 ? text : ''
      // 70 高主轨名称贴顶 2px，50 高素材轨 / 音频轨沿用 3px
      const labelY = g.y + (g.h >= cfg.mainTrackHeight ? 2 : 3)
      this.label.position.set(g.x + 5, labelY)
      this.label.style.fontSize = cfg.clipFontSize
      // 素材资源（视频 / 图片含 GIF / 音频）名称后显示块时长码 HH:MM:SS:FF
      const hasTimecode =
        g.w > 20 && (item.type === 'video' || item.type === 'image' || item.type === 'audio')
      if (hasTimecode) {
        this.timeLabel.visible = true
        this.timeLabel.text = formatTimecode(this.duration, cfg.fps)
        this.timeLabel.style.fontSize = cfg.clipFontSize
        const tcX = this.label.x + this.label.width + 6
        this.timeLabel.position.set(tcX, labelY)
        // 白色 10% 叠色圆角底板
        this.timeBg
          .roundRect(tcX - 4, labelY - 1, this.timeLabel.width + 8, this.timeLabel.height + 1, 3)
          .fill({ color: 0xffffff, alpha: 0.1 })
      } else {
        this.timeLabel.visible = false
        this.timeLabel.text = ''
      }
      // 文字遮罩：左起文字 x、右到块右缘，上下各扩 2px 容纳时长码底板
      this.labelMask.clear()
      if (g.w > 20) {
        this.labelMask
          .rect(g.x + 5, labelY - 2, Math.max(1, g.w - 5), Math.max(1, this.label.height + 4))
          .fill(0xffffff)
      }
    } else {
      // 装饰块：16px 块体内放 14px 方芯片，垂直居中
      this.timeLabel.visible = false
      this.timeLabel.text = ''
      const chipSize = Math.max(10, Math.round(g.h - 2))
      const chipY = g.y + (g.h - chipSize) / 2
      let cursor = g.x + 3
      const rightLimit = g.x + g.w - 3
      const iconKey = showText ? this.prefixIconKey(item.type) : null
      if (iconKey) {
        cursor = this.drawPrefixChip(iconKey, cursor, chipY, chipSize) + 3
      }
      this.label.text = showText ? text : ''
      this.label.style.fontSize = cfg.clipFontSize
      if (showText) {
        const padX = 4
        let chipW = this.label.width + padX * 2
        if (cursor + chipW > rightLimit) {
          // 宽度放不下完整芯片：芯片填满剩余空间，文字由 labelMask 在块右缘硬裁
          chipW = Math.max(0, rightLimit - cursor)
        }
        if (chipW >= 10) {
          // 文字白色底板
          this.chipG
            .roundRect(cursor, chipY, chipW, chipSize, 3)
            .fill({ color: 0xffffff, alpha: 0.14 })
          this.label.position.set(
            cursor + padX,
            Math.round(chipY + (chipSize - this.label.height) / 2)
          )
        } else {
          this.label.text = ''
        }
      }
      // 芯片整体随块宽裁切
      this.labelMask.clear().rect(g.x + 2, g.y, Math.max(1, g.w - 4), g.h).fill(0xffffff)
    }
    this.drawSel()
  }

  clearTemp() {
    this.temp = null
  }

  /**
   * 当前视口内需要的格序号区间 [firstI, lastI]。
   * side：视口左右各预留的格数（对齐参考 sideMaxNumber），侧滚时新格提前解析、
   * 不会等滚入视口才白屏等解码；窗口总量天然 = 可视格数 + 2×side，
   * 不会把整条视频的帧一次全铺（对齐参考 videoSpriteNumber 窗口模型）。
   *
   * 两种序号口径：
   * - 视频（真实素材，不循环）：格序号 j 锚定「源时间」——第 j 格对应源
   *   [j·cellSec, (j+1)·cellSec)，世界 x = g.x + j·cellW - sourceStart·scale。
   *   该映射在左右拖裁（含提交后 sourceStart/start 同步变化）下保持不变，
   *   故向内拖裁只是遮罩收窄，格停留原位、不销毁也不重新抽帧（对齐参考
   *   asconfig offsetL/offsetR：storyboard 世界固定、mask 裁切）。
   * - GIF（循环铺格）：格序号相对块左缘，入点变化随签名整体重建。
   */
  private visibleRange(cw: number, side = 0) {
    const g = this.geom
    const cellW = this.cfg.trackMediaWidth
    // canvas 全屏逻辑坐标下可见区为 [headWidth, cw]（0..headWidth 在画布外被裁掉）
    const left = this.cfg.headWidth
    if (this.item.type !== 'video') {
      const total = Math.max(1, Math.ceil(g.w / cellW))
      const firstI = Math.max(0, Math.min(total - 1, Math.floor((left - g.x) / cellW) - side))
      const lastI = Math.min(
        total - 1,
        Math.floor((Math.min(cw, g.x + g.w) - g.x) / cellW) + side
      )
      return { firstI, lastI }
    }
    // 源锚定：世界 X 与源时间 t 互换算子 X(t)=g.x+(t-ss)·scale
    const scale = this.lastScale || 1
    const cellSec = cellW / scale
    const x0 = g.x - this.sourceStart * scale
    const srcDur = sourceDurationOf(this.item)
    const lo = left - side * cellW
    const hi = cw + side * cellW
    let firstJ = Math.floor((lo - x0) / cellW)
    let lastJ = Math.ceil((hi - x0) / cellW) - 1
    firstJ = Math.max(0, firstJ)
    if (Number.isFinite(srcDur)) lastJ = Math.min(lastJ, Math.ceil(srcDur / cellSec) - 1)
    if (firstJ > lastJ) return { firstI: 0, lastI: -1 }
    return { firstI: firstJ, lastI: lastJ }
  }

  /**
   * 每次 draw 调用：已有内容立即按新几何同步（平移 / 缩放 / 拖裁不错位），
   * 缺失内容异步请求，回来后按当时几何挂载并 invalidate 触发一次重绘。
   *
   * runCells=false（横滚拖拽节流帧）：只做已有格的几何同步，不销毁窗口外格、
   * 不发起新抽帧——滚动中每帧都有 2~3 个新格擦过视口，若逐帧抽帧会把沿途
   * 整条视频的帧全解一遍（对齐参考 scrollMainTrackMidea 的 200ms 节流）。
   * 缩放 / 入点 / 媒体高签名变化不受节流限制，立即按新签名重建。
   */
  updateMedia(rctx: { cw: number; scale: number; zoom: number }, runCells = true) {
    const g = this.geom
    const item = this.item
    const ss = this.sourceStart
    const dur = this.duration
    const cellW = this.cfg.trackMediaWidth
    this.lastScale = rctx.scale
    // 音频覆盖层先清空，音频分支末尾由 syncAudioOverlay 统一绘制（与选中态解耦）；
    // 视频 / 图片 / 装饰 / 文字分支保持 audioG 隐藏
    this.audioG.clear()
    this.audioG.visible = false

    /* -------- 视频 / GIF：连续缩略格（视频另带底部内嵌音轨波形） -------- */
    if (item.type === 'video' || isGifItem(item)) {
      // GIF 旧视图可能残留首帧平铺瓦片，进入逐格模式前清掉
      if (this.tile) {
        this.mediaC.removeChild(this.tile)
        this.tile.destroy()
        this.tile = null
        this.tileUrl = ''
        this.imgSig = ''
      }
      // 视频格锚定源时间（见 visibleRange）：签名只含 zoom/高，拖裁改入点不重建；
      // GIF 循环铺格仍以块左缘为 0 号格，入点变化需整体重建。
      const anchored = item.type === 'video'
      const want = anchored
        ? `v|${rctx.zoom}|${Math.round(g.mediaH)}`
        : `g|${rctx.zoom}|${ss.toFixed(3)}|${Math.round(g.mediaH)}`
      const wantChanged = want !== this.cellWant
      if (wantChanged) {
        this.cellWant = want
        this.cellGen++
      }
      const gen = this.cellGen
      // 格序号 → 世界 x：视频 = g.x + j·cellW - ss·scale（内容世界固定）；GIF = 块左缘起
      const posX = (i: number, sss: number, gx: number) =>
        anchored ? gx + i * cellW - sss * rctx.scale : gx + i * cellW

      // 1. 每帧必做：签名过期的格销毁，其余立即按最新几何重定位（横滚时紧随块移动）
      for (const [i, sp] of Array.from(this.cells)) {
        if (this.cellKeys.get(i) !== want) {
          this.mediaC.removeChild(sp)
          sp.destroy()
          this.cells.delete(i)
          this.cellKeys.delete(i)
        } else {
          sp.width = cellW
          sp.height = g.mediaH
          sp.position.set(posX(i, ss, g.x), g.mediaY)
        }
      }

      // 横滚节流帧：窗口增删 / 抽帧跳过（签名变化除外），已有格靠上一步跟随平移
      if (!runCells && !wantChanged) return

      // 2. 窗口（视口 + 两侧预留格）外的格销毁；窗口只覆盖可视区附近一小段，
      //    移出的格立刻摘除，缩略图始终"一次只出现窗口内这一部分"。
      //    视频窗口按视口世界坐标取源格（不按块边界）：向内拖裁被遮罩盖住的格
      //    仍在窗口内存活，外拖恢复时立即露出、无需重新解码。
      const { firstI, lastI } = this.visibleRange(rctx.cw, MEDIA_SIDE_CELLS)
      for (const [i, sp] of Array.from(this.cells)) {
        if (i < firstI || i > lastI) {
          this.mediaC.removeChild(sp)
          sp.destroy()
          this.cells.delete(i)
          this.cellKeys.delete(i)
        }
      }

      // 3. 窗口内缺失的格：视频按源格时刻抽帧、GIF 按入点换算（含循环取模），
      //    纹理缓存在 MediaStore LRU
      const cellSec = cellW / rctx.scale
      const srcDur = sourceDurationOf(item)
      const url = (item.source as { url: string }).url
      const h = Math.max(1, Math.round(g.mediaH))
      // GIF 帧来自内嵌解码器，视频帧来自 mediabunny，接口一致
      const cellMedia = item.type === 'video' ? this.store.getVideo(url) : this.store.getGif(url)
      // GIF 本身是循环动画：块拉长后帧时刻按 GIF 自身时长取模，
      // 时间轴上持续循环展示不同帧（等价参考 GifSprite.frames 循环铺格）；
      // 视频不循环，格时刻直接锚源时间，并钳在源时长内。
      const gifDur = isGifItem(item)
        ? (item.source as { duration?: number }).duration ?? 0
        : 0
      const span = Math.max(0.04, Math.min(dur, srcDur) - 0.02)
      for (let i = firstI; i <= lastI; i++) {
        if (this.cells.has(i)) continue
        const rawT = anchored ? (i + 0.5) * cellSec : ss + (i + 0.5) * cellSec
        let t: number
        if (gifDur > 0) {
          t = ((rawT % gifDur) + gifDur) % gifDur
        } else if (anchored) {
          t = Math.max(0.01, Math.min(rawT, Math.max(0.02, srcDur - 0.01)))
        } else {
          t = Math.max(ss + 0.01, Math.min(rawT, ss + span))
        }
        const idx = i
        cellMedia
          .requestCell(t, cellW, h)
          .then(tex => {
            if (this.destroyed || !tex || gen !== this.cellGen || this.cells.has(idx)) return
            const r = this.visibleRange(
              // cw 用当前几何推算视口宽度不现实，回调时用全局视口即可
              this.lastCw,
              MEDIA_SIDE_CELLS
            )
            if (idx < r.firstI || idx > r.lastI) return
            const gg = this.geom
            const sp = new this.T.Sprite(tex)
            sp.width = cellW
            sp.height = gg.mediaH
            sp.position.set(posX(idx, this.sourceStart, gg.x), gg.mediaY)
            this.mediaC.addChild(sp)
            this.cells.set(idx, sp)
            this.cellKeys.set(idx, want)
            this.invalidate()
          })
          .catch(() => {})
      }

      // 3. 视频内嵌音轨：只解析一次，到位后刷新波形 + 音量覆盖层（GIF 无音轨）
      if (item.type === 'video') {
        if (!this.videoAudioTried) {
          this.videoAudioTried = true
          this.store
            .getVideo(url)
            .getAudio()
            .then(buf => {
              if (this.destroyed) return
              this.videoAudioBuf = buf
              // 通知外层真实音轨探测结果（右侧面板据此决定是否显示音量控制组）
              this.onAudioProbed?.(hasValidAudio(buf))
              this.invalidate()
            })
            .catch(() => {})
        }
        if (this.videoAudioBuf) {
          // 音量（含片段静音）作为波形增益：分贝改变 → 柱高随动（与音频块同口径）
          const gain = (item as { muted?: boolean; volume?: number }).muted
            ? 0
            : Math.min(10, Math.max(0, item.volume ?? 1))
          this.syncWave(this.videoAudioBuf, {
            gx: g.x,
            y: g.waveY,
            h: g.waveH,
            bg: this.cfg.videoWaveBg,
            wave: this.cfg.mediaLineColor,
            ss,
            scale: rctx.scale,
            zoom: rctx.zoom,
            cw: rctx.cw,
            kind: 'v',
            gain
          })
          // 音量白线 / 淡入淡出小球覆盖层（与独立音频块同一套绘制）
          this.syncAudioOverlay(g, rctx.scale)
        }
      }
      return
    }

    /* ---------------- 音频：解码一次，整块画 dB 波形 ---------------- */
    if (item.type === 'audio') {
      if (!this.audioTried) {
        this.audioTried = true
        const url = (item.source as { url: string }).url
        this.store
          .getAudioFile(url)
          .then(buf => {
            if (this.destroyed) return
            this.audioBuf = buf
            this.invalidate()
          })
          .catch(() => {})
      }
      if (this.audioBuf) {
        // 音量（含片段静音）作为波形增益：分贝改变 → 柱高随动
        const gain = (item as { muted?: boolean; volume?: number }).muted
          ? 0
          : Math.min(10, Math.max(0, item.volume ?? 1))
        this.syncWave(this.audioBuf, {
          gx: g.x,
          y: g.waveY,
          h: g.waveH,
          bg: this.cfg.audioWaveBg,
          wave: this.cfg.audioLineColor,
          ss,
          scale: rctx.scale,
          zoom: rctx.zoom,
          cw: rctx.cw,
          kind: 'a',
          gain
        })
      }
      this.syncAudioOverlay(g, rctx.scale)
      return
    }

    /* ---------------- 静态图片 / 贴纸 / 滤镜：cover 瓦片平铺（GIF 已在上方逐格分支） ---------------- */
    if (item.type === 'image' || item.type === 'sticker' || item.type === 'filter') {
      const src = item.source as { url?: string; thumb?: string }
      const url = item.type === 'filter' ? src.thumb : src.url
      if (!url) return
      const want = `img|${url}|${Math.round(g.mediaH)}`
      // 无论是否需要重新烘焙，已有瓦片每次都同步几何（平移 / 拖裁）
      if (this.tile && this.tileUrl === url) {
        this.tile.width = g.w
        this.tile.height = g.mediaH
        this.tile.position.set(g.x, g.mediaY)
      }
      if (want !== this.imgSig) {
        this.imgSig = want
        const h = Math.max(1, Math.round(g.mediaH))
        this.store
          .getCoverTile(url, cellW, h)
          .then(tex => {
            if (this.destroyed || !tex) return
            if (!this.tile || this.tileUrl !== url) {
              this.mediaC.removeChildren()
              this.mediaC.addChild(this.mediaMask)
              const gg = this.geom
              // v8：TilingSprite 改为选项构造（旧位置参数已废弃）
              this.tile = new this.T.TilingSprite({
                texture: tex,
                width: Math.max(1, gg.w),
                height: Math.max(1, gg.mediaH)
              })
              this.tileUrl = url
              this.tile.position.set(gg.x, gg.mediaY)
              this.mediaC.addChild(this.tile)
            } else if (Math.round(this.geom.mediaH) === h) {
              // 同 url 仅高度变化：替换为新烘焙纹理
              this.tile.texture = tex
            }
            const gg = this.geom
            this.tile.width = gg.w
            this.tile.height = gg.mediaH
            this.tile.position.set(gg.x, gg.mediaY)
            this.invalidate()
          })
          .catch(() => {})
      }
      return
    }

    /* ---------------- text / caption / effect / transition：纯色块 ---------------- */
    if (this.solidKey !== item.type) {
      this.solidKey = item.type
      this.mediaC.removeChildren()
      this.mediaC.addChild(this.mediaMask)
    }
  }

  /** 最近一次布局的视口宽度（异步回调校验格可见性用） */
  private lastCw = 0
  /** 最近一次布局的 px/秒（源锚定格窗口换算用） */
  private lastScale = 0

  /** draw 时回传视口宽度 */
  noteViewport(cw: number) {
    this.lastCw = cw
  }

  /** 音量白线活动区上下沿（波形区内缩） */
  private volTrack(g: ClipGeom): { top: number; bottom: number } {
    return { top: g.waveY + VOL_TRACK_INSET, bottom: g.waveY + g.waveH - VOL_TRACK_INSET }
  }

  /** 音量 dB 范围：轨道内部以 linear 增益 0..10 存（-60dB ~ 20dB）；-60dB 显示为 -∞ */
  static readonly VOL_DB_MIN = -60
  static readonly VOL_DB_MAX = 20

  /** linear → dB（≤0 视为 -60） */
  private static volToDb(v: number): number {
    if (v <= 0) return ClipView.VOL_DB_MIN
    return Math.max(ClipView.VOL_DB_MIN, Math.min(ClipView.VOL_DB_MAX, 20 * Math.log10(v)))
  }
  /** dB → linear（范围 -60..20） */
  private static dbToVol(db: number): number {
    const d = Math.max(ClipView.VOL_DB_MIN, Math.min(ClipView.VOL_DB_MAX, db))
    return Math.pow(10, d / 20)
  }

  /** 音量 linear → 白线 y（dB 空间等距映射：顶=20dB，底=-60dB） */
  private volToY(g: ClipGeom): number {
    const vol = (this.item as { volume?: number }).volume ?? 1
    const { top, bottom } = this.volTrack(g)
    const db = ClipView.volToDb(vol)
    const ratio = (db - ClipView.VOL_DB_MIN) / (ClipView.VOL_DB_MAX - ClipView.VOL_DB_MIN)
    return bottom - ratio * (bottom - top)
  }

  /** 指针 y → 音量 linear（0..10） */
  yToVolume(g: ClipGeom, py: number): number {
    const { top, bottom } = this.volTrack(g)
    const ratio = Math.max(0, Math.min(1, (bottom - py) / (bottom - top)))
    const db = ClipView.VOL_DB_MIN + ratio * (ClipView.VOL_DB_MAX - ClipView.VOL_DB_MIN)
    return ClipView.dbToVol(db)
  }

  /** 淡入小球中心 x：fadeIn=0 时停靠在左边框内侧 FADE_BALL_INSET 处 */
  private fadeInBallX(g: ClipGeom): number {
    const scale = this.lastScale || 1
    const fi = Math.max(0, Math.min((this.item as { fadeIn?: number }).fadeIn ?? 0, this.duration))
    return g.x + Math.max(FADE_BALL_INSET, Math.min(fi * scale, g.w - FADE_BALL_INSET))
  }

  /** 淡出小球中心 x：fadeOut=0 时停靠在右边框内侧 FADE_BALL_INSET 处 */
  private fadeOutBallX(g: ClipGeom): number {
    const scale = this.lastScale || 1
    const fo = Math.max(0, Math.min((this.item as { fadeOut?: number }).fadeOut ?? 0, this.duration))
    return g.x + g.w - Math.max(FADE_BALL_INSET, Math.min(fo * scale, g.w - FADE_BALL_INSET))
  }

  /**
   * 绘制音频交互覆盖层（独立音频片段 + 含内嵌音轨的视频片段常驻绘制）：
   * 音量白线 + 淡入淡出黑心白边小球 + 淡入淡出半透明黑色三角压暗；
   * 未悬停时整体 0.5 透明度（常驻弱化），悬停时 1.0（可操作态）。
   * 选中态青色描边由 selG 单独负责，overlay 与 selected 解耦。
   */
  private syncAudioOverlay(g: ClipGeom, scale: number) {
    this.audioG.clear()
    const isAudioClip = this.item.type === 'audio'
    const isVideoAudio = this.item.type === 'video' && !!this.videoAudioBuf
    if ((!isAudioClip && !isVideoAudio) || g.waveH <= 0) {
      this.audioG.visible = false
      return
    }
    this.audioG.visible = true
    const top = g.waveY
    const bottom = g.waveY + g.waveH
    const h = g.waveH
    const vy = this.volToY(g)
    // 基础透明度：未悬停≈0.5（常驻弱化），悬停≈1.0。
    // 白线用 base；淡变遮罩恒 0.75（不受 hover 影响，常驻全色）。
    // 淡变小球仅 hover 时绘。
    const base = this.hovered ? 1 : IDLE_OVERLAY_ALPHA
    const ballVisible = this.hovered

    const fi = Math.max(0, Math.min((this.item as { fadeIn?: number }).fadeIn ?? 0, this.duration))
    const fo = Math.max(0, Math.min((this.item as { fadeOut?: number }).fadeOut ?? 0, this.duration))
    const fiX = this.fadeInBallX(g)
    const foX = this.fadeOutBallX(g)

    /**
     * Bezier 弧形遮罩（向内凹陷）：
     * 原直线三角的斜边是 (edgeX,bottom) → (fullX,top)。要让曲线**向内凹陷**
     * （相对三角形，即曲线向斜边的上方/空区弯，使黑遮罩比直线三角更小），
     * 两个控制点的 y 必须放在对角线**上方**。
     *   diagY(x) = bottom - h * (x-edgeX)/span
     * 当前 cp1y 在 bottom（= diagY 起点）→ 外凸；改到顶部附近 → 内凹。
     */
    const FADE_CURVE_RATIO = 0.8
    const drawFadeIn = () => {
      const edgeX = g.x
      const fullX = edgeX + fi * scale * FADE_CURVE_RATIO
      if (fullX <= edgeX + 0.5) return
      const span = fullX - edgeX
      // cp1 从中段上方拉（远高于对角线），cp2 在终点前一点贴近顶边
      const cp1x = edgeX + span * 0.5
      const cp1y = top + h * 0.15
      const cp2x = fullX - span * 0.05
      const cp2y = top + h * 0.05
      this.audioG
        .moveTo(edgeX, top)
        .lineTo(edgeX, bottom)
        .bezierCurveTo(cp1x, cp1y, cp2x, cp2y, fullX, top)
        .closePath()
        .fill({ color: 0x000000, alpha: FADE_SHADE_ALPHA })
    }
    const drawFadeOut = () => {
      const rightX = g.x + g.w
      const fullX = rightX - fo * scale * FADE_CURVE_RATIO
      if (fullX >= rightX - 0.5) return
      const span = rightX - fullX
      const cp1x = rightX - span * 0.5
      const cp1y = top + h * 0.15
      const cp2x = fullX + span * 0.05
      const cp2y = top + h * 0.05
      this.audioG
        .moveTo(rightX, top)
        .lineTo(rightX, bottom)
        .bezierCurveTo(cp1x, cp1y, cp2x, cp2y, fullX, top)
        .closePath()
        .fill({ color: 0x000000, alpha: FADE_SHADE_ALPHA })
    }
    if (fi > 0) drawFadeIn()
    if (fo > 0) drawFadeOut()

    // 音量白线（常驻，受 hover 影响）
    this.audioG
      .moveTo(g.x + 3, vy)
      .lineTo(g.x + g.w - 3, vy)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.95 * base, cap: 'round' })

    // 两个淡变小球：仅悬停绘制；1px 黑心 + 2px 白描边（外圆 r=4, stroke w=2）
    if (ballVisible) {
      const ballCY = top + FADE_BALL_CY
      const BALL_CORE_R = 1
      const drawBall = (cx: number) => {
        this.audioG
          .circle(cx, ballCY, FADE_BALL_R)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.95 })
        this.audioG
          .circle(cx, ballCY, BALL_CORE_R)
          .fill({ color: 0x141414, alpha: 1 })
      }
      drawBall(fiX)
      drawBall(foX)
    }
  }

  /**
   * 波形（源时间窗口锚定，语义同视频缩略格）：
   * 只烘焙「视口 + 两侧预留格」世界窗口与素材源区间相交的一段，条内每像素
   * 对应 1/scale 源秒，世界位置 X = gx + (tA - ss)·scale。
   * 向内拖裁时 gx 与 ss 同步变化（trimL）或均不变（trimR），X 与 tA/tB
   * 数学上恒定 → 不重新烘焙，仅 waveMask 随块宽收窄完成视觉裁切（对齐参考
   * asconfig offsetL/offsetR：音频条世界固定、遮罩裁切）；向外拖裁露出新
   * 源区间、或横滚 / 块移动越过 64px 网格时才重算一次（逐列振幅，无解码）。
   */
  private syncWave(
    buf: AudioBuffer,
    o: {
      gx: number
      y: number
      h: number
      bg: number
      wave: number
      ss: number
      scale: number
      zoom: number
      cw: number
      kind: 'v' | 'a'
      /** 音量增益（拖白线时柱高随动；muted 传 0）；缺省 1 */
      gain?: number
    }
  ) {
    if (o.h <= 0) return
    const pad = MEDIA_SIDE_CELLS * this.cfg.trackMediaWidth
    // 世界窗口 [headWidth-pad, cw+pad] → 源时间（X(t)=gx+(t-ss)·scale），再夹到素材范围
    const maxT = Math.min(buf.duration, sourceDurationOf(this.item))
    const tL = Math.max(0, o.ss + (this.cfg.headWidth - pad - o.gx) / o.scale)
    const tR = Math.min(maxT, o.ss + (o.cw + pad - o.gx) / o.scale)
    const inWindow = tR - tL >= 1 / o.scale
    if (this.waveGfx) this.waveGfx.visible = inWindow
    if (!inWindow) return
    // 64px 世界粒度归格：横滚 / 移动的小位移复用旧条；拖裁内收 tL/tR 完全不变
    const gridSec = 64 / o.scale
    const tA = Math.floor(tL / gridSec) * gridSec
    const tB = Math.ceil(tR / gridSec) * gridSec
    const wpx = Math.max(1, Math.round((tB - tA) * o.scale))
    // 增益按 0.01 量化入键：拖白线连续变动时重烘焙次数可控，同一音量始终命中同一纹理
    const gQ = Math.round(Math.max(0, o.gain ?? 1) * 100)
    const key = `${o.kind}|${o.zoom}|${Math.round(o.h)}|${Math.round(tA * o.scale)}|${wpx}|g${gQ}`
    if (key !== this.waveSig) {
      if (this.waveGfx) {
        this.waveC.removeChild(this.waveGfx)
        this.waveGfx.destroy()
        this.waveGfx = null
      }
      const gfx = this.waveform.build({
        buffer: buf,
        offset: tA,
        duration: wpx / o.scale,
        width: wpx,
        height: Math.max(1, Math.round(o.h)),
        bg: o.bg,
        wave: o.wave,
        secPerPx: 1 / o.scale,
        gain: o.gain ?? 1
      })
      this.waveGfx = gfx
      this.waveC.addChild(gfx)
      this.waveSig = key
    }
    this.waveGfx?.position.set(o.gx + (tA - o.ss) * o.scale, o.y)
  }

  destroy() {
    this.destroyed = true
    this.cellGen++
    // 前缀图标纹理是全时间轴共享缓存，销毁节点时不得连带释放
    if (this.chipIcon) {
      this.labelC.removeChild(this.chipIcon)
      this.chipIcon.destroy({ texture: false })
      this.chipIcon = null
    }
    // 共享纹理（抽帧 / 瓦片）由 MediaStore 统一释放，这里只销毁节点
    this.container.destroy({ children: true })
  }
}
