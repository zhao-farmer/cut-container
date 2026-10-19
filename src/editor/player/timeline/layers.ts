/* ============================================================
 *  播放器时间线 · 编辑态多层合成 mixin
 *  - 每个可见视觉片段一个独立离屏 surface（CanvasSource + Sprite），
 *    按 clipId 池化复用、按视图矩形共用遮罩；
 *  - 静帧渲染 renderTimelineStill：收集 t 时刻全部可见层
 *    （视频取帧走 codec 资源池串行链；图片/GIF/贴纸绘制、文本走 SVG
 *    光栅化），transform 布局、屏幕旋转包围盒、点选命中测试；
 *  - 对外：选中态同步、操作框变换读写、不透明度 / 文本 live 更新、
 *    悬停预览 scrub。
 * ============================================================ */
import {
  baseFitOf,
  effectiveScale,
  logicalCanvasSize,
  normalizeTransform,
  type TransformBounds
} from '../../transform'
import { resolveTextStyle } from '../../types'
import type { ClipTransform, TextAlign, TextContent, TextVAlign } from '../../types'
import {
  buildCanvasTextSvg,
  ensureTextFont,
  measureTextBlock,
  rasterizeTextSvg
} from '../../utils/textSvg'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'
import type { LayerBox, LayerEntry, TextEditMeta, TlClip } from '../core/types'
import { isTextClipKind } from '../core/types'

/** 把描边颜色与不透明度合成一个 CSS 颜色（支持 #rgb / #rrggbb / #rrggbbaa；其它格式原样返回） */
function mergeColorAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha))
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())
  if (!m) return color
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const own = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  return `rgba(${r},${g},${b},${Math.round(a * own * 1000) / 1000})`
}

