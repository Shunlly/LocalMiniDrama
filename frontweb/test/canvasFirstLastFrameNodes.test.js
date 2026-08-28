import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick } from 'vue'

import { buildDramaCanvasGraph } from '../src/utils/dramaCanvasAdapter.js'

const mediaNodeSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasMediaNode.vue', import.meta.url), 'utf8')
const mediaPanelSource = readFileSync(new URL('../src/components/dramaCanvas/CanvasMediaPanel.vue', import.meta.url), 'utf8')

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

function makeStoryboard(id, extra = {}) {
  return {
    id,
    episode_id: 7,
    storyboard_number: id,
    creation_mode: 'classic',
    action: `动作${id}`,
    dialogue: `对白${id}`,
    ...extra,
  }
}

function makeDrama({ storyboards, metadata = { storyboard_use_first_last_frame: true } } = {}) {
  return {
    id: 3,
    title: '首尾帧占位',
    metadata,
    characters: [],
    scenes: [],
    props: [],
    episodes: [{
      id: 7,
      episode_number: 1,
      storyboards: storyboards || [makeStoryboard(21)],
    }],
  }
}

function nodeById(graph, id) {
  return graph.nodes.find((node) => node.id === id)
}

function hasEdge(graph, source, target) {
  return graph.edges.some((edge) => edge.source === source && edge.target === target)
}

test('canvasFirstLastFrameNodes dramaCanvasAdapter 在首尾帧模式下始终产出待生成节点', () => {
  const drama = makeDrama({
    storyboards: [makeStoryboard(21, { video_local_path: 'videos/21.mp4' })],
  })
  const graph = buildDramaCanvasGraph(drama, { useFirstLastFrame: true })
  const first = nodeById(graph, 'sbimg-first:21')
  const last = nodeById(graph, 'sbimg-last:21')
  const video = nodeById(graph, 'sbvid:21')

  assert.equal(first?.type, 'canvasMedia')
  assert.equal(last?.type, 'canvasMedia')
  assert.deepEqual({
    url: first.data.url,
    frameKind: first.data.frameKind,
    pending: first.data.pending,
    frameLabel: first.data.frameLabel,
  }, {
    url: '',
    frameKind: 'first',
    pending: true,
    frameLabel: '首帧',
  })
  assert.deepEqual({
    url: last.data.url,
    frameKind: last.data.frameKind,
    pending: last.data.pending,
    frameLabel: last.data.frameLabel,
  }, {
    url: '',
    frameKind: 'last',
    pending: true,
    frameLabel: '尾帧',
  })
  assert.ok(video, '占位首尾帧不得丢掉后续视频节点')
  assert.equal(nodeById(graph, 'sbimg:21'), undefined)
  assert.ok(hasEdge(graph, 'sbtxt:21', 'sbimg-first:21'))
  assert.ok(hasEdge(graph, 'sbimg-first:21', 'sbimg-last:21'))
  assert.ok(hasEdge(graph, 'sbimg-last:21', 'sbvid:21'))
})

test('canvasFirstLastFrameNodes dramaCanvasAdapter 有图时照旧显示，缺一帧仍保留占位', () => {
  const drama = makeDrama({
    storyboards: [makeStoryboard(21, {
      image_url: '/static/images/first.png',
      video_local_path: 'videos/21.mp4',
    })],
  })
  const graph = buildDramaCanvasGraph(drama, {
    useFirstLastFrame: true,
    imagesBySbId: {
      21: [{
        id: 88,
        status: 'completed',
        frame_type: 'storyboard_first',
        image_url: '/static/images/first.png',
      }],
    },
  })
  const first = nodeById(graph, 'sbimg-first:21')
  const last = nodeById(graph, 'sbimg-last:21')

  assert.equal(first.data.url, '/static/images/first.png')
  assert.equal(first.data.pending, false)
  assert.equal(last.data.url, '')
  assert.equal(last.data.pending, true)
  assert.ok(nodeById(graph, 'sbvid:21'))
  assert.ok(hasEdge(graph, 'sbimg-first:21', 'sbimg-last:21'))
  assert.ok(hasEdge(graph, 'sbimg-last:21', 'sbvid:21'))
})

