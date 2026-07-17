const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const errors = [];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function existsRepo(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readRepo(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function scriptReferencesExist(pkg) {
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    const matches = String(script).matchAll(/\bnode\s+([^\s&|]+)/g);
    for (const match of matches) {
      const target = match[1].replace(/^"|"$/g, '');
      if (target.startsWith('-') || target.includes('*')) continue;
      assert(exists(target), `package script "${name}" references missing file: ${target}`);
    }
  }
}

function assertContainsAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert(source.includes(fragment), `${label} missing: ${fragment}`);
  }
}

function assertNoMojibake(relFiles) {
  const badChars = [
    0x7035, 0x7ef1, 0x93c1, 0x9422, 0x9359, 0x7459, 0x6d93, 0x7ecb, 0x93c8,
    0x7f03, 0x59af, 0x6769, 0x6d60, 0x9a9e, 0x59e3, 0x9343, 0x5bb8, 0x59ab, 0xfffd,
  ].map((cp) => String.fromCodePoint(cp));
  for (const rel of relFiles) {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');
    const hits = badChars.filter((char) => content.includes(char));
    assert(hits.length === 0, `${rel} contains mojibake characters: ${hits.map((char) => `U+${char.codePointAt(0).toString(16)}`).join(', ')}`);
  }
}

const pkg = JSON.parse(read('package.json'));
for (const script of ['check', 'test', 'audit', 'verify']) {
  assert(pkg.scripts && pkg.scripts[script], `package.json missing script: ${script}`);
}
assert(/check/.test(pkg.scripts.verify || '') && /test/.test(pkg.scripts.verify || '') && /audit/.test(pkg.scripts.verify || ''), 'verify must run check, test, and audit');
scriptReferencesExist(pkg);

