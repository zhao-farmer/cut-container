/* ============================================================
 *  纹理引用计数（缩略图 LRU 与 ClipView 之间的所有权约定）
 *
 *  背景：时间轴的视频 / GIF 缩略格纹理由 MediaStore 的 LRU 缓存，
 *  而纹理同时被 ClipView 的精灵直接引用渲染。旧实现 LRU 一淘汰就
 *  `texture.destroy(true)`，会把仍在屏幕上的精灵纹理销毁（source 变 null），
 *  随后 pixi 渲染读到 `source.alphaMode` 直接抛
 *  "Cannot read properties of null (reading 'alphaMode')"，
 *  整个时间轴 / 画面停止刷新。
 *
 *  约定：
 *  - ClipView 把纹理挂到精灵上时 retain()，摘除精灵时 release()；
 *  - LRU 淘汰改用 retire()：有引用就只标记待销毁，等最后一个引用释放再销毁。
 * ============================================================ */
import type { Texture } from 'pixi.js'

const uses = new Map<Texture, number>()
/** 已被 LRU 淘汰、但因仍有引用而延迟销毁的纹理 */
const retired = new Set<Texture>()

/** 增加一次引用（ClipView 持有纹理期间不允许被 LRU 销毁） */
export function retainTexture(tex: Texture): void {
  uses.set(tex, (uses.get(tex) ?? 0) + 1)
}

/** 释放一次引用；若该纹理已被 LRU 淘汰且引用归零，则此时才真正销毁 */
export function releaseTexture(tex: Texture): void {
  if (!tex) return
  const n = (uses.get(tex) ?? 0) - 1
  if (n > 0) {
    uses.set(tex, n)
    return
  }
  uses.delete(tex)
  if (retired.delete(tex)) {
    try {
      tex.destroy(true)
    } catch {
      /* noop */
    }
  }
}

/**
 * LRU 淘汰：没有引用就立即销毁；还有引用则挂起，等最后一个 release 再销毁。
 */
export function retireTexture(tex: Texture): void {
  if (!tex) return
  // 已被别处销毁（source 为空）就不要再碰，避免二次 destroy 抛错
  if (!tex.source) return
  if ((uses.get(tex) ?? 0) > 0) {
    retired.add(tex)
    return
  }
  try {
    tex.destroy(true)
  } catch {
    /* noop */
  }
}
