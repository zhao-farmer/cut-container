/* ============================================================
 *  npm 包构建后处理：
 *  - dist/ 经典脚本（IIFE）与浏览器全局版 mediabunny
 *  - lib/  ES module
 *  - 包根 package.json / README.md / index.d.ts
 * ============================================================ */
import { build, transform } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pkgDir = path.join(root, 'npm-build-dist')
const distDir = path.join(pkgDir, 'dist')
const libDir = path.join(pkgDir, 'lib')
const vendorDir = path.join(distDir, 'vendor')

fs.mkdirSync(distDir, { recursive: true })
fs.mkdirSync(libDir, { recursive: true })
fs.mkdirSync(vendorDir, { recursive: true })

// 类型声明（源码手写 d.ts → 包根）
fs.copyFileSync(path.join(root, 'types/index.d.ts'), path.join(pkgDir, 'index.d.ts'))

// ESM min（lib/）
await build({
  entryPoints: [path.join(libDir, 'cut-container.mjs')],
  outfile: path.join(libDir, 'cut-container.min.mjs'),
  bundle: false,
  minify: true,
  sourcemap: false,
  target: 'es2020',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'warning'
})

// 经典脚本 min（dist/）：用 transform 保留顶层的 var CutContainer = ...
const iifeCode = fs.readFileSync(path.join(distDir, 'cut-container.js'), 'utf8')
const iifeMin = await transform(iifeCode, {
  loader: 'js',
  minify: true,
  target: 'es2020',
  sourcefile: 'cut-container.js',
  sourcemap: false,
  legalComments: 'none'
})
fs.writeFileSync(path.join(distDir, 'cut-container.min.js'), `${iifeMin.code}\n`)

// mediabunny 浏览器全局版：window.Mediabunny（经典脚本）
await build({
  stdin: {
    contents: "import * as Mediabunny from 'mediabunny';\nglobalThis.Mediabunny = Mediabunny;",
    resolveDir: root,
    sourcefile: 'mediabunny-global.js',
    loader: 'js'
  },
  outfile: path.join(vendorDir, 'mediabunny.min.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning'
})
fs.copyFileSync(
  path.join(root, 'node_modules/mediabunny/LICENSE'),
  path.join(vendorDir, 'LICENSE.mediabunny.txt')
)

// 发布包 README / 许可证：
// 中文文档已内联进 README.md（npm 只渲染这一个文件，且不托管包内其它 md），
// 故发布包不再带 README.zh-CN.md；仓库里保留该文件供 GitHub 浏览。
// 旧构建残留兜底清理（空 outDir 之外的第二道保险）
fs.rmSync(path.join(pkgDir, 'README.zh-CN.md'), { force: true })
fs.copyFileSync(path.join(root, 'README.md'), path.join(pkgDir, 'README.md'))
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(pkgDir, 'LICENSE'))

// 发布包 package.json：只保留运行时必需字段
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const outPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  license: rootPkg.license,
  type: 'module',
  main: './lib/cut-container.mjs',
  module: './lib/cut-container.mjs',
  types: './index.d.ts',
  unpkg: './dist/cut-container.min.js',
  jsdelivr: './dist/cut-container.min.js',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './lib/cut-container.mjs',
      default: './lib/cut-container.mjs'
    },
    './min': './lib/cut-container.min.mjs',
    './script': './dist/cut-container.js',
    './script.min': './dist/cut-container.min.js',
    './vendor/mediabunny': './dist/vendor/mediabunny.min.js',
    './package.json': './package.json'
  },
  files: ['dist', 'lib', 'index.d.ts', 'README.md', 'LICENSE'],
  sideEffects: true,
  dependencies: rootPkg.dependencies
}
fs.writeFileSync(path.join(pkgDir, 'package.json'), `${JSON.stringify(outPkg, null, 2)}\n`)

// 旧构建目录已更名为 npm-build-dist
const legacyDir = path.join(root, 'dist-lib')
if (fs.existsSync(legacyDir)) fs.rmSync(legacyDir, { recursive: true, force: true })

// 兜底：发布包不包含 sourcemap，清掉任何残留的 *.map
let removedMaps = 0
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.map')) {
      fs.rmSync(full)
      removedMaps++
    }
  }
}
walk(distDir)
walk(libDir)
if (removedMaps) console.log(`[build-lib] 已清理 ${removedMaps} 个残留 .map 文件`)

console.log('[build-lib] npm-build-dist 包内容：')
for (const name of fs.readdirSync(pkgDir).sort()) {
  const full = path.join(pkgDir, name)
  const stat = fs.statSync(full)
  if (stat.isFile()) console.log(`  ${name}  ${(stat.size / 1024).toFixed(1)} kB`)
  else console.log(`  ${name}/`)
}
console.log(`  dist/  ${fs.readdirSync(distDir).length} files`)
console.log(`  lib/   ${fs.readdirSync(libDir).length} files`)
console.log(`  dist/vendor/  ${fs.readdirSync(vendorDir).length} files`)
