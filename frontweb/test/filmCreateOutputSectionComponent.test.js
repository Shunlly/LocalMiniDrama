import test from 'node:test'
import assert from 'node:assert/strict'

import { defineComponent, h, nextTick, ref } from 'vue'

import { createFormStubs } from './helpers/accessibleDialogStub.js'
import {
  actionGateReasons,
  buttonByAriaLabel,
  buttonByText,
  click,
  compileIconStub,
  compileSfc,
  createHostRenderer,
  findByClass,
  findByTestId,
  loadCompiledSfc,
  mountHarness,
  textContent,
  vueUrl,
} from './helpers/vueComponentHarness.js'

const actionGateUrl = new URL('../src/components/filmCreate/ActionGate.vue', import.meta.url)
const deliveryPanelUrl = new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url)
const videoSettingsUrl = new URL('../src/components/filmCreate/FilmCreateVideoSettingsPanel.vue', import.meta.url)
const outputSectionUrl = new URL('../src/components/filmCreate/FilmCreateOutputSection.vue', import.meta.url)

const iconStubUrl = compileIconStub(['Box', 'Document', 'Download', 'VideoPlay'])
const compiledActionGateUrl = compileSfc(actionGateUrl, 'output-section-action-gate', new Map([['vue', vueUrl]]))
const compiledDeliveryPanelUrl = compileSfc(
  deliveryPanelUrl,
  'output-section-delivery-panel',
  new Map([
    ['vue', vueUrl],
    ['@element-plus/icons-vue', iconStubUrl],
    ['@/components/filmCreate/ActionGate.vue', compiledActionGateUrl],
  ]),
)
const compiledVideoSettingsUrl = compileSfc(
  videoSettingsUrl,
  'output-section-video-settings',
  new Map([['vue', vueUrl]]),
)
const FilmCreateOutputSection = await loadCompiledSfc(
  outputSectionUrl,
  'film-create-output-section-component',
  new Map([
    ['vue', vueUrl],
    ['@/components/filmCreate/FilmCreateDeliveryPanel.vue', compiledDeliveryPanelUrl],
    ['@/components/filmCreate/FilmCreateVideoSettingsPanel.vue', compiledVideoSettingsUrl],
  ]),
)

const renderer = createHostRenderer()
const DRAMA_ID = 11
const EPISODE_ID = 22
assert.notEqual(DRAMA_ID, EPISODE_ID)

const ElSwitchStub = defineComponent({
  name: 'ElSwitchStub',
  props: ['modelValue', 'disabled', 'title', 'activeText', 'inactiveText'],
  setup(props, { attrs }) {
    return () => h('button', {
      ...attrs,
      type: 'button',
      role: 'switch',
      disabled: Boolean(props.disabled),
      title: props.title ?? attrs.title,
      'aria-checked': Boolean(props.modelValue),
    }, props.modelValue ? (props.activeText || attrs['active-text'] || '开') : (props.inactiveText || attrs['inactive-text'] || '关'))
  },
})

function requireButton(root, label) {
  const button = buttonByText(root, label)
  assert.ok(button, `缺少按钮：${label}`)
  return button
}

function mountOutput(initial = {}) {
  const events = []
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
    resolution: '720p',
    subtitle: false,
    burnDialogue: false,
    watermark: false,
    watermarkText: '',
    ...initial,
  })
  const mounted = mountHarness(renderer, () => h(FilmCreateOutputSection, {
    ...props.value,
    'onUpdate:resolution': (value) => { props.value = { ...props.value, resolution: value } },
    onOpenAiConfig: () => events.push(['open-ai-config']),
    onGenerateVideo: () => events.push(['generate-video']),
    onDownloadVideo: () => events.push(['download-video']),
    onDownloadSubtitle: () => events.push(['download-subtitle']),
    onExportProject: () => events.push(['export-project']),
  }), {
    components: {
      ...createFormStubs(),
      ElSwitch: ElSwitchStub,
      'el-switch': ElSwitchStub,
    },
  })
  return { ...mounted, events, props }
}

test('没有分镜视频时展示中文空态，合成入口带禁用原因', async () => {
  const harness = mountOutput({
    composeActionDisabledReason: '请先生成或添加分镜',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
  })
  try {
    await nextTick()
    const guidance = findByTestId(harness.root, 'delivery-guidance')[0]
    assert.ok(guidance)
    assert.match(textContent(guidance), /还没有可播放的分镜视频/)
    const compose = requireButton(harness.root, '合成成片')
    assert.equal(compose.props.disabled, true)
    assert.equal(compose.props['aria-label'], '合成成片不可用：请先生成或添加分镜')
    assert.ok(actionGateReasons(harness.root).includes('请先生成或添加分镜'))
    assert.match(textContent(harness.root), /视频配置/)
    assert.doesNotMatch(textContent(harness.root), new RegExp(`${DRAMA_ID}|${EPISODE_ID}`))
  } finally {
    harness.app.unmount()
  }
})

