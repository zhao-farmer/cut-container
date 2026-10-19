/* ============================================================
 *  编辑器 · 后端素材目录合并
 *
 *  把 imitate-node 返回的目录条目（BackendItem）并入编辑器现用的
 *  MaterialsData：按类型分组、插到列表最前、按 url / id 去重；
 *  字体条目单独返回（由 customFonts 注册 FontFace 后进入字体下拉）。
 * ============================================================ */
import type {
  AudioItem,
  CaptionItem,
  ComingSoonItem,
  FilterItem,
  MaterialsData,
  MaterialItem,
  StickerItem
} from '../types'
import type { BackendItem } from './backend'

export interface RemoteFontItem {
  id: string
  name: string
  url: string
  /** 注册 FontFace 用的族名（后端目录可指定，默认由 id 生成） */
  family?: string
}

export interface CatalogMergeResult {
  /** 新并入的条目数（0 表示目录全部已存在） */
  added: number
  /** 远端字体（交给 customFonts 注册） */
  fonts: RemoteFontItem[]
}

/** 目录合并可选参数：skipIds＝用户已删除的素材 id（避免刷新后被后端目录重新加回） */
export interface CatalogMergeOptions {
  skipIds?: Set<string>
}

/** 把后端目录合并进素材数据（就地修改并返回统计） */
export function mergeCatalogIntoMaterials(
  data: MaterialsData,
  items: BackendItem[],
  opts: CatalogMergeOptions = {}
): CatalogMergeResult {
  const fonts: RemoteFontItem[] = []
  const skipIds = opts.skipIds
  let added = 0

  const addWithUrl = <T extends { url: string }>(list: T[], item: T): void => {
    if (list.some(x => x.url === item.url)) return
    list.unshift(item)
    added++
  }
  const addComingSoon = (list: ComingSoonItem[], item: ComingSoonItem): void => {
    if (list.some(x => x.id === item.id || x.name === item.name)) return
    list.unshift(item)
    added++
  }

  for (const it of items) {
    if (skipIds && it.id && skipIds.has(it.id)) continue
    const kind = String(it.kind || '').toLowerCase()
    if (!it.url && !it.thumb && kind !== 'effect' && kind !== 'transition') continue
    switch (kind) {
      case 'video':
      case 'image':
      case 'gif': {
        const material: MaterialItem = {
          id: it.id || `be-${kind}-${it.url}`,
          name: it.name || '未命名素材',
          kind: kind as MaterialItem['kind'],
          url: it.url,
          source: 'remote_file',
          remote_file: it.url,
          duration: it.duration,
          width: it.width,
          height: it.height,
          sub: it.sub || '服务端'
        }
        addWithUrl(data.material, material)
        break
      }
      case 'audio': {
        const audio: AudioItem = {
          id: it.id || `be-audio-${it.url}`,
          // 音频面板展示名称不带后缀（与本地音频上传一致）
          name: (it.name || '未命名音频').replace(/\.[^.]+$/, ''),
          type: it.type === 'sfx' ? 'sfx' : 'music',
          url: it.url,
          duration: it.duration,
          sub: it.sub || '服务端'
        }
        addWithUrl(data.audio, audio)
        break
      }
      case 'subtitle': {
        const caption: CaptionItem = {
          id: it.id || `be-cap-${it.url}`,
          name: it.name || '未命名字幕',
          format: it.format === 'ass' ? 'ass' : 'srt',
          url: it.url,
          sub: it.sub || '服务端'
        }
        addWithUrl(data.caption, caption)
        break
      }
      case 'sticker': {
        const sticker: StickerItem = {
          id: it.id || `be-sticker-${it.url}`,
          name: it.name || '未命名贴纸',
          url: it.url,
          sub: it.sub || '服务端'
        }
        addWithUrl(data.sticker, sticker)
        break
      }
      case 'filter': {
        const thumb = it.thumb || it.url
        if (!thumb) break
        if (data.filter.some(x => x.thumb === thumb)) break
        const filter: FilterItem = {
          id: it.id || `be-filter-${thumb}`,
          name: it.name || '未命名滤镜',
          thumb,
          filter: (it.filter || 'none') as FilterItem['filter']
        }
        data.filter.unshift(filter)
        added++
        break
      }
      case 'effect':
        addComingSoon(data.effect, { id: it.id || `be-effect-${it.name}`, name: it.name || '未命名特效', comingSoon: true })
        break
      case 'transition':
        addComingSoon(data.transition, {
          id: it.id || `be-transition-${it.name}`,
          name: it.name || '未命名转场',
          comingSoon: true
        })
        break
      case 'font':
        if (it.url) {
          fonts.push({
            id: it.id || `be-font-${it.url}`,
            name: it.name || '远端字体',
            url: it.url,
            family: it.family
          })
        }
        break
      default:
        break
    }
  }

  return { added, fonts }
}
