/* ============================================================
 *  编辑器框架 · 模块分隔条拖拽（各模块相互独立）
 *  - [data-split="left"]     左栏 | 播放器   → --ed-left-w
 *  - [data-split="right"]    播放器 | 右栏   → --ed-right-w
 *  - [data-split="timeline"] 播放器区 | 轨道 → --ed-tl-h
 *  - [data-split="vumeter"]  轨道 | 竖井电平表（第五模块，左右拉宽）→ --ed-vu-w
 *
 * 拖 timeline（上下）时左右两栏宽度不变：播放器面板（深灰底）尺寸变化，
 * 内部 16:9 黑色画面区由播放器自身按 contain（短边为准）等比缩放居中，
 * 四周露出面板底色。左/右分隔条同理，只改中栏宽度，画面区自行适应。
 * 起始快照模型：pointerdown 记录起点尺寸，pointermove 按 (dx,dy) 计算
 * ============================================================ */

const MIN_LEFT = 190
const MAX_LEFT = 480
const MIN_RIGHT = 290
const MAX_RIGHT = 480
/** 中间播放器模块的最小宽度（拖动左右分隔条时不得把它压得更窄） */
const MIN_CENTER = 440
const MIN_TIMELINE = 140
const MIN_VU = 90
const MAX_VU = 220

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function bindSplitters(shell: HTMLElement): () => void {
  const mainEl = shell.querySelector<HTMLElement>('.ed-main')
  const leftPanel = shell.querySelector<HTMLElement>('.ed-left')
  const rightPanel = shell.querySelector<HTMLElement>('.ed-right')
  const timeline = shell.querySelector<HTMLElement>('.ed-timeline')
  const vuPanel = shell.querySelector<HTMLElement>('.ed-vumeter')
  const handles = Array.from(shell.querySelectorAll<HTMLElement>('[data-split]'))

  const unbinds: Array<() => void> = []

  /** 上排两根竖向分隔条的占用宽度合计（左|中、中|右） */
  const mainSplitsWidth = () => {
    if (!mainEl) return 0
    return Array.from(mainEl.querySelectorAll<HTMLElement>('.ed-split-h')).reduce(
      (sum, el) => sum + el.offsetWidth,
      0
    )
  }
  /** 在保证播放器 ≥ MIN_CENTER 的前提下，某一侧栏允许达到的最大宽度 */
  const maxSideKeepingCenter = (otherSide: HTMLElement | null) => {
    if (!mainEl) return Number.POSITIVE_INFINITY
    return mainEl.clientWidth - mainSplitsWidth() - (otherSide?.offsetWidth ?? 0) - MIN_CENTER
  }

  handles.forEach(handle => {
    const side = handle.dataset.split
    // 浏览器自带的左右 / 上下拖拽光标（editor/css/base.css 的 .ed-split-* 同值为兜底）
    const cursor = side === 'timeline' ? 'row-resize' : 'col-resize'

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault()

      const startX = e.clientX
      const startY = e.clientY
      const startSize =
        side === 'left'
          ? leftPanel?.offsetWidth ?? 0
          : side === 'right'
            ? rightPanel?.offsetWidth ?? 0
            : side === 'vumeter'
              ? vuPanel?.offsetWidth ?? 0
              : timeline?.offsetHeight ?? 0

      shell.classList.add('is-resizing')
      handle.classList.add('dragging')
      const prevBodyCursor = document.body.style.cursor
      const prevBodySelect = document.body.style.userSelect
      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'

      const onPointerMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY

        if (side === 'left' && leftPanel) {
          // 左栏变宽时同步守住播放器 440px 下限（此时右栏宽度不变）
          const maxW = Math.min(MAX_LEFT, maxSideKeepingCenter(rightPanel))
          shell.style.setProperty('--ed-left-w', `${clamp(startSize + dx, MIN_LEFT, maxW)}px`)
        } else if (side === 'right' && rightPanel) {
          // 右栏变宽时同步守住播放器 440px 下限（此时左栏宽度不变）
          const maxW = Math.min(MAX_RIGHT, maxSideKeepingCenter(leftPanel))
          shell.style.setProperty('--ed-right-w', `${clamp(startSize - dx, MIN_RIGHT, maxW)}px`)
        } else if (side === 'timeline' && timeline) {
          const maxH = Math.max(MIN_TIMELINE, shell.clientHeight - 150)
          shell.style.setProperty('--ed-tl-h', `${clamp(startSize - dy, MIN_TIMELINE, maxH)}px`)
        } else if (side === 'vumeter' && vuPanel) {
          // 分隔条在面板左侧：向左拖（dx 负）面板变宽
          shell.style.setProperty('--ed-vu-w', `${clamp(startSize - dx, MIN_VU, MAX_VU)}px`)
        }
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        shell.classList.remove('is-resizing')
        handle.classList.remove('dragging')
        document.body.style.cursor = prevBodyCursor
        document.body.style.userSelect = prevBodySelect
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    }

    handle.addEventListener('pointerdown', onPointerDown)
    unbinds.push(() => handle.removeEventListener('pointerdown', onPointerDown))
  })

  return () => unbinds.forEach(fn => fn())
}
