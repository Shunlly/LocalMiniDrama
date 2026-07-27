import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createProviderServer } = require('../../backend-node/scripts/e2e-provider.js')
const { REQUIRED_FINAL_CAPTURES } = require('../scripts/acceptance-report-contract.cjs')
const { removeFixtureTree } = require('../scripts/fixture-cleanup.cjs')
const productionE2e = require('../scripts/e2e-production.cjs')
const {
  AI_TWO_COLUMN_VIEWPORT,
  DESKTOP_VIEWPORTS,
  EVIDENCE_SCHEMA,
  FOCUSED_DESKTOP_VIEWPORT,
  REQUIRED_PROVIDER_ENDPOINTS,
  REQUIRED_PROVIDER_TYPES,
  REQUIRED_TRACK_TYPES,
  assertCoverageCardMatrix,
  assertCompleteEvidence,
  createReadinessGate,
  createEvidenceRecorder,
  assertProductionTimeline,
  assertProviderInvocations,
  assertProviderStats,
  cancelAndWaitForWorkflowWorkerDrain,
  consumeExpectedBrowserError,
  extractZipEntries,
  fetchWithIdempotentRetry,
  formatExpectedEpisodeContextLabel,
  focusedAiRouteAction,
  installFocusedAiRoutes,
  main: runProductionE2e,
  resetAcceptanceReportArtifacts,
  sanitizeEvidenceText,
  createWorkflowDrainPrerequisite,
  runCleanup,
  waitForEnabledAction,
  waitForAcceptanceCaptureReadiness,
  waitForCoverageCardMatrix,
  waitForEpisodeContext,
  waitForProjectTitle,
  waitForWorkflowWorkerDrain,
} = productionE2e
const productionSource = readFileSync(new URL('../scripts/e2e-production.cjs', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const frontendPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const verificationDockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const productionDockerfile = readFileSync(new URL('../Dockerfile.prod', import.meta.url), 'utf8')
const productionNginxConfig = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')
const backendDockerfile = readFileSync(new URL('../../backend-node/Dockerfile', import.meta.url), 'utf8')
const backendEntrypoint = readFileSync(new URL('../../backend-node/docker-entrypoint.sh', import.meta.url), 'utf8')
const composeSource = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')
const ciWorkflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const releaseWorkflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
const gitignoreSource = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')
const pipelinePanelSource = readFileSync(new URL('../src/components/filmCreate/FilmCreatePipelinePanel.vue', import.meta.url), 'utf8')

function sourceFunction(name) {
  const value = productionE2e[name]
  assert.equal(typeof value, 'function', `missing exported production E2E function: ${name}`)
  return Function.prototype.toString.call(value)
}

function assertSourceOrder(source, snippets) {
  let cursor = -1
  for (const snippet of snippets) {
    const index = source.indexOf(snippet, cursor + 1)
    assert.ok(index > cursor, `missing or out-of-order E2E assertion: ${snippet}`)
    cursor = index
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function productionInvocations(overrides = {}) {
  return REQUIRED_PROVIDER_TYPES.map((providerType) => ({
    provider_type: providerType,
    provider_name: providerType === 'compositor' ? 'ffmpeg' : 'openai',
    model: providerType === 'compositor' ? 'ffmpeg' : `local-e2e-${providerType}`,
    mode: 'production',
    status: 'success',
    cost_estimate: providerType === 'compositor' ? null : 0.01,
    ...(overrides[providerType] || {}),
  }))
}

function productionTimeline() {
  const tracks = REQUIRED_TRACK_TYPES.map((type, index) => ({
    id: index + 1,
    type,
    item_count: 1,
    items: [{
      id: index + 1,
      start_sec: 0,
      end_sec: 1,
      source_path: type === 'subtitle' ? 'A line of dialogue' : `production://${type}/1`,
      metadata: { production: true },
    }],
  }))
  return {
    summary: {
      episode_count: 1,
      track_count: tracks.length,
      item_count: tracks.length,
      track_types: [...REQUIRED_TRACK_TYPES],
    },
    episodes: [{ episode: { id: 1 }, tracks }],
  }
}

test('controlled browser error consumption removes exactly one matching entry', () => {
  const expected = 'console: Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
  assert.deepEqual(
    consumeExpectedBrowserError([expected, expected, 'pageerror: unrelated'], expected),
    [expected, 'pageerror: unrelated'],
  )
  assert.throws(
    () => consumeExpectedBrowserError(['pageerror: unrelated'], expected),
    /expected controlled browser error was not observed/,
  )
})

function focusedAcceptanceEvidence() {
  return {
    status: 'passed',
    primary_viewport: { width: 1280, height: 720 },
    ai_two_column_viewport: { width: 1024, height: 768 },
    project: { id: 1, title: 'Focused fixture' },
    episode: {
      id: 1,
      label: '\u7b2c 1 \u96c6',
      visible_label: '\u7b2c 1 \u96c6',
      aria_label: '\u5f53\u524d\u96c6',
      initial_route_id: 1,
      initial_script_title: '\u7b2c1\u96c6',
      switched_id: 2,
      switched_label: '\u7b2c 2 \u96c6 \u00b7 \u7b2c\u4e8c\u5e55',
      switched_route_id: 2,
      switched_script_title: '\u7b2c\u4e8c\u5e55',
      restored_id: 1,
      restored_label: '\u7b2c 1 \u96c6',
      restored_route_id: 1,
      restored_script_title: '\u7b2c1\u96c6',
      switch_restored: true,
    },
    source_handoff: {
      project_card_entry: true,
      return_hash: '#source-intake-workflow',
      compact_complete: true,
      entered_production: true,
    },
    navigation: { current_count: 1, current_label: '\u6545\u4e8b\u677f', completed_distinct_count: 1 },
    pipeline: {
      initial_state: 'blocked',
      initial_action: '\u914d\u7f6e\u7f3a\u5931\u670d\u52a1',
      post_mutation_state: 'checking',
      injected_failure_state: 'error',
      retry_action: '\u91cd\u8bd5\u80fd\u529b\u68c0\u67e5',
      final_state: 'ready',
      final_action: '\u4e00\u952e\u751f\u6210\u6210\u7247',
    },
    ai: {
      service_order: ['image', 'video', 'text', 'tts', 'storyboard_image'],
      action_counts: [1, 1, 0, 1, 0],
      mutation: { method: 'POST', service_type: 'text', created_id: 99, is_default: false },
      configuration_feedback_observed: true,
      native_close_focus_restored: true,
      custom_return_focus_restored: true,
      columns_1280: 4,
      columns_1024: 2,
      minimum_target_size: 32,
    },
    readiness: {
      requests_after_mutation: 2,
      injected_failure_status: 503,
      retry_status: 200,
      final_missing_capabilities: 0,
    },
    provider_calls_unchanged: true,
    document_overflow: {
      '1280x720': { passed: true },
      '1024x768': { passed: true },
    },
    component_overflow: {
      '1280x720': [{ selector: '.coverage-grid', index: 0, client_width: 100, scroll_width: 100 }],
      '1024x768': [{ selector: '.coverage-grid', index: 0, client_width: 100, scroll_width: 100 }],
    },
    coverage_layout: {
      columns_at_1280: 4,
      minimum_card_width: 220,
      visible_card_count: 5,
      horizontal_overflow: false,
      columns_at_1024: 2,
    },
    cleanup: {
      exact_name_registered: true,
      created_id_registered: true,
      visible_config_removed: true,
      fixture_restored: true,
      routes_disposed: true,
      listeners_disposed: true,
      gate_disposed: true,
      page_closed: true,
    },
    screenshots: REQUIRED_FINAL_CAPTURES.map((capture) => ({
      path: `acceptance-report/screenshots/${capture.id}.png`,
      bytes: 100,
      sha256: 'a'.repeat(64),
      viewport: { width: capture.width, height: capture.height },
      surface: capture.surface,
      theme: capture.theme,
    })),
  }
}

function storedZipEntry(name, data) {
  const filename = Buffer.from(name)
  const payload = Buffer.from(data)
  const local = Buffer.alloc(30 + filename.length + payload.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(filename.length, 26)
  filename.copy(local, 30)
  payload.copy(local, 30 + filename.length)

  const central = Buffer.alloc(46 + filename.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(filename.length, 28)
  filename.copy(central, 46)
  return { local, central }
}

function storedZip(name, data) {
  const { local, central } = storedZipEntry(name, data)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}

test('E2E provider stats require authorization, count real calls, and retain no request secrets', async () => {
  const token = 'contract-only-token'
  const secrets = {
    text: 'contract text prompt that must not be retained',
    image: 'contract image prompt that must not be retained',
    video: 'contract video prompt that must not be retained',
    tts: 'contract speech input that must not be retained',
  }
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'localminidrama-provider-contract-'))
  const fixtures = {
    imagePath: path.join(fixtureRoot, 'frame.png'),
    audioPath: path.join(fixtureRoot, 'speech.mp3'),
    videoPath: path.join(fixtureRoot, 'clip.mp4'),
  }
  await Promise.all([
    writeFile(fixtures.imagePath, Buffer.alloc(128, 1)),
    writeFile(fixtures.audioPath, Buffer.alloc(512, 2)),
    writeFile(fixtures.videoPath, Buffer.alloc(2048, 3)),
  ])
  const server = createProviderServer({
    token,
    fixtures,
    publicBaseUrl: 'http://127.0.0.1',
  })
  const address = await listen(server)
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const unauthorized = await fetch(`${baseUrl}/__e2e/stats`)
    assert.equal(unauthorized.status, 401)

    const reset = await fetch(`${baseUrl}/__e2e/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(reset.status, 200)

    const completion = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'local-e2e-text',
        messages: [{ role: 'user', content: secrets.text }],
      }),
    })
    assert.equal(completion.status, 200)

    const image = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'local-e2e-image', prompt: secrets.image }),
    })
    assert.equal(image.status, 200)

    const video = await fetch(`${baseUrl}/v1/video/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'local-e2e-video', prompt: secrets.video }),
    })
    assert.equal(video.status, 200)

    const tts = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'local-e2e-tts', input: secrets.tts }),
    })
    assert.equal(tts.status, 200)
    await tts.arrayBuffer()

    const statsResponse = await fetch(`${baseUrl}/__e2e/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(statsResponse.status, 200)
    const stats = await statsResponse.json()
    assert.deepEqual(assertProviderStats(stats, [token, ...Object.values(secrets)]), {
      text: 1,
      image: 1,
      video: 1,
      tts: 1,
    })
    assert.equal(stats.events.find((event) => event.endpoint === 'text').input_chars, secrets.text.length)
    assert.equal(stats.events.find((event) => event.endpoint === 'image').prompt_chars, secrets.image.length)
    assert.equal(stats.events.find((event) => event.endpoint === 'video').prompt_chars, secrets.video.length)
    assert.equal(stats.events.find((event) => event.endpoint === 'tts').input_chars, secrets.tts.length)
  } finally {
    await close(server)
    await removeFixtureTree(fixtureRoot, { force: true })
  }
})

test('production invocation contract requires successful non-mock evidence for every production capability', () => {
  assert.deepEqual(Object.keys(assertProviderInvocations(productionInvocations())), [...REQUIRED_PROVIDER_TYPES])
  assert.throws(
    () => assertProviderInvocations(productionInvocations({ text: { provider_name: 'mock' } })),
    /must not use a mock/,
  )
  assert.throws(
    () => assertProviderInvocations(productionInvocations({ video: { status: 'failed' } })),
    /must succeed/,
  )
  assert.throws(
    () => assertProviderInvocations(productionInvocations().filter((item) => item.provider_type !== 'tts')),
    /missing production provider invocation for tts/,
  )
})

test('provider call contract requires successful real calls and rejects leaked values', () => {
  const stats = {
    schema: 'localminidrama.e2e-provider-stats.v1',
    reset_at: new Date().toISOString(),
    calls: Object.fromEntries(REQUIRED_PROVIDER_ENDPOINTS.map((type) => [
      type,
      { attempted: 1, succeeded: 1, failed: 0 },
    ])),
    events: REQUIRED_PROVIDER_ENDPOINTS.map((endpoint, sequence) => ({
      sequence,
      endpoint,
      success: true,
      status_code: 200,
    })),
  }
  assert.deepEqual(Object.keys(assertProviderStats(stats, ['never-present'])), [...REQUIRED_PROVIDER_ENDPOINTS])
  assert.throws(
    () => assertProviderStats({
      ...stats,
      calls: { ...stats.calls, text: { attempted: 0, succeeded: 0, failed: 0 } },
    }),
    /text endpoint was not called/,
  )
  assert.throws(
    () => assertProviderStats({ ...stats, events: [...stats.events, { endpoint: 'text', success: true, prompt: 'leak' }] }),
    /leaked prompt/,
  )
})

test('production timeline contract requires core media and explicit optional-track state', () => {
  assert.deepEqual(assertProductionTimeline(productionTimeline()), { episodes: 1, tracks: 7, items: 7 })
  const multiEpisode = productionTimeline()
  multiEpisode.episodes.push(structuredClone(multiEpisode.episodes[0]))
  multiEpisode.summary.episode_count = 2
  multiEpisode.summary.track_count = 14
  multiEpisode.summary.item_count = 14
  assert.deepEqual(assertProductionTimeline(multiEpisode), { episodes: 2, tracks: 14, items: 14 })

  const inconsistentEpisodes = productionTimeline()
  inconsistentEpisodes.summary.episode_count = 2
  assert.throws(() => assertProductionTimeline(inconsistentEpisodes), /episode details are inconsistent/)

  const missingBgm = productionTimeline()
  missingBgm.episodes[0].tracks = missingBgm.episodes[0].tracks.filter((track) => track.type !== 'bgm')
  assert.throws(() => assertProductionTimeline(missingBgm), /missing bgm track/)

  const placeholder = productionTimeline()
  placeholder.episodes[0].tracks[0].items[0].source_path = 'mock://video/1'
  assert.throws(() => assertProductionTimeline(placeholder), /must not be a placeholder/)

  const explicitUnused = productionTimeline()
  for (const type of ['effect', 'bgm', 'transition']) {
    const track = explicitUnused.episodes[0].tracks.find((item) => item.type === type)
    track.items = []
    track.item_count = 0
    track.status = 'unused'
    track.metadata = { optional: true, usage: 'unused' }
  }
  explicitUnused.summary.item_count = 4
  assert.deepEqual(assertProductionTimeline(explicitUnused), { episodes: 1, tracks: 7, items: 4 })
})

test('ZIP evidence parser reads stored entries and rejects traversal paths', () => {
  const entries = extractZipEntries(storedZip('project.json', '{"version":"test"}'))
  assert.equal(entries.get('project.json').toString('utf8'), '{"version":"test"}')
  assert.throws(() => extractZipEntries(storedZip('../escape.txt', 'no')), /unsafe ZIP entry path/)
})

test('E2E API retry repeats transient GET failures but never repeats writes', async () => {
  let getCalls = 0
  const response = { ok: true }
  const getResult = await fetchWithIdempotentRetry('http://example.test/read', {}, async () => {
    getCalls += 1
    if (getCalls === 1) throw new TypeError('transient socket close')
    return response
  })
  assert.equal(getResult, response)
  assert.equal(getCalls, 2)

  let postCalls = 0
  await assert.rejects(
    fetchWithIdempotentRetry('http://example.test/write', { method: 'POST' }, async () => {
      postCalls += 1
      throw new TypeError('write socket close')
    }),
    /write socket close/,
  )
  assert.equal(postCalls, 1)
})

test('production API driver carries the trusted frontend origin on writes', () => {
  assert.match(productionSource, /const FRONTEND_ORIGIN = new URL\(FRONTEND_URL\)\.origin/)
  assert.match(productionSource, /'Content-Type': 'application\/json',[\s\S]*?Origin: FRONTEND_ORIGIN/)
  assert.match(
    productionSource,
    /api\/v1\/ai-configs\/\$\{id\}`,[\s\S]*?method: 'DELETE',[\s\S]*?headers: \{ Origin: FRONTEND_ORIGIN \}/,
  )
})

