/**
 * Web Component 的 JSX 类型声明
 *
 * <cut-container> 是通过 customElements.define() 命令式注册的自定义元素，
 * 并非 React/Solid 组件，因此 TS 的 JSX.IntrinsicElements 中没有它的类型，
 * 在 .tsx / .solid.tsx 中直接书写会报 TS2339（运行时不受影响）。
 * 这里分别为 React（全局 JSX 命名空间）与 Solid（solid-js 模块内 JSX 命名空间）补声明。
 */
import type * as React from 'react'
import type { JSX as SolidJSX } from 'solid-js'

// React：普通 .tsx 使用全局 JSX 命名空间
declare global {
  /** 容器暴露给宿主的命令式 API（与 cutContainer.ts 保持一致），全局可用无需 import */
  interface CutContainerElement extends HTMLElement {
    mount: (framework: string, component: any, props?: Record<string, any>) => Promise<void> | void
    unmount: () => void
    props: Record<string, any>
  }

  namespace JSX {
    interface IntrinsicElements {
      'cut-container': React.DetailedHTMLProps<
        React.HTMLAttributes<CutContainerElement>,
        CutContainerElement
      >
    }
  }
}

// Solid：.solid.tsx 通过 jsxImportSource=solid-js 使用 solid-js 内的 JSX 命名空间
declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'cut-container': SolidJSX.HTMLAttributes<CutContainerElement>
    }
  }
}
