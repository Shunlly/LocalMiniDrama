import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileTemplate, parse } from '@vue/compiler-sfc'
import { VueFlow } from '@vue-flow/core'
import { ref } from 'vue'

import { useCanvasWorkflowOrder } from '../src/composables/useCanvasWorkflowOrder.js'
import { reorderWorkflowGroupStoryboards } from '../src/utils/canvasWorkflow.js'

const sidebarUrl = new URL('../src/components/dramaCanvas/CanvasWorkflowSidebarList.vue', import.meta.url)
const canvasUrl = new URL('../src/views/DramaCanvas.vue', import.meta.url)
const sidebarSource = readFileSync(sidebarUrl, 'utf8')
const canvasSource = readFileSync(canvasUrl, 'utf8')

function workflowGroups() {
  return [
    {
      id: 'group-a',
      title: '主流程',
      storyboard_ids: [11, 12, 13],
      pipeline: ['image', 'video'],
    },
    {
      id: 'group-b',
      title: '补拍',
      storyboard_ids: [21, 22],
      pipeline: ['image'],
    },
  ]
}

test('workflow storyboard reorder is immutable and remains inside its group', () => {
  const original = workflowGroups()
  const reordered = reorderWorkflowGroupStoryboards(original, 'group-a', 0, 2)

  assert.notStrictEqual(reordered, original)
  assert.notStrictEqual(reordered[0], original[0])
  assert.strictEqual(reordered[1], original[1])
  assert.deepEqual(reordered[0].storyboard_ids, [12, 13, 11])
  assert.deepEqual(original[0].storyboard_ids, [11, 12, 13])
  assert.deepEqual(reordered[1].storyboard_ids, [21, 22])

  const movedUp = reorderWorkflowGroupStoryboards(reordered, 'group-a', 2, 1)
  assert.deepEqual(movedUp[0].storyboard_ids, [12, 11, 13])
})

test('invalid workflow storyboard moves preserve the current array reference', () => {
  const original = workflowGroups()

  assert.strictEqual(reorderWorkflowGroupStoryboards(original, 'missing', 0, 1), original)
  assert.strictEqual(reorderWorkflowGroupStoryboards(original, 'group-a', -1, 1), original)
  assert.strictEqual(reorderWorkflowGroupStoryboards(original, 'group-a', 0, 3), original)
  assert.strictEqual(reorderWorkflowGroupStoryboards(original, 'group-a', 1, 1), original)
})

test('workflow order stays optimistic until persistence succeeds and blocks concurrent moves', async () => {
  const groups = ref(workflowGroups())
  let finishSave
  const savedPayloads = []
  const persist = (nextGroups) => {
    savedPayloads.push(nextGroups)
    return new Promise((resolve) => {
      finishSave = resolve
    })
  }
  const { workflowOrderSaving, reorderWorkflowStoryboards } = useCanvasWorkflowOrder({
    workflowGroups: groups,
    persist,
  })

  const pending = reorderWorkflowStoryboards({ groupId: 'group-a', fromIndex: 0, toIndex: 2 })
  assert.equal(workflowOrderSaving.value, true)
  assert.deepEqual(groups.value[0].storyboard_ids, [12, 13, 11])
  assert.equal(savedPayloads.length, 1)

  const ignored = await reorderWorkflowStoryboards({ groupId: 'group-a', fromIndex: 0, toIndex: 1 })
  assert.equal(ignored, false)
  assert.equal(savedPayloads.length, 1)

  finishSave({ ok: true })
  assert.equal(await pending, true)
  assert.equal(workflowOrderSaving.value, false)
  assert.deepEqual(groups.value[0].storyboard_ids, [12, 13, 11])
})

test('workflow order rolls back when persistence reports a failure', async () => {
  const original = workflowGroups()
  const groups = ref(original)
  const previousGroups = groups.value
  const appliedSnapshots = []
  const failures = []
  const expectedError = new Error('network unavailable')
  const failedResult = { ok: false, error: expectedError, operation: { operationId: 42 } }
  const { workflowOrderSaving, reorderWorkflowStoryboards } = useCanvasWorkflowOrder({
    workflowGroups: groups,
    persist: async () => failedResult,
    onOrderApplied: () => appliedSnapshots.push(groups.value[0].storyboard_ids.join(',')),
    onSaveFailed: (error, result) => failures.push({ error, result }),
  })

  const saved = await reorderWorkflowStoryboards({ groupId: 'group-a', fromIndex: 1, toIndex: 0 })

  assert.equal(saved, false)
  assert.equal(workflowOrderSaving.value, false)
  assert.strictEqual(groups.value, previousGroups)
  assert.deepEqual(groups.value[0].storyboard_ids, [11, 12, 13])
  assert.deepEqual(appliedSnapshots, ['12,11,13', '11,12,13'])
  assert.deepEqual(failures, [{ error: expectedError, result: failedResult }])
})

test('workflow order also rolls back when persistence rejects', async () => {
  const original = workflowGroups()
  const groups = ref(original)
  const previousGroups = groups.value
  const failures = []
  const expectedError = new Error('request rejected')
  const { reorderWorkflowStoryboards } = useCanvasWorkflowOrder({
    workflowGroups: groups,
    persist: async () => { throw expectedError },
    onSaveFailed: (error) => failures.push(error),
  })

  assert.equal(await reorderWorkflowStoryboards({ groupId: 'group-b', fromIndex: 0, toIndex: 1 }), false)
  assert.strictEqual(groups.value, previousGroups)
  assert.deepEqual(failures, [expectedError])
})

test('workflow sidebar template compiles with drag handle and keyboard ordering controls', () => {
  const { descriptor, errors: parseErrors } = parse(sidebarSource, { filename: sidebarUrl.pathname })
  assert.deepEqual(parseErrors, [])
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: sidebarUrl.pathname,
    id: 'canvas-workflow-sidebar-ordering',
  })
  assert.deepEqual(compiled.errors, [])

  assert.match(sidebarSource, /class="storyboard-drag-handle"/)
  assert.match(sidebarSource, /:draggable="!reorderDisabled"/)
  assert.match(sidebarSource, /@dragstart\.stop=/)
  assert.match(sidebarSource, /@drop\.stop=/)
  assert.match(sidebarSource, /@keydown\.up\.prevent\.stop=/)
  assert.match(sidebarSource, /@keydown\.down\.prevent\.stop=/)
  assert.match(sidebarSource, /<ArrowUp\s*\/>/)
  assert.match(sidebarSource, /<ArrowDown\s*\/>/)
  assert.match(sidebarSource, /:aria-label="dragHandleLabel/)
})

test('drama canvas enables Vue Flow visibility rendering outside the focused inspector and persists sidebar ordering', () => {
  assert.equal(Boolean(VueFlow.props?.onlyRenderVisibleElements), true)
  assert.match(canvasSource, /:only-render-visible-elements="!focusedNodeId && !selectedFreeNodeId"/)
  assert.match(canvasSource, /@reorder-storyboards="reorderWorkflowStoryboards"/)
  assert.match(canvasSource, /persist: \(\) => persistCanvasState\(\{ groupsOnly: true, reportError: false \}\)/)
  assert.match(canvasSource, /分镜排序保存失败，已恢复原顺序/)
  assert.match(canvasSource, /onSaveFailed: \(error, result\)[\s\S]*?abandonCanvasSaveOperation\(result\?\.operation\)/)
})
