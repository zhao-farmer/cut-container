/* ============================================================
 *  素材库 · 面板一：素材（视频 / 图片 / 动图）
 *  唯一上传入口：顶部「导入」按钮（可多选本地视频 / 图片 / 动图）。
 *  卡片固定宽度，面板拉伸时自动换行；hover 右下角浮现 ＋，
 *  点击加入时间轴（视频入视频轨，图片 / 动图入画中画轨）。
 *  点击卡片本身：视频载入播放器，图片 / 动图灯箱放大。
 * ============================================================ */
import { fmtTime } from '../../utils/time'
import type { MaterialItem } from '../../types'
import type { PanelCtx } from '../materialsPanel'
import type { AnyAddTrackPayload } from '../materialsPanel'
import { extOfFile, filesToMaterials } from './upload'
import { probeGifMeta } from '../../codec/timelineMedia'
import { MATERIAL_MIME, setDragPayload, clearDragPayload, beginDragGhost, endDragGhost, transparentDragImage } from '../dragPayload'

/** 静态图片入轨的默认停留时长（秒，对齐参考分镜轨道） */
const IMAGE_CLIP_DURATION = 5

/**
 * 视频卡片元素缓存：切换素材 tab 时面板 DOM 会重建，
 * 但 <video> 节点复用后不会重新请求 / 解析元数据，避免反复加载视频。
 * key = materialId|url（URL 变化时重新建元素）。
 */
const videoCache = new Map<string, HTMLVideoElement>()

function videoKey(m: MaterialItem): string {
  return `${m.id}|${m.url}`
}

function createCachedVideo(m: MaterialItem): HTMLVideoElement {
  const key = videoKey(m)
  const cached = videoCache.get(key)
  if (cached) return cached
  const v = document.createElement('video')
  v.className = 'ed-clip-media'
  v.muted = true
  v.playsInline = true
  v.preload = 'metadata'
  v.crossOrigin = 'anonymous'
  v.src = m.url.includes('#') ? m.url : `${m.url}#t=0.5`
  // 部分视频（如 bunny.mp4）开头是黑场，元数据就绪后跳到前 1/4 与 2s 的较小值取封面帧
  v.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(v.duration) && v.duration > 2) v.currentTime = Math.min(2, v.duration * 0.25)
  })
  videoCache.set(key, v)
  return v
}

function releaseCachedVideo(m: MaterialItem): void {
  const key = videoKey(m)
  const v = videoCache.get(key)
  if (!v) return
  v.pause()
  v.removeAttribute('src')
  v.load()
  videoCache.delete(key)
}

/** 素材删除后同步释放；编辑器销毁时清空全部缓存 */
export function pruneMaterialVideoCache(ids: Set<string>): void {
  for (const [key, v] of videoCache) {
    const id = key.slice(0, key.indexOf('|'))
    if (ids.has(id)) continue
    v.pause()
    v.removeAttribute('src')
    v.load()
    videoCache.delete(key)
  }
}

export function clearMaterialVideoCache(): void {
  for (const v of videoCache.values()) {
    v.pause()
    v.removeAttribute('src')
    v.load()
  }
  videoCache.clear()
}

/**
 * 同步构造素材的入轨载荷（拖拽 dragstart 不能等待异步 GIF 探测，
 * 未带时长的 GIF 先用 5s 兜底；＋按钮路径仍会在点击时懒解析真实时长）。
 */
function payloadOfMaterial(m: MaterialItem): AnyAddTrackPayload {
  const format = extOfFile(m.url) || (m.kind === 'video' ? 'mp4' : 'image')
  if (m.kind === 'video') {
    return {
      type: 'video',
      name: m.name,
      duration: m.duration || 5,
      materialId: m.id,
      source: { url: m.url, name: m.name, format, duration: m.duration || 5, width: m.width ?? 0, height: m.height ?? 0 }
    }
  }
  const duration = m.kind === 'gif' ? m.duration || IMAGE_CLIP_DURATION : IMAGE_CLIP_DURATION
  return {
    type: 'image',
    name: m.name,
    duration,
    materialId: m.id,
    source: { url: m.url, name: m.name, format, duration, width: m.width ?? 0, height: m.height ?? 0 }
  }
}

