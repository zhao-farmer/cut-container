/** CutContainer 对外类型声明（npm 使用者） */
export class CutContainer extends HTMLElement {
  props: Record<string, any>
  readonly instance: any
  readonly framework: string | null
  mount(framework: string, component: any): Promise<void>
  unmount(): void
}

export declare function defineCutContainer(tagName?: string): void
export declare function registerAdapter(framework: string, adapter: any): void
export declare function createEditorPage(rootEl: HTMLElement, props: Record<string, any>, emit: (name: string, detail: any) => void): any

export interface DemoProps {
  title: string
  materials: Record<string, any>
  tracks: any[]
}

export declare const MATERIALS: Record<string, any>
export declare const TRACKS: any[]
export declare const DRAFT_TITLE: string
export declare const demoProps: DemoProps

export declare function mountEditor(host: HTMLElement, props?: Record<string, any>): Promise<CutContainer>

export type Lang = 'zh' | 'en'
export declare function getLang(): Lang
export declare function setLang(lang: Lang): void
export declare function t(key: string, lang?: Lang): string

export interface EditorUserConfig {
  title?: string
  materials?: Record<string, any>
  tracks?: any[]
  lang?: Lang
  /** 素材库选项卡：material / audio / text / caption / sticker / filter / effect / transition */
  tabs?: string[]
  backend?: {
    enabled?: boolean
    baseUrl?: string
    timeoutMs?: number
    /** 自定义接口地址；相对路径拼 baseUrl，绝对 URL 原样使用 */
    endpoints?: {
      catalog?: string
      upload?: string
      delete?: string
      config?: string
    }
    catalogUrl?: string
    uploadUrl?: string
    deleteUrl?: string
    configUrl?: string
  }
}

export interface CreateEditorAppOptions {
  host: string | HTMLElement
  config?: EditorUserConfig | string
  lang?: Lang
  tabs?: string[]
  fetchOptions?: RequestInit
  /** 导入轨道配置：mount 前 / importTracks() 时调用；返回配置或 tracks 数组 */
  onImportTracks?: () => EditorUserConfig | any[] | null | undefined | Promise<EditorUserConfig | any[] | null | undefined>
  /** 导出轨道配置：exportTracks() 时调用 */
  onExportTracks?: (config: EditorUserConfig) => void | Promise<void>
}

export interface EditorAppHandle {
  loadConfig(source: string | EditorUserConfig): Promise<EditorUserConfig>
  mount(overrides?: EditorUserConfig): Promise<CutContainer>
  importTracks(): Promise<EditorUserConfig | null>
  exportTracks(): Promise<EditorUserConfig>
  unmount(): void
  getConfig(): EditorUserConfig
  readonly element: CutContainer | null
}

/** 先加载外部配置，再执行挂载（构造时不启动编辑器） */
export declare function createApp(options: CreateEditorAppOptions): EditorAppHandle
