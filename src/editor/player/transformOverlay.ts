/* ============================================================
 *  播放器画面操作框（DOM 覆盖层）
 *  - 选中片段：白色边框 + 四角/四边共 8 个控制点 + 顶部旋转手柄
 *  - 拖框体移动、角点等比/双轴缩放、边点单轴缩放（自动关等比）、旋转柄旋转
 *  - 点击其它可见层切换选中；点空白不拦截（交给舞台单击播放/暂停）
 * ============================================================ */
import type { ClipTransform } from '../types'
import type { LayerBox, TextEditMeta } from './core/types'
import { SCALE_MAX, SCALE_MIN, normalizeTransform, withUniformDisabled } from '../transform'

export interface TransformOverlayBridge {
  getBoxes(): LayerBox[]
  getSelected(): string | null
  isPlaying(): boolean
  /** 逻辑像素 → 屏幕像素 */
  getK(): number
  /** 屏幕点命中（舞台坐标系） */
  hitTest(x: number, y: number): string | null
  getTransform(clipId: string): ClipTransform | null
  /** 拖拽中实时变换（player 已更新布局，此处仅转发给面板） */
  onLive(clipId: string, t: ClipTransform): void
  /** 手势结束提交（入栈 / 落盘由 EditorPage 处理） */
  onCommit(clipId: string, t: ClipTransform): void
  /** 点选其它层（同步时间轴选中） */
  onPick(clipId: string): void
  /** 文字原位编辑：取内容 / 样式 / 屏幕字号（非文字片段返回 null） */
  getTextMeta?(clipId: string): TextEditMeta | null
  /** 进入 / 退出原位编辑（内核据此隐藏 / 恢复文字表面） */
  setTextEditing?(clipId: string | null): void
  /** 原位编辑键入实时回显 */
  onTextLive?(clipId: string, patch: { content: string }): void
  /** 原位编辑结束提交 */
  onTextCommit?(clipId: string): void
}

type Mode = 'move' | 'corner' | 'edge' | 'rotate'

interface Gesture {
  mode: Mode
  clipId: string
  handle: string
  start: ClipTransform
  p0: { x: number; y: number }
  box: LayerBox
  moved: boolean
  pointerId: number
  pending: boolean
}

const HANDLE_HTML = `
  <i class="tf-handle tf-h-tl" data-h="tl"></i>
  <i class="tf-handle tf-h-tc" data-h="tc"></i>
  <i class="tf-handle tf-h-tr" data-h="tr"></i>
  <i class="tf-handle tf-h-cl" data-h="cl"></i>
  <i class="tf-handle tf-h-cr" data-h="cr"></i>
  <i class="tf-handle tf-h-bl" data-h="bl"></i>
  <i class="tf-handle tf-h-bc" data-h="bc"></i>
  <i class="tf-handle tf-h-br" data-h="br"></i>
  <span class="tf-rotate" data-h="rotate"><i class="tf-rotate-line"></i></span>`

const CLICK_THRESHOLD = 4

/** 原位编辑光标颜色：亮青，白 / 深色文字上都清晰（剪映口径） */
const CARET_COLOR = '#25f4ee'

