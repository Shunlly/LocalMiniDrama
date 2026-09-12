import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')

const characterBlock = read('FilmCreateCharacterBlock.vue')
const sceneBlock = read('FilmCreateSceneBlock.vue')
const propBlock = read('FilmCreatePropBlock.vue')
const resourcePanel = read('FilmCreateResourcePanel.vue')
const refImageField = read('FilmCreateResourceRefImageField.vue')
const characterLibrary = read('FilmCreateCharacterLibraryDialogs.vue')
const sceneLibrary = read('FilmCreateSceneLibraryDialogs.vue')
const propLibrary = read('FilmCreatePropLibraryDialogs.vue')
const characterEdit = read('FilmCreateCharacterEditDialog.vue')
const sceneEdit = read('FilmCreateSceneEditDialog.vue')
const propEdit = read('FilmCreatePropEditDialog.vue')

test('制作页角色、场景、道具块的列表操作带上中文无障碍名称', () => {
  assert.match(characterBlock, /:aria-label="`编辑角色\$\{char\.name \|\| '未命名角色'\}`"/)
  assert.match(characterBlock, /将\$\{char\.name \|\| '未命名角色'\}加入本剧库/)
  assert.match(characterBlock, /将\$\{char\.name \|\| '未命名角色'\}加入素材库/)
  assert.match(characterBlock, /AI 生成\$\{char\.name \|\| '未命名角色'\}图片/)
  assert.match(characterBlock, /上传\$\{char\.name \|\| '未命名角色'\}图片/)
  assert.match(characterBlock, /重新生成\$\{char\.name \|\| '未命名角色'\}相关分镜图/)
  assert.match(characterBlock, /aria-label="打开本剧角色库"/)

  assert.match(sceneBlock, /:aria-label="`编辑场景\$\{scene\.location \|\| '未命名场景'\}`"/)
  assert.match(sceneBlock, /将\$\{scene\.location \|\| '未命名场景'\}加入本剧库/)
  assert.match(sceneBlock, /AI 生成\$\{scene\.location \|\| '未命名场景'\}图片/)
  assert.match(sceneBlock, /aria-label="打开本剧场景库"/)

  assert.match(propBlock, /:aria-label="`编辑道具\$\{prop\.name \|\| '未命名道具'\}`"/)
  assert.match(propBlock, /将\$\{prop\.name \|\| '未命名道具'\}加入本剧库/)
  assert.match(propBlock, /AI 生成\$\{prop\.name \|\| '未命名道具'\}图片/)
  assert.match(propBlock, /aria-label="打开本剧道具库"/)
})

test('资源面板折叠按钮和参考图操作使用中文展开/收起名称', () => {
  assert.match(resourcePanel, /resourcePanelCollapsed \? '展开资源管理' : '收起资源管理'/)
  assert.match(resourcePanel, /charactersBlockCollapsed \? '展开角色' : '收起角色'/)
  assert.match(resourcePanel, /propsBlockCollapsed \? '展开道具' : '收起道具'/)
  assert.match(resourcePanel, /scenesBlockCollapsed \? '展开场景' : '收起场景'/)
  assert.match(refImageField, /aria-label="移除待上传参考图"/)
  assert.match(refImageField, /aria-label="移除参考图"/)
  assert.match(refImageField, /extracting \? pendingExtractTitle : '提取特征描述'/)
})

test('角色、场景、道具库弹窗的加入本集、编辑、删除和关闭都有中文名称', () => {
  assert.match(characterLibrary, /将\$\{item\.name \|\| '未命名角色'\}加入本集/)
  assert.match(characterLibrary, /编辑公共角色\$\{item\.name \|\| '未命名角色'\}/)
  assert.match(characterLibrary, /删除公共角色\$\{item\.name \|\| '未命名角色'\}/)
  assert.match(characterLibrary, /aria-label="关闭本剧角色库"/)
  assert.match(characterLibrary, /editCharLibrarySaving \? '正在保存公共角色，请稍候' : '保存公共角色'/)

  assert.match(sceneLibrary, /将\$\{item\.location \|\| item\.time \|\| '未命名场景'\}加入本集/)
  assert.match(sceneLibrary, /aria-label="关闭本剧场景库"/)
  assert.match(sceneLibrary, /editSceneLibrarySaving \? '正在保存公共场景，请稍候' : '保存公共场景'/)

  assert.match(propLibrary, /将\$\{item\.name \|\| '未命名道具'\}加入本集/)
  assert.match(propLibrary, /aria-label="关闭本剧道具库"/)
  assert.match(propLibrary, /editPropLibrarySaving \? '正在保存公共道具，请稍候' : '保存公共道具'/)
})

test('角色、场景、道具编辑弹窗的取消和保存有中文无障碍名称', () => {
  assert.match(characterEdit, /aria-label="取消编辑角色"/)
  assert.match(characterEdit, /editCharacterForm\?\.id \? '保存角色' : '添加角色'/)
  assert.match(sceneEdit, /aria-label="取消编辑场景"/)
  assert.match(sceneEdit, /editSceneForm\?\.id \? '保存场景' : '添加场景'/)
  assert.match(propEdit, /aria-label="取消编辑道具"/)
  assert.match(propEdit, /aria-label="取消添加道具"/)
  assert.match(propEdit, /editPropForm\?\.id \? '保存道具' : '添加道具'/)
})

test('资源库无图封面不再用没有中文原因的禁用按钮', () => {
  for (const source of [characterLibrary, sceneLibrary, propLibrary]) {
    assert.doesNotMatch(source, /class="library-item-cover" :disabled/)
    assert.match(source, /class="library-item-cover library-item-cover--empty"/)
    assert.match(source, /role="img"/)
    assert.match(source, /暂无图片/)
  }
  assert.match(sceneBlock, /missingScenePanoramaReason\(scene\)/)
  assert.match(sceneBlock, /正在生成全景图，请稍候/)
})
