import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createFreeCreateTaskOwner, getReferenceUploadBlockReason } from '../src/utils/freeCreate.js'
import { hasPendingMediaLibraryOperations } from '../src/utils/mediaLibrary.js'
import { readSourceIntakeWorkflowSources } from './helpers/sourceIntakeWorkflowSources.js'
import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mediaLibrarySource = readMediaLibrarySources()
const freeCreateSource = [read('../src/views/FreeCreate.vue'), read('../src/composables/useFreeCreateWorkspace.js')].join('\n')
const sourceWorkflowSource = readSourceIntakeWorkflowSources()

test('media library uploads and network imports participate in route and browser leave protection', () => {
  assert.equal(hasPendingMediaLibraryOperations(false, new Set()), false)
  assert.equal(hasPendingMediaLibraryOperations(true, new Set()), true)
  assert.equal(hasPendingMediaLibraryOperations(false, new Set(['commons:1'])), true)
  assert.equal(hasPendingMediaLibraryOperations(true, new Set(['commons:1'])), true)

  assert.match(mediaLibrarySource, /import \{ onBeforeRouteLeave, useRoute, useRouter \} from 'vue-router'/)
  assert.match(
    mediaLibrarySource,
    /async function confirmMediaLibraryLeave\(\) \{[\s\S]*if \(!hasPendingMediaLibraryOperations\(uploading\.value, networkImportingKeys\)\) return true[\s\S]*ElMessageBox\.confirm\([\s\S]*confirmButtonText: '离开'[\s\S]*cancelButtonText: '继续留在本页'/,
  )
  assert.match(mediaLibrarySource, /onBeforeRouteLeave\(confirmMediaLibraryLeave\)/)
  assert.doesNotMatch(mediaLibrarySource, /function confirmMediaLibraryLeave\(\) \{[\s\S]*ElMessage\.warning\([\s\S]*return false/)
  assert.match(
    mediaLibrarySource,
    /function handleBeforeUnload\(event\) \{\s*if \(!hasPendingMediaLibraryOperations\(uploading\.value, networkImportingKeys\)\) return[\s\S]*event\.preventDefault\(\)[\s\S]*event\.returnValue = ''/,
  )
  assert.match(mediaLibrarySource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(mediaLibrarySource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('FreeCreate blocks navigation while a reference image upload is in flight', () => {
  assert.equal(getReferenceUploadBlockReason('uploading'), '参考图正在上传，请等待上传完成')
  assert.equal(getReferenceUploadBlockReason('idle'), '')

  const owner = createFreeCreateTaskOwner(async () => {})
  assert.equal(owner.hasActive(), false)
  owner.begin({ item: { id: 9 } })
  assert.equal(owner.hasActive(), true)

  assert.match(
    freeCreateSource,
    /onBeforeRouteLeave\(async \(\) => \{[\s\S]*return confirmFreeCreateLeave\(\)/,
  )
  assert.match(
    freeCreateSource,
    /async function confirmFreeCreateLeave\(\) \{[\s\S]*if \(refImageUploadStatus\.value === 'uploading'\) \{[\s\S]*ElMessage\.warning\([\s\S]*return false[\s\S]*if \(!freeCreateTaskOwner\.hasActive\(\)\) return true/,
  )
  const confirmStart = freeCreateSource.indexOf('async function confirmFreeCreateLeave')
  const uploadingIndex = freeCreateSource.indexOf("refImageUploadStatus.value === 'uploading'", confirmStart)
  const taskOwnerIndex = freeCreateSource.indexOf('freeCreateTaskOwner.hasActive()', confirmStart)
  assert.ok(confirmStart >= 0 && uploadingIndex >= 0 && taskOwnerIndex > uploadingIndex)
  assert.match(
    freeCreateSource,
    /function handleBeforeUnload\(event\) \{[\s\S]*shouldBlockFreeCreateUnload\(\{[\s\S]*uploading: refImageUploadStatus\.value === 'uploading'[\s\S]*hasActive: freeCreateTaskOwner\.hasActive\(\)/,
  )
})

test('existing-source workflow launch is checked before unsaved source input', () => {
  assert.match(
    sourceWorkflowSource,
    /const sourceOperationActive = computed\(\(\) => Boolean\([\s\S]*workflowStarting\.value[\s\S]*readinessChecking\.value/,
  )
  assert.match(
    sourceWorkflowSource,
    /async function confirmSourceInputLeave\(\) \{[\s\S]*if \(sourceOperationActive\.value\) \{[\s\S]*showWorkflowMessage\('warning',[\s\S]*return false[\s\S]*if \(!hasUnsavedSourceInput\.value\) return true/,
  )
  const activeIndex = sourceWorkflowSource.indexOf('if (sourceOperationActive.value)')
  const unsavedIndex = sourceWorkflowSource.indexOf('if (!hasUnsavedSourceInput.value)')
  assert.ok(activeIndex >= 0, 'route guard must check active source operations')
  assert.ok(unsavedIndex >= 0, 'route guard must check unsaved source input')
  assert.ok(activeIndex < unsavedIndex, 'active workflow launch must be checked before the clean-input fast path')
})


test('项目列表素材库生图进行中会拦住离开', () => {
  const filmListNav = read('../src/components/filmList/useFilmListNavigation.js')
  const filmListPage = read('../src/views/FilmList.vue')
  assert.match(filmListNav, /pendingLibraryImageWork\(\)/)
  assert.match(filmListNav, /LIBRARY_IMAGE_LEAVE_MESSAGE/)
  assert.match(filmListPage, /ref="libraryDialogsRef"/)
  assert.match(filmListPage, /hasPendingLibraryImageWork: \(\) => libraryDialogsRef\.value\?\.hasPendingLibraryImageWork\?\.\(\) === true/)
})
