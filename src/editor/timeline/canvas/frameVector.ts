/* ============================================================
 *  时间轴 · 帧坐标向量（内存版，替代参考实现的 WASM frameVector）
 *
 *  参考 asconfig 的 @/assets/wasm/frameVector（AssemblyScript 编译），
 *  本模块不再加载 .wasm，改为把每一帧的世界坐标直接存入内存中的
 *  Float64Array；缓冲区只增容、不重新分配，避免高频重绘时 GC 抖动。
 *
 *  已与原 WASM 导出函数逐项对齐语义（Node 实测）：
 *   - initFrameVector(fw, totalWidth) → 长度 = ceil(totalWidth / fw)
 *   - getValueAt(i)                   → round(i*fw, 3)；越界（含负数）→ 0
 *   - getFrameDistance(i, n)          → round(n*fw, 3)；n 为负抛错
 *   - getFrameByPosition(x)           → clamp(round(x / fw), 0, len-1)
 *   - getDataLength()                 → 当前向量长度
 * ============================================================ */

/** 与 WASM 一致：坐标统一保留 3 位小数，消除浮点累积误差 */
const round3 = (v: number) => Math.round(v * 1000) / 1000

let frameWidth = 0
let dataLength = 0
/** 持久内存向量：只在容量不足时扩容，init 时覆写前 dataLength 项 */
let positions = new Float64Array(0)

/**
 * 初始化帧向量（每次时间轴重绘时调用）。
 * @param fw         单帧像素宽（getTimeScaleInfo().frameWidth）
 * @param totalWidth 世界总宽（px）
 * @returns 向量长度
 */
export function initFrameVector(fw: number, totalWidth: number): number {
  frameWidth = fw > 0 ? fw : 0
  dataLength = frameWidth > 0 && totalWidth > 0 ? Math.ceil(totalWidth / frameWidth) : 0
  if (positions.length < dataLength) positions = new Float64Array(dataLength)
  for (let i = 0; i < dataLength; i++) positions[i] = round3(i * frameWidth)
  return dataLength
}

/** 第 index 帧的世界坐标；越界与负数一律返回 0（对齐 WASM） */
export function getValueAt(index: number): number {
  if (index < 0 || index >= dataLength) return 0
  return positions[index]
}

/** 从第 index 帧起连续 frameSize 帧的像素距离（index 与 WASM 一样不参与计算） */
export function getFrameDistance(index: number, frameSize: number): number {
  if (frameSize < 0) throw new Error('[frameVector] frameSize must be non-negative')
  void index
  return round3(frameSize * frameWidth)
}

/** 世界坐标 → 最近帧索引（四舍五入并钳制在 [0, len-1]） */
export function getFrameByPosition(position: number): number {
  if (dataLength <= 0 || frameWidth <= 0) return 0
  const i = Math.round(position / frameWidth)
  return Math.min(dataLength - 1, Math.max(0, i))
}

/** 当前向量长度（总帧数） */
export function getDataLength(): number {
  return dataLength
}

/** 当前单帧像素宽（供外部做秒 ↔ 像素换算） */
export function getFrameWidth(): number {
  return frameWidth
}
