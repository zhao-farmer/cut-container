/* ============================================================
 *  播放器 UI · 画面比例 / 播放画质菜单 mixin
 *  - 比例：适应（原始，主轨第一个资源大小）/ 十档固定预设；
 *  - 画质四档：中间缓冲长边 + 渲染分辨率 + 呈现帧率上限三个降负载杠杆，
 *    只影响预览，不影响导出；切档全量重建中间缓冲并推进图层表面代次。
 * ============================================================ */
import {
  QUALITY_OPTIONS,
  RATIO_DIVIDERS_BEFORE,
  RATIO_FIT,
  RATIO_PRESETS,
  ratioGlyph
} from '../core/constants'
import type { RatioOption } from '../core/constants'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export function MenusMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class Menus extends Base {
    protected toggleRatioMenu() {
      this.openPopover(this.ratioBtn, box => {
        // 顶部特殊项合并为一个「适应（原始）」：
        // 大小取主轨第一个资源，没有主轨资源时使用 1600×900。
        const specials: Array<{ opt: RatioOption }> = [
          { opt: RATIO_FIT }
        ]
        for (const { opt } of specials) {
          const row = document.createElement('div')
          row.className = 'jy-pop-item'
          if (this.ratioOption.key === opt.key) row.classList.add('is-active')
          row.innerHTML =
            `<span class="jy-pop-check">✓</span>` +
            `<span class="jy-pop-label">${opt.label}</span>` +
            '<span class="jy-pop-glyph"></span>'
          row.addEventListener('click', () => {
            this.setRatio(opt)
            this.closePopover()
          })
          box.appendChild(row)
        }
        // 固定预设（横屏组 / 竖屏组，分组前插分隔线）
        for (const opt of RATIO_PRESETS) {
          if (RATIO_DIVIDERS_BEFORE.includes(opt.key)) {
            const divider = document.createElement('div')
            divider.className = 'jy-pop-divider'
            box.appendChild(divider)
          }
          const row = document.createElement('div')
          row.className = 'jy-pop-item'
          if (this.ratioOption.key === opt.key) row.classList.add('is-active')
          row.innerHTML =
            `<span class="jy-pop-check">✓</span>` +
            `<span class="jy-pop-label">${opt.label}</span>` +
            ratioGlyph(opt.ratio as number)
          row.addEventListener('click', () => {
            this.setRatio(opt)
            this.closePopover()
          })
          box.appendChild(row)
        }
      })
    }

    protected setRatio(opt: RatioOption) {
      const oldRatio = this.ratioOption.ratio ?? this.originRatio()
      this.ratioOption = opt
      // 「适应（原始）」在底栏仍显示短标签「比例」，避免按钮过宽
      this.ratioBtn.textContent = opt.key === 'fit' ? '比例' : opt.label
      // 不在 setRatio 内先重排：等外层按新旧比例换算完元素位置后，
      // 由 refreshAfterRatio 统一做一次布局 + 文字表面重绘，避免重复 O(n) 重排。
      // 「适应（原始）」同时把主轨第一个资源的确切尺寸发给草稿参数；
      // 固定预设只发宽高比，由外层按短边 1080 换算。
      const size = opt.key === 'fit' ? this.originSize() : undefined
      const resolved = opt.ratio ?? (size ? size.w / size.h : null)
      this.emit('ratio:change', {
        key: opt.key,
        label: opt.label,
        ratio: resolved,
        oldRatio,
        size
      })
    }

    protected toggleQualityMenu() {
      this.openPopover(this.originalBtn, box => {
        QUALITY_OPTIONS.forEach((opt, idx) => {
          const row = document.createElement('div')
          row.className = 'jy-pop-item'
          if (idx === this.qualityIndex) row.classList.add('is-active')
          row.innerHTML =
            `<span class="jy-pop-check">✓</span>` +
            `<span class="jy-pop-text"><span class="jy-pop-label">${opt.label}</span>` +
            `<span class="jy-pop-sub">${opt.sub}</span></span>`
          row.addEventListener('click', () => {
            this.applyQuality(idx)
            this.closePopover()
          })
          box.appendChild(row)
        })
      })
    }

    /** 切换播放画质：重设渲染分辨率并按新长边重建全部中间缓冲 */
    protected applyQuality(index: number) {
      this.qualityIndex = index
      const opt = QUALITY_OPTIONS[index]
      // 底栏按钮跟随当前档位显示短名（原画 / 清晰 / 流畅 / 低清），
      // 完整名称 + 说明放 title，悬停可见
      this.originalBtn.textContent = opt.short
      this.originalBtn.title = `${opt.label}（${opt.sub}）`
      const app = this.app
      if (app) {
        const res = Math.max(1, opt.resolution(window.devicePixelRatio || 1))
        if (app.renderer.resolution !== res) {
          app.renderer.resize(
            this.stageEl.clientWidth || app.screen.width,
            this.stageEl.clientHeight || app.screen.height,
            res
          )
        }
      }
      // 重建离屏缓冲（单素材 surface + 时间线各图层 surface）
      this.resetVideoSurface()
      this.pruneLayers(new Set())
      // 图层表面代次 +1：播放循环中的静态层（图片/贴纸/文字）下一拍按新画质重建
      this.layersEpoch++
      // GIF 帧序号缓存一并清掉：缩放后的新表面需要按当前帧重画一次
      this.resources.gifFrameIdx.clear()
      // 播放中切档：立即按新帧率上限调整 ticker 节拍（下一拍起呈现/合成次数即变化）
      if (this.playing) this.applyTickerRate()
      if (this.tlClips) {
        void this.renderTimelineStill(this.currentTime)
      } else if (this.hasVideo) {
        this.renderStill(this.currentTime)
      }
      this.relayoutStage()
    }

    /** 当前画质档的预览呈现帧率上限（0＝不限制，跟随素材源帧率） */
    protected qualityMaxFps(): number {
      return QUALITY_OPTIONS[this.qualityIndex]?.maxFps ?? 0
    }

    /** 把 pixi ticker 的节拍限制到当前画质档帧率（播放开始 / 播放中切档时调用） */
    protected applyTickerRate() {
      if (this.app) this.app.ticker.maxFPS = this.qualityMaxFps()
    }

    /**
     * 按当前画质把原始 w/h 限制为中间缓冲尺寸（保持比例取整）。
     * maxEdge＝0（原画质）时不限边；hardCap 为额外安全上限（图片/GIF 用 1920）。
     */
    protected applyQualityCap(w: number, h: number, hardCap = Infinity): [number, number] {
      let nw = Math.max(1, Math.round(w))
      let nh = Math.max(1, Math.round(h))
      const maxEdge = QUALITY_OPTIONS[this.qualityIndex].maxEdge
      const limit = maxEdge > 0 ? Math.min(maxEdge, hardCap) : hardCap
      if (Number.isFinite(limit) && Math.max(nw, nh) > (limit as number)) {
        const k = (limit as number) / Math.max(nw, nh)
        nw = Math.max(1, Math.round(nw * k))
        nh = Math.max(1, Math.round(nh * k))
      }
      return [nw, nh]
    }
  }

  return Menus
}
