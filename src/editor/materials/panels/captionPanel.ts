/* ============================================================
 *  素材库 · 面板四：字幕（.srt 原文 / .ass 按样式化渲染）
 *  点击行弹窗预览；ass 解析其中的字体 / 颜色 / 描边后用 div 还原。
 * ============================================================ */
import type { CaptionItem } from '../../types'
import type { PanelCtx } from '../materialsPanel'
import { filesToCaptions } from './upload'
import { parseAssDoc, parseCaption, type AssStyleInfo } from '../../codec/captionParse'

/** 秒 → H:MM:SS.cc（ass 厘秒口径，仅预览展示用） */
function formatAssTime(sec: number): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const cc = Math.round((s - Math.floor(s)) * 100)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(mm)}:${pad(ss)}.${pad(cc)}`
}

/** 字幕文件解析失败时的兜底单片段时长（秒） */
const CAPTION_CLIP_DURATION = 5

export function renderCaptionPanel(ctx: PanelCtx): void {
  const { panel, data, esc, toast, showOverlay, hint, pickFiles, commit, addTrack, addCaptionClips, showItemMenu, renameItem, deleteItem } = ctx

  function renderAssPreview(text: string): HTMLElement {
    const doc = parseAssDoc(text)
    const stage = document.createElement('div')
    stage.className = 'ed-cap-stage'
    doc.events.forEach(ev => {
      const st: AssStyleInfo | undefined = doc.styles.get(ev.style)
      const line = document.createElement('div')
      line.className = 'ed-cap-line'
      const txt = document.createElement('div')
      txt.className = 'ed-cap-text'
      txt.textContent = ev.text.replace(/\N/g, ' ')
      if (st) {
        txt.style.fontFamily = `'${st.font}', 'Microsoft YaHei', sans-serif`
        // ass PlayResX 960 → 预览宽约 440，字号等比缩小
        txt.style.fontSize = Math.max(12, Math.round(st.size * 0.5)) + 'px'
        txt.style.color = st.primary
        txt.style.fontWeight = st.bold ? '700' : '400'
        txt.style.fontStyle = st.italic ? 'italic' : 'normal'
        txt.style.webkitTextStroke = `1px ${st.outline}`
      }
      const time = document.createElement('div')
      time.className = 'ed-cap-time'
      time.textContent = `${formatAssTime(ev.start)} → ${formatAssTime(ev.end)}　${ev.style}`
      line.appendChild(txt)
      line.appendChild(time)
      stage.appendChild(line)
    })
    return stage
  }

  async function openCaption(c: CaptionItem) {
    let raw = ''
    try {
      raw = await (await fetch(c.url)).text()
    } catch (err) {
      console.warn('[editor/materials] 字幕读取失败:', err)
      toast('字幕读取失败')
      return
    }
    const box = document.createElement('div')
    box.className = 'ed-overlay-box ed-cap-box'
    box.innerHTML = `
      <button type="button" class="ed-overlay-x" title="关闭">✕</button>
      <div class="ed-cap-head">
        <span class="ed-cap-badge ${c.format}">${c.format.toUpperCase()}</span>
        <span class="ed-cap-title">${esc(c.name)}</span>
      </div>
      <div class="ed-cap-body"></div>`
    const body = box.querySelector<HTMLElement>('.ed-cap-body')!
    if (c.format === 'srt') {
      const pre = document.createElement('pre')
      pre.className = 'ed-cap-raw'
      pre.textContent = raw
      body.appendChild(pre)
    } else {
      body.appendChild(renderAssPreview(raw))
    }
    const close = showOverlay(box)
    box.querySelector('.ed-overlay-x')!.addEventListener('click', close)
  }

  function captionRow(c: CaptionItem): HTMLElement {
    const row = document.createElement('div')
    row.className = 'ed-list-row ed-caption-row'
    row.innerHTML = `
      <span class="ed-cap-badge ${c.format}">${c.format.toUpperCase()}</span>
      <span class="meta">
        <div class="name">${esc(c.name)}</div>
        <div class="sub">${esc(c.sub ?? '')}</div>
      </span>
      <button type="button" class="ed-row-addbtn" title="添加到时间轴">＋</button>
      <span class="ed-row-action">预览</span>`
    // 字幕轨在主轨上方（layer 4）：一条 cue 一个字幕片段，批量入轨
    const btn = row.querySelector<HTMLButtonElement>('.ed-row-addbtn')!
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      btn.disabled = true
      try {
        let raw = ''
        try {
          raw = await (await fetch(c.url)).text()
        } catch (err) {
          console.warn('[editor/materials] 字幕读取失败:', err)
          toast('字幕读取失败')
          return
        }
        const cues = parseCaption(c.format, raw)
        if (cues.length) {
          addCaptionClips(c, cues, raw)
          toast(`已添加 ${cues.length} 条字幕`)
        } else {
          // 解析不出对白区间：退回播放头处的单片段
          addTrack({
            type: 'caption',
            name: c.name,
            duration: CAPTION_CLIP_DURATION,
            materialId: c.id,
            source: { url: c.url, name: c.name, format: c.format, duration: CAPTION_CLIP_DURATION, content: c.name }
          })
          toast('已添加到时间轴')
        }
      } finally {
        btn.disabled = false
      }
    })
    row.addEventListener('click', () => void openCaption(c))
    // 右键：重命名 / 删除
    row.addEventListener('contextmenu', e => {
      showItemMenu(e, {
        name: c.name,
        onRename: next => {
          c.name = next
          renameItem(c.id, next)
          commit()
          renderList()
        },
        onDelete: () => {
          data.caption = data.caption.filter(x => x.id !== c.id)
          deleteItem(c.id)
          commit()
          renderList()
        }
      })
    })
    return row
  }

  // ---------- 顶部操作条：上传字幕 ----------
  const bar = document.createElement('div')
  bar.className = 'ed-subbar'
  bar.innerHTML = `<button type="button" class="ed-mini-btn ed-cap-upload">上传字幕</button>`
  panel.appendChild(bar)
  const uploadBtn = bar.querySelector<HTMLButtonElement>('.ed-cap-upload')!
  uploadBtn.addEventListener('click', async () => {
    const files = await pickFiles('.srt,.ass,text/plain', true)
    if (files.length === 0) return
    uploadBtn.disabled = true
    try {
      const items = await filesToCaptions(files)
      data.caption.push(...items)
      commit()
      renderList()
      toast(`已上传 ${items.length} 个字幕`)
    } catch (err) {
      console.warn('[editor/materials] 字幕上传失败:', err)
      toast('字幕上传失败')
    } finally {
      uploadBtn.disabled = false
    }
  })

  const listEl = document.createElement('div')
  panel.appendChild(listEl)

  function renderList() {
    listEl.innerHTML = ''
    data.caption.forEach(c => listEl.appendChild(captionRow(c)))
  }
  renderList()
  panel.appendChild(hint('支持 .srt / .ass：点行尾 ＋ 添加到时间轴，点「预览」查看内容（ass 按字体/颜色/描边渲染）；也可点「上传字幕」添加本地文件。'))
}
