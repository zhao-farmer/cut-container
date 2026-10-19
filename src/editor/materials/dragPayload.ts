/* ============================================================
 *  素材库 → 时间轴：HTML5 拖拽载荷中转 + 拖拽镜像管理
 *
 *  dragstart 时只能同步写 dataTransfer（GIF 懒探测等异步准备无法等待），
 *  且 dragover 阶段浏览器安全策略禁止读取 getData() 内容（仅可见 types）。
 *  拖拽源（素材卡 / 音频行）与放置目标（时间轴 host）同属一个编辑器实例，
 *  故经此模块级变量在拖拽期间传递载荷；dataTransfer 同时写入同内容。
 *
 *  镜像（对齐剪映）：
 *    - 素材区 / 播放器 / 草稿区：跟随光标的正方形缩略图，光标为复制（＋）；
 *    - 底部轨道区：隐藏方块，由时间轴 pixi 绘制条形占位。
 *  浏览器原生拖拽镜像无法随区域换形，故 dragstart 用 1×1 透明图屏蔽，
 *  自绘 fixed DOM 方块（挂 body、内联样式，Shadow DOM 外也可显示）。
 * ============================================================ */
import type { AnyAddTrackPayload } from './materialsPanel'

/** 自定义拖拽类型（dataTransfer MIME） */
export const MATERIAL_MIME = 'application/x-uc-material'

let current: AnyAddTrackPayload | null = null

export const setDragPayload = (p: AnyAddTrackPayload): void => {
  current = p
}

export const getDragPayload = (): AnyAddTrackPayload | null => current

export const clearDragPayload = (): void => {
  current = null
}

/* ---------------- 自绘正方形拖拽镜像 ---------------- */

const GHOST_SIZE = 72

export interface DragGhostSpec {
  /** 图片 / GIF / 视频封面（dataURL 或可直接显示的 URL）；无封面时按 kind 显示字形方块 */
  thumb: string | null
  /** media＝视频/图片/GIF（失败兜底 ▶ 方块）；audio＝音符方块 */
  kind?: 'media' | 'audio'
}

let ghostEl: HTMLDivElement | null = null
/** 当前是否在轨道区（条形模式：隐藏方块） */
let barMode = false
let transparent: HTMLCanvasElement | null = null

/** 1×1 透明画布：屏蔽浏览器原生拖拽镜像（单例复用，挂在屏外以兼容各 Chromium 版本） */
export function transparentDragImage(): HTMLCanvasElement {
  if (!transparent) {
    transparent = document.createElement('canvas')
    transparent.width = 1
    transparent.height = 1
    Object.assign(transparent.style, {
      position: 'fixed',
      left: '-100px',
      top: '-100px',
      width: '1px',
      height: '1px',
      pointerEvents: 'none'
    } satisfies Partial<CSSStyleDeclaration>)
    document.body.appendChild(transparent)
  }
  return transparent
}

function positionGhost(x: number, y: number) {
  if (!ghostEl) return
  ghostEl.style.left = `${x - GHOST_SIZE / 2}px`
  ghostEl.style.top = `${y - GHOST_SIZE / 2}px`
}

const onWinDragOver = (e: DragEvent) => {
  if (!ghostEl) return
  positionGhost(e.clientX, e.clientY)
}

const onWinDragEnd = () => {
  endDragGhost()
}

/**
 * 开始拖拽：创建跟随光标的正方形镜像。
 * 调用方需在 dragstart 里另行 setDragImage(transparentDragImage(), 0, 0)。
 */
export function beginDragGhost(spec: DragGhostSpec): void {
  endDragGhost()
  barMode = false
  const el = document.createElement('div')
  el.setAttribute('data-ed-drag-ghost', '')
  Object.assign(el.style, {
    position: 'fixed',
    left: '-200px',
    top: '-200px',
    width: `${GHOST_SIZE}px`,
    height: `${GHOST_SIZE}px`,
    zIndex: '2147483647',
    pointerEvents: 'none',
    borderRadius: '8px',
    overflow: 'hidden',
    boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,.35)',
    boxShadow: '0 6px 18px rgba(0,0,0,.45)',
    background: '#103c5c',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  } satisfies Partial<CSSStyleDeclaration>)
  if (spec.thumb) {
    const img = document.createElement('img')
    img.src = spec.thumb
    img.draggable = false
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    } satisfies Partial<CSSStyleDeclaration>)
    el.appendChild(img)
  } else {
    // 无封面：音频＝青色音符；视频/图片兜底＝播放三角
    const isAudio = spec.kind === 'audio'
    el.textContent = isAudio ? '♪' : '▶'
    Object.assign(el.style, {
      background: isAudio ? '#103c5c' : '#004d52',
      color: isAudio ? '#62b8f0' : '#e8e8ec',
      fontSize: isAudio ? '38px' : '30px',
      lineHeight: '1'
    } satisfies Partial<CSSStyleDeclaration>)
  }
  document.body.appendChild(el)
  ghostEl = el
  window.addEventListener('dragover', onWinDragOver, true)
  window.addEventListener('dragend', onWinDragEnd, true)
}

/** 进入 / 离开轨道区：轨道区显示条形，隐藏正方形镜像 */
export function setDragBarMode(on: boolean): void {
  barMode = on
  if (ghostEl) ghostEl.style.display = barMode ? 'none' : 'flex'
}

/** 结束拖拽：移除镜像与全局监听（dragend 兜底，卡片自身也会显式调用） */
export function endDragGhost(): void {
  barMode = false
  if (ghostEl) {
    ghostEl.remove()
    ghostEl = null
  }
  window.removeEventListener('dragover', onWinDragOver, true)
  window.removeEventListener('dragend', onWinDragEnd, true)
}
