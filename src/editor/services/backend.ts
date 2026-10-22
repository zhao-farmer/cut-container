/* ============================================================
 *  编辑器 · 可选后端服务层
 *
 *  接口地址来自 public/app-config.json（运行时可改，无需重新构建）：
 *    { "backend": { "mode": "hybrid", "baseUrl": "http://localhost:3001", "timeoutMs": 8000 } }
 *
 *  mode 三档（详见 BackendMode）：
 *    local  纯前端          —— 所有后端函数直接返回空，不产生任何网络请求
 *    remote 纯后端          —— 目录 / 上传 / 删除 / 重命名全部走后端
 *    hybrid 只从后端取资源  —— 目录与配置走 GET，写操作（上传 / 删除 / 重命名）留在前端
 *  （旧配置只写 enabled=true 时按 remote 处理，行为与升级前一致。）
 *  后端项目见 E:\2026study\imitate-node。
 * ============================================================ */

/** 后端支持的素材类型 */
export type AssetKind =
  | 'video'
  | 'image'
  | 'gif'
  | 'audio'
  | 'font'
  | 'subtitle'
  | 'sticker'
  | 'filter'
  | 'effect'
  | 'transition'

/** 后端目录 / 上传返回的条目（字段按 kind 可选） */
export interface BackendItem {
  id: string
  name: string
  url: string
  kind: AssetKind | string
  sub?: string
  duration?: number
  width?: number
  height?: number
  /** subtitle：srt / ass */
  format?: string
  /** audio：music / sfx */
  type?: string
  /** filter：pixi 滤镜标识（none / blackwhite / …） */
  filter?: string
  /** filter：缩略图地址；缺省时用 url */
  thumb?: string
  /** font：注册 FontFace 用的字体族名；缺省时用 cutfont-<id> */
  family?: string
  size?: number
  mime?: string
}

/**
 * 后端交互模式（配置项 backend.mode）：
 * - 'local'  纯前端：不发起任何后端请求，素材 / 时间线全部本地（localStorage + IndexedDB）
 * - 'remote' 纯后端：目录、上传、删除、重命名全部走后端
 * - 'hybrid' 只从后端取资源：目录 / 配置文件从后端拉，导入（上传）、删除、重命名等写操作全部留在前端
 */
export type BackendMode = 'local' | 'remote' | 'hybrid'

export interface BackendConfig {
  /** 交互模式；缺省时按 enabled 推导（true → 'remote'，false → 'local'），兼容旧配置 */
  mode: BackendMode
  enabled: boolean
  baseUrl: string
  timeoutMs: number
  /** 可选：覆盖默认固定路径（相对路径会拼到 baseUrl；绝对 URL 原样使用） */
  endpoints?: BackendEndpoints
}

export interface BackendEndpoints {
  catalog?: string
  upload?: string
  delete?: string
  /** 重命名：PATCH，body 为 { name }；支持 {id} / :id 占位符 */
  rename?: string
  config?: string
}

const DEFAULT_CONFIG: BackendConfig = { mode: 'local', enabled: false, baseUrl: '', timeoutMs: 8000 }

/** createApp 传入的后端配置优先于 window.CUT_CONTAINER_CONFIG / app-config.json */
let overrideConfig: BackendConfig | null = null

