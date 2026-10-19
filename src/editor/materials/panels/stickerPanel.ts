/* ============================================================
 *  素材库 · 面板五：贴纸（背景透明的动态 GIF，后端素材目录）
 *  棋盘格底衬出透明区域；hover 右下角 ＋ 添加到贴纸轨（layer 2），
 *  点击卡片本身灯箱放大预览；右键可重命名 / 删除。
 * ============================================================ */
import { extOfFile } from './upload'
import type { PanelCtx } from '../materialsPanel'

/** 贴纸入轨的默认时长（秒） */
const STICKER_CLIP_DURATION = 3

export function renderStickerPanel(ctx: PanelCtx): void {
  const { panel, data, esc, openLightbox, hint, toast, addTrack, commit, showItemMenu, renameItem, deleteItem } = ctx

  const grid = document.createElement('div')
  grid.className = 'ed-sticker-grid'

  function stickerCell(s: (typeof data.sticker)[number]): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'ed-sticker'
    cell.title = s.name
    cell.innerHTML = `
      <img class="ed-sticker-img" src="${esc(s.url)}" alt="${esc(s.name)}" loading="lazy" />
      <button type="button" class="ed-corner-addbtn ed-sticker-addbtn" title="添加到时间轴">＋</button>`
    cell.querySelector<HTMLButtonElement>('.ed-sticker-addbtn')!.addEventListener('click', e => {
      e.stopPropagation()
      addTrack({
        type: 'sticker',
        name: s.name,
        duration: STICKER_CLIP_DURATION,
        materialId: s.id,
        source: {
          url: s.url,
          name: s.name,
          format: extOfFile(s.url) || 'gif',
          duration: STICKER_CLIP_DURATION,
          width: 0,
          height: 0
        }
      })
      toast('已添加到时间轴')
    })
    cell.addEventListener('click', () => openLightbox(s.url, s.name))
    // 右键：重命名 / 删除
    cell.addEventListener('contextmenu', e => {
      showItemMenu(e, {
        name: s.name,
        onRename: next => {
          s.name = next
          renameItem(s.id, next)
          commit()
          renderGrid()
        },
        onDelete: () => {
          data.sticker = data.sticker.filter(x => x.id !== s.id)
          deleteItem(s.id)
          commit()
          renderGrid()
        }
      })
    })
    return cell
  }

  function renderGrid() {
    grid.innerHTML = ''
    data.sticker.forEach(s => grid.appendChild(stickerCell(s)))
  }

  panel.appendChild(grid)
  renderGrid()
  panel.appendChild(hint('贴纸为背景透明的动态 GIF，来自后端素材目录；hover 点 ＋ 添加到时间轴，点击卡片放大预览，右键可重命名 / 删除。', 10))
}
