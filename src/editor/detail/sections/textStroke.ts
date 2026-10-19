/* ============================================================
 *  文字选项组 · ④ 描边（可选段：颜色 / 不透明度 / 粗细）
 * ============================================================ */
import { DEFAULT_TEXT_STROKE } from '../../types'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  RESET_SVG,
  bindColorControl,
  bindNumPair,
  bindOptionalSection,
  colorRowHtml,
  syncOptionalSection,
  syncSetUnit,
  syncSetVal,
  unitNum,
  type TextPatch
} from './shared'

/** 描边组 HTML（初始收起；caret 无 is-open） */
export function renderTextStroke(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span class="ed-tsec-head-l">
          <label class="ed-tsec-check"><input type="checkbox" data-f="sk-on"><span>描边</span></label>
          <button type="button" class="ed-tsec-caret" data-toggle="sk-body" title="展开" aria-label="展开"></button>
        </span>
        <button type="button" class="ed-tsec-reset" data-reset="stroke" title="重置" aria-label="重置描边">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body" data-f="sk-body">
        <div class="ed-tr">
          <span class="ed-tr-k">颜色</span>
          ${colorRowHtml('sk-color', 'sk-colorHex', t.stroke.color)}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">不透明度</span>
          <input type="range" class="ed-pic-range" data-f="sk-opR" min="0" max="100" step="1">
          ${unitNum('sk-opN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.stroke.opacity * 100)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">粗细</span>
          <input type="range" class="ed-pic-range" data-f="sk-wR" min="0" max="100" step="1">
          ${unitNum('sk-wN', {
            min: 0, max: 100, step: 1,
            value: String(Math.round(t.stroke.width))
          })}
        </div>
      </div>
    </section>`
}

/** 绑定描边组 */
export function bindTextStroke(
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
    onF: 'sk-on',
    bodyF: 'sk-body',
    resetKey: 'stroke',
    enabled: t().stroke.enabled,
    onToggle: enabled => {
      const next = { ...t().stroke, enabled }
      t().stroke = next
      live({ stroke: next })
      commit()
    },
    onReset: () => {
      const next = { ...DEFAULT_TEXT_STROKE, enabled: t().stroke.enabled }
      t().stroke = next
      live({ stroke: next })
      syncAll()
      commit()
    }
  })

  bindColorControl(root, 'sk-color', 'sk-colorHex', c => {
    t().stroke = { ...t().stroke, color: c }
    live({ stroke: t().stroke })
  }, commit)

  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sk-opR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sk-opN"]')!,
    0,
    100,
    v => {
      t().stroke = { ...t().stroke, opacity: v / 100 }
      live({ stroke: t().stroke })
    },
    Math.round(t().stroke.opacity * 100),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sk-wR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sk-wN"]')!,
    0,
    100,
    v => {
      t().stroke = { ...t().stroke, width: v }
      live({ stroke: t().stroke })
    },
    Math.round(t().stroke.width),
    { clampNum: ctx.clampNum, commit }
  )
}

/** 重同步：颜色 / 不透明度 / 粗细 + 勾选态 */
export function syncTextStroke(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const tx = sel.text!
  syncSetVal(root, active, 'sk-colorHex', tx.stroke.color)
  const skColor = root.querySelector<HTMLInputElement>('[data-f="sk-color"]')
  if (skColor && skColor !== active) skColor.value = tx.stroke.color
  syncSetVal(root, active, 'sk-opR', String(Math.round(tx.stroke.opacity * 100)))
  syncSetUnit(root, active, 'sk-opN', Math.round(tx.stroke.opacity * 100))
  syncSetVal(root, active, 'sk-wR', String(Math.round(tx.stroke.width)))
  syncSetUnit(root, active, 'sk-wN', Math.round(tx.stroke.width))
  syncOptionalSection(root, active, 'sk-on', 'sk-body', tx.stroke.enabled)
}
