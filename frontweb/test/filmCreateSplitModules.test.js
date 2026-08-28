import test from 'node:test'
import assert from 'node:assert/strict'

import { requestCoreJson } from '../src/utils/coreJsonRequest.js'
import {
  buildEpisodeVideoFilename,
  fetchVerifiedVideoBlob,
  triggerBlobDownload,
} from '../src/utils/filmCreateDelivery.js'
import { runConcurrently } from '../src/utils/filmCreateConcurrency.js'
import {
  buildScriptStoryboardEstimate,
  clipSecondsForStoryboardEstimate,
  estimateVideoDurationSecFromCharLen,
} from '../src/utils/filmCreateEstimates.js'

test('core JSON request unwraps data, times out, and rejects HTTP failures', async () => {
  const calls = []
  const drama = await requestCoreJson('/dramas/7', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ success: true, data: { id: 7, title: '项目' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.deepEqual(drama, { id: 7, title: '项目' })
  assert.equal(calls[0].url, '/api/v1/dramas/7')
  assert.equal(calls[0].options.method, 'GET')
  assert.ok(calls[0].options.signal)

  await assert.rejects(
    requestCoreJson('/dramas/7', {
      timeoutMs: 20,
      fetchImpl: async (_url, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')))
      }),
    }),
    { message: 'PROJECT_LOAD_FAILED', status: 0 },
  )

  await assert.rejects(
    requestCoreJson('/dramas/7', {
      fetchImpl: async () => new Response('{"success":false}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    { status: 500 },
  )
})

test('verified video fetch rejects HTTP errors, empty bodies, JSON errors and timeout', async () => {
  const blob = await fetchVerifiedVideoBlob('/static/final.mp4', async (url, options) => {
    assert.equal(url, '/static/final.mp4')
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'same-origin')
    assert.match(options.headers.Accept, /video\/*/)
    assert.ok(options.signal)
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  })
  assert.equal(blob.size, 8)
  assert.equal(blob.type, 'video/mp4')

  await assert.rejects(
    fetchVerifiedVideoBlob('/static/missing.mp4', async () => new Response('', { status: 502 })),
    /HTTP 502/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/empty.mp4', async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })),
    /成片文件为空/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/error.mp4', async () => new Response('{"error":"failed"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    /服务器返回了错误信息/,
  )
  await assert.rejects(
    fetchVerifiedVideoBlob('/static/slow.mp4', async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')))
    }), { timeoutMs: 20 }),
    /成片下载超时/,
  )
})

test('video filename is filesystem-safe and Blob download always releases its object URL', () => {
  const blob = new Blob(['video'], { type: 'video/webm' })
  const filename = buildEpisodeVideoFilename('测试:<项目>/第一部*?', '2/3', blob)
  assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f]/)
  assert.match(filename, /^测试__项目__第一部__-第2_3集-成片\.webm$/)

  const events = []
  const anchor = {
    style: {},
    click() { events.push('click') },
    remove() { events.push('remove') },
  }
  const environment = {
    document: {
      createElement(tag) {
        assert.equal(tag, 'a')
        return anchor
      },
      body: { appendChild(node) { assert.equal(node, anchor); events.push('append') } },
    },
    URL: {
      createObjectURL(value) { assert.equal(value, blob); events.push('create'); return 'blob:video' },
      revokeObjectURL(value) { assert.equal(value, 'blob:video'); events.push('revoke') },
    },
  }

  triggerBlobDownload(blob, filename, environment)
  assert.equal(anchor.href, 'blob:video')
  assert.equal(anchor.download, filename)
  assert.equal(anchor.rel, 'noopener')
  assert.deepEqual(events, ['create', 'append', 'click', 'remove', 'revoke'])
})

test('script estimate and concurrent runner keep pipeline semantics', async () => {
  assert.equal(clipSecondsForStoryboardEstimate(8), 8)
  assert.equal(estimateVideoDurationSecFromCharLen(600), 70)
  const estimate = buildScriptStoryboardEstimate('字'.repeat(600), 5)
  assert.equal(estimate.sec, 70)
  assert.equal(estimate.locked, 14)

  const seen = []
  const active = new Set()
  await runConcurrently(['a', 'b', 'c'], 2, async (item) => {
    seen.push(item)
    assert.ok(active.has(item))
  }, { getLabel: (item) => item, activeTasks: active })
  assert.deepEqual(seen.sort(), ['a', 'b', 'c'])
  assert.equal(active.size, 0)
})
