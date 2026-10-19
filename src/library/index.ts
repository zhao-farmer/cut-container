/* ============================================================
 *  对外发布入口（npm / CDN）
 *  - 副作用：自动注册 <cut-container> 自定义元素
 *  - 导出编辑器工厂、元素类与原生示例数据
 *  - `mountEditor(host, props)`：CDN 一行挂载的便捷方法
 * ============================================================ */
import { CutContainer } from '../cutContainer'
import createEditorPage from '../editor/editorPage'
import { MATERIALS, TRACKS, DRAFT_TITLE } from '../parent-demos/externalData'
import type { Lang } from '../editor/lang'
import { setBackendConfig } from '../editor/services/backend'

export { CutContainer } from '../cutContainer'
export { defineCutContainer, registerAdapter } from '../cutContainer'
export { createEditorPage }
export { MATERIALS, TRACKS, DRAFT_TITLE }
// 语言：默认中文；setLang('en') 后挂载即为英文界面（也可 mountEditor(host,{ lang:'en' })）
export { getLang, setLang, t } from '../editor/lang'
export type { Lang } from '../editor/lang'

export type CutContainerElement = CutContainer

/** 原生示例的默认 props（空工程；素材目录由后端可选提供） */
export const demoProps = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }

/**
 * 便捷挂载：把编辑器挂到任意容器（不传容器里的 <cut-container> 时自动创建）。
 * 返回 <cut-container> 元素，便于后续调用 update / 事件监听。
 */
export async function mountEditor(
  host: HTMLElement,
  props: Record<string, any> = {}
): Promise<CutContainerElement> {
  let el = (host.matches('cut-container') ? host : host.querySelector('cut-container')) as CutContainerElement | null
  if (!el) {
    el = document.createElement('cut-container') as CutContainerElement
    el.style.display = 'block'
    el.style.width = '100%'
    el.style.height = '100%'
    host.appendChild(el)
  }
  el.props = { ...demoProps, ...props }
  await el.mount('dom', createEditorPage)
  return el
}

/** 外部用户配置（可来自 JSON URL / 对象；未知字段忽略） */
export interface EditorUserConfig {
  title?: string
  materials?: Record<string, any>
  tracks?: any[]
  lang?: Lang
  /** 素材库选项卡（如只展示前四项） */
  tabs?: string[]
  /**
   * 可选后端配置，等价于 window.CUT_CONTAINER_CONFIG。
   * 支持 endpoints / 扁平 URL 字段：
   * { enabled, baseUrl, timeoutMs, endpoints: { catalog, upload, delete, config } }
   */
  backend?: Record<string, any>
}

export interface CreateEditorAppOptions {
  /** 容器元素或 CSS 选择器 */
  host: string | HTMLElement
  /** 初始配置；传 URL 时由 mount() 自动加载 */
  config?: EditorUserConfig | string
  lang?: Lang
  /** 初始素材库选项卡 */
  tabs?: string[]
  fetchOptions?: RequestInit
  /** 导入轨道配置：mount 前 / 调用 importTracks() 时执行 */
  onImportTracks?: () =>
    | EditorUserConfig
    | any[]
    | null
    | undefined
    | Promise<EditorUserConfig | any[] | null | undefined>
  /** 导出轨道配置：调用 exportTracks() 时执行 */
  onExportTracks?: (config: EditorUserConfig) => void | Promise<void>
}

export interface EditorAppHandle {
  /** 加载外部配置（URL 或对象）；可多次调用逐层合并 */
  loadConfig: (source: string | EditorUserConfig) => Promise<EditorUserConfig>
  /** 配置加载完成后执行挂载 */
  mount: (overrides?: EditorUserConfig) => Promise<CutContainerElement>
  /** 执行 onImportTracks 并更新当前工程 */
  importTracks: () => Promise<EditorUserConfig | null>
  /** 读取当前工程并执行 onExportTracks */
  exportTracks: () => Promise<EditorUserConfig>
  unmount: () => void
  getConfig: () => EditorUserConfig
  readonly element: CutContainerElement | null
}

function normalizeUserConfig(raw: unknown): EditorUserConfig {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  // 兼容编辑器导出的 { app, version, title, materials, tracks } 与 { editor: {...} }
  const data = (root.editor && typeof root.editor === 'object' ? root.editor : root) as Record<string, any>
  const out: EditorUserConfig = {}
  if (typeof data.title === 'string') out.title = data.title
  if (data.materials && typeof data.materials === 'object') out.materials = data.materials
  if (Array.isArray(data.tracks)) out.tracks = data.tracks
  if (data.lang === 'zh' || data.lang === 'en') out.lang = data.lang
  else if (data.language === 'zh' || data.language === 'en') out.lang = data.language
  if (Array.isArray(data.tabs)) out.tabs = data.tabs.filter((t: unknown): t is string => typeof t === 'string')
  if (data.backend && typeof data.backend === 'object') out.backend = data.backend
  return out
}

