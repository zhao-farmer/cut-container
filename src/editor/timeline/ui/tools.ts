/* ============================================================
 *  时间轴工具栏 · 工具模块
 *  撤销 / 恢复（历史栈由外层持有）、分割 / 向左右裁剪 / 删除
 *  （走时间轴 applyOp）、播放头帧标记切换 + M 快捷键。
 * ============================================================ */
import type { TimelineOp, TimelineSelection } from '../core/types'

/** 需要选中片段才可点的工具操作 */
const SELECT_OPS: TimelineOp[] = ['split', 'trim-left', 'trim-right', 'delete']
const ALL_TOOL_OPS = new Set<string>(['undo', 'redo', 'marker', ...SELECT_OPS])

export interface ToolsDeps {
  /** 当前时间轴选中（决定分割 / 裁剪 / 删除按钮禁用态） */
  getSelection: () => TimelineSelection | null
  /** 撤销 / 恢复：外层持有历史栈，按钮仅触发 */
  undo: () => void
  redo: () => void
  /** 历史栈是否非空（按钮禁用态） */
  canUndo: () => boolean
  canRedo: () => boolean
  /** 时间轴原子操作，失败时外层已 toast；这里按返回 msg 兜底提示 */
  applyOp: (op: TimelineOp) => { ok: boolean; msg?: string }
  /** 播放头帧添加 / 移除标记 */
  toggleMarker: () => void
  /** 轻提示 */
  toast: (msg: string) => void
  /** 编辑器弹层（封面弹窗等）是否打开：打开时 M 键不拦截 */
  hasOpenModal: () => boolean
}

export interface ToolsApi {
  refreshOpButtons: () => void
  destroy: () => void
}

export function bindTools(shell: HTMLElement, deps: ToolsDeps): ToolsApi {
  const btn = (op: string) => shell.querySelector<HTMLButtonElement>(`button[data-op="${op}"]`)

  /** 按选中态 / 历史栈刷新工具条禁用态（undo/redo 由外层在回调后驱动刷新） */
  function refreshOpButtons() {
    const undoBtn = btn('undo')
    const redoBtn = btn('redo')
    if (undoBtn) undoBtn.disabled = !deps.canUndo()
    if (redoBtn) redoBtn.disabled = !deps.canRedo()
    const hasSel = !!deps.getSelection()
    for (const op of SELECT_OPS) {
      const b = btn(op)
      if (b) b.disabled = !hasSel
    }
  }

  // 编辑组：撤销 / 恢复 / 分割 / 向左右裁剪 / 删除 / 标记
  const onClick = (e: Event) => {
    const target = e.currentTarget as HTMLButtonElement
    const op = target.dataset.op || ''
    if (!ALL_TOOL_OPS.has(op)) return
    if (op === 'undo') {
      deps.undo()
      return
    }
    if (op === 'redo') {
      deps.redo()
      return
    }
    if ((SELECT_OPS as string[]).includes(op)) {
      const r = deps.applyOp(op as TimelineOp)
      if (!r.ok && r.msg) deps.toast(r.msg)
      return
    }
    if (op === 'marker') {
      deps.toggleMarker()
    }
  }
  shell.querySelectorAll<HTMLButtonElement>('button[data-op]').forEach(b => {
    if (ALL_TOOL_OPS.has(b.dataset.op || '')) b.addEventListener('click', onClick)
  })

  // 快捷键 M：在当前播放头帧添加 / 移除标记（剪映同款）。
  // 输入控件聚焦 / 封面弹窗打开时不拦截；修饰键组合（如 Cmd+M）放行。
  const onMarkerShortcut = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey) return
    const ae = document.activeElement as HTMLElement | null
    if (
      ae &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable)
    )
      return
    if (deps.hasOpenModal()) return
    e.preventDefault()
    deps.toggleMarker()
  }
  document.addEventListener('keydown', onMarkerShortcut)

  return {
    refreshOpButtons,
    destroy() {
      document.removeEventListener('keydown', onMarkerShortcut)
    }
  }
}
