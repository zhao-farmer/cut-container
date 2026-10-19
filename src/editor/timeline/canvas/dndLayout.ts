/* ============================================================
 *  时间轴画布 · 「添加」模块的落点解析（近纯函数）
 *  - laneAccepts：泳道类型是否接受拖放载荷
 *  - payloadOfItem：轨道既有子项 → 拖放载荷（块体移动复用拖入链路）
 *  - mainTrackAppendStart / mainTrackReorderStart：主轨磁吸的队尾 / 重排落点
 *  - resolve：按指针 / 泳道 / 磁吸状态算出 DndView（青块 + 灰槽 + 绿线）
 * ============================================================ */
import type { TrackObject, AnyTrackItem } from '../../types'
import type { AnyAddTrackPayload } from '../../materials/materialsPanel'
import type { Lane } from '../core/types'
import { clamp } from '../core/helpers'
import { DND_SNAP_THRESHOLD_PX } from './constants'
import type { TimelineCtx, DndRaw, DndView } from './context'

export interface DndLayoutApi {
  laneAccepts: (lane: Lane, p: AnyAddTrackPayload) => boolean
  payloadOfItem: (it: AnyTrackItem) => AnyAddTrackPayload
  mainTrackAppendStart: (track: TrackObject | null) => number
  mainTrackReorderStart: (track: TrackObject | null, reqStart: number, dur: number) => number
  resolve: (
    lanes: Lane[],
    scale: number,
    cw: number,
    ch: number,
    hasHBar: boolean,
    rawOverride?: DndRaw
  ) => DndView | null
}

