const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const { version: PACKAGE_VERSION } = require('../package.json')
const { REQUIRED_FINAL_CAPTURES, inspectPng } = require('./acceptance-report-contract.cjs')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_EVIDENCE_ROOT = path.join(PROJECT_ROOT, 'artifacts', 'e2e-production')
const EVIDENCE_SCHEMA = 'localminidrama.production-e2e-evidence.v1'
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3013').replace(/\/$/, '')
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:5679').replace(/\/$/, '')
const PROVIDER_BASE_URL = (process.env.E2E_PROVIDER_BASE_URL || 'http://e2e-provider:5688/v1').replace(/\/$/, '')
const PROVIDER_CONTROL_URL = (process.env.E2E_PROVIDER_CONTROL_URL || 'http://127.0.0.1:5688').replace(/\/$/, '')
const PROVIDER_TOKEN = process.env.E2E_PROVIDER_TOKEN || 'local-e2e-token'
const CONFIG_PREFIX = 'E2E Production Provider '
const WORKFLOW_COMPLETION_RECOVERY_TIMEOUT = 5000
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const REQUIRED_PROVIDER_TYPES = Object.freeze(['text', 'asset_image', 'image', 'video', 'tts', 'compositor'])
const REQUIRED_PROVIDER_ENDPOINTS = Object.freeze(['text', 'image', 'video', 'tts'])
const REQUIRED_TRACK_TYPES = Object.freeze(['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'])
const OPTIONAL_TRACK_TYPES = new Set(['effect', 'bgm', 'transition'])
const PROVIDER_PRICING = Object.freeze({
  text: { input_per_million_tokens: 10, output_per_million_tokens: 20 },
  image: { per_image: 0.01 },
  storyboard_image: { per_image: 0.01 },
  video: { per_second: 0.02 },
  tts: { per_1000_characters: 0.5 },
})
const PROVIDER_SELECTION_OPTIONS = Object.freeze({
  text_model: 'local-e2e-text',
  text_provider: 'openai_compatible',
  asset_image_model: 'local-e2e-image',
  asset_image_provider: 'openai_compatible',
  image_model: 'local-e2e-image',
  image_provider: 'openai_compatible',
  video_model: 'local-e2e-video',
  video_provider: 'openai_compatible',
  tts_model: 'local-e2e-tts',
  tts_provider: 'openai_compatible',
})
const DESKTOP_VIEWPORTS = Object.freeze([
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
])
const FOCUSED_DESKTOP_VIEWPORT = Object.freeze({ width: 1280, height: 720 })
const AI_TWO_COLUMN_VIEWPORT = Object.freeze({ width: 1024, height: 768 })
const UI = Object.freeze({
  workflowTitle: '\u6545\u4e8b\u7d20\u6750\u6d41\u7a0b',
  intakeStep: '\u5bfc\u5165\u7d20\u6750',
  draftMode: '\u8349\u7a3f\u9884\u6f14',
  startDraft: '\u4ee5 \u8349\u7a3f\u9884\u6f14 \u542f\u52a8',
  productionMode: '\u6b63\u5f0f\u5236\u4f5c',
  startProduction: '\u4ee5 \u6b63\u5f0f\u5236\u4f5c \u542f\u52a8',
  refresh: '\u5237\u65b0',
  timelineStep: '\u5267\u96c6 / \u65f6\u95f4\u7ebf',
  continueImport: '\u7ee7\u7eed\u5bfc\u5165\u6545\u4e8b\u7d20\u6750',
  workflowHistory: '\u6d41\u7a0b\u8bb0\u5f55',
  enterProduction: '\u8fdb\u5165\u5236\u4f5c',
  returnToDrama: '\u8fd4\u56de\u5267\u96c6',
  deliveryExport: '\u4ea4\u4ed8\u4e0e\u5bfc\u51fa',
  collapseNavigation: '\u6536\u8d77\u5bfc\u822a',
  expandNavigation: '\u5c55\u5f00\u5bfc\u822a',
  sourcePlaceholder: '\u7c98\u8d34\u5c0f\u8bf4\u3001\u6897\u6982\u3001\u5267\u672c\u3001\u5206\u955c\u8868\u3001\u6f2b\u753b\u6587\u5b57\u8bf4\u660e\u6216\u8f6c\u5199\u6587\u672c',
  newProject: '\u65b0\u5efa\u9879\u76ee',
  confirm: '\u786e\u5b9a',
  importOnly: '\u5bfc\u5165\u6545\u4e8b\u7d20\u6750',
  retryLoad: '\u91cd\u8bd5\u52a0\u8f7d',
  downloadFinal: '\u4e0b\u8f7d\u6210\u7247',
  exportProject: '\u5bfc\u51fa\u9879\u76ee',
  currentEpisode: '\u5f53\u524d\u96c6',
  openStoryMaterials: (title) => `\u6253\u5f00\u9879\u76ee\u300c${title}\u300d\u7684\u6545\u4e8b\u7d20\u6750\u6d41\u7a0b`,
  aiConfiguration: '\u0041\u0049\u914d\u7f6e',
  addConfiguration: '\u6dfb\u52a0\u914d\u7f6e',
  configureMissingService: '\u914d\u7f6e\u7f3a\u5931\u670d\u52a1',
  returnToProduction: '\u8fd4\u56de\u5236\u4f5c',
  configurationRechecking: '\u914d\u7f6e\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u91cd\u65b0\u68c0\u67e5',
  retryCapability: '\u91cd\u8bd5\u80fd\u529b\u68c0\u67e5',
  generateFinal: '\u4e00\u952e\u751f\u6210\u6210\u7247',
})

const SENSITIVE_KEY_PATTERN = /^(?:authorization|proxy_authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|credentials|cookie|set_cookie|base[_-]?url|provider[_-]?config)$/i
const SENSITIVE_TEXT_PATTERN = /\b(?:authorization|proxy[-_ ]authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|credentials?)\b\s*[:=]?\s*(?:bearer\s+)?[^\s,;}\]]*/gi
let smokeHelpers = null

function getSmokeHelpers() {
  if (!smokeHelpers) smokeHelpers = require('./e2e-smoke.cjs')
  return smokeHelpers
}

function registerCleanup(actions, label, run) {
  return getSmokeHelpers().registerCleanup(actions, label, run)
}

async function runCleanup(actions, logger) {
  if (actions.length === 0) return []
  return getSmokeHelpers().runCleanup(actions, logger)
}

function createWorkflowDrainPrerequisite() {
  let failure = null
  return {
    async drain(runId, waitForDrain = waitForWorkflowWorkerDrain) {
      try {
        return await waitForDrain(runId)
      } catch (error) {
        failure ||= error
        throw error
      }
    },
    assertDrained() {
      if (!failure) return
      const error = new Error(
        `E2E destructive cleanup blocked because workflow drain failed: ${failure.message || String(failure)}`,
      )
      error.cause = failure
      throw error
    },
  }
}

function runDockerFixturePurge(options) {
  return getSmokeHelpers().runDockerFixturePurge(options)
}

function defaultLaunchBrowser(options) {
  return require('playwright').chromium.launch(options)
}

function resolveSourceIdentity(explicit = null) {
  if (explicit) {
    return {
      commit: String(explicit.commit || '').trim().toLowerCase(),
      version: String(explicit.version || '').trim(),
      working_tree_dirty: Boolean(explicit.working_tree_dirty),
    }
  }

  const envCommit = String(process.env.GITHUB_SHA || '').trim()
  let commit = /^[0-9a-f]{40,64}$/i.test(envCommit) ? envCommit : ''
  if (!commit) {
    commit = String(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    })).trim()
  }
  const status = String(execFileSync('git', ['status', '--porcelain'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }))
  return {
    commit: commit.toLowerCase(),
    version: PACKAGE_VERSION,
    working_tree_dirty: status.trim().length > 0,
  }
}

function collectForbiddenValues(additional = []) {
  const environmentSecrets = Object.entries(process.env)
    .filter(([key, value]) => value && /(?:authorization|api[_-]?key|token|secret|password|credential)/i.test(key))
    .map(([, value]) => String(value))
  return [...new Set([PROVIDER_TOKEN, ...environmentSecrets, ...additional]
    .map((value) => String(value || ''))
    .filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length)
}

function sanitizeEvidenceText(value, forbiddenValues = [], maxLength = 2000) {
  let sanitized = String(value || '')
  for (const forbidden of forbiddenValues) {
    sanitized = sanitized.split(forbidden).join('[REDACTED]')
  }
  sanitized = sanitized
    .replace(
      /(["'])(?:authorization|proxy[-_ ]authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|credentials?|base[-_ ]?url|provider[-_ ]?config)\1\s*:\s*(["'])[^"'\r\n]*\2/gi,
      '"sensitive-field":"[REDACTED]"',
    )
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, 'authentication-data [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(SENSITIVE_TEXT_PATTERN, 'sensitive-data [REDACTED]')
    .replace(/\b(?:base[-_ ]?url|provider[-_ ]?config)\b\s*[:=]\s*[^\s,;}\]]*/gi, 'sensitive-config [REDACTED]')
    .replace(/([?&](?:key|token|secret|password)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s,;}\]]+/gi, '[URL]')
    .replace(
      /\b(?:authorization|proxy[-_ ]authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|credentials?|base[-_ ]?url|provider[-_ ]?config)\b/gi,
      'sensitive-field',
    )
  return Number.isFinite(maxLength) ? sanitized.slice(0, maxLength) : sanitized
}

function sanitizeEvidenceValue(value, forbiddenValues = []) {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeEvidenceText(value, forbiddenValues)
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidenceValue(item, forbiddenValues))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, item]) => [key, sanitizeEvidenceValue(item, forbiddenValues)]))
  }
  return sanitizeEvidenceText(value, forbiddenValues)
}

function mergeEvidence(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      mergeEvidence(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

function assertEvidenceSerializationSafe(serialized, forbiddenValues = []) {
  for (const forbidden of forbiddenValues) {
    assert.equal(serialized.includes(forbidden), false, 'E2E evidence contains a protected value')
  }
  assert.doesNotMatch(
    serialized,
    /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|credentials?|base[-_ ]?url|provider[-_ ]?config)\b/i,
    'E2E evidence contains authentication or credential data',
  )
}

function assertEvidencePayloadSafe(bytes, forbiddenValues = [], label = 'artifact') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  for (const forbidden of forbiddenValues) {
    assert.equal(buffer.includes(Buffer.from(forbidden)), false, `${label} contains a protected value`)
  }
  const text = buffer.toString('utf8')
  assert.doesNotMatch(
    text,
    /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|credentials?|base[-_ ]?url|provider[-_ ]?config)\b["']?\s*[:=]/i,
    `${label} contains authentication or sensitive configuration data`,
  )
}

function normalizeArtifactPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '')
  assert.ok(normalized && !path.posix.isAbsolute(normalized), 'evidence artifact path must be relative')
  assert.equal(normalized.split('/').includes('..'), false, 'evidence artifact path must not traverse directories')
  return normalized
}

function assertArtifactDescriptor(descriptor, label) {
  assert.ok(descriptor && typeof descriptor === 'object', `${label} evidence is required`)
  assert.ok(String(descriptor.path || '').trim(), `${label} evidence path is required`)
  assert.ok(Number(descriptor.bytes) > 0, `${label} evidence byte count must be positive`)
  assert.match(String(descriptor.sha256 || ''), /^[0-9a-f]{64}$/, `${label} evidence SHA-256 is invalid`)
}

function assertCompleteEvidence(evidence) {
  assert.equal(evidence.schema, EVIDENCE_SCHEMA)
  assert.match(evidence.source.commit, /^[0-9a-f]{40,64}$/, 'E2E evidence must bind a Git commit')
  assert.match(evidence.source.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'E2E evidence must bind a version')
  assert.equal(
    typeof evidence.source.working_tree_dirty,
    'boolean',
    'E2E evidence must record whether the working tree was dirty',
  )
  assert.equal(
    evidence.source.working_tree_dirty,
    false,
    'E2E acceptance evidence requires a clean Git working tree',
  )
  assert.equal(evidence.qa.status, 'passed', 'E2E QA evidence must pass')
  assert.equal(evidence.qa.passed, true, 'E2E QA conclusion must be true')
  assert.equal(evidence.provider.reset_observed, true, 'E2E evidence must bind provider counts to this run')
  for (const endpoint of REQUIRED_PROVIDER_ENDPOINTS) {
    assert.ok(evidence.provider.calls[endpoint].attempted > 0, `E2E evidence is missing ${endpoint} provider attempts`)
    assert.ok(evidence.provider.calls[endpoint].succeeded > 0, `E2E evidence is missing ${endpoint} provider successes`)
    assert.equal(evidence.provider.calls[endpoint].failed, 0, `E2E evidence contains failed ${endpoint} provider calls`)
  }
  for (const type of REQUIRED_PROVIDER_TYPES) {
    assert.ok(evidence.provider.workflow_invocations[type] > 0, `E2E evidence is missing ${type} workflow invocations`)
  }
  for (const [key, label] of [
    ['png', 'PNG'],
    ['mp3', 'MP3'],
    ['mp4', 'MP4'],
    ['composed_video', 'composed video'],
    ['final_video', 'final video download'],
    ['project_zip', 'project ZIP download'],
  ]) {
    assertArtifactDescriptor(evidence.artifacts[key], label)
  }
  assert.equal(evidence.browser.status, 'passed', 'browser acceptance evidence must pass')
  assert.equal(evidence.browser.final_download.status, 'passed', 'browser final-video download status must pass')
  assert.equal(evidence.browser.final_download.validated, true, 'browser final-video download must be validated')
  assert.equal(evidence.browser.project_export.status, 'passed', 'browser project export status must pass')
  assert.equal(evidence.browser.project_export.validated, true, 'browser project export must be validated')
  const focused = evidence.browser.focused_acceptance
  assert.equal(focused.status, 'passed', 'focused desktop acceptance evidence must pass')
  assert.deepEqual(focused.primary_viewport, FOCUSED_DESKTOP_VIEWPORT)
  assert.deepEqual(focused.ai_two_column_viewport, AI_TWO_COLUMN_VIEWPORT)
  assert.ok(Number(focused.episode.id) > 0, 'focused acceptance must identify the initial episode')
  assert.equal(focused.episode.label, focused.episode.visible_label, 'focused episode title and visible label must match')
  assert.equal(focused.episode.aria_label, UI.currentEpisode, 'focused episode selector must retain its accessible name')
  assert.equal(Number(focused.episode.initial_route_id), Number(focused.episode.id), 'focused initial episode route is incorrect')
  assert.ok(String(focused.episode.initial_script_title || '').trim(), 'focused initial script title is required')
  assert.ok(Number(focused.episode.switched_id) > 0, 'focused acceptance must switch to another episode')
  assert.notEqual(Number(focused.episode.switched_id), Number(focused.episode.id), 'focused episode switch must change ids')
  assert.ok(String(focused.episode.switched_label || '').trim(), 'focused switched episode label is required')
  assert.equal(
    Number(focused.episode.switched_route_id),
    Number(focused.episode.switched_id),
    'focused switched episode route is incorrect',
  )
  assert.ok(String(focused.episode.switched_script_title || '').trim(), 'focused switched script title is required')
  assert.ok(
    focused.episode.switched_label.replace(/\s+/g, '').includes(
      focused.episode.switched_script_title.replace(/\s+/g, ''),
    ),
    'focused switched episode label must identify its script title',
  )
  assert.equal(Number(focused.episode.restored_id), Number(focused.episode.id), 'focused acceptance must restore the original episode id')
  assert.equal(Number(focused.episode.restored_route_id), Number(focused.episode.id), 'focused restored episode route is incorrect')
  assert.equal(focused.episode.restored_label, focused.episode.label, 'focused acceptance must restore the original episode label')
  assert.equal(
    focused.episode.restored_script_title,
    focused.episode.initial_script_title,
    'focused acceptance must restore the original script title',
  )
  assert.equal(focused.episode.switch_restored, true, 'focused acceptance must restore the original episode')
  assert.equal(focused.source_handoff.project_card_entry, true)
  assert.equal(focused.source_handoff.return_hash, '#source-intake-workflow')
  assert.equal(focused.source_handoff.compact_complete, true)
  assert.equal(focused.source_handoff.entered_production, true)
  assert.equal(focused.navigation.current_count, 1)
  assert.ok(focused.navigation.completed_distinct_count > 0)
  assert.deepEqual(focused.ai.service_order, ['video', 'image', 'text', 'tts', 'storyboard_image'])
  assert.deepEqual(focused.ai.action_counts, [1, 1, 0, 1, 0])
  assert.equal(focused.ai.mutation.method, 'POST')
  assert.equal(focused.ai.mutation.service_type, 'text')
  assert.equal(focused.ai.mutation.is_default, false)
  assert.equal(focused.ai.native_close_focus_restored, true)
  assert.equal(focused.ai.custom_return_focus_restored, true)
  assert.equal(focused.ai.columns_1280, 5)
  assert.equal(focused.ai.columns_1024, 2)
  assert.ok(focused.ai.minimum_target_size >= 32)
  assert.equal(focused.pipeline.initial_state, 'blocked')
  assert.equal(focused.pipeline.post_mutation_state, 'checking')
  assert.equal(focused.pipeline.injected_failure_state, 'error')
  assert.equal(focused.pipeline.final_state, 'ready')
  assert.equal(focused.readiness.injected_failure_status, 503)
  assert.equal(focused.readiness.retry_status, 200)
  assert.equal(focused.readiness.final_missing_capabilities, 0)
  assert.equal(focused.provider_calls_unchanged, true)
  assert.equal(focused.document_overflow['1280x720'].passed, true)
  assert.equal(focused.document_overflow['1024x768'].passed, true)
  for (const records of [
    focused.component_overflow['1280x720'],
    focused.component_overflow['1024x768'],
  ]) {
    assert.ok(Array.isArray(records) && records.length > 0, 'focused component overflow evidence is required')
    for (const record of records) {
      assert.ok(record.scroll_width <= record.client_width + 1, `${record.selector} has horizontal overflow`)
    }
  }
  assert.equal(focused.cleanup.exact_name_registered, true)
  assert.equal(focused.cleanup.created_id_registered, true)
  assert.equal(focused.cleanup.visible_config_removed, true)
  assert.equal(focused.cleanup.fixture_restored, true)
  assert.equal(focused.cleanup.routes_disposed, true)
  assert.equal(focused.cleanup.listeners_disposed, true)
  assert.equal(focused.cleanup.gate_disposed, true)
  assert.equal(focused.cleanup.page_closed, true)
  assert.equal(focused.screenshots.length, REQUIRED_FINAL_CAPTURES.length)
  assert.deepEqual(
    focused.screenshots.map((item) => `${item.surface}:${item.viewport.width}x${item.viewport.height}:${item.theme}`),
    REQUIRED_FINAL_CAPTURES.map((item) => `${item.surface}:${item.width}x${item.height}:${item.theme}`),
  )
  for (const screenshot of focused.screenshots) assertArtifactDescriptor(screenshot, 'focused screenshot')
  assert.ok(evidence.browser.playback.length >= 2, 'browser playback evidence must cover both desktop viewports')
  for (const viewport of evidence.browser.playback) {
    assert.equal(viewport.composed.played, true, 'composed video must play in the browser')
    assert.equal(viewport.composed.ended, true, 'composed video must reach its ended state in the browser')
    assert.equal(viewport.composed.unicode_path, true, 'composed video must exercise a Unicode storage path')
    assert.equal(viewport.storyboard.played, true, 'storyboard video must play in the browser')
    assert.equal(viewport.storyboard.ended, true, 'storyboard video must reach its ended state in the browser')
    assert.equal(viewport.storyboard.unicode_path, true, 'storyboard video must exercise a Unicode storage path')
  }
  assert.equal(evidence.cleanup.status, 'passed', 'E2E cleanup evidence must pass')
  const mediaCleanup = evidence.cleanup.media_cleanup
  assert.ok(mediaCleanup?.candidates > 0, 'E2E cleanup must account for generated media')
  assert.equal(mediaCleanup.deleted, mediaCleanup.candidates, 'E2E cleanup must delete every generated media file')
  assert.equal(mediaCleanup.missing, 0, 'E2E cleanup must not lose generated media before purge')
  assert.equal(mediaCleanup.shared, 0, 'E2E fixture media must not be shared with retained projects')
  return evidence
}

