/* ============================================================
 *  编辑器框架 · 编解码（codec）· 播放器 · Web Audio 混音器
 *
 *  播放器中唯一的 Web Audio 合成单元（独立文件，不依赖 pixi / DOM UI）：
 *  - AudioContext 由本类唯一持有（单素材播放与时间线混音共用）；
 *  - 单素材模式：音频 Sample 转 AudioBuffer 后直连 destination，
 *    节点登记在 activeSources，停止 / seek 时统一掐断；
 *  - 时间线模式：每个可闻片段（音频轨 + 视频原声）一个 AudioBufferSourceNode，
 *    经各自的增益节点（音量 0-200% + 头淡入 / 尾淡出）汇入 masterGain 天然多轨混音；
 *    masterGain → destination，并挂 L/R 立体声分析 tap 给电平表；
 *  - lookahead 调度（窗口约 0.9s，每个 tick 补排），解码迟到导致的整体
 *    顺延量 drift 直接烘焙进起播墙钟时刻；
 *  - 画面降速后的音频重同步：未起播节点取消重排（听感无损），累计顺延
 *    较大时连在响节点也掐断重排，避免声音持续跑到画面前面。
 * ============================================================ */
import { createStereoTap } from '../levelMeter'
import type { StereoTap } from '../levelMeter'
import type { MediaSourceDecoder } from './playerMediaSourceDecoder'

/** 调度需要的片段窄结构（TlClip 结构化兼容） */
export interface MixClip {
  id: string
  url: string
  start: number
  end: number
  sourceStart: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export interface ScheduleOptions {
  clips: MixClip[]
  /** 本次补排覆盖到的时间线时刻（lookahead 窗口上沿） */
  uptoTl: number
  /** 本次播放会话的时间线起点（秒） */
  startAt: number
  /** 会话墙钟基准（音频模式＝ctxTime+0.12） */
  startClock: number
  /** 解码跟不上时累计的顺延量（秒，只增不减） */
  drift: number
  /** 本次播放会话令牌（runToken） */
  token: number
  /** 会话是否仍有效（令牌未变、仍在播放） */
  isCurrent: () => boolean
  /** 取某 URL 的解码器（区间音频缓冲按需懒取，失败该片段静默） */
  getDecoder: (url: string) => Promise<MediaSourceDecoder>
}

export class PlayerMixer {
  /** 唯一音频上下文（单素材 / 时间线共用；用户手势栈内同步创建） */
  ctx: AudioContext | null = null
  /** 全部已调度 source（单素材直连节点 + 时间线混音节点），停止时统一掐断 */
  readonly activeSources = new Set<AudioBufferSourceNode>()

  /** 混音总线：片段增益 → masterGain → destination */
  private masterGain: GainNode | null = null
  /** 混音总线 → L/R analyser 的电平 tap（播放底栏格子电平表） */
  private busTap: StereoTap | null = null

  /** 本次播放已调度的音频片段 key 集合（key＝clipId:token） */
  private scheduled = new Set<string>()
  /** 在排音频节点的起播时刻 / 去重 key：降速重同步时区分「未起播可平移」与「在响」 */
  private srcInfo = new Map<AudioBufferSourceNode, { when: number; key: string }>()

