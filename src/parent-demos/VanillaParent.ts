/* ============================================================
 *  外部原生（Vanilla）应用 —— 纯数据传递层，无框架运行时。
 *  只负责创建 <cut-container>，传入素材 / 轨道数据并挂载编辑器；
 *  返回卸载函数，供父层切换框架时清理。
 * ============================================================ */
import '../cutContainer'
import createEditorPage from '../editor/editorPage'
import { MATERIALS, TRACKS, DRAFT_TITLE } from './externalData'

export function mountVanillaParent(target: HTMLElement): () => void {
  const el = document.createElement('cut-container') as HTMLElement & {
    props?: Record<string, unknown>
    mount?: (mode: string, factory: unknown) => Promise<void>
    unmount?: () => void
  }
  el.className = 'external-host'
  el.style.display = 'block'
  el.style.width = '100%'
  el.style.height = '100%'
  target.appendChild(el)

  // 外部应用只做一件事：传递素材原始数据 + 轨道操作数据
  el.props = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }
  void el.mount?.('dom', createEditorPage)

  return () => {
    el.unmount?.()
    el.remove()
  }
}

export default mountVanillaParent