export function createDndLayout(ctx: TimelineCtx): DndLayoutApi {
  const { cfg, originX, s, geo } = ctx
  const { frameSnap, timeToX } = geo

  /**
   * 泳道是否接受该载荷：视频/图片/GIF ↔ video/image 轨；音频 ↔ audio 轨；
   * 文字 ↔ 字幕共用同一种文本轨（互相接受，旧字幕轨也继续接收二者）；
   * 其余装饰类（贴纸 / 滤镜 / 特效 / 转场）只接受同类型轨；空主轨只接视频 / 图片。
   */
  const laneAccepts = (lane: Lane, p: AnyAddTrackPayload): boolean => {
    const t = lane.track
    if (!t) return (p.type === 'video' || p.type === 'image') && lane.isMain
    if (p.type === 'audio') return t.type === 'audio'
    if (p.type === 'video' || p.type === 'image') return t.type === 'video' || t.type === 'image'
    if (p.type === 'text' || p.type === 'caption') return t.type === 'text' || t.type === 'caption'
    return t.type === p.type
  }

  /** 轨道既有子项 → 拖放载荷（块体重新投放复用素材库拖入的解析 / 高亮 / 落位链路） */
  const payloadOfItem = (it: AnyTrackItem): AnyAddTrackPayload =>
    ({
      type: it.type,
      name: it.name,
      duration: it.duration,
      materialId: it.materialId,
      source: it.source
    }) as AnyAddTrackPayload

  /**
   * 主轨磁吸：新片段进入主轨时的追加起点＝最后一个可见片段的结尾（帧对齐），
   * 空主轨（track=null / 无子项）为 0。无论指针落在主轨哪个时刻都排在队伍末尾。
   */
  function mainTrackAppendStart(track: TrackObject | null): number {
    if (!track) return 0
    const last = track.items
      .filter(it => it.visible !== false)
      .sort((a, b) => a.start - b.start)
      .pop()
    return last ? Math.max(0, frameSnap(last.start + last.duration)) : 0
  }

  /**
   * 主轨磁吸 · 主轨内部重排的松手落点（仅用于拖动态灰槽预告）：
   * 调用时被拖块已从 track 剔除。按「浮块时间中点」在剩余片段中点序列中的
   * 位置决定插入先后，再把插入位之前各片时长从头累计——即松手整轨 pack
   * （首尾相接、按时间顺序排列）后被拖块将获得的起点。与 EditorPage
   * moveItemOp 主轨内重排的「中点排序 + 从头 pack」口径严格一致。
   */
  function mainTrackReorderStart(track: TrackObject | null, reqStart: number, dur: number): number {
    if (!track) return 0
    const items = track.items.slice().sort((a, b) => a.start - b.start)
    const reqMid = reqStart + dur / 2
    let cursor = 0
    let slot = 0
    let inserted = false
    for (const it of items) {
      const d = frameSnap(it.duration)
      if (!inserted && reqMid < it.start + d / 2) {
        slot = cursor
        inserted = true
      }
      cursor = frameSnap(cursor + d)
    }
    if (!inserted) slot = cursor
    return Math.max(0, frameSnap(slot))
  }

  function resolve(
    lanes: Lane[],
    scale: number,
    cw: number,
    ch: number,
    hasHBar: boolean,
    rawOverride?: DndRaw
  ): DndView | null {
    const raw = rawOverride ?? s.dndRaw
    if (!raw) return null
    const { payload, x, y } = raw
    // 素材库拖入：指针即块左缘中点；块体拖拽：保持按下时指针在块内的相对位置
    const grabOffX = raw.grabOffX ?? 0
    const grabRatioY = clamp(raw.grabRatioY ?? 0.5, 0, 1)
    const isAudio = payload.type === 'audio'
    const dur = Math.max(0.1, payload.duration)
    const playBottom = ch - (hasHBar ? cfg.scrollbarHeight : 0)
    // 素材库拖入时块自光标向右延伸（指针在块左缘）；块体拖拽时左缘回退抓取横向偏移，
    // 做到"点击在哪，拖动时指针还在哪"。起始时间帧吸附，不小于 0。
    const guideX = clamp(x, 0, cw - 1)
    // 指针时刻的原始帧起点（未经过自动磁吸改写）：主轨磁吸 ON 且浮块在主轨上时，
    // 拖动全程以它为准——浮块横向 1:1 跟手，排列只发生在松手提交时。
    const rawStart = Math.max(0, frameSnap((x - originX + s.offX - grabOffX) / scale))
    let start = rawStart

    // 自动磁吸：开启后，拖入资源的开头 / 结尾对齐任意轨道上某一子项的
    // 开头 / 结尾（另含 0 点、播放头与标尺标记帧），就近吸附并记录需要画绿线的边。
    const snapLines: number[] = []
    if (s.snap) {
      const candidates: number[] = [0, s.playhead, ...s.markers]
      for (const ln of lanes) {
        if (!ln.track) continue
        for (const it of ln.track.items) {
          if (it.visible === false) continue
          candidates.push(it.start, it.start + it.duration)
        }
      }
      const thr = DND_SNAP_THRESHOLD_PX / scale
      const nearest = (t: number): number | null => {
        let bestT: number | null = null
        let bestD = Infinity
        for (const c of candidates) {
          const d = Math.abs(c - t)
          if (d < bestD) {
            bestD = d
            bestT = c
          }
        }
        return bestD <= thr ? bestT : null
      }
      const headCand = nearest(start)
      const tailCand = nearest(start + dur)
      const headD = headCand === null ? Infinity : Math.abs(headCand - start)
      const tailD = tailCand === null ? Infinity : Math.abs(tailCand - (start + dur))
      if (headCand !== null && headD <= tailD) {
        start = Math.max(0, frameSnap(headCand))
      } else if (tailCand !== null) {
        start = Math.max(0, frameSnap(tailCand - dur))
      }
      // 吸附后重新核对两边：开头、结尾可能同时命中（等长相邻等情形），各自亮绿线
      const eps = 1 / cfg.fps
      const addLine = (t: number) => {
        if (snapLines.every(v => Math.abs(v - t) > eps)) snapLines.push(t)
      }
      for (const c of candidates) {
        if (Math.abs(c - start) < eps) addLine(start)
        if (Math.abs(c - (start + dur)) < eps) addLine(start + dur)
      }
    }

    const w = dur * scale
    let gx = timeToX(start, scale)
    const gw = Math.max(3, w)

    // 命中泳道（含泳道间隙一半的容差）
    let hit: Lane | null = null
    for (const lane of lanes) {
      if (y >= lane.y - cfg.lineDistance / 2 && y <= lane.y + lane.h + cfg.lineDistance / 2) {
        hit = lane
        break
      }
    }

    // 两个判定分离：
    //  ① 轨道提亮只看「类型是否兼容」——素材一进入时间轴，所有能接收该素材的轨道
    //     （视频 / 图片 ↔ 媒体轨；音频 ↔ 音频轨）立即亮起，与当前时刻有无子项无关；
    //  ② 能否直接落进命中行，还要看放置区间 [start, start+dur] 是否与该轨可见子项
    //     重叠（端点相接不算）。兼容但重叠 / 不兼容 / 空白区 → 松手新建一条同类型轨道，
    //     但其他兼容轨保持亮起（重叠不压暗整行）。
    const ovEps = 1 / cfg.fps
    const trackFree = (t: TrackObject): boolean =>
      !t.items.some(
        it =>
          it.visible !== false &&
          start < it.start + it.duration - ovEps &&
          start + dur > it.start + ovEps
      )

    const placeIds: string[] = []
    let mainPlaceable = false
    for (const lane of lanes) {
      if (!laneAccepts(lane, payload)) continue
      if (lane.track) placeIds.push(lane.track.id)
      else if (lane.isMain) mainPlaceable = true
    }

    // 命中行类型兼容且时间不重叠 → 目标行＝该行（灰槽是否锁定看纵向过半）；否则浮动新建轨
    const canLand = (lane: Lane): boolean =>
      laneAccepts(lane, payload) && (!lane.track || trackFree(lane.track))
    // 主轨磁吸 + 新片段（素材库拖入，或从其他轨移入；主轨内部重排不算）压到主轨行：
    // 无论指针时刻是否压在既有片段上，都视为可落主轨——落点统一追加到主轨末尾，
    // 不再因中途重叠而新建平行轨。
    const hitOnMain =
      !!hit && laneAccepts(hit, payload) && (!hit.track ? hit.isMain : hit.track.layer === 0)
    const enteringMain = s.mainSnap && hitOnMain && !raw.fromMain
    const target: Lane | null = enteringMain || (hit && canLand(hit)) ? hit : null
    const targetMain = !!target && !target.track && target.isMain
    // 目标行（灰槽）高度：压在具体可放行上取该行高度（主轨 70 / 素材轨 50 / 装饰轨 20）；
    // 新建轨预览按素材类型——视频 / 图片 / 音频 50，贴纸 / 文字 / 字幕等装饰类 20。
    // 注意这是「落点阴影」的高度，仅用于预告；拖动浮块自身高度恒为 floatH，不随之伸缩。
    const isMediaPayload = isAudio || payload.type === 'video' || payload.type === 'image'
    const createH = isMediaPayload ? cfg.trackHeight : cfg.decorTrackHeight
    const bandH = target ? target.h : createH
    const bandY = target ? target.y : clamp(y - bandH / 2, cfg.timelineHeight + 1, playBottom - bandH - 1)
    // 拖动浮块高度全程恒定＝松手稳态块体高度，不随鼠标上下切换的目标轨伸缩：
    //  · 块体拖拽：来源泳道的稳态块高（raw.srcH：主轨 70 / 素材媒体轨 50 / 装饰块 16）；
    //  · 素材库拖入：媒体 50；装饰类＝行高 20 - 上下内边距＝16（避免「拖起变高松手缩回」）。
    // 目标行与浮块的高度差只通过灰色底槽（bandY/bandH，整行高）预告。
    const steadyH = isMediaPayload ? createH : createH - cfg.clipPadOther
    const floatH = rawOverride ? (raw.srcH ?? steadyH) : steadyH
    const gh = floatH
    const onMain = !!target && (!target.track ? target.isMain : target.track.layer === 0)
    // 主轨磁吸 ON 且浮块在主轨上：拖动全程不做任何实时排列——
    //  · start 还原为指针时刻 rawStart（撤销自动磁吸 7px 边缘吸附），浮块横向 1:1 跟手；
    //  · 松手后的落点只由灰色底槽预告（slotGx）：
    //    - 新进入主轨（素材库 / 其他轨移入）：追加到队尾（mainTrackAppendStart）；
    //    - 主轨内部重排：按浮块时间中点在剩余序列中的位置，预告整轨 pack 后的起点
    //      （mainTrackReorderStart）；松手时数据层才真正按时间顺序首尾排列。
    //  · 自动磁吸绿线在此让位，不再显示。
    let slotGx: number | null = null
    if (s.mainSnap && target && onMain) {
      start = rawStart
      gx = timeToX(start, scale)
      slotGx = timeToX(
        raw.fromMain
          ? mainTrackReorderStart(target.track, start, dur)
          : mainTrackAppendStart(target.track),
        scale
      )
      snapLines.length = 0
    }
    // 真实块浮块高度＝floatH（来源高度，全程恒定）；与青 ghost 同口径，
    // 不再按目标轨取 70 / 50——进主轨不实时变大，高度差由灰槽预告。
    const clipH = floatH
    // 纵向锚点＝按下时指针在块内的相对位置（grabRatioY）；指针到达泳道顶线时块恰好
    // 露出一半，继续下移整块出全（越线部分由遮罩裁掉，无轨道背景）
    // 纵向重叠过半 → 槽位锁定（可放行显示灰色底槽；浮动新建态不锁）
    let locked = false
    if (target) {
      const overlap = Math.max(0, Math.min(y - grabRatioY * clipH + clipH, bandY + bandH) - Math.max(y - grabRatioY * clipH, bandY))
      locked = overlap >= Math.min(clipH, bandH) * 0.5
    }
    const createNew = !target
    const gyMin = cfg.timelineHeight - clipH / 2
    // 纵向 1:1 跟手：浮块始终保持按下抓取点（grabRatioY）相对指针的偏移，
    // 即使与目标行重叠过半（locked）也不吸附到槽位居中——上下移动全程不跳动。
    // locked 仅决定灰色底槽是否出现；落点行位置 / 高度只由底槽预告，
    // 浮块与底槽在纵向上可以分离，松手提交时才合并到目标行几何。
    const gy = clamp(y - grabRatioY * clipH, gyMin, playBottom - clipH - 1)

    return {
      valid: true,
      locked,
      trackId: target && target.track ? target.track.id : null,
      targetMain,
      createNew,
      placeIds,
      mainPlaceable,
      start,
      snapLines,
      gx,
      gy,
      gw,
      gh,
      slotGx,
      clipH,
      bandY,
      bandH,
      isAudio,
      guideX,
      name: payload.name
    }
  }

  return { laneAccepts, payloadOfItem, mainTrackAppendStart, mainTrackReorderStart, resolve }
}
