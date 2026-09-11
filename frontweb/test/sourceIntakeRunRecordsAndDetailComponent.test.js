import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByText,
  createHostRenderer,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'
import { normalizeWorkflowRun } from '../src/utils/workflowRunStatus.js'

const recordsUrl = new URL('../src/components/sourceIntake/SourceIntakeRunRecordsPanel.vue', import.meta.url)
const drawerUrl = new URL('../src/components/sourceIntake/SourceIntakeSourceDetailDrawer.vue', import.meta.url)
const workflowUrl = new URL('../src/utils/workflowRunStatus.js', import.meta.url)
const adapterUrl = new URL('../src/utils/sourceIntakeAdapter.js', import.meta.url)

const SourceIntakeRunRecordsPanel = await loadCompiledSfc(
  recordsUrl,
  'source-intake-run-records-panel',
  new Map([
    ['vue', vueUrl],
    ['@/utils/workflowRunStatus', workflowUrl.href],
  ]),
)
const SourceIntakeSourceDetailDrawer = await loadCompiledSfc(
  drawerUrl,
  'source-intake-source-detail-drawer',
  new Map([
    ['vue', vueUrl],
    ['@/utils/sourceIntakeAdapter', adapterUrl.href],
  ]),
)
const renderer = createHostRenderer()

const ElDrawerStub = defineComponent({
  name: 'ElDrawerStub',
  props: ['modelValue', 'title', 'size'],
  setup(props, { slots }) {
    return () => h('drawer', {
      'data-title': props.title || '',
      hidden: !props.modelValue,
    }, props.modelValue ? slots.default?.() : [])
  },
})

function sampleRun(overrides = {}) {
  return {
    id: 88,
    type: 'novel2anime',
    status: 'failed',
    created_at: '2026-09-11T02:00:00.000Z',
    progress: 40,
    input_json: { mode: 'draft' },
    steps: [
      { id: 1, step_key: 'source_intake', status: 'completed', attempts: 1 },
      { id: 2, step_key: 'storyboard_draft', status: 'failed', attempts: 2 },
    ],
    ...overrides,
  }
}

function mountRecords(initial = {}) {
  const events = []
  const run = sampleRun(initial.run)
  const runState = normalizeWorkflowRun(run)
  const mounted = mountHarness(renderer, () => h(SourceIntakeRunRecordsPanel, {
    selectedRun: run,
    runState,
    runProgressStatus: initial.progressStatus || 'exception',
    displayedRunError: initial.error || '分镜草稿失败，请稍后重试',
    extractionNextStep: initial.extractionNextStep || null,
    onOpenExtractionAiConfig: (serviceType) => events.push(['open-extraction-ai-config', serviceType]),
    formatTime: (value) => (value ? '9月11日 10:00' : ''),
  }))
  return { ...mounted, events }
}

function mountDrawer(initial = {}) {
  return mountHarness(renderer, () => h(SourceIntakeSourceDetailDrawer, {
    visible: initial.visible !== false,
    'onUpdate:visible': () => {},
    loading: Boolean(initial.loading),
    sourceDetail: initial.detail ?? null,
    formatTime: (value) => (value ? '9月11日 10:00' : ''),
  }), {
    components: {
      ElDrawer: ElDrawerStub,
      'el-drawer': ElDrawerStub,
    },
  })
}

