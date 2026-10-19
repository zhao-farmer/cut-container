/* ============================================================
 *  字幕文件解析（codec）：.srt / .ass → 统一的对白区间 CaptionCue[]
 *  - srt：序号行 + 00:00:01,234 --> 00:00:03,500 + 文本行（空行分块）
 *  - ass：[V4+ Styles] 样式（字体 / 字号 / 主色 / 描边色 / 粗细）+
 *    [Events] 段 Dialogue 行；时间 H:MM:SS.cc（厘秒），
 *    Text 为最后一个逗号后的全部内容；剥离 {\...} 覆写标签、\N/\h。
 *    每条 cue 按其 Style 名挂上 CaptionCueStyle（颜色为入轨后直接可用的
 *    逻辑画布口径：字号 / 描边宽需经 layoutAssCues 按目标画布换算）。
 * ============================================================ */
import { LOGICAL_SHORT_SIDE } from '../transform'
import type { CaptionCue, CaptionCueStyle, CaptionFormat } from '../types'

/** 00:00:01,234（srt，毫秒逗号）或 00:00:01.23（ass，厘秒点号）→ 秒 */
function parseTimestamp(raw: string): number {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(raw.trim())
  if (!m) return 0
  const [, h, mm, ss, frac] = m
  const rest = frac.padEnd(3, '0')
  return (+h) * 3600 + (+mm) * 60 + (+ss) + parseInt(rest, 10) / 1000
}

/** 清理字幕展示文本：去 ass 覆写标签 / 换行占位 / HTML 实体残留，折叠空白 */
function cleanText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // {\an8} {\pos(...)} 等
    .replace(/\\N/gi, ' ')
    .replace(/\\h/gi, ' ')
    .replace(/<[^>]+>/g, '') // srt 里偶发的 <i>/<b>
    .replace(/\r?\n+/g, ' ')
    .trim()
}

/** &HAABBGGRR / &HBBGGRR → #RRGGBB（忽略 alpha 通道，透明度另行解析） */
export function assColorToHex(raw: string): string {
  const hex = raw.replace('&H', '').replace('&', '').trim()
  const six = hex.slice(-6).padStart(6, '0')
  const bb = six.slice(0, 2)
  const gg = six.slice(2, 4)
  const rr = six.slice(4, 6)
  return `#${rr}${gg}${bb}`
}

/** &HAABBGGRR 的 alpha 字节 → 不透明度 0..1（ASS 里 00＝完全不透明） */
function assAlpha(raw: string): number {
  const hex = raw.replace('&H', '').replace('&', '').trim()
  if (hex.length < 8) return 1
  const aa = parseInt(hex.slice(0, 2), 16)
  if (!Number.isFinite(aa)) return 1
  return Math.min(1, Math.max(0, 1 - aa / 255))
}

/** ass 样式表中的一行样式（字号 / 描边宽保持脚本原始像素，换算由调用方做） */
export interface AssStyleInfo {
  name: string
  font: string
  /** 脚本像素字号（相对 PlayRes） */
  size: number
  primary: string
  primaryAlpha: number
  outline: string
  outlineAlpha: number
  bold: boolean
  italic: boolean
  /** 描边宽度（脚本像素） */
  outlineWidth: number
  /** 对齐方式（numpad 1-9，缺省 2 底部居中） */
  alignment: number
}

export interface AssEvent {
  start: number
  end: number
  style: string
  text: string
}

export interface AssDocument {
  playResX: number
  playResY: number
  styles: Map<string, AssStyleInfo>
  events: AssEvent[]
}

const DEFAULT_ASS_STYLE: AssStyleInfo = {
  name: 'Default',
  font: 'Microsoft YaHei',
  size: 42,
  primary: '#ffffff',
  primaryAlpha: 1,
  outline: '#000000',
  outlineAlpha: 0.55,
  bold: false,
  italic: false,
  outlineWidth: 2,
  alignment: 2
}

