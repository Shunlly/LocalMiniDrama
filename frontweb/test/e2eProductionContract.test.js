import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createProviderServer } = require('../../backend-node/scripts/e2e-provider.js')
const {
  DESKTOP_VIEWPORTS,
  EVIDENCE_SCHEMA,
  REQUIRED_PROVIDER_ENDPOINTS,
  REQUIRED_PROVIDER_TYPES,
  REQUIRED_TRACK_TYPES,
  assertCompleteEvidence,
  createEvidenceRecorder,
  assertProductionTimeline,
  assertProviderInvocations,
  assertProviderStats,
  extractZipEntries,
  fetchWithIdempotentRetry,
  main: runProductionE2e,
  sanitizeEvidenceText,
} = require('../scripts/e2e-production.cjs')
const productionSource = readFileSync(new URL('../scripts/e2e-production.cjs', import.meta.url), 'utf8')
const verificationDockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const productionDockerfile = readFileSync(new URL('../Dockerfile.prod', import.meta.url), 'utf8')
const backendDockerfile = readFileSync(new URL('../../backend-node/Dockerfile', import.meta.url), 'utf8')
const backendEntrypoint = readFileSync(new URL('../../backend-node/docker-entrypoint.sh', import.meta.url), 'utf8')
const composeSource = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')
const ciWorkflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const releaseWorkflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
const gitignoreSource = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')

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
        playback: DESKTOP_VIEWPORTS.map((viewport) => ({
          viewport,
          composed: { played: true },
          storyboard: { played: true },
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
  assert.match(productionSource, /importSourceFromUi\(startPage, drama\.id/)
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
  assert.match(productionSource, /await video\.play\(\)/)
  assert.match(productionSource, /verifyPlayableVideo\(page\.locator\('\.sb-video-player'\)\.first\(\)/)
  assert.doesNotMatch(productionSource, /verifyPlayableVideo\(page\.locator\('\.sb-video-thumb-player'\)/)
  assert.match(productionSource, /persistBrowserPlayback\(evidenceRecorder, viewport, composedVideo, storyboardVideo\)/)
  assert.match(productionSource, /project_export:\s*\{\s*status: 'failed',\s*validated: false,/)
  assert.match(productionSource, /getByText\(`\$\{expectedTrackCount\} \\u8f68`/)
  assert.match(productionSource, /expectedTrackCount: timelineEvidence\.tracks/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.continueImport/)
  assert.match(productionSource, /getByRole\('button', \{ name: UI\.enterProduction/)
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
