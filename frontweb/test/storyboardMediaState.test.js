import test from 'node:test'
import assert from 'node:assert/strict'

import * as storyboardMedia from '../src/utils/storyboardMedia.js'

const episodeA = { projectId: 7, episodeId: 71 }
const episodeB = { projectId: 7, episodeId: 72 }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createController() {
  assert.equal(
    typeof storyboardMedia.createStoryboardMediaStateController,
    'function',
    'storyboard media state controller must be implemented',
  )
  return storyboardMedia.createStoryboardMediaStateController()
}

function requestFor(requests, storyboardId, endpoint) {
  const request = requests.find((item) => (
    item.storyboardId === storyboardId && item.endpoint === endpoint
  ))
  assert.ok(request, `missing ${endpoint} request for storyboard ${storyboardId}`)
  return request
}

function primeReady(controller, context = episodeA, storyboardId = 101) {
  controller.setContext(context)
  const requests = controller.beginFull([storyboardId])
  controller.commitSuccess(requestFor(requests, storyboardId, 'images'), [{ id: 'image-old' }])
  controller.commitSuccess(requestFor(requests, storyboardId, 'videos'), [{ id: 'video-old' }])
  assert.equal(controller.getSnapshot().status, 'ready')
}

function beginSingleForContext(controller, storyboardId, expectedContext = episodeA, storyboardIds = [storyboardId]) {
  return controller.beginSingle(storyboardId, { expectedContext, storyboardIds })
}

async function settle(controller, request, promise) {
  try {
    return controller.commitSuccess(request, await promise)
  } catch (error) {
    return controller.commitFailure(request, error)
  }
}

test('an old episode response cannot commit media or state into the new episode', async () => {
  const controller = createController()
  controller.setContext(episodeA)
  const oldRequests = controller.beginFull([101])
  const oldImages = deferred()
  const oldRun = settle(
    controller,
    requestFor(oldRequests, 101, 'images'),
    oldImages.promise,
  )

  controller.setContext(episodeB)
  const newRequests = controller.beginFull([202])
  controller.commitSuccess(requestFor(newRequests, 202, 'images'), [{ id: 'image-new' }])
  controller.commitSuccess(requestFor(newRequests, 202, 'videos'), [{ id: 'video-new' }])

  oldImages.resolve([{ id: 'image-stale' }])
  assert.equal(await oldRun, false)
  assert.deepEqual(controller.getSnapshot(), {
    context: episodeB,
    status: 'ready',
    initialized: true,
    media: {
      images: { 202: [{ id: 'image-new' }] },
      videos: { 202: [{ id: 'video-new' }] },
    },
    pendingEndpoints: [],
    failedEndpoints: [],
  })
})

test('single refresh keeps the cached endpoint when its peer request fails', async () => {
  const controller = createController()
  primeReady(controller)
  const requests = beginSingleForContext(controller, 101)
  const images = deferred()
  const videos = deferred()
  const runs = [
    settle(controller, requestFor(requests, 101, 'images'), images.promise),
    settle(controller, requestFor(requests, 101, 'videos'), videos.promise),
  ]

  images.resolve([{ id: 'image-new' }])
  videos.reject(new Error('video list failed'))
  await Promise.all(runs)

  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'error')
  assert.deepEqual(snapshot.media.images[101], [{ id: 'image-new' }])
  assert.deepEqual(snapshot.media.videos[101], [{ id: 'video-old' }])
  assert.deepEqual(snapshot.pendingEndpoints, [])
  assert.deepEqual(snapshot.failedEndpoints, [{ storyboardId: 101, endpoint: 'videos' }])
})

test('a successful endpoint retry clears only that failure and ready waits for every endpoint', () => {
  const controller = createController()
  primeReady(controller)
  const failedRequests = beginSingleForContext(controller, 101)
  controller.commitFailure(requestFor(failedRequests, 101, 'images'), new Error('image failed'))
  controller.commitFailure(requestFor(failedRequests, 101, 'videos'), new Error('video failed'))

  const retryRequests = beginSingleForContext(controller, 101)
  controller.commitSuccess(requestFor(retryRequests, 101, 'images'), [{ id: 'image-retry' }])

  let snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'loading')
  assert.deepEqual(snapshot.failedEndpoints, [{ storyboardId: 101, endpoint: 'videos' }])
  assert.deepEqual(snapshot.pendingEndpoints, [{ storyboardId: 101, endpoint: 'videos' }])

  controller.commitSuccess(requestFor(retryRequests, 101, 'videos'), [{ id: 'video-retry' }])
  snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.deepEqual(snapshot.failedEndpoints, [])
  assert.deepEqual(snapshot.pendingEndpoints, [])
})

