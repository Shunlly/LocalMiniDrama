import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'

import { useDisclosureState } from '../src/composables/useDisclosureState.js'

test('disclosure starts compact and toggles without persistence side effects', () => {
  const state = useDisclosureState()

  assert.equal(state.expanded.value, false)
  state.toggle()
  assert.equal(state.expanded.value, true)
  state.setExpanded(false)
  assert.equal(state.expanded.value, false)
})

test('forceExpanded opens running work and does not close it afterward', async () => {
  const running = ref(false)
  const state = useDisclosureState({ forceExpanded: running })

  running.value = true
  await nextTick()
  assert.equal(state.expanded.value, true)

  running.value = false
  await nextTick()
  assert.equal(state.expanded.value, true)
})
