import { en } from './en'
import { zh } from './zh'
import type { Lang } from './types'

export type { Lang } from './types'
export { zh } from './zh'
export { en } from './en'

export const LANG_STORAGE_KEY = 'cut-container:lang'

const isLang = (v: unknown): v is Lang => v === 'zh' || v === 'en'

/** 当前语言（localStorage 优先，默认中文） */
export function getLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY)
    if (isLang(stored)) return stored
  } catch {
    /* file:// / 隐私模式可能禁用 localStorage */
  }
  return 'zh'
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
}

/** 编辑器挂载时解析语言：props.lang > 全局设置 */
export function resolveLang(explicit?: unknown): Lang {
  return isLang(explicit) ? explicit : getLang()
}

/** 供程序化提示使用（DOM 文案由 installDomI18n 自动替换） */
export function t(key: keyof typeof zh, lang: Lang = getLang()): string {
  return lang === 'en' ? en[key] : zh[key]
}

/** 整句翻译（供数据层生成英文预览 / 片段名；找不到时原样返回） */
export function tr(text: string, lang: Lang = getLang()): string {
  return lang === 'en' ? translatePhrase(text) ?? text : text
}

// 中文源文 → 英文译文（同一句中文在多处出现时共用一条译文）
const enByZh = new Map<string, string>()
for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
  const source = zh[key]
  if (!enByZh.has(source)) enByZh.set(source, en[key])
}

/** 带变量的动态文案（toast / 状态行） */
const dynamicRules: Array<[RegExp, string]> = [
  [/^已导入 (\d+) 个素材$/, 'Imported $1 media item(s)'],
  [/^已上传 (\d+) 个音频$/, 'Uploaded $1 audio item(s)'],
  [/^已上传 (\d+) 个字幕$/, 'Uploaded $1 subtitle file(s)'],
  [/^已添加 (\d+) 条字幕$/, 'Added $1 subtitle(s)'],
  [/^已添加 (\d+) 个音频$/, 'Added $1 audio item(s)'],
  [/^已添加 (\d+) 个素材$/, 'Added $1 media item(s)'],
  [/^(.+) 行 · 服务端$/, '$1 lines · Server'],
  [/^(.+) 行 · 本地上传$/, '$1 lines · Local upload'],
  [/^已添加字体：(.+)$/, 'Font added: $1'],
  [/^已添加「默认文本」$/, 'Added "Default text"'],
  [/^已添加「(.+)」$/, 'Added "$1"'],
  [/^已添加文本（(.+)）$/, 'Added text ($1)'],
  [/^(\d+) 种样式 · 字体\/颜色\/描边$/, '$1 styles · font/color/stroke'],
  [/^(\d+) 条 · 纯文本时间轴$/, '$1 items · plain-text timeline'],
  [/^正在渲染画面… (\d+)%$/, 'Rendering… $1%'],
  [/^正在导出视频$/, 'Exporting video'],
  [/^正在封装 MP4…$/, 'Packaging MP4…'],
  [/^正在混合音轨…$/, 'Mixing audio…'],
  [/^正在提取音轨…$/, 'Extracting audio…'],
  [/^正在预览 · (视频|图片|动图|音频|文本|字体) (.+)$/, 'Previewing · $1 $2']
]

const previewKindEn: Record<string, string> = {
  视频: 'Video',
  图片: 'Image',
  动图: 'GIF',
  音频: 'Audio',
  文本: 'Text',
  字体: 'Font'
}

function translatePhrase(text: string): string | null {
  const exact = enByZh.get(text)
  if (exact) return exact
  for (const [re, replacement] of dynamicRules) {
    const m = text.match(re)
    if (!m) continue
    if (re.source.includes('正在预览')) {
      const kind = previewKindEn[m[1]] ?? m[1]
      return `Previewing · ${kind} ${m[2]}`
    }
    return text.replace(re, replacement)
  }
  // 画质按钮 title =「完整名（说明）」
  const paren = text.match(/^(.+)（(.+)）$/)
  if (paren) {
    const head = translatePhrase(paren[1]) ?? paren[1]
    const tail = translatePhrase(paren[2]) ?? paren[2]
    return `${head} (${tail})`
  }
  return null
}

/** 这些容器里是用户内容 / 数值，不做翻译 */
const SKIP_SELECTOR = [
  '[data-no-i18n]',
  '.ed-clip-name',
  '.ed-cap-text',
  '.ed-draft-name',
  '.ed-tl-clip-name',
  '.ed-text-preset-name',
  'script',
  'style'
].join(',')

function shouldSkip(el: Element | null): boolean {
  return !!el?.closest(SKIP_SELECTOR)
}

const TRANSLATABLE_ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt']

function translateTextNode(node: Text): void {
  const value = node.nodeValue
  if (!value || !/[\u4e00-\u9fff]/.test(value)) return
  const parent = node.parentElement
  if (shouldSkip(parent)) return
  const core = value.trim()
  if (!core) return
  const translated = translatePhrase(core)
  if (!translated || translated === core) return
  const start = value.indexOf(core)
  node.nodeValue = `${value.slice(0, start)}${translated}${value.slice(start + core.length)}`
}

function translateAttributes(el: Element): void {
  if (shouldSkip(el)) return
  for (const attr of TRANSLATABLE_ATTRS) {
    const value = el.getAttribute(attr)
    if (!value || !/[\u4e00-\u9fff]/.test(value)) continue
    const core = value.trim()
    const translated = translatePhrase(core)
    if (translated && translated !== core) {
      const start = value.indexOf(core)
      el.setAttribute(attr, `${value.slice(0, start)}${translated}${value.slice(start + core.length)}`)
    }
  }
}

function translateTree(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node as Text)
    return
  }
  if (node.nodeType === Node.ELEMENT_NODE) translateAttributes(node as Element)
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text)
    else translateAttributes(current as Element)
    current = walker.nextNode()
  }
}

/**
 * 在编辑器的 Shadow DOM 根节点上安装中→英文案替换。
 * - 只监听英文模式；中文模式直接返回空清理函数；
 * - 组件仍是中文源码，面板重渲染 / 弹窗 / toast 新增节点由 MutationObserver 自动翻译；
 * - 返回清理函数（编辑器 destroy 时调用）。
 */
export function installDomI18n(root: HTMLElement | ShadowRoot, lang: Lang): () => void {
  if (lang !== 'en') return () => {}
  translateTree(root)

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        translateTextNode(m.target as Text)
      } else if (m.type === 'attributes') {
        translateAttributes(m.target as Element)
      } else {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text)
          else if (node.nodeType === Node.ELEMENT_NODE) translateTree(node)
        })
      }
    }
  })
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRS
  })
  return () => observer.disconnect()
}
