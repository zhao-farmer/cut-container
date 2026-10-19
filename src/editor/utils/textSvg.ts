/* ============================================================
 *  文字 · 统一 SVG 渲染管线
 *  - 素材面板模板预览（内联 SVG）与播放器文字表面（SVG 光栅化）
 *    共用同一套布局 / 描边 / 阴影描述，所见即所得；
 *  - 几何口径与原 canvas fillText 绘制完全一致：整块恒居中、
 *    align 只收齐块内各行、竖排自右向左列、拉丁字符顺时针转 90°；
 *  - 阴影支持多层串联（feGaussianBlur + feOffset + feFlood + feMerge），
 *    可表达霓虹等 canvas 单道 shadowBlur 无法呈现的叠层发光。
 * ============================================================ */
import type { ResolvedTextStyle, TextShadow } from '../types'

/** 字形包围盒（相对表面中心；ox/oy 为盒心偏移） */
export interface TextBlockBox {
  w: number
  h: number
  ox: number
  oy: number
}

export interface BuiltTextSvg {
  /** 完整 svg 文档字符串 */
  svg: string
  /** 文档像素尺寸 */
  width: number
  height: number
  /** 字形包围盒（命中 / 操作框用，恒贴合字形而非整幅画布） */
  box: TextBlockBox
}

/* ---------------- 测量（与浏览器同款文字引擎，几何和光栅零偏差） ---------------- */

let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  return measureCtx!
}

/**
 * 每份 SVG 的 filter id 序号：素材面板会同屏内联几十个文字 SVG，
 * 若共用固定 id（url(#tx-fx) 在 document 内解析到第一个同名 filter），
 * 各卡片的描边投影 / 多层发光会全部串到第一张卡的滤镜。逐份唯一即可。
 */
let svgFilterSeq = 0

