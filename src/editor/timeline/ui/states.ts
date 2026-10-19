/* ============================================================
 *  时间轴工具栏 · 状态模块
 *  主轨磁吸 / 自动磁吸 / 预览轴 三个开关（is-on + aria-pressed +
 *  动态 data-tip），以及轨道缩放滑杆与两侧 ± 按钮。
 *  数据语义（主轨重排落盘 / 播放器静帧恢复等）全部走外层回调，
 *  本模块只管理按钮视觉与滑杆值。
 * ============================================================ */

const ZOOM_MIN = 1
const ZOOM_MAX = 13

export interface StatesDeps {
  /** 主轨磁吸切换：外层负责主轨重排落盘与同步时间轴 */
  onMainSnapChange: (on: boolean) => void
  /** 自动磁吸切换 */
  onSnapChange: (on: boolean) => void
  /** 预览轴切换（关闭时外层恢复播放器播放头静帧） */
  onPreviewChange: (on: boolean) => void
  /** 缩放等级变化（来自滑杆或 ± 按钮） */
  onZoomChange: (level: number) => void
  /** 时间轴未就绪时读不到等级，返回 null 表示仅更新滑杆本地值 */
  getZoom: () => number | null
}

export interface StatesApi {
  /** 外部反向同步缩放等级到滑杆 */
  setZoomLevel: (level: number) => void
  destroy: () => void
}

export function bindStates(shell: HTMLElement, deps: StatesDeps): StatesApi {
  const zoomRange = shell.querySelector<HTMLInputElement>('.ed-tl-range')!
  const mainSnapBtn = shell.querySelector<HTMLButtonElement>('button[data-role="tl-main-snap"]')!
  const snapBtn = shell.querySelector<HTMLButtonElement>('button[data-role="tl-snap"]')!
  const previewBtn = shell.querySelector<HTMLButtonElement>('button[data-role="tl-preview"]')!

  const setPressed = (btn: HTMLButtonElement, on: boolean) => {
    btn.classList.toggle('is-on', on)
    btn.setAttribute('aria-pressed', String(on))
  }

  // 主轨磁吸：视觉切换后交外层（外层语义：开启瞬间主轨按时间顺序贴边重排）
  mainSnapBtn.addEventListener('click', () => {
    const next = !mainSnapBtn.classList.contains('is-on')
    setPressed(mainSnapBtn, next)
    mainSnapBtn.dataset.tip = next ? '关闭主轨吸附' : '开启主轨吸附'
    deps.onMainSnapChange(next)
  })

  // 自动磁吸：拖入素材及移动 / 拖裁片段时对齐其他子项开头 / 结尾
  snapBtn.addEventListener('click', () => {
    const on = !snapBtn.classList.contains('is-on')
    setPressed(snapBtn, on)
    snapBtn.dataset.tip = on ? '关闭自动吸附' : '开启自动吸附'
    deps.onSnapChange(on)
  })

  // 预览轴：开启后鼠标在时间线上移动显示跟随的黄色竖线（默认开启）
  previewBtn.addEventListener('click', () => {
    const on = !previewBtn.classList.contains('is-on')
    setPressed(previewBtn, on)
    previewBtn.dataset.tip = on ? '关闭预览轴' : '开启预览轴'
    deps.onPreviewChange(on)
  })

  // 缩放：滑杆 + 两侧按钮，等比缩放并以视口中心为锚点（锚定在时间轴内实现）
  zoomRange.addEventListener('input', () => {
    deps.onZoomChange(Number(zoomRange.value))
  })
  shell.querySelectorAll<HTMLButtonElement>('button[data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.zoom)
      // 等级 1-13：等级越大单帧越宽（放大），故 +1 即放大
      const base = deps.getZoom() ?? Number(zoomRange.value)
      const lv = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, base + dir))
      zoomRange.value = String(lv)
      deps.onZoomChange(lv)
    })
  })

  return {
    setZoomLevel(level: number) {
      zoomRange.value = String(level)
    },
    destroy() {
      /* 按钮均在 shell DOM 内随容器销毁，无 document 级监听 */
    }
  }
}
