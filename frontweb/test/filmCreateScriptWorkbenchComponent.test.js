import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  actionGateReasons,
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const workbenchUrl = new URL('../src/components/filmCreate/FilmCreateScriptWorkbench.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Document', 'DocumentAdd', 'Plus'])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'script-workbench-action-gate', new Map([['vue', vueUrl]]))
const FilmCreateScriptWorkbench = await loadCompiledSfc(
  workbenchUrl,
  'film-create-script-workbench-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

function mountWorkbench(initialProps = {}) {
  const props = ref({
    isStoryGenRunning: false,
    dramaId: DRAMA_ID,
    hasAnyEpisode: true,
    scriptGenerating: false,
    currentEpisodeId: EPISODE_ID,
    episodes: [{ id: EPISODE_ID, title: '第一集', episode_number: 1, script_content: '对白' }],
    scriptDraftStatus: 'saved',
    scriptDraftStatusLabel: '已保存',
    selectScriptLoading: false,
    selectScriptImporting: false,
    selectableScriptDramas: [],
    selectScriptDramas: [],
    scriptWorkbenchMode: 'create',
    storyInput: '',
    storyStyle: '',
    storyType: '',
    storyEpisodeCount: 1,
    scriptTitle: '第一集',
    scriptContent: '对白',
    showSelectScriptDialog: false,
    selectPreviewEpisodeId: String(EPISODE_ID),
    ...initialProps,
  })
  const events = []
  const mounted = mountHarness(renderer, () => h(FilmCreateScriptWorkbench, {
    ...props.value,
    'onUpdate:storyInput': (value) => { props.value = { ...props.value, storyInput: value } },
    'onUpdate:scriptWorkbenchMode': (value) => { props.value = { ...props.value, scriptWorkbenchMode: value } },
    onGenerateStory: () => events.push(['generate-story']),
    onOpenNovelImport: () => events.push(['open-novel-import']),
    onAddEpisode: () => events.push(['add-episode']),
    onGoToDrama: () => events.push(['go-to-drama']),
    onGenerateScript: () => events.push(['generate-script']),
    onOpenSelectScript: () => events.push(['open-select-script']),
    onReturnToCreation: () => events.push(['return-to-creation']),
  }))
  return { ...mounted, events, props }
}

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

test('没有故事梗概时生成剧本禁用，中文 title 和读屏名称都说明下一步', async () => {
  const harness = mountWorkbench({ storyInput: '   ' })
  try {
    await nextTick()
    const generate = requireButton(harness.root, '生成剧本')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '请先输入故事梗概')
    assert.equal(generate.props['aria-label'], '生成剧本不可用：请先输入故事梗概')
    assert.ok(actionGateReasons(harness.root).includes('请先输入故事梗概'))
  } finally {
    harness.app.unmount()
  }
})

test('生成中禁用生成剧本并给出中文进行中原因', async () => {
  const harness = mountWorkbench({
    storyInput: '少女与狐狸寻找宝石',
    isStoryGenRunning: true,
  })
  try {
    await nextTick()
    const generate = requireButton(harness.root, '生成剧本')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, '正在生成剧本，请稍候')
    assert.equal(generate.props['aria-label'], '正在生成剧本')
  } finally {
    harness.app.unmount()
  }
})

test('空剧集给出添加一集下一步，保存当前集门闩仍是先创建剧集', async () => {
  const harness = mountWorkbench({
    hasAnyEpisode: false,
    currentEpisodeId: null,
    episodes: [],
    scriptTitle: '',
    scriptContent: '',
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /还没有剧集/)
    assert.match(textContent(harness.root), /可以点「添加一集」开始手写剧本/)
    const add = buttonByAriaLabel(harness.root, '添加一集')
    const back = buttonByAriaLabel(harness.root, '返回剧集管理')
    assert.ok(add)
    assert.ok(back)
    assert.equal(buttonByText(harness.root, '保存当前集'), undefined)
    click(add)
    click(back)
    assert.deepEqual(harness.events, [['add-episode'], ['go-to-drama']])
  } finally {
    harness.app.unmount()
  }
})

test('选择剧本空态去掉英文省略号，导入中禁用原因可见', async () => {
  const harness = mountWorkbench({
    hasAnyEpisode: false,
    currentEpisodeId: null,
    episodes: [],
    storyInput: '',
    selectScriptImporting: true,
  })
  try {
    await nextTick()
    assert.doesNotMatch(textContent(harness.root), /从已有剧本中选择…/)
    const openSelect = requireButton(harness.root, '从已有剧本中选择')
    assert.equal(openSelect.props.disabled, true)
    assert.equal(openSelect.props.title, '正在导入剧本，请稍候')
    assert.equal(openSelect.props['aria-label'], '从已有剧本中选择不可用：正在导入剧本，请稍候')
    const startCreate = buttonByAriaLabel(harness.root, '开始创作剧本')
    assert.ok(startCreate)
    click(startCreate)
    assert.deepEqual(harness.events, [['return-to-creation']])
  } finally {
    harness.app.unmount()
  }
})
