/* ============================================================
 *  时间轴 · manage：键盘快捷键
 *  - Ctrl/Cmd + C 复制、Ctrl/Cmd + X 剪切、Ctrl/Cmd + V 粘贴
 *  - Delete / Backspace 删除选中片段
 *  - 输入框 / 文本域 / contenteditable 内不拦截，避免影响命名等输入
 * ============================================================ */
export interface TimelineShortcutActions {
  copy: () => void
  cut: () => void
  paste: () => void
  remove: () => void
  /** 是否处于可操作上下文（如已选中片段、且不处于素材预览态） */
  canAct: () => boolean
}

/** 事件路径上是否存在可编辑控件（穿透 Shadow DOM） */
function isEditableTarget(e: KeyboardEvent): boolean {
  for (const node of e.composedPath()) {
    const el = node as HTMLElement
    if (!el || !el.tagName) continue
    const tag = el.tagName.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (el.isContentEditable) return true
  }
  return false
}

/** 绑定时间轴快捷键，返回解绑函数 */
export function bindTimelineShortcuts(actions: TimelineShortcutActions): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isEditableTarget(e)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase()
      // 粘贴不要求当前有选中片段（剪贴板在即可），其余操作需要选中
      if (key === 'v') {
        e.preventDefault()
        actions.paste()
        return
      }
      if (!actions.canAct()) return
      if (key === 'c') {
        e.preventDefault()
        actions.copy()
      } else if (key === 'x') {
        e.preventDefault()
        actions.cut()
      }
      return
    }
    if (!actions.canAct()) return
    if (!mod && !e.altKey && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      actions.remove()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
