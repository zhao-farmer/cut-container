/* ============================================================
 *  播放器 UI · 外壳 mixin
 *  底栏 DOM 构建（时间码 / 播放钮 / 画质 / 填充 / 比例 / 全屏 /
 *  格子电平表）、loading / error、播放钮与时间码 UI 状态、
 *  全屏切换、外部电平 tap 接管。
 * ============================================================ */
import { FullscreenBar } from '../fullscreenBar'
import { createTransformOverlay } from '../transformOverlay'
import { GridLevelMeter } from '../../levelMeter'
import type { StereoTap } from '../../levelMeter'
import { FS_ICONS, PLAYER_ICONS } from '../../utils/icons'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export function ShellMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class Shell extends Base {
    /** 播放器左上角标题（素材选中预览时显示「正在预览 …」） */
    protected jyTitleEl: HTMLElement | null = null
    /** 预览进度条（素材选中预览时显示） */
    protected scrubEl: HTMLElement | null = null
    protected seekEl: HTMLInputElement | null = null
    protected seekDragging = false
    /** 拖动预览进度条前的播放态：松手后从新位置继续播放 */
    protected seekResume = false

    /** 改写播放器左上角标题（不传 / 空串恢复默认「播放器」） */
    setHeaderTitle(title: string | null) {
      if (this.jyTitleEl) this.jyTitleEl.textContent = title && title.trim() ? title : '播放器'
    }

    /** 素材预览进度条显隐（时间线模式不需要，拖时间轴即可） */
    setPreviewScrub(show: boolean) {
      if (this.scrubEl) this.scrubEl.style.display = show ? '' : 'none'
      if (!show && this.seekEl) {
        this.seekEl.value = '0'
        this.seekEl.style.setProperty('--seek-pos', '0%')
        this.seekDragging = false
        this.seekResume = false
      }
    }

    // ====================== UI ======================
    protected buildDOM() {
      this.rootEl.innerHTML = `
        <div class="jy-player">
          <div class="jy-head">
            <span class="jy-title">播放器</span>
          </div>
          <div class="jy-stage">
            <div class="jy-loading" style="display:none">解码加载中…</div>
            <div class="jy-error" style="display:none"></div>
            <div class="jy-nav" style="display:none">
              <div class="jy-nav-frame"><div class="jy-nav-view"></div></div>
            </div>
          </div>
          <div class="jy-scrub" style="display:none">
            <input type="range" class="jy-seek" min="0" max="1000" step="1" value="0" aria-label="预览进度" />
          </div>
          <div class="jy-bar">
            <div class="jy-bar-left">
              <span class="jy-time-cur">00:00:00:00</span>
              <span class="jy-time-dur">00:00:00:00</span>
            </div>
            <div class="jy-bar-center">
              <button type="button" class="jy-play" title="播放 / 暂停">${PLAYER_ICONS.play}</button>
            </div>
            <div class="jy-bar-right">
              <button type="button" class="jy-chip" data-act="quality" title="播放画质">原画</button>
              <button type="button" class="jy-icon-btn" data-act="fit" title="画面填充（缩放预览）">${PLAYER_ICONS.fit}</button>
              <button type="button" class="jy-chip" data-act="ratio" title="画面比例">比例</button>
              <button type="button" class="jy-icon-btn" data-act="fullscreen" title="全屏">${FS_ICONS.enter}</button>
            </div>
          </div>
        </div>`

      const $ = <T extends HTMLElement>(sel: string) => this.rootEl.querySelector(sel) as T
      this.jyTitleEl = $('.jy-title')
      this.stageEl = $('.jy-stage')
      this.scrubEl = $('.jy-scrub')
      this.seekEl = $<HTMLInputElement>('.jy-seek')
      this.playBtn = $('.jy-play')
      this.timeCurEl = $('.jy-time-cur')
      this.timeDurEl = $('.jy-time-dur')
      this.fitBtn = $('[data-act="fit"]')
      this.ratioBtn = $('[data-act="ratio"]')
      this.originalBtn = $('[data-act="quality"]')
      this.navEl = $('.jy-nav')
      this.navFrameEl = $('.jy-nav-frame')
      this.navViewEl = $('.jy-nav-view')

      // 底栏格子电平表：紧跟两个时间码；时间线含音频时常驻显示。
      // 同时是右侧竖井电平表的显示 / 隐藏开关（剪映口径：点格子切竖表）
      const levelHost = document.createElement('span')
      levelHost.title = '显示 / 隐藏电平表'
      $('.jy-bar-left').appendChild(levelHost)
      this.levelMeter = new GridLevelMeter(levelHost)
      levelHost.addEventListener('click', () => this.emit('level:toggle-vu', undefined))

      const toggle = () => (this.playing ? this.pause() : this.play())
      this.playBtn.addEventListener('click', toggle)
      // 点击画面任意位置播放 / 暂停（中央三角纯视觉、不拦截指针）；
      // 放大后的平移拖拽结束会产生 click，需吞掉
      this.stageEl.addEventListener('click', e => {
        if ((e.target as HTMLElement).classList.contains('jy-error')) return
        if (this.panSwallowClick) {
          this.panSwallowClick = false
          return
        }
        toggle()
      })
      // 放大后在空白画面按住拖动平移（命中素材时操作框会 stopPropagation，仍是移动素材）
      this.stageEl.addEventListener('pointerdown', this.onStagePanDown)
      this.stageEl.addEventListener('pointermove', this.onStagePanMove)
      this.stageEl.addEventListener('pointerup', this.onStagePanUp)
      this.stageEl.addEventListener('pointercancel', this.onStagePanUp)
      this.initNavigator()
      this.fitBtn.addEventListener('click', () => this.toggleZoomPopover())
      this.ratioBtn.addEventListener('click', () => this.toggleRatioMenu())
      this.originalBtn.addEventListener('click', () => this.toggleQualityMenu())
      $('[data-act="fullscreen"]').addEventListener('click', () => this.toggleFullscreen())
      document.addEventListener('fullscreenchange', this.onFullscreenChange)

      // 画面操作框覆盖层（选中片段后显示；播放中自动隐藏）
      this.overlay = createTransformOverlay(this.stageEl, {
        getBoxes: () => this.getLayerBoxes(),
        getSelected: () => this.selectedClipId,
        isPlaying: () => this.playing || this.tlPreparing,
        getK: () => this.getLogicalK(),
        hitTest: (x, y) => this.hitTest(x, y),
        getTransform: id => this.getClipTransform(id),
        onLive: (id, t) => {
          this.updateClipTransform(id, t)
          const cur = this.getClipTransform(id)
          if (cur) this.onTransformLive?.(id, cur)
        },
        onCommit: (id, t) => this.onTransformCommit?.(id, t),
        onPick: id => this.pickClipFromOverlay(id),
        getTextMeta: id => this.getClipEditText(id),
        setTextEditing: id => this.setTextEditing(id),
        onTextLive: (id, patch) => {
          // 键入即时重绘文字表面（编辑中表面保持原位显示，输入框仅呈现光标 / 选区）
          this.updateClipLive(id, { text: patch })
          this.onTextLive?.(id, patch)
        },
        onTextCommit: id => this.onTextCommit?.(id)
      })
      this.addBoxesListener(() => this.overlay?.refresh())

      // 预览进度条：拖动 / 点击 → 立即跳到目标位置
      if (this.seekEl) {
        const seek = this.seekEl
        const beginDrag = () => {
          this.seekDragging = true
          // 播放中先暂停：拖动期间只定格目标帧，避免一边拖一边继续往前播
          this.seekResume = this.playing || this.tlPreparing
          if (this.seekResume) this.pause()
        }
        const endDrag = () => {
          this.seekDragging = false
          if (this.seekResume) {
            this.seekResume = false
            // 松手后从新位置继续播放（跳转已即时生效）
            void this.play()
          }
        }
        seek.addEventListener('pointerdown', beginDrag)
        seek.addEventListener('pointerup', endDrag)
        seek.addEventListener('pointercancel', endDrag)
        seek.addEventListener('input', () => {
          // 拖动过程中 timeupdate 会被 seekDragging 屏蔽，这里直接按滑杆值刷新白色已播放段
          const ratio = Math.max(0, Math.min(1, Number(seek.value) / 1000))
          seek.style.setProperty('--seek-pos', `${ratio * 100}%`)
          if (this.duration > 0) this.seek(ratio * this.duration)
        })
      }

      // 全屏简易播放控制条（独立组件，DOM 自建于画面区，全屏时由 CSS 显示）
      this.fsBar = new FullscreenBar(this.stageEl, {
        isPlaying: () => this.playing || this.tlPreparing,
        getTime: () => this.currentTime,
        getDuration: () => this.duration,
        seek: t => this.seek(t),
        togglePlay: toggle,
        exitFullscreen: () => this.toggleFullscreen()
      })

      this.updatePlayUI()
      this.updateTimeUI()
    }

    /** 画面内点选：更新本地选中并通知外部（EditorPage 同步时间轴 / 面板） */
    protected pickClipFromOverlay(id: string) {
      if (this.selectedClipId === id) return
      this.selectedClipId = id
      this.scheduleBoxesNotify()
      this.onClipSelect?.(id)
    }

    protected setLoading(v: boolean, text?: string) {
      this.loading = v
      const el = this.rootEl.querySelector('.jy-loading') as HTMLElement
      el.style.display = v ? 'block' : 'none'
      if (text) el.textContent = text
      // loading 期间隐藏画面中央的播放浮钮（避免与提示胶囊重叠）
      this.rootEl.querySelector('.jy-player')?.classList.toggle('is-loading', v)
    }

    protected showError(msg: string) {
      const el = this.rootEl.querySelector('.jy-error') as HTMLElement
      el.style.display = 'block'
      el.textContent = msg
    }

    protected clearError() {
      ;(this.rootEl.querySelector('.jy-error') as HTMLElement).style.display = 'none'
    }

    // ====================== 全屏 ======================
    protected toggleFullscreen() {
      if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void (this.rootEl.querySelector('.jy-player') as HTMLElement).requestFullscreen?.()
      }
    }

    protected onFullscreenChange = () => {
      const fs = !!document.fullscreenElement
      const player = this.rootEl.querySelector('.jy-player') as HTMLElement | null
      // 全屏样式（隐藏标题栏 / 常规底栏、黑底、显示底部简易播放条）均挂在此类上
      player?.classList.toggle('is-fullscreen', fs)
      const btn = this.rootEl.querySelector('[data-act="fullscreen"]') as HTMLButtonElement | null
      if (btn) {
        btn.classList.toggle('is-on', fs)
        btn.innerHTML = fs ? FS_ICONS.exit : FS_ICONS.enter
        btn.title = fs ? '退出全屏（Esc）' : '全屏'
      }
      // 进入全屏立刻把播放条时间 / 进度刷到当前位置
      this.fsBar.syncPlaying(this.playing || this.tlPreparing)
      this.fsBar.syncTime()
    }

    // ====================== UI 状态 ======================
    protected updatePlayUI() {
      if (!this.playBtn) return
      // 资源准备中即视为"即将播放"：按钮立刻变成暂停态（再点＝取消起播），
      // 不等准备结束才切换
      const showPause = this.playing || this.tlPreparing
      this.playBtn.innerHTML = showPause ? PLAYER_ICONS.pause : PLAYER_ICONS.play
      this.fsBar?.syncPlaying(showPause)
      this.rootEl.querySelector('.jy-player')?.classList.toggle('is-playing', this.playing)
      // 播放 / 解码准备中隐藏选中操作框（播放 tick 不发 boxes 通知），
      // 暂停后的静帧重绘会再通知 refresh，框按最新包围盒恢复
      this.overlay?.refresh()
    }

    protected updateTimeUI() {
      if (this.timeCurEl) this.timeCurEl.textContent = this.fmtTC(this.currentTime)
      // 总时长按剪映习惯取整到秒显示（5.067s → 00:00:05:00）
      if (this.timeDurEl) this.timeDurEl.textContent = this.fmtTC(Math.floor(this.duration || 0))
      // 预览进度条跟随播放位置（拖动中不回写，避免和指针打架）
      if (this.seekEl && !this.seekDragging && this.duration > 0) {
        const ratio = Math.max(0, Math.min(1, this.currentTime / this.duration))
        this.seekEl.value = String(Math.round(ratio * 1000))
        // 已播放段（滑杆左侧）用灰白底色铺满，右侧保持深灰
        this.seekEl.style.setProperty('--seek-pos', `${ratio * 100}%`)
      }
      // 全屏简易播放条的时间码 / 进度由独立组件自行更新（含拖拽保护）
      this.fsBar?.syncTime()
    }

    /**
     * 外部音源接管 / 释放底栏格子电平表（素材库音乐试听：格子表与竖井表同源数据）。
     * tap 非空即显示并实时跟该音源；null 时还原为时间线混音源（按当前播放态决定跳动 / 全灭）。
     */
    setExternalLevelTap(tap: StereoTap | null) {
      this.externalTap = tap
      if (tap) {
        this.levelMeter?.setVisible(true)
        this.levelMeter?.start(tap)
        this.emitActiveTap()
        return
      }
      const hasAudioClip = !!this.tlClips?.some(c => c.kind === 'audio' || c.kind === 'video')
      this.levelMeter?.setVisible(hasAudioClip)
      const busTap = this.mixer.tap
      if (this.playing && busTap) this.levelMeter?.start(busTap)
      else this.levelMeter?.idle()
      this.emitActiveTap()
    }

    /** 监听活动电平 tap（试听音源 → 时间线混音 → null），供外部竖井电平表使用 */
    setTapListener(fn: ((tap: StereoTap | null) => void) | null) {
      this.tapListener = fn
    }

    protected emitActiveTap() {
      this.tapListener?.(this.externalTap ?? (this.playing ? this.mixer.tap : null))
    }
  }

  return Shell
}
