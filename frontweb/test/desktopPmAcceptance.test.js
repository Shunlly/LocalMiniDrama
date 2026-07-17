import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const routerSource = read('../src/router/index.js')
const aiConfigSource = read('../src/views/AiConfig.vue')
const dramaDetailSource = read('../src/views/DramaDetail.vue')
const sourceIntakeSource = read('../src/components/SourceIntakeWorkflowPanel.vue')
const filmListSource = read('../src/views/FilmList.vue')
const freeCreateSource = read('../src/views/FreeCreate.vue')
const canvasSource = read('../src/views/DramaCanvas.vue')
const filmCreateSource = read('../src/views/FilmCreate.vue')

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
    '/film/12',
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
  assert.match(filmListSource, /<article\s+v-for="d in dramas"[\s\S]*class="project-card"/)
  assert.match(filmListSource, /<RouterLink[\s\S]*class="project-card-link"[\s\S]*name: 'drama-detail'/)
  assert.match(filmListSource, /<\/RouterLink>\s*<el-dropdown[\s\S]*class="project-card-menu"/)
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
