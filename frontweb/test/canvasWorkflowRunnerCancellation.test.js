import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const srcRoot = new URL('../src/', import.meta.url).href
const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: ${JSON.stringify(srcRoot)} + specifier.slice(2) + '.js', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url)

const runner = await import('../src/composables/useCanvasWorkflowRunner.js')
const { taskAPI } = await import('../src/api/task.js')
const { imagesAPI } = await import('../src/api/images.js')
const { videosAPI } = await import('../src/api/videos.js')
const { aiAPI } = await import('../src/api/ai.js')
const { storyboardsAPI } = await import('../src/api/storyboards.js')
const { default: request } = await import('../src/utils/request.js')

const originalTaskGet = taskAPI.get
const originalRequestPost = request.post
const originalImagesCreate = imagesAPI.create
const originalVideosCreate = videosAPI.create
const originalAiList = aiAPI.list
const originalGetFramePrompts = storyboardsAPI.getFramePrompts
const originalGenerateFramePrompt = storyboardsAPI.generateFramePrompt

function abortError(error) {
  return error?.name === 'AbortError'
}

function dramaWithStoryboard(id = 11) {
  return {
    id: 7,
    metadata: {},
    episodes: [{ id: 3, storyboards: [{ id, storyboard_number: 1, dialogue: '台词' }] }],
  }
}

test.afterEach(() => {
  taskAPI.get = originalTaskGet
  request.post = originalRequestPost
  imagesAPI.create = originalImagesCreate
  videosAPI.create = originalVideosCreate
  aiAPI.list = originalAiList
  storyboardsAPI.getFramePrompts = originalGetFramePrompts
  storyboardsAPI.generateFramePrompt = originalGenerateFramePrompt
})

test('polling wait aborts immediately without querying the task endpoint', async () => {
  assert.equal(typeof runner.pollTaskSimple, 'function')
  let queryCount = 0
  taskAPI.get = async () => {
    queryCount += 1
    return { status: 'pending' }
  }
  const controller = new AbortController()
  const startedAt = Date.now()
  const pending = runner.pollTaskSimple('task-wait', {
    signal: controller.signal,
    interval: 60_000,
    deadlineMs: 120_000,
  })

  controller.abort()

  await assert.rejects(pending, abortError)
  assert.ok(Date.now() - startedAt < 500, 'abort should not wait for the 60 second timer')
  assert.equal(queryCount, 0)
})

test('each task query carries the caller signal and a timeout no greater than 15 seconds', async () => {
  assert.equal(typeof runner.pollTaskSimple, 'function')
  const controller = new AbortController()
  let receivedOptions
  taskAPI.get = async (_taskId, options) => {
    receivedOptions = options
    return { status: 'completed', result: { image_id: 9 } }
  }

  const result = await runner.pollTaskSimple('task-complete', {
    signal: controller.signal,
    interval: 0,
    deadlineMs: 60_000,
    requestTimeoutMs: 60_000,
  })

  assert.deepEqual(result, { status: 'completed', result: { image_id: 9 } })
  assert.strictEqual(receivedOptions.signal, controller.signal)
  assert.equal(receivedOptions.timeout, 15_000)
})

test('polling respects its total deadline even when attempts remain', async () => {
  assert.equal(typeof runner.pollTaskSimple, 'function')
  taskAPI.get = async () => ({ status: 'pending' })
  const startedAt = Date.now()

  const result = await runner.pollTaskSimple('task-deadline', {
    interval: 2,
    maxAttempts: 10_000,
    deadlineMs: 25,
    requestTimeoutMs: 10,
  })

  assert.equal(result.status, 'timeout')
  assert.match(result.error, /超时/)
  assert.ok(Date.now() - startedAt < 500)
})

for (const status of ['cancelled', 'canceled']) {
  test(`remote ${status} status rejects as cancellation`, async () => {
    assert.equal(typeof runner.pollTaskSimple, 'function')
    taskAPI.get = async () => ({ status, error: { message: '用户已取消任务' } })

    await assert.rejects(
      runner.pollTaskSimple(`task-${status}`, { interval: 0 }),
      (error) => error?.name === 'AbortError' && /用户已取消任务/.test(error.message),
    )
  })
}

test('an already-aborted workflow rejects instead of producing a failed summary', async () => {
  const controller = new AbortController()
  controller.abort()
  const callbacks = []

  await assert.rejects(
    runner.runWorkflowGroup(
      dramaWithStoryboard(),
      { id: 'group-a', storyboard_ids: [11], pipeline: ['audio'] },
      {
        signal: controller.signal,
        onStoryboardStart: () => callbacks.push('storyboard-start'),
        onStoryboardError: () => callbacks.push('storyboard-error'),
      },
    ),
    abortError,
  )
  assert.deepEqual(callbacks, [])
})

