import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

import { useAiConfigEmptyCopy } from '../src/composables/useAiConfigEmptyCopy.js'

const vueSource = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')
const emptyCopySource = readFileSync(new URL('../src/composables/useAiConfigEmptyCopy.js', import.meta.url), 'utf8')

const CONFIG_ID = 41
const DRAMA_ID = 11
assert.notEqual(CONFIG_ID, DRAMA_ID)

function createCopy(overrides = {}) {
  return useAiConfigEmptyCopy({
    list: overrides.list || ref([]),
    configLoadState: overrides.configLoadState || ref('idle'),
    configLoadError: overrides.configLoadError || ref(''),
    vendorLockError: overrides.vendorLockError || ref(''),
    activeServiceFilter: overrides.activeServiceFilter || ref(''),
  })
}

test('空态文案区分 pending/error/过滤类型，且不抽走 loadList/openTest', () => {
  assert.match(vueSource, /useAiConfigEmptyCopy\(/)
  assert.match(vueSource, /async function loadList\(\)/)
  assert.match(vueSource, /async function openTest\(row\)/)
  assert.doesNotMatch(emptyCopySource, /async function loadList\(/)
  assert.doesNotMatch(emptyCopySource, /async function openTest\(/)
  assert.doesNotMatch(emptyCopySource, /useAiConfigList/)

  const pending = createCopy()
  assert.equal(pending.configListPendingEmpty.value, true)
  assert.equal(pending.configListFailedEmpty.value, false)
  assert.equal(pending.configEmptyTitle.value, '正在读取配置列表')

  const failed = createCopy({
    configLoadState: ref('error'),
    configLoadError: ref('暂时无法读取 AI 配置，请稍后重试。'),
  })
  assert.equal(failed.configListFailedEmpty.value, true)
  assert.equal(failed.configListPendingEmpty.value, false)
  assert.equal(failed.configEmptyTitle.value, '暂时无法读取配置列表')
  assert.match(failed.configEmptyDescription.value, /暂时无法读取 AI 配置/)

  const stale = createCopy({
    list: ref([{ id: CONFIG_ID, drama_id: DRAMA_ID, service_type: 'text' }]),
    configLoadState: ref('error'),
    configLoadError: ref('暂时无法读取 AI 配置，请稍后重试。'),
  })
  assert.equal(stale.configListFailedEmpty.value, false)
  assert.equal(stale.configListPendingEmpty.value, false)
  assert.equal(stale.configEmptyTitle.value, '还没有 AI 服务配置')
})

test('OCR 与语音转写过滤空态不会互相串用', () => {
  const ocr = createCopy({
    configLoadState: ref('ready'),
    activeServiceFilter: ref('ocr'),
  })
  const transcription = createCopy({
    configLoadState: ref('ready'),
    activeServiceFilter: ref('transcription'),
  })
  assert.match(ocr.configEmptyTitle.value, /图片识别 OCR/)
  assert.match(ocr.configEmptyDescription.value, /PDF\/图片识别/)
  assert.doesNotMatch(ocr.configEmptyDescription.value, /音频\/视频转写/)
  assert.match(transcription.configEmptyTitle.value, /语音转写/)
  assert.match(transcription.configEmptyDescription.value, /音频\/视频转写/)
  assert.doesNotMatch(transcription.configEmptyDescription.value, /PDF\/图片识别/)
})