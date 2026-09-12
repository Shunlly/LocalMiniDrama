import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  click,
  compileIconStub,
  createHostRenderer,
  dataModule,
  findAll,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const controlsUrl = new URL('../src/components/dramaCanvas/CanvasFlowControls.vue', import.meta.url)
const iconStubUrl = compileIconStub(['FullScreen', 'Lock', 'Unlock', 'ZoomIn', 'ZoomOut'])
const backgroundStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export const Background = defineComponent({
    name: 'VueFlowBackground',
    props: ['variant', 'patternColor', 'gap'],
    setup(props) {
      return () => h('div', { 'data-background': props.variant || '' })
    },
  })
`)
const controlsStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export const Controls = defineComponent({
    name: 'VueFlowControls',
    props: ['showZoom', 'showFitView', 'showInteractive'],
    setup(_props, { slots }) {
      return () => h('div', { 'data-controls': 'true' }, [
        slots['control-zoom-in']?.(),
        slots['control-zoom-out']?.(),
        slots['control-fit-view']?.(),
        slots['control-interactive']?.(),
      ])
    },
  })
`)
const minimapStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export const MiniMap = defineComponent({
    name: 'VueFlowMiniMap',
    props: ['pannable', 'zoomable'],
    setup() { return () => h('div', { 'data-minimap': 'true' }) }
  })
`)
const CanvasFlowControls = await loadCompiledSfc(
  controlsUrl,
  'canvas-flow-controls-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@vue-flow/background', backgroundStubUrl],
    ['@vue-flow/controls', controlsStubUrl],
    ['@vue-flow/minimap', minimapStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountControls(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(CanvasFlowControls, {
    backgroundMode: initial.backgroundMode ?? 'dots',
    canvasInteractive: initial.canvasInteractive ?? true,
    zoomCanvasIn: () => events.push('zoom-in'),
    zoomCanvasOut: () => events.push('zoom-out'),
    fitCanvasView: () => events.push('fit-view'),
    toggleCanvasInteractive: () => events.push('toggle-interactive'),
  }))
  return { ...mounted, events }
}

test('画布缩放与适配入口保留中文名称并交给页面方法', async () => {
  const harness = mountControls()
  try {
    await nextTick()
    const zoomIn = buttonByAriaLabel(harness.root, '放大画布')
    const zoomOut = buttonByAriaLabel(harness.root, '缩小画布')
    const fit = buttonByAriaLabel(harness.root, '适配可读视图')
    assert.ok(zoomIn)
    assert.ok(zoomOut)
    assert.ok(fit)
    assert.equal(zoomIn.props.title, '放大画布')
    assert.equal(zoomOut.props.title, '缩小画布')
    assert.equal(fit.props.title, '适配可读视图')
    click(zoomIn)
    click(zoomOut)
    click(fit)
    assert.deepEqual(harness.events, ['zoom-in', 'zoom-out', 'fit-view'])
    assert.equal(findAll(harness.root, (node) => node.props?.['data-background'] === 'dots').length, 1)
    assert.equal(findAll(harness.root, (node) => node.props?.['data-minimap'] === 'true').length, 1)
  } finally {
    harness.app.unmount()
  }
})

test('互动锁定与解锁使用中文 aria-label，无背景时不渲染点阵', async () => {
  const unlocked = mountControls({ canvasInteractive: true })
  try {
    await nextTick()
    const lock = buttonByAriaLabel(unlocked.root, '锁定画布')
    assert.ok(lock)
    assert.equal(lock.props.title, '锁定画布')
    assert.equal(lock.props['aria-pressed'], false)
    click(lock)
    assert.deepEqual(unlocked.events, ['toggle-interactive'])
  } finally {
    unlocked.app.unmount()
  }

  const locked = mountControls({ canvasInteractive: false, backgroundMode: 'none' })
  try {
    await nextTick()
    const unlock = buttonByAriaLabel(locked.root, '解锁画布')
    assert.ok(unlock)
    assert.equal(unlock.props.title, '解锁画布')
    assert.equal(unlock.props['aria-pressed'], true)
    assert.equal(buttonByAriaLabel(locked.root, '锁定画布'), undefined)
    assert.equal(findAll(locked.root, (node) => node.props && Object.prototype.hasOwnProperty.call(node.props, 'data-background')).length, 0)
  } finally {
    locked.app.unmount()
  }
})
