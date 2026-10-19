/* ============================================================
 *  文字选项组 · ② 位置设置（段头 + 重置）
 *  缩放（等比开关）/ 位置 XY / 平面旋转拨盘 / 翻转 / 九宫格定位。
 *  与播放器操作框同源：onTransformLive 高频回显、onTransformCommit 入栈。
 * ============================================================ */
import type { TextAlign, TextVAlign } from '../../types'
import type { ClipTransform } from '../../types'
import {
  POSITION_MAX,
  TEXT_SCALE_BOUNDS,
  normalizeTransform,
  resetTransform,
  withUniformDisabled,
  withUniformEnabled
} from '../../transform'
import { flipIcon } from '../../utils/icons'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  POS_ALIGN6,
  SCALE_RAIL_MAX,
  pctToRail,
  railToPct,
  posAlignSvg,
  RESET_SVG,
  unitNum,
  writeUnitValue
} from './shared'

/** 位置设置组 HTML */
export function renderTextPosition(sel: DetailSelection, _ctx: DetailViewCtx): string {
  const tr = normalizeTransform(sel.transform, TEXT_SCALE_BOUNDS)
  const posBtns = POS_ALIGN6.map(
    (o, i) =>
      `${i === 3 ? '<i class="ed-align-sep" aria-hidden="true"></i>' : ''}
      <button type="button" class="ed-seg-btn"
        data-f="p-align" data-id="${o.id}"${o.h ? ` data-h="${o.h}"` : ''}${
          o.v ? ` data-v="${o.v}"` : ''
        } title="${o.title}">${posAlignSvg(o.id)}</button>`
  ).join('')
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span>位置设置</span>
        <button type="button" class="ed-tsec-reset" data-f="p-reset" title="重置" aria-label="重置位置设置">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body">
        <div class="ed-tr" data-f="p-uniformRow">
          <span class="ed-tr-k">缩放</span>
          <input type="range" class="ed-pic-range" data-f="p-range"
            min="0" max="${SCALE_RAIL_MAX}" step="1"
            value="${Math.round(pctToRail(Math.round(tr.scale * 100)))}">
          ${unitNum('p-pct', {
            min: 0, max: 500, step: 1, suffix: '%',
            value: `${Math.round(tr.scale * 100)}%`
          })}
        </div>
        <div class="ed-tr" data-f="p-axisX" hidden>
          <span class="ed-tr-k">缩放宽度</span>
          <input type="range" class="ed-pic-range" data-f="p-rangeX"
            min="0" max="${SCALE_RAIL_MAX}" step="1"
            value="${Math.round(pctToRail(Math.round(tr.scaleX * 100)))}">
          ${unitNum('p-scaleX', {
            min: 0, max: 500, step: 1, suffix: '%',
            value: `${Math.round(tr.scaleX * 100)}%`
          })}
        </div>
        <div class="ed-tr" data-f="p-axisY" hidden>
          <span class="ed-tr-k">缩放高度</span>
          <input type="range" class="ed-pic-range" data-f="p-rangeY"
            min="0" max="${SCALE_RAIL_MAX}" step="1"
            value="${Math.round(pctToRail(Math.round(tr.scaleY * 100)))}">
          ${unitNum('p-scaleY', {
            min: 0, max: 500, step: 1, suffix: '%',
            value: `${Math.round(tr.scaleY * 100)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-switch">
          <span class="ed-tr-k">等比缩放</span>
          <label class="ed-switch">
            <input type="checkbox" data-f="p-uniform"${tr.uniform ? ' checked' : ''}><i></i>
          </label>
        </div>
        <div class="ed-tr ed-tr-pos">
          <span class="ed-tr-k">位置</span>
          ${unitNum('p-x', {
            min: -POSITION_MAX, max: POSITION_MAX, step: 1, tag: 'X',
            value: String(Math.round(tr.x))
          })}
          ${unitNum('p-y', {
            min: -POSITION_MAX, max: POSITION_MAX, step: 1, tag: 'Y',
            value: String(Math.round(tr.y))
          })}
        </div>
        <div class="ed-tr ed-tr-rot">
          <span class="ed-tr-k">平面旋转</span>
          ${unitNum('p-rot', {
            min: -36000, max: 36000, step: 1, suffix: '°', prec: 2,
            value: `${(Math.round(tr.rotation * 100) / 100).toFixed(2)}°`
          })}
          <span class="ed-pic-dial" data-f="p-dial" title="按住圆环拖动旋转"><i class="ed-pic-dial-need"></i></span>
        </div>
        <div class="ed-tr ed-tr-flip">
          <span class="ed-tr-k">翻转</span>
          <button type="button" class="ed-flip-btn${sel.transform?.flipH ? ' is-on' : ''}"
            data-flip="h" title="水平翻转">${flipIcon('h')}</button>
          <button type="button" class="ed-flip-btn${sel.transform?.flipV ? ' is-on' : ''}"
            data-flip="v" title="垂直翻转">${flipIcon('v')}</button>
        </div>
        <span class="ed-align6 ed-posalign" role="group" aria-label="位置对齐">${posBtns}</span>
      </div>
    </section>`
}

/** 绑定位置设置组（变换控件，与播放器操作框同源） */
export function bindTextPosition(
  host: HTMLElement,
  root: HTMLElement,
  ref: DetailSelectionRef,
  ctx: DetailViewCtx
): void {
  const { clampNum } = ctx
  const $ = <T extends HTMLElement>(f: string): T => root.querySelector<T>(`[data-f="${f}"]`)!
  const range = $<HTMLInputElement>('p-range')
  const rangeX = $<HTMLInputElement>('p-rangeX')
  const rangeY = $<HTMLInputElement>('p-rangeY')
  const pct = $<HTMLInputElement>('p-pct')
  const scaleXEl = $<HTMLInputElement>('p-scaleX')
  const scaleYEl = $<HTMLInputElement>('p-scaleY')
  const uniform = $<HTMLInputElement>('p-uniform')
  const xEl = $<HTMLInputElement>('p-x')
  const yEl = $<HTMLInputElement>('p-y')
  const rotEl = $<HTMLInputElement>('p-rot')
  const uniformRow = root.querySelector('[data-f="p-uniformRow"]') as HTMLElement
  const axisXRow = root.querySelector('[data-f="p-axisX"]') as HTMLElement
  const axisYRow = root.querySelector('[data-f="p-axisY"]') as HTMLElement
  const dial = $('p-dial') as HTMLElement
  const dialNeed = dial.querySelector('.ed-pic-dial-need') as HTMLElement
  const resetBtn = $<HTMLButtonElement>('p-reset')
  const isFocused = (el: Element | null) => el === host.ownerDocument.activeElement
  /** 文本数值框读值：parseFloat 兼容「100%」「0.00°」 */
  const numOf = (el: HTMLInputElement, fallback: number) => {
    const n = parseFloat(el.value)
    return Number.isFinite(n) ? n : fallback
  }
  const readPos = () => ({
    x: clampNum(numOf(xEl, 0), -POSITION_MAX, POSITION_MAX),
    y: clampNum(numOf(yEl, 0), -POSITION_MAX, POSITION_MAX)
  })

  function read(): ClipTransform {
    const cur = normalizeTransform(ref.current!.transform, TEXT_SCALE_BOUNDS)
    const { x, y } = readPos()
    if (uniform.checked) {
      const s = clampNum(numOf(pct, 100) / 100, 0, TEXT_SCALE_BOUNDS.max)
      return normalizeTransform(
        { ...cur, uniform: true, scale: s, scaleX: s, scaleY: s, x, y, rotation: numOf(rotEl, 0) },
        TEXT_SCALE_BOUNDS
      )
    }
    return normalizeTransform(
      {
        ...cur,
        uniform: false,
        scale: cur.scale,
        scaleX: clampNum(numOf(scaleXEl, 100) / 100, 0, TEXT_SCALE_BOUNDS.max),
        scaleY: clampNum(numOf(scaleYEl, 100) / 100, 0, TEXT_SCALE_BOUNDS.max),
        x,
        y,
        rotation: numOf(rotEl, 0)
      },
      TEXT_SCALE_BOUNDS
    )
  }
  const liveT = () => {
    const tr = read()
    ref.current!.transform = tr
    ctx.callbacks.onTransformLive?.(tr, TEXT_SCALE_BOUNDS)
  }
  const commitT = () => {
    const tr = read()
    ref.current!.transform = tr
    ctx.callbacks.onTransformCommit?.(tr, TEXT_SCALE_BOUNDS)
  }

  /** 位置六按钮激活态：面板侧只能确定水平 / 垂直居中（0,0） */
  function markAlign(tr: ClipTransform) {
    root.querySelectorAll<HTMLButtonElement>('button[data-f="p-align"]').forEach(b => {
      b.classList.toggle(
        'is-on',
        (b.dataset.id === 'h-center' && Math.abs(tr.x) < 2) ||
          (b.dataset.id === 'v-middle' && Math.abs(tr.y) < 2)
      )
    })
  }

  function write(t0: ClipTransform | null | undefined) {
    const tr = normalizeTransform(t0, TEXT_SCALE_BOUNDS)
    uniform.checked = tr.uniform
    uniformRow.hidden = !tr.uniform
    axisXRow.hidden = tr.uniform
    axisYRow.hidden = tr.uniform
    if (!isFocused(range)) range.value = String(Math.round(pctToRail(tr.scale * 100)))
    if (!isFocused(rangeX)) rangeX.value = String(Math.round(pctToRail(tr.scaleX * 100)))
    if (!isFocused(rangeY)) rangeY.value = String(Math.round(pctToRail(tr.scaleY * 100)))
    if (!isFocused(pct)) writeUnitValue(pct, Math.round(tr.scale * 100))
    if (!isFocused(scaleXEl)) writeUnitValue(scaleXEl, Math.round(tr.scaleX * 100))
    if (!isFocused(scaleYEl)) writeUnitValue(scaleYEl, Math.round(tr.scaleY * 100))
    if (!isFocused(xEl)) writeUnitValue(xEl, Math.round(tr.x))
    if (!isFocused(yEl)) writeUnitValue(yEl, Math.round(tr.y))
    if (!isFocused(rotEl)) writeUnitValue(rotEl, Math.round(tr.rotation * 100) / 100)
    dialNeed.style.transform = `rotate(${tr.rotation}deg)`
    markAlign(tr)
  }

  /** 滑杆 ↔ 百分比文本框（0% – 500%，100% 居中的非线性轨道） */
  const linkScale = (r: HTMLInputElement, numEl: HTMLInputElement) => {
    r.addEventListener('input', () => {
      writeUnitValue(numEl, railToPct(Number(r.value)))
      liveT()
    })
    r.addEventListener('change', () => {
      writeUnitValue(numEl, railToPct(Number(r.value)))
      commitT()
    })
    numEl.addEventListener('input', () => {
      r.value = String(Math.round(pctToRail(clampNum(numOf(numEl, 0), 0, 500))))
      liveT()
    })
    numEl.addEventListener('change', () => {
      const q = clampNum(numOf(numEl, 0), 0, 500)
      writeUnitValue(numEl, Math.round(q))
      r.value = String(Math.round(pctToRail(q)))
      commitT()
    })
    numEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') numEl.blur()
    })
  }
  linkScale(range, pct)
  linkScale(rangeX, scaleXEl)
  linkScale(rangeY, scaleYEl)

  // 位置 X / Y：输入实时上屏，失焦 / 回车规整为整数并提交
  for (const el of [xEl, yEl]) {
    el.addEventListener('input', liveT)
    el.addEventListener('change', () => {
      const { x, y } = readPos()
      writeUnitValue(xEl, x)
      writeUnitValue(yEl, y)
      commitT()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur()
    })
  }
  // 平面旋转：允许小数（如 12.5°），失焦 / 回车保留两位小数并提交
  rotEl.addEventListener('input', liveT)
  rotEl.addEventListener('change', () => {
    const r = numOf(rotEl, 0)
    writeUnitValue(rotEl, Math.round(r * 100) / 100)
    commitT()
  })
  rotEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') rotEl.blur()
  })
  uniform.addEventListener('change', () => {
    const cur = normalizeTransform(ref.current!.transform, TEXT_SCALE_BOUNDS)
    const next = uniform.checked
      ? withUniformEnabled(cur, TEXT_SCALE_BOUNDS)
      : withUniformDisabled(cur, TEXT_SCALE_BOUNDS)
    ref.current!.transform = next
    write(next)
    ctx.callbacks.onTransformLive?.(next, TEXT_SCALE_BOUNDS)
    ctx.callbacks.onTransformCommit?.(next, TEXT_SCALE_BOUNDS)
  })
  // 翻转按钮（水平 / 垂直）：toggle
  root.querySelectorAll<HTMLButtonElement>('.ed-flip-btn').forEach(b => {
    b.addEventListener('click', () => {
      const axis = b.dataset.flip as 'h' | 'v'
      const cur = normalizeTransform(ref.current!.transform, TEXT_SCALE_BOUNDS)
      const next = normalizeTransform({
        ...cur,
        flipH: axis === 'h' ? !cur.flipH : cur.flipH,
        flipV: axis === 'v' ? !cur.flipV : cur.flipV
      }, TEXT_SCALE_BOUNDS)
      ref.current!.transform = next
      b.classList.toggle('is-on', axis === 'h' ? !!next.flipH : !!next.flipV)
      ctx.callbacks.onTransformLive?.(next, TEXT_SCALE_BOUNDS)
      ctx.callbacks.onTransformCommit?.(next, TEXT_SCALE_BOUNDS)
    })
  })
  resetBtn.addEventListener('click', () => {
    const next = resetTransform()
    ref.current!.transform = next
    write(next)
    ctx.callbacks.onTransformLive?.(next, TEXT_SCALE_BOUNDS)
    ctx.callbacks.onTransformCommit?.(next, TEXT_SCALE_BOUNDS)
  })

  // 拨盘
  let dialing = false
  const dialAngle = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect()
    return (
      (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) /
        Math.PI +
      90
    )
  }
  dial.addEventListener('pointerdown', e => {
    dialing = true
    dial.setPointerCapture(e.pointerId)
    const start = normalizeTransform(ref.current!.transform, TEXT_SCALE_BOUNDS).rotation
    const a0 = dialAngle(e)
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      if (!dialing) return
      const tr = normalizeTransform(
        { ...ref.current!.transform, rotation: start + (dialAngle(ev) - a0) },
        TEXT_SCALE_BOUNDS
      )
      ref.current!.transform = tr
      write(tr)
      ctx.callbacks.onTransformLive?.(tr, TEXT_SCALE_BOUNDS)
    }
    const up = () => {
      dialing = false
      dial.removeEventListener('pointermove', move)
      dial.removeEventListener('pointerup', up)
      dial.removeEventListener('pointercancel', up)
      commitT()
    }
    dial.addEventListener('pointermove', move)
    dial.addEventListener('pointerup', up)
    dial.addEventListener('pointercancel', up)
  })

  // 位置六按钮：单轴对齐（左 / 水平居中 / 右只改 x；顶 / 垂直居中 / 底只改 y）
  root.querySelectorAll<HTMLButtonElement>('button[data-f="p-align"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = (btn.dataset.h as TextAlign | undefined) ?? null
      const v = (btn.dataset.v as TextVAlign | undefined) ?? null
      ctx.callbacks.onClipAlign?.(h, v)
    })
  })

  write(ref.current!.transform)
}

