import type { FrameworkAdapter, ContainerInstance } from '../types'

/**
 * 通用 DOM 页面适配器
 *
 * 适用于任何基于 DOM 的页面/场景（Pixi + MediaBunny 混合、纯 JS 页面等）
 * Component 是一个工厂函数：(rootEl, props, emit) => { update, destroy }
 *
 * 这是最灵活的适配器——你可以在页面工厂函数内部做任何事：
 *  - 初始化 PixiJS 画布
 *  - 初始化 MediaBunny 播放器
 *  - 操作 DOM
 *  - 加载第三方库
 */
export const domAdapter: FrameworkAdapter = {
  async mount(rootEl, Component, props, emit) {
    // 设置根容器样式
    rootEl.style.width = '100%'
    rootEl.style.height = '100%'
    rootEl.style.overflow = 'hidden'

    let instance: any = null

    if (typeof Component === 'function') {
      // 工厂函数模式
      instance = Component(rootEl, props, emit)
    } else if (typeof Component === 'string') {
      // HTML 字符串模式
      rootEl.innerHTML = Component
      instance = {
        update() { /* HTML 字符串不支持更新 */ },
        destroy() { rootEl.innerHTML = '' }
      }
    } else {
      throw new Error('[domAdapter] Component 必须是工厂函数或 HTML 字符串')
    }

    // 等待异步初始化（如果 instance 是 Promise）
    if (instance && typeof instance.then === 'function') {
      instance = await instance
    }

    const containerInstance: ContainerInstance = {
      update(newProps) {
        if (instance && typeof instance.update === 'function') {
          instance.update(newProps)
        }
      },
      destroy() {
        if (instance && typeof instance.destroy === 'function') {
          instance.destroy()
        }
        rootEl.innerHTML = ''
      },
      raw: instance
    }

    return containerInstance
  }
}

export default domAdapter
