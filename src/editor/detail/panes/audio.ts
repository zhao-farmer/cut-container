/* ============================================================
 *  编辑器框架 · 右侧详情 · ④ 音频视图（选中音频片段）
 *
 *  薄壳：仅保留独立音频片段页的外层包裹，
 *  音量控制三行（音量 dB / 淡入 / 淡出）已抽到
 *  sections/audioVolume.ts，与视频内嵌音轨（画面页）共用同一实现。
 * ============================================================ */
import type { DetailSelection, DetailSelectionRef, DetailViewCtx } from '../index'
import {
  renderAudioVolume,
  bindAudioVolume,
  syncAudioVolume
} from '../sections/audioVolume'

/** 淡入 / 淡出允许范围（秒） */
export { FADE_MAX } from '../sections/audioVolume'
/** 音量 dB 范围（内部 item.volume 存 linear 增益 0..10，对应 -60dB ~ 20dB） */
export { VOL_DB_MIN, VOL_DB_MAX } from '../sections/audioVolume'
export { volToDbText, volToDb, dbToVol, dbTextToDb } from '../sections/audioVolume'
/** 上下微调按钮组（兼容旧引用） */
export { spinCtl } from '../sections/shared'

/** 音频片段：仅保留「音量控制」组，无素材名称 / 无时长裁剪 */
export function renderAudio(sel: DetailSelection, _ctx: DetailViewCtx): string {
  return `
    <div class="ed-audio-info">
      <div class="ed-audio-groups">
        <div class="ed-text-pane" style="padding-top:0">
          ${renderAudioVolume(sel.audio!, { prefix: '', id: sel.id, flush: true })}
        </div>
      </div>
    </div>`
}

/** 绑定「音频」面板音量控制组 */
export function bindAudio(host: HTMLElement, ref: DetailSelectionRef, ctx: DetailViewCtx): void {
  const root = host.querySelector<HTMLElement>('.ed-audio-info')
  if (!root) return
  bindAudioVolume(root, ref, ctx, { prefix: '', id: ref.current?.id ?? '' })
}

/** 同片段重复同步时回灌音量控制组控件值（不抢焦点） */
export function syncAudioValues(
  host: HTMLElement,
  sel: DetailSelection,
  active: Element | null,
  _ctx: DetailViewCtx
): void {
  const root = host.querySelector<HTMLElement>('.ed-audio-info')
  if (!root) return
  syncAudioVolume(root, sel, active, { prefix: '' })
}
