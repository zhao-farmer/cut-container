/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*.svelte' {
  import type { SvelteComponent } from 'svelte'
  const component: typeof SvelteComponent
  export default component
}

// 为 pixi.js 的全局引用补充类型
declare interface Window {
  PIXI: any
}