function pickUrl(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function normalizeEndpoints(input: any): BackendEndpoints | undefined {
  if (!input || typeof input !== 'object') return undefined
  const src = input.endpoints && typeof input.endpoints === 'object' ? input.endpoints : input
  const out: BackendEndpoints = {}
  const catalog = pickUrl(src.catalog, src.catalogUrl)
  const upload = pickUrl(src.upload, src.uploadUrl)
  const del = pickUrl(src.delete, src.deleteUrl)
  const ren = pickUrl(src.rename, src.renameUrl)
  const config = pickUrl(src.config, src.configUrl, src.configJsonUrl)
  if (catalog) out.catalog = catalog
  if (upload) out.upload = upload
  if (del) out.delete = del
  if (ren) out.rename = ren
  if (config) out.config = config
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeConfig(input: any): BackendConfig {
  const b = input && typeof input === 'object' ? input : {}
  const rawMode = typeof b.mode === 'string' ? b.mode.trim().toLowerCase() : ''
  const mode: BackendMode =
    rawMode === 'remote' || rawMode === 'hybrid' || rawMode === 'local'
      ? (rawMode as BackendMode)
      : // 兼容旧配置：只写了 enabled 时，true 视为纯后端
        b.enabled === true
        ? 'remote'
        : 'local'
  return {
    mode,
    // mode 是唯一事实来源，enabled 保留给旧调用方
    enabled: mode !== 'local',
    baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl.replace(/\/+$/, '') : '',
    timeoutMs: Number(b.timeoutMs) > 0 ? Number(b.timeoutMs) : DEFAULT_CONFIG.timeoutMs,
    endpoints: normalizeEndpoints(b)
  }
}

/** 运行时覆盖后端配置（createApp 用）；传 null 恢复默认读取顺序 */
export function setBackendConfig(config: Partial<BackendConfig> | null): void {
  overrideConfig = config ? normalizeConfig(config) : null
  configPromise = null
}

let configPromise: Promise<BackendConfig> | null = null

/** 带超时的 fetch（后端不可达时快速失败，回到本地模式） */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    window.clearTimeout(timer)
  }
}

/** 读取并缓存项目配置：优先 window.CUT_CONTAINER_CONFIG（CDN 场景），
 *  其次 public/app-config.json；失败一律按“未启用”处理 */
export function loadAppConfig(): Promise<BackendConfig> {
  if (overrideConfig) return Promise.resolve(overrideConfig)
  if (!configPromise) {
    configPromise = (async () => {
      const inline = (globalThis as { CUT_CONTAINER_CONFIG?: Partial<BackendConfig> }).CUT_CONTAINER_CONFIG
      if (inline && typeof inline === 'object') return normalizeConfig(inline)
      // file:// 直接打开时没有同源服务器，跳过 /app-config.json 请求
      if (typeof location !== 'undefined' && location.protocol === 'file:') return { ...DEFAULT_CONFIG }
      try {
        const res = await fetchWithTimeout('/app-config.json', {}, 4000)
        if (!res.ok) return { ...DEFAULT_CONFIG }
        const json = (await res.json()) as { backend?: Partial<BackendConfig> }
        return normalizeConfig(json?.backend ?? {})
      } catch {
        return { ...DEFAULT_CONFIG }
      }
    })()
  }
  return configPromise
}

/** 当前交互模式（mode 是唯一事实来源；旧配置 enabled=true 会推导为 remote） */
export async function backendMode(): Promise<BackendMode> {
  return (await loadAppConfig()).mode
}

/** 能否从后端读取（目录 / 配置 / 静态资源）：local 之外都可以 */
export async function backendCanRead(): Promise<boolean> {
  return (await loadAppConfig()).mode !== 'local'
}

/** 能否向后端写入（上传 / 删除 / 重命名等）：只有纯后端模式 */
export async function backendCanWrite(): Promise<boolean> {
  return (await loadAppConfig()).mode === 'remote'
}

/** 后端基地址；local / 未配置返回 null（调用方据此走本地逻辑） */
export async function backendBase(): Promise<string | null> {
  const cfg = await loadAppConfig()
  if (cfg.mode === 'local' || !cfg.baseUrl) return null
  return cfg.baseUrl
}

/** 拼接 endpoint：绝对 URL 原样使用，相对路径拼 baseUrl */
function endpointUrl(cfg: BackendConfig, key: keyof BackendEndpoints, fallback: string): string | null {
  const raw = cfg.endpoints?.[key]
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw
    return cfg.baseUrl ? `${cfg.baseUrl}${raw.startsWith('/') ? '' : '/'}${raw}` : null
  }
  return cfg.baseUrl ? `${cfg.baseUrl}${fallback}` : null
}

