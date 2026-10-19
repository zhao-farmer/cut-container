import type { FrameworkAdapter, ContainerInstance } from '../types'

/**
 * SolidJS 框架适配器
 */
export const solidAdapter: FrameworkAdapter = {
  async mount(rootEl, Component, props, emit) {
    const { render } = await import('solid-js/web')

    let dispose: (() => void) | null = null

    const doRender = (currentProps: Record<string, any>) => {
      if (dispose) {
        dispose()
      }
      dispose = render(
        () =>
          Component({
            ...currentProps,
            onEvent: emit
          }),
        rootEl
      )
    }

    doRender(props)

    const instance: ContainerInstance = {
      update(newProps) {
        doRender(newProps)
      },
      destroy() {
        if (dispose) {
          dispose()
          dispose = null
        }
      },
      raw: dispose
    }

    return instance
  }
}
