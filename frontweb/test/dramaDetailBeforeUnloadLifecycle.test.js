import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

function registerLifecycle(environment) {
  const lifecycleStart = source.indexOf('onMounted(async () => {')
  assert.ok(lifecycleStart >= 0, 'missing DramaDetail mounted lifecycle')
  const stateStart = source.lastIndexOf('let dramaDetailUnmounted = false', lifecycleStart)
  const lifecycle = sourceBetween(
    stateStart >= 0 ? 'let dramaDetailUnmounted = false' : 'onMounted(async () => {',
    '</script>',
  )
  const statePreamble = stateStart >= 0 ? '' : 'let dramaDetailUnmounted = false\n'
  let mounted
  let beforeUnmount
  new Function(
    'onMounted',
    'onBeforeUnmount',
    'retryDramaLoad',
    'window',
    'handleInfoBeforeUnload',
    'isDramaReady',
    'route',
    'setTimeout',
    'episodeBatchImportDialogRef',
    'projectLifecycle',
    'clearInfoSaveTimer',
    `${statePreamble}${lifecycle}`,
  )(
    (callback) => { mounted = callback },
    (callback) => { beforeUnmount = callback },
    environment.retryDramaLoad,
    environment.window,
    environment.handleInfoBeforeUnload,
    environment.isDramaReady,
    environment.route,
    environment.setTimeout,
    environment.episodeBatchImportDialogRef,
    environment.projectLifecycle,
    environment.clearInfoSaveTimer,
  )
  assert.equal(typeof mounted, 'function')
  assert.equal(typeof beforeUnmount, 'function')
  return { mounted, beforeUnmount }
}

function createDeferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createEnvironment(overrides = {}) {
  const events = []
  const listeners = new Set()
  const timers = []
  return {
    events,
    listeners,
    timers,
    retryDramaLoad: async () => {},
    window: {
      addEventListener(type, listener) {
        assert.equal(type, 'beforeunload')
        events.push('add')
        listeners.add(listener)
      },
      removeEventListener(type, listener) {
        assert.equal(type, 'beforeunload')
        events.push('remove')
        listeners.delete(listener)
      },
    },
    handleInfoBeforeUnload() {},
    isDramaReady: { value: false },
    route: { query: {} },
    setTimeout(callback) {
      timers.push(callback)
      return timers.length
    },
    episodeBatchImportDialogRef: { value: null },
    projectLifecycle: { dispose() {} },
    clearInfoSaveTimer() {},
    ...overrides,
  }
}

test('DramaDetail does not register beforeunload after unmount during its initial load', async () => {
  const load = createDeferred()
  const environment = createEnvironment({ retryDramaLoad: () => load.promise })
  const { mounted, beforeUnmount } = registerLifecycle(environment)

  const mounting = mounted()
  await Promise.resolve()
  beforeUnmount()
  load.resolve()
  await mounting

  assert.deepEqual(environment.events, ['remove'])
  assert.equal(environment.listeners.size, 0)
})

test('DramaDetail skips the delayed batch-import action after unmount', async () => {
  let openCalls = 0
  const environment = createEnvironment({
    isDramaReady: { value: true },
    route: { query: { importBatch: '1' } },
    episodeBatchImportDialogRef: { value: { openDialog: () => { openCalls += 1 } } },
  })
  const { mounted, beforeUnmount } = registerLifecycle(environment)

  await mounted()
  assert.equal(environment.timers.length, 1)
  beforeUnmount()
  environment.timers[0]()

  assert.equal(openCalls, 0)
})
