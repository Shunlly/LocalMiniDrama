import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { synchronizeFreeCanvasSelection } from '../src/utils/freeCanvasState.js'

const canvasSource = readFileSync(new URL('../src/views/DramaCanvas.vue', import.meta.url), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function extractFunction(name) {
  const markers = [`async function ${name}`, `function ${name}`]
  const start = markers.reduce((match, marker) => {
    const index = canvasSource.indexOf(marker)
    return index >= 0 && (match < 0 || index < match) ? index : match
  }, -1)
  assert.ok(start >= 0, `缺少 ${name}`)

  let bodyStart = -1
  let parenthesisDepth = 0
  for (let index = canvasSource.indexOf('(', start); index < canvasSource.length; index += 1) {
    if (canvasSource[index] === '(') parenthesisDepth += 1
    if (canvasSource[index] === ')') parenthesisDepth -= 1
    if (parenthesisDepth === 0 && canvasSource[index] === '{') {
      bodyStart = index
      break
    }
  }
  assert.ok(bodyStart >= 0, `缺少 ${name} 函数体`)

  let depth = 0
  for (let index = bodyStart; index < canvasSource.length; index += 1) {
    if (canvasSource[index] === '{') depth += 1
    if (canvasSource[index] === '}') depth -= 1
    if (depth === 0) return canvasSource.slice(start, index + 1)
  }
  throw new Error(`${name} 函数体未闭合`)
}

function createRouteFocusHarness() {
  const projects = new Map([
    [101, [
      { id: 'free:text:alpha', type: 'text', title: '项目甲节点', content: '初载内容' },
      { id: 'free:text:gamma', type: 'text', title: '项目甲后退节点', content: '后退与刷新内容' },
    ]],
    [202, [
      { id: 'free:text:beta', type: 'text', title: '项目乙节点', content: '前进内容' },
    ]],
  ])
  const productionNodes = new Map([
    [101, 'sb:prod-101'],
    [202, 'sb:prod-202'],
  ])
  const route = { params: { id: '101' }, query: { episode: '11', focus: 'free:text:alpha' } }
  const canvasProjectId = { get value() { return Number(route.params.id) } }
  const canvasInstanceActive = { value: true }
  const drama = { value: null }
  const freeCanvas = { value: { nodes: [], edges: [] } }
  const canvasMode = { value: 'production' }
  const nodes = { value: [] }
  const edges = { value: [] }
  const focusedNodeId = { value: null }
  const filterEpisodeId = { value: null }
  const selectedFreeNodeId = { value: 'free:text:stale' }
  const selectedFreeNodeIds = { value: ['free:text:stale'] }
  const selectedFreeEdgeIds = { value: ['free:edge:stale'] }
  const document = {
    activeElement: { dataset: { freeNodeId: 'free:text:stale' }, value: '陈旧内容' },
    querySelector(selector) {
      if (selector !== '.free-canvas-inspector-dock') return null
      const selected = freeCanvas.value.nodes.find((node) => String(node.id) === String(selectedFreeNodeId.value))
      if (!selected || blockedInspectorIds.has(String(selected.id))) return null
      const target = {
        dataset: { freeNodeId: String(selected.id) },
        value: selected.content,
        focus() { document.activeElement = target },
      }
      return {
        dataset: { freeNodeId: String(selected.id) },
        querySelector() { return target },
      }
    },
  }
  let pendingLoad = null
  const blockedInspectorIds = new Set()
  const mediaEpisodeLoads = []

  function installProject(projectId) {
    const projectNodes = structuredClone(projects.get(Number(projectId)) || [])
    drama.value = { id: Number(projectId), episodes: [] }
    freeCanvas.value = { nodes: projectNodes, edges: [] }
    nodes.value = [
      ...projectNodes.map((node) => ({ id: node.id, type: 'freeCanvas', selected: false })),
      { id: productionNodes.get(Number(projectId)), type: 'canvasStoryboard', selected: false },
    ]
    edges.value = []
  }

  async function loadCanvasProject() {
    const requestedProjectId = Number(route.params.id)
    if (pendingLoad) {
      const current = pendingLoad
      pendingLoad = null
      await current.promise
    }
    if (Number(route.params.id) !== requestedProjectId) return false
    installProject(requestedProjectId)
    filterEpisodeId.value = route.query.episode ? Number(route.query.episode) : null
    return true
  }

  const dependencies = {
    route,
    canvasProjectId,
    canvasInstanceActive,
    drama,
    freeCanvas,
    canvasMode,
    nodes,
    edges,
    focusedNodeId,
    filterEpisodeId,
    selectedFreeNodeId,
    selectedFreeNodeIds,
    selectedFreeEdgeIds,
    document,
    canvasEntityFocusRevision: 0,
    FREE_INSPECTOR_FOCUS_TIMEOUT_MS: 200,
    FREE_INSPECTOR_FOCUS_POLL_MS: 2,
    nextTick: async () => {},
    setTimeout,
    Date,
    Number,
    isFreeCanvasNodeId: (id) => freeCanvas.value.nodes.some((node) => String(node.id) === String(id)),
    synchronizeFreeCanvasSelection,
    setFocusedCanvasNode: async (id) => { focusedNodeId.value = id; return true },
    setCanvasMode: async (mode) => { canvasMode.value = mode },
    loadForDrama: async (_drama, episodeId) => { mediaEpisodeLoads.push(episodeId) },
    rebuildGraph: () => {},
    resetCanvasProjectForRoute() {
      drama.value = null
      freeCanvas.value = { nodes: [], edges: [] }
      nodes.value = []
      edges.value = []
      focusedNodeId.value = null
      selectedFreeNodeId.value = null
      selectedFreeNodeIds.value = []
      selectedFreeEdgeIds.value = []
    },
    loadCanvasProject,
  }
  const functionNames = [
    'routeFocusNodeId',
    'routeEpisodeId',
    'claimCanvasEntityFocus',
    'claimRouteEntityFocus',
    'ownsCanvasEntityFocus',
    'waitForFreeCanvasInspectorFocus',
    'activateFreeCanvasNode',
    'closeFreeCanvasInspector',
    'synchronizeRouteFocusedEntity',
    'synchronizeCanvasRouteFocus',
  ]
  const dependencyNames = Object.keys(dependencies)
  const controller = new Function(
    ...dependencyNames,
    `'use strict'; ${functionNames.map(extractFunction).join('\n')}; return { ${functionNames.join(', ')} };`,
  )(...dependencyNames.map((name) => dependencies[name]))

  return {
    ...controller,
    route,
    drama,
    freeCanvas,
    canvasMode,
    focusedNodeId,
    filterEpisodeId,
    selectedFreeNodeId,
    document,
    mediaEpisodeLoads,
    deferNextLoad() { pendingLoad = deferred(); return pendingLoad },
    blockInspector(nodeId) { blockedInspectorIds.add(String(nodeId)) },
    unblockInspector(nodeId) { blockedInspectorIds.delete(String(nodeId)) },
    unload() { drama.value = null },
  }
}

function assertInspectorState(harness, expectedId, expectedContent, stage) {
  const inspector = harness.document.querySelector('.free-canvas-inspector-dock')
  const selectedEntity = harness.freeCanvas.value.nodes.find((node) => String(node.id) === String(expectedId))
  assert.equal(harness.selectedFreeNodeId.value, expectedId, `${stage} selected id`)
  assert.equal(selectedEntity?.content, expectedContent, `${stage} 选中内容实体`)
  assert.equal(inspector?.dataset.freeNodeId, expectedId, `${stage} inspector id`)
  assert.equal(harness.document.activeElement?.dataset.freeNodeId, expectedId, `${stage} activeElement id`)
  assert.equal(harness.document.activeElement?.value, expectedContent, `${stage} 内容实体`)
}

test('路由初载、前进、后退和刷新保持自由画布检查器实体与焦点一致', async () => {
  const harness = createRouteFocusHarness()

  assert.equal(await harness.synchronizeCanvasRouteFocus({ resetProject: true }), true)
  assert.equal(harness.canvasMode.value, 'free')
  assertInspectorState(harness, 'free:text:alpha', '初载内容', '初载')
  const initialTargetId = harness.selectedFreeNodeId.value

  harness.route.params.id = '202'
  harness.route.query.episode = '22'
  harness.route.query.focus = 'free:text:beta'
  assert.equal(await harness.synchronizeCanvasRouteFocus({ resetProject: true }), true)
  assertInspectorState(harness, 'free:text:beta', '前进内容', '前进')

  harness.route.params.id = '101'
  harness.route.query.episode = '11'
  harness.route.query.focus = 'free:text:gamma'
  assert.equal(await harness.synchronizeCanvasRouteFocus({ resetProject: true }), true)
  assertInspectorState(harness, 'free:text:gamma', '后退与刷新内容', '后退')

  harness.unload()
  assert.equal(await harness.synchronizeCanvasRouteFocus({ resetProject: true }), true)
  assertInspectorState(harness, 'free:text:gamma', '后退与刷新内容', '刷新')
  assert.notEqual(harness.selectedFreeNodeId.value, initialTargetId, '最终目标不能沿用初载目标')
})

test('仅 episode 的历史变化会恢复筛选，制作焦点和无效焦点不会沿用旧检查器', async () => {
  const harness = createRouteFocusHarness()
  await harness.synchronizeCanvasRouteFocus({ resetProject: true })

  harness.route.query.episode = '12'
  assert.equal(await harness.synchronizeCanvasRouteFocus(), true)
  assert.equal(harness.filterEpisodeId.value, 12)
  assert.deepEqual(harness.mediaEpisodeLoads, [12])
  assertInspectorState(harness, 'free:text:alpha', '初载内容', '仅 episode 后退恢复')

  harness.route.query.focus = 'sb:prod-101'
  assert.equal(await harness.synchronizeCanvasRouteFocus(), true)
  assert.equal(harness.canvasMode.value, 'production')
  assert.equal(harness.focusedNodeId.value, 'sb:prod-101')
  assert.equal(harness.selectedFreeNodeId.value, null)

  harness.route.query.focus = 'sb:missing'
  assert.equal(await harness.synchronizeCanvasRouteFocus(), true)
  assert.equal(harness.focusedNodeId.value, null)
  assert.equal(harness.selectedFreeNodeId.value, null)
})

test('旧 revision 晚到不能覆盖新路由的 selected id、检查器实体或 activeElement', async () => {
  const harness = createRouteFocusHarness()
  await harness.synchronizeCanvasRouteFocus({ resetProject: true })

  harness.blockInspector('free:text:alpha')
  harness.route.query.focus = 'free:text:alpha'
  const staleNavigation = harness.synchronizeCanvasRouteFocus()
  await Promise.resolve()

  harness.route.query.focus = 'free:text:gamma'
  assert.equal(await harness.synchronizeCanvasRouteFocus(), true)
  assertInspectorState(harness, 'free:text:gamma', '后退与刷新内容', '新 revision')

  harness.unblockInspector('free:text:alpha')
  assert.equal(await staleNavigation, false)
  assertInspectorState(harness, 'free:text:gamma', '后退与刷新内容', '旧 revision 晚到后')
})
