/* ============================================================
 *  素材库 · 文本预设样式（系统字体，不依赖任何 web 字体）
 *  - SWATCHS：「预设样式」T 字色卡（纯填充 / 描边 / 底色板 / 投影），
 *    点击整卡即把带该样式的「默认文本」添加到时间轴；
 *  - FX_PRESETS：「花字效果」示例卡（霓虹 / 高能时刻等多层发光与描边），
 *    用示例文字出预览，卡片右下角 ＋ 入轨。
 *  所有描边 / 阴影 / 字距均按设计字号描述，入轨统一等比换算到逻辑字号 48，
 *  面板预览（buildHugTextSvg）与播放器光栅化共用同一条 SVG 管线。
 * ============================================================ */
import type { TextContent, TextShadow, TextTemplateShadow } from '../../types'
import { resolveTextStyle } from '../../types'
import type { ResolvedTextStyle } from '../../types'
import { buildHugTextSvg } from '../../utils/textSvg'
import { tr } from '../../lang'

/** 入轨文字的逻辑字号（描边 / 阴影 / 字距按设计字号等比换算到此口径） */
export const TEXT_LOGICAL_FONT_SIZE = 48

/** 设计稿阴影（px）→ 通用 TextShadow（blur 百分比 / 距离 / 角度口径） */
function toShadow(s: TextTemplateShadow, designFs: number, targetFs: number): TextShadow {
  const k = targetFs / designFs
  const dx = (s.dx ?? 0) * k
  const dy = (s.dy ?? 0) * k
  return {
    enabled: true,
    color: s.color,
    opacity: s.opacity ?? 1,
    blur: Math.round(((s.blur ?? 0) * k / targetFs) * 100),
    distance: Math.round(Math.hypot(dx, dy)),
    angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI)
  }
}

/** 预设的描边描述（设计字号 px） */
export interface PresetStroke {
  color: string
  width: number
  opacity?: number
}

/** 预设的底色底板（入轨后渲染为文字后的圆角底板；色卡缩略图直接整块铺色） */
export interface PresetPlate {
  color: string
  opacity?: number
  /** 圆角 0-100（相对底板半高） */
  radius?: number
  /** 高度扩展 0-100（字号百分比） */
  height?: number
  /** 宽度扩展 0-100（字号百分比） */
  width?: number
}

export interface TextStylePreset {
  id: string
  name: string
  /** 色卡 / 卡片上的预览文字 */
  thumb: string
  /** 入轨后的文字内容 */
  content: string
  /** 副标题（样式描述，花字卡用） */
  sub?: string
  /** 缩略图设计字号 */
  fs: number
  /** 色卡整块底色（底板类预设） */
  tileBg?: string
  bold?: boolean
  italic?: boolean
  color: string
  stroke?: PresetStroke
  /** 多层投影 / 发光（设计字号 px，dx/dy 右下为正） */
  shadows?: TextTemplateShadow[]
  /** 字间距（设计字号 px） */
  letterSpacing?: number
  /** 入轨文字的圆角底板 */
  plate?: PresetPlate
}

/** 预设 → 面板预览用的归一文字样式（设计字号 1:1 呈现；底板不画进 SVG，由瓦片 CSS 铺色） */
export function presetPreviewStyle(p: TextStylePreset): ResolvedTextStyle {
  const shadows = (p.shadows ?? []).map(s => toShadow(s, p.fs, p.fs))
  return resolveTextStyle({
    content: p.thumb,
    color: p.color,
    fontSize: p.fs,
    fontFamily: '',
    bold: p.bold,
    italic: p.italic,
    letterSpacing: p.letterSpacing ?? 0,
    stroke: p.stroke
      ? { enabled: true, color: p.stroke.color, opacity: p.stroke.opacity ?? 1, width: p.stroke.width }
      : undefined,
    shadow: shadows[0],
    extraShadows: shadows.slice(1)
  })
}

/** 预设色卡 / 花字卡的内联 SVG（与播放器同管线，描边 / 多层发光缩放不糊） */
export function presetPreviewSvg(p: TextStylePreset): string {
  // 英文模式下用英文预览文本重新排版（SVG 宽度按文字实测，居中不裁切）
  return buildHugTextSvg(presetPreviewStyle({ ...p, thumb: tr(p.thumb) })).svg
}

