/* ============================================================
 *  编辑器框架 · 时间计算 / 格式化公共工具
 *  全项目时间坐标统一为秒（时间轴内部按 1/30 帧对齐），
 *  本文件只放纯函数，不依赖任何业务模块。
 * ============================================================ */

/** 秒数 → mm:ss（非有限数字返回 --:--） */
export function fmtTime(s: number | undefined | null): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '--:--'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 标尺时间文字：剪映样式 MM:SS（分、秒均补零；超 1 小时加 H: 前缀） */
export function formatRuler(sec: number): string {
  const v = Math.max(0, Math.round(sec))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const s = v % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 拖动提示用 m:ss.cs */
export function formatHint(sec: number): string {
  const v = Math.max(0, sec)
  const m = Math.floor(v / 60)
  let s = Math.floor(v % 60)
  // 帧吸附后秒值为 frame/30（如 8.6 的浮点实为 8.59999…），
  // 百分秒用四舍五入并处理进位，避免显示成 8.59
  let cs = Math.round((v - Math.floor(v)) * 100)
  if (cs >= 100) {
    cs = 0
    s += 1
  }
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** 秒 → 吸附到帧网格（1/fps 秒）：播放器与时间轴互通时间的基础单位统一为帧 */
export function snapToFrame(sec: number, fps: number): number {
  const v = Number.isFinite(sec) ? sec : 0
  return Math.round(Math.max(0, v) * fps) / fps
}

/** 素材块时长码 HH:MM:SS:FF（参考 asconfig calcFrameTime，帧值四舍五入） */
export function formatTimecode(sec: number, fps: number): string {
  const total = Math.max(0, Math.round(sec * fps))
  const f = total % fps
  const totalSec = Math.floor(total / fps)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(f)}`
}
