/* ============================================================
 *  编辑器框架 · 编解码（codec）· 播放器媒体源解码器
 *
 *  单个媒体源解码器（按 URL 缓存、跨片段复用），从 player/playerBase 抽取，
 *  抽出，供播放器时间轴逐帧 / 区间音频解码使用：
 *  - 视频：VideoSampleSink 顺序 / 随机取帧；
 *  - 音频：按片段区间 [start,start+dur) 解码为独立 AudioBuffer
 *    （避免把整支长音频一次性解出），区间结果按键缓存，同一 sink 的
 *    区间解码经串行链排队（mediabunny 不保证同 sink 并发迭代安全）。
 * ============================================================ */
import {
  Input,
  ALL_FORMATS,
  UrlSource,
  VideoSampleSink,
  AudioSampleSink
} from 'mediabunny'

export class MediaSourceDecoder {
  input!: Input
  videoSink: VideoSampleSink | null = null
  audioSink: AudioSampleSink | null = null
  displayWidth = 0
  displayHeight = 0
  private clipBuffers = new Map<string, Promise<AudioBuffer | null>>()
  private audioChain: Promise<unknown> = Promise.resolve()

  static async create(url: string): Promise<MediaSourceDecoder> {
    const d = new MediaSourceDecoder()
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
    d.input = input
    if (!(await input.canRead())) throw new Error('无法识别的媒体格式')
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack()
    ])
    if (videoTrack && (await videoTrack.canDecode())) {
      d.videoSink = new VideoSampleSink(videoTrack)
      d.displayWidth = (await videoTrack.getDisplayWidth()) || 0
      d.displayHeight = (await videoTrack.getDisplayHeight()) || 0
    }
    if (audioTrack && (await audioTrack.canDecode())) {
      d.audioSink = new AudioSampleSink(audioTrack)
    }
    return d
  }

  /**
   * 解码素材 [rangeStart, rangeStart+rangeDur) 为一个 AudioBuffer。
   * key 通常为片段 id，保证同一片段 seek 后复用、不同片段各自缓存。
   */
  buildClipAudio(
    ctx: AudioContext,
    key: string,
    rangeStart: number,
    rangeDur: number
  ): Promise<AudioBuffer | null> {
    if (!this.audioSink) return Promise.resolve(null)
    let p = this.clipBuffers.get(key)
    if (!p) {
      const run = this.audioChain.then(() => this.drainRange(ctx, rangeStart, rangeDur))
      // 串行链：无论本次成功失败都允许后续区间继续；失败结果照常缓存给调用方
      this.audioChain = run.then(
        () => undefined,
        () => undefined
      )
      p = run
      this.clipBuffers.set(key, p)
    }
    return p
  }

  private async drainRange(
    ctx: AudioContext,
    rangeStart: number,
    rangeDur: number
  ): Promise<AudioBuffer | null> {
    const endT = rangeStart + Math.max(0.02, rangeDur)
    const pieces: { buf: AudioBuffer; offset: number }[] = []
    let rate = 0
    let ch = 0
    try {
      for await (const sample of this.audioSink!.samples(Math.max(0, rangeStart), endT)) {
        const b = sample.toAudioBuffer()
        sample.close()
        if (!rate) {
          rate = b.sampleRate
          ch = b.numberOfChannels
        }
        // sink 起点可能落在区间之前（分包对齐）：按时间戳换算在目标缓冲中的位置
        const offset = Math.max(0, Math.round((sample.timestamp - rangeStart) * b.sampleRate))
        pieces.push({ buf: b, offset })
      }
    } catch {
      return null
    }
    if (!pieces.length || !rate || !ch) return null
    const total = Math.round(rangeDur * rate)
    const out = ctx.createBuffer(ch, Math.max(1, total), rate)
    for (const { buf, offset } of pieces) {
      if (offset >= total) continue
      const n = Math.min(buf.length, total - offset)
      for (let c = 0; c < Math.min(ch, buf.numberOfChannels); c++) {
        out.copyToChannel(buf.getChannelData(c).subarray(0, n), c, offset)
      }
    }
    return out
  }

  dispose() {
    try {
      this.input.dispose()
    } catch {
      /* noop */
    }
  }
}
