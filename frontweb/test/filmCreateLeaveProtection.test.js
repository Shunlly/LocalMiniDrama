import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'

import { hasActiveMediaGenerationWork } from '../src/composables/filmCreate/useFilmCreateBatchGeneration.js'
import { useFilmCreateNavigationGuards } from '../src/composables/filmCreate/useFilmCreateNavigationGuards.js'
import { useGenerationTaskStore } from '../src/stores/generationTaskStore.js'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
  'utf8',
).replace(/\r\n?/g, '\n')

function refOf(value) {
  return { value }
}

function stubElementPlusFeedback() {
  const messages = []
  const originals = {
    warning: ElMessage.warning,
    error: ElMessage.error,
    success: ElMessage.success,
    info: ElMessage.info,
    confirm: ElMessageBox.confirm,
  }
  const record = (type) => (message, title, options) => {
    messages.push({ type, message, title, options })
    return { close() {} }
  }
  ElMessage.warning = record('warning')
  ElMessage.error = record('error')
  ElMessage.success = record('success')
  ElMessage.info = record('info')
  let confirmImpl = async () => {}
  ElMessageBox.confirm = async (message, title, options) => {
    messages.push({ type: 'confirm', message, title, options })
    return confirmImpl(message, title, options)
  }
  return {
    messages,
    setConfirm(next) {
      confirmImpl = next
    },
    last(type) {
      return messages.filter((item) => item.type === type).at(-1)
    },
    restore() {
      ElMessage.warning = originals.warning
      ElMessage.error = originals.error
      ElMessage.success = originals.success
      ElMessage.info = originals.info
      ElMessageBox.confirm = originals.confirm
    },
  }
}

function createGuards(overrides = {}) {
  const cancelCalls = []
  const guards = useFilmCreateNavigationGuards({
    pipelineStarting: refOf(false),
    pipelineRunning: refOf(false),
    pipelineStopping: refOf(false),
    activePipelineRunPromise: refOf(null),
    pipelineOwnedTaskIds: new Set(),
    showAiConfigDialog: refOf(false),
    aiConfigContentRef: refOf(null),
    scriptDraftController: {
      hasPendingChanges: () => false,
      markSaved() {},
    },
    flushScriptDraft: async () => {},
    cancelPipelineRun: async () => {
      cancelCalls.push('cancel')
      return true
    },
    ...overrides,
  })
  return { guards, cancelCalls }
}

function unloadEvent() {
  let prevented = false
  const event = {
    preventDefault() { prevented = true },
    returnValue: 'preset',
    wasPrevented() { return prevented },
  }
  return event
}

