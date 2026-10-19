/* ============================================================
 *  编辑器框架 · 编解码（codec）· 时间线成片导出
 *
 *  把底部时间线合成为一条 MP4（H.264 + AAC）：
 *  - 视频：调用方逐帧把 pixi 画布渲染为「该时刻的多层合成静帧」，
 *    本模块用 mediabunny CanvasSource 读取同一 canvas 的每一帧并编码；
 *  - 音频：OfflineAudioContext 离线渲染——每个可闻片段（音频轨 +
 *    视频原声）解码区间缓冲后按「恒定音量倍率 + 头淡入 / 尾淡出」
 *    包络汇入双声道总线（与播放器 PlayerMixer 同口径），startRendering
 *    得到整条时间线的混音 AudioBuffer，再用 AudioBufferSource 编码 AAC；
 *  - 封装：Mp4OutputFormat(fastStart in-memory) + BufferTarget，
 *    finalize 后返回完整 ArrayBuffer 供调用方下载。
 *
 *  本文件不依赖 pixi / DOM UI；逐帧渲染由 prepareFrame 回调承担
 *  （实现在播放器侧 exportCapture mixin）。
 * ============================================================ */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output
} from 'mediabunny'
import type { MediaSourceDecoder } from './playerMediaSourceDecoder'

/** 离线混音需要的片段窄结构（TlClip 结构化兼容，与 PlayerMixer.MixClip 同口径） */
export interface ExportMixClip {
  id: string
  url: string
  /** 时间线起点 / 终点（秒） */
  start: number
  end: number
  /** 素材入点（秒） */
  sourceStart: number
  /** 音量线性倍率 0-10 */
  volume: number
  /** 淡入 / 淡出时长（秒） */
  fadeIn: number
  fadeOut: number
}

export interface TimelineExportOptions {
  /** 成片宽（偶数，像素）——即草稿画布宽 */
  width: number
  /** 成片高（偶数，像素）——即草稿画布高 */
  height: number
  /** 帧率（与时间轴 30fps 一致） */
  fps: number
  /** 时间线总时长（秒） */
  duration: number
  /** 捕获目标：调用方的 pixi 画布，prepareFrame 完成后该画布即为当前帧 */
  canvas: HTMLCanvasElement
  /** 逐帧回调：把时间线 t 时刻的多层合成静帧画好并同步上屏到 canvas */
  prepareFrame: (t: number) => Promise<void>
  /** 参与混音的可闻片段（已剔除静音轨 / 静音片段）；空数组导出无声纯视频 */
  clips: ExportMixClip[]
  /** 按 URL 取媒体解码器（与播放器共用资源池，区间缓冲已缓存可直接复用） */
  getDecoder: (url: string) => Promise<MediaSourceDecoder>
  /** 区间音频解码所用的真实 AudioContext（仅用其 createBuffer；须已在用户手势内创建） */
  decodeCtx: AudioContext
  /** 进度回调：phase 'video'|'audio'|'mux'，ratio 0-1 */
  onProgress?: (phase: 'video' | 'audio' | 'mux', ratio: number) => void
  /** 取消令牌：cancelled=true 时尽快中止并抛 'abort' */
  signal?: { cancelled: boolean }
}

/** 离线混音采样率（AAC 常规 48k；源缓冲采样率不同时 Web Audio 自动重采样） */
const EXPORT_SAMPLE_RATE = 48000

/**
 * 离线渲染整条时间线的混音（双声道）。
 * 包络与 PlayerMixer.schedule 完全一致：恒定音量倍率 + 相对片段头的
 * 淡入（0→vol）/ 相对片段尾的淡出（vol→0.0001）。
 */