test('英文错误收成中文，并补上合成失败下一步', async () => {
  const harness = mountOutput({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    composeActionDisabledReason: 'Failed to fetch',
    videoStatus: 'error',
    videoErrorMsg: 'HTTP Error',
    videoDownloadStatus: 'error',
    videoDownloadError: 'Network Error',
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    deliverySubtitleAvailable: true,
    deliveryExportHasError: true,
    deliveryExportFeedback: 'Request failed with status code 502',
    deliveryExportStatus: { subtitle: 'error', project: 'error' },
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /成片合成失败，请稍后重试/)
    assert.match(textContent(findByClass(harness.root, 'video-download-status')[0]), /成片下载失败，请稍后重试/)
    assert.match(textContent(findByClass(harness.root, 'delivery-export-feedback')[0]), /导出失败，请稍后重试/)
    const nextStep = findByClass(harness.root, 'delivery-failure-next')[0]
    assert.ok(nextStep)
    assert.equal(nextStep.props.role, 'status')
    assert.match(textContent(nextStep), /可继续点「重试下载」/)
    assert.equal(findByTestId(harness.root, 'video-settings-lock-reason').length, 0)
    const compose = requireButton(harness.root, '重新合成')
    assert.equal(compose.props.disabled, true)
    assert.match(compose.props['aria-label'], /当前不能合成成片/)
    assert.doesNotMatch(textContent(harness.root), /HTTP Error|Failed to fetch|Network Error|status code/i)
  } finally {
    harness.app.unmount()
  }
})

test('正在合成时锁住视频配置并说明请等待', async () => {
  const harness = mountOutput({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    videoStatus: 'generating',
    videoProgress: 40,
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
  })
  try {
    await nextTick()
    const lock = findByTestId(harness.root, 'video-settings-lock-reason')[0]
    assert.ok(lock)
    assert.equal(textContent(lock).trim(), '正在合成视频，请等待当前任务完成')
    const subtitle = buttonByAriaLabel(harness.root, '成片字幕')
    assert.ok(subtitle)
    assert.equal(subtitle.props.disabled, true)
    assert.equal(subtitle.props.title, '正在合成视频，请等待当前任务完成')
    assert.match(textContent(harness.root), /视频正在生成，请稍候/)
    assert.doesNotMatch(textContent(harness.root), /\.\.\./)
    assert.equal(findByClass(harness.root, 'delivery-failure-next').length, 0)
  } finally {
    harness.app.unmount()
  }
})

test('成片就绪后可合成、下载、导出，并打开 AI 配置', async () => {
  const harness = mountOutput({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    deliveryCompositeStatusLabel: '已合成',
    deliveryFileCount: 3,
    videoStatus: 'done',
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    deliverySubtitleAvailable: true,
  })
  try {
    await nextTick()
    assert.match(textContent(harness.root), /视频生成完成/)
    assert.equal(findByClass(harness.root, 'delivery-failure-next').length, 0)
    click(requireButton(harness.root, '重新合成'))
    click(requireButton(harness.root, '下载成片'))
    click(requireButton(harness.root, '下载字幕'))
    click(requireButton(harness.root, '导出项目包'))
    click(buttonByText(harness.root, 'AI 配置'))
    assert.deepEqual(harness.events, [
      ['generate-video'],
      ['download-video'],
      ['download-subtitle'],
      ['export-project'],
      ['open-ai-config'],
    ])
    assert.doesNotMatch(textContent(harness.root), new RegExp(String(DRAMA_ID) + "|" + String(EPISODE_ID)))
  } finally {
    harness.app.unmount()
  }
})

test('字幕导出失败和项目包失败给出不同的下一步，中文错误原样保留', async () => {
  const subtitle = mountOutput({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    videoStatus: 'done',
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    deliverySubtitleAvailable: true,
    deliveryExportHasError: true,
    deliveryExportFeedback: '字幕服务暂时不可用，请稍后重试',
    deliveryExportStatus: { subtitle: 'error', project: 'idle' },
  })
  try {
    await nextTick()
    assert.match(textContent(subtitle.root), /字幕服务暂时不可用，请稍后重试/)
    assert.match(textContent(findByClass(subtitle.root, 'delivery-failure-next')[0]), /可继续点「重试字幕」/)
    assert.equal(requireButton(subtitle.root, '重试字幕').props.disabled, false)
  } finally {
    subtitle.app.unmount()
  }

  const pack = mountOutput({
    playableStoryboardVideoCount: 2,
    storyboardCount: 2,
    videoStatus: 'done',
    currentEpisodeVideoUrl: '/static/final.mp4',
    currentEpisodeId: EPISODE_ID,
    dramaId: DRAMA_ID,
    deliveryExportHasError: true,
    deliveryExportFeedback: '项目包导出失败，请稍后重试',
    deliveryExportStatus: { subtitle: 'idle', project: 'error' },
  })
  try {
    await nextTick()
    assert.match(textContent(findByClass(pack.root, 'delivery-failure-next')[0]), /可继续点「重试项目包」/)
    assert.equal(requireButton(pack.root, '重试项目包').props.disabled, false)
  } finally {
    pack.app.unmount()
  }
})
