import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { filmCreateActionTitle } from '../src/components/filmCreate/filmCreateActionTitle.js'

function read(name) {
  return readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')
}

test('禁用 title 辅助函数：进行中优先，空原因不输出', () => {
  assert.equal(filmCreateActionTitle('当前集还没有剧本，请先编写或导入剧本'), '当前集还没有剧本，请先编写或导入剧本')
  assert.equal(filmCreateActionTitle('', true, '正在保存角色，请稍候'), '正在保存角色，请稍候')
  assert.equal(filmCreateActionTitle('请先填写名称', true, '正在保存道具，请稍候'), '正在保存道具，请稍候')
  assert.equal(filmCreateActionTitle(''), undefined)
  assert.equal(filmCreateActionTitle('Network Error'), 'Network Error')
})

test('小说导入改走按需反馈，导入中给出中文 title', () => {
  const source = read('FilmCreateNovelImportDialog.vue')
  assert.match(source, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(source, /from 'element-plus'/)
  assert.match(source, /:title="importDisabledReason \|\| undefined"/)
  assert.match(source, /正在导入小说，请稍候/)
  assert.match(source, /正在读取文本，请稍候/)
  assert.match(source, /正在确认导入内容，请稍候/)
  assert.match(source, /会消耗额度/)
  assert.doesNotMatch(source, /会消耗 Token/)
})

test('交付、全流程、分镜和资源禁用按钮带中文 title', () => {
  const delivery = read('FilmCreateDeliveryPanel.vue') + read('filmCreateDeliveryPanelCopy.js')
  const pipeline = read('FilmCreatePipelinePanel.vue') + read('filmCreatePipelinePanelUx.js') + read('filmCreatePipelinePanelBindings.js') + read('FilmCreatePipelineActions.vue')
  const storyboard = read('FilmCreateStoryboardPanel.vue') + read('FilmCreateStoryboardEmptyState.vue')
  const configBar = read('FilmCreateStoryboardConfigBar.vue')
  const resource = read('FilmCreateResourcePanel.vue')
  const videoColumn = read('FilmCreateStoryboardVideoColumn.vue')
  const script = read('FilmCreateScriptWorkbench.vue')

  assert.match(delivery, /:title="panelState\.composeButtonTitle"/)
  assert.match(delivery, /loadingLabel: '正在合成成片'/)
  assert.match(delivery, /请稍候/)
  assert.match(pipeline, /:title="productionButtonTitle(?: \|\| undefined)?"/)
  assert.match(pipeline, /:title="draftButtonTitle(?: \|\| undefined)?"/)
  assert.match(pipeline, /正在生成完整成片，请稍候/)
  assert.match(storyboard, /正在生成分镜，请稍候/)
  assert.match(configBar, /正在生成分镜，请稍候/)
  assert.match(configBar, /正在批量生成分镜视频，请稍候/)
  assert.match(resource, /正在提取角色，请稍候/)
  assert.match(resource, /正在提取道具，请稍候/)
  assert.match(resource, /正在提取场景，请稍候/)
  assert.match(videoColumn, /正在生成分镜视频，请稍候/)
  assert.match(script, /正在保存当前集，请稍候/)
  assert.match(script, /正在生成剧本，请稍候/)
})

test('制作页组件用户可见文案不再弹出 Network Error / Please', () => {
  const files = [
    'FilmCreateDeliveryPanel.vue',
    'FilmCreatePipelinePanel.vue',
    'FilmCreatePipelineActions.vue',
    'FilmCreatePipelineSteps.vue',
    'FilmCreatePipelineStatus.vue',
    'FilmCreateStoryboardPanel.vue',
    'FilmCreateStoryboardEmptyState.vue',
    'FilmCreateStoryboardToolbar.vue',
    'FilmCreateStoryboardList.vue',
    'FilmCreateResourcePanel.vue',
    'FilmCreateScriptWorkbench.vue',
    'FilmCreateNovelImportDialog.vue',
  ]
  for (const name of files) {
    const source = read(name)
    const templateEnd = source.indexOf('<script')
    const template = templateEnd > 0 ? source.slice(0, templateEnd) : source
    assert.doesNotMatch(template, /\bPlease\b|\bFailed\b|\bNetwork Error\b|\bHTTP Error\b/, name)
  }
})
