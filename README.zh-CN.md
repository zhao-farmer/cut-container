# CutContainer

[English](README.md) | **简体中文**

一个剪映风格的视频编辑器，封装为与框架无关的 Web Component。可以直接放入原生 HTML，也可以在 Vue、React、Svelte、Solid 中使用；编辑器本身不依赖任何前端框架运行时。

## 安装

```bash
npm install cut-container
```

`pixi.js` 和 `mediabunny` 会作为依赖自动安装。发布包同时提供 ES module 和经典脚本：

```text
dist/   经典 <script> 构建与浏览器全局版 mediabunny
lib/    ES module 构建
```

视频解码与 MP4 导出需要支持 WebCodecs 的 Chrome / Edge。

## 使用方式

### 原始 HTML — 经典脚本

```html
<div id="app" style="width: 100%; height: 100vh"></div>

<script src="https://cdn.jsdelivr.net/npm/pixi.js@8.12.0/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container/dist/vendor/mediabunny.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container/dist/cut-container.min.js"></script>
<script>
  const app = CutContainer.createApp({ host: '#app' })
  app.mount()
</script>
```

经典构建暴露全局 `CutContainer`，并读取全局 `PIXI` 与 `Mediabunny`，与 `pixi.js` / `pixi.mjs` 的分工一致。

### 原始 HTML — ES module

```html
<div id="app" style="width: 100%; height: 100vh"></div>

<script type="importmap">
{
  "imports": {
    "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.12.0/dist/pixi.min.mjs",
    "mediabunny": "https://cdn.jsdelivr.net/npm/mediabunny@1.50.8/dist/bundles/mediabunny.min.mjs"
  }
}
</script>
<script type="module">
  import { createApp } from 'https://cdn.jsdelivr.net/npm/cut-container/lib/cut-container.min.mjs'

  const app = createApp({ host: '#app' })
  await app.mount()
</script>
```

ES module 构建通过 bare import 解析 `pixi.js` / `mediabunny`，适用于 import map、Vite、webpack 等模块环境。

### Vue 3

```vue
<template>
  <div ref="host" class="editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createApp, type EditorAppHandle } from 'cut-container'

const host = ref<HTMLDivElement | null>(null)
let app: EditorAppHandle | null = null

onMounted(async () => {
  app = createApp({ host: host.value! })
  await app.mount()
})

onBeforeUnmount(() => app?.unmount())
</script>

<style scoped>
.editor { width: 100%; height: 100vh; }
</style>
```

### React

```tsx
import { useEffect, useRef } from 'react'
import { createApp, type EditorAppHandle } from 'cut-container'

export default function Editor() {
  const host = useRef<HTMLDivElement>(null)
  const appRef = useRef<EditorAppHandle | null>(null)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const app = createApp({ host: host.current! })
      appRef.current = app
      await app.mount()
      if (disposed) app.unmount()
    })()
    return () => {
      disposed = true
      appRef.current?.unmount()
    }
  }, [])

  return <div ref={host} style={{ width: '100%', height: '100vh' }} />
}
```

### Svelte

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { createApp, type EditorAppHandle } from 'cut-container'

  let host: HTMLDivElement
  let app: EditorAppHandle | undefined

  onMount(() => {
    void (async () => {
      app = createApp({ host })
      await app.mount()
    })()
    return () => app?.unmount()
  })
</script>

<div bind:this={host} class="editor"></div>

<style>
  .editor { width: 100%; height: 100vh; }
</style>
```

### Solid

```tsx
import { onCleanup, onMount } from 'solid-js'
import { createApp, type EditorAppHandle } from 'cut-container'

export default function Editor() {
  let host!: HTMLDivElement
  let app: EditorAppHandle | undefined

  onMount(() => {
    void (async () => {
      app = createApp({ host })
      await app.mount()
    })()
  })
  onCleanup(() => app?.unmount())

  return <div ref={host} style={{ width: '100%', height: '100vh' }} />
}
```

### 便捷挂载

只挂载一次时，可以使用 `mountEditor`，它会自动创建 `<cut-container>`：

```ts
import { mountEditor } from 'cut-container'

