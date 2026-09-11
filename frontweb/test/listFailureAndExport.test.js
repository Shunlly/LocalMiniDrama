import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { describeServiceLoadError } from '../src/utils/requestError.js'
import { mediaLibraryAccessState } from '../src/utils/mediaLibrary.js'
import { sanitizeExportFilename, validateExportBlob, resolveExportFailureMessage } from '../src/utils/projectExport.js'
import { readFilmListLibrarySource } from './helpers/filmListLibrarySource.js'
import { readFilmListSources } from './helpers/filmListSources.js'
import { readMediaLibrarySources } from './helpers/mediaLibrarySources.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const filmListSource = readFilmListSources().ui
const filmListLibrarySource = readFilmListLibrarySource()
const mediaLibrarySource = readMediaLibrarySources()
const dramaApiSource = read('../src/api/drama.js')

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

  assert.match(filmListSource, /async function loadList[\s\S]*hasSuccessfulListLoad\.value = true/)
  assert.match(filmListSource, /listError\.value = ''/)
  assert.match(filmListSource, /listError\.value = describeProjectLoadError\(error\)/)
  assert.match(filmListSource, /listAbortController\?\.abort\(\)/)
  assert.match(filmListSource, /signal: controller\.signal/)
  assert.match(filmListSource, /isRequestCanceled\(error\) \|\| requestId !== listRequestSequence/)
  assert.doesNotMatch(filmListSource, /dramas\.value\s*=\s*\[\]/)
  assert.match(
    filmListSource,
    /onBeforeUnmount\(\(\) => \{[\s\S]*listAbortController\?\.abort\(\)/,
  )
})

