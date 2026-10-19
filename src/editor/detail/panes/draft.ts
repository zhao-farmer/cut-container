/* ============================================================
 *  编辑器框架 · 右侧详情 · ① 草稿参数视图
 *
 *  空选（没有任何选中片段）时展示：可编辑草稿名称 + 四项只读
 *  工程参数（比例 / 画布宽高 / 分辨率 / 帧率）。此视图没有手动
 *  页签——右栏显示哪一类视图完全由当前选中片段类型决定。
 *
 *  比例 / 画布宽高与播放器比例菜单联动：固定比例按短边 1080 换算；
 *  「适应（原始）」直接使用主轨第一个资源大小，没有主轨资源时 1600×9000。
 * ============================================================ */
import type { DetailData } from '../index'
import { t } from '../../lang'

/** 草稿分辨率 / 帧率（工程导出参数，当前固定） */
const DRAFT_RESOLUTION = '1080P'
const DRAFT_FPS = '30 fps'

/** 草稿画布短边基准像素（1080P 工程，长边随比例换算） */
export const DRAFT_CANVAS_SHORT_EDGE = 1080

/** 行结构（与其它视图的只读行一致） */
type RowFn = (k: string, vHtml: string) => string

/** 草稿参数：名称可编辑，其余四项只读（比例 / 画布来自 data，随播放器联动） */
export function renderDraft(row: RowFn, data: DetailData, canExport: boolean): string {
  return `
    ${row('草稿名称', '<input class="ed-input" style="max-width:150px" data-role="title-input" />')}
    ${row('比例', data.ratioLabel)}
    ${row('画布宽高', `${data.canvasW} × ${data.canvasH}`)}
    ${row('分辨率', DRAFT_RESOLUTION)}
    ${row('帧率', DRAFT_FPS)}
    <div class="ed-draft-actions">
      <button type="button" class="ed-export-video" data-role="export-video" ${canExport ? '' : 'disabled'}>
        ${t('detail.exportVideo')}
      </button>
    </div>
  `
}

/** 时间线是否有可导出片段时开关按钮（隐藏片段不计，与导出守卫同口径） */
export function setDraftExportEnabled(host: HTMLElement, enabled: boolean): void {
  const btn = host.querySelector<HTMLButtonElement>('[data-role="export-video"]')
  if (btn) btn.disabled = !enabled
}

/**
 * 按画面宽高比换算草稿画布像素（1080P 工程，短边锁定 1080，取偶数像素）：
 * 横屏（ratio≥1）高 1080、宽随比例；竖屏宽 1080、高随比例。
 * 「5.8 寸」预设固定 1125×2436（iPhone 设备原生逻辑分辨率）。
 * 注意：固定预设由调用方按比率换算；「适应（原始）」由播放器直接发实际宽高。
 */
export function draftCanvasSize(key: string, ratio: number): { w: number; h: number } {
  if (key === '5.8') return { w: 1125, h: 2436 }
  const even = (n: number) => 2 * Math.round(n / 2)
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { w: DRAFT_CANVAS_SHORT_EDGE, h: DRAFT_CANVAS_SHORT_EDGE }
  }
  return ratio >= 1
    ? { w: even(DRAFT_CANVAS_SHORT_EDGE * ratio), h: DRAFT_CANVAS_SHORT_EDGE }
    : { w: DRAFT_CANVAS_SHORT_EDGE, h: even(DRAFT_CANVAS_SHORT_EDGE / ratio) }
}

/** 绑定草稿名称输入（输入即回写数据层，面板重绘后保留已编辑值） */
export function bindDraft(
  host: HTMLElement,
  data: DetailData,
  onTitleChange: (title: string) => void,
  onExport: () => void
): void {
  const input = host.querySelector<HTMLInputElement>('[data-role="title-input"]')
  if (input) {
    input.value = data.title
    input.addEventListener('input', () => {
      onTitleChange(input.value || '未命名草稿')
    })
  }
  const exportBtn = host.querySelector<HTMLButtonElement>('[data-role="export-video"]')
  exportBtn?.addEventListener('click', () => {
    if (!exportBtn.disabled) onExport()
  })
}
