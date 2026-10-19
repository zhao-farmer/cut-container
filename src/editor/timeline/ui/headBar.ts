/* ============================================================
 *  时间轴 · 左侧按钮栏（轨道头列）
 *  顶部标尺占位 + 行容器层（每条真实轨道一个 .ed-tl-head-row，与右侧
 *  泳道一一对应：行底色 + 类型图标 + 锁定 / 显示 / 原声按钮收在同一行 div）
 *  + 底部横向滚动条占位；空主轨在他轨有素材时显示占位行。
 *  syncHead 由渲染模块每次 draw 后调用，行 top / 高度随泳道同步。
 * ============================================================ */
import type { TrackObject, TrackObjectType } from '../../types'
import { numToCss, type TimelineConfig } from '../core/config'
import type { Lane } from '../core/types'
import { tlIcon, tabIcon } from '../../utils/icons'
import type { HeadEls, TimelineState } from '../canvas/context'

export type TrackAct = 'lock' | 'show' | 'sound'
type ColKey = 'type' | TrackAct

/** 空主轨占位行（无真实轨道对象）在 rowMap 中的合成 id */
const EMPTY_MAIN_ROW = '__empty-main__'

export interface HeadBarDeps {
  /** 点击行内按钮：锁定 / 显示 / 原声（由 ops 模块提交撤销栈操作） */
  toggleTrack: (trackId: string, act: TrackAct) => void
}

export interface HeadBarApi {
  els: HeadEls
  /** 每帧按泳道同步行容器 / 按钮 / 拖放高亮 */
  syncHead: (lanes: Lane[], hasHBar: boolean, allTracksEmpty: boolean) => void
  destroy: () => void
}

