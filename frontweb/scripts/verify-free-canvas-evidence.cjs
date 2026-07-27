const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const { inspectPng } = require('./acceptance-report-contract.cjs')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_EVIDENCE_ROOT = path.join(
  PROJECT_ROOT,
  'artifacts',
  'e2e-production',
  'free-canvas',
)
const EVIDENCE_SCHEMA = 'localminidrama.free-canvas-e2e-evidence.v1'
const E2E_TITLE_PREFIX = 'E2E Novel2Anime '
const REQUIRED_CAPTURES = Object.freeze([
  { id: 'free-canvas-1280x720-light', width: 1280, height: 720, theme: 'light', inspectorOpen: false },
  { id: 'free-canvas-1280x720-dark', width: 1280, height: 720, theme: 'dark', inspectorOpen: true },
  { id: 'free-canvas-1366x768-light', width: 1366, height: 768, theme: 'light', inspectorOpen: false },
  { id: 'free-canvas-1366x768-dark', width: 1366, height: 768, theme: 'dark', inspectorOpen: true },
  { id: 'free-canvas-1440x900-light', width: 1440, height: 900, theme: 'light', inspectorOpen: false },
  { id: 'free-canvas-1440x900-dark', width: 1440, height: 900, theme: 'dark', inspectorOpen: true },
])
const REQUIRED_STEPS = Object.freeze([
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
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|token|secret|password|credential|cookie|headers?|query|response|stack)/i
const SENSITIVE_TEXT = /(?:authorization\s*[:=]|bearer\s+|api[_-]?key\s*[:=]|password\s*[:=]|[?&](?:token|api[_-]?key|secret)=)/i

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function createCleanSourceBinding(head, porcelainStatus) {
  const revision = String(head || '').trim()
  if (!/^[0-9a-f]{40,64}$/i.test(revision)) throw new Error('Evidence source binding requires a full Git HEAD')
  if (String(porcelainStatus || '').trim()) throw new Error('Evidence source binding requires a clean source tree')
  return { head: revision, worktree_state: 'clean' }
}

function validateCleanSourceBinding(binding) {
  if (binding?.worktree_state !== 'clean') throw new Error('Evidence source binding is not clean')
  return createCleanSourceBinding(binding?.head, '')
}

function getCleanSourceBinding() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  return createCleanSourceBinding(head, status)
}

