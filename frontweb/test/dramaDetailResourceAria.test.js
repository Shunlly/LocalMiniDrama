import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const library = read('../src/components/dramaDetail/DramaDetailResourceLibrary.vue')
const charEdit = read('../src/components/dramaDetail/DramaDetailCharacterEditDialogs.vue')
const sceneEdit = read('../src/components/dramaDetail/DramaDetailSceneEditDialogs.vue')
const propEdit = read('../src/components/dramaDetail/DramaDetailPropEditDialogs.vue')
const dialogs = read('../src/components/dramaDetail/DramaDetailResourceDialogs.vue')
const canvasActions = read('../src/components/dramaCanvas/CanvasStoryboardPanelActions.vue')
const contextMenu = read('../src/components/dramaCanvas/CanvasContextMenu.vue')

test('详情页资源库标签和列表操作带中文名称', () => {
  assert.match(library, /资源库\$\{t\.label\}/)
  assert.match(library, /制作资源\$\{t\.label\}/)
  assert.match(library, /编辑角色\$\{item\.name \|\| '未命名角色'\}/)
  assert.match(library, /删除角色\$\{item\.name \|\| '未命名角色'\}/)
  assert.match(library, /编辑场景\$\{item\.location \|\| '未命名场景'\}/)
  assert.match(library, /编辑道具\$\{item\.name \|\| '未命名道具'\}/)
  assert.match(library, /aria-label="从素材库导入角色"/)
  assert.match(library, /charLoading \? '\u6b63\u5728\u52a0\u8f7d\u89d2色\u5e93\uff0c\u8bf7\u7a0d\u5019' : '\u91cd\u8bd5\u52a0\u8f7d\u89d2\u8272\u5e93'/)
})

test('详情页编辑弹窗取消和保存有中文名称', () => {
  assert.match(charEdit, /aria-label="取消编辑制作角色"/)
  assert.match(charEdit, /aria-label="取消编辑角色"/)
  assert.match(charEdit, /'保存制作角色'/)
  assert.match(charEdit, /'保存角色'/)
  assert.match(sceneEdit, /aria-label="取消编辑制作场景"/)
  assert.match(sceneEdit, /aria-label="取消编辑场景"/)
  assert.match(sceneEdit, /'保存制作场景'/)
  assert.match(sceneEdit, /'保存场景'/)
  assert.match(propEdit, /aria-label="取消编辑制作道具"/)
  assert.match(propEdit, /aria-label="取消编辑道具"/)
  assert.match(propEdit, /'保存制作道具'/)
  assert.match(propEdit, /'保存道具'/)
  assert.match(dialogs, /取消导入\$\{importTypeLabel\(importType\)\}/)
  assert.match(dialogs, /前往制作页新增并入库/)
  assert.match(dialogs, /正在导入\$\{importTypeLabel\(importType\)\}「\$\{importItemName\(importType, item\)\}」/)
  assert.match(dialogs, /待导入\$\{importTypeLabel\(importType\)\}「\$\{importItemName\(importType, item\)\}」预览图/)
  assert.match(dialogs, /class="library-empty resource-empty-state" role="status" aria-live="polite"/)
})

test('画布分镜操作条和右键菜单使用中文动作名', () => {
  assert.match(canvasActions, /'保存分镜'/)
  assert.match(canvasActions, /'生成分镜图'/)
  assert.match(canvasActions, /aria-label="删除分镜"/)
  assert.match(contextMenu, /aria-label="添加分镜节点"/)
  assert.match(contextMenu, /aria-label="添加自由图片节点"/)
})