test('运行记录展示类型、模式、步骤状态和中文失败原因', async () => {
  const harness = mountRecords()
  try {
    await nextTick()
    const text = textContent(harness.root)
    assert.match(text, /故事转动画/)
    assert.match(text, /草稿预演/)
    assert.match(text, /9月11日 10:00/)
    assert.match(text, /素材导入/)
    assert.match(text, /分镜草稿/)
    assert.match(text, /失败/)
    assert.match(text, /#2/)
    assert.match(text, /分镜草稿失败，请稍后重试/)
    const [error] = findByClass(harness.root, 'run-error')
    assert.equal(error.props.role, 'alert')
    assert.equal(error.props['aria-live'], 'assertive')
    assert.equal(error.props.id, 'source-intake-run-error')
    assert.doesNotMatch(text, /Network Error|fetch failed|Invalid Date/i)
  } finally {
    harness.app.unmount()
  }
})

test('正式制作占位会显示告警，没有失败步骤时不展示错误条', async () => {
  const placeholder = mountRecords({
    run: {
      id: 89,
      type: 'novel2anime',
      status: 'completed',
      created_at: '2026-09-11T02:00:00.000Z',
      progress: 100,
      input_json: { mode: 'production' },
      steps: [{
        id: 3,
        step_key: 'image_generation',
        status: 'completed',
        attempts: 1,
        output_json: { provider: 'mock', placeholder: true },
      }],
    },
    error: '不应出现',
  })
  try {
    await nextTick()
    const text = textContent(placeholder.root)
    assert.match(text, /正式制作检测到占位媒体产物/)
    const note = findByClass(placeholder.root, 'placeholder-note')[0]
    assert.ok(note)
    assert.ok(String(note.props.class).includes('is-error') || note.props.class?.['is-error'])
    assert.doesNotMatch(text, /不应出现/)
  } finally {
    placeholder.app.unmount()
  }
})

test('素材详情抽屉区分加载、空数据和片段/事件/关系', async () => {
  const loading = mountDrawer({ loading: true })
  try {
    await nextTick()
    assert.match(textContent(loading.root), /加载中/)
  } finally {
    loading.app.unmount()
  }

  const empty = mountDrawer({ detail: null })
  try {
    await nextTick()
    assert.match(textContent(empty.root), /未找到素材详情，请稍后重试/)
  } finally {
    empty.app.unmount()
  }

  const detail = mountDrawer({
    detail: {
      source: { title: '雨巷小说', source_type: 'novel', created_at: '2026-09-11T02:00:00.000Z' },
      items: [],
      events: [{ id: 7, event_no: 1, title: '开场', detail: '巷口只剩一把油纸伞。' }],
      event_edges: [{ id: 8, relation_type: 'next', from_event_id: 7, to_event_id: 9 }],
    },
  })
  try {
    await nextTick()
    const text = textContent(detail.root)
    assert.match(text, /雨巷小说/)
    assert.match(text, /小说/)
    assert.match(text, /暂无素材片段/)
    assert.match(text, /开场/)
    assert.match(text, /巷口只剩一把油纸伞/)
    assert.match(text, /顺承/)
    assert.match(text, /事件 1/)
    assert.match(text, /事件 9/)
    assert.doesNotMatch(text, /next|from_event_id|Invalid Date/)
  } finally {
    detail.app.unmount()
  }
})


test('处理失败给出图片识别下一步，普通失败没有这颗按钮', async () => {
  const withStep = mountRecords({
    error: '图片识别失败。请到「AI 配置」添加「图片识别」服务，或先使用本机 Tesseract。',
    extractionNextStep: {
      kind: 'ocr',
      serviceType: 'ocr',
      actionLabel: '去「AI 配置」添加图片识别',
      extraHint: 'PDF/图片也可先使用本机 Tesseract。',
    },
  })
  try {
    await nextTick()
    const text = textContent(withStep.root)
    assert.match(text, /下一步/)
    assert.match(text, /去「AI 配置」添加图片识别/)
    assert.match(text, /本机 Tesseract/)
    const action = buttonByText(withStep.root, '去「AI 配置」添加图片识别')
    assert.ok(action, '缺少图片识别下一步按钮')
    action.props.onClick()
    assert.deepEqual(withStep.events, [['open-extraction-ai-config', 'ocr']])
  } finally {
    withStep.app.unmount()
  }

  const plain = mountRecords()
  try {
    await nextTick()
    assert.doesNotMatch(textContent(plain.root), /下一步/)
  } finally {
    plain.app.unmount()
  }
})
