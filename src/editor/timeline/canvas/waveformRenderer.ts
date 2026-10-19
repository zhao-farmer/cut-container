/* ============================================================
 *  时间轴 · 音频波形渲染器（从 media.ts 抽出，参考 asconfig
 *  waveformGenerator / waveformConfig）
 *
 *  AudioBuffer 逐像素列取最大振幅 → dB 非线性映射为柱高，
 *  超过 -6dB 的柱顶用 0xff7e2f 橙色警示；pixi v8 同色矩形累加
 *  到一条路径后一次性 fill。渲染器无状态，可全局复用。
 * ============================================================ */

type PixiNS = typeof import('pixi.js')

/** dB → 柱顶位置百分比（0%=柱顶贴满，100%=无信号），区间线性插值 */
const DB_TO_TOP_PCT = [
  { db: 0, pct: 0 },
  { db: -6, pct: 20 },
  { db: -12, pct: 38 },
  { db: -20, pct: 56 },
  { db: -30, pct: 76 },
  { db: -50, pct: 94 },
  { db: -60, pct: 100 }
]

function topPctFromDb(db: number): number {
  const t = DB_TO_TOP_PCT
  if (db >= t[0].db) return t[0].pct
  if (db <= t[t.length - 1].db) return t[t.length - 1].pct
  for (let i = 0; i < t.length - 1; i++) {
    if (db <= t[i].db && db >= t[i + 1].db) {
      const k = (db - t[i].db) / (t[i + 1].db - t[i].db)
      return t[i].pct + k * (t[i + 1].pct - t[i].pct)
    }
  }
  return 100
}

export interface WaveOptions {
  buffer: AudioBuffer
  /** 素材入点（秒） */
  offset?: number
  /** 取用时长（秒），缺省取到 buffer 结尾 */
  duration?: number
  width: number
  height: number
  bg: number
  wave: number
  warn?: number
  /**
   * 每像素对应的源秒数（= 1/scale）。给出后每列按真实时间边界取采样，
   * 长波形条也不会因 step 取整产生累积漂移，波形可与源锚定缩略格精确对齐；
   * 缺省时退化为整段线性映射（旧行为）。
   */
  secPerPx?: number
  /**
   * 片段音量增益（线性倍率，1＝原始）。在 dB 映射前乘到每列峰值振幅上，
   * 时间轴上拖动音量白线时波形柱高随分贝实时变化；>1 的增益超 0dB 自然削顶，
   * 柱顶落入既有橙色警示区；底色轨道不受增益影响，始终铺满。
   */
  gain?: number
}

export class WaveformRenderer {
  constructor(private T: PixiNS) {}

  /**
   * 画 dB 非线性映射波形。
   * 返回的 Graphics 以 (0,0) 为左上角，尺寸 width×height。
   */
  build(opts: WaveOptions): import('pixi.js').Graphics {
    const { buffer, width, height, bg, wave } = opts
    const warnColor = opts.warn ?? 0xff7e2f
    const gain = Math.max(0, Number.isFinite(opts.gain) ? (opts.gain as number) : 1)
    const offset = Math.max(0, opts.offset ?? 0)
    const T = this.T
    const g = new T.Graphics()
    // v8：链式 path + 一次 fill；底色
    g.rect(0, 0, width, height).fill(bg)

    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const startIdx = Math.min(data.length - 1, Math.floor(offset * rate))
    const usable = opts.duration
      ? Math.floor(opts.duration * rate)
      : data.length - startIdx
    const endIdx = Math.min(data.length, startIdx + Math.max(1, usable))
    const step = Math.max(1, Math.ceil((endIdx - startIdx) / Math.max(1, width)))
    // 精确时间边界（secPerPx）：列 x 取 [x, x+1) 像素对应的真实采样区间
    const spp = opts.secPerPx ? opts.secPerPx * rate : 0

    const warnPct = topPctFromDb(-6)
    const warnSplitY = (height * warnPct) / 100

    const normal: number[] = []
    const warn: number[] = []
    for (let x = 0; x < width; x++) {
      let amp = 0
      const s = spp ? startIdx + Math.floor(x * spp) : startIdx + x * step
      const e = spp
        ? Math.min(endIdx, startIdx + Math.floor((x + 1) * spp))
        : Math.min(endIdx, s + step)
      for (let i = s; i < e; i++) {
        const v = Math.abs(data[i])
        if (v > amp) amp = v
      }
      // 音量增益在 dB 映射前生效（超 0dB 削顶 → 橙警示），0 音量整列跳过呈静音
      amp = Math.min(1, amp * gain)
      if (amp < 0.00001) continue
      const db = 20 * Math.log10(Math.max(amp, 0.00001))
      const topY = (height * topPctFromDb(db)) / 100
      if (topY < warnSplitY) {
        // 超 -6dB：顶部橙色 + 其余蓝色
        warn.push(x, topY, warnSplitY - topY)
        normal.push(x, warnSplitY, height - warnSplitY)
      } else {
        normal.push(x, topY, height - topY)
      }
    }
    // v8：同色矩形累加到当前路径后一次性 fill
    if (normal.length) {
      for (let i = 0; i < normal.length; i += 3) {
        g.rect(normal[i], normal[i + 1], 1, Math.max(1, normal[i + 2]))
      }
      g.fill(wave)
    }
    if (warn.length) {
      for (let i = 0; i < warn.length; i += 3) {
        g.rect(warn[i], warn[i + 1], 1, Math.max(1, warn[i + 2]))
      }
      g.fill(warnColor)
    }
    return g
  }
}
