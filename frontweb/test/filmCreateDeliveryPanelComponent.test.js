import test from 'node:test'
import assert from 'node:assert/strict'

import { h, nextTick, ref } from 'vue'

import {
  actionGateReasons,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByClass,
  findByTestId,
  findByType,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const deliveryPanelUrl = new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url)

const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const iconStubUrl = compileIconStub(['Box', 'Document', 'Download', 'VideoPlay'])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'delivery-panel-action-gate', new Map([['vue', vueUrl]]))
const FilmCreateDeliveryPanel = await loadCompiledSfc(
  deliveryPanelUrl,
  'film-create-delivery-panel-component',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)

const renderer = createHostRenderer()
const deliveryEventListeners = {
  onGenerateVideo: (_args, events) => events.push(['generate-video']),
  onDownloadVideo: (_args, events) => events.push(['download-video']),
  onDownloadSubtitle: (_args, events) => events.push(['download-subtitle']),
  onExportProject: (_args, events) => events.push(['export-project']),
  onScrollToAnchor: (args, events) => events.push(['scroll-to-anchor', ...args]),
}

function mountDelivery(initialProps = {}) {
  const props = ref({
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    deliveryCompositeStatusLabel: '未合成',
    deliveryFileCount: 0,
    composeActionDisabledReason: '',
    videoStatus: 'idle',
    videoProgress: 0,
    currentEpisodeVideoUrl: '',
    videoDownloadStatus: 'idle',
    videoDownloadError: '',
    currentEpisodeId: null,
    deliverySubtitleAvailable: false,
    dramaId: null,
    deliveryExportStatus: { subtitle: 'idle', project: 'idle' },
    videoErrorMsg: '',
    deliveryExportFeedback: '',
    deliveryExportHasError: false,
    ...initialProps,
  })
  const events = []
  const mounted = mountHarness(renderer, () => {
    const listeners = {}
    for (const [name, listener] of Object.entries(deliveryEventListeners)) {
      listeners[name] = (...args) => listener(args, events)
    }
    return h(FilmCreateDeliveryPanel, { ...props.value, ...listeners })
  })
  return { ...mounted, events, props }
}

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

test('没有成片、剧集或项目时，下载和导出展示中文禁用原因', () => {
  const missingProject = mountDelivery({
    currentEpisodeId: EPISODE_ID,
    dramaId: null,
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
  })
  try {
    const download = requireButton(missingProject.root, '下载成片')
    const subtitle = requireButton(missingProject.root, '下载字幕')
    const exportProject = requireButton(missingProject.root, '导出项目包')
    assert.equal(download.props.disabled, true)
    assert.equal(subtitle.props.disabled, true)
    assert.equal(exportProject.props.disabled, true)
    assert.equal(download.props['aria-label'], '下载成片不可用：请先合成成片后再下载')
    assert.equal(subtitle.props['aria-label'], '下载字幕不可用：当前集还没有可下载的字幕')
    assert.equal(exportProject.props['aria-label'], '导出项目包不可用：请先打开制作项目')
    assert.ok(actionGateReasons(missingProject.root).includes('请先合成成片后再下载'))
    assert.ok(actionGateReasons(missingProject.root).includes('当前集还没有可下载的字幕'))
    assert.ok(actionGateReasons(missingProject.root).includes('请先打开制作项目'))
    assert.doesNotMatch(textContent(missingProject.root), new RegExp(String(EPISODE_ID)))
  } finally {
    missingProject.app.unmount()
  }

  const missingEpisode = mountDelivery({
    currentEpisodeId: null,
    dramaId: DRAMA_ID,
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    currentEpisodeVideoUrl: '/static/final.mp4',
  })
  try {
    const download = requireButton(missingEpisode.root, '下载成片')
    const subtitle = requireButton(missingEpisode.root, '下载字幕')
    const exportProject = requireButton(missingEpisode.root, '导出项目包')
    assert.notEqual(download.props.disabled, true)
    assert.equal(subtitle.props.disabled, true)
    assert.notEqual(exportProject.props.disabled, true)
    assert.equal(subtitle.props['aria-label'], '下载字幕不可用：请先选择剧集')
    assert.equal(exportProject.props['aria-label'], '导出项目包')
    assert.doesNotMatch(textContent(missingEpisode.root), new RegExp(String(DRAMA_ID)))
  } finally {
    missingEpisode.app.unmount()
  }
})

