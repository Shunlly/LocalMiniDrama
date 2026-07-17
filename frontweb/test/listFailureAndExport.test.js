import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const filmListSource = read('../src/views/FilmList.vue')
const mediaLibrarySource = read('../src/views/MediaLibrary.vue')
const dramaApiSource = read('../src/api/drama.js')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

async function loadExportHelpers() {
  const helperSource = sourceBetween(
    filmListSource,
    'function sanitizeExportFilename',
    'async function onExport',
  )
  const moduleSource = `${helperSource}\nexport { sanitizeExportFilename, validateExportBlob }`
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`)
}

async function loadOnExportHarness() {
  const exportImplementation = sourceBetween(
    filmListSource,
    'function sanitizeExportFilename',
    'function triggerImport',
  )
  const harnessSource = `
    const exportingId = { value: null }
    const exportFailure = { value: null }
    const calls = []
    let exportResult = null
    let latestAnchor = null
    const dramaAPI = {
      async exportDrama(id) {
        calls.push('api:' + id)
        if (exportResult instanceof Error) throw exportResult
        return exportResult
      },
    }
    const URL = {
      createObjectURL() { calls.push('create-url'); return 'blob:test-export' },
      revokeObjectURL(value) { calls.push('revoke:' + value) },
    }
    const document = {
      createElement() {
        latestAnchor = {
          isConnected: false,
          href: '',
          download: '',
          rel: '',
          click() { calls.push('click') },
          remove() { this.isConnected = false; calls.push('remove') },
        }
        return latestAnchor
      },
      body: {
        appendChild(anchor) { anchor.isConnected = true; calls.push('append') },
      },
    }
    const ElMessage = {
      success(message) { calls.push('success:' + message) },
      error(message) { calls.push('error:' + message) },
    }
    ${exportImplementation}
    function setExportResult(value) { exportResult = value }
    function resetHarness() { calls.length = 0; latestAnchor = null }
    function getLatestAnchor() { return latestAnchor }
    export { calls, exportFailure, exportingId, getLatestAnchor, onExport, resetHarness, setExportResult }
  `
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(harnessSource)}`)
}

test('project list uses a persistent failure state without replacing it with an empty state', () => {
  assert.match(filmListSource, /v-if="listError"[\s\S]*role="alert"[\s\S]*您的项目数据没有被删除/)
  assert.match(filmListSource, /下方显示上次成功加载的数据，当前内容已过期/)
  assert.match(filmListSource, /@click="loadList"[\s\S]*重试加载/)
  assert.match(
    filmListSource,
    /v-if="!loading && hasSuccessfulListLoad && !listError && dramas\.length === 0"/,
  )

  const loadListSource = sourceBetween(filmListSource, 'async function loadList', 'function formatDate')
  assert.match(loadListSource, /hasSuccessfulListLoad\.value = true/)
  assert.match(loadListSource, /listError\.value = ''/)
  assert.match(loadListSource, /listError\.value = describeProjectLoadError\(error\)/)
  assert.doesNotMatch(loadListSource, /dramas\.value\s*=\s*\[\]/)
})

