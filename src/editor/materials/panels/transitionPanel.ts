/* ============================================================
 *  素材库 · 面板八：转场（帧动画 + 画面调整）
 *  能力暂未实现：空状态提示 + 条目卡片点击 toast；右键可重命名 / 删除。
 * ============================================================ */
import { tabIcon } from '../../utils/icons'
import type { PanelCtx } from '../materialsPanel'

const LABEL = '转场'

export function renderTransitionPanel(ctx: PanelCtx): void {
  const { panel, data, esc, toast, commit, showItemMenu, renameItem, deleteItem } = ctx

  const empty = document.createElement('div')
  empty.className = 'ed-empty'
  empty.innerHTML = `
    <div class="ed-empty-ic">${tabIcon('transition', 34)}</div>
    <div class="ed-empty-name">${LABEL}功能未实现</div>
    <div class="ed-empty-sub">${LABEL}将采用帧动画 + 画面调整实现<br />该能力将在后续版本提供</div>`
  panel.appendChild(empty)

  const grid = document.createElement('div')
  grid.className = 'ed-soon-grid'

  function renderGrid() {
    grid.innerHTML = ''
    data.transition.forEach(it => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'ed-soon-card'
      card.innerHTML = `<span class="ed-soon-name">${esc(it.name)}</span><span class="ed-soon-tag">未实现</span>`
      card.addEventListener('click', () => toast(`「${it.name}」功能未实现`))
      card.addEventListener('contextmenu', e => {
        showItemMenu(e, {
          name: it.name,
          onRename: next => {
            it.name = next
            renameItem(it.id, next)
            commit()
            renderGrid()
          },
          onDelete: () => {
            data.transition = data.transition.filter(x => x.id !== it.id)
            deleteItem(it.id)
            commit()
            renderGrid()
          }
        })
      })
      grid.appendChild(card)
    })
  }

  renderGrid()
  panel.appendChild(grid)
}
