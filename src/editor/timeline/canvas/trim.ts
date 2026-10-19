/* ============================================================
 *  时间轴画布 · 「左右拉取」模块（素材块左 / 右缘拖裁）
 *  - updateTrim：trimL / trimR 预览（ClipView.temp）。拖裁不做磁吸跳吸，
 *    按主轨磁吸开关分两种口径：
 *
 *    ① 主轨磁吸开启且作用于主轨（cd.ripple，严格对齐 asconfig addMainTrackItem
 *       的 pullLeft / pullRight 预览 + pointerup 提交两段式）：
 *       · trimR＝尾部波纹：自身锚定起点改变时长（sourceStart 不动，
 *         视频 / 音频受源末帧限制），编辑点之后的主轨子项整体平移 delta，
 *         其他轨道不受影响；
 *       · trimL（asconfig pullLeft 两段式）：
 *         预览 pointermove——自身左缘跟随把手（右缘钉死）、编辑点之前的主轨
 *         子项整组跟随把手临时位移（右拖右移、左拖左移且可越过坐标轴）、编辑点
 *         后子项不动，全部仅视觉不写数据；
 *         松手 dragLeftEnd——自身左缘回到原起点（start 不变）、duration 增减、
 *         sourceStart 借帧，编辑点之后的主轨子项整体平移 delta，前片复位且
 *         数据不变，其他轨道不受影响。
 *
 *    ② 关闭磁吸或非主轨（与普通轨一致）：
 *       · 左缘左拖下限＝紧邻前片结束值（首片为坐标轴 0）
 *       · 右缘右拖上限＝紧邻后片开始值（无后片不限）
 *       视频 / 音频在邻居边界之内还要再受自身源范围限制；
 *       图片 / GIF 源时长无限，sourceStart 钉住不动。
 *
 *  - commitTrim：松手把 temp 按帧整数回写（ripple 平移在同一撤销点）
 * ============================================================ */
import { clamp, sourceDurationOf } from '../core/helpers'
import { formatHint } from '../../utils/time'
import type { TimelineCtx, ClipDrag } from './context'
import type { OpsApi } from './ops'

export interface TrimDeps {
  /** 拖裁 hint（边缘平移帧没有真实事件，用最近 client 坐标定位） */
  dragHint: (text: string) => void
}

export interface TrimApi {
  updateTrim: (cd: ClipDrag, dt: number) => void
  /** 松手提交；返回是否实际发生了变更（外层据此决定是否重绘） */
  commitTrim: (cd: ClipDrag) => void
}

