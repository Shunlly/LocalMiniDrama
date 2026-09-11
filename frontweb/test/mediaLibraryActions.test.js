import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive, ref } from 'vue'

import { createLatestMediaRequestGuard } from '../src/utils/mediaLibrary.js'
import { createMediaLibraryNavigation } from '../src/components/mediaLibrary/mediaLibraryNavigation.js'
import { createMediaLibraryLocalLoad, describeMediaLoadError } from '../src/components/mediaLibrary/mediaLibraryLocalLoad.js'
import { createMediaLibraryNetworkActions, describeNetworkError } from '../src/components/mediaLibrary/mediaLibraryNetworkActions.js'
import { createMediaLibrarySelection } from '../src/components/mediaLibrary/mediaLibrarySelection.js'
import { describeServiceLoadError } from '../src/utils/requestError.js'
import { describeMediaLibraryUserError } from '../src/utils/mediaLibraryUserError.js'

test('无 returnTo 时 goBack 与 goHome 都回项目首页，有 returnTo 时 goBack 回制作台', () => {
  const calls = []
  const router = { push: (value) => calls.push(['push', value]) }
  const openWorkspaceNavItem = (currentRouter, itemId) => {
    calls.push(['nav', currentRouter === router, itemId])
  }

  const home = createMediaLibraryNavigation({
    router,
    returnTo: { value: '' },
    openWorkspaceNavItem,
  })
  home.goHome()
  home.goBack()
  assert.deepEqual(calls, [
    ['nav', true, 'list'],
    ['nav', true, 'list'],
  ])

  calls.length = 0
  const studio = createMediaLibraryNavigation({
    router,
    returnTo: { value: '/film/12?episode=4' },
    openWorkspaceNavItem,
  })
  studio.goHome()
  studio.goBack()
  assert.deepEqual(calls, [
    ['nav', true, 'list'],
    ['push', '/film/12?episode=4'],
  ])
})

test('loadMedia 成功后只保留可见选中，失败不清空已有列表', async () => {
  const mediaItems = ref([{ id: 1, name: '旧素材', url: '/static/old.png' }])
  const selectedIds = reactive(new Set([1, 99]))
  const loading = ref(false)
  const page = ref(1)
  const pageSize = ref(30)
  const mediaType = ref('all')
  const keyword = ref('')
  const total = ref(0)
  const hasSuccessfulMediaLoad = ref(true)
  const loadError = ref('')
  const mediaRequestGuard = createLatestMediaRequestGuard()
  const { loadMedia } = createMediaLibraryLocalLoad({
    page,
    pageSize,
    mediaType,
    keyword,
    loading,
    mediaItems,
    selectedIds,
    total,
    hasSuccessfulMediaLoad,
    loadError,
    mediaRequestGuard,
    mediaLibraryAPI: {
      async list() {
        return {
          items: [
            { id: 1, name: '新素材', url: '/static/a.png', file_size: 2048 },
            { id: 2, name: '乙', url: '/static/b.png', file_size: 4096 },
          ],
          pagination: { total: 2 },
        }
      },
    },
  })

  const applied = await loadMedia()
  assert.equal(applied.status, 'applied')
  assert.equal(mediaItems.value.length, 2)
  assert.equal(selectedIds.has(1), true)
  assert.equal(selectedIds.has(99), false)
  assert.equal(loadError.value, '')
  assert.equal(loading.value, false)

  const failed = createMediaLibraryLocalLoad({
    page,
    pageSize,
    mediaType,
    keyword,
    loading,
    mediaItems,
    selectedIds,
    total,
    hasSuccessfulMediaLoad,
    loadError,
    mediaRequestGuard: createLatestMediaRequestGuard(),
    mediaLibraryAPI: {
      async list() {
        const error = new Error('offline')
        error.response = { status: 503 }
        throw error
      },
    },
  })
  const result = await failed.loadMedia()
  assert.equal(result.status, 'failed')
  assert.equal(mediaItems.value.length, 2)
  assert.match(loadError.value, /素材服务暂时不可用/)
  assert.equal(hasSuccessfulMediaLoad.value, true)
})

test('空关键词网络搜索留下可见中文错误，不会假装成功', async () => {
  const networkKeyword = ref('   ')
  const networkMediaType = ref('all')
  const networkSource = ref('all')
  const networkItems = ref([{ title: '旧结果' }])
  const networkLoading = ref(false)
  const networkError = ref('')
  const networkNotice = ref('旧说明')
  const networkSearched = ref(true)
  const { searchNetworkMedia } = createMediaLibraryNetworkActions({
    networkKeyword,
    networkMediaType,
    networkSource,
    networkItems,
    networkLoading,
    networkError,
    networkNotice,
    networkSearched,
    networkRequestGuard: createLatestMediaRequestGuard(),
    networkImportFeedback: ref(null),
    networkImportRetryItem: ref(null),
    networkImportingKeys: reactive(new Set()),
    scopedDramaId: ref(null),
    loadMedia: async () => {},
    mediaLibraryAPI: {
      async searchNetwork() {
        throw new Error('should not search')
      },
    },
  })
  await searchNetworkMedia()
  assert.equal(networkError.value, '请输入关键词后再搜索')
  assert.equal(networkItems.value[0].title, '旧结果')
})

test('刷新离开保护只在上传或导入进行中拦截', () => {
  const uploading = ref(true)
  const networkImportingKeys = reactive(new Set())
  const { handleBeforeUnload } = createMediaLibrarySelection({
    mediaWriteLocked: ref(false),
    selectedIds: reactive(new Set()),
    mediaItems: ref([]),
    uploading,
    networkImportingKeys,
    loadMedia: () => {},
  })

  const uploadingEvent = { prevented: false, returnValue: 'keep' }
  uploadingEvent.preventDefault = () => { uploadingEvent.prevented = true }
  handleBeforeUnload(uploadingEvent)
  assert.equal(uploadingEvent.prevented, true)
  assert.equal(uploadingEvent.returnValue, '')

  uploading.value = false
  networkImportingKeys.add('commons:1')
  const importingEvent = { prevented: false, returnValue: 'keep' }
  importingEvent.preventDefault = () => { importingEvent.prevented = true }
  handleBeforeUnload(importingEvent)
  assert.equal(importingEvent.prevented, true)

  networkImportingKeys.clear()
  const idle = { prevented: false, returnValue: 'keep' }
  idle.preventDefault = () => { idle.prevented = true }
  handleBeforeUnload(idle)
  assert.equal(idle.prevented, false)
  assert.equal(idle.returnValue, 'keep')
})

test('加载和网络错误描述保持中文服务名，不会把不同服务混用', () => {
  assert.equal(
    describeMediaLoadError({ response: { status: 503 } }),
    describeServiceLoadError({ response: { status: 503 } }, { serviceLabel: '素材服务' }),
  )
  assert.equal(
    describeNetworkError({ response: { status: 503 } }, '暂时无法搜索网络素材，请稍后重试'),
    describeMediaLibraryUserError({ response: { status: 503 } }, { serviceLabel: '网络素材服务', fallback: '暂时无法搜索网络素材，请稍后重试' }),
  )
  assert.match(describeMediaLoadError({ response: { status: 503 } }), /素材服务/)
  assert.doesNotMatch(describeMediaLoadError({ response: { status: 503 } }), /网络素材服务/)
  assert.match(describeNetworkError({ response: { status: 503 } }, '搜索失败'), /网络素材服务/)
  assert.notEqual(describeNetworkError({ response: { status: 503 } }, '搜索失败'), describeMediaLoadError({ response: { status: 503 } }))
})
