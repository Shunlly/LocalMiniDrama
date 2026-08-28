import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/AIConfigContent.vue', import.meta.url), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('generation settings expose loading, persistent error, and retry states', () => {
  assert.match(source, /const genConcurrencyInput = ref\(null\)/)
  assert.match(source, /const genVideoConcurrencyInput = ref\(null\)/)
  assert.match(source, /const generationSettingsLoadState = ref\('loading'\)/)
  assert.match(source, /const generationSettingsLoadError = ref\(''\)/)

  const loader = sourceBetween(
    'async function loadGenerationSettings',
    'function onConcurrencyChange',
  )
  assert.match(loader, /generationSettingsLoadState\.value = 'loading'/)
  assert.match(loader, /generationSettingsLoadState\.value = 'ready'/)
  assert.match(loader, /generationSettingsLoadError\.value = ''/)
  assert.match(loader, /generationSettingsLoadError\.value = describeServiceLoadError\(/)
  assert.match(loader, /withRequestRetry/)
  assert.match(loader, /isRequestCanceled/)
  assert.match(loader, /generationSettingsLoadState\.value = 'error'/)
  assert.doesNotMatch(loader, /catch \(_\) \{\}/)

  assert.match(
    source,
    /v-if="generationSettingsLoadState === 'error'"[\s\S]*role="alert"[\s\S]*generationSettingsLoadError[\s\S]*@click="loadGenerationSettings"/,
  )
  assert.match(source, /v-else-if="generationSettingsLoadState === 'loading'"[\s\S]*正在读取生成设置/)
})

test('generation settings save remains fail closed until a successful reload', () => {
  assert.match(
    source,
    /const generationSettingsWriteLocked = computed\(\(\) => generationSettingsLoadState\.value !== 'ready' \|\| genSettingSaving\.value\)/,
  )
  assert.match(source, /:disabled="generationSettingsWriteLocked"[\s\S]*@click="saveGenerationSettings"/)

  const saver = sourceBetween(
    'async function saveGenerationSettings',
    'const loading = ref',
  )
  assert.match(
    saver,
    /if \(generationSettingsWriteLocked\.value\) \{[\s\S]*ElMessage\.warning\([\s\S]*return/,
  )
  assert.ok(
    saver.indexOf('generationSettingsWriteLocked.value')
      < saver.indexOf('generationSettingsAPI.update'),
  )
})
