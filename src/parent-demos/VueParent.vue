<template>
  <!-- 外部 Vue 应用：不实现任何编辑页面，只负责把数据传给框架容器 -->
  <cut-container ref="containerRef" class="external-host"></cut-container>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import '../cutContainer'
import createEditorPage from '../editor/editorPage'
import { MATERIALS, TRACKS, DRAFT_TITLE } from './externalData'

const containerRef = ref<any>(null)

onMounted(async () => {
  const el = containerRef.value
  if (!el) return
  // 外部框架只做一件事：传递素材原始数据 + 轨道操作数据
  el.props = { title: DRAFT_TITLE, materials: MATERIALS, tracks: TRACKS }
  await el.mount('dom', createEditorPage)
})

onBeforeUnmount(() => {
  containerRef.value?.unmount()
})
</script>

<style scoped>
.external-host {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