test('project list load errors stay user-facing and never look like an empty catalog', () => {
  assert.equal(
    describeServiceLoadError({ response: { status: 503 } }, { serviceLabel: '项目服务' }),
    '项目服务暂时不可用（HTTP 503）',
  )
  assert.equal(
    describeServiceLoadError({ message: 'Network Error' }, { serviceLabel: '项目服务' }),
    '无法连接项目服务，请检查服务是否已启动',
  )
  assert.equal(
    describeServiceLoadError({ response: { data: { error: { message: '项目库维护中' } } } }, { serviceLabel: '项目服务' }),
    '项目库维护中',
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
  assert.match(filmListLibrarySource, /async function doUploadLibImg[\s\S]*if \(props\.listWriteLocked/)
  assert.match(filmListSource, /<FilmListLibraryDialogs/)
  assert.match(filmListSource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(filmListSource, /from 'element-plus'/)
})

test('material center preserves stale data and blocks upload and deletion on load failure', () => {
  assert.match(mediaLibrarySource, /v-if="loadError"[\s\S]*role="alert"[\s\S]*您的素材数据没有被删除/)
  assert.match(mediaLibrarySource, /下方显示上次成功加载的数据，当前内容已过期/)
  assert.match(mediaLibrarySource, /@click="loadMedia"[\s\S]*重试加载/)
  assert.match(
    mediaLibrarySource,
    /v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems\.length === 0"/,
  )

  assert.match(mediaLibrarySource, /async function loadMedia[\s\S]*hasSuccessfulMediaLoad\.value = true/)
  assert.match(mediaLibrarySource, /loadError\.value = ''/)
  assert.match(mediaLibrarySource, /loadError\.value = describeMediaLoadError\(err\)/)
  assert.doesNotMatch(mediaLibrarySource, /mediaItems\.value\s*=\s*\[\]/)

  assert.match(
    mediaLibrarySource,
    /const mediaWriteLocked = computed\(\(\) => mediaAccessState\.value\.writeLocked\)/,
  )
  assert.match(
    mediaLibrarySource,
    /:type="mediaItems\.length === 0 && !loading \? 'default' : 'primary'"[\s\S]*:loading="uploading"[\s\S]*:disabled="mediaWriteLocked \|\| uploading"/,
  )
  assert.match(mediaLibrarySource, /:aria-label="actionLabel\('删除', item\)"[\s\S]*:disabled="mediaWriteLocked"/)
  assert.match(mediaLibrarySource, /async function deleteItem\(item\) \{\s*if \(mediaWriteLocked\.value\) return/)
  assert.match(mediaLibrarySource, /async function batchDelete\(\) \{\s*if \(mediaWriteLocked\.value\) return/)

  assert.deepEqual(
    mediaLibraryAccessState({
      loading: false,
      uploading: false,
      hasSuccessfulLoad: true,
      loadError: '素材服务暂时不可用（HTTP 503）',
      itemCount: 3,
    }),
    {
      navigationLocked: false,
      showEntryStrip: true,
      writeLocked: true,
    },
  )
  assert.equal(
    describeServiceLoadError({ response: { status: 503 } }, { serviceLabel: '素材服务' }),
    '素材服务暂时不可用（HTTP 503）',
  )
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
  assert.match(filmListSource, /class="export-failure-state import-failure-state"[\s\S]*tabindex="-1"/)
  assert.match(filmListSource, /function dismissImportFailure\(\)[\s\S]*await nextTick\(\)[\s\S]*trigger\?\.focus\?\.\(\)/)

  assert.match(filmListSource, /function clearImportFailure\(\)/)
  assert.ok(filmListSource.includes("if (!/\\.zip$/i.test(file.name || '')) {"))
  assert.ok(filmListSource.includes("setImportFailure(file.name, new Error('请选择 .zip 格式的项目包'))"))
  assert.match(filmListSource, /const data = await dramaAPI\.importDrama\(file\)[\s\S]*importFailure\.value = null/)
  assert.match(filmListSource, /catch \(error\) \{[\s\S]*setImportFailure\(file\.name, error\)/)
})

test('project import failure helpers sanitize filenames and sensitive backend details', () => {
  assert.match(
    filmListSource,
    /function normalizeImportFailureFilename\(name\) \{[\s\S]*split\(\/\[\\\\\/\]\/[\s\S]*未命名项目包/,
  )
  assert.match(
    filmListSource,
    /function sanitizeImportFailureReason\(message\) \{[\s\S]*backend-node[\s\S]*项目包解析失败，请确认文件完整且与当前版本兼容/,
  )
  assert.match(
    filmListSource,
    /function resolveImportFailureMessage\(error\) \{[\s\S]*sanitizeImportFailureReason\(responseBody\)[\s\S]*sanitizeImportFailureReason\(responseMessage\)[\s\S]*sanitizeImportFailureReason\(error\?\.message\)/,
  )
})

test('project import behavior clears stale errors on reselection and persists invalid extension and API failures', () => {
  assert.match(filmListSource, /function triggerImport\(\) \{\s*if \(listWriteLocked\.value\) return\s*importFileInput\.value\?\.click\(\)/)
  assert.match(
    filmListSource,
    /async function onImportFile\(e\) \{[\s\S]*e\.target\.value = ''[\s\S]*clearImportFailure\(\)[\s\S]*setImportFailure\(file\.name, new Error\('请选择 \.zip 格式的项目包'\)\)[\s\S]*const data = await dramaAPI\.importDrama\(file\)[\s\S]*importFailure\.value = null[\s\S]*ElMessage\.success\(`导入成功：\$\{data\?\.title \|\| '项目'\}`\)[\s\S]*loadList\(\)[\s\S]*setImportFailure\(file\.name, error\)/,
  )
})


test('export filename and payload validation reject unsafe or false-success responses', async () => {
  assert.equal(sanitizeExportFilename('月光基地'), '月光基地.zip')
  assert.equal(sanitizeExportFilename('con'), 'project-con.zip')
  assert.equal(sanitizeExportFilename('../a<>b.zip'), '_a__b.zip')
  await assert.rejects(validateExportBlob(new Blob()), /导出的项目包为空/)
  await assert.rejects(
    validateExportBlob(new Blob(['{"message":"服务失败"}'], { type: 'application/json' })),
    /服务失败/,
  )
  const zip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], { type: 'application/zip' })
  const accepted = await validateExportBlob(zip)
  assert.equal(accepted.size, zip.size)
})

test('project export waits for a validated blob and keeps failures retryable', async () => {
  assert.match(filmListSource, /validateExportBlob\(await dramaAPI\.exportDrama\(d\.id\)\)/)
  assert.match(filmListSource, /ElMessage\.success\('项目包已验证，下载已开始'\)/)
  assert.match(filmListSource, /exportFailure\.value = \{[\s\S]*message,/)
  assert.doesNotMatch(filmListSource, /href = `\/api\/v1\/dramas/)
  assert.match(filmListSource, /v-if="exportFailure"[\s\S]*role="alert"[\s\S]*@click="onExport\(exportFailure\.drama\)"/)
  assert.match(dramaApiSource, /exportDrama\(id\)[\s\S]*responseType: 'blob'/)
  assert.equal(
    await resolveExportFailureMessage({ message: '网络中断' }),
    '网络中断',
  )
  assert.equal(
    await resolveExportFailureMessage({ response: { data: { error: { message: '磁盘已满' } } } }),
    '磁盘已满',
  )
})

test('分类素材加载失败不会被伪装成空库，且 AI 配置在列表失败时仍可打开', () => {
  assert.match(filmListSource, /<FilmListLibraryDialogs/)
  assert.match(filmListLibrarySource, /from '@\/utils\/elementPlusFeedback\.js'/)
  assert.doesNotMatch(filmListLibrarySource, /from 'element-plus'/)
  assert.match(filmListLibrarySource, /const charLibraryError = ref\(''\)/)
  assert.match(filmListLibrarySource, /charLibraryError\.value = describeServiceLoadError/)
  assert.doesNotMatch(filmListLibrarySource, /catch \{ charLibraryList\.value = \[\] \}/)
  assert.match(filmListLibrarySource, /v-if="charLibraryError"[\s\S]*@click="loadCharLibraryList"[\s\S]*重试/)
  assert.match(filmListLibrarySource, /v-if="!charLibraryLoading && !charLibraryError && charLibraryList\.length === 0"/)
  assert.match(filmListLibrarySource, /没有匹配的角色，试试其他关键词/)
  assert.match(filmListLibrarySource, /aria-label="清除角色素材搜索"/)
  assert.match(filmListLibrarySource, /function clearCharLibraryKeyword/)
  assert.match(filmListSource, /class="btn-settings" title="打开 AI 配置" aria-label="打开 AI 配置" @click="showAiConfigDialog = true"/)
  assert.doesNotMatch(filmListSource, /class="btn-settings" :disabled="listWriteLocked"/)
  assert.match(filmListSource, /const newSubmitDisabledReason = computed/)
  assert.match(filmListSource, /请先填写项目标题/)
  assert.match(filmListSource, /:title="listWriteLocked \? listWriteLockReason : '打开分类素材'"/)
  assert.match(
    filmListSource,
    /class="action-btn action-btn-new" :disabled="listWriteLocked" aria-label="新建项目" :title="listWriteLocked \? listWriteLockReason : undefined"/,
  )
  assert.match(
    filmListSource,
    /class="action-btn action-btn-import" :loading="importing" :disabled="listWriteLocked" aria-label="导入项目包" :title="listWriteLocked \? listWriteLockReason : undefined"/,
  )
  assert.match(
    filmListSource,
    /class="example-btn"[\s\S]*:disabled="listWriteLocked"\s*:title="listWriteLocked \? listWriteLockReason : undefined"\s*@click="onImportExample\(ex\)"/,
  )
  for (const click of [
    'openEditCharLibrary(item)',
    'onDeleteCharLibrary(item)',
    'submitEditCharLibrary',
    'openEditSceneLibrary(item)',
    'onDeleteSceneLibrary(item)',
    'submitEditSceneLibrary',
    'openEditPropLibrary(item)',
    'onDeletePropLibrary(item)',
    'submitEditPropLibrary',
  ]) {
    const escaped = click.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      filmListLibrarySource,
      new RegExp(`:disabled="listWriteLocked" :title="listWriteLocked \\? listWriteLockReason : undefined"[\\s\\S]{0,360}?@click="${escaped}"`),
    )
  }
  for (const form of ['editCharLibraryForm', 'editSceneLibraryForm', 'editPropLibraryForm']) {
    assert.match(
      filmListLibrarySource,
      new RegExp(`libraryUploadDisabledReason\\(${form}\\)`),
    )
    assert.match(
      filmListLibrarySource,
      new RegExp(`libraryGenerateDisabledReason\\(${form}\\)`),
    )
  }
  assert.match(filmListLibrarySource, /function libraryWriteReason\(\) \{\s*return props\.listWriteLocked \? props\.listWriteLockReason : ''/)
  assert.match(filmListLibrarySource, /if \(form\?\.imgGenerating\) return '正在生成图片，请稍候'/)
  assert.match(filmListLibrarySource, /if \(form\?\.imgUploading\) return '正在上传图片，请稍候'/)
  assert.doesNotMatch(filmListLibrarySource, /return '正在上传'\n/)
  assert.doesNotMatch(filmListLibrarySource, /return '正在生成'\n/)
  assert.match(filmListSource, /Number.isNaN\(d\.getTime\(\)\)/)
  assert.equal(
    describeServiceLoadError({ response: { status: 502 } }, { serviceLabel: '角色素材服务' }),
    '角色素材服务暂时不可用（HTTP 502）',
  )
})

