/* ============================================================
 *  右侧详情 · 选项组共享件（sections/ 各拆分组复用）
 *
 *  从原文字视图抽出的通用 UI 零件与绑定逻辑：
 *    · 单位一体数值框 / 上下微调 / 滑杆+数值对 / 颜色对
 *    · 六态对齐（横排 / 竖排）、字体选项、缩放非线性轨道
 *    · 可选段（复选框 + 折叠小三角 + 重置）统一控制
 *    · 内容放大 / 段头重置 / 发光预设等 SVG
 * ============================================================ */
import type { TextAlign, TextVAlign } from '../../types'
import { CHEV_DOWN, CHEV_UP } from '../../utils/icons'
import type { DetailSelection, DetailViewCtx } from '../index'

// 图标定义已统一收敛到 utils/icons.ts；这里透传导出，保持 sections 内部引用路径稳定
export {
  align6Svg,
  glowPresetSvg,
  hAlignSvg,
  posAlignSvg,
  RESET_SVG,
  vBarSvg,
  ZOOM_IN_SVG,
  ZOOM_OUT_SVG
} from '../../utils/icons'

/** 文字属性 patch 别名（动态键写入用） */
export type TextPatch = Partial<NonNullable<DetailSelection['text']>>

/** 文字字体可选项（仅系统常见字体，无在线字体库） */
export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '系统' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica Neue', label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Courier New', label: 'Courier New' }
]

/** 六态对齐：横排（左 / 中 / 右）＋ 竖排（上 / 中 / 下） */
export type Align6 =
  | 'h-left'
  | 'h-center'
  | 'h-right'
  | 'v-top'
  | 'v-middle'
  | 'v-bottom'

export const ALIGN6: { v: Align6; title: string }[] = [
  { v: 'h-left', title: '横排 · 左对齐' },
  { v: 'h-center', title: '横排 · 居中对齐' },
  { v: 'h-right', title: '横排 · 右对齐' },
  { v: 'v-top', title: '竖排 · 上对齐' },
  { v: 'v-middle', title: '竖排 · 居中对齐' },
  { v: 'v-bottom', title: '竖排 · 下对齐' }
]

/** 由当前文字样式推导六态对齐中激活的一项 */
export function align6Of(t: { vertical: boolean; align: TextAlign; valign: TextVAlign }): Align6 {
  return t.vertical ? `v-${t.valign}` : `h-${t.align}`
}

/** 位置设置底部六按钮：水平三态（只改 x）＋ 竖直三态（只改 y） */
export const POS_ALIGN6: { id: string; h: TextAlign | null; v: TextVAlign | null; title: string }[] = [
  { id: 'h-left', h: 'left', v: null, title: '左对齐' },
  { id: 'h-center', h: 'center', v: null, title: '水平居中对齐' },
  { id: 'h-right', h: 'right', v: null, title: '右对齐' },
  { id: 'v-top', h: null, v: 'top', title: '顶对齐' },
  { id: 'v-middle', h: null, v: 'middle', title: '垂直居中对齐' },
  { id: 'v-bottom', h: null, v: 'bottom', title: '底对齐' }
]

/* ---------- 缩放滑杆：0% – 500%，100% 位于轨道正中央（非线性映射） ---------- */
export const SCALE_RAIL_MAX = 1000
/** 百分比 → 滑杆轨道位置（0 – 1000，500 ＝ 100%） */
export function pctToRail(pct: number): number {
  return pct <= 100 ? pct * 5 : 500 + (pct - 100) * 1.25
}
/** 滑杆轨道位置 → 百分比 */
export function railToPct(rail: number): number {
  return rail <= 500 ? rail / 5 : 100 + (rail - 500) * 0.8
}

/* 数值微调上 / 下箭头（SVG 定义在 utils/icons.ts 统一维护） */

/** 上下微调按钮组（按住可连续步进；target 为被调控件的 data-f） */
export function spinCtl(target: string): string {
  return `
    <span class="ed-spin-ctl">
      <button type="button" class="ed-spin-btn" data-spin="${target}" data-dir="1"
        tabindex="-1" aria-label="增大" title="增大（按住连续）">${CHEV_UP}</button
      ><button type="button" class="ed-spin-btn" data-spin="${target}" data-dir="-1"
        tabindex="-1" aria-label="减小" title="减小（按住连续）">${CHEV_DOWN}</button>
    </span>`
}

/** 窄数值框 + 上下微调按钮 */
export function spinNum(f: string, attrs: string): string {
  return `<span class="ed-spin"><input type="number" class="ed-spin-input" data-f="${f}" ${attrs}>${spinCtl(f)}</span>`
}

/**
 * 单位一体的居中文本数值框（「100%」「0.00°」等，数值与后缀同一个框）。
 * 上下微调参数走 data-*（文本框无原生 min / max / step）。
 */
