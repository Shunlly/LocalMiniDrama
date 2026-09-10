import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { remainingExtractNamedFunction } from './helpers/remainingSourceBetween.js'
import { canvasUserError } from '../src/composables/useCanvasUserError.js'
import { isRequestNetworkError, isRequestTimeout } from '../src/utils/requestError.js'

const panelSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasAssetPanel.vue', import.meta.url), 'utf8')
const filmScenesSource = readFileSync(new URL('../src/composables/filmCreate/useScenes.js', import.meta.url), 'utf8')

const MISSING_MAIN_IMAGE = '请先为该场景生成或上传主图'
const MAIN_IMAGE_GENERATING = '场景主图正在生成，请等待完成'
const PANORAMA_FAILED = '全景图生成失败'
const PANORAMA_TIMEOUT = '全景图生成超时，请稍后重试'
const PANORAMA_CANCELLED = '操作已取消'
const PANORAMA_POLL_FAILED = '全景图任务轮询失败'
const PANORAMA_NO_TASK = '全景图任务未返回任务 ID'
const PANORAMA_DONE = '全景图已生成'

function hasChinese(text) {
  return /[一-鿿]/.test(String(text || ''))
}

function isChineseWithoutEnglishTech(text) {
  const value = String(text || '')
  return hasChinese(value) && !/timeout of|Network Error|Request failed|Please |failed to generate/i.test(value)
}

async function rejectedMessage(run) {
  try {
    await run()
  } catch (error) {
    return String(error?.message || '')
  }
  assert.fail('应当抛出错误')
}

function timeoutError(message = 'timeout of 600000ms exceeded') {
  const error = new Error(message)
  error.code = 'ECONNABORTED'
  error.isTimeout = true
  return error
}

function loadWait(getTask) {
  const taskAPI = { get: getTask }
  return new Function(
    'taskAPI',
    'canvasUserError',
    'isRequestNetworkError',
    'isRequestTimeout',
    `'use strict'; ${remainingExtractNamedFunction(panelSource, 'panoramaTaskError')}\n${remainingExtractNamedFunction(panelSource, 'waitForPanoramaTask')}; return waitForPanoramaTask;`,
  )(taskAPI, canvasUserError, isRequestNetworkError, isRequestTimeout)
}

function loadGenerate(overrides = {}) {
  const hasSceneSource = { value: overrides.hasSceneSource ?? true }
  const panoramaGenerating = { value: false }
  const panoramaError = { value: '' }
  const messages = []
  const ElMessage = {
    success(text) { messages.push({ type: 'success', text }) },
    error(text) { messages.push({ type: 'error', text }) },
    warning(text) { messages.push({ type: 'warning', text }) },
    info(text) { messages.push({ type: 'info', text }) },
  }
  const sceneAPI = {
    generatePanorama: overrides.generatePanorama || (async (sceneId) => {
      sceneAPI.lastSceneId = sceneId
      return { task_id: 'pano-' + sceneId }
    }),
  }
  const props = { entity: { id: overrides.sceneId ?? 11 } }
  const ctx = {
    refreshDrama: overrides.refreshDrama || (async () => {}),
    refresh: overrides.refresh || (async () => {}),
  }
  const waitForPanoramaTask = overrides.waitForPanoramaTask || (async () => {})
  const refreshPanoramaScene = overrides.refreshPanoramaScene || (async () => {})
  const generatePanorama = new Function(
    'hasSceneSource',
    'panoramaGenerating',
    'panoramaError',
    'sceneAPI',
    'props',
    'waitForPanoramaTask',
    'refreshPanoramaScene',
    'ctx',
    'ElMessage',
    'canvasUserError',
    `'use strict'; ${remainingExtractNamedFunction(panelSource, 'generatePanorama')}; return generatePanorama;`,
  )(
    hasSceneSource,
    panoramaGenerating,
    panoramaError,
    sceneAPI,
    props,
    waitForPanoramaTask,
    refreshPanoramaScene,
    ctx,
    ElMessage,
    canvasUserError,
  )
  return { generatePanorama, panoramaError, panoramaGenerating, messages, props, sceneAPI }
}

test('画布全景图禁用文案与制作页对齐，并保留主图生成中提示', () => {
  assert.match(filmScenesSource, new RegExp(MISSING_MAIN_IMAGE))
  assert.match(panelSource, new RegExp(`if \\(!hasSceneSource\\.value\\) return '${MISSING_MAIN_IMAGE}'`))
  assert.match(panelSource, new RegExp(`if \\(generating\\.value\\) return '${MAIN_IMAGE_GENERATING}'`))
  assert.match(panelSource, /:reason="panoramaDisabledReason"/)
  assert.match(panelSource, /:disabled="Boolean\(panoramaDisabledReason\)"/)
  assert.doesNotMatch(panelSource, /请先生成场景主图/)
})

