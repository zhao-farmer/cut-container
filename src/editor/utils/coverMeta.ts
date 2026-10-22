/* ============================================================
 *  封面图 → MP4 元信息字节（covr 封面）
 *
 *  编辑器里的封面统一是 dataURL（上传图 / 主轨首帧截取都是 canvas 导出的图）。
 *  mediabunny 的 MP4 封装在写 `moov/udta/meta/ilst/covr` 时，data-box 的类型标记
 *  只认 JPEG / PNG / BMP，因此这里统一重编码成 JPEG，并把长边限制在 1024 以内：
 *  - 元信息是给人看的缩略图，不需要原图分辨率；
 *  - 封面字节会整段进 moov，过大既撑大文件也拖慢 fastStart。
 * ============================================================ */

/** 写入元信息的封面最大边长（像素） */
const MAX_EDGE = 1024

export interface CoverMetaImage {
  data: Uint8Array
  mimeType: string
}

/**
 * dataURL → 可写入 MP4 元信息的 JPEG 字节。
 * 解码 / 绘制 / 编码任一环节失败都返回 null（调用方照常导出成片，只是没有封面）。
 */
export async function coverImageToMetaJpeg(dataUrl: string): Promise<CoverMetaImage | null> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return null

    const k = Math.min(1, MAX_EDGE / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * k))
    const h = Math.max(1, Math.round(h0 * k))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG 没有透明通道：先铺白底，避免 PNG 的透明区域在播放器里显示成黑块
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return null
    return { data: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' }
  } catch {
    return null
  }
}
