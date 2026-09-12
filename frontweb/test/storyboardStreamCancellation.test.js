import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { storyboardsAPI } from '../src/api/storyboards.js'

const storyboardsSource = readFileSync(new URL('../src/api/storyboards.js', import.meta.url), 'utf8')
const universalSource = readFileSync(new URL('../src/composables/filmCreate/useFilmCreateUniversalSegment.js', import.meta.url), 'utf8')

test('全能片段流式请求把取消信号交给 fetch', async () => {
  assert.match(storyboardsSource, /generateUniversalSegmentPromptStream\(id, body, onDelta, options\)/)
  assert.match(storyboardsSource, /polishUniversalSegmentPromptStream\(id, body, onDelta, options\)/)
  assert.match(storyboardsSource, /signal/)
  assert.match(universalSource, /\{ signal: controller\.signal \}/)
  assert.match(universalSource, /controller\.abort\(\)/)

  const controller = new AbortController()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, signal: options?.signal })
    const error = new Error('The user aborted a request.')
    error.name = 'AbortError'
    throw error
  }
  try {
    await assert.rejects(
      () => storyboardsAPI.polishUniversalSegmentPromptStream(9, { draft_universal_segment_text: '草稿' }, () => {}, { signal: controller.signal }),
      (error) => {
        assert.equal(error.name, 'AbortError')
        assert.match(String(error.message), /操作已取消/)
        assert.doesNotMatch(String(error.message), /aborted a request/i)
        return true
      },
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].signal, controller.signal)
    assert.match(String(calls[0].url), /universal-segment-polish-stream/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
