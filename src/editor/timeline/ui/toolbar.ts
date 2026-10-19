/* ============================================================
 *  时间轴 · 工具栏（顶部工具条）
 *  组装三子模块：
 *   - tools     工具模块（撤销 / 恢复 / 分割 / 删除 / 标记 + M 快捷键）
 *   - states    状态模块（主轨磁吸 / 自动磁吸 / 预览轴 / 轨道缩放）
 *   - playerOps 播放器操作（定格 / 倒放 / 裁剪，未实现占位）
 *  本文件只负责工具栏 HTML 骨架（零增删迁移）与子模块接线。
 * ============================================================ */
import { tlIcon } from '../../utils/icons'
import { bindTools, type ToolsDeps } from './tools'
import { bindStates, type StatesDeps } from './states'
import { bindPlayerOps } from './playerOps'

/** 工具栏 HTML（插入 .ed-timeline 内、画布上方；结构 / class / data-* 保持原样） */
export function timelineToolbarHtml(): string {
  return `
      <div class="ed-tl-toolbar">
        <span class="ed-tl-group">
          <button type="button" class="ed-tl-btn" data-op="undo" data-tip="撤销">${tlIcon('undo')}</button>
          <button type="button" class="ed-tl-btn" data-op="redo" data-tip="恢复">${tlIcon('redo')}</button>
          <button type="button" class="ed-tl-btn" data-op="split" data-tip="分割">${tlIcon('split')}</button>
          <button type="button" class="ed-tl-btn" data-op="trim-left" data-tip="向左裁剪">${tlIcon('trim-left')}</button>
          <button type="button" class="ed-tl-btn" data-op="trim-right" data-tip="向右裁剪">${tlIcon('trim-right')}</button>
          <button type="button" class="ed-tl-btn" data-op="delete" data-tip="删除">${tlIcon('delete')}</button>
          <button type="button" class="ed-tl-btn" data-op="marker" data-tip="标记">${tlIcon('marker')}</button>
        </span>
        <span class="ed-tl-sep"></span>
        <span class="ed-tl-group">
          <button type="button" class="ed-tl-btn" data-op="freeze" data-tip="定格">${tlIcon('freeze')}</button>
          <button type="button" class="ed-tl-btn" data-op="reverse" data-tip="倒放">${tlIcon('reverse')}</button>
          <button type="button" class="ed-tl-btn" data-op="crop" data-tip="裁剪">${tlIcon('crop')}</button>
        </span>
        <div class="ed-tl-spacer"></div>
        <button type="button" class="ed-tl-btn is-on" data-role="tl-main-snap" data-tip="关闭主轨吸附" aria-pressed="true">${tlIcon('main-magnet')}</button>
        <button type="button" class="ed-tl-btn is-on" data-role="tl-snap" data-tip="关闭自动吸附" aria-pressed="true">${tlIcon('magnet')}</button>
        <button type="button" class="ed-tl-btn is-on" data-role="tl-preview" data-tip="关闭预览轴" aria-pressed="true">${tlIcon('preview-axis')}</button>
        <span class="ed-tl-sep"></span>
        <span class="ed-tl-zoom">
          <button type="button" class="ed-tl-btn" data-zoom="-1" data-tip="缩小">${tlIcon('zoom-out')}</button>
          <input type="range" class="ed-tl-range" min="1" max="13" step="1" value="7" aria-label="时间轴的放大与缩小">
          <button type="button" class="ed-tl-btn" data-zoom="1" data-tip="放大">${tlIcon('zoom-in')}</button>
        </span>
      </div>`
}

export interface TimelineToolbarDeps extends ToolsDeps, StatesDeps {
  /** 轻提示（占位播放器操作等用） */
  toast: (msg: string) => void
  /** M 快捷键触发时判断编辑器弹层是否打开（打开则不拦截） */
  hasOpenModal: () => boolean
}

export interface TimelineToolbarApi {
  /** 按选中态 / 历史栈刷新工具按钮禁用态 */
  refreshOpButtons: () => void
  /** 外部（时间轴异步就绪）反向同步当前缩放等级到滑杆 */
  setZoomLevel: (level: number) => void
  /** 解绑全部监听（含 document 上的 M 快捷键） */
  destroy: () => void
}

/** 绑定工具栏全部交互；按钮 DOM 已随 timelineToolbarHtml 注入 shell */
export function createTimelineToolbar(shell: HTMLElement, deps: TimelineToolbarDeps): TimelineToolbarApi {
  const tools = bindTools(shell, deps)
  const states = bindStates(shell, deps)
  bindPlayerOps(shell, deps)
  tools.refreshOpButtons()
  return {
    refreshOpButtons: tools.refreshOpButtons,
    setZoomLevel: states.setZoomLevel,
    destroy() {
      tools.destroy()
      states.destroy()
    }
  }
}