test('production evidence persists identity, media hashes, failure state, logs, and no protected values', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'localminidrama-e2e-evidence-'))
  const evidenceRoot = path.join(fixtureRoot, 'artifacts', 'e2e-production')
  const protectedValue = 'contract-super-secret-value'
  const media = Buffer.from('contract artifact bytes')
  try {
    const recorder = await createEvidenceRecorder({
      evidenceRoot,
      sourceIdentity: {
        commit: 'a'.repeat(40),
        version: '1.2.8',
        working_tree_dirty: false,
      },
      now: () => Date.UTC(2026, 6, 16, 0, 0, 0),
      forbiddenValues: [protectedValue],
    })
    await recorder.stage('contract_failure')
    const descriptor = await recorder.persistArtifact('media/frame.png', media, 'png')
    await recorder.set({
      diagnostic: {
        authorization: `Bearer ${protectedValue}`,
        message: `Authorization: Bearer ${protectedValue}; api_key=${protectedValue}; base_url=http://private.invalid/v1`,
      },
    })
    await assert.rejects(
      recorder.persistArtifact('media/leaked.txt', Buffer.from(`value=${protectedValue}`)),
      /contains a protected value/,
    )
    await assert.rejects(
      recorder.persistArtifact('media/leaked-config.json', Buffer.from('{"api_key":"unknown-value"}')),
      /sensitive configuration data/,
    )
    const contractFailure = new Error(`Authorization: Bearer ${protectedValue}; credential=${protectedValue}`)
    contractFailure.stack = `Error: Authorization: Bearer ${protectedValue}\n    at contractFailure (e2e-production.cjs:1:1)`
    await recorder.fail(contractFailure)

    const evidenceText = await readFile(path.join(evidenceRoot, 'evidence.json'), 'utf8')
    const logText = await readFile(path.join(evidenceRoot, 'run.log'), 'utf8')
    const persistedMedia = await readFile(path.join(evidenceRoot, 'media', 'frame.png'))
    const evidence = JSON.parse(evidenceText)

    assert.equal(evidence.schema, EVIDENCE_SCHEMA)
    assert.equal(evidence.status, 'failed')
    assert.equal(evidence.source.commit, 'a'.repeat(40))
    assert.equal(evidence.source.version, '1.2.8')
    assert.equal(evidence.source.working_tree_dirty, false)
    assert.equal(evidence.run.failed_stage, 'contract_failure')
    assert.match(evidence.failure.stack, /at contractFailure \(e2e-production\.cjs:1:1\)/)
    assert.equal(evidence.qa.status, 'not_run')
    assert.deepEqual(Object.keys(evidence.provider.calls), REQUIRED_PROVIDER_ENDPOINTS)
    assert.deepEqual(evidence.provider.calls.text, { attempted: 0, succeeded: 0, failed: 0 })
    assert.deepEqual(evidence.artifacts.png, {
      path: 'media/frame.png',
      bytes: media.length,
      sha256: crypto.createHash('sha256').update(media).digest('hex'),
    })
    assert.deepEqual(persistedMedia, media)
    assert.match(logText, /"event":"artifact_persisted"/)
    for (const output of [evidenceText, logText]) {
      assert.equal(output.includes(protectedValue), false)
      assert.doesNotMatch(output, /authorization|api[_ -]?key|credentials?|base[_ -]?url|private\.invalid/i)
    }
  } finally {
    await removeFixtureTree(fixtureRoot, { force: true })
  }
})

test('streaming log sanitizer removes JSON credential fields, values, and private URLs', () => {
  const sanitized = sanitizeEvidenceText(JSON.stringify({
    authorization: 'Bearer unknown-auth-value',
    api_key: 'sk-unknown-value',
    base_url: 'http://private.invalid/v1',
    normal: 'kept',
  }), [], Infinity)
  assert.match(sanitized, /"normal":"kept"/)
  assert.doesNotMatch(
    sanitized,
    /authorization|api[_ -]?key|base[_ -]?url|unknown-auth-value|sk-unknown-value|private\.invalid/i,
  )
})

test('production evidence can seal a complete successful acceptance package', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'localminidrama-e2e-success-'))
  const evidenceRoot = path.join(fixtureRoot, 'artifacts', 'e2e-production')
  try {
    const recorder = await createEvidenceRecorder({
      evidenceRoot,
      sourceIdentity: {
        commit: 'c'.repeat(40),
        version: '1.2.8',
        working_tree_dirty: false,
      },
      now: () => Date.UTC(2026, 6, 16, 2, 0, 0),
    })
    const artifactPaths = {
      png: 'media/storyboard.png',
      mp3: 'media/storyboard.mp3',
      mp4: 'media/storyboard.mp4',
      composed_video: 'media/composed.mp4',
      final_video: 'downloads/final.mp4',
      project_zip: 'downloads/project.zip',
    }
    const artifacts = {}
    for (const [key, artifactPath] of Object.entries(artifactPaths)) {
      artifacts[key] = await recorder.persistArtifact(artifactPath, Buffer.from(`safe-${key}`))
    }
    await recorder.set({
      qa: { status: 'passed', passed: true, score: 100, mode: 'production' },
      provider: {
        reset_observed: true,
        calls: Object.fromEntries(REQUIRED_PROVIDER_ENDPOINTS.map((type) => [type, {
          attempted: 1,
          succeeded: 1,
          failed: 0,
        }])),
        workflow_invocations: Object.fromEntries(REQUIRED_PROVIDER_TYPES.map((type) => [type, 1])),
      },
      artifacts,
      browser: {
        status: 'passed',
        focused_acceptance: focusedAcceptanceEvidence(),
        playback: DESKTOP_VIEWPORTS.map((viewport) => ({
          viewport,
          composed: { played: true, ended: true, unicode_path: true },
          storyboard: { played: true, ended: true, unicode_path: true },
        })),
        final_download: { status: 'passed', validated: true, artifact: artifacts.final_video },
        project_export: { status: 'passed', validated: true, artifact: artifacts.project_zip },
      },
      cleanup: {
        status: 'passed',
        failure_count: 0,
        media_cleanup: { candidates: 8, deleted: 8, missing: 0, shared: 0 },
      },
    })
    const finalEvidence = await recorder.pass()
    const persistedEvidence = JSON.parse(await readFile(path.join(evidenceRoot, 'evidence.json'), 'utf8'))
    assert.equal(finalEvidence.status, 'passed')
    assert.equal(persistedEvidence.status, 'passed')
    assert.equal(persistedEvidence.source.commit, 'c'.repeat(40))
    assert.equal(persistedEvidence.artifacts.project_zip.path, 'downloads/project.zip')
    assert.throws(
      () => assertCompleteEvidence({
        ...persistedEvidence,
        source: { ...persistedEvidence.source, working_tree_dirty: true },
      }),
      /clean Git working tree/,
    )
    assert.throws(
      () => assertCompleteEvidence({
        ...persistedEvidence,
        browser: {
          ...persistedEvidence.browser,
          focused_acceptance: {
            ...persistedEvidence.browser.focused_acceptance,
            episode: {
              ...persistedEvidence.browser.focused_acceptance.episode,
              switch_restored: false,
            },
          },
        },
      }),
      /restore the original episode/,
    )
    assert.throws(
      () => assertCompleteEvidence({
        ...persistedEvidence,
        browser: {
          ...persistedEvidence.browser,
          focused_acceptance: {
            ...persistedEvidence.browser.focused_acceptance,
            episode: {
              ...persistedEvidence.browser.focused_acceptance.episode,
              switched_route_id: 3,
            },
          },
        },
      }),
      /switched episode route/,
    )
    assert.throws(
      () => assertCompleteEvidence({
        ...persistedEvidence,
        browser: {
          ...persistedEvidence.browser,
          focused_acceptance: {
            ...persistedEvidence.browser.focused_acceptance,
            episode: {
              ...persistedEvidence.browser.focused_acceptance.episode,
              restored_script_title: '\u5176\u4ed6\u5267\u672c',
            },
          },
        },
      }),
      /restore the original script title/,
    )
    assert.throws(
      () => assertCompleteEvidence({
        ...persistedEvidence,
        browser: {
          ...persistedEvidence.browser,
          focused_acceptance: {
            ...persistedEvidence.browser.focused_acceptance,
            coverage_layout: {
              ...persistedEvidence.browser.focused_acceptance.coverage_layout,
              columns_at_1280: 5,
            },
          },
        },
      }),
      /four columns/,
    )
  } finally {
    await removeFixtureTree(fixtureRoot, { force: true })
  }
})

test('production E2E entrypoint seals evidence when browser startup fails', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'localminidrama-e2e-entrypoint-'))
  const evidenceRoot = path.join(fixtureRoot, 'artifacts', 'e2e-production')
  const protectedValue = 'entrypoint-browser-secret'
  try {
    await assert.rejects(
      runProductionE2e({
        evidenceRoot,
        sourceIdentity: {
          commit: 'b'.repeat(40),
          version: '1.2.8',
          working_tree_dirty: false,
        },
        now: () => Date.UTC(2026, 6, 16, 1, 0, 0),
        evidenceForbiddenValues: [protectedValue],
        launchBrowser: async () => {
          throw new Error(`Authorization: Bearer ${protectedValue}`)
        },
        logger: { log() {}, warn() {} },
      }),
      /entrypoint-browser-secret/,
    )
    const evidenceText = await readFile(path.join(evidenceRoot, 'evidence.json'), 'utf8')
    const logText = await readFile(path.join(evidenceRoot, 'run.log'), 'utf8')
    const evidence = JSON.parse(evidenceText)
    assert.equal(evidence.status, 'failed')
    assert.equal(evidence.run.failed_stage, 'browser_recovery')
    assert.equal(evidence.cleanup.status, 'passed')
    assert.equal(evidence.provider.reset_observed, false)
    assert.deepEqual(evidence.provider.calls.text, { attempted: 0, succeeded: 0, failed: 0 })
    assert.equal(evidenceText.includes(protectedValue), false)
    assert.equal(logText.includes(protectedValue), false)
    assert.doesNotMatch(`${evidenceText}\n${logText}`, /authorization|credentials?/i)
  } finally {
    await removeFixtureTree(fixtureRoot, { force: true })
  }
})

test('production E2E verifies workflow-first disclosures and AI config modes', () => {
  const readinessDisclosure = sourceFunction('verifyProjectReadinessDisclosureUi')
  assertSourceOrder(readinessDisclosure, [
    "page.getByTestId('project-readiness-toggle')",
    "page.getByTestId('project-readiness-details')",
    'assert.equal(await details.count(), 1',
    "await details.waitFor({ state: 'hidden' })",
    "assert.equal(await toggle.getAttribute('aria-expanded'), 'false'",
    'await toggle.click()',
    "await details.waitFor({ state: 'visible' })",
    "assert.equal(await toggle.getAttribute('aria-expanded'), 'true'",
  ])
  assert.match(productionSource, /await verifyProjectReadinessDisclosureUi\(startPage\)/)

  const pipelineDisclosure = sourceFunction('verifyFilmPipelineDisclosureUi')
  assertSourceOrder(pipelineDisclosure, [
    "page.getByTestId('film-pipeline-toggle')",
    "page.getByTestId('film-pipeline-details')",
    'assert.equal(await details.count(), 1',
    "await details.waitFor({ state: 'hidden' })",
    "assert.equal(await toggle.getAttribute('aria-expanded'), 'false'",
  ])
  assert.match(productionSource, /await verifyFilmPipelineDisclosureUi\(page\)/)

  const aiConfiguration = sourceFunction('verifyAiConfigurationUi')
  assertSourceOrder(aiConfiguration, [
    "page.getByTestId('ai-config-mode-coverage')",
    "page.getByTestId('ai-config-mode-configs')",
    "page.locator('#ai-config-coverage-panel')",
    "page.locator('#ai-config-configs-panel')",
    "assert.equal(await coverageMode.getAttribute('aria-selected'), 'true'",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'false'",
    "await coveragePanel.waitFor({ state: 'visible', timeout: 30000 })",
    "await configsPanel.waitFor({ state: 'hidden' })",
    "await coverageMode.press('ArrowRight')",
    "await coveragePanel.waitFor({ state: 'hidden' })",
    "await configsPanel.waitFor({ state: 'visible', timeout: 30000 })",
    'await configsMode.evaluate((element) => element.ownerDocument.activeElement === element)',
    "true,\n    'keyboard navigation must move focus to configuration management'",
    "assert.equal(await coverageMode.getAttribute('aria-selected'), 'false'",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'true'",
    "await configsMode.press('ArrowLeft')",
    "await coveragePanel.waitFor({ state: 'visible', timeout: 30000 })",
    "await configsPanel.waitFor({ state: 'hidden' })",
    'await coverageMode.evaluate((element) => element.ownerDocument.activeElement === element)',
    "true,\n    'reverse keyboard navigation must restore focus to service status'",
    "assert.equal(await coverageMode.getAttribute('aria-selected'), 'true'",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'false'",
    'await configsMode.click()',
    "await coveragePanel.waitFor({ state: 'hidden' })",
    "await configsPanel.waitFor({ state: 'visible', timeout: 30000 })",
    "page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })",
    "assert.equal(await coverageMode.getAttribute('aria-selected'), 'false'",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'true'",
  ])
})

