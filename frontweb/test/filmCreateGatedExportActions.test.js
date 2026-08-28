import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storyboardPanel = readFileSync(new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url), 'utf8')
const scriptWorkbench = readFileSync(new URL('../src/components/filmCreate/FilmCreateScriptWorkbench.vue', import.meta.url), 'utf8')
const resourcePanel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')

test('分镜导出按钮在没有剧集时展示禁用原因', () => {
  assert.match(storyboardPanel, /<ActionGate[\s\S]*?label="导出分镜表"/)
  assert.match(storyboardPanel, /<ActionGate[\s\S]*?label="导出解说 SRT"/)
  assert.match(storyboardPanel, /:disabled="Boolean\(episodeActionDisabledReason\)"/)
  assert.match(storyboardPanel, /首尾帧模式下使用单张图，序列宫格暂不可用/)
})

test('保存当前集在未选剧集时展示禁用原因', () => {
  assert.match(scriptWorkbench, /<ActionGate :reason="saveCurrentEpisodeDisabledReason" label="保存当前集">/)
  assert.match(scriptWorkbench, /describeSaveCurrentEpisodeDisabledReason/)
})

test('角色道具场景入库按钮在缺图时展示禁用原因', () => {
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(char\)" label="加入本剧库">/)
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(prop\)" label="加入素材库">/)
  assert.match(resourcePanel, /<ActionGate :reason="missingAssetImageReason\(scene\)" label="加入本剧库">/)
  assert.match(resourcePanel, /describeMissingAssetImageReason\(hasAssetImage\(item\)\)/)
})
