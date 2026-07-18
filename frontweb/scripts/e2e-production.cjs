const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const { version: PACKAGE_VERSION } = require('../package.json')

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
const UI = Object.freeze({
  workflowTitle: '\u6545\u4e8b\u7d20\u6750\u6d41\u7a0b',
  intakeStep: '\u5bfc\u5165\u7d20\u6750',
  draftMode: '\u8349\u7a3f\u9884\u6f14',
  startDraft: '\u4ee5 \u8349\u7a3f\u9884\u6f14 \u542f\u52a8',
  productionMode: '\u6b63\u5f0f\u5236\u4f5c',
  startProduction: '\u4ee5 \u6b63\u5f0f\u5236\u4f5c \u542f\u52a8',
  refresh: '\u5237\u65b0',
  timelineStep: '\u5267\u96c6 / \u65f6\u95f4\u7ebf',
  continueImport: '\u7ee7\u7eed\u5bfc\u5165\u7d20\u6750',
  enterProduction: '\u8fdb\u5165\u5236\u4f5c',
  returnToDrama: '\u8fd4\u56de\u5267\u96c6',
  compositeVideo: '\u5408\u6210\u89c6\u9891',
  collapseNavigation: '\u6536\u8d77\u5bfc\u822a',
  expandNavigation: '\u5c55\u5f00\u5bfc\u822a',
  sourcePlaceholder: '\u7c98\u8d34\u5c0f\u8bf4\u3001\u6897\u6982\u3001\u5267\u672c\u3001\u5206\u955c\u8868\u3001\u6f2b\u753b\u6587\u5b57\u8bf4\u660e\u6216\u8f6c\u5199\u6587\u672c',
  newProject: '\u65b0\u5efa\u9879\u76ee',
  confirm: '\u786e\u5b9a',
  importOnly: '\u4ec5\u5bfc\u5165\u7d20\u6750',
  retryLoad: '\u91cd\u8bd5\u52a0\u8f7d',
  downloadFinal: '\u4e0b\u8f7d\u6210\u7247',
  exportProject: '\u5bfc\u51fa\u9879\u76ee',
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

async function fetchWithIdempotentRetry(url, options = {}, fetchImpl = fetch) {
  const method = String(options.method || 'GET').toUpperCase()
  const attempts = method === 'GET' ? 3 : 1
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(url, options)
    } catch (error) {
      lastError = error
      if (attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 100))
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
  const existing = await apiRequest('/ai-configs')
  for (const config of existing) {
    if (String(config.name || '').startsWith(CONFIG_PREFIX)) await deleteConfig(config.id)
  }

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

async function verifyAiConfigurationUi(page) {
  await page.goto(`${FRONTEND_URL}/ai-config`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '\u0041\u0049 \u670d\u52a1\u914d\u7f6e\u4e0e\u9a8c\u8bc1', exact: true }).waitFor({ timeout: 30000 })
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
  assert.equal(await newButton.isEnabled(), true, 'new project command must be enabled')
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
  return payload.data
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

async function verifyDraftUpgradeUi(page, dramaId) {
  await page.goto(`${FRONTEND_URL}/film/${dramaId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('#film-create-quick-nav button.nav-step').filter({ hasText: '\u5206\u955c\u56fe' }).click()
  await page.getByText('\u8349\u7a3f\u5360\u4f4d\u89c6\u9891\uff0c\u5c1a\u672a\u751f\u6210\u53ef\u64ad\u653e\u7247\u6bb5\u3002', { exact: true }).first().waitFor({ timeout: 30000 })
  assert.equal(await page.locator('img[src^="mock://"], video[src^="mock://"]').count(), 0, 'Draft placeholders must not render as media elements')
  assert.equal((await page.locator('body').innerText()).includes('mock://'), false, 'Draft placeholder URLs must not be exposed in the UI')
  return { placeholderMessageVisible: true }
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
  await flowStepButton(workflow, UI.timelineStep).click()
  const timeline = workflow.locator('.timeline-block')
  assert.ok(Number.isInteger(expectedTrackCount) && expectedTrackCount > 0, 'expected timeline track count is required')
  await timeline.getByText(`${expectedTrackCount} \u8f68`, { exact: true }).waitFor({ timeout: 30000 })
  await timeline.getByText('video / subtitle / voice / dialogue / effect / bgm / transition', { exact: true }).waitFor({ timeout: 30000 })
  await assertNoHorizontalOverflow(page, `drama detail ${viewport.width}x${viewport.height}`)

  await timeline.getByRole('button', { name: UI.continueImport, exact: true }).click()
  await workflow.getByPlaceholder(UI.sourcePlaceholder, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const navigationPromise = page.waitForURL(new RegExp(`/film/${dramaId}(?:[?#]|$)`), { timeout: 30000 })
  await page.getByRole('button', { name: UI.enterProduction, exact: true }).click()
  await navigationPromise
  await page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('#film-create-quick-nav button.nav-step').filter({ hasText: UI.compositeVideo }).click()
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
  let primaryError = null
  let primaryFailureStage = null
  let draftWorkflowRun = null
  let workflowRun = null
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
        fixturePurgeResult = await runDockerFixturePurge({
          dramaId: drama.id,
          expectedTitle: fixtureTitle,
        })
      })
    }
    assert.ok(drama?.id, 'created drama id is required')

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
      const current = await apiRequest(`/workflows/${draftWorkflowRun.id}`)
      if (!TERMINAL_STATUSES.has(current.status)) {
        await apiRequest(`/workflows/${draftWorkflowRun.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'E2E cleanup' }),
        })
      }
    })
    const draftCompleted = await waitForWorkflow(draftWorkflowRun.id)
    assert.equal(draftCompleted.status, 'completed', `draft workflow failed: ${draftCompleted.error || 'unknown error'}`)
    assert.equal(draftCompleted.input_json?.qa_mode, 'draft')
    const draftPlaceholders = await assertDraftPlaceholderState(drama.id)
    const draftUiEvidence = await verifyDraftUpgradeUi(startPage, drama.id)
    await evidenceRecorder.stage('draft_workflow', 'passed')

    await evidenceRecorder.stage('provider_setup')
    const providerState = await installProviderConfigs(stamp)
    registerCleanup(cleanupActions, 'temporary AI provider configs', () => restoreProviderConfigs(providerState))
    const aiConfigUiEvidence = await verifyAiConfigurationUi(startPage)
    await providerControlRequest('/__e2e/reset', 'POST')
    providerStatsReset = true
    await evidenceRecorder.set({ provider: { reset_observed: true } })
    await evidenceRecorder.stage('provider_setup', 'passed')

    await evidenceRecorder.stage('production_workflow')
    workflowRun = await startProductionFromUi(startPage, drama.id)
    await evidenceRecorder.set({ workflow: { production_run_id: workflowRun.id } })
    registerCleanup(cleanupActions, `cancel workflow ${workflowRun.id}`, async () => {
      const current = await apiRequest(`/workflows/${workflowRun.id}`)
      if (!TERMINAL_STATUSES.has(current.status)) {
        await apiRequest(`/workflows/${workflowRun.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'E2E cleanup' }),
        })
      }
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
    logger.log(JSON.stringify({
      status: finalEvidence.status,
      evidence: path.relative(PROJECT_ROOT, evidenceRecorder.evidencePath).replace(/\\/g, '/'),
      commit: finalEvidence.source.commit,
      version: finalEvidence.source.version,
    }))
    return finalEvidence
  } catch (error) {
    await evidenceRecorder.fail(error)
    throw error
  }
}

module.exports = {
  CONFIG_PREFIX,
  DEFAULT_EVIDENCE_ROOT,
  DESKTOP_VIEWPORTS,
  EVIDENCE_SCHEMA,
  REQUIRED_PROVIDER_ENDPOINTS,
  REQUIRED_PROVIDER_TYPES,
  REQUIRED_TRACK_TYPES,
  assertCompleteEvidence,
  assertEvidencePayloadSafe,
  assertEvidenceSerializationSafe,
  assertMp3,
  assertMp4,
  assertPng,
  assertProductionTimeline,
  assertProviderInvocations,
  assertProviderStats,
  createEvidenceRecorder,
  extractZipEntries,
  fetchWithIdempotentRetry,
  installProviderConfigs,
  main,
  sanitizeEvidenceText,
  summarizeProviderCalls,
  summarizeProviderInvocations,
  restoreProviderConfigs,
  verifyExport,
  waitForWorkflow,
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
