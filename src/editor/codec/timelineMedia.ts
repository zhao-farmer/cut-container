/* ============================================================
 *  编辑器框架 · 编解码（codec）· 时间线媒体解析（参考 asconfig/TimelineEditor.vue）
 *
 *  - 视频：mediabunny Input 解封装，三种抽帧路径（采样 / 编码包顺序
 *    解码 / video seek 截帧，按 WebGPU 环境分流）统一收在
 *    ./timelineFrameExtractor.ts 的 FrameExtractor；这里负责微任务合批、
 *    逐帧 cover 烘焙成"固定格宽 × 封面裁切"纹理（LRU 缓存）；
 *    视频内嵌音轨用 AudioBufferSink 解码成 AudioBuffer。
 *  - 音频文件：fetch → AudioContext.decodeAudioData → AudioBuffer。
 *  - 图片 / 动图首帧 / 贴纸：HTMLImage 加载后按 cover 烘焙成平铺瓦片。
 *  - 波形绘制收在 timeline/canvas/waveformRenderer.ts 的 WaveformRenderer。
 *
 * pixi 版本固定 v8（rect/roundRect/poly + fill/stroke 链式 API），命名空间由外部注入。
 * ============================================================ */
import { Input, ALL_FORMATS, UrlSource, AudioBufferSink } from 'mediabunny'
import { FrameExtractor } from './timelineFrameExtractor'
import { bakeCover } from './timelineBakeCover'

/** 缩略格逻辑宽度（px），与参考实现的 trackMediaWidth 一致 */
export const CELL_W = 46
/** 单视频缓存的最大帧数（超出按最久未使用淘汰） */
const VIDEO_FRAME_LRU = 160
/** 同一视频单帧取图的最大并发（getSample 各自独立解码管线，限并发保护 GPU 帧池） */
const VIDEO_SAMPLE_CONCURRENCY = 3

type PixiNS = typeof import('pixi.js')

interface CachedFrame {
  tex: import('pixi.js').Texture
  last: number
}

interface FrameJob {
  key: string
  time: number
  w: number
  h: number
  resolve: (t: import('pixi.js').Texture | null) => void
}

/**
 * 单个视频地址的抽帧 / 取音轨控制器。
 * 同一时间点的抽帧请求会在一个微任务批次里合并，共用一个 VideoSampleSink。
 */
class VideoMedia {
  private input: Input | null = null
  private videoTrack: Awaited<ReturnType<Input['getPrimaryVideoTrack']>> = null
  private readyPromise: Promise<void> | null = null
  private failed = false
  private jobs = new Map<string, FrameJob>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  /** 单帧取图等待队列 + 在途计数（每格独立 getSample，完成一格即回调上屏） */
  private cellQueue: FrameJob[] = []
  private cellRunning = 0
  private destroyed = false
  private frames = new Map<string, CachedFrame>()
  private audioPromise: Promise<AudioBuffer | null> | null = null
  /** 三路径抽帧器（采样 / 编码包 / video seek），按格尺寸烘焙，复用 PIXI 命名空间 */
  private extractor: FrameExtractor

  constructor(private T: PixiNS, readonly url: string) {
    this.extractor = new FrameExtractor(T)
  }

