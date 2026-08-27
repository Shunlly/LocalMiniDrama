const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require('playwright')

const smokeHelpers = require('./e2e-smoke.cjs')
const { inspectPng } = require('./acceptance-report-contract.cjs')
const { removeFixtureTree } = require('./fixture-cleanup.cjs')
const { REQUIRED_CAPTURES } = require('./verify-free-canvas-evidence.cjs')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const PRODUCTION_EVIDENCE_ROOT = path.join(PROJECT_ROOT, 'artifacts', 'e2e-production')
const ACCEPTANCE_ROOT = path.join(PRODUCTION_EVIDENCE_ROOT, 'free-canvas')
const E2E_TITLE_PREFIX = smokeHelpers.E2E_TITLE_PREFIX
const E2E_SUITE = 'free-canvas'
const DEFAULT_TIMEOUT_MS = Number(process.env.E2E_FREE_CANVAS_TIMEOUT_MS) || 30000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const REQUIRED_STEP_NAMES = Object.freeze([
  'connected_to_local_services',
  'created_primary_fixture_data',
  'opened_existing_project_canvas',
  'switched_to_free_mode',
  'created_and_edited_text_node',
  'created_image_and_video_nodes',
  'keyboard_activated_free_node',
  'created_config_node_and_connection',
  'marquee_selected_exact_nodes',
  'copied_and_pasted_subgraph',
  'verified_delete_undo_redo',
  'verified_missing_configuration',
  'recovered_canvas_save',
  'rejected_unsafe_upload',
  'created_and_converted_production_reference',
  'converted_storyboard_reference',
  'verified_project_isolation',
  'verified_persistence_after_refresh',
  'captured_acceptance_screenshots',
  'cleanup',
])
const SENSITIVE_TEXT_PATTERNS = [
  /authorization\s*[:=]\s*(?:bearer\s+)?\S+/gi,
  /bearer\s+\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /password\s*[:=]\s*\S+/gi,
  /credential(?:s)?\s*[:=]\s*\S+/gi,
  /response\s*=\s*\{[^}]*\}/gi,
]
const UPLOAD_FAILURE_MESSAGE = 'E2E 素材上传已安全拒绝'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function normalizeServiceUrl(value, label, allowRemote) {
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    throw new Error(`${label} must be an absolute HTTP URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTP URL without credentials`)
  }
  if (parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error(`${label} must be an origin without a path, query, or fragment`)
  }
  if (!allowRemote && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must use a loopback host unless E2E_ALLOW_REMOTE_SERVICES=1`)
  }
  return parsed.origin
}

function resolveServiceUrls(env = process.env) {
  const allowRemote = env.E2E_ALLOW_REMOTE_SERVICES === '1'
  const frontendUrl = normalizeServiceUrl(
    env.FRONTEND_URL || 'http://127.0.0.1:3013',
    'FRONTEND_URL',
    allowRemote,
  )
  const backendUrl = normalizeServiceUrl(
    env.BACKEND_URL || 'http://127.0.0.1:5679',
    'BACKEND_URL',
    allowRemote,
  )
  return { frontendUrl, backendUrl, frontendOrigin: new URL(frontendUrl).origin }
}

const SERVICES = resolveServiceUrls(process.env)

function buildRequestHeaders(input, frontendOrigin) {
  const headers = {}
  new Headers(input || {}).forEach((value, key) => {
    if (!['origin', 'content-type'].includes(key.toLowerCase())) headers[key] = value
  })
  headers['Content-Type'] = 'application/json'
  headers.Origin = frontendOrigin
  return headers
}

async function fetchApi(baseUrl, pathname, options = {}, fetchImpl = fetch, frontendOrigin = SERVICES.frontendOrigin) {
  const response = await fetchImpl(`${baseUrl}/api/v1${pathname}`, {
    ...options,
    headers: buildRequestHeaders(options.headers, frontendOrigin),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const method = String(options.method || 'GET').toUpperCase()
    const safePath = String(pathname).split('?', 1)[0]
    throw new Error(`API request failed: ${method} ${safePath} (HTTP ${response.status})`)
  }
  return body.data
}

async function apiFetch(pathname, options = {}, fetchImpl = fetch, services = SERVICES) {
  return fetchApi(services.backendUrl, pathname, options, fetchImpl, services.frontendOrigin)
}

async function frontendApiFetch(pathname, options = {}, fetchImpl = fetch, services = SERVICES) {
  return fetchApi(services.frontendUrl, pathname, options, fetchImpl, services.frontendOrigin)
}

function buildBrowserLaunchOptions() {
  const options = { headless: process.env.HEADED !== '1' }
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  else if (process.env.PLAYWRIGHT_CHANNEL) options.channel = process.env.PLAYWRIGHT_CHANNEL
  else if (process.platform === 'win32') options.channel = 'msedge'
  return options
}

function parseMetadata(drama) {
  if (!drama?.metadata) return {}
  if (typeof drama.metadata === 'object') return drama.metadata
  try {
    return JSON.parse(drama.metadata)
  } catch (_) {
    return {}
  }
}

function assertFixtureRecord(drama, { dramaId, expectedTitle, source }) {
  assert.equal(Number(drama?.id), Number(dramaId), `${source} fixture id does not match`)
  assert.equal(drama?.title, expectedTitle, `${source} fixture title does not match`)
  const metadata = parseMetadata(drama)
  assert.equal(metadata.e2e, true, `${source} fixture is missing the E2E marker`)
  assert.equal(metadata.e2e_suite, E2E_SUITE, `${source} fixture suite does not match`)
}

function paginatedItems(value) {
  if (Array.isArray(value)) return value
  return Array.isArray(value?.items) ? value.items : []
}

async function assertFixtureIdentity({ apiRequest, frontendApiRequest: frontendRequest, dramaId, expectedTitle }) {
  assert.ok(Number.isSafeInteger(Number(dramaId)) && Number(dramaId) > 0, 'fixture id must be a positive integer')
  assert.ok(String(expectedTitle || '').startsWith(E2E_TITLE_PREFIX), 'fixture title must use the guarded E2E prefix')
  const [backendDrama, frontendDrama, frontendMatches] = await Promise.all([
    apiRequest(`/dramas/${dramaId}`),
    frontendRequest(`/dramas/${dramaId}`),
    frontendRequest(`/dramas?keyword=${encodeURIComponent(expectedTitle)}&page=1&page_size=100`),
  ])
  assertFixtureRecord(backendDrama, { dramaId, expectedTitle, source: 'backend' })
  assertFixtureRecord(frontendDrama, { dramaId, expectedTitle, source: 'frontend proxy' })
  const items = paginatedItems(frontendMatches)
  const total = Number(frontendMatches?.pagination?.total ?? items.length)
  assert.ok(Number.isSafeInteger(total) && total <= items.length, 'frontend fixture search must not be truncated')
  const exactMatches = items.filter((item) => item?.title === expectedTitle)
  assert.equal(exactMatches.length, 1, 'frontend proxy must expose exactly one fixture title')
  assertFixtureRecord(exactMatches[0], { dramaId, expectedTitle, source: 'frontend fixture list' })
  return frontendDrama
}

async function createFixture(apiRequest, stamp = Date.now(), role = 'primary') {
  const uniqueSuffix = crypto.randomBytes(6).toString('hex')
  const safeRole = role === 'isolation' ? 'isolation' : 'primary'
  const title = `${E2E_TITLE_PREFIX}Free Canvas ${safeRole} ${stamp} ${uniqueSuffix}`
  const drama = await apiRequest('/dramas', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: 'Browser E2E fixture for the free canvas.',
      style: 'anime style',
      total_episodes: 1,
      metadata: { e2e: true, e2e_suite: E2E_SUITE, e2e_role: safeRole },
    }),
  })
  assert.ok(drama?.id, 'free canvas E2E fixture must return a project id')
  return { drama, title, role: safeRole }
}

async function seedPrimaryFixture(apiRequest, fixture, stamp = Date.now()) {
  const dramaId = Number(fixture.drama.id)
  const episodeTitle = `E2E Canvas Episode ${stamp}`
  const characterName = `E2E Canvas Character ${stamp}`
  const characterDescription = `Initial production reference ${stamp}`
  await apiRequest(`/dramas/${dramaId}/episodes`, {
    method: 'PUT',
    body: JSON.stringify({
      episodes: [{
        episode_number: 1,
        title: episodeTitle,
        script_content: `Scene fixture ${stamp}`,
        description: 'Minimal free canvas browser fixture.',
        duration: 12,
      }],
    }),
  })
  let drama = await apiRequest(`/dramas/${dramaId}`)
  const episode = (drama.episodes || []).find((item) => item.title === episodeTitle)
  assert.ok(episode?.id, 'fixture episode was not created')

  await apiRequest(`/dramas/${dramaId}/characters`, {
    method: 'PUT',
    body: JSON.stringify({
      characters: [{
        name: characterName,
        role: 'lead',
        description: characterDescription,
        personality: 'precise',
        appearance: 'blue jacket',
      }],
    }),
  })
  drama = await apiRequest(`/dramas/${dramaId}`)
  const character = (drama.characters || []).find((item) => item.name === characterName)
  assert.ok(character?.id, 'fixture character was not created')

  const storyboard = await apiRequest('/storyboards', {
    method: 'POST',
    body: JSON.stringify({
      episode_id: episode.id,
      storyboard_number: 1,
      title: `E2E Canvas Storyboard ${stamp}`,
      description: 'A safe local storyboard for browser verification.',
      location: 'Local test stage',
      time: 'Day',
      duration: 4,
    }),
  })
  assert.ok(storyboard?.id, 'fixture storyboard was not created')
  assert.equal(Number(storyboard.episode_id), Number(episode.id), 'fixture storyboard belongs to the wrong episode')
  return { episode, character, storyboard, characterDescription }
}

async function purgeFixtureSafely({ fixture, assertIdentity, fixturePurger }) {
  assert.ok(String(fixture?.title || '').startsWith(E2E_TITLE_PREFIX), 'hard purge requires the guarded title prefix')
  await assertIdentity(fixture)
  const result = await fixturePurger({ dramaId: fixture.drama.id, expectedTitle: fixture.title })
  assert.equal(result?.verified, true, 'hard purge did not return verified evidence')
  return result
}

async function assertServicesReachable(fetchImpl = fetch, services = SERVICES) {
  const [frontend, backend] = await Promise.all([
    fetchImpl(services.frontendUrl, { redirect: 'manual' }),
    fetchImpl(`${services.backendUrl}/api/v1/dramas?page=1&page_size=1`, {
      headers: { Origin: services.frontendOrigin },
    }),
  ])
  if (!frontend.ok) throw new Error(`Frontend is unavailable at ${services.frontendUrl}: HTTP ${frontend.status}`)
  if (!backend.ok) throw new Error(`Backend is unavailable at ${services.backendUrl}: HTTP ${backend.status}`)
}

function sanitizeEvidenceText(value, maxLength = 500) {
  let sanitized = String(value || '')
  for (const pattern of SENSITIVE_TEXT_PATTERNS) sanitized = sanitized.replace(pattern, '[REDACTED]')
  return sanitized
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1')
    .replace(/[\r\n\0]+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function sanitizeEvidenceUrl(value) {
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

function normalizeCleanupEvidence(cleanup = {}) {
  return {
    status: cleanup.status === 'passed' ? 'passed' : 'failed',
    fixtures: (Array.isArray(cleanup.fixtures) ? cleanup.fixtures : []).map((fixture) => ({
      drama_id: Number(fixture.drama_id ?? fixture.dramaId),
      title: sanitizeEvidenceText(fixture.title, 200),
      verified: fixture.verified === true,
    })),
    failures: (Array.isArray(cleanup.failures) ? cleanup.failures : []).map((failure) => ({
      label: sanitizeEvidenceText(failure.label, 120),
      message: sanitizeEvidenceText(failure.error?.message || failure.message || 'cleanup failed', 300),
    })),
  }
}

function normalizeFlowEvidence(flow) {
  if (!flow || typeof flow !== 'object') return null
  return {
    completed: flow.completed === true,
    primary_drama_id: Number(flow.primary_drama_id),
    isolation_drama_id: Number(flow.isolation_drama_id),
    node_ids: (Array.isArray(flow.node_ids) ? flow.node_ids : []).map((id) => sanitizeEvidenceText(id, 160)),
    edge_ids: (Array.isArray(flow.edge_ids) ? flow.edge_ids : []).map((id) => sanitizeEvidenceText(id, 160)),
    text_node_id: sanitizeEvidenceText(flow.text_node_id, 160),
    config_node_id: sanitizeEvidenceText(flow.config_node_id, 160),
    image_node_id: sanitizeEvidenceText(flow.image_node_id, 160),
    video_node_id: sanitizeEvidenceText(flow.video_node_id, 160),
    reference_node_id: sanitizeEvidenceText(flow.reference_node_id, 160),
    keyboard_activations: (Array.isArray(flow.keyboard_activations) ? flow.keyboard_activations : []).map((entry) => ({
      key: sanitizeEvidenceText(entry.key, 20),
      node_id: sanitizeEvidenceText(entry.node_id, 160),
      focus_retained: entry.focus_retained === true,
      exact_selection_verified: entry.exact_selection_verified === true,
      inspector_open_verified: entry.inspector_open_verified === true,
    })),
    marquee_selected_node_ids: (Array.isArray(flow.marquee_selected_node_ids) ? flow.marquee_selected_node_ids : [])
      .map((id) => sanitizeEvidenceText(id, 160)),
    clone_node_ids: (Array.isArray(flow.clone_node_ids) ? flow.clone_node_ids : [])
      .map((id) => sanitizeEvidenceText(id, 160)),
    edge_endpoints: (Array.isArray(flow.edge_endpoints) ? flow.edge_endpoints : []).map((edge) => ({
      id: sanitizeEvidenceText(edge.id, 160),
      source: sanitizeEvidenceText(edge.source, 160),
      target: sanitizeEvidenceText(edge.target, 160),
    })),
    text_sha256: sanitizeEvidenceText(flow.text_sha256, 64),
    mode: sanitizeEvidenceText(flow.mode, 20),
    background: sanitizeEvidenceText(flow.background, 20),
    viewport: {
      x: Number(flow.viewport?.x),
      y: Number(flow.viewport?.y),
      zoom: Number(flow.viewport?.zoom),
    },
    config_status: sanitizeEvidenceText(flow.config_status, 40),
    config_runtime_status: sanitizeEvidenceText(flow.config_runtime_status, 40),
    storyboard_target_id: Number(flow.storyboard_target_id),
    storyboard_description_sha256: sanitizeEvidenceText(flow.storyboard_description_sha256, 64),
    marquee_selection_verified: flow.marquee_selection_verified === true,
    copy_paste_verified: flow.copy_paste_verified === true,
    delete_undo_redo_verified: flow.delete_undo_redo_verified === true,
    save_recovery_verified: flow.save_recovery_verified === true,
    upload_failure_verified: flow.upload_failure_verified === true,
    image_interaction_verified: flow.image_interaction_verified === true,
    video_interaction_verified: flow.video_interaction_verified === true,
    conversion_verified: flow.conversion_verified === true,
    storyboard_conversion_verified: flow.storyboard_conversion_verified === true,
    isolation_verified: flow.isolation_verified === true,
  }
}

function normalizeScreenshotEvidence(screenshots) {
  return (Array.isArray(screenshots) ? screenshots : []).map((entry) => ({
    id: sanitizeEvidenceText(entry.id, 120),
    path: sanitizeEvidenceText(entry.path, 240),
    viewport: { width: Number(entry.viewport?.width), height: Number(entry.viewport?.height) },
    theme: sanitizeEvidenceText(entry.theme, 20),
    bytes: Number(entry.bytes),
    sha256: sanitizeEvidenceText(entry.sha256, 64),
    captured_at: entry.captured_at,
    step: sanitizeEvidenceText(entry.step, 80),
    inspector_open: entry.inspector_open === true,
    geometry: {
      node_count: Number(entry.geometry?.node_count),
      toolbar_visible: entry.geometry?.toolbar_visible === true,
      minimap_visible: entry.geometry?.minimap_visible === true,
      sidebar_visible: entry.geometry?.sidebar_visible === true,
      inspector_visible: entry.geometry?.inspector_visible === true,
    },
  }))
}

function buildEvidenceManifest({
  status,
  gitRevision,
  sourceBinding,
  services = SERVICES,
  canvasUrl = '',
  steps = [],
  flow = null,
  cleanup = {},
  error = null,
  screenshots = [],
  generatedAt = new Date().toISOString(),
}) {
  return {
    schema: 'localminidrama.free-canvas-e2e-evidence.v1',
    status: status === 'passed' ? 'passed' : 'failed',
    generated_at: generatedAt,
    git_revision: sanitizeEvidenceText(gitRevision, 64),
    source: {
      head: sanitizeEvidenceText(sourceBinding?.head, 64),
      worktree_state: sanitizeEvidenceText(sourceBinding?.worktree_state, 20),
    },
    urls: {
      frontend: sanitizeEvidenceUrl(services.frontendUrl),
      backend: sanitizeEvidenceUrl(services.backendUrl),
      canvas: sanitizeEvidenceUrl(canvasUrl),
    },
    suite: E2E_SUITE,
    steps: (Array.isArray(steps) ? steps : []).map((step) => ({
      name: sanitizeEvidenceText(step.name || step.step, 120),
      status: step.status === 'failed' ? 'failed' : 'passed',
      at: step.at || generatedAt,
    })),
    flow: normalizeFlowEvidence(flow),
    cleanup: normalizeCleanupEvidence(cleanup),
    failure: status === 'passed' ? null : {
      message: sanitizeEvidenceText(error?.message || error || 'Free canvas E2E failed', 400),
    },
    screenshots: normalizeScreenshotEvidence(screenshots),
  }
}

function assertUniqueStringIds(values, label, minimum) {
  assert.ok(Array.isArray(values) && values.length >= minimum, `${label} are incomplete`)
  assert.equal(values.every((value) => typeof value === 'string' && value.length > 0), true, `${label} are invalid`)
  assert.equal(new Set(values).size, values.length, `${label} must be unique`)
}

function assertKeyboardActivationEvidence(activations, nodeIds) {
  assert.equal(Array.isArray(activations), true, 'browser flow keyboard activation evidence is incomplete')
  assert.equal(activations.length, 2, 'browser flow keyboard evidence must contain exactly Enter and Space')
  const keys = activations.map((entry) => entry?.key)
  assert.equal(new Set(keys).size, 2, 'browser flow keyboard activation keys must be unique')
  assert.deepEqual([...keys].sort(), ['Enter', 'Space'], 'browser flow keyboard evidence must contain exactly Enter and Space')
  for (const entry of activations) {
    assert.equal(nodeIds.has(entry?.node_id), true, `browser flow ${entry?.key || 'unknown'} keyboard node is missing`)
    assert.equal(entry?.focus_retained, true, `browser flow ${entry.key} keyboard focus evidence is incomplete`)
    assert.equal(entry?.exact_selection_verified, true, `browser flow ${entry.key} keyboard selection evidence is incomplete`)
    assert.equal(entry?.inspector_open_verified, true, `browser flow ${entry.key} keyboard inspector evidence is incomplete`)
  }
}

function assertBrowserFlowResult(result) {
  assert.equal(result?.completed, true, 'Free canvas browser flow result is incomplete')
  assert.ok(Number.isSafeInteger(result.primary_drama_id) && result.primary_drama_id > 0, 'primary fixture identity is incomplete')
  assert.ok(Number.isSafeInteger(result.isolation_drama_id) && result.isolation_drama_id > 0, 'isolation fixture identity is incomplete')
  assert.notEqual(result.primary_drama_id, result.isolation_drama_id, 'browser flow fixtures must be distinct')
  assertUniqueStringIds(result.node_ids, 'browser flow node IDs', 7)
  assertUniqueStringIds(result.edge_ids, 'browser flow edge IDs', 2)
  assertUniqueStringIds(result.clone_node_ids, 'browser flow clone node IDs', 2)
  assertUniqueStringIds(result.marquee_selected_node_ids, 'browser flow marquee-selected node IDs', 2)
  const nodeIds = new Set(result.node_ids)
  const edgeIds = new Set(result.edge_ids)
  const roleNodeIds = [
    result.text_node_id,
    result.config_node_id,
    result.image_node_id,
    result.video_node_id,
    result.reference_node_id,
  ]
  for (const id of [...roleNodeIds, ...result.clone_node_ids]) {
    assert.equal(nodeIds.has(id), true, 'browser flow role node is missing from the exact node set')
  }
  assert.equal(new Set(roleNodeIds).size, roleNodeIds.length, 'browser flow role node IDs must be unique')
  assertKeyboardActivationEvidence(result.keyboard_activations, nodeIds)
  assertExactIdSet(
    result.marquee_selected_node_ids,
    [result.text_node_id, result.config_node_id],
    'browser flow marquee selection',
  )
  assert.equal(Array.isArray(result.edge_endpoints), true, 'browser flow edge endpoint evidence is incomplete')
  assert.equal(result.edge_endpoints.length, result.edge_ids.length, 'browser flow edge endpoint evidence is incomplete')
  for (const edge of result.edge_endpoints) {
    assert.equal(edgeIds.has(edge?.id), true, 'browser flow edge endpoint ID is unknown')
    assert.equal(nodeIds.has(edge?.source) && nodeIds.has(edge?.target), true, 'browser flow edge endpoint is unknown')
  }
  assert.match(String(result.text_sha256 || ''), /^[0-9a-f]{64}$/i, 'browser flow text hash is incomplete')
  assert.equal(result.mode, 'free', 'browser flow mode persistence is incomplete')
  assert.equal(result.background, 'lines', 'browser flow background persistence is incomplete')
  assert.equal(result.config_status, 'idle', 'browser flow config persistence is incomplete')
  assert.equal(result.config_runtime_status, 'blocked', 'browser flow config gate evidence is incomplete')
  assert.equal(['x', 'y', 'zoom'].every((key) => Number.isFinite(result.viewport?.[key])), true, 'browser flow viewport is incomplete')
  assert.ok(Number.isSafeInteger(result.storyboard_target_id) && result.storyboard_target_id > 0, 'browser flow storyboard target is incomplete')
  assert.match(String(result.storyboard_description_sha256 || ''), /^[0-9a-f]{64}$/i, 'browser flow storyboard hash is incomplete')
  for (const key of [
    'marquee_selection_verified',
    'copy_paste_verified',
    'delete_undo_redo_verified',
    'save_recovery_verified',
    'upload_failure_verified',
    'image_interaction_verified',
    'video_interaction_verified',
    'conversion_verified',
    'storyboard_conversion_verified',
    'isolation_verified',
  ]) {
    assert.equal(result[key], true, `Free canvas browser flow result is incomplete: ${key}`)
  }
  return result
}

async function runBrowserFlow(run, context) {
  return assertBrowserFlowResult(await run(context))
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForValue(read, predicate, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (predicate(value)) return value
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  const suffix = lastError ? `: ${sanitizeEvidenceText(lastError.message, 180)}` : ''
  throw new Error(`${label} did not complete before timeout${suffix}`)
}

function getFreeCanvas(drama) {
  const value = parseMetadata(drama).free_canvas
  if (!value || typeof value !== 'object') {
    return { version: 1, mode: 'production', background: 'dots', viewport: { x: 0, y: 0, zoom: 0.9 }, nodes: [], edges: [] }
  }
  return {
    ...value,
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    edges: Array.isArray(value.edges) ? value.edges : [],
  }
}

async function readFreeCanvas(apiRequest, dramaId) {
  return getFreeCanvas(await apiRequest(`/dramas/${dramaId}`))
}

async function waitForPersistedFreeCanvas(apiRequest, dramaId, predicate, label = 'free canvas persistence') {
  return waitForValue(
    () => readFreeCanvas(apiRequest, dramaId),
    predicate,
    label,
  )
}

function stringSet(values) {
  return new Set((values || []).map((value) => String(value)))
}

function setDifference(after, before) {
  const beforeSet = before instanceof Set ? before : stringSet(before)
  return [...after].map(String).filter((value) => !beforeSet.has(value))
}

function assertExactIdSet(actualValues, expectedValues, label) {
  const actual = [...stringSet(actualValues)].sort()
  const expected = [...stringSet(expectedValues)].sort()
  assert.deepEqual(actual, expected, `${label} must match the exact API ID set`)
}

function viewportSummary(viewport) {
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(3) : 'invalid')
  return `x=${number(viewport?.x)},y=${number(viewport?.y)},zoom=${number(viewport?.zoom)}`
}

function viewportWithinTolerance(actual, expected, { position = 4, zoom = 0.04 } = {}) {
  return ['x', 'y', 'zoom'].every((key) => Number.isFinite(Number(actual?.[key])) && Number.isFinite(Number(expected?.[key])))
    && Math.abs(Number(actual.x) - Number(expected.x)) <= position
    && Math.abs(Number(actual.y) - Number(expected.y)) <= position
    && Math.abs(Number(actual.zoom) - Number(expected.zoom)) <= zoom
}

async function assertUniqueLocator(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS })
  assert.equal(await locator.count(), 1, `${label} locator must resolve exactly once`)
  return locator
}

function freeNodeLocator(page, nodeId) {
  return page.locator(`.free-canvas-node[data-free-node-id=${JSON.stringify(String(nodeId))}]`)
}

async function exactFreeNode(page, nodeId) {
  return assertUniqueLocator(freeNodeLocator(page, nodeId), `free node ${String(nodeId)}`)
}

async function readRenderedViewport(page) {
  const viewport = page.locator('.vue-flow__transformationpane')
  await assertUniqueLocator(viewport, 'free canvas transformation pane')
  return viewport.evaluate((element) => {
    const svgMatrix = typeof element.getCTM === 'function' ? element.getCTM() : null
    if (svgMatrix) return { x: svgMatrix.e, y: svgMatrix.f, zoom: svgMatrix.a }
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return { x: 0, y: 0, zoom: 1 }
    const matrix = new DOMMatrixReadOnly(transform)
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }
  })
}

async function expectPressed(locator, expected) {
  await assertUniqueLocator(locator, 'mode button')
  await waitForValue(
    () => locator.getAttribute('aria-pressed'),
    (value) => value === expected,
    'mode button state',
  )
}

async function createFreeNodeFromMenu(page, typeLabel) {
  const trigger = page.getByRole('button', { name: '新建自由节点', exact: true })
  await assertUniqueLocator(trigger, 'new free node button')
  await trigger.click()
  const option = page.getByRole('menuitem', { name: typeLabel, exact: true })
  await assertUniqueLocator(option, `${typeLabel} free node menu option`)
  await option.click()
}

async function createNodeAndResolve({ page, apiRequest, dramaId, type, action }) {
  const before = await readFreeCanvas(apiRequest, dramaId)
  const beforeIds = stringSet(before.nodes.map((node) => node.id))
  await action()
  const persisted = await waitForPersistedFreeCanvas(
    apiRequest,
    dramaId,
    (state) => {
      const afterIds = stringSet(state.nodes.map((node) => node.id))
      const created = setDifference(afterIds, beforeIds)
      return created.length === 1 && [...beforeIds].every((id) => afterIds.has(id))
    },
    `${type} node creation`,
  )
  const afterIds = stringSet(persisted.nodes.map((node) => node.id))
  const createdIds = setDifference(afterIds, beforeIds)
  assert.equal(createdIds.length, 1, `${type} creation must add exactly one API node ID`)
  const node = persisted.nodes.find((item) => String(item.id) === createdIds[0])
  assert.equal(node?.type, type, `created API node ${createdIds[0]} has the wrong type`)
  await clickUniqueButton(page, '适配视图')
  await delay(400)
  await waitForUiSaveSettled(page)
  await exactFreeNode(page, createdIds[0])
  return { node, state: persisted, before }
}

async function moveExactNodeAwayFrom({ page, apiRequest, dramaId, nodeId, anchorNodeId }) {
  const before = await readFreeCanvas(apiRequest, dramaId)
  const beforeNode = before.nodes.find((node) => String(node.id) === String(nodeId))
  assert.ok(beforeNode, `movable API node ${nodeId} is missing`)
  const node = await exactFreeNode(page, nodeId)
  await node.click()
  await delay(200)
  const anchor = await exactFreeNode(page, anchorNodeId)
  const dragSurface = node.locator('.node-header')
  await assertUniqueLocator(dragSurface, `drag surface ${nodeId}`)
  const pane = page.locator('.vue-flow__pane')
  await assertUniqueLocator(pane, 'free canvas pane')
  let nodeBox = null
  let paneBox = null
  let deltaX = 0
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    nodeBox = await node.boundingBox()
    paneBox = await pane.boundingBox()
    assert.ok(nodeBox && paneBox, 'exact node movement requires browser coordinates')
    const requiredDistance = nodeBox.width + 32
    const rightSpace = paneBox.x + paneBox.width - (nodeBox.x + nodeBox.width) - 24
    const leftSpace = nodeBox.x - paneBox.x - 24
    if (rightSpace >= requiredDistance) {
      deltaX = requiredDistance
      break
    }
    if (leftSpace >= requiredDistance) {
      deltaX = -requiredDistance
      break
    }
    if (attempt < 4) {
      await clickUniqueButton(page, '缩小画布')
      await delay(220)
    }
  }
  assert.ok(
    Math.abs(deltaX) > Number(nodeBox?.width),
    `free canvas does not expose enough space to separate exact nodes (pane=${Math.round(paneBox.x)},${Math.round(paneBox.width)} node=${Math.round(nodeBox.x)},${Math.round(nodeBox.width)})`,
  )
  const dragBy = async (distance) => {
    const dragBox = await dragSurface.boundingBox()
    assert.ok(dragBox, 'exact node drag surface has no browser coordinates')
    const start = { x: dragBox.x + dragBox.width / 2, y: dragBox.y + dragBox.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + distance, start.y, { steps: 12 })
    await page.mouse.up()
  }
  await dragBy(deltaX)

  let movedState = await waitForPersistedFreeCanvas(
    apiRequest,
    dramaId,
    (state) => {
      const moved = state.nodes.find((item) => String(item.id) === String(nodeId))
      return moved && Math.hypot(
        Number(moved.position?.x) - Number(beforeNode.position?.x),
        Number(moved.position?.y) - Number(beforeNode.position?.y),
      ) > 20
    },
    `exact node ${nodeId} movement`,
  )
  let finalGap = Number.NEGATIVE_INFINITY
  for (let correctionAttempt = 0; correctionAttempt <= 2; correctionAttempt += 1) {
    const movedBox = await node.boundingBox()
    const anchorBox = await anchor.boundingBox()
    assert.ok(movedBox && anchorBox, 'separated exact nodes have no browser coordinates')
    finalGap = deltaX > 0
      ? movedBox.x - (anchorBox.x + anchorBox.width)
      : anchorBox.x - (movedBox.x + movedBox.width)
    if (finalGap >= 16) break
    if (correctionAttempt === 2) break
    const previous = movedState.nodes.find((item) => String(item.id) === String(nodeId))
    const correction = Math.sign(deltaX) * (16 - finalGap + 12)
    await dragBy(correction)
    movedState = await waitForPersistedFreeCanvas(
      apiRequest,
      dramaId,
      (state) => {
        const moved = state.nodes.find((item) => String(item.id) === String(nodeId))
        return moved && Math.hypot(
          Number(moved.position?.x) - Number(previous?.position?.x),
          Number(moved.position?.y) - Number(previous?.position?.y),
        ) > 3
      },
      `exact node ${nodeId} separation correction`,
    )
  }
  assert.ok(finalGap >= 16, `exact free nodes remain too close after browser drag (gap=${Math.round(finalGap)})`)
}

async function connectExactNodes({ page, apiRequest, dramaId, sourceId, targetId }) {
  const before = await readFreeCanvas(apiRequest, dramaId)
  const beforeEdgeIds = stringSet(before.edges.map((edge) => edge.id))
  const sourceNode = await exactFreeNode(page, sourceId)
  const targetNode = await exactFreeNode(page, targetId)
  const sourceHandle = sourceNode.locator('.vue-flow__handle.source')
  const targetHandle = targetNode.locator('.vue-flow__handle.target')
  await assertUniqueLocator(sourceHandle, `source handle ${sourceId}`)
  await assertUniqueLocator(targetHandle, `target handle ${targetId}`)
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetHandle.boundingBox()
  assert.ok(sourceBox && targetBox, 'exact connection handles must have browser coordinates')
  const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
  const sourceHit = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest('[data-free-node-id]')?.getAttribute('data-free-node-id') || ''
  ), sourcePoint)
  const targetHit = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest('[data-free-node-id]')?.getAttribute('data-free-node-id') || ''
  ), targetPoint)
  assert.equal(sourceHit, String(sourceId), 'pointer hit target for source handle does not match the exact source ID')
  assert.equal(targetHit, String(targetId), 'pointer hit target for target handle does not match the exact target ID')
  await sourceHandle.click()
  await waitForValue(
    () => sourceHandle.getAttribute('class'),
    (className) => String(className).split(/\s+/).includes('connecting'),
    'source handle did not enter click-connecting state',
  )
  await targetHandle.click()

  const persisted = await waitForPersistedFreeCanvas(
    apiRequest,
    dramaId,
    (state) => setDifference(stringSet(state.edges.map((edge) => edge.id)), beforeEdgeIds).length === 1,
    'free canvas connection',
  )
  const createdIds = setDifference(stringSet(persisted.edges.map((edge) => edge.id)), beforeEdgeIds)
  assert.equal(createdIds.length, 1, 'connection must add exactly one API edge ID')
  const edge = persisted.edges.find((item) => String(item.id) === createdIds[0])
  assert.deepEqual(
    { source: String(edge?.source), target: String(edge?.target) },
    { source: String(sourceId), target: String(targetId) },
    'connection API endpoints do not match the exact dragged nodes',
  )
  return { edge, state: persisted }
}

async function readSelectedFreeNodeIds(page) {
  return page.locator('.vue-flow__node.selected [data-free-node-id]').evaluateAll((elements) => (
    elements.map((element) => String(element.getAttribute('data-free-node-id') || '')).filter(Boolean)
  ))
}

async function assertExactSelectedFreeNodeIds(page, expectedNodeIds) {
  const expected = [...stringSet(expectedNodeIds)].sort()
  const selected = await waitForValue(
    () => readSelectedFreeNodeIds(page),
    (nodeIds) => {
      const actual = [...stringSet(nodeIds)].sort()
      return actual.length === expected.length && actual.every((id, index) => id === expected[index])
    },
    'exact browser free-node selection',
  )
  assertExactIdSet(selected, expected, 'selected browser free nodes')
  return selected
}

async function marqueeSelectExactNodes({ page, nodeIds }) {
  const expectedNodeIds = [...stringSet(nodeIds)]
  assert.ok(expectedNodeIds.length >= 2, 'marquee selection requires at least two exact node IDs')
  const pane = page.locator('.vue-flow__pane')
  await assertUniqueLocator(pane, 'free canvas marquee pane')
  const paneBox = await pane.boundingBox()
  assert.ok(paneBox, 'free canvas marquee pane has no browser coordinates')

  const boxes = []
  for (const nodeId of expectedNodeIds) {
    const box = await (await exactFreeNode(page, nodeId)).boundingBox()
    assert.ok(box, `free node ${nodeId} has no browser coordinates for marquee selection`)
    boxes.push(box)
  }
  const bounds = {
    left: Math.min(...boxes.map((box) => box.x)),
    top: Math.min(...boxes.map((box) => box.y)),
    right: Math.max(...boxes.map((box) => box.x + box.width)),
    bottom: Math.max(...boxes.map((box) => box.y + box.height)),
  }
  const padding = 14
  const start = {
    x: Math.max(paneBox.x + 3, bounds.left - padding),
    y: Math.max(paneBox.y + 3, bounds.top - padding),
  }
  const end = {
    x: Math.min(paneBox.x + paneBox.width - 3, bounds.right + padding),
    y: Math.min(paneBox.y + paneBox.height - 3, bounds.bottom + padding),
  }
  assert.ok(start.x < bounds.left && start.y < bounds.top, 'marquee start cannot enclose the exact node bounds')
  assert.ok(end.x > bounds.right && end.y > bounds.bottom, 'marquee end cannot enclose the exact node bounds')
  const endpointHits = await page.evaluate(({ startPoint, endPoint }) => (
    [startPoint, endPoint].map(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest('[data-free-node-id]')?.getAttribute('data-free-node-id') || ''
    ))
  ), { startPoint: start, endPoint: end })
  assert.deepEqual(endpointHits, ['', ''], 'marquee endpoints must land on blank canvas space')

  await page.mouse.click(start.x, start.y, { button: 'left' })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(end.x, end.y, { steps: 16 })
  await page.mouse.up({ button: 'left' })
  return assertExactSelectedFreeNodeIds(page, expectedNodeIds)
}

async function findBlankPanePoint(page, paneBox) {
  const candidates = []
  for (const xRatio of [0.08, 0.92, 0.18, 0.82, 0.5]) {
    for (const yRatio of [0.12, 0.86, 0.28, 0.72]) {
      candidates.push({
        x: paneBox.x + paneBox.width * xRatio,
        y: paneBox.y + paneBox.height * yRatio,
      })
    }
  }
  for (const point of candidates) {
    const blocked = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      if (!element) return true
      return Boolean(element.closest([
        '[data-free-node-id]',
        '.el-button',
        '.el-dropdown-menu',
        '.free-canvas-inspector-dock',
        '.vue-flow__minimap',
        '.vue-flow__controls',
        '.el-message',
      ].join(',')))
    }, point)
    if (!blocked) return point
  }
  throw new Error('free canvas has no blank pane point for panning')
}

async function clickUniqueButton(page, name) {
  const button = page.getByRole('button', { name, exact: true })
  await assertUniqueLocator(button, `${name} button`)
  await button.click()
}

async function waitForUiSaveSettled(page) {
  await delay(850)
  await waitForValue(
    () => page.getByText('保存中…', { exact: true }).count(),
    (count) => count === 0,
    'canvas save queue',
  )
}

async function waitForMessage(page, message) {
  await page.waitForFunction(
    (expected) => [...document.querySelectorAll('.el-message')]
      .some((element) => element.textContent?.includes(expected)),
    message,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
}

async function installProviderIsolation(page) {
  const hits = { configs: 0, readiness: 0 }
  const configsPattern = '**/api/v1/ai-configs**'
  const readinessPattern = '**/api/v1/workflows/novel2anime/readiness'
  const configsHandler = async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') return route.continue()
    hits.configs += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  }
  const readinessHandler = async (route) => {
    hits.readiness += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          qa_mode: 'production',
          ready: false,
          capabilities: [
            { key: 'video', service_type: 'video', ready: false, detail: 'missing' },
            { key: 'tts', service_type: 'tts', ready: false, detail: 'missing' },
            { key: 'ffmpeg', ready: true },
          ],
          missing_capabilities: [
            { key: 'video', service_type: 'video', detail: 'missing' },
            { key: 'tts', service_type: 'tts', detail: 'missing' },
          ],
        },
      }),
    })
  }
  await page.route(configsPattern, configsHandler)
  await page.route(readinessPattern, readinessHandler)
  return {
    hits,
    async dispose() {
      await page.unroute(configsPattern, configsHandler)
      await page.unroute(readinessPattern, readinessHandler)
    },
  }
}

async function assertPageFixtureIdentity({ page, fixture, verifyFixture, services = SERVICES }) {
  await verifyFixture(fixture)
  const current = new URL(page.url())
  assert.equal(current.origin, services.frontendUrl, 'browser frontend origin does not match the approved service')
  assert.equal(current.pathname, `/film/${fixture.drama.id}/canvas`, 'browser is showing the wrong fixture canvas')
  assert.equal(current.search, '', 'fixture canvas URL must not contain query evidence')
  assert.equal(current.hash, '', 'fixture canvas URL must not contain fragment evidence')
  const title = page.locator('.page-title')
  await assertUniqueLocator(title, 'fixture page title')
  assert.equal((await title.textContent())?.trim(), fixture.title, 'browser fixture title does not match the guarded identity')
}

async function openFixtureCanvas({ page, fixture, verifyFixture, services = SERVICES }) {
  await verifyFixture(fixture)
  const url = `${services.frontendUrl}/film/${fixture.drama.id}/canvas`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const modeSwitch = page.getByRole('group', { name: '画布模式' })
  await assertUniqueLocator(modeSwitch, 'canvas mode switch')
  await assertPageFixtureIdentity({ page, fixture, verifyFixture, services })
  return { url, modeSwitch }
}

async function setEvidenceTheme(page, theme) {
  const darkTarget = page.getByRole('button', { name: '暗色主题', exact: true })
  const lightTarget = page.getByRole('button', { name: '浅色主题', exact: true })
  const darkCount = await darkTarget.count()
  const lightCount = await lightTarget.count()
  assert.equal(darkCount + lightCount, 1, 'theme control must expose exactly one target theme')
  if (theme === 'dark' && darkCount === 1) await darkTarget.click()
  if (theme === 'light' && lightCount === 1) await lightTarget.click()
  const expectedTarget = theme === 'dark' ? lightTarget : darkTarget
  await waitForValue(() => expectedTarget.count(), (count) => count === 1, `${theme} theme activation`)
}

async function closeInspector(page) {
  const inspector = page.getByRole('complementary', { name: '自由节点检查器' })
  const count = await inspector.count()
  assert.ok(count <= 1, 'free canvas inspector must be unique')
  if (count === 1) {
    const close = inspector.getByRole('button', { name: '关闭检查器', exact: true })
    await assertUniqueLocator(close, 'close inspector button')
    await close.click()
    await inspector.waitFor({ state: 'detached', timeout: DEFAULT_TIMEOUT_MS })
  }
}

function boxesOverlap(left, right, gap = 0) {
  return !(
    left.x + left.width + gap <= right.x
    || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y
    || right.y + right.height + gap <= left.y
  )
}

function assertBoxInside(inner, outer, label, tolerance = 1) {
  assert.ok(inner.x >= outer.x - tolerance, `${label} is clipped on the left`)
  assert.ok(inner.y >= outer.y - tolerance, `${label} is clipped on the top`)
  assert.ok(inner.x + inner.width <= outer.x + outer.width + tolerance, `${label} is clipped on the right`)
  assert.ok(inner.y + inner.height <= outer.y + outer.height + tolerance, `${label} is clipped on the bottom`)
}

async function visibleBox(locator, label) {
  await assertUniqueLocator(locator, label)
  const box = await locator.boundingBox()
  assert.ok(box && box.width > 0 && box.height > 0, `${label} has no visible geometry`)
  return box
}

async function assertCaptureGeometry({ page, capture, expectedNodeIds }) {
  const viewport = page.viewportSize()
  assert.deepEqual(viewport, { width: capture.width, height: capture.height }, `${capture.id} browser viewport is incorrect`)
  const viewportBox = { x: 0, y: 0, width: viewport.width, height: viewport.height }
  const canvasBox = await visibleBox(page.locator('.canvas-main'), 'free canvas main region')
  const toolbarBox = await visibleBox(page.locator('.free-canvas-bottom-toolbar'), 'free canvas toolbar')
  const minimapBox = await visibleBox(page.locator('.vue-flow__minimap'), 'free canvas minimap')
  const sidebarBox = await visibleBox(
    page.getByRole('complementary', { name: '自由画布素材', exact: true }),
    'free canvas asset sidebar',
  )
  assertBoxInside(canvasBox, viewportBox, 'free canvas main region')
  assertBoxInside(toolbarBox, canvasBox, 'free canvas toolbar')
  assertBoxInside(minimapBox, canvasBox, 'free canvas minimap')
  assertBoxInside(sidebarBox, viewportBox, 'free canvas asset sidebar')
  assert.equal(boxesOverlap(sidebarBox, canvasBox), false, 'asset sidebar overlaps the free canvas main region')
  assert.equal(boxesOverlap(toolbarBox, minimapBox, 2), false, 'free canvas toolbar overlaps the minimap')

  const nodeBoxes = []
  for (const nodeId of expectedNodeIds) {
    const box = await visibleBox(await exactFreeNode(page, nodeId), `capture free node ${nodeId}`)
    assertBoxInside(box, canvasBox, `capture free node ${nodeId}`)
    assert.equal(boxesOverlap(box, toolbarBox), false, `capture free node ${nodeId} overlaps the toolbar`)
    assert.equal(boxesOverlap(box, minimapBox), false, `capture free node ${nodeId} overlaps the minimap`)
    nodeBoxes.push(box)
  }

  const inspector = page.getByRole('complementary', { name: '自由节点检查器', exact: true })
  const inspectorCount = await inspector.count()
  assert.equal(inspectorCount, capture.inspectorOpen ? 1 : 0, `${capture.id} inspector state is incorrect`)
  if (capture.inspectorOpen) {
    const inspectorBox = await visibleBox(inspector, 'free canvas inspector')
    assertBoxInside(inspectorBox, viewportBox, 'free canvas inspector')
    assert.equal(boxesOverlap(inspectorBox, sidebarBox), false, 'free canvas inspector overlaps the asset sidebar')
    assert.equal(boxesOverlap(inspectorBox, canvasBox), false, 'free canvas inspector overlaps the canvas main region')
    for (const [index, box] of nodeBoxes.entries()) {
      assert.equal(boxesOverlap(inspectorBox, box), false, `free canvas inspector overlaps capture node ${expectedNodeIds[index]}`)
    }
  }

  return {
    node_count: nodeBoxes.length,
    toolbar_visible: true,
    minimap_visible: true,
    sidebar_visible: true,
    inspector_visible: capture.inspectorOpen,
  }
}

async function captureAcceptanceScreenshots({
  page,
  fixture,
  verifyFixture,
  services,
  evidenceRoot,
  expectedNodeIds,
  inspectorNodeId,
}) {
  const screenshotRoot = path.join(evidenceRoot, 'screenshots')
  await fs.mkdir(screenshotRoot, { recursive: true })
  const descriptors = []
  for (const capture of REQUIRED_CAPTURES) {
    await page.setViewportSize({ width: capture.width, height: capture.height })
    await setEvidenceTheme(page, capture.theme)
    await closeInspector(page)
    await clickUniqueButton(page, '适配视图')
    if (capture.inspectorOpen) {
      const inspectorNode = await exactFreeNode(page, inspectorNodeId)
      await inspectorNode.click()
      await assertUniqueLocator(
        page.getByRole('complementary', { name: '自由节点检查器', exact: true }),
        'acceptance capture inspector',
      )
      await delay(250)
      await clickUniqueButton(page, '适配视图')
    }
    await waitForUiSaveSettled(page)
    await assertPageFixtureIdentity({ page, fixture, verifyFixture, services })
    assert.equal(await page.locator('.free-canvas-node[data-free-node-id]').count(), expectedNodeIds.length, 'capture node count is incomplete')
    for (const nodeId of expectedNodeIds) await exactFreeNode(page, nodeId)
    const geometry = await assertCaptureGeometry({ page, capture, expectedNodeIds })
    const buffer = await page.screenshot({
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      type: 'png',
    })
    const fileName = `${capture.id}.png`
    const target = path.join(screenshotRoot, fileName)
    const png = inspectPng(buffer, target)
    assert.equal(png.width, capture.width, `${capture.id} screenshot width is incorrect`)
    assert.equal(png.height, capture.height, `${capture.id} screenshot height is incorrect`)
    await fs.writeFile(target, buffer)
    descriptors.push({
      id: capture.id,
      path: `screenshots/${fileName}`,
      viewport: { width: capture.width, height: capture.height },
      theme: capture.theme,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      captured_at: new Date().toISOString(),
      step: 'acceptance_capture',
      inspector_open: capture.inspectorOpen,
      geometry,
    })
  }
  return descriptors
}

function assertPersistedCanvasState(state, expected) {
  assert.equal(state.mode, 'free', 'persisted free canvas mode is incorrect')
  assert.equal(state.background, 'lines', 'persisted free canvas background is incorrect')
  assertExactIdSet(state.nodes.map((node) => node.id), expected.nodeIds, 'persisted free canvas nodes')
  assertExactIdSet(state.edges.map((edge) => edge.id), expected.edgeIds, 'persisted free canvas edges')
  const text = state.nodes.find((node) => String(node.id) === String(expected.textNodeId))
  assert.equal(text?.content, expected.textContent, 'persisted browser-edited text is incorrect')
  const config = state.nodes.find((node) => String(node.id) === String(expected.configNodeId))
  assert.equal(config?.status, 'idle', 'persisted config node status is incorrect')
  for (const [nodeId, type] of [[expected.imageNodeId, 'image'], [expected.videoNodeId, 'video']]) {
    const mediaNode = state.nodes.find((node) => String(node.id) === String(nodeId))
    assert.equal(mediaNode?.type, type, `persisted ${type} node type is incorrect`)
  }
  for (const expectedEdge of expected.edges) {
    const edge = state.edges.find((item) => String(item.id) === String(expectedEdge.id))
    assert.deepEqual(
      { source: String(edge?.source), target: String(edge?.target) },
      { source: String(expectedEdge.source), target: String(expectedEdge.target) },
      `persisted edge ${expectedEdge.id} endpoints are incorrect`,
    )
  }
  assert.equal(['x', 'y', 'zoom'].every((key) => Number.isFinite(Number(state.viewport?.[key]))), true, 'persisted viewport is invalid')
}

async function assertReloadedBrowserState({ page, apiRequest, dramaId, expected }) {
  const persisted = await readFreeCanvas(apiRequest, dramaId)
  assertPersistedCanvasState(persisted, expected)
  const modeSwitch = page.getByRole('group', { name: '画布模式' })
  await expectPressed(modeSwitch.getByRole('button', { name: '自由', exact: true }), 'true')
  assert.equal(await page.locator('.free-canvas-node[data-free-node-id]').count(), expected.nodeIds.length, 'reloaded browser node count is incorrect')
  for (const nodeId of expected.nodeIds) await exactFreeNode(page, nodeId)
  for (const edgeId of expected.edgeIds) {
    const edge = page.locator(`.vue-flow__edge[data-id=${JSON.stringify(String(edgeId))}]`)
    await assertUniqueLocator(edge, `reloaded edge ${edgeId}`)
  }
  const textNode = await exactFreeNode(page, expected.textNodeId)
  await textNode.dblclick()
  const editor = textNode.getByRole('textbox', { name: '文本内容', exact: true })
  await assertUniqueLocator(editor, 'reloaded exact text editor')
  assert.equal(await editor.inputValue(), expected.textContent, 'reloaded text editor content is incorrect')
  const pane = page.locator('.vue-flow__pane')
  await assertUniqueLocator(pane, 'free canvas pane')
  await pane.click({ position: { x: 16, y: 16 } })

  const configNode = await exactFreeNode(page, expected.configNodeId)
  assert.match(await configNode.textContent(), /需要配置/, 'reloaded config node must remain blocked')
  await assertUniqueLocator(
    configNode.getByRole('button', { name: '打开 AI 配置', exact: true }),
    'reloaded config entry',
  )
  const background = page.locator('.vue-flow__background')
  await assertUniqueLocator(background, 'free canvas background')
  assert.ok(await background.locator('path').count() > 0, 'reloaded free canvas must render the lines background')
  const renderedViewport = await readRenderedViewport(page)
  assert.ok(renderedViewport, 'reloaded viewport transform is unavailable')
  assert.ok(Math.abs(renderedViewport.zoom - Number(persisted.viewport.zoom)) < 0.04, 'reloaded viewport zoom does not match the API')
  assert.ok(Math.abs(renderedViewport.x - Number(persisted.viewport.x)) < 4, 'reloaded viewport x does not match the API')
  assert.ok(Math.abs(renderedViewport.y - Number(persisted.viewport.y)) < 4, 'reloaded viewport y does not match the API')
  return persisted
}

async function exerciseFreeCanvas({
  page,
  apiRequest,
  primaryFixture,
  isolationFixture,
  seeded,
  verifyFixture,
  services = SERVICES,
  evidenceRoot = ACCEPTANCE_ROOT,
  recordStep = () => {},
  stamp = Date.now(),
}) {
  const primaryId = Number(primaryFixture.drama.id)
  const isolationId = Number(isolationFixture.drama.id)
  const textContent = `Free canvas browser edit ${stamp}`
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const providerIsolation = await installProviderIsolation(page)
  let screenshots = []

  try {
    await verifyFixture(primaryFixture)
    await verifyFixture(isolationFixture)
    const opened = await openFixtureCanvas({ page, fixture: primaryFixture, verifyFixture, services })
    await expectPressed(opened.modeSwitch.getByRole('button', { name: '制作', exact: true }), 'true')
    recordStep('opened_existing_project_canvas')

    await opened.modeSwitch.getByRole('button', { name: '自由', exact: true }).click()
    await expectPressed(opened.modeSwitch.getByRole('button', { name: '自由', exact: true }), 'true')
    await assertUniqueLocator(page.locator('.vue-flow'), 'free canvas surface')
    await waitForPersistedFreeCanvas(apiRequest, primaryId, (state) => state.mode === 'free', 'free canvas mode switch')
    recordStep('switched_to_free_mode')

    const textCreated = await createNodeAndResolve({
      page,
      apiRequest,
      dramaId: primaryId,
      type: 'text',
      action: () => createFreeNodeFromMenu(page, '文本'),
    })
    const textNodeId = String(textCreated.node.id)
    const textNode = await exactFreeNode(page, textNodeId)
    await textNode.dblclick()
    const editor = textNode.getByRole('textbox', { name: '文本内容', exact: true })
    await assertUniqueLocator(editor, 'exact text node editor')
    await editor.fill(textContent)
    const pane = page.locator('.vue-flow__pane')
    await assertUniqueLocator(pane, 'free canvas pane')
    await pane.click({ position: { x: 18, y: 18 } })
    await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.some((node) => String(node.id) === textNodeId && node.content === textContent),
      'in-place text edit',
    )
    recordStep('created_and_edited_text_node')
    await closeInspector(page)
    await waitForUiSaveSettled(page)

    const configCreated = await createNodeAndResolve({
      page,
      apiRequest,
      dramaId: primaryId,
      type: 'config',
      action: () => createFreeNodeFromMenu(page, '配置'),
    })
    const configNodeId = String(configCreated.node.id)
    const configNode = await exactFreeNode(page, configNodeId)
    await waitForValue(
      () => configNode.textContent(),
      (content) => String(content).includes('需要配置'),
      'missing provider config state',
    )
    await assertUniqueLocator(
      configNode.getByRole('button', { name: '打开 AI 配置', exact: true }),
      'config node AI configuration entry',
    )
    assert.ok(providerIsolation.hits.configs > 0, 'isolated missing AI configuration list was not requested')
    recordStep('verified_missing_configuration')
    await closeInspector(page)
    await moveExactNodeAwayFrom({
      page,
      apiRequest,
      dramaId: primaryId,
      nodeId: configNodeId,
      anchorNodeId: textNodeId,
    })
    await clickUniqueButton(page, '适配视图')
    const connected = await connectExactNodes({
      page,
      apiRequest,
      dramaId: primaryId,
      sourceId: textNodeId,
      targetId: configNodeId,
    })
    const originalEdge = connected.edge
    recordStep('created_config_node_and_connection')

    await marqueeSelectExactNodes({
      page,
      nodeIds: [textNodeId, configNodeId],
    })
    await assertExactSelectedFreeNodeIds(page, [textNodeId, configNodeId])
    recordStep('marquee_selected_exact_nodes')
    const beforePaste = await readFreeCanvas(apiRequest, primaryId)
    await page.keyboard.press(`${modifier}+C`)
    await page.keyboard.press(`${modifier}+V`)
    const pasted = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === beforePaste.nodes.length + 2 && state.edges.length === beforePaste.edges.length + 1,
      'free canvas copy and paste',
    )
    const cloneNodeIds = setDifference(
      stringSet(pasted.nodes.map((node) => node.id)),
      stringSet(beforePaste.nodes.map((node) => node.id)),
    )
    const cloneEdgeIds = setDifference(
      stringSet(pasted.edges.map((edge) => edge.id)),
      stringSet(beforePaste.edges.map((edge) => edge.id)),
    )
    assert.equal(cloneNodeIds.length, 2, 'paste must create exactly two clone node IDs')
    assert.equal(cloneEdgeIds.length, 1, 'paste must create exactly one clone edge ID')
    await assertExactSelectedFreeNodeIds(page, cloneNodeIds)
    const cloneNodes = cloneNodeIds.map((id) => pasted.nodes.find((node) => String(node.id) === id))
    assert.deepEqual(cloneNodes.map((node) => node?.type).sort(), ['config', 'text'], 'pasted node types are incorrect')
    const clonedText = cloneNodes.find((node) => node?.type === 'text')
    const clonedConfig = cloneNodes.find((node) => node?.type === 'config')
    assert.equal(clonedText?.content, textContent, 'pasted text content is incorrect')
    const clonedEdge = pasted.edges.find((edge) => String(edge.id) === cloneEdgeIds[0])
    assert.deepEqual(
      { source: String(clonedEdge?.source), target: String(clonedEdge?.target) },
      { source: String(clonedText?.id), target: String(clonedConfig?.id) },
      'pasted edge endpoints were not rewritten to the exact clone IDs',
    )
    for (const cloneId of cloneNodeIds) await exactFreeNode(page, cloneId)
    recordStep('copied_and_pasted_subgraph')

    const fullNodeIds = pasted.nodes.map((node) => String(node.id))
    const fullEdgeIds = pasted.edges.map((edge) => String(edge.id))
    await page.bringToFront()
    await clickUniqueButton(page, '删除所选节点')
    const deleted = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === 2 && state.edges.length === 1,
      'delete pasted selection',
    )
    assertExactIdSet(deleted.nodes.map((node) => node.id), [textNodeId, configNodeId], 'deleted state nodes')
    assertExactIdSet(deleted.edges.map((edge) => edge.id), [originalEdge.id], 'deleted state edges')
    await clickUniqueButton(page, '撤销')
    const undone = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === 4 && state.edges.length === 2,
      'undo pasted selection deletion',
    )
    assertExactIdSet(undone.nodes.map((node) => node.id), fullNodeIds, 'undo state nodes')
    assertExactIdSet(undone.edges.map((edge) => edge.id), fullEdgeIds, 'undo state edges')
    await clickUniqueButton(page, '重做')
    const redone = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === 2 && state.edges.length === 1,
      'redo pasted selection deletion',
    )
    assertExactIdSet(redone.nodes.map((node) => node.id), [textNodeId, configNodeId], 'redo state nodes')
    await clickUniqueButton(page, '撤销')
    const restored = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === 4 && state.edges.length === 2,
      'restore pasted selection for persistence',
    )
    assertExactIdSet(restored.nodes.map((node) => node.id), fullNodeIds, 'restored state nodes')
    assertExactIdSet(restored.edges.map((edge) => edge.id), fullEdgeIds, 'restored state edges')
    recordStep('verified_delete_undo_redo')

    const imageCreated = await createNodeAndResolve({
      page,
      apiRequest,
      dramaId: primaryId,
      type: 'image',
      action: () => createFreeNodeFromMenu(page, '图片'),
    })
    const imageNodeId = String(imageCreated.node.id)
    const imageNode = await exactFreeNode(page, imageNodeId)
    assert.equal(
      String(await imageNode.getAttribute('aria-label')).startsWith('图片：'),
      true,
      'created image node does not expose its accessible type and name',
    )

    const videoCreated = await createNodeAndResolve({
      page,
      apiRequest,
      dramaId: primaryId,
      type: 'video',
      action: () => createFreeNodeFromMenu(page, '视频'),
    })
    const videoNodeId = String(videoCreated.node.id)
    const videoNode = await exactFreeNode(page, videoNodeId)
    assert.equal(
      String(await videoNode.getAttribute('aria-label')).startsWith('视频：'),
      true,
      'created video node does not expose its accessible type and name',
    )
    await videoNode.scrollIntoViewIfNeeded()
    await videoNode.locator('.node-header').click({ force: true })
    await assertExactSelectedFreeNodeIds(page, [videoNodeId])
    await assertUniqueLocator(
      page.getByRole('complementary', { name: '自由节点检查器', exact: true }),
      'selected video node inspector',
    )
    await closeInspector(page)
    recordStep('created_image_and_video_nodes')

    const keyboardActivations = []
    for (const key of ['Enter', 'Space']) {
      await imageNode.focus()
      assert.equal(
        await imageNode.evaluate((element) => document.activeElement === element),
        true,
        `image node did not receive browser focus before ${key} activation`,
      )
      await page.keyboard.press(key)
      await assertExactSelectedFreeNodeIds(page, [imageNodeId])
      assert.equal(
        await imageNode.evaluate((element) => document.activeElement === element),
        true,
        `${key} activation did not retain focus on the exact free node`,
      )
      await assertUniqueLocator(
        page.getByRole('complementary', { name: '自由节点检查器', exact: true }),
        `${key}-activated image node inspector`,
      )
      keyboardActivations.push({
        key,
        node_id: imageNodeId,
        focus_retained: true,
        exact_selection_verified: true,
        inspector_open_verified: true,
      })
      await closeInspector(page)
    }
    recordStep('keyboard_activated_free_node')

    await waitForUiSaveSettled(page)
    const savePattern = `**/api/v1/dramas/${primaryId}/canvas-layout`
    let saveFailureCount = 0
    const saveHandler = async (route) => {
      if (route.request().method() === 'PUT' && saveFailureCount === 0) {
        saveFailureCount += 1
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'E2E_SAVE_REJECTED', message: 'E2E canvas save rejected' } }),
        })
      }
      return route.continue()
    }
    await page.route(savePattern, saveHandler)
    try {
      await clickUniqueButton(page, '切换背景')
      const failedStatus = page.getByText('保存失败', { exact: true })
      await assertUniqueLocator(failedStatus, 'canvas save failure status')
      await page.unroute(savePattern, saveHandler)
      await clickUniqueButton(page, '重试保存画布')
      const savedStatus = page.getByText('已保存', { exact: true })
      await assertUniqueLocator(savedStatus, 'canvas save recovered status')
    } finally {
      await page.unroute(savePattern, saveHandler).catch(() => {})
    }
    assert.equal(saveFailureCount, 1, 'canvas layout save failure must be injected exactly once')
    await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.background === 'lines',
      'recovered background save',
    )
    recordStep('recovered_canvas_save')

    const renderedBeforeZoom = await readRenderedViewport(page)
    await clickUniqueButton(page, '放大画布')
    const renderedZoomed = await waitForValue(
      () => readRenderedViewport(page),
      (viewport) => Math.abs(Number(viewport.zoom) - Number(renderedBeforeZoom.zoom)) > 0.01,
      'browser zoom transform',
    )

    const paneBox = await pane.boundingBox()
    assert.ok(paneBox, 'canvas pane must have browser coordinates')
    const panStart = await findBlankPanePoint(page, paneBox)
    await page.mouse.click(panStart.x, panStart.y, { button: 'left' })
    await page.keyboard.down('Space')
    await page.mouse.move(panStart.x, panStart.y)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(panStart.x + 140, panStart.y + 90, { steps: 12 })
    await page.mouse.up({ button: 'left' })
    await page.keyboard.up('Space')
    const renderedPanned = await waitForValue(
      () => readRenderedViewport(page),
      (viewport) => (
        Math.abs(Number(viewport.x) - Number(renderedZoomed.x)) > 20
        || Math.abs(Number(viewport.y) - Number(renderedZoomed.y)) > 20
      ),
      'browser pan transform',
    )
    const viewportState = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => viewportWithinTolerance(state.viewport, renderedPanned),
      'panned viewport save',
    ).catch(async (error) => {
      const observed = await readFreeCanvas(apiRequest, primaryId)
      throw new Error(
        `${error.message}; browser ${viewportSummary(renderedPanned)}; API ${viewportSummary(observed.viewport)}`,
      )
    })

    const uploadBefore = await readFreeCanvas(apiRequest, primaryId)
    const uploadPattern = '**/api/v1/assets/upload'
    let uploadFailureCount = 0
    const uploadHandler = async (route) => {
      if (route.request().method() === 'POST' && uploadFailureCount === 0) {
        uploadFailureCount += 1
        return route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'E2E_UPLOAD_REJECTED', message: UPLOAD_FAILURE_MESSAGE } }),
        })
      }
      return route.continue()
    }
    await page.route(uploadPattern, uploadHandler)
    try {
      const uploadInput = page.locator('[aria-label="自由画布素材"] input[type="file"]')
      assert.equal(await uploadInput.count(), 1, 'free canvas upload input must be unique')
      await uploadInput.setInputFiles({ name: 'e2e-safe-upload.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
      await waitForMessage(page, UPLOAD_FAILURE_MESSAGE)
      await waitForValue(() => Promise.resolve(uploadFailureCount), (count) => count === 1, 'safe upload failure injection')
    } finally {
      await page.unroute(uploadPattern, uploadHandler)
    }
    const uploadAfter = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === uploadBefore.nodes.length,
      'upload failure node isolation',
    )
    assertExactIdSet(uploadAfter.nodes.map((node) => node.id), uploadBefore.nodes.map((node) => node.id), 'upload failure nodes')
    assert.equal(uploadFailureCount, 1, 'upload failure must be injected exactly once')
    recordStep('rejected_unsafe_upload')

    const referenceCreated = await createNodeAndResolve({
      page,
      apiRequest,
      dramaId: primaryId,
      type: 'reference',
      action: async () => {
        const characterButton = page.getByRole('button', { name: seeded.character.name, exact: true })
        await assertUniqueLocator(characterButton, 'fixture character library item')
        await characterButton.click()
      },
    })
    const referenceNodeId = String(referenceCreated.node.id)
    const referenceNode = await exactFreeNode(page, referenceNodeId)
    await referenceNode.click()
    const inspector = page.getByRole('complementary', { name: '自由节点检查器' })
    await assertUniqueLocator(inspector, 'reference node inspector')
    const conversionTarget = inspector.getByRole('combobox', { name: '转换目标', exact: true })
    await assertUniqueLocator(conversionTarget, 'reference conversion target')
    await conversionTarget.click()
    const characterOption = page.getByRole('option', { name: `角色 · ${seeded.character.name}`, exact: true })
    await assertUniqueLocator(characterOption, 'fixture character conversion option')
    await characterOption.click()
    const convertButton = inspector.getByRole('button', { name: '转换引用', exact: true })
    await assertUniqueLocator(convertButton, 'convert reference button')
    await convertButton.click()
    const confirm = page.getByRole('button', { name: '确认转换', exact: true })
    await assertUniqueLocator(confirm, 'confirm conversion button')
    await confirm.click()
    await waitForMessage(page, '已转换为制作参考')
    const convertedCharacter = await waitForValue(
      () => apiRequest(`/characters/${seeded.character.id}`),
      (character) => (
        String(character?.description || '').includes('[自由画布参考]')
        && String(character?.description || '').includes(seeded.character.name)
      ),
      'production reference conversion',
    )
    assert.notEqual(convertedCharacter.description, seeded.characterDescription, 'conversion did not update the production target')
    recordStep('created_and_converted_production_reference')

    const referenceState = await readFreeCanvas(apiRequest, primaryId)
    const retainedReference = referenceState.nodes.find((node) => String(node.id) === referenceNodeId)
    assert.ok(retainedReference, 'converted character reference node was not retained')
    const referenceTitle = String(retainedReference.title || '').trim()
    const referenceContent = String(retainedReference.content || '').trim()
    assert.ok(referenceTitle && referenceContent, 'storyboard conversion fixture reference text is incomplete')
    const storyboardBefore = await apiRequest(`/storyboards/${seeded.storyboard.id}`)
    const expectedStoryboardDescription = `${String(storyboardBefore.description || '').trim()}\n\n[自由画布参考]\n${referenceTitle}\n${referenceContent}`
    await conversionTarget.click()
    const storyboardOption = page.getByRole('option', {
      name: `分镜 · ${seeded.episode.title} · ${seeded.storyboard.title}`,
      exact: true,
    })
    await assertUniqueLocator(storyboardOption, 'fixture storyboard conversion option')
    await storyboardOption.click()
    await convertButton.click()
    await assertUniqueLocator(confirm, 'confirm storyboard conversion button')
    await confirm.click()
    const convertedStoryboard = await waitForValue(
      () => apiRequest(`/storyboards/${seeded.storyboard.id}`),
      (storyboard) => storyboard?.description === expectedStoryboardDescription,
      'storyboard production reference conversion',
    )
    assert.equal(convertedStoryboard.description, expectedStoryboardDescription, 'storyboard conversion did not append the exact free reference')
    const storyboardLinkedState = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.some((node) => (
        String(node.id) === referenceNodeId
        && Number(node.storyboard_ref ?? node.storyboardId) === Number(seeded.storyboard.id)
      )),
      'storyboard conversion reference retention',
    )
    assert.ok(storyboardLinkedState.nodes.some((node) => String(node.id) === referenceNodeId), 'storyboard conversion removed the free node')
    await exactFreeNode(page, referenceNodeId)
    recordStep('converted_storyboard_reference')

    const finalBeforeIsolation = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === 7 && state.edges.length === 2 && state.background === 'lines',
      'final populated free canvas',
    )
    const finalNodeIds = finalBeforeIsolation.nodes.map((node) => String(node.id))
    const finalEdgeIds = finalBeforeIsolation.edges.map((edge) => String(edge.id))
    const finalEdges = finalBeforeIsolation.edges.map((edge) => ({
      id: String(edge.id),
      source: String(edge.source),
      target: String(edge.target),
    }))
    assertPersistedCanvasState(finalBeforeIsolation, {
      nodeIds: finalNodeIds,
      edgeIds: finalEdgeIds,
      edges: finalEdges,
      textNodeId,
      textContent,
      configNodeId,
      imageNodeId,
      videoNodeId,
    })
    assert.ok(
      viewportWithinTolerance(finalBeforeIsolation.viewport, viewportState.viewport, { position: 0.001, zoom: 0.001 }),
      'final viewport drifted before isolation',
    )

    await verifyFixture(isolationFixture)
    const isolated = await openFixtureCanvas({ page, fixture: isolationFixture, verifyFixture, services })
    await expectPressed(isolated.modeSwitch.getByRole('button', { name: '制作', exact: true }), 'true')
    await isolated.modeSwitch.getByRole('button', { name: '自由', exact: true }).click()
    await expectPressed(isolated.modeSwitch.getByRole('button', { name: '自由', exact: true }), 'true')
    const isolationState = await waitForPersistedFreeCanvas(
      apiRequest,
      isolationId,
      (state) => state.mode === 'free' && state.nodes.length === 0 && state.edges.length === 0,
      'isolation fixture free canvas',
    )
    assert.equal(isolationState.nodes.length, 0, 'isolation fixture unexpectedly contains primary nodes')
    assert.equal(await page.locator('.free-canvas-node[data-free-node-id]').count(), 0, 'isolation browser contains primary free nodes')
    for (const nodeId of finalNodeIds) assert.equal(await freeNodeLocator(page, nodeId).count(), 0, `primary node ${nodeId} leaked into isolation fixture`)

    await verifyFixture(primaryFixture)
    await openFixtureCanvas({ page, fixture: primaryFixture, verifyFixture, services })
    const restoredPrimary = await waitForPersistedFreeCanvas(
      apiRequest,
      primaryId,
      (state) => state.nodes.length === finalNodeIds.length && state.edges.length === finalEdgeIds.length,
      'primary fixture project switch restore',
    )
    assertPersistedCanvasState(restoredPrimary, {
      nodeIds: finalNodeIds,
      edgeIds: finalEdgeIds,
      edges: finalEdges,
      textNodeId,
      textContent,
      configNodeId,
      imageNodeId,
      videoNodeId,
    })
    recordStep('verified_project_isolation')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await assertPageFixtureIdentity({ page, fixture: primaryFixture, verifyFixture, services })
    const reloaded = await assertReloadedBrowserState({
      page,
      apiRequest,
      dramaId: primaryId,
      expected: {
        nodeIds: finalNodeIds,
        edgeIds: finalEdgeIds,
        edges: finalEdges,
        textNodeId,
        textContent,
        configNodeId,
        imageNodeId,
        videoNodeId,
      },
    })
    recordStep('verified_persistence_after_refresh')

    screenshots = await captureAcceptanceScreenshots({
      page,
      fixture: primaryFixture,
      verifyFixture,
      services,
      evidenceRoot,
      expectedNodeIds: finalNodeIds,
      inspectorNodeId: configNodeId,
    })
    assert.equal(screenshots.length, REQUIRED_CAPTURES.length, 'acceptance screenshot matrix is incomplete')
    recordStep('captured_acceptance_screenshots')

    return {
      completed: true,
      primary_drama_id: primaryId,
      isolation_drama_id: isolationId,
      node_ids: finalNodeIds,
      edge_ids: finalEdgeIds,
      text_node_id: textNodeId,
      config_node_id: configNodeId,
      image_node_id: imageNodeId,
      video_node_id: videoNodeId,
      reference_node_id: referenceNodeId,
      keyboard_activations: keyboardActivations,
      marquee_selected_node_ids: [textNodeId, configNodeId],
      clone_node_ids: cloneNodeIds,
      edge_endpoints: finalEdges,
      text_sha256: crypto.createHash('sha256').update(textContent).digest('hex'),
      mode: reloaded.mode,
      background: reloaded.background,
      viewport: {
        x: Number(reloaded.viewport.x),
        y: Number(reloaded.viewport.y),
        zoom: Number(reloaded.viewport.zoom),
      },
      config_status: String(reloaded.nodes.find((node) => String(node.id) === configNodeId)?.status || ''),
      config_runtime_status: 'blocked',
      storyboard_target_id: Number(seeded.storyboard.id),
      storyboard_description_sha256: crypto.createHash('sha256').update(expectedStoryboardDescription).digest('hex'),
      marquee_selection_verified: true,
      copy_paste_verified: true,
      delete_undo_redo_verified: true,
      save_recovery_verified: true,
      upload_failure_verified: true,
      image_interaction_verified: true,
      video_interaction_verified: true,
      conversion_verified: true,
      storyboard_conversion_verified: true,
      isolation_verified: true,
      screenshots,
    }
  } finally {
    await providerIsolation.dispose().catch(() => {})
  }
}

function createCleanSourceBinding(head, porcelainStatus) {
  const revision = String(head || '').trim()
  assert.match(revision, /^[0-9a-f]{40,64}$/i, 'free canvas evidence requires a full Git HEAD')
  assert.equal(String(porcelainStatus || '').trim(), '', 'free canvas evidence requires a clean source tree')
  return { head: revision, worktree_state: 'clean' }
}

function validateCleanSourceBinding(binding) {
  assert.equal(binding?.worktree_state, 'clean', 'free canvas evidence source tree must be clean')
  return createCleanSourceBinding(binding?.head, '')
}

function getCleanSourceBinding() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
  const porcelainStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  return createCleanSourceBinding(revision, porcelainStatus)
}

async function resetEvidenceRoot(evidenceRoot) {
  const root = path.resolve(evidenceRoot)
  const expectedRoot = path.resolve(ACCEPTANCE_ROOT)
  assert.equal(root, expectedRoot, 'free canvas evidence root must be the exact repository-owned directory')
  assert.notEqual(root, path.parse(root).root, 'refusing to reset a filesystem root')
  const projectReal = await fs.realpath(PROJECT_ROOT)
  const ownedParents = [
    path.join(PROJECT_ROOT, 'artifacts'),
    PRODUCTION_EVIDENCE_ROOT,
  ]
  for (const ownedParent of ownedParents) {
    try {
      const stat = await fs.lstat(ownedParent)
      assert.equal(stat.isSymbolicLink(), false, 'repository evidence parent must not be a symbolic link')
      assert.equal(stat.isDirectory(), true, 'repository evidence parent must be a directory')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await fs.mkdir(ownedParent)
    }
  }
  const ownerReal = await fs.realpath(PRODUCTION_EVIDENCE_ROOT)
  const ownerRelative = path.relative(projectReal, ownerReal)
  assert.equal(path.isAbsolute(ownerRelative), false, 'repository evidence parent resolves outside the project')
  assert.equal(ownerRelative.startsWith(`..${path.sep}`) || ownerRelative === '..', false, 'repository evidence parent resolves outside the project')
  assert.equal(
    ownerRelative.toLowerCase(),
    path.join('artifacts', 'e2e-production').toLowerCase(),
    'repository evidence parent is not the canonical production evidence directory',
  )
  try {
    const stat = await fs.lstat(root)
    assert.equal(stat.isSymbolicLink(), false, 'free canvas evidence directory must not be a symbolic link')
    assert.equal(stat.isDirectory(), true, 'free canvas evidence path must be a directory')
    const rootReal = await fs.realpath(root)
    assert.equal(path.relative(ownerReal, rootReal).toLowerCase(), 'free-canvas', 'free canvas evidence directory resolves outside its owner')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await removeFixtureTree(root, { force: true })
  await fs.mkdir(root)
  return root
}

async function writeEvidenceManifest(evidenceRoot, manifest) {
  const temporary = path.join(evidenceRoot, 'manifest.json.tmp')
  const target = path.join(evidenceRoot, 'manifest.json')
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, target)
  return target
}

async function captureFailureEvidence({ page, evidenceRoot = ACCEPTANCE_ROOT, fixtures = [], verifyFixture, services = SERVICES }) {
  if (!page?.url || !page?.screenshot || !verifyFixture) return null
  let current
  try {
    current = new URL(page.url())
  } catch (_) {
    return null
  }
  const match = /^\/film\/(\d+)\/canvas$/.exec(current.pathname)
  if (!match || current.origin !== services.frontendUrl || current.search || current.hash) return null
  const fixture = fixtures.find((item) => Number(item?.drama?.id) === Number(match[1]))
  if (!fixture) return null
  await assertPageFixtureIdentity({ page, fixture, verifyFixture, services })
  const buffer = await page.screenshot({ fullPage: false, animations: 'disabled', caret: 'hide', type: 'png' })
  const viewport = page.viewportSize?.() || { width: 0, height: 0 }
  const target = path.join(evidenceRoot, 'failure.png')
  await fs.writeFile(target, buffer)
  return {
    id: 'failure',
    path: 'failure.png',
    viewport,
    theme: 'unknown',
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    captured_at: new Date().toISOString(),
    step: 'failure_capture',
  }
}

async function main({
  apiRequest = apiFetch,
  frontendApiRequest: frontendRequest = frontendApiFetch,
  launchBrowser = (options) => chromium.launch(options),
  fixtureFactory = createFixture,
  fixtureSeeder = seedPrimaryFixture,
  identityGuard = assertFixtureIdentity,
  fixturePurger = smokeHelpers.runDockerFixturePurge,
  browserFlow = exerciseFreeCanvas,
  sourceBindingProvider = getCleanSourceBinding,
  logger = console,
  now = Date.now,
  evidenceRoot = ACCEPTANCE_ROOT,
  evidenceRootResetter = resetEvidenceRoot,
  ensureServices = assertServicesReachable,
  services = SERVICES,
} = {}) {
  const sourceBinding = validateCleanSourceBinding(await sourceBindingProvider())
  const root = await evidenceRootResetter(evidenceRoot)
  const cleanupActions = []
  const cleanupFixtures = []
  const fixtures = []
  const steps = []
  let page = null
  let primaryError = null
  let flow = null
  let screenshots = []
  let canvasUrl = ''
  let sourceBindingError = null
  const recordStep = (name, status = 'passed') => steps.push({ name, status, at: new Date().toISOString() })
  const verifyFixture = (fixture) => identityGuard({
    apiRequest,
    frontendApiRequest: frontendRequest,
    dramaId: fixture.drama.id,
    expectedTitle: fixture.title,
  })
  const registerFixtureCleanup = (fixture) => {
    const evidence = {
      drama_id: Number(fixture.drama.id),
      title: fixture.title,
      verified: false,
    }
    cleanupFixtures.push(evidence)
    smokeHelpers.registerCleanup(cleanupActions, `hard purge drama ${fixture.drama.id}`, async () => {
      await purgeFixtureSafely({ fixture, assertIdentity: verifyFixture, fixturePurger })
      evidence.verified = true
    })
  }

  try {
    await ensureServices()
    recordStep('connected_to_local_services')

    const stamp = now()
    const primaryFixture = await fixtureFactory(apiRequest, stamp, 'primary')
    fixtures.push(primaryFixture)
    registerFixtureCleanup(primaryFixture)
    await verifyFixture(primaryFixture)
    const seeded = await fixtureSeeder(apiRequest, primaryFixture, stamp)
    await verifyFixture(primaryFixture)
    recordStep('created_primary_fixture_data')

    const isolationFixture = await fixtureFactory(apiRequest, stamp + 1, 'isolation')
    fixtures.push(isolationFixture)
    registerFixtureCleanup(isolationFixture)
    await verifyFixture(isolationFixture)
    recordStep('created_isolation_fixture')
    canvasUrl = `${services.frontendUrl}/film/${primaryFixture.drama.id}/canvas`

    const browser = await launchBrowser(buildBrowserLaunchOptions())
    smokeHelpers.registerCleanup(cleanupActions, 'browser', () => browser.close())
    page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    flow = await runBrowserFlow(browserFlow, {
      page,
      apiRequest,
      frontendApiRequest: frontendRequest,
      primaryFixture,
      isolationFixture,
      seeded,
      verifyFixture,
      services,
      evidenceRoot: root,
      recordStep,
      stamp,
    })
    screenshots = flow.screenshots
  } catch (error) {
    primaryError = error
    recordStep('browser_flow_failed', 'failed')
    const failureScreenshot = await captureFailureEvidence({
      page,
      evidenceRoot: root,
      fixtures,
      verifyFixture,
      services,
    }).catch(() => null)
    if (failureScreenshot) screenshots = [failureScreenshot]
  }

  const cleanupLogger = {
    warn(message) {
      logger.warn(sanitizeEvidenceText(message, 300))
    },
  }
  const cleanupFailures = await smokeHelpers.runCleanup(cleanupActions, cleanupLogger)
  recordStep('cleanup', cleanupFailures.length ? 'failed' : 'passed')
  const cleanup = {
    status: cleanupFailures.length ? 'failed' : 'passed',
    fixtures: cleanupFixtures,
    failures: cleanupFailures,
  }
  const missingSteps = REQUIRED_STEP_NAMES.filter((name) => !steps.some((step) => step.name === name && step.status === 'passed'))
  if (!primaryError && cleanupFailures.length === 0 && missingSteps.length) {
    primaryError = new assert.AssertionError({
      message: 'successful browser flow omitted required evidence steps',
      actual: missingSteps,
      expected: [],
      operator: 'deepEqual',
    })
  }
  try {
    const finalSourceBinding = validateCleanSourceBinding(await sourceBindingProvider())
    assert.deepEqual(finalSourceBinding, sourceBinding, 'free canvas source HEAD changed during evidence generation')
  } catch (error) {
    sourceBindingError = error
  }
  const allErrors = [
    ...(primaryError ? [primaryError] : []),
    ...(sourceBindingError ? [sourceBindingError] : []),
    ...cleanupFailures.map(({ error }) => error),
  ]
  const finalError = allErrors.length === 0
    ? null
    : allErrors.length === 1
      ? allErrors[0]
      : new AggregateError(allErrors, 'Free canvas E2E or cleanup failed')
  const status = finalError ? 'failed' : 'passed'
  const manifest = buildEvidenceManifest({
    status,
    gitRevision: sourceBinding.head,
    sourceBinding,
    services,
    canvasUrl,
    steps,
    flow,
    cleanup,
    error: finalError,
    screenshots,
  })
  const manifestPath = await writeEvidenceManifest(root, manifest)

  if (finalError) {
    logger.error(`Free canvas E2E failed; sanitized evidence: ${manifestPath}`)
    throw finalError
  }

  logger.log(`Free canvas E2E passed; evidence: ${manifestPath}`)
  return { flow, cleanup, manifestPath }
}

module.exports = {
  ACCEPTANCE_ROOT,
  E2E_TITLE_PREFIX,
  REQUIRED_STEP_NAMES,
  apiFetch,
  assertBrowserFlowResult,
  assertFixtureIdentity,
  assertServicesReachable,
  buildBrowserLaunchOptions,
  buildEvidenceManifest,
  captureFailureEvidence,
  createFixture,
  createCleanSourceBinding,
  exerciseFreeCanvas,
  frontendApiFetch,
  main,
  purgeFixtureSafely,
  resetEvidenceRoot,
  resolveServiceUrls,
  runBrowserFlow,
  sanitizeEvidenceText,
  sanitizeEvidenceUrl,
  seedPrimaryFixture,
  viewportWithinTolerance,
  waitForPersistedFreeCanvas,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeEvidenceText(error?.message || error, 500))
    process.exitCode = 1
  })
}
