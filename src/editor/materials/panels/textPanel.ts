/* ============================================================
 *  素材库 · 面板三：文本
 *  - 预设样式：T 字色卡（纯填充 / 描边 / 底色板 / 硬投影），仅负责选择样式，
 *    默认选中首张「无样式」；选中后点下方【添加文本】按钮入轨；
 *  - 花字效果：霓虹 / 高能时刻等多层发光与粗描边示例卡（系统字体，
 *    不依赖 web 字体），hover 右下角 ＋ 添加。
 *  所有预设预览（内联 SVG）与入轨后播放器光栅化共用同一套描述，
 *  描边 / 多层发光所见即所得。
 * ============================================================ */
import type { PanelCtx } from '../materialsPanel'
import { NONE_SWATCH_SVG } from '../../utils/icons'
import { t } from '../../lang'
import {
  TEXT_FX_PRESETS,
  TEXT_SWATCHES,
  localizedPresetContent,
  localizedPresetName,
  presetPreviewSvg,
  presetToTextContent,
  type TextStylePreset
} from '../presets/textPresets'

/** 文本片段入轨的默认时长（秒） */
const TEXT_CLIP_DURATION = 3

/** 无样式预设入轨时的素材 id（与内建默认文本一致，名称按语言生成） */
const PLAIN_ID = 't-default'

export function renderTextPanel(ctx: PanelCtx): void {
  const { panel, esc, groupTitle, hint, toast, addTrack } = ctx

  /** 当前选中的样式预设（null＝无样式 / 默认白字），默认选中首张 */
  let active: TextStylePreset | null = null

  // ---------- 预设样式：T 字色卡（只选择、不直接添加） ----------
  panel.appendChild(groupTitle('预设样式'))
  const swatchGrid = document.createElement('div')
  swatchGrid.className = 'ed-tswatch-grid'
  const tiles: HTMLButtonElement[] = []

  function markActive(tile: HTMLButtonElement): void {
    tiles.forEach(t => t.classList.toggle('is-active', t === tile))
  }

  function swatchTile(p: TextStylePreset | null): HTMLButtonElement {
    const tile = document.createElement('button')
    tile.type = 'button'
    tile.className = 'ed-tswatch'
    if (!p) {
      // 无样式：禁止符，添加默认白字
      tile.classList.add('is-none', 'is-active')
      tile.title = '无样式（默认白字）'
      tile.innerHTML = NONE_SWATCH_SVG
    } else {
      tile.title = p.name
      if (p.tileBg) tile.style.backgroundColor = p.tileBg
      // 与播放器同管线生成的内联 SVG（矢量描边 / 投影，缩放不糊）
      tile.innerHTML = presetPreviewSvg(p)
    }
    tile.addEventListener('click', () => {
      active = p
      markActive(tile)
    })
    tiles.push(tile)
    return tile
  }

  swatchGrid.appendChild(swatchTile(null))
  TEXT_SWATCHES.forEach(p => swatchGrid.appendChild(swatchTile(p)))
  panel.appendChild(swatchGrid)

  // ---------- 添加文本：按当前选中样式入轨 ----------
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'ed-text-add'
  addBtn.textContent = '添加文本'
  addBtn.addEventListener('click', () => {
    const plainText = t('text.newText')
    if (!active) {
      addTrack({
        type: 'text',
        name: plainText,
        duration: TEXT_CLIP_DURATION,
        materialId: PLAIN_ID,
        source: presetToTextContent({
          id: PLAIN_ID,
          name: plainText,
          thumb: 'T',
          content: plainText,
          fs: 48,
          color: '#ffffff'
        })
      })
      toast(`已添加「${plainText}」`)
      return
    }
    const presetName = localizedPresetName(active)
    const source = presetToTextContent(active)
    source.content = plainText
    addTrack({
      type: 'text',
      name: presetName,
      duration: TEXT_CLIP_DURATION,
      materialId: active.id,
      source
    })
    toast(`已添加文本（${presetName}）`)
  })
  panel.appendChild(addBtn)

  // ---------- 花字效果：示例卡 + hover ＋（系统字体的多层发光 / 粗描边） ----------
  const fxTitle = groupTitle('花字效果')
  fxTitle.classList.add('is-gap')
  panel.appendChild(fxTitle)
  const fxWrap = document.createElement('div')
  fxWrap.className = 'ed-tpl-grid'

  TEXT_FX_PRESETS.forEach(p => {
    const card = document.createElement('div')
    card.className = 'ed-tpl-card'
    const preview = document.createElement('div')
    preview.className = 'ed-tpl-preview'
    preview.innerHTML = presetPreviewSvg(p)

    const foot = document.createElement('div')
    foot.className = 'ed-tpl-foot'
    foot.innerHTML = `<span class="name">${esc(p.name)}</span><span class="sub">${esc(p.sub ?? '')}</span>`

    const fxAddBtn = document.createElement('button')
    fxAddBtn.type = 'button'
    fxAddBtn.className = 'ed-tpl-addbtn'
    fxAddBtn.title = '添加到时间轴'
    fxAddBtn.textContent = '＋'
    fxAddBtn.addEventListener('click', () => {
      const presetName = localizedPresetName(p)
      const source = presetToTextContent(p)
      source.content = localizedPresetContent(p)
      addTrack({
        type: 'text',
        name: presetName,
        duration: TEXT_CLIP_DURATION,
        materialId: p.id,
        source
      })
      toast(`已添加「${presetName}」`)
    })

    card.appendChild(preview)
    card.appendChild(foot)
    card.appendChild(fxAddBtn)
    fxWrap.appendChild(card)
  })
  panel.appendChild(fxWrap)

  panel.appendChild(hint('先在预设样式中选择一款，再点「添加文本」加入时间轴；花字效果点卡片右下角 ＋ 添加。'))
}
