/* ============================================================
 *  本地媒体持久化（IndexedDB）
 *  - 后端不可用 / 未配置时，导入的视频、音频仍以 blob: URL 使用；
 *    blob: 刷新即失效，所以这里把原始 File/Blob 按素材 id 存进 IndexedDB，
 *    启动时再换回新的 blob: URL，保证「导入后刷新仍能找到」。
 *  - 后端上传成功（http 地址）的素材不会写入这里，仍由后端目录恢复。
 * ============================================================ */
import type { MaterialsData } from '../types'

const DB_NAME = 'cut-container-local-media'
const STORE = 'files'
let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** 保存一份本地文件（key = 素材 id） */
export async function putLocalFile(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** 读取本地文件（不存在 / IndexedDB 不可用 → null） */
export async function getLocalFile(id: string): Promise<Blob | null> {
  const db = await openDB()
  if (!db) return null
  return new Promise<Blob | null>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 把素材库中失效的 blob: 地址恢复成新的对象 URL；返回恢复数量 */
export async function restoreLocalMedia(data: MaterialsData): Promise<number> {
  const groups = [data.material, data.audio, data.caption, data.sticker] as unknown as Array<
    Array<{ id: string; url?: string }>
  >
  let changed = 0
  for (const list of groups) {
    for (const item of list) {
      if (typeof item.url !== 'string' || !item.url.startsWith('blob:')) continue
      const blob = await getLocalFile(item.id)
      if (!blob) continue
      item.url = URL.createObjectURL(blob)
      changed++
    }
  }
  return changed
}

/**
 * 清空 IndexedDB 里保存的本地媒体文件（清除本机缓存时调用）。
 * 与 editorStorage.clear() 配合，覆盖 localStorage + IndexedDB 两处持久化。
 */
export async function clearLocalMedia(): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