async function createEvidenceRecorder({
  evidenceRoot = process.env.E2E_EVIDENCE_DIR || DEFAULT_EVIDENCE_ROOT,
  sourceIdentity = null,
  now = Date.now,
  forbiddenValues = [],
} = {}) {
  const root = path.resolve(PROJECT_ROOT, evidenceRoot)
  const identity = resolveSourceIdentity(sourceIdentity)
  assert.match(identity.commit, /^[0-9a-f]{40,64}$/, 'Production E2E requires a valid Git commit')
  assert.match(identity.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Production E2E requires a valid version')
  const protectedValues = collectForbiddenValues(forbiddenValues)
  const evidencePath = path.join(root, 'evidence.json')
  const logPath = path.join(root, 'run.log')
  const timestamp = () => new Date(now()).toISOString()
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    status: 'running',
    source: identity,
    run: {
      started_at: timestamp(),
      finished_at: null,
      failed_stage: null,
    },
    qa: { status: 'not_run', passed: null, score: null, mode: 'production' },
    provider: {
      protocol: 'openai-compatible-local-fixture',
      reset_observed: false,
      calls: Object.fromEntries(REQUIRED_PROVIDER_ENDPOINTS.map((type) => [type, {
        attempted: 0,
        succeeded: 0,
        failed: 0,
      }])),
      workflow_invocations: Object.fromEntries(REQUIRED_PROVIDER_TYPES.map((type) => [type, 0])),
    },
    artifacts: {
      png: null,
      mp3: null,
      mp4: null,
      composed_video: null,
      final_video: null,
      api_project_zip: null,
      project_zip: null,
    },
    browser: {
      status: 'not_run',
      playback: [],
      final_download: { status: 'not_run', validated: false },
      project_export: { status: 'not_run', validated: false },
    },
    workflow: {},
    stages: [],
    failure: null,
  }
  let currentStage = 'initialize'

  async function write() {
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`
    assertEvidenceSerializationSafe(serialized, protectedValues)
    await fs.writeFile(evidencePath, serialized, 'utf8')
  }

  async function log(event, details = {}) {
    const entry = sanitizeEvidenceValue({ at: timestamp(), event, ...details }, protectedValues)
    const serialized = `${JSON.stringify(entry)}\n`
    assertEvidenceSerializationSafe(serialized, protectedValues)
    await fs.appendFile(logPath, serialized, 'utf8')
  }

  await fs.mkdir(root, { recursive: true })
  await resetAcceptanceReportArtifacts(root)
  await fs.writeFile(logPath, '', 'utf8')
  await write()
  await log('evidence_initialized', { commit: identity.commit, version: identity.version })

  return {
    root,
    evidencePath,
    logPath,
    currentStage: () => currentStage,
    snapshot: () => structuredClone(evidence),
    async stage(name, status = 'started', details = {}) {
      currentStage = String(name)
      evidence.stages.push(sanitizeEvidenceValue({ name, status, at: timestamp(), ...details }, protectedValues))
      await log('stage', { name, status })
      await write()
    },
    async set(patch) {
      mergeEvidence(evidence, sanitizeEvidenceValue(patch, protectedValues))
      await write()
    },
    async persistArtifact(relativePath, bytes, evidenceKey = null) {
      const artifactPath = normalizeArtifactPath(relativePath)
      if (evidenceKey !== null) {
        assert.equal(
          Object.hasOwn(evidence.artifacts, evidenceKey),
          true,
          `unknown evidence artifact key ${evidenceKey}`,
        )
      }
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
      assert.ok(buffer.length > 0, `evidence artifact ${artifactPath} must not be empty`)
      assertEvidencePayloadSafe(buffer, protectedValues, `evidence artifact ${artifactPath}`)
      const destination = path.resolve(root, ...artifactPath.split('/'))
      assert.equal(destination.startsWith(`${root}${path.sep}`), true, 'evidence artifact escaped the evidence root')
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, buffer)
      const descriptor = {
        path: artifactPath,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      }
      if (evidenceKey !== null) {
        evidence.artifacts[evidenceKey] = descriptor
        await write()
      }
      await log('artifact_persisted', { path: descriptor.path, bytes: descriptor.bytes, sha256: descriptor.sha256 })
      return descriptor
    },
    assertSafePayload(bytes, label) {
      assertEvidencePayloadSafe(bytes, protectedValues, label)
    },
    async pass() {
      assertCompleteEvidence(evidence)
      evidence.status = 'passed'
      evidence.run.finished_at = timestamp()
      evidence.run.failed_stage = null
      evidence.failure = null
      await log('run_finished', { status: 'passed' })
      await write()
      return structuredClone(evidence)
    },
    async fail(error, failedStage = currentStage) {
      const failure = error instanceof Error ? error : new Error(String(error))
      evidence.status = 'failed'
      evidence.run.finished_at = timestamp()
      evidence.run.failed_stage = String(failedStage)
      evidence.failure = sanitizeEvidenceValue({
        name: failure.name || 'Error',
        message: failure.message || String(failure),
      }, protectedValues)
      await log('run_finished', { status: 'failed', stage: failedStage, failure: evidence.failure })
      await write()
      return structuredClone(evidence)
    },
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function flowStepButton(workflow, label) {
  return workflow.getByRole('button', {
    name: new RegExp(`^(?:(?:\\d+|\u2713)\\s+)?${escapeRegExp(label)}(?:\\s|$)`),
  })
}

async function revealWorkflowHistoryIfCompleted(workflow) {
  const completion = workflow.getByTestId('source-workflow-complete')
  if (!await completion.isVisible()) {
    try {
      await completion.waitFor({ state: 'visible', timeout: WORKFLOW_COMPLETION_RECOVERY_TIMEOUT })
    } catch (error) {
      if (error?.name === 'TimeoutError') return false
      throw error
    }
  }
  const historyToggle = completion.getByRole('button', { name: UI.workflowHistory, exact: true })
  if (await historyToggle.getAttribute('aria-expanded') === 'true') return false
  await historyToggle.click()
  assert.equal(await historyToggle.getAttribute('aria-expanded'), 'true', 'compact workflow history must expand before selecting a step')
  return true
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function waitForAbortableRetryDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, abortError(signal))
    const timeoutId = setTimeout(() => finish(resolve), milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchWithIdempotentRetry(url, options = {}, fetchImpl = fetch, retryDelay = waitForAbortableRetryDelay) {
  const method = String(options.method || 'GET').toUpperCase()
  const attempts = method === 'GET' ? 3 : 1
  const { signal } = options
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw abortError(signal)
    try {
      return await fetchImpl(url, options)
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      lastError = error
      if (attempt >= attempts) throw error
      await retryDelay(attempt * 100, signal)
    }
  }
  throw lastError
}

async function apiRequest(pathname, options = {}) {
  const response = await fetchWithIdempotentRetry(`${BACKEND_URL}/api/v1${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Origin: FRONTEND_ORIGIN,
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    throw new Error(`API ${pathname} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body.data
}

async function providerControlRequest(pathname, method = 'GET') {
  const response = await fetch(`${PROVIDER_CONTROL_URL}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${PROVIDER_TOKEN}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`E2E provider control ${pathname} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return body
}

async function deleteConfig(id) {
  const response = await fetch(`${BACKEND_URL}/api/v1/ai-configs/${id}`, {
    method: 'DELETE',
    headers: { Origin: FRONTEND_ORIGIN },
  })
  if (response.status !== 404 && !response.ok) {
    throw new Error(`Failed to delete E2E AI config ${id}: HTTP ${response.status}`)
  }
}

async function installProviderConfigs(stamp) {
  const definitions = [
    ['text', 'local-e2e-text', '/chat/completions'],
    ['image', 'local-e2e-image', '/images/generations'],
    ['storyboard_image', 'local-e2e-image', '/images/generations'],
    ['video', 'local-e2e-video', '/video/generations'],
    ['tts', 'local-e2e-tts', ''],
  ]
  const state = { created: [] }
  try {
    for (const [serviceType, model, endpoint] of definitions) {
      const config = await apiRequest('/ai-configs', {
        method: 'POST',
        body: JSON.stringify({
          service_type: serviceType,
          provider: 'openai_compatible',
          api_protocol: 'openai',
          name: `${CONFIG_PREFIX}${serviceType} ${stamp}`,
          base_url: PROVIDER_BASE_URL,
          api_key: PROVIDER_TOKEN,
          model: [model],
          default_model: model,
          endpoint,
          priority: 100000,
          is_default: false,
          is_active: true,
          settings: JSON.stringify({
            allow_local_http: true,
            pricing: PROVIDER_PRICING[serviceType],
          }),
        }),
      })
      state.created.push(config)
    }
    return state
  } catch (error) {
    await restoreProviderConfigs(state).catch(() => {})
    throw error
  }
}

async function restoreProviderConfigs(state) {
  const failures = []
  for (const config of state.created) {
    try {
      await deleteConfig(config.id)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Failed to restore AI provider configuration after E2E')
}

async function waitForWorkflow(runId, timeoutMs = Number(process.env.E2E_WORKFLOW_TIMEOUT_MS) || 300000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = await apiRequest(`/workflows/${encodeURIComponent(runId)}`)
    if (TERMINAL_STATUSES.has(latest.status)) return latest
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Production workflow ${runId} timed out; last state=${JSON.stringify(latest)}`)
}

function workflowDrainRequestDeadlineError() {
  const error = new Error('Workflow worker drain request deadline exceeded')
  error.workflowDrainRequestTimedOut = true
  return error
}

function workflowDrainTimeoutError(runId, timeoutMs, latest = null) {
  return new Error(
    `Workflow ${runId} worker drain timed out after ${timeoutMs}ms; `
    + `last worker_active=${JSON.stringify(latest?.worker_active)}; last state=${JSON.stringify(latest)}`,
  )
}

async function requestWithinDeadline(request, pathname, {
  deadline,
  clock = Date.now,
  options = {},
} = {}) {
  const remainingMs = deadline - clock()
  if (remainingMs <= 0) throw workflowDrainRequestDeadlineError()

  const controller = new AbortController()
  let timeoutId
  let requestPromise
  try {
    requestPromise = Promise.resolve(request(pathname, { ...options, signal: controller.signal }))
  } catch (error) {
    requestPromise = Promise.reject(error)
  }
  const deadlinePromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(workflowDrainRequestDeadlineError()), remainingMs)
  })
  try {
    return await Promise.race([requestPromise, deadlinePromise])
  } finally {
    clearTimeout(timeoutId)
    controller.abort()
  }
}

function resolveWorkflowDrainDeadline(timeoutMs, clock, deadline) {
  const boundedTimeoutMs = Math.max(0, Number(timeoutMs) || 0)
  return {
    boundedTimeoutMs,
    deadline: Number.isFinite(deadline) ? deadline : clock() + boundedTimeoutMs,
  }
}

async function waitForWorkflowWorkerDrain(runId, {
  timeoutMs = Number(process.env.E2E_WORKFLOW_DRAIN_TIMEOUT_MS) || 30000,
  intervalMs = 1000,
  request = apiRequest,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = Date.now,
  deadline,
} = {}) {
  const { boundedTimeoutMs, deadline: sharedDeadline } = resolveWorkflowDrainDeadline(timeoutMs, clock, deadline)
  const boundedIntervalMs = Math.max(1, Number(intervalMs) || 1)
  let latest = null

  while (true) {
    try {
      latest = await requestWithinDeadline(request, `/workflows/${encodeURIComponent(runId)}`, {
        deadline: sharedDeadline,
        clock,
      })
    } catch (error) {
      if (!error?.workflowDrainRequestTimedOut) throw error
      break
    }
    if (latest?.worker_active === false) return latest

    const delayRemainingMs = sharedDeadline - clock()
    if (delayRemainingMs <= 0) break
    await delay(Math.min(boundedIntervalMs, delayRemainingMs))
  }

  throw workflowDrainTimeoutError(runId, boundedTimeoutMs, latest)
}

async function cancelAndWaitForWorkflowWorkerDrain(runId, {
  timeoutMs = Number(process.env.E2E_WORKFLOW_DRAIN_TIMEOUT_MS) || 30000,
  intervalMs = 1000,
  request = apiRequest,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = Date.now,
} = {}) {
  const { boundedTimeoutMs, deadline } = resolveWorkflowDrainDeadline(timeoutMs, clock)
  let latest = null
  try {
    latest = await requestWithinDeadline(request, `/workflows/${encodeURIComponent(runId)}`, { deadline, clock })
    if (!TERMINAL_STATUSES.has(latest?.status)) {
      await requestWithinDeadline(request, `/workflows/${encodeURIComponent(runId)}/cancel`, {
        deadline,
        clock,
        options: {
          method: 'POST',
          body: JSON.stringify({ reason: 'E2E cleanup' }),
        },
      })
    }
    return await waitForWorkflowWorkerDrain(runId, {
      timeoutMs: boundedTimeoutMs,
      intervalMs,
      request,
      delay,
      clock,
      deadline,
    })
  } catch (error) {
    if (error?.workflowDrainRequestTimedOut) {
      throw workflowDrainTimeoutError(runId, boundedTimeoutMs, latest)
    }
    throw error
  }
}

async function waitForProjectTitle(page, expectedTitle) {
  await page.waitForFunction((expected) => (
    String(document.querySelector('.film-create .page-title')?.textContent || '').trim() === expected
  ), expectedTitle, { timeout: 30000 })
}

function formatExpectedEpisodeContextLabel(episode, fallbackIndex = 0) {
  const number = Math.max(1, Number(episode?.episode_number) || Number(fallbackIndex) + 1)
  const prefix = `\u7b2c ${number} \u96c6`
  const title = String(episode?.title || '').trim()
  if (!title || title.replace(/\s+/g, '') === `\u7b2c${number}\u96c6`) return prefix
  return `${prefix} \u00b7 ${title}`
}

async function waitForEpisodeContext(page, expectedEpisodeLabel) {
  const expectation = {
    selector: '.film-create .header-episode-select',
    ariaLabel: UI.currentEpisode,
    episodeLabel: String(expectedEpisodeLabel || '').trim(),
  }
  assert.ok(expectation.episodeLabel, 'expected episode context label is required')
  const snapshotHandle = await page.waitForFunction(({ selector, ariaLabel, episodeLabel }) => {
    const root = document.querySelector(selector)
    const combobox = root?.querySelector('input[role="combobox"]')
    const selectedLabel = root?.querySelector(
      '.el-select__selected-item.el-select__placeholder:not(.is-transparent)',
    )
    const title = String(root?.getAttribute('title') || '').replace(/\s+/g, ' ').trim()
    const visibleLabel = String(selectedLabel?.textContent || '').replace(/\s+/g, ' ').trim()
    const ariaBusy = String(root?.getAttribute('aria-busy') || 'false').trim()
    const selectedStyle = selectedLabel ? getComputedStyle(selectedLabel) : null
    const selectedLabelVisible = Boolean(
      selectedLabel
      && !selectedLabel.hidden
      && selectedLabel.getClientRects().length > 0
      && selectedStyle?.display !== 'none'
      && selectedStyle?.visibility !== 'hidden',
    )
    const snapshot = {
      title,
      visibleLabel,
      ariaLabel: String(combobox?.getAttribute('aria-label') || '').trim(),
      ariaBusy,
    }
    return (
      selectedLabelVisible
      && combobox?.getAttribute('aria-label') === ariaLabel
      && ariaBusy !== 'true'
      && title === episodeLabel
      && visibleLabel === episodeLabel
    ) ? snapshot : false
  }, expectation, { timeout: 30000 })
  try {
    return await snapshotHandle.jsonValue()
  } finally {
    await snapshotHandle.dispose()
  }
}

async function waitForScriptEpisodeTitle(page, expectedTitle) {
  const titleHandle = await page.waitForFunction((expected) => {
    const value = String(document.querySelector('input[placeholder="\u96c6\u6807\u9898"]')?.value || '').trim()
    return value === expected ? value : false
  }, expectedTitle, { timeout: 30000 })
  try {
    return await titleHandle.jsonValue()
  } finally {
    await titleHandle.dispose()
  }
}

async function selectEpisodeFromHeader(page, episode, fallbackIndex) {
  assert.ok(episode?.id, 'header episode switch requires an episode id')
  const expectedLabel = formatExpectedEpisodeContextLabel(episode, fallbackIndex)
  const selectRoot = page.locator('.film-create .header-episode-select')
  await selectRoot.click()
  const option = page.getByRole('option', { name: expectedLabel, exact: true })
  await option.waitFor({ state: 'visible', timeout: 30000 })
  const navigation = page.waitForURL((url) => (
    url.searchParams.get('episode') === String(episode.id)
  ), { timeout: 30000 })
  await option.click()
  await navigation
  const context = await waitForEpisodeContext(page, expectedLabel)
  const routeEpisodeId = Number(new URL(page.url()).searchParams.get('episode'))
  assert.equal(routeEpisodeId, Number(episode.id), 'header episode switch route is incorrect')
  const expectedScriptTitle = String(
    episode.title || `\u7b2c${Number(episode.episode_number) || fallbackIndex + 1}\u96c6`,
  ).trim()
  const scriptTitle = await waitForScriptEpisodeTitle(page, expectedScriptTitle)
  return { ...context, routeEpisodeId, scriptTitle }
}