test('focused production E2E expands the 769px sidebar before checking every header control', () => {
  const focusedAcceptance = sourceFunction('verifyFocusedDesktopAcceptance')
  assertSourceOrder(focusedAcceptance, [
    'await page.setViewportSize(FILM_DESKTOP_EDGE_VIEWPORT)',
    "page.getByRole('button', { name: UI.expandNavigation, exact: true })",
    "await edgeExpand.waitFor({ state: 'visible', timeout: 10000 })",
    'await edgeExpand.click()',
    "page.getByRole('button', { name: UI.collapseNavigation, exact: true })",
    "await edgeCollapse.waitFor({ state: 'visible', timeout: 10000 })",
    'await assertFilmCreateDesktopLayout(page, { ...FILM_DESKTOP_EDGE_VIEWPORT, sidebarWidth: 180 })',
  ])

  const layoutAssertion = sourceFunction('assertFilmCreateDesktopLayout')
  for (const selector of [
    '.header-episode-select',
    '.btn-back-drama',
    '.btn-canvas-mode',
    '.btn-theme',
    '.btn-ai-config',
  ]) {
    assert.match(layoutAssertion, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(layoutAssertion, /scrollWidth/)
  assert.match(layoutAssertion, /clientWidth/)
  assert.match(layoutAssertion, /overlaps/)
})

test('focused production E2E covers media center to completed-project URL intake focus', () => {
  const focusedAcceptance = sourceFunction('verifyFocusedDesktopAcceptance')
  assertSourceOrder(focusedAcceptance, [
    'await page.goto(`${FRONTEND_URL}/media-library`',
    "page.getByRole('button', { name: UI.sourceImportProject, exact: true })",
    "url.searchParams.get('intent') === 'source-import'",
    'await sourceImportEntry.click()',
    "page.getByRole('textbox', { name: '\\u641c\\u7d22\\u9879\\u76ee', exact: true })",
    "projectCard.locator('.project-card-link')",
    'const sourceListUrl = new URL(page.url())',
    "const sourceReturnTo = projectDestination.searchParams.get('returnTo')",
    "assert.ok(sourceReturnTo, 'project action must retain source-import list context')",
    "for (const key of ['q', 'status', 'sort', 'intent'])",
    "assert.equal(projectDestination.searchParams.get('intake'), 'source-url'",
    'await projectEntry.click()',
    "assert.equal(sourceUrl.searchParams.get('intake'), 'source-url'",
    "assert.equal(sourceUrl.searchParams.get('returnTo'), sourceReturnTo",
    "workflow.getByRole('textbox', { name: UI.sourceUrlLabel, exact: true })",
    "await sourceUrlInput.waitFor({ state: 'visible', timeout: 30000 })",
    'element.ownerDocument.activeElement === element',
  ])
})

test('production E2E verifies service-specific AI config return routes in config management', () => {
  const aiConfigReturn = sourceFunction('verifyAiConfigReturnUi')
  assertSourceOrder(aiConfigReturn, [
    'service_type=text',
    "page.getByTestId('ai-config-mode-configs')",
    "await configsMode.waitFor({ state: 'visible', timeout: 30000 })",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'true'",
    "await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })",
    "page.getByRole('dialog', { name: '\\u6dfb\\u52a0\\u914d\\u7f6e', exact: true })",
    "if (error?.name !== 'TimeoutError') throw error",
    "getByRole('button', { name: '\\u53d6\\u6d88', exact: true }).click()",
    "await addDialog.waitFor({ state: 'hidden', timeout: 10000 })",
    "page.getByRole('button', { name: '\\u8fd4\\u56de\\u539f\\u9879\\u76ee', exact: true })",
    "await backButton.waitFor({ state: 'visible', timeout: 10000 })",
    'await Promise.all([',
    'page.waitForURL',
    'backButton.click()',
    "page.locator('#source-intake-workflow')",
    "await workflow.waitFor({ state: 'visible', timeout: 30000 })",
    "return_to_preserved: new URL(page.url()).hash === '#source-intake-workflow'",
    'workflow_visible: await workflow.isVisible()',
  ])
  assert.doesNotMatch(
    aiConfigReturn,
    /getByRole\('heading', \{ name: '\\u0041\\u0049 \\u670d\\u52a1\\u914d\\u7f6e\\u4e0e\\u9a8c\\u8bc1'/,
  )
})

test('production upgrade waits briefly for and reopens compact workflow history before selecting intake', async () => {
  const revealHistory = productionE2e.revealWorkflowHistoryIfCompleted
  assert.equal(typeof revealHistory, 'function', 'missing compact workflow history recovery helper')

  const fixture = ({ visible = false, expanded = 'false', revealAfterWait = false } = {}) => {
    let clicks = 0
    let waitForCalls = 0
    let ariaExpandedCalls = 0
    let ariaExpanded = expanded
    const historyToggle = {
      getAttribute: async () => {
        ariaExpandedCalls += 1
        return ariaExpanded
      },
      click: async () => {
        clicks += 1
        ariaExpanded = 'true'
      },
    }
    const completion = {
      isVisible: async () => visible,
      waitFor: async ({ state, timeout }) => {
        waitForCalls += 1
        assert.equal(state, 'visible')
        assert.ok(timeout > 0 && timeout < 30000, 'completion recovery wait must stay bounded below the normal UI timeout')
        if (!revealAfterWait) {
          const error = new Error('completion summary did not appear')
          error.name = 'TimeoutError'
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
        visible = true
      },
      getByRole: () => historyToggle,
    }
    return {
      workflow: { getByTestId: () => completion },
      clicks: () => clicks,
      waitForCalls: () => waitForCalls,
      ariaExpandedCalls: () => ariaExpandedCalls,
    }
  }

  const hidden = fixture()
  assert.equal(await revealHistory(hidden.workflow), false)
  assert.equal(hidden.clicks(), 0)
  assert.equal(hidden.waitForCalls(), 1)

  const expanded = fixture({ visible: true, expanded: 'true' })
  assert.equal(await revealHistory(expanded.workflow), false)
  assert.equal(expanded.clicks(), 0)
  assert.equal(expanded.waitForCalls(), 0)
  assert.equal(expanded.ariaExpandedCalls(), 1)

  const collapsed = fixture({ visible: true })
  assert.equal(await revealHistory(collapsed.workflow), true)
  assert.equal(collapsed.clicks(), 1)
  assert.equal(collapsed.ariaExpandedCalls(), 2, 'history expansion must be confirmed after clicking')

  const delayed = fixture({ revealAfterWait: true })
  assert.equal(await revealHistory(delayed.workflow), true)
  assert.equal(delayed.waitForCalls(), 1)
  assert.equal(delayed.clicks(), 1)
  assert.equal(delayed.ariaExpandedCalls(), 2)

  const start = productionSource.indexOf('async function startWorkflowModeFromUi')
  const end = productionSource.indexOf('\nasync function startDraftFromUi', start)
  assert.ok(start >= 0 && end > start, 'production workflow mode function is missing')
  assertSourceOrder(productionSource.slice(start, end), [
    'await revealWorkflowHistoryIfCompleted(workflow)',
    'await flowStepButton(workflow, UI.intakeStep).click()',
  ])
})

test('focused desktop acceptance is isolated from expensive media workflows', () => {
  assert.deepEqual(FOCUSED_DESKTOP_VIEWPORT, { width: 1280, height: 720 })
  assert.deepEqual(AI_TWO_COLUMN_VIEWPORT, { width: 1024, height: 768 })
  assert.deepEqual(DESKTOP_VIEWPORTS, [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
  ])
  assert.equal(DESKTOP_VIEWPORTS.some(({ width }) => width === 1280 || width === 1024), false)

  const focused = sourceFunction('verifyFocusedDesktopAcceptance')
  assertSourceOrder(focused, [
    'FOCUSED_DESKTOP_VIEWPORT',
    'UI.sourceImportProject',
    "page.locator('.project-card')",
    "projectCard.locator('.project-card-link')",
    'projectEntry.click()',
    "#source-intake-workflow",
    "getByTestId('source-workflow-complete')",
    'UI.enterProduction',
    "page.locator('.page-title')",
    'waitForEpisodeContext(page,',
    'selectEpisodeFromHeader(page, secondEpisode, 1)',
    'selectEpisodeFromHeader(page, firstEpisode, 0)',
    "page.locator('#film-create-quick-nav [aria-current=\"step\"]')",
    ".status-done:not(.is-current)",
    "getByTestId('film-pipeline-action')",
  ])
  assert.doesNotMatch(
    focused,
    /verifyPlayableVideo|\.play\(|verifyFinalVideoDownloadUi|verifyProjectExportUi|startProductionFromUi|startDraftFromUi/,
  )
})

test('focused episode context formats the exact user-visible number and title', () => {
  assert.equal(typeof formatExpectedEpisodeContextLabel, 'function')
  assert.equal(
    formatExpectedEpisodeContextLabel({ episode_number: 2, title: '\u7b2c\u4e8c\u5e55' }, 1),
    '\u7b2c 2 \u96c6 \u00b7 \u7b2c\u4e8c\u5e55',
  )
  assert.equal(
    formatExpectedEpisodeContextLabel({ episode_number: 1, title: '\u7b2c1\u96c6' }, 0),
    '\u7b2c 1 \u96c6',
  )
  assert.equal(
    formatExpectedEpisodeContextLabel({ episode_number: 1, title: '\u7b2c 1 \u96c6' }, 0),
    '\u7b2c 1 \u96c6',
  )
})

test('header episode switching clicks the visible select root instead of its covered input', () => {
  const switchEpisode = sourceFunction('selectEpisodeFromHeader')
  assertSourceOrder(switchEpisode, [
    "page.locator('.film-create .header-episode-select')",
    'await selectRoot.click()',
    "page.getByRole('option', { name: expectedLabel, exact: true })",
  ])
  assert.doesNotMatch(
    switchEpisode,
    /getByRole\('combobox'[\s\S]*?\.click\(/,
    'the covered Element Plus combobox input must not be used as the pointer target',
  )
})

test('focused AI setup clicks the visible switch control instead of its hidden input', () => {
  const createConfig = sourceFunction('createMissingServiceFromUi')
  assertSourceOrder(createConfig, [
    "const defaultSwitchItem = configFormItem(configDialog, '\\u8bbe\\u4e3a\\u9ed8\\u8ba4')",
    "const defaultSwitchInput = defaultSwitchItem.locator('[role=\"switch\"]')",
    "const defaultSwitchControl = defaultSwitchItem.locator('.el-switch')",
    'await defaultSwitchControl.click()',
    "await defaultSwitchInput.getAttribute('aria-checked')",
  ])
  assert.doesNotMatch(
    createConfig,
    /defaultSwitchInput\.click\(/,
    'the visually hidden Element Plus switch input must not receive pointer clicks',
  )
})

test('focused AI setup restores its exact name after applying the provider preset', () => {
  const createConfig = sourceFunction('createMissingServiceFromUi')
  assertSourceOrder(createConfig, [
    "configFormItem(configDialog, '\\u5382\\u5546').locator('.el-select').click()",
    "page.getByRole('option', { name: '\\u004f\\u0070\\u0065\\u006e\\u0041\\u0049 \\u517c\\u5bb9\\u7f51\\u5173'",
    "configFormItem(configDialog, '\\u540d\\u79f0').locator('input').fill(fixture.exactName)",
  ])
})

test('project title readiness waits for the exact project name and propagates timeouts', async () => {
  assert.equal(typeof waitForProjectTitle, 'function', 'missing exported project title readiness helper')

  let title = '\u6b63\u5728\u52a0\u8f7d\u9879\u76ee'
  const expectedTitle = 'Focused fixture'
  const observedTitles = []
  const hadOwnDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const originalDocument = globalThis.document
  const page = {
    waitForFunction: async (predicate, expected, options) => {
      assert.deepEqual(options, { timeout: 30000 }, 'title readiness must use a bounded page wait')
      const replacedHadOwnDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
      const replacedDocument = globalThis.document
      globalThis.document = {
        querySelector: (selector) => {
          assert.equal(selector, '.film-create .page-title', 'title readiness must stay within FilmCreate')
          return { textContent: title }
        },
      }
      try {
        observedTitles.push(title)
        assert.equal(predicate(expected), false, 'loading copy must not satisfy title readiness')
        await new Promise((resolve) => setTimeout(resolve, 0))
        title = expectedTitle
        observedTitles.push(title)
        assert.equal(predicate(expected), true, 'expected project name must satisfy title readiness')
      } finally {
        if (replacedHadOwnDocument) globalThis.document = replacedDocument
        else delete globalThis.document
      }
    },
  }

  await waitForProjectTitle(page, expectedTitle)
  assert.deepEqual(observedTitles, ['\u6b63\u5728\u52a0\u8f7d\u9879\u76ee', expectedTitle])
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis, 'document'), hadOwnDocument)
  if (hadOwnDocument) assert.equal(globalThis.document, originalDocument)

  const timeout = new Error('Timed out waiting for function')
  await assert.rejects(
    waitForProjectTitle({ waitForFunction: async () => { throw timeout } }, expectedTitle),
    timeout,
    'title readiness must not swallow page wait failures',
  )

  const focused = sourceFunction('verifyFocusedDesktopAcceptance')
  assertSourceOrder(focused, [
    "page.locator('.film-create').waitFor({ state: 'visible', timeout: 30000 })",
    'waitForProjectTitle(page, fixtureTitle)',
    "page.locator('#film-create-quick-nav [aria-current=\"step\"]')",
  ])
})

test('episode context readiness waits for the root title and visible selected label', async () => {
  assert.equal(typeof waitForEpisodeContext, 'function', 'missing exported episode context readiness helper')

  const expectedEpisodeTitle = '\u96e8\u591c\u6765\u7535'
  const expectedEpisodeLabel = `\u7b2c 1 \u96c6 \u00b7 ${expectedEpisodeTitle}`
  let title = '\u672a\u9009\u62e9\u5267\u96c6'
  let visibleLabel = '\u9009\u62e9\u96c6\u6570'
  let ariaLabel = '\u5176\u4ed6\u9009\u62e9\u5668'
  let ariaBusy = 'false'
  let selectedLabelVisible = true
  let snapshotDisposed = false
  const selector = '.film-create .header-episode-select'
  const combobox = {
    getAttribute(name) {
      if (name === 'aria-label') return ariaLabel
      if (name === 'title') assert.fail('episode title belongs to the select root, not the combobox input')
      return null
    },
  }
  const selectedLabel = {
    get textContent() {
      return visibleLabel
    },
    get hidden() {
      return !selectedLabelVisible
    },
    getClientRects() {
      return selectedLabelVisible ? [{ width: 120, height: 32 }] : []
    },
  }
  const root = {
    getAttribute(name) {
      if (name === 'title') return title
      if (name === 'aria-busy') return ariaBusy
      return null
    },
    querySelector(actualSelector) {
      if (actualSelector === 'input[role="combobox"]') return combobox
      if (actualSelector === '.el-select__selected-item.el-select__placeholder:not(.is-transparent)') return selectedLabel
      assert.fail(`unexpected episode context selector: ${actualSelector}`)
    },
  }
  const page = {
    async waitForFunction(predicate, expectation, options) {
      assert.deepEqual(options, { timeout: 30000 }, 'episode readiness must use a bounded page wait')
      assert.deepEqual(expectation, {
        selector,
        ariaLabel: '\u5f53\u524d\u96c6',
        episodeLabel: expectedEpisodeLabel,
      })
      const hadOwnDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
      const originalDocument = globalThis.document
      const hadOwnGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, 'getComputedStyle')
      const originalGetComputedStyle = globalThis.getComputedStyle
      globalThis.document = {
        querySelector(actualSelector) {
          assert.equal(actualSelector, selector)
          return root
        },
      }
      globalThis.getComputedStyle = () => ({
        display: selectedLabelVisible ? 'block' : 'none',
        visibility: selectedLabelVisible ? 'visible' : 'hidden',
      })
      try {
        assert.equal(predicate(expectation), false, 'placeholder context must not satisfy readiness')
        title = expectedEpisodeLabel
        assert.equal(predicate(expectation), false, 'title alone must not satisfy readiness')
        visibleLabel = title
        assert.equal(predicate(expectation), false, 'title and visible label must not bypass the combobox name')
        ariaLabel = '\u5f53\u524d\u96c6'
        selectedLabelVisible = false
        assert.equal(predicate(expectation), false, 'a hidden selected label must not satisfy readiness')
        selectedLabelVisible = true
        title = `\u5907\u4efd \u00b7 ${expectedEpisodeTitle}`
        visibleLabel = title
        assert.equal(predicate(expectation), false, 'a partial title match must not satisfy exact episode context')
        title = expectedEpisodeLabel
        visibleLabel = title
        ariaBusy = 'true'
        assert.equal(predicate(expectation), false, 'a busy episode switch must not satisfy readiness')
        ariaBusy = 'false'
        const snapshot = predicate(expectation)
        assert.deepEqual(snapshot, {
          title,
          visibleLabel,
          ariaLabel,
          ariaBusy,
        })
        return {
          async jsonValue() {
            return snapshot
          },
          async dispose() {
            snapshotDisposed = true
          },
        }
      } finally {
        if (hadOwnDocument) globalThis.document = originalDocument
        else delete globalThis.document
        if (hadOwnGetComputedStyle) globalThis.getComputedStyle = originalGetComputedStyle
        else delete globalThis.getComputedStyle
      }
    },
  }

  assert.deepEqual(await waitForEpisodeContext(page, expectedEpisodeLabel), {
    title: expectedEpisodeLabel,
    visibleLabel: expectedEpisodeLabel,
    ariaLabel: '\u5f53\u524d\u96c6',
    ariaBusy: 'false',
  })
  assert.equal(snapshotDisposed, true, 'episode readiness must dispose its browser handle')

  const timeout = new Error('Timed out waiting for episode context')
  await assert.rejects(
    waitForEpisodeContext({ waitForFunction: async () => { throw timeout } }, expectedEpisodeLabel),
    timeout,
    'episode readiness must not swallow page wait failures',
  )
})

test('enabled action readiness waits through a trial click and preserves failures', async () => {
  assert.equal(typeof waitForEnabledAction, 'function', 'missing exported enabled action readiness helper')

  let enabled = false
  let enabledChecks = 0
  const trialCalls = []
  const locator = {
    async click(options) {
      trialCalls.push(options)
      assert.equal(enabled, false, 'trial click must begin while the action is disabled')
      await new Promise((resolve) => setTimeout(resolve, 0))
      enabled = true
    },
    async isEnabled() {
      enabledChecks += 1
      return enabled
    },
  }

  await waitForEnabledAction(locator, 'new project command')
  assert.deepEqual(trialCalls, [{ trial: true, timeout: 30000 }])
  assert.equal(enabledChecks, 1, 'actionability must be explicitly confirmed after the trial click')

  const clickFailure = new Error('trial click timed out')
  await assert.rejects(
    waitForEnabledAction({
      click: async () => { throw clickFailure },
      isEnabled: async () => assert.fail('enabled state must not be checked after trial failure'),
    }, 'new project command'),
    clickFailure,
    'trial click failures must not be swallowed',
  )

  const createDramaStart = productionSource.indexOf('async function createDramaFromUi')
  const createDramaEnd = productionSource.indexOf('\nasync function verifyAiConfigReturnUi', createDramaStart)
  assert.ok(createDramaStart >= 0 && createDramaEnd > createDramaStart, 'createDramaFromUi is missing')
  assertSourceOrder(productionSource.slice(createDramaStart, createDramaEnd), [
    "newButton.waitFor({ state: 'visible', timeout: 30000 })",
    "waitForEnabledAction(newButton, 'new project command')",
    'await newButton.click()',
  ])
})

test('focused AI recovery decorates only the fixture and proves fail-closed keyboard recovery', () => {
  const providerSetup = sourceFunction('installProviderConfigs')
  assert.doesNotMatch(providerSetup, /startsWith\(CONFIG_PREFIX\)/)

  const getRouteMatrix = [
    { pathname: '/api/v1/ai-configs', query: '', expected: 'decorate-list' },
    { pathname: '/api/v1/ai-configs', query: '?cache=1', expected: 'decorate-list' },
    { pathname: '/api/v1/ai-configs', query: '?service_type=video', expected: 'passthrough' },
    { pathname: '/api/v1/ai-configs', query: '?service_type=', expected: 'passthrough' },
    { pathname: '/api/v1/ai-configs', query: '?cache=1&service_type=', expected: 'passthrough' },
    { pathname: '/api/v1/ai-configs/1', query: '', expected: 'passthrough' },
  ]
  for (const entry of getRouteMatrix) {
    assert.equal(focusedAiRouteAction({ method: 'GET', ...entry }), entry.expected)
  }
  assert.equal(focusedAiRouteAction({
    method: 'POST',
    pathname: '/api/v1/ai-configs',
    requestName: 'exact fixture',
    fixtureName: 'exact fixture',
  }), 'decorate-create')
  assert.equal(focusedAiRouteAction({
    method: 'POST',
    pathname: '/api/v1/ai-configs',
    requestName: 'user config',
    fixtureName: 'exact fixture',
  }), 'passthrough')

  const routePolicy = sourceFunction('focusedAiRouteAction')
  assert.match(routePolicy, /new URLSearchParams\(query\)\.has\('service_type'\)/)
  assert.doesNotMatch(routePolicy, /serviceType/)

  const routes = sourceFunction('installFocusedAiRoutes')
  assert.match(routes, /focusedAiRouteAction/)
  assert.match(routes, /providerState\.created/)
  assert.match(routes, /last_test_status/)
  assert.match(routes, /readinessGate/)

  const createConfig = sourceFunction('createMissingServiceFromUi')
  assertSourceOrder(createConfig, [
    "page.getByRole('button', { name: UI.addConfiguration",
    "provider: 'openai_compatible'",
    "service_type: 'text'",
    "default_model: 'local-e2e-text'",
    'is_default, false',
    'createdId',
  ])
  assert.match(createConfig, /request\.method\(\) === 'POST'/)
  assert.match(createConfig, /url\.pathname === '\/api\/v1\/ai-configs'/)
  assert.match(createConfig, /page\.waitForFunction/)
  assert.doesNotMatch(createConfig, /ai-configs\/test/)

  const focused = sourceFunction('verifyFocusedDesktopAcceptance')
  assert.match(pipelinePanelSource, /data-testid="film-pipeline-summary"/)
  assert.equal(
    (focused.match(/fallback: page\.getByTestId\('film-pipeline-summary'\)/g) || []).length,
    3,
    'all focus drivers must target the product-exposed pipeline summary',
  )
  assert.doesNotMatch(focused, /fallback:\s*page\.locator/)
  assertSourceOrder(focused, [
    'assertCoverageLayout',
    'columns: 4',
    'layout1280.cards.map',
    'assertComponentHorizontalOverflow',
    'minimumTargetSize: 32',
    'assertWorkbenchFocus',
    'UI.configureMissingService',
    'createMissingServiceFromUi',
    'const injectedFailureResponsePromise = page.waitForResponse',
    "response.status() === 503",
    'UI.returnToProduction',
    'UI.configurationRechecking',
    "data-state=\"checking\"",
    'readinessGate.release(503)',
    'const injectedFailureResponse = await injectedFailureResponsePromise',
    "data-state=\"error\"",
    "retryAction.press('Enter')",
    "data-state=\"ready\"",
    'AI_TWO_COLUMN_VIEWPORT',
    'columns: 2',
  ])
  assert.match(focused, /assert\.deepEqual\(providerCallsAfter, providerCallsBefore/)
  assert.match(focused, /layout1024\.cards\.map/)
  assert.match(focused, /\/ai-configs\/test/)
  assert.match(focused, /\/workflows\/novel2anime/)
  assert.match(focused, /assert\.equal\(injectedFailureResponse\.status\(\), 503/)
  assert.doesNotMatch(focused, /readinessStatuses\.includes\(503\)/)
  assert.ok(
    focused.indexOf('const injectedFailureResponsePromise = page.waitForResponse')
      < focused.indexOf('await customReturn.click()'),
    'the controlled failure listener must be registered before the readiness request starts',
  )
  assert.ok(
    focused.indexOf('routes.readinessGate.release(503)')
      < focused.indexOf('const customFocus = await assertWorkbenchFocus'),
    'the intercepted readiness request must be released before focus polling can consume its timeout budget',
  )
  assert.match(focused, /finally\s*\{/)
})

test('focused coverage waits for the exact service-state matrix before each layout assertion', () => {
  const focused = sourceFunction('verifyFocusedDesktopAcceptance')
  const firstLayout = focused.indexOf('const layout1280 = await assertCoverageLayout')
  const secondLayout = focused.indexOf('const layout1024 = await assertCoverageLayout')
  assert.ok(firstLayout >= 0 && secondLayout > firstLayout, 'focused acceptance must retain both coverage layout assertions')

  const firstWait = focused.lastIndexOf('await waitForCoverageCardMatrix(page)', firstLayout)
  const secondWait = focused.lastIndexOf('await waitForCoverageCardMatrix(page)', secondLayout)
  assert.ok(firstWait >= 0 && firstWait < firstLayout, '1280 layout must wait for the exact coverage matrix')
  assert.ok(secondWait > firstLayout && secondWait < secondLayout, '1024 layout must wait for the exact coverage matrix again')

  const coverageWait = sourceFunction('waitForCoverageCardMatrix')
  assert.match(coverageWait, /FOCUSED_COVERAGE_MATRIX/)
  assert.match(coverageWait, /service/)
  assert.match(coverageWait, /state/)
  assert.match(coverageWait, /test_status/)
  assert.doesNotMatch(coverageWait, /assertCoverageLayout/)
})

test('focused acceptance snapshots completed navigation before capture routes leave FilmCreate', () => {
  const focused = sourceFunction('verifyFocusedDesktopAcceptance')

  assertSourceOrder(focused, [
    'const completedSteps = page.locator',
    'const completedDistinctCount = await completedSteps.count()',
    'assert.ok(completedDistinctCount > 0',
    'captureAcceptanceReportScreenshots(page, {',
    'completed_distinct_count: completedDistinctCount',
  ])
  assert.doesNotMatch(focused, /completed_distinct_count:\s*await completedSteps\.count\(\)/)
})

test('acceptance capture preparation waits for mask-free expected surface state', () => {
  const preparation = sourceFunction('prepareAcceptanceCaptureSurface')
  assert.match(preparation, /waitForAcceptanceCaptureReadiness\(page, capture, fixture\)/)

  const readiness = sourceFunction('waitForAcceptanceCaptureReadiness')
  assert.match(readiness, /el-loading-mask/)
  assert.match(readiness, /project-readiness/)
  assert.match(readiness, /summary-item/)
  assert.match(readiness, /service-chip/)
  assert.match(readiness, /=== 8/)
  assert.match(readiness, /=== 5/)
  assert.match(readiness, /film-pipeline-summary/)
  assert.match(readiness, /ai-config-configs-panel/)
  assert.match(readiness, /fixture\.uiConfigName/)
  assert.match(readiness, /fixture\.expectedConfigNames/)
  assert.match(readiness, /waitForCoverageCardMatrix/)
  assert.match(readiness, /project-list/)
  assert.match(readiness, /film-list/)
  assert.match(readiness, /projects-wrap\[aria-busy="false"\]/)
  assert.match(readiness, /media-library/)
  assert.match(readiness, /media-grid\[aria-busy="false"\]/)
  assert.match(readiness, /data-load-state/)
  assert.match(readiness, /drama-canvas/)
  assert.match(readiness, /vue-flow-canvas/)
  assert.match(readiness, /free-create/)
  assert.match(readiness, /service-readiness\.is-ready/)
  assert.doesNotMatch(readiness, /service-readiness:not/)

  assert.match(
    productionSource,
    /async function assertScreenshotSurfaceSafe\(page\)[\s\S]*?element\.getClientRects\(\)\.length > 0[\s\S]*?capture surface still contains a loading mask/,
  )

  assert.match(preparation, /fixture\.routes\.state\.freeCreateReadyImage = capture\.surface === 'free-create'/)

  assert.match(productionSource, /'project-list': `\$\{FRONTEND_URL\}\/`/)
  assert.match(productionSource, /'media-library': `\$\{FRONTEND_URL\}\/media-library`/)
  assert.match(productionSource, /'drama-canvas': `\$\{FRONTEND_URL\}\/film\/\$\{fixture\.dramaId\}\/canvas\?episode=\$\{episodeId\}`/)
  assert.match(productionSource, /'free-create': `\$\{FRONTEND_URL\}\/free-create`/)

  const captures = sourceFunction('captureAcceptanceReportScreenshots')
  assertSourceOrder(captures, [
    'prepareAcceptanceCaptureSurface(page, capture, fixture)',
    'assertScreenshotSurfaceSafe(page)',
    'page.screenshot',
  ])

  const focused = sourceFunction('verifyFocusedDesktopAcceptance')
  assertSourceOrder(focused, [
    'const exactName = `E2E Focused Text ${stamp}`',
    'const inactiveTextId = Number(textFixture.id)',
    'providerState.created',
    'Number(config.id) !== inactiveTextId',
    'expectedConfigNames',
    'captureAcceptanceReportScreenshots(page, {',
    'uiConfigName: exactName',
    'expectedConfigNames',
  ])
})

const FOCUSED_COVERAGE_WAIT_MATRIX = [
  { service: 'image', state: 'configured', test_status: 'unknown' },
  { service: 'video', state: 'default', test_status: 'failed' },
  { service: 'text', state: 'missing', test_status: 'unknown' },
  { service: 'tts', state: 'default', test_status: 'unknown' },
  { service: 'storyboard_image', state: 'default', test_status: 'passed' },
]

function createClassList(names) {
  return {
    contains: (name) => names.includes(name),
    [Symbol.iterator]: function * iterate() {
      yield * names
    },
  }
}

function createCoverageCard({ service, state, test_status: testStatus }) {
  return {
    classList: createClassList([`coverage-${state}`]),
    querySelector(selector) {
      if (selector === '.coverage-icon') return { classList: createClassList([`coverage-icon-${service}`]) }
      if (selector === '.coverage-test-status') return { classList: createClassList([`test-${testStatus}`]) }
      return null
    },
  }
}

function createCaptureReadinessPage({
  configRows = [],
  summaryItems = 8,
  serviceChips = 5,
  loadingMasks = 0,
  filmReady = true,
  coverageRecords = FOCUSED_COVERAGE_WAIT_MATRIX,
  projectListState = 'ready',
  mediaLibraryState = 'empty',
  canvasState = 'flow',
  freeCreateState = 'ready',
} = {}) {
  const visible = (textContent = '', classNames = [], attributes = {}) => ({
    textContent,
    classList: createClassList(classNames),
    getAttribute: (name) => attributes[name] ?? null,
    getClientRects: () => [{}],
  })
  const matchesSimpleSelector = (node, selector) => {
    const excludedClasses = [...selector.matchAll(/:not\(\.([A-Za-z0-9_-]+)\)/g)].map((match) => match[1])
    const positiveSelector = selector.replace(/:not\(\.[A-Za-z0-9_-]+\)/g, '')
    const requiredClasses = [...positiveSelector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1])
    const requiredAttributes = [...positiveSelector.matchAll(/\[([A-Za-z0-9_-]+)="([^"]*)"\]/g)]
      .map((match) => [match[1], match[2]])
    return requiredClasses.every((name) => node.classList?.contains(name))
      && excludedClasses.every((name) => !node.classList?.contains(name))
      && requiredAttributes.every(([name, value]) => node.getAttribute?.(name) === value)
  }
  const toggle = {
    ...visible(),
    getAttribute: (name) => (name === 'aria-expanded' ? 'true' : null),
  }
  const nodes = {
    '#ai-config-configs-panel': visible(),
    '.config-list-section': visible(),
    '[data-testid="project-readiness-toggle"]': toggle,
    '[data-testid="project-readiness-details"]': visible(),
    '.film-create': visible(),
    '[data-testid="film-pipeline-summary"][data-state="ready"]': filmReady ? visible() : null,
  }
  const surfaceNodes = [
    visible('', ['film-list']),
    visible('', ['projects-wrap'], { 'aria-busy': projectListState === 'loading' ? 'true' : 'false' }),
    visible('', ['project-grid']),
    visible('', ['media-library-page']),
    visible('', ['media-grid'], { 'aria-busy': mediaLibraryState === 'loading' ? 'true' : 'false' }),
    visible('', ['drama-canvas-page']),
    ...(canvasState === 'error' ? [visible('', ['canvas-load-failure'])] : [visible('', ['canvas-shell'])]),
    visible('', ['free-create-page']),
    visible('', ['input-panel']),
    visible('', ['service-readiness', `is-${freeCreateState}`]),
  ]
  if (['ready', 'loading', 'error'].includes(projectListState)) surfaceNodes.push(visible('', ['project-card']))
  if (projectListState === 'error') surfaceNodes.push(visible('', ['data-load-state']))
  if (['ready', 'loading', 'error'].includes(mediaLibraryState)) surfaceNodes.push(visible('', ['media-card']))
  if (mediaLibraryState === 'empty') surfaceNodes.push(visible('', ['empty-media']))
  if (mediaLibraryState === 'error') surfaceNodes.push(visible('', ['data-load-state']))
  if (['flow', 'loading'].includes(canvasState)) surfaceNodes.push(visible('', ['vue-flow-canvas']))
  if (canvasState === 'start') surfaceNodes.push(visible('', ['canvas-start-state']))
  const cell = (textContent = '') => ({
    ...visible(textContent),
    querySelector: (selector) => (selector === '.cell' ? visible(textContent) : null),
  })
  const headers = [cell(''), cell('\u540d\u79f0')]
  const tableRows = configRows.map((name) => ({
    ...visible(name),
    querySelectorAll: (selector) => (selector === 'td.el-table__cell' ? [cell(''), cell(name)] : []),
  }))
  nodes['#ai-config-configs-panel .config-list-section .el-table'] = {
    ...visible(),
    querySelectorAll(selector) {
      if (selector === '.el-table__header-wrapper th.el-table__cell') return headers
      if (selector === '.el-table__body-wrapper tbody tr.el-table__row') return tableRows
      return []
    },
  }
  const lists = {
    '.el-loading-mask': Array.from({
      length: loadingMasks + [projectListState, mediaLibraryState, canvasState, freeCreateState]
        .filter((state) => state === 'loading').length,
    }, () => visible()),
    '.el-table__row': tableRows,
    '[data-testid="project-readiness-details"] .summary-item': Array.from({ length: summaryItems }, () => visible()),
    '[data-testid="project-readiness-details"] .service-chip': Array.from({ length: serviceChips }, () => visible()),
    '#ai-config-coverage-panel .coverage-item': coverageRecords.map(createCoverageCard),
  }
  return {
    async waitForFunction(predicate, argument, options) {
      assert.deepEqual(options, { timeout: 30000 })
      const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
      const originalDocument = globalThis.document
      const hadGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, 'getComputedStyle')
      const originalGetComputedStyle = globalThis.getComputedStyle
      globalThis.document = {
        querySelector: (selector) => nodes[selector]
          || surfaceNodes.find((node) => matchesSimpleSelector(node, selector))
          || null,
        querySelectorAll: (selector) => lists[selector] || [],
      }
      globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible' })
      try {
        if (!predicate(argument)) throw new Error('capture readiness predicate did not match')
      } finally {
        if (hadDocument) globalThis.document = originalDocument
        else delete globalThis.document
        if (hadGetComputedStyle) globalThis.getComputedStyle = originalGetComputedStyle
        else delete globalThis.getComputedStyle
      }
    },
  }
}

test('coverage matrix waiter executes the exact service, state, and test-status predicate', async () => {
  assert.equal(typeof waitForCoverageCardMatrix, 'function', 'missing coverage matrix waiter')
  await waitForCoverageCardMatrix(createCaptureReadinessPage())

  const invalidMatrices = [
    FOCUSED_COVERAGE_WAIT_MATRIX.slice(0, -1),
    FOCUSED_COVERAGE_WAIT_MATRIX.map((record, index) => (index === 0 ? { ...record, service: 'text' } : record)),
    FOCUSED_COVERAGE_WAIT_MATRIX.map((record, index) => (index === 0 ? { ...record, state: 'default' } : record)),
    FOCUSED_COVERAGE_WAIT_MATRIX.map((record, index) => (index === 4 ? { ...record, test_status: 'failed' } : record)),
  ]
  for (const coverageRecords of invalidMatrices) {
    await assert.rejects(
      waitForCoverageCardMatrix(createCaptureReadinessPage({ coverageRecords })),
      /capture readiness predicate did not match/,
    )
  }
})

test('film screenshot readiness rejects visible loading masks and waits for ready state', async () => {
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({ loadingMasks: 1 }),
      { surface: 'film-pipeline' },
      {},
    ),
    /capture readiness predicate did not match/,
  )
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({ filmReady: false }),
      { surface: 'film-pipeline' },
      {},
    ),
    /capture readiness predicate did not match/,
  )
  await waitForAcceptanceCaptureReadiness(
    createCaptureReadinessPage(),
    { surface: 'film-pipeline' },
    {},
  )
})

test('coverage screenshot readiness executes the exact card predicate', async () => {
  await waitForAcceptanceCaptureReadiness(
    createCaptureReadinessPage(),
    { surface: 'ai-config-coverage' },
    {},
  )
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({
        coverageRecords: FOCUSED_COVERAGE_WAIT_MATRIX.map((record, index) => (
          index === 2 ? { ...record, state: 'configured' } : record
        )),
      }),
      { surface: 'ai-config-coverage' },
      {},
    ),
    /capture readiness predicate did not match/,
  )
})

test('acceptance management readiness requires the exact UI-created configuration name', async () => {
  assert.equal(typeof waitForAcceptanceCaptureReadiness, 'function', 'missing acceptance capture readiness helper')
  const page = createCaptureReadinessPage({
    configRows: [
      'E2E Production Provider text',
      'E2E Production Provider image',
      'E2E Production Provider storyboard_image',
      'E2E Production Provider video',
      'E2E Production Provider tts',
    ],
  })
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(page, { surface: 'ai-config-management' }, {}),
    /requires uiConfigName/,
  )
})

test('acceptance management readiness accepts four fixture rows plus the exact UI-created configuration', async () => {
  const uiConfigName = 'E2E Focused Text capture-fixture'
  const expectedConfigNames = [
    'E2E Production Provider image capture-fixture',
    'E2E Production Provider storyboard_image capture-fixture',
    'E2E Production Provider video capture-fixture',
    'E2E Production Provider tts capture-fixture',
    uiConfigName,
  ]
  const page = createCaptureReadinessPage({
    configRows: expectedConfigNames,
  })
  await waitForAcceptanceCaptureReadiness(
    page,
    { surface: 'ai-config-management' },
    { uiConfigName, expectedConfigNames },
  )
})

test('acceptance management readiness rejects an extra inactive row and a near-match name', async () => {
  const uiConfigName = 'E2E Focused Text exact'
  const expectedConfigNames = [
    'E2E Production Provider image exact',
    'E2E Production Provider storyboard_image exact',
    'E2E Production Provider video exact',
    'E2E Production Provider tts exact',
    uiConfigName,
  ]
  const fixture = { uiConfigName, expectedConfigNames }
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({ configRows: [...expectedConfigNames, 'E2E Production Provider text exact'] }),
      { surface: 'ai-config-management' },
      fixture,
    ),
    /capture readiness predicate did not match/,
  )
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({
        configRows: expectedConfigNames.map((name) => (name === uiConfigName ? `${name} backup` : name)),
      }),
      { surface: 'ai-config-management' },
      fixture,
    ),
    /capture readiness predicate did not match/,
  )
})