export function createTransformOverlay(stage: HTMLElement, bridge: TransformOverlayBridge) {
  const layer = document.createElement('div')
  layer.className = 'tf-layer'
  layer.innerHTML = `<div class="tf-box">${HANDLE_HTML}</div>`
  stage.appendChild(layer)
  const box = layer.querySelector('.tf-box') as HTMLDivElement

  let gesture: Gesture | null = null
  /** 命中层 / 手柄的 pointerdown 后置 true，用于吞掉随后的 click（避免误触播放） */
  let armedClick = false

  const localPoint = (e: MouseEvent) => {
    const r = stage.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clampScale = (v: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, v))

  /** 向量相对 -a 旋转（转到框的局部坐标系） */
  const toLocal = (x: number, y: number, a: number) => ({
    x: x * Math.cos(-a) - y * Math.sin(-a),
    y: x * Math.sin(-a) + y * Math.cos(-a)
  })

  const normAngle = (a: number) => {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
  }

  const handleMode = (h: string): Mode | null => {
    if (h === 'rotate') return 'rotate'
    if (['tl', 'tr', 'bl', 'br'].includes(h)) return 'corner'
    if (['tc', 'bc', 'cl', 'cr'].includes(h)) return 'edge'
    return null
  }

  const findBox = (id: string): LayerBox | null =>
    bridge.getBoxes().find(b => b.clipId === id) ?? null

  function refresh() {
    const id = bridge.getSelected()
    if (bridge.isPlaying() || !id) {
      box.classList.remove('is-on')
      layer.classList.remove('is-drag')
      return
    }
    const b = findBox(id)
    if (!b) {
      box.classList.remove('is-on')
      return
    }
    box.classList.add('is-on')
    const deg = (b.rotation * 180) / Math.PI
    box.style.left = `${b.cx}px`
    box.style.top = `${b.cy}px`
    box.style.width = `${b.w}px`
    box.style.height = `${b.h}px`
    box.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`
    positionTextEditor()
  }

  // —— 文字原位编辑（双击文字进入；Enter / Shift+Enter 换行，失焦 / Esc 提交）——
  let textEditor: HTMLTextAreaElement | null = null
  let editingId: string | null = null
  /** 当前编辑元信息（竖排时编辑框改用 vertical-rl，最小宽度收窄） */
  let editingMeta: TextEditMeta | null = null
  /** 提交中移除节点会同步触发 blur，用此标志防止重入 */
  let editCommitting = false

  /**
   * 编辑框跟随文字：中心 / 旋转与文字盒同步，宽高紧贴内容自然尺寸
   * （wrap=off：只有物理回车才换行，与画面渲染口径一致；不撑满含背景底板的整盒，
   * 避免文字视觉偏移）。键入时内核已重算字形盒，编辑框即时贴合。
   */
  function positionTextEditor() {
    const ta = textEditor
    if (!ta || !editingId) return
    const b = findBox(editingId)
    if (!b) return
    const deg = (b.rotation * 180) / Math.PI
    // 竖排文本盒本身窄而高，编辑框最小宽度只需容下一列
    const minW = editingMeta?.vertical ? Math.max(editingMeta.screenFontSize + 20, 56) : 72
    // 先清 padding、给一个试排宽度，量内容自然宽高（white-space:pre，仅物理换行断行）
    ta.style.padding = '0'
    ta.style.width = `${Math.max(b.w, minW - 12)}px`
    ta.style.height = 'auto'
    const natW = ta.scrollWidth
    const natH = ta.scrollHeight
    const padX = 6
    const padY = 4
    ta.style.left = `${b.cx}px`
    ta.style.top = `${b.cy}px`
    ta.style.width = `${Math.max(natW + padX * 2, minW)}px`
    ta.style.padding = `${padY}px ${padX}px`
    ta.style.height = `${natH + padY * 2}px`
    ta.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`
  }

  function startTextEdit(clipId: string) {
    if (editingId === clipId && textEditor) return
    endTextEdit()
    const meta = bridge.getTextMeta?.(clipId)
    const b = findBox(clipId)
    if (!meta || !b) return
    editingId = clipId
    editingMeta = meta
    const ta = document.createElement('textarea')
    ta.className = 'tf-text-edit'
    ta.value = meta.content
    ta.rows = 1
    // 画面文字不自动折行（超长按溢出呈现），编辑框与之一致：wrap=off，仅回车物理换行
    ta.wrap = 'off'
    ta.spellcheck = false
    ta.setAttribute('spellcheck', 'false')
    // —— 编辑框所见即所得（光标 / 选区口径）——
    // 剪映口径：编辑期间文字本体（含填充 / 描边 / 阴影 / 发光）始终由 PIXI 表面原位渲染，
    // 输入框文字透明、只露出 caret 与选区，因此字形从不发生「二次绘制」，不会跳位 / 变大。
    // 字号 / 字体 / 字距 / 行高仍按屏幕元信息设置——caret 停留位置要与画布字形逐像素对齐。
    ta.style.color = 'transparent'
    ta.style.caretColor = CARET_COLOR
    ta.style.fontFamily = meta.fontFamily
    ta.style.fontSize = `${meta.screenFontSize}px`
    ta.style.fontWeight = meta.bold ? '700' : '400'
    ta.style.fontStyle = meta.italic ? 'italic' : 'normal'
    // 行高 / 对齐 / 字距 / 下划线与 SVG 渲染口径一致（下划线透明不可见，仅占布局）
    ta.style.lineHeight = meta.lineHeight ? `${meta.lineHeight}px` : '1.25'
    ta.style.textAlign = meta.align === 'left' ? 'left' : meta.align === 'right' ? 'right' : 'center'
    if (meta.letterSpacing) ta.style.letterSpacing = `${meta.letterSpacing}px`
    if (meta.underline) ta.style.textDecoration = 'underline'
    // 竖排：编辑框同步 vertical-rl（列自右向左，与画面渲染一致）
    ta.style.writingMode = meta.vertical ? 'vertical-rl' : 'horizontal-tb'
    // 拦截指针 / 点击：不能冒泡到操作框（触发移动手势）或舞台（切换播放/暂停）
    ta.addEventListener('pointerdown', ev => ev.stopPropagation())
    ta.addEventListener('click', ev => ev.stopPropagation(), true)
    ta.addEventListener('dblclick', ev => ev.stopPropagation())
    ta.addEventListener('input', () => {
      // onTextLive → 内核同步重算字形盒（layerBoxes 即时更新），编辑框立即贴合
      bridge.onTextLive?.(clipId, { content: ta.value })
      positionTextEditor()
    })
    ta.addEventListener('keydown', ev => {
      // 挡住时间轴 / 全局快捷键（Delete、Alt+方向键等）；Enter 保持默认插入换行
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        ev.preventDefault()
        endTextEdit()
      }
    })
    ta.addEventListener('blur', () => {
      if (!editCommitting) endTextEdit()
    })
    layer.appendChild(ta)
    layer.classList.add('is-texting')
    textEditor = ta
    bridge.setTextEditing?.(clipId)
    // refresh() 内会经 positionTextEditor 完成定位 / 尺寸贴合
    refresh()
    ta.focus()
    // 光标置于文末（不全选，避免一进编辑就整片蓝色选区）
    const len = ta.value.length
    ta.setSelectionRange(len, len)
  }

  /** 结束原位编辑（外部起播前也会调用；未在编辑时 no-op） */
  function endTextEdit() {
    const ta = textEditor
    const id = editingId
    if (!ta || !id) {
      textEditor = null
      editingId = null
      editingMeta = null
      return
    }
    editCommitting = true
    bridge.onTextCommit?.(id)
    bridge.setTextEditing?.(null)
    ta.remove()
    layer.classList.remove('is-texting')
    textEditor = null
    editingId = null
    editingMeta = null
    editCommitting = false
    refresh()
  }

  function onDblClick(e: MouseEvent) {
    if (bridge.isPlaying()) return
    const err = stage.querySelector('.jy-error') as HTMLElement | null
    if (err && err.style.display !== 'none') return
    const p = localPoint(e)
    const id = bridge.hitTest(p.x, p.y)
    if (!id || !bridge.getTextMeta?.(id)) return
    // 已翻转的文字片段禁止原位编辑（transform 含镜像符号，画布定位不稳定）：
    // 请在右上角文字面板中编辑
    const tr = bridge.getTransform(id)
    if (tr && (tr.flipH || tr.flipV)) return
    e.stopPropagation()
    e.preventDefault()
    if (bridge.getSelected() !== id) bridge.onPick(id)
    startTextEdit(id)
  }

  /** 拖拽中 rAF 合帧计算并下发一次 live transform */
  function scheduleCompute(e: PointerEvent) {
    if (!gesture) return
    gesture.moved = true
    if (gesture.pending) return
    gesture.pending = true
    requestAnimationFrame(() => {
      gesture!.pending = false
      if (!gesture) return
      compute(gesture.p0, localPoint(e), gesture)
    })
  }

  function compute(p0: { x: number; y: number }, p: { x: number; y: number }, g: Gesture) {
    const s0 = g.start
    const b = g.box
    const k = bridge.getK()
    let next: ClipTransform = { ...s0 }

    if (g.mode === 'move') {
      next.x = s0.x + (p.x - p0.x) / k
      next.y = s0.y + (p.y - p0.y) / k
    } else if (g.mode === 'rotate') {
      const a0 = Math.atan2(p0.y - b.cy, p0.x - b.cx)
      const a1 = Math.atan2(p.y - b.cy, p.x - b.cx)
      next.rotation = s0.rotation + (normAngle(a1 - a0) * 180) / Math.PI
    } else if (g.mode === 'corner') {
      if (s0.uniform) {
        const d0 = Math.hypot(p0.x - b.cx, p0.y - b.cy)
        const d1 = Math.hypot(p.x - b.cx, p.y - b.cy)
        if (d0 > 0) next.scale = clampScale(s0.scale * d1 / d0)
      } else {
        const v0 = toLocal(p0.x - b.cx, p0.y - b.cy, b.rotation)
        const v1 = toLocal(p.x - b.cx, p.y - b.cy, b.rotation)
        if (Math.abs(v0.x) > 0.5) next.scaleX = clampScale(s0.scaleX * Math.abs(v1.x) / Math.abs(v0.x))
        if (Math.abs(v0.y) > 0.5) next.scaleY = clampScale(s0.scaleY * Math.abs(v1.y) / Math.abs(v0.y))
      }
    } else if (g.mode === 'edge') {
      const v0 = toLocal(p0.x - b.cx, p0.y - b.cy, b.rotation)
      const v1 = toLocal(p.x - b.cx, p.y - b.cy, b.rotation)
      if (g.handle === 'cl' || g.handle === 'cr') {
        if (Math.abs(v0.x) > 0.5) next.scaleX = clampScale(s0.scaleX * Math.abs(v1.x) / Math.abs(v0.x))
      } else {
        if (Math.abs(v0.y) > 0.5) next.scaleY = clampScale(s0.scaleY * Math.abs(v1.y) / Math.abs(v0.y))
      }
    }
    bridge.onLive(g.clipId, normalizeTransform(next))
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    // error 遮罩显示时不拦截任何点击
    const err = stage.querySelector('.jy-error') as HTMLElement | null
    if (err && err.style.display !== 'none') return

    // 原位编辑中：框 / 手柄仅作展示（剪映口径保留选中框），不响应拖拽手势；
    // 输入框自身的 pointerdown 已 stopPropagation 走文本选择 / 光标逻辑，
    // 其余区域放行给舞台（失焦即提交退出编辑）。
    if (layer.classList.contains('is-texting')) return

    const target = e.target as HTMLElement
    // 文字原位编辑输入框：完全放行（获焦 / 光标 / 选择），不触发移动手势
    if (target.closest('.tf-text-edit')) return
    const hEl = target.closest('[data-h]') as HTMLElement | null
    const p = localPoint(e)
    let mode: Mode | null = null
    let handle = ''
    let clipId: string | null = null

    if (hEl) {
      handle = hEl.dataset.h || ''
      mode = handleMode(handle)
      clipId = bridge.getSelected()
    } else {
      // 命中某层本体（含选中层）→ 移动；命中别的层 → 先切换选中
      clipId = bridge.hitTest(p.x, p.y)
      if (clipId) {
        mode = 'move'
        const sel = bridge.getSelected()
        if (sel !== clipId) bridge.onPick(clipId)
      }
    }

    if (!mode || !clipId) return // 空白：放行，舞台 click 播放/暂停
    const start = bridge.getTransform(clipId)
    const box0 = findBox(clipId)
    if (!start || !box0) return

    // 边点首次操作即关闭等比（缩放中心固定为框中心）
    const t0 = mode === 'edge' ? withUniformDisabled(start) : start
    gesture = {
      mode,
      handle,
      clipId,
      start: normalizeTransform(t0),
      p0: p,
      box: box0,
      moved: false,
      pointerId: e.pointerId,
      pending: false
    }
    armedClick = true
    layer.classList.add('is-drag')
    // 个别情况下活动指针已结束（极快点击 / 合成事件），捕获失败不应阻断手势
    try {
      layer.setPointerCapture(e.pointerId)
    } catch {
      /* noop：move/up 监听本就挂在 layer 上 */
    }
    e.preventDefault()
    e.stopPropagation()
  }

  function onPointerMove(e: PointerEvent) {
    if (gesture && e.pointerId === gesture.pointerId) {
      scheduleCompute(e)
      e.preventDefault()
      return
    }
    // 悬停光标
    const target = e.target as HTMLElement
    if (target.closest('.tf-text-edit')) return
    const h = (target.closest('[data-h]') as HTMLElement | null)?.dataset.h
    if (h) {
      layer.style.cursor =
        h === 'rotate'
          ? 'grab'
          : ['tl', 'br'].includes(h)
            ? 'nwse-resize'
            : ['tr', 'bl'].includes(h)
              ? 'nesw-resize'
              : ['cl', 'cr'].includes(h)
                ? 'ew-resize'
                : 'ns-resize'
      return
    }
    const p = localPoint(e)
    layer.style.cursor = bridge.hitTest(p.x, p.y) ? 'move' : 'default'
  }

  function onPointerUp(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const g = gesture
    gesture = null
    layer.classList.remove('is-drag')
    try { layer.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    // 位移超过阈值的真拖拽 → 结束时一次性提交；纯点击（选中/不动作）不产生历史
    if (g.moved) {
      const t = bridge.getTransform(g.clipId)
      if (t) bridge.onCommit(g.clipId, t)
    }
    refresh()
    e.preventDefault()
    e.stopPropagation()
  }

  // 命中层 / 手柄后的 click 必须吞掉，否则舞台会切换播放/暂停
  function onClick(e: MouseEvent) {
    if (armedClick) {
      armedClick = false
      e.stopPropagation()
      e.preventDefault()
    }
  }

  layer.addEventListener('pointerdown', onPointerDown)
  layer.addEventListener('pointermove', onPointerMove)
  layer.addEventListener('pointerup', onPointerUp)
  layer.addEventListener('pointercancel', onPointerUp)
  layer.addEventListener('click', onClick, true)
  layer.addEventListener('dblclick', onDblClick)

  return {
    refresh,
    endTextEdit,
    destroy() {
      // 销毁仅摘除节点，不再触发 commit / 外部回调
      if (textEditor) textEditor.remove()
      textEditor = null
      editingId = null
      layer.removeEventListener('pointerdown', onPointerDown)
      layer.removeEventListener('pointermove', onPointerMove)
      layer.removeEventListener('pointerup', onPointerUp)
      layer.removeEventListener('pointercancel', onPointerUp)
      layer.removeEventListener('click', onClick, true)
      layer.removeEventListener('dblclick', onDblClick)
      layer.remove()
    }
  }
}

export type TransformOverlay = ReturnType<typeof createTransformOverlay>