async function waitForEnabledAction(locator, label) {
  await locator.click({ trial: true, timeout: 30000 })
  assert.equal(await locator.isEnabled(), true, `${label} must be enabled`)
}

function browserLaunchOptions() {
  const options = {
    headless: process.env.HEADED !== '1',
    args: ['--autoplay-policy=no-user-gesture-required'],
  }
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  else if (process.env.PLAYWRIGHT_CHANNEL) options.channel = process.env.PLAYWRIGHT_CHANNEL
  else if (process.platform === 'win32') options.channel = 'msedge'
  return options
}

function assertProviderInvocations(invocations) {
  assert.ok(Array.isArray(invocations), 'workflow provider_invocations must be an array')
  for (const providerType of REQUIRED_PROVIDER_TYPES) {
    const matching = invocations.filter((item) => item.provider_type === providerType)
    assert.ok(matching.length > 0, `missing production provider invocation for ${providerType}`)
    for (const invocation of matching) {
      assert.equal(invocation.mode, 'production', `${providerType} invocation must be production mode`)
      assert.equal(invocation.status, 'success', `${providerType} invocation must succeed`)
      assert.ok(String(invocation.provider_name || '').trim(), `${providerType} provider name is required`)
      if (providerType !== 'compositor') {
        assert.notEqual(invocation.cost_estimate, null, `${providerType} invocation must expose a configured cost estimate`)
        assert.ok(Number(invocation.cost_estimate) >= 0, `${providerType} cost estimate must be non-negative`)
      }
      assert.doesNotMatch(
        `${invocation.provider_name || ''} ${invocation.model || ''}`,
        /(?:^|[-_\s])(mock|placeholder)(?:$|[-_\s])/i,
        `${providerType} invocation must not use a mock provider or model`,
      )
    }
  }
  return Object.fromEntries(REQUIRED_PROVIDER_TYPES.map((type) => [
    type,
    invocations.filter((item) => item.provider_type === type).length,
  ]))
}

function summarizeProviderInvocations(invocations) {
  const items = Array.isArray(invocations) ? invocations : []
  return Object.fromEntries(REQUIRED_PROVIDER_TYPES.map((type) => [
    type,
    items.filter((item) => item?.provider_type === type).length,
  ]))
}

function assertProviderStats(stats, forbiddenValues = []) {
  assert.equal(stats?.schema, 'localminidrama.e2e-provider-stats.v1')
  assert.ok(stats?.reset_at, 'provider stats must identify the reset boundary')
  for (const endpoint of REQUIRED_PROVIDER_ENDPOINTS) {
    const counts = stats?.calls?.[endpoint]
    assert.ok(counts, `provider stats are missing ${endpoint}`)
    assert.ok(counts.attempted > 0, `${endpoint} endpoint was not called`)
    assert.ok(counts.succeeded > 0, `${endpoint} endpoint did not succeed`)
    assert.equal(counts.failed, 0, `${endpoint} endpoint recorded failed calls`)
    assert.ok(
      stats.events.some((event) => event.endpoint === endpoint && event.success === true),
      `${endpoint} endpoint has no successful event evidence`,
    )
  }
  const serialized = JSON.stringify(stats)
  for (const forbidden of forbiddenValues.filter(Boolean)) {
    assert.equal(serialized.includes(String(forbidden)), false, 'provider stats leaked protected request content')
  }
  for (const event of stats.events || []) {
    for (const forbiddenKey of ['authorization', 'api_key', 'body', 'prompt', 'input', 'messages']) {
      assert.equal(Object.hasOwn(event, forbiddenKey), false, `provider stats event leaked ${forbiddenKey}`)
    }
  }
  return Object.fromEntries(REQUIRED_PROVIDER_ENDPOINTS.map((type) => [type, stats.calls[type].succeeded]))
}

function summarizeProviderCalls(stats) {
  return Object.fromEntries(REQUIRED_PROVIDER_ENDPOINTS.map((type) => {
    const counts = stats?.calls?.[type] || {}
    return [type, {
      attempted: Math.max(0, Number(counts.attempted) || 0),
      succeeded: Math.max(0, Number(counts.succeeded) || 0),
      failed: Math.max(0, Number(counts.failed) || 0),
    }]
  }))
}

function isPlaceholder(value) {
  return /^(?:mock|placeholder):\/\//i.test(String(value || '').trim())
}

function assertProductionTimeline(timeline) {
  const episodeCount = Number(timeline?.summary?.episode_count)
  assert.ok(Number.isInteger(episodeCount) && episodeCount > 0, 'production timeline must contain episodes')
  assert.equal(timeline.episodes?.length, episodeCount, 'production timeline episode details are inconsistent')
  assert.ok(timeline.summary?.item_count > 0, 'production timeline must contain items')
  for (const episode of timeline.episodes) {
    const tracks = Array.isArray(episode.tracks) ? episode.tracks : []
    const byType = new Map(tracks.map((track) => [track.type, track]))
    for (const type of REQUIRED_TRACK_TYPES) {
      const track = byType.get(type)
      assert.ok(track, `episode ${episode.episode?.id || '?'} is missing ${type} track`)
      assert.equal(track.item_count, track.items?.length, `${type} track item count is inconsistent`)
      if (OPTIONAL_TRACK_TYPES.has(type) && track.item_count === 0) {
        assert.equal(track.status, 'unused', `${type} track must explicitly declare that it is unused`)
        assert.equal(track.metadata?.optional, true, `${type} track must declare optional=true`)
        assert.equal(track.metadata?.usage, 'unused', `${type} track must declare usage=unused`)
        continue
      }
      for (const item of track.items || []) {
        assert.ok(item.end_sec > item.start_sec, `${type} item must have a positive duration`)
        assert.ok(String(item.source_path || '').trim(), `${type} item source is required`)
        assert.equal(isPlaceholder(item.source_path), false, `${type} item must not be a placeholder`)
        assert.notEqual(item.metadata?.placeholder, true, `${type} item metadata must not be a placeholder`)
      }
    }
    assert.ok(byType.get('video').item_count > 0, 'video track must contain production items')
    assert.ok(byType.get('subtitle').item_count > 0, 'subtitle track must contain production items')
    assert.ok(
      byType.get('voice').item_count > 0 || byType.get('dialogue').item_count > 0,
      'voice or dialogue track must contain production audio',
    )
  }
  return {
    episodes: timeline.episodes.length,
    tracks: timeline.summary.track_count,
    items: timeline.summary.item_count,
  }
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('ZIP end-of-central-directory record was not found')
}

function extractZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  assert.ok(entryCount > 0 && entryCount <= 10000, 'ZIP entry count is outside the E2E safety boundary')
  assert.ok(
    centralDirectoryOffset + centralDirectorySize <= eocdOffset,
    'ZIP central directory exceeds archive bounds',
  )

  const entries = new Map()
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'invalid ZIP central directory entry')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/')
    assert.equal((flags & 0x1) === 0, true, `encrypted ZIP entry is not supported: ${name}`)
    assert.equal(name.startsWith('/') || name.split('/').includes('..'), false, `unsafe ZIP entry path: ${name}`)
    assert.equal(buffer.readUInt32LE(localHeaderOffset), 0x04034b50, `invalid local ZIP header: ${name}`)
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    assert.equal(compressed.length, compressedSize, `truncated ZIP entry: ${name}`)
    let data
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = zlib.inflateRawSync(compressed)
    else throw new Error(`unsupported ZIP compression method ${method}: ${name}`)
    assert.equal(data.length, uncompressedSize, `ZIP entry size mismatch: ${name}`)
    entries.set(name, data)
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function assertPng(buffer, label) {
  assert.ok(buffer.length > 64, `${label} is too small`)
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} is not PNG media`)
}

function assertMp3(buffer, label) {
  assert.ok(buffer.length > 256, `${label} is too small`)
  const hasId3 = buffer.subarray(0, 3).toString('ascii') === 'ID3'
  const hasFrameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
  assert.equal(hasId3 || hasFrameSync, true, `${label} is not MP3 media`)
}

function assertMp4(buffer, label) {
  assert.ok(buffer.length > 1024, `${label} is too small`)
  assert.equal(buffer.subarray(4, 8).toString('ascii'), 'ftyp', `${label} is not MP4 media`)
}

async function verifyExport(dramaId, evidenceRecorder = null) {
  const response = await fetch(`${BACKEND_URL}/api/v1/dramas/${dramaId}/export`)
  assert.equal(response.ok, true, `project export failed with HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'project export must be a ZIP archive')
  const entries = extractZipEntries(bytes)
  if (evidenceRecorder) {
    for (const [name, data] of entries) evidenceRecorder.assertSafePayload(data, `project export entry ${name}`)
  }
  const projectEntry = entries.get('project.json')
  assert.ok(projectEntry, 'project export must contain project.json')
  const project = JSON.parse(projectEntry.toString('utf8'))
  const imageNames = [...entries.keys()].filter((name) => /^media\/storyboards\/.*\.png$/i.test(name))
  const videoNames = [...entries.keys()].filter((name) => /^media\/videos\/.*\.mp4$/i.test(name))
  const audioNames = [...entries.keys()].filter((name) => /^media\/audio\/.*\.mp3$/i.test(name))
  assert.ok(imageNames.length > 0, 'project export must contain generated PNG media')
  assert.ok(videoNames.length > 0, 'project export must contain generated MP4 media')
  assert.ok(audioNames.length > 0, 'project export must contain generated MP3 media')
  imageNames.forEach((name) => assertPng(entries.get(name), `export entry ${name}`))
  videoNames.forEach((name) => assertMp4(entries.get(name), `export entry ${name}`))
  audioNames.forEach((name) => assertMp3(entries.get(name), `export entry ${name}`))

  const storyboards = (project.episodes || []).flatMap((episode) => episode.storyboards || [])
  assert.ok(storyboards.length > 0, 'project export must describe generated storyboards')
  assert.ok(storyboards.some((storyboard) => entries.has(storyboard.image_file)), 'exported image reference is missing')
  assert.ok(storyboards.some((storyboard) => entries.has(storyboard.video_file)), 'exported video reference is missing')
  assert.ok(
    storyboards.some((storyboard) => entries.has(storyboard.audio_file) || entries.has(storyboard.narration_audio_file)),
    'exported audio reference is missing',
  )
  const artifact = evidenceRecorder
    ? await evidenceRecorder.persistArtifact('exports/api-project.zip', bytes, 'api_project_zip')
    : {
        path: null,
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      }
  return {
    artifact,
    entries: entries.size,
    images: imageNames.length,
    videos: videoNames.length,
    audio: audioNames.length,
  }
}

