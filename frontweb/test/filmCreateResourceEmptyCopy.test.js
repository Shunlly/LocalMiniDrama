import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { useFilmCreateNavSteps } from '../src/composables/filmCreate/useFilmCreateNavSteps.js'

const panel = readFileSync(new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url), 'utf8')

function refOf(value) {
  return { value }
}

function createNav(overrides = {}) {
  return useFilmCreateNavSteps({
    genStore: { getRunningForEpisode() { return [] } },
    dramaId: refOf(11),
    currentEpisodeId: refOf(22),
    scriptContent: refOf(''),
    isStoryGenRunning: refOf(false),
    characters: refOf([]),
    hasAssetImage: () => false,
    charactersGenerating: refOf(false),
    generatingCharIds: new Set(),
    props: refOf([]),
    propsExtracting: refOf(false),
    generatingPropIds: new Set(),
    scenes: refOf([]),
    scenesExtracting: refOf(false),
    generatingSceneIds: new Set(),
    storyboards: refOf([]),
    storyboardGenerating: refOf(false),
    universalOmniPolishRunning: refOf(false),
    hasSbImage: () => false,
    generatingSbImageIds: new Set(),
    batchImageRunning: refOf(false),
    getSbAllVideos: () => [],
    batchVideoRunning: refOf(false),
    generatingSbVideoIds: new Set(),
    videoStatus: refOf('idle'),
    currentEpisodeVideoUrl: refOf(''),
    ...overrides,
  })
}

test('资源面板标题与导航步骤一致，空态指向真实按钮', () => {
  const { navSteps } = createNav()
  const labels = Object.fromEntries(navSteps.value.map((step) => [step.key, step.label]))
  assert.equal(labels.chars, '角色')
  assert.equal(labels.props, '道具')
  assert.equal(labels.scenes, '场景')
  assert.match(panel, /class="resource-block-title">角色<\/span>/)
  assert.match(panel, /class="resource-block-title">道具<\/span>/)
  assert.match(panel, /class="resource-block-title">场景<\/span>/)
  assert.match(panel, /暂无角色，可用「剧本自动提取角色」或「添加角色」/)
  assert.match(panel, /暂无道具，可用「从剧本提取道具」或「添加道具」/)
  assert.match(panel, /暂无场景，可用「从剧本提取场景」或「添加场景」/)
  assert.doesNotMatch(panel, /class="resource-block-title">角色生成<\/span>/)
})