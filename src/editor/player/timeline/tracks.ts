/* ============================================================
 *  播放器时间线 · 轨道数据 mixin
 *  EditorPage 注入 TrackObject[] 后展平为 TlClip（区间 / 层级 /
 *  静音 / 不透明度 / 音量 / 淡入淡出 / 归一化 transform），
 *  重算总时长、钳制播放位置、回收图层、刷新静帧，并后台触发
 *  codec 资源池预取。传 null 退回单素材模式。
 * ============================================================ */
import { normalizeTransform, TEXT_SCALE_BOUNDS } from '../../transform'
import { CAPTION_TEXT_DEFAULTS } from '../../types'
import type { AnyTrackItem, TextContent, TrackObject } from '../../types'
import type { AbstractCtor } from '../core/playerBase'
import { PlayerBase } from '../core/playerBase'
import type { TlClip } from '../core/types'

export function TracksMixin<TBase extends AbstractCtor<PlayerBase>>(Base: TBase) {
  abstract class Tracks extends Base {
    /**
     * 注入时间线轨道数据（EditorPage 初始 + 每次轨道提交后调用）。
     * 展平为片段数组并重算总时长；播放停止、当前位置钳制、刷新静帧。
     */
    setTimelineTracks(tracks: TrackObject[] | null) {
      this.tlStop()
      if (!tracks) {
        this.tlClips = null
        this.tlClipById.clear()
        this.tlPreloading = null
        this.pruneLayers(new Set())
        this.selectedClipId = null
        this.tlDuration = 0
        this.levelMeter?.setVisible(!!this.externalTap)
        return
      }
      const clips: TlClip[] = []
      const VISUAL_OR_AUDIO = ['video', 'image', 'audio', 'sticker', 'text', 'caption'] as const
      for (const tr of tracks) {
        if (!(VISUAL_OR_AUDIO as readonly string[]).includes(tr.type)) continue
        for (const raw of tr.items) {
          const it = raw as AnyTrackItem
          if (!(VISUAL_OR_AUDIO as readonly string[]).includes(it.type)) continue
          // 字幕（caption）复用文本渲染管线：无媒体 url，source 即文本样式载体
          const isTextLike = it.type === 'text' || it.type === 'caption'
          const url = isTextLike ? '' : (it.source as { url?: string } | undefined)?.url || ''
          if (!isTextLike && !url) continue
          const format = (it.source as { format?: string } | undefined)?.format
          const natW = (it.source as { width?: number } | undefined)?.width || 0
          const natH = (it.source as { height?: number } | undefined)?.height || 0
          const start = Math.max(0, it.start)
          const duration = Math.max(0, it.duration)
          clips.push({
            id: it.id,
            url,
            kind: it.type as TlClip['kind'],
            format,
            natW: natW > 0 ? natW : undefined,
            natH: natH > 0 ? natH : undefined,
            start,
            end: start + duration,
            sourceStart: Math.max(0, it.sourceStart ?? 0),
            // 数字层＝创建序：新添加的轨道 layer 最大，画面叠放 / 点选优先级天然在最顶
            layer: tr.layer,
            visible: it.visible !== false && !tr.hidden,
            muted: !!tr.muted,
            itemMuted: !!it.muted,
            opacity: Math.min(1, Math.max(0, it.opacity ?? 1)),
            volume: Math.min(10, Math.max(0, it.volume ?? 1)),
            fadeIn: Math.max(0, it.fadeIn ?? 0),
            fadeOut: Math.max(0, it.fadeOut ?? 0),
            transform: normalizeTransform(it.transform, isTextLike ? TEXT_SCALE_BOUNDS : undefined),
            text: isTextLike
              ? it.type === 'caption'
                ? {
                    ...CAPTION_TEXT_DEFAULTS,
                    ...(it.source as Partial<TextContent>),
                    content:
                      (it.source as { content?: string }).content ||
                      (it.source as { name?: string }).name ||
                      ''
                  } as TextContent
                : (it.source as TextContent)
              : undefined
          })
        }
      }
      clips.sort((a, b) => a.start - b.start || a.layer - b.layer)
      this.tlClips = clips
      this.tlClipById = new Map(clips.map(c => [c.id, c]))
      // 时间线含音频轨片段或视频原声片段 → 底栏格子电平表常驻（音乐试听中保持显示）
      this.levelMeter?.setVisible(this.externalTap ? true : clips.some(c => c.kind === 'audio' || c.kind === 'video'))
      // 回收已不在轨道中的编辑态图层（保留的层复用 surface，不重新取图）
      this.pruneLayers(new Set(clips.map(c => c.id)))
      // 外部选中项若已消失则清掉（EditorPage 是调用方，正常情况下它会先同步）
      if (this.selectedClipId && !this.tlClipById.has(this.selectedClipId)) {
        this.selectedClipId = null
      }
      this.tlDuration = clips.reduce((m, c) => Math.max(m, c.end), 0)
      // 切到时间线语义的总时长（底栏显示），并把当前位置钳进新范围并吸附到帧
      this.duration = this.tlDuration
      this.currentTime = this.snapTc(Math.min(this.currentTime, this.tlDuration))
      this.playing = false
      this.updatePlayUI()
      this.updateTimeUI()
      void this.renderTimelineStill(this.currentTime)
      // 后台异步预载全部资源（视频解码器 / 音频缓冲 / 图片 / GIF 逐帧），
      // 点播放时若未完成则继续等待并显示「加载资源中」。单个资源失败不阻断。
      const visualClips = clips.filter(
        c => c.kind === 'video' || c.kind === 'image' || c.kind === 'sticker' || c.kind === 'text' || c.kind === 'caption'
      )
      const audibleClips = clips.filter(
        c => !c.muted && !c.itemMuted && (c.kind === 'audio' || c.kind === 'video')
      )
      this.tlPreloading = this.resources
        .prepare(visualClips, audibleClips, this.mixer.ctx)
        .catch(() => undefined)
      // 内置素材入轨时没有原生尺寸元数据；预载（解码器/图片）完成后才能解析
      // 「适应（原始）」的真实主轨尺寸，就绪后重排并重渲染静帧，同时通知草稿参数。
      this.tlPreloading.then(() => {
        if (this.ratioOption.key !== 'fit' || this.tlClips !== clips) return
        const size = this.originSize()
        this.relayoutStage()
        void this.renderTimelineStill(this.currentTime)
        this.emit('ratio:change', {
          key: 'fit',
          label: this.ratioOption.label,
          ratio: size.w / size.h,
          size
        })
      })
    }

    /** 释放全部合成解码器 / 图片缓存（退出合成模式或 destroy 时） */
    protected disposeTimelineSources() {
      // 导出顺序取帧游标先归还（可能仍持有解码器迭代器 / 在途 VideoFrame）
      this.resources.endStillSequence()
      this.resources.dispose()
      this.tlPreloading = null
      this.tlClipById.clear()
      this.pruneLayers(new Set())
      this.layerBoxes = []
    }
  }

  return Tracks
}
