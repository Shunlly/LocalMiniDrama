import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const routerSource = read('../src/router/index.js').replace(/\r\n?/g, '\n')
const aiConfigSource = read('../src/views/AiConfig.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const sourceIntakeSource = read('../src/components/SourceIntakeWorkflowPanel.vue')
const readinessSource = read('../src/components/ProjectReadinessPanel.vue')
const filmListSource = read('../src/views/FilmList.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const canvasSource = read('../src/views/DramaCanvas.vue')
const filmCreateSource = read('../src/views/FilmCreate.vue')
const filmCreatePipelineSource = read('../src/components/filmCreate/FilmCreatePipelinePanel.vue')
const mediaLibrarySource = read('../src/views/MediaLibrary.vue')

function extractUniqueCompletionSummaryRule(sourceText) {
  const styleStart = sourceText.indexOf('<style')
  const styleEnd = sourceText.lastIndexOf('</style>')
  assert.ok(styleStart >= 0 && styleEnd > styleStart, 'source workflow must retain a style block')
  const styleSource = sourceText.slice(styleStart, styleEnd)
  const selector = '.source-workflow-complete'
  const selectorOccurrences = styleSource.match(/\.source-workflow-complete\b/g) || []
  assert.equal(selectorOccurrences.length, 1, 'completion summary must have one CSS selector in the SFC')

  const ruleStart = styleSource.indexOf(`${selector} {`)
  assert.ok(ruleStart >= 0, 'completion summary must retain its primary CSS rule')
  const bodyStart = ruleStart + `${selector} {`.length
  const bodyEnd = styleSource.indexOf('\n}', bodyStart)
  assert.ok(bodyEnd > bodyStart, 'completion summary CSS rule must close')
  return styleSource.slice(bodyStart, bodyEnd)
}

test('project readiness defaults to a compact local-task-first surface', () => {
  assert.match(readinessSource, /data-testid="project-readiness-toggle"/)
  assert.match(readinessSource, /data-testid="project-readiness-details"/)
  assert.match(readinessSource, /defaultExpanded: \{ type: Boolean, default: false \}/)
  assert.match(readinessSource, /v-show="expanded"/)
})

async function loadReturnToNormalizer() {
  const start = routerSource.indexOf('export function normalizeAiConfigReturnTo')
  const end = routerSource.indexOf('\n\nconst router =', start)
  assert.ok(start >= 0 && end > start, 'returnTo normalizer must remain a standalone pure function')
  const helperModule = routerSource.slice(start, end)
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(helperModule)}`)
}

test('AI config returnTo accepts only valid first-party workspaces', async () => {
  const { normalizeAiConfigReturnTo } = await loadReturnToNormalizer()

  assert.equal(normalizeAiConfigReturnTo('/drama/12'), '/drama/12')
  assert.equal(normalizeAiConfigReturnTo('  /drama/12?tab=sources#intake  '), '/drama/12?tab=sources#intake')
  assert.equal(normalizeAiConfigReturnTo('/film/12?episode=4&focus=sb%3A42'), '/film/12?episode=4&focus=sb%3A42')
  assert.equal(normalizeAiConfigReturnTo(['/drama/7', 'https://evil.test']), '/drama/7')
  assert.equal(
    normalizeAiConfigReturnTo('/film/12/canvas?episode=4&focus=sb%3A99&ignored=1#drop'),
    '/film/12/canvas?episode=4&focus=sb%3A99',
  )
  assert.equal(normalizeAiConfigReturnTo('/free-create?mode=video&ignored=1'), '/free-create?mode=video')
  assert.equal(normalizeAiConfigReturnTo('/free-create?mode=bad'), '/free-create')

  for (const value of [
    '',
    '/',
    '/drama/0',
    '/drama/-1',
    '/drama/1/../2',
    '/ai-config',
    'https://evil.test/drama/12',
    '//evil.test/drama/12',
    'javascript:alert(1)',
    '/%2F%2Fevil.test/drama/12',
    null,
    undefined,
  ]) {
    assert.equal(normalizeAiConfigReturnTo(value), '', String(value))
  }

  assert.match(routerSource, /delete query\.returnTo/)
  assert.match(dramaDetailSource, /returnTo:\s*route\.fullPath/)
  assert.match(aiConfigSource, /router\.replace\(returnTo\.value \|\| \{ name: 'list' \}\)/)
  assert.match(aiConfigSource, /return '返回自由创作'/)
})

test('media library returnTo safely preserves the current film workspace', async () => {
  const { normalizeMediaLibraryReturnTo } = await loadReturnToNormalizer()
  assert.equal(normalizeMediaLibraryReturnTo('/film/12?episode=4&ignored=1#drop'), '/film/12?episode=4')
  assert.equal(
    normalizeMediaLibraryReturnTo('/film/12/canvas?episode=4&focus=sb%3A42&ignored=1'),
    '/film/12/canvas?episode=4&focus=sb%3A42',
  )
  assert.equal(normalizeMediaLibraryReturnTo('/film/12/canvas'), '/film/12/canvas')
  assert.equal(normalizeMediaLibraryReturnTo(['/film/7', 'https://evil.test']), '/film/7')
  for (const value of ['', '/', '/film/0', '/film/12/../13', '//evil.test/film/12', null]) {
    assert.equal(normalizeMediaLibraryReturnTo(value), '', String(value))
  }
  assert.match(routerSource, /name: 'media-library'[\s\S]*normalizeReturnTo: normalizeMediaLibraryReturnTo/)
  assert.match(mediaLibrarySource, /router\.push\(returnTo\.value \|\| '\/'\)/)
  assert.match(filmCreateSource, /returnTo: route\.fullPath/)
  assert.match(
    filmListSource,
    /path: `\/drama\/\$\{drama\.id\}`,[\s\S]{0,100}query: \{ returnTo: projectListReturnTo\.value \},[\s\S]{0,100}hash: '#source-intake-workflow'/,
  )
})

test('source intake advertises and validates every backend-supported upload extension', () => {
  const extensions = [
    '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json', '.pdf',
    '.png', '.jpg', '.jpeg', '.webp', '.gif',
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
    '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
  ]
  for (const extension of extensions) {
    assert.match(sourceIntakeSource, new RegExp(`['\"]${extension.replace('.', '\\.') }['\"]`), extension)
  }

  assert.match(sourceIntakeSource, /:accept="SOURCE_FILE_ACCEPT"/)
  assert.match(sourceIntakeSource, /本地素材文件/)
  assert.match(sourceIntakeSource, /支持文本、PDF、图片、音频和视频，单文件最大 20MB/)
  assert.match(sourceIntakeSource, /file\.size > MAX_SOURCE_FILE_BYTES/)
  assert.match(sourceIntakeSource, /SOURCE_FILE_EXTENSION_SET\.has\(extension\)/)
  assert.match(sourceIntakeSource, /TEXT_SOURCE_FILE_EXTENSIONS\.has\(extension\) && file\.size <= 2 \* 1024 \* 1024/)
  assert.match(sourceIntakeSource, /正在上传并解析/)
  assert.match(sourceIntakeSource, /role="status" aria-live="polite"/)
  assert.match(sourceIntakeSource, /role="alert"/)
})