function backendMediaUrl(value) {
  const text = String(value || '').trim()
  if (/^https?:\/\//i.test(text)) return text
  const relative = text.replace(/^\/?static\//i, '').replace(/^\/+/, '')
  return `${BACKEND_URL}/static/${relative.split('/').map(encodeURIComponent).join('/')}`
}

async function fetchMedia(value, assertion, label, {
  evidenceRecorder = null,
  artifactPath = null,
  evidenceKey = null,
} = {}) {
  assert.ok(value && !isPlaceholder(value), `${label} durable path is required`)
  const response = await fetch(backendMediaUrl(value))
  assert.equal(response.ok, true, `${label} fetch failed with HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  assertion(buffer, label)
  if (evidenceRecorder && artifactPath) {
    return evidenceRecorder.persistArtifact(artifactPath, buffer, evidenceKey)
  }
  return {
    path: null,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

async function verifyDurableMedia(drama, evidenceRecorder = null) {
  const episode = drama?.episodes?.[0]
  assert.ok(episode, 'completed drama must contain an episode')
  assert.ok(episode.video_url, 'completed episode must contain a composed video')
  const storyboards = Array.isArray(episode.storyboards) ? episode.storyboards : []
  assert.ok(storyboards.length > 0, 'completed episode must contain storyboards')
  for (const storyboard of storyboards) {
    assert.ok(storyboard.local_path, `storyboard ${storyboard.id} must retain a local image`)
    assert.ok(storyboard.video_local_path, `storyboard ${storyboard.id} must retain a local video`)
    assert.equal(isPlaceholder(storyboard.local_path), false)
    assert.equal(isPlaceholder(storyboard.video_local_path), false)
  }
  const audioStoryboard = storyboards.find((storyboard) => storyboard.audio_local_path || storyboard.narration_audio_local_path)
  assert.ok(audioStoryboard, 'at least one storyboard must retain TTS audio')
  const first = storyboards[0]
  const image = await fetchMedia(first.local_path, assertPng, 'storyboard image', {
    evidenceRecorder,
    artifactPath: 'media/storyboard.png',
    evidenceKey: 'png',
  })
  const video = await fetchMedia(first.video_local_path, assertMp4, 'storyboard video', {
    evidenceRecorder,
    artifactPath: 'media/storyboard.mp4',
    evidenceKey: 'mp4',
  })
  const audio = await fetchMedia(
    audioStoryboard.audio_local_path || audioStoryboard.narration_audio_local_path,
    assertMp3,
    'storyboard audio',
    { evidenceRecorder, artifactPath: 'media/storyboard.mp3', evidenceKey: 'mp3' },
  )
  const composite = await fetchMedia(episode.video_url, assertMp4, 'composed episode video', {
    evidenceRecorder,
    artifactPath: 'media/composed-episode.mp4',
    evidenceKey: 'composed_video',
  })
  return { image, video, audio, composite }
}

function attachPageAudit(page, viewport) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return { errors, viewport }
}

async function assertNoHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    return {
      viewportWidth: window.innerWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyClientWidth: body?.clientWidth || 0,
      bodyScrollWidth: body?.scrollWidth || 0,
    }
  })
  assert.ok(
    result.rootScrollWidth <= result.rootClientWidth + 1,
    `${label} has document horizontal overflow: ${JSON.stringify(result)}`,
  )
  assert.ok(
    result.bodyScrollWidth <= Math.max(result.bodyClientWidth, result.rootClientWidth) + 1,
    `${label} has body horizontal overflow: ${JSON.stringify(result)}`,
  )
  return result
}

function assertNoConsoleErrors(audit, label) {
  assert.deepEqual(audit.errors, [], `${label} emitted browser errors:\n${audit.errors.join('\n')}`)
}

function assertOnlyInjectedRecoveryErrors(audit) {
  const unexpected = audit.errors.filter((message) => !/\b502\b|Bad Gateway/i.test(message))
  assert.deepEqual(
    unexpected,
    [],
    `failure-recovery page emitted unexpected browser errors:\n${unexpected.join('\n')}`,
  )
  return audit.errors.length
}

async function readDownloadBytes(download, label) {
  const failure = await download.failure()
  assert.equal(failure, null, `${label} failed: ${failure || 'unknown error'}`)
  const downloadPath = await download.path()
  assert.ok(downloadPath, `${label} did not produce a local file`)
  const bytes = await fs.readFile(downloadPath)
  assert.ok(bytes.length > 0, `${label} produced an empty file`)
  return bytes
}

async function verifyProjectListRecoveryUi(page) {
  const listRoute = /\/api\/v1\/dramas(?:\?.*)?$/
  let failNextList = true
  const routeHandler = async (route) => {
    if (failNextList && route.request().method() === 'GET') {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'E2E_UPSTREAM_FAILURE', message: 'Injected E2E failure' } }),
      })
      return
    }
    await route.continue()
  }
  await page.route(listRoute, routeHandler)
  try {
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' })
    const failureState = page.locator('.data-load-state[role="alert"]')
    await failureState.waitFor({ state: 'visible', timeout: 20000 })
    await failureState.getByText(/\u9879\u76ee\u6570\u636e\u6ca1\u6709\u88ab\u5220\u9664/).waitFor({ timeout: 10000 })
    assert.equal(
      await page.getByRole('button', { name: UI.newProject, exact: true }).first().isDisabled(),
      true,
      'project writes must remain disabled while the list is unavailable',
    )

    failNextList = false
    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET' && listRoute.test(new URL(response.url()).pathname + new URL(response.url()).search)
    ), { timeout: 30000 })
    await failureState.getByRole('button', { name: UI.retryLoad, exact: true }).click()
    const response = await responsePromise
    assert.equal(response.ok(), true, `project list retry failed with HTTP ${response.status()}`)
    await failureState.waitFor({ state: 'hidden', timeout: 20000 })
    assert.equal(
      await page.getByRole('button', { name: UI.newProject, exact: true }).first().isEnabled(),
      true,
      'project writes must unlock after a successful retry',
    )
  } finally {
    await page.unroute(listRoute, routeHandler)
  }
  return { injectedStatus: 502, recovered: true }
}

async function resetAcceptanceReportArtifacts(evidenceRoot) {
  const root = path.resolve(evidenceRoot)
  await fs.mkdir(root, { recursive: true })
  const rootRealPath = await fs.realpath(root)
  const acceptanceRoot = path.join(root, 'acceptance-report')
  assert.equal(path.dirname(acceptanceRoot), root, 'acceptance report must be an exact evidence-root child')
  assert.equal(path.basename(acceptanceRoot), 'acceptance-report', 'acceptance report child name is incorrect')

  let targetStat
  try {
    targetStat = await fs.lstat(acceptanceRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  if (targetStat.isSymbolicLink()) {
    await fs.unlink(acceptanceRoot)
    return
  }
  if (!targetStat.isDirectory()) {
    await fs.unlink(acceptanceRoot)
    return
  }

  const targetRealPath = await fs.realpath(acceptanceRoot)
  const relativeTarget = path.relative(rootRealPath, targetRealPath)
  assert.ok(
    relativeTarget && !relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== '..' && !path.isAbsolute(relativeTarget),
    'acceptance report directory escapes the evidence root',
  )
  await fs.rm(acceptanceRoot, { recursive: true })
}

async function verifyProjectReadinessDisclosureUi(page) {
  const toggle = page.getByTestId('project-readiness-toggle')
  const details = page.getByTestId('project-readiness-details')
  await toggle.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await details.count(), 1, 'project readiness details must remain mounted while collapsed')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'project readiness must start collapsed')
  await toggle.click()
  await details.waitFor({ state: 'visible' })
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'project readiness toggle must expose details')
}

async function verifyAiConfigurationUi(page) {
  await page.goto(`${FRONTEND_URL}/ai-config`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '\u0041\u0049 \u670d\u52a1\u914d\u7f6e\u4e0e\u9a8c\u8bc1', exact: true }).waitFor({ timeout: 30000 })
  const coverageMode = page.getByTestId('ai-config-mode-coverage')
  const configsMode = page.getByTestId('ai-config-mode-configs')
  const coveragePanel = page.locator('#ai-config-coverage-panel')
  const configsPanel = page.locator('#ai-config-configs-panel')
  await coverageMode.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await coverageMode.getAttribute('aria-selected'), 'true', 'service status mode must be selected by default')
  assert.equal(await configsMode.getAttribute('aria-selected'), 'false', 'AI config must open on service status')
  await coveragePanel.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await coveragePanel.isVisible(), true, 'service status panel must be visible by default')
  assert.equal(await configsPanel.count(), 1, 'configuration management panel must remain mounted')
  await configsPanel.waitFor({ state: 'hidden' })
  assert.equal(await configsPanel.isVisible(), false, 'configuration management panel must start hidden')
  await coverageMode.press('ArrowRight')
  await coveragePanel.waitFor({ state: 'hidden' })
  await configsPanel.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(
    await configsMode.evaluate((element) => element.ownerDocument.activeElement === element),
    true,
    'keyboard navigation must move focus to configuration management',
  )
  assert.equal(await coverageMode.getAttribute('aria-selected'), 'false', 'keyboard navigation must deselect service status')
  assert.equal(await configsMode.getAttribute('aria-selected'), 'true', 'keyboard navigation must select configuration management')
  await configsMode.press('ArrowLeft')
  await coveragePanel.waitFor({ state: 'visible', timeout: 30000 })
  await configsPanel.waitFor({ state: 'hidden' })
  assert.equal(
    await coverageMode.evaluate((element) => element.ownerDocument.activeElement === element),
    true,
    'reverse keyboard navigation must restore focus to service status',
  )
  assert.equal(await coverageMode.getAttribute('aria-selected'), 'true', 'reverse keyboard navigation must select service status')
  assert.equal(await configsMode.getAttribute('aria-selected'), 'false', 'reverse keyboard navigation must deselect configuration management')
  await configsMode.click()
  await coveragePanel.waitFor({ state: 'hidden' })
  await configsPanel.waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await coverageMode.getAttribute('aria-selected'), 'false', 'service status mode must be deselected')
  assert.equal(await configsMode.getAttribute('aria-selected'), 'true', 'configuration management mode must be selected')
  for (const serviceType of ['text', 'image', 'storyboard_image', 'video', 'tts']) {
    await page.locator('.el-table__row')
      .filter({ hasText: `${CONFIG_PREFIX}${serviceType}` })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
  }
  const textConfigRow = page.locator('.el-table__row').filter({ hasText: `${CONFIG_PREFIX}text` }).first()
  await textConfigRow.getByRole('button', { name: '\u6d4b\u8bd5', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '\u6d4b\u8bd5\u8fde\u63a5', exact: true })
  await dialog.getByText('\u8fde\u63a5\u6210\u529f', { exact: true }).waitFor({ timeout: 30000 })
  await dialog.getByRole('button', { name: '\u5173\u95ed', exact: true }).click()
  return {
    fixtureServices: ['text', 'image', 'storyboard_image', 'video', 'tts'],
    connectionTest: 'passed',
    userDefaultsMutated: false,
  }
}

async function createDramaFromUi(page, { title, description }) {
  await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' })
  const newButton = page.getByRole('button', { name: UI.newProject, exact: true }).first()
  await newButton.waitFor({ state: 'visible', timeout: 30000 })
  await waitForEnabledAction(newButton, 'new project command')
  await newButton.click()
  const dialog = page.getByRole('dialog', { name: UI.newProject, exact: true })
  await dialog.getByPlaceholder('\u8f93\u5165\u9879\u76ee\u6807\u9898').fill(title)
  await dialog.getByPlaceholder('\u8f93\u5165\u9879\u76ee\u63cf\u8ff0\uff08\u9009\u586b\uff09').fill(description)
  let fixtureClaimInjected = false
  const createRoute = '**/api/v1/dramas'
  const createRouteHandler = async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const requestBody = route.request().postDataJSON()
    assert.equal(requestBody.title, title, 'UI project creation must preserve the entered title')
    assert.equal(requestBody.description, description, 'UI project creation must preserve the entered description')
    fixtureClaimInjected = true
    await route.continue({
      postData: JSON.stringify({
        ...requestBody,
        metadata: { ...(requestBody.metadata || {}), e2e: true },
      }),
    })
  }
  await page.route(createRoute, createRouteHandler)
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/dramas'
  ), { timeout: 30000 })
  const navigationPromise = page.waitForURL(/\/drama\/\d+(?:[?#]|$)/, { timeout: 30000 })
  let response
  let payload
  try {
    await dialog.getByRole('button', { name: UI.confirm, exact: true }).click()
    response = await responsePromise
    payload = await response.json().catch(() => ({}))
  } finally {
    await page.unroute(createRoute, createRouteHandler)
  }
  assert.equal(response.ok(), true, `UI project creation failed: ${response.status()} ${JSON.stringify(payload)}`)
  assert.equal(fixtureClaimInjected, true, 'UI project creation must be atomically marked as an E2E fixture')
  assert.ok(payload.data?.id, 'UI project creation must return an id')
  assert.equal(payload.data?.metadata?.e2e, true, 'created E2E fixture must retain its cleanup marker')
  await navigationPromise
  assert.match(page.url(), new RegExp(`/drama/${payload.data.id}(?:[?#]|$)`))
  assert.equal(
    new URL(page.url()).hash,
    '#source-intake-workflow',
    'new projects must land on the source intake workflow rather than an unscoped detail page',
  )
  const workflow = page.locator('#source-intake-workflow')
  await workflow.waitFor({ state: 'visible', timeout: 30000 })
  const workflowBox = await workflow.boundingBox()
  assert.ok(workflowBox && workflowBox.y >= 0, 'new project source workflow must be visible in the viewport')
  return payload.data
}

async function verifyAiConfigReturnUi(page, dramaId) {
  const returnTo = `/drama/${dramaId}#source-intake-workflow`
  await page.goto(
    `${FRONTEND_URL}/ai-config?service_type=text&returnTo=${encodeURIComponent(returnTo)}`,
    { waitUntil: 'domcontentloaded' },
  )
  const configsMode = page.getByTestId('ai-config-mode-configs')
  await configsMode.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await configsMode.getAttribute('aria-selected'), 'true', 'service-specific AI config must open in config management')
  await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })
  const backButton = page.getByRole('button', { name: '\u8fd4\u56de\u539f\u9879\u76ee', exact: true })
  await backButton.waitFor({ state: 'visible', timeout: 10000 })
  const navigationPromise = page.waitForURL(new RegExp(`/drama/${dramaId}#source-intake-workflow$`), { timeout: 30000 })
  await backButton.click()
  await navigationPromise
  const workflow = page.locator('#source-intake-workflow')
  await workflow.waitFor({ state: 'visible', timeout: 30000 })
  return {
    return_to_preserved: new URL(page.url()).hash === '#source-intake-workflow',
    workflow_visible: await workflow.isVisible(),
  }
}

async function importSourceFromUi(page, dramaId, { title, text }) {
  await page.goto(`${FRONTEND_URL}/drama/${dramaId}`, { waitUntil: 'domcontentloaded' })
  const workflow = page.locator('#source-intake-workflow')
  await workflow.waitFor({ state: 'visible', timeout: 30000 })
  await flowStepButton(workflow, UI.intakeStep).click()
  await workflow.getByPlaceholder('\u6545\u4e8b\u7d20\u6750\u6807\u9898').fill(title)
  await workflow.getByPlaceholder(UI.sourcePlaceholder, { exact: true }).fill(text)
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/v1/dramas/${dramaId}/story-sources`
  ), { timeout: 30000 })
  await workflow.getByRole('button', { name: UI.importOnly, exact: true }).click()
  const response = await responsePromise
  const payload = await response.json().catch(() => ({}))
  assert.equal(response.ok(), true, `UI source import failed: ${response.status()} ${JSON.stringify(payload)}`)
  assert.ok(payload.data?.source?.id, 'UI source import must return a source id')
  await workflow.getByText(/\u7d20\u6750\u5df2\u5bfc\u5165/).first().waitFor({ timeout: 20000 })
  return payload.data
}

async function verifyFinalVideoDownloadUi(page, evidenceRecorder = null) {
  if (evidenceRecorder) {
    await evidenceRecorder.set({ browser: { final_download: { status: 'running', validated: false } } })
  }
  try {
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
    await page.getByRole('button', { name: UI.downloadFinal, exact: true }).click()
    const download = await downloadPromise
    const bytes = await readDownloadBytes(download, 'final video UI download')
    assertMp4(bytes, 'final video UI download')
    assert.match(download.suggestedFilename(), /\.mp4$/i, 'final video download must use an MP4 filename')
    await page.getByText('\u6210\u7247\u4e0b\u8f7d\u5df2\u5b8c\u6210\u3002', { exact: true }).waitFor({ timeout: 10000 })
    const artifact = evidenceRecorder
      ? await evidenceRecorder.persistArtifact('downloads/final-video.mp4', bytes, 'final_video')
      : {
          path: null,
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }
    const result = {
      status: 'passed',
      validated: true,
      artifact,
      filename: path.basename(download.suggestedFilename()),
    }
    if (evidenceRecorder) await evidenceRecorder.set({ browser: { final_download: result } })
    return result
  } catch (error) {
    if (evidenceRecorder) {
      await evidenceRecorder.set({
        browser: {
          final_download: {
            status: 'failed',
            validated: false,
            failure: { name: error?.name || 'Error', message: error?.message || String(error) },
          },
        },
      }).catch(() => {})
    }
    throw error
  }
}

async function verifyProjectExportUi(page, title, evidenceRecorder = null) {
  if (evidenceRecorder) {
    await evidenceRecorder.set({ browser: { project_export: { status: 'running', validated: false } } })
  }
  try {
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' })
    const card = page.locator('.project-card').filter({ hasText: title }).first()
    await card.waitFor({ state: 'visible', timeout: 30000 })
    await card.locator('.project-menu-button').click()
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
    downloadPromise.catch(() => {})
    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET' &&
      /\/api\/v1\/dramas\/\d+\/export$/.test(new URL(response.url()).pathname)
    ), { timeout: 30000 })
    await page.getByRole('menuitem').filter({ hasText: UI.exportProject }).click()
    const response = await responsePromise
    if (!response.ok()) {
      const payload = await response.json().catch(() => ({}))
      const code = payload?.error?.code || payload?.code || `HTTP_${response.status()}`
      throw new Error(`UI project export request failed: ${code}`)
    }
    const download = await downloadPromise
    const bytes = await readDownloadBytes(download, 'project export UI download')
    assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'UI project export must be a ZIP archive')
    const entries = extractZipEntries(bytes)
    if (evidenceRecorder) {
      for (const [name, data] of entries) evidenceRecorder.assertSafePayload(data, `UI project export entry ${name}`)
    }
    assert.ok(entries.has('project.json'), 'UI project export must include project.json')
    assert.match(download.suggestedFilename(), /\.zip$/i, 'project export must use a ZIP filename')
    const artifact = evidenceRecorder
      ? await evidenceRecorder.persistArtifact('downloads/project-export.zip', bytes, 'project_zip')
      : {
          path: null,
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }
    const result = {
      status: 'passed',
      validated: true,
      artifact,
      entries: entries.size,
      filename: path.basename(download.suggestedFilename()),
    }
    if (evidenceRecorder) await evidenceRecorder.set({ browser: { project_export: result } })
    return result
  } catch (error) {
    if (evidenceRecorder) {
      await evidenceRecorder.set({
        browser: {
          project_export: {
            status: 'failed',
            validated: false,
            failure: { name: error?.name || 'Error', message: error?.message || String(error) },
          },
        },
      }).catch(() => {})
    }
    throw error
  }
}

async function verifyPlayableVideo(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 30000 })
  const result = await locator.evaluate(async (video) => {
    const waitForMetadata = () => new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve()
      const timer = setTimeout(() => reject(new Error('metadata timeout')), 20000)
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      video.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`media error ${video.error?.code || 'unknown'}`))
      }, { once: true })
      video.load()
    })
    await waitForMetadata()
    video.muted = true
    if (video.seekable?.length && video.duration > 0.8) {
      const seeked = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('media seek timeout')), 5000)
        video.addEventListener('seeked', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      video.currentTime = Math.max(0, video.duration - 0.75)
      await seeked
    }
    const before = video.currentTime
    const ended = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      video.addEventListener('ended', () => {
        clearTimeout(timer)
        resolve(true)
      }, { once: true })
    })
    await video.play()
    const endedObserved = await ended
    const after = video.currentTime
    const played = after > before
    return {
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      played,
      ended: endedObserved && video.ended,
      currentTime: after,
      source: video.currentSrc || video.src,
    }
  })
  assert.ok(Number.isFinite(result.duration) && result.duration > 0, `${label} duration must be positive`)
  assert.ok(result.videoWidth > 0 && result.videoHeight > 0, `${label} must decode video frames`)
  assert.equal(result.played, true, `${label} did not play`)
  assert.equal(result.ended, true, `${label} did not reach its ended state`)
  return result
}

function summarizePlayback(result) {
  let unicodePath = false
  try {
    unicodePath = /[^\x00-\x7f]/.test(decodeURIComponent(new URL(result.source).pathname))
  } catch (_) {
    unicodePath = false
  }
  return {
    duration: result.duration,
    width: result.videoWidth,
    height: result.videoHeight,
    ready_state: result.readyState,
    played: result.played,
    ended: result.ended,
    current_time: result.currentTime,
    unicode_path: unicodePath,
  }
}

async function persistBrowserPlayback(evidenceRecorder, viewport, composedVideo, storyboardVideo) {
  if (!evidenceRecorder) return
  const entry = {
    viewport,
    composed: summarizePlayback(composedVideo),
    storyboard: summarizePlayback(storyboardVideo),
  }
  const previous = evidenceRecorder.snapshot().browser.playback || []
  const playback = previous.filter((item) => (
    item.viewport?.width !== viewport.width || item.viewport?.height !== viewport.height
  ))
  playback.push(entry)
  await evidenceRecorder.set({ browser: { playback } })
}

async function startWorkflowModeFromUi(page, dramaId, {
  modeLabel,
  startLabel,
  expectedMode,
  providerOptions = null,
}) {
  const routePatterns = providerOptions
    ? [
        '**/api/v1/workflows/novel2anime/readiness',
        '**/api/v1/workflows/novel2anime',
      ]
    : []
  const injectProviderOptions = async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const requestBody = route.request().postDataJSON()
    await route.continue({
      postData: JSON.stringify({
        ...requestBody,
        options: { ...(requestBody.options || {}), ...providerOptions },
      }),
    })
  }
  for (const pattern of routePatterns) await page.route(pattern, injectProviderOptions)

  try {
    await page.goto(`${FRONTEND_URL}/drama/${dramaId}`, { waitUntil: 'domcontentloaded' })
    const workflow = page.locator('#source-intake-workflow')
    await workflow.waitFor({ state: 'visible', timeout: 30000 })
    await workflow.getByText(UI.workflowTitle, { exact: true }).waitFor({ timeout: 30000 })
    await revealWorkflowHistoryIfCompleted(workflow)
    await flowStepButton(workflow, UI.intakeStep).click()
    const modeGroup = workflow.getByRole('radiogroup', {
      name: '\u5de5\u4f5c\u6d41\u542f\u52a8\u6a21\u5f0f',
      exact: true,
    })
    const modeRadio = modeGroup.getByRole('radio', { name: modeLabel, exact: true })
    await modeGroup.getByText(modeLabel, { exact: true }).click()
    assert.equal(await modeRadio.isChecked(), true, `${expectedMode} mode must be selected through the UI`)

    const startButton = workflow.getByRole('button', { name: startLabel, exact: true }).first()
    await startButton.waitFor({ state: 'visible', timeout: 20000 })
    await startButton.click({ trial: true, timeout: 30000 })
    assert.equal(await startButton.isEnabled(), true, `${expectedMode} start command must be executable`)
    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/workflows/novel2anime'
    ), { timeout: 45000 })
    await startButton.click()
    const response = await responsePromise
    const payload = await response.json().catch(() => ({}))
    assert.equal(response.ok(), true, `UI ${expectedMode} start failed: ${response.status()} ${JSON.stringify(payload)}`)
    assert.notEqual(payload.success, false, `UI ${expectedMode} start failed: ${JSON.stringify(payload)}`)
    assert.ok(payload.data?.id, `UI ${expectedMode} start must return a workflow run id`)
    return payload.data
  } finally {
    for (const pattern of routePatterns) await page.unroute(pattern, injectProviderOptions)
  }
}

async function startDraftFromUi(page, dramaId) {
  return startWorkflowModeFromUi(page, dramaId, {
    modeLabel: UI.draftMode,
    startLabel: UI.startDraft,
    expectedMode: 'Draft',
  })
}

async function startProductionFromUi(page, dramaId) {
  return startWorkflowModeFromUi(page, dramaId, {
    modeLabel: UI.productionMode,
    startLabel: UI.startProduction,
    expectedMode: 'Production',
    providerOptions: PROVIDER_SELECTION_OPTIONS,
  })
}

async function assertDraftPlaceholderState(dramaId) {
  const draftDrama = await apiRequest(`/dramas/${dramaId}`)
  const storyboards = (draftDrama.episodes || []).flatMap((episode) => episode.storyboards || [])
  assert.ok(storyboards.length > 0, 'Draft workflow must create storyboards before Production upgrade')
  const imagePlaceholders = storyboards.filter((storyboard) => isPlaceholder(storyboard.image_url)).length
  const videoPlaceholders = storyboards.filter((storyboard) => isPlaceholder(storyboard.video_url)).length
  assert.ok(imagePlaceholders > 0, 'Draft workflow must create placeholder images for upgrade coverage')
  assert.ok(videoPlaceholders > 0, 'Draft workflow must create placeholder videos for upgrade coverage')
  return { storyboardCount: storyboards.length, imagePlaceholders, videoPlaceholders }
}

async function verifyFilmPipelineDisclosureUi(page) {
  const toggle = page.getByTestId('film-pipeline-toggle')
  const details = page.getByTestId('film-pipeline-details')
  await toggle.waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await details.count(), 1, 'film pipeline details must remain mounted while collapsed')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'idle film pipeline must start collapsed')
}

async function verifyDraftUpgradeUi(page, dramaId) {
  await page.goto(`${FRONTEND_URL}/film/${dramaId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
  await verifyFilmPipelineDisclosureUi(page)
  await page.locator('#film-create-quick-nav button.nav-step').filter({ hasText: '\u5206\u955c\u56fe' }).click()
  await page.getByText('\u8349\u7a3f\u5360\u4f4d\u89c6\u9891\uff0c\u5c1a\u672a\u751f\u6210\u53ef\u64ad\u653e\u7247\u6bb5\u3002', { exact: true }).first().waitFor({ timeout: 30000 })
  assert.equal(await page.locator('img[src^="mock://"], video[src^="mock://"]').count(), 0, 'Draft placeholders must not render as media elements')
  assert.equal((await page.locator('body').innerText()).includes('mock://'), false, 'Draft placeholder URLs must not be exposed in the UI')
  return { placeholderMessageVisible: true }
}

function attachFocusedPageAudit(page, viewport) {
  const errors = []
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  }
  const onPageError = (error) => errors.push(`pageerror: ${error.message}`)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  return {
    errors,
    viewport,
    dispose() {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}

async function assertComponentHorizontalOverflow(page, label, selectors) {
  const records = []
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    let visibleCount = 0
    for (let index = 0; index < count; index += 1) {
      const element = locator.nth(index)
      if (!await element.isVisible()) continue
      visibleCount += 1
      const dimensions = await element.evaluate((node) => ({
        client_width: node.clientWidth,
        scroll_width: node.scrollWidth,
        client_height: node.clientHeight,
        scroll_height: node.scrollHeight,
      }))
      assert.ok(
        dimensions.scroll_width <= dimensions.client_width + 1,
        `${label} ${selector}[${index}] has horizontal overflow: ${JSON.stringify(dimensions)}`,
      )
      records.push({ selector, index, ...dimensions })
    }
    assert.ok(visibleCount > 0, `${label} requires at least one visible ${selector}`)
  }
  return records
}

const FOCUSED_COVERAGE_MATRIX = Object.freeze([
  Object.freeze({ service: 'video', label: '\u89c6\u9891\u751f\u6210', state: 'default', test_status: 'failed', action_count: 1, action_label: '\u91cd\u65b0\u6d4b\u8bd5' }),
  Object.freeze({ service: 'image', label: '\u7d20\u6750\u56fe\u7247', state: 'configured', test_status: 'unknown', action_count: 1, action_label: '\u8865\u9f50\u9ed8\u8ba4' }),
  Object.freeze({ service: 'text', label: '\u6587\u672c\u751f\u6210', state: 'missing', test_status: 'unknown', action_count: 0, action_label: '' }),
  Object.freeze({ service: 'tts', label: '\u8bed\u97f3\u5408\u6210', state: 'default', test_status: 'unknown', action_count: 1, action_label: '\u7acb\u5373\u6d4b\u8bd5' }),
  Object.freeze({ service: 'storyboard_image', label: '\u5206\u955c\u56fe\u7247', state: 'default', test_status: 'passed', action_count: 0, action_label: '' }),
])

function assertCoverageCardMatrix(records) {
  assert.equal(records.length, FOCUSED_COVERAGE_MATRIX.length, 'AI coverage must contain exactly five service cards')
  for (let index = 0; index < FOCUSED_COVERAGE_MATRIX.length; index += 1) {
    const actual = records[index]
    const expected = FOCUSED_COVERAGE_MATRIX[index]
    assert.equal(actual.service, expected.service, `coverage card ${index} service identity is incorrect`)
    assert.equal(actual.label, expected.label, `${expected.service} label is incorrect`)
    assert.equal(actual.state, expected.state, `${expected.service} coverage state is incorrect`)
    assert.equal(actual.test_status, expected.test_status, `${expected.service} test status is incorrect`)
    assert.equal(actual.action_count, expected.action_count, `${expected.service} action count is incorrect`)
    assert.equal(actual.action_label, expected.action_label, `${expected.service} action label is incorrect`)
  }
  return records
}

async function waitForCoverageCardMatrix(page) {
  const expected = FOCUSED_COVERAGE_MATRIX.map(({ service, state, test_status }) => ({ service, state, test_status }))
  await page.waitForFunction((expectedMatrix) => {
    const records = [...document.querySelectorAll('#ai-config-coverage-panel .coverage-item')].map((element) => {
      const icon = element.querySelector('.coverage-icon')
      const serviceClass = [...(icon?.classList || [])].find((name) => /^coverage-icon-(?!$)/.test(name)) || ''
      const stateClass = ['coverage-default', 'coverage-configured', 'coverage-missing']
        .find((name) => element.classList.contains(name)) || ''
      const testNode = element.querySelector('.coverage-test-status')
      const testClass = ['test-failed', 'test-unknown', 'test-passed']
        .find((name) => testNode?.classList.contains(name)) || ''
      return {
        service: serviceClass.replace('coverage-icon-', ''),
        state: stateClass.replace('coverage-', ''),
        test_status: testClass.replace('test-', ''),
      }
    })
    return JSON.stringify(records) === JSON.stringify(expectedMatrix)
  }, expected, { timeout: 30000 })
}

async function assertCoverageLayout(page, {
  viewport,
  columns,
  requireSingleRow = false,
} = {}) {
  const cards = page.locator('#ai-config-coverage-panel .coverage-item')
  const snapshot = await cards.evaluateAll((elements) => {
    const grid = elements[0]?.closest('.coverage-grid')
    const dialog = document.querySelector('.el-dialog.ai-config-workspace-dialog')
    if (!grid || !dialog) return null
    const gridBox = grid.getBoundingClientRect()
    const dialogBox = dialog.getBoundingClientRect()
    const records = elements.map((element) => {
      const box = element.getBoundingClientRect()
      const icon = element.querySelector('.coverage-icon')
      const serviceClass = [...(icon?.classList || [])].find((name) => /^coverage-icon-(?!$)/.test(name)) || ''
      const stateClass = ['coverage-default', 'coverage-configured', 'coverage-missing']
        .find((name) => element.classList.contains(name)) || ''
      const testNode = element.querySelector('.coverage-test-status')
      const testClass = ['test-failed', 'test-unknown', 'test-passed']
        .find((name) => testNode?.classList.contains(name)) || ''
      const actions = [...element.querySelectorAll('.coverage-actions button')]
      return {
        service: serviceClass.replace('coverage-icon-', ''),
        label: String(element.querySelector('.coverage-item-heading strong')?.textContent || '').trim(),
        state: stateClass.replace('coverage-', ''),
        test_status: testClass.replace('test-', ''),
        action_count: actions.length,
        action_label: actions.length === 1 ? String(actions[0].textContent || '').trim() : '',
        display: getComputedStyle(element).display,
        x: box.left - gridBox.left + grid.scrollLeft,
        y: box.top - gridBox.top + grid.scrollTop,
        viewport_x: box.left,
        viewport_y: box.top,
        width: box.width,
        height: box.height,
      }
    })
    return {
      records,
      grid_columns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      dialog: { x: dialogBox.left, y: dialogBox.top, width: dialogBox.width, height: dialogBox.height },
    }
  })
  assert.ok(snapshot, 'AI coverage grid and dialog must be present')
  const records = snapshot.records
  assertCoverageCardMatrix(records)
  for (const record of records) {
    assert.notEqual(record.display, 'none', `${record.service} coverage card must be displayed`)
    assert.ok(record.width > 0 && record.height > 0, `${record.service} coverage card has no layout box`)
  }

  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const a = records[left]
      const b = records[right]
      const separated = (
        a.x + a.width <= b.x + 1
        || b.x + b.width <= a.x + 1
        || a.y + a.height <= b.y + 1
        || b.y + b.height <= a.y + 1
      )
      assert.equal(separated, true, `${a.service} and ${b.service} coverage cards overlap`)
    }
  }

  const gridColumns = snapshot.grid_columns
  assert.equal(gridColumns, columns, `${viewport.width} coverage grid column count is incorrect`)
  const xTracks = [...new Set(records.map((record) => Math.round(record.x)))]
  assert.equal(xTracks.length, columns, `${viewport.width} coverage cards do not occupy ${columns} tracks`)
  const rowCounts = new Map()
  for (const record of records) {
    const row = Math.round(record.y)
    rowCounts.set(row, (rowCounts.get(row) || 0) + 1)
  }
  assert.equal([...rowCounts.values()].every((count) => count <= columns), true, 'coverage row exceeds its grid tracks')
  if (requireSingleRow) {
    assert.equal(rowCounts.size, 1, `${viewport.width} coverage cards must share one row`)
    const dialogBox = snapshot.dialog
    for (const record of records) {
      assert.ok(record.viewport_x >= dialogBox.x - 1 && record.viewport_x + record.width <= dialogBox.x + dialogBox.width + 1)
      assert.ok(record.viewport_y >= 0 && record.viewport_y + record.height <= viewport.height + 1)
    }
  } else {
    for (let index = 0; index < await cards.count(); index += 1) {
      const card = cards.nth(index)
      await card.scrollIntoViewIfNeeded()
      assert.equal(await card.evaluate((element) => getComputedStyle(element).display !== 'none'), true)
    }
  }
  return { columns: gridColumns, cards: records }
}

async function assertMinimumTargetSize(page, label, selectors, minimumTargetSize = 32) {
  const records = []
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()
    let visibleCount = 0
    for (let index = 0; index < count; index += 1) {
      const target = locator.nth(index)
      if (!await target.isVisible()) continue
      visibleCount += 1
      const box = await target.boundingBox()
      assert.ok(box, `${label} ${selector}[${index}] has no target box`)
      assert.ok(box.width >= minimumTargetSize, `${label} ${selector}[${index}] is narrower than ${minimumTargetSize}px`)
      assert.ok(box.height >= minimumTargetSize, `${label} ${selector}[${index}] is shorter than ${minimumTargetSize}px`)
      records.push({ selector, index, width: box.width, height: box.height })
    }
    assert.ok(visibleCount > 0, `${label} requires at least one visible ${selector}`)
  }
  return records
}

