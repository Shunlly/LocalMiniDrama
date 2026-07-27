import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, defineComponent, h, nextTick } from 'vue'

const componentUrl = new URL('../src/components/dramaCanvas/FreeCanvasAssetSidebar.vue', import.meta.url)
const componentSource = readFileSync(componentUrl, 'utf8')
const { descriptor, errors } = parse(componentSource, { filename: componentUrl.pathname })
assert.deepEqual(errors, [])
let compiledSource = compileScript(descriptor, {
  id: 'free-canvas-asset-sidebar-runtime',
  inlineTemplate: true,
}).content
for (const [specifier, resolved] of [
  ['vue', import.meta.resolve('vue')],
  ['@element-plus/icons-vue', import.meta.resolve('@element-plus/icons-vue')],
  ['@/utils/freeCanvasMedia', new URL('../src/utils/freeCanvasMedia.js', import.meta.url).href],
]) {
  compiledSource = compiledSource
    .replaceAll(`from '${specifier}'`, `from '${resolved}'`)
    .replaceAll(`from "${specifier}"`, `from "${resolved}"`)
}
const FreeCanvasAssetSidebar = (await import(
  `data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`
)).default

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

const SlotStub = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('stub', attrs, slots.default?.())
  },
})
const ButtonStub = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  },
})

function findAll(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node)
  for (const child of node.children || []) findAll(child, predicate, matches)
  return matches
}

function textContent(node) {
  return `${node.text || ''}${(node.children || []).map(textContent).join('')}`
}

async function mountSidebar() {
  const root = hostNode('root')
  const app = renderer.createApp(FreeCanvasAssetSidebar, {
    projectId: 7,
    storyboardMedia: [{
      id: 'storyboard-image:30',
      projectId: 7,
      storyboardId: 20,
      type: 'image',
      storageKey: 'dramas/7/frame.png',
      label: '分镜图片',
    }],
    assets: [{
      id: 44,
      drama_id: 7,
      type: 'video',
      local_path: 'dramas/7/shot.mp4',
      name: '项目视频',
    }],
  })
  for (const name of ['el-tooltip', 'el-icon', 'el-input', 'el-radio-group', 'el-radio-button']) {
    app.component(name, SlotStub)
  }
  app.component('el-button', ButtonStub)
  app.mount(root)
  await nextTick()
  return { app, root }
}

function dragPayloadFor(row) {
  const entries = new Map()
  const dataTransfer = {
    effectAllowed: '',
    setData(type, value) { entries.set(type, value) },
  }
  assert.equal(typeof row.props.onDragstart, 'function')
  row.props.onDragstart({ dataTransfer, stopPropagation() {} })
  assert.equal(entries.size, 1)
  const [[type, raw]] = entries
  return { dataTransfer, payload: JSON.parse(raw), type }
}

test('mounted media rows publish versioned project-scoped identity payloads without paths', async () => {
  const harness = await mountSidebar()
  try {
    const rows = findAll(harness.root, (node) => (
      node.type === 'button' && String(node.props.class || '').includes('asset-item-media')
    ))
    const storyboardRow = rows.find((row) => textContent(row).includes('分镜图片'))
    const assetRow = rows.find((row) => textContent(row).includes('项目视频'))
    assert.ok(storyboardRow)
    assert.ok(assetRow)
    assert.equal(storyboardRow.props.draggable, true)
    assert.equal(assetRow.props.draggable, true)

    const storyboardDrag = dragPayloadFor(storyboardRow)
    assert.equal(storyboardDrag.type, 'application/x-local-mini-drama-free-canvas-media')
    assert.deepEqual(storyboardDrag.payload, {
      version: 1,
      projectId: 7,
      kind: 'storyboard-media',
      mediaId: 'storyboard-image:30',
      storyboardId: '20',
    })
    const assetDrag = dragPayloadFor(assetRow)
    assert.deepEqual(assetDrag.payload, {
      version: 1,
      projectId: 7,
      kind: 'project-asset',
      mediaId: '44',
    })
    assert.equal(assetDrag.dataTransfer.effectAllowed, 'copy')
    for (const payload of [storyboardDrag.payload, assetDrag.payload]) {
      assert.equal('storageKey' in payload, false)
      assert.equal('local_path' in payload, false)
      assert.equal('content' in payload, false)
    }
  } finally {
    harness.app.unmount()
  }
})
