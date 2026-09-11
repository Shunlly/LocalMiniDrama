import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('项目列表公共库弹窗的编辑删除关闭保存有中文名称', () => {
  const charLib = read('../src/components/filmList/FilmListCharLibraryDialogs.vue')
  const sceneLib = read('../src/components/filmList/FilmListSceneLibraryDialogs.vue')
  const propLib = read('../src/components/filmList/FilmListPropLibraryDialogs.vue')
  assert.match(charLib, /编辑公共角色\$\{item\.name \|\| '未命名角色'\}/)
  assert.match(charLib, /aria-label="关闭角色库"/)
  assert.match(sceneLib, /编辑公共场景\$\{item\.location \|\| '未命名场景'\}/)
  assert.match(propLib, /aria-label="关闭道具库"/)
})

test('AI 配置工具条保留中文操作名且 loadList 仍在页面', () => {
  const toolbar = read('../src/components/aiConfig/AiConfigListToolbar.vue')
  const page = read('../src/components/AIConfigContent.vue')
  assert.match(toolbar, /'添加配置'/)
  assert.match(toolbar, /aria-label="导出配置"/)
  assert.match(toolbar, /'一键换密钥'/)
  assert.match(page, /async function loadList\(/)
  assert.match(page, /function openTest\(/)
})

test('素材处理流程重试暂停取消和刷新有中文名称', () => {
  const stage = read('../src/components/sourceIntake/SourceIntakeProcessStageCard.vue')
  const panel = read('../src/components/SourceIntakeWorkflowPanel.vue')
  assert.match(stage, /'重试失败步骤'/)
  assert.match(stage, /'暂停处理'/)
  assert.match(panel, /'重试加载素材处理'/)
  assert.match(panel, /'恢复轮询'/)
})

test('项目列表失败条和自由创作入口保持中文操作名', () => {
  const banners = read('../src/components/filmList/FilmListFailureBanners.vue')
  const freeCreate = read('../src/components/freeCreate/FreeCreateInputPanel.vue')
  assert.match(banners, /'重试加载'/)
  assert.match(banners, /'重新选择项目包'/)
  assert.match(freeCreate, /aria-label="重新检查生成能力"/)
  assert.match(freeCreate, /aria-label="前往 AI 配置"/)
})