test('project readiness capture waits for all fixed summary and service items', async () => {
  await assert.rejects(
    waitForAcceptanceCaptureReadiness(
      createCaptureReadinessPage({ summaryItems: 7, serviceChips: 5 }),
      { surface: 'project-readiness' },
      {},
    ),
    /capture readiness predicate did not match/,
  )
  await waitForAcceptanceCaptureReadiness(
    createCaptureReadinessPage({ summaryItems: 8, serviceChips: 5 }),
    { surface: 'project-readiness' },
    {},
  )
})

test('project list screenshot readiness rejects loading, errors, and a list without a visible card', async () => {
  for (const projectListState of ['loading', 'error', 'no-card']) {
    await assert.rejects(
      waitForAcceptanceCaptureReadiness(
        createCaptureReadinessPage({ projectListState }),
        { surface: 'project-list' },
        {},
      ),
      /capture readiness predicate did not match/,
      projectListState,
    )
  }
  await waitForAcceptanceCaptureReadiness(createCaptureReadinessPage(), { surface: 'project-list' }, {})
})

test('media library screenshot readiness rejects loading, errors, and settled output without content', async () => {
  for (const mediaLibraryState of ['loading', 'error', 'no-content']) {
    await assert.rejects(
      waitForAcceptanceCaptureReadiness(
        createCaptureReadinessPage({ mediaLibraryState }),
        { surface: 'media-library' },
        {},
      ),
      /capture readiness predicate did not match/,
      mediaLibraryState,
    )
  }
  await waitForAcceptanceCaptureReadiness(createCaptureReadinessPage(), { surface: 'media-library' }, {})
  await waitForAcceptanceCaptureReadiness(
    createCaptureReadinessPage({ mediaLibraryState: 'ready' }),
    { surface: 'media-library' },
    {},
  )
})

