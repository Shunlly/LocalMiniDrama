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
})

test('DramaDetail forwards source URL intent and the workflow applies it after loading completed state', () => {
  assert.match(detailSource, /:source-import-intent="sourceImportIntent"/)
  assert.match(detailSource, /route\.query\.intake === 'source-url'/)
  assert.match(detailSource, /scrollToSection\(id, \{ focus: !\(id === 'source-intake-workflow' && sourceImportIntent\.value\) \}\)/)
  assert.match(panelSource, /sourceImportIntent: \{ type: Boolean, default: false \}/)
  assert.match(panelSource, /ref="sourceUrlInput"[\s\S]*v-model="form\.source_url"/)
  assert.match(panelSource, /await loadData\(\)[\s\S]*if \(props\.sourceImportIntent\) await openSourceImportIntent\(\)/)
})
