/**
 * 外部 React 应用 —— 纯数据传递层。
 * 不实现编辑页面：只渲染 cut-container，挂载框架内编辑器页面并传入两类数据。
 */
import React, { useRef, useEffect } from 'react'
import '../cutContainer'
import createEditorPage from '../editor/editorPage'
import { MATERIALS, TRACKS, DRAFT_TITLE } from './externalData'

export function ReactParent() {
  const containerRef = useRef<CutContainerElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // 外部框架只做一件事：传递素材原始数据 + 轨道操作数据
    el.props = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }
    el.mount('dom', createEditorPage as any)

    return () => {
      el.unmount()
    }
  }, [])

  return <cut-container ref={containerRef} style={{ display: 'block', width: '100%', height: '100%' }} />
}

export default ReactParent
