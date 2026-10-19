/** @jsxImportSource solid-js */
/**
 * 外部 Solid 应用 —— 纯数据传递层。
 * 不实现编辑页面：只渲染 cut-container，挂载框架内编辑器页面并传入两类数据。
 */
import { onMount, onCleanup } from 'solid-js'
import '../cutContainer'
import createEditorPage from '../editor/editorPage'
import { MATERIALS, TRACKS, DRAFT_TITLE } from './externalData'

export function SolidParent() {
  let containerRef: CutContainerElement | undefined

  onMount(async () => {
    const el = containerRef as any
    if (!el) return
    // 外部框架只做一件事：传递素材原始数据 + 轨道操作数据
    el.props = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }
    await el.mount('dom', createEditorPage)
  })

  onCleanup(() => {
    const el = containerRef as any
    if (el) el.unmount()
  })

  return (
    <cut-container
      ref={el => (containerRef = el)}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}

export default SolidParent