function applyMeasureFont(ctx: CanvasRenderingContext2D, st: ResolvedTextStyle): void {
  ctx.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${st.fontSize}px ${st.fontFamily || 'sans-serif'}`
}

/** 竖排中字符是否直排（CJK / 假名 / 谚文 / 全角标点等）；否则按横排字符顺时针转 90° */
export function isUprightCp(cp: number): boolean {
  return (
    cp > 0xffff ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0x31ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef)
  )
}

interface HLine {
  text: string
  /** 绘制起点（text-anchor=start） */
  x: number
  /** 中线 y（dominant-baseline=central） */
  y: number
  /** 行宽（含字间距） */
  w: number
}

interface VGlyph {
  ch: string
  x: number
  y: number
  /** 沿列方向步进（含字间距） */
  adv: number
  /** 拉丁 / 数字等横排字符：顺时针转 90° */
  rot: boolean
}

interface ULineRect {
  x: number
  y: number
  w: number
  h: number
}

interface TextGeometry {
  width: number
  height: number
  hLines: HLine[]
  vGlyphs: VGlyph[]
  underlines: ULineRect[]
  box: TextBlockBox
  /** 本次布局实际使用的描边 / 阴影内边距（box 含此内边距，背景底板按扣除后的字形盒包裹） */
  padX: number
  padY: number
}

/**
 * 文本几何布局（纯测量，不绘制）。
 * @param surfaceW/H 表面尺寸；文字块恒居中（hug 时传紧贴尺寸即可）
 * @param padX/Y 字形到表面边缘的预留（描边 / 阴影外扩）
 */
function layoutText(
  st: ResolvedTextStyle,
  surfaceW: number,
  surfaceH: number,
  padX: number,
  padY: number
): TextGeometry {
  const ctx = getMeasureCtx()
  applyMeasureFont(ctx, st)
  const fs = st.fontSize

  if (!st.content) {
    return {
      width: surfaceW,
      height: surfaceH,
      hLines: [],
      vGlyphs: [],
      underlines: [],
      box: { w: Math.max(fs * 1.2, 1) + padX * 2, h: fs * 1.25 + padY * 2, ox: 0, oy: 0 },
      padX,
      padY
    }
  }
  return st.vertical
    ? layoutVertical(ctx, st, surfaceW, surfaceH, fs, padX, padY)
    : layoutHorizontal(ctx, st, surfaceW, surfaceH, fs, padX, padY)
}

/** 逐字测量文本宽度（含字间距；字间距为 0 时等价整串测量） */
function measureSpacedText(ctx: CanvasRenderingContext2D, s: string, ls: number): number {
  if (!s) return 0
  if (!ls) return ctx.measureText(s).width
  let w = 0
  for (const ch of s) w += ctx.measureText(ch).width
  return w + ls * (s.length - 1)
}

/** 文本块左边缘 blockX0 内，某行按对齐方向收齐后的绘制起点 x */
function lineBlockX(blockX0: number, align: ResolvedTextStyle['align'], maxW: number, lineW: number): number {
  if (align === 'left') return blockX0
  if (align === 'right') return blockX0 + maxW - lineW
  return blockX0 + (maxW - lineW) / 2
}

function layoutHorizontal(
  ctx: CanvasRenderingContext2D,
  st: ResolvedTextStyle,
  sizeW: number,
  sizeH: number,
  fs: number,
  padX: number,
  padY: number
): TextGeometry {
  const lines = st.content.split('\n')
  const lh = fs * 1.25 + st.lineSpacing
  const widths = lines.map(ln => measureSpacedText(ctx, ln, st.letterSpacing))
  const maxW = widths.reduce((m, w) => Math.max(m, w), 0)
  const blockH = lines.length * lh - (lines.length > 1 ? st.lineSpacing : 0)

  // 整块恒水平 / 垂直居中；align 只作用于块内各行
  const blockX0 = (sizeW - maxW) / 2
  const blockTop = (sizeH - blockH) / 2

  const hLines: HLine[] = lines.map((text, i) => ({
    text,
    x: lineBlockX(blockX0, st.align, maxW, widths[i] ?? 0),
    y: blockTop + i * lh + lh / 2 - st.lineSpacing / 2,
    w: widths[i] ?? 0
  }))

  const underlines: ULineRect[] = []
  if (st.underline) {
    for (const ln of hLines) {
      underlines.push({
        x: ln.x,
        y: ln.y + fs * 0.42,
        w: Math.max(ln.w, 1),
        h: Math.max(1.5, fs * 0.05)
      })
    }
  }

  return {
    width: sizeW,
    height: sizeH,
    hLines,
    vGlyphs: [],
    underlines,
    box: { w: Math.max(maxW, fs * 1.2) + padX * 2, h: blockH + padY * 2, ox: 0, oy: 0 },
    padX,
    padY
  }
}

function layoutVertical(
  ctx: CanvasRenderingContext2D,
  st: ResolvedTextStyle,
  sizeW: number,
  sizeH: number,
  fs: number,
  padX: number,
  padY: number
): TextGeometry {
  const lines = st.content.split('\n')
  const colPitch = fs * 1.25 + st.lineSpacing
  const cols: VGlyph[][] = []
  const colHs: number[] = []
  let maxColH = 0
  for (const ln of lines) {
    const glyphs: VGlyph[] = []
    let pen = 0
    for (const ch of Array.from(ln)) {
      const cp = ch.codePointAt(0) ?? 0
      const rot = !isUprightCp(cp)
      const adv = (rot ? ctx.measureText(ch).width : fs) + st.letterSpacing
      glyphs.push({ ch, x: 0, y: 0, adv, rot })
      pen += adv
    }
    const colH = Math.max(pen - (glyphs.length ? st.letterSpacing : 0), 0)
    maxColH = Math.max(maxColH, colH)
    colHs.push(colH)
    cols.push(glyphs)
  }
  const blockW = cols.length * colPitch - (cols.length > 1 ? st.lineSpacing : 0)
  const blockH = maxColH

  // 整块恒居中；valign 只让各列在最高列范围内上 / 中 / 下收齐
  const blockTop = (sizeH - blockH) / 2
  const blockX0 = (sizeW - blockW) / 2
  const vGlyphs: VGlyph[] = []
  cols.forEach((glyphs, i) => {
    const cx = blockX0 + blockW - (i + 0.5) * colPitch
    const colH = colHs[i] ?? 0
    const vOffset =
      st.valign === 'top'
        ? 0
        : st.valign === 'bottom'
          ? maxColH - colH
          : (maxColH - colH) / 2
    let pen = blockTop + vOffset
    for (const g of glyphs) {
      g.x = cx
      g.y = pen + g.adv / 2
      pen += g.adv
      vGlyphs.push(g)
    }
  })

  // 竖排下划线：沿每列右侧的竖线
  const underlines: ULineRect[] = []
  if (st.underline) {
    cols.forEach(glyphs => {
      if (!glyphs.length) return
      const first = glyphs[0]!
      const last = glyphs[glyphs.length - 1]!
      const top = first.y - first.adv / 2
      const bottom = last.y + last.adv / 2
      underlines.push({
        x: first.x + fs * 0.42,
        y: top,
        w: Math.max(1.5, fs * 0.05),
        h: Math.max(bottom - top, 1)
      })
    })
  }

  return {
    width: sizeW,
    height: sizeH,
    hLines: [],
    vGlyphs,
    underlines,
    box: { w: Math.max(blockW, fs * 1.2) + padX * 2, h: blockH + padY * 2, ox: 0, oy: 0 },
    padX,
    padY
  }
}

/* ------------------------------- SVG 序列化 ------------------------------- */

/** XML 文本节点转义 */
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 仅保留安全小数位，避免噪声 */
function n(v: number): string {
  return String(Math.round(v * 100) / 100)
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** 颜色属性：hex 走 presentation 属性，其它走 CSS（兼容 rgba / 颜色关键字） */
function colorAttr(name: string, color: string): { attr?: string; style?: string } {
  return HEX_RE.test(color) ? { attr: `${name}="${color}"` } : { style: `${name}:${color}` }
}

/** 阴影 / 发光层：主阴影（blur 为 0-100 百分比口径）转成 SVG 像素参数 */
interface PaintShadow {
  color: string
  opacity: number
  /** 高斯标准差（px） */
  sigma: number
  dx: number
  dy: number
}

function shadowPaintList(st: ResolvedTextStyle): PaintShadow[] {
  const fs = st.fontSize
  const conv = (s: TextShadow): PaintShadow => {
    const rad = (s.angle * Math.PI) / 180
    return {
      color: s.color,
      opacity: s.opacity,
      // canvas shadowBlur 约等于 2 倍 sigma，沿用旧观感
      sigma: Math.max(0, ((s.blur / 100) * fs) / 2),
      dx: Math.cos(rad) * s.distance,
      dy: Math.sin(rad) * s.distance
    }
  }
  const out: PaintShadow[] = []
  if (st.shadow.enabled) out.push(conv(st.shadow))
  for (const s of st.extraShadows) out.push(conv(s))
  return out
}

/**
 * 发光范围 → 高斯标准差（按字号比例，两种发光共用）：
 * canvas shadowBlur 约等于 2 倍 sigma，沿用旧观感。
 */
function glowSigma(st: ResolvedTextStyle): number {
  const g = st.glow
  if (!g.enabled || g.strength <= 0) return 0
  return Math.max(0, ((g.range / 100) * st.fontSize) / 2)
}

/**
 * 普通外发光（soft）：单层高斯模糊，光晕居中、无方向。
 * 参数仅 颜色 / 强度（不透明度）/ 范围（sigma）。
 */
function glowSoftList(st: ResolvedTextStyle): PaintShadow[] {
  const g = st.glow
  if (!g.enabled || g.mode !== 'soft' || g.strength <= 0) return []
  const sigma = glowSigma(st)
  return [{ color: g.color, opacity: (g.strength / 100) * 0.85, sigma, dx: 0, dy: 0 }]
}

/**
 * 璀璨光束（gem）：从字形沿投射方向打出的方向性柔光光锥（剪映「璀璨」同款观感）。
 * 不用 feSpecularLighting——它在白字 alpha 上只会产生金属凹凸的灰烟。
 *
 * 做法（纯 SVG filter 原语）：
 *   沿投射方向铺 COPIES 份字形 alpha 的模糊拷贝，每份：
 *     - 独立 feGaussianBlur，σ 随距离线性递增（近端窄、远端宽 → 锥形发散）；
 *     - feOffset 到 i·step 的位置（线性位移 → 光柱长度）；
 *     - flood 着发光色，不透明度按 q^i 指数衰减（远端淡出）。
 *   各笔画的模糊形单方向拉伸、间隙保留为纵向暗纹，自然形成多道光柱；
 *   另附一道紧贴字形、很弱的内晕，让字面自身发亮。
 *
 * 角度口径（均 -50°~50°）：方向向量由 (sin(h), -sin(v)) 归一化得到——
 * 角度只决定光束朝向、不改变光束长短/粗细：
 * 垂直角负值 → 光束向下（dy>0）、正值向上；水平角负值 → 向左（dx<0）；
 * (0,0) 时默认垂直向下。
 * 「强度」= 整体不透明度；「范围」= 同时控制光束宽度（σ）与长度（step）。
 */
interface GemGlow {
  /** 滤镜内部节点字符串 */
  nodes: string
  /** 外层 feMerge 中由后到前压入的层 result 名 */
  merges: string[]
  /** 光束相对字形在 x / y 方向的最大外扩（hug 留白用） */
  extentX: number
  extentY: number
}

function buildGemGlow(st: ResolvedTextStyle): GemGlow | null {
  const g = st.glow
  if (!g.enabled || g.mode !== 'gem' || g.strength <= 0) return null
  const fs = st.fontSize
  const k = g.strength / 100
  const COPIES = 16
  const DECAY = 0.78
  const r = g.range / 100
  // 近端 σ 已达到笔画级别（字形结构被糊成柔光，不留下可见重影），
  // 远端继续变宽形成光锥；密排布 + 大重叠，避免各份之间出现云絮分层
  const sigma0 = fs * 0.16
  const sigma1 = Math.max(fs * (0.14 + r * 0.3), sigma0)
  // 每份位移步长：范围越大光束越长（与角度无关），总长 ≈ COPIES·step
  const step = fs * (0.045 + r * 0.225)

  // 方向单位向量：角度只控制朝向；(0,0) 默认垂直向下
  let ux = Math.sin((g.angleH * Math.PI) / 180)
  let uy = -Math.sin((g.angleV * Math.PI) / 180)
  const len = Math.hypot(ux, uy)
  if (len < 1e-6) {
    ux = 0
    uy = 1
  } else {
    ux /= len
    uy /= len
  }

  const fc = colorAttr('flood-color', g.color)
  let nodes = ''
  const merges: string[] = []
  let extentX = sigma1
  let extentY = sigma1

  for (let i = 0; i < COPIES; i++) {
    const t = i / (COPIES - 1)
    const sigma = sigma0 + (sigma1 - sigma0) * t
    const dx = (i + 1) * step * ux
    const dy = (i + 1) * step * uy
    const op = k * 0.85 * DECAY ** i
    nodes += `\n    <feGaussianBlur in="SourceAlpha" stdDeviation="${n(sigma)}" result="gb${i}"/>`
    nodes += `\n    <feOffset in="gb${i}" dx="${n(dx)}" dy="${n(dy)}" result="go${i}"/>`
    nodes += `\n    <feFlood ${fc.attr ?? ''}${fc.style ? ` style="${fc.style}"` : ''} flood-opacity="${n(op)}" result="gf${i}"/>`
    nodes += `\n    <feComposite in="gf${i}" in2="go${i}" operator="in" result="gm${i}"/>`
    merges.push(`gm${i}`)
    extentX = Math.max(extentX, Math.abs(dx) + sigma)
    extentY = Math.max(extentY, Math.abs(dy) + sigma)
  }

  // 紧贴字形的弱内晕（字面发亮，但不形成压过光束的对称光团）
  nodes += `\n    <feGaussianBlur in="SourceAlpha" stdDeviation="${n(fs * 0.06)}" result="ghB"/>`
  const hc = colorAttr('flood-color', g.color)
  nodes += `\n    <feFlood ${hc.attr ?? ''}${hc.style ? ` style="${hc.style}"` : ''} flood-opacity="${n(k * 0.45)}" result="ghF"/>`
  nodes += `\n    <feComposite in="ghF" in2="ghB" operator="in" result="ghC"/>`
  merges.push('ghC')

  return { nodes, merges, extentX, extentY }
}

/** 背景底板几何（坐标相对表面中心；x/y 为左上角偏移，0,0 即表面中心） */
interface BgRect {
  x: number
  y: number
  w: number
  h: number
  rx: number
  color: string
  opacity: number
}

function backgroundRect(st: ResolvedTextStyle, glyphBox: TextBlockBox): BgRect | null {
  const b = st.background
  if (!b.enabled) return null
  const fs = st.fontSize
  const w = glyphBox.w + (fs * b.width) / 100 * 2
  const h = glyphBox.h + (fs * b.height) / 100 * 2
  const dx = ((b.offsetX - 50) / 100) * w * 0.5
  const dy = ((b.offsetY - 50) / 100) * h * 0.5
  return {
    x: glyphBox.ox - w / 2 + dx,
    y: glyphBox.oy - h / 2 + dy,
    w,
    h,
    rx: (Math.min(w, h) / 2) * (b.radius / 100),
    color: b.color,
    opacity: b.opacity
  }
}

/** 字形盒 ∪ 背景底板（操作框在开启背景时包裹底板；坐标仍相对表面中心） */
function unionBackground(box: TextBlockBox, bg: BgRect | null): TextBlockBox {
  if (!bg) return box
  const x0 = Math.min(box.ox - box.w / 2, bg.x)
  const x1 = Math.max(box.ox + box.w / 2, bg.x + bg.w)
  const y0 = Math.min(box.oy - box.h / 2, bg.y)
  const y1 = Math.max(box.oy + box.h / 2, bg.y + bg.h)
  return { w: x1 - x0, h: y1 - y0, ox: (x0 + x1) / 2, oy: (y0 + y1) / 2 }
}

/**
 * 多层阴影 / 发光 / 光束滤镜：
 * 阴影 / soft 外发光每层 blur → offset → flood 着色 → in 裁切；
 * gem 光束自带节点（16 份递宽衰减拷贝 + 内晕，已着色）。
 * feMerge 从下到上：阴影层 → soft 发光层 → gem 光束层（远端→近端→内晕）→ SourceGraphic。
 * 滤镜区域按光束实际像素外扩相对字形盒精确计算：典型多字时区域小（光栅化便宜），
 * 单字 + 极端角度时才放大，长尾不被裁。
 */
function buildEffectFilter(
  shadows: PaintShadow[],
  glows: PaintShadow[],
  gem: GemGlow | null,
  boxW: number,
  boxH: number,
  filterId: string
): string {
  const layerNode = (s: PaintShadow, id: string, i: number) => {
    const fc = colorAttr('flood-color', s.color)
    return `
    <feGaussianBlur in="SourceAlpha" stdDeviation="${n(s.sigma)}" result="b${id}${i}"/>
    <feOffset in="b${id}${i}" dx="${n(s.dx)}" dy="${n(s.dy)}" result="o${id}${i}"/>
    <feFlood ${fc.attr ?? ''}${fc.style ? ` style="${fc.style}"` : ''} flood-opacity="${n(s.opacity)}" result="c${id}${i}"/>
    <feComposite in="c${id}${i}" in2="o${id}${i}" operator="in" result="s${id}${i}"/>`
  }
  const nodes = [
    ...shadows.map((s, i) => layerNode(s, 's', i)),
    ...glows.map((s, i) => layerNode(s, 'g', i)),
    gem?.nodes ?? ''
  ].join('')
  const mx = Math.max(
    ...[...shadows, ...glows].map(s => Math.abs(s.dx) + s.sigma * 2),
    gem?.extentX ?? 0
  )
  const my = Math.max(
    ...[...shadows, ...glows].map(s => Math.abs(s.dy) + s.sigma * 2),
    gem?.extentY ?? 0
  )
  // 额外 10% 余量给 flood 边缘抗锯齿
  const xp = (mx / boxW) * 100 + 10
  const yp = (my / boxH) * 100 + 10
  const region = `x="${n(-xp)}%" y="${n(-yp)}%" width="${n(100 + xp * 2)}%" height="${n(100 + yp * 2)}%"`
  const merges = [
    ...shadows.map((_, i) => `\n      <feMergeNode in="ss${i}"/>`),
    ...glows.map((_, i) => `\n      <feMergeNode in="sg${i}"/>`),
    ...(gem?.merges ?? []).map(r => `\n      <feMergeNode in="${r}"/>`)
  ].join('')
  return `<filter id="${filterId}" ${region}>${nodes}
    <feMerge>${merges}
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>`
}

/** 字体相关 presentation 属性 */
function fontPresentation(st: ResolvedTextStyle): string {
  return [
    `font-family="${(st.fontFamily || 'sans-serif').replace(/"/g, "'")}"`,
    `font-size="${n(st.fontSize)}"`,
    `font-weight="${st.bold ? 700 : 400}"`,
    `font-style="${st.italic ? 'italic' : 'normal'}"`
  ].join(' ')
}