/** 预设 / 花字在英文模式下的显示名与入轨文字 */
export function localizedPresetName(p: TextStylePreset): string {
  return tr(p.name)
}

export function localizedPresetContent(p: TextStylePreset): string {
  return tr(p.content)
}

/** 预设 → 入轨文字内容（设计字号等比换算到逻辑字号 48，系统字体不加 fontFamily） */
export function presetToTextContent(p: TextStylePreset): TextContent {
  const k = TEXT_LOGICAL_FONT_SIZE / p.fs
  const shadows = (p.shadows ?? []).map(s => toShadow(s, p.fs, TEXT_LOGICAL_FONT_SIZE))
  return {
    content: p.content,
    color: p.color,
    fontSize: TEXT_LOGICAL_FONT_SIZE,
    // 空串＝浏览器系统字体（预设不依赖任何 web 字体）
    fontFamily: '',
    bold: p.bold,
    italic: p.italic,
    letterSpacing: p.letterSpacing ? Math.round(p.letterSpacing * k * 100) / 100 : undefined,
    stroke: p.stroke
      ? {
          enabled: true,
          color: p.stroke.color,
          opacity: p.stroke.opacity ?? 1,
          width: Math.round(p.stroke.width * k * 100) / 100
        }
      : undefined,
    shadow: shadows[0] ? { ...shadows[0] } : undefined,
    ...(shadows.length > 1 ? { extraShadows: shadows.slice(1) } : {}),
    ...(p.plate
      ? {
          background: {
            enabled: true,
            color: p.plate.color,
            opacity: p.plate.opacity ?? 1,
            radius: p.plate.radius ?? 16,
            height: p.plate.height ?? 46,
            width: p.plate.width ?? 90,
            offsetY: 50,
            offsetX: 50
          }
        }
      : {})
  }
}

/* 无样式色卡（禁止符）的 SVG 定义在 utils/icons.ts 统一维护 */

/* ============================================================
 *  预设样式色卡（24 个：填充 / 描边 / 底板 / 投影，顺序对应剪映预设行）
 * ============================================================ */
const SW = 30