test('drama canvas screenshot readiness rejects loading, errors, and a shell without flow or start state', async () => {
  for (const canvasState of ['loading', 'error', 'no-content']) {
    await assert.rejects(
      waitForAcceptanceCaptureReadiness(
        createCaptureReadinessPage({ canvasState }),
        { surface: 'drama-canvas' },
        {},
      ),
      /capture readiness predicate did not match/,
      canvasState,
    )
  }
  await waitForAcceptanceCaptureReadiness(createCaptureReadinessPage(), { surface: 'drama-canvas' }, {})
  await waitForAcceptanceCaptureReadiness(
    createCaptureReadinessPage({ canvasState: 'start' }),
    { surface: 'drama-canvas' },
    {},
  )
})

test('free create screenshot readiness rejects loading, error, and missing service states', async () => {
  for (const freeCreateState of ['loading', 'error', 'missing']) {
    await assert.rejects(
      waitForAcceptanceCaptureReadiness(
        createCaptureReadinessPage({ freeCreateState }),
        { surface: 'free-create' },
        {},
      ),
      /capture readiness predicate did not match/,
      freeCreateState,
    )
  }
  await waitForAcceptanceCaptureReadiness(createCaptureReadinessPage(), { surface: 'free-create' }, {})
})

test('focused AI list exposes a sanitized ready image only for the free-create capture switch', async () => {
  const routes = new Map()
  const listeners = new Map()
  const imageConfig = {
    id: 41,
    name: 'E2E Production Provider image',
    provider: 'openai_compatible',
    service_type: 'image',
    api_protocol: 'openai',
    default_model: 'local-e2e-image',
    model: '["local-e2e-image"]',
    is_default: true,
    is_active: true,
    credential_set: false,
    last_test_status: 'failed',
    base_url: 'http://protected-provider.invalid/v1',
    api_key: 'protected-image-key',
    settings: '{"api_key":"protected-settings-key"}',
  }
  const page = {
    async route(pattern, handler) { routes.set(pattern, handler) },
    async unrouteAll() {},
    on(event, listener) { listeners.set(event, listener) },
    off(event, listener) { listeners.delete(event) },
  }
  const installed = await installFocusedAiRoutes(page, {
    inactiveTextId: 11,
    providerState: { created: [imageConfig] },
    uiConfigName: 'Focused test fixture',
  })
  const aiConfigHandler = routes.get('**/api/v1/ai-configs*')
  const decoratedImage = async () => {
    let payload
    await aiConfigHandler({
      request: () => ({
        method: () => 'GET',
        url: () => 'http://localhost:5679/api/v1/ai-configs',
      }),
      fetch: async () => ({ json: async () => ({ success: true, data: [imageConfig] }) }),
      continue: async () => assert.fail('focused image list must be decorated'),
      fulfill: async ({ body }) => { payload = JSON.parse(body) },
    })
    return payload.data[0]
  }

  assert.equal(installed.state.freeCreateReadyImage, false)
  const ordinaryImage = await decoratedImage()
  assert.deepEqual(
    {
      is_default: ordinaryImage.is_default,
      is_active: ordinaryImage.is_active,
      credential_set: ordinaryImage.credential_set,
      last_test_status: ordinaryImage.last_test_status,
    },
    { is_default: false, is_active: true, credential_set: false, last_test_status: 'unknown' },
  )

  installed.state.freeCreateReadyImage = true
  const readyImage = await decoratedImage()
  assert.deepEqual(
    {
      is_default: readyImage.is_default,
      is_active: readyImage.is_active,
      credential_set: readyImage.credential_set,
      last_test_status: readyImage.last_test_status,
    },
    { is_default: true, is_active: true, credential_set: true, last_test_status: 'passed' },
  )
  assert.deepEqual(
    { base_url: readyImage.base_url, api_key: readyImage.api_key, settings: readyImage.settings },
    { base_url: '', api_key: '', settings: null },
  )

  const routesSource = sourceFunction('installFocusedAiRoutes')
  assert.doesNotMatch(routesSource, /openTest|ai-configs\/test|providerControlRequest/)
  await installed.dispose()
})