test('pending, failed, and unknown media states all block a Provider write', () => {
  const controller = createController()
  controller.setContext(episodeA)
  let providerWrites = 0
  const submit = () => {
    controller.assertReady(episodeA)
    providerWrites += 1
  }

  assert.throws(submit, (error) => {
    assert.equal(storyboardMedia.isStoryboardMediaStateError(error), true)
    assert.match(error.message, /尚未就绪/)
    return true
  })

  const requests = controller.beginFull([101])
  assert.throws(submit, /正在读取/)
  controller.commitSuccess(requestFor(requests, 101, 'images'), [])
  controller.commitFailure(requestFor(requests, 101, 'videos'), new Error('video failed'))
  assert.throws(submit, /读取失败/)
  assert.equal(providerWrites, 0)
})

test('a media failure after confirmation and prompt work prevents the Provider write', async () => {
  const controller = createController()
  primeReady(controller)
  const confirmation = deferred()
  let providerWrites = 0

  const submission = (async () => {
    controller.assertReady(episodeA)
    await confirmation.promise
    await Promise.resolve('prepared prompt')
    controller.assertReady(episodeA)
    providerWrites += 1
  })()

  const refreshRequests = beginSingleForContext(controller, 101)
  controller.commitFailure(
    requestFor(refreshRequests, 101, 'images'),
    new Error('late image list failure'),
  )
  controller.commitSuccess(
    requestFor(refreshRequests, 101, 'videos'),
    [{ id: 'video-old' }],
  )
  confirmation.resolve(true)

  await assert.rejects(submission, (error) => (
    storyboardMedia.isStoryboardMediaStateError(error) && /读取失败/.test(error.message)
  ))
  assert.equal(providerWrites, 0)
})

test('linked-resource regeneration cannot submit while media is unknown', () => {
  const controller = createController()
  controller.setContext(episodeA)
  let providerWrites = 0

  assert.throws(() => {
    controller.assertReady(episodeA)
    providerWrites += 1
  }, (error) => storyboardMedia.isStoryboardMediaStateError(error))

  assert.equal(providerWrites, 0)
})

test('a text-only flow is not blocked while storyboard media is unknown', async () => {
  const controller = createController()
  controller.setContext(episodeA)
  let textWrites = 0

  const runTextOnly = async () => {
    controller.assertReady(episodeA, { required: false })
    await Promise.resolve('prepared text prompt')
    textWrites += 1
  }

  await runTextOnly()
  assert.equal(textWrites, 1)
  assert.equal(controller.getSnapshot().status, 'unknown')
})

test('a full refresh replaces tracked storyboards and invalidates older single requests', () => {
  const controller = createController()
  controller.setContext(episodeA)
  const initial = controller.beginFull([101, 102])
  for (const request of initial) controller.commitSuccess(request, [{ id: `${request.endpoint}-${request.storyboardId}` }])

  const oldSingle = beginSingleForContext(controller, 101, episodeA, [101, 102])
  const replacement = controller.beginFull([102])
  const duringRefresh = controller.getSnapshot()
  assert.deepEqual(Object.keys(duringRefresh.media.images), ['102'])
  assert.deepEqual(Object.keys(duringRefresh.media.videos), ['102'])
  assert.equal(
    controller.commitSuccess(requestFor(oldSingle, 101, 'images'), [{ id: 'stale' }]),
    false,
  )
  for (const request of replacement) controller.commitSuccess(request, [])
  assert.equal(controller.getSnapshot().status, 'ready')
})

test('an old episode callback cannot begin a single refresh or mutate media state', () => {
  const changes = []
  const controller = storyboardMedia.createStoryboardMediaStateController({
    onChange: (snapshot) => changes.push(snapshot),
  })
  primeReady(controller, episodeA, 101)
  controller.setContext(episodeB)
  const before = controller.getSnapshot()
  const changesBefore = changes.length

  const requests = controller.beginSingle(101, {
    expectedContext: episodeA,
    storyboardIds: [101],
  })

  assert.deepEqual(requests, [])
  assert.deepEqual(controller.getSnapshot(), before)
  assert.equal(changes.length, changesBefore)
})

test('a single refresh rejects a storyboard outside the current episode without loading state', () => {
  const controller = createController()
  primeReady(controller, episodeA, 101)
  const before = controller.getSnapshot()

  const requests = controller.beginSingle(202, {
    expectedContext: episodeA,
    storyboardIds: [101],
  })

  assert.deepEqual(requests, [])
  assert.deepEqual(controller.getSnapshot(), before)
})
