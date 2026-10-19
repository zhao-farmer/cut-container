// 统一入口文件
export { CutContainer, defineCutContainer, registerAdapter } from './cutContainer'
export type { FrameworkType, ContainerInstance, FrameworkAdapter, CutContainerElement } from './types'

// 框架适配器按需直接引入（发布产物默认只注册 dom，避免把整套框架打进 npm 包）
export { vueAdapter } from './adapters/vue'
export { reactAdapter } from './adapters/react'
export { svelteAdapter } from './adapters/svelte'
export { solidAdapter } from './adapters/solid'
export { domAdapter } from './adapters/dom'
export { registerAdapter as registerFrameworkAdapter } from './adapters'
