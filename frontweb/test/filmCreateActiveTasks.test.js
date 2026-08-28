import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useFilmCreateActiveTasks } from '../src/composables/filmCreate/useFilmCreateActiveTasks.js'
import { GEN_RESOURCE } from '../src/stores/generationTaskStore.js'

function createDeps(overrides = {}) {
  return {
    genStore: {
      getAllRunningTasks: () => [],
    },
    pipelineRunning: ref(false),
    pipelineStopping: ref(false),
    pipelineAbortRequested: ref(false),
    pipelineCurrentStep: ref(''),
    isStoryGenRunning: ref(false),
    universalOmniPolishRunning: ref(false),
    universalOmniPolishProgress: ref({ current: 0, total: 0, label: '' }),
    batchImageRunning: ref(false),
    batchVideoRunning: ref(false),
    batchVideoProgress: ref({ current: 0, total: 0, failed: 0 }),
    ...overrides,
  }
}

test('active tasks stay empty when nothing is running', () => {
  const { allActiveTaskItems, allActiveTaskLabels } = useFilmCreateActiveTasks(createDeps())
  assert.deepEqual(allActiveTaskItems.value, [])
  assert.deepEqual(allActiveTaskLabels.value, [])
})

test('pipeline labels distinguish running, stopping and unfinished abort', () => {
  const deps = createDeps({
    pipelineRunning: ref(true),
    pipelineCurrentStep: ref('[步骤 2/5] 生成分镜图'),
  })
  const { allActiveTaskItems } = useFilmCreateActiveTasks(deps)
  assert.equal(allActiveTaskItems.value[0].kind, 'pipeline')
  assert.equal(allActiveTaskItems.value[0].label, '生成分镜图')

  deps.pipelineStopping.value = true
  assert.equal(allActiveTaskItems.value[0].label, '正在停止全流程...')

  deps.pipelineStopping.value = false
  deps.pipelineAbortRequested.value = true
  assert.equal(allActiveTaskItems.value[0].label, '全流程停止未完成，点击重试')
})

test('local story generation is omitted when genStore already tracks the same story task', () => {
  const running = [{
    key: 'story-1',
    resourceType: GEN_RESOURCE.GENERATE_STORY,
    label: '生成剧本...',
  }]
  const withStore = useFilmCreateActiveTasks(createDeps({
    isStoryGenRunning: ref(true),
    genStore: { getAllRunningTasks: () => running },
  }))
  assert.equal(withStore.allActiveTaskItems.value.length, 1)
  assert.equal(withStore.allActiveTaskItems.value[0].kind, 'genStore')

  const localOnly = useFilmCreateActiveTasks(createDeps({
    isStoryGenRunning: ref(true),
  }))
  assert.equal(localOnly.allActiveTaskItems.value[0].kind, 'storyGenLocal')
  assert.equal(localOnly.allActiveTaskItems.value[0].label, '生成剧本...')
})

test('batch video progress and omni polish keep drama/episode ids from leaking into labels', () => {
  const dramaId = 11
  const episodeId = 22
  assert.notEqual(dramaId, episodeId)
  const { allActiveTaskItems, allActiveTaskLabels } = useFilmCreateActiveTasks(createDeps({
    universalOmniPolishRunning: ref(true),
    universalOmniPolishProgress: ref({ current: 1, total: 4, label: '分镜 3' }),
    batchVideoRunning: ref(true),
    batchVideoProgress: ref({ current: 2, total: 6, failed: 0 }),
    batchImageRunning: ref(true),
  }))
  const labels = allActiveTaskLabels.value.join('|')
  assert.match(labels, /润色全能分镜 1\/4 分镜 3/)
  assert.match(labels, /批量生成分镜视频 2\/6/)
  assert.match(labels, /批量生成分镜图/)
  assert.equal(labels.includes(String(dramaId)), false)
  assert.equal(labels.includes(String(episodeId)), false)
  assert.equal(allActiveTaskItems.value.length, 3)
})
