import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { readFilmCreateResourceDialogTree } from './helpers/filmCreateResourceDialogSources.js'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
  'utf8',
)
const navStepsSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateNavSteps.js', import.meta.url),
  'utf8',
)
const scriptWorkspaceSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateScriptWorkspace.js', import.meta.url),
  'utf8',
)
const storyboardVideoFieldsSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateStoryboardVideoFields.js', import.meta.url),
  'utf8',
)
const deliveryActionsSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateDeliveryActions.js', import.meta.url),
  'utf8',
)
const filmCreateStyleSource = readFileSync(
  new URL('../src/views/FilmCreate.css', import.meta.url),
  'utf8',
)
const stylePickerSource = readFileSync(
  new URL('../src/components/StylePickerButton.vue', import.meta.url),
  'utf8',
)
const pipelinePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url),
  'utf8',
)
const deliveryPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateDeliveryPanel.vue', import.meta.url),
  'utf8',
)
const scriptWorkbenchSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateScriptWorkbench.vue', import.meta.url),
  'utf8',
)
const storyboardDialogsSource = [
  'FilmCreateStoryboardDialogs.vue',
  'FilmCreateStoryboardPromptDialog.vue',
  'FilmCreateStoryboardFramePromptDialog.vue',
  'FilmCreateStoryboardVideoParamsDialog.vue',
  'FilmCreateStoryboardFreeReferencePreview.vue',
].map((name) => readFileSync(new URL(`../src/components/filmCreate/${name}`, import.meta.url), 'utf8')).join('\n')
const resourcePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url),
  'utf8',
)
const storyboardPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.css', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardEmptyState.vue', import.meta.url),
  'utf8',
) + '\n' + readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardVideoColumn.vue', import.meta.url),
  'utf8',
)
const storyboardConfigBarSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardConfigBar.vue', import.meta.url),
  'utf8',
)
const resourceDialogsSource = readFilmCreateResourceDialogTree()
const headerSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateHeader.vue', import.meta.url),
  'utf8',
)
const workspaceNavSource = readFileSync(
  new URL('../src/composables/filmCreate/useFilmCreateWorkspaceNav.js', import.meta.url),
  'utf8',
)
const quickNavSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateQuickNav.vue', import.meta.url),
  'utf8',
)
const projectLoadStateSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateProjectLoadState.vue', import.meta.url),
  'utf8',
)

test('film create navigation and resource disclosure controls use native buttons', () => {
  assert.match(filmCreateSource, /<FilmCreateQuickNav/)
  assert.match(filmCreateSource, /@scroll-to-anchor="scrollToAnchor"/)
  assert.match(quickNavSource, /<button[\s\S]*?class="nav-toggle"[\s\S]*?:aria-expanded="!navCollapsed"/)
  assert.match(quickNavSource, /<button[\s\S]*?class="nav-step"[\s\S]*?:aria-current="activeNavAnchor === step\.anchor \? 'step' : undefined"/)
  assert.match(quickNavSource, /<button[\s\S]*?class="nav-step"[\s\S]*?@click="emit\('scroll-to-anchor', step\.anchor, step\.anchor\)"/)
  assert.match(quickNavSource, /<button[\s\S]*?class="nav-sub-toggle"[\s\S]*?:aria-expanded="storyboardMenuExpanded"/)
  assert.match(quickNavSource, /<button[\s\S]*?class="nav-sub-item"[\s\S]*?@click="emit\('scroll-to-anchor', 'sb-' \+ sb\.id, 'anchor-storyboard-images'\)"/)
  assert.equal((quickNavSource.match(/:aria-current=/g) || []).length, 1)
  assert.match(quickNavSource, /\{ 'is-current': activeNavAnchor === step\.anchor \}/)

  const storyboardScriptAnchors = storyboardPanelSource.match(/id="anchor-storyboard"/g) || []
  const storyboardImageAnchors = storyboardConfigBarSource.match(/id="anchor-storyboard-images"/g) || []
  assert.equal(storyboardScriptAnchors.length, 1)
  assert.equal(storyboardImageAnchors.length, 1)
  assert.match(storyboardPanelSource, /<FilmCreateStoryboardConfigBar/)
  assert.ok(
    storyboardConfigBarSource.indexOf('id="anchor-storyboard-images"')
      < storyboardConfigBarSource.indexOf('label="批量生成分镜图"'),
  )

  const disclosureButtons = resourcePanelSource.match(
    /<button\b[^>]*class="collapse-header(?: resource-block-header)?"[^>]*>/g,
  ) || []
  assert.equal(disclosureButtons.length, 4)
  for (const button of disclosureButtons) {
    assert.match(button, /:aria-expanded=/)
    assert.match(button, /aria-controls=/)
  }
})

