/* ============================================================
 *  编辑器框架 · 模块一：左侧素材库（选项卡外壳 + 分发聚合）
 *
 *  八个类型面板各自独立成文件（panels/ 目录）：
 *    material   → panels/materialPanel.ts    视频/图片/动图
 *    audio      → panels/audioPanel.ts       音乐/音效，行内试听
 *    text       → panels/textPanel.ts        默认文本 + 模板文本
 *    caption    → panels/captionPanel.ts     srt 原文 / ass 样式化预览
 *    sticker    → panels/stickerPanel.ts     背景透明动态贴纸
 *    filter     → panels/filterPanel.ts      pixi 调色实时预览
 *    effect     → panels/effectPanel.ts      未实现提示
 *    transition → panels/transitionPanel.ts  未实现提示
 *
 *  本文件只保留：选项卡轨道（图标在上文字在下、溢出翻转）、
 *  面板共享 DOM 工具（esc / toast / overlay / 灯箱 / 标题 / 提示）、
 *  当前面板生命周期（音频试听停止、pixi 销毁）的统一调度。
 *  点击视频素材 → 通过 onLoad 回调请求播放器载入。
 * ============================================================ */
import type { MaterialsData, MaterialItem, AudioKind, CaptionCue, CaptionItem, TrackObjectType, TrackSourceMap } from '../types'
import { tabIcon, chevronsDouble } from '../utils/icons'
import { createFilePicker } from './panels/upload'
import { renderMaterialPanel, clearMaterialVideoCache, pruneMaterialVideoCache } from './panels/materialPanel'
import { renderAudioPanel } from './panels/audioPanel'
import { renderTextPanel } from './panels/textPanel'
import { renderCaptionPanel } from './panels/captionPanel'
import { renderStickerPanel } from './panels/stickerPanel'
import { renderFilterPanel } from './panels/filterPanel'
import { renderEffectPanel } from './panels/effectPanel'
import { renderTransitionPanel } from './panels/transitionPanel'

export interface MaterialsPanelHandle {
  /** 替换素材数据并重绘当前选项卡 */
  setMaterials: (data: MaterialsData) => void
  /** 清除素材选中态（不重绘；同步通知 onSelect(null)） */
  clearSelection: () => void
  destroy: () => void
}

/** 八个类型面板渲染函数的统一签名：返回值可选，用于切走时清理（停试听 / 销毁 pixi） */
export type PanelRenderer = (ctx: PanelCtx) => (() => void) | void

/**
 * 加入时间轴的载荷（start / 轨道 id 由编排层自动处理）：
 * 描述"素材库哪一项、以什么内容信息插入"，对应轨道对象的一个子项。
 */
export interface AddTrackPayload<T extends TrackObjectType = TrackObjectType> {
  /** 轨道类型：素材库哪一项插入进来了 */
  type: T
  /** 子项显示名称 */
  name: string
  /** 持续时长（秒） */
  duration: number
  /** 关联的素材库素材 id（文本等无素材实体可省略） */
  materialId?: string
  /** 内容信息（参考 asconfig 各 *TrackDB.source，字段随 type 而定） */
  source: TrackSourceMap[T]
}

/** 抹去泛型后的联合，便于内部统一传递 */
export type AnyAddTrackPayload = { [K in TrackObjectType]: AddTrackPayload<K> }[TrackObjectType]

