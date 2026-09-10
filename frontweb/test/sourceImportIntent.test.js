import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { revealSourceImportIntent } from '../src/utils/sourceImportIntent.js'

const panelSource = readFileSync(new URL('../src/components/SourceIntakeWorkflowPanel.vue', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')

test('completed workflow source-import intent reveals intake and focuses the URL field', async () => {
  const historyExpanded = { value: false }
  const selectedStepId = { value: 'delivery' }
  const focused = []

  await revealSourceImportIntent({
    historyExpanded,
    selectedStepId,
    sourceUrlInput: { value: { focus: () => focused.push('source-url') } },
    nextTickFn: async () => {},
  })

  assert.equal(historyExpanded.value, true)
  assert.equal(selectedStepId.value, 'intake')
  assert.deepEqual(focused, ['source-url'])

  const delayed = []
  const timers = []
  await revealSourceImportIntent({
    historyExpanded: { value: false },
    selectedStepId: { value: 'delivery' },
    sourceUrlInput: { value: { focus: () => delayed.push('source-url') } },
    nextTickFn: async () => {},
    windowRef: { setTimeout: (callback, delay) => { timers.push(delay); callback() } },
    refocusDelay: 300,
  })
  assert.deepEqual(delayed, ['source-url', 'source-url'])
  assert.deepEqual(timers, [300])
})

test('DramaDetail forwards source URL intent and the workflow applies it after loading completed state', () => {
  assert.match(detailSource, /:source-import-intent="sourceImportIntent"/)
  assert.match(detailSource, /route\.query\.intake === 'source-url'/)
  assert.match(detailSource, /scrollToSection\(id, \{ focus: !\(id === 'source-intake-workflow' && sourceImportIntent\.value\) \}\)/)
  assert.match(panelSource, /sourceImportIntent: \{ type: Boolean, default: false \}/)
  assert.match(panelSource, /ref="sourceUrlInput"[\s\S]*v-model="form\.source_url"/)
  assert.match(panelSource, /if \(props\.sourceImportIntent\) await openSourceImportIntent\(\)[\s\S]*await loadData\(\)[\s\S]*if \(props\.sourceImportIntent\) await openSourceImportIntent\(\)/)
  assert.match(panelSource, /persistInspectedFlowStep\(selectedFlowStepId\.value\)[\s\S]*sourceUrlInput\.value\?\.focus\?\.\(\)/)
  assert.match(detailSource, /route\.path, route\.hash, Boolean\(drama\.value\), sourceImportIntent\.value/)
  assert.doesNotMatch(detailSource, /\(\) => \[route\.fullPath, Boolean\(drama\.value\)\]/)
})
