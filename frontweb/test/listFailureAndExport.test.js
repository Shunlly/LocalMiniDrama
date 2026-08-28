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

async function loadOnImportHarness() {
  const importImplementation = sourceBetween(
    filmListSource,
    'function clearImportFailure',
    'async function moveToTrash',
  )
  const harnessSource = `
    const importing = { value: false }
    const importFailure = { value: null }
    const listWriteLocked = { value: false }
    const calls = []
    let importResult = null
    const importFileInput = {
      value: {
        click() { calls.push('open-picker') },
      },
    }
    const dramaAPI = {
      async importDrama(file) {
        calls.push('api:' + file.name)
        if (importResult instanceof Error) throw importResult
        return await importResult
      },
    }
    const ElMessage = {
      success(message) { calls.push('success:' + message) },
      error(message) { calls.push('error:' + message) },
    }
    function loadList() { calls.push('load-list') }
    ${importImplementation}
    function setImportResult(value) { importResult = value }
    function resetHarness() {
      calls.length = 0
      importResult = null
      importing.value = false
      importFailure.value = null
      listWriteLocked.value = false
    }
    export {
      calls,
      clearImportFailure,
      importFailure,
      importing,
      listWriteLocked,
      normalizeImportFailureFilename,
      onImportFile,
      resolveImportFailureMessage,
      resetHarness,
      sanitizeImportFailureReason,
      setImportResult,
      triggerImport,
    }
  `
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(harnessSource)}`)
}

test('project list uses a persistent failure state without replacing it with an empty state', () => {
  assert.match(filmListSource, /v-if="listError"[\s\S]*role="alert"[\s\S]*您的项目数据没有被删除/)
  assert.match(filmListSource, /下方显示上次成功加载的数据，当前内容已过期/)
  assert.match(filmListSource, /@click="loadList"[\s\S]*重试加载/)
  assert.match(
    filmListSource,
    /v-if="!loading && hasSuccessfulListLoad && !listError && dramas\.length === 0 && !hasProjectFilters"/,
  )
  assert.match(
    filmListSource,
    /v-if="!loading && hasSuccessfulListLoad && !listError && hasProjectFilters && filteredDramas\.length === 0"/,
  )

  const loadListSource = sourceBetween(filmListSource, 'async function loadList', 'function formatDate')
  assert.match(loadListSource, /hasSuccessfulListLoad\.value = true/)
  assert.match(loadListSource, /listError\.value = ''/)
  assert.match(loadListSource, /listError\.value = describeProjectLoadError\(error\)/)
  assert.match(loadListSource, /listAbortController\?\.abort\(\)/)
  assert.match(loadListSource, /signal: controller\.signal/)
  assert.match(loadListSource, /isRequestCanceled\(error\) \|\| requestId !== listRequestSequence/)
  assert.doesNotMatch(loadListSource, /dramas\.value\s*=\s*\[\]/)
  assert.match(
    filmListSource,
    /onBeforeUnmount\(\(\) => \{[\s\S]*listAbortController\?\.abort\(\)/,
  )
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
    /const mediaWriteLocked = computed\(\(\) => mediaAccessState\.value\.writeLocked\)/,
  )
  assert.match(
    mediaLibrarySource,
    /:type="mediaItems\.length === 0 && !loading \? 'default' : 'primary'"[\s\S]*:loading="uploading"[\s\S]*:disabled="mediaWriteLocked"/,
  )
  assert.match(mediaLibrarySource, /:aria-label="actionLabel\('删除', item\)"[\s\S]*:disabled="mediaWriteLocked"/)
  assert.match(mediaLibrarySource, /async function deleteItem\(item\) \{\s*if \(mediaWriteLocked\.value\) return/)
  assert.match(mediaLibrarySource, /async function batchDelete\(\) \{\s*if \(mediaWriteLocked\.value\) return/)
})

test('project import failures stay persistent with retry and dismiss actions', () => {
  assert.match(
    filmListSource,
    /v-if="importFailure"[\s\S]*role="alert"[\s\S]*importFailure\.fileName[\s\S]*importFailure\.message/,
  )
  assert.match(
    filmListSource,
    /class="export-failure-state import-failure-state"[\s\S]*:loading="importing"[\s\S]*@click="triggerImport"/,
  )
  assert.match(filmListSource, /@click="dismissImportFailure"[\s\S]*关闭/)
  assert.match(filmListSource, /ref="importTriggerButton"[\s\S]*导入项目包/)
  assert.match(filmListSource, /function dismissImportFailure\(\)[\s\S]*await nextTick\(\)[\s\S]*trigger\?\.focus\?\.\(\)/)

  const importSource = sourceBetween(filmListSource, 'function clearImportFailure', 'async function moveToTrash')
  assert.match(importSource, /clearImportFailure\(\)/)
  assert.ok(importSource.includes("if (!/\\.zip$/i.test(file.name || '')) {"))
  assert.ok(importSource.includes("setImportFailure(file.name, new Error('请选择 .zip 格式的项目包'))"))
  assert.match(importSource, /const data = await dramaAPI\.importDrama\(file\)[\s\S]*importFailure\.value = null/)
  assert.match(importSource, /catch \(error\) \{[\s\S]*setImportFailure\(file\.name, error\)/)
})

test('project import failure helpers sanitize filenames and sensitive backend details', async () => {
  const {
    normalizeImportFailureFilename,
    resolveImportFailureMessage,
    sanitizeImportFailureReason,
  } = await loadOnImportHarness()

  assert.equal(normalizeImportFailureFilename('D:\\Users\\33028\\Desktop\\bad?<name>.zip'), 'bad__name_.zip')
  assert.equal(normalizeImportFailureFilename('   ...   '), '未命名项目包')
  assert.equal(
    sanitizeImportFailureReason('SQLITE_BUSY while opening D:\\secret\\demo.zip at /srv/app/backend-node/data/dramas.db'),
    '项目包解析失败，请确认文件完整且与当前版本兼容',
  )
  const sanitizedPathMessage = resolveImportFailureMessage({
    response: { data: { message: '导入失败：/srv/uploads/demo.zip' } },
  })
  assert.equal(sanitizedPathMessage, '导入失败：服务器文件')
  assert.doesNotMatch(sanitizedPathMessage, /\/srv\/|demo\.zip/)
})

test('project import behavior clears stale errors on reselection and persists invalid extension and API failures', async () => {
  const harness = await loadOnImportHarness()

  harness.triggerImport()
  assert.deepEqual(harness.calls, ['open-picker'])

  harness.resetHarness()
  const invalidTarget = {
    files: [{ name: 'D:\\Users\\33028\\Desktop\\unsafe.txt' }],
    value: 'selected',
  }
  await harness.onImportFile({ target: invalidTarget })
  assert.equal(invalidTarget.value, '')
  assert.equal(harness.importing.value, false)
  assert.deepEqual(harness.importFailure.value, {
    fileName: 'unsafe.txt',
    message: '请选择 .zip 格式的项目包',
  })
  assert.deepEqual(harness.calls, [])

  harness.resetHarness()
  harness.importFailure.value = { fileName: 'old.zip', message: '旧错误' }
  let resolveImport
  harness.setImportResult(new Promise((resolve) => { resolveImport = resolve }))
  const pendingTarget = {
    files: [{ name: 'retry.zip' }],
    value: 'picked',
  }
  const pendingImport = harness.onImportFile({ target: pendingTarget })
  assert.equal(pendingTarget.value, '')
  assert.equal(harness.importFailure.value, null)
  assert.equal(harness.importing.value, true)
  resolveImport({ title: '重试项目' })
  await pendingImport
  assert.equal(harness.importing.value, false)
  assert.equal(harness.importFailure.value, null)
  assert.deepEqual(harness.calls, [
    'api:retry.zip',
    'success:导入成功：重试项目',
    'load-list',
  ])

  harness.resetHarness()
  const backendError = new Error('SQLITE_BUSY while opening D:\\secret\\draft.zip')
  backendError.response = {
    data: {
      message: 'SQLITE_BUSY at /srv/app/backend-node/data/dramas.db',
    },
  }
  harness.setImportResult(backendError)
  await harness.onImportFile({
    target: {
      files: [{ name: 'C:\\Users\\33028\\Desktop\\draft.zip' }],
      value: 'picked',
    },
  })
  assert.deepEqual(harness.importFailure.value, {
    fileName: 'draft.zip',
    message: '项目包解析失败，请确认文件完整且与当前版本兼容',
  })
  assert.equal(harness.importing.value, false)
  assert.doesNotMatch(JSON.stringify(harness.importFailure.value), /backend-node|SQLITE|D:\\\\|\/srv\//)
  assert.doesNotMatch(harness.calls.join('|'), /error:/)
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

test('分类素材加载失败不会被伪装成空库，且 AI 配置在列表失败时仍可打开', () => {
  assert.match(filmListSource, /const charLibraryError = ref\(''\)/)
  assert.match(filmListSource, /charLibraryError\.value = describeServiceLoadError/)
  assert.doesNotMatch(filmListSource, /catch \{ charLibraryList\.value = \[\] \}/)
  assert.match(filmListSource, /v-if="charLibraryError"[\s\S]*@click="loadCharLibraryList"[\s\S]*重试/)
  assert.match(filmListSource, /v-if="!charLibraryLoading && !charLibraryError && charLibraryList\.length === 0"/)
  assert.match(filmListSource, /没有匹配的角色，试试其他关键词/)
  assert.match(filmListSource, /class="btn-settings" title="打开 AI 配置" @click="showAiConfigDialog = true"/)
  assert.doesNotMatch(filmListSource, /class="btn-settings" :disabled="listWriteLocked"/)
})
