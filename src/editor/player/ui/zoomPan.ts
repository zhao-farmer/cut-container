/* ============================================================
 *  播放器 UI · 画面填充（预览缩放 / 拖拽平移 / 导航小窗）mixin
 *  - 缩放只作用于预览画面（比例视图矩形整体放大 100%-400%），
 *    不影响导出 / 时间线数据；
 *  - 放大后在画面空白处按住可拖拽平移，黑边轴方向不可移；
 *  - 右下角导航小窗：整帧缩略 + 青色视口框，可拖动平移。
 * ============================================================ */
import { tlIcon } from '../../utils/icons'
import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_STEP,
  NAV_PREVIEW_H,
  NAV_PREVIEW_W
} from '../core/constants'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export function ZoomPanMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class ZoomPan extends Base {
    /**
     * 填充按钮：
     * 缩放弹层已开 → 收起；其它弹层开着 → 关后改开缩放弹层；
     * 无弹层且处于放大状态 → 一键恢复适应；适应状态 → 弹出 −/滑块/+ 缩放条
     */
    protected toggleZoomPopover() {
      if (this.popEl) {
        if (this.popOwner === this.fitBtn) {
          this.closePopover()
          return
        }
        this.closePopover()
      }
      if (this.canvasZoom > 1) {
        this.setCanvasZoom(CANVAS_ZOOM_MIN)
        return
      }
      this.openPopover(this.fitBtn, box => this.buildZoomPopover(box))
    }

    protected buildZoomPopover(box: HTMLDivElement) {
      box.classList.add('jy-pop-zoom')
      // 图标与滑杆样式与时间轴缩放控件保持一致（放大镜 − / 细轨白圆点 / 放大镜 +）
      box.innerHTML =
        `<button type="button" class="jz-btn" data-z="out" title="缩小" aria-label="缩小">${tlIcon('zoom-out')}</button>` +
        `<input class="jz-range" type="range" min="100" max="${CANVAS_ZOOM_MAX * 100}" step="10" value="${Math.round(this.canvasZoom * 100)}" aria-label="画面缩放">` +
        `<button type="button" class="jz-btn" data-z="in" title="放大" aria-label="放大">${tlIcon('zoom-in')}</button>`
      const range = box.querySelector<HTMLInputElement>('.jz-range')!
      this.zoomRange = range
      range.addEventListener('input', () => this.setCanvasZoom(Number(range.value) / 100))
      box
        .querySelector('[data-z="out"]')!
        .addEventListener('click', () => this.setCanvasZoom(this.canvasZoom - CANVAS_ZOOM_STEP))
      box
        .querySelector('[data-z="in"]')!
        .addEventListener('click', () => this.setCanvasZoom(this.canvasZoom + CANVAS_ZOOM_STEP))
    }

    /** 设置预览缩放倍数（1＝适应窗口，上限 400%），同步钳制平移、刷新舞台与按钮态 */
    protected setCanvasZoom(z: number) {
      let nz = Math.round(z * 10) / 10
      nz = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, nz))
      if (nz <= CANVAS_ZOOM_MIN + 1e-6) nz = CANVAS_ZOOM_MIN
      this.canvasZoom = nz
      // 缩小 / 窗口变大时回收越界平移（getViewRect 内部按当前缩放钳制）
      this.getViewRect()
      this.stageEl.classList.toggle('is-zoomed', nz > 1)
      this.fitBtn.classList.toggle('is-on', nz > 1)
      this.fitBtn.title =
        nz > 1 ? `画面填充 ${Math.round(nz * 100)}%（点击恢复适应）` : '画面填充（缩放预览）'
      if (this.zoomRange) this.zoomRange.value = String(Math.round(nz * 100))
      this.relayoutStage()
    }

    /** 放大后在空白画面按住拖动平移（箭头函数属性，保持 this 绑定并可在 destroy 移除） */
    protected onStagePanDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.canvasZoom <= 1) return
      const t = e.target as HTMLElement
      // 导航小窗 / 加载与错误遮罩不触发平移；命中素材时操作框已 stopPropagation
      if (t.closest('.jy-nav,.jy-loading,.jy-error')) return
      // 新手势开始：清掉上一手势可能残留的 click 吞掉标记
      this.panSwallowClick = false
      this.panGesture = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        panX0: this.canvasPanX,
        panY0: this.canvasPanY,
        moved: false
      }
      try {
        this.stageEl.setPointerCapture(e.pointerId)
      } catch {
        /* 个别合成事件下捕获失败，move/up 监听仍在 */
      }
      e.preventDefault()
    }

    protected onStagePanMove = (e: PointerEvent) => {
      const g = this.panGesture
      if (!g || e.pointerId !== g.id) return
      const dx = e.clientX - g.x0
      const dy = e.clientY - g.y0
      if (!g.moved && Math.hypot(dx, dy) < 3) return
      g.moved = true
      this.stageEl.classList.add('is-panning')
      this.canvasPanX = g.panX0 + dx
      this.canvasPanY = g.panY0 + dy
      this.getViewRect() // 钳制到「画面始终覆盖屏幕」
      this.relayoutStage()
      e.preventDefault()
    }

    protected onStagePanUp = (e: PointerEvent) => {
      const g = this.panGesture
      if (!g || e.pointerId !== g.id) return
      this.panGesture = null
      this.stageEl.classList.remove('is-panning')
      try {
        this.stageEl.releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      // 真拖拽：吞掉随后的 click，避免误触播放/暂停
      if (g.moved) {
        this.panSwallowClick = true
        e.preventDefault()
      }
    }

    /** 导航小窗：整帧缩略 + 青色视口框，按住拖动可平移画面 */
    protected initNavigator() {
      this.navEl.addEventListener('pointerdown', (e: PointerEvent) => {
        // 小窗在舞台内部，阻止冒泡触发空白平移与播放/暂停 click
        e.stopPropagation()
        if (e.button !== 0 || this.canvasZoom <= 1) return
        const frame = this.navFrameEl
        this.panFromNavigator(e.clientX, e.clientY)
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return
          this.panFromNavigator(ev.clientX, ev.clientY)
          ev.preventDefault()
        }
        const up = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return
          frame.removeEventListener('pointermove', move)
          frame.removeEventListener('pointerup', up)
          frame.removeEventListener('pointercancel', up)
          try {
            frame.releasePointerCapture(e.pointerId)
          } catch {
            /* noop */
          }
        }
        try {
          frame.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
        frame.addEventListener('pointermove', move)
        frame.addEventListener('pointerup', up)
        frame.addEventListener('pointercancel', up)
      })
      this.navEl.addEventListener('click', e => e.stopPropagation())
    }

    /** 导航小窗缩放系数：基础比例矩形缩入 NAV_W×NAV_H 的等比系数 */
    protected navScale(base: { vw: number; vh: number }): number {
      return Math.min(NAV_PREVIEW_W / base.vw, NAV_PREVIEW_H / base.vh)
    }

    /** 把小窗内的视口坐标换算成画面平移：让视口中心对准该处 */
    protected panFromNavigator(clientX: number, clientY: number) {
      const base = this.getBaseViewRect()
      if (!base) return
      const r = this.navFrameEl.getBoundingClientRect()
      const ns = this.navScale(base)
      const fx = (clientX - r.left) / ns
      const fy = (clientY - r.top) / ns
      const z = this.canvasZoom
      this.canvasPanX = (base.vw / 2 - fx) * z
      this.canvasPanY = (base.vh / 2 - fy) * z
      this.getViewRect()
      this.relayoutStage()
    }

    /** 按当前缩放/平移刷新导航小窗：帧框尺寸 + 青色视口框位置；缩放为 1 时隐藏 */
    protected updateNavigator() {
      if (!this.navEl) return
      const base = this.getBaseViewRect()
      const rect = this.getViewRect()
      if (!this.app || !base || !rect || this.canvasZoom <= 1) {
        this.navEl.style.display = 'none'
        return
      }
      const cw = this.app.screen.width
      const ch = this.app.screen.height
      const ns = this.navScale(base)
      this.navFrameEl.style.width = `${Math.max(24, base.vw * ns)}px`
      this.navFrameEl.style.height = `${Math.max(24, base.vh * ns)}px`
      const z = this.canvasZoom
      // 屏幕左上角在帧坐标系中的位置：-rect.vx / z；视口尺寸：屏幕尺寸 / z
      const view = this.navViewEl.style
      view.left = `${(-rect.vx / z) * ns}px`
      view.top = `${(-rect.vy / z) * ns}px`
      view.width = `${(cw / z) * ns}px`
      view.height = `${(ch / z) * ns}px`
      this.navEl.style.display = ''
    }
  }

  return ZoomPan
}