test('画布全景图失败、超时、取消保持中文，不回退英文', () => {
  assert.match(filmScenesSource, new RegExp(PANORAMA_FAILED))
  assert.match(filmScenesSource, new RegExp(PANORAMA_TIMEOUT))
  assert.match(filmScenesSource, new RegExp(PANORAMA_CANCELLED))
  assert.match(panelSource, new RegExp(`canvasUserError\\(panoramaTaskError\\(task\\), '${PANORAMA_FAILED}'\\)`))
  assert.match(panelSource, new RegExp(`canvasUserError\\(panoramaTaskError\\(task, '${PANORAMA_TIMEOUT}'\\), '${PANORAMA_TIMEOUT}'\\)`))
  assert.match(panelSource, new RegExp(`canvasUserError\\(panoramaTaskError\\(task, '${PANORAMA_CANCELLED}'\\), '${PANORAMA_CANCELLED}'\\)`))
  assert.match(panelSource, new RegExp(`throw new Error\\('${PANORAMA_TIMEOUT}'\\)`))
  assert.match(panelSource, new RegExp(`panoramaError\\.value = canvasUserError\\(error, '${PANORAMA_FAILED}'\\)`))
  assert.doesNotMatch(panelSource, /全景图生成超时，请稍后刷新查看/)
  assert.doesNotMatch(panelSource, /Panorama generation failed|Please generate|Network Error|timeout of 600000ms exceeded/)
})

test('waitForPanoramaTask 把失败、超时、取消和英文技术错误翻成中文', async () => {
  const failed = loadWait(async () => ({ status: 'failed', error: 'Request failed with status code 500' }))
  assert.equal(await rejectedMessage(() => failed('t-fail', 2, 0)), PANORAMA_FAILED)

  const chineseFailed = loadWait(async () => ({ status: 'failed', error: '配额已用完' }))
  assert.equal(await rejectedMessage(() => chineseFailed('t-fail-zh', 2, 0)), '配额已用完')

  const timedOut = loadWait(async () => ({ status: 'timeout', error: 'timeout of 600000ms exceeded' }))
  assert.equal(await rejectedMessage(() => timedOut('t-timeout', 2, 0)), PANORAMA_TIMEOUT)

  const timeoutNoError = loadWait(async () => ({ status: 'timeout' }))
  assert.equal(await rejectedMessage(() => timeoutNoError('t-timeout-empty', 2, 0)), PANORAMA_TIMEOUT)

  const cancelled = loadWait(async () => ({ status: 'cancelled', error: 'canceled' }))
  assert.equal(await rejectedMessage(() => cancelled('t-cancel', 2, 0)), PANORAMA_CANCELLED)

  const canceled = loadWait(async () => ({ status: 'canceled' }))
  assert.equal(await rejectedMessage(() => canceled('t-canceled', 2, 0)), PANORAMA_CANCELLED)

  const pending = loadWait(async () => ({ status: 'processing' }))
  assert.equal(await rejectedMessage(() => pending('t-pending', 2, 0)), PANORAMA_TIMEOUT)

  const httpTimeout = loadWait(async () => { throw timeoutError() })
  assert.equal(await rejectedMessage(() => httpTimeout('t-http-timeout', 1, 0)), PANORAMA_TIMEOUT)

  const network = loadWait(async () => {
    const error = new Error('Network Error')
    error.code = 'ERR_NETWORK'
    throw error
  })
  assert.equal(await rejectedMessage(() => network('t-network', 1, 0)), PANORAMA_POLL_FAILED)

  const completed = loadWait(async () => ({ status: 'completed' }))
  await completed('t-ok', 2, 0)
})

test('generatePanorama 把失败超时取消写到中文 panoramaError，无主图时不提交', async () => {
  const blocked = loadGenerate({
    hasSceneSource: false,
    generatePanorama: async () => { throw new Error('should not run') },
  })
  await blocked.generatePanorama()
  assert.equal(blocked.panoramaError.value, '')
  assert.equal(blocked.messages.length, 0)

  const failed = loadGenerate({
    sceneId: 11,
    waitForPanoramaTask: async () => { throw new Error('Request failed with status code 500') },
  })
  await failed.generatePanorama()
  assert.equal(failed.sceneAPI.lastSceneId, 11)
  assert.equal(failed.panoramaError.value, PANORAMA_FAILED)
  assert.equal(failed.messages[0].text, PANORAMA_FAILED)
  assert.equal(isChineseWithoutEnglishTech(failed.panoramaError.value), true)
  assert.equal(failed.panoramaGenerating.value, false)

  const timedOut = loadGenerate({
    waitForPanoramaTask: async () => { throw new Error(PANORAMA_TIMEOUT) },
  })
  await timedOut.generatePanorama()
  assert.equal(timedOut.panoramaError.value, PANORAMA_TIMEOUT)
  assert.equal(isChineseWithoutEnglishTech(timedOut.panoramaError.value), true)

  const cancelled = loadGenerate({
    waitForPanoramaTask: async () => { throw new Error(PANORAMA_CANCELLED) },
  })
  await cancelled.generatePanorama()
  assert.equal(cancelled.panoramaError.value, PANORAMA_CANCELLED)

  const abort = new Error('canceled')
  abort.name = 'AbortError'
  const aborted = loadGenerate({
    waitForPanoramaTask: async () => { throw abort },
  })
  await aborted.generatePanorama()
  assert.equal(aborted.panoramaError.value, PANORAMA_CANCELLED)

  const missingTask = loadGenerate({
    generatePanorama: async () => ({}),
  })
  await missingTask.generatePanorama()
  assert.equal(missingTask.panoramaError.value, PANORAMA_NO_TASK)

  const ok = loadGenerate({ sceneId: 21 })
  await ok.generatePanorama()
  assert.equal(ok.sceneAPI.lastSceneId, 21)
  assert.notEqual(ok.sceneAPI.lastSceneId, 11)
  assert.equal(ok.panoramaError.value, '')
  assert.equal(ok.messages[0].text, PANORAMA_DONE)
})
