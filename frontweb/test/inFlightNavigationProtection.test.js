import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createFreeCreateTaskOwner, getReferenceUploadBlockReason } from '../src/utils/freeCreate.js'
import { hasPendingMediaLibraryOperations } from '../src/utils/mediaLibrary.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mediaLibrarySource = read('../src/views/MediaLibrary.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const sourceWorkflowSource = read('../src/components/SourceIntakeWorkflowPanel.vue')

test('media library uploads and network imports participate in route and browser leave protection', () => {
  assert.equal(hasPendingMediaLibraryOperations(false, new Set()), false)
  assert.equal(hasPendingMediaLibraryOperations(true, new Set()), true)
  assert.equal(hasPendingMediaLibraryOperations(false, new Set(['commons:1'])), true)
  assert.equal(hasPendingMediaLibraryOperations(true, new Set(['commons:1'])), true)

  assert.match(mediaLibrarySource, /import \{ onBeforeRouteLeave, useRoute, useRouter \} from 'vue-router'/)
  assert.match(
    mediaLibrarySource,
    /function confirmMediaLibraryLeave\(\) \{[\s\S]*if \(!hasPendingMediaLibraryOperations\(uploading\.value, networkImportingKeys\)\) return true[\s\S]*ElMessage\.warning\([\s\S]*return false/,
  )
  assert.match(mediaLibrarySource, /onBeforeRouteLeave\(\(\) => confirmMediaLibraryLeave\(\)\)/)
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
    /onBeforeRouteLeave\(async \(\) => \{[\s\S]*if \(refImageUploadStatus\.value === 'uploading'\) \{[\s\S]*ElMessage\.warning\([\s\S]*return false[\s\S]*if \(!freeCreateTaskOwner\.hasActive\(\)\) return true/,
  )
  const uploadingIndex = freeCreateSource.indexOf("refImageUploadStatus.value === 'uploading'")
  const taskOwnerIndex = freeCreateSource.indexOf('freeCreateTaskOwner.hasActive()')
  assert.ok(uploadingIndex >= 0 && taskOwnerIndex > uploadingIndex)
  assert.match(
    freeCreateSource,
    /function handleBeforeUnload\(event\) \{[\s\S]*refImageUploadStatus\.value !== 'uploading'[\s\S]*freeCreateTaskOwner\.hasActive\(\)/,
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

