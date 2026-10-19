/* ============================================================
 *  编辑器框架 · 右侧详情 · ② 画面视图（选中视频 / 图片 / 贴纸）
 *
 *  视觉与文字面板 sections 组件完全同款（ed-tsec 段头 / ed-tr 行 /
 *  长滑杆 + 单位一体数值框 + 上下微调 / iOS 开关 / 拨盘）：
 *    · 位置大小（缩放·等比 / 位置 XY / 平面旋转 / 翻转）
 *    · 混合（模式 select + 不透明度）
 *    · 音量控制（仅「视频且真实含音轨」时渲染，复用 sections/audioVolume）
 *  最后只读展示时长裁剪信息。
 *  播放器操作框高频回显走 syncPictureTransform：只刷控件值、
 *  不重建 DOM、不抢焦点。
 * ============================================================ */
import type { ClipTransform } from '../../types'
import {
  POSITION_MAX,
  SCALE_MAX,
  SCALE_MIN,
  normalizeTransform,
  resetTransform,
  withUniformDisabled,
  withUniformEnabled
} from '../../transform'
import { flipIcon } from '../../utils/icons'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  renderAudioVolume,
  bindAudioVolume,
  syncAudioVolume
} from '../sections/audioVolume'
import { RESET_SVG, bindSpinButtons, unitNum, writeUnitValue } from '../sections/shared'

/** 「位置大小」组 HTML（样式同文字 · 位置设置组；无九宫格对齐） */
function positionGroupHTML(sel: DetailSelection): string {
  const tr = normalizeTransform(sel.transform)
  const scaleMin = Math.round(SCALE_MIN * 100)
  const scaleMax = Math.round(SCALE_MAX * 100)
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span>位置大小</span>
        <button type="button" class="ed-tsec-reset" data-f="picPosReset"
          title="重置" aria-label="重置位置大小">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body">
        <div class="ed-tr" data-f="picUniformRow">
          <span class="ed-tr-k">缩放</span>
          <input type="range" class="ed-pic-range" data-f="scaleRange"
            min="${scaleMin}" max="${scaleMax}" step="1"
            value="${Math.round(tr.scale * 100)}">
          ${unitNum('scalePct', {
            min: scaleMin, max: scaleMax, step: 1, suffix: '%',
            value: `${Math.round(tr.scale * 100)}%`
          })}
        </div>
        <div class="ed-tr" data-f="picAxisX" hidden>
          <span class="ed-tr-k">缩放宽度</span>
          <input type="range" class="ed-pic-range" data-f="scaleXRange"
            min="${scaleMin}" max="${scaleMax}" step="1"
            value="${Math.round(tr.scaleX * 100)}">
          ${unitNum('scaleXPct', {
            min: scaleMin, max: scaleMax, step: 1, suffix: '%',
            value: `${Math.round(tr.scaleX * 100)}%`
          })}
        </div>
        <div class="ed-tr" data-f="picAxisY" hidden>
          <span class="ed-tr-k">缩放高度</span>
          <input type="range" class="ed-pic-range" data-f="scaleYRange"
            min="${scaleMin}" max="${scaleMax}" step="1"
            value="${Math.round(tr.scaleY * 100)}">
          ${unitNum('scaleYPct', {
            min: scaleMin, max: scaleMax, step: 1, suffix: '%',
            value: `${Math.round(tr.scaleY * 100)}%`
          })}
        </div>
        <div class="ed-tr ed-tr-switch">
          <span class="ed-tr-k">等比缩放</span>
          <label class="ed-switch">
            <input type="checkbox" data-f="uniform"${tr.uniform ? ' checked' : ''}><i></i>
          </label>
        </div>
        <div class="ed-tr ed-tr-pos">
          <span class="ed-tr-k">位置</span>
          ${unitNum('x', {
            min: -POSITION_MAX, max: POSITION_MAX, step: 1, tag: 'X',
            value: String(Math.round(tr.x))
          })}
          ${unitNum('y', {
            min: -POSITION_MAX, max: POSITION_MAX, step: 1, tag: 'Y',
            value: String(Math.round(tr.y))
          })}
        </div>
        <div class="ed-tr ed-tr-rot">
          <span class="ed-tr-k">平面旋转</span>
          ${unitNum('rotation', {
            min: -36000, max: 36000, step: 1, suffix: '°', prec: 2,
            value: `${(Math.round(tr.rotation * 100) / 100).toFixed(2)}°`
          })}
          <span class="ed-pic-dial" data-f="dial" title="按住圆环拖动旋转"><i class="ed-pic-dial-need"></i></span>
        </div>
        <div class="ed-tr ed-tr-flip">
          <span class="ed-tr-k">翻转</span>
          <button type="button" class="ed-flip-btn${sel.transform?.flipH ? ' is-on' : ''}"
            data-flip="h" title="水平翻转">${flipIcon('h')}</button>
          <button type="button" class="ed-flip-btn${sel.transform?.flipV ? ' is-on' : ''}"
            data-flip="v" title="垂直翻转">${flipIcon('v')}</button>
        </div>
      </div>
    </section>`
}

/** 「混合」组 HTML（仅整体不透明度；无混合模式） */
function blendGroupHTML(sel: DetailSelection, opacityPct: number): string {
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-head">
        <span>混合</span>
        <button type="button" class="ed-tsec-reset" data-f="blendReset"
          title="重置" aria-label="重置不透明度">${RESET_SVG}</button>
      </div>
      <div class="ed-tsec-body">
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">不透明度</span>
          <input type="range" class="ed-pic-range" data-f="opRange" min="0" max="100" step="1"
            value="${opacityPct}">
          ${unitNum('opPct', {
            min: 0, max: 100, step: 1, suffix: '%',
            value: `${opacityPct}%`
          })}
        </div>
      </div>
    </section>`
}