async function assertWorkbenchFocus(page, { preferred, fallback, label }) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const documentFocus = await page.evaluate(() => {
      const active = document.activeElement
      const hiddenDialog = active?.closest?.('.ai-config-workspace-dialog')
      return {
        tag: active?.tagName || '',
        in_hidden_dialog: Boolean(hiddenDialog && getComputedStyle(hiddenDialog).display === 'none'),
      }
    })
    const preferredFocused = await preferred.evaluate((element) => element.contains(element.ownerDocument.activeElement)).catch(() => false)
    const fallbackFocused = await fallback.evaluate((element) => element.contains(element.ownerDocument.activeElement)).catch(() => false)
    if (
      !['BODY', 'HTML', ''].includes(documentFocus.tag)
      && !documentFocus.in_hidden_dialog
      && (preferredFocused || fallbackFocused)
    ) {
      return { restored: true, target: preferredFocused ? 'preferred' : 'fallback' }
    }
    await page.waitForTimeout(50)
  }
  const active = await page.evaluate(() => ({
    tag: document.activeElement?.tagName || '',
    class_name: String(document.activeElement?.className || '').slice(0, 120),
  }))
  assert.fail(`${label} did not restore focus to the workbench: ${JSON.stringify(active)}`)
}

function createReadinessGate({
  timeoutMs = 10000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let armed = false
  let intercepted = false
  let releaseResolve = null
  let release = Promise.resolve(503)
  const waiters = new Set()
  const expectedReadinessPost = 'POST /api/v1/workflows/novel2anime/readiness'
  const settleWaiter = (waiter, error = null) => {
    if (!waiters.delete(waiter)) return
    if (waiter.timer !== null) clearTimeoutFn(waiter.timer)
    if (error) waiter.reject(error)
    else waiter.resolve()
  }
  return {
    arm() {
      assert.equal(armed, false, 'readiness gate is already armed')
      armed = true
      intercepted = false
      release = new Promise((resolve) => { releaseResolve = resolve })
    },
    isArmed: () => armed,
    async intercept() {
      assert.equal(armed, true, 'readiness gate was not armed')
      intercepted = true
      for (const waiter of [...waiters]) settleWaiter(waiter)
      const status = await release
      armed = false
      return status
    },
    waitUntilIntercepted() {
      if (intercepted) return Promise.resolve()
      if (!armed) return Promise.reject(new Error(`Cannot wait for ${expectedReadinessPost}: readiness gate is not armed`))
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null }
        waiter.timer = setTimeoutFn(() => {
          if (!waiters.delete(waiter)) return
          waiter.timer = null
          reject(new Error(`${expectedReadinessPost} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        waiters.add(waiter)
      })
    },
    release(status = 503) {
      releaseResolve?.(status)
    },
    dispose() {
      const error = new Error(`Readiness gate disposed before expected readiness POST ${expectedReadinessPost.slice(5)}`)
      for (const waiter of [...waiters]) settleWaiter(waiter, error)
      if (armed) releaseResolve?.(503)
      armed = false
      intercepted = false
    },
  }
}

function focusedAiRouteAction({
  method,
  pathname,
  query = '',
  requestName = '',
  fixtureName = '',
} = {}) {
  if (pathname !== '/api/v1/ai-configs') return 'passthrough'
  if (method === 'POST') {
    return fixtureName && requestName === fixtureName ? 'decorate-create' : 'passthrough'
  }
  if (method === 'GET' && !new URLSearchParams(query).has('service_type')) return 'decorate-list'
  return 'passthrough'
}

async function installFocusedAiRoutes(page, fixture) {
  const aiListPattern = '**/api/v1/ai-configs*'
  const readinessPattern = '**/api/v1/workflows/novel2anime/readiness'
  const readinessGate = createReadinessGate()
  const state = {
    inactiveTextId: fixture.inactiveTextId,
    uiCreatedIds: new Set(),
    decoratedUiCreatedIds: new Set(),
    includeUiCreated: false,
    mutationComplete: false,
    recoveryComplete: false,
    readinessStatuses: [],
  }
  const requestCounts = { readiness_after_mutation: 0, ui_config_posts: 0 }
  const fixtureIds = new Set(fixture.providerState.created.map((config) => Number(config.id)))
  const uiCreatedRowWaiters = new Map()

  const resolveUiCreatedRowWaiter = (id) => {
    const waiter = uiCreatedRowWaiters.get(id)
    if (!waiter) return
    uiCreatedRowWaiters.delete(id)
    clearTimeout(waiter.timer)
    waiter.resolve()
  }

  const waitForUiCreatedRow = (id, timeoutMs = 30000) => {
    const numericId = Number(id)
    if (state.decoratedUiCreatedIds.has(numericId)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        uiCreatedRowWaiters.delete(numericId)
        reject(new Error(`decorated AI config list did not include created id ${numericId}`))
      }, timeoutMs)
      uiCreatedRowWaiters.set(numericId, { resolve, timer })
    })
  }

  const aiListHandler = async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const requestBody = request.method() === 'POST' ? (request.postDataJSON() || {}) : {}
    const action = focusedAiRouteAction({
      method: request.method(),
      pathname: url.pathname,
      query: url.search,
      requestName: requestBody.name || '',
      fixtureName: fixture.uiConfigName,
    })
    if (action === 'decorate-create') {
      requestCounts.ui_config_posts += 1
      const existingSettings = (() => {
        try {
          return requestBody.settings ? JSON.parse(requestBody.settings) : {}
        } catch {
          return {}
        }
      })()
      const response = await route.fetch({
        postData: JSON.stringify({
          ...requestBody,
          settings: JSON.stringify({ ...existingSettings, allow_local_http: true }),
        }),
      })
      const payload = await response.json()
      const createdId = Number(payload?.data?.id)
      assert.ok(Number.isSafeInteger(createdId) && createdId > 0, 'focused AI create route response must contain an id')
      assert.ok(fixture.cleanupState?.createdIds instanceof Set, 'focused AI create route requires cleanup ownership')
      fixture.cleanupState.createdIds.add(createdId)
      state.uiCreatedIds.add(createdId)
      state.includeUiCreated = true
      state.mutationComplete = true
      await route.fulfill({ response, body: JSON.stringify(payload) })
      return
    }
    if (action === 'passthrough') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const payload = await response.json()
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const allowedIds = new Set([...fixtureIds, ...(state.includeUiCreated ? state.uiCreatedIds : [])])
    const decorated = rows
      .filter((row) => allowedIds.has(Number(row.id)))
      .filter((row) => Number(row.id) !== Number(state.inactiveTextId))
      .map((row) => {
        const display = { ...row, base_url: '', api_key: '', settings: null }
        if (row.service_type === 'video') return { ...display, is_default: true, is_active: true, last_test_status: 'failed' }
        if (row.service_type === 'image') return { ...display, is_default: false, is_active: true, last_test_status: 'unknown' }
        if (row.service_type === 'tts') return { ...display, is_default: true, is_active: true, last_test_status: 'unknown' }
        if (row.service_type === 'storyboard_image') return { ...display, is_default: true, is_active: true, last_test_status: 'passed' }
        return { ...display, is_default: false, is_active: true, last_test_status: 'unknown' }
      })
    state.decoratedUiCreatedIds = new Set(decorated.map((row) => Number(row.id)))
    for (const id of state.decoratedUiCreatedIds) resolveUiCreatedRowWaiter(id)
    await route.fulfill({ response, body: JSON.stringify({ ...payload, data: decorated }) })
  }

  const readinessHandler = async (route) => {
    const request = route.request()
    const requestBody = request.postDataJSON() || {}
    const postData = JSON.stringify({
      ...requestBody,
      options: { ...(requestBody.options || {}), ...PROVIDER_SELECTION_OPTIONS },
    })
    if (state.mutationComplete && !state.recoveryComplete) requestCounts.readiness_after_mutation += 1
    if (readinessGate.isArmed()) {
      const status = await readinessGate.intercept()
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'E2E_READINESS_FAILURE', message: 'Controlled readiness failure' } }),
      })
      return
    }
    await route.continue({ postData })
  }

  const readinessResponseListener = (response) => {
    const request = response.request()
    const url = new URL(response.url())
    if (request.method() === 'POST' && url.pathname === '/api/v1/workflows/novel2anime/readiness') {
      state.readinessStatuses.push(response.status())
    }
  }

  await page.route(aiListPattern, aiListHandler)
  await page.route(readinessPattern, readinessHandler)
  page.on('response', readinessResponseListener)
  return {
    state,
    requestCounts,
    readinessGate,
    waitForUiCreatedRow,
    async dispose() {
      readinessGate.dispose()
      for (const [id, waiter] of uiCreatedRowWaiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(`decorated AI config list was disposed before including created id ${id}`))
      }
      uiCreatedRowWaiters.clear()
      try {
        await page.unrouteAll({ behavior: 'wait' })
      } finally {
        page.off('response', readinessResponseListener)
      }
    },
  }
}

async function cleanupFocusedAiState(state) {
  const failures = []
  for (const id of [...state.createdIds]) {
    try {
      await deleteConfig(id)
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    const visible = await apiRequest('/ai-configs')
    for (const config of visible.filter((item) => item.name === state.exactName)) await deleteConfig(config.id)
  } catch (error) {
    failures.push(error)
  }
  if (!state.fixtureRestored) {
    try {
      await apiRequest(`/ai-configs/${state.fixtureTextId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: state.fixtureWasActive }),
      })
      state.fixtureRestored = true
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    const remaining = await apiRequest('/ai-configs')
    state.visibleConfigRemoved = !remaining.some((item) => item.name === state.exactName)
    assert.equal(state.visibleConfigRemoved, true, 'focused UI configuration remains visible after exact cleanup')
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) throw new AggregateError(failures, 'Focused AI configuration cleanup failed')
}

async function readStableProviderCalls() {
  let previous = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = summarizeProviderCalls(await providerControlRequest('/__e2e/stats'))
    if (previous && JSON.stringify(previous) === JSON.stringify(current)) return current
    previous = current
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Provider call counters did not stabilize before focused acceptance')
}

function configFormItem(dialog, label) {
  return dialog.locator('.el-form-item').filter({ hasText: label }).first()
}

async function createMissingServiceFromUi(page, fixture) {
  const configDialog = page.locator('.ai-config-dialog:visible').last()
  await page.waitForFunction((addLabel) => {
    const dialog = [...document.querySelectorAll('.ai-config-dialog')].find((element) => (
      getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    ))
    const addButton = [...document.querySelectorAll('button')].find((element) => (
      element.textContent?.trim() === addLabel && !element.disabled
    ))
    return Boolean(dialog || addButton)
  }, UI.addConfiguration, { timeout: 30000 })
  if (!await configDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: UI.addConfiguration, exact: true }).click()
  }
  await configDialog.waitFor({ state: 'visible', timeout: 30000 })

  const expectedMutation = {
    provider: 'openai_compatible',
    service_type: 'text',
    default_model: 'local-e2e-text',
  }
  await configFormItem(configDialog, '\u540d\u79f0').locator('input').fill(fixture.exactName)
  await configFormItem(configDialog, '\u5382\u5546').locator('.el-select').click()
  await page.getByRole('option', { name: '\u004f\u0070\u0065\u006e\u0041\u0049 \u517c\u5bb9\u7f51\u5173', exact: true }).click()
  await configFormItem(configDialog, '\u0041\u0050\u0049 \u004b\u0065\u0079').locator('input').fill(PROVIDER_TOKEN)
  await configFormItem(configDialog, '\u6a21\u578b\u5217\u8868').locator('textarea').fill(expectedMutation.default_model)
  await configFormItem(configDialog, '\u9ed8\u8ba4\u6a21\u578b').locator('.el-select').click()
  await page.getByRole('option', { name: expectedMutation.default_model, exact: true }).click()
  await configDialog.locator('.advanced-config-collapse .el-collapse-item__header').click()
  await configFormItem(configDialog, '\u0042\u0061\u0073\u0065 \u0055\u0052\u004c').locator('input').fill(PROVIDER_BASE_URL)

  const defaultSwitchItem = configFormItem(configDialog, '\u8bbe\u4e3a\u9ed8\u8ba4')
  const defaultSwitchInput = defaultSwitchItem.locator('[role="switch"]')
  const defaultSwitchControl = defaultSwitchItem.locator('.el-switch')
  if (await defaultSwitchInput.getAttribute('aria-checked') === 'true') await defaultSwitchControl.click()
  assert.equal(await defaultSwitchInput.getAttribute('aria-checked'), 'false', 'focused UI config must not replace a user default')

  const responsePromise = page.waitForResponse((response) => {
    const request = response.request()
    const url = new URL(request.url())
    return request.method() === 'POST' && url.pathname === '/api/v1/ai-configs'
  }, { timeout: 30000 })
  await configDialog.getByRole('button', { name: UI.confirm, exact: true }).click()
  const response = await responsePromise
  assert.equal(response.ok(), true, `focused UI config create failed with HTTP ${response.status()}`)
  const requestBody = response.request().postDataJSON()
  assert.equal(requestBody.provider, expectedMutation.provider)
  assert.equal(requestBody.service_type, expectedMutation.service_type)
  assert.equal(requestBody.default_model, expectedMutation.default_model)
  assert.equal(requestBody.is_default, false)
  const responseBody = await response.json()
  const createdId = Number(responseBody?.data?.id)
  assert.ok(Number.isSafeInteger(createdId) && createdId > 0, 'focused UI config response must contain an id')
  assert.equal(fixture.createdIds.has(createdId), true, 'focused create route must claim cleanup ownership before responding')
  assert.equal(fixture.routes.state.uiCreatedIds.has(createdId), true, 'focused create route must register the created id before responding')
  assert.equal(fixture.routes.state.includeUiCreated, true, 'focused create route must enable list decoration before responding')
  assert.equal(fixture.routes.state.mutationComplete, true, 'focused create route must register mutation state before responding')
  await fixture.routes.waitForUiCreatedRow(createdId)

  assert.equal(fixture.routes.requestCounts.ui_config_posts, 1, 'focused acceptance must create exactly one UI config')
  assert.equal(responseBody.data.is_active, true)
  await page.getByText('\u6dfb\u52a0\u6210\u529f', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await configDialog.waitFor({ state: 'hidden', timeout: 10000 })
  return {
    method: 'POST',
    service_type: expectedMutation.service_type,
    created_id: createdId,
    is_default: false,
  }
}

async function setEvidenceTheme(page, theme) {
  const hasTheme = await page.locator('html').evaluate((element, value) => element.classList.contains(value), theme)
  if (!hasTheme) {
    const toggle = page.locator('.btn-theme:visible').first()
    if (await toggle.count()) await toggle.click()
    else {
      await page.evaluate((nextTheme) => {
        document.documentElement.classList.remove('light', 'dark')
        document.documentElement.classList.add(nextTheme)
        localStorage.setItem('lmd-theme', nextTheme)
      }, theme)
    }
  }
  await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme)
  assert.equal(await page.locator('html').evaluate((element, value) => element.classList.contains(value), theme), true)
}

