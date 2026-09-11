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
const paneSource = readFileSync(new URL('../src/components/aiConfig/AiConfigGenerationSettingsPane.vue', import.meta.url), 'utf8')
const composableSource = readFileSync(new URL('../src/composables/useAiConfigGenerationSettings.js', import.meta.url), 'utf8')
const settingsSurface = [source, paneSource].join('\n')

function canceledError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ERR_CANCELED' })
}

test('generation settings expose loading, persistent error, and retry states', async () => {
  assert.match(composableSource, /loadGenerationSettingsPayload\(generationSettingsAPI/)
  assert.match(composableSource, /shouldIgnoreGenerationSettingsError\(error, controller\.signal\)/)
  assert.match(composableSource, /describeGenerationSettingsLoadError\(error, controller\.signal\)/)
  assert.match(source, /<AiConfigGenerationSettingsPane/)
  assert.match(
    paneSource,
    /v-if="generationSettingsLoadState === 'error'"[\s\S]*role="alert"[\s\S]*generationSettingsLoadError[\s\S]*@click="loadGenerationSettings"/,
  )
  assert.match(paneSource, /v-else-if="generationSettingsLoadState === 'loading'"[\s\S]*正在读取生成设置/)

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
    composableSource,
    /const generationSettingsWriteLocked = computed\(\(\) => generationSettingsLoadState\.value !== 'ready' \|\| genSettingSaving\.value\)/,
  )
  assert.match(settingsSurface, /:disabled="generationSettingsWriteLocked"[\s\S]*@click="saveGenerationSettings"/)
  assert.match(settingsSurface, /:title="generationSettingsWriteLocked \? generationSettingsWriteLockReason : undefined"/)
  assert.match(composableSource, /generationSettingsWriteLockReason/)
  assert.match(composableSource, /validateGenerationConcurrency\(n, nv\)/)
  assert.match(composableSource, /generationSettingsWriteLocked\.value/)
  assert.ok(composableSource.indexOf('generationSettingsWriteLocked.value') < composableSource.indexOf('generationSettingsAPI.update'))
  assert.match(composableSource, /if \(isUserFacingAbort\(e\)\) return\s*ElMessage\.error\(toUserFacingError\(e, '保存失败'\)\)/)
  assert.match(composableSource, /保存成功，生成并发设置已写入本地服务/)
  assert.doesNotMatch(source, /保存失败：/)
  assert.equal(validateGenerationConcurrency(0, 3), '图片并发数请填写 1-20 之间的整数')
  assert.equal(validateGenerationConcurrency(3, 99), '视频并发数请填写 1-20 之间的整数')
  assert.equal(validateGenerationConcurrency(3, 4), '')
  assert.equal(clampGenerationConcurrency('7.6'), 8)
  assert.equal(clampGenerationConcurrency('0'), null)
  assert.match(describeGenerationSettingsLoadError({ response: { status: 502 } }), /生成设置服务暂时不可用（HTTP 502）/)
})
