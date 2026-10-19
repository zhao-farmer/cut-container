/* ============================================================
 *  文字选项组 · ① 字体设置（无段头）
 *  字体（含用户上传）/ 字号 / 样式 BUI / 颜色 / 字间距·行间距 / 六态对齐
 * ============================================================ */
import type { TextAlign, TextVAlign } from '../../types'
import { UPLOAD_ICON } from '../../utils/icons'
import { addCustomFont, listCustomFonts } from '../../utils/customFonts'
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  ALIGN6,
  FONT_OPTIONS,
  align6Of,
  align6Svg,
  bindColorControl,
  colorRowHtml,
  spinCtl,
  spinNum,
  unitNum,
  writeUnitValue,
  type TextPatch
} from './shared'

/** 字体设置组 HTML */
export function renderTextFont(sel: DetailSelection, ctx: DetailViewCtx): string {
  const t = sel.text!
  // 用户上传的字体排在最前（新的在前），其后是内置系统字体
  const fontList = [
    ...listCustomFonts().map(f => ({ value: f.family, label: f.name })),
    ...FONT_OPTIONS
  ]
  const fontOptions = fontList.map(
    f =>
      `<option value="${ctx.escapeHtml(f.value)}"${f.value === t.fontFamily ? ' selected' : ''}
        style="font-family:${f.value ? `'${ctx.escapeHtml(f.value)}', sans-serif` : 'sans-serif'}">${ctx.escapeHtml(f.label)}</option>`
  ).join('')
  const curA6 = align6Of(t)
  const alignBtns = ALIGN6.map(
    (o, i) =>
      `${i === 3 ? '<i class="ed-align-sep" aria-hidden="true"></i>' : ''}
      <button type="button" class="ed-seg-btn${curA6 === o.v ? ' is-on' : ''}"
        data-f="t-align" data-v="${o.v}" title="${o.title}">${align6Svg(o.v)}</button>`
  ).join('')
  return `
    <section class="ed-tsec">
      <div class="ed-tsec-body">
        <div class="ed-tr">
          <span class="ed-tr-k">字体</span>
          <select class="ed-input ed-select ed-font-select" data-f="t-font">${fontOptions}</select>
          ${spinCtl('t-font')}
          <button type="button" class="ed-font-upload" data-f="t-font-upload"
            title="上传字体（ttf / otf / woff / woff2）" aria-label="上传字体">${UPLOAD_ICON}</button>
        </div>
        <div class="ed-font-tip" data-role="font-tip" hidden></div>
        <div class="ed-tr ed-tr-unit">
          <span class="ed-tr-k">字号</span>
          <input type="range" class="ed-pic-range" data-f="t-size" min="1" max="300" step="1">
          ${unitNum('t-sizeN', {
            min: 1, max: 300, step: 1,
            value: String(Math.round(t.fontSize))
          })}
        </div>
        <div class="ed-tr">
          <span class="ed-tr-k">样式</span>
          <span class="ed-bui">
            <button type="button" class="ed-bui-btn${t.bold ? ' is-on' : ''}" data-f="t-bold" title="加粗">B</button>
            <button type="button" class="ed-bui-btn u${t.underline ? ' is-on' : ''}" data-f="t-under" title="下划线">U</button>
            <button type="button" class="ed-bui-btn i${t.italic ? ' is-on' : ''}" data-f="t-italic" title="斜体">I</button>
          </span>
        </div>
        <div class="ed-tr">
          <span class="ed-tr-k">颜色</span>
          ${colorRowHtml('t-color', 't-colorHex', t.color)}
        </div>
        <div class="ed-tr">
          <span class="ed-tr-k">字间距</span>
          ${spinNum('t-ls', 'min="-200" max="500" step="1"')}
          <span class="ed-tr-k ed-tr-k2">行间距</span>
          ${spinNum('t-lh', 'min="-200" max="500" step="1"')}
        </div>
        <div class="ed-tr ed-tr-align">
          <span class="ed-tr-k">对齐方式</span>
          <span class="ed-align6" role="group" aria-label="对齐方式">${alignBtns}</span>
        </div>
      </div>
    </section>`
}

