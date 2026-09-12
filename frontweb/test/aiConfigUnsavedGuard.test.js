import test from 'node:test'
import assert from 'node:assert/strict'

import { hasUnsavedAiConfigChanges } from '../src/utils/aiConfigUnsavedGuard.js'

test('reports dirty state from any AI config editor', () => {
  const cleanEditor = { hasUnsavedChanges: () => false }
  const dirtyEditor = { hasUnsavedChanges: () => true }

  assert.equal(hasUnsavedAiConfigChanges([cleanEditor, dirtyEditor]), true)
})

test('treats missing, unmounted, and invalid editors as clean', () => {
  assert.equal(hasUnsavedAiConfigChanges([null, undefined, {}, false]), false)
})

test('does not clear dirty state while evaluating a close request', () => {
  let dirty = true
  const editor = {
    hasUnsavedChanges: () => dirty,
    markUnsavedChangesDiscarded: () => { dirty = false },
  }

  assert.equal(hasUnsavedAiConfigChanges([editor]), true)
  assert.equal(dirty, true)
})
