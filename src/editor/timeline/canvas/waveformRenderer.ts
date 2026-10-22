/* ============================================================
 *  时间轴 · 音频波形渲染器（从 media.ts 抽出，参考 asconfig
 *  waveformGenerator / waveformConfig）
 *
 *  AudioBuffer 逐像素列取最大振幅 → dB 非线性映射为柱高；
 *  超过 -6dB 的柱顶用 0xff7e2f 橙色警示。
 *
 *  实现说明：波形按「整条片段」烘焙到离屏 canvas，再作为纹理交给 pixi 精灵。
 *  - 逐列 fillRect 比 pixi Graphics 的逐矩形路径快一个量级，
 *    超高缩放下整段宽度上万像素也能一次画完；
 *  - 纹理用 linear 采样，缩放拉伸时是平滑过渡而不是一块一块的矩形；
 *  - 纹理只在缩放 / 轨道高 / 音量变化时重建，滚动只改精灵位置。
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

/** 0xRRGGBB → css 颜色 */
function cssColor(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

export interface WaveOptions {
  buffer: AudioBuffer
  /** 素材入点（秒） */
  offset?: number
  /** 取用时长（秒），缺省取到 buffer 结尾 */
  duration?: number
  width: number
  height: number
  /** 底色；缺省/undefined 时底透明（时间轴把底色单独画一条常量矩形，方便音量只缩放波形高度） */
  bg?: number
  wave: number
  warn?: number
  /**
   * 每像素对应的源秒数（= 1/scale）。给出后每列按真实时间边界取采样，
   * 长波形条也不会因 step 取整产生累积漂移；缺省时退化为整段线性映射。
   */
  secPerPx?: number
  /**
   * 片段音量增益（线性倍率，1＝原始）。在 dB 映射前乘到每列峰值振幅上；
   * 时间轴上拖动音量白线时波形柱高随之实时变化。
   */
  gain?: number
}

export class WaveformRenderer {
  constructor(private T: PixiNS) {}

  /** 把波形画进离屏 canvas（宽 width、高 height，1:1 像素） */
  drawCanvas(opts: WaveOptions): HTMLCanvasElement {
    const { buffer, bg, wave } = opts
    const warnColor = opts.warn ?? 0xff7e2f
    const gain = Math.max(0, Number.isFinite(opts.gain) ? (opts.gain as number) : 1)
    const offset = Math.max(0, opts.offset ?? 0)
    const width = Math.max(1, Math.round(opts.width))
    const height = Math.max(1, Math.round(opts.height))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    if (typeof bg === 'number') {
      ctx.fillStyle = cssColor(bg)
      ctx.fillRect(0, 0, width, height)
    }

    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const startIdx = Math.min(data.length - 1, Math.floor(offset * rate))
    const usable = opts.duration ? Math.floor(opts.duration * rate) : data.length - startIdx
    const endIdx = Math.min(data.length, startIdx + Math.max(1, usable))
    const step = Math.max(1, Math.ceil((endIdx - startIdx) / width))
    const spp = opts.secPerPx ? opts.secPerPx * rate : 0

    const warnSplitY = (height * topPctFromDb(-6)) / 100
    const waveCss = cssColor(wave)
    const warnCss = cssColor(warnColor)

    // 逐列取峰值 → dB → 柱高；同色矩形按两遍绘制（正常色一次、警示色一次）
    const tops: Float32Array = new Float32Array(width)
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
      amp = Math.min(1, amp * gain)
      tops[x] = amp < 0.00001 ? -1 : (height * topPctFromDb(20 * Math.log10(amp))) / 100
    }

    ctx.fillStyle = waveCss
    for (let x = 0; x < width; x++) {
      const topY = tops[x]
      if (topY < 0) continue
      const y = Math.max(topY, warnSplitY)
      ctx.fillRect(x, y, 1, Math.max(1, height - y))
    }
    ctx.fillStyle = warnCss
    for (let x = 0; x < width; x++) {
      const topY = tops[x]
      if (topY < 0 || topY >= warnSplitY) continue
      ctx.fillRect(x, topY, 1, Math.max(1, warnSplitY - topY))
    }
    return canvas
  }

  /**
   * 画 dB 波形并包成纹理（linear 采样，拉伸平滑）。
   * 纹理以 (0,0) 为左上角，宽高对应 opts.width×opts.height。
   */
  buildTexture(opts: WaveOptions): import('pixi.js').Texture {
    const canvas = this.drawCanvas(opts)
    const T = this.T
    const source = new T.CanvasSource({ resource: canvas, scaleMode: 'linear' })
    return new T.Texture({ source })
  }

  /**
   * 兼容旧调用：返回 Graphics（时间轴已改用纹理，保留给外部按需使用）。
   */
  build(opts: WaveOptions): import('pixi.js').Graphics {
    const { buffer, width, height, bg, wave } = opts
    const warnColor = opts.warn ?? 0xff7e2f
    const gain = Math.max(0, Number.isFinite(opts.gain) ? (opts.gain as number) : 1)
    const offset = Math.max(0, opts.offset ?? 0)
    const T = this.T
    const g = new T.Graphics()
    if (typeof bg === 'number') g.rect(0, 0, width, height).fill(bg)

    const data = buffer.getChannelData(0)
    const rate = buffer.sampleRate
    const startIdx = Math.min(data.length - 1, Math.floor(offset * rate))
    const usable = opts.duration ? Math.floor(opts.duration * rate) : data.length - startIdx
    const endIdx = Math.min(data.length, startIdx + Math.max(1, usable))
    const step = Math.max(1, Math.ceil((endIdx - startIdx) / Math.max(1, width)))
    const spp = opts.secPerPx ? opts.secPerPx * rate : 0
    const warnSplitY = (height * topPctFromDb(-6)) / 100

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
      amp = Math.min(1, amp * gain)
      if (amp < 0.00001) continue
      const topY = (height * topPctFromDb(20 * Math.log10(amp))) / 100
      if (topY < warnSplitY) {
        warn.push(x, topY, warnSplitY - topY)
        normal.push(x, warnSplitY, height - warnSplitY)
      } else {
        normal.push(x, topY, height - topY)
      }
    }
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
