import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createProviderServer } = require('../../backend-node/scripts/e2e-provider.js')
const { REQUIRED_FINAL_CAPTURES } = require('../scripts/acceptance-report-contract.cjs')
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
  createEvidenceRecorder,
  assertProductionTimeline,
  assertProviderInvocations,
  assertProviderStats,
  extractZipEntries,
  fetchWithIdempotentRetry,
  focusedAiRouteAction,
  main: runProductionE2e,
  resetAcceptanceReportArtifacts,
  sanitizeEvidenceText,
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

function focusedAcceptanceEvidence() {
  return {
    status: 'passed',
    primary_viewport: { width: 1280, height: 720 },
    ai_two_column_viewport: { width: 1024, height: 768 },
    project: { id: 1, title: 'Focused fixture' },
    episode: { id: 1, label: '\u7b2c 1 \u96c6' },
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
      service_order: ['video', 'image', 'text', 'tts', 'storyboard_image'],
      action_counts: [1, 1, 0, 1, 0],
      mutation: { method: 'POST', service_type: 'text', created_id: 99, is_default: false },
      configuration_feedback_observed: true,
      native_close_focus_restored: true,
      custom_return_focus_restored: true,
      columns_1280: 5,
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
    await rm(fixtureRoot, { recursive: true, force: true })
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
    await recorder.fail(new Error(`Authorization: Bearer ${protectedValue}; credential=${protectedValue}`))

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
    await rm(fixtureRoot, { recursive: true, force: true })
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
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
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
    await rm(fixtureRoot, { recursive: true, force: true })
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

test('production E2E verifies service-specific AI config return routes in config management', () => {
  const aiConfigReturn = sourceFunction('verifyAiConfigReturnUi')
  assertSourceOrder(aiConfigReturn, [
    'service_type=text',
    "page.getByTestId('ai-config-mode-configs')",
    "await configsMode.waitFor({ state: 'visible', timeout: 30000 })",
    "assert.equal(await configsMode.getAttribute('aria-selected'), 'true'",
    "await page.locator('.config-list-section').waitFor({ state: 'visible', timeout: 30000 })",
    "page.getByRole('button', { name: '\\u8fd4\\u56de\\u539f\\u9879\\u76ee', exact: true })",
    "await backButton.waitFor({ state: 'visible', timeout: 10000 })",
    'const navigationPromise = page.waitForURL',
    'await backButton.click()',
    'await navigationPromise',
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
    "page.locator('.project-card')",
    'UI.openStoryMaterials',
    "storyEntry.press('Enter')",
    "#source-intake-workflow",
    "getByTestId('source-workflow-complete')",
    'UI.enterProduction',
    "page.locator('.page-title')",
    "getByRole('combobox', { name: UI.currentEpisode",
    "page.locator('#film-create-quick-nav [aria-current=\"step\"]')",
    ".status-done:not(.is-current)",
    "getByTestId('film-pipeline-action')",
  ])
  assert.doesNotMatch(
    focused,
    /verifyPlayableVideo|\.play\(|verifyFinalVideoDownloadUi|verifyProjectExportUi|startProductionFromUi|startDraftFromUi/,
  )
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
    'columns: 5',
    'layout1280.cards.map',
    'assertComponentHorizontalOverflow',
    'minimumTargetSize: 32',
    'assertWorkbenchFocus',
    'UI.configureMissingService',
    'createMissingServiceFromUi',
    'UI.returnToProduction',
    'UI.configurationRechecking',
    "data-state=\"checking\"",
    'readinessGate.release(503)',
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
  assert.match(focused, /finally\s*\{/)
})

test('focused coverage geometry uses one normalized DOM snapshot and validates service identity', () => {
  const records = [
    { service: 'video', label: '\u89c6\u9891\u751f\u6210', state: 'default', test_status: 'failed', action_count: 1, action_label: '\u91cd\u65b0\u6d4b\u8bd5' },
    { service: 'image', label: '\u7d20\u6750\u56fe\u7247', state: 'configured', test_status: 'unknown', action_count: 1, action_label: '\u8865\u9f50\u9ed8\u8ba4' },
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
    "['video', 'image', 'text', 'tts', 'storyboard_image']",
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

test('same-SHA acceptance captures reuse the final matrix and raw E2E chains the final verifier', () => {
  assert.equal(
    frontendPackage.scripts['e2e:production:raw'],
    'node scripts/e2e-production.cjs',
  )
  assert.equal(
    frontendPackage.scripts['e2e:production'],
    'npm run e2e:production:raw && npm run verify:acceptance-report:final',
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
    await rm(fixtureRoot, { recursive: true, force: true })
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
      < productionSource.indexOf('const providerState = await installProviderConfigs(stamp)'),
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
