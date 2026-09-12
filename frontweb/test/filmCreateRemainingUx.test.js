import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  describeActionTitle,
  toFilmCreateUserFacingText,
} from '../src/components/filmCreate/filmCreateActionCopy.js'
import { describeDeliveryPanelState } from '../src/components/filmCreate/filmCreateDeliveryPanelCopy.js'

function read(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
}

function styleBlock(source) {
  const start = source.lastIndexOf('<style')
  return start >= 0 ? source.slice(start) : source
}

const delivery = read('../src/components/filmCreate/FilmCreateDeliveryPanel.vue')
const workbench = read('../src/components/filmCreate/FilmCreateScriptWorkbench.vue')
const resourcePanel = read('../src/components/filmCreate/FilmCreateResourcePanel.vue')
const resourceBlockCss = read('../src/components/filmCreate/filmCreateResourceBlock.css')
const scriptColumnCss = read('../src/components/filmCreate/FilmCreateStoryboardScriptColumn.css')
const storyboardEmpty = read('../src/components/filmCreate/FilmCreateStoryboardEmptyState.vue')
const characterBlock = read('../src/components/filmCreate/FilmCreateCharacterBlock.vue')
const propBlock = read('../src/components/filmCreate/FilmCreatePropBlock.vue')
const sceneBlock = read('../src/components/filmCreate/FilmCreateSceneBlock.vue')

test('交付面板、剧本工作台、资源空态和分镜脚本列在 769px 不再撑宽', () => {
  const deliveryStyle = styleBlock(delivery)
  assert.match(deliveryStyle, /\.delivery-overview[\s\S]*min-width:\s*0/)
  assert.match(
    deliveryStyle,
    /@media \(max-width: 769px\) \{[\s\S]*\.delivery-overview \{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  )
  assert.match(deliveryStyle, /\.delivery-stat \{[\s\S]*min-width:\s*0/)
  assert.match(deliveryStyle, /\.delivery-stat span[\s\S]*overflow-wrap:\s*anywhere/)

  const workbenchStyle = styleBlock(workbench)
  assert.match(workbenchStyle, /\.script-workbench-unified[\s\S]*min-width:\s*0/)
  assert.match(workbenchStyle, /\.script-title-input \{[\s\S]*min-width:\s*0/)
  assert.doesNotMatch(workbenchStyle, /\.script-title-input \{[\s\S]*min-width:\s*min\(280px/)
  assert.match(workbenchStyle, /\.film-episode-empty-actions \{[\s\S]*flex-wrap:\s*wrap/)
  assert.match(workbenchStyle, /@media \(max-width: 769px\) \{[\s\S]*\.script-add-episode \{[\s\S]*margin-left:\s*0/)

  const resourceStyle = styleBlock(resourcePanel)
  assert.match(resourceStyle, /\.resource-empty-tip \{[\s\S]*min-width:\s*0/)
  assert.match(resourceStyle, /\.resource-empty-copy \{[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(resourceStyle, /\.resource-empty-actions \{[\s\S]*flex-wrap:\s*wrap[\s\S]*min-width:\s*0/)
  assert.match(resourceStyle, /@media \(max-width: 769px\) \{[\s\S]*\.resource-empty-actions \{[\s\S]*width:\s*100%/)
  assert.match(resourceBlockCss, /\.asset-actions \{[\s\S]*flex-wrap:\s*wrap[\s\S]*min-width:\s*0/)
  assert.match(resourceBlockCss, /minmax\(\s*min\(\s*460px,\s*100%\s*\)/)

  assert.match(scriptColumnCss, /\.sb-script \{[\s\S]*min-width:\s*0[\s\S]*overflow-x:\s*hidden/)
  assert.match(scriptColumnCss, /\.sb-script-row \{[\s\S]*flex-wrap:\s*wrap[\s\S]*min-width:\s*0/)
  assert.match(
    scriptColumnCss,
    /@media \(max-width: 769px\) \{[\s\S]*\.sb-script-row\.sb-script-selects \{[\s\S]*flex-direction:\s*column/,
  )
  assert.match(scriptColumnCss, /\.sb-script-row\.sb-script-selects[\s\S]*min-width:\s*0/)

  const emptyStyle = styleBlock(storyboardEmpty)
  assert.match(emptyStyle, /\.empty-tip \{[\s\S]*min-width:\s*0/)
  assert.match(emptyStyle, /\.empty-tip-actions \{[\s\S]*flex-wrap:\s*wrap[\s\S]*min-width:\s*0/)
})

test('空态读屏名包含可见文案，每个空态动作区只有一个 primary', () => {
  assert.match(resourcePanel, /:aria-label="extractCharactersEmptyAriaLabel"/)
  assert.match(resourcePanel, /:aria-label="extractPropsEmptyAriaLabel"/)
  assert.match(resourcePanel, /:aria-label="extractScenesEmptyAriaLabel"/)
  assert.match(resourcePanel, /aria-label="去创建剧集"/)
  assert.match(resourcePanel, /aria-label="去选择剧集"/)
  assert.doesNotMatch(resourcePanel, /去创建剧集后再提取/)
  assert.match(resourcePanel, /characterGenerationDisabledReason === EPISODE_REQUIRED_REASON/)
  assert.match(characterBlock, /:type="characters.length \? 'primary' : undefined"/)
  assert.match(propBlock, /:type="propItems.length \? 'primary' : undefined"/)
  assert.match(sceneBlock, /:type="scenes.length \? 'primary' : undefined"/)
  assert.match(storyboardEmpty, /aria-label="去创建剧集"/)
  assert.doesNotMatch(storyboardEmpty, /去创建剧集后再生成分镜/)
  assert.match(resourcePanel, /type="primary"[\s\S]*:aria-label="extractCharactersEmptyAriaLabel"/)
  assert.match(resourcePanel, /type="primary"[\s\S]*:aria-label="extractPropsEmptyAriaLabel"/)
  assert.match(resourcePanel, /type="primary"[\s\S]*:aria-label="extractScenesEmptyAriaLabel"/)
})

test('用户可见失败会去掉 HTTP 状态码', () => {
  assert.equal(toFilmCreateUserFacingText('素材读取失败（HTTP 503）', '操作失败，请稍后重试'), '操作失败，请稍后重试')
  assert.equal(toFilmCreateUserFacingText('HTTP 404', '操作失败，请稍后重试'), '操作失败，请稍后重试')
  assert.equal(toFilmCreateUserFacingText('生成失败（HTTP 500）', '生成失败'), '生成失败')
  assert.equal(describeActionTitle({ disabledReason: '加载失败 HTTP 502' }), '当前不可用')
  const failed = describeDeliveryPanelState({
    videoStatus: 'error',
    videoErrorMsg: '成片合成失败（HTTP 503）',
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  assert.equal(failed.videoErrorMsg, '成片合成失败，请稍后重试')
  assert.doesNotMatch(JSON.stringify(failed), /HTTP\s*503/i)
  assert.match(characterBlock, /toFilmCreateUserFacingText\(props\.assetErrorText\(asset\), '生成失败'\)/)
  assert.match(propBlock, /toFilmCreateUserFacingText\(props\.assetErrorText\(asset\), '生成失败'\)/)
  assert.match(sceneBlock, /toFilmCreateUserFacingText\(props\.assetErrorText\(asset\), '生成失败'\)/)
})