export function renderMaterialPanel(ctx: PanelCtx): void {
  const { panel, data, esc, hint, toast, pickFiles, commit, addTrack, selectedId, onSelect, showItemMenu, renameItem, deleteItem } = ctx
  let keyword = ''

  const bar = document.createElement('div')
  bar.className = 'ed-subbar'
  bar.innerHTML = `<button type="button" class="ed-mini-btn ed-import-btn">导入</button><input class="ed-search" placeholder="搜索文件名" />`
  panel.appendChild(bar)
  const input = bar.querySelector<HTMLInputElement>('.ed-search')!
  const importBtn = bar.querySelector<HTMLButtonElement>('.ed-import-btn')!

  // 导入：素材面板唯一的本地上传入口（可多选）
  importBtn.addEventListener('click', async () => {
    const files = await pickFiles('video/*,image/*', true)
    if (files.length === 0) return
    importBtn.disabled = true
    try {
      const items = await filesToMaterials(files)
      data.material.push(...items)
      commit()
      renderGrid()
      toast(`已导入 ${items.length} 个素材`)
    } catch (err) {
      console.warn('[editor/materials] 素材导入失败:', err)
      toast('素材导入失败')
    } finally {
      importBtn.disabled = false
    }
  })

  input.addEventListener('input', () => {
    keyword = input.value.trim().toLowerCase()
    renderGrid()
  })

  const grid = document.createElement('div')
  grid.className = 'ed-grid'
  panel.appendChild(grid)

  function makeCard(m: MaterialItem): HTMLElement {
    const card = document.createElement('div')
    card.className = 'ed-clip'
    card.dataset.id = m.id
    if (selectedId === m.id) card.classList.add('is-selected')
    const badge =
      m.kind === 'video'
        ? m.duration
          ? fmtTime(m.duration)
          : '视频'
        : m.kind === 'gif'
          ? m.duration
            ? fmtTime(m.duration)
            : 'GIF'
          : '图片'
    const media =
      m.kind === 'video'
        ? ''
        : `<img class="ed-clip-media" src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy" />`
    card.innerHTML = `
      <div class="ed-clip-thumb real">
        ${media}
        <span class="ed-clip-badge">${badge}</span>
      </div>
      <div class="ed-clip-name" title="${esc(m.name)}">${esc(m.name)}</div>
      <button type="button" class="ed-clip-addbtn" title="添加到时间轴">＋</button>`
    if (m.kind === 'video') {
      const thumb = card.querySelector<HTMLElement>('.ed-clip-thumb')!
      // 复用上次的 <video>：切 tab / 搜索 / 重命名重绘都不再重新解析视频
      thumb.insertBefore(createCachedVideo(m), thumb.firstChild)
    }
    // ＋ 加入时间轴：视频入主视频轨（layer 0），图片 / 动图入图片轨（layer 1）
    card.querySelector<HTMLButtonElement>('.ed-clip-addbtn')!.addEventListener('click', async e => {
      e.stopPropagation()
      // GIF 未带时长（外部直接传入）：入轨前懒解析一次各帧延迟之和，失败兜底 5 秒
      if (m.kind === 'gif' && !m.duration) {
        try {
          const meta = probeGifMeta(await (await fetch(m.url)).arrayBuffer())
          if (meta) {
            if (meta.duration > 0) m.duration = meta.duration
            if (!m.width) m.width = meta.width
            if (!m.height) m.height = meta.height
          }
        } catch {
          /* 探测失败沿用兜底时长 */
        }
      }
      addTrack(payloadOfMaterial(m))
      toast('已添加到时间轴')
    })
    // 点击卡片本身：选中并在播放器预览该素材（再点已选中的卡片保持选中）
    card.addEventListener('click', () => {
      if (selectedId === m.id) return
      onSelect(m)
    })
    // 右键：重命名 / 删除（重命名只编辑主文件名，后缀保持原样）
    card.addEventListener('contextmenu', e => {
      const dot = m.name.lastIndexOf('.')
      const suffix = dot > 0 ? m.name.slice(dot) : ''
      const baseName = suffix ? m.name.slice(0, -suffix.length) : m.name
      showItemMenu(e, {
        name: baseName,
        onRename: next => {
          const trimmed = next.trim()
          if (!trimmed) return
          const fullName =
            suffix && !trimmed.toLowerCase().endsWith(suffix.toLowerCase()) ? trimmed + suffix : trimmed
          m.name = fullName
          renameItem(m.id, fullName)
          commit()
          renderGrid()
        },
        onDelete: () => {
          if (card.classList.contains('is-selected')) onSelect(null)
          releaseCachedVideo(m)
          data.material = data.material.filter(x => x.id !== m.id)
          deleteItem(m.id)
          commit()
          renderGrid()
        }
      })
    })
    // 拖拽到时间轴：上三区（素材/播放器/草稿）跟随正方形缩略图，进入轨道区由 pixi 画条形
    card.draggable = true
    card.addEventListener('dragstart', e => {
      if (!e.dataTransfer) return
      const payload = payloadOfMaterial(m)
      setDragPayload(payload)
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData(MATERIAL_MIME, JSON.stringify(payload))
      // 屏蔽原生 16:9 镜像，改用正方形 DOM 镜像（视频同步抓卡片当前封面帧，失败用纯色方块）
      let thumb: string | null = m.kind === 'video' ? null : m.url
      if (m.kind === 'video') {
        try {
          const cv = card.querySelector<HTMLVideoElement>('video')
          if (cv && cv.videoWidth > 0) {
            const c = document.createElement('canvas')
            c.width = cv.videoWidth
            c.height = cv.videoHeight
            c.getContext('2d')!.drawImage(cv, 0, 0)
            thumb = c.toDataURL('image/jpeg', 0.8)
          }
        } catch {
          thumb = null
        }
      }
      beginDragGhost({ thumb, kind: 'media' })
      if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(transparentDragImage(), 0, 0)
    })
    card.addEventListener('dragend', () => {
      clearDragPayload()
      endDragGhost()
    })
    return card
  }

  function renderGrid() {
    grid.innerHTML = ''
    const list = data.material.filter(m => m.name.toLowerCase().includes(keyword))
    list.forEach(m => grid.appendChild(makeCard(m)))
    if (list.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ed-empty'
      empty.innerHTML = `<div class="ed-empty-name" style="padding:20px 0">${
        keyword ? '没有匹配的素材' : '暂无素材，点击左上角「导入」上传'
      }</div>`
      grid.appendChild(empty)
    }
  }
  renderGrid()

  panel.appendChild(hint('点击「导入」上传本地视频 / 图片 / 动图；hover 素材卡片点 ＋ 添加到时间轴，点击卡片在播放器预览。'))
}
