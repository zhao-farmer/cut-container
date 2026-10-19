/* ============================================================
 *  编辑器框架 · 编解码（codec）· 播放器 · 多轨合成资源池
 *
 *  从播放器内核（player/core）抽出的「时间线合成播放」资源层，
 *  不依赖 pixi / DOM UI，只负责按 URL 缓存与复用：
 *  - MediaSourceDecoder：视频 / 音频同源共享（视频逐帧 / 区间音频）
 *  - HTMLImageElement：图片 / 贴纸首帧（GIF 首帧由 drawImage 天然保证）
 *  - GIF 逐帧解码结果（parseGif + composeGif），含每片段上次绘制帧序号
 *  - 素材原生尺寸回填（供「原始比例」读取）
 *  - 同 URL 静帧取帧串行链（mediabunny 同 sink 并发迭代不安全）
 *  - 起播前批量预取（音频区间缓冲 / 解码器 / 图片）
 *
 *  单个资源失败不阻断整体（调用方按静默 / 黑场处理）。
 * ============================================================ */
import { MediaSourceDecoder } from './playerMediaSourceDecoder'
import { composeGif, parseGif } from './timelineMedia'
import type { GifRenderedFrame } from './timelineMedia'

/** 资源池需要的片段窄结构（TlClip 结构化兼容） */
export interface ResourceClip {
  id: string
  url: string
  kind: 'video' | 'image' | 'audio' | 'sticker' | 'text' | 'caption'
  format?: string
  /** 时间线起点 / 终点（秒） */
  start: number
  end: number
  /** 素材入点（秒） */
  sourceStart: number
  visible: boolean
}

export interface GifData {
  frames: GifRenderedFrame[]
  duration: number
}

/** 导出顺序取帧游标：一条 samples() 迭代器 + 当前帧 / 下一帧 */
interface SeqCursor {
  dec: MediaSourceDecoder
  iter: AsyncIterator<any> | null
  cur: any
  next: any
  /** 上一次请求的目标时刻，用于发现时间回退 */
  lastT: number
  done: boolean
}

/** 是否为 GIF 动图片段（图片 / 贴纸类、format=gif 或 url 以 .gif 结尾） */
export function isGifClip(c: { kind: string; format?: string; url: string }): boolean {
  return (
    (c.kind === 'image' || c.kind === 'sticker') &&
    (c.format === 'gif' || /\.gif(\?|$)/i.test(c.url))
  )
}

export class PlayerResources {
  /** 按 URL 缓存的媒体解码器（视频/音频同 Input） */
  private decoders = new Map<string, Promise<MediaSourceDecoder>>()
  /** 按 URL 缓存的图片元素 */
  private images = new Map<string, Promise<HTMLImageElement>>()
  /** 按 URL 缓存的 GIF 逐帧解码结果 */
  private gifs = new Map<string, Promise<GifData | null>>()
  /** 按 URL 记录素材原生尺寸（解码器/图片加载完成后回填） */
  private dims = new Map<string, { w: number; h: number }>()
  /** 同 URL 静帧取帧串行链 */
  private stillChain = new Map<string, Promise<unknown>>()
  /** 导出顺序取帧模式开关 */
  private seqActive = false
  /** 导出顺序取帧游标（按片段 id） */
  private seqCursors = new Map<string, SeqCursor>()
  /** 记录每个 GIF 片段上一次绘制的帧序号，避免每 tick 重绘同一帧 */
  readonly gifFrameIdx = new Map<string, number>()

  /** 取（或惰性创建）某 URL 的解码器，同一源的多个片段共享 */
  getDecoder(url: string): Promise<MediaSourceDecoder> {
    let p = this.decoders.get(url)
    if (!p) {
      p = MediaSourceDecoder.create(url).catch(err => {
        // 创建失败移出缓存，允许后续重试
        this.decoders.delete(url)
        throw err
      })
      p.then(d => {
        if (d.displayWidth > 0 && d.displayHeight > 0) {
          this.dims.set(url, { w: d.displayWidth, h: d.displayHeight })
        }
      }, () => undefined)
      this.decoders.set(url, p)
    }
    return p
  }