/** 画面属性面板 HTML */
export function renderPicture(sel: DetailSelection, ctx: DetailViewCtx): string {
  const opacityPct = Math.round((sel.opacity ?? 1) * 100)
  const audioGroup = sel.audio
    ? renderAudioVolume(sel.audio, { prefix: 'p', id: sel.id })
    : ''
  return `
    <div class="ed-pic ed-text-pane">
      ${positionGroupHTML(sel)}
      ${blendGroupHTML(sel, opacityPct)}
      ${audioGroup}
    </div>`
}

/** 绑定「画面」面板控件（DOM 重建后调用一次） */
export function bindPicture(host: HTMLElement, ref: DetailSelectionRef, ctx: DetailViewCtx): void {
  const root = host.querySelector('.ed-pic') as HTMLElement | null
  if (!root) return
  const { clampNum } = ctx
  const $ = <T extends HTMLElement>(f: string): T => root.querySelector<T>(`[data-f="${f}"]`)!
  const scaleMin = Math.round(SCALE_MIN * 100)
  const scaleMax = Math.round(SCALE_MAX * 100)

  const scaleRange = $<HTMLInputElement>('scaleRange')
  const scalePct = $<HTMLInputElement>('scalePct')
  const scaleXRange = $<HTMLInputElement>('scaleXRange')
  const scaleXPct = $<HTMLInputElement>('scaleXPct')
  const scaleYRange = $<HTMLInputElement>('scaleYRange')
  const scaleYPct = $<HTMLInputElement>('scaleYPct')
  const uniform = $<HTMLInputElement>('uniform')
  const xEl = $<HTMLInputElement>('x')
  const yEl = $<HTMLInputElement>('y')
  const rotEl = $<HTMLInputElement>('rotation')
  const opRange = $<HTMLInputElement>('opRange')
  const opPct = $<HTMLInputElement>('opPct')
  const uniformRow = $<HTMLElement>('picUniformRow')
  const axisXRow = $<HTMLElement>('picAxisX')
  const axisYRow = $<HTMLElement>('picAxisY')
  const dial = $<HTMLElement>('dial')
  const dialNeed = dial.querySelector('.ed-pic-dial-need') as HTMLElement
  const posResetBtn = $<HTMLButtonElement>('picPosReset')
  const blendResetBtn = $<HTMLButtonElement>('blendReset')

  const isFocused = (el: Element | null) => el === host.ownerDocument.activeElement
  /** 单位一体文本框读值：parseFloat 兼容「100%」「0.00°」 */
  const numOf = (el: HTMLInputElement, fallback: number) => {
    const n = parseFloat(el.value)
    return Number.isFinite(n) ? n : fallback
  }

  /** 从控件读回一个归一化 transform（含翻转最新值） */
  function read(): ClipTransform {
    const cur = normalizeTransform(ref.current!.transform)
    const u = uniform.checked
    if (u) {
      const s = clampNum(numOf(scalePct, 100), scaleMin, scaleMax) / 100
      return normalizeTransform({
        ...cur, uniform: true, scale: s, scaleX: s, scaleY: s,
        x: clampNum(numOf(xEl, 0), -POSITION_MAX, POSITION_MAX),
        y: clampNum(numOf(yEl, 0), -POSITION_MAX, POSITION_MAX),
        rotation: numOf(rotEl, 0)
      })
    }
    return normalizeTransform({
      ...cur, uniform: false,
      scale: cur.scale,
      scaleX: clampNum(numOf(scaleXPct, 100), scaleMin, scaleMax) / 100,
      scaleY: clampNum(numOf(scaleYPct, 100), scaleMin, scaleMax) / 100,
      x: clampNum(numOf(xEl, 0), -POSITION_MAX, POSITION_MAX),
      y: clampNum(numOf(yEl, 0), -POSITION_MAX, POSITION_MAX),
      rotation: numOf(rotEl, 0)
    })
  }

  const live = () => {
    const t = read()
    ref.current!.transform = t
    ctx.callbacks.onTransformLive?.(t)
  }
  const commit = () => {
    const t = read()
    ref.current!.transform = t
    ctx.callbacks.onTransformCommit?.(t)
  }

  /** 写控件值（外部回灌；正在输入的控件不打断） */
  function write(t0: ClipTransform | null | undefined) {
    const t = normalizeTransform(t0)
    uniform.checked = t.uniform
    // 等比：只显示主缩放行；非等比：主行禁用、显示宽 / 高两行
    uniformRow.hidden = false
    axisXRow.hidden = t.uniform
    axisYRow.hidden = t.uniform
    scaleRange.disabled = !t.uniform
    scalePct.disabled = !t.uniform
    if (!isFocused(scaleRange)) scaleRange.value = String(Math.round(t.scale * 100))
    if (!isFocused(scalePct)) writeUnitValue(scalePct, Math.round(t.scale * 100))
    if (!isFocused(scaleXRange)) scaleXRange.value = String(Math.round(t.scaleX * 100))
    if (!isFocused(scaleXPct)) writeUnitValue(scaleXPct, Math.round(t.scaleX * 100))
    if (!isFocused(scaleYRange)) scaleYRange.value = String(Math.round(t.scaleY * 100))
    if (!isFocused(scaleYPct)) writeUnitValue(scaleYPct, Math.round(t.scaleY * 100))
    if (!isFocused(xEl)) writeUnitValue(xEl, Math.round(t.x))
    if (!isFocused(yEl)) writeUnitValue(yEl, Math.round(t.y))
    if (!isFocused(rotEl)) writeUnitValue(rotEl, Math.round(t.rotation * 100) / 100)
    dialNeed.style.transform = `rotate(${t.rotation}deg)`
  }

  /** 滑杆 ↔ 单位数值框成对绑定：input 实时、change 入栈 */
  const linkScale = (r: HTMLInputElement, numEl: HTMLInputElement) => {
    r.addEventListener('input', () => {
      writeUnitValue(numEl, Number(r.value))
      live()
    })
    r.addEventListener('change', () => {
      writeUnitValue(numEl, Number(r.value))
      commit()
    })
    numEl.addEventListener('input', () => {
      r.value = String(clampNum(numOf(numEl, 0), scaleMin, scaleMax))
      live()
    })
    numEl.addEventListener('change', () => {
      const q = clampNum(numOf(numEl, 0), scaleMin, scaleMax)
      writeUnitValue(numEl, Math.round(q))
      r.value = String(Math.round(q))
      commit()
    })
    numEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') numEl.blur()
    })
  }
  linkScale(scaleRange, scalePct)
  linkScale(scaleXRange, scaleXPct)
  linkScale(scaleYRange, scaleYPct)

  // 位置 X / Y：输入实时上屏，失焦 / 回车规整为整数并提交
  for (const el of [xEl, yEl]) {
    el.addEventListener('input', live)
    el.addEventListener('change', () => {
      writeUnitValue(xEl, clampNum(numOf(xEl, 0), -POSITION_MAX, POSITION_MAX))
      writeUnitValue(yEl, clampNum(numOf(yEl, 0), -POSITION_MAX, POSITION_MAX))
      commit()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur()
    })
  }
  // 平面旋转：失焦 / 回车保留两位小数并提交
  rotEl.addEventListener('input', live)
  rotEl.addEventListener('change', () => {
    writeUnitValue(rotEl, Math.round(numOf(rotEl, 0) * 100) / 100)
    commit()
  })
  rotEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') rotEl.blur()
  })

  // 等比开关：以当前 transform（含真实 sx/sy、scale）为基准切换
  uniform.addEventListener('change', () => {
    const cur = normalizeTransform(ref.current!.transform)
    const next = uniform.checked ? withUniformEnabled(cur) : withUniformDisabled(cur)
    ref.current!.transform = next
    write(next)
    ctx.callbacks.onTransformLive?.(next)
    ctx.callbacks.onTransformCommit?.(next)
  })

  // 翻转按钮（水平 / 垂直）
  const flipBtns = root.querySelectorAll<HTMLButtonElement>('.ed-flip-btn')
  flipBtns.forEach(b => {
    b.addEventListener('click', () => {
      const axis = b.dataset.flip as 'h' | 'v'
      const cur = normalizeTransform(ref.current!.transform)
      const next = normalizeTransform({
        ...cur,
        flipH: axis === 'h' ? !cur.flipH : cur.flipH,
        flipV: axis === 'v' ? !cur.flipV : cur.flipV
      })
      ref.current!.transform = next
      flipBtns.forEach(bb =>
        bb.classList.toggle('is-on', bb.dataset.flip === 'h' ? !!next.flipH : !!next.flipV)
      )
      ctx.callbacks.onTransformLive?.(next)
      ctx.callbacks.onTransformCommit?.(next)
    })
  })

  // 位置大小重置：几何归位
  posResetBtn.addEventListener('click', () => {
    const next = normalizeTransform(resetTransform())
    ref.current!.transform = next
    write(next)
    ctx.callbacks.onTransformLive?.(next)
    ctx.callbacks.onTransformCommit?.(next)
  })

  // 混合段重置：不透明度回 100%
  blendResetBtn.addEventListener('click', () => {
    opRange.value = '100'
    writeUnitValue(opPct, 100)
    ref.current!.opacity = 1
    ctx.callbacks.onOpacityLive?.(1)
    ctx.callbacks.onOpacityCommit?.(1)
  })

  // 不透明度：滑杆 ↔ 单位框镜像，拖动实时上屏，松手 / 失焦提交
  const opCommit = () => {
    const pct = clampNum(numOf(opPct, 100), 0, 100)
    writeUnitValue(opPct, Math.round(pct))
    opRange.value = String(Math.round(pct))
    ref.current!.opacity = pct / 100
    ctx.callbacks.onOpacityCommit?.(pct / 100)
  }
  opRange.addEventListener('input', () => {
    writeUnitValue(opPct, Number(opRange.value))
    ref.current!.opacity = Number(opRange.value) / 100
    ctx.callbacks.onOpacityLive?.(Number(opRange.value) / 100)
  })
  opRange.addEventListener('change', opCommit)
  opPct.addEventListener('input', () => {
    opRange.value = String(clampNum(numOf(opPct, 100), 0, 100))
    ref.current!.opacity = clampNum(numOf(opPct, 100), 0, 100) / 100
    ctx.callbacks.onOpacityLive?.(clampNum(numOf(opPct, 100), 0, 100) / 100)
  })
  opPct.addEventListener('change', opCommit)
  opPct.addEventListener('keydown', e => {
    if (e.key === 'Enter') opPct.blur()
  })

  // 视频内嵌音轨音量控制（仅真实含音轨的视频渲染了该组）
  bindAudioVolume(root, ref, ctx, { prefix: 'p', id: ref.current!.id })

  // 拨盘：按住圆环拖动
  let dialing = false
  const dialAngle = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // 向上为 0°，顺时针
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
  }
  dial.addEventListener('pointerdown', e => {
    dialing = true
    dial.setPointerCapture(e.pointerId)
    const start = normalizeTransform(ref.current!.transform).rotation
    const a0 = dialAngle(e)
    e.preventDefault()

    const move = (ev: PointerEvent) => {
      if (!dialing) return
      const t = normalizeTransform({ ...ref.current!.transform, rotation: start + (dialAngle(ev) - a0) })
      ref.current!.transform = t
      write(t)
      ctx.callbacks.onTransformLive?.(t)
    }
    const up = () => {
      dialing = false
      dial.removeEventListener('pointermove', move)
      dial.removeEventListener('pointerup', up)
      dial.removeEventListener('pointercancel', up)
      commit()
    }
    dial.addEventListener('pointermove', move)
    dial.addEventListener('pointerup', up)
    dial.addEventListener('pointercancel', up)
  })

  // 全部单位框的上下微调按钮（按住连续步进；input 走 live、松手 change 入栈）
  bindSpinButtons(root, clampNum)

  write(ref.current!.transform)
}