test('canvasFirstLastFrameNodes dramaCanvasAdapter 主图模式没有主图就不建 sbimg 节点', () => {
  const drama = makeDrama({
    metadata: {},
    storyboards: [makeStoryboard(21, { video_local_path: 'videos/21.mp4' })],
  })
  const graph = buildDramaCanvasGraph(drama, { useFirstLastFrame: false })

  assert.equal(nodeById(graph, 'sbimg:21'), undefined)
  assert.equal(nodeById(graph, 'sbimg-first:21'), undefined)
  assert.equal(nodeById(graph, 'sbimg-last:21'), undefined)
  assert.ok(nodeById(graph, 'sbvid:21'))
  assert.ok(hasEdge(graph, 'sbtxt:21', 'sbvid:21'))
})

test('canvasFirstLastFrameNodes dramaCanvasAdapter 真实画布入口只靠 metadata 也会生成占位节点', () => {
  const drama = makeDrama({
    metadata: { storyboard_use_first_last_frame: true },
    storyboards: [makeStoryboard(21, { last_frame_image_url: '/static/images/last.png' })],
  })
  const graph = buildDramaCanvasGraph(drama, {
    episodeId: 7,
    imagesBySbId: {},
    videosBySbId: {},
  })
  const first = nodeById(graph, 'sbimg-first:21')
  const last = nodeById(graph, 'sbimg-last:21')
  assert.equal(first.data.pending, true)
  assert.equal(first.data.url, '')
  assert.equal(last.data.pending, false)
  assert.equal(last.data.url, '/static/images/last.png')
  assert.equal(nodeById(graph, 'sbvid:21'), undefined)
  assert.ok(hasEdge(graph, 'sbtxt:21', 'sbimg-first:21'))
  assert.ok(hasEdge(graph, 'sbimg-first:21', 'sbimg-last:21'))
})

test('canvasFirstLastFrameNodes dramaCanvasAdapter 全能分镜不产出首尾帧占位', () => {
  const drama = makeDrama({
    storyboards: [
      makeStoryboard(21, {
        creation_mode: 'universal',
        universal_segment_text: '一段全能分镜词',
        video_local_path: 'videos/21.mp4',
      }),
      makeStoryboard(22),
    ],
  })
  const graph = buildDramaCanvasGraph(drama, { useFirstLastFrame: true })

  assert.equal(nodeById(graph, 'sbimg-first:21'), undefined)
  assert.equal(nodeById(graph, 'sbimg-last:21'), undefined)
  assert.ok(nodeById(graph, 'sbuni:21'))
  assert.ok(nodeById(graph, 'sbvid:21'))
  assert.ok(hasEdge(graph, 'sbuni:21', 'sbvid:21'))
  assert.ok(nodeById(graph, 'sbimg-first:22'))
  assert.ok(nodeById(graph, 'sbimg-last:22'))
  assert.equal(nodeById(graph, 'sbimg-first:22').data.pending, true)
})

function hostNode(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
}

function insert(child, parent, anchor = null) {
  if (child.parent) {
    const index = child.parent.children.indexOf(child)
    if (index >= 0) child.parent.children.splice(index, 1)
  }
  child.parent = parent
  const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
  if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, child)
  else parent.children.push(child)
}

const renderer = createRenderer({
  patchProp(element, key, _previous, next) { element.props[key] = next },
  insert,
  remove(child) {
    if (!child.parent) return
    const index = child.parent.children.indexOf(child)
    if (index >= 0) child.parent.children.splice(index, 1)
    child.parent = null
  },
  createElement: (type) => hostNode(type),
  createText: (text) => hostNode('#text', text),
  createComment: (text) => hostNode('#comment', text),
  setText(node, text) { node.text = text },
  setElementText(node, text) {
    const child = hostNode('#text', text)
    child.parent = node
    node.children = [child]
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] || null
  },
  querySelector: () => null,
  setScopeId() {},
  cloneNode: (node) => ({ ...node, props: { ...node.props }, children: [...node.children] }),
  insertStaticContent(content, parent, anchor) {
    const node = hostNode('#static', content)
    insert(node, parent, anchor)
    return [node, node]
  },
})

