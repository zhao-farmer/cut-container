# CutContainer

**English** | [简体中文](https://github.com/zhao-farmer/cut-container/blob/main/README.zh-CN.md)

A CapCut-style video editor packaged as a framework-agnostic Web Component. Drop `<cut-container>` into a vanilla page, Vue, React, Svelte or Solid app — no framework runtime is required by the editor itself.

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
<script src="https://cdn.jsdelivr.net/npm/cut-container/dist/vendor/mediabunny.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cut-container/dist/cut-container.min.js"></script>
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
  import { createApp } from 'https://cdn.jsdelivr.net/npm/cut-container/lib/cut-container.min.mjs'

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

### Backend configuration

`backend.mode` decides how the editor talks to your server:

| Mode | Catalog / config | Upload on import | Delete / rename |
|---|---|---|---|
| `local` (default) | never fetched, zero requests | local only (IndexedDB) | local only |
| `remote` | fetched | uploaded to the backend | sent to the backend |
| `hybrid` | fetched (GET only) | local only | local only |

Use `hybrid` when the backend only hosts the media library: the editor reads the catalog from it,
but importing / deleting / renaming never writes back — all of that stays in the browser.

```json
{ "backend": { "mode": "hybrid", "baseUrl": "https://api.example.com" } }
```

| Field | Description |
|---|---|
| `mode` | `local` \| `remote` \| `hybrid` (see the table above) |
| `enabled` | Legacy switch; when `mode` is omitted, `enabled: true` means `remote` |
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
    mode: 'hybrid',
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
- If a cover is set, the exported MP4 stores it as cover art in the file metadata (`moov/udta/meta/ilst/covr`) together with the draft title — players and file managers show that image instead of the first frame.

## Acknowledgements

This editor stands on two excellent open-source projects. Many thanks to their authors and contributors.

### pixi.js

[pixi.js](https://github.com/pixijs/pixijs) v8 draws everything you see on the timeline and in the player:

| Where | What it does |
|---|---|
| `src/editor/timeline/canvas/` | timeline rendering: tracks, clips, thumbnails, waveform, playhead, scrollbars |
| `src/editor/timeline/canvas/render.ts` | layer composition, masks, cover button, drag ghost |
| `src/editor/timeline/canvas/waveformRenderer.ts` | waveform textures baked with `CanvasSource` |
| `src/editor/player/` | player stage: video/image sprites, transforms, filters, overlays |

### mediabunny

[mediabunny](https://github.com/Vanilagy/mediabunny) v1.50 handles decoding, frame extraction and MP4 muxing:

| Where | What it does |
|---|---|
| `src/editor/codec/timelineExporter.ts` | MP4 muxing, metadata tags (cover art `covr`, title) |
| `src/editor/codec/timelineFrameExtractor.ts` | exact frame extraction for thumbnails and the cover editor |
| `src/editor/codec/timelineMedia.ts` | video / GIF frame cache and audio decoding |
| `src/editor/player/` | playback through WebCodecs |

Both are MIT licensed. If you build something with this editor, consider starring their repositories.

## License

MIT. See [LICENSE](https://github.com/zhao-farmer/cut-container/blob/main/LICENSE).