test('focused AI create route registers ownership and list visibility before fulfilling', async () => {
  const routes = new Map()
  const listeners = new Map()
  const cleanupState = { createdIds: new Set() }
  const fixture = {
    inactiveTextId: 11,
    providerState: { created: [] },
    uiConfigName: 'Focused test fixture',
    cleanupState,
  }
  const page = {
    async route(pattern, handler) {
      routes.set(pattern, handler)
    },
    async unrouteAll() {},
    on(event, listener) {
      listeners.set(event, listener)
    },
    off(event, listener) {
      listeners.delete(event)
    },
  }
  const installed = await installFocusedAiRoutes(page, fixture)
  const aiConfigHandler = routes.get('**/api/v1/ai-configs*')
  const created = {
    id: 88,
    name: fixture.uiConfigName,
    service_type: 'text',
    is_active: true,
    is_default: false,
  }
  let createFulfilled = false

  await aiConfigHandler({
    request: () => ({
      method: () => 'POST',
      url: () => 'http://localhost:5679/api/v1/ai-configs',
      postDataJSON: () => ({ name: fixture.uiConfigName, settings: '{}' }),
    }),
    fetch: async () => ({ json: async () => ({ success: true, data: created }) }),
    continue: async () => assert.fail('focused create must not continue'),
    fulfill: async () => {
      assert.equal(cleanupState.createdIds.has(created.id), true, 'create route must claim cleanup ownership before fulfill')
      assert.equal(installed.state.uiCreatedIds.has(created.id), true, 'create route must register the created id before fulfill')
      assert.equal(installed.state.includeUiCreated, true, 'create route must enable decorated list visibility before fulfill')
      assert.equal(installed.state.mutationComplete, true, 'create route must register mutation state before fulfill')
      createFulfilled = true
    },
  })
  assert.equal(createFulfilled, true)

  let decoratedList
  await aiConfigHandler({
    request: () => ({
      method: () => 'GET',
      url: () => 'http://localhost:5679/api/v1/ai-configs',
    }),
    fetch: async () => ({ json: async () => ({ success: true, data: [created] }) }),
    continue: async () => assert.fail('focused list must be decorated'),
    fulfill: async ({ body }) => {
      decoratedList = JSON.parse(body)
    },
  })
  assert.deepEqual(decoratedList.data.map((row) => row.id), [created.id], 'immediate decorated GET must include the created config')
  await installed.dispose()
})

function createReadinessTimerHarness() {
  let nextId = 0
  const scheduled = []
  const cleared = []
  return {
    scheduled,
    cleared,
    setTimeoutFn(callback, delay) {
      const timer = { id: `timer-${nextId += 1}`, callback, delay }
      scheduled.push(timer)
      return timer.id
    },
    clearTimeoutFn(id) {
      cleared.push(id)
    },
    fire(index) {
      scheduled[index].callback()
    },
  }
}

test('readiness gate gives each waiter the default timeout without disarming late interception', async () => {
  assert.equal(typeof createReadinessGate, 'function', 'missing exported readiness gate')
  const timers = createReadinessTimerHarness()
  const gate = createReadinessGate(timers)
  gate.arm()
  assert.equal(timers.scheduled.length, 0, 'arming without a waiter must not schedule a timer')

  const wait = gate.waitUntilIntercepted()
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].delay, 10000, 'waiter must own the bounded default timeout')
  timers.fire(0)
  await assert.rejects(
    wait,
    /POST \/api\/v1\/workflows\/novel2anime\/readiness.*timed out after 10000ms/,
  )
  assert.equal(gate.isArmed(), true, 'wait timeout must leave the gate armed for a late readiness request')

  let lateSettled = false
  const lateIntercept = gate.intercept().finally(() => { lateSettled = true })
  await Promise.resolve()
  assert.equal(lateSettled, false, 'late readiness request must remain intercepted until cleanup')
  gate.dispose()
  assert.equal(await lateIntercept, 503)
})

test('readiness gate clears a successful waiter timer', async () => {
  const timers = createReadinessTimerHarness()
  const gate = createReadinessGate(timers)
  gate.arm()
  const wait = gate.waitUntilIntercepted()
  assert.equal(timers.scheduled.length, 1)
  const intercept = gate.intercept()
  await wait
  assert.deepEqual(timers.cleared, [timers.scheduled[0].id])
  gate.release(503)
  assert.equal(await intercept, 503)
})

test('readiness gate disposal rejects every pre-interception waiter and clears timers', async () => {
  const timers = createReadinessTimerHarness()
  const gate = createReadinessGate(timers)
  gate.arm()
  const waits = [gate.waitUntilIntercepted(), gate.waitUntilIntercepted()]
  assert.equal(timers.scheduled.length, 2, 'each wait call must own one timer')
  gate.dispose()

  const results = await Promise.race([
    Promise.allSettled(waits),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
  ])
  assert.notEqual(results, 'pending', 'dispose must settle pending waits promptly')
  assert.deepEqual(results.map(({ status }) => status), ['rejected', 'rejected'])
  for (const result of results) assert.match(result.reason.message, /disposed before expected readiness POST/)
  assert.deepEqual(timers.cleared, timers.scheduled.map(({ id }) => id))
})

test('focused readiness routes continue normal requests and record only real target responses', async () => {
  assert.equal(typeof installFocusedAiRoutes, 'function', 'missing exported focused AI route installer')

  const routes = new Map()
  const listeners = new Map()
  const unrouteAllCalls = []
  const removedListeners = []
  let activeGateHandler = null
  const page = {
    async route(pattern, handler) {
      routes.set(pattern, handler)
    },
    async unrouteAll(options) {
      assert.deepEqual(options, { behavior: 'wait' }, 'focused route cleanup must wait for active handlers')
      assert.ok(activeGateHandler, 'unrouteAll must wait for the active readiness handler')
      unrouteAllCalls.push(options)
      await activeGateHandler
      routes.clear()
    },
    on(event, listener) {
      listeners.set(event, listener)
    },
    off(event, listener) {
      assert.equal(listeners.get(event), listener, `off must remove its registered ${event} listener`)
      assert.equal(routes.size, 0, 'response listener must remain registered until all routes are removed')
      listeners.delete(event)
      removedListeners.push(event)
    },
  }
  const fixture = {
    inactiveTextId: 11,
    providerState: { created: [] },
    uiConfigName: 'Focused test fixture',
  }
  const installed = await installFocusedAiRoutes(page, fixture)
  const readinessPattern = '**/api/v1/workflows/novel2anime/readiness'
  const readinessHandler = routes.get(readinessPattern)
  const readinessResponseListener = listeners.get('response')
  assert.equal(typeof readinessHandler, 'function')
  assert.equal(typeof readinessResponseListener, 'function', 'readiness responses must be observed after continue')

  const continued = []
  const fetched = []
  const fulfilled = []
  const normalRoute = {
    request: () => ({ postDataJSON: () => ({ drama_id: 42, options: { caller_option: 'preserved' } }) }),
    continue: async (options) => { continued.push(options) },
    fetch: async (options) => { fetched.push(options) },
    fulfill: async (options) => { fulfilled.push(options) },
  }
  await readinessHandler(normalRoute)
  assert.equal(continued.length, 1, 'normal readiness POST must continue exactly once')
  assert.equal(fetched.length, 0, 'normal readiness POST must not fetch through a route')
  assert.equal(fulfilled.length, 0, 'normal readiness POST must not fulfill a route')
  assert.deepEqual(JSON.parse(continued[0].postData), {
    drama_id: 42,
    options: {
      caller_option: 'preserved',
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
    },
  })

  const response = ({ method, pathname, status }) => ({
    request: () => ({ method: () => method }),
    url: () => `http://localhost:5679${pathname}`,
    status: () => status,
  })
  await readinessResponseListener(response({ method: 'GET', pathname: '/api/v1/workflows/novel2anime/readiness', status: 204 }))
  await readinessResponseListener(response({ method: 'POST', pathname: '/api/v1/other', status: 202 }))
  await readinessResponseListener(response({ method: 'POST', pathname: '/api/v1/workflows/novel2anime/readiness', status: 201 }))
  assert.deepEqual(installed.state.readinessStatuses, [201], 'only target readiness POST responses must be recorded')

  installed.readinessGate.arm()
  const releasedGateFulfilled = []
  const releasedGateContinued = []
  const releasedGateHandler = readinessHandler({
    request: () => ({ postDataJSON: () => ({ options: {} }) }),
    continue: async (options) => { releasedGateContinued.push(options) },
    fetch: async () => assert.fail('armed readiness gate must not fetch'),
    fulfill: async (options) => {
      releasedGateFulfilled.push(options)
      const listener = listeners.get('response')
      assert.equal(typeof listener, 'function', 'fulfilled readiness response must reach the active response listener')
      await listener(response({
        method: 'POST',
        pathname: '/api/v1/workflows/novel2anime/readiness',
        status: options.status,
      }))
    },
  })
  await installed.readinessGate.waitUntilIntercepted()
  installed.readinessGate.release(503)
  await releasedGateHandler
  assert.equal(releasedGateContinued.length, 0, 'armed readiness gate must not continue')
  assert.equal(releasedGateFulfilled.length, 1, 'armed readiness gate must fulfill exactly once')
  assert.equal(releasedGateFulfilled[0].status, 503)
  assert.deepEqual(installed.state.readinessStatuses, [201, 503], 'a fulfilled 503 must be recorded only by the response listener')

  installed.readinessGate.arm()
  const pendingGateFulfilled = []
  const pendingGateContinued = []
  activeGateHandler = readinessHandler({
    request: () => ({ postDataJSON: () => ({ options: {} }) }),
    continue: async (options) => { pendingGateContinued.push(options) },
    fetch: async () => assert.fail('armed readiness gate must not fetch'),
    fulfill: async (options) => { pendingGateFulfilled.push(options) },
  })
  await installed.readinessGate.waitUntilIntercepted()
  await installed.dispose()
  assert.equal(pendingGateContinued.length, 0, 'dispose-released readiness gate must not continue')
  assert.equal(pendingGateFulfilled.length, 1, 'dispose must wait for the pending readiness gate to fulfill')
  assert.equal(pendingGateFulfilled[0].status, 503)
  assert.deepEqual(installed.state.readinessStatuses, [201, 503], 'dispose must not fabricate a readiness response status')

  assert.deepEqual(unrouteAllCalls, [{ behavior: 'wait' }])
  assert.deepEqual(removedListeners, ['response'])
  assert.equal(routes.size, 0)
  assert.equal(listeners.size, 0)

  const unrouteFailure = new Error('unrouteAll failed')
  const failingListeners = new Map()
  const failingPage = {
    route: async () => {},
    unrouteAll: async (options) => {
      assert.deepEqual(options, { behavior: 'wait' })
      throw unrouteFailure
    },
    on(event, listener) {
      failingListeners.set(event, listener)
    },
    off(event, listener) {
      assert.equal(failingListeners.get(event), listener)
      failingListeners.delete(event)
    },
  }
  const failingInstall = await installFocusedAiRoutes(failingPage, fixture)
  await assert.rejects(failingInstall.dispose(), unrouteFailure)
  assert.equal(failingListeners.size, 0, 'dispose must remove the response listener when unrouteAll fails')
})