/** createMaterialsPanel 的可选外部回调 */
export interface MaterialsPanelOptions {
  /** 素材数据在面板内发生变更（上传 / 提取）：外部负责落盘与详情刷新 */
  onChange?: (data: MaterialsData) => void
  /** 素材库「添加到时间轴」（卡片 ＋ / 文本按钮 / 音频行 / 字幕行 / 贴纸 / 滤镜） */
  onAddTrack?: (payload: AnyAddTrackPayload) => void
  /**
   * 字幕文件入轨：按文件内对白区间批量生成字幕片段（一条 cue 一个片段），
   * 共用同一条字幕轨、一次落盘。
   */
  onAddCaptionClips?: (item: CaptionItem, cues: CaptionCue[], raw: string) => void
  /**
   * 音频试听状态变化：
   *   el 非空 = 开始试听（元素尚未 play，调用方可在手势栈内 createMediaElementSource 接管路由）；
   *   null   = 停止（手动 / 播完 / 切分类 / 面板销毁）。kind 为该条素材的分类。
   */
  onAudition?: (el: HTMLAudioElement | null, kind: AudioKind) => void
  /**
   * 素材选中变化：m 非空 = 选中并在播放器预览该素材；null = 取消选中。
   * 点击空白 / 点击其他素材 / 外部取消都会触发。
   */
  onSelect?: (m: MaterialItem | null) => void
  /** 子项重命名后同步外部（时间轴片段名 / 预览标题等） */
  onRenameItem?: (id: string, name: string) => void
  /** 子项删除后同步外部（清理引用它的时间轴片段 / 预览） */
  onDeleteItem?: (id: string) => void
  /** 只展示指定选项卡（缺省展示全部）；顺序按传入顺序 */
  tabs?: MaterialTabKey[]
}

/** 子项右键菜单回调：重命名 / 删除由各面板自己改数据并重绘 */
export interface ItemMenuOptions {
  /** 当前显示名（重命名输入框初值） */
  name: string
  onRename: (name: string) => void
  onDelete: () => void
}

export interface PanelCtx {
  /** 面板内容容器（每次切换会被清空） */
  panel: HTMLElement
  /** 当前素材数据（setMaterials 后随重绘传入最新值；面板可直接就地变更） */
  data: MaterialsData
  /** 点击视频素材：请求播放器载入 */
  onLoad: (m: MaterialItem) => void
  /** HTML 转义 */
  esc: (s: string) => string
  /** 轻提示（1.6s 自动消失） */
  toast: (msg: string) => void
  /** 弹窗覆盖层，返回关闭函数（点击遮罩也可关闭） */
  showOverlay: (box: HTMLElement) => () => void
  /** 灯箱：放大查看图片 / 动图 */
  openLightbox: (url: string, name: string) => void
  /** 子项右键菜单（重命名 / 删除） */
  showItemMenu: (e: MouseEvent, opts: ItemMenuOptions) => void
  /** 重命名成功后的外部同步（时间轴同名片段 / 预览标题） */
  renameItem: (id: string, name: string) => void
  /** 删除后的外部同步（时间轴引用清理） */
  deleteItem: (id: string) => void
  /** 分组小标题 */
  groupTitle: (text: string) => HTMLElement
  /** 行尾说明文字 */
  hint: (text: string, marginTop?: number) => HTMLElement
  /** 打开本地文件选择器（input 常驻，可重复选择） */
  pickFiles: (accept: string, multiple?: boolean) => Promise<File[]>
  /** 面板就地变更数据后提交：外部落盘 + 刷新详情（不重绘当前面板） */
  commit: () => void
  /** 把素材库子项添加到对应类型轨道的末尾 */
  addTrack: (payload: AnyAddTrackPayload) => void
  /** 字幕文件按对白区间批量入轨（一条 cue 一个字幕片段；raw 为文件原文，供按画布比例换算 ass 样式） */
  addCaptionClips: (item: CaptionItem, cues: CaptionCue[], raw: string) => void
  /** 音频试听开始 / 停止（见 MaterialsPanelOptions.onAudition） */
  onAudition?: (el: HTMLAudioElement | null, kind: AudioKind) => void
  /** 当前选中的素材 id（素材面板用于高亮） */
  selectedId: string | null
  /** 素材选中 / 取消（选中后在播放器预览） */
  onSelect: (m: MaterialItem | null) => void
}

const TABS = [
  { k: 'material', label: '素材' },
  { k: 'audio', label: '音频' },
  { k: 'text', label: '文本' },
  { k: 'caption', label: '字幕' },
  { k: 'sticker', label: '贴纸' },
  { k: 'filter', label: '滤镜' },
  { k: 'effect', label: '特效' },
  { k: 'transition', label: '转场' }
] as const
export type MaterialTabKey = (typeof TABS)[number]['k']
type TabKey = MaterialTabKey

