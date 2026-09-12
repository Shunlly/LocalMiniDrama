import test from 'node:test'
import assert from 'node:assert/strict'
import { useFilmCreateNavSteps } from '../src/composables/filmCreate/useFilmCreateNavSteps.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'

const DRAMA_ID = 11
const EPISODE_ID = 22

function refOf(value) {
  return { value }
}

function createDeps(overrides = {}) {
  assert.notEqual(DRAMA_ID, EPISODE_ID)
  const running = overrides.running || []
  return {
    genStore: {
      getRunningForEpisode(dramaId, episodeId) {
        assert.equal(dramaId, DRAMA_ID)
        assert.equal(episodeId, EPISODE_ID)
        return running
      },
    },
    dramaId: refOf(DRAMA_ID),
    currentEpisodeId: refOf(EPISODE_ID),
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
  }
}

test('empty project reports pending steps and names delivery 交付与导出', () => {
  const { navSteps } = useFilmCreateNavSteps(createDeps())
  const keys = navSteps.value.map((step) => step.key)
  assert.deepEqual(keys, ['script', 'chars', 'props', 'scenes', 'sb', 'sbimg', 'video'])
  assert.equal(navSteps.value.find((step) => step.key === 'video').label, '交付与导出')
  assert.equal(navSteps.value.find((step) => step.key === 'chars').label, '角色')
  assert.ok(navSteps.value.every((step) => step.status === 'pending'))
})

test('script and asset images mark done, partial, and generating without mixing drama ids', () => {
  const { navSteps } = useFilmCreateNavSteps(createDeps({
    scriptContent: refOf('第一集剧本'),
    characters: refOf([{ id: 1 }, { id: 2 }]),
    hasAssetImage: (item) => item.id === 1,
    storyboards: refOf([{ id: 101 }, { id: 202 }]),
    hasSbImage: (sb) => sb.id === 101,
    getSbAllVideos: (id) => (id === 101 ? [{ id: 'v1' }] : []),
    running: [{ resourceType: GEN_RESOURCE.SB_VIDEO, resourceId: 202 }],
  }))
  const byKey = Object.fromEntries(navSteps.value.map((step) => [step.key, step]))
  assert.equal(byKey.script.status, 'done')
  assert.equal(byKey.chars.status, 'partial')
  assert.equal(byKey.chars.count, 2)
  assert.equal(byKey.sb.status, 'done')
  assert.equal(byKey.sbimg.status, 'partial')
  assert.equal(byKey.video.status, 'partial')
})

test('whole-episode video url is the only done state for delivery', () => {
  const done = useFilmCreateNavSteps(createDeps({
    storyboards: refOf([{ id: 3 }]),
    getSbAllVideos: () => [{ id: 'clip' }],
    currentEpisodeVideoUrl: refOf('/static/final.mp4'),
  }))
  assert.equal(done.navSteps.value.find((step) => step.key === 'video').status, 'done')

  const generating = useFilmCreateNavSteps(createDeps({
    storyboards: refOf([{ id: 3 }]),
    getSbAllVideos: () => [{ id: 'clip' }],
    videoStatus: refOf('generating'),
  }))
  assert.equal(generating.navSteps.value.find((step) => step.key === 'video').status, 'generating')
})
