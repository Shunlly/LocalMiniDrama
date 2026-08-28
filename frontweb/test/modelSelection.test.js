import test from 'node:test'
import assert from 'node:assert/strict'

import { getSelectableModels } from '../src/utils/modelSelection.js'

const configs = [
  {
    id: 1,
    service_type: 'text',
    is_active: true,
    is_default: true,
    model: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    default_model: 'deepseek-v4-flash',
  },
  {
    id: 2,
    service_type: 'text',
    is_active: true,
    is_default: false,
    model: ['qwen-plus'],
    default_model: 'qwen-plus',
  },
]

test('uses default active config models when no config is selected', () => {
  assert.deepEqual(getSelectableModels(configs, 'text', null), [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ])
})

test('uses selected config models when config is selected', () => {
  assert.deepEqual(getSelectableModels(configs, 'text', 2), ['qwen-plus'])
  assert.deepEqual(getSelectableModels(configs, 'text', '2'), ['qwen-plus'])
})

test('does not fall back to another config when an explicit id is stale or crosses service type', () => {
  assert.deepEqual(getSelectableModels(configs, 'text', 'missing'), [])
  assert.deepEqual(getSelectableModels(configs, 'image', 1), [])
  assert.deepEqual(getSelectableModels([
    { ...configs[0], is_active: false },
  ], 'text', 1), [])
})