async function assertScreenshotSurfaceSafe(page) {
  assert.equal(await page.locator('.ai-config-dialog:visible').count(), 0, 'secret-bearing AI form must be closed before capture')
  const exposure = await page.evaluate(({ protectedToken, protectedUrl }) => {
    const visibleText = document.body?.innerText || ''
    const inputValues = [...document.querySelectorAll('input, textarea')].map((element) => String(element.value || ''))
    return {
      token: visibleText.includes(protectedToken) || inputValues.includes(protectedToken),
      url: visibleText.includes(protectedUrl) || inputValues.includes(protectedUrl),
      text_length: visibleText.trim().length,
      loading_masks: [...document.querySelectorAll('.el-loading-mask')].filter((element) => (
        getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
      )).length,
    }
  }, { protectedToken: PROVIDER_TOKEN, protectedUrl: PROVIDER_BASE_URL })
  assert.equal(exposure.token, false, 'capture surface exposes a protected credential value')
  assert.equal(exposure.url, false, 'capture surface exposes a protected service URL')
  assert.ok(exposure.text_length > 100, 'capture surface is blank')
  assert.equal(exposure.loading_masks, 0, 'capture surface still contains a loading mask')
}

async function waitForAcceptanceCaptureReadiness(page, capture, fixture = {}) {
  const uiConfigName = String(fixture.uiConfigName || '').trim()
  const expectedConfigNames = Array.isArray(fixture.expectedConfigNames)
    ? fixture.expectedConfigNames.map((name) => String(name || '').trim())
    : []
  if (capture.surface === 'ai-config-management') {
    assert.ok(uiConfigName, 'AI config management capture readiness requires uiConfigName')
    assert.equal(expectedConfigNames.length, 5, 'AI config management capture readiness requires exactly five config names')
    assert.equal(expectedConfigNames.every(Boolean), true, 'AI config management capture readiness requires non-empty config names')
    assert.equal(new Set(expectedConfigNames).size, 5, 'AI config management capture readiness requires five unique config names')
    assert.equal(expectedConfigNames.includes(uiConfigName), true, 'AI config management capture readiness must include uiConfigName')
  }
  const expectedCoverage = FOCUSED_COVERAGE_MATRIX.map(({ service, state, test_status }) => ({ service, state, test_status }))
  await page.waitForFunction(({ surface, expectedConfigNames: configNames, expectedCoverage: coverage }) => {
    const isVisible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const hasLoadingMask = [...document.querySelectorAll('.el-loading-mask')].some(isVisible)
    if (hasLoadingMask) return false
    if (surface === 'project-readiness') {
      const toggle = document.querySelector('[data-testid="project-readiness-toggle"]')
      return toggle?.getAttribute('aria-expanded') === 'true'
        && isVisible(document.querySelector('[data-testid="project-readiness-details"]'))
        && [...document.querySelectorAll('[data-testid="project-readiness-details"] .summary-item')].filter(isVisible).length === 8
        && [...document.querySelectorAll('[data-testid="project-readiness-details"] .service-chip')].filter(isVisible).length === 5
    }
    if (surface === 'film-pipeline') {
      return isVisible(document.querySelector('.film-create'))
        && isVisible(document.querySelector('[data-testid="film-pipeline-summary"][data-state="ready"]'))
    }
    if (surface === 'ai-config-management') {
      const configPanel = document.querySelector('#ai-config-configs-panel')
      const configSection = document.querySelector('.config-list-section')
      const table = document.querySelector('#ai-config-configs-panel .config-list-section .el-table')
      if (!isVisible(configPanel) || !isVisible(configSection) || !isVisible(table)) return false
      const headers = [...table.querySelectorAll('.el-table__header-wrapper th.el-table__cell')]
      const nameColumnIndex = headers.findIndex((header) => (
        String(header.querySelector('.cell')?.textContent || '').trim() === '\u540d\u79f0'
      ))
      if (nameColumnIndex < 0) return false
      const visibleRows = [...table.querySelectorAll('.el-table__body-wrapper tbody tr.el-table__row')].filter(isVisible)
      if (visibleRows.length !== 5) return false
      const visibleNames = visibleRows.map((row) => {
        const cells = [...row.querySelectorAll('td.el-table__cell')]
        return String(cells[nameColumnIndex]?.querySelector('.cell')?.textContent || '').trim()
      })
      return new Set(visibleNames).size === 5
        && JSON.stringify([...visibleNames].sort()) === JSON.stringify([...configNames].sort())
    }
    if (surface === 'ai-config-coverage') {
      const records = [...document.querySelectorAll('#ai-config-coverage-panel .coverage-item')].map((element) => {
        const icon = element.querySelector('.coverage-icon')
        const serviceClass = [...(icon?.classList || [])].find((name) => /^coverage-icon-(?!$)/.test(name)) || ''
        const stateClass = ['coverage-default', 'coverage-configured', 'coverage-missing']
          .find((name) => element.classList.contains(name)) || ''
        const testNode = element.querySelector('.coverage-test-status')
        const testClass = ['test-failed', 'test-unknown', 'test-passed']
          .find((name) => testNode?.classList.contains(name)) || ''
        return {
          service: serviceClass.replace('coverage-icon-', ''),
          state: stateClass.replace('coverage-', ''),
          test_status: testClass.replace('test-', ''),
        }
      })
      return JSON.stringify(records) === JSON.stringify(coverage)
    }
    return false
  }, { surface: capture.surface, expectedConfigNames, expectedCoverage }, { timeout: 30000 })
  if (capture.surface === 'ai-config-coverage') await waitForCoverageCardMatrix(page)
}

async function prepareAcceptanceCaptureSurface(page, capture, fixture) {
  const episodeId = fixture.completedDrama.episodes[0].id
  fixture.routes.state.includeUiCreated = capture.surface === 'ai-config-management'
  const targetUrl = capture.surface === 'project-readiness'
    ? `${FRONTEND_URL}/drama/${fixture.dramaId}#source-intake-workflow`
    : `${FRONTEND_URL}/film/${fixture.dramaId}?episode=${episodeId}`
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  const workspaceDialog = page.locator('.ai-config-workspace-dialog')
  await workspaceDialog.waitFor({ state: 'hidden', timeout: 30000 })
  await setEvidenceTheme(page, capture.theme)

  if (capture.surface === 'project-readiness') {
    const toggle = page.getByTestId('project-readiness-toggle')
    await toggle.waitFor({ state: 'visible', timeout: 30000 })
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await page.getByTestId('project-readiness-details').waitFor({ state: 'visible', timeout: 10000 })
  } else {
    await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('[data-testid="film-pipeline-summary"][data-state="ready"]').waitFor({ state: 'visible', timeout: 30000 })
    if (capture.surface !== 'film-pipeline') {
      await page.locator('.btn-ai-config').click()
      await workspaceDialog.waitFor({ state: 'visible', timeout: 30000 })
      if (capture.surface === 'ai-config-management') {
        await page.getByTestId('ai-config-mode-configs').click()
        await page.locator('#ai-config-configs-panel').waitFor({ state: 'visible', timeout: 10000 })
        await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 10000 })
      } else {
        await page.getByTestId('ai-config-mode-coverage').click()
        await page.locator('#ai-config-coverage-panel').waitFor({ state: 'visible', timeout: 10000 })
      }
    }
  }
  await waitForAcceptanceCaptureReadiness(page, capture, fixture)
}

async function captureAcceptanceReportScreenshots(page, fixture) {
  const screenshots = []
  for (const capture of REQUIRED_FINAL_CAPTURES) {
    await page.setViewportSize({ width: capture.width, height: capture.height })
    await prepareAcceptanceCaptureSurface(page, capture, fixture)
    await page.evaluate(() => document.fonts?.ready)
    await assertScreenshotSurfaceSafe(page)
    const buffer = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide', type: 'png' })
    const inspected = inspectPng(buffer, capture.id)
    assert.deepEqual(
      { width: inspected.width, height: inspected.height },
      { width: capture.width, height: capture.height },
      `${capture.id} PNG dimensions do not match its original viewport`,
    )
    assert.ok(buffer.length > 10000, `${capture.id} PNG is unexpectedly small`)
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const descriptor = await fixture.evidenceRecorder.persistArtifact(
      `acceptance-report/screenshots/${capture.id}.png`,
      buffer,
    )
    assert.equal(descriptor.sha256, sha256)
    screenshots.push({
      id: capture.id,
      path: descriptor.path,
      bytes: descriptor.bytes,
      sha256,
      viewport: { width: capture.width, height: capture.height },
      surface: capture.surface,
      theme: capture.theme,
    })
  }
  return screenshots
}

async function writeAcceptanceManifest({ evidence, evidencePath, evidenceRoot }) {
  assert.equal(evidence.status, 'passed', 'acceptance manifest requires passed E2E evidence')
  assert.match(evidence.source.commit, /^[0-9a-f]{40,64}$/)
  assert.equal(evidence.source.working_tree_dirty, false)
  const evidenceBytes = await fs.readFile(evidencePath)
  const evidenceSha256 = crypto.createHash('sha256').update(evidenceBytes).digest('hex')
  const descriptors = new Map(evidence.browser.focused_acceptance.screenshots.map((item) => [item.id, item]))
  const screenshots = REQUIRED_FINAL_CAPTURES.map((capture) => {
    const descriptor = descriptors.get(capture.id)
    assert.ok(descriptor, `missing final screenshot descriptor ${capture.id}`)
    return {
      id: capture.id,
      path: `screenshots/${capture.id}.png`,
      sha256: descriptor.sha256,
      bytes: descriptor.bytes,
      mime: 'image/png',
      originalViewport: true,
      viewport: { width: capture.width, height: capture.height },
      theme: capture.theme,
      surface: capture.surface,
    }
  })
  const manifest = {
    schema: 'localminidrama.acceptance-screenshot-manifest.v1',
    source: { commit: evidence.source.commit, repositoryClean: true },
    e2eEvidence: { path: '../evidence.json', sha256: evidenceSha256 },
    screenshots,
  }
  const acceptanceRoot = path.join(evidenceRoot, 'acceptance-report')
  const temporaryPath = path.join(acceptanceRoot, 'manifest.json.tmp')
  const manifestPath = path.join(acceptanceRoot, 'manifest.json')
  await fs.mkdir(acceptanceRoot, { recursive: true })
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, manifestPath)
  return { path: manifestPath, screenshots: screenshots.length, sha256: evidenceSha256 }
}