const migration23 = read('migrations/23_novel2anime_workflows.sql');
for (const table of [
  'story_sources',
  'source_items',
  'story_events',
  'adaptation_plans',
  'workflow_runs',
  'workflow_steps',
  'qa_reports',
  'creative_reviews',
  'timeline_tracks',
  'timeline_items',
]) {
  assert(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i').test(migration23), `migration 23 missing table: ${table}`);
}

const migration24 = read('migrations/24_provider_skill_pipeline.sql');
for (const table of [
  'provider_invocations',
  'skill_registry',
  'skill_invocations',
  'story_event_edges',
]) {
  assert(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i').test(migration24), `migration 24 missing table: ${table}`);
}
assertContainsAll(migration24, [
  'localminidrama-source-intake',
  'localminidrama-script-adapter',
  'localminidrama-continuity-qa',
  'localminidrama-workflow-auditor',
  'localminidrama-provider-sdk',
], 'skill registry seed');

for (const rel of [
  'src/services/sourceIntakeService.js',
  'src/services/sourceMediaExtractionService.js',
  'src/services/workflowService.js',
  'src/services/qaService.js',
  'src/services/providerSdkService.js',
  'src/services/skillRegistryService.js',
  'src/services/legacyAsyncSchedulerService.js',
  'src/routes/storySources.js',
  'src/routes/workflows.js',
  'src/routes/qaReports.js',
  'test/novel2animeWorkflow.test.js',
  'test/sourceMediaExtraction.test.js',
  'test/serverLifecycle.test.js',
  'test/workflowDrainLifecycle.test.js',
]) {
  assert(exists(rel), `missing required file: ${rel}`);
}

const routesIndex = read('src/routes/index.js');
assertContainsAll(routesIndex, [
  '/workflows/novel2anime',
  '/workflows/:run_id/retry',
  '/workflows/:run_id/cancel',
  '/workflows/:run_id/pause',
  '/workflows/:run_id/resume',
  '/dramas/:id/story-sources',
  '/qa/reports',
  '/qa/reports/:report_id/remediate',
], 'routes/index.js');
assert(routesIndex.includes('legacy_import_novel'), 'legacy import-novel route must write through Source Intake when drama_id is supplied');

const app = read('src/app.js');
assert(app.includes('resumeActiveWorkflowRunsOnStartup'), 'app startup must resume active workflow runs');
assert(app.includes('ensureDefaultSkills'), 'app startup must seed skill registry');
assert(app.includes('createBackgroundTaskContextMiddleware'), 'API requests must run inside the background task context');

const sourceIntake = read('src/services/sourceIntakeService.js');
assertContainsAll(sourceIntake, [
  'persistRawSourceText',
  'story_event_edges',
  'event_edges',
], 'source intake service');

const workflow = read('src/services/workflowService.js');
assertContainsAll(workflow, [
  'workflowQueues',
  'backgroundTasks.assertAccepting()',
  'backgroundTasks.schedule(',
  'drainWorkflowQueue',
  'assertNovel2AnimeLaunchReadiness',
  'image_generation',
  'video_generation',
  'audio_generation',
  'post_composite',
  'pauseWorkflowRun',
  'resumeWorkflowRun',
  'localminidrama-provider-sdk',
  'timeline_plan',
  'transition',
], 'workflow service');
assert(!workflow.includes('setImmediate'), 'workflow scheduler must use the centralized queue, not setImmediate');

const qa = read('src/services/qaService.js');
assertContainsAll(qa, [
  'isRealMediaPath',
  'Final QA requires non-mock generated media',
  'story_event_edges',
  'provider_invocations',
  'skill_invocations',
  'requiredTrackTypes',
  'remediation_actions',
  'remediateQaReport',
  'refresh_asset_bible',
  'repair_storyboards',
  'repair_timeline',
  'legacy_async_audit',
  'skill_template_audit',
], 'QA service');

const providerSdk = read('src/services/providerSdkService.js');
assertContainsAll(providerSdk, [
  'recordProviderInvocation',
  'generateStoryboardImages',
  'generateStoryboardVideos',
  'generateStoryboardAudio',
  'compositeEpisodes',
], 'provider SDK service');

const storySourcesRoutes = read('src/routes/storySources.js');
assertContainsAll(storySourcesRoutes, [
  'uploadForDrama',
  'source_intake_upload',
  'extractUploadedSource',
  'sanitizeUploadMetadata',
], 'story sources routes');

const sourceMediaExtraction = read('src/services/sourceMediaExtractionService.js');
assertContainsAll(sourceMediaExtraction, [
  'MAX_SOURCE_UPLOAD_BYTES',
  'MAX_EXTRACTED_TEXT_BYTES',
  'detectMagic',
  'extractPdf',
  'ocrImageWithFallback',
  'transcribeAudio',
  'extractVideoAndTranscribe',
  'getFfmpegPath',
  'createTempDir',
  'extractUploadedSource',
], 'source media extraction service');
assert(!storySourcesRoutes.includes('Real PDF, image, audio, and video OCR/transcription intake is deferred'), 'story source upload must not claim implemented media extraction is deferred');

const timelineService = read('src/services/timelineService.js');
assertContainsAll(timelineService, [
  'getDramaTimeline',
  'getEpisodeTimeline',
  'exportEpisodeSrt',
  'exportDramaManifest',
], 'timeline service');

const asyncAudit = read('src/services/asyncAuditService.js');
assertContainsAll(asyncAudit, [
  'LEGACY_SET_IMMEDIATE_ALLOWLIST',
  'auditLegacyAsyncEntrypoints',
  'raw setImmediate usage must use legacyAsyncSchedulerService',
], 'async audit service');
const legacyScheduler = read('src/services/legacyAsyncSchedulerService.js');
assertContainsAll(legacyScheduler, [
  'AsyncLocalStorage',
  'createHook',
  'assertAccepting',
  'runTracked',
  'scheduleLegacyAsync',
  'shutdownBackgroundTasks',
  'getLegacyAsyncSchedulerState',
], 'legacy async scheduler service');

for (const rel of [
  'prompts/skills/source-intake.md',
  'prompts/skills/script-adapter.md',
  'prompts/skills/asset-bible.md',
  'prompts/skills/storyboard-draft.md',
  'prompts/skills/timeline-plan.md',
  'prompts/skills/continuity-qa.md',
]) {
  assert(exists(rel), `missing skill template: ${rel}`);
}

const asyncAuditService = require('../src/services/asyncAuditService');
const asyncResult = asyncAuditService.auditLegacyAsyncEntrypoints(root);
assert(asyncResult.passed, `legacy async audit failed: ${JSON.stringify(asyncResult.issues)}`);

const hasFullWorkspace = existsRepo('frontweb/src/utils/workflowRunStatus.js') && existsRepo('docker-compose.yml');
if (hasFullWorkspace) {
  const frontendWorkflowStatus = readRepo('frontweb/src/utils/workflowRunStatus.js');
  assertContainsAll(frontendWorkflowStatus, [
    'paused',
    'canPause',
    'canResume',
    'image_generation',
    'video_generation',
    'audio_generation',
    'post_composite',
  ], 'frontend workflow status');

  const rootPkg = JSON.parse(readRepo('package.json'));
  for (const script of ['docker:up', 'docker:down', 'verify', 'verify:docker']) {
    assert(rootPkg.scripts && rootPkg.scripts[script], `root package.json missing script: ${script}`);
  }
  for (const rel of ['docker-compose.yml', 'backend-node/Dockerfile', 'frontweb/Dockerfile', '.dockerignore']) {
    assert(existsRepo(rel), `missing Docker file: ${rel}`);
  }
  assertNoMojibake([
    'backend-node/src/services/sourceIntakeService.js',
    'backend-node/src/services/qaService.js',
    'frontweb/src/components/SourceIntakeWorkflowPanel.vue',
    'frontweb/src/utils/sourceIntakeAdapter.js',
    'frontweb/src/utils/workflowRunStatus.js',
    'frontweb/test/novel2animeWorkflowUi.test.js',
  ]);
}

if (errors.length) {
  console.error('Flow audit failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Flow audit passed.');
