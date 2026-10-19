import type { FrameworkAdapter, ContainerInstance } from '../types'
import type { Component } from 'vue'

/**
 * Vue 3 框架适配器
 */
export const vueAdapter: FrameworkAdapter = {
  async mount(rootEl, Comp, props, emit) {
    const { createApp, h, getCurrentInstance } = await import('vue')

    // 创建一个 provide 响应式的 props 方案：使用 reactive 对象
    const { reactive } = await import('vue')
    const reactiveProps = reactive({ ...props })

    // 包装组件，注入 $emitWrapper
    const WrappedComponent = {
      setup(_: any, { slots }: any) {
        const instance = getCurrentInstance()
        if (instance) {
          // 在 setup 中挂到 proxy 上，供选项式 API 使用
          ;(instance.proxy as any).$emitWrapper = emit
        }
        return () => h(Comp as any, reactiveProps, slots)
      }
    }

    const app = createApp(WrappedComponent)
    app.config.globalProperties.$emitWrapper = emit
    app.mount(rootEl)

    const instance: ContainerInstance = {
      update(newProps: Record<string, any>) {
        // 合并到 reactive props，触发响应式更新
        Object.assign(reactiveProps, newProps)
      },
      destroy() {
        app.unmount()
      },
      raw: app
    }

    return instance
  }
}
