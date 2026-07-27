import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createProjectInstanceLifecycle,
  isProjectInstanceDisposedError,
} from '../src/utils/projectInstanceLifecycle.js'
import request from '../src/utils/request.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const appSource = read('../src/App.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const sourcePanelSource = read('../src/components/SourceIntakeWorkflowPanel.vue')

test('App keys project workspaces by the normalized project route instance', () => {
  assert.match(appSource, /<router-view\s+v-slot="\{ Component, route: matchedRoute \}">/)
  assert.match(appSource, /<component\s+:is="Component"\s+:key="projectRouteInstanceKey\(matchedRoute\)"/)
  assert.match(appSource, /import \{ projectRouteInstanceKey \} from '@\/utils\/projectListRoute\.js'/)
})

test('same-route project changes run both unsaved guards before the keyed remount', () => {
  assert.match(dramaDetailSource, /onBeforeRouteUpdate\(\(to, from\) => \{[\s\S]*projectRouteInstanceKey\(to\)[\s\S]*projectRouteInstanceKey\(from\)[\s\S]*confirmInfoLeave\(\)/)
  assert.match(sourcePanelSource, /onBeforeRouteUpdate\(\(to, from\) => \{[\s\S]*projectRouteInstanceKey\(to\)[\s\S]*projectRouteInstanceKey\(from\)[\s\S]*confirmSourceInputLeave\(\)/)
})

test('source workflow teardown stops polling and invalidates controller work', () => {
  assert.match(
    sourcePanelSource,
    /onBeforeUnmount\(\(\) => \{[\s\S]*stopPoll\(\)[\s\S]*sourceImportController\.reset\(\)/,
  )
})

test('disposed project instances suppress deferred mutation feedback and follow-up requests', async () => {
  const lifecycle = createProjectInstanceLifecycle()
  let resolveMutation
  const mutation = new Promise((resolve) => { resolveMutation = resolve })
  const events = []
  const pending = (async () => {
    try {
      await lifecycle.execute(() => mutation)
      lifecycle.run(() => events.push('project-a-message'))
      await lifecycle.execute(async () => { events.push('project-a-follow-up') })
    } catch (error) {
      if (!isProjectInstanceDisposedError(error)) throw error
    }
  })()

  lifecycle.dispose()
  resolveMutation({ success: true })
  await pending

  assert.deepEqual(events, [])
  let invoked = false
  await assert.rejects(
    lifecycle.execute(async () => { invoked = true }),
    (error) => isProjectInstanceDisposedError(error),
  )
  assert.equal(invoked, false)
})

test('disposing a project instance closes every message handle it created', () => {
  const lifecycle = createProjectInstanceLifecycle()
  const closed = []
  const notifier = lifecycle.guardNotifier({
    success(label) {
      return { close: () => closed.push(label) }
    },
  })

  notifier.success('project-a-first')
  notifier.success('project-a-second')
  lifecycle.dispose()
  lifecycle.dispose()

  assert.deepEqual(closed, ['project-a-first', 'project-a-second'])
})

test('project disposal continues closing message handles after one close fails', () => {
  const lifecycle = createProjectInstanceLifecycle()
  const closed = []
  const notifier = lifecycle.guardNotifier({
    success(handle) {
      return handle
    },
  })

  notifier.success({ close: () => { throw new Error('close failed') } })
  notifier.success({ close: () => closed.push('second-message') })

  assert.doesNotThrow(() => lifecycle.dispose())
  assert.deepEqual(closed, ['second-message'])
})

test('project-owned API requests suppress the shared transport error toast at dispatch', async () => {
  const lifecycle = createProjectInstanceLifecycle()
  const api = lifecycle.guardApi({
    inspectRequest() {
      return request.get('/project-request-scope-probe', {
        adapter: async (config) => ({
          config,
          data: { success: true, data: config.suppressErrorToast === true },
          headers: {},
          status: 200,
          statusText: 'OK',
        }),
      })
    },
  })

  assert.equal(await api.inspectRequest(), true)
  lifecycle.dispose()
})

test('DramaDetail routes episode mutation continuations through the project lifecycle', () => {
  assert.match(dramaDetailSource, /createProjectInstanceLifecycle/)
  assert.match(
    dramaDetailSource,
    /async function onAddEpisode[\s\S]*projectLifecycle\.execute\(\(\) => dramaAPI\.saveEpisodes[\s\S]*ElMessage\.success[\s\S]*projectLifecycle\.execute\(\(\) => loadDrama\(\)\)/,
  )
  assert.match(dramaDetailSource, /onBeforeUnmount\(\(\) => \{[\s\S]*projectLifecycle\.dispose\(\)/)
})