  /** 在用户手势调用栈内同步创建 / 返回音频上下文 */
  ensureContextSync(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  /** 确保混音总线（masterGain + 立体声电平 tap）存在，随 ctx 生命周期只建一次 */
  ensureBusSync(): { ctx: AudioContext; tap: StereoTap } {
    const ctx = this.ensureContextSync()
    if (!this.masterGain) {
      this.masterGain = ctx.createGain()
      this.masterGain.gain.value = 1
      this.masterGain.connect(ctx.destination)
    }
    if (!this.busTap) {
      this.busTap = createStereoTap(ctx, this.masterGain)
    }
    return { ctx, tap: this.busTap }
  }

  /** 混音总线电平 tap（未建立时间线总线时为 null） */
  get tap(): StereoTap | null {
    return this.busTap
  }

  // —— 单素材播放：直连 destination 的节点跟踪 ——

  track(node: AudioBufferSourceNode): void {
    this.activeSources.add(node)
  }

  untrack(node: AudioBufferSourceNode): void {
    this.activeSources.delete(node)
  }

  /** 掐断全部在播节点（单素材 stop / seek；时间线停止复用同一集合） */
  stopAllSources(): void {
    this.activeSources.forEach(n => {
      try { n.stop() } catch { /* noop */ }
    })
    this.activeSources.clear()
  }

  // —— 时间线会话 ——

  /** 新会话开始：清掉上一轮的去重 / 节点信息 */
  beginSession(): void {
    this.scheduled.clear()
    this.srcInfo.clear()
  }

  /** 停止时间线播放：掐断全部 source 并清会话标记（保留 ctx / 总线 / tap） */
  stopSession(): void {
    this.stopAllSources()
    this.srcInfo.clear()
    this.scheduled.clear()
  }

  /**
   * lookahead 补排：把 [startAt, uptoTl] 窗口内尚未调度的可闻片段排入 Web Audio。
   * 缓冲按片段区间懒解码（getDecoder），解码耗时导致排不进当前时刻时整体后移
   * 并从缓冲对应位置截起。增益包络：恒定音量 + 头淡入 + 尾淡出。
   */
  schedule(opts: ScheduleOptions): void {
    const ctx = this.ctx
    if (!ctx || !this.masterGain) return
    const { clips, uptoTl, startAt, startClock, drift, token, isCurrent, getDecoder } = opts
    for (const c of clips) {
      if (c.end <= startAt) continue
      if (c.start > uptoTl) continue
      const key = `${c.id}:${token}`
      if (this.scheduled.has(key)) continue
      this.scheduled.add(key)
      // 该片段本次实际发声区间（可能从播放起点被截断）
      const p0 = Math.max(c.start, startAt)
      // 起播墙钟时刻含 drift：画面降速后音频跟随顺延
      const when0 = startClock + (p0 - startAt) + drift
      // 片段缓冲即素材 [sourceStart, sourceStart+duration)，故偏移量相对片段头
      const bufOffset0 = p0 - c.start
      const dur0 = c.end - p0
      getDecoder(c.url)
        .then(d => d.buildClipAudio(ctx, c.id, c.sourceStart, c.end - c.start))
        .then(buf => {
          // 可能已被降速重同步作废（key 被删，tick 会用新 drift 重新排）
          if (!isCurrent() || !this.scheduled.has(key)) return
          if (!buf || !this.ctx || !this.masterGain) return
          let when = when0
          let offset = bufOffset0
          let dur = dur0
          // 解码耗时导致排不进当前时刻：整体后移并从缓冲对应位置截起
          const slack = when - this.ctx.currentTime
          if (slack < 0.02) {
            const late = 0.02 - slack
            when += late
            offset += late
            dur -= late
          }
          dur = Math.min(dur, Math.max(0, buf.duration - offset))
          if (dur <= 0.01) return
          const node = this.ctx.createBufferSource()
          node.buffer = buf
          // 每片段一个增益：音量倍率（0-10x）+ 头淡入 / 尾淡出（相对片段头/尾，秒）
          const clipGain = this.ctx.createGain()
          const vol = Math.min(10, Math.max(0, c.volume))
          const clipDur = c.end - c.start
          const fi = Math.max(0, Math.min(c.fadeIn, clipDur))
          const fo = Math.max(0, Math.min(c.fadeOut, clipDur))
          const off = Math.max(0, offset)
          const foBegin = clipDur - fo
          if (fo > 0 && off >= foBegin) {
            // 起播点已落在淡出区（从片段尾附近续播）：直接按剩余比例淡出
            const v0 = vol * Math.max(0, (clipDur - off) / fo)
            clipGain.gain.setValueAtTime(v0, when)
            clipGain.gain.linearRampToValueAtTime(0.0001, when + dur)
          } else {
            const v0 = fi > 0 && off < fi ? vol * (off / fi) : vol
            clipGain.gain.setValueAtTime(v0, when)
            if (fi > 0 && off < fi) {
              clipGain.gain.linearRampToValueAtTime(vol, when + (fi - off))
            }
            if (fo > 0 && off < foBegin) {
              const wFo = when + (foBegin - off)
              if (wFo < when + dur - 0.005) {
                clipGain.gain.setValueAtTime(vol, wFo)
                clipGain.gain.linearRampToValueAtTime(0.0001, when + dur)
              }
            }
          }
          node.connect(clipGain)
          clipGain.connect(this.masterGain!)
          node.start(when, Math.max(0, offset), dur)
          node.stop(when + dur + 0.02)
          this.activeSources.add(node)
          this.srcInfo.set(node, { when, key })
          node.onended = () => {
            this.activeSources.delete(node)
            this.srcInfo.delete(node)
          }
        })
        .catch(() => { /* 该片段静音处理，不影响其他轨 */ })
    }
  }

  /**
   * 画面降速后的音频重同步：
   *  - 未起播（when 还在 20ms 后）的节点直接取消，由下一 tick 按新 drift 重排（听感无损）；
   *  - full=true 时连正在发声的节点也掐断重排（避免音乐持续跑到画面前面），
   *    仅在累计顺延较大时触发，防止持续慢解码下反复切碎声音。
   */
  resync(full: boolean): void {
    const ctx = this.ctx
    if (!ctx) return
    const nowC = ctx.currentTime
    for (const [node, info] of Array.from(this.srcInfo.entries())) {
      const pending = info.when > nowC + 0.02
      if (pending || full) {
        try { node.stop() } catch { /* noop */ }
        this.activeSources.delete(node)
        this.srcInfo.delete(node)
        this.scheduled.delete(info.key)
      }
    }
  }

  /** 销毁：掐断声源、拆除电平 tap、关闭音频上下文 */
  dispose(): void {
    this.stopAllSources()
    this.scheduled.clear()
    this.srcInfo.clear()
    this.busTap?.dispose()
    this.busTap = null
    this.masterGain = null
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      void ctx.close().catch(() => { /* noop */ })
    }
  }
}
