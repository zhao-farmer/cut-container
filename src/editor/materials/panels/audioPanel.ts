/* ============================================================
 *  素材库 · 面板二：音频
 *  顶部「上传」「提取」；中部为与素材同宽的卡片网格（140px，自动换行）；
 *  底部为试听播放条（选中某条音频后出现，关闭后隐藏）：
 *    - 播放 / 暂停、进度拖动、当前时间 / 总时长、关闭；
 *    - 试听走 Web Audio 接管，联动播放器底栏格子电平表与右下角竖井电平表；
 *    - 与时间线播放相互独立：试听不打断播放器，播放器播放也不影响试听。
 *  卡片左下角仍是单条试听按钮，hover 右下角 ＋ 加入音频轨。
 * ============================================================ */
import type { AudioItem, AudioKind } from '../../types'
import type { PanelCtx } from '../materialsPanel'
import { extOfFile, extractAudioFromVideo, filesToAudio, upId } from './upload'
import { putLocalFile } from '../../utils/localMediaStore'
import {
  MATERIAL_MIME,
  setDragPayload,
  clearDragPayload,
  beginDragGhost,
  endDragGhost,
  transparentDragImage
} from '../dragPayload'

/** 时长 → 角标文本（m:ss） */
function fmtDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 秒 → 播放器时钟（mm:ss） */
function fmtClock(sec: number): string {
  const v = Number.isFinite(sec) && sec > 0 ? sec : 0
  const m = Math.floor(v / 60)
  const s = Math.floor(v % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function renderAudioPanel(ctx: PanelCtx): () => void {
  const { panel, data, esc, toast, pickFiles, commit, addTrack, showItemMenu, renameItem, deleteItem } = ctx

  /** 当前试听（同一时刻仅一条） */
  let preview: { item: AudioItem; audio: HTMLAudioElement } | null = null
  /** 当前试听对应的卡片播放按钮 */
  let previewBtn: HTMLButtonElement | null = null
  /** 进度拖动中：timeupdate 不回写滑杆，避免跳回 */
  let seekDragging = false
  let busy = false

  // ---------- 骨架：顶部操作 + 卡片网格 + 底部试听条 ----------
  panel.innerHTML = `
    <div class="ed-audio-wrap">
      <div class="ed-audio-toolbar">
        <button type="button" class="ed-audio-op" data-op="upload">上传</button>
        <button type="button" class="ed-audio-op" data-op="extract">提取</button>
      </div>
      <div class="ed-audio-grid"></div>
      <div class="ed-audio-player" hidden>
        <button type="button" class="ed-ap-play" title="播放 / 暂停">▶</button>
        <div class="ed-ap-main">
          <div class="ed-ap-title"></div>
          <div class="ed-ap-row">
            <span class="ed-ap-cur">00:00</span>
            <input type="range" class="ed-ap-seek" min="0" max="1000" step="1" value="0" aria-label="试听进度">
            <span class="ed-ap-dur">00:00</span>
            <button type="button" class="ed-ap-close" title="关闭试听">×</button>
          </div>
        </div>
      </div>
    </div>`
  const gridEl = panel.querySelector<HTMLElement>('.ed-audio-grid')!
  const barEl = panel.querySelector<HTMLElement>('.ed-audio-player')!
  const barPlay = panel.querySelector<HTMLButtonElement>('.ed-ap-play')!
  const barTitle = panel.querySelector<HTMLElement>('.ed-ap-title')!
  const barCur = panel.querySelector<HTMLElement>('.ed-ap-cur')!
  const barDur = panel.querySelector<HTMLElement>('.ed-ap-dur')!
  const barSeek = panel.querySelector<HTMLInputElement>('.ed-ap-seek')!
  const barClose = panel.querySelector<HTMLButtonElement>('.ed-ap-close')!

  /** 同步卡片播放按钮 / 底部播放条的播放态 */
  function syncPlaying(playing: boolean) {
    if (previewBtn) {
      previewBtn.textContent = playing ? '⏸' : '▶'
      previewBtn.classList.toggle('playing', playing)
    }
    barPlay.textContent = playing ? '⏸' : '▶'
    barPlay.classList.toggle('playing', playing)
  }

  /** 停止试听：pause + 拆电平图；hide=true 时收起底部播放条 */
  function stopPreview(hide = false) {
    const item = preview?.item
    if (preview) {
      const a = preview.audio
      a.pause()
      a.removeAttribute('src')
    }
    preview = null
    syncPlaying(false)
    previewBtn = null
    if (hide) barEl.hidden = true
    barCur.textContent = '00:00'
    barSeek.value = '0'
    if (item) ctx.onAudition?.(null, item.type)
  }

  /** 把某条音频装进底部播放条并开始播放 */
  function playItem(item: AudioItem, cardBtn: HTMLButtonElement) {
    if (preview?.item.url === item.url) {
      // 同一条：播放 / 暂停切换（复用已接线的元素，避免重复 createMediaElementSource）
      if (preview.audio.paused) {
        void preview.audio.play().catch(() => stopPreview(true))
      } else {
        preview.audio.pause()
      }
      syncPlaying(!preview.audio.paused)
      return
    }

    stopPreview(false)
    const audio = new Audio()
    // 跨源音频（后端 /files）必须带 CORS，否则 Web Audio 取到的是静音、电平表不跳
    audio.crossOrigin = 'anonymous'
    audio.preload = 'metadata'
    audio.src = item.url
    preview = { item, audio }
    previewBtn = cardBtn

    barEl.hidden = false
    barTitle.textContent = item.name
    barTitle.title = item.sub ? `${item.name} · ${item.sub}` : item.name
    barCur.textContent = '00:00'
    barDur.textContent = fmtClock(item.duration || 0)
    barSeek.value = '0'

    const refreshTime = () => {
      if (preview?.audio !== audio) return
      barCur.textContent = fmtClock(audio.currentTime)
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.duration || 0
      barDur.textContent = fmtClock(d)
      if (!seekDragging) barSeek.value = String(Math.round((d > 0 ? audio.currentTime / d : 0) * 1000))
    }
    audio.addEventListener('loadedmetadata', refreshTime)
    audio.addEventListener('timeupdate', refreshTime)
    audio.addEventListener('play', () => {
      if (preview?.audio === audio) syncPlaying(true)
    })
    audio.addEventListener('pause', () => {
      if (preview?.audio === audio) syncPlaying(false)
    })
    audio.addEventListener('ended', () => {
      if (preview?.audio !== audio) return
      syncPlaying(false)
      audio.currentTime = 0
      barCur.textContent = '00:00'
      barSeek.value = '0'
    })

    // 试听接管 Web Audio：格子电平表 + 竖井电平表共用这一路信号
    ctx.onAudition?.(audio, item.type)
    syncPlaying(true)
    audio.play().catch(err => {
      console.warn('[editor/materials] 试听失败:', err)
      stopPreview(true)
    })
  }

  function audioCard(m: AudioItem): HTMLElement {
    const card = document.createElement('div')
    card.className = 'ed-audio-card'
    card.title = m.sub ? `${m.name} · ${m.sub}` : m.name
    const badge = fmtDuration(m.duration)
    card.innerHTML = `
      <div class="ed-audio-thumb">
        <span class="ed-audio-note">♪</span>
        ${badge ? `<span class="ed-clip-badge">${badge}</span>` : ''}
        <button type="button" class="ed-audition" title="试听 / 停止">▶</button>
      </div>
      <div class="ed-audio-name">${esc(m.name)}</div>
      <div class="ed-audio-sub">${esc(m.sub ?? '')}</div>
      <button type="button" class="ed-corner-addbtn ed-audio-addbtn" title="添加到时间轴">＋</button>`

    const btn = card.querySelector<HTMLButtonElement>('.ed-audition')!
    btn.addEventListener('click', e => {
      e.stopPropagation()
      // 同一条 → 播放 / 暂停切换；不同条 → 换曲并从头播放
      playItem(m, btn)
    })

    card.querySelector<HTMLButtonElement>('.ed-audio-addbtn')!.addEventListener('click', e => {
      e.stopPropagation()
      const duration = m.duration || 5
      const format = extOfFile(m.url) || (m.type === 'music' ? 'mp3' : 'wav')
      addTrack({
        type: 'audio',
        name: m.name,
        duration,
        materialId: m.id,
        // 音频轨层级为负数（layer -1），在主轨之下
        source: { url: m.url, name: m.name, format, duration, audioType: m.type }
      })
      toast('已添加到时间轴')
    })

    // 右键：重命名 / 删除
    card.addEventListener('contextmenu', e => {
      showItemMenu(e, {
        name: m.name,
        onRename: next => {
          m.name = next
          renameItem(m.id, next)
          commit()
          renderList()
        },
        onDelete: () => {
          if (preview?.item.id === m.id) stopPreview(true)
          data.audio = data.audio.filter(x => x.id !== m.id)
          deleteItem(m.id)
          commit()
          renderList()
        }
      })
    })

    // 拖拽到时间轴：上三区跟随音符方块，进入音频轨由 pixi 画蓝色条形
    card.draggable = true
    card.addEventListener('dragstart', e => {
      if (!e.dataTransfer) return
      const duration = m.duration || 5
      const format = extOfFile(m.url) || (m.type === 'music' ? 'mp3' : 'wav')
      const payload = {
        type: 'audio' as const,
        name: m.name,
        duration,
        materialId: m.id,
        source: { url: m.url, name: m.name, format, duration, audioType: m.type }
      }
      setDragPayload(payload)
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData(MATERIAL_MIME, JSON.stringify(payload))
      beginDragGhost({ thumb: null, kind: 'audio' })
      if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(transparentDragImage(), 0, 0)
    })
    card.addEventListener('dragend', () => {
      clearDragPayload()
      endDragGhost()
    })
    return card
  }

  function renderList() {
    stopPreview(true)
    gridEl.innerHTML = ''
    const list = data.audio
    gridEl.classList.toggle('is-empty', list.length === 0)
    list.forEach(m => gridEl.appendChild(audioCard(m)))
    if (list.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ed-empty'
      empty.innerHTML = `<div class="ed-empty-name">暂无音频</div>
        <div class="ed-empty-sub">可在上方「上传」本地音频，或「提取」视频音轨</div>`
      gridEl.appendChild(empty)
    }
  }

  // ---------- 底部播放条交互 ----------
  barPlay.addEventListener('click', () => {
    if (!preview) return
    if (preview.audio.paused) void preview.audio.play().catch(() => stopPreview(true))
    else preview.audio.pause()
  })
  barClose.addEventListener('click', () => stopPreview(true))
  barSeek.addEventListener('pointerdown', () => {
    seekDragging = true
  })
  barSeek.addEventListener('pointerup', () => {
    seekDragging = false
  })
  barSeek.addEventListener('input', () => {
    if (!preview) return
    const d = Number.isFinite(preview.audio.duration) && preview.audio.duration > 0
      ? preview.audio.duration
      : preview.item.duration || 0
    if (d > 0) preview.audio.currentTime = (Number(barSeek.value) / 1000) * d
  })

  // ---------- 上传：本地音频 ----------
  panel.querySelector<HTMLButtonElement>('[data-op="upload"]')!.addEventListener('click', async () => {
    if (busy) return
    const files = await pickFiles('audio/*', true)
    if (files.length === 0) return
    busy = true
    try {
      const items = await filesToAudio(files, 'music')
      data.audio.push(...items)
      commit()
      renderList()
      toast(`已上传 ${items.length} 个音频`)
    } catch (err) {
      console.warn('[editor/materials] 音频上传失败:', err)
      toast('音频上传失败')
    } finally {
      busy = false
    }
  })

  // ---------- 提取：视频 → WAV 音轨 ----------
  panel.querySelector<HTMLButtonElement>('[data-op="extract"]')!.addEventListener('click', async () => {
    if (busy) return
    const files = await pickFiles('video/*', false)
    if (files.length === 0) return
    busy = true
    toast('正在提取音轨…')
    try {
      const file = files[0]
      const { url, duration, blob } = await extractAudioFromVideo(file)
      const id = upId('audio')
      if (url.startsWith('blob:')) void putLocalFile(id, blob)
      data.audio.push({
        id,
        name: file.name.replace(/\.[^.]+$/, '') + '（提取音频）',
        type: 'music',
        url,
        duration,
        sub: `WAV · ${Math.round(duration)}s · 视频提取`
      })
      commit()
      renderList()
      toast('音轨已提取')
    } catch (err) {
      console.warn('[editor/materials] 音轨提取失败:', err)
      toast('无法提取该视频的音轨')
    } finally {
      busy = false
    }
  })

  renderList()

  return () => stopPreview(true)
}
