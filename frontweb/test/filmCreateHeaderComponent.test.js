import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  findAll,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const headerUrl = new URL('../src/components/filmCreate/FilmCreateHeader.vue', import.meta.url)
const filmCreateContextUrl = new URL('../src/utils/filmCreateContext.js', import.meta.url)
const iconStubUrl = compileIconStub(['ArrowLeft', 'Grid', 'Moon', 'Plus', 'Setting', 'Sunny'])
const FilmCreateHeader = await loadCompiledSfc(
  headerUrl,
  'film-create-header-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/utils/filmCreateContext', filmCreateContextUrl.href],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const EPISODE_ID = 22
const OTHER_EPISODE_ID = 33
assert.notEqual(DRAMA_ID, EPISODE_ID)

const ElSelectWithChange = defineComponent({
  name: 'ElSelectStub',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  setup(props, { attrs, emit, slots, expose }) {
    expose({
      focus() {},
      toggleMenu() {},
    })
    return () => h('select', {
      ...attrs,
      value: props.modelValue,
      disabled: Boolean(attrs.disabled),
      title: attrs.title,
      'aria-label': attrs['aria-label'],
      'aria-busy': attrs['aria-busy'],
      onChange: (event) => {
        const value = typeof props.modelValue === 'number'
          ? Number(event.target.value)
          : event.target.value
        emit('update:modelValue', value)
        emit('change', value)
      },
    }, slots.default?.())
  },
})

function selectByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'select' && node.props?.['aria-label'] === label)[0]
}

function mountHeader(initialProps = {}) {
  const events = []
  const props = {
    projectPageTitle: '演示短剧',
    projectLoadState: 'ready',
    dramaId: DRAMA_ID,
    hasAnyEpisode: false,
    selectedEpisodeId: null,
    episodeSwitching: false,
    selectedEpisodeContextLabel: '',
    episodes: [],
    isDark: false,
    ...initialProps,
  }
  const mounted = mountHarness(renderer, () => h(FilmCreateHeader, {
    ...props,
    onGoList: () => events.push(['go-list']),
    onEpisodeSelect: (value) => events.push(['episode-select', value]),
    onAddEpisode: () => events.push(['add-episode']),
    onGoToDrama: () => events.push(['go-to-drama']),
    onGoCanvasMode: () => events.push(['go-canvas-mode']),
    onToggleTheme: () => events.push(['toggle-theme']),
    onOpenAiConfig: () => events.push(['open-ai-config']),
  }), {
    components: {
      ElSelect: ElSelectWithChange,
      'el-select': ElSelectWithChange,
    },
  })
  return { ...mounted, events }
}

test('制作页头展示品牌、返回剧集和画布模式，无剧集时是添加一集', () => {
  const harness = mountHeader()
  try {
    assert.match(textContent(harness.root), /本地短剧助手/)
    assert.match(textContent(harness.root), /演示短剧/)
    const logo = buttonByAriaLabel(harness.root, '返回项目列表')
    assert.ok(logo)
    assert.match(logo.props.class, /logo/)
    click(logo)
    const backToDrama = buttonByAriaLabel(harness.root, '返回剧集')
    assert.ok(backToDrama)
    assert.equal(textContent(backToDrama).replace(/\s+/g, ' ').trim(), '返回剧集')
    assert.equal(buttonByAriaLabel(harness.root, '返回剧集管理'), undefined)
    click(backToDrama)
    const canvas = buttonByAriaLabel(harness.root, '画布模式')
    assert.ok(canvas)
    click(canvas)
    const addEpisode = buttonByAriaLabel(harness.root, '添加一集')
    assert.ok(addEpisode)
    assert.match(textContent(addEpisode), /添加一集/)
    click(addEpisode)
    assert.deepEqual(harness.events, [
      ['go-list'],
      ['go-to-drama'],
      ['go-canvas-mode'],
      ['add-episode'],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('项目未就绪时 AI 配置展示中文禁用原因；就绪后可打开', () => {
  const loading = mountHeader({ projectLoadState: 'loading', dramaId: null })
  try {
    const config = buttonByText(loading.root, 'AI 配置')
    assert.ok(config)
    assert.equal(config.props.disabled, true)
    assert.equal(config.props.title, '项目加载完成后才能打开 AI 配置')
    assert.equal(config.props['aria-label'], 'AI 配置不可用：项目加载完成后才能打开')
    assert.equal(buttonByAriaLabel(loading.root, '返回剧集'), undefined)
    assert.equal(buttonByAriaLabel(loading.root, '添加一集'), undefined)
  } finally {
    loading.app.unmount()
  }

  const ready = mountHeader({
    hasAnyEpisode: true,
    selectedEpisodeId: EPISODE_ID,
    selectedEpisodeContextLabel: '第 1 集 · 开场',
    episodes: [
      { id: EPISODE_ID, episode_number: 1, title: '开场' },
      { id: OTHER_EPISODE_ID, episode_number: 2, title: '对峙' },
    ],
  })
  try {
    const config = buttonByAriaLabel(ready.root, '打开 AI 配置')
    assert.ok(config)
    assert.notEqual(config.props.disabled, true)
    assert.equal(config.props.title, '打开 AI 配置')
    click(config)
    const episodeSelect = selectByAriaLabel(ready.root, '当前集')
    assert.ok(episodeSelect)
    assert.match(textContent(episodeSelect), /第 1 集 · 开场/)
    assert.match(textContent(episodeSelect), /第 2 集 · 对峙/)
    assert.equal(buttonByAriaLabel(ready.root, '添加一集'), undefined)
    const theme = buttonByAriaLabel(ready.root, '切换到暗色模式')
    assert.ok(theme)
    assert.match(textContent(theme), /暗色/)
    click(theme)
    assert.deepEqual(ready.events, [['open-ai-config'], ['toggle-theme']])
  } finally {
    ready.app.unmount()
  }
})

test('切换剧集中禁用当前集选择并给出中文原因', async () => {
  const harness = mountHeader({
    hasAnyEpisode: true,
    selectedEpisodeId: EPISODE_ID,
    episodeSwitching: true,
    selectedEpisodeContextLabel: '第 1 集 · 开场',
    episodes: [{ id: EPISODE_ID, episode_number: 1, title: '开场' }],
  })
  try {
    await nextTick()
    const episodeSelect = selectByAriaLabel(harness.root, '当前集')
    assert.ok(episodeSelect)
    assert.equal(episodeSelect.props.disabled, true)
    assert.equal(episodeSelect.props.title, '正在切换剧集，请稍候')
    assert.equal(episodeSelect.props['aria-busy'], true)
  } finally {
    harness.app.unmount()
  }
})