/** 把几何 + 样式序列化为完整 svg 文档 */
function emitSvg(st: ResolvedTextStyle, g: TextGeometry): BuiltTextSvg {
  const shadows = shadowPaintList(st)
  const glows = glowSoftList(st)
  const gem = buildGemGlow(st)
  // 字形盒（扣除布局内边距）：背景底板紧贴字形，不把描边 / 发光留白算进底板
  const glyphBox: TextBlockBox = {
    w: Math.max(g.box.w - g.padX * 2, 1),
    h: Math.max(g.box.h - g.padY * 2, 1),
    ox: g.box.ox,
    oy: g.box.oy
  }
  const fxCount = shadows.length + glows.length + (gem ? 1 : 0)
  // 同文档多内联 SVG 时 filter id 必须唯一，否则 url(#…) 会解析到别人的滤镜
  const filterId = `tx-fx-${++svgFilterSeq}`
  const defs = fxCount
    ? `<defs>${buildEffectFilter(shadows, glows, gem, glyphBox.w, glyphBox.h, filterId)}</defs>`
    : ''

  const bg = backgroundRect(st, glyphBox)
  const bgSvg = bg
    ? (() => {
        const fc = colorAttr('fill', bg.color)
        return `\n<rect x="${n(g.width / 2 + bg.x)}" y="${n(g.height / 2 + bg.y)}" width="${n(bg.w)}" height="${n(bg.h)}" rx="${n(bg.rx)}" ${fc.attr ?? ''}${fc.style ? ` style="${fc.style}"` : ''} fill-opacity="${n(bg.opacity)}"/>`
      })()
    : ''

  // 文字组：填充 + 可选描边（paint-order 保证描边在填充之下，尖角不糊脸）
  const attrs: string[] = [fontPresentation(st)]
  const styleParts: string[] = []
  const fill = colorAttr('fill', st.color)
  if (fill.attr) attrs.push(fill.attr)
  if (fill.style) styleParts.push(fill.style)
  if (st.stroke.enabled && st.stroke.width > 0) {
    const sc = colorAttr('stroke', st.stroke.color)
    if (sc.attr) attrs.push(sc.attr)
    if (sc.style) styleParts.push(sc.style)
    attrs.push(`stroke-width="${n(st.stroke.width)}"`)
    attrs.push(`stroke-opacity="${n(st.stroke.opacity)}"`)
    attrs.push('stroke-linejoin="round" stroke-miterlimit="2"')
    styleParts.push('paint-order:stroke fill')
  }
  if (fxCount) attrs.push(`filter="url(#${filterId})"`)
  if (styleParts.length) attrs.push(`style="${styleParts.join(';')}"`)

  let body = ''

  // 横排：无间距时整行一个 <text>（保留字距调整）；有字间距时逐字摆放（与旧 canvas 口径一致）
  const ctx = getMeasureCtx()
  for (const ln of g.hLines) {
    if (!st.letterSpacing) {
      body += `\n  <text x="${n(ln.x)}" y="${n(ln.y)}" text-anchor="start" dominant-baseline="central" xml:space="preserve">${escText(ln.text)}</text>`
    } else {
      let pen = ln.x
      for (const ch of ln.text) {
        body += `\n  <text x="${n(pen)}" y="${n(ln.y)}" text-anchor="start" dominant-baseline="central">${escText(ch)}</text>`
        pen += ctx.measureText(ch).width + st.letterSpacing
      }
    }
  }

  // 竖排：逐字（拉丁 / 数字顺时针转 90°）
  for (const gl of g.vGlyphs) {
    if (gl.rot) {
      body += `\n  <text transform="translate(${n(gl.x)} ${n(gl.y)}) rotate(90)" text-anchor="middle" dominant-baseline="central">${escText(gl.ch)}</text>`
    } else {
      body += `\n  <text x="${n(gl.x)}" y="${n(gl.y)}" text-anchor="middle" dominant-baseline="central">${escText(gl.ch)}</text>`
    }
  }

  // 下划线：只随填充（不描边 / 不投影，与旧 canvas 一致）
  let lines = ''
  if (g.underlines.length) {
    const uc = colorAttr('fill', st.color)
    lines = `\n<g ${uc.attr ?? ''}${uc.style ? ` style="${uc.style}"` : ''} stroke="none">`
    for (const r of g.underlines) {
      lines += `\n  <rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`
    }
    lines += '\n</g>'
  }

  // 混合：整体不透明度（关闭混合段＝直通，按完全不透明渲染）
  const opacity = st.blend.enabled ? st.blend.opacity : 1
  const rootAttr = opacity >= 1 ? '' : ` opacity="${n(opacity)}"`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}">${defs}
