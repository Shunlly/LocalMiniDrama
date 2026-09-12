import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick } from 'vue'

import {
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  createHostRenderer,
  dataModule,
  findAll,
  findByClass,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const listUrl = new URL('../src/components/dramaDetail/DramaDetailEpisodeList.vue', import.meta.url)
const iconStubUrl = compileIconStub(['Delete', 'Plus', 'VideoPlay'])
const batchImportStubUrl = dataModule(`
  import { defineComponent, h } from ${JSON.stringify(vueUrl)}
  export default defineComponent({
    name: 'EpisodeBatchImportDialogStub',
    props: ['startEpisodeNumber', 'importHandler'],
    setup(props, { expose }) {
      expose({
        openDialog() {},
        hasUnsavedWork() { return false },
        isImporting() { return false },
        requestClose() { return true },
      })
      return () => h('div', {
        'data-episode-batch-import': 'true',
        'data-start-episode': String(props.startEpisodeNumber ?? ''),
      })
    },
  })
`)
const DramaDetailEpisodeList = await loadCompiledSfc(
  listUrl,
  'drama-detail-episode-list-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/EpisodeBatchImportDialog.vue', batchImportStubUrl],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const EPISODE_ID = 22
const OTHER_EPISODE_ID = 33
assert.notEqual(DRAMA_ID, EPISODE_ID)
assert.notEqual(EPISODE_ID, OTHER_EPISODE_ID)

const TEXT_MODEL_REASON = '需要先配置默认文本模型，才能从故事素材自动生成剧集。'
const SOURCE_REASON = '需要至少导入 1 份故事素材，才能自动拆分成剧集。'

const RouterLinkStub = {
  name: 'RouterLink',
  props: ['to'],
  setup(props, { slots, attrs }) {
    return () => h('a', {
      ...attrs,
      href: '#',
      'data-to': JSON.stringify(props.to ?? null),
    }, slots.default?.())
  },
}

function emptyState(overrides = {}) {
  return {
    title: '还没有剧集',
    description: '可以从故事素材自动拆分剧集，也可以先批量导入现成剧本，或创建空白剧集再手动完善。',
    primaryAction: { id: 'start_episode_generation', label: '从素材生成剧集' },
    primaryDisabledReason: '',
    unblockAction: null,
    ...overrides,
  }
}

function linkByAriaLabel(root, label) {
  return findAll(root, (node) => node.type === 'a' && node.props?.['aria-label'] === label)[0]
}

function mountList(initial = {}) {
  const events = []
  const mounted = mountHarness(renderer, () => h(DramaDetailEpisodeList, {
    episodes: initial.episodes ?? [],
    episodeEmptyState: initial.episodeEmptyState ?? emptyState(),
    nextEpisodeNumber: initial.nextEpisodeNumber ?? 1,
    addingEpisode: Boolean(initial.addingEpisode),
    deletingEpisodeId: initial.deletingEpisodeId ?? null,
    dramaId: initial.dramaId ?? DRAMA_ID,
    withProjectListReturnTo: (query = {}) => ({ ...query, returnTo: '/' }),
    epStatusLabel: (status) => ({ draft: '草稿', processing: '制作中', completed: '已完成' }[status] || status || ''),
    onAddEpisode: () => events.push(['add-episode']),
    onDeleteEpisode: (episode) => events.push(['delete-episode', episode.id]),
    onBatchImportEpisodes: () => events.push(['batch-import']),
    openEpisodeBatchImport: () => events.push(['open-batch-import']),
    handleReadinessAction: (action) => events.push(['readiness', action?.id, action?.label]),
  }), {
    components: {
      RouterLink: RouterLinkStub,
      'router-link': RouterLinkStub,
    },
  })
  return { ...mounted, events }
}

test('没有剧集时展示中文空态，生成入口带禁用原因', async () => {
  const harness = mountList({
    episodeEmptyState: emptyState({
      primaryDisabledReason: TEXT_MODEL_REASON,
      unblockAction: { id: 'configure_ai', label: '配置文本模型' },
    }),
  })
  try {
    await nextTick()
    const empty = findByClass(harness.root, 'empty-state')[0]
    assert.ok(empty)
    assert.equal(empty.props.role, 'status')
    assert.match(textContent(empty), /还没有剧集/)
    assert.match(textContent(empty), /也可以先批量导入现成剧本/)
    assert.match(textContent(empty), new RegExp(TEXT_MODEL_REASON))

    const generate = buttonByText(harness.root, '从素材生成剧集')
    assert.ok(generate, '缺少从素材生成剧集')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, TEXT_MODEL_REASON)
    assert.equal(generate.props['aria-describedby'], 'episode-empty-reason')

    const trigger = findByClass(harness.root, 'tooltip-trigger')[0]
    assert.ok(trigger)
    assert.equal(trigger.props['aria-label'], `从素材生成剧集不可用：${TEXT_MODEL_REASON}`)
    const tooltip = findAll(harness.root, (node) => node.type === 'tooltip')[0]
    assert.ok(tooltip, '缺少禁用原因 tooltip')
    assert.equal(tooltip.props['data-content'], TEXT_MODEL_REASON)

    click(buttonByText(harness.root, '配置文本模型'))
    click(buttonByText(harness.root, '批量导入剧本'))
    click(buttonByAriaLabel(harness.root, '新增空白集'))
    assert.deepEqual(harness.events, [
      ['readiness', 'configure_ai', '配置文本模型'],
      ['open-batch-import'],
      ['add-episode'],
    ])
    assert.doesNotMatch(textContent(harness.root), /Please|Failed|Network Error/i)
  } finally {
    harness.app.unmount()
  }
})

