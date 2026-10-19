/* ============================================================
 *  播放器播放 · 单素材 mixin
 *  mediabunny 直连（UrlSource / BlobSource → Input → Video/Audio
 *  SampleSink）：加载探测、首帧静帧、播放 / 暂停 / seek、
 *  A/V 同步播放循环（有音轨以 Web Audio 时钟为主，无音轨用
 *  performance；画质档帧率封顶丢帧）、结尾处理与资源拆除。
 *  音频节点统一登记到 codec/PlayerMixer 的 activeSources。
 * ============================================================ */
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'

export function SinglePlaybackMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class SinglePlayback extends Base {
    // ====================== 加载 ======================
    protected async load(opts: { src?: string; file?: Blob }) {
      // 单素材预览：退出时间线合成模式并释放合成解码器
      if (this.tlClips) {
        this.tlClips = null
        this.tlDuration = 0
        this.disposeTimelineSources()
      }
      // 先释放旧 input 并取消任何在播循环（teardownInput 内部会使 runToken 前进一次）
      this.teardownInput()
      // 在 teardown 之后再捕获令牌，避免重复自增导致守卫误判
      const token = this.runToken
      this.playing = false
      this.currentTime = 0
      this.duration = 0
      this.hasVideo = false
      this.clearError()
      this.setLoading(true)
      this.updatePlayUI()
      this.updateTimeUI()

      try {
        const source = opts.file
          ? new BlobSource(opts.file)
          : new UrlSource(opts.src!)

        const input = new Input({ source, formats: ALL_FORMATS })
        this.input = input

        const canRead = await input.canRead()
        if (!canRead) throw new Error('无法识别的媒体格式')

        const [duration, videoTrack, audioTrack] = await Promise.all([
          input.computeDuration(),
          input.getPrimaryVideoTrack(),
          input.getPrimaryAudioTrack()
        ])
        if (token !== this.runToken) return

        this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0
        this.hasVideo = !!(videoTrack && (await videoTrack.canDecode()))
        this.hasAudio = !!(audioTrack && (await audioTrack.canDecode()))

        if (!this.hasVideo && !this.hasAudio) {
          throw new Error('当前浏览器无法解码该文件（需要支持 WebCodecs 的 Chrome/Edge）')
        }

        if (this.hasVideo) {
          this.videoSink = new VideoSampleSink(videoTrack!)
          this.displayWidth = (await videoTrack!.getDisplayWidth()) || 640
          this.displayHeight = (await videoTrack!.getDisplayHeight()) || 360
          // 渲染首帧（静帧）
          await this.renderStill(0)
        }
        if (this.hasAudio) {
          this.audioSink = new AudioSampleSink(audioTrack!)
        }

        this.updateTimeUI()
        this.setLoading(false)
        this.emit('media:ready', {
          duration: this.duration,
          width: this.displayWidth,
          height: this.displayHeight,
          hasAudio: this.hasAudio,
          hasVideo: this.hasVideo,
          decoder: 'mediabunny'
        })
        this.emit('media:metadata', {
          duration: this.duration,
          width: this.displayWidth,
          height: this.displayHeight,
          hasAudio: this.hasAudio
        })
      } catch (err: any) {
        if (token !== this.runToken) return
        this.setLoading(false)
        const msg = err?.message || String(err)
        this.showError(`加载/解码失败：${msg}`)
        this.emit('media:error', { message: msg })
      }
    }

    /** 渲染某个时刻的静帧（用于首帧 / seek 后暂停态） */
    protected async renderStill(time: number) {
      if (!this.videoSink || !this.hasVideo) return
      try {
        const frame = await this.videoSink.getSample(time)
        if (frame) {
          try {
            this.presentFrame((ctx, w, h) => frame.draw(ctx, 0, 0, w, h))
          } finally {
            try {
              frame.close()
            } catch {
              /* noop */
            }
          }
        }
      } catch {
        /* 忽略单帧解码错误 */
      }
    }

    // ====================== 播放控制 ======================
    async play() {
      // 时间线合成模式
      if (this.tlClips) {
        // 资源准备中再次点击（播放钮此时仍显示三角）＝取消本次开播
        if (this.tlPreparing) {
          this.tlCancelPrepare()
          return
        }
        await this.playTimeline()
        return
      }
      if (this.playing || !this.input) return
      if (!this.hasVideo && !this.hasAudio) return
      this.clearError()

      // Web Audio 需要用户手势后 resume
      if (this.hasAudio) {
        const ctx = this.mixer.ensureContextSync()
        if (ctx.state === 'suspended') await ctx.resume()
      }

      // 已播放到结尾：再次点击"播放"从头重播（否则以 duration 为起点会立刻再次 ended）
      let startAt = this.currentTime
      if (this.duration > 0 && this.currentTime >= this.duration - 0.05) {
        startAt = 0
        this.currentTime = 0
        this.updateTimeUI()
      }

      this.playing = true
      this.updatePlayUI()
      this.emit('media:play', { currentTime: this.snapTc(this.currentTime), duration: this.duration })
      this.runPlayback(startAt)
    }

    pause() {
      // 点轨道后的 0.5s 续播保护期内按了暂停：取消续播，定格在指针位置
      if (this.tlResumeTimer !== null) {
        this.tlClearResume()
        this.playing = false
        this.currentTime = this.snapTc(this.currentTime)
        this.updatePlayUI()
        void this.renderTimelineStill(this.currentTime)
        this.emit('media:pause', { currentTime: this.currentTime, duration: this.duration })
        return
      }
      // 资源准备中：直接取消准备（尚未开播，不产生 pause 事件）
      if (this.tlPreparing) {
        this.tlCancelPrepare()
        return
      }
      if (!this.playing) return
      this.playing = false
      // 暂停落在帧网格上：定格帧 / 时间码 / 时间轴播放头严格同帧
      this.currentTime = this.snapTc(this.currentTime)
      this.updatePlayUI()
      if (this.tlClips) {
        this.tlStop()
        // 暂停后定格当前帧（含图片 / 黑场）
        void this.renderTimelineStill(this.currentTime)
      } else {
        this.stopPlayback()
        // 暂停后定格当前帧
        this.renderStill(this.currentTime)
      }
      this.emit('media:pause', { currentTime: this.currentTime, duration: this.duration })
    }

    seek(time: number) {
      // 时间线模式：拖动刻度 → 跳到时间线位置
      if (this.tlClips) {
        // 三种「带播放意图」的来源：正在播 / 起播准备中 / 0.5s 续播保护期内的再次点击
        const fromPlaying = this.playing
        const fromPreparing = this.tlPreparing
        const hasPendingResume = this.tlResumeTimer !== null
        const wantPlay = fromPlaying || fromPreparing || hasPendingResume
        if (this.tlPreparing) this.tlCancelPrepare()
        // 时间基础单位为帧：下发位置吸附到帧网格，播放器时间码与时间轴播放头严格同帧
        const t = this.snapTc(Math.min(this.tlDuration || 0, time))
        this.currentTime = t
        // 作废任何在途的悬停预览帧，避免其晚于本次 seek 上屏
        this.tlScrubToken++
        this.updateTimeUI()
        this.emit('media:seek', { currentTime: t, duration: this.tlDuration })
        if (fromPlaying || hasPendingResume) {
          // 播放中（或保护期内再次）点轨道：指针立刻跳转到新位置定格，
          // 但 0.5s 后才从该位置起播——避免连点 / 误触时画面来回跳。
          // 期间保留播放意图：不发 pause、播放钮仍是暂停态、预览轴保持失效；
          // 再次点击会重新计时，暂停 / tlStop / 轨道更新会取消定时器。
          if (fromPlaying) this.tlStop()
          void this.renderTimelineStill(t)
          this.tlResumeTimer = setTimeout(() => {
            this.tlResumeTimer = null
            if (!this.tlClips) return
            // playTimeline 开头有 playing 守卫，定时器触发时先放行
            this.playing = false
            void this.playTimeline()
          }, 500)
        } else if (wantPlay) {
          // 起播准备中点击：旧准备已取消，立即在新位置重新准备起播
          this.playing = false
          void this.playTimeline()
        } else {
          // 纯暂停态拖动：只出静帧
          void this.renderTimelineStill(t)
        }
        return
      }
      const t = this.snapTc(Math.min(this.duration || 0, time))
      this.currentTime = t
      this.updateTimeUI()
      this.emit('media:seek', { currentTime: t, duration: this.duration })
      if (this.playing) {
        this.stopPlayback()
        this.runPlayback(t)
      } else {
        this.renderStill(t)
      }
    }

    // ====================== 核心：A/V 同步播放循环 ======================
    protected runPlayback(startTime: number) {
      const token = ++this.runToken
      const startMedia = startTime

      // ---- 时钟基准 ----
      // 有音轨：以 Web Audio 上下文时钟为主；无音轨：用 performance 时钟
      const ctx = this.mixer.ctx
      const useAudio = this.hasAudio && !!ctx
      const ctxStartTime = useAudio ? ctx!.currentTime + 0.08 : 0
      const perfStart = performance.now() / 1000

      // 媒体时间 → 时钟时间
      const mediaToClock = (mediaT: number) =>
        useAudio ? ctxStartTime + (mediaT - startMedia) : perfStart + (mediaT - startMedia)
      const getClock = () =>
        useAudio ? ctx!.currentTime : performance.now() / 1000

      // ---- 音频调度（主时钟）----
      if (useAudio && this.audioSink) {
        const audioIter = this.audioSink.samples(startTime)
        this.audioIter = audioIter
        let nextNodeStart = ctxStartTime
        const audioRunner = (async () => {
          try {
            for await (const sample of audioIter) {
              if (token !== this.runToken || !this.playing) {
                sample.close()
                break
              }
              const buffer = sample.toAudioBuffer()
              sample.close()
              const node = ctx!.createBufferSource()
              node.buffer = buffer
              node.connect(ctx!.destination)
              const when = Math.max(nextNodeStart, ctx!.currentTime + 0.02)
              node.start(when)
              this.mixer.track(node)
              node.onended = () => this.mixer.untrack(node)
              nextNodeStart = when + buffer.duration
            }
          } catch {
            /* 播放被取消 */
          } finally {
            if (this.audioIter === audioIter) this.audioIter = null
          }
        })()
        void audioRunner
      }

      // ---- 视频帧循环（跟随时钟）----
      const videoIter = this.hasVideo && this.videoSink
        ? this.videoSink.samples(startTime)
        : null
      if (videoIter) this.videoIter = videoIter
      // 画质档帧率封顶：上一次实际呈现帧的素材时间戳（秒），-1 表示尚未呈现过
      let lastPresentedTs = -1

      const tick = async () => {
        if (token !== this.runToken || !this.playing) return

        if (videoIter) {
          try {
            const next = await videoIter.next()
            if (token !== this.runToken || !this.playing) {
              // 帧已从解码器取出但播放被取消：必须关帧，否则 VideoSample 被
              // GC 时 mediabunny 报 "garbage collected without first being closed"
              try {
                if (!next.done) next.value.close()
              } catch {
                /* noop */
              }
              return
            }
            if (next.done) {
              this.handleEnded()
              return
            }
            const frame = next.value
            // 等到该帧该出现的时刻
            const target = mediaToClock(frame.timestamp)
            const waitMs = (target - getClock()) * 1000
            if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))
            if (token !== this.runToken || !this.playing) {
              frame.close()
              return
            }
            // 画质档帧率封顶：距上一呈现帧不足帧间隔的帧直接丢弃——
            // 不 draw 到中间缓冲、不上传 GPU 纹理，画面保持上一帧（观感降帧），
            // 但时间码 / 进度条照常推进。帧仍须从迭代器取出并关闭，避免帧泄漏。
            const capFps = this.qualityMaxFps()
            const minGap = capFps > 0 ? 1 / capFps : 0
            const dropped =
              minGap > 0 &&
              lastPresentedTs >= 0 &&
              frame.timestamp - lastPresentedTs < minGap - 0.002
            if (!dropped) {
              this.presentFrame((ctx2, w, h) => frame.draw(ctx2, 0, 0, w, h))
              lastPresentedTs = frame.timestamp
            }
            this.currentTime = frame.timestamp
            this.updateTimeUI()
            this.emit('media:timeupdate', {
              currentTime: this.snapTc(frame.timestamp),
              duration: this.duration
            })
            frame.close()
          } catch {
            this.handleEnded()
            return
          }
        } else {
          // 纯音频：用时钟推进进度
          this.currentTime = startMedia + (getClock() - (useAudio ? ctxStartTime : perfStart))
          this.updateTimeUI()
          this.emit('media:timeupdate', { currentTime: this.snapTc(this.currentTime), duration: this.duration })
          await new Promise(r => setTimeout(r, 200))
        }

        if (this.duration && this.currentTime >= this.duration - 0.05) {
          this.handleEnded()
          return
        }
        this.rafId = requestAnimationFrame(() => void tick())
      }

      void tick()
    }

    protected handleEnded() {
      if (!this.playing) return
      this.playing = false
      this.currentTime = this.duration || this.currentTime
      this.updatePlayUI()
      this.stopPlayback()
      this.updateTimeUI()
      this.emit('media:ended', { currentTime: this.currentTime, duration: this.duration })
    }

    /** 停止播放循环、取消迭代器、掐断已调度音频 */
    protected stopPlayback() {
      this.runToken++
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
      this.mixer.stopAllSources()
      // 显式终止挂起的解码迭代器，释放解码器，避免 seek 后新旧迭代器冲突
      const vIter = this.videoIter
      const aIter = this.audioIter
      this.videoIter = null
      this.audioIter = null
      try { vIter?.return?.(undefined) } catch { /* noop */ }
      try { aIter?.return?.(undefined) } catch { /* noop */ }
    }

    protected teardownInput() {
      this.stopPlayback()
      try { this.input?.dispose() } catch { /* noop */ }
      this.input = null
      this.videoSink = null
      this.audioSink = null
    }
  }

  return SinglePlayback
}