test('abort after an awaited step suppresses completion and error hooks', async () => {
  const controller = new AbortController()
  const callbacks = []
  let finishAudio
  request.post = () => new Promise((resolve) => {
    finishAudio = resolve
  })

  const pending = runner.runWorkflowGroup(
    dramaWithStoryboard(),
    { id: 'group-a', storyboard_ids: [11], pipeline: ['audio'] },
    {
      signal: controller.signal,
      onStepStart: () => callbacks.push('step-start'),
      onStepComplete: () => callbacks.push('step-complete'),
      onStepError: () => callbacks.push('step-error'),
      onStoryboardComplete: () => callbacks.push('storyboard-complete'),
      onStoryboardError: () => callbacks.push('storyboard-error'),
    },
  )

  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  finishAudio({ ok: true })

  const rejection = await pending.then(
    (summary) => ({ summary }),
    (error) => ({ error }),
  )
  assert.equal(rejection.error?.name, 'AbortError')
  assert.equal('summary' in rejection, false, 'abort must not resolve with summary.failed')
  assert.deepEqual(callbacks, ['step-start'])
})

test('workflow generation requests receive the run signal and task-appropriate bounded submission timeouts', async () => {
  const controller = new AbortController()
  const received = []
  const capture = (name) => async (_body, options) => {
    received.push({ name, options })
    return {}
  }
  imagesAPI.create = capture('image')
  videosAPI.create = capture('video')
  aiAPI.list = async (_type, options) => {
    received.push({ name: 'ai-list', options })
    return []
  }
  storyboardsAPI.getFramePrompts = async (_id, options) => {
    received.push({ name: 'frame-prompts', options })
    return { frame_prompts: [{ frame_type: 'first', prompt: '首帧提示词' }] }
  }
  request.post = async (_url, _body, options) => {
    received.push({ name: 'audio', options })
    return {}
  }
  const drama = dramaWithStoryboard()
  const storyboard = {
    ...drama.episodes[0].storyboards[0],
    image_prompt: '图片提示词',
    video_prompt: '视频提示词',
    creation_mode: 'universal',
  }
  drama.episodes[0].storyboards[0] = storyboard
  const generationOptions = { aspectRatio: '16:9', imagesBySbId: {} }

  await runner.runImageStep(drama, storyboard, generationOptions, { signal: controller.signal })
  await runner.runFrameImageStep(drama, storyboard, generationOptions, 'first', { signal: controller.signal })
  await runner.runVideoStep(drama, storyboard, generationOptions, { signal: controller.signal })
  await runner.runAudioStep(storyboard, { signal: controller.signal })

  assert.deepEqual(received.map((item) => item.name), [
    'image',
    'frame-prompts',
    'image',
    'ai-list',
    'video',
    'audio',
  ])
  for (const { name, options } of received) {
    assert.equal(options.signal, controller.signal)
    assert.equal(options.timeout, name === 'audio' ? 300_000 : 15_000)
  }
})

test('audio timeout is reported as an unknown billable outcome instead of a safe retry failure', async () => {
  request.post = async () => {
    const error = new Error('timeout of 300000ms exceeded')
    error.code = 'ECONNABORTED'
    throw error
  }

  await assert.rejects(
    runner.runAudioStep({ id: 11, dialogue: '台词' }),
    (error) => error?.code === 'SUBMISSION_OUTCOME_UNKNOWN'
      && /可能仍在合成并产生费用/.test(error.message)
      && /刷新/.test(error.message),
  )
})

test('unknown billable outcome aborts a workflow group instead of becoming a retryable failure summary', async () => {
  request.post = async () => {
    const error = new Error('timeout')
    error.code = 'ECONNABORTED'
    throw error
  }
  const callbacks = []

  await assert.rejects(
    runner.runWorkflowGroup(
      dramaWithStoryboard(),
      { id: 'group-a', storyboard_ids: [11], pipeline: ['audio'] },
      { onStoryboardError: () => callbacks.push('storyboard-error') },
    ),
    (error) => error?.code === 'SUBMISSION_OUTCOME_UNKNOWN' && error?.storyboardId === 11,
  )
  assert.deepEqual(callbacks, [])
})

test('workflow refresh receives the run signal and bounded timeout', async () => {
  const controller = new AbortController()
  let refreshOptions
  imagesAPI.create = async () => ({})
  const drama = dramaWithStoryboard()
  drama.episodes[0].storyboards[0].image_prompt = '图片提示词'

  await runner.runStoryboardPipeline(
    drama,
    11,
    ['image'],
    {
      signal: controller.signal,
      reloadStoryboard: async (_storyboardId, options) => {
        refreshOptions = options
        return dramaWithStoryboard().episodes[0].storyboards[0]
      },
    },
  )

  assert.equal(refreshOptions.signal, controller.signal)
  assert.equal(refreshOptions.timeout, 15_000)
})

test('frame prompt fallback warns before a billable image request without exposing provider details', async () => {
  const events = []
  storyboardsAPI.getFramePrompts = async () => {
    throw new Error('provider secret detail')
  }
  imagesAPI.create = async () => {
    events.push({ type: 'request' })
    return {}
  }
  const drama = dramaWithStoryboard()
  const storyboard = drama.episodes[0].storyboards[0]
  storyboard.image_prompt = '本地提示词'

  await runner.runFrameImageStep(
    drama,
    storyboard,
    { aspectRatio: '16:9', imagesBySbId: {} },
    'first',
    { onWarning: (warning) => events.push({ type: 'warning', warning }) },
  )

  assert.deepEqual(events.map((event) => event.type), ['warning', 'request'])
  assert.equal(events[0].warning.code, 'frame-prompt-fallback')
  assert.match(events[0].warning.message, /本地提示词/)
  assert.doesNotMatch(events[0].warning.message, /provider secret detail/)
})
