import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  clampGenerationConcurrency,
  describeGenerationSettingsLoadError,
  loadGenerationSettingsPayload,
  parseGenerationSettingsPayload,
  shouldIgnoreGenerationSettingsError,
  validateGenerationConcurrency,
} from '../src/utils/aiConfigGenerationSettings.js'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

function canceledError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ERR_CANCELED' })
}

test('generation settings expose loading, persistent error, and retry states', async () => {
  assert.match(source, /loadGenerationSettingsPayload\(generationSettingsAPI/)
  assert.match(source, /shouldIgnoreGenerationSettingsError\(error, controller\.signal\)/)
  assert.match(source, /describeGenerationSettingsLoadError\(error, controller\.signal\)/)
  assert.match(
    source,
    /v-if="generationSettingsLoadState === 'error'"[\s\S]*role="alert"[\s\S]*generationSettingsLoadError[\s\S]*@click="loadGenerationSettings"/,
  )
  assert.match(source, /v-else-if="generationSettingsLoadState === 'loading'"[\s\S]*正在读取生成设置/)

  const ok = await loadGenerationSettingsPayload({
    async get() {
      return { concurrency: 3, video_concurrency: 4 }
    },
  }, { delayMs: 0 })
  assert.equal(ok.aborted, false)
  assert.equal(ok.concurrency, 3)
  assert.equal(ok.videoConcurrency, 4)

  await assert.rejects(
    loadGenerationSettingsPayload({
      async get() {
        return { concurrency: 0, video_concurrency: 4 }
      },
    }, { delayMs: 0 }),
    /生成设置返回的数据无效/,
  )

  const controller = new AbortController()
  const canceled = await loadGenerationSettingsPayload({
    async get() {
      throw canceledError()
    },
  }, { signal: controller.signal, delayMs: 0 }).catch((error) => error)
  assert.equal(shouldIgnoreGenerationSettingsError(canceledError(), controller.signal) || canceled?.aborted, true)
})

test('generation settings save remains fail closed until a successful reload', () => {
  assert.match(
    source,
    /const generationSettingsWriteLocked = computed\(\(\) => generationSettingsLoadState\.value !== 'ready' \|\| genSettingSaving\.value\)/,
  )
  assert.match(source, /:disabled="generationSettingsWriteLocked"[\s\S]*@click="saveGenerationSettings"/)
  assert.match(source, /validateGenerationConcurrency\(n, nv\)/)
  assert.match(source, /generationSettingsWriteLocked\.value/)
  assert.ok(source.indexOf('generationSettingsWriteLocked.value') < source.indexOf('generationSettingsAPI.update'))
  assert.equal(validateGenerationConcurrency(0, 3), '图片并发数请填写 1-20 之间的整数')
  assert.equal(validateGenerationConcurrency(3, 99), '视频并发数请填写 1-20 之间的整数')
  assert.equal(validateGenerationConcurrency(3, 4), '')
  assert.equal(clampGenerationConcurrency('7.6'), 8)
  assert.equal(clampGenerationConcurrency('0'), null)
  assert.match(describeGenerationSettingsLoadError({ response: { status: 502 } }), /生成设置服务暂时不可用（HTTP 502）/)
})