  getImage(url: string): Promise<HTMLImageElement> {
    let p = this.images.get(url)
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('图片加载失败'))
        img.src = url
      })
      p.catch(() => this.images.delete(url))
      p.then(img => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          this.dims.set(url, { w: img.naturalWidth, h: img.naturalHeight })
        }
      }, () => undefined)
      this.images.set(url, p)
    }
    return p
  }

  /** 取（或惰性创建）某 URL 的 GIF 逐帧解码结果，失败 resolve null */
  getGif(url: string): Promise<GifData | null> {
    let p = this.gifs.get(url)
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(url)
          const buf = await res.arrayBuffer()
          const parsed = parseGif(buf)
          if (!parsed) return null
          return { frames: composeGif(parsed), duration: parsed.duration }
        } catch {
          return null
        }
      })()
      p.catch(() => this.gifs.delete(url))
      this.gifs.set(url, p)
    }
    return p
  }

  /** 读取已回填的素材原生尺寸（未就绪返回 undefined） */
  getDim(url: string): { w: number; h: number } | undefined {
    return this.dims.get(url)
  }

  /**
   * 导出专用：开启 / 关闭「顺序取帧」模式。
   * 导出按时间单调递增逐帧取图，用每个片段一条顺序迭代器（sink.samples()）
   * 替代逐帧 getSample()——后者每次都要从关键帧重新 seek 解码，是导出慢的主因。
   * 同一 sink 上不能再并发 getSample（mediabunny 不保证安全），故导出期间
   * renderTimelineStill 必须走 getSampleStillSeq。
   */
  beginStillSequence(): void {
    this.endStillSequence()
    this.seqActive = true
  }

  endStillSequence(): void {
    this.seqActive = false
    for (const c of this.seqCursors.values()) this.closeCursor(c)
    this.seqCursors.clear()
  }

  /** 是否处于导出顺序取帧模式 */
  isStillSequencing(): boolean {
    return this.seqActive
  }

  /**
   * 顺序取帧：cursor 按 clipId 维护，内部保留「当前帧 + 下一帧」两张，
   * 目标时刻之前的帧逐张关闭。返回当前帧的 clone 交给调用方 close，
   * cursor 自己持有的那份继续用于后续时刻。
   */
  async getSampleStillSeq(
    url: string,
    clipId: string,
    time: number
  ): Promise<{ frame: any; dec: MediaSourceDecoder } | null> {
    const dec = await this.getDecoder(url)
    if (!dec.videoSink) return null
    const t = Math.max(0, time)
    let c = this.seqCursors.get(clipId)
    if (!c || c.dec !== dec || t < c.lastT - 1e-4) {
      // 首次 / 换了解码器 / 时间回退：重建迭代器（导出正常不会回退）
      if (c) this.closeCursor(c)
      c = {
        dec,
        iter: dec.videoSink.samples(Math.max(0, t - 0.5)),
        cur: null,
        next: null,
        lastT: t,
        done: false
      }
      this.seqCursors.set(clipId, c)
    }
    c.lastT = t
    for (;;) {
      if (!c.next) {
        if (c.done || !c.iter) break
        let r: IteratorResult<any>
        try {
          r = await c.iter.next()
        } catch {
          c.done = true
          break
        }
        if (!r || r.done) {
          c.done = true
          break
        }
        c.next = r.value
      }
      const f = c.next
      if (f.timestamp <= t + 1e-4) {
        if (c.cur && c.cur !== f) {
          try { c.cur.close() } catch { /* noop */ }
        }
        c.cur = f
        c.next = null
      } else {
        break
      }
    }
    if (!c.cur) return null
    let frame = c.cur
    try {
      // VideoFrame.clone 是引用计数级别的浅拷贝，开销可忽略
      if (typeof c.cur.clone === 'function') frame = c.cur.clone()
    } catch {
      /* clone 失败则退回共享帧（调用方 close 后 cursor 会重建） */
    }
    return { frame, dec }
  }

  private closeCursor(c: {
    iter: AsyncIterator<any> | null
    cur: any
    next: any
  }): void {
    try { c.iter?.return?.(undefined) } catch { /* noop */ }
    for (const f of [c.next, c.cur]) {
      try { f?.close?.() } catch { /* noop */ }
    }
    c.iter = null
    c.cur = null
    c.next = null
  }

  /** 同 URL 的随机取帧串行化，避免同 sink 并发迭代；返回帧与解码器（失败 null） */
  getSampleStill(
    url: string,
    time: number
  ): Promise<{ frame: any; dec: MediaSourceDecoder } | null> {
    const prev = this.stillChain.get(url) ?? Promise.resolve()
    const run = prev
      .then(() => this.getDecoder(url))
      .then(dec => {
        if (!dec.videoSink) return null
        return dec.videoSink.getSample(time).then(frame => (frame ? { frame, dec } : null))
      })
      .catch(() => null)
    this.stillChain.set(
      url,
      run.then(() => undefined, () => undefined)
    )
    return run
  }

  /**
   * 起播前预取：所有可闻片段的区间 AudioBuffer 全部解出、
   * 所有视频源解码器打开（建 sink）、所有图片加载完成。
   * 单个资源失败不 reject（该片段播放时自然静默 / 黑场），不阻断整体起播。
   */
  async prepare(
    visualClips: ResourceClip[],
    audibleClips: ResourceClip[],
    ctx: AudioContext | null
  ): Promise<void> {
    const tasks: Promise<unknown>[] = []
    for (const c of audibleClips) {
      tasks.push(
        this.getDecoder(c.url)
          .then(d =>
            ctx
              ? d.buildClipAudio(ctx, c.id, c.sourceStart, c.end - c.start)
              : Promise.resolve(null)
          )
          .catch(() => null)
      )
    }
    const seen = new Set<string>()
    for (const c of visualClips) {
      if (!c.visible) continue
      // 文本 / 字幕表面本地绘制，无需预取资源
      if (c.kind === 'text' || c.kind === 'caption') continue
      const key = `${c.kind}:${c.url}`
      if (seen.has(key)) continue
      seen.add(key)
      if (c.kind === 'image' || c.kind === 'sticker') {
        tasks.push(
          isGifClip(c) ? this.getGif(c.url).catch(() => null) : this.getImage(c.url).catch(() => null)
        )
      } else {
        tasks.push(this.getDecoder(c.url).catch(() => null))
      }
    }
    await Promise.all(tasks)
  }

  /** 释放全部合成解码器 / 图片缓存（退出合成模式或 destroy 时） */
  dispose(): void {
    this.endStillSequence()
    this.decoders.forEach(p => {
      p.then(d => d.dispose()).catch(() => { /* 创建失败/未完成 */ })
    })
    this.decoders.clear()
    this.images.clear()
    this.gifs.clear()
    this.gifFrameIdx.clear()
    this.dims.clear()
    this.stillChain.clear()
  }
}
