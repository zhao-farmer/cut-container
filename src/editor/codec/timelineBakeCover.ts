/* ============================================================
 *  时间轴 · cover 烘焙工具
 *  把源画面按 cover 规则裁切成 w×h 的独立 canvas 纹理，
 *  脱离对 video / VideoFrame / img 生命周期的依赖。
 *  抽帧器 FrameExtractor 与媒体存储 MediaStore 共用。
 * ============================================================ */

type PixiNS = typeof import('pixi.js')

/** 任意可被 CanvasRenderingContext2D.drawImage 接受的源 */
export type Drawable = CanvasImageSource

const DPR = Math.min(2, window.devicePixelRatio || 1)

/**
 * cover 烘焙：源画面按 cover 裁切到 w×h（按 DPR 提升物理分辨率），
 * 返回 v8 ImageSource 承载的独立纹理（不走 Texture.from 全局缓存，
 * 便于调用方 LRU 自行销毁）。
 */
export function bakeCover(T: PixiNS, source: Drawable, sw: number, sh: number, w: number, h: number) {
  const W = Math.max(1, Math.round(w * DPR))
  const H = Math.max(1, Math.round(h * DPR))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const srcRatio = sw / sh
  const dstRatio = w / h
  let sx = 0
  let sy = 0
  let cw = sw
  let ch = sh
  if (srcRatio > dstRatio) {
    // 源更宽：左右裁切
    cw = sh * dstRatio
    sx = (sw - cw) / 2
  } else {
    ch = sw / dstRatio
    sy = (sh - ch) / 2
  }
  ctx.drawImage(source as CanvasImageSource, sx, sy, cw, ch, 0, 0, W, H)
  return new T.Texture({ source: new T.ImageSource({ resource: canvas }) })
}
