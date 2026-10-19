import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import sveltePreprocess from 'svelte-preprocess'
import solidPlugin from 'vite-plugin-solid'
import react from '@vitejs/plugin-react'

// 关键：React 和 Solid 都用 JSX，必须通过扩展名/路径隔离
//  - 普通 .tsx/.jsx  -> React
//  - .solid.tsx/.solid.jsx -> Solid
export default defineConfig({
  plugins: [
    vue(),
    svelte({
      preprocess: sveltePreprocess({
        typescript: true
      })
    }),
    // Solid 只处理 .solid.tsx / .solid.jsx
    solidPlugin({
      include: ['**/*.solid.tsx', '**/*.solid.jsx']
    }),
    // React 处理普通 jsx/tsx，但排除 solid 文件
    react({
      include: /\.(jsx|tsx)$/,
      exclude: [/\.solid\.(jsx|tsx)$/, /node_modules/]
    })
  ],
  server: {
    port: 5173,
    open: true
  },
  optimizeDeps: {
    include: ['vue', 'react', 'react-dom', 'svelte', 'solid-js', 'pixi.js', 'mediabunny']
  }
})
