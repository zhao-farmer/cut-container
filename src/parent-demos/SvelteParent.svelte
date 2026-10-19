<!--
  外部 Svelte 应用 —— 纯数据传递层。
  不实现编辑页面：只渲染 cut-container，挂载框架内编辑器页面并传入两类数据。
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import '../cutContainer'
  import createEditorPage from '../editor/editorPage'
  import { MATERIALS, TRACKS, DRAFT_TITLE } from './externalData'

  let containerEl: HTMLElement | null = null

  onMount(async () => {
    if (!containerEl) return
    // 外部框架只做一件事：传递素材原始数据 + 轨道操作数据
    ;(containerEl as any).props = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }
    await (containerEl as any).mount('dom', createEditorPage)
  })

  onDestroy(() => {
    containerEl && (containerEl as any).unmount()
  })
</script>

<cut-container bind:this={containerEl} class="external-host"></cut-container>

<style>
  .external-host {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