<g${rootAttr}>${bgSvg}
<g ${attrs.join(' ')}>${body}
</g>${lines}
</g>
</svg>`

  return { svg, width: g.width, height: g.height, box: unionBackground(g.box, bg) }
}

/** 描边外扩预留（与旧 canvas pad 一致） */
function strokePad(st: ResolvedTextStyle): { padX: number; padY: number } {
  const fs = st.fontSize
  const half = st.stroke.enabled && st.stroke.width > 0 ? st.stroke.width / 2 : 0
  return { padX: fs * 0.15 + half, padY: fs * 0.1 + half }
}

/**
 * 面板预览：紧贴字形内容的 SVG（额外为阴影 / 发光 / 背景底板预留对称边距，防止被裁）。
 * 返回的 width/height 即设计 px，CSS 可直接等比缩放。
 */
export function buildHugTextSvg(st: ResolvedTextStyle): BuiltTextSvg {
  // 先以 0 内距量出字形块尺寸
  const probe = layoutText(st, 0, 0, 0, 0)
  const contentW = Math.max(probe.box.w, 1)
  const contentH = Math.max(probe.box.h, 1)

  const { padX, padY } = strokePad(st)
  // 阴影 / 外发光外扩：|偏移| + 2σ 基本覆盖光晕尾部；四边对称留白以保证块恒居中
  let glowX = 0
  let glowY = 0
  for (const s of [...shadowPaintList(st), ...glowSoftList(st)]) {
    glowX = Math.max(glowX, Math.abs(s.dx) + s.sigma * 2)
    glowY = Math.max(glowY, Math.abs(s.dy) + s.sigma * 2)
  }
  // gem 光束：按三束光的最远彗尾 + 模糊半径预留，防止光柱被裁
  const gemGlow = buildGemGlow(st)
  if (gemGlow) {
    glowX = Math.max(glowX, gemGlow.extentX)
    glowY = Math.max(glowY, gemGlow.extentY)
  }
  // 背景底板：按相对字形盒的最远边缘留白（底板可能比字形块大，或被偏移推到一侧）
  const bg = backgroundRect(st, probe.box)
  let bgX = 0
  let bgY = 0
  if (bg) {
    bgX = Math.max(Math.abs(bg.x), Math.abs(bg.x + bg.w)) - contentW / 2
    bgY = Math.max(Math.abs(bg.y), Math.abs(bg.y + bg.h)) - contentH / 2
  }
  const px = Math.max(padX, glowX, bgX, 0)
  const py = Math.max(padY, glowY, bgY, 0)

  const W = Math.ceil(contentW + px * 2)
  const H = Math.ceil(contentH + py * 2)
  const g = layoutText(st, W, H, px, py)
  return emitSvg(st, g)
}

/**
 * 播放器：按逻辑画布尺寸构建 SVG（文字块恒在画布居中，语义与静帧 / 播放合成一致）。
 */
export function buildCanvasTextSvg(st: ResolvedTextStyle, width: number, height: number): BuiltTextSvg {
  const { padX, padY } = strokePad(st)
  const g = layoutText(st, width, height, padX, padY)
  return emitSvg(st, g)
}

/** 同步测量文字包围盒（操作框 / 九宫格对齐用，不必等光栅化；含背景底板范围） */
export function measureTextBlock(st: ResolvedTextStyle): TextBlockBox {
  const g = layoutText(st, 0, 0, 0, 0)
  return unionBackground(g.box, backgroundRect(st, g.box))
}

/* ------------------------------ SVG → 位图光栅化 ------------------------------ */

/**
 * 把 SVG 文档光栅化为已 decode 的 HTMLImageElement（由调用方 drawImage 入画布）。
 * Blob URL 同源、SVG 内无外部引用，不会污染画布；页面已加载的 @font-face 字体可直接使用。
 */
export async function rasterizeTextSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ------------------------------- Web 字体就绪 ------------------------------- */

const fontPromises = new Map<string, Promise<void>>()
const GENERIC_FONTS = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

/** 从 font-family 栈中解析出具名族（去掉引号 / 泛型族） */
function parseFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map(f => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(f => f && !GENERIC_FONTS.has(f.toLowerCase()))
}

/**
 * 确保字体栈中的 web / 本地字体已可用后再光栅化（避免首帧回退字体）。
 * 字体缺失 / 加载失败都静默放行，由浏览器回退字体绘制；每个族只触发一次加载。
 */
export function ensureTextFont(fontStack: string): Promise<void> {
  if (!('fonts' in document)) return Promise.resolve()
  const tasks = parseFamilies(fontStack).map(fam => {
    let p = fontPromises.get(fam)
    if (!p) {
      p = (async () => {
        try {
          await document.fonts.load(`16px "${fam.replace(/"/g, '')}"`)
        } catch {
          /* 本机无此字体：静默，走回退族 */
        }
      })()
      fontPromises.set(fam, p)
    }
    return p
  })
  return Promise.all(tasks).then(() => undefined)
}
