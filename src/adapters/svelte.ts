import type { FrameworkAdapter, ContainerInstance } from '../types'

/**
 * Svelte 框架适配器
 */
export const svelteAdapter: FrameworkAdapter = {
  async mount(rootEl, Component, props, emit) {
    // Svelte 组件直接 new
    const svelteComponent = new Component({
      target: rootEl,
      props: props
    })

    // 转发所有自定义事件：Svelte 组件内 dispatch('eventName', data)
    const forwardEvent = (event: any) => {
      emit(event.type, event.detail)
    }

    // 监听常见事件 + 通配符（Svelte 原生不支持*，这里监听已知事件名列表）
    const knownEvents = ['submit', 'change', 'click', 'close', 'update', 'message']
    knownEvents.forEach(name => {
      svelteComponent.$on(name, (e: any) => emit(name, e.detail ?? e))
    })

    // 也支持通过自定义 $emit 方式
    ;(svelteComponent as any).$on?.('emitWrapper', (e: any) => {
      if (e.detail?.name) {
        emit(e.detail.name, e.detail.data)
      }
    })

    const instance: ContainerInstance = {
      update(newProps) {
        svelteComponent.$set(newProps)
      },
      destroy() {
        svelteComponent.$destroy()
      },
      raw: svelteComponent
    }

    return instance
  }
}