export function unitNum(
  f: string,
  o: { min: number; max: number; step: number; value: string; suffix?: string; prec?: number; tag?: string }
): string {
  return `<span class="ed-tnum">${o.tag ? `<i class="ed-tnum-tag">${o.tag}</i>` : ''}<input type="text"
      class="ed-tnum-input" data-f="${f}" inputmode="decimal" autocomplete="off"
      data-min="${o.min}" data-max="${o.max}" data-step="${o.step}" data-prec="${o.prec ?? 0}"${
        o.suffix ? ` data-suffix="${o.suffix}"` : ''
      } value="${o.value}"></span>${spinCtl(f)}`
}

/** 按文本框 data-prec / data-suffix 把数值写回「100%」「0.00°」形态 */
export function writeUnitValue(el: HTMLInputElement, v: number): void {
  const prec = Number(el.dataset.prec ?? 0)
  const text = prec > 0 ? v.toFixed(prec) : String(Math.round(v))
  el.value = `${text}${el.dataset.suffix ?? ''}`
}

/* 对齐 / 放大 / 重置 / 发光预设等图标已统一迁至 utils/icons.ts */

/** 颜色行（原生取色器 + 十六进制文本框） */
export function colorRowHtml(f: string, hexF: string, val: string): string {
  return `
    <span class="ed-color-edit">
      <input type="color" class="ed-color-native" data-f="${f}" title="选择颜色">
      <input type="text" class="ed-input ed-color-hex" data-f="${hexF}" maxlength="7" value="${val}">
    </span>`
}

/**
 * 通用上下微调按钮绑定（字号 / 字间距 / 行间距 / 字体；按住连续步进）：
 * 步进时只发 input（实时上屏），松手 change 才入栈。
 */
