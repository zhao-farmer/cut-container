/* ============================================================
 *  文字选项组 · ⑤ 背景（可选段）
 *  颜色 / 不透明度 / 圆角 / 高度 / 宽度 / 上下偏移 / 左右偏移
 * ============================================================ */
import { DEFAULT_TEXT_BACKGROUND } from '../../types'
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

/** 背景组 HTML（初始收起） */
export function renderTextBackground(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span class="ed-tsec-head-l">
          <label class="ed-tsec-check"><input type="checkbox" data-f="bg-on"><span>背景</span></label>
          <button type="button" class="ed-tsec-caret" data-toggle="bg-body" title="展开" aria-label="展开"></button>
        </span>
        <button type="button" class="ed-tsec-reset" data-reset="background" title="重置" aria-label="重置背景">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body" data-f="bg-body">
        <div class="ed-tr">
          <span class="ed-tr-k">颜色</span>
          ${colorRowHtml('bg-color', 'bg-colorHex', t.background.color)}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">不透明度</span>
          <input type="range" class="ed-pic-range" data-f="bg-opR" min="0" max="100" step="1">
          ${unitNum('bg-opN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.opacity * 100)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">圆角</span>
          <input type="range" class="ed-pic-range" data-f="bg-radiusR" min="0" max="100" step="1">
          ${unitNum('bg-radiusN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.radius)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">高度</span>
          <input type="range" class="ed-pic-range" data-f="bg-hR" min="0" max="100" step="1">
          ${unitNum('bg-hN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.height)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">宽度</span>
          <input type="range" class="ed-pic-range" data-f="bg-wR" min="0" max="100" step="1">
          ${unitNum('bg-wN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.width)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">上下偏移</span>
          <input type="range" class="ed-pic-range" data-f="bg-oyR" min="0" max="100" step="1">
          ${unitNum('bg-oyN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.offsetY)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">左右偏移</span>
          <input type="range" class="ed-pic-range" data-f="bg-oxR" min="0" max="100" step="1">
          ${unitNum('bg-oxN', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${Math.round(t.background.offsetX)}%`
          })}
        </div>
      </div>
    </section>`
}

/** 绑定背景组 */
export function bindTextBackground(
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
    onF: 'bg-on',
    bodyF: 'bg-body',
    resetKey: 'background',
    enabled: t().background.enabled,
    onToggle: enabled => {
      const next = { ...t().background, enabled }
      t().background = next
      live({ background: next })
      commit()
    },
    onReset: () => {
      const next = { ...DEFAULT_TEXT_BACKGROUND, enabled: t().background.enabled }
      t().background = next
      live({ background: next })
      syncAll()
      commit()
    }
  })

  bindColorControl(root, 'bg-color', 'bg-colorHex', c => {
    t().background = { ...t().background, color: c }
    live({ background: t().background })
  }, commit)

  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="bg-opR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="bg-opN"]')!,
    0,
    100,
    v => {
      t().background = { ...t().background, opacity: v / 100 }
      live({ background: t().background })
    },
    Math.round(t().background.opacity * 100),
    { clampNum: ctx.clampNum, commit }
  )
  const bgPctKey = (
    key: 'radius' | 'height' | 'width' | 'offsetY' | 'offsetX',
    rf: string,
    nf: string
  ) => {
    bindNumPair(
      root.querySelector<HTMLInputElement>(`[data-f="${rf}"]`)!,
      root.querySelector<HTMLInputElement>(`[data-f="${nf}"]`)!,
      0,
      100,
      v => {
        t().background = { ...t().background, [key]: v }
        live({ background: t().background })
      },
      Math.round(t().background[key] as number),
      { clampNum: ctx.clampNum, commit }
    )
  }
  bgPctKey('radius', 'bg-radiusR', 'bg-radiusN')
  bgPctKey('height', 'bg-hR', 'bg-hN')
  bgPctKey('width', 'bg-wR', 'bg-wN')
  bgPctKey('offsetY', 'bg-oyR', 'bg-oyN')
  bgPctKey('offsetX', 'bg-oxR', 'bg-oxN')
}

/** 重同步：颜色 / 不透明度 / 圆角 / 高宽 / 偏移 + 勾选态 */
export function syncTextBackground(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const tx = sel.text!
  syncSetVal(root, active, 'bg-colorHex', tx.background.color)
  const bgColor = root.querySelector<HTMLInputElement>('[data-f="bg-color"]')
  if (bgColor && bgColor !== active) bgColor.value = tx.background.color
  syncSetVal(root, active, 'bg-opR', String(Math.round(tx.background.opacity * 100)))
  syncSetUnit(root, active, 'bg-opN', Math.round(tx.background.opacity * 100))
  syncSetVal(root, active, 'bg-radiusR', String(Math.round(tx.background.radius)))
  syncSetUnit(root, active, 'bg-radiusN', Math.round(tx.background.radius))
  syncSetVal(root, active, 'bg-hR', String(Math.round(tx.background.height)))
  syncSetUnit(root, active, 'bg-hN', Math.round(tx.background.height))
  syncSetVal(root, active, 'bg-wR', String(Math.round(tx.background.width)))
  syncSetUnit(root, active, 'bg-wN', Math.round(tx.background.width))
  syncSetVal(root, active, 'bg-oyR', String(Math.round(tx.background.offsetY)))
  syncSetUnit(root, active, 'bg-oyN', Math.round(tx.background.offsetY))
  syncSetVal(root, active, 'bg-oxR', String(Math.round(tx.background.offsetX)))
  syncSetUnit(root, active, 'bg-oxN', Math.round(tx.background.offsetX))
  syncOptionalSection(root, active, 'bg-on', 'bg-body', tx.background.enabled)
}