await mountEditor(document.getElementById('app')!, {
  title: '我的工程',
  lang: 'zh'
})
```

## 配置项

`createApp()` 支持以下选项：

| 选项 | 类型 | 说明 |
|---|---|---|
| `host` | `string \| HTMLElement` | 必填，容器选择器或元素 |
| `config` | `EditorUserConfig \| string` | 初始配置对象或 URL；传 URL 时 `mount()` 会自动加载 |
| `lang` | `'zh' \| 'en'` | 初始语言 |
| `tabs` | `string[]` | 素材库显示的选项卡及顺序 |
| `fetchOptions` | `RequestInit` | 加载配置 URL 时的 fetch 参数 |
| `onImportTracks` | `() => config \| tracks \| null \| Promise<...>` | 挂载前及调用 `importTracks()` 时执行 |
| `onExportTracks` | `(project) => void \| Promise<void>` | 调用 `exportTracks()` 时执行，参数为当前工程 |

`EditorUserConfig` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `string` | 工程名称 |
| `materials` | `object` | 素材库数据（`material`、`audio`、`text`、`caption`、`sticker`、`filter`、`effect`、`transition`） |
| `tracks` | `array` | 时间线轨道数据 |
| `lang` | `'zh' \| 'en'` | 编辑器语言（也兼容 `language`） |
| `tabs` | `string[]` | 显示的素材选项卡：`material`、`audio`、`text`、`caption`、`sticker`、`filter`、`effect`、`transition` |
| `backend` | `object` | 可选的后端配置 |

### 先加载外部配置再挂载

```ts
import { createApp } from 'cut-container'

const app = createApp({ host: '#app' })

await app.loadConfig('/editor-config.json') // URL 或对象
await app.mount()

// app.unmount()
// app.getConfig()
// app.element
```

`loadConfig()` 可以多次调用，配置会逐层合并。使用 `config: '/editor-config.json'` 时，`mount()` 会自动加载该 URL。传入 `materials` 或 `tracks` 时，会覆盖本地工程缓存。

### 配置示例

```json
{
  "title": "外部配置示例",
  "lang": "zh",
  "tabs": ["material", "audio", "text", "caption"],
  "backend": {
    "mode": "remote",
    "baseUrl": "https://api.example.com",
    "timeoutMs": 8000,
    "endpoints": {
      "catalog": "/v1/media",
      "upload": "/v1/upload",
      "delete": "/v1/media/{id}",
      "config": "/v1/draft-config"
    }
  }
}
```

### 后端配置

`backend.mode` 决定编辑器怎么和后端打交道：

| 模式 | 素材目录 / 配置 | 导入时的上传 | 删除 / 重命名 |
|---|---|---|---|
| `local`（默认） | 完全不请求 | 只存本地（IndexedDB） | 只改本地 |
| `remote` | 从后端拉 | 上传到后端 | 调用后端接口 |
| `hybrid` | 只做 GET 拉取 | 只存本地 | 只改本地 |

后端只负责托管素材库时用 `hybrid`：目录从后端读，导入 / 删除 / 重命名都不会写回后端，全部留在浏览器里。

```json
{ "backend": { "mode": "hybrid", "baseUrl": "https://api.example.com" } }
```

| 字段 | 说明 |
|---|---|
| `mode` | `local` \| `remote` \| `hybrid`（见上表） |
| `enabled` | 旧开关；不写 `mode` 时 `enabled: true` 等价于 `remote` |
| `baseUrl` | 相对接口路径的前缀 |
| `timeoutMs` | 请求超时；`0` 表示不超时 |
| `endpoints.catalog` | 素材目录 JSON |
| `endpoints.upload` | multipart 上传接口 |
| `endpoints.delete` | 删除接口，支持 `{id}` / `:id` 占位符 |
| `endpoints.config` | 远程草稿配置 |

也支持扁平字段 `catalogUrl` / `uploadUrl` / `deleteUrl` / `configUrl`。相对路径会拼接 `baseUrl`，绝对 `http(s)` 地址原样使用；如果删除接口没有占位符，会自动追加 `/{id}`。

也可以在挂载前设置全局配置：

```html
<script>
  window.CUT_CONTAINER_CONFIG = {
    mode: 'hybrid',
    baseUrl: 'http://localhost:3001',
    timeoutMs: 8000
  }