  private ensureInput(): Promise<void> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = (async () => {
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(this.url) })
      this.input = input
      const track = await input.getPrimaryVideoTrack()
      if (!track) {
        this.failed = true
        throw new Error('无视频轨')
      }
      this.videoTrack = track
    })().catch(err => {
      this.failed = true
      throw err
    })
    return this.readyPromise
  }

  /** 请求某个素材时刻的封面格纹理（失败 resolve null，不抛异常） */
  requestCell(time: number, w: number, h: number): Promise<import('pixi.js').Texture | null> {
    const key = `${time.toFixed(3)}@${w}x${h}`
    const hit = this.frames.get(key)
    if (hit) {
      hit.last = performance.now()
      return Promise.resolve(hit.tex)
    }
    const queued = this.jobs.get(key)
    if (queued) {
      return new Promise(resolve => {
        const oldResolve = queued.resolve
        queued.resolve = t => {
          oldResolve(t)
          resolve(t)
        }
      })
    }
    return new Promise(resolve => {
      this.jobs.set(key, { key, time, w, h, resolve })
      if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 0)
    })
  }

  private async flush() {
    this.flushTimer = null
    if (this.jobs.size === 0) return
    const batch = Array.from(this.jobs.values())
    this.jobs.clear()
    try {
      await this.ensureInput()
    } catch {
      batch.forEach(j => j.resolve(null))
      return
    }
    if (this.failed || !this.videoTrack) {
      batch.forEach(j => j.resolve(null))
      return
    }
    // 每格独立 getSample 单帧快取：完成一格立刻回调上屏（与图片瓦片同节奏），
    // 不再等整批时刻全部解完；并发上限保护 WebCodecs GPU 帧池。
    for (const job of batch) this.cellQueue.push(job)
    void this.pumpCells()
  }

  /** 按并发上限驱动单帧取图队列 */
  private pumpCells() {
    while (this.cellRunning < VIDEO_SAMPLE_CONCURRENCY) {
      const job = this.cellQueue.shift()
      if (!job) return
      this.cellRunning++
      this.extractor
        .extractOne(this.videoTrack!, this.url, job.time, job.w, job.h)
        .then(tex => {
          if (tex) {
            if (this.destroyed) this.safeDestroyTex(tex)
            else this.storeFrame(job.key, tex)
          }
          job.resolve(tex)
        })
        .catch(() => job.resolve(null))
        .finally(() => {
          this.cellRunning--
          if (this.cellQueue.length) this.pumpCells()
        })
    }
  }

  private storeFrame(key: string, tex: import('pixi.js').Texture) {
    this.frames.set(key, { tex, last: performance.now() })
    if (this.frames.size > VIDEO_FRAME_LRU) {
      const oldestKey = this.frames.keys().next().value as string | undefined
      if (oldestKey && oldestKey !== key) {
        const old = this.frames.get(oldestKey)!
        this.frames.delete(oldestKey)
        this.safeDestroyTex(old.tex)
      }
    }
  }

  private safeDestroyTex(tex: import('pixi.js').Texture) {
    try {
      tex.destroy(true)
    } catch {
      /* noop */
    }
  }

  /** 视频内嵌音轨 → 合并为一个 AudioBuffer（无音轨返回 null） */
  getAudio(): Promise<AudioBuffer | null> {
    if (this.audioPromise) return this.audioPromise
    this.audioPromise = (async () => {
      try {
        await this.ensureInput()
        if (!this.input) return null
        const audioTrack = await this.input.getPrimaryAudioTrack()
        if (!audioTrack) return null
        const sink = new AudioBufferSink(audioTrack)
        let sampleRate = 0
        let channels = 0
        let total = 0
        const segments: AudioBuffer[] = []
        for await (const wrapped of sink.buffers(0, Infinity)) {
          if (!sampleRate) {
            sampleRate = wrapped.buffer.sampleRate
            channels = wrapped.buffer.numberOfChannels
          }
          total += wrapped.buffer.length
          segments.push(wrapped.buffer)
        }
        if (!segments.length) return null
        const ctx = getAudioContext()
        const merged = ctx.createBuffer(channels, total, sampleRate)
        let offset = 0
        for (const buf of segments) {
          for (let ch = 0; ch < channels; ch++) {
            merged.getChannelData(ch).set(buf.getChannelData(ch), offset)
          }
          offset += buf.length
        }
        return merged
      } catch {
        return null
      }
    })()
    return this.audioPromise
  }

  destroy() {
    this.destroyed = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.jobs.forEach(j => j.resolve(null))
    this.jobs.clear()
    this.cellQueue.forEach(j => j.resolve(null))
    this.cellQueue = []
    this.frames.forEach(f => this.safeDestroyTex(f.tex))
    this.frames.clear()
    const input = this.input
    if (input) {
      Promise.resolve()
        .then(() => (input as unknown as { close?: () => Promise<void> }).close?.())
        .catch(() => {})
    }
    this.input = null
  }
}

/* ============================================================
 *  GIF：自包含解析 + 逐帧合成（无第三方依赖）
 *  浏览器没有原生 GIF 时长 / 逐帧 API，这里直接解析 GIF89a：
 *  逻辑屏幕描述符 / 全局调色板 / 图形控制扩展（帧延迟、透明色、
 *  disposal）/ 图像描述符 / LZW 压缩数据，再按 disposal 规则
 *  把索引帧合成为全尺寸 ImageData。
 * ============================================================ */