function assertEvidenceSafe(value, location = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertEvidenceSafe(item, `${location}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && SENSITIVE_TEXT.test(value)) {
      throw new Error(`Sensitive text is not allowed in ${location}`)
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`Sensitive evidence field is not allowed: ${location}.${key}`)
    assertEvidenceSafe(child, `${location}.${key}`)
  }
}

function assertSafeEvidenceUrl(value, label) {
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    throw new Error(`${label} must be an absolute URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or fragments`)
  }
}

function assertFlowComplete(flow) {
  if (
    flow?.completed !== true
    || !Number.isSafeInteger(flow.primary_drama_id)
    || !Number.isSafeInteger(flow.isolation_drama_id)
    || flow.primary_drama_id <= 0
    || flow.isolation_drama_id <= 0
    || flow.primary_drama_id === flow.isolation_drama_id
    || !Array.isArray(flow.node_ids)
    || flow.node_ids.length < 7
    || new Set(flow.node_ids).size !== flow.node_ids.length
    || !Array.isArray(flow.edge_ids)
    || flow.edge_ids.length < 2
    || new Set(flow.edge_ids).size !== flow.edge_ids.length
  ) {
    throw new Error('Free canvas browser flow evidence is incomplete')
  }
  const nodeIds = new Set(flow.node_ids)
  const edgeIds = new Set(flow.edge_ids)
  const roleNodeIds = [
    flow.text_node_id,
    flow.config_node_id,
    flow.image_node_id,
    flow.video_node_id,
    flow.reference_node_id,
  ]
  if (
    !roleNodeIds.every((id) => nodeIds.has(id))
    || new Set(roleNodeIds).size !== roleNodeIds.length
    || !nodeIds.has(flow.keyboard_activated_node_id)
    || !['Enter', 'Space'].includes(flow.keyboard_activation_key)
    || !Array.isArray(flow.marquee_selected_node_ids)
    || flow.marquee_selected_node_ids.length !== 2
    || new Set(flow.marquee_selected_node_ids).size !== 2
    || !flow.marquee_selected_node_ids.every((id) => nodeIds.has(id))
    || !flow.marquee_selected_node_ids.includes(flow.text_node_id)
    || !flow.marquee_selected_node_ids.includes(flow.config_node_id)
    || !Array.isArray(flow.clone_node_ids)
    || flow.clone_node_ids.length !== 2
    || new Set(flow.clone_node_ids).size !== 2
    || !flow.clone_node_ids.every((id) => nodeIds.has(id))
    || !Array.isArray(flow.edge_endpoints)
    || flow.edge_endpoints.length !== flow.edge_ids.length
  ) {
    throw new Error('Free canvas browser flow node and edge identity evidence is incomplete')
  }
  for (const edge of flow.edge_endpoints) {
    if (!edgeIds.has(edge?.id) || !nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) {
      throw new Error('Free canvas browser flow edge endpoints are invalid')
    }
  }
  if (
    !/^[0-9a-f]{64}$/i.test(String(flow.text_sha256 || ''))
    || flow.mode !== 'free'
    || flow.background !== 'lines'
    || flow.config_status !== 'idle'
    || flow.config_runtime_status !== 'blocked'
    || !Number.isSafeInteger(flow.storyboard_target_id)
    || flow.storyboard_target_id <= 0
    || !/^[0-9a-f]{64}$/i.test(String(flow.storyboard_description_sha256 || ''))
    || !['x', 'y', 'zoom'].every((key) => Number.isFinite(flow.viewport?.[key]))
  ) {
    throw new Error('Free canvas browser flow persistence evidence is incomplete')
  }
  for (const key of [
    'marquee_selection_verified',
    'copy_paste_verified',
    'delete_undo_redo_verified',
    'save_recovery_verified',
    'upload_failure_verified',
    'image_interaction_verified',
    'video_interaction_verified',
    'keyboard_focus_verified',
    'keyboard_selection_verified',
    'conversion_verified',
    'storyboard_conversion_verified',
    'isolation_verified',
  ]) {
    if (flow[key] !== true) throw new Error(`Free canvas browser flow is missing ${key}`)
  }
}

async function readJson(file) {
  let text
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Evidence manifest must be a regular file: ${file}`)
    }
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing evidence manifest: ${file}`)
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`Evidence manifest is not valid JSON: ${file}`)
  }
}

function normalizedPath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right)
}

async function inspectEvidenceLayout(evidenceRoot) {
  const root = path.resolve(evidenceRoot)
  let rootStat
  try {
    rootStat = await fs.lstat(root)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing evidence root: ${root}`)
    throw error
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Evidence root must be a regular directory, not a symbolic link: ${root}`)
  }
  const rootReal = await fs.realpath(root)
  const screenshotRoot = path.join(root, 'screenshots')
  let screenshotRootStat
  try {
    screenshotRootStat = await fs.lstat(screenshotRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing screenshots directory: ${screenshotRoot}`)
    throw error
  }
  if (!screenshotRootStat.isDirectory() || screenshotRootStat.isSymbolicLink()) {
    throw new Error(`Screenshots directory must be a regular directory, not a symbolic link: ${screenshotRoot}`)
  }
  const screenshotRootReal = await fs.realpath(screenshotRoot)
  if (!samePath(path.dirname(screenshotRootReal), rootReal) || path.basename(screenshotRootReal) !== 'screenshots') {
    throw new Error('Screenshots directory resolves outside the evidence root')
  }
  return { root, rootReal, screenshotRoot, screenshotRootReal }
}

async function readScreenshot(layout, relativePath) {
  const target = path.resolve(layout.root, ...relativePath.split('/'))
  if (!samePath(path.dirname(target), layout.screenshotRoot)) {
    throw new Error(`Screenshot path escapes the canonical screenshots directory: ${relativePath}`)
  }
  let stat
  try {
    stat = await fs.lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing screenshot file: ${relativePath}`)
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Screenshot must be a regular file: ${relativePath}`)
  const targetReal = await fs.realpath(target)
  if (!samePath(path.dirname(targetReal), layout.screenshotRootReal)) {
    throw new Error(`Screenshot path resolves outside the evidence root: ${relativePath}`)
  }
  return { target, stat, buffer: await fs.readFile(target) }
}

