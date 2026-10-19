/* ============================================================
 *  时间轴 · 视频画面抽帧器（参考 asconfig/TimelineEditor.vue 的三种解析方式）
 *
 *  单入口 extract() 按运行环境选择策略，返回与时刻下标对齐的、
 *  已按 cover 烘焙成"格宽 × 格高"的 pixi 纹理（失败位置为 null）。
 *  LRU 缓存 / 微任务合批由上层 timelineMedia.ts 的 VideoMedia 负责：
 *
 *  1. extractSampleFrames —— mediabunny VideoSampleSink 按时间点取已解码
 *     sample。流数据连续，适合长跨度或少量格子（>30s 或 <30 格）。
 *  2. extractEncodedFrames —— EncodedPacketSink 顺序喂 WebCodecs
 *     VideoDecoder，只解到最后一个目标时刻即停，短而密的区间更快。
 *  3. extractVideoElementFrames —— 无 WebGPU 时的兜底：原生 <video>
 *     seek 到目标时刻后用 canvas 拷贝像素，得到脱离 video 的独立帧。
 *
 *  分流规则与参考一致：
 *    有 GPU：跨度 >30s 或 格数 <30 → 路径 1，否则路径 2
 *    无 GPU：路径 3
 *  路径 1/2 整体失败时回退路径 3，保证抽格不抛异常。
 *
 *  注意（实测坑）：WebCodecs 硬解的 VideoFrame 来自有限大小的 GPU 帧池，
 *  输出回调里若把 frame 留存（攒一批再烘焙），帧池耗尽后解码器会永久
 *  停摆、decoder.flush() 也不返回。因此每条路径都必须在拿到帧的当下
 *  同步烘焙并立即 close（参考 bakeFrameToSprite 也是在回调里即刻烘焙）。
 * ============================================================ */
import { VideoSampleSink, EncodedPacketSink, type Input } from 'mediabunny'
import { bakeCover } from './timelineBakeCover'

type PixiNS = typeof import('pixi.js')

/** Input.getPrimaryVideoTrack() resolve 出的非空轨道类型 */
type VideoTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>

export interface ExtractOptions {
  track: VideoTrack
  url: string
  /** 目标时刻数组（秒，相对素材），无需排序，返回值按下标对齐 */
  times: number[]
  /** 烘焙格宽 / 高（px） */
  w: number
  h: number
}

/** 仅取 navigator.gpu 形态，避免依赖 @webgpu/types */
interface GpuNavigator {
  gpu?: {
    requestAdapter: () => Promise<unknown>
  }
}

const waitEvent = (video: HTMLVideoElement, event: string, timeoutMs = 8000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`video ${event} 超时`))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onErr)
    }
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(video.error ?? new Error(`video ${event} 失败`))
    }
    video.addEventListener(event, onOk, { once: true })
    video.addEventListener('error', onErr, { once: true })
  })

export class FrameExtractor {
  /** WebGPU 探测结果缓存（undefined=未探测） */
  private static gpu: boolean | undefined

  /**
   * 单帧取图复用的 VideoSampleSink（一个 VideoMedia 一个 extractor、一条轨）。
   * getSample 每次调用内部都新建独立解码管线，sink 本身只持有轨道引用，可复用。
   */
  private sampleSink: VideoSampleSink | null = null

  constructor(private T: PixiNS) {}

  /** 判断 WebGPU 适配器是否存在（对齐参考 onMounted 里的 requestAdapter） */
  static async hasGpu(): Promise<boolean> {
    if (this.gpu !== undefined) return this.gpu
    let ok = false
    try {
      const gpu = (navigator as unknown as GpuNavigator).gpu
      if (gpu) ok = (await gpu.requestAdapter()) != null
    } catch {
      ok = false
    }
    if (!ok) console.warn('[FrameExtractor] 没有可用 WebGPU 设备，视频缩略改用 video seek 截帧')
    this.gpu = ok
    return ok
  }

