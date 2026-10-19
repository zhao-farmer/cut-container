/* ============================================================
 *  右侧详情 · 文字面板（组合器）
 *
 *  把「内容 / 字体 / 位置 / 混合 / 描边 / 背景 / 发光 / 阴影」
 *  八个选项组按顺序拼装为 .ed-text-pane，对外保持原契约：
 *    renderText / bindText / syncTextTransform / syncTextValues
 * ============================================================ */
import type { ClipTransform } from '../../types'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import { bindSpinButtons } from './shared'
import { renderTextContent, bindTextContent, syncTextContent } from './textContent'
import { renderTextFont, bindTextFont, syncTextFont } from './textFont'
import { renderTextPosition, bindTextPosition, syncTextPositionValues } from './textPosition'
import { renderTextBlend, bindTextBlend, syncTextBlend } from './textBlend'
import { renderTextStroke, bindTextStroke, syncTextStroke } from './textStroke'
import { renderTextBackground, bindTextBackground, syncTextBackground } from './textBackground'
import { renderTextGlow, bindTextGlow, syncTextGlow } from './textGlow'
import { renderTextShadow, bindTextShadow, syncTextShadow } from './textShadow'

const PANE_SEL = '.ed-text-pane'

/** 渲染整个文字属性面板 */
export function renderText(sel: DetailSelection, ctx: DetailViewCtx): string {
  return `
  <div class="ed-text-pane">
    ${renderTextContent(sel, ctx)}
    ${renderTextFont(sel, ctx)}
    ${renderTextPosition(sel, ctx)}
    ${renderTextBlend(sel, ctx)}
    ${renderTextStroke(sel, ctx)}
    ${renderTextBackground(sel, ctx)}
    ${renderTextGlow(sel, ctx)}
    ${renderTextShadow(sel, ctx)}
  </div>`
}

/** 绑定文字面板全部控件 */
export function bindText(host: HTMLElement, ref: DetailSelectionRef, ctx: DetailViewCtx): void {
  const root = host.querySelector<HTMLElement>(PANE_SEL)
  if (!root) return

  // 各选项组重置后需要整体回灌一遍控件
  const syncAll = () => {
    const sel = ref.current
    if (sel) syncTextValues(host, sel, null)
  }

  bindTextContent(host, root, ref, ctx)
  bindTextFont(host, root, ref, ctx)
  bindTextPosition(host, root, ref, ctx)
  bindTextBlend(host, root, ref, ctx, syncAll)
  bindTextStroke(host, root, ref, ctx, syncAll)
  bindTextBackground(host, root, ref, ctx, syncAll)
  bindTextGlow(host, root, ref, ctx, syncAll)
  bindTextShadow(host, root, ref, ctx, syncAll)

  // 通用上下微调按钮（字号 / 间距 / 字体 / 各单位数值框），整面板统一绑定一次
  bindSpinButtons(root, ctx.clampNum)
}

/**
 * 播放器操作框高频回显 / 同片段重同步：轻量刷新位置设置控件值。
 * 返回 false 表示文字面板根节点不存在（调用方应整体重绘）。
 */
export function syncTextTransform(host: HTMLElement, t0: ClipTransform): boolean {
  const root = host.querySelector(PANE_SEL)
  if (!root) return false
  syncTextPositionValues(host, root, t0)
  return true
}

/** 同片段重复同步（撤销 / setTracks）：分组回灌全部文字控件，不重建 DOM、不抢焦点 */
export function syncTextValues(host: HTMLElement, sel: DetailSelection, active: Element | null): void {
  const root = host.querySelector(PANE_SEL)
  if (!sel.text || !root) return
  syncTextContent(root, sel, active)
  syncTextFont(root, sel, active)
  // 位置组：写回全部变换控件（与高频回显同源；焦点框由内部跳过）
  if (sel.transform) syncTextPositionValues(host, root, sel.transform)
  syncTextBlend(root, sel, active)
  syncTextStroke(root, sel, active)
  syncTextBackground(root, sel, active)
  syncTextGlow(root, sel, active)
  syncTextShadow(root, sel, active)
}
