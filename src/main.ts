// ============================================================
//  CutContainer - 剪映风格编辑器外壳入口
// ============================================================
//  最上方标题栏（本文件，与父框架无关）：
//    左：Vue3 / React / Svelte / SolidJS 父应用切换按钮
//    中：当前草稿文件名
//    右：文件 / 帮助 下拉菜单（纯 UI 演示）
//  标题栏下方为选中的"父应用"，父应用内部嵌入
//  <cut-container>（Web Component）加载播放器页面。
// ============================================================

import './parent-demos/parent.css'
import { getLang, setLang, type Lang } from './editor/lang'

import { createApp } from 'vue'
import { createRoot } from 'react-dom/client'
import React from 'react'
import VueParent from './parent-demos/VueParent.vue'
import ReactParent from './parent-demos/ReactParent'
import SvelteParent from './parent-demos/SvelteParent.svelte'
import SolidParent from './parent-demos/SolidParent.solid.tsx'
import { mountVanillaParent } from './parent-demos/VanillaParent'
import type { SvelteComponent } from 'svelte'
import { editorStorage, STORAGE_KEYS, isMaterialsData, isTrackObjectList } from './editor/utils/storage'
import { clearLocalMedia } from './editor/utils/localMediaStore'

type FrameworkKey = 'vue' | 'react' | 'svelte' | 'solid' | 'vanilla'

const app = document.getElementById('app')!

let currentInstance: any = null
let currentFramework: FrameworkKey | null = null

const frameworks: Record<FrameworkKey, { label: string; icon: string; color: string }> = {
  vue: { label: 'Vue3', icon: '/Vue.png', color: '#42d392' },
  react: { label: 'React', icon: '/React.png', color: '#61dafb' },
  svelte: { label: 'Svelte', icon: '/svelte.png', color: '#ff5a3c' },
  solid: { label: 'SolidJS', icon: '/SolidJS.png', color: '#a78bfa' },
  // 原生（无框架）示例：金黄色标识
  vanilla: { label: 'Vanilla', icon: '/Vanilla.png', color: '#f5c542' }
}

// ====================== 配置：导入 / 导出 / 清除缓存 ======================