/** 选项卡 → 对应面板渲染函数 */
const PANEL_RENDERERS: Record<TabKey, PanelRenderer> = {
  material: renderMaterialPanel,
  audio: renderAudioPanel,
  text: renderTextPanel,
  caption: renderCaptionPanel,
  sticker: renderStickerPanel,
  filter: renderFilterPanel,
  effect: renderEffectPanel,
  transition: renderTransitionPanel
}

/** 转义文本，安全插入 innerHTML */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function createMaterialsPanel(
  tabsEl: HTMLElement,
  panelEl: HTMLElement,
  initial: MaterialsData,
  onLoad: (m: MaterialItem) => void,
  options: MaterialsPanelOptions = {}
): MaterialsPanelHandle {
  let data: MaterialsData = initial
  let activeTab: TabKey = 'material'
  /** 当前允许展示的选项卡（外部可通过 options.tabs 只开前四项等） */
  const availableTabs = (() => {
    const wanted = options.tabs?.filter(k => TABS.some(t => t.k === k))
    return wanted && wanted.length > 0 ? TABS.filter(t => wanted.includes(t.k)) : [...TABS]
  })()
  if (!availableTabs.some(t => t.k === activeTab)) activeTab = availableTabs[0]!.k
  /** 当前面板的清理函数（音频停止试听 / 滤镜销毁 pixi） */
  let panelCleanup: (() => void) | null = null
  /** 素材选中态（跨 tab / 重绘保留；点击空白 / 外部取消时清空） */
  let selectedMaterialId: string | null = null

  /** 更新选中态 + 高亮（不重绘，避免打断滚动 / 输入）并通知外部 */
  function setMaterialSelection(m: MaterialItem | null) {
    selectedMaterialId = m?.id ?? null
    panelEl.querySelectorAll<HTMLElement>('.ed-clip').forEach(el => {
      el.classList.toggle('is-selected', selectedMaterialId !== null && el.dataset.id === selectedMaterialId)
    })
    options.onSelect?.(m)
  }

  const overlayRoot = panelEl.getRootNode() as HTMLElement | ShadowRoot

  // ---------- 选项卡按钮（图标在上、文字在下；固定间距，溢出时右侧出现方向切换） ----------
  tabsEl.innerHTML = `
    <div class="ed-tabs-track">
      ${availableTabs
        .map(
          t =>
            `<button type="button" class="ed-tab" data-tab="${t.k}">${tabIcon(t.k)}<span class="ed-tab-tx">${t.label}</span></button>`
        )
        .join('')}
    </div>
    <button type="button" class="ed-tabs-more" hidden title="切换排列方向">${chevronsDouble()}</button>
  `
  const trackEl = tabsEl.querySelector<HTMLElement>('.ed-tabs-track')!
  const moreBtn = tabsEl.querySelector<HTMLButtonElement>('.ed-tabs-more')!
  /** dir=false：从左向右（默认，展示最左侧选项卡）；dir=true：从右向左（展示最右侧） */
  let rtlDir = false

  /** 内容放不下时显示方向按钮，并把轨道平移到对应端 */
  function updateOverflow() {
    const MORE_W = 26
    const contentW = trackEl.scrollWidth
    const fullW = tabsEl.clientWidth
    const overflow = contentW - fullW > 1
    moreBtn.hidden = !overflow
    const avail = overflow ? fullW - MORE_W : fullW
    const maxShift = Math.max(0, contentW - avail)
    trackEl.style.transform = rtlDir ? `translateX(${-maxShift}px)` : 'translateX(0)'
    moreBtn.classList.toggle('at-right', rtlDir)
  }
  moreBtn.addEventListener('click', () => {
    rtlDir = !rtlDir
    updateOverflow()
  })
  const resizeObs = new ResizeObserver(updateOverflow)
  resizeObs.observe(tabsEl)

  function renderTabs() {
    tabsEl.querySelectorAll('.ed-tab').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === activeTab)
    })
  }

  // ---------- 面板共享：弹窗覆盖层 / 轻提示 ----------
  function showOverlay(box: HTMLElement): () => void {
    const ov = document.createElement('div')
    ov.className = 'ed-overlay'
    ov.appendChild(box)
    overlayRoot.appendChild(ov)
    const close = () => ov.remove()
    ov.addEventListener('click', e => {
      if (e.target === ov) close()
    })
    return close
  }

  function toast(msg: string) {
    const t = document.createElement('div')
    t.className = 'ed-toast'
    t.textContent = msg
    overlayRoot.appendChild(t)
    requestAnimationFrame(() => t.classList.add('show'))
    window.setTimeout(() => {
      t.classList.remove('show')
      window.setTimeout(() => t.remove(), 250)
    }, 1600)
  }

  function groupTitle(text: string): HTMLElement {
    const d = document.createElement('div')
    d.className = 'ed-group-title'
    d.textContent = text
    return d
  }

  function hint(text: string, marginTop = 4): HTMLElement {
    const p = document.createElement('p')
    p.className = 'ed-hint'
    p.style.marginTop = marginTop + 'px'
    p.textContent = text
    return p
  }

  // ---------- 灯箱：放大查看图片 / 动图 ----------
  function openLightbox(url: string, name: string) {
    const box = document.createElement('div')
    box.className = 'ed-overlay-box ed-lightbox'
    box.innerHTML = `
      <button type="button" class="ed-overlay-x" title="关闭">✕</button>
      <img class="ed-lightbox-img" src="${esc(url)}" alt="${esc(name)}" />
      <div class="ed-lightbox-name">${esc(name)}</div>`
    const close = showOverlay(box)
    box.querySelector('.ed-overlay-x')!.addEventListener('click', close)
    box.querySelector('img')!.addEventListener('click', e => e.stopPropagation())
  }

  // 文件选择 input 挂在不会被清空的 tabsEl 上，跨 tab 复用（须在 innerHTML 赋值之后创建）
  const filePicker = createFilePicker(tabsEl)

  // ---------- 子项右键菜单：重命名 / 删除 ----------
  let ctxMenuEl: HTMLElement | null = null
  let ctxMenuCleanup: (() => void) | null = null

  function closeItemMenu() {
    ctxMenuCleanup?.()
    ctxMenuCleanup = null
    ctxMenuEl?.remove()
    ctxMenuEl = null
  }

  function showItemMenu(e: MouseEvent, opts: ItemMenuOptions) {
    e.preventDefault()
    e.stopPropagation()
    closeItemMenu()
    const menu = document.createElement('div')
    menu.className = 'ed-ctx-menu'
    menu.innerHTML = `
      <button type="button" class="ed-ctx-item" data-act="rename">重命名</button>
      <button type="button" class="ed-ctx-item" data-act="delete">删除</button>`
    overlayRoot.appendChild(menu)
    ctxMenuEl = menu

    const place = () => {
      const r = menu.getBoundingClientRect()
      const pad = 8
      menu.style.left = `${Math.max(pad, Math.min(e.clientX, window.innerWidth - r.width - pad))}px`
      menu.style.top = `${Math.max(pad, Math.min(e.clientY, window.innerHeight - r.height - pad))}px`
    }
    place()

    const onDown = (ev: PointerEvent) => {
      // Shadow DOM 内：window 捕获阶段 target 会重定向为宿主，
      // 用 composedPath 判断是否点在菜单里，避免真实鼠标按下先关菜单
      if (!ev.composedPath().includes(menu)) closeItemMenu()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeItemMenu()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    ctxMenuCleanup = () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }

    menu.querySelector('[data-act="delete"]')!.addEventListener('click', () => {
      closeItemMenu()
      opts.onDelete()
    })
    menu.querySelector('[data-act="rename"]')!.addEventListener('click', () => {
      closeItemMenu()
      openRenameDialog(opts)
    })
  }

  /** 重命名弹窗：标题 + 输入框 + 非法字符提示 + 保存 / 取消 */
  function openRenameDialog(opts: ItemMenuOptions) {
    const box = document.createElement('div')
    box.className = 'ed-rename-box'
    box.innerHTML = `
      <div class="ed-rename-head">重命名</div>
      <input class="ed-rename-input" type="text" maxlength="80" />
      <div class="ed-rename-hint">暂不支持 \\ / : * ? < > |</div>
      <div class="ed-rename-actions">
        <button type="button" class="ed-rename-save">保存</button>
        <button type="button" class="ed-rename-cancel">取消</button>
      </div>`
    const close = showOverlay(box)
    const input = box.querySelector<HTMLInputElement>('.ed-rename-input')!
    const hint = box.querySelector<HTMLElement>('.ed-rename-hint')!
    const HINT = '暂不支持 \\ / : * ? < > |'
    input.value = opts.name

    const fail = (msg: string) => {
      hint.textContent = msg
      hint.classList.add('is-error')
      input.focus()
      input.select()
    }
    const save = () => {
      const next = input.value.trim()
      if (!next) return fail('名称不能为空')
      if (/[\\/:*?"<>|]/.test(next)) return fail('名称不能包含 \\ / : * ? " < > |')
      close()
      if (next !== opts.name) opts.onRename(next)
    }
    box.querySelector('.ed-rename-save')!.addEventListener('click', save)
    box.querySelector('.ed-rename-cancel')!.addEventListener('click', close)
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        save()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    })
    input.addEventListener('input', () => {
      hint.textContent = HINT
      hint.classList.remove('is-error')
    })
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }


  // 点击素材面板空白处：取消选中（点卡片 / 导入 / 搜索框不算空白）
  panelEl.addEventListener('click', e => {
    if (selectedMaterialId === null) return
    const t = e.target as HTMLElement
    if (t.closest('.ed-clip') || t.closest('.ed-subbar') || t.closest('.ed-overlay')) return
    setMaterialSelection(null)
  })

  // ---------- 面板分发：清理上一个 → 清空 → 渲染当前 ----------
  function renderTabPanel() {
    panelCleanup?.()
    panelCleanup = null
    panelEl.innerHTML = ''
    const ctx: PanelCtx = {
      panel: panelEl,
      data,
      onLoad,
      esc,
      toast,
      showOverlay,
      openLightbox,
      groupTitle,
      hint,
      pickFiles: filePicker.pick,
      commit: () => options.onChange?.(data),
      showItemMenu,
      renameItem: (id, name) => options.onRenameItem?.(id, name),
      deleteItem: id => options.onDeleteItem?.(id),
      addTrack: op => options.onAddTrack?.(op),
      addCaptionClips: (item, cues, raw) => options.onAddCaptionClips?.(item, cues, raw),
      onAudition: (el, kind) => options.onAudition?.(el, kind),
      selectedId: selectedMaterialId,
      onSelect: m => setMaterialSelection(m)
    }
    panelCleanup = PANEL_RENDERERS[activeTab](ctx) ?? null
  }

  tabsEl.querySelectorAll<HTMLButtonElement>('.ed-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      // 切换素材分类视为离开当前素材预览
      if (selectedMaterialId !== null) setMaterialSelection(null)
      activeTab = btn.getAttribute('data-tab') as TabKey
      renderTabs()
      renderTabPanel()
    })
  })

  renderTabs()
  renderTabPanel()
  updateOverflow()

  return {
    setMaterials(next: MaterialsData) {
      data = next
      pruneMaterialVideoCache(new Set(next.material.map(m => m.id)))
      renderTabPanel()
    },
    clearSelection() {
      if (selectedMaterialId !== null) setMaterialSelection(null)
    },
    destroy() {
      panelCleanup?.()
      panelCleanup = null
      resizeObs.disconnect()
      clearMaterialVideoCache()
      tabsEl.innerHTML = ''
      panelEl.innerHTML = ''
    }
  }
}

export default createMaterialsPanel