interface GifRawFrame {
  left: number
  top: number
  width: number
  height: number
  /** 帧延迟（毫秒）；源为 0 时按浏览器惯例取 100ms */
  delayMs: number
  /** disposal：0/1 保留，2 清背景，3 恢复上一帧 */
  disposal: number
  /** 透明色索引（-1 = 无透明） */
  transparent: number
  interlaced: boolean
  /** 本帧生效的 RGB 调色板（长度 = 颜色数 × 3） */
  palette: Uint8Array
  /** 索引像素（长度 width × height，已去交织） */
  indices: Uint8Array
}

export interface GifMeta {
  width: number
  height: number
  /** 总时长（秒）= 各帧延迟之和 */
  duration: number
  frames: number
}

interface ParsedGif extends GifMeta {
  raw: GifRawFrame[]
}

const GIF_DEFAULT_DELAY_MS = 100
/** 单个 GIF 烘焙纹理缓存上限（超出 LRU 淘汰） */
const GIF_FRAME_LRU = 320

/** 解析 GIF 二进制 */
export function parseGif(buf: ArrayBuffer): ParsedGif | null {
  const b = new Uint8Array(buf)
  const dv = new DataView(buf)
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null // 'GIF'
  const width = dv.getUint16(6, true)
  const height = dv.getUint16(8, true)
  const packed = b[10]
  let globalPalette: Uint8Array | null = null
  let p = 13
  if (packed & 0x80) {
    const n = 2 << (packed & 7)
    globalPalette = b.slice(p, p + n * 3)
    p += n * 3
  }

  const raw: GifRawFrame[] = []
  let gce = { disposal: 0, delayMs: 0, transparent: -1 }

  const skipSubBlocks = () => {
    while (b[p] !== 0 && p < b.length) p += b[p] + 1
    p++ // 0x00 终止符
  }

  while (p < b.length) {
    const block = b[p++]
    if (block === 0x3b) break // trailer
    if (block === 0x21) {
      // 扩展块
      const label = b[p++]
      if (label === 0xf9) {
        // Graphic Control Extension：size(4) packed delayCs(2) tci terminator
        p++ // block size = 4
        const fp = b[p]
        const disposal = (fp >> 2) & 7
        const delayCs = dv.getUint16(p + 1, true)
        const transparent = fp & 1 ? b[p + 3] : -1
        gce = { disposal, delayMs: delayCs * 10, transparent }
        p += 4
        p++ // terminator
      } else {
        skipSubBlocks()
      }
    } else if (block === 0x2c) {
      // 图像描述符
      const left = dv.getUint16(p, true)
      const top = dv.getUint16(p + 2, true)
      const iw = dv.getUint16(p + 4, true)
      const ih = dv.getUint16(p + 6, true)
      const ip = b[p + 8]
      p += 9
      let palette = globalPalette
      if (ip & 0x80) {
        const n = 2 << (ip & 7)
        palette = b.slice(p, p + n * 3)
        p += n * 3
      }
      const interlaced = !!(ip & 0x40)
      const minCodeSize = b[p++]
      // 拼接 LZW 数据子块
      const chunks: Uint8Array[] = []
      let total = 0
      while (b[p] !== 0 && p < b.length) {
        const size = b[p++]
        chunks.push(b.subarray(p, p + size))
        total += size
        p += size
      }
      p++ // terminator
      const data = new Uint8Array(total)
      let off = 0
      for (const c of chunks) {
        data.set(c, off)
        off += c.length
      }
      if (palette && iw > 0 && ih > 0) {
        raw.push({
          left,
          top,
          width: iw,
          height: ih,
          delayMs: gce.delayMs > 0 ? gce.delayMs : GIF_DEFAULT_DELAY_MS,
          disposal: gce.disposal,
          transparent: gce.transparent,
          interlaced,
          palette,
          indices: gifLzwDecode(data, Math.max(2, Math.min(8, minCodeSize)), iw * ih)
        })
      }
      // GCE 只作用于紧随其后的一个图像
      gce = { disposal: 0, delayMs: 0, transparent: -1 }
    } else {
      break // 未知块：安全结束
    }
  }

  if (!raw.length || !width || !height) return null
  let duration = 0
  for (const f of raw) duration += f.delayMs
  return { width, height, duration: duration / 1000, frames: raw.length, raw }
}

