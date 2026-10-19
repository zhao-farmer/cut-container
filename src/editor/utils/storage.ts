/* ============================================================
 *  编辑器框架 · localStorage 持久化（单一存储入口）
 *  - 统一命名空间前缀 uc-editor: + 业务短 key
 *  - 版本化包装 { version, savedAt, data }，带 try/catch 容错
 *  - 版本不匹配（如 v1 数组 → v2 八分类对象）视为无缓存，
 *    由外部新 props 重新落盘，避免脏数据水合。
 * ============================================================ */
import type { MaterialsData, TrackObject, TrackObjectType, StoredEnvelope } from '../types'

const PREFIX = 'uc-editor:'
/** v2：{duration, ops[]} 扁平操作；v3：TrackObject[] 轨道对象数组（type/layer/items） */
const VERSION = 3

const TRACK_TYPES: ReadonlySet<string> = new Set<TrackObjectType>([
  'video',
  'image',
  'audio',
  'text',
  'caption',
  'sticker',
  'filter',
  'effect',
  'transition'
])

const KEY_MATERIALS = 'materials'
const KEY_TRACKS = 'tracks'
const KEY_COVER = 'cover'
const KEY_MARKERS = 'markers'
/** 已删除的素材 id：后端目录再次下发时跳过，保证删除后刷新不再出现 */
const KEY_DELETED = 'deletedMaterials'

export const STORAGE_KEYS = {
  materials: PREFIX + KEY_MATERIALS,
  tracks: PREFIX + KEY_TRACKS,
  cover: PREFIX + KEY_COVER,
  markers: PREFIX + KEY_MARKERS,
  deletedMaterials: PREFIX + KEY_DELETED
} as const

/** 封面数据：image 为 dataURL（上传图 / 主轨首帧，正方形裁切），null 表示未设置 */
export interface CoverData {
  image: string | null
}

function read<T>(key: string): StoredEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const env = JSON.parse(raw) as StoredEnvelope<T>
    if (!env || typeof env !== 'object' || !('data' in env)) return null
    // 版本不一致：数据结构已变更，旧缓存作废
    if (env.version !== VERSION) return null
    return env
  } catch {
    return null
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 严格校验八分类素材结构。
 * 仅校验版本号不够：开发期曾出现「version=2 但 data 是旧数组 / 缺分类」的脏缓存，
 * 水合后访问 materials.material.find 会直接抛 TypeError 导致整个页面挂载失败。
 */
export function isMaterialsData(v: unknown): v is MaterialsData {
  if (!isPlainObject(v)) return false
  const listKeys = ['material', 'audio', 'caption', 'sticker', 'filter', 'effect', 'transition'] as const
  if (!listKeys.every(k => Array.isArray(v[k]))) return false
  const text = v.text
  return isPlainObject(text) && Array.isArray(text.defaults) && Array.isArray(text.templates)
}

/**
 * 严格校验轨道对象数组（localStorage tracks 的 v3 形状）。
 * 每一项必须是含 id/type(合法枚举)/layer(数字)/name/items(数组) 的轨道对象；
 * 每个子项必须含 id/type(合法枚举)/name/start(数字)/duration(数字)/source(对象)。
 */
export function isTrackObjectList(v: unknown): v is TrackObject[] {
  if (!Array.isArray(v)) return false
  return v.every(track => {
    if (!isPlainObject(track)) return false
    if (typeof track.id !== 'string' || typeof track.name !== 'string') return false
    if (typeof track.layer !== 'number' || !TRACK_TYPES.has(track.type as string)) return false
    if (!Array.isArray(track.items)) return false
    return track.items.every((it: unknown) => {
      if (!isPlainObject(it)) return false
      return (
        typeof it.id === 'string' &&
        typeof it.name === 'string' &&
        TRACK_TYPES.has(it.type as string) &&
        typeof it.start === 'number' &&
        Number.isFinite(it.start) &&
        typeof it.duration === 'number' &&
        Number.isFinite(it.duration) &&
        isPlainObject(it.source)
      )
    })
  })
}

/**
 * 严格校验时间线标记列表：每项为非负有限数字（秒）。
 * 帧对齐 / 排序 / 去重由使用方负责，这里只做形状兜底。
 */
export function isMarkerList(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  )
}

function write<T>(key: string, data: T): string {
  const env: StoredEnvelope<T> = {
    version: VERSION,
    savedAt: new Date().toISOString(),
    data
  }
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(env))
  } catch (e) {
    console.warn('[editor/storage] 写入失败（可能超出容量）:', e)
  }
  return env.savedAt
}

export const editorStorage = {
  loadMaterials(): { data: MaterialsData; savedAt: string } | null {
    const env = read<MaterialsData>(KEY_MATERIALS)
    // 版本通过但形状不对（脏缓存）同样作废，由外部 props 兜底并重新落盘
    if (!env || !isMaterialsData(env.data)) return null
    return { data: env.data, savedAt: env.savedAt }
  },
  saveMaterials(data: MaterialsData): string {
    return write(KEY_MATERIALS, data)
  },

  loadTracks(): { data: TrackObject[]; savedAt: string } | null {
    const env = read<TrackObject[]>(KEY_TRACKS)
    if (!env || !isTrackObjectList(env.data)) return null
    return { data: env.data, savedAt: env.savedAt }
  },
  saveTracks(data: TrackObject[]): string {
    return write(KEY_TRACKS, data)
  },

  loadCover(): { data: CoverData; savedAt: string } | null {
    const env = read<CoverData>(KEY_COVER)
    if (!env || typeof env.data?.image !== 'string') return null
    return { data: env.data, savedAt: env.savedAt }
  },
  saveCover(data: CoverData): string {
    return write(KEY_COVER, data)
  },

  /** 时间线标记（秒数组，帧对齐由使用方保证） */
  loadMarkers(): { data: number[]; savedAt: string } | null {
    const env = read<number[]>(KEY_MARKERS)
    if (!env || !isMarkerList(env.data)) return null
    return { data: env.data, savedAt: env.savedAt }
  },
  saveMarkers(data: number[]): string {
    return write(KEY_MARKERS, data)
  },

  /** 已删除素材 id 列表（普通 JSON 数组；用于过滤后端目录回灌） */
  loadDeletedMaterials(): string[] {
    try {
      const raw = localStorage.getItem(PREFIX + KEY_DELETED)
      const arr = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  },
  saveDeletedMaterials(ids: string[]): void {
    try {
      localStorage.setItem(PREFIX + KEY_DELETED, JSON.stringify([...new Set(ids)]))
    } catch {
      /* noop */
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(PREFIX + KEY_MATERIALS)
      localStorage.removeItem(PREFIX + KEY_TRACKS)
      localStorage.removeItem(PREFIX + KEY_COVER)
      localStorage.removeItem(PREFIX + KEY_MARKERS)
      localStorage.removeItem(PREFIX + KEY_DELETED)
    } catch {
      /* noop */
    }
  }
}