test('source workflow navigation names the actual action and moves focus to its target', () => {
  assert.match(dramaDetailSource, /label: '前往素材处理'/)
  assert.doesNotMatch(dramaDetailSource, /label: '从素材生成剧集'/)
  assert.match(sourceIntakeSource, /id="source-intake-workflow" class="source-workflow-section" tabindex="-1"/)
  assert.match(dramaDetailSource, /target\.focus\(\{ preventScroll: true \}\)/)
})

test('source intake protects drafts, validates URLs early, and keeps mode recovery operable', () => {
  assert.match(sourceIntakeSource, /:error="sourceUrlValidationMessage"/)
  assert.match(sourceIntakeSource, /isValidHttpSourceUrl\(rawSourceUrl\.value\)/)
  assert.match(sourceIntakeSource, /onBeforeRouteLeave\(\(\) => confirmSourceInputLeave\(\)\)/)
  assert.match(sourceIntakeSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  assert.match(sourceIntakeSource, /:disabled="isWorkflowLaunchBusy"/)
  assert.doesNotMatch(sourceIntakeSource, /class="workflow-mode-control"[\s\S]{0,180}:disabled="isWorkflowLaunchBusy \|\| Boolean\(newWorkflowRunReason\)"/)
  assert.match(sourceIntakeSource, /草稿结构检查|qaPresentation\.scopeLabel/)
  assert.doesNotMatch(sourceIntakeSource, /Source Intake \/ Workflow \/ QA \/ Timeline/)
})

test('project cards use a keyboard link while keeping the action menu outside it', () => {
  assert.match(filmListSource, /<article\s+v-for="d in filteredDramas"[\s\S]*class="project-card"/)
  assert.match(filmListSource, /<RouterLink[\s\S]*class="project-card-link"[\s\S]*name: 'film'/)
  assert.match(filmListSource, /<\/RouterLink>\s*<RouterLink[\s\S]*class="project-card-assets"[\s\S]*<\/RouterLink>\s*<el-dropdown[\s\S]*class="project-card-menu"/)
  assert.match(filmListSource, /@click\.stop/)
  assert.match(filmListSource, /<el-dropdown-item command="trash"[\s\S]*移入回收站/)
  assert.match(filmListSource, /\.project-card-link:focus-visible/)
  assert.doesNotMatch(filmListSource, /@click="openProject\(d\.id\)"/)
})

test('project detail sticky header stays opaque over scrolled content', () => {
  assert.match(dramaDetailSource, /\.header\s*\{[\s\S]*?background:\s*#121216;/)
  assert.match(
    dramaDetailSource,
    /html\.light \.drama-detail \.header\s*\{[\s\S]*?background:\s*#ffffff !important;/,
  )
})

test('desktop creation surfaces keep focused tasks readable and user-facing', () => {
  assert.match(canvasSource, /nodes: \[nodeId\]/)
  assert.match(canvasSource, /minZoom: FOCUSED_NODE_MIN_ZOOM/)
  assert.match(canvasSource, /MIN_READABLE_CANVAS_ZOOM = 0\.9/)
  assert.match(canvasSource, /setFocusedNode: setFocusedCanvasNode/)
  assert.match(canvasSource, /returnQuery\.focus = focusedNodeId\.value/)
  assert.match(canvasSource, /returnTo,/)
  assert.match(freeCreateSource, /aria-label="返回项目首页"/)
  assert.match(freeCreateSource, /router\.push\(\{ name: 'list' \}\)/)
  assert.match(freeCreateSource, /<VideoCamera v-else \/>/)
  assert.match(freeCreateSource, /getServiceConfigReadiness\(activeServiceConfig\.value\)/)
  assert.match(freeCreateSource, /:disabled="generateDisabled"/)
  assert.match(freeCreateSource, /service_type: activeServiceType\.value/)
  assert.match(filmListSource, /router\.push\(\{ name: 'free-create' \}\)/)
  assert.doesNotMatch(freeCreateSource, /🎨|🎬/)
  assert.doesNotMatch(filmCreateSource, /经典模式双槽；图生前先走专业帧提示词模块/)
  assert.doesNotMatch(filmCreateSource, /每镜输出多子分镜段落式/)
  assert.match(filmCreateSource, /帮助视频保持镜头衔接/)
  assert.match(filmCreateSource, /可直接用于长提示词的分段描述/)
  assert.match(filmCreateSource, /草稿占位/)
  assert.doesNotMatch(filmCreateSource, /正在检查 Production|Draft 占位|FFmpeg 能力|TTS 配音失败|解说 TTS 失败/)
})

test('completed source workflows hand off to production without obscuring the episode list', () => {
  assert.match(sourceIntakeSource, /data-testid="source-workflow-complete"/)
  assert.match(sourceIntakeSource, /@click="\$emit\('enter-production'\)"/)
  assert.match(sourceIntakeSource, /@click="\$emit\('focus-episode-list'\)"/)
  const completionSummaryRule = extractUniqueCompletionSummaryRule(sourceIntakeSource)
  assert.equal((completionSummaryRule.match(/\bmax-height\s*:/g) || []).length, 1)
  assert.match(completionSummaryRule, /\bmax-height:\s*180px/)
  assert.doesNotMatch(completionSummaryRule, /^\s*height\s*:/m)
  assert.doesNotMatch(completionSummaryRule, /\bmax-block-size\s*:/)
  assert.match(completionSummaryRule, /border-bottom:\s*1px solid var\(--el-border-color\)/)
  assert.doesNotMatch(sourceIntakeSource, /source-workflow-complete[^>]*card/)
  assert.match(dramaDetailSource, /@enter-production="enterSourceWorkflowProduction"/)
  assert.match(dramaDetailSource, /@focus-episode-list="scrollToSection\('episode-list'\)"/)
  assert.match(
    dramaDetailSource,
    /function enterSourceWorkflowProduction\(\)[\s\S]*?episodes\.value\.find\(\(item\) => Number\(item\?\.id\) > 0\)[\s\S]*?goEpisode\(episode\.id\)/,
  )
})

test('film creation desktop keeps the pipeline focus above long content and anchors below the sticky header', () => {
  const pipelineIndex = filmCreateSource.indexOf('<FilmCreatePipelinePanel')
  const scriptWorkbenchIndex = filmCreateSource.indexOf('class="section card script-workbench-unified"')

  assert.ok(pipelineIndex >= 0, 'pipeline panel must remain in the film creation workspace')
  assert.ok(scriptWorkbenchIndex >= 0, 'script workbench must remain in the film creation workspace')
  assert.ok(pipelineIndex < scriptWorkbenchIndex, 'pipeline focus must be visible before the long script workbench')
  assert.match(filmCreateSource, /--film-create-sticky-offset:\s*84px/)
  assert.match(
    filmCreateSource,
    /\.main :is\(\[id\^="anchor-"\], \[id\^="sb-"\]\)\s*\{[\s\S]*?scroll-margin-top:\s*var\(--film-create-sticky-offset\)/,
  )
  assert.match(filmCreatePipelineSource, /class="pipeline-focus"/)
  assert.match(filmCreatePipelineSource, /当前阻断/)
  assert.match(filmCreatePipelineSource, /下一步/)
  assert.match(filmCreatePipelineSource, /<details\s+v-if="longFocusReason"/)
})
