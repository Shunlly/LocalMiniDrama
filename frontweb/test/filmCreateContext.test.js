import test from 'node:test'
import assert from 'node:assert/strict'

import { formatEpisodeContextLabel } from '../src/utils/filmCreateContext.js'

test('episode context always identifies the episode number before its title', () => {
  assert.equal(
    formatEpisodeContextLabel({ episode_number: 2, title: '雨夜来电' }),
    '第 2 集 · 雨夜来电',
  )
  assert.equal(formatEpisodeContextLabel({ episode_number: 3, title: '' }), '第 3 集')
  assert.equal(formatEpisodeContextLabel({ title: '尾声' }, 4), '第 5 集 · 尾声')
})

test('episode context does not duplicate a default episode title', () => {
  assert.equal(
    formatEpisodeContextLabel({ episode_number: 1, title: '第1集' }),
    '第 1 集',
  )
  assert.equal(
    formatEpisodeContextLabel({ episode_number: 1, title: '第 1 集' }),
    '第 1 集',
  )
})