test('project writes stay locked until a successful list response', () => {
  assert.match(
    filmListSource,
    /const listWriteLocked = computed\(\(\) => loading\.value \|\| !hasSuccessfulListLoad\.value \|\| Boolean\(listError\.value\)\)/,
  )
  assert.match(filmListSource, /class="btn-import"[\s\S]*:disabled="listWriteLocked"/)
  assert.match(filmListSource, /class="btn-new" :disabled="listWriteLocked"/)
  assert.match(filmListSource, /command="edit" :disabled="listWriteLocked"/)
  assert.match(filmListSource, /command="trash" :disabled="listWriteLocked"/)
  assert.match(filmListSource, /async function submitNew\(\) \{\s*if \(listWriteLocked\.value\) return/)
  assert.match(filmListSource, /async function moveToTrash\(d\) \{\s*if \(listWriteLocked\.value\) return/)
  assert.match(filmListSource, /async function doUploadLibImg[\s\S]*if \(listWriteLocked\.value\)/)
})

test('material center preserves stale data and blocks upload and deletion on load failure', () => {
  assert.match(mediaLibrarySource, /v-if="loadError"[\s\S]*role="alert"[\s\S]*您的素材数据没有被删除/)
  assert.match(mediaLibrarySource, /下方显示上次成功加载的数据，当前内容已过期/)
  assert.match(mediaLibrarySource, /@click="loadMedia"[\s\S]*重试加载/)
  assert.match(
    mediaLibrarySource,
    /v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems\.length === 0"/,
  )

  const loadMediaSource = sourceBetween(mediaLibrarySource, 'async function loadMedia', 'function itemUrl')
  assert.match(loadMediaSource, /hasSuccessfulMediaLoad\.value = true/)
  assert.match(loadMediaSource, /loadError\.value = ''/)
  assert.match(loadMediaSource, /loadError\.value = describeMediaLoadError\(err\)/)
  assert.doesNotMatch(loadMediaSource, /mediaItems\.value\s*=\s*\[\]/)

  assert.match(
    mediaLibrarySource,
    /const mediaWriteLocked = computed\(\(\) => loading\.value \|\| !hasSuccessfulMediaLoad\.value \|\| Boolean\(loadError\.value\)\)/,
  )
  assert.match(mediaLibrarySource, /type="primary" :loading="uploading" :disabled="mediaWriteLocked"/)
  assert.match(mediaLibrarySource, /:aria-label="actionLabel\('删除', item\)"[\s\S]*:disabled="mediaWriteLocked"/)
  assert.match(mediaLibrarySource, /async function deleteItem\(item\) \{\s*if \(mediaWriteLocked\.value\) return/)
  assert.match(mediaLibrarySource, /async function batchDelete\(\) \{\s*if \(mediaWriteLocked\.value\) return/)
})

test('export filename and payload validation reject unsafe or false-success responses', async () => {
  const { sanitizeExportFilename, validateExportBlob } = await loadExportHelpers()

  assert.equal(sanitizeExportFilename('CON'), 'project-CON.zip')
  assert.equal(sanitizeExportFilename(' ... '), 'drama.zip')
  assert.equal(sanitizeExportFilename('episode.zip'), 'episode.zip')
  const cleaned = sanitizeExportFilename('项目/第一集:*?<>|')
  assert.match(cleaned, /\.zip$/)
  assert.doesNotMatch(cleaned, /[<>:"/\\|?*]/)

  const validZip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], { type: 'application/zip' })
  assert.equal(await validateExportBlob(validZip), validZip)
  await assert.rejects(validateExportBlob(new Blob([])), /项目包为空/)
  await assert.rejects(
    validateExportBlob(new Blob([JSON.stringify({ error: { message: '导出容量超限' } })], { type: 'application/json' })),
    /导出容量超限/,
  )
  await assert.rejects(validateExportBlob(new Blob(['not-a-zip'], { type: 'text/plain' })), /文件格式无效/)
})

test('project export waits for a validated blob and keeps failures retryable', () => {
  const exportSource = sourceBetween(filmListSource, 'async function onExport', 'function triggerImport')
  const apiCall = exportSource.indexOf('await dramaAPI.exportDrama(d.id)')
  const validation = exportSource.indexOf('validateExportBlob')
  const click = exportSource.indexOf('anchor.click()')
  const success = exportSource.indexOf("ElMessage.success('项目包已验证，下载已开始')")
  assert.ok(apiCall >= 0 && validation >= 0 && click >= 0 && success >= 0)
  assert.ok(apiCall < click && validation < click && click < success)
  assert.match(exportSource, /URL\.createObjectURL\(blob\)/)
  assert.match(exportSource, /URL\.revokeObjectURL\(downloadUrl\)/)
  assert.match(exportSource, /exportFailure\.value = \{[\s\S]*message,/)
  assert.doesNotMatch(exportSource, /href = `\/api\/v1\/dramas/)

  assert.match(filmListSource, /v-if="exportFailure"[\s\S]*role="alert"[\s\S]*@click="onExport\(exportFailure\.drama\)"/)
  assert.match(dramaApiSource, /exportDrama\(id\)[\s\S]*responseType: 'blob'/)
})

test('project export behavior reports success only after validation and recovers from a retry', async () => {
  const harness = await loadOnExportHarness()
  const validZip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], { type: 'application/zip' })

  harness.setExportResult(validZip)
  await harness.onExport({ id: 7, title: '第一集/终版' })
  assert.deepEqual(harness.calls, [
    'api:7',
    'create-url',
    'append',
    'click',
    'success:项目包已验证，下载已开始',
    'remove',
    'revoke:blob:test-export',
  ])
  assert.equal(harness.getLatestAnchor().download, '第一集_终版.zip')
  assert.equal(harness.exportFailure.value, null)
  assert.equal(harness.exportingId.value, null)

  harness.resetHarness()
  harness.setExportResult(new Blob([JSON.stringify({ error: { message: '导出端拒绝请求' } })], { type: 'application/json' }))
  await harness.onExport({ id: 8, title: '失败项目' })
  assert.deepEqual(harness.calls, ['api:8', 'error:导出端拒绝请求'])
  assert.deepEqual(harness.exportFailure.value, {
    drama: { id: 8, title: '失败项目' },
    message: '导出端拒绝请求',
  })
  assert.equal(harness.exportingId.value, null)

  const retryDrama = harness.exportFailure.value.drama
  harness.resetHarness()
  harness.setExportResult(validZip)
  await harness.onExport(retryDrama)
  assert.equal(harness.exportFailure.value, null)
  assert.match(harness.calls.join('|'), /api:8\|create-url\|append\|click\|success:/)
  assert.match(harness.calls.join('|'), /remove\|revoke:blob:test-export$/)
})
