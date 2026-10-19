/* ============================================================
 *  文字选项组 · 内容（多行输入 + 放大 / 恢复两态）
 * ============================================================ */
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import { ZOOM_IN_SVG, ZOOM_OUT_SVG } from './shared'

/** 内容组 HTML */
export function renderTextContent(sel: DetailSelection, ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <div class="ed-tcontent-wrap">
      <textarea class="ed-tcontent" data-f="content" rows="2"
        placeholder="输入文字">${ctx.escapeHtml(t.content)}</textarea>
      <button type="button" class="ed-tcontent-zoom" data-f="content-zoom"
        title="放大" aria-label="放大">${ZOOM_IN_SVG}</button>
    </div>`
}

/** 绑定内容输入（input 实时重绘，change 入栈）与放大 / 恢复两态 */
export function bindTextContent(
  host: HTMLElement,
  root: HTMLElement,
  ref: DetailSelectionRef,
  ctx: DetailViewCtx
): void {
  const contentEl = root.querySelector<HTMLTextAreaElement>('[data-f="content"]')!
  contentEl.addEventListener('input', () => {
    ref.current!.text!.content = contentEl.value
    ctx.callbacks.onTextLive?.({ content: contentEl.value })
  })
  contentEl.addEventListener('change', () => ctx.callbacks.onTextCommit?.())

  // 内容框两态尺寸：放大 ↔ 恢复（仅视图态，不入项目数据）
  const contentWrap = contentEl.closest('.ed-tcontent-wrap') as HTMLElement
  const zoomBtn = root.querySelector<HTMLButtonElement>('[data-f="content-zoom"]')!
  zoomBtn.addEventListener('click', () => {
    const expanded = contentWrap.classList.toggle('is-expanded')
    zoomBtn.innerHTML = expanded ? ZOOM_OUT_SVG : ZOOM_IN_SVG
    zoomBtn.title = expanded ? '恢复' : '放大'
    zoomBtn.setAttribute('aria-label', expanded ? '恢复' : '放大')
  })
}

/** 重同步：回灌文字内容（不抢焦点） */
export function syncTextContent(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const el = root.querySelector<HTMLTextAreaElement>('[data-f="content"]')
  if (el && el !== active) el.value = sel.text!.content
}