function findAll(node, type, matches = []) {
  if (node.type === type) matches.push(node)
  for (const child of node.children || []) findAll(child, type, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

const vueUrl = import.meta.resolve('vue')
const handleStub = dataModule(`
  import { defineComponent, h } from '${vueUrl}'
  export const Position = { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' }
  export const Handle = defineComponent({
    name: 'Handle',
    props: ['type', 'position'],
    setup: () => () => h('span', { class: 'handle-stub' }),
  })
`)
const childStub = dataModule(`
  import { defineComponent, h } from '${vueUrl}'
  export default defineComponent({
    name: 'ChildStub',
    setup: () => () => h('div', { class: 'child-stub' }),
  })
`)

const { descriptor, errors } = parse(mediaNodeSource, { filename: 'CanvasMediaNode.vue' })
assert.deepEqual(errors, [])
let compiledSource = compileScript(descriptor, {
  id: 'canvas-first-last-frame-nodes',
  inlineTemplate: true,
}).content
for (const [specifier, resolved] of [
  ['vue', vueUrl],
  ['@vue-flow/core', handleStub],
  ['@/composables/useCanvasContext', new URL('../src/composables/useCanvasContext.js', import.meta.url).href],
  ['./CanvasMediaPanel.vue', childStub],
  ['./CanvasNodeStatusOverlay.vue', childStub],
]) {
  compiledSource = compiledSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
}

const CanvasMediaNode = (await import(dataModule(compiledSource))).default

function mountMediaNode(data) {
  const Harness = defineComponent({
    setup() {
      return () => h(CanvasMediaNode, { id: 'sbimg-first:21', data })
    },
  })
  const root = hostNode('root')
  const app = renderer.createApp(Harness)
  app.mount(root)
  return { app, root }
}

test('canvasFirstLastFrameNodes 空 URL 展示待生成文案且不渲染破图', async () => {
  const first = mountMediaNode({
    kind: 'image',
    url: '',
    frameKind: 'first',
    frameLabel: '首帧',
    pending: true,
    storyboard: { id: 21, storyboard_number: 2 },
  })
  const last = mountMediaNode({
    kind: 'image',
    url: '   ',
    frameKind: 'last',
    frameLabel: '尾帧',
    pending: true,
    storyboard: { id: 21, storyboard_number: 2 },
  })
  const ready = mountMediaNode({
    kind: 'image',
    url: '/static/images/first.png',
    frameKind: 'first',
    frameLabel: '首帧',
    pending: false,
    storyboard: { id: 21, storyboard_number: 2 },
  })
  const generic = mountMediaNode({
    kind: 'image',
    url: '',
    storyboard: { id: 21, storyboard_number: 2 },
  })
  try {
    await nextTick()
    const firstButton = findAll(first.root, 'div').find((node) => node.props.role === 'button')
    const lastButton = findAll(last.root, 'div').find((node) => node.props.role === 'button')
    assert.match(textContent(first.root), /待生成首帧/)
    assert.match(textContent(last.root), /待生成尾帧/)
    assert.match(String(firstButton.props['aria-label'] || firstButton.props.ariaLabel), /待生成首帧/)
    assert.match(String(lastButton.props['aria-label'] || lastButton.props.ariaLabel), /待生成尾帧/)
    assert.equal(findAll(first.root, 'img').length, 0)
    assert.equal(findAll(last.root, 'img').length, 0)
    assert.equal(findAll(ready.root, 'img').length, 1)
    assert.doesNotMatch(textContent(ready.root), /待生成首帧/)
    assert.match(textContent(generic.root), /无分镜图/)
    assert.equal(findAll(generic.root, 'img').length, 0)
  } finally {
    first.app.unmount()
    last.app.unmount()
    ready.app.unmount()
    generic.app.unmount()
  }
})

test('canvasFirstLastFrameNodes 面板空态同步待生成文案，且节点不用卡片套卡片', () => {
  assert.match(mediaPanelSource, /待生成首帧/)
  assert.match(mediaPanelSource, /待生成尾帧/)
  assert.match(mediaNodeSource, /class="empty"/)
  assert.match(mediaNodeSource, /pending-frame/)
  assert.doesNotMatch(mediaNodeSource, /class="card"/)
})
