import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ref } from 'vue'

const composableUrl = new URL('../src/composables/useCanvasCrud.js', import.meta.url)
const composableSource = readFileSync(composableUrl, 'utf8')

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const elementPlusStubUrl = dataModule(`
  export const ElMessage = {
    info(message) { globalThis.__canvasCrudTestState.messages.push({ type: 'info', message }) },
    warning(message) { globalThis.__canvasCrudTestState.messages.push({ type: 'warning', message }) },
    success(message) { globalThis.__canvasCrudTestState.messages.push({ type: 'success', message }) },
  }
`)

function apiStub(name, methods) {
  return dataModule(`
    export const ${name} = {
      ${methods.map((method) => `${method}(...args) { return globalThis.__canvasCrudTestState.${method}(...args) }`).join(',\n      ')}
    }
  `)
}

const moduleUrls = new Map([
  ['vue', import.meta.resolve('vue')],
  ['element-plus', elementPlusStubUrl],
  ['@/api/drama', apiStub('dramaAPI', ['saveEpisodes', 'saveCharacters'])],
  ['@/api/storyboards', apiStub('storyboardsAPI', ['create'])],
  ['@/api/scenes', apiStub('sceneAPI', ['create'])],
  ['@/api/props', apiStub('propAPI', ['create'])],
])

