import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findByClass,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const warningUrl = new URL('../src/components/filmCreate/FilmCreateProjectDependencyWarning.vue', import.meta.url)
const loadStateUrl = new URL('../src/components/filmCreate/FilmCreateProjectLoadState.vue', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Loading', 'Refresh', 'WarningFilled'])
const replacements = new Map([
  ['vue', vueUrl],
  ['@element-plus/icons-vue', iconStubUrl],
])
const FilmCreateProjectDependencyWarning = await loadCompiledSfc(
  warningUrl,
  'film-create-project-dependency-warning',
  replacements,
)
const FilmCreateProjectLoadState = await loadCompiledSfc(
  loadStateUrl,
  'film-create-project-load-state',
  replacements,
)
const renderer = createHostRenderer()

function visibleButtonText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim()
}

test('依赖警告只有一个 primary，读屏名包含可见重试加载素材', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(FilmCreateProjectDependencyWarning, {
    mediaError: '分镜素材读取失败',
    loading: false,
    onRetry: () => events.push('retry'),
  }))
  try {
    await nextTick()
    const actions = findByClass(harness.root, 'project-dependency-warning-actions')[0]
    const buttons = findByType(actions, 'button')
    const primaries = buttons.filter((node) => node.props['data-variant'] === 'primary')
    assert.equal(primaries.length, 1)
    const retry = buttonByText(harness.root, '重试加载素材')
    assert.ok(retry)
    assert.equal(retry.props['aria-label'], '重试加载素材')
    assert.ok(String(retry.props['aria-label']).includes(visibleButtonText(retry)))
    click(retry)
    assert.deepEqual(events, ['retry'])
  } finally {
    harness.app.unmount()
  }
})

test('依赖警告不把 HTTP 状态码展示给用户', async () => {
  const harness = mountHarness(renderer, () => h(FilmCreateProjectDependencyWarning, {
    mediaError: '读取失败（HTTP 503）',
    dependencyWarning: '任务状态同步失败 HTTP 502',
  }))
  try {
    await nextTick()
    const pageText = textContent(harness.root)
    assert.match(pageText, /[一-鿿]/)
    assert.doesNotMatch(pageText, /HTTP\s*\d{3}/i)
    assert.match(pageText, /分镜素材读取失败|项目依赖暂时无法同步/)
  } finally {
    harness.app.unmount()
  }
})

test('项目加载失败只有一个 primary，读屏名包含可见重试加载', async () => {
  const events = []
  const harness = mountHarness(renderer, () => h(FilmCreateProjectLoadState, {
    state: 'error',
    errorText: '无法连接本地服务（HTTP 500）',
    notFound: false,
    pending: false,
    onRetry: () => events.push('retry'),
    onGoList: () => events.push('go-list'),
    onGoToDrama: () => events.push('go-to-drama'),
    dramaId: 9,
  }))
  try {
    await nextTick()
    const actions = findByClass(harness.root, 'project-load-state-actions')[0]
    const buttons = findByType(actions, 'button')
    const primaries = buttons.filter((node) => node.props['data-variant'] === 'primary')
    assert.equal(primaries.length, 1)
    const retry = buttonByText(harness.root, '重试加载')
    const drama = buttonByText(harness.root, '返回剧集')
    const back = buttonByText(harness.root, '返回项目列表')
    assert.ok(retry)
    assert.ok(drama)
    assert.ok(back)
    assert.equal(retry.props['aria-label'], '重试加载')
    assert.ok(String(retry.props['aria-label']).includes(visibleButtonText(retry)))
    assert.ok(String(back.props['aria-label']).includes(visibleButtonText(back)))
    assert.doesNotMatch(textContent(harness.root), /HTTP\s*\d{3}/i)
    assert.match(textContent(harness.root), /暂时无法打开制作项目/)
    click(retry)
    click(drama)
    assert.deepEqual(events, ['retry', 'go-to-drama'])
  } finally {
    harness.app.unmount()
  }
})