/** 当前日期标签（与默认草稿名风格一致：M月D日） */
function todayLabel(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 标题栏当前草稿名（用于默认导出文件名） */
function getDraftName(): string {
  return document.querySelector<HTMLInputElement>('.ed-filename-input')?.value.trim() || '草稿'
}

/**
 * 导入 / 清除缓存后重新挂载当前父框架：
 * 容器内的编辑器会整体重建并重新水合（此时 localStorage 已更新）。
 */
function remountCurrent(): void {
  if (currentFramework) mountFramework(currentFramework, document.getElementById('demo-content')!)
}

/** 切换编辑器语言：写入本地设置后整体重挂当前父框架，让所有面板按新语言重建 */
function switchLang(lang: Lang): void {
  if (getLang() === lang) return
  setLang(lang)
  updateLangMenu()
  remountCurrent()
}

/** 语言菜单当前项打勾 */
function updateLangMenu(wrap?: HTMLElement | null): void {
  const menu = wrap ?? document.querySelector<HTMLElement>('.ed-menu-wrap[data-menu="lang"]')
  if (!menu) return
  const items = menu.querySelectorAll<HTMLElement>('.ed-menu-item')
  if (items[0]) items[0].textContent = `${getLang() === 'zh' ? '✓ ' : ''}中文`
  if (items[1]) items[1].textContent = `${getLang() === 'en' ? '✓ ' : ''}English`
}

/** 导出配置：把本地素材数据 + 时间线数据打包为 JSON 下载 */
function exportConfig(): void {
  const materials = editorStorage.loadMaterials()?.data ?? null
  const tracks = editorStorage.loadTracks()?.data ?? null
  if (!materials && (!tracks || tracks.length === 0)) {
    alert('暂无本地配置可导出')
    return
  }
  const payload = {
    app: 'cut-container-editor',
    version: 3,
    exportedAt: new Date().toISOString(),
    title: getDraftName(),
    materials,
    tracks
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `剪辑配置_${getDraftName()}_${todayLabel()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  console.log('[菜单] 配置已导出')
}

/** 导入配置：选择导出的 JSON，校验后写回 localStorage 并重载编辑器 */
function importConfig(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.hidden = true
  input.style.display = 'none'

  const cleanup = () => input.remove()
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) {
      cleanup()
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      let json: any
      try {
        json = JSON.parse(String(reader.result))
      } catch (e) {
        console.warn('[菜单] 配置文件解析失败:', e)
        alert('配置文件解析失败，请选择本应用导出的 JSON 配置文件')
        cleanup()
        return
      }
      // 与编辑器水合同一套严格形状校验，杜绝脏配置写坏本地数据
      let imported = 0
      if (isMaterialsData(json?.materials)) {
        editorStorage.saveMaterials(json.materials)
        imported += 1
      }
      if (isTrackObjectList(json?.tracks)) {
        editorStorage.saveTracks(json.tracks)
        imported += 1
      }
      if (imported === 0) {
        alert('配置文件无效：未找到可用的素材或时间线数据')
        cleanup()
        return
      }
      console.log(`[菜单] 配置导入成功（${imported}/2 项），重新加载编辑器`)
      cleanup()
      remountCurrent()
    }
    reader.onerror = () => {
      alert('配置文件读取失败')
      cleanup()
    }
    reader.readAsText(file)
  })
  // 未选择文件（取消选择器）时也要清理隐藏 input
  input.addEventListener('cancel', cleanup)

  document.body.appendChild(input)
  input.click()
}

/** 清除本地缓存：清空 localStorage + IndexedDB 本地媒体后重载编辑器，恢复框架初始演示数据 */
async function clearCache(): Promise<void> {
  if (!window.confirm('确定清除本地缓存的素材与时间线数据吗？将恢复为框架初始演示数据。')) return
  editorStorage.clear()
  await clearLocalMedia()
  console.log('[菜单] 已清除本地缓存：', STORAGE_KEYS)
  remountCurrent()
}

// ====================== 标题栏 ======================
function createTitleBar(): HTMLDivElement {
  const bar = document.createElement('div')
  bar.className = 'ed-titlebar'

  // 左：品牌 + 框架切换按钮
  const left = document.createElement('div')
  left.style.display = 'flex'
  left.style.alignItems = 'center'
  left.style.gap = '12px'
  left.innerHTML = `
    <div class="ed-fws" id="nav-buttons">
      ${(Object.keys(frameworks) as FrameworkKey[])
        .map(
          key => `
        <button class="ed-fw" data-fw="${key}" type="button">
          <img class="ed-fw-icon" src="${frameworks[key].icon}" alt="${frameworks[key].label}" />${frameworks[key].label}
        </button>`
        )
        .join('')}
    </div>
  `

  // 中：文件名（常驻无边框透明输入框，点击即可修改）
  const center = document.createElement('div')
  center.className = 'ed-filename'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.className = 'ed-filename-input'
  nameInput.value = todayLabel()
  nameInput.title = '草稿名'
  let lastValid = nameInput.value
  nameInput.addEventListener('focus', () => nameInput.select())
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') nameInput.blur()
  })
  nameInput.addEventListener('blur', () => {
    const v = nameInput.value.trim()
    nameInput.value = v || lastValid
    if (v) lastValid = v
  })
  center.appendChild(nameInput)

  // 右：文件 / 帮助 下拉
  const right = document.createElement('div')
  right.className = 'ed-menus'

  right.appendChild(
    createMenu('文件', [
      { text: '导入配置', on: () => importConfig() },
      { text: '导出配置', on: () => exportConfig() },
      { text: '导出视频', on: () => window.dispatchEvent(new CustomEvent('uc-editor:export-video')) },
      { sep: true },
      { text: '清除缓存', on: () => clearCache() }
    ])
  )
  // 语言选择：仅切换编辑器内部文案；顶部 tabs / 文件 / 帮助保持原样
  const langMenu = createMenu('语言', [
    { text: '中文', on: () => switchLang('zh') },
    { text: 'English', on: () => switchLang('en') }
  ])
  langMenu.dataset.menu = 'lang'
  right.appendChild(langMenu)
  updateLangMenu(langMenu)
  right.appendChild(
    createMenu('帮助', [
      { text: '使用文档', on: () => showModal('使用文档', USAGE_HTML) },
      { text: '关于', on: () => showModal('关于', ABOUT_HTML) }
    ])
  )

  bar.appendChild(left)
  bar.appendChild(center)
  bar.appendChild(right)
  return bar
}

interface MenuItemDef {
  text?: string
  sep?: boolean
  on?: () => void
}

/** 创建一个"按钮 + 下拉面板"，处理展开/点击外部关闭 */
function createMenu(label: string, items: MenuItemDef[]): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'ed-menu-wrap'

  const btn = document.createElement('button')
  btn.className = 'ed-menu-btn'
  btn.type = 'button'
  btn.textContent = label

  const menu = document.createElement('div')
  menu.className = 'ed-menu'
  menu.style.display = 'none'

  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div')
      sep.className = 'ed-menu-sep'
      menu.appendChild(sep)
      continue
    }
    const mi = document.createElement('div')
    mi.className = 'ed-menu-item'
    mi.textContent = it.text || ''
    mi.addEventListener('click', () => {
      it.on?.()
      closeAll()
    })
    menu.appendChild(mi)
  }

  const closeAll = () => {
    document.querySelectorAll('.ed-menu').forEach(m => ((m as HTMLElement).style.display = 'none'))
    document.querySelectorAll('.ed-menu-btn').forEach(b => b.classList.remove('open'))
  }

  btn.addEventListener('click', e => {
    e.stopPropagation()
    const isOpen = menu.style.display === 'block'
    closeAll()
    if (!isOpen) {
      menu.style.display = 'block'
      btn.classList.add('open')
    }
  })
  document.addEventListener('click', closeAll)

  wrap.appendChild(btn)
  wrap.appendChild(menu)
  return wrap
}

// ====================== 弹窗（使用文档 / 关于） ======================
const USAGE_HTML = `
  <div class="ed-doc">
    <div class="ed-doc-nav">
      <button type="button" class="ed-doc-tab is-on" data-doc-tab="start">快速上手</button>
      <button type="button" class="ed-doc-tab" data-doc-tab="keys">快捷键</button>
    </div>
    <div class="ed-doc-panes">
      <div class="ed-doc-pane is-on" data-doc-pane="start">
        <ul>
          <li><b>切换父框架</b>：顶部 Vue3 / React / Svelte / SolidJS 按钮，四种外部框架加载同一个编辑器页面。</li>
          <li><b>素材库</b>：左侧「素材 / 音频 / 文本 / 贴纸」浏览；「导入」上传本地文件，卡片悬停点 + 加入时间轴，右键可重命名 / 删除。素材与轨道自动保存在 localStorage。</li>
          <li><b>播放器</b>：mediabunny + WebCodecs 真实解码，支持播放 / 暂停 / 拖动进度；全屏播放时可用空格与方向键控制。</li>
          <li><b>时间轴</b>：pixi.js 渲染轨道与缩略格；右侧滑杆分级缩放，缩略格按帧缓存、缩放只复用不重解；拖动左 / 右 / 下分隔条调整各区域大小。</li>
          <li><b>封面设计</b>：点时间轴左侧「封面」打开。「主轨抽帧」按帧选画面（黄线定位当前帧），「上传封面」选本地图片；取景框四角等比缩放、框内拖动平移，「完成裁剪」把结果放回画布，撤销 / 恢复最多保留 5 张。</li>
          <li><b>导出</b>：<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>E</kbd> 或右上「导出视频」。封面会写入 MP4 的 <code>covr</code> 元信息（不是首帧）。</li>
          <li><b>草稿与数据</b>：右栏「草稿信息」修改名称、查看比例 / 画布宽高 / 分辨率 / 帧率；「文件」菜单导入导出配置（JSON）、清除本地缓存。</li>
          <li><b>后端模式</b>：配置 <code>backend.mode</code> 为 <code>local</code>（纯前端）/ <code>remote</code>（纯后端）/ <code>hybrid</code>（只从后端取素材，导入删除改名都留在前端）。</li>
        </ul>
      </div>

      <div class="ed-doc-pane" data-doc-pane="keys">
        <table class="ed-doc-keys">
          <tbody>
            <tr><td><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>C</kbd></td><td>复制选中的片段</td></tr>
            <tr><td><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>X</kbd></td><td>剪切选中的片段</td></tr>
            <tr><td><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>V</kbd></td><td>粘贴片段</td></tr>
            <tr><td><kbd>Delete</kbd> / <kbd>Backspace</kbd></td><td>删除选中的片段</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>选中片段前后移动一帧</td></tr>
            <tr><td><kbd>M</kbd></td><td>在播放头位置添加 / 移除标记</td></tr>
            <tr><td><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>E</kbd></td><td>导出视频</td></tr>
            <tr><td><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Backspace</kbd></td><td>清除本地素材缓存</td></tr>
            <tr><td><kbd>Space</kbd></td><td>全屏播放器中播放 / 暂停</td></tr>
            <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>全屏播放器中快退 / 快进 5 秒</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></td><td>全屏播放器中逐帧后退 / 前进</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>关闭弹窗 / 菜单，或退出文字编辑</td></tr>
          </tbody>
        </table>
        <p class="ed-doc-tip">输入框、文本域内不会触发片段编辑快捷键；全屏快捷键仅在播放器全屏时生效。</p>
      </div>
    </div>
  </div>
`
const ABOUT_HTML = `
  <div class="ed-about">
    <div class="ed-about-name">CutContainer 剪辑</div>
    <div class="ed-about-ver">版本 v1.0.0（演示版）</div>
    <ul>
      <li>多框架通用页面容器：Web Component + Shadow DOM</li>
      <li>适配外部框架：Vue3 / React / Svelte / SolidJS</li>
      <li>预览播放：mediabunny（WebCodecs 真实解码）</li>
      <li>时间轴渲染：pixi.js v8</li>
      <li>数据持久化：localStorage 版本化存储</li>
    </ul>
  </div>
`

/** 暗色风格信息弹窗：点击遮罩 / 按 Esc / 点关闭按钮均可关闭（单一关闭入口） */
function showModal(title: string, bodyHtml: string) {
  const mask = document.createElement('div')
  mask.className = 'ed-modal-mask'
  mask.innerHTML = `
    <div class="ed-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="ed-modal-head">
        <span class="ed-modal-title">${title}</span>
        <button type="button" class="ed-modal-x" aria-label="关闭">×</button>
      </div>
      <div class="ed-modal-body">${bodyHtml}</div>
      <div class="ed-modal-foot">
        <button type="button" class="ed-modal-ok">我知道了</button>
      </div>
    </div>`

  // 文档弹窗更宽一些，避免快捷键表换行
  if (mask.querySelector('.ed-doc')) mask.querySelector('.ed-modal')?.classList.add('ed-modal-doc')

  // 文档弹窗的左侧导航：点击切换面板
  mask.querySelectorAll<HTMLElement>('[data-doc-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.docTab
      mask.querySelectorAll('[data-doc-tab]').forEach(t => {
        t.classList.toggle('is-on', (t as HTMLElement).dataset.docTab === key)
      })
      mask.querySelectorAll('[data-doc-pane]').forEach(p => {
        p.classList.toggle('is-on', (p as HTMLElement).dataset.docPane === key)
      })
    })
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  function close() {
    mask.remove()
    document.removeEventListener('keydown', onKey)
  }

  mask.addEventListener('click', e => {
    if (e.target === mask) close()
  })
  mask.querySelector('.ed-modal-x')!.addEventListener('click', close)
  mask.querySelector('.ed-modal-ok')!.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(mask)
}

function createContent(): HTMLDivElement {
  const content = document.createElement('div')
  content.id = 'demo-content'
  content.style.flex = '1'
  content.style.minHeight = '0'
  content.style.display = 'flex'
  return content
}

// ====================== 框架挂载 ======================
function unmountCurrent() {
  if (!currentFramework || !currentInstance) return

  switch (currentFramework) {
    case 'vue':
      currentInstance.unmount()
      break
    case 'react':
      currentInstance.unmount()
      break
    case 'svelte':
      ;(currentInstance as SvelteComponent).$destroy()
      break
    case 'solid':
      if (typeof currentInstance === 'function') {
        currentInstance()
      }
      break
    case 'vanilla':
      if (typeof currentInstance === 'function') {
        currentInstance()
      }
      break
  }
  currentInstance = null
  currentFramework = null
}

function mountFramework(fw: FrameworkKey, container: HTMLElement) {
  unmountCurrent()
  container.innerHTML = ''
  currentFramework = fw

  const appEl = document.createElement('div')
  appEl.id = 'app-root'
  appEl.style.width = '100%'
  appEl.style.height = '100%'
  container.appendChild(appEl)

  switch (fw) {
    case 'vue': {
      const instance = createApp(VueParent)
      instance.mount(appEl)
      currentInstance = instance
      break
    }
    case 'react': {
      const root = createRoot(appEl)
      root.render(React.createElement(ReactParent))
      currentInstance = root
      break
    }
    case 'svelte': {
      const comp = new SvelteParent({ target: appEl })
      currentInstance = comp
      break
    }
    case 'solid': {
      import('solid-js/web').then(({ render }) => {
        const dispose = render(() => SolidParent(), appEl)
        currentInstance = dispose
      })
      break
    }
    case 'vanilla': {
      currentInstance = mountVanillaParent(appEl)
      break
    }
  }

  updateActiveButton(fw)
}

function updateActiveButton(fw: FrameworkKey) {
  const buttons = document.querySelectorAll('#nav-buttons button')
  buttons.forEach(btn => {
    const btnFw = btn.getAttribute('data-fw') as FrameworkKey
    if (btnFw === fw) {
      btn.classList.add('active')
      ;(btn as HTMLElement).style.borderColor = frameworks[fw].color
      ;(btn as HTMLElement).style.color = frameworks[fw].color
    } else {
      btn.classList.remove('active')
      ;(btn as HTMLElement).style.borderColor = ''
      ;(btn as HTMLElement).style.color = ''
    }
  })
}

// ====================== 启动 ======================
app.appendChild(createTitleBar())
const content = createContent()
app.appendChild(content)

document.querySelectorAll('#nav-buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    const fw = btn.getAttribute('data-fw') as FrameworkKey
    if (fw && fw !== currentFramework) {
      mountFramework(fw, content)
    }
  })
})

// 默认挂载 Vue
mountFramework('vue', content)

;(window as any).__ucDemo = {
  mount: (fw: FrameworkKey) => {
    mountFramework(fw, content)
  },
  get current() {
    return currentFramework
  }
}

console.log('已就绪', 'color:#18b9d4;font-size:14px;font-weight:bold;')
console.log('切换父应用框架：__ucDemo.mount("vue" | "react" | "svelte" | "solid" | "vanilla")')
