import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { h, nextTick, ref } from 'vue'

import {
  buttonByText,
  click,
  createHostRenderer,
  dataModule,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const pageSource = readFileSync(new URL('../src/views/DramaDetail.vue', import.meta.url), 'utf8')
const loadAndNavSource = readFileSync(new URL('../src/components/dramaDetail/dramaDetailLoadAndNav.js', import.meta.url), 'utf8')
const readinessSource = readFileSync(new URL('../src/components/dramaDetail/DramaDetailReadinessSection.vue', import.meta.url), 'utf8')
const readinessUrl = new URL('../src/components/dramaDetail/DramaDetailReadinessSection.vue', import.meta.url)

const readinessPanelStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'ProjectReadinessPanelStub',
    props: ['readiness'],
    emits: ['action'],
    setup(props, { emit }) {
      return () => h('section', {
        'data-readiness-panel': 'true',
        'aria-labelledby': 'project-readiness-title',
      }, [
        h('h2', { id: 'project-readiness-title' }, '成片交付就绪度'),
        h('button', {
          type: 'button',
          onClick: () => emit('action', props.readiness?.nextAction || { id: 'configure_ai', label: '配置文本模型' }),
        }, props.readiness?.nextAction?.label || '下一步'),
      ])
    },
  })
`)

const DramaDetailReadinessSection = await loadCompiledSfc(
  readinessUrl,
  'drama-detail-readiness-section-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/ProjectReadinessPanel.vue', readinessPanelStubUrl],
  ]),
)

const renderer = createHostRenderer()

function mountReadiness(initial = {}) {
  const props = ref({
    readinessDependencyState: 'idle',
    readinessDependencyError: '',
    hasReadinessSnapshot: false,
    projectReadiness: null,
    ...initial,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailReadinessSection, {
    ...props.value,
    onRetry: () => events.push('retry'),
    onAction: (action) => events.push(['action', action?.id, action?.label]),
  }))
  return { ...mounted, events, props }
}

test('DramaDetail 把就绪检查交给独立组件，重试和动作仍由页面处理', () => {
  assert.match(pageSource, /<DramaDetailReadinessSection/)
  assert.match(pageSource, /@retry="retryReadinessDependencies"/)
  assert.match(pageSource, /@action="handleReadinessAction"/)
  assert.match(pageSource, /createDramaDetailLoadAndNav\(/)
  assert.match(pageSource, /retryReadinessDependencies,/)
  assert.match(pageSource, /handleReadinessAction,/)
  assert.match(loadAndNavSource, /async function retryReadinessDependencies/)
  assert.match(loadAndNavSource, /function handleReadinessAction/)
  assert.doesNotMatch(pageSource, /<ProjectReadinessPanel/)
  assert.doesNotMatch(pageSource, /class="dependency-status/)
  assert.doesNotMatch(readinessSource, /function retryReadinessDependencies/)
  assert.doesNotMatch(readinessSource, /function handleReadinessAction/)
  assert.match(readinessSource, /role="status"/)
  assert.match(readinessSource, /aria-live="polite"/)
  assert.match(readinessSource, /role="alert"/)
  assert.match(readinessSource, /aria-live="assertive"/)
  assert.match(readinessSource, /正在检查 AI 配置与故事素材状态/)
  assert.match(readinessSource, /当前显示的是上次成功加载的就绪状态/)
})

test('首次检查就绪依赖时展示中文状态，失败可重试', async () => {
  const loading = mountReadiness({ readinessDependencyState: 'loading' })
  try {
    await nextTick()
    const status = findByClass(loading.root, 'dependency-status')[0]
    assert.ok(status)
    assert.equal(status.props.role, 'status')
    assert.equal(status.props['aria-live'], 'polite')
    assert.match(textContent(status), /正在检查 AI 配置与故事素材状态/)
    assert.equal(buttonByText(loading.root, '重试'), undefined)
    assert.equal(findByClass(loading.root, 'dependency-status--error').length, 0)
  } finally {
    loading.app.unmount()
  }

  const failed = mountReadiness({
    readinessDependencyState: 'error',
    readinessDependencyError: 'AI 配置和故事素材状态加载失败，暂时无法判断项目就绪状态。',
  })
  try {
    await nextTick()
    const alert = findByClass(failed.root, 'dependency-status--error')[0]
    assert.ok(alert)
    assert.equal(alert.props.role, 'alert')
    assert.equal(alert.props['aria-live'], 'assertive')
    assert.match(textContent(alert), /AI 配置和故事素材状态加载失败/)
    assert.doesNotMatch(textContent(alert), /当前显示的是上次成功加载的就绪状态/)
    const retry = buttonByText(failed.root, '重试')
    assert.ok(retry, '缺少就绪依赖重试')
    click(retry)
    assert.deepEqual(failed.events, ['retry'])
  } finally {
    failed.app.unmount()
  }
})

test('已有快照时刷新不挡住就绪面板，失败会说明仍显示上次结果', async () => {
  const readiness = {
    complete: false,
    readyCount: 2,
    totalCount: 6,
    nextAction: { id: 'configure_ai', label: '配置文本模型' },
  }
  const refreshing = mountReadiness({
    readinessDependencyState: 'loading',
    hasReadinessSnapshot: true,
    projectReadiness: readiness,
  })
  try {
    await nextTick()
    assert.equal(findByClass(refreshing.root, 'dependency-status').length, 0)
    assert.match(textContent(refreshing.root), /成片交付就绪度/)
    click(buttonByText(refreshing.root, '配置文本模型'))
    assert.deepEqual(refreshing.events, [['action', 'configure_ai', '配置文本模型']])
  } finally {
    refreshing.app.unmount()
  }

  const stale = mountReadiness({
    readinessDependencyState: 'error',
    readinessDependencyError: '故事素材状态加载失败，暂时无法判断项目就绪状态。',
    hasReadinessSnapshot: true,
    projectReadiness: readiness,
  })
  try {
    await nextTick()
    assert.match(textContent(stale.root), /故事素材状态加载失败/)
    assert.match(textContent(stale.root), /当前显示的是上次成功加载的就绪状态/)
    assert.match(textContent(stale.root), /成片交付就绪度/)
  } finally {
    stale.app.unmount()
  }
})
