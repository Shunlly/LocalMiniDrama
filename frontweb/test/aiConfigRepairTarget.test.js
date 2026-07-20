import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyAiConfigRepairTarget,
  getAiConfigRepairTarget,
} from '../src/utils/aiConfigRepairTarget.js'

test('AI structural repair targets map to the concrete missing field', () => {
  assert.deepEqual(getAiConfigRepairTarget('missing_credentials'), {
    field: 'credentials',
    section: null,
  })
  assert.deepEqual(getAiConfigRepairTarget('missing_model'), {
    field: 'model',
    section: null,
  })
  assert.deepEqual(getAiConfigRepairTarget('missing_workflow'), {
    field: 'workflow',
    section: 'endpoint',
  })
})

test('workflow repair expands its advanced section and focuses Workflow JSON after render', async () => {
  const advancedSections = { value: [] }
  const focused = []
  let renders = 0

  const target = await applyAiConfigRepairTarget('missing_workflow', {
    advancedSections,
    fieldRefs: {
      workflow: { value: { focus: () => focused.push('workflow') } },
    },
    nextTickFn: async () => { renders += 1 },
  })

  assert.deepEqual(target, { field: 'workflow', section: 'endpoint' })
  assert.deepEqual(advancedSections.value, ['endpoint'])
  assert.equal(renders, 1)
  assert.deepEqual(focused, ['workflow'])
})

test('credential and model repairs focus their corresponding visible field', async () => {
  const focused = []
  const fieldRefs = {
    credentials: { value: { focus: () => focused.push('credentials') } },
    model: { value: { focus: () => focused.push('model') } },
  }
  const options = {
    advancedSections: { value: [] },
    fieldRefs,
    nextTickFn: async () => {},
  }

  await applyAiConfigRepairTarget('missing_credentials', options)
  await applyAiConfigRepairTarget('missing_model', options)

  assert.deepEqual(focused, ['credentials', 'model'])
})