/** GIF LZW 变长码解码（码长上限 12） */
function gifLzwDecode(data: Uint8Array, minCodeSize: number, pxCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let dict: number[][] = []
  const resetDict = () => {
    dict = []
    for (let i = 0; i < clearCode; i++) dict.push([i])
    dict.push([]) // clear code
    dict.push([]) // end code
    codeSize = minCodeSize + 1
  }
  resetDict()

  const out: number[] = []
  let prev: number[] | null = null
  let bitPos = 0
  const readCode = (): number => {
    let code = 0
    for (let i = 0; i < codeSize; i++) {
      const bi = bitPos >> 3
      if (bi < data.length) code |= ((data[bi] >> (bitPos & 7)) & 1) << i
      bitPos++
    }
    return code
  }

  while (out.length < pxCount && bitPos < data.length * 8) {
    const code = readCode()
    if (code === clearCode) {
      resetDict()
      prev = null
      continue
    }
    if (code === endCode) break
    let entry: number[]
    if (code < dict.length) {
      entry = dict[code]
    } else if (prev) {
      entry = [...prev, prev[0]]
    } else {
      break
    }
    for (let i = 0; i < entry.length && out.length < pxCount; i++) out.push(entry[i])
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]])
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++
    }
    prev = entry
  }
  return Uint8Array.from(out.slice(0, pxCount))
}

export interface GifRenderedFrame {
  image: ImageData
  /** 该帧起始时刻（秒） */
  time: number
}

/** 交织 GIF 的扫描行序（4 趟） */
function gifInterlaceRows(h: number): number[] {
  const rows: number[] = []
  const starts = [0, 4, 2, 1]
  const steps = [8, 8, 4, 2]
  for (let pass = 0; pass < 4; pass++) {
    for (let y = starts[pass]; y < h; y += steps[pass]) rows.push(y)
  }
  return rows
}

/** 按 disposal 规则把索引帧合成为全尺寸 RGBA 帧序列 */
export function composeGif(g: ParsedGif): GifRenderedFrame[] {
  const base = new ImageData(g.width, g.height)
  const frames: GifRenderedFrame[] = []
  let saved: Uint8ClampedArray | null = null
  let t = 0
  for (const f of g.raw) {
    if (f.disposal === 3) saved = new Uint8ClampedArray(base.data)
    const rows = f.interlaced ? gifInterlaceRows(f.height) : null
    for (let y = 0; y < f.height; y++) {
      const sy = rows ? rows[y] : y
      for (let x = 0; x < f.width; x++) {
        const idx = f.indices[y * f.width + x]
        if (idx === f.transparent) continue
        const di = ((f.top + sy) * g.width + (f.left + x)) * 4
        const pi = idx * 3
        base.data[di] = f.palette[pi]
        base.data[di + 1] = f.palette[pi + 1]
        base.data[di + 2] = f.palette[pi + 2]
        base.data[di + 3] = 255
      }
    }
    frames.push({ image: new ImageData(new Uint8ClampedArray(base.data), g.width, g.height), time: t })
    t += f.delayMs / 1000
    if (f.disposal === 2) {
      // 恢复为背景：帧矩形清成透明
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          base.data[((f.top + y) * g.width + (f.left + x)) * 4 + 3] = 0
        }
      }
    } else if (f.disposal === 3 && saved) {
      base.data.set(saved)
      saved = null
    }
  }
  return frames
}

/** 上传探测用：从 GIF 二进制读总时长与尺寸（解析失败返回 null） */
export function probeGifMeta(buf: ArrayBuffer): GifMeta | null {
  const g = parseGif(buf)
  if (!g) return null
  return { width: g.width, height: g.height, duration: g.duration, frames: g.frames }
}

/**
 * 单个 GIF 地址的逐帧控制器：解析一次拿到全帧 ImageData，
 * 时间轴按素材时刻取最近帧并 cover 烘焙（与 VideoMedia 同一抽格接口）。
 */
class GifMedia {
  private ready: Promise<{ frames: GifRenderedFrame[]; duration: number } | null> | null = null
  private frames = new Map<string, CachedFrame>()
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  constructor(private T: PixiNS, readonly url: string) {}

