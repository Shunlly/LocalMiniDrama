import test from 'node:test'
import assert from 'node:assert/strict'

import { pickActiveNavigationAnchor } from '../src/composables/filmCreate/useNavigation.js'

test('navigation picks the last section crossing the sticky-header offset', () => {
  const entries = [
    { id: 'anchor-script', top: -500 },
    { id: 'anchor-characters', top: 60 },
    { id: 'anchor-props', top: 420 },
  ]

  assert.equal(pickActiveNavigationAnchor(entries, 96), 'anchor-characters')
})

test('navigation keeps the first upcoming section before any section crosses', () => {
  assert.equal(
    pickActiveNavigationAnchor([
      { id: 'anchor-script', top: 140 },
      { id: 'anchor-characters', top: 700 },
    ], 96),
    'anchor-script',
  )
})

test('navigation ignores invalid measurements and handles an empty page', () => {
  assert.equal(
    pickActiveNavigationAnchor([
      { id: 'missing', top: Number.NaN },
      { id: 'anchor-script', top: 80 },
    ], 96),
    'anchor-script',
  )
  assert.equal(pickActiveNavigationAnchor([], 96), '')
})

test('navigation falls back to the first workflow step before async anchors mount', () => {
  assert.equal(
    pickActiveNavigationAnchor([
      { id: 'anchor-script', top: Number.NaN },
      { id: 'anchor-characters', top: Number.NaN },
    ], 96),
    'anchor-script',
  )
})