async function verifyFocusedDesktopAcceptance(browser, {
  dramaId,
  fixtureTitle,
  completedDrama,
  providerState,
  stamp,
  cleanupActions,
  evidenceRecorder,
}) {
  const completedEpisodes = completedDrama?.episodes || []
  const firstEpisode = completedEpisodes[0]
  const secondEpisode = completedEpisodes[1]
  assert.ok(firstEpisode?.id, 'focused acceptance requires the completed first episode')
  assert.ok(secondEpisode?.id, 'focused acceptance requires a second episode for switch coverage')
  const textFixtures = providerState.created.filter((config) => (
    config.service_type === 'text' && String(config.name || '').includes(String(stamp))
  ))
  assert.equal(textFixtures.length, 1, 'focused acceptance requires one exact E2E text fixture')
  const textFixture = textFixtures[0]
  const exactName = `E2E Focused Text ${stamp}`
  const inactiveTextId = Number(textFixture.id)
  const expectedConfigNames = [
    ...providerState.created
      .filter((config) => Number(config.id) !== inactiveTextId)
      .map((config) => String(config.name || '').trim()),
    exactName,
  ]
  assert.equal(expectedConfigNames.length, 5, 'focused acceptance requires exactly five visible AI config names')
  assert.equal(expectedConfigNames.every(Boolean), true, 'focused acceptance AI config names must be non-empty')
  assert.equal(new Set(expectedConfigNames).size, 5, 'focused acceptance AI config names must be unique')
  const cleanupState = {
    exactName,
    exactNameRegistered: true,
    createdIds: new Set(),
    fixtureTextId: inactiveTextId,
    fixtureWasActive: Boolean(textFixture.is_active),
    fixtureRestored: false,
    visibleConfigRemoved: false,
  }
  registerCleanup(cleanupActions, `focused AI config ${exactName}`, () => cleanupFocusedAiState(cleanupState))
  await apiRequest(`/ai-configs/${inactiveTextId}`, {
    method: 'PUT',
    body: JSON.stringify({ is_active: false }),
  })

  const providerCallsBefore = await readStableProviderCalls()
  const page = await browser.newPage({ viewport: FOCUSED_DESKTOP_VIEWPORT })
  const audit = attachFocusedPageAudit(page, FOCUSED_DESKTOP_VIEWPORT)
  const forbiddenRequests = []
  const onRequest = (request) => {
    const pathname = new URL(request.url()).pathname
    if (
      request.method() === 'POST'
      && (pathname.endsWith('/ai-configs/test') || pathname.endsWith('/workflows/novel2anime'))
    ) forbiddenRequests.push({ method: request.method(), pathname })
  }
  page.on('request', onRequest)
  let routes = null
  let result = null
  let primaryError = null
  const disposalState = {
    routesDisposed: false,
    listenersDisposed: false,
    gateDisposed: false,
    pageClosed: false,
  }

  try {
    routes = await installFocusedAiRoutes(page, {
      providerState,
      inactiveTextId,
      uiConfigName: exactName,
      cleanupState,
    })
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' })
    const search = page.getByRole('textbox', { name: '\u641c\u7d22\u9879\u76ee', exact: true })
    await search.waitFor({ state: 'visible', timeout: 30000 })
    await search.fill(fixtureTitle)
    const projectCard = page.locator('.project-card').filter({ hasText: fixtureTitle })
    await projectCard.waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await projectCard.count(), 1, 'focused project search must resolve one project card')
    const storyEntry = projectCard.getByRole('link', { name: UI.openStoryMaterials(fixtureTitle), exact: true })
    await storyEntry.focus()
    const sourceNavigation = page.waitForURL((url) => (
      url.pathname === `/drama/${dramaId}` && url.hash === '#source-intake-workflow'
    ), { timeout: 30000 })
    await storyEntry.press('Enter')
    await sourceNavigation
    const sourceUrl = new URL(page.url())
    assert.equal(sourceUrl.hash, '#source-intake-workflow')
    assert.equal(sourceUrl.searchParams.has('returnTo'), true, 'project-list return context must be preserved')
    const workflow = page.locator('#source-intake-workflow')
    await workflow.waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('#source-intake-workflow')?.contains(document.activeElement))
    const completion = workflow.getByTestId('source-workflow-complete')
    await completion.waitFor({ state: 'visible', timeout: 30000 })
    await completion.getByRole('button', { name: UI.workflowHistory, exact: true }).waitFor({ state: 'visible' })
    await completion.getByRole('button', { name: UI.enterProduction, exact: true }).waitFor({ state: 'visible' })
    const filmNavigation = page.waitForURL((url) => (
      url.pathname === `/film/${dramaId}` && url.searchParams.get('episode') === String(firstEpisode.id)
    ), { timeout: 30000 })
    await completion.getByRole('button', { name: UI.enterProduction, exact: true }).click()
    await filmNavigation
    await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
    await waitForProjectTitle(page, fixtureTitle)
    assert.equal(String(await page.locator('.page-title').textContent() || '').trim(), fixtureTitle)
    const expectedFirstEpisodeLabel = formatExpectedEpisodeContextLabel(firstEpisode, 0)
    const episodeContext = await waitForEpisodeContext(page, expectedFirstEpisodeLabel)
    const initialRouteEpisodeId = Number(new URL(page.url()).searchParams.get('episode'))
    assert.equal(initialRouteEpisodeId, Number(firstEpisode.id), 'initial focused episode route is incorrect')
    const expectedFirstScriptTitle = String(
      firstEpisode.title || `\u7b2c${Number(firstEpisode.episode_number) || 1}\u96c6`,
    ).trim()
    const initialScriptTitle = await waitForScriptEpisodeTitle(page, expectedFirstScriptTitle)
    const switchedEpisodeContext = await selectEpisodeFromHeader(page, secondEpisode, 1)
    const restoredEpisodeContext = await selectEpisodeFromHeader(page, firstEpisode, 0)
    const episodeLabel = episodeContext.title

    const currentSteps = page.locator('#film-create-quick-nav [aria-current="step"]')
    const completedSteps = page.locator('#film-create-quick-nav .status-done:not(.is-current)')
    assert.equal(await currentSteps.count(), 1, 'FilmCreate must expose exactly one current navigation step')
    assert.ok(await completedSteps.count() > 0, 'FilmCreate must expose a distinct completed navigation step')
    const currentLabel = String(await currentSteps.first().innerText()).trim()
    assert.equal(await currentSteps.first().evaluate((element) => element.matches('.status-done:not(.is-current)')), false)

    const pipelineDetails = page.getByTestId('film-pipeline-details')
    await pipelineDetails.waitFor({ state: 'hidden', timeout: 10000 })
    const blockedSummary = page.locator('[data-testid="film-pipeline-summary"][data-state="blocked"]')
    await blockedSummary.waitFor({ state: 'visible', timeout: 30000 })
    let pipelineAction = page.getByTestId('film-pipeline-action')
    await pipelineAction.filter({ hasText: UI.configureMissingService }).waitFor({ state: 'visible', timeout: 30000 })

    const genericOpener = page.locator('.btn-ai-config')
    await genericOpener.focus()
    await genericOpener.click()
    const workspaceDialog = page.locator('.ai-config-workspace-dialog')
    await workspaceDialog.waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('#ai-config-coverage-panel').waitFor({ state: 'visible', timeout: 30000 })
    await waitForCoverageCardMatrix(page)
    const layout1280 = await assertCoverageLayout(page, {
      viewport: FOCUSED_DESKTOP_VIEWPORT,
      columns: 5,
      requireSingleRow: true,
    })
    const serviceOrder = layout1280.cards.map(({ service }) => service)
    const actionCounts = layout1280.cards.map(({ action_count }) => action_count)
    assert.equal(layout1280.cards.every((item) => item.action_count <= 1), true)
    const componentSelectors = [
      '.ai-config-workspace-dialog .el-dialog__body',
      '.ai-config-workspace-dialog .tab-content',
      '.ai-config-workspace-dialog .config-workspace-panel:visible',
      '#ai-config-coverage-panel .coverage-panel',
      '#ai-config-coverage-panel .coverage-grid',
      '#ai-config-coverage-panel .coverage-item',
      '#ai-config-coverage-panel .coverage-actions',
    ]
    const overflow1280 = await assertComponentHorizontalOverflow(page, 'focused 1280 coverage', componentSelectors)
    const layoutContract = { minimumTargetSize: 32 }
    await assertMinimumTargetSize(page, 'focused 1280 coverage', [
      '#ai-config-coverage-panel .coverage-select',
      '#ai-config-coverage-panel .coverage-actions button',
      '.config-workspace-mode',
      '.ai-config-dialog-back',
      '.ai-config-workspace-dialog .el-dialog__headerbtn',
    ], layoutContract.minimumTargetSize)
    const document1280 = { ...(await assertNoHorizontalOverflow(page, 'focused 1280 coverage')), passed: true }
    await workspaceDialog.locator('.el-dialog__headerbtn').click()
    await workspaceDialog.waitFor({ state: 'hidden', timeout: 10000 })
    const nativeFocus1280 = await assertWorkbenchFocus(page, {
      preferred: genericOpener,
      fallback: page.getByTestId('film-pipeline-summary'),
      label: '1280 native AI close',
    })
    assert.equal(await page.getByText(UI.configurationRechecking, { exact: true }).count(), 0)
    pipelineAction = page.getByTestId('film-pipeline-action')
    await pipelineAction.filter({ hasText: UI.configureMissingService }).waitFor({ state: 'visible', timeout: 30000 })

    await pipelineAction.focus()
    await pipelineAction.click()
    await workspaceDialog.waitFor({ state: 'visible', timeout: 30000 })
    await page.getByTestId('ai-config-mode-configs').waitFor({ state: 'visible', timeout: 30000 })
    const mutation = await createMissingServiceFromUi(page, {
      exactName,
      createdIds: cleanupState.createdIds,
      routes,
    })
    routes.readinessGate.arm()
    const customReturn = workspaceDialog.getByRole('button', { name: UI.returnToProduction, exact: true })
    await customReturn.click()
    await routes.readinessGate.waitUntilIntercepted()
    await workspaceDialog.waitFor({ state: 'hidden', timeout: 10000 })
    await page.getByText(UI.configurationRechecking, { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('[data-testid="film-pipeline-summary"][data-state="checking"]').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(
      await page.locator('button:visible:not([disabled])').filter({ hasText: UI.generateFinal }).count(),
      0,
    )
    const customFocus = await assertWorkbenchFocus(page, {
      preferred: pipelineAction,
      fallback: page.getByTestId('film-pipeline-summary'),
      label: 'custom return to production',
    })
    routes.readinessGate.release(503)
    await page.locator('[data-testid="film-pipeline-summary"][data-state="error"]').waitFor({ state: 'visible', timeout: 10000 })
    assert.equal(await page.locator('[data-testid="film-pipeline-summary"][data-state="ready"]').count(), 0)
    const retryAction = page.getByTestId('film-pipeline-action').filter({ hasText: UI.retryCapability })
    await retryAction.waitFor({ state: 'visible', timeout: 10000 })
    await retryAction.focus()
    const retryResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/workflows/novel2anime/readiness'
      && response.status() === 200
    ), { timeout: 30000 })
    await retryAction.press('Enter')
    const retryResponse = await retryResponsePromise
    const retryBody = await retryResponse.json()
    await page.locator('[data-testid="film-pipeline-summary"][data-state="ready"]').waitFor({ state: 'visible', timeout: 30000 })
    const finalAction = page.getByTestId('film-pipeline-action').filter({ hasText: UI.generateFinal })
    await finalAction.waitFor({ state: 'visible', timeout: 10000 })
    routes.state.recoveryComplete = true
    assert.equal(routes.requestCounts.readiness_after_mutation, 2)
    assert.equal(routes.state.readinessStatuses.includes(503), true)
    assert.equal(retryResponse.status(), 200)
    assert.equal(retryBody?.data?.missing_capabilities?.length, 0)

    await page.setViewportSize(AI_TWO_COLUMN_VIEWPORT)
    routes.state.includeUiCreated = false
    await genericOpener.focus()
    await genericOpener.click()
    await workspaceDialog.waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('#ai-config-coverage-panel').waitFor({ state: 'visible', timeout: 30000 })
    await waitForCoverageCardMatrix(page)
    const layout1024 = await assertCoverageLayout(page, {
      viewport: AI_TWO_COLUMN_VIEWPORT,
      columns: 2,
    })
    assert.deepEqual(layout1024.cards.map(({ service }) => service), serviceOrder)
    assert.deepEqual(layout1024.cards.map(({ action_count }) => action_count), actionCounts)
    const overflow1024 = await assertComponentHorizontalOverflow(page, 'focused 1024 coverage', componentSelectors)
    await assertMinimumTargetSize(page, 'focused 1024 coverage', [
      '#ai-config-coverage-panel .coverage-select',
      '#ai-config-coverage-panel .coverage-actions button',
      '.config-workspace-mode',
      '.ai-config-dialog-back',
      '.ai-config-workspace-dialog .el-dialog__headerbtn',
    ], layoutContract.minimumTargetSize)
    const document1024 = { ...(await assertNoHorizontalOverflow(page, 'focused 1024 coverage')), passed: true }
    await workspaceDialog.locator('.el-dialog__headerbtn').click()
    await workspaceDialog.waitFor({ state: 'hidden', timeout: 10000 })
    const nativeFocus1024 = await assertWorkbenchFocus(page, {
      preferred: genericOpener,
      fallback: page.getByTestId('film-pipeline-summary'),
      label: '1024 native AI close',
    })

    const screenshots = await captureAcceptanceReportScreenshots(page, {
      dramaId,
      completedDrama,
      routes,
      evidenceRecorder,
      uiConfigName: exactName,
      expectedConfigNames,
    })
    const providerCallsAfter = await readStableProviderCalls()
    assert.deepEqual(providerCallsAfter, providerCallsBefore, 'focused acceptance must not call the Provider')
    assert.deepEqual(forbiddenRequests, [], 'focused acceptance attempted a forbidden Provider test or workflow start')
    assert.deepEqual(audit.errors, [], `focused acceptance emitted browser errors:\n${audit.errors.join('\n')}`)

    result = {
      status: 'passed',
      primary_viewport: FOCUSED_DESKTOP_VIEWPORT,
      ai_two_column_viewport: AI_TWO_COLUMN_VIEWPORT,
      project: { id: dramaId, title: fixtureTitle },
      episode: {
        id: firstEpisode.id,
        label: episodeLabel,
        visible_label: episodeContext.visibleLabel,
        aria_label: episodeContext.ariaLabel,
        initial_route_id: initialRouteEpisodeId,
        initial_script_title: initialScriptTitle,
        switched_id: secondEpisode.id,
        switched_label: switchedEpisodeContext.title,
        switched_route_id: switchedEpisodeContext.routeEpisodeId,
        switched_script_title: switchedEpisodeContext.scriptTitle,
        restored_id: firstEpisode.id,
        restored_label: restoredEpisodeContext.title,
        restored_route_id: restoredEpisodeContext.routeEpisodeId,
        restored_script_title: restoredEpisodeContext.scriptTitle,
        switch_restored: restoredEpisodeContext.title === episodeContext.title,
      },
      source_handoff: {
        project_card_entry: true,
        return_hash: sourceUrl.hash,
        compact_complete: true,
        entered_production: true,
      },
      navigation: {
        current_count: 1,
        current_label: currentLabel,
        completed_distinct_count: await completedSteps.count(),
      },
      pipeline: {
        initial_state: 'blocked',
        initial_action: UI.configureMissingService,
        post_mutation_state: 'checking',
        injected_failure_state: 'error',
        retry_action: UI.retryCapability,
        final_state: 'ready',
        final_action: UI.generateFinal,
      },
      ai: {
        service_order: serviceOrder,
        action_counts: actionCounts,
        mutation,
        configuration_feedback_observed: true,
        native_close_focus_restored: nativeFocus1280.restored && nativeFocus1024.restored,
        custom_return_focus_restored: customFocus.restored,
        columns_1280: layout1280.columns,
        columns_1024: layout1024.columns,
        minimum_target_size: layoutContract.minimumTargetSize,
      },
      readiness: {
        requests_after_mutation: routes.requestCounts.readiness_after_mutation,
        injected_failure_status: 503,
        retry_status: retryResponse.status(),
        final_missing_capabilities: retryBody.data.missing_capabilities.length,
      },
      provider_calls_unchanged: true,
      document_overflow: { '1280x720': document1280, '1024x768': document1024 },
      component_overflow: { '1280x720': overflow1280, '1024x768': overflow1024 },
      cleanup: null,
      screenshots,
    }
  } catch (error) {
    primaryError = error
  } finally {
    const finalizationFailures = []
    page.off('request', onRequest)
    audit.dispose()
    disposalState.listenersDisposed = true
    if (routes) {
      try {
        await routes.dispose()
        disposalState.routesDisposed = true
        disposalState.gateDisposed = true
      } catch (error) {
        finalizationFailures.push(error)
      }
    }
    await cleanupFocusedAiState(cleanupState).catch((error) => finalizationFailures.push(error))
    try {
      await page.close()
      disposalState.pageClosed = true
    } catch (error) {
      finalizationFailures.push(error)
    }
    if (finalizationFailures.length) {
      const cleanupError = new AggregateError(finalizationFailures, 'Focused acceptance disposal failed')
      primaryError = primaryError
        ? new AggregateError([primaryError, cleanupError], 'Focused acceptance and cleanup failed')
        : cleanupError
    }
  }
  if (primaryError) throw primaryError
  result.cleanup = {
    exact_name_registered: cleanupState.exactNameRegistered,
    created_id_registered: cleanupState.createdIds.has(result.ai.mutation.created_id),
    visible_config_removed: cleanupState.visibleConfigRemoved,
    fixture_restored: cleanupState.fixtureRestored,
    routes_disposed: disposalState.routesDisposed,
    listeners_disposed: disposalState.listenersDisposed,
    gate_disposed: disposalState.gateDisposed,
    page_closed: disposalState.pageClosed,
  }
  return result
}

