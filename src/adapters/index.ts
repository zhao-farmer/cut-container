import type { FrameworkAdapter } from '../types'
import { domAdapter } from './dom'

/**
 * 内置适配器注册表。
 * 编辑器发布产物只需要 dom 适配器；Vue / React / Svelte / Solid 的父应用直接
 * 用 `<cut-container>` + mount('dom', createEditorPage) 即可，避免把四个框架
 * 一起打进 npm 包。需要原生框架适配器时用 registerAdapter 注册。
 */
const adapters: Record<string, FrameworkAdapter> = {
  dom: domAdapter
}

/**
 * 注册自定义框架适配器
 */
export function registerAdapter(framework: string, adapter: FrameworkAdapter) {
  adapters[framework] = adapter
}

/**
 * 获取指定框架的适配器
 */
export function getAdapter(framework: string): FrameworkAdapter {
  const adapter = adapters[framework]
  if (!adapter) {
    throw new Error(`[CutContainer] 不支持的框架类型: ${framework}，支持的类型: ${Object.keys(adapters).join(', ')}`)
  }
  return adapter
}

export { adapters }
export { domAdapter }