test('就绪后下载和导出走真实按钮入口；失败态收成中文并改成重试', async () => {
  const harness = mountDelivery({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    deliverySubtitleAvailable: true,
  })
  try {
    requireButton(harness.root, '重新合成').props.onClick()
    requireButton(harness.root, '下载成片').props.onClick()
    requireButton(harness.root, '下载字幕').props.onClick()
    requireButton(harness.root, '导出项目包').props.onClick()
    assert.deepEqual(harness.events, [
      ['generate-video'],
      ['download-video'],
      ['download-subtitle'],
      ['export-project'],
    ])

    harness.props.value = {
      ...harness.props.value,
      videoStatus: 'error',
      videoErrorMsg: '成片合成失败（HTTP 503）',
      videoDownloadStatus: 'error',
      videoDownloadError: 'Failed to fetch',
      deliveryExportHasError: true,
      deliveryExportFeedback: 'Network Error',
      deliveryExportStatus: { subtitle: 'error', project: 'error' },
    }
    await nextTick()

    const alerts = findByType(harness.root, 'alert')
    assert.ok(alerts.some((node) => textContent(node) === '成片合成失败，请稍后重试'))
    assert.match(textContent(findByClass(harness.root, 'video-download-status')[0]), /成片下载失败，请稍后重试/)
    assert.match(textContent(findByClass(harness.root, 'delivery-export-feedback')[0]), /导出失败，请稍后重试/)
    assert.equal(requireButton(harness.root, '重试下载').props['aria-label'], '重试下载')
    assert.equal(requireButton(harness.root, '重试字幕').props['aria-label'], '重试字幕')
    assert.equal(requireButton(harness.root, '重试项目包').props['aria-label'], '重试项目包')
    assert.doesNotMatch(textContent(harness.root), /HTTP Error|Failed to fetch|Network Error|HTTP\s*503/i)
    assert.doesNotMatch(textContent(harness.root), new RegExp(`${DRAMA_ID}|${EPISODE_ID}`))
  } finally {
    harness.app.unmount()
  }
})

test('未选剧集的空态不会误导去生成分镜视频，合成入口保持禁用', () => {
  const harness = mountDelivery({
    composeActionDisabledReason: '请先创建或选择剧集',
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    currentEpisodeId: null,
    dramaId: DRAMA_ID,
  })
  try {
    const guidance = findByClass(harness.root, 'delivery-guidance')[0]
    assert.ok(guidance)
    assert.match(textContent(guidance), /请先创建或选择剧集/)
    assert.doesNotMatch(textContent(guidance), /去分镜面板生成视频/)
    assert.equal(requireButton(harness.root, '合成成片').props.disabled, true)
    assert.equal(requireButton(harness.root, '合成成片').props['aria-label'], '合成成片不可用：请先创建或选择剧集')
  } finally {
    harness.app.unmount()
  }
})

test('没有分镜时点空态入口滚动到分镜面板，不使用 hash 链接', async () => {
  const noStoryboards = mountDelivery({
    composeActionDisabledReason: '请先生成或添加分镜',
    playableStoryboardVideoCount: 0,
    storyboardCount: 0,
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
  })
  try {
    await nextTick()
    const action = findByTestId(noStoryboards.root, 'delivery-empty-action')[0]
    assert.ok(action)
    assert.equal(action.type, 'button')
    assert.equal(action.props.type, 'button')
    assert.equal(textContent(action).trim(), '去分镜面板添加分镜')
    click(action)
    assert.deepEqual(noStoryboards.events, [['scroll-to-anchor', 'anchor-storyboard', 'anchor-storyboard']])
  } finally {
    noStoryboards.app.unmount()
  }

  const missingVideos = mountDelivery({
    playableStoryboardVideoCount: 0,
    storyboardCount: 3,
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
  })
  try {
    await nextTick()
    const action = findByTestId(missingVideos.root, 'delivery-empty-action')[0]
    assert.ok(action)
    assert.equal(textContent(action).trim(), '去分镜面板生成视频')
    click(action)
    assert.deepEqual(missingVideos.events, [['scroll-to-anchor', 'anchor-storyboard-images', 'anchor-storyboard-images']])
  } finally {
    missingVideos.app.unmount()
  }
})

test('合成和下载进行中使用中文状态，不用英文省略号', async () => {
  const generating = mountDelivery({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    videoStatus: 'generating',
    videoProgress: 40,
  })
  try {
    await nextTick()
    const progress = findByClass(generating.root, 'video-progress')[0]
    assert.ok(progress)
    assert.equal(progress.props.role, 'status')
    assert.match(textContent(progress), /视频正在生成，请稍候/)
    assert.doesNotMatch(textContent(generating.root), /\.\.\./)
  } finally {
    generating.app.unmount()
  }

  const downloading = mountDelivery({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    videoDownloadStatus: 'downloading',
  })
  try {
    await nextTick()
    assert.match(textContent(downloading.root), /正在验证并下载成片，请稍候/)
    assert.doesNotMatch(textContent(downloading.root), /\.\.\./)
    assert.equal(requireButton(downloading.root, '下载成片').props.title, '正在下载成片，请稍候')
  } finally {
    downloading.app.unmount()
  }
})
