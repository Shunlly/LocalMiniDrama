import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// 与 npm test 共用 srcAliasLoader，避免把 @/foo.js 解析成 foo.js.js。
register(new URL('./srcAliasLoader.js', import.meta.url))

const { default: request } = await import('../src/utils/request.js')
const { imagesAPI } = await import('../src/api/images.js')
const { videosAPI } = await import('../src/api/videos.js')
const { aiAPI } = await import('../src/api/ai.js')
const { storyboardsAPI } = await import('../src/api/storyboards.js')
const { dramaAPI } = await import('../src/api/drama.js')
const { assetsAPI } = await import('../src/api/assets.js')

const originalGet = request.get
const originalPost = request.post

test.afterEach(() => {
  request.get = originalGet
  request.post = originalPost
})

test('workflow APIs forward cancellation and timeout options to request boundaries', async () => {
  const controller = new AbortController()
  const options = { signal: controller.signal, timeout: 15_000 }
  const calls = []
  request.get = async (...args) => { calls.push(['get', ...args]); return [] }
  request.post = async (...args) => { calls.push(['post', ...args]); return {} }

  await imagesAPI.create({ prompt: 'image' }, options)
  await imagesAPI.list({ storyboard_id: 9 }, options)
  await videosAPI.create({ prompt: 'video' }, options)
  await videosAPI.list({ storyboard_id: 9 }, options)
  await aiAPI.list('video', options)
  await storyboardsAPI.getFramePrompts(9, options)
  await storyboardsAPI.generateFramePrompt(9, { frame_type: 'first' }, options)
  await dramaAPI.get(7, options)
  await assetsAPI.list({ drama_id: 7 }, options)

  assert.deepEqual(calls, [
    ['post', '/images', { prompt: 'image' }, options],
    ['get', '/images', { ...options, params: { storyboard_id: 9 } }],
    ['post', '/videos', { prompt: 'video' }, options],
    ['get', '/videos', { ...options, params: { storyboard_id: 9 } }],
    ['get', '/ai-configs', { ...options, params: { service_type: 'video' } }],
    ['get', '/storyboards/9/frame-prompts', options],
    ['post', '/storyboards/9/frame-prompt', { frame_type: 'first' }, options],
    ['get', '/dramas/7', options],
    ['get', '/assets', { ...options, params: { drama_id: 7 } }],
  ])
})