/**
 * 创建一个「先加载外部配置、再挂载」的编辑器对象。
 *
 * ```ts
 * const app = createApp({ host: '#app' })
 * await app.loadConfig('./user-config.json')
 * await app.mount()
 * ```
 *
 * - 构造时不会执行任何挂载；
 * - loadConfig 支持 URL / 对象，可多次调用合并；
 * - mount 时才真正创建 <cut-container> 并初始化编辑器。
 */
export function createApp(options: CreateEditorAppOptions): EditorAppHandle {
  const initialUrl = typeof options.config === 'string' ? options.config : null
  let config: EditorUserConfig = typeof options.config === 'object' ? normalizeUserConfig(options.config) : {}
  if (options.lang) config.lang = options.lang
  if (options.tabs && options.tabs.length > 0) config.tabs = [...options.tabs]
  let loaded = false
  let importLoaded = false
  let element: CutContainerElement | null = null

  const resolveHost = (): HTMLElement => {
    if (typeof options.host !== 'string') return options.host
    const el = document.querySelector<HTMLElement>(options.host)
    if (!el) throw new Error(`[CutContainer] 找不到容器: ${options.host}`)
    return el
  }

  const loadConfig = async (source: string | EditorUserConfig): Promise<EditorUserConfig> => {
    let raw: unknown
    if (typeof source === 'string') {
      const res = await fetch(source, options.fetchOptions)
      if (!res.ok) throw new Error(`[CutContainer] 配置加载失败 (${res.status}): ${source}`)
      raw = await res.json()
    } else {
      raw = source
    }
    if (!raw || typeof raw !== 'object') throw new Error('[CutContainer] 配置格式无效：需要 JSON 对象')
    config = { ...config, ...normalizeUserConfig(raw) }
    loaded = true
    return { ...config }
  }

  /** 触发外部导入回调；已挂载时同步刷新编辑器 */
  const importTracks = async (): Promise<EditorUserConfig | null> => {
    if (!options.onImportTracks) return null
    const importedRaw = await options.onImportTracks()
    if (!importedRaw) return null
    const imported = normalizeUserConfig(Array.isArray(importedRaw) ? { tracks: importedRaw } : importedRaw)
    config = { ...config, ...imported }
    importLoaded = true
    if (element) {
      const patch: Record<string, any> = {}
      if (imported.title !== undefined) patch.title = imported.title
      if (imported.materials !== undefined) patch.materials = imported.materials
      if (imported.tracks !== undefined) patch.tracks = imported.tracks
      ;(element.instance as any)?.update?.(patch)
    }
    return imported
  }

  /** 读取当前工程快照并交给外部导出回调 */
  const exportTracks = async (): Promise<EditorUserConfig> => {
    const containerInstance = element?.instance as any
    // domAdapter 把编辑器 handle 放在 raw 上（instance 本身是 update/destroy 包装）
    const snapshot = (containerInstance?.raw ?? containerInstance)?.getSnapshot?.()
    const payload: EditorUserConfig = snapshot
      ? { title: snapshot.title, materials: snapshot.materials, tracks: snapshot.tracks }
      : { title: config.title, materials: config.materials, tracks: config.tracks }
    await options.onExportTracks?.(payload)
    return payload
  }

  const mount = async (overrides: EditorUserConfig = {}): Promise<CutContainerElement> => {
    if (initialUrl && !loaded) {
      await loadConfig(initialUrl)
    }
    if (Object.keys(overrides).length > 0) config = { ...config, ...normalizeUserConfig(overrides) }
    if (!importLoaded && options.onImportTracks) await importTracks()
    // 后端配置：endpoints 可覆盖固定路径；没有配置时恢复默认读取顺序
    setBackendConfig((config.backend as any) ?? null)
    const props: Record<string, any> = {}
    if (config.title !== undefined) props.title = config.title
    if (config.materials !== undefined) props.materials = config.materials
    if (config.tracks !== undefined) props.tracks = config.tracks
    if (config.lang !== undefined) props.lang = config.lang
    if (config.tabs !== undefined) props.tabs = config.tabs
    // 外部配置里带了工程数据：覆盖本地缓存，避免旧 localStorage 遮蔽新配置
    if (config.materials !== undefined || config.tracks !== undefined) props.replaceStorage = true
    element = await mountEditor(resolveHost(), props)
    return element
  }

  return {
    loadConfig,
    mount,
    importTracks,
    exportTracks,
    unmount: () => element?.unmount(),
    getConfig: () => ({ ...config }),
    get element() {
      return element
    }
  }
}
