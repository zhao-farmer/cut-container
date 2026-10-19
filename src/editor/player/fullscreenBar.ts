/* ============================================================
 *  全屏简易播放控制条（独立组件）
 *  从 MediaBunnyPlayer 抽离：DOM / 图标 / 进度拖拽 / 键盘快进快退
 *  全部内聚在本文件，播放器只通过 hooks 提供数据与动作。
 *
 *  显示时机：祖先节点带 .is-fullscreen 类时由 CSS 显示（悬浮画面底部）。
 *  层级：z-index 高于画面操作框覆盖层(.tf-layer, z-index:6)，否则真实
 *  指针事件会被铺满画面的覆盖层整体吞掉（按钮点不到、进度拖不动）。
 * ============================================================ */

import { FS_ICONS } from '../utils/icons'

/** 时间码帧率（与 MediaBunnyPlayer.TC_FPS / 时间轴 TIMELINE_FPS 一致） */
const FS_FPS = 30
/** 左右方向键快退 / 快进步长（秒） */
const SEEK_STEP_SEC = 5

export interface FullscreenBarHooks {
  /** 当前是否播放中（决定按钮显暂停还是三角） */
  isPlaying: () => boolean
  getTime: () => number
  getDuration: () => number
  seek: (timeSec: number) => void
  togglePlay: () => void
  exitFullscreen: () => void
}

/** 秒 → HH:MM:SS:FF */
function fmtTC(s: number) {
  const frames = Math.max(0, Math.round((Number.isFinite(s) ? s : 0) * FS_FPS))
  const ff = frames % FS_FPS
  const ss = Math.floor(frames / FS_FPS) % 60
  const mm = Math.floor(frames / (FS_FPS * 60)) % 60
  const hh = Math.floor(frames / (FS_FPS * 3600))
  const p = (v: number) => String(v).padStart(2, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`
}

export class FullscreenBar {
  private el: HTMLDivElement
  private playBtn: HTMLButtonElement
  private tCur: HTMLSpanElement
  private tDur: HTMLSpanElement
  private track: HTMLDivElement
  private fill: HTMLDivElement
  private thumb: HTMLElement
  private hooks: FullscreenBarHooks
  /** 进度条拖拽中：不被播放 tick 的时间回写覆盖拇指位置 */
  private dragging = false

  constructor(stage: HTMLElement, hooks: FullscreenBarHooks) {
    this.hooks = hooks
    stage.insertAdjacentHTML(
      'beforeend',
      `<div class="jy-fsbar">
        <button type="button" class="jy-fs-play" title="播放（空格）">${FS_ICONS.play}</button>
        <span class="jy-fs-time">
          <span class="jy-fs-tcur">00:00:00:00</span><span class="jy-fs-sep">/</span><span class="jy-fs-tdur">00:00:00:00</span>
        </span>
        <div class="jy-fs-track" title="拖动调整进度（← / → 快退快进 5 秒，Shift+← / → 逐帧）">
          <div class="jy-fs-line"></div>
          <div class="jy-fs-fill"></div>
          <i class="jy-fs-thumb"></i>
        </div>
        <span class="jy-fs-vsep"></span>
        <button type="button" class="jy-fs-exit" title="退出全屏（Esc）">${FS_ICONS.exit}</button>
      </div>`
    )
    const $ = <T extends HTMLElement>(sel: string) => stage.querySelector(sel) as T
    this.el = $('.jy-fsbar')
    this.playBtn = $('.jy-fs-play')
    this.tCur = $('.jy-fs-tcur')
    this.tDur = $('.jy-fs-tdur')
    this.track = $('.jy-fs-track')
    this.fill = $('.jy-fs-fill')
    this.thumb = $('.jy-fs-thumb')

    // 整条控制栏阻断冒泡：点按钮 / 拖进度时不触发画面区的「点击播放暂停」
    this.el.addEventListener('click', e => e.stopPropagation())
    this.el.addEventListener('pointerdown', e => e.stopPropagation())
    this.playBtn.addEventListener('click', () => {
      hooks.togglePlay()
      // 点击后让按钮失焦：避免全屏内按空格时既触发本钮 click 又走 document 快捷键
      this.playBtn.blur()
    })
    $('.jy-fs-exit').addEventListener('click', () => hooks.exitFullscreen())
    this.bindScrub()
    document.addEventListener('keydown', this.onKeyDown)
  }

  /** 播放 / 暂停态同步（含按钮 title 提示随态切换） */
  syncPlaying(playing: boolean) {
    this.playBtn.innerHTML = playing ? FS_ICONS.pause : FS_ICONS.play
    this.playBtn.title = playing ? '暂停（空格）' : '播放（空格）'
  }

  /** 时间码 + 进度条同步（拖拽中只更文字，不抢拇指） */
  syncTime() {
    const cur = this.hooks.getTime()
    const dur = this.hooks.getDuration() || 0
    this.tCur.textContent = fmtTC(cur)
    this.tDur.textContent = fmtTC(Math.floor(dur))
    if (this.dragging) return
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0
    this.fill.style.width = `${pct}%`
    this.thumb.style.left = `${pct}%`
  }

  /** 进度条指针拖拽：按下即吸附、移动实时 seek（capture 防拖出断触） */
  private bindScrub() {
    const scrubFromClientX = (clientX: number) => {
      const r = this.track.getBoundingClientRect()
      if (r.width <= 0) return
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      this.hooks.seek(ratio * (this.hooks.getDuration() || 0))
    }
    this.track.addEventListener('pointerdown', e => {
      e.preventDefault()
      e.stopPropagation()
      this.dragging = true
      this.track.classList.add('is-drag')
      try { this.track.setPointerCapture(e.pointerId) } catch { /* noop */ }
      scrubFromClientX(e.clientX)
    })
    this.track.addEventListener('pointermove', e => {
      if (!this.dragging) return
      e.preventDefault()
      scrubFromClientX(e.clientX)
    })
    const end = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      this.track.classList.remove('is-drag')
      try { this.track.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      this.syncTime()
    }
    this.track.addEventListener('pointerup', end)
    this.track.addEventListener('pointercancel', end)
  }

  /**
   * 全屏键盘：← / → 快退快进 5 秒，Shift+← / → 逐帧，空格播放暂停。
   * 仅在真正全屏时响应；preventDefault 阻止空格触发聚焦按钮 / 页面滚动。
   */
  private onKeyDown = (e: KeyboardEvent) => {
    if (!document.fullscreenElement) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const step = e.shiftKey ? 1 / FS_FPS : SEEK_STEP_SEC
      const dur = this.hooks.getDuration() || 0
      const next = Math.min(dur, Math.max(0, this.hooks.getTime() + (e.key === 'ArrowRight' ? step : -step)))
      this.hooks.seek(next)
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      this.hooks.togglePlay()
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.onKeyDown)
    this.el.remove()
  }
}