export function createHeadBar(
  host: HTMLElement,
  cfg: TimelineConfig,
  s: TimelineState,
  deps: HeadBarDeps
): HeadBarApi {
  /* ---------- 左侧轨道头列（参考 asconfig handle-track，按行成整体） ----------
   * 顶部标尺占位 + 行容器层（每条真实轨道一个 .ed-tl-head-row，与右侧泳道一一对应：
   * 行底色 + 类型图标 + 锁定 / 显示 / 原声按钮全部收在同一个行 div 内；他轨有素材而主轨空时，
   * 主轨也有一个同构占位行，整排按钮以默认态展示但不可点）+ 底部滚动条占位；
   * 顶 / 底两个占位 div 不展示任何样式（无线条、无底色，透出与外部一致的背景）；
   * 行容器随 draw() 的泳道布局同步 top / 高度（含纵移），行内各格用 left 定位。 */
  const root = document.createElement('div')
  root.className = 'ed-tl-head'
  // DOM 侧可配置项以 CSS 变量下发（按钮底色 / hover、标尺区高度、泳道底色、头列底色 / 分隔线）
  root.style.setProperty('--tl-btn-bg', cfg.commonButtonBgColor)
  root.style.setProperty('--tl-btn-hover', cfg.commonButtonHoverColor)
  root.style.setProperty('--tl-ruler-h', `${cfg.timelineHeight}px`)
  root.style.setProperty('--tl-lane-fill', numToCss(cfg.trackBackgroundColor))
  root.style.setProperty('--tl-bg', numToCss(cfg.backgroundColor))
  root.style.setProperty('--tl-divider', numToCss(cfg.laneDividerColor))
  root.innerHTML =
    '<div class="ed-tl-head-top"></div>' +
    '<div class="ed-tl-head-rows"></div>' +
    '<div class="ed-tl-head-sb"></div>'
  const sb = root.querySelector<HTMLDivElement>('.ed-tl-head-sb')!
  const rows = root.querySelector<HTMLDivElement>('.ed-tl-head-rows')!
  // 拖拽落轨时空主轨（隐式新轨）的轨道头浮动高亮条（无真实轨道，不属于任何行容器）
  const drag = document.createElement('div')
  drag.className = 'ed-tl-head-lane is-drag-over'
  drag.style.display = 'none'
  rows.appendChild(drag)
  host.appendChild(root)

  const els: HeadEls = { root, sb, rows, drag }

  /**
   * 主轨 / 素材轨均可放视频（含内嵌原声），与音频轨一样展示音量开关；
   * 其余装饰轨不展示（对齐参考：素材轨与主轨同样有锁 / 显示 / 静音三按钮）
   */
  const trackHasSound = (t: TrackObject) =>
    t.type === 'video' || t.type === 'image' || t.type === 'audio'
  /** 行容器（与轨道一一对应：行底色 + 全部按钮；空主轨占位行仅在他轨有素材时出现）+ 行内四格，按 id 复用 */
  const rowMap = new Map<string, HTMLDivElement>()
  const cellMaps: Record<ColKey, Map<string, HTMLElement>> = {
    type: new Map(),
    lock: new Map(),
    show: new Map(),
    sound: new Map()
  }
  /** 轨道类型 → 素材库选项卡图标（video/image 共用素材图标；字幕与文本同轨共用 TI） */
  const TRACK_TAB_ICON: Record<TrackObjectType, string> = {
    video: 'material',
    image: 'material',
    audio: 'audio',
    text: 'text',
    caption: 'text',
    sticker: 'sticker',
    filter: 'filter',
    effect: 'effect',
    transition: 'transition'
  }

  /** 空主轨占位按钮：span（无 data-track/data-act，点击委托天然忽略）+ is-ph 关指针，图标固定默认态 */
  function syncPlaceholderCell(
    key: TrackAct,
    rowId: string,
    row: HTMLDivElement,
    keepSet: Set<string>,
    icon: string,
    tip: string
  ) {
    keepSet.add(rowId)
    let btn = cellMaps[key].get(rowId)
    if (!btn) {
      btn = document.createElement('span')
      btn.className = 'ed-tl-cell ed-tl-head-btn is-ph'
      btn.innerHTML = '<span class="ed-tl-ic"></span>'
      row.appendChild(btn)
      cellMaps[key].set(rowId, btn)
    }
    const ic = btn.querySelector<HTMLSpanElement>('.ed-tl-ic')!
    ic.dataset.tip = tip
    ic.innerHTML = tlIcon(icon, 14)
  }

  /** 取 / 建操作按钮，挂进对应轨道的行容器（CSS 按 data-act 定 left、满轨高），并刷新三态 */
  function syncActCell(
    key: TrackAct,
    t: TrackObject,
    row: HTMLDivElement,
    keepSet: Set<string>,
    state: { on: boolean; onIcon: string; offIcon: string; onTip: string; offTip: string }
  ) {
    keepSet.add(t.id)
    let btn = cellMaps[key].get(t.id) as HTMLButtonElement | undefined
    if (!btn) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ed-tl-cell ed-tl-head-btn'
      btn.dataset.track = t.id
      btn.dataset.act = key
      btn.innerHTML = '<span class="ed-tl-ic"></span>'
      row.appendChild(btn)
      cellMaps[key].set(t.id, btn)
    }
    btn.classList.toggle('is-off', state.on)
    const ic = btn.querySelector<HTMLSpanElement>('.ed-tl-ic')!
    ic.dataset.tip = state.on ? state.onTip : state.offTip
    ic.innerHTML = tlIcon(state.on ? state.onIcon : state.offIcon, 14)
  }

  function pruneMap(map: Map<string, HTMLElement>, keepSet: Set<string>) {
    for (const [id, el] of map) {
      if (!keepSet.has(id)) {
        el.remove()
        map.delete(id)
      }
    }
  }

  /**
   * 每次 draw 后按泳道同步：每轨一个行容器（top 随泳道、高度与泳道一致），内含各按钮。
   * 空主轨（无对象或素材为空）：全空工程不渲染任何头列行（剪映全空态头列留空）；
   * 他轨有素材时渲染占位行——类型图标 + 锁 / 显示 / 原声整排按钮以默认态展示（剪映该状态主轨前侧按钮仍在），
   * 但主轨对象尚不存在，按钮不可点击（CSS is-ph 关指针），落素材后行随真实轨道重建为可交互按钮。
   */
  function syncHead(lanes: Lane[], hasHBar: boolean, allTracksEmpty: boolean) {
    sb.style.display = hasHBar ? 'block' : 'none'
    // 行容器层只允许在播放区内可见：纵向滚动时行随泳道上下移动，
    // 但不能滑入顶部标尺占位带 / 底部横向滚动条占位带（两者固定不动）
    root.style.setProperty('--tl-sb-h', hasHBar ? `${cfg.scrollbarHeight}px` : '0px')
    const keep: Record<ColKey | 'row', Set<string>> = {
      row: new Set(),
      type: new Set(),
      lock: new Set(),
      show: new Set(),
      sound: new Set()
    }
    for (const lane of lanes) {
      const t = lane.track
      const isEmptyMain = lane.isMain && (!t || t.items.length === 0)
      if (isEmptyMain && allTracksEmpty) continue
      const rowId = isEmptyMain ? EMPTY_MAIN_ROW : t!.id
      keep.row.add(rowId)
      // 行容器（铺满 90px 轨道头列，与右侧 canvas 泳道同 top/同高；底色由 CSS 承担）
      let row = rowMap.get(rowId)
      if (!row) {
        row = document.createElement('div')
        row.className = 'ed-tl-head-row'
        rows.appendChild(row)
        rowMap.set(rowId, row)
      }
      row.classList.toggle('is-empty-main', isEmptyMain)
      row.style.top = `${lane.y}px`
      row.style.height = `${lane.h}px`

      // 第一格：类型图标（纯装饰，随类型设定一次；CSS 定 left:6）
      keep.type.add(rowId)
      let typeCell = cellMaps.type.get(rowId)
      if (!typeCell) {
        const trackType: TrackObjectType = isEmptyMain ? 'video' : t!.type
        typeCell = document.createElement('span')
        typeCell.className = 'ed-tl-cell ed-tl-head-type'
        typeCell.innerHTML = tabIcon(TRACK_TAB_ICON[trackType], 17)
        row.appendChild(typeCell)
        cellMaps.type.set(rowId, typeCell)
      }

      if (isEmptyMain) {
        // 空主轨占位：三按钮默认态（未锁 / 可见 / 有声）、不可点击，仅与剪映视觉对齐
        syncPlaceholderCell('lock', rowId, row, keep.lock, 'track-lock-open', '锁定轨道')
        syncPlaceholderCell('show', rowId, row, keep.show, 'track-eye', '隐藏轨道')
        syncPlaceholderCell('sound', rowId, row, keep.sound, 'track-sound', '隐藏原声')
        continue
      }

      // 锁定 / 显示：每条轨道都有，按钮满轨高（hover/点击热区与轨道等高）
      syncActCell('lock', t!, row, keep.lock, {
        on: !!t!.locked,
        onIcon: 'track-lock',
        offIcon: 'track-lock-open',
        onTip: '解锁轨道',
        offTip: '锁定轨道'
      })
      syncActCell('show', t!, row, keep.show, {
        on: !!t!.hidden,
        onIcon: 'track-eye-off',
        offIcon: 'track-eye',
        onTip: '显示轨道',
        offTip: '隐藏轨道'
      })

      // 原声：仅视频 / 图片 / 音频轨渲染该按钮
      if (trackHasSound(t!)) {
        syncActCell('sound', t!, row, keep.sound, {
          on: !!t!.muted,
          onIcon: 'track-sound-off',
          offIcon: 'track-sound',
          onTip: '显示原声',
          offTip: '隐藏原声'
        })
      }
    }
    pruneMap(rowMap, keep.row)
    pruneMap(cellMaps.type, keep.type)
    pruneMap(cellMaps.lock, keep.lock)
    pruneMap(cellMaps.show, keep.show)
    pruneMap(cellMaps.sound, keep.sound)

    // 拖入素材：所有此刻可放入的既有轨轨道头行齐亮（进入 pixi 即亮，不必进入轨道）；
    // 空主轨可放时——他轨有素材则高亮其占位行；全空工程用浮动高亮条接续；新建轨无轨道头高亮
    const dv = s.dndView
    for (const el of rowMap.values()) el.classList.remove('is-drag-over')
    drag.style.display = 'none'
    if (dv) {
      for (const id of dv.placeIds) rowMap.get(id)?.classList.add('is-drag-over')
      if (dv.mainPlaceable) {
        const mainLane = lanes.find(l => l.isMain && (!l.track || l.track.items.length === 0))
        if (mainLane) {
          const emptyRow = rowMap.get(EMPTY_MAIN_ROW)
          if (emptyRow) {
            emptyRow.classList.add('is-drag-over')
          } else {
            drag.style.display = 'block'
            drag.style.top = `${mainLane.y}px`
            drag.style.height = `${mainLane.h}px`
          }
        }
      }
    }
  }

  const onClick = (e: MouseEvent) => {
    const btn = (e.target as Element | null)?.closest?.('button[data-act]') as HTMLButtonElement | null
    if (btn?.dataset.track) {
      deps.toggleTrack(btn.dataset.track, btn.dataset.act as TrackAct)
    }
  }
  root.addEventListener('click', onClick)

  function destroy() {
    root.removeEventListener('click', onClick)
    rowMap.clear()
    ;(Object.keys(cellMaps) as ColKey[]).forEach(k => cellMaps[k].clear())
    root.remove()
  }

  return { els, syncHead, destroy }
}