  private ensure() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      try {
        const res = await fetch(this.url)
        const buf = await res.arrayBuffer()
        const parsed = parseGif(buf)
        if (!parsed) return null
        return { frames: composeGif(parsed), duration: parsed.duration }
      } catch {
        return null
      }
    })()
    return this.ready
  }

  /** 请求某个素材时刻对应的 GIF 帧封面格（失败 resolve null，不抛异常） */
  requestCell(time: number, w: number, h: number): Promise<import('pixi.js').Texture | null> {
    return this.ensure().then(decoded => {
      if (!decoded || !decoded.frames.length) return null
      const tf = decoded.frames
      // 超界钳到首 / 尾帧
      let fi = 0
      for (let i = 0; i < tf.length; i++) {
        if (tf[i].time <= time) fi = i
        else break
      }
      const key = `${fi}@${w}x${h}`
      const hit = this.frames.get(key)
      if (hit) {
        hit.last = performance.now()
        return hit.tex
      }
      if (!this.canvas) {
        this.canvas = document.createElement('canvas')
        this.canvas.width = tf[0].image.width
        this.canvas.height = tf[0].image.height
        this.ctx = this.canvas.getContext('2d')
      }
      const cv = this.canvas!
      this.ctx!.putImageData(tf[fi].image, 0, 0)
      const tex = bakeCover(this.T, cv, cv.width, cv.height, w, h)
      this.storeFrame(key, tex)
      return tex
    })
  }

  private storeFrame(key: string, tex: import('pixi.js').Texture) {
    this.frames.set(key, { tex, last: performance.now() })
    if (this.frames.size > GIF_FRAME_LRU) {
      const oldestKey = this.frames.keys().next().value as string | undefined
      if (oldestKey && oldestKey !== key) {
        const old = this.frames.get(oldestKey)!
        this.frames.delete(oldestKey)
        try {
          old.tex.destroy(true)
        } catch {
          /* noop */
        }
      }
    }
  }

  destroy() {
    this.frames.forEach(f => {
      try {
        f.tex.destroy(true)
      } catch {
        /* noop */
      }
    })
    this.frames.clear()
  }
}

/* ---------------- 全局共享的音频上下文 ---------------- */

let sharedAudioCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) sharedAudioCtx = new AudioContext()
  return sharedAudioCtx
}

/* ---------------- 媒体资源总存储 ---------------- */

export class MediaStore {
  private videos = new Map<string, VideoMedia>()
  private gifs = new Map<string, GifMedia>()
  private audioFiles = new Map<string, Promise<AudioBuffer | null>>()
  private images = new Map<string, Promise<HTMLImageElement | null>>()
  private tiles = new Map<string, Promise<import('pixi.js').Texture | null>>()

  constructor(private T: PixiNS) {}

  getVideo(url: string): VideoMedia {
    let v = this.videos.get(url)
    if (!v) {
      v = new VideoMedia(this.T, url)
      this.videos.set(url, v)
    }
    return v
  }

  /** GIF：解析一次逐帧抽格（接口与 getVideo 一致） */
  getGif(url: string): GifMedia {
    let g = this.gifs.get(url)
    if (!g) {
      g = new GifMedia(this.T, url)
      this.gifs.set(url, g)
    }
    return g
  }

  /** 独立音频文件（mp3/wav…）解码 */
  getAudioFile(url: string): Promise<AudioBuffer | null> {
    let p = this.audioFiles.get(url)
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(url)
          const ab = await res.arrayBuffer()
          return await getAudioContext().decodeAudioData(ab.slice(0))
        } catch {
          return null
        }
      })()
      this.audioFiles.set(url, p)
    }
    return p
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    let p = this.images.get(url)
    if (!p) {
      p = new Promise(resolve => {
        const img = new Image()
        // 跨源素材（后端 /files、/uploads）必须带 CORS，否则 drawImage 会污染 canvas，
        // PIXI 上传纹理时报 "Tainted canvases may not be loaded"
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      })
      this.images.set(url, p)
    }
    return p
  }

  /** 图片 / GIF 首帧 / 贴纸的 cover 平铺瓦片 */
  getCoverTile(url: string, w: number, h: number): Promise<import('pixi.js').Texture | null> {
    const key = `${url}|${w}|${h}`
    let p = this.tiles.get(key)
    if (!p) {
      p = (async () => {
        const img = await this.loadImage(url)
        if (!img || !img.naturalWidth) return null
        return bakeCover(this.T, img, img.naturalWidth, img.naturalHeight, w, h)
      })()
      this.tiles.set(key, p)
    }
    return p
  }

  destroy() {
    this.videos.forEach(v => v.destroy())
    this.videos.clear()
    this.gifs.forEach(g => g.destroy())
    this.gifs.clear()
    this.audioFiles.clear()
    this.tiles.forEach(p => {
      p.then(t => {
        if (t) {
          try {
            t.destroy(true)
          } catch {
            /* noop */
          }
        }
      })
    })
    this.tiles.clear()
    this.images.clear()
  }
}

export function createMediaStore(T: PixiNS): MediaStore {
  return new MediaStore(T)
}