/**
 * 播放器操作框高频回显：轻量刷新变换控件值（不重建 DOM、不抢焦点）。
 * 返回 false 表示画面根节点不存在（调用方应整体重绘）。
 */
export function syncPictureTransform(host: HTMLElement, t0: ClipTransform): boolean {
  const root = host.querySelector('.ed-pic')
  if (!root) return false
  const doc = host.ownerDocument
  const active = doc.activeElement
  const setVal = (f: string, v: string) => {
    const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
    if (el && el !== active) el.value = v
  }
  const setUnit = (f: string, v: number) => {
    const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
    if (el && el !== active) writeUnitValue(el, v)
  }
  const t = normalizeTransform(t0)
  setVal('scaleRange', String(Math.round(t.scale * 100)))
  setUnit('scalePct', Math.round(t.scale * 100))
  setVal('scaleXRange', String(Math.round(t.scaleX * 100)))
  setUnit('scaleXPct', Math.round(t.scaleX * 100))
  setVal('scaleYRange', String(Math.round(t.scaleY * 100)))
  setUnit('scaleYPct', Math.round(t.scaleY * 100))
  setUnit('x', Math.round(t.x))
  setUnit('y', Math.round(t.y))
  setUnit('rotation', Math.round(t.rotation * 100) / 100)
  const uniform = root.querySelector<HTMLInputElement>('[data-f="uniform"]')
  if (uniform) {
    uniform.checked = t.uniform
    const sr = root.querySelector<HTMLInputElement>('[data-f="scaleRange"]')
    const sp = root.querySelector<HTMLInputElement>('[data-f="scalePct"]')
    if (sr) sr.disabled = !t.uniform
    if (sp) sp.disabled = !t.uniform
    const uRow = root.querySelector('[data-f="picUniformRow"]') as HTMLElement | null
    if (uRow) uRow.hidden = false
    const axRow = root.querySelector('[data-f="picAxisX"]') as HTMLElement | null
    const ayRow = root.querySelector('[data-f="picAxisY"]') as HTMLElement | null
    if (axRow) axRow.hidden = t.uniform
    if (ayRow) ayRow.hidden = t.uniform
  }
  const needle = root.querySelector('.ed-pic-dial-need') as HTMLElement | null
  if (needle) needle.style.transform = `rotate(${t.rotation}deg)`
  // 翻转按钮回灌
  root.querySelectorAll<HTMLButtonElement>('.ed-flip-btn').forEach(b => {
    b.classList.toggle('is-on', b.dataset.flip === 'h' ? !!t.flipH : !!t.flipV)
  })
  return true
}

/**
 * 同片段重复同步（撤销 / setTracks / 轨道手势 live 回显）时回灌不透明度与
 * 视频音量控制组：不重建 DOM、不抢焦点（正在编辑的控件跳过）。
 */
export function syncPictureValues(
  host: HTMLElement,
  sel: DetailSelection,
  active: Element | null,
  ctx: DetailViewCtx
): void {
  const root = host.querySelector('.ed-pic')
  if (!root) return
  if (sel.opacity !== undefined) {
    const pct = Math.round(ctx.clampNum(sel.opacity, 0, 1) * 100)
    const r = root.querySelector<HTMLInputElement>('[data-f="opRange"]')
    const n = root.querySelector<HTMLInputElement>('[data-f="opPct"]')
    if (r && r !== active) r.value = String(pct)
    if (n && n !== active) writeUnitValue(n, pct)
  }
  // 视频内嵌音轨音量控制组（无音轨时该组不存在，内部空操作）
  if (sel.audio) syncAudioVolume(root, sel, active, { prefix: 'p' })
}