async function verifyCompletedUi(browser, dramaId, viewport, {
  reusePage = null,
  audit = null,
  verifyDownload = false,
  evidenceRecorder = null,
  expectedTrackCount = REQUIRED_TRACK_TYPES.length,
} = {}) {
  const page = reusePage || await browser.newPage({ viewport })
  const pageAudit = audit || attachPageAudit(page, viewport)
  await page.setViewportSize(viewport)
  await page.goto(`${FRONTEND_URL}/drama/${dramaId}`, { waitUntil: 'domcontentloaded' })
  const workflow = page.locator('#source-intake-workflow')
  await workflow.waitFor({ state: 'visible', timeout: 30000 })
  await workflow.getByRole('button', { name: UI.refresh, exact: true }).click()
  const completion = workflow.getByTestId('source-workflow-complete')
  await completion.waitFor({ state: 'visible', timeout: 30000 })
  await completion.getByRole('button', { name: UI.workflowHistory, exact: true }).click()
  await flowStepButton(workflow, UI.timelineStep).click()
  const timeline = workflow.locator('.timeline-block')
  assert.ok(Number.isInteger(expectedTrackCount) && expectedTrackCount > 0, 'expected timeline track count is required')
  await timeline.getByText(`${expectedTrackCount} \u8f68`, { exact: true }).waitFor({ timeout: 30000 })
  await timeline.getByText('video / subtitle / voice / dialogue / effect / bgm / transition', { exact: true }).waitFor({ timeout: 30000 })
  await assertNoHorizontalOverflow(page, `drama detail ${viewport.width}x${viewport.height}`)

  await timeline.getByRole('button', { name: UI.continueImport, exact: true }).click()
  await workflow.getByPlaceholder(UI.sourcePlaceholder, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const navigationPromise = page.waitForURL(new RegExp(`/film/${dramaId}(?:[?#]|$)`), { timeout: 30000 })
  await completion.getByRole('button', { name: UI.enterProduction, exact: true }).click()
  await navigationPromise
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('#film-create-quick-nav button.nav-step').filter({ hasText: UI.deliveryExport }).click()
  const composedVideo = await verifyPlayableVideo(page.locator('.video-preview-player'), 'composed episode preview')
  const storyboardVideo = await verifyPlayableVideo(page.locator('.sb-video-player').first(), 'storyboard video preview')
  await persistBrowserPlayback(evidenceRecorder, viewport, composedVideo, storyboardVideo)
  const finalDownload = verifyDownload ? await verifyFinalVideoDownloadUi(page, evidenceRecorder) : null
  await assertNoHorizontalOverflow(page, `FilmCreate ${viewport.width}x${viewport.height}`)

  const collapse = page.getByRole('button', { name: UI.collapseNavigation, exact: true })
  await collapse.click()
  await page.getByRole('button', { name: UI.expandNavigation, exact: true }).click()
  const backPromise = page.waitForURL(new RegExp(`/drama/${dramaId}(?:[?#]|$)`), { timeout: 30000 })
  await page.getByRole('button', { name: UI.returnToDrama, exact: true }).click()
  await backPromise
  await workflow.waitFor({ state: 'visible', timeout: 30000 })
  await assertNoHorizontalOverflow(page, `return to drama ${viewport.width}x${viewport.height}`)
  assertNoConsoleErrors(pageAudit, `viewport ${viewport.width}x${viewport.height}`)
  if (!reusePage) await page.close()
  return { viewport, composedVideo, storyboardVideo, finalDownload }
}

async function main({
  logger = console,
  now = Date.now,
  launchBrowser = defaultLaunchBrowser,
  evidenceRoot = process.env.E2E_EVIDENCE_DIR || DEFAULT_EVIDENCE_ROOT,
  sourceIdentity = null,
  evidenceForbiddenValues = [],
} = {}) {
  const evidenceRecorder = await createEvidenceRecorder({
    evidenceRoot,
    sourceIdentity,
    now,
    forbiddenValues: evidenceForbiddenValues,
  })
  const cleanupActions = []
  const workflowDrainPrerequisite = createWorkflowDrainPrerequisite()
  let primaryError = null
  let primaryFailureStage = null
  let draftWorkflowRun = null
  let workflowRun = null
  let providerState = null
  let providerStatsReset = false
  let fixturePurgeResult = null
  const protectedValues = collectForbiddenValues(evidenceForbiddenValues)

  try {
    const stamp = now()
    const sourceMarker = `E2E source marker ${stamp}`
    await evidenceRecorder.stage('browser_recovery')
    const browser = await launchBrowser(browserLaunchOptions())
    registerCleanup(cleanupActions, 'browser', () => browser.close())
    const fixtureTitle = `${getSmokeHelpers().E2E_TITLE_PREFIX}中文路径 ${stamp}`
    const startViewport = DESKTOP_VIEWPORTS[0]
    const recoveryPage = await browser.newPage({ viewport: startViewport })
    const recoveryAudit = attachPageAudit(recoveryPage, startViewport)
    const failureRecoveryEvidence = await verifyProjectListRecoveryUi(recoveryPage)
    failureRecoveryEvidence.observedBrowserErrors = assertOnlyInjectedRecoveryErrors(recoveryAudit)
    await recoveryPage.close()
    await evidenceRecorder.stage('browser_recovery', 'passed')

    await evidenceRecorder.stage('fixture_creation')
    const startPage = await browser.newPage({ viewport: startViewport })
    const startAudit = attachPageAudit(startPage, startViewport)

    const drama = await createDramaFromUi(startPage, {
      title: fixtureTitle,
      description: 'Production E2E fixture created through the desktop web UI',
    })
    if (drama?.id) {
      registerCleanup(cleanupActions, `hard purge drama ${drama.id}`, async () => {
        workflowDrainPrerequisite.assertDrained()
        fixturePurgeResult = await runDockerFixturePurge({
          dramaId: drama.id,
          expectedTitle: fixtureTitle,
        })
      })
    }
    registerCleanup(cleanupActions, 'temporary AI provider configs', async () => {
      workflowDrainPrerequisite.assertDrained()
      if (providerState) await restoreProviderConfigs(providerState)
    })
    assert.ok(drama?.id, 'created drama id is required')
    await verifyProjectReadinessDisclosureUi(startPage)
    const aiConfigReturnEvidence = await verifyAiConfigReturnUi(startPage, drama.id)
    assert.equal(aiConfigReturnEvidence.return_to_preserved, true)
    assert.equal(aiConfigReturnEvidence.workflow_visible, true)
    await evidenceRecorder.set({ browser: { ai_config_return: aiConfigReturnEvidence } })

    const sourceResult = await importSourceFromUi(startPage, drama.id, {
      title: `E2E production source ${stamp}`,
      text: [
        `shot 1 Characters: Aria, Bo. Location: Gate. Aria says the warning is real. ${sourceMarker}.`,
        'shot 2 Narration: The guards arrive. Bo starts a fight and they escape through the market.',
      ].join('\n'),
    })
    assert.ok(sourceResult?.source?.id, 'created source id is required')
    await evidenceRecorder.set({ workflow: { drama_id: drama.id } })
    await evidenceRecorder.stage('fixture_creation', 'passed')

    await evidenceRecorder.stage('draft_workflow')
    draftWorkflowRun = await startDraftFromUi(startPage, drama.id)
    await evidenceRecorder.set({ workflow: { draft_run_id: draftWorkflowRun.id } })
    registerCleanup(cleanupActions, `cancel draft workflow ${draftWorkflowRun.id}`, async () => {
      await workflowDrainPrerequisite.drain(draftWorkflowRun.id, cancelAndWaitForWorkflowWorkerDrain)
    })
    const draftCompleted = await waitForWorkflow(draftWorkflowRun.id)
    assert.equal(draftCompleted.status, 'completed', `draft workflow failed: ${draftCompleted.error || 'unknown error'}`)
    assert.equal(draftCompleted.input_json?.qa_mode, 'draft')
    const draftPlaceholders = await assertDraftPlaceholderState(drama.id)
    const draftUiEvidence = await verifyDraftUpgradeUi(startPage, drama.id)
    await evidenceRecorder.stage('draft_workflow', 'passed')

    await evidenceRecorder.stage('provider_setup')
    providerState = await installProviderConfigs(stamp)
    const aiConfigUiEvidence = await verifyAiConfigurationUi(startPage)
    await providerControlRequest('/__e2e/reset', 'POST')
    providerStatsReset = true
    await evidenceRecorder.set({ provider: { reset_observed: true } })
    await evidenceRecorder.stage('provider_setup', 'passed')

    await evidenceRecorder.stage('production_workflow')
    workflowRun = await startProductionFromUi(startPage, drama.id)
    await evidenceRecorder.set({ workflow: { production_run_id: workflowRun.id } })
    registerCleanup(cleanupActions, `cancel workflow ${workflowRun.id}`, async () => {
      await workflowDrainPrerequisite.drain(workflowRun.id, cancelAndWaitForWorkflowWorkerDrain)
    })

    const completed = await waitForWorkflow(workflowRun.id)
    await evidenceRecorder.set({
      provider: { workflow_invocations: summarizeProviderInvocations(completed.provider_invocations) },
    })
    assert.equal(completed.status, 'completed', `production workflow failed: ${completed.error || 'unknown error'}`)
    assert.equal(completed.input_json?.qa_mode, 'production')
    assert.equal(completed.progress, 100)
    assert.equal(completed.steps.every((step) => step.status === 'completed'), true)
    for (const stepKey of ['image_generation', 'video_generation', 'audio_generation', 'post_composite', 'qa_audit']) {
      const step = completed.steps.find((item) => item.step_key === stepKey)
      assert.ok(step, `missing workflow step ${stepKey}`)
      assert.equal(step.output_json?.mode === 'production' || stepKey === 'qa_audit', true)
    }
    assertProviderInvocations(completed.provider_invocations)
    await evidenceRecorder.stage('production_workflow', 'passed')

    await evidenceRecorder.stage('qa_audit')
    const reports = await apiRequest(`/qa/reports?drama_id=${drama.id}&run_id=${encodeURIComponent(workflowRun.id)}`)
    const qaReport = reports[0] || null
    await evidenceRecorder.set({
      qa: {
        status: qaReport ? (qaReport.passed ? 'passed' : 'failed') : 'missing',
        passed: qaReport ? Boolean(qaReport.passed) : false,
        score: qaReport?.score ?? null,
        mode: qaReport?.report_json?.mode || 'production',
      },
    })
    assert.ok(reports.length > 0, 'production workflow must create a QA report')
    assert.equal(reports[0].passed, true)
    assert.equal(reports[0].report_json?.mode, 'production')
    await evidenceRecorder.stage('qa_audit', 'passed')

    await evidenceRecorder.stage('timeline_and_media')
    const timeline = await apiRequest(`/dramas/${drama.id}/timeline`)
    const timelineEvidence = assertProductionTimeline(timeline)
    await evidenceRecorder.set({ timeline: timelineEvidence })
    const manifest = await apiRequest(`/dramas/${drama.id}/timeline/manifest`)
    assert.equal(manifest.schema, 'localminidrama.timeline_manifest.v1')
    assert.deepEqual(manifest.summary.track_types, REQUIRED_TRACK_TYPES)
    assert.ok(manifest.summary.episode_count > 0, 'timeline manifest must contain episodes')
    assert.equal(manifest.episodes.length, manifest.summary.episode_count)
    await evidenceRecorder.set({
      timeline: {
        manifest: {
          schema: manifest.schema,
          episodes: manifest.summary.episode_count,
          tracks: manifest.summary.track_count,
          items: manifest.summary.item_count,
        },
      },
    })
    const completedDrama = await apiRequest(`/dramas/${drama.id}`)
    const mediaEvidence = await verifyDurableMedia(completedDrama, evidenceRecorder)
    await evidenceRecorder.set({
      artifacts: {
        png: mediaEvidence.image,
        mp3: mediaEvidence.audio,
        mp4: mediaEvidence.video,
        composed_video: mediaEvidence.composite,
      },
    })
    await evidenceRecorder.stage('timeline_and_media', 'passed')

    await evidenceRecorder.stage('focused_desktop_acceptance')
    await evidenceRecorder.set({ browser: { focused_acceptance: { status: 'running' } } })
    const focusedAcceptance = await verifyFocusedDesktopAcceptance(browser, {
      dramaId: drama.id,
      fixtureTitle,
      completedDrama,
      providerState,
      stamp,
      cleanupActions,
      evidenceRecorder,
    })
    await evidenceRecorder.set({ browser: { focused_acceptance: focusedAcceptance } })
    await evidenceRecorder.stage('focused_desktop_acceptance', 'passed')

    await evidenceRecorder.stage('browser_acceptance')
    await evidenceRecorder.set({ browser: { status: 'running' } })
    const browserEvidence = []
    browserEvidence.push(await verifyCompletedUi(browser, drama.id, startViewport, {
      reusePage: startPage,
      audit: startAudit,
      verifyDownload: true,
      evidenceRecorder,
      expectedTrackCount: timelineEvidence.tracks,
    }))
    await evidenceRecorder.set({
      browser: {
        playback: browserEvidence.map((item) => ({
          viewport: item.viewport,
          composed: summarizePlayback(item.composedVideo),
          storyboard: summarizePlayback(item.storyboardVideo),
        })),
      },
    })
    browserEvidence.push(await verifyCompletedUi(browser, drama.id, DESKTOP_VIEWPORTS[1], {
      expectedTrackCount: timelineEvidence.tracks,
    }))
    await evidenceRecorder.set({
      browser: {
        playback: browserEvidence.map((item) => ({
          viewport: item.viewport,
          composed: summarizePlayback(item.composedVideo),
          storyboard: summarizePlayback(item.storyboardVideo),
        })),
      },
    })
    const uiProjectExport = await verifyProjectExportUi(startPage, fixtureTitle, evidenceRecorder)
    assertNoConsoleErrors(startAudit, 'UI project export')
    const browserPlayback = browserEvidence.map((item) => ({
      viewport: item.viewport,
      composed: summarizePlayback(item.composedVideo),
      storyboard: summarizePlayback(item.storyboardVideo),
    }))
    await evidenceRecorder.set({
      artifacts: {
        final_video: browserEvidence[0].finalDownload.artifact,
        project_zip: uiProjectExport.artifact,
      },
      browser: {
        status: 'passed',
        playback: browserPlayback,
        final_download: {
          validated: browserEvidence[0].finalDownload.validated,
          artifact: browserEvidence[0].finalDownload.artifact,
        },
        project_export: {
          validated: uiProjectExport.validated,
          entries: uiProjectExport.entries,
          artifact: uiProjectExport.artifact,
        },
        failure_recovery: failureRecoveryEvidence,
        ai_service_setup: aiConfigUiEvidence,
        draft_upgrade: draftUiEvidence,
      },
      draft: draftPlaceholders,
    })
    await evidenceRecorder.stage('browser_acceptance', 'passed')

    await evidenceRecorder.stage('api_export')
    const exportEvidence = await verifyExport(drama.id, evidenceRecorder)
    await evidenceRecorder.set({
      artifacts: { api_project_zip: exportEvidence.artifact },
      export: {
        validated: true,
        entries: exportEvidence.entries,
        images: exportEvidence.images,
        videos: exportEvidence.videos,
        audio: exportEvidence.audio,
      },
    })
    await evidenceRecorder.stage('api_export', 'passed')

    await evidenceRecorder.stage('provider_accounting')
    const providerStats = await providerControlRequest('/__e2e/stats')
    assertProviderStats(providerStats, [PROVIDER_TOKEN, sourceMarker])
    const providerCalls = summarizeProviderCalls(providerStats)
    await evidenceRecorder.set({ provider: { calls: providerCalls } })
    await evidenceRecorder.stage('provider_accounting', 'passed')

  } catch (error) {
    primaryError = error
    primaryFailureStage = evidenceRecorder.currentStage()
    if (primaryFailureStage === 'browser_acceptance') {
      await evidenceRecorder.set({ browser: { status: 'failed' } }).catch(() => {})
    }
    if (primaryFailureStage === 'focused_desktop_acceptance') {
      await evidenceRecorder.set({ browser: { focused_acceptance: { status: 'failed' } } }).catch(() => {})
    }
    if (providerStatsReset) {
      try {
        const providerStats = await providerControlRequest('/__e2e/stats')
        const providerCalls = summarizeProviderCalls(providerStats)
        await evidenceRecorder.set({ provider: { calls: providerCalls } })
      } catch {
        // The initialized zero counts are authoritative when the provider was unreachable.
      }
    }
  }

  await evidenceRecorder.stage('cleanup')
  const cleanupLogger = {
    warn(message) {
      logger.warn(sanitizeEvidenceText(message, protectedValues))
    },
  }
  const cleanupFailures = await runCleanup(cleanupActions, cleanupLogger)
  await evidenceRecorder.set({
    cleanup: {
      status: cleanupFailures.length ? 'failed' : 'passed',
      failure_count: cleanupFailures.length,
      media_cleanup: fixturePurgeResult?.media_cleanup || null,
    },
  })
  await evidenceRecorder.stage('cleanup', cleanupFailures.length ? 'failed' : 'passed')
  if (cleanupFailures.length && !primaryError) {
    primaryError = new AggregateError(
      cleanupFailures.map(({ error }) => error),
      `E2E cleanup failed for ${cleanupFailures.map(({ label }) => label).join(', ')}`,
    )
  }

  if (primaryError) {
    await evidenceRecorder.fail(primaryError, primaryFailureStage || 'cleanup')
    throw primaryError
  }

  try {
    await evidenceRecorder.stage('evidence_validation')
    const finalEvidence = await evidenceRecorder.pass()
    const acceptanceManifest = await writeAcceptanceManifest({
      evidence: finalEvidence,
      evidencePath: evidenceRecorder.evidencePath,
      evidenceRoot: evidenceRecorder.root,
    })
    logger.log(JSON.stringify({
      status: finalEvidence.status,
      evidence: path.relative(PROJECT_ROOT, evidenceRecorder.evidencePath).replace(/\\/g, '/'),
      commit: finalEvidence.source.commit,
      version: finalEvidence.source.version,
      acceptance_screenshots: acceptanceManifest.screenshots,
    }))
    return finalEvidence
  } catch (error) {
    await evidenceRecorder.fail(error)
    throw error
  }
}

module.exports = {
  AI_TWO_COLUMN_VIEWPORT,
  CONFIG_PREFIX,
  DEFAULT_EVIDENCE_ROOT,
  DESKTOP_VIEWPORTS,
  EVIDENCE_SCHEMA,
  FOCUSED_DESKTOP_VIEWPORT,
  REQUIRED_PROVIDER_ENDPOINTS,
  REQUIRED_PROVIDER_TYPES,
  REQUIRED_TRACK_TYPES,
  assertCoverageCardMatrix,
  assertCoverageLayout,
  assertCompleteEvidence,
  assertEvidencePayloadSafe,
  assertEvidenceSerializationSafe,
  assertMp3,
  assertMp4,
  assertPng,
  assertProductionTimeline,
  assertProviderInvocations,
  assertProviderStats,
  cancelAndWaitForWorkflowWorkerDrain,
  createEvidenceRecorder,
  createReadinessGate,
  createWorkflowDrainPrerequisite,
  createMissingServiceFromUi,
  captureAcceptanceReportScreenshots,
  extractZipEntries,
  fetchWithIdempotentRetry,
  formatExpectedEpisodeContextLabel,
  focusedAiRouteAction,
  installProviderConfigs,
  installFocusedAiRoutes,
  main,
  prepareAcceptanceCaptureSurface,
  revealWorkflowHistoryIfCompleted,
  sanitizeEvidenceText,
  summarizeProviderCalls,
  summarizeProviderInvocations,
  restoreProviderConfigs,
  runCleanup,
  resetAcceptanceReportArtifacts,
  verifyExport,
  verifyAiConfigReturnUi,
  verifyAiConfigurationUi,
  verifyFilmPipelineDisclosureUi,
  verifyFocusedDesktopAcceptance,
  verifyProjectReadinessDisclosureUi,
  waitForEnabledAction,
  waitForAcceptanceCaptureReadiness,
  waitForCoverageCardMatrix,
  waitForEpisodeContext,
  waitForWorkflow,
  waitForWorkflowWorkerDrain,
  waitForProjectTitle,
  selectEpisodeFromHeader,
  writeAcceptanceManifest,
}

if (require.main === module) {
  const command = process.argv[2]
  const run = command === '--sanitize-log'
    ? (async () => {
        let input = ''
        for await (const chunk of process.stdin) input += chunk
        process.stdout.write(sanitizeEvidenceText(input, collectForbiddenValues(), Infinity))
      })()
    : main()
  run.catch((error) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(sanitizeEvidenceText(message, collectForbiddenValues()))
    process.exitCode = 1
  })
}
