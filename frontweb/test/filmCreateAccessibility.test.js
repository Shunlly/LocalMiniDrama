import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const filmCreateSource = readFileSync(
  new URL('../src/views/FilmCreate.vue', import.meta.url),
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
const resourcePanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateResourcePanel.vue', import.meta.url),
  'utf8',
)
const storyboardPanelSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateStoryboardPanel.vue', import.meta.url),
  'utf8',
)
const resourceDialogsSource = readFileSync(
  new URL('../src/components/filmCreate/FilmCreateResourceDialogs.vue', import.meta.url),
  'utf8',
)
const filmCreateUiSource = filmCreateSource + '\n' + deliveryPanelSource + '\n' + scriptWorkbenchSource + '\n' + resourcePanelSource + '\n' + storyboardPanelSource

test('film create navigation and resource disclosure controls use native buttons', () => {
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-toggle"[\s\S]*?:aria-expanded="!navCollapsed"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-step"[\s\S]*?:aria-current="activeNavAnchor === step\.anchor \? 'step' : undefined"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-step"[\s\S]*?@click="scrollToAnchor\(step\.anchor, step\.anchor\)"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-sub-toggle"[\s\S]*?:aria-expanded="storyboardMenuExpanded"/)
  assert.match(filmCreateSource, /<button[\s\S]*?class="nav-sub-item"[\s\S]*?@click="scrollToAnchor\('sb-' \+ sb\.id, 'anchor-storyboard-images'\)"/)
  assert.equal((filmCreateSource.match(/:aria-current=/g) || []).length, 1)
  assert.match(filmCreateSource, /\{ 'is-current': activeNavAnchor === step\.anchor \}/)

  const storyboardScriptAnchors = storyboardPanelSource.match(/id="anchor-storyboard"/g) || []
  const storyboardImageAnchors = storyboardPanelSource.match(/id="anchor-storyboard-images"/g) || []
  assert.equal(storyboardScriptAnchors.length, 1)
  assert.equal(storyboardImageAnchors.length, 1)
  assert.ok(
    storyboardPanelSource.indexOf('id="anchor-storyboard-images"')
      < storyboardPanelSource.indexOf('label="批量生成分镜图"'),
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
  assert.equal((filmCreateSource.match(/v-model="selectedEpisodeId"/g) || []).length, 0)
  assert.equal((filmCreateSource.match(/class="header-episode-select"/g) || []).length, 1)

  const selectStart = filmCreateSource.indexOf('class="header-episode-select"')
  const selectEnd = filmCreateSource.indexOf('</el-select>', selectStart)
  const episodeSelectSource = filmCreateSource.slice(selectStart, selectEnd)

  assert.match(filmCreateSource, /class="header-context-label">项目<\/span>/)
  assert.match(filmCreateSource, /class="header-context-label">当前集<\/span>/)
  assert.match(filmCreateSource, /<h1 class="page-title"\s+:title="projectPageTitle">\{\{ projectPageTitle \}\}<\/h1>/)
  assert.doesNotMatch(filmCreateSource, /<span class="page-title"/)
  assert.match(filmCreateSource, /\.page-title\s*\{[\s\S]*?margin:\s*0;/)
  assert.match(episodeSelectSource, /aria-label="当前集"/)
  assert.match(episodeSelectSource, /:model-value="selectedEpisodeId"/)
  assert.match(episodeSelectSource, /:loading="episodeSwitching"/)
  assert.match(episodeSelectSource, /:disabled="episodeSwitching"/)
  assert.match(episodeSelectSource, /:aria-busy="episodeSwitching"/)
  assert.match(episodeSelectSource, /v-for="\(ep, index\) in \(store\.drama\?\.episodes \|\| \[\]\)"/)
  assert.match(episodeSelectSource, /:label="formatEpisodeContextLabel\(ep, index\)"/)
  assert.doesNotMatch(episodeSelectSource, /\bclearable\b/)
})

test('film create navigation names and reports the final delivery step accurately', () => {
  assert.match(
    filmCreateSource,
    /label: '交付与导出',\s+anchor: 'anchor-video',\s+status: compositeStatus/,
  )
  assert.match(filmCreateSource, /if \(isPlaceholderMediaUrl\(s\)\) return ''/)
  assert.match(filmCreateSource, /currentEpisodeVideoUrl\.value\s*\? 'done'/)
  assert.doesNotMatch(
    filmCreateSource,
    /label: '分镜视频',\s+anchor: 'anchor-video'/,
  )
})

test('delivery stage consolidates composite readiness and user-facing export actions', () => {
  assert.match(filmCreateSource, /<FilmCreateDeliveryPanel/)
  assert.match(deliveryPanelSource, /<section id="anchor-video" class="section card delivery-section">/)
  assert.match(deliveryPanelSource, /<h2 class="section-title">交付与导出<\/h2>/)
  assert.match(deliveryPanelSource, /分镜视频[\s\S]*playableStoryboardVideoCount[\s\S]*整集合成[\s\S]*可交付文件/)
  assert.match(filmCreateSource, /@download-video="downloadCurrentEpisodeVideo"/)
  assert.match(filmCreateSource, /@download-subtitle="downloadCurrentEpisodeSubtitle"/)
  assert.match(filmCreateSource, /@export-project="exportCurrentProjectPackage"/)
  assert.match(filmCreateSource, /const deliverySubtitleAvailable = computed\(\(\) => storyboards\.value\.some/)
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
  assert.match(filmCreateSource, /@return-to-creation="returnToScriptCreation"/)
  assert.match(resourceDialogsSource, /class="library-empty"[\s\S]*?@click="returnToCharacterPanel"/)
  assert.match(scriptWorkspaceSource, /function returnToScriptCreation\(\)/)
  assert.match(scriptWorkspaceSource, /function returnToCharacterPanel\(\)/)
})

test('every FilmCreate ActionGate identifies its button action', () => {
  const actionGates = filmCreateUiSource.match(/<ActionGate\b[^>]*>/g) || []
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
  assert.match(pipelinePanelSource, /forceExpanded:\s*computed\(\(\) => props\.running\)/)
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
test('制作页空剧集提供可执行入口', () => {
  assert.match(filmCreateSource, /const hasAnyEpisode = computed\(\(\) => \(store\.drama\?\.episodes \|\| \[\]\)\.length > 0\)/)
  assert.match(filmCreateSource, /:has-episode="hasAnyEpisode"/)
  assert.match(filmCreateSource, /@add-episode="onAddEpisode"/)
  assert.match(filmCreateSource, /class="header-add-episode"/)
  assert.match(scriptWorkbenchSource, /class="empty-tip film-episode-empty"/)
  assert.match(scriptWorkbenchSource, /还没有剧集/)
  assert.match(scriptWorkbenchSource, /返回剧集管理/)
})
