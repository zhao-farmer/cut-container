/* ============================================================
 *  库构建（npm / CDN）
 *  - cut-container.js     经典 <script>（IIFE，全局 CutContainer）
 *  - cut-container.mjs    ES module（import）
 *  - min 版本由 scripts/build-lib-assets.mjs 生成
 *
 *  pixi.js / mediabunny 作为外部依赖：
 *  - .mjs 由使用方从 node_modules / import map 解析
 *  - .js  使用全局 PIXI / Mediabunny（和 pixi.js / pixi.mjs 的关系一致）
 * ============================================================ */
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'npm-build-dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/library/index.ts',
      name: 'CutContainer',
      formats: ['es', 'iife'],
      fileName: format =>
        format === 'es' ? 'lib/cut-container.mjs' : 'dist/cut-container.js'
    },
    rollupOptions: {
      external: ['pixi.js', 'mediabunny'],
      output: {
        exports: 'named',
        inlineDynamicImports: true,
        globals: {
          'pixi.js': 'PIXI',
          mediabunny: 'Mediabunny'
        }
      }
    }
  }
})