/** 绑定字体设置组 */
export function bindTextFont(
  host: HTMLElement,
  root: HTMLElement,
  ref: DetailSelectionRef,
  ctx: DetailViewCtx
): void {
  const t = () => ref.current!.text!
  const { clampNum } = ctx
  const live = (patch: TextPatch) => ctx.callbacks.onTextLive?.(patch)
  const commit = () => ctx.callbacks.onTextCommit?.()

  // 字体：上下微调步进 / 选择都只发 input（实时上屏），change 才入栈
  const fontEl = root.querySelector<HTMLSelectElement>('[data-f="t-font"]')!
  fontEl.addEventListener('input', () => {
    t().fontFamily = fontEl.value
    live({ fontFamily: fontEl.value })
  })
  fontEl.addEventListener('change', () => {
    t().fontFamily = fontEl.value
    live({ fontFamily: fontEl.value })
    commit()
  })

  // 字体上传：选择文件 → FontFace 注册 → 选项插到列表最前并立即应用
  const uploadBtn = root.querySelector<HTMLButtonElement>('[data-f="t-font-upload"]')
  const tipEl = root.querySelector<HTMLElement>('[data-role="font-tip"]')
  if (uploadBtn && tipEl) {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'
    fileInput.dataset.role = 'font-file'
    fileInput.style.display = 'none'
    uploadBtn.after(fileInput)

    let tipTimer = 0
    const showTip = (msg: string, error = false) => {
      tipEl.textContent = msg
      tipEl.hidden = false
      tipEl.classList.toggle('is-error', error)
      if (tipTimer) window.clearTimeout(tipTimer)
      tipTimer = window.setTimeout(() => {
        tipEl.hidden = true
        tipEl.classList.remove('is-error')
      }, 3200)
    }

    uploadBtn.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      fileInput.value = ''
      if (!file) return
      uploadBtn.classList.add('is-busy')
      uploadBtn.disabled = true
      try {
        const font = await addCustomFont(file)
        // 解析期间选中项可能已切换 / 面板已重绘：只更新仍挂载的字体下拉
        const tx = ref.current?.text
        if (tx && fontEl.isConnected) {
          let opt = fontEl.querySelector<HTMLOptionElement>(`option[value="${font.family}"]`)
          if (!opt) {
            opt = document.createElement('option')
            opt.value = font.family
            opt.textContent = font.name
            opt.style.fontFamily = `'${font.family}', sans-serif`
            fontEl.prepend(opt)
          }
          fontEl.value = font.family
          tx.fontFamily = font.family
          live({ fontFamily: font.family })
          commit()
        }
        showTip(`已添加字体：${font.name}`)
      } catch (e) {
        showTip(e instanceof Error ? e.message : '字体上传失败', true)
      } finally {
        uploadBtn.classList.remove('is-busy')
        uploadBtn.disabled = false
      }
    })
  }

  // 字号（滑杆 + 单位一体数值框）
  const sizeR = root.querySelector<HTMLInputElement>('[data-f="t-size"]')!
  const sizeN = root.querySelector<HTMLInputElement>('[data-f="t-sizeN"]')!
  writeUnitValue(sizeN, Math.round(t().fontSize))
  sizeR.value = String(Math.round(t().fontSize))
  const sizeLive = () => {
    const fs = clampNum(parseFloat(sizeN.value) || 1, 1, 300)
    t().fontSize = fs
    live({ fontSize: fs })
  }
  sizeR.addEventListener('input', () => {
    writeUnitValue(sizeN, Number(sizeR.value))
    sizeLive()
  })
  sizeR.addEventListener('change', () => {
    writeUnitValue(sizeN, Number(sizeR.value))
    sizeLive()
    commit()
  })
  sizeN.addEventListener('input', () => {
    sizeR.value = String(clampNum(parseFloat(sizeN.value) || 1, 1, 300))
    sizeLive()
  })
  sizeN.addEventListener('change', () => {
    const fs = clampNum(parseFloat(sizeN.value) || 1, 1, 300)
    writeUnitValue(sizeN, fs)
    sizeR.value = String(Math.round(fs))
    t().fontSize = fs
    live({ fontSize: fs })
    commit()
  })
  sizeN.addEventListener('keydown', e => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  })

  // 样式 B / U / I
  const bindToggle = (f: string, key: 'bold' | 'underline' | 'italic') => {
    const btn = root.querySelector<HTMLButtonElement>(`[data-f="${f}"]`)!
    btn.addEventListener('click', () => {
      const v = !t()[key]
      t()[key] = v
      btn.classList.toggle('is-on', v)
      live({ [key]: v } as TextPatch)
      commit()
    })
  }
  bindToggle('t-bold', 'bold')
  bindToggle('t-under', 'underline')
  bindToggle('t-italic', 'italic')

  // 颜色
  bindColorControl(root, 't-color', 't-colorHex', c => {
    t().color = c
    live({ color: c })
  }, commit)

  // 字 / 行间距
  const bindInt = (f: string, key: 'letterSpacing' | 'lineSpacing', min: number, max: number) => {
    const el = root.querySelector<HTMLInputElement>(`[data-f="${f}"]`)!
    el.value = String(Math.round(t()[key]))
    const onInput = () => {
      const v = clampNum(Number(el.value) || 0, min, max)
      t()[key] = v
      live({ [key]: v } as TextPatch)
    }
    el.addEventListener('input', onInput)
    el.addEventListener('change', () => {
      const v = clampNum(Number(el.value) || 0, min, max)
      el.value = String(Math.round(v))
      t()[key] = v
      live({ [key]: v } as TextPatch)
      commit()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    })
  }
  bindInt('t-ls', 'letterSpacing', -200, 500)
  bindInt('t-lh', 'lineSpacing', -200, 500)

  // 对齐方式（横排左 / 中 / 右 · 竖排上 / 中 / 下）
  root.querySelectorAll<HTMLButtonElement>('button[data-f="t-align"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [mode, v] = (btn.dataset.v || '').split('-')
      const vertical = mode === 'v'
      t().vertical = vertical
      const patch: TextPatch = vertical
        ? { vertical: true, valign: v as TextVAlign }
        : { vertical: false, align: v as TextAlign }
      if (vertical) t().valign = v as TextVAlign
      else t().align = v as TextAlign
      root
        .querySelectorAll<HTMLButtonElement>('button[data-f="t-align"]')
        .forEach(b => b.classList.toggle('is-on', b === btn))
      live(patch)
      commit()
    })
  })
}

