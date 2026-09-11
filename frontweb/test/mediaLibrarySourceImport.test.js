import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import { createDeferred } from './helpers/vueComponentHarness.js'
import {
  buildMediaLibrarySourceImportDestination,
  describeMediaLibrarySourceImportProjectAction,
  normalizeMediaLibrarySourceImportProjectId,
  normalizeMediaLibrarySourceImportProjects,
} from '../src/utils/mediaLibrarySourceImport.js'
import {
  createMediaLibrarySourceImport,
  describeMediaLibrarySourceImportLoadError,
} from '../src/components/mediaLibrary/mediaLibrarySourceImport.js'

const SCOPED_ID = 12
const SELECTED_ID = 34
const OTHER_ID = 56
assert.notEqual(SCOPED_ID, SELECTED_ID)
assert.notEqual(SELECTED_ID, OTHER_ID)

function createRouter() {
  const calls = []
  return {
    calls,
    push(value) {
      calls.push(['push', value])
      return Promise.resolve()
    },
  }
}

test('网页导入目的地只接受正整数项目 ID，并带上 intake 与素材流程锚点', () => {
  assert.equal(normalizeMediaLibrarySourceImportProjectId('12'), 12)
  assert.equal(normalizeMediaLibrarySourceImportProjectId(OTHER_ID), OTHER_ID)
  assert.equal(normalizeMediaLibrarySourceImportProjectId(0), null)
  assert.equal(normalizeMediaLibrarySourceImportProjectId('bad'), null)
  assert.deepEqual(
    buildMediaLibrarySourceImportDestination({ projectId: String(SELECTED_ID), returnTo: '/film/12?episode=4' }),
    {
      name: 'drama-detail',
      params: { id: SELECTED_ID },
      query: { intake: 'source-url', returnTo: '/film/12?episode=4' },
      hash: '#source-intake-workflow',
    },
  )
  assert.equal(
    buildMediaLibrarySourceImportDestination({ projectId: SELECTED_ID, returnTo: '/film/12?episode=4' }).params.id,
    SELECTED_ID,
  )
  assert.notEqual(
    buildMediaLibrarySourceImportDestination({ projectId: SELECTED_ID }).params.id,
    SCOPED_ID,
  )
  assert.deepEqual(
    buildMediaLibrarySourceImportDestination({ projectId: SELECTED_ID }),
    {
      name: 'drama-detail',
      params: { id: SELECTED_ID },
      query: { intake: 'source-url' },
      hash: '#source-intake-workflow',
    },
  )
  assert.equal(buildMediaLibrarySourceImportDestination({ projectId: 0 }), null)
  assert.equal(describeMediaLibrarySourceImportProjectAction({ title: '雨巷' }), '导入到项目「雨巷」')
  assert.equal(describeMediaLibrarySourceImportProjectAction({}), '导入到项目「未命名项目」')
})

test('项目列表归一化会丢掉非法 ID，且不会把其他项目的 ID 算进来', () => {
  const normalized = normalizeMediaLibrarySourceImportProjects({
    items: [
      { id: SELECTED_ID, title: '雨巷', episodes: [{ id: 1 }] },
      { id: 'bad', title: '脏数据' },
      { id: OTHER_ID, title: '  ', episodes: [] },
    ],
    pagination: { total: 2, page: 1, page_size: 24 },
  }, { page: 1, pageSize: 24 })
  assert.deepEqual(normalized.items.map((item) => item.id), [SELECTED_ID, OTHER_ID])
  assert.equal(normalized.items[0].title, '雨巷')
  assert.equal(normalized.items[0].episodeCount, 1)
  assert.equal(normalized.items[1].title, '')
  assert.equal(normalized.items[1].episodeCount, 0)
  assert.doesNotMatch(JSON.stringify(normalized.items), new RegExp(String(SCOPED_ID)))
})

test('已有当前项目时直接进入该项目素材流程，不会打开选择弹窗，也不会误用其他项目 ID', () => {
  const router = createRouter()
  const navCalls = []
  const picker = createMediaLibrarySourceImport({
    router,
    scopedDramaId: ref(SCOPED_ID),
    returnTo: ref('/film/12?episode=4'),
    navigationLocked: ref(false),
    openWorkspaceNavItem: (...args) => navCalls.push(args),
    dramaAPI: { list() { throw new Error('should not list') } },
  })

  assert.equal(picker.goSourceImport(), 'direct')
  assert.equal(picker.showPicker.value, false)
  assert.deepEqual(router.calls, [[
    'push',
    {
      name: 'drama-detail',
      params: { id: SCOPED_ID },
      query: { intake: 'source-url', returnTo: '/film/12?episode=4' },
      hash: '#source-intake-workflow',
    },
  ]])
  assert.equal(router.calls[0][1].params.id, SCOPED_ID)
  assert.notEqual(router.calls[0][1].params.id, SELECTED_ID)
  assert.deepEqual(navCalls, [])
})