test('缺故事素材时禁用原因换成导入素材，生成入口仍不可点', async () => {
  const harness = mountList({
    episodeEmptyState: emptyState({
      primaryDisabledReason: SOURCE_REASON,
      unblockAction: { id: 'import_source', label: '去导入素材' },
    }),
  })
  try {
    await nextTick()
    const generate = buttonByText(harness.root, '从素材生成剧集')
    assert.equal(generate.props.disabled, true)
    assert.equal(generate.props.title, SOURCE_REASON)
    assert.notEqual(generate.props.title, TEXT_MODEL_REASON)
    assert.equal(generate.props['aria-describedby'], 'episode-empty-reason')
    click(buttonByText(harness.root, '去导入素材'))
    assert.deepEqual(harness.events, [['readiness', 'import_source', '去导入素材']])
  } finally {
    harness.app.unmount()
  }
})

test('有分集时展示卡片和进入制作，删除走页面方法', async () => {
  const harness = mountList({
    deletingEpisodeId: OTHER_EPISODE_ID,
    episodes: [
      {
        id: EPISODE_ID,
        episode_number: 1,
        title: '',
        script_content: '',
        status: 'draft',
        storyboards: [],
      },
      {
        id: OTHER_EPISODE_ID,
        episode_number: 2,
        title: '雨夜对峙',
        script_content: '巷口只剩一把油纸伞。',
        status: 'processing',
        storyboards: [{ id: 1 }, { id: 2 }],
      },
    ],
  })
  try {
    await nextTick()
    assert.equal(findByClass(harness.root, 'empty-state').length, 0)
    assert.match(textContent(harness.root), /共 2 集/)
    assert.match(textContent(harness.root), /未命名/)
    assert.match(textContent(harness.root), /暂无剧本/)
    assert.match(textContent(harness.root), /雨夜对峙/)
    assert.match(textContent(harness.root), /巷口只剩一把油纸伞/)
    assert.match(textContent(harness.root), /2 分镜/)
    assert.match(textContent(harness.root), /制作中/)

    const unnamedLink = linkByAriaLabel(harness.root, '进入第 1 集「未命名」制作')
    assert.ok(unnamedLink, '缺少进入第 1 集「未命名」制作')
    assert.deepEqual(JSON.parse(unnamedLink.props['data-to']), {
      path: `/film/${DRAMA_ID}`,
      query: { episode: String(EPISODE_ID), returnTo: '/' },
    })
    assert.doesNotMatch(unnamedLink.props['data-to'], new RegExp(String(OTHER_EPISODE_ID)))

    const namedLink = linkByAriaLabel(harness.root, '进入第 2 集「雨夜对峙」制作')
    assert.ok(namedLink)
    assert.match(namedLink.props['data-to'], new RegExp(String(OTHER_EPISODE_ID)))

    const removeFirst = buttonByAriaLabel(harness.root, '删除第 1 集')
    const removeSecond = buttonByAriaLabel(harness.root, '删除第 2 集')
    assert.ok(removeFirst)
    assert.ok(removeSecond)
    assert.equal(removeSecond.props['data-loading'], true)
    assert.notEqual(removeFirst.props['data-loading'], true)
    click(removeFirst)
    click(buttonByAriaLabel(harness.root, '新增一集'))
    assert.deepEqual(harness.events, [
      ['delete-episode', EPISODE_ID],
      ['add-episode'],
    ])
  } finally {
    harness.app.unmount()
  }
})

test('主按钮已是新增空白集时不再重复渲染第二个新增空白集', async () => {
  const harness = mountList({
    episodeEmptyState: emptyState({
      primaryAction: { id: 'create_blank_episode', label: '新增空白集', target: 'add-episode' },
      unblockAction: { id: 'import_source', label: '去导入素材' },
    }),
  })
  try {
    await nextTick()
    const addButtons = findAll(harness.root, (node) => node.type === 'button' && textContent(node).replace(/\s+/g, ' ').trim() === '新增空白集')
    assert.equal(addButtons.length, 1)
    click(addButtons[0])
    click(buttonByText(harness.root, '去导入素材'))
    click(buttonByText(harness.root, '批量导入剧本'))
    assert.deepEqual(harness.events, [
      ['readiness', 'create_blank_episode', '新增空白集'],
      ['readiness', 'import_source', '去导入素材'],
      ['open-batch-import'],
    ])
  } finally {
    harness.app.unmount()
  }
})
