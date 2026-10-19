/* ============================================================
 *  播放器 UI · 通用底栏弹层 mixin
 *  position: fixed 弹层（可溢出中栏覆盖右侧面板），自动选择
 *  上 / 下展开方向、视口钳位、点击外部 / Esc 关闭。
 *  画面填充 / 比例 / 画质三个弹层共用。
 * ============================================================ */
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export function PopoverMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class Popover extends Base {
    protected closePopover() {
      if (!this.popEl) return
      const owner = this.popOwner
      this.popEl.remove()
      this.popEl = null
      owner?.classList.remove('is-on')
      this.popOwner = null
      // 缩放弹层关闭后，放大状态下填充按钮仍需保持高亮
      if (owner === this.fitBtn && this.canvasZoom > 1) {
        owner?.classList.add('is-on')
      }
      this.zoomRange = null
      if (this.popDocDown) {
        document.removeEventListener('pointerdown', this.popDocDown, true)
        this.popDocDown = null
      }
      if (this.popKeyDown) {
        document.removeEventListener('keydown', this.popKeyDown, true)
        this.popKeyDown = null
      }
    }

    /**
     * 弹出菜单（position: fixed，相对视口定位；可溢出中栏播放器覆盖在右侧面板之上）：
     * 默认在按钮正下方、水平居中于按钮；下方空间不足时自动翻到按钮上方；
     * 水平方向钳在视口内，两侧都放不下时取较高一侧并限高滚动。
     * 同一按钮再点＝收起；点击外部 / Esc 关闭。
     */
    protected openPopover(owner: HTMLElement, build: (box: HTMLDivElement) => void) {
      if (this.popEl && this.popOwner === owner) {
        this.closePopover()
        return
      }
      this.closePopover()
      const player = this.rootEl.querySelector('.jy-player') as HTMLElement
      const box = document.createElement('div')
      box.className = 'jy-pop'
      build(box)
      // 仍挂在 shadow DOM 内以命中 .jy-pop 样式；fixed 定位不受中栏 overflow:hidden 裁剪
      player.appendChild(box)
      const br = owner.getBoundingClientRect()
      const GAP = 6
      box.style.visibility = 'hidden'
      const bw = box.offsetWidth
      const bh = box.offsetHeight
      // 垂直：优先下方；下方放不下但上方放得下则翻上；都放不下时取空间较大的一侧。
      // getBoundingClientRect 即视口坐标，fixed 下直接使用。
      const spaceBelow = window.innerHeight - br.bottom
      const spaceAbove = br.top
      const below = bh + GAP <= spaceBelow || (spaceBelow >= spaceAbove && bh + GAP > spaceAbove)
      box.style.top = below
        ? `${br.bottom + GAP}px`
        : `${br.top - GAP - bh}px`
      // 水平：以按钮中心居中，再整体钳在视口内
      box.style.left = `${Math.max(
        6,
        Math.min(br.left + br.width / 2 - bw / 2, window.innerWidth - bw - 6)
      )}px`
      // 两侧都不足以完整显示时，限高并允许内部滚动
      const avail = below ? spaceBelow : spaceAbove
      if (bh + GAP > avail) {
        box.style.maxHeight = `${Math.max(120, avail - GAP - 4)}px`
        box.style.overflowY = 'auto'
      }
      box.style.visibility = ''
      this.popEl = box
      this.popOwner = owner
      owner.classList.add('is-on')
      this.popDocDown = e => {
        const path = e.composedPath()
        if (path.includes(box) || path.includes(owner)) return
        this.closePopover()
      }
      this.popKeyDown = e => {
        if (e.key === 'Escape') this.closePopover()
      }
      document.addEventListener('pointerdown', this.popDocDown, true)
      document.addEventListener('keydown', this.popKeyDown, true)
    }
  }

  return Popover
}