test('film create keeps the episode selector only in the page header', () => {
  assert.match(filmCreateSource, /<FilmCreateHeader/)
  assert.equal((filmCreateSource.match(/v-model="selectedEpisodeId"/g) || []).length, 0)
  assert.equal((headerSource.match(/class="header-episode-select"/g) || []).length, 1)
  assert.equal((filmCreateSource.match(/class="header-episode-select"/g) || []).length, 0)

  const selectStart = headerSource.indexOf('class="header-episode-select"')
  const selectEnd = headerSource.indexOf('</el-select>', selectStart)
  const episodeSelectSource = headerSource.slice(selectStart, selectEnd)

  assert.match(headerSource, /class="header-context-label">项目<\/span>/)
  assert.match(headerSource, /class="header-context-label">当前集<\/span>/)
  assert.match(headerSource, /<h1 class="page-title"\s+:title="projectPageTitle">\{\{ projectPageTitle \}\}<\/h1>/)
  assert.doesNotMatch(headerSource, /<span class="page-title"/)
  assert.doesNotMatch(filmCreateSource, /<span class="page-title"/)
  assert.match(filmCreateStyleSource, /\.page-title\s*\{[\s\S]*?margin:\s*0;/)
  assert.match(episodeSelectSource, /aria-label="当前集"/)
  assert.match(episodeSelectSource, /:model-value="selectedEpisodeId"/)
  assert.match(episodeSelectSource, /:loading="episodeSwitching"/)
  assert.match(episodeSelectSource, /:disabled="episodeSwitching"/)
  assert.match(episodeSelectSource, /:aria-busy="episodeSwitching"/)
  assert.match(episodeSelectSource, /v-for="\(ep, index\) in episodes"/)
  assert.match(episodeSelectSource, /:label="formatEpisodeContextLabel\(ep, index\)"/)
  assert.doesNotMatch(episodeSelectSource, /\bclearable\b/)
  assert.match(headerSource, /ref="episodeSelectRef"/)
  assert.match(headerSource, /function focusEpisodeSelect\(/)
  assert.match(headerSource, /defineExpose\(\{\s*focusEpisodeSelect\s*\}\)/)
  assert.match(filmCreateSource, /ref="filmCreateHeaderRef"/)
  assert.doesNotMatch(filmCreateSource, /function onSelectEpisode\(/)
  assert.match(filmCreateSource, /useFilmCreateWorkspaceNav\(/)
  assert.match(workspaceNavSource, /function onSelectEpisode\(/)
  assert.match(workspaceNavSource, /filmCreateHeaderRef\.value\?\.focusEpisodeSelect/)
  assert.match(workspaceNavSource, /querySelector\('\.header'\)\?\.scrollIntoView/)
})

test('制作页头没有微信我联系入口', () => {
  assert.doesNotMatch(headerSource, /微信我/)
  assert.doesNotMatch(headerSource, /btn-wechat/)
  assert.doesNotMatch(headerSource, /showWechat/)
  assert.doesNotMatch(headerSource, /扫码联系作者/)
  assert.doesNotMatch(headerSource, /微信联系作者/)
  assert.doesNotMatch(headerSource, /ChatDotSquare/)
  assert.match(headerSource, /class="header-actions"/)
  assert.match(headerSource, /class="btn-ai-config"/)
  assert.match(headerSource, /AI 配置/)
  assert.match(headerSource, /项目加载完成后才能打开 AI 配置/)
  assert.match(headerSource, /正在切换剧集，请稍候/)
  assert.match(headerSource, /\.btn-ai-config:focus-visible/)
})

test('film create navigation names and reports the final delivery step accurately', () => {
  assert.match(
    navStepsSource,
    /label: '交付与导出',\s+anchor: 'anchor-video',\s+status: compositeStatus/,
  )
  assert.match(deliveryActionsSource, /if \(isPlaceholderMediaUrl\(s\)\) return ''/)
  assert.match(navStepsSource, /currentEpisodeVideoUrl\.value\s*\? 'done'/)
  assert.doesNotMatch(
    navStepsSource,
    /label: '分镜视频',\s+anchor: 'anchor-video'/,
  )
  assert.match(filmCreateSource, /useFilmCreateNavSteps\(/)
})

test('delivery stage consolidates composite readiness and user-facing export actions', () => {
  const outputSectionSource = readFileSync(new URL('../src/components/filmCreate/FilmCreateOutputSection.vue', import.meta.url), 'utf8')
  assert.match(filmCreateSource, /<FilmCreateOutputSection/)
  assert.match(outputSectionSource, /<FilmCreateDeliveryPanel/)
  assert.match(deliveryPanelSource, /<section id="anchor-video" class="section card delivery-section">/)
  assert.match(deliveryPanelSource, /<h2 class="section-title">交付与导出<\/h2>/)
  assert.match(deliveryPanelSource, /分镜视频[\s\S]*playableStoryboardVideoCount[\s\S]*整集合成[\s\S]*可交付文件/)
  assert.match(filmCreateSource, /@download-video="downloadCurrentEpisodeVideo"/)
  assert.match(filmCreateSource, /@download-subtitle="downloadCurrentEpisodeSubtitle"/)
  assert.match(filmCreateSource, /@export-project="exportCurrentProjectPackage"/)
  assert.match(deliveryActionsSource, /const deliverySubtitleAvailable = computed\(\(\) => storyboards\.value\.some/)
  assert.match(deliveryPanelSource, /<ActionGate :reason="downloadSubtitleDisabledReason" label="下载字幕">/)
  assert.match(deliveryPanelSource, /:disabled="Boolean\(downloadSubtitleDisabledReason\)"/)
  assert.match(filmCreateSource, /import \{ timelinesAPI as rawTimelinesAPI \} from '@\/api\/timelines'/)
  assert.match(filmCreateSource, /const timelinesAPI = projectLifecycle\.guardApi\(rawTimelinesAPI\)/)
})

test('storyboard video controls expose a focusable missing-prompt reason', () => {
  assert.match(
    storyboardPanelSource,
    /<ActionGate :reason="sbVideoGenerationDisabledReason\(sb\)" label="生成分镜视频">/,
  )
  assert.match(storyboardPanelSource, /class="sb-video-disabled-reason"[\s\S]*?role="status"[\s\S]*?tabindex="0"/)
  assert.match(storyboardVideoFieldsSource, /function sbVideoGenerationDisabledReason\(sb\)[\s\S]*?请先填写视频提示词/)
})

test('script and character library empty states provide direct actions', () => {
  assert.match(scriptWorkbenchSource, /class="select-script-empty"[\s\S]*?emit\('return-to-creation'\)/)
  assert.match(scriptWorkbenchSource, /class="script-select-empty"[\s\S]*?emit\('open-select-script'\)/)
  assert.match(scriptWorkbenchSource, /class="script-select-empty"[\s\S]*?emit\('return-to-creation'\)/)
  assert.match(filmCreateSource, /@return-to-creation="returnToScriptCreation"/)
  assert.match(resourceDialogsSource, /class="library-empty"[\s\S]*?@click="returnToCharacterPanel"/)
  assert.match(resourceDialogsSource, /@click="returnToPropPanel">去道具面板/)
  assert.match(resourceDialogsSource, /@click="returnToPropPanel">创建道具/)
  assert.match(resourceDialogsSource, /@click="returnToScenePanel">去场景面板/)
  assert.match(resourceDialogsSource, /@click="returnToScenePanel">创建场景/)
  assert.match(scriptWorkspaceSource, /function returnToScriptCreation\(\)/)
  assert.match(scriptWorkspaceSource, /function returnToCharacterPanel\(\)/)
  assert.match(scriptWorkspaceSource, /function returnToPropPanel\(\)/)
  assert.match(scriptWorkspaceSource, /function returnToScenePanel\(\)/)
})

test('every FilmCreate ActionGate identifies its button action', () => {
  const imageColumnSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreateStoryboardImageColumn.vue', import.meta.url),
    'utf8',
  )
  const characterBlockSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreateCharacterBlock.vue', import.meta.url),
    'utf8',
  )
  const propBlockSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreatePropBlock.vue', import.meta.url),
    'utf8',
  )
  const sceneBlockSource = readFileSync(
    new URL('../src/components/filmCreate/FilmCreateSceneBlock.vue', import.meta.url),
    'utf8',
  )
  const actionGates = [filmCreateSource, deliveryPanelSource, scriptWorkbenchSource, resourcePanelSource, characterBlockSource, propBlockSource, sceneBlockSource, storyboardPanelSource, storyboardConfigBarSource, resourceDialogsSource, imageColumnSource]
    .flatMap((source) => source.match(/<ActionGate\b[^>]*>/g) || [])
  assert.ok(actionGates.length >= 13)
  for (const gate of actionGates) {
    assert.match(gate, /(?:^|\s):?label=/)
  }
})

test('style picker toolbar and options are keyboard-operable buttons', () => {
  assert.match(stylePickerSource, /<button[\s\S]*?class="style-picker-trigger"[\s\S]*?aria-haspopup="dialog"/)
  assert.match(stylePickerSource, /<button[\s\S]*?class="spt-clear"[\s\S]*?aria-label="清除生成风格"/)
  assert.match(stylePickerSource, /<button[\s\S]*?class="spd-item"[\s\S]*?:aria-pressed=/)
  assert.doesNotMatch(stylePickerSource, /<div\b[^>]*class="(?:style-picker-trigger|spd-item)"/)
})

test('full pipeline is an accessible idle disclosure that opens for running work', () => {
  assert.match(pipelinePanelSource, /<button[\s\S]*?data-testid="film-pipeline-toggle"/)
  assert.match(pipelinePanelSource, /:aria-expanded="expanded"/)
  assert.match(pipelinePanelSource, /aria-controls="film-pipeline-details"/)
  assert.match(pipelinePanelSource, /id="film-pipeline-details"/)
  assert.match(pipelinePanelSource, /v-show="expanded"/)
  assert.match(pipelinePanelSource, /forceExpanded:\s*computed\(\(\) => props\.running \|\| props\.errorLog\.length > 0\)/)
  assert.match(pipelinePanelSource, /\.pipeline-toggle:focus-visible\s*\{/)
  assert.match(pipelinePanelSource, /<h2 id="pipeline-title" class="pipeline-title">全流程生成<\/h2>/)
  assert.equal(pipelinePanelSource.match(/>全流程生成<\//g)?.length, 1)

  const summaryStart = pipelinePanelSource.indexOf('class="pipeline-disclosure-head"')
  const detailsStart = pipelinePanelSource.indexOf('id="film-pipeline-details"')
  assert.ok(summaryStart >= 0 && summaryStart < detailsStart)
  const compactSummary = pipelinePanelSource.slice(summaryStart, detailsStart)
  assert.match(compactSummary, /\{\{ focusKicker \}\}/)
  assert.match(compactSummary, /\{\{ focusTitle \}\}/)
  assert.match(compactSummary, /\{\{ focusNextStep \}\}/)
})
test('制作页侧栏取消任务在停止流水线时说明原因，并保留键盘焦点', () => {
  assert.match(quickNavSource, /正在停止流水线，请稍候/)
  assert.match(quickNavSource, /\.atp-item-close:focus-visible/)
})

test('制作页空剧集提供可执行入口', () => {
  assert.match(filmCreateSource, /const hasAnyEpisode = computed\(\(\) => \(store\.drama\?\.episodes \|\| \[\]\)\.length > 0\)/)
  assert.match(filmCreateSource, /:has-episode="hasAnyEpisode"/)
  assert.match(filmCreateSource, /@add-episode="onAddEpisode"/)
  assert.match(headerSource, /class="header-add-episode"/)
  assert.match(scriptWorkbenchSource, /class="empty-tip film-episode-empty"/)
  assert.match(scriptWorkbenchSource, /还没有剧集/)
  assert.match(scriptWorkbenchSource, /aria-label="添加一集"/)
  assert.match(scriptWorkbenchSource, /aria-label="返回剧集管理"/)
  assert.match(scriptWorkbenchSource, /if \(props\.dramaId && !props\.hasAnyEpisode\) return '请先创建或选择剧集'/)
  assert.match(scriptWorkbenchSource, /template v-else/)
  assert.match(scriptWorkbenchSource, /class="script-title-input"/)
  assert.match(scriptWorkbenchSource, /<ActionGate :reason="generateStoryDisabledReason" label="生成剧本">/)
})

test('storyboard prompt dialogs name every editable field', () => {
  assert.doesNotMatch(storyboardDialogsSource, /<el-form-item label="">/)
  assert.match(storyboardDialogsSource, /<el-form-item label="原始图片提示词">/)
  assert.match(storyboardDialogsSource, /aria-label="原始图片提示词"/)
  assert.match(storyboardDialogsSource, /<el-form-item label="通用优化提示词">/)
  assert.match(storyboardDialogsSource, /aria-label="通用优化提示词"/)
  assert.match(storyboardDialogsSource, /<el-form-item label="视频提示词">/)
  assert.match(storyboardDialogsSource, /aria-label="视频提示词"/)
    assert.match(storyboardDialogsSource, /editingFramePromptSlot === 'last' \? '尾帧' : '首帧'\}图生提示词/)
})

test('制作页加载失败面保持可读状态和重试入口', () => {
  assert.match(filmCreateSource, /<FilmCreateProjectLoadState/)
  assert.match(filmCreateSource, /ref="projectLoadFailureRef"/)
  assert.match(filmCreateSource, /@retry="retryFilmProjectLoad"/)
  assert.match(projectLoadStateSource, /role="status"/)
  assert.match(projectLoadStateSource, /role="alert"/)
  assert.match(projectLoadStateSource, /正在加载制作项目/)
  assert.match(projectLoadStateSource, /制作项目不存在/)
  assert.match(projectLoadStateSource, /暂时无法打开制作项目/)
  assert.match(projectLoadStateSource, /项目数据没有被删除/)
  assert.match(projectLoadStateSource, /v-if="!notFound"[\s\S]*重试加载/)
  assert.match(projectLoadStateSource, /返回项目列表/)
  assert.match(projectLoadStateSource, /focus: \(\) => errorSectionRef\.value\?\.focus\?\.\(\)/)
})
