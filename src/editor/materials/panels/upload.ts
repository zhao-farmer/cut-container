/* ============================================================
 *  素材库 · 本地上传 / 提取公共工具
 *
 *  - 文件选择：复用挂在面板上的隐藏 <input type="file">
 *  - 大媒体（视频/图片/音频）走 blob: URL（会话内使用）
 *  - 字幕文本很小，读成 data: URL（可随 localStorage 持久化）
 *  - 「提取」：视频文件经 WebAudio 解码为 PCM 后编码 WAV
 * ============================================================ */
import type { AudioKind, AudioItem, CaptionFormat, CaptionItem, MaterialItem, MediaKind } from '../../types'
import { probeGifMeta } from '../../codec/timelineMedia'
import { uploadAsset } from '../../services/backend'
import { putLocalFile } from '../../utils/localMediaStore'

let seq = 0
/** 本会话内唯一 id（前缀 up 表示用户上传） */
export function upId(prefix: string): string {
  seq += 1
  return `up-${prefix}-${Date.now().toString(36)}-${seq}`
}

/** 文件选择器：input 常驻宿主（display:none），方便重复选择与自动化派发 change */
export interface FilePicker {
  pick: (accept: string, multiple?: boolean) => Promise<File[]>
}

export function createFilePicker(host: HTMLElement): FilePicker {
  const input = document.createElement('input')
  input.type = 'file'
  input.hidden = true
  input.style.display = 'none'
  host.appendChild(input)

  function pick(accept: string, multiple = false): Promise<File[]> {
    return new Promise(resolve => {
      input.accept = accept
      input.multiple = multiple
      input.value = ''
      const onChange = () => {
        input.removeEventListener('change', onChange)
        resolve(Array.from(input.files ?? []))
      }
      input.addEventListener('change', onChange)
      input.click()
    })
  }

  return { pick }
}

/* ---------- 媒体元数据探测 ---------- */

interface MediaMeta {
  duration: number
  width: number
  height: number
}

function probeMedia(url: string, isVideo: boolean): Promise<MediaMeta> {
  return new Promise(resolve => {
    const el = document.createElement(isVideo ? 'video' : 'audio')
    el.preload = 'metadata'
    const done = (meta: MediaMeta) => {
      el.src = ''
      resolve(meta)
    }
    el.addEventListener('loadedmetadata', () =>
      done({
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        // HTMLAudioElement 无 videoWidth，读取为 undefined → 0
        width: (el as HTMLVideoElement).videoWidth || 0,
        height: (el as HTMLVideoElement).videoHeight || 0
      })
    )
    el.addEventListener('error', () => done({ duration: 0, width: 0, height: 0 }))
    el.src = url
  })
}

function probeImage(url: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = url
  })
}