export function bindSpinButtons(root: HTMLElement, clampNum: (v: number, min: number, max: number) => number): void {
  root.querySelectorAll<HTMLButtonElement>('.ed-spin-btn').forEach(btn => {
    const targetF = btn.dataset.spin!
    const dir = Number(btn.dataset.dir)
    const target = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-f="${targetF}"]`
    )!
    let delayTimer = 0
    let repeatTimer = 0
    let changed = false
    const fireInput = () =>
      target.dispatchEvent(new target.ownerDocument.defaultView!.Event('input', { bubbles: true }))
    const fireChange = () =>
      target.dispatchEvent(new target.ownerDocument.defaultView!.Event('change', { bubbles: true }))
    const stepOnce = () => {
      // 禁用控件（如非等比时的主缩放框）上下微调一并屏蔽
      if (!(target instanceof HTMLSelectElement) && target.disabled) return
      if (target instanceof HTMLSelectElement) {
        const next = target.selectedIndex + dir
        if (next < 0 || next >= target.options.length) return
        target.selectedIndex = next
      } else {
        // 文本数值框（100% / 0.00° 等）步长 / 范围取 data-*；普通数字框取原生属性
        const ds = target.dataset
        const isUnit = target.type === 'text' && ds.step !== undefined
        const min = isUnit ? Number(ds.min) : Number(target.min)
        const max = isUnit ? Number(ds.max) : Number(target.max)
        const step = isUnit ? Number(ds.step) : Number(target.step) || 1
        // parseFloat 对「100%」「0.00°」同样可用
        const cur = parseFloat(target.value)
        const base = Number.isFinite(cur) ? cur : 0
        const next = clampNum(Math.round((base + dir * step) * 1000) / 1000, min, max)
        if (next === base) return
        if (isUnit) writeUnitValue(target, next)
        else target.value = String(next)
      }
      changed = true
      fireInput()
    }
    const stop = () => {
      if (delayTimer) {
        clearTimeout(delayTimer)
        delayTimer = 0
      }
      if (repeatTimer) {
        clearInterval(repeatTimer)
        repeatTimer = 0
      }
      if (changed) {
        changed = false
        fireChange()
      }
    }
    btn.addEventListener('pointerdown', e => {
      // 不抢焦点：避免正在输入的控件失焦提前提交
      e.preventDefault()
      stop()
      stepOnce()
      delayTimer = window.setTimeout(() => {
        repeatTimer = window.setInterval(stepOnce, 70)
      }, 420)
    })
    btn.addEventListener('pointerup', stop)
    btn.addEventListener('pointercancel', stop)
    btn.addEventListener('pointerleave', stop)
  })
}

/** 颜色取色器 + 十六进制文本框绑定：取色 input 实时；hex 合法后 change 提交 */
export function bindColorControl(
  root: ParentNode,
  f: string,
  hexF: string,
  apply: (c: string) => void,
  commit: () => void
): void {
  const cEl = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!
  const hEl = root.querySelector<HTMLInputElement>(`[data-f="${hexF}"]`)!
  cEl.value = /^#[0-9a-fA-F]{6}$/.test(hEl.value) ? hEl.value : '#000000'
  cEl.addEventListener('input', () => {
    hEl.value = cEl.value
    apply(cEl.value)
  })
  cEl.addEventListener('change', commit)
  hEl.addEventListener('change', () => {
    const v = hEl.value.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const c = v.toLowerCase()
      cEl.value = c
      apply(c)
      commit()
    } else {
      hEl.value = cEl.value
    }
  })
}

/**
 * 滑杆 + 数值框成对绑定（拖动镜像、live；松手 / 失焦提交）。
 * 数值框为单位一体文本框时按 data-suffix / data-prec 回写。
 */
export function bindNumPair(
  range: HTMLInputElement,
  num: HTMLInputElement,
  min: number,
  max: number,
  apply: (v: number) => void,
  initial: number,
  ctx: Pick<DetailViewCtx, 'clampNum'> & { commit: () => void }
): void {
  const { clampNum } = ctx
  const set = (v0: number, doCommit: boolean) => {
    const v = clampNum(Math.round(v0), min, max)
    range.value = String(v)
    writeUnitValue(num, v)
    apply(v)
    if (doCommit) ctx.commit()
  }
  range.value = String(initial)
  writeUnitValue(num, initial)
  range.addEventListener('input', () => set(Number(range.value), false))
  range.addEventListener('change', () => set(Number(range.value), true))
  num.addEventListener('input', () => {
    const v = clampNum(parseFloat(num.value) || 0, min, max)
    range.value = String(v)
    apply(v)
  })
  num.addEventListener('change', () => set(parseFloat(num.value) || 0, true))
  num.addEventListener('keydown', e => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  })
}

/** 同片段重同步辅助：普通输入框值回灌（不抢焦点） */
export function syncSetVal(root: ParentNode, active: Element | null, f: string, v: string): void {
  const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
  if (el && el !== active) el.value = v
}

/** 同片段重同步辅助：单位一体文本框按 data-suffix / data-prec 回灌（不抢焦点） */
export function syncSetUnit(root: ParentNode, active: Element | null, f: string, v: number): void {
  const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
  if (el && el !== active) {
    const prec = Number(el.dataset.prec ?? 0)
    el.value = prec > 0 ? v.toFixed(prec) : `${Math.round(v)}${el.dataset.suffix ?? ''}`
  }
}

/** 可选段（复选框 + 折叠小三角 + 重置）绑定参数 */
export interface OptionalSectionBinding {
  root: HTMLElement
  /** 复选框 data-f */
  onF: string
  /** 折叠体 data-f（同时也是小三角 data-toggle 目标） */
  bodyF: string
  /** 重置按钮 data-reset 键 */
  resetKey: string
  /** 初始勾选态 */
  enabled: boolean
  /** 勾选 / 取消勾选（段内完成数据写入 + live + commit） */
  onToggle: (enabled: boolean) => void
  /** 重置钮：参数回默认（保留勾选态），段内写完数据后须回灌全部控件 */
  onReset: () => void
}

/**
 * 可选段统一控制：
 * 复选框仅决定该段数据是否生效（未勾选整段 inert 置灰，展开态不变）；
 * 小三角仅控制展开 / 收起；重置恢复默认参数但保留勾选态。
 */
export function bindOptionalSection(b: OptionalSectionBinding): void {
  const { root, onF, bodyF, resetKey } = b
  const on = root.querySelector<HTMLInputElement>(`[data-f="${onF}"]`)!
  const body = root.querySelector<HTMLElement>(`[data-f="${bodyF}"]`)!
  const caret = root.querySelector<HTMLButtonElement>(`[data-toggle="${bodyF}"]`)!
  const resetBtn = root.querySelector<HTMLButtonElement>(`[data-reset="${resetKey}"]`)!

  const applyEnabled = () => {
    body.inert = !on.checked
    body.classList.toggle('is-off', !on.checked)
  }
  const applyCaret = () => {
    caret.classList.toggle('is-open', !body.hidden)
    caret.title = body.hidden ? '展开' : '收起'
    caret.setAttribute('aria-label', body.hidden ? '展开' : '收起')
  }
  // 初次进入：启用的段默认展开，其余收起；之后完全交给小三角
  on.checked = b.enabled
  body.hidden = !b.enabled
  body.inert = !b.enabled
  body.classList.toggle('is-off', !b.enabled)
  applyCaret()

  on.addEventListener('change', () => {
    b.onToggle(on.checked)
    applyEnabled()
    // 勾选启用：自动展开段体便于立即调参；取消勾选：保留展开态但置灰
    if (on.checked && body.hidden) {
      body.hidden = false
      applyCaret()
    }
  })
  caret.addEventListener('click', () => {
    body.hidden = !body.hidden
    applyCaret()
  })
  resetBtn.addEventListener('click', () => b.onReset())
}

/** 同片段重同步时回灌可选段勾选态 + 禁用置灰（展开 / 收起由小三角独立维持） */
export function syncOptionalSection(
  root: ParentNode,
  active: Element | null,
  onF: string,
  bodyF: string,
  enabled: boolean
): void {
  const on = root.querySelector<HTMLInputElement>(`[data-f="${onF}"]`)
  if (on && on !== active) on.checked = enabled
  const body = root.querySelector<HTMLElement>(`[data-f="${bodyF}"]`)
  if (body) {
    body.inert = !enabled
    body.classList.toggle('is-off', !enabled)
  }
}
