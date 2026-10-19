import type { FrameworkType, ContainerInstance } from './types'
import { getAdapter, registerAdapter } from './adapters'

/**
 * CutContainer - 多框架通用页面容器
 *
 * 基于原生 Web Component (Custom Element + Shadow DOM) 实现，
 * 支持 Vue / React / Svelte / Solid / PixiJS / MediaBunny 等多种框架。
 *
 * 通信模型：
 * - 父→子: container.props = { ... }
 * - 子→父: container.addEventListener('eventName', handler)
 * - 插槽: 通过 shadow DOM 的 slot 机制
 */
export class CutContainer extends HTMLElement {
  /** Shadow Root */
  private _shadow: ShadowRoot

  /** 内部属性存储 */
  private _props: Record<string, any> = {}

  /** 当前框架实例 */
  private _instance: ContainerInstance | null = null

  /** 当前挂载的框架类型 */
  private _framework: FrameworkType | null = null

  /** 当前组件 */
  private _component: any = null

  /** 挂载目标容器元素 */
  private _rootEl: HTMLDivElement | null = null

  static get observedAttributes() {
    return ['framework', 'title', 'theme']
  }

  constructor() {
    super()
    this._shadow = this.attachShadow({ mode: 'open' })
    this._rootEl = document.createElement('div')
    this._rootEl.style.width = '100%'
    this._rootEl.style.height = '100%'
    this._rootEl.id = 'uc-root'
    this._shadow.appendChild(this._rootEl)
  }

  // ==================== 属性 (Attribute) 监听 ====================

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return

    switch (name) {
      case 'framework':
        // 仅当已经有组件时才重新挂载
        if (this._component) {
          this._doMount(newValue as FrameworkType, this._component)
        }
        break
      case 'title':
      case 'theme':
        // 同步到 props
        this._props[name] = newValue
        if (this._instance?.update) {
          this._instance.update(this._props)
        }
        break
    }
  }

  // ==================== Props (Property) ====================

  /**
   * 设置属性（支持对象、数组等复杂类型）
   * 外部框架直接通过 .props = {} 传参
   */
  set props(value: Record<string, any>) {
    this._props = { ...this._props, ...value }
    // 如果实例已挂载，触发更新
    if (this._instance?.update) {
      this._instance.update(this._props)
    }
  }

  get props(): Record<string, any> {
    return this._props
  }

  // ==================== 当前实例（只读）====================

  get instance(): ContainerInstance | null {
    return this._instance
  }

  get framework(): FrameworkType | null {
    return this._framework
  }

  // ==================== 核心方法 ====================

  /**
   * 挂载指定框架的组件
   * @param framework 框架类型
   * @param Component 组件构造函数或配置
   */
  async mount(framework: FrameworkType, Component: any): Promise<void> {
    this._framework = framework
    this._component = Component
    await this._doMount(framework, Component)
  }

  /**
   * 执行实际的挂载逻辑
   */
  private async _doMount(framework: FrameworkType, Component: any): Promise<void> {
    // 先销毁旧实例
    this._unmount()

    if (!this._rootEl) {
      this._rootEl = document.createElement('div')
      this._rootEl.id = 'uc-root'
      this._shadow.appendChild(this._rootEl)
    }

    // 清空容器
    this._rootEl.innerHTML = ''

    const adapter = getAdapter(framework)

    // 事件转发函数
    const emit = (eventName: string, detail: any) => {
      this.dispatchEvent(
        new CustomEvent(eventName, {
          detail,
          bubbles: false,
          composed: true // 允许事件穿透 shadow DOM
        })
      )
    }

    // 调用适配器挂载
    try {
      this._instance = await adapter.mount(this._rootEl, Component, this._props, emit)
    } catch (error) {
      console.error(`[CutContainer] 挂载 ${framework} 组件失败:`, error)
      this._rootEl.innerHTML = `
        <div style="
          padding: 20px;
          color: #e53e3e;
          background: #fff5f5;
          border: 1px solid #feb2b2;
          border-radius: 8px;
          font-family: sans-serif;
          font-size: 14px;
        ">
          <strong>⚠️ 挂载失败</strong><br/>
          框架: ${framework}<br/>
          错误: ${error instanceof Error ? error.message : String(error)}
        </div>
      `
      this._instance = null
    }
  }

  /**
   * 卸载当前组件
   */
  unmount(): void {
    this._unmount()
    this._framework = null
    this._component = null
  }

  /**
   * 内部卸载逻辑（不清空 framework 和 component 引用）
   */
  private _unmount(): void {
    if (this._instance?.destroy) {
      try {
        this._instance.destroy()
      } catch (e) {
        console.warn('[CutContainer] 销毁实例时出错:', e)
      }
      this._instance = null
    }
  }

  // ==================== 生命周期 ====================

  connectedCallback() {
    // 元素被插入 DOM 时
    this.dispatchEvent(new CustomEvent('connected', { detail: { element: this } }))
  }

  disconnectedCallback() {
    // 元素被移除时清理
    this._unmount()
    this.dispatchEvent(new CustomEvent('disconnected', { detail: {} }))
  }

  adoptedCallback() {
    // 元素被移动到新文档时
  }
}

// 全局注册自定义元素
if (typeof customElements !== 'undefined' && !customElements.get('cut-container')) {
  customElements.define('cut-container', CutContainer)
}

// 导出注册方法（供用户手动注册）
export function defineCutContainer(tagName: string = 'cut-container'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, CutContainer)
  }
}

export { registerAdapter }
export default CutContainer
