import type { FrameworkAdapter, ContainerInstance } from '../types'

/**
 * React 框架适配器
 */
export const reactAdapter: FrameworkAdapter = {
  async mount(rootEl, Component, props, emit) {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')

    const root = createRoot(rootEl)

    const render = (currentProps: Record<string, any>) => {
      root.render(
        React.createElement(Component, {
          ...currentProps,
          // 统一事件回调：props.onEvent('name', data)
          onEvent: emit,
          // 也支持每个事件名直接调用
          onSubmit: (data: any) => emit('onSubmit', data),
          onChange: (data: any) => emit('onChange', data),
          onClick: (data: any) => emit('onClick', data)
        })
      )
    }

    render(props)

    const instance: ContainerInstance = {
      update(newProps) {
        render(newProps)
      },
      destroy() {
        root.unmount()
      },
      raw: root
    }

    return instance
  }
}