export function LayersMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class Layers extends Base {
    /**
     * 导出期间已画好的静态层（图片 / 贴纸 / 文字）：它们的表面内容与时间无关，
     * 逐帧重绘 + 纹理重传纯属浪费，导出开始时清空即可全程复用。
     */
    private exportPainted = new Set<string>()

    /** 导出开始：清空静态层绘制缓存（随后每层只需画一次） */
    protected beginExportPaint(): void {
      this.exportPainted.clear()
    }

    /** 导出结束：释放缓存标记 */
    protected endExportPaint(): void {
      this.exportPainted.clear()
    }

    /** t 时刻可见的画面片段：取覆盖该时刻的最高层级（同层取后出现者） */
    protected pickVisualClip(t: number): TlClip | null {
      const clips = this.tlClips
      if (!clips) return null
      let best: TlClip | null = null
      for (const c of clips) {
        if (c.kind === 'audio' || !c.visible) continue
        if (c.start <= t && t < c.end) {
          if (!best || c.layer >= best.layer) best = c
        }
      }
      return best
    }

    /** t 时刻全部可见视觉片段（layer 升序），编辑态多层合成用 */
    protected pickVisualClips(t: number): TlClip[] {
      const clips = this.tlClips
      if (!clips) return []
      const out: TlClip[] = []
      for (const c of clips) {
        if (c.kind === 'audio' || !c.visible) continue
        if (c.start <= t && t < c.end) out.push(c)
      }
      out.sort((a, b) => a.layer - b.layer || a.start - b.start)
      return out
    }

    /** 取得（或按新尺寸重建）某片段的编辑态图层 surface */
    protected ensureLayerSurface(clipId: string, w: number, h: number): LayerEntry | null {
      const PIXI = this.pixi
      const app = this.app
      if (!PIXI || !app || !this.layersMask) return null
      let e = this.layers.get(clipId)
      if (!e) {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        const source = new PIXI.CanvasSource({ resource: canvas, scaleMode: PIXI.SCALE_MODES.LINEAR })
        const texture = new PIXI.Texture({ source })
        const sprite = new PIXI.Sprite(texture)
        sprite.anchor.set(0.5)
        sprite.visible = false
        sprite.mask = this.layersMask
        app.stage.addChild(sprite)
        e = {
          clipId,
          sprite,
          source,
          texture,
          canvas,
          ctx,
          natW: w,
          natH: h,
          textKey: '',
          textReady: false,
          textToken: 0,
          visible: false
        }
        this.layers.set(clipId, e)
        return e
      }
      if (e.natW !== w || e.natH !== h) {
        e.canvas.width = w
        e.canvas.height = h
        const source = new PIXI.CanvasSource({ resource: e.canvas, scaleMode: PIXI.SCALE_MODES.LINEAR })
        const texture = new PIXI.Texture({ source })
        e.sprite.texture = PIXI.Texture.EMPTY
        e.texture.destroy(true)
        e.texture = texture
        e.source = source
        e.sprite.texture = texture
        e.natW = w
        e.natH = h
        e.textKey = ''
        e.textBox = undefined
        e.textReady = false
        e.textToken++
      }
      return e
    }

    protected destroyLayer(e: LayerEntry) {
      const PIXI = this.pixi
      try {
        e.sprite.destroy({ texture: false })
        e.sprite.texture = PIXI?.Texture.EMPTY ?? e.sprite.texture
        e.texture.destroy(true)
      } catch { /* noop */ }
      this.layers.delete(e.clipId)
    }

    /** 回收已不在轨道中的图层 */
    protected pruneLayers(liveIds: Set<string>) {
      for (const [id, e] of Array.from(this.layers)) {
        if (!liveIds.has(id)) this.destroyLayer(e)
      }
    }

    /** 隐藏全部编辑态图层（进入播放 / 黑场） */
    protected hideAllLayers() {
      for (const e of this.layers.values()) {
        e.visible = false
        e.sprite.visible = false
      }
      this.layerBoxes = []
      this.scheduleBoxesNotify()
    }

    /** 文本表面的逻辑尺寸（随当前比例视图比例） */
    protected textLogicalSize(): { width: number; height: number } {
      const rect = this.getViewRect()
      const ratio = rect && rect.vh > 0 ? rect.vw / rect.vh : 16 / 9
      return logicalCanvasSize(ratio)
    }

    /**
     * 按 TextContent 构建文字 SVG 并光栅化进透明表面（内容指纹未变则跳过）。
     * 几何（字形包围盒）在字体就绪后同步算出，像素异步上屏；
     * 快速连续改字时按 textToken 丢弃过期图像，最终只保留最新一版。
     * 支持：粗体 / 斜体 / 下划线、字 / 行间距、水平 / 垂直对齐、描边、多层阴影 / 发光。
     */
    protected async paintTextSurface(clip: TlClip): Promise<LayerEntry | null> {
      const raw = clip.text
      if (!raw) return null
      const st = resolveTextStyle(raw)
      const size = this.textLogicalSize()
      const e = this.ensureLayerSurface(clip.id, size.width, size.height)
      if (!e) return null
      const key = `${JSON.stringify(st)}|${size.width}x${size.height}`
      if (e.textKey === key && e.textReady) return e
      e.textKey = key
      const token = ++e.textToken
      try {
        // web 字体先就绪再测量 / 光栅化，避免首帧回退字体造成版式跳动
        await ensureTextFont(st.fontFamily)
        if (token !== e.textToken || e.textKey !== key) return e
        const built = buildCanvasTextSvg(st, size.width, size.height)
        e.textBox = built.box
        const img = await rasterizeTextSvg(built.svg)
        if (token !== e.textToken || e.textKey !== key) return e
        e.ctx.clearRect(0, 0, size.width, size.height)
        e.ctx.drawImage(img, 0, 0, size.width, size.height)
        e.textReady = true
      } catch {
        if (token !== e.textToken || e.textKey !== key) return e
        // 光栅化失败不清空已有内容；首建失败则给一张空表面
        e.ctx.clearRect(0, 0, size.width, size.height)
        e.textReady = true
      }
      return e
    }

    /**
     * 文字位置快速对齐：返回对齐后的新 transform。
     * h / v 为 null 时该轴保持当前坐标（单轴对齐：左 / 水平居中 / 右 · 顶 / 垂直居中 / 底）。
     * b 用于保留文字面板更宽的缩放范围（0% – 500%）。
     */
    alignClipPosition(
      clipId: string,
      h: TextAlign | null,
      v: TextVAlign | null,
      b?: TransformBounds
    ): ClipTransform | null {
      const clip = this.tlClipById.get(clipId)
      if (!clip || !isTextClipKind(clip)) return null
      const size = this.textLogicalSize()
      // 同步测量字形盒（SVG 几何，不必等光栅化完成）
      const box = clip.text ? measureTextBlock(resolveTextStyle(clip.text)) : null
      const bw = box?.w ?? (clip.text?.fontSize ?? 48) * 3
      const bh = box?.h ?? size.height * 0.2
      const cur = normalizeTransform(clip.transform, b)
      // 字形盒恒居中（ox/oy 已为 0），边缘对齐直接以画布半宽减字形半宽
      const x =
        h === null
          ? cur.x
          : Math.round(
              h === 'left'
                ? -(size.width - bw) / 2
                : h === 'right'
                  ? (size.width - bw) / 2
                  : 0
            )
      const y =
        v === null
          ? cur.y
          : Math.round(
              v === 'top'
                ? -(size.height - bh) / 2
                : v === 'bottom'
                  ? (size.height - bh) / 2
                  : 0
            )
      return normalizeTransform({ ...cur, x, y }, b)
    }

    /**
     * 按各片段 transform 把全部可见图层摆进视图；同时刷新屏幕包围盒。
     * scale=1 基准＝表面自然尺寸 contain（cover 模式取 max）铺满比例视图框。
     */
    protected applyLayerLayouts() {
      const rect = this.getViewRect()
      if (!rect) return
      const { vx, vy, vw, vh } = rect
      const k = this.logicalK(rect)
      const cx = vx + vw / 2
      const cy = vy + vh / 2
      const boxes: LayerBox[] = []
      if (this.layersMask) {
        // 遮罩只在有可见图层时显示；否则它会作为普通白色矩形铺在画面上
        this.layersMask.visible = Array.from(this.layers.values()).some(e => e.visible)
      }
      for (const e of this.layers.values()) {
        if (!e.visible) continue
        const clip = this.tlClipById.get(e.clipId)
        if (!clip) continue
        // 表面自然尺寸 contain 铺满比例视图框（画面填充缩放已含在 rect 内）
        const fit = Math.min(vw / e.natW, vh / e.natH)
        // 叠轨素材初始画中画缩小（主轨铺满），让多层资源同时可见、层级可辨
        const base = fit * baseFitOf(clip.kind, clip.layer)
        const tr = clip.transform
        const { sx, sy } = effectiveScale(tr)
        const w = e.natW * base * sx
        const h = e.natH * base * sy
        const px = cx + tr.x * k
        const py = cy + tr.y * k
        const rot = (tr.rotation * Math.PI) / 180
        // 用 sprite.scale 设置实际缩放下的翻转符号（PIXI v8 Sprite.width/height 会覆盖 scale 的符号，
        // 因此直接用 scale 设置，sprite.width = abs(scale.x * texture.width) 仍然对）
        e.sprite.scale.set(
          base * sx * (tr.flipH ? -1 : 1),
          base * sy * (tr.flipV ? -1 : 1)
        )
        e.sprite.position.set(px, py)
        e.sprite.rotation = rot
        e.sprite.alpha = clip.opacity
        // 文字层的包围盒贴合字形：表面仍是整幅逻辑画布，字形可能因对齐停靠
        // 偏离表面中心（ox/oy）；盒心＝精灵中心 + 偏移（随旋转一起转动）。
        const isTextBox = isTextClipKind(clip) && !!e.textBox
        const tb = e.textBox
        const bw = isTextBox ? tb!.w * base * sx : w
        const bh = isTextBox ? tb!.h * base * sy : h
        // 屏幕包围盒四角（含旋转）。直接由几何计算，不读 sprite.worldTransform——
        // 后者只在 pixi 渲染帧更新，图层从隐藏切显示后的首个布局会读到旧矩阵，
        // 导致命中测试（操作框按 cx/w 摆放正常）漏掉该层。
        const cos = Math.cos(rot)
        const sin = Math.sin(rot)
        const boxOx = isTextBox ? (tb!.ox ?? 0) * base * sx : 0
        const boxOy = isTextBox ? (tb!.oy ?? 0) * base * sy : 0
        const bcx = px + boxOx * cos - boxOy * sin
        const bcy = py + boxOx * sin + boxOy * cos
        const hw = bw / 2
        const hh = bh / 2
        const rotQuad: Array<[number, number]> = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        const corners: LayerBox['corners'] = rotQuad.map(([qx, qy]) => ({
          x: bcx + qx * cos - qy * sin,
          y: bcy + qx * sin + qy * cos
        }))
        boxes.push({ clipId: e.clipId, cx: bcx, cy: bcy, w: bw, h: bh, rotation: rot, corners })
      }
      this.layerBoxes = boxes
    }

    getLayerBoxes(): LayerBox[] {
      return this.layerBoxes
    }

    /** 当前舞台的逻辑像素 → 屏幕像素系数（供操作框拖拽换算） */
    getLogicalK(): number {
      const rect = this.getViewRect()
      return rect ? this.logicalK(rect) : 1
    }

    /** 屏幕点命中测试（供操作框） */
    hitTest(x: number, y: number): string | null {
      return this.hitTestLayer(x, y)
    }

    /** 订阅包围盒变化（rAF 合帧），返回取消函数 */
    addBoxesListener(fn: () => void): () => void {
      this.boxesListeners.add(fn)
      return () => this.boxesListeners.delete(fn)
    }

    protected scheduleBoxesNotify() {
      if (this.boxesRafId !== null || !this.boxesListeners.size) return
      this.boxesRafId = requestAnimationFrame(() => {
        this.boxesRafId = null
        this.boxesListeners.forEach(fn => fn())
      })
    }

    // —— 对外：选中 / 变换 ——

    /** 设置外部选中片段（时间轴选中 / 画面点选的统一入口） */
    setSelectedClipId(id: string | null) {
      if (this.selectedClipId === id) return
      this.selectedClipId = id
      if (!this.playing && !this.tlPreparing) {
        this.tlScrubToken++
        void this.renderTimelineStill(this.currentTime)
      }
    }

    getSelectedClipId(): string | null {
      return this.selectedClipId
    }

    isPlayingState(): boolean {
      return this.playing
    }

    getClipTransform(clipId: string): ClipTransform | null {
      return this.tlClipById.get(clipId)?.transform ?? null
    }

    /** live 变换更新（拖拽中）：只改工作态布局，不解码 / 不落盘 */
    updateClipTransform(clipId: string, t: ClipTransform, b?: TransformBounds) {
      const clip = this.tlClipById.get(clipId)
      if (!clip) return
      clip.transform = normalizeTransform(t, b)
      // 播放态同样是多层图层合成（tlLayerPumps 渲染进同一 surface 池）
      this.applyLayerLayouts()
      this.scheduleBoxesNotify()
    }

    /** live 变换批量更新（切比例时只写数据，布局由 refreshAfterRatio 统一做一次） */
    updateClipTransforms(
      entries: Array<{ clipId: string; transform: ClipTransform; bounds?: TransformBounds }>
    ) {
      for (const { clipId, transform, bounds } of entries) {
        const clip = this.tlClipById.get(clipId)
        if (clip) clip.transform = normalizeTransform(transform, bounds)
      }
    }

    /**
     * 比例切换后的轻量刷新：只按新视图比例重排，并重绘文字层表面（其逻辑画布随比例变化）。
     * 不重新 setTracks / 不重新预载解码器 / 不 seek 视频静帧，避免切比例卡顿。
     */
    refreshAfterRatio() {
      this.relayoutStage()
      for (const e of this.layers.values()) {
        const clip = this.tlClipById.get(e.clipId)
        if (!clip || !isTextClipKind(clip)) continue
        void this.paintTextSurface(clip).then(entry => {
          if (!entry) return
          entry.source.update()
          this.applyLayerLayouts()
          this.scheduleBoxesNotify()
        })
      }
    }

    /**
     * 面板高频轻量改片段（不落盘 / 不重设轨道 / 不停播）：
     * - opacity：改 clip 后下一帧布局自动生效（静帧与播放同路径）；
     * - text：文字表面按 textKey 重建 SVG 光栅化并上传纹理，播放中也即时可见。
     */
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
      const clip = this.tlClipById.get(clipId)
      if (!clip) return
      if (patch.opacity !== undefined) {
        clip.opacity = Math.min(1, Math.max(0, patch.opacity))
        // 暂停态静帧不会自动重绘：立刻按新 alpha 重排图层，拖动滑杆即时可见
        this.applyLayerLayouts()
        this.scheduleBoxesNotify()
      }
      // 音频参数（轨道音量白线 / 淡入淡出小球、右侧面板共用）：
      // 直接写当前播放会话的 TlClip，seek / 下一轮 lookahead 补排即按新包络发声；
      // 已排入 Web Audio 的节点不回收（包络在调度时已固化），松手入栈后重设轨道收敛。
      if (patch.volume !== undefined) clip.volume = Math.min(10, Math.max(0, patch.volume))
      if (patch.fadeIn !== undefined) clip.fadeIn = Math.max(0, patch.fadeIn)
      if (patch.fadeOut !== undefined) clip.fadeOut = Math.max(0, patch.fadeOut)
      if (patch.muted !== undefined) clip.itemMuted = !!patch.muted
      if (patch.text) {
        clip.text = { ...(clip.text as TextContent), ...patch.text }
        void this.paintTextSurface(clip).then(e => {
          // 像素上屏；textBox 在光栅化前已随内容重算，故这里必须再跑一次布局
          // 并广播包围盒——编辑态选中框保持显示，框要跟着键入即时伸缩。
          if (e) {
            e.source.update()
            this.applyLayerLayouts()
            this.scheduleBoxesNotify()
          }
        })
        // 同步先排一次（textBox 尚未更新时盒形沿用旧值，光栅化完成后上面再校正）
        this.applyLayerLayouts()
        this.scheduleBoxesNotify()
      }
    }

    /** 文字原位编辑所需信息：内容 / 颜色 / 字体 + 屏幕字号（含 fit 与片段缩放） */
    getClipEditText(clipId: string): TextEditMeta | null {
      const clip = this.tlClipById.get(clipId)
      if (!clip || !isTextClipKind(clip) || !clip.text) return null
      const st = resolveTextStyle(clip.text)
      const size = this.textLogicalSize()
      const rect = this.getViewRect()
      const fit = rect ? Math.min(rect.vw / size.width, rect.vh / size.height) : 1
      const { sx } = effectiveScale(clip.transform)
      // 逻辑像素 → 屏幕像素（文字 baseFit 恒为 1）
      const s = fit * sx
      return {
        content: st.content,
        color: st.color,
        fontFamily: st.fontFamily || 'sans-serif',
        bold: st.bold,
        italic: st.italic,
        underline: st.underline,
        vertical: st.vertical,
        align: st.align,
        letterSpacing: st.letterSpacing * s,
        lineHeight: (st.fontSize * 1.25 + st.lineSpacing) * s,
        strokeWidth: st.stroke.enabled && st.stroke.width > 0 ? st.stroke.width * s : 0,
        strokeColor:
          st.stroke.enabled && st.stroke.width > 0
            ? mergeColorAlpha(st.stroke.color, st.stroke.opacity)
            : undefined,
        screenFontSize: Math.max(10, st.fontSize * s)
      }
    }

    /** 进入 / 退出文字原位编辑：重画一帧（表面始终显示，编辑框文字透明不产生双影） */
    setTextEditing(clipId: string | null) {
      if (this.editingTextId === clipId) return
      this.editingTextId = clipId
      if (!this.playing && !this.tlPreparing) {
        this.tlScrubToken++
        void this.renderTimelineStill(this.currentTime)
      }
    }

    /** 当前画面上某屏幕点命中的最上层片段 id（未命中 null，层级以轨道 layer 为准） */
    protected hitTestLayer(x: number, y: number): string | null {
      let best: LayerBox | null = null
      let bestLayer = -Infinity
      for (const box of this.layerBoxes) {
        if (!this.pointInBox(x, y, box)) continue
        const layer = this.tlClipById.get(box.clipId)?.layer ?? 0
        if (!best || layer > bestLayer) {
          best = box
          bestLayer = layer
        }
      }
      return best ? best.clipId : null
    }

    /** 旋转矩形点内测试（叉积同号） */
    protected pointInBox(x: number, y: number, box: LayerBox): boolean {
      const [p0, p1, p2, p3] = box.corners
      if (!p0 || !p1 || !p2 || !p3) return false
      const sides: Array<[typeof p0, typeof p1]> = [[p0, p1], [p1, p2], [p2, p3], [p3, p0]]
      let sign = 0
      for (const [a, b] of sides) {
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
        const s = cross > 0 ? 1 : cross < 0 ? -1 : 0
        if (s === 0) return true
        if (sign === 0) sign = s
        else if (sign !== s) return false
      }
      return true
    }

    /**
     * 悬停预览（预览轴开启且非播放态）：把 t 时刻的画面上屏，但不改动 currentTime / 播放头。
     * 传 null＝恢复显示当前播放头位置的静帧（鼠标离开时间线 / 关闭预览轴时）。
     * 播放 / 准备中调用直接忽略（播放中预览轴由时间轴侧禁用）。
     */
    scrub(time: number | null) {
      if (!this.tlClips || this.playing || this.tlPreparing || this.tlResumeTimer !== null) return
      if (time === null) {
        // 恢复播放头位置正式静帧：作废旧悬停预览，GIF 暂停循环泵随之恢复
        this.tlScrubToken++
        void this.renderTimelineStill(this.currentTime)
        return
      }
      const token = ++this.tlScrubToken
      const t = Math.max(0, Math.min(this.tlDuration || 0, time))
      void this.renderTimelineStill(t, token)
    }

    /**
     * 把 GIF 在 clip-local 时刻对应的帧画入图层表面。
     * localTime 为相对片段头的素材时刻（已含 sourceStart），GIF 循环播放。
     * 帧序号未变时跳过重绘；返回是否实际重绘。
     */
    protected async drawGifFrame(clip: TlClip, localTime: number): Promise<boolean> {
      const gif = await this.resources.getGif(clip.url)
      if (!gif || !gif.frames.length) return false
      const dur = gif.duration > 0 ? gif.duration : 1
      const t = ((localTime % dur) + dur) % dur
      let fi = 0
      for (let i = 0; i < gif.frames.length; i++) {
        if (gif.frames[i].time <= t) fi = i
        else break
      }
      if (this.resources.gifFrameIdx.get(clip.id) === fi) return false
      const f = gif.frames[fi]
      // 图片类安全上限 1920，再叠加当前画质长边限制
      const [w, h] = this.applyQualityCap(f.image.width, f.image.height, 1920)
      const e = this.ensureLayerSurface(clip.id, w, h)
      if (!e) return false
      e.ctx.clearRect(0, 0, w, h)
      if (w === f.image.width && h === f.image.height) {
        e.ctx.putImageData(f.image, 0, 0)
      } else {
        // 缩放：先贴到离屏再 drawImage 缩放（putImageData 不支持缩放）
        const tmp = document.createElement('canvas')
        tmp.width = f.image.width
        tmp.height = f.image.height
        tmp.getContext('2d')!.putImageData(f.image, 0, 0)
        e.ctx.drawImage(tmp, 0, 0, w, h)
      }
      e.source.update()
      this.resources.gifFrameIdx.set(clip.id, fi)
      return true
    }

    /**
     * 暂停态 GIF 循环泵已废弃：所有 GIF（含贴纸 GIF、主画面 GIF 图片）
     * 在暂停 / seek / 刚添加时都定格在播放头对应帧，由 renderTimelineStill
     * → drawGifFrame 负责单帧绘制即可。
     */
    protected stopIdleGif() {
      this.gifIdleToken++
      if (this.gifIdleRaf !== null) {
        cancelAnimationFrame(this.gifIdleRaf)
        this.gifIdleRaf = null
      }
    }

    protected startIdleGif(_clips: TlClip[]) {
      this.stopIdleGif()
      // 不再启动 rAF 循环，所有 GIF 暂停态均定格在当前帧
    }

    /**
     * 渲染时间线某时刻的编辑态多层静帧（暂停 / seek / 初始化 / 悬停预览 / 选中变化用）。
     * 收集 t 时刻全部可见视觉片段（含跨区间选中片段的入点预览），各自表面独立绘制后统一布局。
     */
    protected async renderTimelineStill(t: number, scrubToken = 0, retry = 0) {
      const clips = this.tlClips
      if (!clips || !this.pixiReady) return
      // 任何静帧重渲染都先停掉旧的暂停态 GIF 泵，末尾按最新可见集决定是否重启
      this.stopIdleGif()
      const runTok = this.runToken
      // scrubToken 非 0＝悬停预览：仅接受最新一次预览，且一旦起播立即失效；
      // 否则走 runToken（pause / seek / setTracks 会令其失效）。两种路径在播放中都失效。
      const stale = () =>
        this.playing ||
        (scrubToken !== 0
          ? scrubToken !== this.tlScrubToken
          : runTok !== this.runToken)

      // 静帧只渲染播放头 t 时刻覆盖的片段：选中片段不在该时刻时不强制显示，
      // 其画面操作框也因 layerBoxes 不含该片段而自动隐藏（用户口径）。
      const vis = this.pickVisualClips(t)
      vis.sort((a, b) => a.layer - b.layer || a.start - b.start)

      if (!vis.length) {
        if (!stale()) {
          this.hideAllLayers()
          if (this.videoSprite) this.videoSprite.visible = false
        }
        return
      }

      const paintOne = async (clip: TlClip): Promise<void> => {
        try {
          // 导出顺序取帧模式：静态层（图片 / 贴纸 / 文字）内容与时间无关，
          // 表面画过一次即可整段导出复用，省掉逐帧 drawImage + 纹理重传。
          // GIF 除外（按时刻取帧），视频每帧都必须更新。
          const seq = this.resources.isStillSequencing()
          if (seq && !this.isGifClip(clip) && clip.kind !== 'video') {
            if (this.exportPainted.has(clip.id) && this.layers.has(clip.id)) return
          }
          if (isTextClipKind(clip)) {
            if (stale()) return
            const e = await this.paintTextSurface(clip)
            if (!stale() && e) {
              e.source.update()
              if (seq) this.exportPainted.add(clip.id)
            }
            return
          }
          if (clip.kind === 'image' || clip.kind === 'sticker') {
            if (this.isGifClip(clip)) {
              const local = clip.sourceStart + Math.max(0, t - clip.start)
              await this.drawGifFrame(clip, local)
              return
            }
            const img = await this.resources.getImage(clip.url)
            if (stale()) return
            // 图片安全上限 1920，再叠加当前画质长边限制
            const [w, h] = this.applyQualityCap(img.naturalWidth || 640, img.naturalHeight || 360, 1920)
            const e = this.ensureLayerSurface(clip.id, w, h)
            if (!e || stale()) return
            e.ctx.clearRect(0, 0, w, h)
            e.ctx.drawImage(img, 0, 0, w, h)
            e.source.update()
            if (seq) this.exportPainted.add(clip.id)
            return
          }
          // video
          const local = clip.sourceStart + Math.max(0, t - clip.start)
          // 导出走顺序迭代器（每帧只解一次）；平时走按时刻 seek 的静帧链
          const got = seq
            ? await this.resources.getSampleStillSeq(clip.url, clip.id, Math.max(0, local))
            : await this.resources.getSampleStill(clip.url, Math.max(0, local))
          if (!got) return
          if (stale()) {
            // 帧已解码但本轮渲染过期（快速拖动 / 新渲染抢占）：关帧丢弃，
            // 不能让 VideoSample 无 close 落入 GC
            try {
              got.frame.close()
            } catch {
              /* noop */
            }
            return
          }
          const { frame, dec } = got
          try {
            // 视频中间缓冲＝原生尺寸（原画质）或当前画质限边
            const [w, h] = this.applyQualityCap(
              dec.displayWidth || frame.displayWidth || 640,
              dec.displayHeight || frame.displayHeight || 360
            )
            const e = this.ensureLayerSurface(clip.id, w, h)
            if (!e) return
            frame.draw(e.ctx, 0, 0, w, h)
            e.source.update()
          } finally {
            try { frame.close() } catch { /* noop */ }
          }
        } catch {
          /* 单层失败不阻断其它层 */
        }
      }
      await Promise.all(vis.map(paintOne))
      if (stale()) return

      // 提交可见集：本轮成功建出 surface 的层显示，其余隐藏。
      // 原位编辑中的文字表面保持显示（剪映口径：阴影 / 描边 / 发光原位不动），
      // 编辑输入框文字透明、只承担光标与选区，故不存在双影。
      const wantIds = new Set(vis.map(c => c.id))
      for (const [id, e] of this.layers) {
        const show = wantIds.has(id)
        e.visible = show
        e.sprite.visible = show
      }
      // 编辑态多层接管画面，单精灵让位（app 背景为纯黑，间隙天然黑场）
      if (this.videoSprite) this.videoSprite.visible = false
      vis.forEach((clip, idx) => {
        const e = this.layers.get(clip.id)
        if (e) e.sprite.zIndex = 1 + idx
      })
      this.applyLayerLayouts()
      // 导出期间没有操作框交互，省掉每帧的包围盒通知（DOM 覆盖层刷新）
      if (!this.resources.isStillSequencing()) this.scheduleBoxesNotify()
      // 正式静帧（非悬停预览）才启动 GIF 贴纸暂停态循环；悬停预览期间贴纸定格省电
      if (scrubToken === 0) this.startIdleGif(vis)
      // 补救：本轮某层取帧失败（surface 未建立），多发生在播放刚结束的
      // teardown 竞态（解码器 / fetch 被 abort）。延迟自愈一次，仍失败则放弃。
      // 导出顺序取帧模式不做补救：迟到的重渲染会打乱迭代器顺序。
      if (retry === 0 && !stale() && !this.resources.isStillSequencing() && vis.some(c => !this.layers.has(c.id))) {
        window.setTimeout(() => {
          if (!stale() && !this.playing) void this.renderTimelineStill(t, scrubToken, 1)
        }, 250)
      }
    }
  }

  return Layers
}