/** 完整解析 ass：脚本头分辨率 + 样式表 + 对白事件 */
export function parseAssDoc(raw: string): AssDocument {
  const doc: AssDocument = {
    playResX: 0,
    playResY: 0,
    styles: new Map<string, AssStyleInfo>(),
    events: []
  }
  let section = ''
  let styleFmt: string[] = []
  let eventFmt: string[] = []
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const l = line.trim()
    if (l.startsWith('[')) {
      section = l
      continue
    }
    if (!l || l.startsWith(';')) continue
    if (section === '[Script Info]') {
      const pm = /^PlayRes(X|Y):\s*(\d+)/i.exec(l)
      if (pm) {
        if (pm[1].toUpperCase() === 'X') doc.playResX = +pm[2]
        else doc.playResY = +pm[2]
      }
      continue
    }
    if (section === '[V4+ Styles]' || section === '[V4 Styles]') {
      if (l.startsWith('Format:')) {
        styleFmt = l.slice(7).split(',').map(s => s.trim().toLowerCase())
      } else if (l.startsWith('Style:')) {
        const p = l.slice(6).split(',').map(s => s.trim())
        const get = (key: string) => p[styleFmt.indexOf(key)] ?? ''
        const st: AssStyleInfo = {
          name: p[0] || `Style${doc.styles.size + 1}`,
          font: get('fontname') || DEFAULT_ASS_STYLE.font,
          size: parseInt(get('fontsize'), 10) || DEFAULT_ASS_STYLE.size,
          primary: assColorToHex(get('primarycolour') || '&H00FFFFFF'),
          primaryAlpha: assAlpha(get('primarycolour') || '&H00FFFFFF'),
          outline: assColorToHex(get('outlinecolour') || '&H00202020'),
          outlineAlpha: assAlpha(get('outlinecolour') || '&H00000000'),
          bold: get('bold') === '-1' || get('bold') === '1',
          italic: get('italic') === '-1' || get('italic') === '1',
          outlineWidth: Math.max(0, parseFloat(get('outline')) || 0),
          alignment: parseInt(get('alignment'), 10) || 2
        }
        doc.styles.set(st.name, st)
      }
    } else if (section === '[Events]') {
      if (l.startsWith('Format:')) {
        eventFmt = l.slice(7).split(',').map(s => s.trim().toLowerCase())
      } else if (l.startsWith('Dialogue:') && eventFmt.length) {
        const p = l.slice(9).split(',')
        const get = (key: string) => (p[eventFmt.indexOf(key)] ?? '').trim()
        const ti = eventFmt.indexOf('text')
        const text = cleanText(p.slice(ti).join(','))
        if (!text) continue
        const start = parseTimestamp(get('start'))
        const end = parseTimestamp(get('end'))
        if (end <= start) continue
        doc.events.push({ start, end, style: get('style'), text })
      }
    }
  }
  return doc
}

/**
 * ass 文档 → CaptionCue[]，每条 cue 挂样式。
 * targetW/targetH 为逻辑画布尺寸（短边 1080 口径）：ass 脚本通常按
 * PlayRes（如 960×540）创作，竖屏工程按宽高比取较小缩放比（contain）
 * 换算字号 / 描边宽，保证字幕视觉占比与脚本一致。
 */
export function cuesFromAssDoc(doc: AssDocument, targetW?: number, targetH?: number): CaptionCue[] {
  const sx = doc.playResX > 0 && targetW ? targetW / doc.playResX : 1
  const sy = doc.playResY > 0 && targetH ? targetH / doc.playResY : 1
  const scale = doc.playResX > 0 && doc.playResY > 0 && targetW && targetH ? Math.min(sx, sy) : 1
  const cues: CaptionCue[] = []
  for (const ev of doc.events) {
    const st = doc.styles.get(ev.style) ?? DEFAULT_ASS_STYLE
    const style: CaptionCueStyle = {
      color: st.primary,
      fontSize: Math.round(st.size * scale),
      fontFamily: st.font,
      bold: st.bold,
      italic: st.italic
    }
    if (st.outlineWidth > 0) {
      style.stroke = {
        color: st.outline,
        width: Math.max(1, Math.round(st.outlineWidth * scale)),
        opacity: st.outlineAlpha
      }
    }
    cues.push({ start: ev.start, end: ev.end, text: ev.text, style })
  }
  return cues
}

export function parseSrt(raw: string): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (const block of raw.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) continue
    // 首行可能是序号
    const tlIdx = lines.findIndex(l => l.includes('-->'))
    if (tlIdx < 0) continue
    const tm = /(\S+)\s*-->\s*(\S+)/.exec(lines[tlIdx])
    if (!tm) continue
    const text = cleanText(lines.slice(tlIdx + 1).join(' '))
    if (!text) continue
    const start = parseTimestamp(tm[1])
    const end = parseTimestamp(tm[2])
    if (end <= start) continue
    cues.push({ start, end, text })
  }
  return cues
}

/** ass 原文 → cue（不给目标画布时字号保持脚本像素，仅供预览等非入轨场景） */
export function parseAss(raw: string): CaptionCue[] {
  return cuesFromAssDoc(parseAssDoc(raw))
}

/**
 * 按格式解析字幕原文；未知格式返回空数组（调用方回退单片段）。
 * ratio 为工程画布宽高比（竖屏 9/16）：ass 字号 / 描边换算到逻辑画布。
 */
export function parseCaption(format: CaptionFormat, raw: string, ratio = 16 / 9): CaptionCue[] {
  try {
    if (format !== 'ass') return parseSrt(raw)
    const target =
      ratio >= 1
        ? { w: Math.round(LOGICAL_SHORT_SIDE * ratio), h: LOGICAL_SHORT_SIDE }
        : { w: LOGICAL_SHORT_SIDE, h: Math.round(LOGICAL_SHORT_SIDE / ratio) }
    return cuesFromAssDoc(parseAssDoc(raw), target.w, target.h)
  } catch {
    return []
  }
}