/** 上传：POST endpoint；默认 `${baseUrl}/api/upload` */
export async function uploadAsset(file: File, kind: AssetKind): Promise<BackendItem | null> {
  const cfg = await loadAppConfig()
  // 只有纯后端模式才上传；hybrid（只取资源）与 local 都留在前端
  if (cfg.mode !== 'remote') return null
  const url = endpointUrl(cfg, 'upload', '/api/upload')
  if (!url) return null
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-file-kind': kind
        },
        body: file
      },
      Math.max(cfg.timeoutMs, 5 * 60 * 1000) // 大文件上传给足时间
    )
    if (!res.ok) return null
    const data = (await res.json()) as { ok?: boolean; item?: BackendItem }
    return data?.ok && data.item ? data.item : null
  } catch {
    return null
  }
}

/** 素材目录：GET endpoint；默认 `${baseUrl}/api/catalog`，支持 `{kind}` 占位符 */
export async function fetchCatalog(kind?: AssetKind): Promise<BackendItem[]> {
  const cfg = await loadAppConfig()
  if (cfg.mode === 'local') return []
  let url = endpointUrl(cfg, 'catalog', '/api/catalog')
  if (!url) return []
  if (kind) {
    if (url.includes('{kind}')) url = url.replace('{kind}', encodeURIComponent(kind))
    else url += `${url.includes('?') ? '&' : '?'}kind=${encodeURIComponent(kind)}`
  }
  try {
    const res = await fetchWithTimeout(url, {}, cfg.timeoutMs)
    if (!res.ok) return []
    const data = (await res.json()) as { ok?: boolean; items?: BackendItem[] }
    return data?.ok && Array.isArray(data.items) ? data.items : []
  } catch {
    return []
  }
}

/** 后端配置 JSON：GET endpoint；默认 `${baseUrl}/api/config` */
export async function fetchRemoteConfig(): Promise<Record<string, any> | null> {
  const cfg = await loadAppConfig()
  if (cfg.mode === 'local') return null
  const url = endpointUrl(cfg, 'config', '/api/config')
  if (!url) return null
  try {
    const res = await fetchWithTimeout(url, {}, cfg.timeoutMs)
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, any>
    return data?.ok ? data : null
  } catch {
    return null
  }
}

/** 删除素材：DELETE endpoint；默认 `${baseUrl}/api/catalog/item/{id}` */
export async function deleteCatalogItem(id: string): Promise<boolean> {
  const cfg = await loadAppConfig()
  // 删除属于写操作：只有纯后端模式才发 DELETE，其余模式删除只作用于前端数据
  if (cfg.mode !== 'remote' || !id) return false
  let url = endpointUrl(cfg, 'delete', '/api/catalog/item/{id}')
  if (!url) return false
  if (url.includes('{id}')) url = url.replace('{id}', encodeURIComponent(id))
  else if (url.includes(':id')) url = url.replace(':id', encodeURIComponent(id))
  else url = `${url.replace(/\/+$/, '')}/${encodeURIComponent(id)}`
  try {
    const res = await fetchWithTimeout(url, { method: 'DELETE' }, cfg.timeoutMs)
    return res.ok
  } catch {
    return false
  }
}

/** 重命名素材：PATCH endpoint；默认 ${baseUrl}/api/catalog/item/{id}，body { name } */
export async function renameCatalogItem(id: string, name: string): Promise<boolean> {
  const cfg = await loadAppConfig()
  if (cfg.mode !== 'remote' || !id) return false
  let url = endpointUrl(cfg, 'rename', '/api/catalog/item/{id}')
  if (!url) return false
  if (url.includes('{id}')) url = url.replace('{id}', encodeURIComponent(id))
  else if (url.includes(':id')) url = url.replace(':id', encodeURIComponent(id))
  else url = `${url.replace(/\/+$/, '')}/${encodeURIComponent(id)}`
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      },
      cfg.timeoutMs
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * 把“后端相对路径”补成可访问的绝对地址（如滤镜示例图 /files/filter/original.png）。
 * 未启用后端时原样返回；调用方需容忍 404（资源已不再随前端发布）。
 */
export async function backendAssetUrl(path: string): Promise<string> {
  const base = await backendBase()
  if (!base) return path
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}
