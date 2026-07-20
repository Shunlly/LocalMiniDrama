import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mediaLibrarySource = read('../src/views/MediaLibrary.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const sourceWorkflowSource = read('../src/components/SourceIntakeWorkflowPanel.vue')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('media library upload participates in route and browser leave protection', () => {
  assert.match(mediaLibrarySource, /import \{ onBeforeRouteLeave, useRoute, useRouter \} from 'vue-router'/)
  assert.match(
    mediaLibrarySource,
    /function confirmMediaLibraryLeave\(\) \{[\s\S]*if \(!uploading\.value\) return true[\s\S]*ElMessage\.warning\([\s\S]*return false/,
  )
  assert.match(mediaLibrarySource, /onBeforeRouteLeave\(\(\) => confirmMediaLibraryLeave\(\)\)/)
  assert.match(
    mediaLibrarySource,
    /function handleBeforeUnload\(event\) \{\s*if \(!uploading\.value\) return[\s\S]*event\.preventDefault\(\)[\s\S]*event\.returnValue = ''/,
  )
  assert.match(mediaLibrarySource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(mediaLibrarySource, /window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
})

test('FreeCreate blocks navigation while a reference image upload is in flight', () => {
  const routeGuard = sourceBetween(
    freeCreateSource,
    'onBeforeRouteLeave(async () =>',
    'function handleBeforeUnload',
  )
  const beforeUnload = sourceBetween(
    freeCreateSource,
    'function handleBeforeUnload',
    'function triggerRefImageUpload',
  )

  assert.match(
    routeGuard,
    /if \(refImageUploadStatus\.value === 'uploading'\) \{[\s\S]*ElMessage\.warning\([\s\S]*return false/,
  )
  assert.ok(
    routeGuard.indexOf("refImageUploadStatus.value === 'uploading'")
      < routeGuard.indexOf('freeCreateTaskOwner.hasActive()'),
  )
  assert.match(beforeUnload, /refImageUploadStatus\.value !== 'uploading'/)
  assert.match(beforeUnload, /freeCreateTaskOwner\.hasActive\(\)/)
})

test('existing-source workflow launch is checked before unsaved source input', () => {
  const leaveGuard = sourceBetween(
    sourceWorkflowSource,
    'async function confirmSourceInputLeave',
    'function handleBeforeUnload',
  )

  const activeIndex = leaveGuard.indexOf('sourceOperationActive.value')
  const unsavedIndex = leaveGuard.indexOf('hasUnsavedSourceInput.value')
  assert.ok(activeIndex >= 0, 'route guard must check active source operations')
  assert.ok(unsavedIndex >= 0, 'route guard must check unsaved source input')
  assert.ok(activeIndex < unsavedIndex, 'active workflow launch must be checked before the clean-input fast path')
  assert.match(leaveGuard, /sourceOperationActive\.value[\s\S]*ElMessage\.warning\([\s\S]*return false/)
  assert.match(
    sourceWorkflowSource,
    /const sourceOperationActive = computed\(\(\) => Boolean\([\s\S]*workflowStarting\.value[\s\S]*readinessChecking\.value/,
  )
})
