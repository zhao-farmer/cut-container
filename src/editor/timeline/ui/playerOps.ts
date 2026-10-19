/* ============================================================
 *  时间轴工具栏 · 播放器操作（占位，未实现）
 *  定格 / 倒放 / 裁剪 三按钮：参考实现亦无此能力，
 *  点击仅给「功能开发中」轻提示。不新增任何 UI。
 * ============================================================ */

const PLAYER_OPS = new Set(['freeze', 'reverse', 'crop'])

export interface PlayerOpsDeps {
  toast: (msg: string) => void
}

export function bindPlayerOps(shell: HTMLElement, deps: PlayerOpsDeps): void {
  shell.querySelectorAll<HTMLButtonElement>('button[data-op]').forEach(btn => {
    if (!PLAYER_OPS.has(btn.dataset.op || '')) return
    btn.addEventListener('click', () => {
      deps.toast(`「${btn.dataset.tip}」功能开发中`)
    })
  })
}
