/* ============================================================
 *  文字选项组 · ⑦ 阴影（可选段）
 *  颜色 / 不透明度 / 模糊度 / 距离 / 角度
 * ============================================================ */
import { DEFAULT_TEXT_SHADOW } from '../../types'
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

/** 阴影组 HTML（初始收起） */
export function renderTextShadow(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span class="ed-tsec-head-l">
          <label class="ed-tsec-check"><input type="checkbox" data-f="sh-on"><span>阴影</span></label>
          <button type="button" class="ed-tsec-caret" data-toggle="sh-body" title="展开" aria-label="展开"></button>
        </span>
        <button type="button" class="ed-tsec-reset" data-reset="shadow" title="重置" aria-label="重置阴影">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body" data-f="sh-body">
        <div class="ed-tr">
          <span class="ed-tr-k">颜色</span>
          ${colorRowHtml('sh-color', 'sh-colorHex', t.shadow.color)}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">不透明度</span>
          <input type="range" class="ed-pic-range" data-f="sh-opR" min="0" max="100" step="1">
          ${unitNum('sh-opN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.shadow.opacity * 100)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">模糊度</span>
          <input type="range" class="ed-pic-range" data-f="sh-blurR" min="0" max="100" step="1">
          ${unitNum('sh-blurN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.shadow.blur)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">距离</span>
          <input type="range" class="ed-pic-range" data-f="sh-distR" min="0" max="100" step="1">
          ${unitNum('sh-distN', {
            min: 0, max: 100, step: 1, suffix: 'px',
            value: `${Math.round(t.shadow.distance)}px`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">角度</span>
          <input type="range" class="ed-pic-range" data-f="sh-angR" min="-180" max="180" step="1">
          ${unitNum('sh-angN', {
            min: -180, max: 180, step: 1, suffix: '°',
            value: `${Math.round(t.shadow.angle)}°`
          })}
        </div>
      </div>
    </section>`
}

/** 绑定阴影组 */
export function bindTextShadow(
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
    onF: 'sh-on',
    bodyF: 'sh-body',
    resetKey: 'shadow',
    enabled: t().shadow.enabled,
    onToggle: enabled => {
      const next = { ...t().shadow, enabled }
      t().shadow = next
      live({ shadow: next })
      commit()
    },
    onReset: () => {
      const next = { ...DEFAULT_TEXT_SHADOW, enabled: t().shadow.enabled }
      t().shadow = next
      live({ shadow: next })
      syncAll()
      commit()
    }
  })

  bindColorControl(root, 'sh-color', 'sh-colorHex', c => {
    t().shadow = { ...t().shadow, color: c }
    live({ shadow: t().shadow })
  }, commit)

  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sh-opR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sh-opN"]')!,
    0,
    100,
    v => {
      t().shadow = { ...t().shadow, opacity: v / 100 }
      live({ shadow: t().shadow })
    },
    Math.round(t().shadow.opacity * 100),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sh-blurR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sh-blurN"]')!,
    0,
    100,
    v => {
      t().shadow = { ...t().shadow, blur: v }
      live({ shadow: t().shadow })
    },
    Math.round(t().shadow.blur),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sh-distR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sh-distN"]')!,
    0,
    100,
    v => {
      t().shadow = { ...t().shadow, distance: v }
      live({ shadow: t().shadow })
    },
    Math.round(t().shadow.distance),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="sh-angR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="sh-angN"]')!,
    -180,
    180,
    v => {
      t().shadow = { ...t().shadow, angle: v }
      live({ shadow: t().shadow })
    },
    Math.round(t().shadow.angle),
    { clampNum: ctx.clampNum, commit }
  )
}

/** 重同步：颜色 / 不透明度 / 模糊度 / 距离 / 角度 + 勾选态 */
export function syncTextShadow(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const tx = sel.text!
  syncSetVal(root, active, 'sh-colorHex', tx.shadow.color)
  const shColor = root.querySelector<HTMLInputElement>('[data-f="sh-color"]')
  if (shColor && shColor !== active) shColor.value = tx.shadow.color
  syncSetVal(root, active, 'sh-opR', String(Math.round(tx.shadow.opacity * 100)))
  syncSetUnit(root, active, 'sh-opN', Math.round(tx.shadow.opacity * 100))
  syncSetVal(root, active, 'sh-blurR', String(Math.round(tx.shadow.blur)))
  syncSetUnit(root, active, 'sh-blurN', Math.round(tx.shadow.blur))
  syncSetVal(root, active, 'sh-distR', String(Math.round(tx.shadow.distance)))
  syncSetUnit(root, active, 'sh-distN', Math.round(tx.shadow.distance))
  syncSetVal(root, active, 'sh-angR', String(Math.round(tx.shadow.angle)))
  syncSetUnit(root, active, 'sh-angN', Math.round(tx.shadow.angle))
  syncOptionalSection(root, active, 'sh-on', 'sh-body', tx.shadow.enabled)
}