export function createTrim(ctx: TimelineCtx, ops: OpsApi, deps: TrimDeps): TrimApi {
  const { cfg, s } = ctx
  const { frameSnap } = ctx.geo

  /**
   * 同轨相邻子项边界（按手势起点数据计算，普通拖裁中其他子项不移动）：
   *  - prevEnd：结束值 ≤ 本块起点的最近邻（无则 0，对应坐标轴原点）
   *  - nextStart：开始值 ≥ 本块终点的最近邻（无则 Infinity）
   * 口径与 Alt+方向键逐帧移动的同轨间隙钳制一致。
   */
  function neighborBounds(cd: ClipDrag): { prevEnd: number; nextStart: number } {
    const eps = 0.5 / cfg.fps
    let prevEnd = 0
    let nextStart = Infinity
    for (const o of cd.track.items) {
      if (o.id === cd.view.item.id) continue
      const end = o.start + o.duration
      if (end <= cd.origStart + eps && end > prevEnd) prevEnd = end
      if (o.start >= cd.origStart + cd.origDur - eps && o.start < nextStart) nextStart = o.start
    }
    return { prevEnd, nextStart }
  }

  function updateTrim(cd: ClipDrag, dt: number) {
    if (cd.ripple) {
      updateRippleTrim(cd, dt)
      return
    }
    if (cd.mode === 'trimL') {
      // 左缘：邻居硬下限（前片结束值 / 0）与视频音频源入点下限取大。
      // 图片 / GIF 静态素材源时长无限：左延只是更早开始停留 / 循环，
      // sourceStart 不跟随；视频 / 音频随左缘减小 sourceStart 露出更早源帧。
      const srcDur = sourceDurationOf(cd.view.item)
      const freeLeft = !Number.isFinite(srcDur)
      const { prevEnd } = neighborBounds(cd)
      const sourceLow = freeLeft ? 0 : Math.max(0, cd.origStart - cd.origSs)
      const nsLow = Math.max(0, prevEnd, sourceLow)
      const nsHigh = cd.origStart + cd.origDur - cfg.minClipDuration
      const ns = clamp(frameSnap(cd.origStart + dt), nsLow, nsHigh)
      const newDur = cd.origStart + cd.origDur - ns
      const newSs = freeLeft
        ? cd.origSs
        : Math.max(0, cd.origSs + (ns - cd.origStart))
      cd.view.temp = { start: ns, duration: newDur, sourceStart: newSs }
      cd.moved = true
      deps.dragHint(`起点 ${formatHint(ns)} · 时长 ${formatHint(newDur)}`)
    } else {
      // 右缘：后片开始值与源右余量取小；图片 / GIF 无后片时保留 +600s 安全上限。
      // 右缘延长只露出源后续帧，sourceStart 不变。
      const srcDur = sourceDurationOf(cd.view.item)
      const { nextStart } = neighborBounds(cd)
      const sourceHigh = Number.isFinite(srcDur)
        ? cd.origStart + (srcDur - cd.origSs)
        : cd.origStart + cd.origDur + 600
      const neLow = cd.origStart + cfg.minClipDuration
      const neHigh = Math.min(nextStart, sourceHigh)
      const ne = clamp(frameSnap(cd.origStart + cd.origDur + dt), neLow, neHigh)
      const newDur = ne - cd.origStart
      cd.view.temp = { start: cd.origStart, duration: newDur, sourceStart: cd.origSs }
      cd.moved = true
      deps.dragHint(`终点 ${formatHint(ne)} · 时长 ${formatHint(newDur)}`)
    }
  }

  /**
   * 主轨磁吸开启（asconfig 两段式）：
   *  - trimR：锚定起点改时长，编辑点后主轨子项预览即跟随平移；
   *  - trimL 预览（对齐 pullLeftContainer pointermove）：被拖块自身左缘跟随把手
   *    （temp.start=ns、时长＝origEnd-ns 故右缘钉死，视频露出源更早帧），编辑点
   *    前主轨子项整组跟随把手临时位移（trimShift.prev，不夹 0、可越轴），编辑点
   *    后子项预览不动。松手提交（dragLeftEnd）：自身左缘回到原起点、增量落在
   *    右缘，编辑点后主轨子项波纹平移，前片数据不变。
   */
  function updateRippleTrim(cd: ClipDrag, dt: number) {
    const srcDur = sourceDurationOf(cd.view.item)
    const infinite = !Number.isFinite(srcDur)
    const origEnd = cd.origStart + cd.origDur
    if (cd.mode === 'trimR') {
      // 尾部延长 / 缩短：sourceStart 不动；视频音频夹源末帧，图片 / GIF +600s 安全上限
      const high = infinite ? cd.origStart + cd.origDur + 600 : cd.origStart + (srcDur - cd.origSs)
      const newEnd = clamp(frameSnap(origEnd + dt), cd.origStart + cfg.minClipDuration, high)
      const newDur = newEnd - cd.origStart
      cd.view.temp = { start: cd.origStart, duration: newDur, sourceStart: cd.origSs }
      s.trimShift = { point: origEnd, delta: newDur - cd.origDur, prev: null }
      cd.moved = true
      deps.dragHint(`终点 ${formatHint(newEnd)} · 时长 ${formatHint(newDur)}`)
    } else {
      // 预览左缘跟手：ns＝把手位置，temp 左缘放 ns、右缘钉 origEnd
      // （视频借源更早帧 Δ ≤ sourceStart；图片 / GIF 保留 600s 安全窗）。
      // 提交时左缘才回原起点（见 commitTrim），故 temp.start 不是落库值。
      const low = infinite ? cd.origStart - 600 : Math.max(0, cd.origStart - cd.origSs)
      const high = origEnd - cfg.minClipDuration
      const ns = clamp(frameSnap(cd.origStart + dt), low, high)
      const insert = cd.origStart - ns
      const newDur = origEnd - ns
      const newSs = infinite ? cd.origSs : Math.max(0, cd.origSs - insert)
      cd.view.temp = { start: ns, duration: newDur, sourceStart: newSs }
      // delta 供松手后片波纹；prev＝前片预览整组位移（=把手位移 ns-origStart，
      // 左拖为负可越轴、右拖为正），render 不夹 0，前片不挂 temp、不写数据
      s.trimShift = { point: origEnd, delta: newDur - cd.origDur, prev: ns - cd.origStart }
      cd.moved = true
      deps.dragHint(`起点 ${formatHint(ns)} · 时长 ${formatHint(newDur)}`)
    }
  }

  function commitTrim(cd: ClipDrag) {
    const temp = cd.view.temp
    const doRipple = cd.ripple
    const origEnd = cd.origStart + cd.origDur
    // trimL 预览时前片只是渲染层临时位移（无 temp），这里清 trimShift 即整体复位
    cd.view.clearTemp()
    s.trimShift = null
    if (cd.moved && temp) {
      ops.commitDraft(draft => {
        const tr = draft.find(t => t.id === cd.track.id)
        const it = tr?.items.find(i => i.id === cd.view.item.id)
        if (!it) return
        // 以帧整数回写，避免 toFixed(3) 截断导致 1/30s 网格漂移（起止须与坐标轴帧一一对应）
        // ripple trimL 的 temp.start 是跟手预览位置（ns），落库起点钉回手势原起点
        // （asconfig dragLeftEnd：self startFrame 不变，增量落在右缘）
        const commitStart = doRipple && cd.mode === 'trimL' ? cd.origStart : temp.start
        it.start = Math.round(commitStart * cfg.fps) / cfg.fps
        it.duration = Math.round(temp.duration * cfg.fps) / cfg.fps
        it.sourceStart = Math.max(0, Math.round(temp.sourceStart * cfg.fps) / cfg.fps)
        // 主轨磁吸（trimL / trimR 同口径）：编辑点之后的主轨（layer0）子项
        // 按位置平移 delta（夹 0）；前片与其他轨道一律不动。
        if (doRipple) {
          const delta = Math.round((temp.duration - cd.origDur) * cfg.fps) / cfg.fps
          if (Math.abs(delta) >= 0.5 / cfg.fps) {
            const eps = 0.5 / cfg.fps
            for (const t2 of draft) {
              if (t2.layer !== 0) continue
              for (const o of t2.items) {
                if (t2.id === cd.track.id && o.id === it.id) continue
                if (o.start >= origEnd - eps) {
                  o.start = Math.max(0, Math.round((o.start + delta) * cfg.fps) / cfg.fps)
                }
              }
            }
          }
        }
      }, '调整时长')
    }
  }

  return { updateTrim, commitTrim }
}