async function verifyFreeCanvasEvidence(evidenceRoot = DEFAULT_EVIDENCE_ROOT, {
  sourceBindingProvider = getCleanSourceBinding,
} = {}) {
  const layout = await inspectEvidenceLayout(evidenceRoot)
  const manifest = await readJson(path.join(layout.root, 'manifest.json'))
  assertEvidenceSafe(manifest)
  if (manifest.schema !== EVIDENCE_SCHEMA) throw new Error('Free canvas evidence schema is invalid')
  if (manifest.status !== 'passed') throw new Error(`Free canvas E2E status is not passed: ${manifest.status || 'missing'}`)
  if (!Number.isFinite(Date.parse(manifest.generated_at))) throw new Error('Free canvas evidence generated time is invalid')
  if (!/^[0-9a-f]{40,64}$/i.test(String(manifest.git_revision || ''))) {
    throw new Error('Free canvas evidence Git revision is invalid')
  }
  const currentSource = validateCleanSourceBinding(await sourceBindingProvider())
  if (
    manifest.source?.worktree_state !== 'clean'
    || manifest.source?.head !== currentSource.head
    || manifest.git_revision !== currentSource.head
  ) {
    throw new Error('Free canvas evidence source binding does not match the current clean HEAD')
  }
  for (const key of ['frontend', 'backend', 'canvas']) assertSafeEvidenceUrl(manifest.urls?.[key], `urls.${key}`)
  const frontendUrl = new URL(manifest.urls.frontend)
  const canvasUrl = new URL(manifest.urls.canvas)
  if (
    canvasUrl.origin !== frontendUrl.origin
    || canvasUrl.pathname !== `/film/${manifest.flow?.primary_drama_id}/canvas`
  ) {
    throw new Error('Free canvas evidence URL does not match the primary flow fixture')
  }
  if (manifest.suite !== 'free-canvas') throw new Error('Free canvas evidence suite is invalid')
  if (!Array.isArray(manifest.steps)) {
    throw new Error('Free canvas evidence steps are missing')
  }
  for (const requiredStep of REQUIRED_STEPS) {
    const matches = manifest.steps.filter((step) => step?.name === requiredStep)
    if (matches.length !== 1 || matches[0].status !== 'passed' || !Number.isFinite(Date.parse(matches[0].at))) {
      throw new Error(`Free canvas evidence required browser step is missing or failed: ${requiredStep}`)
    }
  }
  assertFlowComplete(manifest.flow)
  if (manifest.cleanup?.status !== 'passed' || !Array.isArray(manifest.cleanup.fixtures) || manifest.cleanup.fixtures.length !== 2) {
    throw new Error('Free canvas evidence cleanup did not pass for both fixtures')
  }
  for (const fixture of manifest.cleanup.fixtures) {
    if (fixture?.verified !== true || !String(fixture.title || '').startsWith(E2E_TITLE_PREFIX)) {
      throw new Error('Free canvas cleanup fixture identity is invalid')
    }
  }
  const cleanupIds = manifest.cleanup.fixtures.map((fixture) => fixture.drama_id)
  if (
    new Set(cleanupIds).size !== 2
    || !cleanupIds.includes(manifest.flow.primary_drama_id)
    || !cleanupIds.includes(manifest.flow.isolation_drama_id)
  ) {
    throw new Error('Free canvas cleanup fixtures do not match both flow fixtures')
  }
  if (!Array.isArray(manifest.cleanup.failures) || manifest.cleanup.failures.length !== 0) {
    throw new Error('Free canvas cleanup evidence contains failures')
  }
  if (manifest.failure !== null) throw new Error('Passed free canvas evidence must not include a failure')

  const entries = Array.isArray(manifest.screenshots) ? manifest.screenshots : []
  if (entries.length !== REQUIRED_CAPTURES.length) throw new Error('Free canvas evidence must contain six screenshots')
  const entriesById = new Map(entries.map((entry) => [entry?.id, entry]))
  if (entriesById.size !== REQUIRED_CAPTURES.length) throw new Error('Free canvas screenshot IDs must be unique')

  for (const capture of REQUIRED_CAPTURES) {
    const entry = entriesById.get(capture.id)
    if (!entry) throw new Error(`Missing screenshot descriptor: ${capture.id}`)
    const expectedPath = `screenshots/${capture.id}.png`
    if (
      entry.path !== expectedPath
      || entry.theme !== capture.theme
      || entry.viewport?.width !== capture.width
      || entry.viewport?.height !== capture.height
      || entry.step !== 'acceptance_capture'
      || !Number.isFinite(Date.parse(entry.captured_at))
      || !Number.isSafeInteger(entry.bytes)
      || entry.bytes <= 0
      || !/^[0-9a-f]{64}$/i.test(String(entry.sha256 || ''))
    ) {
      throw new Error(`Screenshot descriptor is invalid: ${capture.id}`)
    }
    if (entry.inspector_open !== capture.inspectorOpen) {
      throw new Error(`Screenshot inspector state is invalid: ${capture.id}`)
    }
    if (
      entry.geometry?.node_count !== manifest.flow.node_ids.length
      || entry.geometry?.toolbar_visible !== true
      || entry.geometry?.minimap_visible !== true
      || entry.geometry?.sidebar_visible !== true
      || entry.geometry?.inspector_visible !== capture.inspectorOpen
    ) {
      throw new Error(`Screenshot inspector geometry is invalid: ${capture.id}`)
    }
    const file = await readScreenshot(layout, entry.path)
    if (file.buffer.length !== entry.bytes || file.stat.size !== entry.bytes) {
      throw new Error(`Screenshot byte count mismatch: ${capture.id}`)
    }
    if (sha256(file.buffer) !== entry.sha256) throw new Error(`Screenshot SHA-256 mismatch: ${capture.id}`)
    const png = inspectPng(file.buffer, file.target)
    if (png.width !== capture.width || png.height !== capture.height) {
      throw new Error(`Screenshot dimensions mismatch: ${capture.id}`)
    }
  }

  return { status: 'passed', screenshots: entries.length, gitRevision: manifest.git_revision }
}

module.exports = {
  DEFAULT_EVIDENCE_ROOT,
  EVIDENCE_SCHEMA,
  REQUIRED_CAPTURES,
  REQUIRED_STEPS,
  assertEvidenceSafe,
  createCleanSourceBinding,
  getCleanSourceBinding,
  verifyFreeCanvasEvidence,
}

if (require.main === module) {
  const evidenceRoot = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_EVIDENCE_ROOT
  verifyFreeCanvasEvidence(evidenceRoot)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
