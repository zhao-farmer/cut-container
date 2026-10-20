# CutContainer

**English** | [简体中文](#简体中文)

A CapCut-style video editor packaged as a framework-agnostic Web Component. Drop `<cut-container>` into a vanilla page, Vue, React, Svelte or Solid app — no framework runtime is required by the editor itself.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| UI | Web Components + Shadow DOM |
| Build | Vite 5 |
| Playback & compositing | pixi.js 8.12 |
| Decoding / MP4 export | mediabunny 1.50.8 + WebCodecs |
| Audio | Web Audio API |
| Persistence | versioned `localStorage` (projects, materials, local files in IndexedDB) |
| Optional backend | zero-dependency Node service for media catalog, uploads and Range requests |

The editor renders and composites everything in the browser. `pixi.js` and `mediabunny` stay external dependencies, so an app can load them from npm, a CDN, or an import map.

## Installation

```bash
npm install cut-container
```

`pixi.js` and `mediabunny` are installed automatically as dependencies. The published package ships as ES modules plus classic IIFE scripts:

```text
dist/   classic <script> builds and the browser-global mediabunny
lib/    ES module builds
```

Requirements: a WebCodecs-capable Chrome or Edge for video decoding and MP4 export.

## Usage

### Vanilla HTML — classic script

```html
<div id="app" style="width: 100%; height: 100vh"></div>

<script src="https://cdn.jsdelivr.net/npm/pixi.js@8.12.0/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container@0.0.2/dist/vendor/mediabunny.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container@0.0.2/dist/cut-container.min.js"></script>
<script>
  const app = CutContainer.createApp({ host: '#app' })
  app.mount()
</script>
```

The classic build exposes the global `CutContainer` and reads the global `PIXI` and `Mediabunny`, matching the relationship between `pixi.js` and `pixi.mjs`.

### Vanilla HTML — ES modules

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
  import { createApp } from 'https://cdn.jsdelivr.net/npm/cut-container@0.0.2/lib/cut-container.min.mjs'

  const app = createApp({ host: '#app' })
  await app.mount()
</script>
```

The ES module build resolves `pixi.js` and `mediabunny` through bare imports, so it works with import maps, Vite, webpack and similar bundlers.

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

### Convenience helper

For a one-off mount, `mountEditor` creates the `<cut-container>` element for you:

```ts
import { mountEditor } from 'cut-container'

await mountEditor(document.getElementById('app')!, {
  title: 'My project',
  lang: 'en'
})
```

## Configuration

`createApp()` accepts the following options:

| Option | Type | Description |
|---|---|---|
| `host` | `string \| HTMLElement` | Required container selector or element |
| `config` | `EditorUserConfig \| string` | Initial config object or URL; a URL is loaded automatically by `mount()` |
| `lang` | `'zh' \| 'en'` | Initial editor language |
| `tabs` | `string[]` | Material tabs to show and their order |
| `fetchOptions` | `RequestInit` | Options used when loading a config URL |
| `onImportTracks` | `() => config \| tracks \| null \| Promise<...>` | Called before mount and by `importTracks()` |
| `onExportTracks` | `(project) => void \| Promise<void>` | Called by `exportTracks()` with the current project |

`EditorUserConfig` fields:

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Project title |
| `materials` | `object` | Material library data (`material`, `audio`, `text`, `caption`, `sticker`, `filter`, `effect`, `transition`) |
| `tracks` | `array` | Timeline track data |
| `lang` | `'zh' \| 'en'` | Editor language (`language` is accepted as an alias) |
| `tabs` | `string[]` | Visible material tabs: `material`, `audio`, `text`, `caption`, `sticker`, `filter`, `effect`, `transition` |
| `backend` | `object` | Optional media backend configuration |

### Load external config first

```ts
import { createApp } from 'cut-container'

const app = createApp({ host: '#app' })

await app.loadConfig('/editor-config.json') // URL or object
await app.mount()

// app.unmount()
// app.getConfig()
// app.element
```

`loadConfig()` can be called repeatedly; configs are merged. Passing `config: '/editor-config.json'` makes `mount()` load that URL automatically. When `materials` or `tracks` are supplied, they override the local project cache.

### Config example

```json
{
  "title": "External config demo",
  "lang": "en",
  "tabs": ["material", "audio", "text", "caption"],
  "backend": {
    "enabled": true,
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

### Backend configuration

| Field | Description |
|---|---|
| `enabled` | Enable the remote catalog / upload / draft config endpoints |
| `baseUrl` | Prefix for relative endpoint paths |
| `timeoutMs` | Request timeout; `0` disables it |
| `endpoints.catalog` | Media catalog JSON |
| `endpoints.upload` | Multipart upload endpoint |
| `endpoints.delete` | Delete endpoint; supports `{id}` or `:id` placeholders |
| `endpoints.config` | Remote draft config |

The flat fields `catalogUrl` / `uploadUrl` / `deleteUrl` / `configUrl` are also accepted. Relative paths are resolved against `baseUrl`; absolute `http(s)` URLs are used as-is. If `delete` has no placeholder, the item id is appended as `/{id}`.

You can also set the backend globally before mounting:

```html
<script>
  window.CUT_CONTAINER_CONFIG = {
    enabled: true,
    baseUrl: 'http://localhost:3001',
    timeoutMs: 8000
  }
</script>
```

### Import / export project callbacks

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

### App handle

| Method / property | Description |
|---|---|
| `loadConfig(source)` | Load a config URL or object and merge it |
| `mount(overrides?)` | Create and mount the editor |
| `importTracks()` | Run `onImportTracks` and apply the result |
| `exportTracks()` | Read the current project and run `onExportTracks` |
| `unmount()` | Destroy the current editor |
| `clearCache(options?)` | Clear local cache (localStorage + IndexedDB media). `{ confirm: true, reload: true }` by default |
| `getConfig()` | Current merged config |
| `element` | The mounted `<cut-container>` element, or `null` |

### Clearing the cache

Embedded pages have no host menu, so the editor ships three ways to wipe the saved project:

```js
// 1. shortcut: Ctrl/Cmd + Shift + Backspace (asks for confirmation, then reloads)
// 2. app handle / element method
await app.clearCache()                             // confirm + reload
await app.clearCache({ confirm: false, reload: false })
await document.querySelector('cut-container').clearCache({ confirm: false })

// 3. window event (works for any embed, optional detail)
window.dispatchEvent(new CustomEvent('uc-editor:clear-cache', { detail: { reload: false } }))
```

It clears `localStorage` (materials, timeline, cover, markers) **and** the IndexedDB store holding locally imported files, then dispatches `uc-editor:cache-cleared` before reloading.

### Language

```ts
import { mountEditor, setLang } from 'cut-container'

setLang('en') // global preference in localStorage
await mountEditor(document.getElementById('app')!, { lang: 'en' })
```

Per-instance `lang` takes precedence over the global setting.

## Usage and Keyboard Shortcuts

Typical workflow:

1. Import videos, images, audio, subtitles or fonts from the left panel.
2. Click a material's **+** button, or drag it onto a track.
3. Trim clip edges, drag clips to reorder, and split/delete as needed.
4. Select text or stickers to edit content, transform, opacity and style.
5. Choose a canvas ratio in the player; **Fit (original)** follows the first resource on the main track.
6. Export with the button in the right panel, or press `Ctrl/Cmd + E`.

Keyboard shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl / ⌘ + C` | Copy selected clip |
| `Ctrl / ⌘ + X` | Cut selected clip |
| `Ctrl / ⌘ + V` | Paste clip |
| `Delete` / `Backspace` | Delete selected clip |
| `Alt + ← / →` | Move selected clip one frame backward / forward |
| `M` | Add / remove a marker at the playhead |
| `Ctrl / ⌘ + E` | Export video |
| `Ctrl / ⌘ + Shift + Backspace` | Clear local cache (confirm, then reload) |
| `Space` | Play / pause in fullscreen player |
| `← / →` | Seek backward / forward 5 seconds in fullscreen |
| `Shift + ← / →` | Step one frame in fullscreen |
| `Esc` | Close a dialog/menu, or exit text editing |

Notes:

- Clip shortcuts are ignored while an input, textarea or contenteditable element has focus.
- Fullscreen shortcuts only work while the player is in fullscreen.
- Adjusting a text clip automatically pauses playback so the playhead cannot run past the clip while you edit.
- Projects and material data are saved to `localStorage` automatically; uploaded local files are kept in IndexedDB.

## License

MIT. See [LICENSE](https://github.com/zhao-farmer/cut-container/blob/main/LICENSE).

---

## 简体中文

一个剪映风格的视频编辑器，封装为与框架无关的 Web Component。可以直接放入原生 HTML，也可以在 Vue、React、Svelte、Solid 中使用；编辑器本身不依赖任何前端框架运行时。

### 使用的技术

| 层级 | 技术 |
|---|---|
| 语言 | TypeScript |
| UI | Web Components + Shadow DOM |
| 构建 | Vite 5 |
| 播放与合成 | pixi.js 8.12 |
| 解码 / MP4 导出 | mediabunny 1.50.8 + WebCodecs |
| 音频 | Web Audio API |
| 持久化 | 版本化 `localStorage`（工程 / 素材），本地上传文件存 IndexedDB |
| 可选后端 | 零依赖 Node 服务，提供素材目录、上传与 Range 静态文件 |

编辑器在浏览器内完成渲染和合成；`pixi.js` 与 `mediabunny` 保持为外部依赖，可通过 npm、CDN 或 import map 加载。

### 安装

```bash
npm install cut-container
```

`pixi.js` 和 `mediabunny` 会作为依赖自动安装。发布包同时提供 ES module 和经典脚本：

```text
dist/   经典 <script> 构建与浏览器全局版 mediabunny
lib/    ES module 构建
```

视频解码与 MP4 导出需要支持 WebCodecs 的 Chrome / Edge。

### 使用方式

#### 原始 HTML — 经典脚本

```html
<div id="app" style="width: 100%; height: 100vh"></div>

<script src="https://cdn.jsdelivr.net/npm/pixi.js@8.12.0/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container@0.0.2/dist/vendor/mediabunny.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container@0.0.2/dist/cut-container.min.js"></script>
<script>
  const app = CutContainer.createApp({ host: '#app' })
  app.mount()
</script>
```

经典构建暴露全局 `CutContainer`，并读取全局 `PIXI` 与 `Mediabunny`，与 `pixi.js` / `pixi.mjs` 的分工一致。

#### 原始 HTML — ES module

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
  import { createApp } from 'https://cdn.jsdelivr.net/npm/cut-container@0.0.2/lib/cut-container.min.mjs'

  const app = createApp({ host: '#app' })
  await app.mount()
</script>
```

ES module 构建通过 bare import 解析 `pixi.js` / `mediabunny`，适用于 import map、Vite、webpack 等模块环境。

#### Vue 3

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

#### React

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

#### Svelte

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

#### Solid

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

#### 便捷挂载

只挂载一次时，可以使用 `mountEditor`，它会自动创建 `<cut-container>`：

```ts
import { mountEditor } from 'cut-container'

await mountEditor(document.getElementById('app')!, {
  title: '我的工程',
  lang: 'zh'
})
```

### 配置项

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

#### 先加载外部配置再挂载

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

#### 配置示例

```json
{
  "title": "外部配置示例",
  "lang": "zh",
  "tabs": ["material", "audio", "text", "caption"],
  "backend": {
    "enabled": true,
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

#### 后端配置

| 字段 | 说明 |
|---|---|
| `enabled` | 是否启用远程素材目录 / 上传 / 草稿配置 |
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
    enabled: true,
    baseUrl: 'http://localhost:3001',
    timeoutMs: 8000
  }
</script>
```

#### 导入 / 导出工程回调

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

#### App 实例方法

| 方法 / 属性 | 说明 |
|---|---|
| `loadConfig(source)` | 加载配置 URL 或对象并合并 |
| `mount(overrides?)` | 创建并挂载编辑器 |
| `importTracks()` | 执行 `onImportTracks` 并应用结果 |
| `exportTracks()` | 读取当前工程并执行 `onExportTracks` |
| `unmount()` | 销毁当前编辑器 |
| `clearCache(options?)` | 清除本机缓存（localStorage + IndexedDB 本地媒体），默认 `{ confirm: true, reload: true }` |
| `getConfig()` | 当前合并后的配置 |
| `element` | 已挂载的 `<cut-container>` 元素，未挂载为 `null` |

#### 清除本机缓存

嵌入页面没有宿主的「文件」菜单，编辑器提供三个入口：

```js
// 1. 快捷键：Ctrl/Cmd + Shift + Backspace（弹确认框，确认后重载页面）
// 2. 实例方法
await app.clearCache()                             // 确认 + 重载
await app.clearCache({ confirm: false, reload: false })
await document.querySelector('cut-container').clearCache({ confirm: false })

// 3. window 事件（任意嵌入方式都能用，detail 可选）
window.dispatchEvent(new CustomEvent('uc-editor:clear-cache', { detail: { reload: false } }))
```

会同时清空 `localStorage`（素材 / 时间线 / 封面 / 标记）**和** IndexedDB 里保存的本地导入文件，重载前还会派发 `uc-editor:cache-cleared` 事件。

#### 语言

```ts
import { mountEditor, setLang } from 'cut-container'

setLang('zh') // 全局偏好，写入 localStorage
await mountEditor(document.getElementById('app')!, { lang: 'zh' })
```

单次传入的 `lang` 优先级高于全局设置。

### 使用与快捷键

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
| `Ctrl / ⌘ + Shift + Backspace` | 清除本机缓存（确认后重载页面） |
| `Space` | 全屏播放器中播放 / 暂停 |
| `← / →` | 全屏播放器中快退 / 快进 5 秒 |
| `Shift + ← / →` | 全屏播放器中逐帧后退 / 前进 |
| `Esc` | 关闭弹窗 / 菜单，或退出文字编辑 |

说明：

- 输入框、文本域、contenteditable 内不会触发片段编辑快捷键。
- 全屏快捷键仅在播放器全屏时生效。
- 调整文字时会自动暂停播放，避免播放头走出文字片段导致文字消失。
- 工程和素材数据会自动保存到 `localStorage`；本地导入的文件保存在 IndexedDB。

### License

MIT，详见 [LICENSE](https://github.com/zhao-farmer/cut-container/blob/main/LICENSE)。