/** 从 url 或文件名取小写后缀（去掉 ?query / #hash），无后缀返回 '' */
export function extOfFile(urlOrName: string): string {
  const path = urlOrName.split(/[?#]/)[0]
  const i = path.lastIndexOf('.')
  return i >= 0 ? path.slice(i + 1).toLowerCase() : ''
}

function kindOfFile(file: File): MediaKind {
  const ext = extOfFile(file.name)
  if (ext === 'gif' || file.type === 'image/gif') return 'gif'
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  return 'video'
}

/** 一组文件 → 素材项（视频/图片/动图） */
export async function filesToMaterials(files: File[]): Promise<MaterialItem[]> {
  const items: MaterialItem[] = []
  for (const file of files) {
    // 本地 blob URL 只用于探测元数据；配置了后端时最终地址换成服务端 URL
    const localUrl = URL.createObjectURL(file)
    const kind = kindOfFile(file)
    const ext = extOfFile(file.name) || (kind === 'video' ? 'video' : 'image')
    let duration: number | undefined
    let width: number | undefined
    let height: number | undefined
    let sub: string
    if (kind === 'video') {
      const meta = await probeMedia(localUrl, true)
      duration = meta.duration || undefined
      width = meta.width || undefined
      height = meta.height || undefined
      sub = ext.toUpperCase() + (duration ? ` · ${Math.round(duration)}s` : '')
    } else if (kind === 'gif') {
      // GIF 时长 = 各帧延迟之和（浏览器无原生 API，自行解析二进制）
      try {
        const meta = probeGifMeta(await file.arrayBuffer())
        duration = meta && meta.duration > 0 ? meta.duration : undefined
        width = meta?.width || undefined
        height = meta?.height || undefined
      } catch {
        /* 解析失败退回普通图片探测 */
      }
      if (!width) {
        const { w, h } = await probeImage(localUrl)
        width = w || undefined
        height = h || undefined
      }
      sub = `${width && height ? `${width} × ${height} · ` : ''}GIF${duration ? ` · ${duration.toFixed(1)}s` : ''}`
    } else {
      const { w, h } = await probeImage(localUrl)
      width = w || undefined
      height = h || undefined
      sub = `${w && h ? `${w} × ${h} · ` : ''}${ext.toUpperCase()}`
    }
    // 后端启用时上传并改用服务端地址；未启用 / 失败保持本地 blob（Blob 另存 IndexedDB，刷新后可恢复）
    const remote = await uploadAsset(file, kind)
    const id = upId(kind)
    if (remote) {
      URL.revokeObjectURL(localUrl)
      sub += ' · 服务端'
    } else {
      void putLocalFile(id, file)
    }
    items.push({
      id,
      name: file.name,
      kind,
      url: remote?.url || localUrl,
      source: remote ? 'remote_file' : 'local_file',
      remote_file: remote?.url,
      local_file: remote ? undefined : localUrl,
      duration,
      width,
      height,
      sub
    })
  }
  return items
}

/** 一组文件 → 音频项 */
export async function filesToAudio(files: File[], type: AudioKind): Promise<AudioItem[]> {
  const items: AudioItem[] = []
  for (const file of files) {
    const localUrl = URL.createObjectURL(file)
    const meta = await probeMedia(localUrl, false)
    const duration = meta.duration
    const remote = await uploadAsset(file, 'audio')
    const id = upId('audio')
    if (remote) URL.revokeObjectURL(localUrl)
    else void putLocalFile(id, file)
    items.push({
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      type,
      url: remote?.url || localUrl,
      duration: duration || undefined,
      sub: `${(extOfFile(file.name) || 'audio').toUpperCase()}${duration ? ` · ${Math.round(duration)}s` : ''} · ${remote ? '服务端' : '本地上传'}`
    })
  }
  return items
}

/* ---------- 字幕：读文本 → data: URL（体积小，可持久化） ---------- */

function captionFormatOf(name: string): CaptionFormat {
  return extOfFile(name) === 'ass' ? 'ass' : 'srt'
}

export function filesToCaptions(files: File[]): Promise<CaptionItem[]> {
  return Promise.all(
    files.map(
      file =>
        new Promise<CaptionItem>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            void (async () => {
              try {
                const text = String(reader.result ?? '')
                const format = captionFormatOf(file.name)
                const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).length
                // btoa 对 Unicode 不安全，先 encodeURIComponent 再转 base64
                const b64 = btoa(unescape(encodeURIComponent(text)))
                // 后端启用时上传原始字幕文件并改用服务端地址；否则内联 data URL
                const remote = await uploadAsset(file, 'subtitle')
                resolve({
                  id: upId('cap'),
                  name: file.name,
                  format,
                  url: remote?.url || `data:text/plain;charset=utf-8;base64,${b64}`,
                  sub: `${lines} 行 · ${remote ? '服务端' : '本地上传'}`
                })
              } catch (err) {
                reject(err)
              }
            })()
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsText(file)
        })
    )
  )
}

/* ---------- 视频提取音频：decodeAudioData → 16bit PCM WAV ---------- */

/** AudioBuffer 交错编码为 WAV 二进制 */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = Math.min(2, buffer.numberOfChannels)
  const sampleRate = buffer.sampleRate
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = frames * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return buf
}

/**
 * 从视频文件提取音轨：
 * Chromium 的 decodeAudioData 可直接解码 mp4/mkv 容器中的音频流为 AudioBuffer，
 * 再编码成 WAV（无需 ffmpeg、无需后台播放整个视频）。
 */
export async function extractAudioFromVideo(
  file: File
): Promise<{ url: string; duration: number; blob: Blob }> {
  const bytes = await file.arrayBuffer()
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  try {
    const decoded = await ctx.decodeAudioData(bytes.slice(0))
    const wav = audioBufferToWav(decoded)
    const blob = new Blob([wav], { type: 'audio/wav' })
    // 后端启用时把提取出的 WAV 也上传，地址可跨会话复用；否则用会话内 blob
    const wavName = `${file.name.replace(/\.[^.]+$/, '')}-audio.wav`
    const remote = await uploadAsset(new File([blob], wavName, { type: 'audio/wav' }), 'audio')
    const url = remote?.url || URL.createObjectURL(blob)
    return { url, duration: decoded.duration, blob }
  } finally {
    void ctx.close()
  }
}
