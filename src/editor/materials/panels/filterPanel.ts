/* ============================================================
 *  素材库 · 面板六：滤镜（pixi ColorMatrix 实时预览）
 *  顶部同一示例画面（后端 /files/filter/original.png）上实时调色，
 *  下方为烘焙好效果的缩略图；返回清理函数在切 tab / 销毁时
 *  销毁 pixi 实例，释放 WebGL 上下文。
 * ============================================================ */
import type { FilterItem, FilterKey } from '../../types'
import * as PIXI from 'pixi.js'
import { backendAssetUrl } from '../../services/backend'
import type { PanelCtx } from '../materialsPanel'

/** 一个 pixi 滤镜预览实例的最小句柄 */
interface FilterPreviewHandle {
  apply: (key: FilterKey) => void
  destroy: () => void
}

async function createFilterPreview(host: HTMLElement): Promise<FilterPreviewHandle | null> {
  // v8：Application 构造 / 初始化分离（init 异步），app.view → app.canvas
  const app = new PIXI.Application()
  await app.init({
    width: host.clientWidth || 240,
    height: host.clientHeight || 132,
    background: 0x101014,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  })
  app.ticker.stop()
  host.appendChild(app.canvas as HTMLCanvasElement)

  let texture: import('pixi.js').Texture
  try {
    // 示例图已随素材迁移到后端，按运行时后端地址加载
    const stageUrl = await backendAssetUrl('/files/filter/original.png')
    const fromURL = (PIXI.Texture as unknown as { fromURL?: (u: string) => Promise<import('pixi.js').Texture> }).fromURL
    texture = fromURL
      ? await fromURL(stageUrl)
      : await PIXI.Assets.load<import('pixi.js').Texture>(stageUrl)
  } catch (err) {
    console.warn('[editor/materials] 滤镜示例图加载失败:', err)
    app.destroy()
    return null
  }

  const sprite = new PIXI.Sprite(texture)
  sprite.anchor.set(0.5)
  const fit = () => {
    const w = host.clientWidth || 240
    const h = host.clientHeight || 132
    const scale = Math.min(w / texture.width, h / texture.height)
    sprite.scale.set(scale)
    sprite.position.set(w / 2, h / 2)
  }
  fit()
  app.stage.addChild(sprite)
  app.render()

  function buildFilter(key: FilterKey): import('pixi.js').ColorMatrixFilter {
    const cmf = new PIXI.ColorMatrixFilter()
    // pixi v8：preset 方法签名与 v7 一致（multiply 必传）；
    // matrix 仍是 getter/setter 属性，自定义矩阵走赋值（ColorMatrix 为 20 元定长元组，number[] 需断言）；
    // 叠加用 multiply=true，否则整体覆盖。
    // 注意 greyscale(scale) 无默认值，grayscale() 会写入 NaN 矩阵导致全黑，黑白用 blackAndWhite(false)
    const setMatrix = (m: number[]) => {
      cmf.matrix = m as unknown as import('pixi.js').ColorMatrix
    }
    switch (key) {
      case 'blackwhite':
        cmf.blackAndWhite(false)
        break
      case 'sepia':
        cmf.sepia(false)
        break
      case 'warm':
        setMatrix([1.12, 0, 0, 0, 0, 0, 1.02, 0, 0, 0, 0, 0, 0.86, 0, 0, 0, 0, 0, 1, 0])
        break
      case 'cool':
        setMatrix([0.88, 0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, 1.14, 0, 0, 0, 0, 0, 1, 0])
        break
      case 'vintage':
        cmf.sepia(false)
        cmf.saturate(0.7, true)
        break
      case 'none':
        break
    }
    return cmf
  }

  const ro = new ResizeObserver(() => {
    if (!host.isConnected) return
    app.renderer.resize(host.clientWidth || 240, host.clientHeight || 132)
    fit()
    app.render()
  })
  ro.observe(host)

  let destroyed = false
  return {
    apply(key: FilterKey) {
      sprite.filters = key === 'none' ? null : [buildFilter(key)]
      app.render()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      ro.disconnect()
      sprite.destroy()
      texture.destroy(true)
      // v8：第一参 renderer 选项，第二参 stage DestroyOptions
      app.destroy({ removeView: true }, { children: true })
    }
  }
}