export const TEXT_SWATCHES: TextStylePreset[] = [
  // —— 纯色 / 描边 ——
  { id: 'sw-white', name: '纯白', thumb: 'T', content: '默认文本', fs: SW, color: '#f5f5f5' },
  { id: 'sw-white-black', name: '白字黑边', thumb: 'T', content: '默认文本', fs: SW, color: '#ffffff', stroke: { color: '#0a0a0a', width: 3.4 } },
  { id: 'sw-yellow-black', name: '黄字黑边', thumb: 'T', content: '默认文本', fs: SW, color: '#ffd400', stroke: { color: '#0a0a0a', width: 3.4 } },
  { id: 'sw-white-red', name: '白字红边', thumb: 'T', content: '默认文本', fs: SW, color: '#ffffff', stroke: { color: '#ff2b2b', width: 2.2 } },
  { id: 'sw-sky-black', name: '天字黑边', thumb: 'T', content: '默认文本', fs: SW, color: '#aed9ff', stroke: { color: '#0a0a0a', width: 3 } },
  { id: 'sw-candy', name: '糖果粉', thumb: 'T', content: '默认文本', fs: SW, color: '#ff7eb3' },
  { id: 'sw-cyan-blue', name: '青字蓝边', thumb: 'T', content: '默认文本', fs: SW, color: '#54d6ff', stroke: { color: '#1f7fd6', width: 2.4 } },
  { id: 'sw-olive', name: '柠绿', thumb: 'T', content: '默认文本', fs: SW, color: '#c8d64a' },
  { id: 'sw-steel', name: '雾蓝灰边', thumb: 'T', content: '默认文本', fs: SW, color: '#8fc4d6', stroke: { color: '#36525c', width: 2.4 } },
  { id: 'sw-red-white', name: '红字白边', thumb: 'T', content: '默认文本', fs: SW, color: '#ff2424', stroke: { color: '#ffffff', width: 2.6 } },
  { id: 'sw-brown-white', name: '棕字白边', thumb: 'T', content: '默认文本', fs: SW, color: '#b5562f', stroke: { color: '#ffffff', width: 2.6 } },
  { id: 'sw-cream', name: '奶油米', thumb: 'T', content: '默认文本', fs: SW, color: '#f3e3b3' },
  { id: 'sw-salmon', name: '西柚粉', thumb: 'T', content: '默认文本', fs: SW, color: '#f3a89c' },

  // —— 底色底板（瓦片整块铺色，入轨为文字后圆角底板） ——
  { id: 'sw-plate-black', name: '黑底白字', thumb: 'T', content: '默认文本', fs: SW, color: '#ffffff', tileBg: '#0c0c0c', plate: { color: '#0c0c0c', radius: 14 } },
  { id: 'sw-plate-white', name: '白底黑字', thumb: 'T', content: '默认文本', fs: SW, color: '#141414', tileBg: '#f2f2f2', plate: { color: '#f2f2f2', radius: 14 } },
  { id: 'sw-plate-yellow', name: '黄底黑字', thumb: 'T', content: '默认文本', fs: SW, color: '#141414', tileBg: '#ffd400', plate: { color: '#ffd400', radius: 14 } },
  { id: 'sw-plate-rose', name: '红底白字', thumb: 'T', content: '默认文本', fs: SW, color: '#ffffff', tileBg: '#cf4d5c', plate: { color: '#cf4d5c', radius: 14 } },
  { id: 'sw-plate-mint', name: '黑底薄荷', thumb: 'T', content: '默认文本', fs: SW, color: '#3ee8a0', tileBg: '#0c0c0c', plate: { color: '#0c0c0c', radius: 14 } },

  // —— 硬投影 ——
  { id: 'sw-shadow-blue', name: '白字蓝影', thumb: 'T', content: '默认文本', fs: SW, color: '#f5f5f5', shadows: [{ color: '#2b7fff', blur: 0, dx: 3, dy: 4 }] },
  { id: 'sw-shadow-pink', name: '白字粉影', thumb: 'T', content: '默认文本', fs: SW, color: '#f5f5f5', shadows: [{ color: '#ff2e93', blur: 0, dx: 3, dy: 4 }] },
  { id: 'sw-shadow-brown', name: '米字棕影', thumb: 'T', content: '默认文本', fs: SW, color: '#f3e3b3', shadows: [{ color: '#7a4a22', blur: 0, dx: 3, dy: 4 }] },
  { id: 'sw-shadow-red', name: '橙字红影', thumb: 'T', content: '默认文本', fs: SW, color: '#ffb300', shadows: [{ color: '#d81e1e', blur: 0, dx: 3, dy: 4 }] },
  { id: 'sw-shadow-green', name: '黑字绿影', thumb: 'T', content: '默认文本', fs: SW, color: '#141414', shadows: [{ color: '#00e676', blur: 0, dx: 3, dy: 4 }] }
]

/* ============================================================
 *  花字效果（多层发光 / 粗描边 / 立体投影；全系统粗体，不用 web 字体）
 * ============================================================ */
const FX = 26

