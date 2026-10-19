/**
 * 通用容器类型定义
 */

/** 内置支持的框架类型（dom 用于编辑器页面等原生组件挂载） */
export type FrameworkType = 'vue' | 'react' | 'svelte' | 'solid' | 'dom'

/** 任意框架名（支持自定义扩展） */
export type FrameworkName = FrameworkType | string

/** 容器实例接口 - 每个框架适配器都需实现 mount / update / destroy */
export interface ContainerInstance {
  /** 更新 props */
  update: (props: Record<string, any>) => void
  /** 销毁实例 */
  destroy: () => void
  /** 原始实例（可选，用于调试或扩展） */
  raw?: any
}

/** 框架适配器接口 */
export interface FrameworkAdapter {
  /**
   * 挂载组件到目标元素
   * @param rootEl 挂载目标 DOM 元素
   * @param Component 组件构造函数或配置
   * @param props 初始属性
   * @param emit 事件发射函数（子→父）
   */
  mount(
    rootEl: HTMLElement,
    Component: any,
    props: Record<string, any>,
    emit: (eventName: string, detail: any) => void
  ): ContainerInstance | Promise<ContainerInstance>
}

/** 通用容器元素扩展属性 */
export interface CutContainerElement extends HTMLElement {
  /** 传入属性对象 */
  props: Record<string, any>
  /** 当前挂载的实例 */
  instance: ContainerInstance | null
  /** 当前挂载的框架名 */
  framework: string | null
  /**
   * 挂载指定框架的组件
   * @param framework 框架类型
   * @param Component 组件
   */
  mount(framework: FrameworkName, Component: any): Promise<void>
  /** 卸载当前组件 */
  unmount(): void
}

/** 全局事件名前缀（子组件统一使用） */
declare global {
  interface HTMLElementEventMap {
    [key: string]: CustomEvent<any>
  }
}

export {}