/** 滤镜片段入轨的默认时长（秒） */
const FILTER_CLIP_DURATION = 3

export function renderFilterPanel(ctx: PanelCtx): () => void {
  const { panel, data, esc, hint, toast, addTrack, commit, showItemMenu, renameItem, deleteItem } = ctx

  /** pixi 就绪前用户已选中的滤镜 */
  let pendingFilter: FilterKey = 'none'
  let filterH: FilterPreviewHandle | null = null
  /** 切走 tab 后异步初始化才返回：直接销毁，不再写回面板 */
  let disposed = false

  const stage = document.createElement('div')
  stage.className = 'ed-filter-stage'
  stage.innerHTML = `<span class="ed-filter-loading">滤镜预览加载中…</span>`
  panel.appendChild(stage)

  function filterThumb(f: FilterItem): HTMLElement {
    // 单元内含 ＋ 按钮，不能用 <button> 嵌套 <button>，改用 div + cursor:pointer
    const cell = document.createElement('div')
    cell.className = 'ed-filter-cell'
    cell.dataset.filter = f.filter
    cell.innerHTML = `
      <img class="ed-filter-thumb" src="${esc(f.thumb)}" alt="${esc(f.name)}" loading="lazy" />
      <button type="button" class="ed-corner-addbtn ed-filter-addbtn" title="添加到时间轴">＋</button>
      <span class="ed-filter-name">${esc(f.name)}</span>`
    if (f.filter === 'none') cell.classList.add('selected')
    // 点击单元本身：选中并在预览画面实时调色
    cell.addEventListener('click', () => {
      panel.querySelectorAll('.ed-filter-cell').forEach(el => el.classList.remove('selected'))
      cell.classList.add('selected')
      pendingFilter = f.filter
      filterH?.apply(f.filter)
    })
    // ＋ 加入滤镜轨（layer 5），不改变当前选中态
    cell.querySelector<HTMLButtonElement>('.ed-filter-addbtn')!.addEventListener('click', e => {
      e.stopPropagation()
      addTrack({
        type: 'filter',
        name: f.name,
        duration: FILTER_CLIP_DURATION,
        materialId: f.id,
        source: { name: f.name, filter: f.filter, thumb: f.thumb, duration: FILTER_CLIP_DURATION }
      })
      toast('已添加到时间轴')
    })
    // 右键：重命名 / 删除
    cell.addEventListener('contextmenu', e => {
      showItemMenu(e, {
        name: f.name,
        onRename: next => {
          f.name = next
          renameItem(f.id, next)
          commit()
          renderGrid()
        },
        onDelete: () => {
          data.filter = data.filter.filter(x => x.id !== f.id)
          if (pendingFilter === f.filter) {
            pendingFilter = 'none'
            filterH?.apply('none')
          }
          deleteItem(f.id)
          commit()
          renderGrid()
        }
      })
    })
    return cell
  }

  const grid = document.createElement('div')
  grid.className = 'ed-filter-grid'
  panel.appendChild(grid)

  function renderGrid() {
    grid.innerHTML = ''
    data.filter.forEach(f => grid.appendChild(filterThumb(f)))
  }
  renderGrid()
  panel.appendChild(hint('点缩略图在上方预览实时调色；hover 缩略图点 ＋ 可把该滤镜作为片段添加到时间轴；右键可重命名 / 删除。'))

  void createFilterPreview(stage).then(h => {
    if (disposed) {
      h?.destroy()
      return
    }
    if (!h) {
      stage.textContent = '滤镜预览不可用（pixi 初始化失败）'
      return
    }
    stage.querySelector('.ed-filter-loading')?.remove()
    filterH = h
    h.apply(pendingFilter)
  })

  return () => {
    disposed = true
    filterH?.destroy()
    filterH = null
  }
}