let loadableSource = composableSource
for (const [specifier, resolved] of moduleUrls) {
  loadableSource = loadableSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from '${resolved}'`)
}

const { useCanvasCrud } = await import(dataModule(loadableSource))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function project(id, title) {
  return {
    id,
    title,
    episodes: [{ id: id * 10, episode_number: 1, title: '第1集', storyboards: [] }],
    characters: [],
  }
}

function createHarness({ request, persistResult = { ok: true } }) {
  const drama = ref(project(1, '项目 A'))
  const routeProjectId = ref(1)
  const filterEpisodeId = ref(10)
  const layoutCache = ref(null)
  const focusedNodeId = ref(null)
  const calls = { persist: [], refresh: 0, focus: [], episodeFilter: [] }
  globalThis.__canvasCrudTestState = {
    messages: [],
    saveEpisodes: (...args) => request('episode', args),
    saveCharacters: (...args) => request('character', args),
    create: (...args) => request(globalThis.__canvasCrudTestState.createType, args),
    createType: '',
  }

  const crud = useCanvasCrud({
    drama,
    routeProjectId,
    canvasMode: ref('production'),
    filterEpisodeId,
    layoutCache,
    focusedNodeId,
    setFocusedNode: async (nodeId) => { calls.focus.push(nodeId) },
    setEpisodeFilter: async (episodeId) => {
      calls.episodeFilter.push(episodeId)
      filterEpisodeId.value = episodeId
    },
    refreshCanvas: async () => { calls.refresh += 1 },
    persistCanvasState: async (options) => {
      calls.persist.push(options)
      return persistResult
    },
  })

  return { crud, drama, routeProjectId, filterEpisodeId, layoutCache, focusedNodeId, calls }
}

test('position persistence failure closes a successfully created entity and prevents duplicate create', async () => {
  let createCalls = 0
  const harness = createHarness({
    request: async (type) => {
      assert.equal(type, 'storyboard')
      createCalls += 1
      return { id: 101 }
    },
    persistResult: { ok: false, error: new Error('save failed') },
  })
  globalThis.__canvasCrudTestState.createType = 'storyboard'
  harness.crud.openCreateDialog('storyboard', { x: 120, y: 80 })

  assert.equal(await harness.crud.submitCreate({ title: '镜头 A' }), true)
  assert.equal(await harness.crud.submitCreate({ title: '镜头 A' }), false)
  assert.equal(createCalls, 1)
  assert.deepEqual(harness.calls.persist, [{ layoutOnly: true }])
  assert.equal(harness.calls.refresh, 1)
  assert.deepEqual(harness.calls.focus, ['sb:101'])
  assert.deepEqual(globalThis.__canvasCrudTestState.messages, [{
    type: 'warning',
    message: '分镜已创建，但画布位置尚未保存，请使用画布保存重试',
  }])
  assert.equal(harness.crud.createDialogVisible.value, false)
})

const cases = [
  { type: 'storyboard', form: { title: '镜头 A', description: '' }, result: { id: 101 } },
  { type: 'episode', form: { title: '新一集' }, result: {} },
  { type: 'character', form: { name: '角色 A' }, result: {} },
  { type: 'scene', form: { location: '场景 A' }, result: { id: 201 } },
  { type: 'prop', form: { name: '道具 A' }, result: { id: 301 } },
]

for (const scenario of cases) {
  test(`${scenario.type} creation ignores a deferred project A response when only the route switches to project B`, async () => {
    const pendingRequest = deferred()
    const harness = createHarness({
      request: (type) => {
        assert.equal(type, scenario.type)
        return pendingRequest.promise
      },
    })
    globalThis.__canvasCrudTestState.createType = scenario.type
    harness.crud.openCreateDialog(scenario.type, { x: 120, y: 80 })

    const pendingCreate = harness.crud.submitCreate(scenario.form)
    await Promise.resolve()
    harness.routeProjectId.value = 2
    pendingRequest.resolve(scenario.result)

    assert.equal(await pendingCreate, false)
    assert.deepEqual(harness.calls.persist, [])
    assert.equal(harness.calls.refresh, 0)
    assert.deepEqual(harness.calls.focus, [])
    assert.deepEqual(harness.calls.episodeFilter, [])
    assert.equal(harness.layoutCache.value, null)
    assert.deepEqual(globalThis.__canvasCrudTestState.messages, [])
    assert.equal(harness.crud.createDialogVisible.value, false)
  })
}

for (const scenario of cases) {
  test(`${scenario.type} creation ignores a deferred project A response after switching to project B`, async () => {
    const pendingRequest = deferred()
    const harness = createHarness({
      request: (type) => {
        assert.equal(type, scenario.type)
        return pendingRequest.promise
      },
    })
    globalThis.__canvasCrudTestState.createType = scenario.type
    harness.crud.openCreateDialog(scenario.type, { x: 120, y: 80 })

    const pendingCreate = harness.crud.submitCreate(scenario.form)
    await Promise.resolve()
    harness.drama.value = project(2, '项目 B')
    harness.filterEpisodeId.value = 20
    pendingRequest.resolve(scenario.result)

    const result = await pendingCreate
    assert.deepEqual(harness.calls.persist, [])
    assert.equal(harness.calls.refresh, 0)
    assert.deepEqual(harness.calls.focus, [])
    assert.deepEqual(harness.calls.episodeFilter, [])
    assert.equal(harness.layoutCache.value, null)
    assert.deepEqual(globalThis.__canvasCrudTestState.messages, [])
    assert.equal(harness.crud.createDialogVisible.value, false)
    assert.equal(result, false)
  })
}

test('a create dialog opened in project A cannot submit after project B becomes current', async () => {
  let requestCount = 0
  const harness = createHarness({
    request: async () => {
      requestCount += 1
      return { id: 101 }
    },
  })
  globalThis.__canvasCrudTestState.createType = 'storyboard'
  harness.crud.openCreateDialog('storyboard', { x: 120, y: 80 })

  harness.routeProjectId.value = 2
  harness.drama.value = project(2, '项目 B')
  harness.filterEpisodeId.value = 20
  await Promise.resolve()

  assert.equal(await harness.crud.submitCreate({ title: '不应创建' }), false)
  assert.equal(requestCount, 0)
  assert.equal(harness.crud.createDialogVisible.value, false)
  assert.equal(harness.crud.pendingFlowPosition.value, null)
})

const sameProjectCases = [
  {
    ...cases[0],
    expectedPersist: [{ layoutOnly: true }],
    expectedRefresh: 1,
    expectedFocus: ['sb:101'],
    expectedPositionId: 'sb:101',
    successMessage: '分镜已添加',
  },
  {
    ...cases[1],
    expectedPersist: [],
    expectedRefresh: 1,
    expectedFocus: [],
    successMessage: '已添加新一集',
  },
  {
    ...cases[2],
    expectedPersist: [],
    expectedRefresh: 2,
    expectedFocus: [],
    successMessage: '角色已添加',
  },
  {
    ...cases[3],
    expectedPersist: [{ layoutOnly: true }],
    expectedRefresh: 1,
    expectedFocus: ['scene:201'],
    expectedPositionId: 'scene:201',
    successMessage: '场景已添加',
  },
  {
    ...cases[4],
    expectedPersist: [{ layoutOnly: true }],
    expectedRefresh: 1,
    expectedFocus: ['prop:301'],
    expectedPositionId: 'prop:301',
    successMessage: '道具已添加',
  },
]

for (const scenario of sameProjectCases) {
  test(`same-project ${scenario.type} creation preserves its success flow`, async () => {
    const harness = createHarness({
      request: async (type) => {
        assert.equal(type, scenario.type)
        return scenario.result
      },
    })
    globalThis.__canvasCrudTestState.createType = scenario.type
    harness.crud.openCreateDialog(scenario.type, { x: 120, y: 80 })

    assert.equal(await harness.crud.submitCreate(scenario.form), true)

    assert.deepEqual(harness.calls.persist, scenario.expectedPersist)
    assert.equal(harness.calls.refresh, scenario.expectedRefresh)
    assert.deepEqual(harness.calls.focus, scenario.expectedFocus)
    if (scenario.expectedPositionId) {
      assert.deepEqual(
        harness.layoutCache.value?.nodes?.[scenario.expectedPositionId],
        { x: 120, y: 80 },
      )
    }
    assert.deepEqual(globalThis.__canvasCrudTestState.messages, [
      { type: 'success', message: scenario.successMessage },
    ])
    assert.equal(harness.crud.createDialogVisible.value, false)
  })
}

test.afterEach(() => {
  delete globalThis.__canvasCrudTestState
})
