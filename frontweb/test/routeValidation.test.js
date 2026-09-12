import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isValidResourceId,
  normalizeResourceId,
  normalizeDramaDetailHash,
  normalizeSourceWorkflowStep,
  requireValidDramaId,
  sanitizeDramaDetailLocation,
} from '../src/utils/routeValidation.js'

test('resource routes accept only positive integer ids', () => {
  assert.equal(isValidResourceId(12), true)
  assert.equal(isValidResourceId('12'), true)
  assert.equal(normalizeResourceId(['12', '99']), '12')
  assert.equal(isValidResourceId(['12', '99']), true)
  for (const value of ['', '0', '-1', '12.5', 'abc', ' 12 ', '012', null, undefined, ['bad', '12']]) {
    assert.equal(isValidResourceId(value), false, String(value))
  }
})

test('invalid drama routes resolve to the not-found page without retaining a broken view', () => {
  assert.equal(requireValidDramaId({ params: { id: '8' } }), true)
  assert.deepEqual(
    requireValidDramaId({ params: { id: 'bad' }, fullPath: '/film/bad' }),
    { name: 'not-found', replace: true, query: { from: '/film/bad' } },
  )
  assert.deepEqual(
    requireValidDramaId({ params: { id: 'abc' }, fullPath: '/film/abc/canvas' }),
    { name: 'not-found', replace: true, query: { from: '/film/abc/canvas' } },
  )
  assert.deepEqual(
    requireValidDramaId({ params: { id: '0' }, fullPath: '/drama/0' }),
    { name: 'not-found', replace: true, query: { from: '/drama/0' } },
  )
  assert.deepEqual(
    requireValidDramaId({ name: 'film', params: { id: ['8'] }, query: { episode: '2' }, hash: '' }),
    {
      name: 'film',
      params: { id: '8' },
      query: { episode: '2' },
      hash: '',
      replace: true,
    },
  )
})

test('router exposes a catch-all not-found route', () => {
  const routerSource = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
  assert.match(routerSource, /path: '\/:pathMatch\(\.\*\)\*'/)
  assert.match(routerSource, /component: \(\) => import\('@\/views\/NotFound\.vue'\)/)
  assert.match(routerSource, /sanitizeDramaDetailLocation\(redirected \|\| to\)/)
})

test('剧详情深链接只恢复合法步骤和锚点', () => {
  assert.equal(normalizeSourceWorkflowStep(['qa', 'evil']), 'qa')
  assert.equal(normalizeSourceWorkflowStep('javascript:alert(1)'), '')
  assert.equal(normalizeDramaDetailHash('#intake'), '#source-intake-workflow')
  assert.equal(normalizeDramaDetailHash('#episode-list'), '#episode-list')
  assert.equal(normalizeDramaDetailHash('#evil'), '')

  const restored = sanitizeDramaDetailLocation({
    name: 'drama-detail',
    params: { id: '21' },
    query: { step: ['process', 'evil'], intake: 'source-url' },
    hash: '#intake',
  })
  assert.equal(restored.query.step, 'process')
  assert.equal(restored.query.intake, 'source-url')
  assert.equal(restored.hash, '#source-intake-workflow')
  assert.equal(restored.replace, true)

  const dropped = sanitizeDramaDetailLocation({
    name: 'drama-detail',
    params: { id: '21' },
    query: { step: 'not-a-step' },
    hash: '#javascript',
  })
  assert.equal(dropped.query.step, undefined)
  assert.equal(dropped.hash, '')

  assert.equal(sanitizeDramaDetailLocation({ name: 'film', query: { step: 'qa' } }), null)
})
