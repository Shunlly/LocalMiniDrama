import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildElementPlusComponentMap,
  parseElementPlusIconModules,
  rewriteElementPlusBarrelImports,
} from '../scripts/elementPlusOnDemand.js'

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
