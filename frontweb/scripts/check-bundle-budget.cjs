const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { removeFixtureTreeSync } = require('./fixture-cleanup.cjs')

const DIST_ROOT = path.resolve(__dirname, '..', 'dist')
const MANIFEST_PATH = path.join(DIST_ROOT, '.vite', 'manifest.json')
const BUDGETS = Object.freeze({
  initialJavaScriptGzip: 120 * 1024,
  initialCssGzip: 40 * 1024,
  // 制作页页面块接近上限；filmCreate composable/utils 已拆独立异步块，且不把公共 Element Plus 打回全量共享块。预留 2KiB 避免 gzip 抖动。
  asyncChunkGzip: 132 * 1024,
})

const UNUSED_ICON_ASSETS = Object.freeze([
  'AddLocation',
  'Watermelon',
  'WindPower',
  'Baseball',
])

// 业务未使用的组件类名。全量 theme-chalk / dist/index.css 会带上它们。
const UNUSED_ELEMENT_PLUS_CSS = Object.freeze([
  'el-calendar',
  'el-cascader',
  'el-color-picker',
  'el-transfer',
  'el-tour',
])

function findLeakedUnusedElementPlusCss(cssText) {
  const source = String(cssText || '')
  return UNUSED_ELEMENT_PLUS_CSS.filter((name) => source.includes(`.${name}`))
}

function gzipSize(relativePath) {
  const absolutePath = path.join(DIST_ROOT, relativePath)
  return zlib.gzipSync(fs.readFileSync(absolutePath), { level: 9 }).length
}

function collectInitialEntries(manifest, entryKey) {
  const visited = new Set()
  const visit = (key) => {
    if (!key || visited.has(key)) return
    const item = manifest[key]
    if (!item) throw new Error(`Bundle manifest references missing entry: ${key}`)
    visited.add(key)
    for (const imported of item.imports || []) visit(imported)
  }
  visit(entryKey)
  return visited
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB gzip`
}

function verifyBundleBudget(manifest) {
  const entry = Object.entries(manifest).find(([, item]) => item.isEntry && item.file?.endsWith('.js'))
  if (!entry) throw new Error('Bundle manifest has no JavaScript application entry')

  const initialKeys = collectInitialEntries(manifest, entry[0])
  const initialJsFiles = new Set()
  const initialCssFiles = new Set()
  for (const key of initialKeys) {
    const item = manifest[key]
    if (item.file?.endsWith('.js')) initialJsFiles.add(item.file)
    for (const cssFile of item.css || []) initialCssFiles.add(cssFile)
  }

  const initialJavaScriptGzip = [...initialJsFiles].reduce((sum, file) => sum + gzipSize(file), 0)
  const initialCssGzip = [...initialCssFiles].reduce((sum, file) => sum + gzipSize(file), 0)
  const oversizedAsyncChunks = Object.entries(manifest)
    .filter(([key, item]) => item.file?.endsWith('.js') && !initialKeys.has(key))
    .map(([, item]) => ({ file: item.file, gzip: gzipSize(item.file) }))
    .filter((item) => item.gzip > BUDGETS.asyncChunkGzip)

  const failures = []
  if (initialJavaScriptGzip > BUDGETS.initialJavaScriptGzip) {
    failures.push(`initial JavaScript is ${formatBytes(initialJavaScriptGzip)} (budget ${formatBytes(BUDGETS.initialJavaScriptGzip)})`)
  }
  if (initialCssGzip > BUDGETS.initialCssGzip) {
    failures.push(`initial CSS is ${formatBytes(initialCssGzip)} (budget ${formatBytes(BUDGETS.initialCssGzip)})`)
  }
  for (const item of oversizedAsyncChunks) {
    failures.push(`${item.file} is ${formatBytes(item.gzip)} (async budget ${formatBytes(BUDGETS.asyncChunkGzip)})`)
  }
  const assetNames = fs.readdirSync(path.join(DIST_ROOT, 'assets'))
  const leakedUnusedIcons = UNUSED_ICON_ASSETS.filter((name) => (
    assetNames.some((file) => file.startsWith(`${name}-`) || file.startsWith(`${name}.`))
  ))
  if (leakedUnusedIcons.length) {
    failures.push(`unused Element Plus icons were still emitted: ${leakedUnusedIcons.join(', ')}`)
  }
  const leakedInitialIconChunks = [...initialJsFiles].filter((file) => {
    const base = path.basename(file)
    return UNUSED_ICON_ASSETS.some((name) => base.startsWith(`${name}-`)) || base.startsWith('MagicStick-')
  })
  if (leakedInitialIconChunks.length) {
    failures.push(`initial JavaScript still includes on-demand icon chunks: ${leakedInitialIconChunks.join(', ')}`)
  }
  const cssText = assetNames
    .filter((name) => name.endsWith('.css'))
    .map((name) => fs.readFileSync(path.join(DIST_ROOT, 'assets', name), 'utf8'))
    .join('\n')
  const leakedUnusedCss = findLeakedUnusedElementPlusCss(cssText)
  if (leakedUnusedCss.length) {
    failures.push(`unused Element Plus CSS still emitted: ${leakedUnusedCss.join(', ')}`)
  }

  if (failures.length) throw new Error(`Bundle budget exceeded:\n- ${failures.join('\n- ')}`)

  return {
    initialJavaScriptGzip,
    initialCssGzip,
    leakedUnusedIcons,
    leakedUnusedCss,
    largestAsyncChunkGzip: Math.max(0, ...Object.entries(manifest)
      .filter(([key, item]) => item.file?.endsWith('.js') && !initialKeys.has(key))
      .map(([, item]) => gzipSize(item.file))),
  }
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`Vite manifest not found: ${MANIFEST_PATH}`)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const result = verifyBundleBudget(manifest)
  removeFixtureTreeSync(path.dirname(MANIFEST_PATH), { force: true })
  console.log(JSON.stringify({ bundle_budget: 'passed', ...result }))
}

module.exports = { BUDGETS, collectInitialEntries, verifyBundleBudget, findLeakedUnusedElementPlusCss, UNUSED_ELEMENT_PLUS_CSS }

if (require.main === module) main()