test('focused coverage geometry follows structural-repair priority and validates service identity', () => {
  const records = [
    { service: 'image', label: '\u7d20\u6750\u56fe\u7247', state: 'configured', test_status: 'unknown', action_count: 1, action_label: '\u8865\u9f50\u9ed8\u8ba4' },
    { service: 'video', label: '\u89c6\u9891\u751f\u6210', state: 'default', test_status: 'failed', action_count: 1, action_label: '\u91cd\u65b0\u6d4b\u8bd5' },
    { service: 'text', label: '\u6587\u672c\u751f\u6210', state: 'missing', test_status: 'unknown', action_count: 0, action_label: '' },
    { service: 'tts', label: '\u8bed\u97f3\u5408\u6210', state: 'default', test_status: 'unknown', action_count: 1, action_label: '\u7acb\u5373\u6d4b\u8bd5' },
    { service: 'storyboard_image', label: '\u5206\u955c\u56fe\u7247', state: 'default', test_status: 'passed', action_count: 0, action_label: '' },
  ].map((record, index) => ({ ...record, x: (index % 2) * 110, y: Math.floor(index / 2) * 90, width: 100, height: 80, display: 'grid' }))
  assert.deepEqual(assertCoverageCardMatrix(records), records)
  assert.throws(
    () => assertCoverageCardMatrix(records.map((record, index) => (
      index === 0 ? { ...record, service: 'text' } : record
    ))),
    /service identity/,
  )
  assert.throws(
    () => assertCoverageCardMatrix(records.map((record, index) => (
      index === 1 ? { ...record, action_label: '\u542f\u7528\u9ed8\u8ba4' } : record
    ))),
    /action label/,
  )

  const layout = sourceFunction('assertCoverageLayout')
  assert.equal((layout.match(/evaluateAll\(/g) || []).length, 1)
  assert.doesNotMatch(layout, /boundingBox\(/)
  assert.match(layout, /grid\.scrollLeft/)
  assert.match(layout, /grid\.scrollTop/)
  assert.match(layout, /coverage-icon-/)
  assert.match(layout, /coverage-(?:default|configured|missing)/)
  assert.match(layout, /test-(?:failed|unknown|passed)/)
  assert.match(layout, /document\.querySelector\('\.el-dialog\.ai-config-workspace-dialog'\)/)
  assert.doesNotMatch(layout, /\.ai-config-workspace-dialog \.el-dialog/)
  assert.match(layout, /assertCoverageCardMatrix\(records\)/)
  assert.ok(layout.indexOf('evaluateAll(') < layout.indexOf('scrollIntoViewIfNeeded()'))
})

test('focused acceptance is called once before playback and is mandatory evidence with exact cleanup', () => {
  const mainSource = sourceFunction('main')
  assert.equal((mainSource.match(/verifyFocusedDesktopAcceptance\(/g) || []).length, 1)
  assert.ok(
    mainSource.indexOf('verifyDurableMedia(completedDrama, evidenceRecorder)')
      < mainSource.indexOf('verifyFocusedDesktopAcceptance(browser,'),
    'focused acceptance must run after durable media completion',
  )
  assert.ok(
    mainSource.indexOf('verifyFocusedDesktopAcceptance(browser,')
      < mainSource.indexOf('verifyCompletedUi(browser,'),
    'focused acceptance must run before expensive playback acceptance',
  )
  assert.doesNotMatch(mainSource, /verifyCompletedUi\([^\n]+FOCUSED_DESKTOP_VIEWPORT/)
  assert.doesNotMatch(mainSource, /verifyCompletedUi\([^\n]+AI_TWO_COLUMN_VIEWPORT/)
  assert.ok(
    mainSource.indexOf("registerCleanup(cleanupActions, 'temporary AI provider configs'")
      < mainSource.indexOf('verifyFocusedDesktopAcceptance(browser,'),
    'focused cleanup must be registered after the broad provider cleanup for LIFO execution',
  )

  const completeness = sourceFunction('assertCompleteEvidence')
  for (const required of [
    "focused.status, 'passed'",
    'FOCUSED_DESKTOP_VIEWPORT',
    'AI_TWO_COLUMN_VIEWPORT',
    'current_count, 1',
    "['image', 'video', 'text', 'tts', 'storyboard_image']",
    '[1, 1, 0, 1, 0]',
    "injected_failure_state, 'error'",
    "final_state, 'ready'",
    'provider_calls_unchanged, true',
    "component_overflow['1280x720']",
    "component_overflow['1024x768']",
    'REQUIRED_FINAL_CAPTURES.length',
    'routes_disposed',
    'listeners_disposed',
    'gate_disposed',
  ]) assert.match(completeness, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const focusedSource = sourceFunction('verifyFocusedDesktopAcceptance')
  assert.match(focusedSource, /exact_name_registered/)
  assert.match(focusedSource, /created_id_registered/)
  assert.match(focusedSource, /visible_config_removed/)
})

test('workflow worker drain waits until the backend explicitly reports false', async () => {
  const details = [{ worker_active: true }, { worker_active: false, status: 'cancelled' }]
  const requests = []
  const delays = []
  let now = 0

  const result = await waitForWorkflowWorkerDrain('run-1', {
    timeoutMs: 100,
    intervalMs: 10,
    request: async (pathname) => {
      requests.push(pathname)
      return details.shift()
    },
    delay: async (milliseconds) => {
      delays.push(milliseconds)
      now += milliseconds
    },
    clock: () => now,
  })

  assert.equal(result.worker_active, false)
  assert.deepEqual(requests, ['/workflows/run-1', '/workflows/run-1'])
  assert.deepEqual(delays, [10])
})

test('workflow worker drain fails closed when worker_active is absent', async () => {
  let now = 0
  await assert.rejects(
    waitForWorkflowWorkerDrain('run-missing', {
      timeoutMs: 20,
      intervalMs: 10,
      request: async () => ({ status: 'cancelled' }),
      delay: async (milliseconds) => { now += milliseconds },
      clock: () => now,
    }),
    /run-missing[\s\S]*worker_active[\s\S]*cancelled/,
  )
})

test('workflow worker drain reports its last state when the timeout expires', async () => {
  let now = 0
  await assert.rejects(
    waitForWorkflowWorkerDrain('run-stuck', {
      timeoutMs: 20,
      intervalMs: 10,
      request: async () => ({ worker_active: true, status: 'cancelled' }),
      delay: async (milliseconds) => { now += milliseconds },
      clock: () => now,
    }),
    /run-stuck[\s\S]*timed out[\s\S]*worker_active[\s\S]*true/,
  )
})

test('workflow worker drain aborts a hanging request within its total deadline', async () => {
  let requestCount = 0
  let aborted = false
  const lateRejection = new Error('request rejected after abort')
  const startedAt = Date.now()

  await assert.rejects(
    waitForWorkflowWorkerDrain('run-hanging', {
      timeoutMs: 30,
      request: (_pathname, { signal }) => new Promise((_resolve, reject) => {
        requestCount += 1
        signal.addEventListener('abort', () => {
          aborted = true
          reject(lateRejection)
        }, { once: true })
      }),
    }),
    /run-hanging[\s\S]*timed out/,
  )

  assert.equal(requestCount, 1)
  assert.equal(aborted, true)
  assert.ok(Date.now() - startedAt < 250, 'a hanging request must respect the total drain budget')
})

test('workflow worker drain does not request after its deadline', async () => {
  let requestCount = 0

  await assert.rejects(
    waitForWorkflowWorkerDrain('run-expired', {
      timeoutMs: 0,
      request: async () => {
        requestCount += 1
        return { worker_active: false }
      },
    }),
    /run-expired[\s\S]*timed out/,
  )

  assert.equal(requestCount, 0)
})

test('workflow worker drain propagates request failures before the deadline', async () => {
  const requestFailure = new Error('workflow detail unavailable')

  await assert.rejects(
    waitForWorkflowWorkerDrain('run-request-failure', {
      timeoutMs: 100,
      request: async () => { throw requestFailure },
    }),
    requestFailure,
  )
})

test('cancel-and-drain aborts a hanging current workflow GET within its total deadline', async () => {
  let requestCount = 0
  let aborted = false

  await assert.rejects(
    cancelAndWaitForWorkflowWorkerDrain('run-current-hanging', {
      timeoutMs: 30,
      request: (pathname, { signal }) => new Promise((_resolve, reject) => {
        requestCount += 1
        assert.equal(pathname, '/workflows/run-current-hanging')
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('current GET rejected after abort'))
        }, { once: true })
      }),
    }),
    /run-current-hanging[\s\S]*timed out/,
  )

  assert.equal(requestCount, 1)
  assert.equal(aborted, true)
})

test('cancel-and-drain aborts a hanging cancellation POST within its total deadline', async () => {
  const paths = []
  let cancelAborted = false

  await assert.rejects(
    cancelAndWaitForWorkflowWorkerDrain('run-cancel-hanging', {
      timeoutMs: 30,
      request: (pathname, { signal, ...options }) => {
        paths.push({ pathname, options })
        if (!pathname.endsWith('/cancel')) return Promise.resolve({ status: 'processing' })
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelAborted = true
            reject(new Error('cancel POST rejected after abort'))
          }, { once: true })
        })
      },
    }),
    /run-cancel-hanging[\s\S]*timed out/,
  )

  assert.deepEqual(paths.map(({ pathname }) => pathname), [
    '/workflows/run-cancel-hanging',
    '/workflows/run-cancel-hanging/cancel',
  ])
  assert.equal(paths[1].options.method, 'POST')
  assert.equal(cancelAborted, true)
})

test('cancel-and-drain gives the cancellation POST only the shared deadline remainder', async () => {
  let now = 0
  const paths = []
  let cancelAborted = false
  const startedAt = Date.now()

  await assert.rejects(
    cancelAndWaitForWorkflowWorkerDrain('run-shared-deadline', {
      timeoutMs: 1000,
      clock: () => now,
      request: (pathname, { signal }) => {
        paths.push(pathname)
        if (paths.length === 1) {
          now = 900
          return Promise.resolve({ status: 'processing' })
        }
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelAborted = true
            reject(new Error('cancel POST rejected after shared deadline'))
          }, { once: true })
        })
      },
    }),
    /run-shared-deadline[\s\S]*timed out/,
  )

  assert.deepEqual(paths, [
    '/workflows/run-shared-deadline',
    '/workflows/run-shared-deadline/cancel',
  ])
  assert.equal(cancelAborted, true)
  assert.ok(Date.now() - startedAt < 500, 'cancel POST must receive only the original deadline remainder')
})

test('cancel-and-drain does not call an API after its deadline', async () => {
  let requestCount = 0

  await assert.rejects(
    cancelAndWaitForWorkflowWorkerDrain('run-cancel-expired', {
      timeoutMs: 0,
      request: async () => {
        requestCount += 1
        return { status: 'completed', worker_active: false }
      },
    }),
    /run-cancel-expired[\s\S]*timed out/,
  )

  assert.equal(requestCount, 0)
})

test('E2E API retry aborts its backoff without another request', async () => {
  const controller = new AbortController()
  let calls = 0
  const startedAt = Date.now()
  const retry = fetchWithIdempotentRetry('http://example.test/abort', { signal: controller.signal }, async () => {
    calls += 1
    throw new TypeError('transient socket close')
  })
  setTimeout(() => controller.abort(), 10)

  await assert.rejects(retry, (error) => error?.name === 'AbortError')
  assert.equal(calls, 1)
  assert.ok(Date.now() - startedAt < 80, 'abort must clear the pending retry timer')
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(calls, 1)
})

test('workflow cleanup blocks provider restore and fixture purge after a drain failure', async () => {
  const prerequisite = createWorkflowDrainPrerequisite()
  let restoreCalls = 0
  let purgeCalls = 0
  const failures = await runCleanup([
    {
      label: 'hard purge fixture',
      run: async () => {
        prerequisite.assertDrained()
        purgeCalls += 1
      },
    },
    {
      label: 'restore provider configs',
      run: async () => {
        prerequisite.assertDrained()
        restoreCalls += 1
      },
    },
    {
      label: 'drain workflow',
      run: () => prerequisite.drain('run-drain-failure', async () => {
        throw new Error('worker drain failed')
      }),
    },
  ], { warn() {} })

  assert.equal(restoreCalls, 0)
  assert.equal(purgeCalls, 0)
  assert.equal(failures.length, 3)
  assert.deepEqual(failures.map(({ label }) => label), [
    'drain workflow',
    'restore provider configs',
    'hard purge fixture',
  ])

  const cancellationPrerequisite = createWorkflowDrainPrerequisite()
  let cancellationRestoreCalls = 0
  let cancellationPurgeCalls = 0
  const cancellationFailures = await runCleanup([
    {
      label: 'hard purge after cancellation failure',
      run: async () => {
        cancellationPrerequisite.assertDrained()
        cancellationPurgeCalls += 1
      },
    },
    {
      label: 'restore after cancellation failure',
      run: async () => {
        cancellationPrerequisite.assertDrained()
        cancellationRestoreCalls += 1
      },
    },
    {
      label: 'cancel before drain',
      run: () => cancellationPrerequisite.drain('run-cancel-failure', async () => {
        throw new Error('cancel request failed')
      }),
    },
  ], { warn() {} })

  assert.equal(cancellationRestoreCalls, 0)
  assert.equal(cancellationPurgeCalls, 0)
  assert.equal(cancellationFailures.length, 3)
})

test('workflow cleanup drains both workers before provider restore and fixture purge', () => {
  const mainSource = sourceFunction('main')
  assertSourceOrder(mainSource, [
    "registerCleanup(cleanupActions, 'temporary AI provider configs'",
    'registerCleanup(cleanupActions, `cancel draft workflow ${draftWorkflowRun.id}`',
    'await workflowDrainPrerequisite.drain(draftWorkflowRun.id, cancelAndWaitForWorkflowWorkerDrain)',
    'registerCleanup(cleanupActions, `cancel workflow ${workflowRun.id}`',
    'await workflowDrainPrerequisite.drain(workflowRun.id, cancelAndWaitForWorkflowWorkerDrain)',
  ])
  const providerRestore = mainSource.indexOf("registerCleanup(cleanupActions, 'temporary AI provider configs'")
  const fixturePurge = mainSource.indexOf('registerCleanup(cleanupActions, `hard purge drama ${drama.id}`')
  const draftCleanup = mainSource.indexOf('registerCleanup(cleanupActions, `cancel draft workflow ${draftWorkflowRun.id}`')
  const productionCleanup = mainSource.indexOf('registerCleanup(cleanupActions, `cancel workflow ${workflowRun.id}`')
  assert.ok(productionCleanup > draftCleanup, 'production cleanup must run before draft cleanup in reverse order')
  assert.ok(draftCleanup > providerRestore, 'draft cleanup must drain before provider restoration in reverse order')
  assert.ok(providerRestore > fixturePurge, 'provider restoration must precede fixture purge in reverse order')
  assert.match(
    mainSource.slice(fixturePurge, providerRestore),
    /workflowDrainPrerequisite\.assertDrained\(\)/,
    'hard-purge callback must carry its own drain guard',
  )
  assert.match(
    mainSource.slice(providerRestore, draftCleanup),
    /workflowDrainPrerequisite\.assertDrained\(\)/,
    'Provider-restore callback must carry its own drain guard',
  )
})