/** 重同步：字体 / 字号 / 间距 / 颜色 / BUI / 六态激活 */
export function syncTextFont(root: ParentNode, sel: DetailSelection, active: Element | null): void {
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
  const fontEl = root.querySelector<HTMLSelectElement>('[data-f="t-font"]')
  if (fontEl && fontEl !== active) fontEl.value = tx.fontFamily
  setVal('t-size', String(Math.round(tx.fontSize)))
  setUnit('t-sizeN', Math.round(tx.fontSize))
  setVal('t-ls', String(Math.round(tx.letterSpacing)))
  setVal('t-lh', String(Math.round(tx.lineSpacing)))
  setVal('t-colorHex', tx.color)
  const tColor = root.querySelector<HTMLInputElement>('[data-f="t-color"]')
  if (tColor && tColor !== active) {
    tColor.value = /^#[0-9a-fA-F]{6}$/.test(tx.color) ? tx.color : '#ffffff'
  }
  const flagBtn = (f: string, on: boolean) => {
    root.querySelector<HTMLButtonElement>(`[data-f="${f}"]`)?.classList.toggle('is-on', on)
  }
  flagBtn('t-bold', tx.bold)
  flagBtn('t-under', tx.underline)
  flagBtn('t-italic', tx.italic)
  const a6 = align6Of(tx)
  root.querySelectorAll<HTMLButtonElement>('button[data-f="t-align"]').forEach(b =>
    b.classList.toggle('is-on', b.dataset.v === a6)
  )
}
