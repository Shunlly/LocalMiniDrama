import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const componentSource = readFileSync(
  new URL('../src/components/AIConfigContent.vue', import.meta.url),
  'utf8',
)
const validationUtilityUrl = new URL('../src/utils/aiConfigValidationFocus.js', import.meta.url)

test('AI config dialog exposes a sticky live validation summary and an owned scroll container', () => {
  assert.match(componentSource, /ref="configDialogScrollRef"\s+class="ai-config-dialog-scroll"/)
  assert.match(
    componentSource,
    /class="ai-config-validation-summary"[\s\S]*?role="alert"[\s\S]*?aria-live="assertive"[\s\S]*?aria-atomic="true"/,
  )
  assert.match(componentSource, /v-for="item in configValidationSummary"/)
  assert.match(
    componentSource,
    /\.ai-config-validation-summary\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
  )
  assert.match(
    componentSource,
    /\.ai-config-dialog-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/,
  )
})

test('AI config form dialog stays within the viewport while only its body content scrolls', () => {
  assert.match(
    componentSource,
    /<AccessibleDialog[\s\S]*?class="ai-config-dialog ai-config-form-dialog ai-config-overlay"[\s\S]*?append-to-body/,
  )
  assert.match(
    componentSource,
    /\.ai-config-form-dialog\s*\{[\s\S]*?max-height:\s*92vh;[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/,
  )
  assert.match(
    componentSource,
    /\.ai-config-form-dialog\s*>\s*\.el-dialog__body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/,
  )
})

test('critical AI config fields expose explicit invalid state and descriptions', () => {
  for (const field of ['service_type', 'name', 'base_url', 'api_key', 'model', 'api_protocol', 'endpoint']) {
    const marker = `data-ai-config-field="${field}"`
    const start = componentSource.indexOf(marker)
    assert.notEqual(start, -1, `${field} should have a stable field marker`)
    const tagStart = componentSource.lastIndexOf('<el-', start)
    const tagEnd = componentSource.indexOf('>', start)
    const fieldTag = componentSource.slice(tagStart, tagEnd + 1)
    assert.match(fieldTag, /:aria-invalid="isConfigFieldInvalid\('[^']+'\)"/)
    assert.match(fieldTag, /:aria-describedby="configFieldDescriptionId\('[^']+'\)"/)
  }

  assert.match(componentSource, /<el-form-item[^>]*prop="modelText"/)
  assert.match(componentSource, /<el-form-item[^>]*prop="api_protocol"/)
  assert.match(componentSource, /<el-form-item[^>]*prop="endpoint"/)
})

test('AI config submit preserves Element Plus invalid fields for focus and clears recovered errors', () => {
  assert.match(
    componentSource,
    /async function submit\(\)[\s\S]*?catch \(invalidFields\)[\s\S]*?handleConfigValidationFailure\(invalidFields\)[\s\S]*?return/,
  )
  assert.match(componentSource, /@validate="handleConfigFieldValidated"/)
  assert.match(componentSource, /handleConfigFieldValidated,/)
  assert.match(componentSource, /handleConfigValidationFailure,/)
  assert.match(componentSource, /useAiConfigUnsaved\(\{/)
})

test('model validation preserves the existing model-less ComfyUI workflow exception', () => {
  assert.match(
    componentSource,
    /modelText:\s*\[[\s\S]*?if \(form\.value\.service_type === 'jimeng2_character_auth' \|\| isComfyUiForm\.value \|\| parseModelText\(value\)\.length > 0\) return cb\(\)/,
  )
})

test('validation errors follow visual field order and never expose an API key', async () => {
  assert.equal(existsSync(validationUtilityUrl), true, 'validation focus utility should exist')
  const { createAiConfigValidationSummary } = await import(validationUtilityUrl.href)
  const secret = 'sk-live-secret-value'

  const summary = createAiConfigValidationSummary({
    endpoint: [{ message: '请输入提交端点' }],
    api_key: [{ message: `API Key ${secret} 无效` }],
    name: [{ message: '请输入名称' }],
    modelText: [{ message: '请填写至少一个模型' }],
  })

  assert.deepEqual(summary.map(({ field, prop, section }) => ({ field, prop, section })), [
    { field: 'name', prop: 'name', section: null },
    { field: 'api_key', prop: 'api_key', section: null },
    { field: 'endpoint', prop: 'endpoint', section: 'endpoint' },
    { field: 'model', prop: 'modelText', section: null },
  ])
  assert.equal(summary.some((item) => item.message.includes(secret)), false)
  assert.match(summary.find((item) => item.field === 'api_key').message, /API Key|凭据/)
})

test('validation focus expands the owning section, scrolls its dialog container, and focuses the field', async () => {
  assert.equal(existsSync(validationUtilityUrl), true, 'validation focus utility should exist')
  const {
    createAiConfigValidationSummary,
    focusFirstInvalidAiConfigField,
  } = await import(validationUtilityUrl.href)
  const calls = []
  const formItem = {
    getBoundingClientRect: () => ({ top: 360, height: 40 }),
  }
  const input = {
    matches: () => true,
    closest: () => formItem,
    focus: (options) => calls.push(['focus', options]),
  }
  const scrollContainer = {
    scrollTop: 30,
    clientHeight: 240,
    querySelector: (selector) => {
      calls.push(['query', selector])
      return input
    },
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: (options) => calls.push(['scroll', options]),
  }
  const summary = createAiConfigValidationSummary({
    base_url: [{ message: '请输入 Base URL' }],
  })

  const focusedField = await focusFirstInvalidAiConfigField(summary, {
    scrollContainer,
    expandSection: (section) => calls.push(['expand', section]),
    nextTickFn: async () => calls.push(['tick']),
  })

  assert.equal(focusedField, 'base_url')
  assert.deepEqual(calls[0], ['expand', 'endpoint'])
  assert.deepEqual(calls[1], ['tick'])
  assert.deepEqual(calls[2], ['query', '[data-ai-config-field="base_url"]'])
  assert.deepEqual(calls[3], ['scroll', { top: 190, behavior: 'smooth' }])
  assert.deepEqual(calls[4], ['focus', { preventScroll: true }])
})
