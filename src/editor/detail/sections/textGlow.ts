/* ============================================================
 *  文字选项组 · ⑥ 发光（可选段）
 *  类型预设（璀璨 gem / 常规 soft）+ 颜色 / 强度 / 范围 /
 *  垂直·水平角度（仅 gem 显示角度行）
 * ============================================================ */
import { DEFAULT_TEXT_GLOW } from '../../types'
import type { TextGlowMode } from '../../types'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  RESET_SVG,
  bindColorControl,
  bindNumPair,
  bindOptionalSection,
  colorRowHtml,
  glowPresetSvg,
  syncOptionalSection,
  syncSetUnit,
  syncSetVal,
  unitNum,
  type TextPatch
} from './shared'

/** 发光组 HTML（初始收起） */
export function renderTextGlow(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const t = sel.text!
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span class="ed-tsec-head-l">
          <label class="ed-tsec-check"><input type="checkbox" data-f="gl-on"><span>发光</span></label>
          <button type="button" class="ed-tsec-caret" data-toggle="gl-body" title="展开" aria-label="展开"></button>
        </span>
        <button type="button" class="ed-tsec-reset" data-reset="glow" title="重置" aria-label="重置发光">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body" data-f="gl-body">
        <div class="ed-tpreset">
          <button type="button" class="ed-tpreset-btn${t.glow.mode === 'gem' ? ' is-on' : ''}"
            data-f="gl-mode" data-v="gem" title="璀璨">${glowPresetSvg('gem')}</button>
          <button type="button" class="ed-tpreset-btn${t.glow.mode === 'soft' ? ' is-on' : ''}"
            data-f="gl-mode" data-v="soft" title="常规">${glowPresetSvg('soft')}</button>
        </div>
        <div class="ed-tr">
          <span class="ed-tr-k">颜色</span>
          ${colorRowHtml('gl-color', 'gl-colorHex', t.glow.color)}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">强度</span>
          <input type="range" class="ed-pic-range" data-f="gl-strR" min="0" max="100" step="1">
          ${unitNum('gl-strN', {
            min: 0, max: 100, step: 1,
            value: String(Math.round(t.glow.strength))
          })}
        </div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">范围</span>
          <input type="range" class="ed-pic-range" data-f="gl-rangeR" min="0" max="100" step="1">
          ${unitNum('gl-rangeN', {
            min: 0, max: 100, step: 1,
            value: String(Math.round(t.glow.range))
          })}
        </div>
        <div class="ed-tr ed-tr-unit" data-f="gl-angVRow"${t.glow.mode === 'gem' ? '' : ' hidden'}>
          <span class="ed-tr-k">垂直角度</span>
          <input type="range" class="ed-pic-range" data-f="gl-angVR" min="-50" max="50" step="1">
          ${unitNum('gl-angVN', {
            min: -50, max: 50, step: 1, suffix: '°',
            value: `${Math.round(t.glow.angleV)}°`
          })}
        </div>
        <div class="ed-tr ed-tr-unit" data-f="gl-angHRow"${t.glow.mode === 'gem' ? '' : ' hidden'}>
          <span class="ed-tr-k">水平角度</span>
          <input type="range" class="ed-pic-range" data-f="gl-angHR" min="-50" max="50" step="1">
          ${unitNum('gl-angHN', {
            min: -50, max: 50, step: 1, suffix: '°',
            value: `${Math.round(t.glow.angleH)}°`
          })}
        </div>
      </div>
    </section>`
}

/** 绑定发光组 */
export function bindTextGlow(
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
    onF: 'gl-on',
    bodyF: 'gl-body',
    resetKey: 'glow',
    enabled: t().glow.enabled,
    onToggle: enabled => {
      const next = { ...t().glow, enabled }
      t().glow = next
      live({ glow: next })
      commit()
    },
    onReset: () => {
      const next = { ...DEFAULT_TEXT_GLOW, enabled: t().glow.enabled }
      t().glow = next
      live({ glow: next })
      syncAll()
      commit()
    }
  })

  // 类型预设（璀璨镜面光照 / 常规外发光），切换后角度行仅 gem 可见
  root.querySelectorAll<HTMLButtonElement>('button[data-f="gl-mode"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn.dataset.v || '') as TextGlowMode
      t().glow = { ...t().glow, mode }
      live({ glow: t().glow })
      root
        .querySelectorAll<HTMLButtonElement>('button[data-f="gl-mode"]')
        .forEach(b => b.classList.toggle('is-on', b === btn))
      const isGem = t().glow.mode === 'gem'
      ;['gl-angVRow', 'gl-angHRow'].forEach(rf => {
        const row = root.querySelector<HTMLElement>(`[data-f="${rf}"]`)
        if (row) row.hidden = !isGem
      })
      commit()
    })
  })

  bindColorControl(root, 'gl-color', 'gl-colorHex', c => {
    t().glow = { ...t().glow, color: c }
    live({ glow: t().glow })
  }, commit)

  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="gl-strR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="gl-strN"]')!,
    0,
    100,
    v => {
      t().glow = { ...t().glow, strength: v }
      live({ glow: t().glow })
    },
    Math.round(t().glow.strength),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="gl-rangeR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="gl-rangeN"]')!,
    0,
    100,
    v => {
      t().glow = { ...t().glow, range: v }
      live({ glow: t().glow })
    },
    Math.round(t().glow.range),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="gl-angVR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="gl-angVN"]')!,
    -50,
    50,
    v => {
      t().glow = { ...t().glow, angleV: v }
      live({ glow: t().glow })
    },
    Math.round(t().glow.angleV),
    { clampNum: ctx.clampNum, commit }
  )
  bindNumPair(
    root.querySelector<HTMLInputElement>('[data-f="gl-angHR"]')!,
    root.querySelector<HTMLInputElement>('[data-f="gl-angHN"]')!,
    -50,
    50,
    v => {
      t().glow = { ...t().glow, angleH: v }
      live({ glow: t().glow })
    },
    Math.round(t().glow.angleH),
    { clampNum: ctx.clampNum, commit }
  )
}

/** 重同步：预设高亮 / 颜色 / 强度 / 范围 / 角度行可见性 + 勾选态 */
export function syncTextGlow(root: ParentNode, sel: DetailSelection, active: Element | null): void {
  const tx = sel.text!
  syncSetVal(root, active, 'gl-colorHex', tx.glow.color)
  const glColor = root.querySelector<HTMLInputElement>('[data-f="gl-color"]')
  if (glColor && glColor !== active) glColor.value = tx.glow.color
  syncSetVal(root, active, 'gl-strR', String(Math.round(tx.glow.strength)))
  syncSetUnit(root, active, 'gl-strN', Math.round(tx.glow.strength))
  syncSetVal(root, active, 'gl-rangeR', String(Math.round(tx.glow.range)))
  syncSetUnit(root, active, 'gl-rangeN', Math.round(tx.glow.range))
  syncSetVal(root, active, 'gl-angVR', String(Math.round(tx.glow.angleV)))
  syncSetUnit(root, active, 'gl-angVN', Math.round(tx.glow.angleV))
  syncSetVal(root, active, 'gl-angHR', String(Math.round(tx.glow.angleH)))
  syncSetUnit(root, active, 'gl-angHN', Math.round(tx.glow.angleH))
  syncOptionalSection(root, active, 'gl-on', 'gl-body', tx.glow.enabled)
  root.querySelectorAll<HTMLButtonElement>('button[data-f="gl-mode"]').forEach(b =>
    b.classList.toggle('is-on', b.dataset.v === tx.glow.mode)
  )
  ;['gl-angVRow', 'gl-angHRow'].forEach(rf => {
    const row = root.querySelector<HTMLElement>(`[data-f="${rf}"]`)
    if (row) row.hidden = tx.glow.mode !== 'gem'
  })
}
