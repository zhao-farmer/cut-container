/* ============================================================
 *  编辑器 · 用户上传字体
 *
 *  - 上传的字体用 FontFace 注册进 document.fonts，家族名用 ASCII
 *    前缀 cutfont-<id>（避免中文 / 空格等字体族名在 SVG font-family
 *    属性里出问题），下拉里显示原始文件名；
 *  - 字体列表按「最后上传的在最前」排序，渲染时插到系统字体之前；
 *  - 与素材上传（blob: 会话内有效）保持同一语义：未配置后端时仅当前会话
 *    有效，刷新页面后需要重新上传；
 *  - 配置了后端（public/app-config.json 的 backend.enabled=true）时，字体
 *    文件上传到 imitate-node，并用服务端地址注册 FontFace；下次启动会从
 *    后端素材目录自动恢复（见 addRemoteFonts）。
 * ============================================================ */
import { uploadAsset } from '../services/backend'

export interface CustomFont {
  /** 会话内唯一 id */
  id: string
  /** 展示名（取文件名去掉扩展名） */
  name: string
  /** 注册到 document.fonts 的字体族名（ASCII，安全用于 CSS / SVG） */
  family: string
  /** 后端地址（配置了后端时存在，可用于跨会话恢复） */
  remoteUrl?: string
}

/** 已上传字体（新的在前，直接作为下拉最前方的选项） */
const customFonts: CustomFont[] = []

/** 支持的字体文件扩展名 / MIME */
const FONT_EXT_RE = /\.(ttf|otf|woff2?|eot)$/i

/** 当前会话内已上传的字体（新 → 旧） */
export function listCustomFonts(): CustomFont[] {
  return customFonts.slice()
}

/** 上传字体：解析失败抛错（调用方负责提示），同一文件名只保留一份 */
export async function addCustomFont(file: File): Promise<CustomFont> {
  if (!FONT_EXT_RE.test(file.name) && !/^font\//i.test(file.type)) {
    throw new Error('仅支持 ttf / otf / woff / woff2 字体文件')
  }
  const name = file.name.replace(/\.[^.]+$/, '').trim() || '上传字体'
  const existed = customFonts.find(f => f.name === name)
  if (existed) return existed

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const family = `cutfont-${id}`

  // 后端启用时先上传，成功则直接用服务端地址注册（可跨会话恢复）
  const remote = await uploadAsset(file, 'font')
  let face: FontFace | null = null
  if (remote) {
    try {
      face = new FontFace(family, `url("${remote.url}")`)
      await face.load()
    } catch {
      face = null
    }
  }

  // 未配置后端 / 后端注册失败：退回本地二进制注册（会话内有效）
  if (!face) {
    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      throw new Error('字体文件读取失败')
    }
    try {
      face = new FontFace(family, buffer)
      await face.load()
    } catch {
      throw new Error('字体解析失败，请确认文件完整且格式受支持')
    }
  }
  document.fonts.add(face)

  const font: CustomFont = { id, name, family, ...(remote ? { remoteUrl: remote.url } : {}) }
  customFonts.unshift(font)
  return font
}

/**
 * 注册后端素材目录中的字体（编辑器启动时调用）：成功注册后进入字体下拉最前方。
 * 地址不可用 / 字体损坏时静默跳过，不影响本地字体。
 */
export async function addRemoteFonts(
  items: { id: string; name: string; url: string; family?: string }[]
): Promise<number> {
  let added = 0
  for (const it of items) {
    if (!it?.url) continue
    if (customFonts.some(f => f.remoteUrl === it.url || f.name === it.name)) continue
    const safeId =
      String(it.id || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 40) || `${Date.now().toString(36)}${added}`
    // 目录可显式指定族名（让 CSS / 预设里写死的 font-family 直接命中），否则用 ASCII 前缀
    const family = (it.family || '').trim() || `cutfont-${safeId}`
    if (customFonts.some(f => f.family === family)) continue
    try {
      const face = new FontFace(family, `url("${it.url}")`)
      await face.load()
      document.fonts.add(face)
      customFonts.unshift({
        id: safeId,
        name: (it.name || '远端字体').replace(/\.[^.]+$/, ''),
        family,
        remoteUrl: it.url
      })
      added++
    } catch {
      /* 字体不可用：跳过 */
    }
  }
  return added
}
