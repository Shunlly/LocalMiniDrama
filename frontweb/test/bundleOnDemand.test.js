import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildElementPlusComponentMap,
  getElementPlusStyleSideEffects,
  parseElementPlusIconModules,
  rewriteElementPlusBarrelImports,
} from '../scripts/elementPlusOnDemand.js'

const require = createRequire(import.meta.url)
const {
  findLeakedUnusedElementPlusCss,
  UNUSED_ELEMENT_PLUS_CSS,
} = require('../scripts/check-bundle-budget.cjs')

const componentsRoot = fileURLToPath(new URL('../node_modules/element-plus/es/components/', import.meta.url))
const iconsIndex = readFileSync(new URL('../node_modules/@element-plus/icons-vue/dist/index.js', import.meta.url), 'utf8')
const componentMap = buildElementPlusComponentMap(componentsRoot)

test('Element Plus 组件映射覆盖反馈 API 与子组件', () => {
  assert.equal(componentMap.get('ElMessage'), 'message')
  assert.equal(componentMap.get('ElMessageBox'), 'message-box')
  assert.equal(componentMap.get('ElNotification'), 'notification')
  assert.equal(componentMap.get('ElLoadingDirective'), 'loading')
  assert.equal(componentMap.get('ElTableColumn'), 'table')
  assert.equal(componentMap.get('ElDialog'), 'dialog')
})

test('业务 barrel 导入会改写成按需组件和样式', () => {
  const rewritten = rewriteElementPlusBarrelImports(
    "import { ElMessage as RawElMessage, ElMessageBox, ElNotification } from 'element-plus'\n",
    componentMap,
    componentsRoot,
  )
  assert.match(rewritten, /element-plus\/es\/components\/message\/index\.mjs/)
  assert.match(rewritten, /element-plus\/es\/components\/message-box\/index\.mjs/)
  assert.match(rewritten, /element-plus\/es\/components\/notification\/index\.mjs/)
  assert.match(rewritten, /element-plus\/es\/components\/message\/style\/css/)
  assert.match(rewritten, /element-plus\/es\/components\/message-box\/style\/css/)
  assert.match(rewritten, /element-plus\/es\/components\/notification\/style\/css/)
  assert.match(rewritten, /ElMessage as RawElMessage/)
  assert.doesNotMatch(rewritten, /from 'element-plus'/)
})

test('未知 Element Plus 导出会在改写时失败', () => {
  assert.throws(
    () => rewriteElementPlusBarrelImports("import { dayjs } from 'element-plus'", componentMap, componentsRoot),
    /未配置按需映射/,
  )
})

test('图标包可以拆成独立模块', () => {
  const modules = parseElementPlusIconModules(iconsIndex)
  assert.equal(modules.size, 293)
  assert.match(modules.get('Close'), /name: "Close"/)
  assert.match(modules.get('MagicStick'), /name: "MagicStick"/)
  assert.match(modules.get('Watermelon'), /name: "Watermelon"/)
  assert.doesNotMatch(modules.get('Close'), /name: "Watermelon"/)
})

test('element-plus/es barrel 也会改写成按需入口', () => {
  const rewritten = rewriteElementPlusBarrelImports(
    'import { ElDialog } from "element-plus/es"\n',
    componentMap,
    componentsRoot,
  )
  assert.match(rewritten, /element-plus\/es\/components\/dialog\/index\.mjs/)
  assert.match(rewritten, /element-plus\/es\/components\/dialog\/style\/css/)
  assert.doesNotMatch(rewritten, /from "element-plus\/es"/)
})

test('组件样式副作用只引入当前组件 css，不引入全量 theme-chalk', () => {
  const sideEffects = getElementPlusStyleSideEffects('dialog', componentsRoot)
  assert.deepEqual(sideEffects, [
    'element-plus/es/components/base/style/css',
    'element-plus/es/components/dialog/style/css',
  ])
  assert.ok(!sideEffects.join('\n').includes('theme-chalk/index'))
  assert.ok(!sideEffects.join('\n').includes('element-plus/dist'))
})

function listAppSourceFiles(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name)
    if (statSync(fullPath).isDirectory()) {
      files.push(...listAppSourceFiles(fullPath))
      continue
    }
    if (/\.(?:js|vue|css)$/.test(name)) files.push(fullPath)
  }
  return files
}

test('业务源码不再全量引入 Element Plus 组件或 CSS', () => {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
  const forbidden = [
    /from\s*['"]element-plus(?:\/es)?['"]/,
    /import\s*\(\s*['"]element-plus(?:\/es)?['"]/,
    /element-plus\/dist/,
    /element-plus\/theme-chalk\/index/,
    /app\.use\(\s*ElementPlus/,
    /import\s+ElementPlus\b/,
    /import\s+\*\s+as\s+\w+\s+from\s*['"]@element-plus\/icons-vue['"]/,
  ]
  const hits = []
  for (const file of listAppSourceFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (forbidden.some((pattern) => pattern.test(line))) {
        hits.push(`${path.relative(srcRoot, file)}:${index + 1}:${line.trim()}`)
      }
    }
  }
  assert.deepEqual(hits, [])
})

test('全量 Element Plus CSS 会被预算检查拦住', () => {
  const fullCss = readFileSync(new URL('../node_modules/element-plus/dist/index.css', import.meta.url), 'utf8')
  assert.deepEqual(
    [...findLeakedUnusedElementPlusCss(fullCss)].sort(),
    [...UNUSED_ELEMENT_PLUS_CSS].sort(),
  )
  assert.deepEqual(findLeakedUnusedElementPlusCss('.el-dialog{}.el-button{}.el-overlay{}'), [])
  const themeCss = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
  assert.deepEqual(findLeakedUnusedElementPlusCss(themeCss), [])
})
