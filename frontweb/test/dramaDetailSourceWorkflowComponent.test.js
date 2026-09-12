import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  dataModule,
  findAll,
  loadCompiledSfc,
  mountHarness,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const workflowSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailSourceWorkflow.vue', import.meta.url), 'utf8')
const workflowUrl = new URL('../src/components/dramaDetail/DramaDetailSourceWorkflow.vue', import.meta.url)
const DRAMA_ID = 11
const OTHER_ID = 22
assert.notEqual(DRAMA_ID, OTHER_ID)

const sourcePanelStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'SourceIntakeWorkflowPanelStub',
    props: ['dramaId', 'drama', 'sourceImportIntent'],
    emits: ['refresh', 'enter-production', 'focus-episode-list'],
    setup(props, { emit }) {
      return () => h('section', {
        id: 'source-intake-workflow',
        tabindex: '-1',
        'data-drama-id': String(props.dramaId ?? ''),
        'data-intent': props.sourceImportIntent ? 'source-url' : '',
      }, [
        h('input', { id: 'source-url', type: 'url', 'aria-label': '故事素材网址' }),
        h('button', { type: 'button', onClick: () => emit('refresh') }, '刷新素材流程'),
        h('button', { type: 'button', onClick: () => emit('enter-production') }, '进入制作'),
        h('button', { type: 'button', onClick: () => emit('focus-episode-list') }, '查看剧集列表'),
      ])
    },
  })
`)

const DramaDetailSourceWorkflow = await loadCompiledSfc(
  workflowUrl,
  'drama-detail-source-workflow-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/SourceIntakeWorkflowPanel.vue', sourcePanelStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountWorkflow(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailSourceWorkflow, {
    dramaId: initial.dramaId ?? DRAMA_ID,
    drama: initial.drama ?? { id: DRAMA_ID, title: '雨巷' },
    sourceImportIntent: Boolean(initial.sourceImportIntent),
    onRefresh: () => events.push('refresh'),
    onEnterProduction: () => events.push('enter-production'),
    onFocusEpisodeList: () => events.push('focus-episode-list'),
  }))
  return { ...mounted, events }
}

test('DramaDetail 把素材流程入口交给独立包装，深链接意图仍由页面转发', () => {
  assert.match(pageSource, /<DramaDetailSourceWorkflow/)
  assert.match(pageSource, /:source-import-intent="sourceImportIntent"/)
  assert.match(pageSource, /@refresh="handleSourceWorkflowRefresh"/)
  assert.match(pageSource, /@enter-production="enterSourceWorkflowProduction"/)
  assert.match(pageSource, /@focus-episode-list="scrollToSection\('episode-list'\)"/)
  assert.match(pageSource, /route.query.intake === 'source-url'/)
  assert.match(pageSource, /scrollToSection\(id, \{ focus: !\(id === 'source-intake-workflow' && sourceImportIntent\.value\) \}\)/)
  assert.doesNotMatch(pageSource, /<SourceIntakeWorkflowPanel/)
  assert.doesNotMatch(workflowSource, /function enterSourceWorkflowProduction/)
  assert.doesNotMatch(workflowSource, /function handleSourceWorkflowRefresh/)
  assert.match(workflowSource, /<SourceIntakeWorkflowPanel/)
  assert.match(workflowSource, /:source-import-intent="sourceImportIntent"/)
})

test('素材流程包装会转发刷新、进入制作和定位剧集列表', async () => {
  const harness = mountWorkflow({ sourceImportIntent: true })
  try {
    await nextTick()
    const section = findAll(harness.root, (node) => node.props?.id === 'source-intake-workflow')[0]
    assert.ok(section, '缺少 source-intake-workflow 锚点')
    assert.equal(section.props.tabindex, '-1')
    assert.equal(section.props['data-drama-id'], String(DRAMA_ID))
    assert.notEqual(section.props['data-drama-id'], String(OTHER_ID))
    assert.equal(section.props['data-intent'], 'source-url')
    click(buttonByText(harness.root, '刷新素材流程'))
    click(buttonByText(harness.root, '进入制作'))
    click(buttonByText(harness.root, '查看剧集列表'))
    assert.deepEqual(harness.events, ['refresh', 'enter-production', 'focus-episode-list'])
  } finally {
    harness.app.unmount()
  }
})