test('same-SHA acceptance captures reuse the final matrix and production E2E chains both final verifiers', () => {
  assert.equal(
    frontendPackage.scripts['e2e:production:raw'],
    'node scripts/e2e-production.cjs',
  )
  assert.equal(
    frontendPackage.scripts['e2e:production'],
    'npm run e2e:production:raw && npm run verify:acceptance-report:final && npm run e2e:free-canvas && npm run verify:free-canvas-evidence',
  )

  const captures = sourceFunction('captureAcceptanceReportScreenshots')
  assert.match(captures, /REQUIRED_FINAL_CAPTURES/)
  assert.match(captures, /inspectPng\(buffer/)
  assert.match(captures, /fullPage:\s*false/)
  assert.match(captures, /capture\.theme/)
  assert.match(captures, /capture\.surface/)
  assert.match(captures, /crypto\.createHash\('sha256'\)/)
  assert.doesNotMatch(captures, /\.play\(|verifyPlayableVideo|api[_-]?key|base[_-]?url/i)
  assert.doesNotMatch(captures, /preparedSurface/)
  assertSourceOrder(captures, [
    'prepareAcceptanceCaptureSurface(page, capture, fixture)',
    'assertScreenshotSurfaceSafe(page)',
    'page.screenshot',
  ])
  const capturePreparation = sourceFunction('prepareAcceptanceCaptureSurface')
  assertSourceOrder(capturePreparation, [
    'page.goto',
    "workspaceDialog.waitFor({ state: 'hidden'",
    'setEvidenceTheme(page, capture.theme)',
    "page.locator('.btn-ai-config').click()",
  ])
  assert.match(capturePreparation, /data-state=\"ready\"/)

  const manifest = sourceFunction('writeAcceptanceManifest')
  assertSourceOrder(manifest, [
    "evidence.status, 'passed'",
    "evidence.source.commit",
    "crypto.createHash('sha256').update(evidenceBytes)",
    "schema: 'localminidrama.acceptance-screenshot-manifest.v1'",
    "path: '../evidence.json'",
    'manifest.json.tmp',
    'fs.rename',
  ])

  const mainSource = sourceFunction('main')
  assert.ok(
    mainSource.indexOf('const finalEvidence = await evidenceRecorder.pass()')
      < mainSource.indexOf('writeAcceptanceManifest('),
    'manifest must be written only after final passed evidence is persisted',
  )
})

test('evidence reruns remove only the exact confined acceptance-report child', async (t) => {
  const recorder = sourceFunction('createEvidenceRecorder')
  assertSourceOrder(recorder, [
    'fs.mkdir(root, { recursive: true })',
    'resetAcceptanceReportArtifacts(root)',
    "fs.writeFile(logPath, '', 'utf8')",
  ])

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'localminidrama-e2e-rerun-'))
  const evidenceRoot = path.join(fixtureRoot, 'artifacts', 'e2e-production')
  const acceptanceRoot = path.join(evidenceRoot, 'acceptance-report')
  const outsideRoot = path.join(fixtureRoot, 'outside')
  try {
    await mkdir(path.join(acceptanceRoot, 'screenshots'), { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await Promise.all([
      writeFile(path.join(acceptanceRoot, 'manifest.json'), 'stale'),
      writeFile(path.join(evidenceRoot, 'evidence.json'), 'keep evidence'),
      writeFile(path.join(evidenceRoot, 'run.log'), 'keep log'),
      writeFile(path.join(evidenceRoot, 'sibling.txt'), 'keep sibling'),
      writeFile(path.join(outsideRoot, 'outside.txt'), 'keep outside'),
    ])
    await resetAcceptanceReportArtifacts(evidenceRoot)
    await assert.rejects(lstat(acceptanceRoot), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(evidenceRoot, 'evidence.json'), 'utf8'), 'keep evidence')
    assert.equal(await readFile(path.join(evidenceRoot, 'run.log'), 'utf8'), 'keep log')
    assert.equal(await readFile(path.join(evidenceRoot, 'sibling.txt'), 'utf8'), 'keep sibling')

    try {
      await symlink(outsideRoot, acceptanceRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.diagnostic('directory link creation is not permitted on this host')
        return
      }
      throw error
    }
    await resetAcceptanceReportArtifacts(evidenceRoot)
    await assert.rejects(lstat(acceptanceRoot), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(outsideRoot, 'outside.txt'), 'utf8'), 'keep outside')
  } finally {
    await removeFixtureTree(fixtureRoot, { force: true })
  }
})

test('browser acceptance contract covers the full UI journey, recovery, downloads, viewports, and playback', () => {
  assert.deepEqual(DESKTOP_VIEWPORTS, [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
  ])
  assert.match(productionSource, /startDraftFromUi\(startPage, drama\.id\)/)
  assert.match(productionSource, /assertDraftPlaceholderState\(drama\.id\)/)
  assert.match(productionSource, /verifyDraftUpgradeUi\(startPage, drama\.id\)/)
  assert.ok(
    productionSource.indexOf('startDraftFromUi(startPage, drama.id)')
      < productionSource.indexOf('providerState = await installProviderConfigs(stamp)'),
    'Draft must complete before temporary Production providers are installed',
  )
  assert.match(productionSource, /startProductionFromUi\(startPage, drama\.id\)/)
  assert.match(productionSource, /verifyProjectListRecoveryUi\(recoveryPage\)/)
  assert.match(productionSource, /assertOnlyInjectedRecoveryErrors\(recoveryAudit\)/)
  assert.doesNotMatch(productionSource, /verifyProjectListRecoveryUi\(startPage\)/)
  assert.match(productionSource, /verifyAiConfigurationUi\(startPage\)/)
  assert.match(productionSource, /provider:\s*'openai_compatible'/)
  assert.match(productionSource, /api_protocol:\s*'openai'/)
  assert.match(productionSource, /allow_local_http:\s*true/)
  assert.match(productionSource, /is_default:\s*false/)
  assert.match(productionSource, /providerOptions:\s*PROVIDER_SELECTION_OPTIONS/)
  assert.match(productionSource, /postData:\s*JSON\.stringify\(\{[\s\S]*options:\s*\{ \...\(requestBody\.options \|\| \{\}\), \...providerOptions \}/)
  assert.doesNotMatch(productionSource, /previousDefaults/)
  assert.match(productionSource, /userDefaultsMutated:\s*false/)
  assert.doesNotMatch(productionSource, /5\/5 \\u7c7b\\u5df2\\u914d\\u7f6e/)
  assert.match(productionSource, /createDramaFromUi\(startPage/)
  assert.match(productionSource, /metadata:\s*\{\s*\.\.\.\(requestBody\.metadata \|\| \{\}\), e2e: true \}/)
  assert.match(productionSource, /fixtureClaimInjected, true/)
  assert.match(productionSource, /new URL\(page\.url\(\)\)\.hash,[\s\S]*#source-intake-workflow/)
  assert.match(productionSource, /async function verifyAiConfigReturnUi\(page, dramaId\)/)
  assert.match(productionSource, /verifyAiConfigReturnUi\(startPage, drama\.id\)/)
  assert.match(productionSource, /return_to_preserved: new URL\(page\.url\(\)\)\.hash === '#source-intake-workflow'/)
  assert.match(productionSource, /importSourceFromUi\(startPage, drama\.id/)
  assert.match(productionSource, /importOnly:\s*'\\u5bfc\\u5165\\u6545\\u4e8b\\u7d20\\u6750'/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.importOnly, exact: true \}\)\.click\(\)/)
  assert.match(productionSource, /verifyFinalVideoDownloadUi\(page, evidenceRecorder\)/)
  assert.match(productionSource, /verifyProjectExportUi\(startPage, fixtureTitle, evidenceRecorder\)/)
  assert.ok(
    productionSource.indexOf('verifyDurableMedia(completedDrama, evidenceRecorder)')
      < productionSource.indexOf('verifyProjectExportUi(startPage, fixtureTitle, evidenceRecorder)'),
    'durable media evidence must be persisted before browser export validation',
  )
  assert.ok(
    productionSource.indexOf('verifyProjectExportUi(startPage, fixtureTitle, evidenceRecorder)')
      < productionSource.indexOf('verifyExport(drama.id, evidenceRecorder)'),
    'browser playback and export must run before the redundant API export validation',
  )
  assert.doesNotMatch(productionSource, /apiRequest\('\/dramas', \{\s*method: 'POST'/)
  assert.match(productionSource, /message\.type\(\) === 'error'/)
  assert.match(productionSource, /rootScrollWidth <= result\.rootClientWidth \+ 1/)
  assert.match(productionSource, /deliveryExport:\s*'\\u4ea4\\u4ed8\\u4e0e\\u5bfc\\u51fa'/)
  assert.match(productionSource, /filter\(\{ hasText: UI\.deliveryExport \}\)\.click\(\)/)
  assert.doesNotMatch(productionSource, /compositeVideo/)
  assert.match(productionSource, /await video\.play\(\)/)
  assert.match(productionSource, /video\.addEventListener\('ended'/)
  assert.match(productionSource, /unicode_path: unicodePath/)
  assert.match(productionSource, /E2E_TITLE_PREFIX\}\u4e2d\u6587\u8def\u5f84 \$\{stamp\}/)
  assert.match(productionSource, /verifyPlayableVideo\(page\.locator\('\.sb-video-player'\)\.first\(\)/)
  assert.doesNotMatch(productionSource, /verifyPlayableVideo\(page\.locator\('\.sb-video-thumb-player'\)/)
  assert.match(productionSource, /persistBrowserPlayback\(evidenceRecorder, viewport, composedVideo, storyboardVideo\)/)
  assert.match(productionSource, /project_export:\s*\{\s*status: 'failed',\s*validated: false,/)
  assert.match(productionSource, /getByText\(`\$\{expectedTrackCount\} \\u8f68`/)
  assert.match(productionSource, /expectedTrackCount: timelineEvidence\.tracks/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.continueImport/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.enterProduction/)
  assert.match(productionSource, /getByTestId\('source-workflow-complete'\)/)
  assert.match(productionSource, /completion\.getByRole\('button', \{ name: UI\.enterProduction, exact: true \}\)/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.workflowHistory, exact: true \}\)/)
  assert.match(productionSource, /flowStepButton\(workflow, UI\.intakeStep\)/)
  assert.match(productionSource, /getByRole\('radiogroup', \{[\s\S]*?name: '\\u5de5\\u4f5c\\u6d41\\u542f\\u52a8\\u6a21\\u5f0f'/)
  assert.match(productionSource, /modeGroup\.getByText\(modeLabel, \{ exact: true \}\)\.click\(\)/)
  assert.doesNotMatch(productionSource, /modeRadio\.check\(\)/)
})

test('production evidence artifacts stay ignored and release CI always uploads evidence plus failure logs', () => {
  assert.match(gitignoreSource, /^artifacts\/$/m)
  assert.match(releaseWorkflow, /Run production workflow, QA, timeline, export and browser checks[\s\S]*?if:\s*always\(\)/)
  assert.match(releaseWorkflow, /Capture container logs on failure[\s\S]*?if:\s*failure\(\)/)
  assert.match(releaseWorkflow, /Upload production E2E evidence[\s\S]*?if:\s*always\(\)/)
  assert.match(releaseWorkflow, /path:\s*\|[\s\S]*?artifacts\/e2e-production\/[\s\S]*?docker-release-e2e\.log/)
})

test('main CI always runs production E2E and uploads the complete sanitized evidence directory', () => {
  assert.match(
    ciWorkflow,
    /- name: Run full production workflow, QA, timeline, export and browser checks\s+if:\s*always\(\)\s+run:\s*npm run verify:e2e/,
  )
  assert.match(
    ciWorkflow,
    /- name: Capture container logs on failure[\s\S]*?if:\s*failure\(\)[\s\S]*?--sanitize-log > artifacts\/e2e-production\/docker-e2e\.log/,
  )
  assert.match(
    ciWorkflow,
    /- name: Upload production E2E evidence\s+if:\s*always\(\)[\s\S]*?path:\s*artifacts\/e2e-production\/[\s\S]*?if-no-files-found:\s*error/,
  )
  assert.doesNotMatch(ciWorkflow, /logs --no-color > docker-e2e\.log/)
})

test('production frontend image installs build tooling but compiles the production runtime', () => {
  assert.match(productionDockerfile, /npm ci --include=dev --no-audit/)
  assert.match(productionDockerfile, /ENV NODE_ENV=production\s+RUN npm run build/)
  assert.doesNotMatch(productionDockerfile, /ENV NODE_ENV=development/)
})

test('production frontend build copies only the Vite runtime instance helper from the backend', () => {
  assert.match(
    productionDockerfile,
    /COPY backend-node\/src\/utils\/runtimeInstanceId\.js \/backend-node\/src\/utils\/runtimeInstanceId\.js/,
  )
})

test('focused desktop coverage contract keeps five cards readable in four 1280px columns', () => {
  assert.match(productionSource, /viewport: FOCUSED_DESKTOP_VIEWPORT,[\s\S]*?columns: 4,[\s\S]*?minimumCardWidth: 220/)
  assert.match(productionSource, /assertCoverageLayout\(page, \{[\s\S]*?viewport: AI_TWO_COLUMN_VIEWPORT,[\s\S]*?columns: 2/)
  assert.match(productionSource, /coverage_layout:\s*\{[\s\S]*?columns_at_1280:[\s\S]*?minimum_card_width:[\s\S]*?visible_card_count:[\s\S]*?horizontal_overflow:[\s\S]*?columns_at_1024:/)
})

test('frontend verification image provides Git for acceptance verifier repositories', () => {
  assert.match(
    verificationDockerfile,
    /apt-get update[\s\S]*apt-get install -y --no-install-recommends git[\s\S]*rm -rf \/var\/lib\/apt\/lists\/\*/,
  )
})

test('frontend verification image preserves tracked report repository paths', () => {
  assert.match(verificationDockerfile, /COPY docs \/docs/)
  assert.match(verificationDockerfile, /COPY frontweb\/public \/frontweb\/public/)
})

test('frontend verification image includes Vite runtime scope support and Chromium for browser behavior tests', () => {
  assert.match(
    verificationDockerfile,
    /COPY backend-node\/src\/utils\/runtimeInstanceId\.js \/backend-node\/src\/utils\/runtimeInstanceId\.js/,
  )
  assert.match(verificationDockerfile, /npx playwright install --with-deps chromium/)
  assert.match(verificationDockerfile, /ENV PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/)
})

test('frontend verification image includes the real route-loading browser fixture', () => {
  assert.match(verificationDockerfile, /COPY frontweb\/browser-fixtures \.\/browser-fixtures/)
})

test('production proxy fails unavailable upstream connections quickly without shortening generation reads', () => {
  assert.equal((productionNginxConfig.match(/proxy_connect_timeout 5s;/g) || []).length, 2)
  assert.equal((productionNginxConfig.match(/proxy_read_timeout 600s;/g) || []).length, 2)
  assert.match(productionNginxConfig, /location \/api\/[\s\S]*proxy_send_timeout 600s;/)
})

test('production images pin reviewed bases and the frontend runs without root', () => {
  const digestPattern = /@sha256:[a-f0-9]{64}/
  assert.match(productionDockerfile, /FROM node:20-bookworm-slim@sha256:/)
  assert.match(productionDockerfile, /FROM nginxinc\/nginx-unprivileged:1\.29-alpine@sha256:/)
  assert.match(productionDockerfile, /USER root\s+RUN apk upgrade --no-cache/)
  assert.match(productionDockerfile, /\nUSER 101\s*\n/)
  assert.match(verificationDockerfile, /RUN chown -R node:node \/app\s+USER node/)
  assert.match(verificationDockerfile, /USER node[\s\S]*CMD \["npm", "run", "dev"/)
  assert.match(productionDockerfile, digestPattern)
  assert.match(backendDockerfile, /FROM node:20-bookworm-slim@sha256:/)
  assert.match(backendDockerfile, /apt-get upgrade -y --no-install-recommends/)
  assert.match(backendDockerfile, /FROM runtime AS production[\s\S]*rm -rf \/usr\/local\/lib\/node_modules\/npm/)
  assert.match(backendDockerfile, digestPattern)
  assert.doesNotMatch(productionDockerfile, /FROM nginx:/)
})

test('backend container gives Node PID 1 and uses a stable maintenance lease scope', () => {
  assert.match(backendDockerfile, /CMD \["node", "src\/server\.js"\]/)
  assert.doesNotMatch(backendDockerfile, /CMD \["npm", "start"\]/)
  assert.match(backendDockerfile, /FROM runtime AS verification/)
  assert.match(backendDockerfile, /COPY --chown=node:node backend-node\/test \.\/test/)
  assert.match(backendDockerfile, /FROM runtime AS production[\s\S]*CMD \["node", "src\/server\.js"\]/)
  assert.match(backendEntrypoint, /exec setpriv --reuid=node --regid=node --init-groups -- "\$@"/)
  assert.doesNotMatch(backendEntrypoint, /exec runuser/)
  assert.match(
    composeSource,
    /LOCALMINIDRAMA_MAINTENANCE_SCOPE:\s*localminidrama-docker-backend/,
  )
  assert.match(composeSource, /backend-verify:[\s\S]*target:\s*verification/)
  assert.match(composeSource, /frontend-verify:[\s\S]*NODE_ENV:\s*production/)
})