export const TEXT_FX_PRESETS: TextStylePreset[] = [
  {
    id: 'fx-show', name: '高能时刻', sub: '白字粉边', thumb: '高能时刻', content: '高能时刻', fs: FX,
    bold: true, color: '#ffffff',
    stroke: { color: '#d6285a', width: 4 },
    shadows: [{ color: '#d6285a', opacity: 0.45, blur: 0, dx: 3, dy: 3 }]
  },
  {
    id: 'fx-neon', name: '霓虹之夜', sub: '多层冷光', thumb: '霓虹之夜', content: '霓虹之夜', fs: FX,
    bold: true, color: '#e9f6ff',
    shadows: [
      { color: '#ffffff', blur: 4, dx: 0, dy: 0 },
      { color: '#27d4ff', blur: 10, dx: 0, dy: 0 },
      { color: '#27d4ff', blur: 20, dx: 0, dy: 0 },
      { color: '#0a6cff', blur: 34, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-cyber', name: '赛博朋克', sub: '青紫双辉', thumb: '赛博朋克', content: '赛博朋克', fs: FX,
    bold: true, color: '#ffffff',
    shadows: [
      { color: '#ffffff', blur: 3, dx: 0, dy: 0 },
      { color: '#27d4ff', blur: 10, dx: 0, dy: 0 },
      { color: '#ff2bd6', blur: 13, dx: 3, dy: 3 },
      { color: '#5b0f8c', blur: 26, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-sticker', name: '潮酷贴纸', sub: '粗黑描边', thumb: '潮酷文字', content: '潮酷文字', fs: FX,
    bold: true, color: '#ffffff',
    stroke: { color: '#111111', width: 5 },
    shadows: [{ color: '#000000', opacity: 0.35, blur: 1, dx: 3, dy: 4 }]
  },
  {
    id: 'fx-gold', name: '鎏金岁月', sub: '暖金投影', thumb: '鎏金岁月', content: '鎏金岁月', fs: FX,
    bold: true, color: '#ffd166',
    shadows: [
      { color: '#7a4a00', blur: 2, dx: 2, dy: 3 },
      { color: '#3a2400', opacity: 0.5, blur: 6, dx: 3, dy: 6 }
    ]
  },
  {
    id: 'fx-purple', name: '紫电幻光', sub: '紫色辉光', thumb: '紫电幻光', content: '紫电幻光', fs: FX,
    bold: true, color: '#f3e8ff',
    shadows: [
      { color: '#ffffff', blur: 3, dx: 0, dy: 0 },
      { color: '#c084fc', blur: 10, dx: 0, dy: 0 },
      { color: '#a855f7', blur: 22, dx: 0, dy: 0 },
      { color: '#6d28d9', blur: 36, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-fire', name: '热血燃橙', sub: '橙红热浪', thumb: '热血燃橙', content: '热血燃橙', fs: FX,
    bold: true, color: '#ffd27a',
    shadows: [
      { color: '#ff7a00', blur: 6, dx: 0, dy: 0 },
      { color: '#ff3d00', blur: 16, dx: 0, dy: 0 },
      { color: '#b31d00', blur: 30, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-mint', name: '薄荷夏夜', sub: '荧光绿', thumb: '薄荷夏夜', content: '薄荷夏夜', fs: FX,
    bold: true, color: '#a6ffcb',
    shadows: [
      { color: '#00e676', blur: 8, dx: 0, dy: 0 },
      { color: '#00b35f', blur: 20, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-ocean', name: '夏日海风', sub: '海盐清蓝', thumb: '夏日海风', content: '夏日海风', fs: FX,
    color: '#7ee8fa',
    shadows: [
      { color: '#1ea0c8', opacity: 0.5, blur: 8, dx: 0, dy: 2 },
      { color: '#0b6c8c', opacity: 0.6, blur: 18, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-magazine', name: '时尚周刊', sub: '宽字距投影', thumb: '时尚周刊', content: '时尚周刊', fs: FX,
    bold: true, color: '#f2f2f2', letterSpacing: 2.5,
    shadows: [{ color: '#000000', opacity: 0.5, blur: 10, dx: 0, dy: 2 }]
  },
  {
    id: 'fx-sweet', name: '甜蜜暴击', sub: '糖果粉', thumb: '甜蜜暴击', content: '甜蜜暴击', fs: FX,
    color: '#ff9ed2',
    shadows: [
      { color: '#781e50', opacity: 0.35, blur: 2, dx: 0, dy: 2 },
      { color: '#ff5fb0', blur: 8, dx: 0, dy: 0 }
    ]
  },
  {
    id: 'fx-pop3d', name: '立体潮字', sub: '蓝色立体', thumb: '立体潮字', content: '立体潮字', fs: FX,
    bold: true, color: '#ffffff',
    shadows: [
      { color: '#2b7fff', blur: 0, dx: 3, dy: 4 },
      { color: '#1f5fd6', blur: 0, dx: 6, dy: 8 }
    ]
  }
]