test('批量/单条生图生视频才算媒体生成，普通编辑和空集合不算', () => {
  assert.equal(hasActiveMediaGenerationWork(), false)
  assert.equal(hasActiveMediaGenerationWork({
    batchImageRunning: refOf(false),
    batchVideoRunning: refOf(false),
    generatingSbImageIds: new Set(),
    generatingSbVideoIds: new Set(),
  }), false)
  assert.equal(hasActiveMediaGenerationWork({ batchImageRunning: refOf(true) }), true)
  assert.equal(hasActiveMediaGenerationWork({ batchImageStopping: refOf(true) }), true)
  assert.equal(hasActiveMediaGenerationWork({ batchVideoRunning: refOf(true) }), true)
  assert.equal(hasActiveMediaGenerationWork({ batchVideoStopping: refOf(true) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSbImageIds: new Set([11]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSbVideoIds: new Set([22]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSbFirstImageIds: new Set([33]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSbLastImageIds: new Set([44]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingUniversalSegmentIds: new Set([1]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ ttsSbIds: new Set([2]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ ttsSbNarrationIds: new Set([5]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ upscalingSbIds: new Set([3]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingCharIds: new Set([9]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingSceneIds: new Set([8]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingPropIds: new Set([7]) }), true)
  assert.equal(hasActiveMediaGenerationWork({ generatingPanoramaIds: new Set([6]) }), true)
  assert.equal(hasActiveMediaGenerationWork({
    runningGenerationTasks: [{ status: 'running', resourceType: 'char_image' }],
  }), true)
})

test('制作页把批量停止和单条生视频接到离开保护', () => {
  const call = filmCreateSource.match(/useFilmCreateNavigationGuards\(\{[\s\S]*?\}\)/)?.[0] || ''
  assert.match(call, /batchImageRunning/)
  assert.match(call, /batchImageStopping/)
  assert.match(call, /batchVideoRunning/)
  assert.match(call, /batchVideoStopping/)
  assert.match(call, /generatingSbImageIds/)
  assert.match(call, /generatingSbVideoIds/)
  assert.match(call, /generatingSbFirstImageIds/)
  assert.match(call, /generatingSbLastImageIds/)
  assert.match(call, /ttsSbIds/)
  assert.match(call, /ttsSbNarrationIds/)
  assert.match(call, /upscalingSbIds/)
  assert.match(call, /generatingUniversalSegmentIds/)
  assert.match(call, /generatingCharIds/)
  assert.match(call, /generatingSceneIds/)
  assert.match(call, /generatingPropIds/)
  assert.match(call, /generatingPanoramaIds/)
  assert.match(call, /getRunningGenerationTasks/)
  assert.match(filmCreateSource, /onBeforeRouteLeave\(allowNavigationAfterDraftFlush\)/)
  assert.match(filmCreateSource, /handleBeforeUnload/)
  const guardsSource = readFileSync(
    new URL('../src/composables/filmCreate/useFilmCreateNavigationGuards.js', import.meta.url),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  assert.match(guardsSource, /getAllRunningTasks/)
})

test('普通编辑不拦截关页，媒体生成才弹出中文计费确认', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    const idle = createGuards()
    const idleEvent = unloadEvent()
    idle.guards.handleBeforeUnload(idleEvent)
    assert.equal(idle.guards.hasActivePipelineWork(), false)
    assert.equal(idle.guards.hasActiveMediaWork(), false)
    assert.equal(idleEvent.wasPrevented(), false)
    assert.equal(idleEvent.returnValue, 'preset')
    assert.equal(await idle.guards.confirmMediaGenerationNavigation(), true)
    assert.equal(feedback.last('confirm'), undefined)

    const editing = createGuards({
      scriptDraftController: {
        hasPendingChanges: () => true,
        markSaved() {},
      },
    })
    const editingEvent = unloadEvent()
    editing.guards.handleBeforeUnload(editingEvent)
    assert.equal(editing.guards.hasActiveMediaWork(), false)
    assert.equal(editingEvent.wasPrevented(), true)
    assert.equal(await editing.guards.confirmMediaGenerationNavigation(), true)
    assert.equal(feedback.last('confirm'), undefined)
  } finally {
    feedback.restore()
  }
})

test('单条生图和生视频离开要确认，任务可能继续计费', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    for (const deps of [
      { generatingSbImageIds: new Set([101]) },
      { generatingSbVideoIds: new Set([202]) },
      { generatingSbFirstImageIds: new Set([303]) },
      { generatingSbLastImageIds: new Set([404]) },
      { ttsSbIds: new Set([505]) },
      { ttsSbNarrationIds: new Set([606]) },
      { upscalingSbIds: new Set([707]) },
    ]) {
      const { guards, cancelCalls } = createGuards(deps)
      const event = unloadEvent()
      guards.handleBeforeUnload(event)
      assert.equal(guards.hasActivePipelineWork(), false)
      assert.equal(guards.hasActiveMediaWork(), true)
      assert.equal(event.wasPrevented(), true)

      feedback.setConfirm(async () => { throw 'cancel' })
      assert.equal(await guards.allowNavigationAfterDraftFlush(), false)
      assert.equal(feedback.last('confirm').title, '媒体生成仍在执行')
      assert.match(feedback.last('confirm').message, /计费可能继续/)
      assert.match(feedback.last('confirm').message, /[\u4e00-\u9fff]/)
      assert.doesNotMatch(feedback.last('confirm').message, /please|billing|provider/i)
      assert.deepEqual(cancelCalls, [])

      feedback.setConfirm(async () => {})
      assert.equal(await guards.allowNavigationAfterDraftFlush(), true)
      assert.deepEqual(cancelCalls, [])
    }
  } finally {
    feedback.restore()
  }
})

test('批量生图生视频和停止中离开同样要确认，且不误停全流程', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    for (const deps of [
      { batchImageRunning: refOf(true) },
      { batchImageStopping: refOf(true) },
      { batchVideoRunning: refOf(true) },
      { batchVideoStopping: refOf(true) },
    ]) {
      const { guards, cancelCalls } = createGuards(deps)
      const event = unloadEvent()
      guards.handleBeforeUnload(event)
      assert.equal(guards.hasActiveMediaWork(), true)
      assert.equal(event.wasPrevented(), true)
      feedback.setConfirm(async () => {})
      assert.equal(await guards.allowNavigationAfterDraftFlush(), true)
      assert.equal(feedback.last('confirm').title, '媒体生成仍在执行')
      assert.match(feedback.last('confirm').message, /计费可能继续/)
      assert.deepEqual(cancelCalls, [])
    }

    const pipeline = createGuards({
      pipelineRunning: refOf(true),
      generatingSbVideoIds: new Set([202]),
    })
    feedback.setConfirm(async () => {})
    assert.equal(await pipeline.guards.allowNavigationAfterDraftFlush(), true)
    assert.equal(feedback.last('confirm').title, '全流程仍在执行')
    assert.deepEqual(pipeline.cancelCalls, ['cancel'])
  } finally {
    feedback.restore()
  }
})

test('角色图和任务中心进行中任务离开也要确认', async () => {
  const feedback = stubElementPlusFeedback()
  try {
    for (const deps of [
      { generatingCharIds: new Set([101]) },
      { generatingSceneIds: new Set([202]) },
      { generatingPropIds: new Set([303]) },
      { generatingPanoramaIds: new Set([404]) },
      { generationTaskStore: { getAllRunningTasks: () => [{ status: 'running', resourceType: 'episode_merge' }] } },
    ]) {
      const { guards, cancelCalls } = createGuards(deps)
      const event = unloadEvent()
      guards.handleBeforeUnload(event)
      assert.equal(guards.hasActivePipelineWork(), false)
      assert.equal(guards.hasActiveMediaWork(), true)
      assert.equal(event.wasPrevented(), true)
      feedback.setConfirm(async () => { throw 'cancel' })
      assert.equal(await guards.allowNavigationAfterDraftFlush(), false)
      assert.equal(feedback.last('confirm').title, '媒体生成仍在执行')
      assert.match(feedback.last('confirm').message, /计费可能继续/)
      assert.match(feedback.last('confirm').message, /[\u4e00-\u9fff]/)
      assert.doesNotMatch(feedback.last('confirm').message, /please|billing|provider/i)
      assert.deepEqual(cancelCalls, [])
    }
  } finally {
    feedback.restore()
  }
})

test('任务中心 getAllRunningTasks 非空时离开要确认并提示计费可能继续', async () => {
  setActivePinia(createPinia())
  const store = useGenerationTaskStore()
  store.markRunning({
    dramaId: 11,
    episodeId: 22,
    resourceType: 'episode_merge',
    resourceId: 22,
    taskId: 'merge-running-1',
  })
  assert.ok(store.getAllRunningTasks().length > 0)

  const feedback = stubElementPlusFeedback()
  try {
    const wired = createGuards({
      getRunningGenerationTasks: () => store.getAllRunningTasks(),
    })
    const fallback = createGuards()
    for (const current of [wired, fallback]) {
      const event = unloadEvent()
      current.guards.handleBeforeUnload(event)
      assert.equal(current.guards.hasActivePipelineWork(), false)
      assert.equal(current.guards.hasActiveMediaWork(), true)
      assert.equal(event.wasPrevented(), true)

      feedback.setConfirm(async () => { throw 'cancel' })
      assert.equal(await current.guards.allowNavigationAfterDraftFlush(), false)
      assert.equal(feedback.last('confirm').title, '媒体生成仍在执行')
      assert.match(feedback.last('confirm').message, /计费可能继续/)
      assert.match(feedback.last('confirm').message, /[一-鿿]/)
      assert.doesNotMatch(feedback.last('confirm').message, /please|billing|provider/i)
      assert.deepEqual(current.cancelCalls, [])
    }

    feedback.setConfirm(async () => {})
    assert.equal(await wired.guards.allowNavigationAfterDraftFlush(), true)
    assert.deepEqual(wired.cancelCalls, [])
  } finally {
    feedback.restore()
  }
})