  /**
   * 单入口：按 GPU / 跨度 / 格数选择策略抽帧。
   * 返回数组与 opts.times 下标一一对应，失败位置为 null（不抛异常）。
   */
  async extract(opts: ExtractOptions): Promise<(import('pixi.js').Texture | null)[]> {
    const times = opts.times.map(t => Math.max(0, t))
    // 各策略内部都按升序迭代；记录原下标用于把结果还原为调用顺序
    const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b])
    const sortedTimes = order.map(i => times[i])
    const out: (import('pixi.js').Texture | null)[] = new Array(times.length).fill(null)
    if (!sortedTimes.length) return out

    let sorted: (import('pixi.js').Texture | null)[]
    const gpu = await FrameExtractor.hasGpu()
    const span = sortedTimes[sortedTimes.length - 1] - sortedTimes[0]
    if (gpu && !(span > 30 || sortedTimes.length < 30)) {
      // 短而密：优先 encoded，失败回退 seek
      try {
        sorted = await this.extractEncodedFrames(opts.track, sortedTimes, opts.w, opts.h)
      } catch (err) {
        console.warn('[FrameExtractor] encoded 抽帧失败，回退 video seek', err)
        sorted = await this.extractVideoElementFrames(opts.url, sortedTimes, opts.w, opts.h)
      }
    } else if (gpu) {
      try {
        sorted = await this.extractSampleFrames(opts.track, sortedTimes, opts.w, opts.h)
      } catch (err) {
        console.warn('[FrameExtractor] sample 抽帧失败，回退 video seek', err)
        sorted = await this.extractVideoElementFrames(opts.url, sortedTimes, opts.w, opts.h)
      }
    } else {
      sorted = await this.extractVideoElementFrames(opts.url, sortedTimes, opts.w, opts.h)
    }
    order.forEach((origIdx, k) => {
      out[origIdx] = sorted[k]
    })
    return out
  }

  /**
   * 单帧快取：立刻用 VideoSampleSink.getSample(time) 只取目标时刻一帧，
   * 解到即烘焙返回，不等待同素材其它时刻（轨道缩略格"完成一格上屏一格"）。
   * 无 GPU 或 getSample 失败时回退原生 video seek 截同一时刻单帧。
   * 失败返回 null，不抛异常。
   */
  async extractOne(
    track: VideoTrack,
    url: string,
    time: number,
    w: number,
    h: number
  ): Promise<import('pixi.js').Texture | null> {
    const t = Math.max(0, time)
    if (await FrameExtractor.hasGpu()) {
      try {
        if (!this.sampleSink) this.sampleSink = new VideoSampleSink(track)
        const sample = await this.sampleSink.getSample(t)
        if (sample) {
          let frame: VideoFrame | null = null
          try {
            frame = sample.toVideoFrame()
            return this.bake(
              frame as unknown as CanvasImageSource,
              frame.displayWidth || frame.codedWidth,
              frame.displayHeight || frame.codedHeight,
              w,
              h
            )
          } finally {
            try {
              frame?.close()
            } catch {
              /* noop */
            }
            try {
              sample.close()
            } catch {
              /* noop */
            }
          }
        }
        return null
      } catch (err) {
        console.warn('[FrameExtractor] getSample 单帧失败，回退 video seek', err)
        this.sampleSink = null
      }
    }
    const arr = await this.extractVideoElementFrames(url, [t], w, h)
    return arr[0] ?? null
  }

  /** 拿到帧的当下同步 cover 烘焙；调用方负责随后立刻释放帧源 */
  private bake(
    source: CanvasImageSource,
    sw: number,
    sh: number,
    w: number,
    h: number
  ): import('pixi.js').Texture | null {
    try {
      return bakeCover(this.T, source, sw, sh, w, h)
    } catch {
      return null
    }
  }

  /**
   * 路径 1：VideoSampleSink.samplesAtTimestamps 批量取已解码帧
   * （对应参考 extractSampleFrames，时刻由上层显式给出）。
   */
  async extractSampleFrames(
    track: VideoTrack,
    times: number[],
    w: number,
    h: number
  ): Promise<(import('pixi.js').Texture | null)[]> {
    const out: (import('pixi.js').Texture | null)[] = new Array(times.length).fill(null)
    const sink = new VideoSampleSink(track)
    // 直接传普通数组（同步可迭代即可，与参考实现一致），不再额外包一层 async
    // generator——旧 gen 在循环异常 / 中断时无法被 return() 回收，会作为悬挂
    // 的异步迭代器被 GC，连带 mediabunny 管线内未取走的 VideoSample 触发泄漏警告
    const iter = sink.samplesAtTimestamps(times)
    let i = 0
    try {
      while (true) {
        const next = await iter.next()
        if (next.done) break
        const sample = next.value
        if (sample) {
          let frame: VideoFrame | null = null
          try {
            frame = sample.toVideoFrame()
            out[i] = this.bake(
              frame as unknown as CanvasImageSource,
              frame.displayWidth || frame.codedWidth,
              frame.displayHeight || frame.codedHeight,
              w,
              h
            )
          } catch {
            out[i] = null
          } finally {
            try {
              frame?.close()
            } catch {
              /* noop */
            }
            try {
              sample.close()
            } catch {
              /* noop */
            }
          }
        }
        i++
        // 让出事件循环，避免连续抽帧阻塞渲染
        await new Promise(r => setTimeout(r, 0))
      }
    } finally {
      // 异常 / 中断时显式归还迭代器：mediabunny 会在 return() 里关闭队列中
      // 已解码但未被消费的 sample，杜绝 "VideoSample was garbage collected"
      try {
        await iter.return?.(undefined)
      } catch {
        /* noop */
      }
    }
    return out
  }

  /**
   * 路径 2：EncodedPacketSink + WebCodecs VideoDecoder 顺序解码，
   * 命中目标时刻的输出即刻烘焙（对应参考 extractEncodedFrames）。
   */
  async extractEncodedFrames(
    track: VideoTrack,
    times: number[],
    w: number,
    h: number
  ): Promise<(import('pixi.js').Texture | null)[]> {
    const out: (import('pixi.js').Texture | null)[] = new Array(times.length).fill(null)
    if (!times.length) return out

    const decoderConfig = await track.getDecoderConfig()
    if (!decoderConfig) throw new Error('获取 decoderConfig 失败')
    const { supported } = await VideoDecoder.isConfigSupported(decoderConfig)
    if (!supported) throw new Error('浏览器解码器配置不支持')

    // 解码按提交顺序输出，用队列把输出帧对应回目标格（-1=过路帧，丢弃）
    const slotQueue: number[] = []
    const decoder = new VideoDecoder({
      output: frame => {
        const slot = slotQueue.shift()
        if (slot !== undefined && slot >= 0) {
          // 必须即刻烘焙 + close：留存 VideoFrame 会耗尽 GPU 帧池导致解码器停摆
          out[slot] = this.bake(
            frame as unknown as CanvasImageSource,
            frame.displayWidth || frame.codedWidth,
            frame.displayHeight || frame.codedHeight,
            w,
            h
          )
        }
        frame.close()
      },
      error: err => console.error('[FrameExtractor] decode error', err)
    })
    decoder.configure(decoderConfig)

    try {
      const sink = new EncodedPacketSink(track)

      // 先喂首个关键帧（输出丢弃），为后续包建立解码上下文
      const first = await sink.getFirstKeyPacket()
      if (first) {
        decoder.decode(first.toEncodedVideoChunk())
        slotQueue.push(-1)
      }

      let iter = 0
      for await (const pkt of sink.packets()) {
        const chunk = pkt.toEncodedVideoChunk()
        let slot = -1
        const ptsSec = chunk.timestamp / 1_000_000
        // 当前包时间越过目标时刻，命中一个待抽格
        if (iter < times.length && ptsSec >= times[iter]) {
          slot = iter
          iter++
        }
        decoder.decode(chunk)
        slotQueue.push(slot)
        if (iter >= times.length) break
      }

      await decoder.flush()
    } finally {
      try {
        decoder.close()
      } catch {
        /* noop */
      }
    }
    return out
  }

  /**
   * 路径 3：原生 <video> 逐个 seek，canvas 拷贝像素后即刻烘焙
   * （对应参考 extractPixiVideoFrames，不依赖 pixi Assets / GPU）。
   */
  async extractVideoElementFrames(
    url: string,
    times: number[],
    w: number,
    h: number
  ): Promise<(import('pixi.js').Texture | null)[]> {
    const out: (import('pixi.js').Texture | null)[] = new Array(times.length).fill(null)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = url
    try {
      await waitEvent(video, 'loadedmetadata')
      for (let i = 0; i < times.length; i++) {
        video.currentTime = times[i]
        await waitEvent(video, 'seeked')
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (!vw || !vh) continue
        // canvas 像素拷贝脱离 video，再烘焙成格纹理
        const canvas = document.createElement('canvas')
        canvas.width = vw
        canvas.height = vh
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(video, 0, 0, vw, vh)
        out[i] = this.bake(canvas, vw, vh, w, h)
        await new Promise(r => setTimeout(r, 0))
      }
    } catch (err) {
      console.warn('[FrameExtractor] video seek 抽帧中断', err)
    } finally {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        /* noop */
      }
    }
    return out
  }
}
