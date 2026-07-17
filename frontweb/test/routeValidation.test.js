import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isValidResourceId, requireValidDramaId } from '../src/utils/routeValidation.js'

test('resource routes accept only positive integer ids', () => {
  assert.equal(isValidResourceId(12), true)
  assert.equal(isValidResourceId('12'), true)
  for (const value of ['', '0', '-1', '12.5', 'abc', null, undefined]) {
    assert.equal(isValidResourceId(value), false)
  }
})

test('invalid drama routes resolve to the not-found page without retaining a broken view', () => {
  assert.equal(requireValidDramaId({ params: { id: '8' } }), true)
  assert.deepEqual(
    requireValidDramaId({ params: { id: 'bad' }, fullPath: '/film/bad' }),
    { path: '/not-found', replace: true, query: { from: '/film/bad' } },
  )
})

test('router exposes a catch-all not-found route', () => {
  const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
  assert.match(routerSource, /path: '\/:pathMatch\(\.\*\)\*'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/NotFound\.vue'\)/)
})