</script>
```

### 导入 / 导出工程回调

```ts
const app = createApp({
  host: '#app',
  onImportTracks: async () => (await fetch('/tracks.json')).json(),
  onExportTracks: async project => {
    await fetch('/save-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    })
  }
})

await app.mount()

await app.importTracks()
const project = await app.exportTracks() // { title, materials, tracks }
```

### App 实例方法

| 方法 / 属性 | 说明 |
|---|---|
| `loadConfig(source)` | 加载配置 URL 或对象并合并 |
| `mount(overrides?)` | 创建并挂载编辑器 |
| `importTracks()` | 执行 `onImportTracks` 并应用结果 |
| `exportTracks()` | 读取当前工程并执行 `onExportTracks` |
| `unmount()` | 销毁当前编辑器 |
| `getConfig()` | 当前合并后的配置 |
| `element` | 已挂载的 `<cut-container>` 元素，未挂载为 `null` |

### 语言

```ts
import { mountEditor, setLang } from 'cut-container'

setLang('zh') // 全局偏好，写入 localStorage
await mountEditor(document.getElementById('app')!, { lang: 'zh' })
```

单次传入的 `lang` 优先级高于全局设置。

## 使用与快捷键

典型流程：

1. 从左侧素材面板导入视频、图片、音频、字幕或字体。
2. 点击素材卡片上的 **+**，或把素材拖到轨道。
3. 拖动片段边缘裁剪，拖动片段调整顺序，使用分割 / 删除等操作。
4. 选中文字或贴纸后，可修改内容、位置、缩放、不透明度和样式。
5. 在播放器中切换画布比例；**适应（原始）** 会跟随主轨第一个资源的大小。
6. 点击右栏「导出视频」，或按 `Ctrl / ⌘ + E` 导出。

快捷键：

| 快捷键 | 功能 |
|---|---|
| `Ctrl / ⌘ + C` | 复制选中片段 |
| `Ctrl / ⌘ + X` | 剪切选中片段 |
| `Ctrl / ⌘ + V` | 粘贴片段 |
| `Delete` / `Backspace` | 删除选中片段 |
| `Alt + ← / →` | 选中片段前后移动一帧 |
| `M` | 在播放头位置添加 / 移除标记 |
| `Ctrl / ⌘ + E` | 导出视频 |
| `Space` | 全屏播放器中播放 / 暂停 |
| `← / →` | 全屏播放器中快退 / 快进 5 秒 |
| `Shift + ← / →` | 全屏播放器中逐帧后退 / 前进 |
| `Esc` | 关闭弹窗 / 菜单，或退出文字编辑 |

说明：

- 输入框、文本域、contenteditable 内不会触发片段编辑快捷键。
- 全屏快捷键仅在播放器全屏时生效。
- 调整文字时会自动暂停播放，避免播放头走出文字片段导致文字消失。
- 工程和素材数据会自动保存到 `localStorage`；本地导入的文件保存在 IndexedDB。
- 设置过封面后，导出的 MP4 会把封面写进文件元信息（moov/udta/meta/ilst/covr），同时写入草稿标题——播放器和文件管理器显示的是这张封面图，而不是首帧。

## 致谢

编辑器的画面渲染与视频处理分别依赖两个优秀的开源项目，感谢它们的作者与贡献者。

### pixi.js

[pixi.js](https://github.com/pixijs/pixijs) v8 负责时间轴与播放器的全部画面绘制：

| 用在哪里 | 具体做什么 |
|---|---|
| `src/editor/timeline/canvas/` | 时间轴渲染：轨道、片段、缩略格、波形、播放头、滚动条 |
| `src/editor/timeline/canvas/render.ts` | 图层合成、遮罩、封面按钮、拖拽虚影 |
| `src/editor/timeline/canvas/waveformRenderer.ts` | 用 `CanvasSource` 烘焙波形纹理 |
| `src/editor/player/` | 播放器舞台：视频 / 图片精灵、变换、滤镜、覆盖层 |

### mediabunny

[mediabunny](https://github.com/Vanilagy/mediabunny) v1.50 负责解码、抽帧与 MP4 封装：

| 用在哪里 | 具体做什么 |
|---|---|
| `src/editor/codec/timelineExporter.ts` | MP4 封装、元信息写入（封面 `covr`、标题） |
| `src/editor/codec/timelineFrameExtractor.ts` | 缩略图与封面编辑器的精确抽帧 |
| `src/editor/codec/timelineMedia.ts` | 视频 / GIF 帧缓存、音频解码 |
| `src/editor/player/` | 基于 WebCodecs 的播放解码 |

两个项目都是 MIT 协议；如果你用这个编辑器做了东西，欢迎去给它们的仓库点个 Star。

## License

MIT，详见 [LICENSE](LICENSE)。

