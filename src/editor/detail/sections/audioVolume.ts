/* ============================================================
 *  详情选项组 · 音量控制（音频片段页 / 视频内嵌音轨页共用）
 *
 *  三行：音量（-60dB ~ +20dB，-60 显示 -∞）/ 淡入时长 / 淡出时长。
 *  prefix:
 *    ''  → 独立音频片段页（data-f="volRange" 等）
 *    'p' → 画面页视频内嵌音轨（data-f="pVolRange" 等）
 *
 *  双向绑定：轨道手势 ↔ 面板控件实时联动。
 *  滑杆 input → onAudioLive（轻量回显），change → onAudioCommit（入栈落盘）；
 *  文本框 + spin + reset 走一次性 live+commit（离散编辑）。
 * ============================================================ */
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import { RESET_SVG, spinCtl } from './shared'

/** 淡入 / 淡出允许范围（秒） */
export const FADE_MAX = 10
/** 音量 dB 范围（内部 item.volume 存 linear 增益 0..10，对应 -60dB ~ 20dB） */
export const VOL_DB_MIN = -60
export const VOL_DB_MAX = 20
/** linear 阈值：≤0.001（≈-60dB）视为静音，面板显示 -∞ */
const VOL_MIN_LINEAR = 0.001

/** linear 增益 → dB 文本；≤阈值显示 "-∞" */
export function volToDbText(v: number): string {
  if (v <= VOL_MIN_LINEAR) return '-∞'
  const db = Math.max(VOL_DB_MIN, Math.min(VOL_DB_MAX, 20 * Math.log10(v)))
  return `${(Math.round(db * 10) / 10).toFixed(1)}dB`
}
/** linear 增益 → dB 数值（钳到 -60..20） */
export function volToDb(v: number): number {
  if (v <= VOL_MIN_LINEAR) return VOL_DB_MIN
  return Math.max(VOL_DB_MIN, Math.min(VOL_DB_MAX, 20 * Math.log10(v)))
}
/** dB 数值 → linear 增益（钳到 0..10） */
export function dbToVol(db: number): number {
  const d = Math.max(VOL_DB_MIN, Math.min(VOL_DB_MAX, db))
  return Math.pow(10, d / 20)
}
/** dB 文本 → dB 数值（兼容 "-∞"、纯数字、带 dB 后缀） */
export function dbTextToDb(text: string): number {
  const t = text.trim().toLowerCase()
  if (t === '-∞' || t === 'inf-' || t === '') return VOL_DB_MIN
  const m = t.match(/(-?\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Math.max(VOL_DB_MIN, Math.min(VOL_DB_MAX, parseFloat(m[1])))
}

/** 「dB / s」一体数值框 + 上下微调 */
function unitNum(
  f: string,
  o: { min: number; max: number; step: number; value: string; suffix: string }
): string {
  return `<span class="ed-tnum"><input type="text"
      class="ed-tnum-input" data-f="${f}" inputmode="decimal" autocomplete="off"
      data-min="${o.min}" data-max="${o.max}" data-step="${o.step}" data-suffix="${o.suffix}"
      value="${o.value}"></span>${spinCtl(f)}`
}

export interface AudioVolumeOptions {
  /** data-f 前缀：'' 独立音频页，'p' 画面页 */
  prefix: '' | 'p'
  /** 片段 id（写在 data-audio-group 上，便于定位） */
  id: string
  /** 顶部去内边距（独立音频页贴顶排布时使用） */
  flush?: boolean
}

/** 音量控制组 HTML */
export function renderAudioVolume(a: NonNullable<DetailSelection['audio']>, o: AudioVolumeOptions): string {
  const p = o.prefix
  const fadeText = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}s`
  const dbVal = volToDb(a.volume ?? 1)
  return `
      <div class="ed-tsec" data-audio-group="${o.id}"${o.flush ? ' style="padding-top:0"' : ''}>
        <div class="ed-tsec-head">
          <span class="ed-tsec-title">音量控制</span>
          <button type="button" class="ed-tsec-reset" data-reset="audio-basic" title="重置音量 / 淡入淡出" aria-label="重置音量控制">${RESET_SVG}</button>
        </div>
        <div class="ed-tsec-body">
          <div class="ed-tr ed-tr-unit">
            <span class="ed-tr-k">音量</span>
            <input type="range" class="ed-pic-range" data-f="${p}volRange"
              min="${VOL_DB_MIN}" max="${VOL_DB_MAX}" step="0.1"
              value="${dbVal.toFixed(1)}">
            ${unitNum(`${p}volDb`, {
              min: VOL_DB_MIN, max: VOL_DB_MAX, step: 0.1,
              value: volToDbText(a.volume ?? 1), suffix: 'dB'
            })}
          </div>
          <div class="ed-tr ed-tr-unit">
            <span class="ed-tr-k">淡入时长</span>
            <input type="range" class="ed-pic-range" data-f="${p}fadeInRange"
              min="0" max="${FADE_MAX}" step="0.1"
              value="${(Math.round(Math.min(FADE_MAX, a.fadeIn ?? 0) * 10) / 10).toFixed(1)}">
            ${unitNum(`${p}fadeIn`, {
              min: 0, max: FADE_MAX, step: 0.1,
              value: fadeText(a.fadeIn ?? 0), suffix: 's'
            })}
          </div>
          <div class="ed-tr ed-tr-unit">
            <span class="ed-tr-k">淡出时长</span>
            <input type="range" class="ed-pic-range" data-f="${p}fadeOutRange"
              min="0" max="${FADE_MAX}" step="0.1"
              value="${(Math.round(Math.min(FADE_MAX, a.fadeOut ?? 0) * 10) / 10).toFixed(1)}">
            ${unitNum(`${p}fadeOut`, {
              min: 0, max: FADE_MAX, step: 0.1,
              value: fadeText(a.fadeOut ?? 0), suffix: 's'
            })}
          </div>
        </div>
      </div>`
}

type AudioPatch = { volume?: number; fadeIn?: number; fadeOut?: number }

/**
 * 绑定音量控制组。
 * @param scope 包含本组控件的容器（独立音频页传 .ed-audio-info，画面页传 .ed-pic）
 */
export function bindAudioVolume(
  scope: HTMLElement,
  ref: DetailSelectionRef,
  ctx: DetailViewCtx,
  o: AudioVolumeOptions
): void {
  const p = o.prefix
  if (!ref.current?.audio) return
  const { clampNum } = ctx
  const $ = <T extends HTMLElement>(f: string): T | null => scope.querySelector<T>(`[data-f="${f}"]`)
  const sel = () => ref.current!
  const a = () => sel().audio!
  const id = () => sel().id
  const live = (patch: AudioPatch, first: boolean) => ctx.callbacks.onAudioLive?.(id(), patch, first)
  const commit = () => ctx.callbacks.onAudioCommit?.(id())

  const volRange = $<HTMLInputElement>(`${p}volRange`)
  const volDb = $<HTMLInputElement>(`${p}volDb`)
  const fadeInRange = $<HTMLInputElement>(`${p}fadeInRange`)
  const fadeOutRange = $<HTMLInputElement>(`${p}fadeOutRange`)
  const fadeInEl = $<HTMLInputElement>(`${p}fadeIn`)
  const fadeOutEl = $<HTMLInputElement>(`${p}fadeOut`)
  if (!volRange || !volDb || !fadeInRange || !fadeOutRange || !fadeInEl || !fadeOutEl) return

  // 初始值
  volRange.value = volToDb(a().volume ?? 1).toFixed(1)
  volDb.value = volToDbText(a().volume ?? 1)
  const fadeInit = (range: HTMLInputElement, el: HTMLInputElement, v: number) => {
    const t = Math.round(Math.min(FADE_MAX, clampNum(v ?? 0, 0, FADE_MAX)) * 10) / 10
    range.value = t.toFixed(1)
    el.value = `${t.toFixed(1)}s`
  }
  fadeInit(fadeInRange, fadeInEl, a().fadeIn ?? 0)
  fadeInit(fadeOutRange, fadeOutEl, a().fadeOut ?? 0)

  // —— 音量滑杆（dB 空间等距）：input 实时预览，change 入栈 ——
  let volFirst = true
  volRange.addEventListener('input', () => {
    const d = Number(volRange.value)
    volDb.value = d <= VOL_DB_MIN ? '-∞' : `${d.toFixed(1)}dB`
    const lin = dbToVol(d)
    a().volume = lin
    live({ volume: lin }, volFirst)
    volFirst = false
  })
  volRange.addEventListener('change', () => {
    volFirst = true
    commit()
  })
  // 音量数字框：离散 change，走 live + commit 一次性
  volDb.addEventListener('input', () => {
    volRange.value = dbTextToDb(volDb.value).toFixed(1)
  })
  volDb.addEventListener('change', () => {
    const d = dbTextToDb(volDb.value)
    volRange.value = d.toFixed(1)
    volDb.value = d <= VOL_DB_MIN ? '-∞' : `${d.toFixed(1)}dB`
    const lin = dbToVol(d)
    a().volume = lin
    live({ volume: lin }, true)
    commit()
  })
  volDb.addEventListener('keydown', e => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  })

  // —— 淡入 / 淡出：滑杆 input 实时，数字框 change 一次性 ——
  const bindFade = (range: HTMLInputElement, el: HTMLInputElement, key: 'fadeIn' | 'fadeOut') => {
    const paint = (v: number) => {
      const t = Math.round(v * 10) / 10
      range.value = t.toFixed(1)
      el.value = `${t.toFixed(1)}s`
    }
    let first = true
    range.addEventListener('input', () => {
      const v = Number(range.value)
      paint(v)
      a()[key] = v
      live({ [key]: v }, first)
      first = false
    })
    range.addEventListener('change', () => {
      first = true
      commit()
    })
    const readEl = () => clampNum(parseFloat(el.value) || 0, 0, FADE_MAX)
    el.addEventListener('input', () => {
      const v = readEl()
      range.value = (Math.round(v * 10) / 10).toFixed(1)
    })
    el.addEventListener('change', () => {
      const v = Math.round(readEl() * 10) / 10
      paint(v)
      a()[key] = v
      live({ [key]: v }, true)
      commit()
    })
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    })
  }
  bindFade(fadeInRange, fadeInEl, 'fadeIn')
  bindFade(fadeOutRange, fadeOutEl, 'fadeOut')

  // —— 段头重置：音量 0dB / 淡入淡出 0（离散操作，live+commit 一次） ——
  const resetBtn = scope.querySelector<HTMLButtonElement>('[data-reset="audio-basic"]')
  resetBtn?.addEventListener('click', () => {
    volRange.value = '0.0'
    volDb.value = volToDbText(1)
    fadeInit(fadeInRange, fadeInEl, 0)
    fadeInit(fadeOutRange, fadeOutEl, 0)
    a().volume = 1
    a().fadeIn = 0
    a().fadeOut = 0
    live({ volume: 1, fadeIn: 0, fadeOut: 0 }, true)
    commit()
  })

  // —— 上下微调按钮（dB 感知；按住连续步进，松手统一 commit） ——
  const spinNames = [`${p}volDb`, `${p}fadeIn`, `${p}fadeOut`]
  scope.querySelectorAll<HTMLButtonElement>('.ed-spin-btn').forEach(btn => {
    const targetF = btn.dataset.spin!
    if (!spinNames.includes(targetF)) return
    const dir = Number(btn.dataset.dir)
    const target = scope.querySelector<HTMLInputElement>(`[data-f="${targetF}"]`)
    if (!target) return
    let delayTimer = 0
    let repeatTimer = 0
    let changed = false
    let spinFirst = true
    const stepOnce = () => {
      const ds = target.dataset
      const min = Number(ds.min)
      const max = Number(ds.max)
      const step = Number(ds.step) || 0.1
      let nextDb: number, nextText: string, nextVal: number
      if (targetF === `${p}volDb`) {
        const curDb = dbTextToDb(target.value)
        nextDb = clampNum(Math.round((curDb + dir * step) * 10) / 10, VOL_DB_MIN, VOL_DB_MAX)
        nextText = nextDb <= VOL_DB_MIN ? '-∞' : `${nextDb.toFixed(1)}${ds.suffix ?? ''}`
        nextVal = dbToVol(nextDb)
      } else {
        const cur = parseFloat(target.value) || 0
        const next = clampNum(Math.round((cur + dir * step) * 10) / 10, min, max)
        if (next === cur) return
        nextDb = next
        nextText = `${next.toFixed(1)}${ds.suffix ?? ''}`
        nextVal = next
      }
      target.value = nextText
      changed = true
      const patch: AudioPatch = {}
      if (targetF === `${p}volDb`) {
        a().volume = nextVal
        patch.volume = nextVal
        volRange.value = nextDb.toFixed(1)
      } else if (targetF === `${p}fadeIn`) {
        a().fadeIn = nextVal
        patch.fadeIn = nextVal
        fadeInRange.value = nextVal.toFixed(1)
      } else {
        a().fadeOut = nextVal
        patch.fadeOut = nextVal
        fadeOutRange.value = nextVal.toFixed(1)
      }
      live(patch, spinFirst)
      spinFirst = false
    }
    const stop = () => {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = 0 }
      if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0 }
      if (changed) { changed = false; spinFirst = true; commit() }
    }
    btn.addEventListener('pointerdown', e => {
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

/** 同片段重复同步（撤销 / setTracks / 轨道手势 live 回显）回灌音量组控件（不抢焦点） */
export function syncAudioVolume(
  scope: ParentNode,
  sel: DetailSelection,
  active: Element | null,
  o: Pick<AudioVolumeOptions, 'prefix'>
): void {
  if (!sel.audio) return
  const p = o.prefix
  const setVal = (f: string, v: string) => {
    const el = scope.querySelector<HTMLInputElement>(`[data-f="${f}"]`)
    if (el && el !== active) el.value = v
  }
  const fadeInit = (rangeF: string, numF: string, v: number) => {
    const t = Math.round(Math.min(FADE_MAX, Math.max(0, v ?? 0)) * 10) / 10
    setVal(rangeF, t.toFixed(1))
    setVal(numF, `${t.toFixed(1)}s`)
  }
  const a = sel.audio
  const db = volToDb(a.volume ?? 1)
  setVal(`${p}volRange`, db.toFixed(1))
  setVal(`${p}volDb`, volToDbText(a.volume ?? 1))
  fadeInit(`${p}fadeInRange`, `${p}fadeIn`, a.fadeIn ?? 0)
  fadeInit(`${p}fadeOutRange`, `${p}fadeOut`, a.fadeOut ?? 0)
}
