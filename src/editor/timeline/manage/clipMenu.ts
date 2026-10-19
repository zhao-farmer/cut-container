/* ============================================================
 *  时间轴 · manage：片段右键菜单 + 剪贴板
 *  - 右键片段弹出「复制 / 剪切 / 删除」（快捷键与键盘模块共用同一剪贴板）
 *  - 剪贴板只保存数据快照（深拷贝），不持有 DOM / 素材引用
 * ============================================================ */
import type { AnyTrackItem, TrackObjectType } from '../../types'

/** 剪贴板内容：原始轨道类型 + 片段数据快照 */
export interface ClipClipboard {
  trackType: TrackObjectType
  item: AnyTrackItem
}

let clipboard: ClipClipboard | null = null

export function setClipClipboard(value: ClipClipboard): void {
  clipboard = value
}

export function getClipClipboard(): ClipClipboard | null {
  return clipboard
}

export interface ClipMenuActions {
  copy: () => void
  cut: () => void
  remove: () => void
}

let closeCurrent: (() => void) | null = null

export function closeClipMenu(): void {
  closeCurrent?.()
  closeCurrent = null
}

/** 在 (x, y) 处打开片段右键菜单；host 为编辑器 Shadow DOM 根节点 */
export function openClipMenu(host: HTMLElement, x: number, y: number, actions: ClipMenuActions): void {
  closeClipMenu()
  const menu = document.createElement('div')
  menu.className = 'ed-tl-ctx'
  menu.innerHTML = `
    <button type="button" class="ed-tl-ctx-item" data-act="copy"><span>复制</span></button>
    <button type="button" class="ed-tl-ctx-item" data-act="cut"><span>剪切</span></button>
    <button type="button" class="ed-tl-ctx-item" data-act="remove"><span>删除</span></button>`
  host.appendChild(menu)

  const place = () => {
    const r = menu.getBoundingClientRect()
    const pad = 8
    menu.style.left = `${Math.max(pad, Math.min(x, window.innerWidth - r.width - pad))}px`
    menu.style.top = `${Math.max(pad, Math.min(y, window.innerHeight - r.height - pad))}px`
  }
  place()

  const onDown = (ev: PointerEvent) => {
    // 菜单挂在 Shadow DOM 内：window 捕获阶段 target 会被重定向为宿主，
    // 必须用 composedPath 判断点击是否落在菜单里，否则真实鼠标按下会先关菜单、click 不触发
    if (!ev.composedPath().includes(menu)) closeClipMenu()
  }
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeClipMenu()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('keydown', onKey, true)
  closeCurrent = () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('keydown', onKey, true)
    menu.remove()
  }

  const run = (fn: () => void) => {
    closeClipMenu()
    fn()
  }
  menu.querySelector('[data-act="copy"]')!.addEventListener('click', () => run(actions.copy))
  menu.querySelector('[data-act="cut"]')!.addEventListener('click', () => run(actions.cut))
  menu.querySelector('[data-act="remove"]')!.addEventListener('click', () => run(actions.remove))
}
