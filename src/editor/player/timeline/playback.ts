/* ============================================================
 *  播放器时间线 · 合成播放 mixin
 *  - 起播准备（loading）：codec 资源池预取全部音频区间缓冲 /
 *    视频解码器 / 图片，就绪后才起时钟；
 *  - 时钟：有可闻片段用 Web Audio 主时钟（codec/PlayerMixer
 *    负责 lookahead 混音调度 / 淡入淡出 / drift 重同步），
 *    无声退化 performance；
 *  - 画面：每个可见视频片段独立顺序帧泵（一次一帧的串行背压），
 *    主轨泵迟到驱动整条时间线顺延（慢而不跳帧），叠轨迟到丢帧追帧；
 *    图片 / 贴纸 / 文字静态层只画一次（代次随画质切换失效），GIF 按拍重绘；
 *  - app.ticker 主循环统一驱动时钟 / 切层 / 帧上屏 / 音频补排。
 * ============================================================ */
import { TC_FPS } from '../core/constants'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'
import type { TlClip, TlLayerPump } from '../core/types'
import { isTextClipKind } from '../core/types'

export function TimelinePlaybackMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class TimelinePlayback extends Base {
    /** 取消起播前准备（再点播放 / 暂停 / seek / 轨道更新时） */
    protected tlCancelPrepare() {
      if (!this.tlPreparing) return
      this.tlPreparing = false
      this.runToken++
      this.setLoading(false)
      // 准备态按钮显示为暂停，取消后恢复三角
      this.updatePlayUI()
    }

    /** 取消点轨道后的 0.5s 续播定时器 */
    protected tlClearResume() {
      if (this.tlResumeTimer !== null) {
        clearTimeout(this.tlResumeTimer)
        this.tlResumeTimer = null
      }
    }

    /** 停止时间线播放：取消准备态 / 续播定时器 / ticker 主循环 / 视频帧泵，掐断全部混音 source */
    protected tlStop() {
      this.tlClearResume()
      if (this.tlPreparing) {
        this.tlPreparing = false
        this.setLoading(false)
      }
      this.runToken++
      this.tlScrubToken++
      if (this.tlTickerFn && this.app) {
        this.app.ticker.remove(this.tlTickerFn)
        this.tlTickerFn = null
        // 恢复 ticker 不限帧：静帧重绘 / 舞台 resize 等非播放流程不受画质档节拍限制
        this.app.ticker.maxFPS = 0
      }
      if (this.tlRafId !== null) {
        cancelAnimationFrame(this.tlRafId)
        clearTimeout(this.tlRafId)
        this.tlRafId = null
      }
      // 拆除全部多层帧泵（关闭在途 VideoFrame / 终止帧迭代器，避免解码器争用与帧泄漏）
      this.killAllLayerPumps()
      // 暂停态 GIF 循环泵一并停止（随后的定格静帧会按最新可见集重启）
      this.stopIdleGif()
      this.mixer.stopSession()
      // 播放停止：格子电平表脱离分析器并余韵衰减到全灭（外部试听音源在放则继续跟它）
      if (this.externalTap) this.levelMeter?.start(this.externalTap)
      else this.levelMeter?.idle()
      this.emitActiveTap()
    }

    /** 拆除播放态全部视频帧泵：标记失效、归还待播帧、终止迭代器 */
    protected killAllLayerPumps() {
      for (const p of Array.from(this.tlLayerPumps.values())) {
        p.alive = false
        if (p.pending) {
          try { p.pending.frame.close() } catch { /* noop */ }
          p.pending = null
        }
        const it = p.iter
        p.iter = null
        try { it?.return?.(undefined) } catch { /* noop */ }
      }
      this.tlLayerPumps.clear()
    }

    protected handleTimelineEnded() {
      if (!this.playing) return
      this.playing = false
      this.currentTime = this.tlDuration
      this.tlStop()
      this.updatePlayUI()
      this.updateTimeUI()
      this.emit('media:ended', { currentTime: this.currentTime, duration: this.tlDuration })
      // 定格在最后一帧附近（而不是越界黑场）。
      // 延后一拍：tlStop 刚对播放 source 执行 stop（解码器 / fetch 中止），
      // 立刻取静帧会被一并 abort，导致跨区间入点预览与操作框缺失。
      window.setTimeout(() => {
        if (this.playing || this.tlPreparing) return
        void this.renderTimelineStill(Math.max(0, this.tlDuration - 1 / TC_FPS))
      }, 120)
    }

    /**
     * 时间线合成播放：
     *  - 准备阶段（loading）：预解码全部音频片段、打开全部视频解码器、预载全部图片，
     *    资源就绪后才正式起播——避免冷加载立刻播放时音频还没解出来（无声 / 半路出声）
     *  - 时钟：存在可闻片段时用 Web Audio 主时钟，否则退化为 performance
     *  - 画面：当前时刻全部可见片段多层合成；片段进入可见区间即起新帧流（硬切）
     *  - 音频：缓冲已全部就绪，每个可闻片段（音频 + 视频原声）一个 AudioBufferSourceNode
     *    汇入混音总线天然混音，lookahead 窗口内统一调度（PlayerMixer）
     */
    protected async playTimeline() {
      const clips = this.tlClips
      if (!clips) return
      if (this.playing || this.tlPreparing) return
      // 起播前提交并关闭画面内文字原位编辑（恢复文字表面、避免编辑框悬挂）
      this.overlay?.endTextEdit()
      // GIF 暂停态独立循环泵让位给播放主循环（播放态由 tick 按时间线时钟驱动）
      this.stopIdleGif()
      // 直接起播（播放命令）时作废任何点轨道后的 0.5s 续播等待
      this.tlClearResume()
      this.clearError()

      const audibleClips = clips.filter(
        c => !c.muted && !c.itemMuted && (c.kind === 'audio' || c.kind === 'video')
      )
      const visualClips = clips.filter(
        c => c.kind === 'video' || c.kind === 'image' || c.kind === 'sticker' || c.kind === 'text' || c.kind === 'caption'
      )
      const useAudio = audibleClips.length > 0

      // Web Audio 需要用户手势后 resume：在手势调用栈内同步创建上下文 / 混音总线 / 发起 resume
      if (useAudio) {
        const { ctx, tap } = this.mixer.ensureBusSync()
        // 外部试听音源优先（音乐试听时格子表与竖井表同源），否则跟时间线混音
        const activeTap = this.externalTap ?? tap
        this.levelMeter?.start(activeTap)
        this.tapListener?.(activeTap)
        if (ctx.state === 'suspended') void ctx.resume()
      }

      let startAt = this.currentTime
      if (this.tlDuration > 0 && startAt >= this.tlDuration - 0.03) {
        startAt = 0
        this.currentTime = 0
        this.updateTimeUI()
      }

      // ---- 准备阶段：全部资源就绪前显示 loading，不起时钟不出声 ----
      const token = ++this.runToken
      this.tlPreparing = true
      this.setLoading(true, '资源加载中，即将播放…')
      // 按钮此刻就切成暂停态（再点＝取消准备）
      this.updatePlayUI()
      try {
        await this.resources.prepare(visualClips, audibleClips, this.mixer.ctx)
      } catch {
        /* 单个资源失败已在内部吞掉；这里仅兜底 */
      }
      // 等待期间被取消（再点一次 / seek / setTracks / destroy）
      if (!this.tlPreparing || token !== this.runToken || !this.tlClips) {
        this.setLoading(false)
        return
      }
      this.tlPreparing = false
      this.setLoading(false)

      // 准备跨越了 await：再确认音频上下文处于运行态（手势授权通常已生效）
      if (useAudio && this.mixer.ctx && this.mixer.ctx.state === 'suspended') {
        try {
          await this.mixer.ctx.resume()
        } catch { /* noop */ }
        if (token !== this.runToken) return
      }

      this.duration = this.tlDuration
      this.playing = true
      this.updatePlayUI()
      this.updateTimeUI()
      this.emit('media:play', { currentTime: this.snapTc(startAt), duration: this.tlDuration })

      const ctx = this.mixer.ctx
      // 统一时钟基准（秒）：音频模式 ctx 时间，无声模式 performance 时间
      const startClock = useAudio ? ctx!.currentTime + 0.12 : performance.now() / 1000
      const nowClock = () => (useAudio ? ctx!.currentTime : performance.now() / 1000)
      // drift＝解码跟不上时累计的顺延量（秒，只增不减）：
      // 帧迟到时整条时间线（画面间隔 / 时间码 / 音频调度）一起顺延，宁可慢也不丢帧。
      // 时间线当前时刻由 onTick 每节拍计算：startAt + (nowClock()-startClock) - drift
      let drift = 0

      // 新会话：清掉上一轮去重 / 节点信息（seek 后续播 / 异常重入）
      this.mixer.beginSession()
      // 清理上一轮残留的多层帧泵
      this.killAllLayerPumps()

      // ---- 音频：lookahead 调度（窗口约 0.9s，每个 tick 补排；实现在 codec/PlayerMixer） ----
      const AHEAD = 0.9
      const scheduleAudio = (uptoTl: number) => {
        if (!useAudio) return
        this.mixer.schedule({
          clips: audibleClips,
          uptoTl,
          startAt,
          startClock,
          drift,
          token,
          isCurrent: () => token === this.runToken,
          getDecoder: url => this.resources.getDecoder(url)
        })
      }

      /**
       * 画面降速后的音频重同步（未起播节点取消重排听感无损；累计顺延较大时
       * 连在响节点也掐断重排）——具体节点操作在 PlayerMixer.resync。
       */
      let driftAtLastFullSync = 0
      const resyncAudio = (full: boolean) => {
        if (!useAudio) return
        this.mixer.resync(full)
      }

      // ---- 画面：片段切换（硬切）+ app.ticker 逐帧呈现（绝不跳帧） ----
      // 帧到达时就已经迟到超过 4ms（解码到点还没出帧）才认定解码跟不上
      const FRAME_LATE_TOL = 0.004
      // 已提前就位的帧在 ticker 上晚呈现超过 0.1s（标签页被抢占 / GPU 长卡）才顺延，
      // 普通 rAF 节拍抖动（≤16ms）直接吸收，避免无谓降速
      const FRAME_STALL_TOL = 0.1
      const FULL_SYNC_STEP = 0.25 // 累计顺延每增加 0.25s 才掐一次在响音频
      // 顺延时间线并按需重同步音频（full 由累计 drift 决定，避免切碎在响声音）
      const slip = (late: number) => {
        drift += late
        const full = drift - driftAtLastFullSync >= FULL_SYNC_STEP
        resyncAudio(full)
        if (full) driftAtLastFullSync = drift
      }

      // ---- 画面：多层合成（与暂停态静帧同口径：全部可见层同屏，层级 / 画中画 / transform 一致） ----
      // 每个当前可见视频片段一个独立顺序帧泵（mediabunny samples() 每次建独立解码管线，
      // 同 URL 多片段并发迭代亦安全）；图片 / 贴纸 / 文字为静态层，表面只画一次。
      /** 主轨泵 clipId＝当前可见视频中层级最低者，其迟到帧驱动整条时间线顺延 */
      let primaryClipId: string | null = null
      /** 本次播放已绘制表面的静态层（退出后再进入只需切可见性，不必重画） */
      const staticPainted = new Set<string>()
      /** 静态层表面代次：播放中切画质销毁图层后与 this.layersEpoch 不一致，需重画全部静态层 */
      let paintedEpoch = this.layersEpoch
      /** 叠轨泵迟到超过该阈值（秒）的帧直接丢弃追帧，避免叠加层持续滞后于主时间线 */
      const OVERLAY_SKIP_TOL = 0.25

      const killPump = (p: TlLayerPump) => {
        if (!this.tlLayerPumps.has(p.clipId)) return
        p.alive = false
        if (p.pending) {
          try { p.pending.frame.close() } catch { /* noop */ }
          p.pending = null
        }
        const it = p.iter
        p.iter = null
        try { it?.return?.(undefined) } catch { /* noop */ }
        this.tlLayerPumps.delete(p.clipId)
      }

      /** 图片 / 贴纸 / 文字层表面绘制一次；可见性由主循环按 t 开关 */
      const paintStaticLayer = async (clip: TlClip) => {
        try {
          if (isTextClipKind(clip)) {
            const e = await this.paintTextSurface(clip)
            if (e) e.source.update()
            return
          }
          if (this.isGifClip(clip)) {
            // 动图：按当前播放时刻取帧（循环），帧未变则跳过重绘
            const local = clip.sourceStart + Math.max(0, this.currentTime - clip.start)
            await this.drawGifFrame(clip, local)
            return
          }
          const img = await this.resources.getImage(clip.url)
          if (token !== this.runToken || !this.playing) return
          const [w, h] = this.applyQualityCap(img.naturalWidth || 640, img.naturalHeight || 360, 1920)
          const e = this.ensureLayerSurface(clip.id, w, h)
          if (!e) return
          e.ctx.clearRect(0, 0, w, h)
          e.ctx.drawImage(img, 0, 0, w, h)
          e.source.update()
        } catch {
          /* 单层失败不阻断其它层 */
        }
      }

      /** 起一个视频片段的顺序帧泵：从 tlAt 对应素材位置入帧，到点帧缓存于 pending */
      const startVideoPump = (clip: TlClip, tlAt: number) => {
        const p: TlLayerPump = {
          clipId: clip.id,
          alive: true,
          iter: null,
          pulling: false,
          pending: null,
          pump: () => { /* 解码器就绪后替换 */ }
        }
        this.tlLayerPumps.set(clip.id, p)
        const local0 = clip.sourceStart + Math.max(0, tlAt - clip.start)
        const localEnd = clip.sourceStart + (clip.end - clip.start)
        this.resources.getDecoder(clip.url)
          .then(dec => {
            if (!p.alive || token !== this.runToken || !this.playing || !dec.videoSink) return
            const iter = dec.videoSink.samples(Math.max(0, local0), localEnd)
            p.iter = iter
            // 帧泵：顺序拉取，一次只缓存一帧，等 ticker 到点呈现后才拉下帧
            p.pump = async () => {
              if (p.pulling) return
              p.pulling = true
              try {
                while (true) {
                  if (!p.alive || token !== this.runToken || !this.playing) return
                  let res: IteratorResult<any>
                  try {
                    res = await iter.next()
                  } catch {
                    /* 片段被取消 / 解码中断：该层静默停帧，不影响其他层 */
                    return
                  }
                  if (!p.alive || token !== this.runToken || !this.playing || res.done) {
                    try { res.value?.close?.() } catch { /* noop */ }
                    return
                  }
                  const frame = res.value
                  // 关键帧预滚可能吐出早于入点的帧，丢弃不画
                  if (frame.timestamp + 1e-3 < local0) {
                    frame.close()
                    continue
                  }
                  const frameTl = clip.start + (frame.timestamp - clip.sourceStart)
                  const wait0 = startClock + (frameTl - startAt) + drift - nowClock()
                  // 叠轨帧严重迟到：丢弃追帧（不顺延时钟，避免画中画长期滞后）
                  if (primaryClipId !== clip.id && wait0 < -OVERLAY_SKIP_TOL) {
                    frame.close()
                    continue
                  }
                  p.pending = {
                    frame,
                    frameTl,
                    w: dec.displayWidth || frame.displayWidth || 640,
                    h: dec.displayHeight || frame.displayHeight || 360,
                    // 到达时还没到点＝提前就位（held）；到达即迟到 >4ms＝解码慢，主轨呈现前顺延
                    held: wait0 > -FRAME_LATE_TOL,
                    slipDue:
                      primaryClipId === clip.id && wait0 < -FRAME_LATE_TOL ? -wait0 : 0
                  }
                  return
                }
              } finally {
                p.pulling = false
              }
            }
          void p.pump()
          })
          .catch(() => { /* 该层解码失败：静默缺层，不影响其他层 */ })
        return p
      }

      /** 到点帧画入对应图层 surface（失败丢弃该帧并继续拉取） */
      const presentPumpFrame = (p: TlLayerPump, clip: TlClip) => {
        const f = p.pending
        if (!f) return
        p.pending = null
        try {
          // 视频中间缓冲按当前画质限边（原画质＝原生尺寸）
          const [w, h] = this.applyQualityCap(f.w, f.h)
          const e = this.ensureLayerSurface(clip.id, w, h)
          if (e) {
            f.frame.draw(e.ctx, 0, 0, w, h)
            e.source.update()
          }
        } catch {
          /* 单帧绘制失败丢弃 */
        }
        try { f.frame.close() } catch { /* noop */ }
        void p.pump()
      }

      // ---- 主循环：app.ticker 驱动整个画布的持续渲染（时钟 / 切片段 / 音频补排 / 帧上屏） ----
      const onTick = () => {
        if (token !== this.runToken || !this.playing) return
        const now = nowClock()
        // 音频节点按 ctxTime+0.12 预排程：起播后前 0.12s 内 now<startClock，
        // t 会比 startAt 小——钳回起播点，避免续播瞬间时间码 / 播放头从
        // startAt 往回跳一小段（如 10:00→9:27→10:0x）再前进
        const t = Math.max(startAt, startAt + (now - startClock) - drift)
        if (this.tlDuration > 0 && t >= this.tlDuration - 1 / TC_FPS / 2) {
          this.handleTimelineEnded()
          return
        }
        this.currentTime = Math.max(0, t)
        // —— 多层合成：t 时刻全部可见视觉片段（layer 升序），与暂停态静帧同一套图层池 ——
        const vis = this.pickVisualClips(this.currentTime)
        const visIds = new Set(vis.map(c => c.id))

        // 退出可见区间的视频泵立即拆除（归还在途帧 / 终止迭代器）
        for (const [id, p] of Array.from(this.tlLayerPumps)) {
          if (!visIds.has(id)) killPump(p)
        }
        // 主轨泵＝可见视频中层级最低者（vis 已按 layer 升序）；
        // 新进入可见区间的视频片段从当前位置起帧泵
        primaryClipId = null
        for (const clip of vis) {
          if (clip.kind !== 'video') continue
          if (primaryClipId === null) {
            primaryClipId = clip.id
            if (!this.tlLayerPumps.has(clip.id)) startVideoPump(clip, this.currentTime)
          } else if (!this.tlLayerPumps.has(clip.id)) {
            startVideoPump(clip, this.currentTime)
          }
        }
        // 静态层（图片 / 贴纸 / 文字）：表面只画一次，之后只切可见性。
        // GIF 动图除外：每 tick 按当前时刻重绘（内部按帧序号去重，不变则跳过）。
        // 播放中切画质会销毁全部图层表面：代次变化时清空已画标记，下一拍重建。
        if (paintedEpoch !== this.layersEpoch) {
          staticPainted.clear()
          paintedEpoch = this.layersEpoch
        }
        for (const clip of vis) {
          if (clip.kind === 'video') continue
          if (this.isGifClip(clip)) {
            void paintStaticLayer(clip)
            continue
          }
          if (staticPainted.has(clip.id)) continue
          staticPainted.add(clip.id)
          void paintStaticLayer(clip)
        }

        // 到点帧上屏。每帧必呈现一次：主轨解码慢就顺延时间线（慢而不跳帧），
        // 叠轨帧迟到不顺延（丢弃追帧）；ticker 每节拍自带一次 pixi 渲染。
        for (const clip of vis) {
          const p = this.tlLayerPumps.get(clip.id)
          const f = p?.pending
          if (!p || !f) continue
          const wait = startClock + (f.frameTl - startAt) + drift - now
          if (wait > 0) continue
          if (primaryClipId === clip.id) {
            let slipAmt = 0
            if (f.slipDue > 0) {
              // 解码迟到（到达时已超 4ms）：按到达时的迟到量顺延
              slipAmt = f.slipDue
            } else if (f.held && wait < -FRAME_STALL_TOL) {
              // 帧已就位但 ticker 晚了 0.1s 以上（页面被抢占）：顺延
              slipAmt = -wait
            }
            if (slipAmt > 0) slip(slipAmt)
          }
          presentPumpFrame(p, clip)
        }

        // 可见集 / 层级 / 布局提交（surface 池与编辑态静帧共用）
        for (const [id, e] of this.layers) {
          const show = visIds.has(id)
          if (e.visible !== show) {
            e.visible = show
            e.sprite.visible = show
          }
        }
        // 播放态单精灵始终让位（间隙无可见层时舞台纯黑背景即黑场）
        if (this.videoSprite) this.videoSprite.visible = false
        vis.forEach((clip, idx) => {
          const e = this.layers.get(clip.id)
          if (e) e.sprite.zIndex = 1 + idx
        })
        this.applyLayerLayouts()

        scheduleAudio(this.currentTime + AHEAD)
        this.updateTimeUI()
        // 对时间轴只下发帧整数时间（内部时钟保持连续），播放头与时间码严格同帧
        this.emit('media:timeupdate', {
          currentTime: this.snapTc(this.currentTime),
          duration: this.tlDuration
        })
      }
      if (this.app) {
        // 注册到 pixi 全局 ticker：每个显示节拍驱动一次时钟推进与帧上屏，
        // ticker 随后自带一次 pixi 渲染，不再需要额外的 setTimeout(0)。
        // 节拍频率按当前画质档封顶（流畅 30 / 低清 20），帧泵的串行背压随之
        // 放缓解码取帧节奏，低档位真正减少绘制 / 纹理上传 / 合成次数。
        this.applyTickerRate()
        this.tlTickerFn = onTick
        this.app.ticker.add(onTick)
      } else {
        // pixi 尚未就绪的兜底（正常流程里准备阶段结束时 app 必然已初始化）
        // 同样按画质档帧率封顶（间隔不足时用 setTimeout 补齐节拍）
        let lastBeat = 0
        const drive = () => {
          const cap = this.qualityMaxFps()
          const nowBeat = performance.now()
          if (cap > 0 && lastBeat > 0 && nowBeat - lastBeat < 1000 / cap - 1) {
            this.tlRafId = window.setTimeout(drive, 1000 / cap - (nowBeat - lastBeat))
            return
          }
          lastBeat = nowBeat
          onTick()
          if (token === this.runToken && this.playing) {
            this.tlRafId = requestAnimationFrame(drive)
          }
        }
        this.tlRafId = requestAnimationFrame(drive)
      }
    }
  }

  return TimelinePlayback
}
