/* ============================================================
 *  播放器舞台 · pixi 画面 mixin
 *  pixi v8 应用初始化（透明画布 + 比例视图黑底 + 双遮罩）、
 *  单素材离屏 surface（CanvasSource 动态重建）、比例视图矩形
 *  （适应（原始） / 固定比例，叠加预览缩放与平移钳制）、
 *  contain 布局、画质限边后的离屏帧呈现。
 * ============================================================ */
import { LOGICAL_SHORT_SIDE } from '../../transform'
import * as PIXI from 'pixi.js'
import { DEFAULT_ORIGIN_SIZE } from '../core/constants'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'
import type { TlClip, ViewRect } from '../core/types'

export function PixiStageMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class PixiStage extends Base {
    // ====================== pixi 画面 ======================
    protected async initPixi() {
      if (!this.rootEl.isConnected) return
      this.pixi = PIXI
      const app = new PIXI.Application()
      await app.init({
        // 画布本身透明：只有 16:9 比例视图矩形画黑底，矩形外露出播放器面板的深灰底，
        // 这样中栏尺寸变化时黑色画面区按 contain 等比缩放、四周留灰边（剪映式）。
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        width: this.stageEl.clientWidth || 800,
        height: this.stageEl.clientHeight || 450
      })
      if (!this.rootEl.isConnected) {
        app.destroy(false, { children: true })
        return
      }
      this.app = app
      app.canvas.style.position = 'absolute'
      app.canvas.style.inset = '0'
      app.canvas.style.display = 'block'
      // 画布置于覆盖层（中央三角 / loading / error）之下
      this.stageEl.insertBefore(app.canvas, this.stageEl.firstChild)

      app.stage.sortableChildren = true
      // 比例视图黑底（最底层；矩形外保持透明）
      this.viewBg = new PIXI.Graphics()
      this.viewBg.zIndex = -10
      app.stage.addChild(this.viewBg)
      this.videoMask = new PIXI.Graphics()
      app.stage.addChild(this.videoMask)
      this.videoSprite = new PIXI.Sprite()
      this.videoSprite.visible = false
      this.videoSprite.zIndex = 0
      this.videoSprite.mask = this.videoMask
      app.stage.addChild(this.videoSprite)
      // 编辑态多层共用的视图遮罩（与 videoMask 同矩形，独立对象互不干扰）
      this.layersMask = new PIXI.Graphics()
      // 没有任何图层引用它时，遮罩会作为普通白色矩形被渲染出来（空工程会铺满白底）；
      // 先隐藏，等真正有可见图层时再打开（见 applyLayerLayouts）
      this.layersMask.visible = false
      app.stage.addChild(this.layersMask)

      // 画面区尺寸变化 → 同步重设 pixi 渲染分辨率并重排（比例视图 / contain/cover /
      // 编辑态多层都依赖它）。不用 app.resizeTo：该选项在本环境（web component +
      // 影子 DOM）下不跟随，分隔条联动缩放时画布会停留在初始尺寸。
      // resize() 会立即清空画布，内容要等下一帧 ticker 才重绘——拖拽分隔条时每一帧
      // 都会出现一帧「空透明画布（露灰底）→ 画面」，表现为闪烁。故 resize+重排后
      // 在同一次 RO 回调（浏览器绘制前）手动补渲染一帧，保证每次绘制都是完整画面。
      this.resizeObs = new ResizeObserver(entries => {
        const rect = entries[0]?.contentRect
        const w = Math.round(rect?.width ?? this.stageEl.clientWidth)
        const h = Math.round(rect?.height ?? this.stageEl.clientHeight)
        let resized = false
        if (
          w > 0 &&
          h > 0 &&
          (app.screen.width !== w || app.screen.height !== h)
        ) {
          app.renderer.resize(w, h)
          resized = true
        }
        this.relayoutStage()
        if (resized) app.renderer.render(app.stage)
      })
      this.resizeObs.observe(this.stageEl)

      this.pixiReady = true
      // 初始化期间媒体可能已就绪：补一帧当前时刻静帧
      if (this.tlClips) {
        void this.renderTimelineStill(this.currentTime)
      } else if (this.hasVideo) {
        this.renderStill(this.currentTime)
      }
      this.layoutVideo()
    }

    /**
     * 按显示分辨率（重新）创建离屏 canvas + CanvasSource。
     * mediabunny 帧先 draw 到离屏 canvas，再 source.update() 触发 GPU 上传。
     */
    protected ensureVideoSurface(w: number, h: number) {
      const PIXI = this.pixi
      if (!PIXI || !this.videoSprite) return
      if (this.videoSource && this.offCanvas && this.offCanvas.width === w && this.offCanvas.height === h) return
      if (this.videoTexture) {
        this.videoSprite.texture = PIXI.Texture.EMPTY
        this.videoTexture.destroy(true)
        this.videoTexture = null
        this.videoSource = null
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const source = new PIXI.CanvasSource({ resource: canvas, scaleMode: PIXI.SCALE_MODES.LINEAR })
      const texture = new PIXI.Texture({ source })
      this.offCanvas = canvas
      this.offCtx = ctx
      this.videoSource = source
      this.videoTexture = texture
      this.videoSprite.texture = texture
      this.videoSprite.visible = false
      this.layoutVideo()
    }

    /** 比例视图基础矩形（CSS 像素；fit＝整个画面区），不含画面填充缩放/平移 */
    protected getBaseViewRect(): ViewRect | null {
      const app = this.app
      if (!app) return null
      const cw = app.screen.width
      const ch = app.screen.height
      if (cw <= 0 || ch <= 0) return null
      // 比例锁定视图矩形：「适应（原始）」取主轨第一个资源大小；
      // 主轨没有资源时使用默认 1600×900。
      let ratio = this.ratioOption.ratio
      if (this.ratioOption.key === 'fit') ratio = this.originRatio()
      let vw = cw
      let vh = ch
      if (ratio !== null) {
        if (cw / ch > ratio) {
          vh = ch
          vw = ch * ratio
        } else {
          vw = cw
          vh = cw / ratio
        }
      }
      return { vx: (cw - vw) / 2, vy: (ch - vh) / 2, vw, vh }
    }

    /**
     * 当前实际视图矩形＝比例基础矩形再叠加画面填充缩放/平移。
     * 放大后画面矩形大于屏幕，平移偏移按「画面始终覆盖屏幕」钳制（黑边轴无法平移）。
     * 单精灵 / 时间线图层 / 遮罩 / 屏幕包围盒全部以此为准，故缩放平移对编辑命中同样生效。
     */
    protected getViewRect(): ViewRect | null {
      const base = this.getBaseViewRect()
      if (!base) return null
      const cw = this.app!.screen.width
      const ch = this.app!.screen.height
      const z = this.canvasZoom
      const zw = base.vw * z
      const zh = base.vh * z
      const maxX = Math.max(0, (zw - cw) / 2)
      const maxY = Math.max(0, (zh - ch) / 2)
      this.canvasPanX = Math.min(maxX, Math.max(-maxX, this.canvasPanX))
      this.canvasPanY = Math.min(maxY, Math.max(-maxY, this.canvasPanY))
      return {
        vx: (cw - zw) / 2 + this.canvasPanX,
        vy: (ch - zh) / 2 + this.canvasPanY,
        vw: zw,
        vh: zh
      }
    }

    /** 逻辑像素 → 屏幕像素系数（比例视图短边对应逻辑短边 1080） */
    protected logicalK(rect: { vw: number; vh: number }): number {
      return Math.min(rect.vw, rect.vh) / LOGICAL_SHORT_SIDE
    }

    /**
     * 「适应（原始）」依据：主轨（layer 0）上时间最早的视频 / 图片资源。
     * 主轨没有资源时返回 null，由 originSize 回退到 1600×900。
     */
    protected originClip(): TlClip | null {
      if (this.tlClips) {
        const main = this.tlClips
          .filter(c => c.layer === 0 && (c.kind === 'video' || c.kind === 'image'))
          .sort((a, b) => a.start - b.start)
        return main[0] ?? null
      }
      return null
    }

    /** 主轨第一个资源的原生大小；无资源 / 尺寸未知时 1600×900 */
    protected originSize(): { w: number; h: number } {
      if (this.tlClips) {
        const clip = this.originClip()
        if (clip) {
          if (clip.natW && clip.natH) return { w: clip.natW, h: clip.natH }
          const d = this.resources.getDim(clip.url)
          if (d && d.w > 0 && d.h > 0) return { w: d.w, h: d.h }
        }
        return { ...DEFAULT_ORIGIN_SIZE }
      }
      // 单素材模式：已加载的视频原生尺寸
      if (this.hasVideo && this.displayWidth > 0 && this.displayHeight > 0) {
        return { w: this.displayWidth, h: this.displayHeight }
      }
      return { ...DEFAULT_ORIGIN_SIZE }
    }

    protected originRatio(): number {
      const { w, h } = this.originSize()
      return w / h
    }

    /** 舞台尺寸 / 比例 / 画面填充变化时统一重排（播放单精灵 + 编辑态多层 + 导航小窗） */
    protected relayoutStage() {
      this.layoutVideo()
      if (this.tlClips) {
        this.applyLayerLayouts()
        this.scheduleBoxesNotify()
      }
      this.updateNavigator()
    }

    /** 把当前离屏画面按 比例视图（含填充缩放/平移）contain 摆进画面区（居中、黑底信箱） */
    protected layoutVideo() {
      const rect = this.getViewRect()
      // 黑底与两个遮罩始终跟随视图矩形（即使单精灵还没有表面）
      if (rect) {
        this.viewBg?.clear().rect(rect.vx, rect.vy, rect.vw, rect.vh).fill(0x000000)
        this.videoMask?.clear().rect(rect.vx, rect.vy, rect.vw, rect.vh).fill(0xffffff)
        this.layersMask?.clear().rect(rect.vx, rect.vy, rect.vw, rect.vh).fill(0xffffff)
      } else {
        this.viewBg?.clear()
      }
      const sprite = this.videoSprite
      if (!sprite || !rect || !this.displayWidth || !this.displayHeight) return
      const { vx, vy, vw, vh } = rect
      // 视频在视图内等比适应（完整显示；放大裁剪由画面填充缩放完成）
      const s = Math.min(vw / this.displayWidth, vh / this.displayHeight)
      sprite.anchor.set(0.5)
      const w = this.displayWidth * s
      const h = this.displayHeight * s
      const cx = vx + vw / 2
      const cy = vy + vh / 2
      sprite.width = w
      sprite.height = h
      sprite.position.set(cx, cy)
      sprite.rotation = 0
    }

    /**
     * 以指定分辨率呈现一帧（时间线合成用：每个片段分辨率可不同）。
     * 内部把 displayWidth/Height 切到该尺寸，离屏 surface 随之重建并重新布局。
     * transparent=true 时表面保留透明通道（贴纸 / 文字 / 透明 PNG）。
     */
    protected presentSurface(
      w: number,
      h: number,
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
      transparent = false
    ) {
      if (!this.pixiReady) return
      this.displayWidth = w
      this.displayHeight = h
      this.presentFrame(draw, transparent)
      // 切片段 / 分辨率后确保按当前片段 transform 布局（尺寸未变时 ensureVideoSurface 不会布局）
      this.layoutVideo()
    }

    /** 向离屏 canvas 绘制一帧并通知 pixi 重新上传（transparent 时清空而不铺黑） */
    protected presentFrame(
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
      transparent = false
    ) {
      if (!this.pixiReady) return
      // 中间缓冲按当前画质限边（原画质＝视频原生尺寸）
      const [sw, sh] = this.applyQualityCap(this.displayWidth, this.displayHeight)
      this.ensureVideoSurface(sw, sh)
      const ctx = this.offCtx
      if (!ctx || !this.videoSource) return
      if (transparent) {
        ctx.clearRect(0, 0, sw, sh)
      } else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, sw, sh)
      }
      draw(ctx, sw, sh)
      this.videoSource.update()
      if (this.videoSprite) this.videoSprite.visible = true
    }

    /** 销毁单素材离屏表面（画质切换后下一帧按新尺寸重建） */
    protected resetVideoSurface() {
      const PIXI = this.pixi
      if (this.videoTexture) {
        if (this.videoSprite) this.videoSprite.texture = PIXI ? PIXI.Texture.EMPTY : this.videoSprite.texture
        this.videoTexture.destroy(true)
      }
      this.videoTexture = null
      this.videoSource = null
      this.offCanvas = null
      this.offCtx = null
    }
  }

  return PixiStage
}
