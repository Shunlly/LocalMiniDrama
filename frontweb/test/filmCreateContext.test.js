import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { formatEpisodeContextLabel } from '../src/utils/filmCreateContext.js'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
  'utf8',
)

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

test('episode context selector keeps the desktop interaction height', () => {
  const selectStart = filmCreateSource.indexOf('class="header-episode-select"')
  const selectEnd = filmCreateSource.indexOf('</el-select>', selectStart)
  const episodeSelectSource = filmCreateSource.slice(selectStart, selectEnd)

  assert.ok(selectStart >= 0)
  assert.doesNotMatch(episodeSelectSource, /\bsize="small"/)
})

test('desktop production header groups commands into a non-overlapping actions workspace', () => {
  assert.match(filmCreateSource, /class="workspace-actions"/)
  assert.match(filmCreateSource, /@media \(min-width: 769px\) and \(max-width: 1400px\) \{[\s\S]*?\.header-inner\s*\{[\s\S]*?grid-template-columns:/)
  assert.match(filmCreateSource, /\.workspace-actions\s*\{[\s\S]*?min-height:\s*32px;/)
  assert.match(filmCreateSource, /@media \(min-width: 769px\) and \(max-width: 1400px\) \{[\s\S]*?\.workspace-actions\s*\{[\s\S]*?grid-column:/)
})