test('没有当前项目时在素材中心打开选择弹窗，而不是踢回首页', () => {
  const router = createRouter()
  const navCalls = []
  const picker = createMediaLibrarySourceImport({
    router,
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(false),
    openWorkspaceNavItem: (...args) => navCalls.push(args),
    dramaAPI: { list() { throw new Error('should not list until open') } },
  })

  assert.equal(picker.goSourceImport(), 'picker')
  assert.equal(picker.showPicker.value, true)
  assert.deepEqual(router.calls, [])
  assert.deepEqual(navCalls, [])

  picker.navigationLocked = picker
  const locked = createMediaLibrarySourceImport({
    router,
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(true),
    openWorkspaceNavItem: (...args) => navCalls.push(args),
  })
  assert.equal(locked.goSourceImport(), 'locked')
  assert.equal(locked.showPicker.value, false)
})

test('选定项目后进入该项目素材流程，不会把另一个项目 ID 写进路由', async () => {
  const router = createRouter()
  const picker = createMediaLibrarySourceImport({
    router,
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(false),
    dramaAPI: {
      async list() {
        return { items: [{ id: SELECTED_ID, title: '雨巷' }], pagination: { total: 1, page: 1, page_size: 24 } }
      },
    },
  })

  const loaded = await picker.loadProjects()
  assert.equal(loaded.status, 'applied')
  assert.equal(picker.projects.value[0].id, SELECTED_ID)
  assert.equal(picker.selectProject({ id: SELECTED_ID, title: '雨巷' }), true)
  assert.equal(picker.showPicker.value, false)
  assert.deepEqual(router.calls, [[
    'push',
    {
      name: 'drama-detail',
      params: { id: SELECTED_ID },
      query: { intake: 'source-url' },
      hash: '#source-intake-workflow',
    },
  ]])
  assert.notEqual(router.calls[0][1].params.id, OTHER_ID)
  assert.equal(picker.selectProject({ id: 'bad' }), false)
})

test('项目列表失败展示中文错误；过期请求不会覆盖后一次结果', async () => {
  const first = createDeferred()
  const second = createDeferred()
  let calls = 0
  const picker = createMediaLibrarySourceImport({
    router: createRouter(),
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(false),
    dramaAPI: {
      list() {
        calls += 1
        return calls === 1 ? first.promise : second.promise
      },
    },
  })

  const pendingFirst = picker.loadProjects()
  const pendingSecond = picker.loadProjects()
  first.resolve({
    items: [{ id: OTHER_ID, title: '过期项目' }],
    pagination: { total: 1, page: 1, page_size: 24 },
  })
  second.resolve({
    items: [{ id: SELECTED_ID, title: '雨巷' }],
    pagination: { total: 1, page: 1, page_size: 24 },
  })
  assert.equal((await pendingFirst).status, 'stale')
  assert.equal((await pendingSecond).status, 'applied')
  assert.deepEqual(picker.projects.value.map((item) => item.id), [SELECTED_ID])
  assert.doesNotMatch(JSON.stringify(picker.projects.value), new RegExp(String(OTHER_ID)))

  const failed = createMediaLibrarySourceImport({
    router: createRouter(),
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(false),
    dramaAPI: {
      async list() {
        const error = new Error('offline')
        error.response = { status: 503 }
        throw error
      },
    },
  })
  const result = await failed.loadProjects()
  assert.equal(result.status, 'failed')
  assert.match(failed.loadError.value, /项目服务暂时不可用/)
  assert.match(describeMediaLibrarySourceImportLoadError({ response: { status: 503 } }), /项目服务/)
  assert.doesNotMatch(failed.loadError.value, /Network Error|fetch failed/i)
})

test('弹窗里新建项目才带上导入意图；不会把选择动作伪装成回首页', () => {
  const router = createRouter()
  const navCalls = []
  const picker = createMediaLibrarySourceImport({
    router,
    scopedDramaId: ref(null),
    returnTo: ref(''),
    navigationLocked: ref(false),
    openWorkspaceNavItem: (currentRouter, itemId, options) => {
      navCalls.push([currentRouter === router, itemId, options])
    },
  })
  picker.showPicker.value = true
  assert.equal(picker.createProjectFromPicker(), true)
  assert.equal(picker.showPicker.value, false)
  assert.deepEqual(navCalls, [[true, 'list', { query: { new: '1', intent: 'source-import' } }]])
  assert.deepEqual(router.calls, [])
})
