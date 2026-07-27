import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as mediaLibrary from '../src/utils/mediaLibrary.js'

const { createLatestMediaRequestGuard } = mediaLibrary
const mediaLibrarySource = readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')

test('an out-of-order successful response cannot replace the latest media results', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = []

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(olderRequest, () => { items = ['older'] }), false)
  assert.deepEqual(items, ['latest'])
})

test('an out-of-order failure cannot clear results or stop the latest loading state', () => {
  const guard = createLatestMediaRequestGuard()
  const olderRequest = guard.begin()
  const latestRequest = guard.begin()
  let items = ['existing']
  let loading = true

  assert.equal(guard.commit(olderRequest, () => { items = [] }), false)
  assert.equal(guard.commit(olderRequest, () => { loading = false }), false)
  assert.deepEqual(items, ['existing'])
  assert.equal(loading, true)

  assert.equal(guard.commit(latestRequest, () => { items = ['latest'] }), true)
  assert.equal(guard.commit(latestRequest, () => { loading = false }), true)
  assert.deepEqual(items, ['latest'])
  assert.equal(loading, false)
})

test('the latest request can commit an error state and finish loading', () => {
  const guard = createLatestMediaRequestGuard()
  const requestId = guard.begin()
  let items = ['stale']
  let loading = true

  assert.equal(guard.commit(requestId, () => { items = [] }), true)
  assert.equal(guard.commit(requestId, () => { loading = false }), true)
  assert.deepEqual(items, [])
  assert.equal(loading, false)
})

test('media selection is limited to ids visible in the latest results', () => {
  assert.equal(typeof mediaLibrary.getVisibleSelectedMediaIds, 'function')

  const selectedIds = new Set([11, 12, 13])
  const visibleItems = [{ id: 12 }, { id: 14 }]

  assert.deepEqual(
    mediaLibrary.getVisibleSelectedMediaIds(selectedIds, visibleItems),
    [12],
  )
  assert.deepEqual(
    mediaLibrary.getVisibleSelectedMediaIds(selectedIds, []),
    [],
  )
})

test('initial media read failures preserve pure navigation while upload keeps it locked', () => {
  assert.equal(typeof mediaLibrary.mediaLibraryAccessState, 'function')

  assert.deepEqual(mediaLibrary.mediaLibraryAccessState({
    loading: false,
    uploading: false,
    hasSuccessfulLoad: false,
    loadError: 'offline',
    itemCount: 0,
  }), {
    navigationLocked: false,
    showEntryStrip: true,
    writeLocked: true,
  })
  assert.deepEqual(mediaLibrary.mediaLibraryAccessState({
    loading: false,
    uploading: true,
    hasSuccessfulLoad: true,
    loadError: '',
    itemCount: 2,
  }), {
    navigationLocked: true,
    showEntryStrip: true,
    writeLocked: false,
  })
})

test('media entry navigation uses its own upload-only lock in the component', () => {
  assert.match(mediaLibrarySource, /v-if="mediaAccessState\.showEntryStrip"\s+class="entry-strip"/)
  assert.match(mediaLibrarySource, /<el-button[^>]*:disabled="mediaAccessState\.navigationLocked"[^>]*@click="goNewProject"[^>]*>[\s\S]*?新建项目/)
  assert.match(mediaLibrarySource, /class="entry-action"[\s\S]*:disabled="mediaAccessState\.navigationLocked"[\s\S]*aria-label="选择项目后导入网页 URL"/)
  assert.match(mediaLibrarySource, /function goNewProject\(\) \{\s*if \(mediaAccessState\.value\.navigationLocked\) return/)
  assert.match(mediaLibrarySource, /function goSourceImport\(\) \{\s*if \(mediaAccessState\.value\.navigationLocked\) return/)
})

test('successful reloads reconcile selection and batch deletion snapshots visible ids', () => {
  assert.match(
    mediaLibrarySource,
    /const visibleSelectedIds = getVisibleSelectedMediaIds\(selectedIds, nextItems\)[\s\S]*selectedIds\.clear\(\)[\s\S]*visibleSelectedIds\.forEach\(\(id\) => selectedIds\.add\(id\)\)/,
  )

  const batchDeleteStart = mediaLibrarySource.indexOf('async function batchDelete')
  const batchDeleteEnd = mediaLibrarySource.indexOf('\nonMounted', batchDeleteStart)
  const batchDeleteSource = mediaLibrarySource.slice(batchDeleteStart, batchDeleteEnd)
  assert.match(batchDeleteSource, /const idsToDelete = getVisibleSelectedMediaIds\(selectedIds, mediaItems\.value\)/)
  assert.match(batchDeleteSource, /for \(const id of idsToDelete\)/)
  assert.doesNotMatch(batchDeleteSource, /for \(const id of selectedIds\)/)
})
