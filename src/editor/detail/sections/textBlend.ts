/* ============================================================
 *  文字选项组 · ③ 混合（整体不透明度，可选段）
 * ============================================================ */
import { DEFAULT_TEXT_BLEND } from '../../types'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  RESET_SVG,
  bindNumPair,
  bindOptionalSection,
  syncOptionalSection,
  unitNum,
  type TextPatch
} from './shared'

/** 混合组 HTML（初始展开；caret 带 is-open） */
export function renderTextBlend(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span class="ed-tsec-head-l">
          <label class="ed-tsec-check"><input type="checkbox" data-f="bx-on"><span>混合</span></label>
          <button type="button" class="ed-tsec-caret is-open" data-toggle="bx-body" title="收起" aria-label="收起"></button>
        </span>
        <button type="button" class="ed-tsec-reset" data-reset="blend" title="重置" aria-label="重置混合">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body" data-f="bx-body">
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">不透明度</span>
          <input type="range" class="ed-pic-range" data-f="bx-opR" min="0" max="100" step="1">
          ${unitNum('bx-opN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.blend.opacity * 100)}%`
          })}
        </div>
      </div>
    </section>`
}

/** 绑定混合组 */
export function bindTextBlend(
  _host: HTMLElement,
  root: HTMLElement,
  ref: DetailSelectionRef,
  ctx: DetailViewCtx,
  syncAll: () => void
): void {
  const t = () => ref.current!.text!
  const live = (patch: TextPatch) => ctx.callbacks.onTextLive?.(patch)
  const commit = () => ctx.callbacks.onTextCommit?.()

  bindOptionalSection({
    root,
    onF: 'bx-on',
    bodyF: 'bx-body',
    resetKey: 'blend',
    enabled: t().blend.enabled,
    onToggle: enabled => {
      const next = { ...t().blend, enabled }
      t().blend = next
      live({ blend: next })
      commit()
    },
    onReset: () => {
      const next = { ...DEFAULT_TEXT_BLEND, enabled: t().blend.enabled }
      t().blend = next
      live({ blend: next })
      syncAll()
      commit()
    }
  })

  // 不透明度
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="bx-opR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="bx-opN"]')!,
    0,
    100,
    v => {
      t().blend = { ...t().blend, opacity: v / 100 }
      live({ blend: t().blend })
    },
    Math.round(t().blend.opacity * 100),
    { clampNum: ctx.clampNum, commit }
  )
}

/** 重同步：勾选态 + 不透明度 */
export function syncTextBlend(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const tx = sel.text!
  const setVal = (f: string, v: string) => {
    const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
    if (el && el !== active) el.value = v
  }
  const setUnit = (f: string, v: number) => {
    const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
    if (el && el !== active) {
      const prec = Number(el.dataset.prec ?? 0)
      el.value = prec > 0 ? v.toFixed(prec) : `${Math.round(v)}${el.dataset.suffix ?? ''}`
    }
  }
  setVal('bx-opR', String(Math.round(tx.blend.opacity * 100)))
  setUnit('bx-opN', Math.round(tx.blend.opacity * 100))
  syncOptionalSection(root, active, 'bx-on', 'bx-body', tx.blend.enabled)
}
