/* ============================================================
 *  时间轴 · pixi 纯图形片段（封面按钮 / 空态提示，TimelineTrack 拆分）
 * ============================================================ */
import type * as PixiNS from 'pixi.js'

/* ---------- 主轨「封面」按钮（pixi 绘制，锚定时间 0，随横滚移动） ---------- */
/** 按钮正方形边长（前缀段宽 50，静止时按钮 40×40 在段内居中） */
export const COVER_BTN_SIZE = 40
/** 面板圆角半径（剪映封面块） */
export const COVER_BTN_RADIUS = 6
/** 虚线节奏：实段 / 间隔（px，pixi v8 无 dashes，手绘） */
export const COVER_DASH_ON = 4
export const COVER_DASH_OFF = 3
/** 笔形图标边长（1024 viewBox 等比缩到此尺寸） */
export const COVER_ICON_SIZE = 17
/** 笔形图标路径 / SVG 构建见 utils/icons.ts 的 COVER_EDIT_ICON_PATH / coverEditIconSvg */
/** 已设封面缩略图右上角「× 移除」角标半径（圆心距按钮上 / 右缘各 7px） */
export const COVER_CLOSE_R = 6.5

/**
 * 沿圆角矩形周长追加虚线轨迹（pixi v8 描边样式不支持 dashes，手绘）：
 * 周长拆 4 直线 + 4 圆弧共 8 段，按弧长每 1px 采样，on/off 节奏的 on 段
 * 聚成 moveTo/lineTo 折线；调用方随后统一 .stroke() 一次。
 * 坐标整体 +0.5，便于 1px 物理宽度描边落在整数像素行。
 */
export function dashedRoundRectPath(
  g: PixiNS.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  on: number,
  off: number
) {
  const P = (px: number, py: number) => ({ x: px + 0.5, y: py + 0.5 })
  const D = (deg: number) => (deg * Math.PI) / 180
  const ARC = (Math.PI * r) / 2
  const ang = (t: number) => (90 * t) / ARC
  // 顺时针自顶边左端起：4 直线 + 4 圆弧
  const segs: Array<{ len: number; at: (t: number) => { x: number; y: number } }> = [
    { len: w - 2 * r, at: t => P(x + r + t, y) },
    { len: ARC, at: t => P(x + w - r + r * Math.cos(D(-90 + ang(t))), y + r + r * Math.sin(D(-90 + ang(t)))) },
    { len: h - 2 * r, at: t => P(x + w, y + r + t) },
    { len: ARC, at: t => P(x + w - r + r * Math.cos(D(ang(t))), y + h - r + r * Math.sin(D(ang(t)))) },
    { len: w - 2 * r, at: t => P(x + w - r - t, y + h) },
    { len: ARC, at: t => P(x + r + r * Math.cos(D(90 + ang(t))), y + h - r + r * Math.sin(D(90 + ang(t)))) },
    { len: h - 2 * r, at: t => P(x, y + h - r - t) },
    { len: ARC, at: t => P(x + r + r * Math.cos(D(180 + ang(t))), y + r + r * Math.sin(D(180 + ang(t)))) }
  ]
  const total = segs.reduce((s, sg) => s + sg.len, 0)
  // 先取整数采样点序列（多取一个收尾点）：on=1 的「点」必须从前一点画到后一点
  // 才有 1px 实线段；直接 lineTo 当前点会得到零长度路径，butt 线帽下完全不显示
  const pointAt = (dd: number) => {
    const v = Math.min(dd, total)
    let acc = 0
    for (const sg of segs) {
      if (v <= acc + sg.len + 1e-6) return sg.at(Math.min(Math.max(v - acc, 0), sg.len))
      acc += sg.len
    }
    return segs[segs.length - 1].at(segs[segs.length - 1].len)
  }
  const pts = Array.from({ length: Math.ceil(total) + 2 }, (_, d) => pointAt(d))
  let drawing = false
  for (let d = 0; d <= Math.ceil(total); d++) {
    const isOn = d % (on + off) < on
    if (isOn) {
      if (!drawing) {
        g.moveTo(pts[d].x, pts[d].y)
        drawing = true
      }
      g.lineTo(pts[d + 1].x, pts[d + 1].y)
    } else {
      drawing = false
    }
  }
}

/* ---------- 空态提示（剪映口径：全空工程投放区 / 空主轨小图标） ---------- */
/** 空主轨泳道填充（他轨有资源时）：比普通泳道 0x242428 亮一档（参考 38→44） */
export const EMPTY_MAIN_LANE_FILL = 0x2a2a2e
/** 全空投放区面板圆角 */
export const EMPTY_DROP_RADIUS = 6
/** 全空投放区点线节奏（参考剪映 1px 点 / 3px 空） */
export const EMPTY_DASH_ON = 1
export const EMPTY_DASH_OFF = 3
/** 全空投放区填充 / 点线 / 图标 / 文案的白色 alpha（黑底主题换算） */
export const EMPTY_DROP_FILL_ALPHA = 0.04
export const EMPTY_DROP_LINE_ALPHA = 0.16
export const EMPTY_DROP_ICON_ALPHA = 0.55
export const EMPTY_DROP_TEXT_COLOR = 0xbfbfbf
/** 空主轨小图标白色 alpha */
export const EMPTY_LANE_ICON_ALPHA = 0.5
/** 胶片框图标外尺寸（参考剪映同形 16×13）与圆角 */
export const FILM_ICON_W = 16
export const FILM_ICON_H = 13
export const FILM_ICON_R = 2
/** 图标距泳道 / 投放区左缘（时间 0）缩进（参考：泳道左缘/盒左 +24） */
export const EMPTY_ICON_INSET = 24
/** 投放区图标与引导文案间距 */
export const EMPTY_ICON_TEXT_GAP = 12

/**
 * 胶片框空态图标（剪映：圆角矩形外框 + 中间一道满宽横隔，16×13）。
 * 描边 / 填充统一白色，alpha 由调用方按场景给。
 */
export function drawFilmIcon(PIXI: typeof import('pixi.js'), x: number, y: number, alpha: number) {
  const g = new PIXI.Graphics()
  g.roundRect(x + 0.25, y + 0.25, FILM_ICON_W, FILM_ICON_H, FILM_ICON_R).stroke({
    width: 1.5,
    color: 0xffffff,
    alpha
  })
  // 中横杠与左右框边相接（1.5px 高，垂直居中）
  g.rect(x + 1, y + FILM_ICON_H / 2 - 0.75, FILM_ICON_W - 2, 1.5).fill({ color: 0xffffff, alpha })
  return g
}