/**
 * 播放器操作框高频回显 / 同片段重同步：轻量刷新位置设置控件值。
 * 调用方需保证 root 为文字面板根；返回 false 表示根节点不存在（应整体重绘）。
 */
export function syncTextPositionValues(
  host: HTMLElement,
  root: ParentNode,
  t0: ClipTransform
): void {
  const doc = host.ownerDocument
  const active = doc.activeElement
  const input = (f: string): HTMLInputElement | null =>
    root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
  const setRail = (f: string, v: number) => {
    const el = input(f)
    if (el && el !== active) el.value = String(Math.round(pctToRail(Math.round(v * 100))))
  }
  const setUnit = (f: string, v: number) => {
    const el = input(f)
    if (el && el !== active) writeUnitValue(el, v)
  }
  const t = normalizeTransform(t0, TEXT_SCALE_BOUNDS)
  setRail('p-range', t.scale)
  setRail('p-rangeX', t.scaleX)
  setRail('p-rangeY', t.scaleY)
  setUnit('p-pct', Math.round(t.scale * 100))
  setUnit('p-scaleX', Math.round(t.scaleX * 100))
  setUnit('p-scaleY', Math.round(t.scaleY * 100))
  setUnit('p-x', Math.round(t.x))
  setUnit('p-y', Math.round(t.y))
  setUnit('p-rot', Math.round(t.rotation * 100) / 100)
  const uniform = input('p-uniform')
  if (uniform) uniform.checked = t.uniform
  const uRow = root.querySelector('[data-f="p-uniformRow"]') as HTMLElement | null
  if (uRow) uRow.hidden = !t.uniform
  const axRow = root.querySelector('[data-f="p-axisX"]') as HTMLElement | null
  if (axRow) axRow.hidden = t.uniform
  const ayRow = root.querySelector('[data-f="p-axisY"]') as HTMLElement | null
  if (ayRow) ayRow.hidden = t.uniform
  // 翻转按钮激活态
  root.querySelectorAll<HTMLButtonElement>('.ed-flip-btn').forEach(b => {
    const on = (b.dataset.flip === 'h' ? !!t.flipH : !!t.flipV)
    b.classList.toggle('is-on', on)
  })
  // 位置六按钮激活态（仅水平 / 垂直居中可由数据判定）
  root.querySelectorAll<HTMLButtonElement>('button[data-f="p-align"]').forEach(b => {
    b.classList.toggle(
      'is-on',
      (b.dataset.id === 'h-center' && Math.abs(t.x) < 2) ||
        (b.dataset.id === 'v-middle' && Math.abs(t.y) < 2)
    )
  })
  const needle = root.querySelector('.ed-pic-dial-need') as HTMLElement | null
  if (needle) needle.style.transform = `rotate(${t.rotation}deg)`
}