async function renderMixdown(
  clips: ExportMixClip[],
  duration: number,
  opts: TimelineExportOptions
): Promise<AudioBuffer> {
  const total = Math.max(0.1, duration)
  const offline = new OfflineAudioContext(2, Math.ceil(total * EXPORT_SAMPLE_RATE), EXPORT_SAMPLE_RATE)

  // 先并发解码各片段区间缓冲（同一解码器内部仍串行排队，不同素材源可并行），
  // 再按时间顺序排入离线混音图——解码通常是混音阶段最慢的一步。
  opts.onProgress?.('audio', 0)
  let decoded = 0
  const buffers = await Promise.all(
    clips.map(async c => {
      if (opts.signal?.cancelled) throw new Error('abort')
      const clipDur = Math.max(0, c.end - c.start)
      if (clipDur <= 0.01) return null
      let buf: AudioBuffer | null = null
      try {
        const dec = await opts.getDecoder(c.url)
        buf = await dec.buildClipAudio(opts.decodeCtx, c.id, c.sourceStart, clipDur)
      } catch {
        /* 单个片段解码失败：静默，不影响其他轨 */
      }
      decoded++
      opts.onProgress?.('audio', decoded / Math.max(1, clips.length))
      return buf ? { c, buf, clipDur } : null
    })
  )
  if (opts.signal?.cancelled) throw new Error('abort')

  for (const item of buffers) {
    if (!item) continue
    const { c, buf, clipDur } = item

    const node = offline.createBufferSource()
    node.buffer = buf
    const gain = offline.createGain()
    const vol = Math.min(10, Math.max(0, c.volume))
    const fi = Math.max(0, Math.min(c.fadeIn, clipDur))
    const fo = Math.max(0, Math.min(c.fadeOut, clipDur))
    if (fi > 0) {
      gain.gain.setValueAtTime(0, c.start)
      gain.gain.linearRampToValueAtTime(vol, c.start + fi)
    } else {
      gain.gain.setValueAtTime(vol, c.start)
    }
    if (fo > 0) {
      gain.gain.setValueAtTime(vol, c.end - fo)
      gain.gain.linearRampToValueAtTime(0.0001, c.end)
    }
    node.connect(gain)
    gain.connect(offline.destination)
    node.start(c.start, 0, clipDur + 0.02)
    node.stop(c.end + 0.02)
  }

  return offline.startRendering()
}

/**
 * 导出时间线成片 MP4。逐帧驱动 prepareFrame 捕获画面，离线渲染混音，
 * finalize 后 resolve 完整文件缓冲。
 */
export async function exportTimelineMp4(opts: TimelineExportOptions): Promise<ArrayBuffer> {
  const width = Math.max(2, opts.width - (opts.width % 2))
  const height = Math.max(2, opts.height - (opts.height % 2))
  const fps = Math.max(1, opts.fps)
  const duration = Math.max(1 / fps, opts.duration)
  const frameCount = Math.max(1, Math.round(duration * fps))
  const frameDur = 1 / fps

  // —— 视频：CanvasSource 逐帧读 canvas；码率按分辨率 / 帧率自适应 ——
  // 经验系数 0.12 bit/像素/帧：1080p30 ≈ 7.5 Mbps，钳在 3-20 Mbps。
  const videoBitrate = Math.min(
    20_000_000,
    Math.max(3_000_000, Math.round(width * height * fps * 0.12))
  )
  const canvasSource = new CanvasSource(opts.canvas, {
    codec: 'avc',
    bitrate: videoBitrate,
    keyFrameInterval: 2,
    sizeChangeBehavior: 'deny'
  })

  // —— 音频：离线混音与视频逐帧渲染并行 ——
  // 混音最慢的一步是先解出各片段区间缓冲；把它放在视频循环之前启动、
  // 循环结束后再取结果，就能和逐帧渲染 / 编码完全重叠，长音频时间线可省数秒。
  const hasAudio = opts.clips.length > 0
  const mixPromise: Promise<AudioBuffer | null> = hasAudio
    ? renderMixdown(opts.clips, duration, opts)
    : Promise.resolve(null)
  // 并行期间先兜住拒绝，避免产生未处理的 Promise 拒绝；真正的错误在下方 await 处抛出
  mixPromise.catch(() => undefined)

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target
  })
  output.addVideoTrack(canvasSource, { frameRate: fps })
  let audioSource: AudioBufferSource | null = null
  if (hasAudio) {
    audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
    output.addAudioTrack(audioSource)
  }
  await output.start()

  // —— 视频：逐帧渲染 → 捕获 → 编码（await 尊重编码器背压）——
  for (let i = 0; i < frameCount; i++) {
    if (opts.signal?.cancelled) {
      await output.cancel().catch(() => undefined)
      throw new Error('abort')
    }
    const t = i * frameDur
    await opts.prepareFrame(t)
    // CanvasSource.add 同步抓当前 canvas；duration 让末帧也占满一个帧间隔
    await canvasSource.add(t, frameDur)
    if ((i & 7) === 0 || i === frameCount - 1) {
      opts.onProgress?.('video', (i + 1) / frameCount)
      // 让出主线程，给进度遮罩绘制 / 浏览器事件留空
      await new Promise(r => setTimeout(r, 0))
    }
  }
  canvasSource.close()

  // 取回并行混音结果并一次性写入音轨（离线渲染已得到整条混音）
  if (audioSource) {
    try {
      const audioBuffer = await mixPromise
      if (audioBuffer) await audioSource.add(audioBuffer)
      audioSource.close()
    } catch (err) {
      await output.cancel().catch(() => undefined)
      throw err
    }
  }
  opts.onProgress?.('mux', 0.2)
  await output.finalize()
  opts.onProgress?.('mux', 1)

  const buffer = target.buffer
  if (!buffer) throw new Error('导出失败：输出缓冲为空')
  return buffer
}
