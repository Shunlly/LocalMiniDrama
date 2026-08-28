import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const e2e = require('../scripts/e2e-free-canvas.cjs')
const { removeFixtureTree } = require('../scripts/fixture-cleanup.cjs')
const verifier = require('../scripts/verify-free-canvas-evidence.cjs')
const frontendPackage = require('../package.json')

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CLEAN_SOURCE_BINDING = { head: 'a'.repeat(40), worktree_state: 'clean' }
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const EXPECTED_EVIDENCE_ROOT = path.join(
  PROJECT_ROOT,
  'artifacts',
  'e2e-production',
  'free-canvas',
)
const CAPTURES = [
  ['free-canvas-1280x720-light', 1280, 720, 'light', false],
  ['free-canvas-1280x720-dark', 1280, 720, 'dark', true],
  ['free-canvas-1366x768-light', 1366, 768, 'light', false],
  ['free-canvas-1366x768-dark', 1366, 768, 'dark', true],
  ['free-canvas-1440x900-light', 1440, 900, 'light', false],
  ['free-canvas-1440x900-dark', 1440, 900, 'dark', true],
]
const REQUIRED_STEP_NAMES = [
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
]
const e2eSource = await readFile(new URL('../scripts/e2e-free-canvas.cjs', import.meta.url), 'utf8')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function createPng(width, height, salt = 0) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 1
  ihdr[9] = 0
  const rowBytes = Math.ceil(width / 8)
  const rows = []
  for (let row = 0; row < height; row += 1) {
    const pixels = Buffer.alloc(rowBytes)
    for (let column = 0; column < rowBytes; column += 1) {
      pixels[column] = (row * 31 + column * 17 + salt * 13) & 0xff
    }
    rows.push(Buffer.from([0]), pixels)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function createValidFlowEvidence() {
  return {
    completed: true,
    primary_drama_id: 41,
    isolation_drama_id: 42,
    node_ids: [
      'free:text:1',
      'free:config:2',
      'free:text:3',
      'free:config:4',
      'free:image:5',
      'free:video:6',
      'free:reference:7',
    ],
    edge_ids: ['free:edge:1', 'free:edge:2'],
    text_node_id: 'free:text:1',
    config_node_id: 'free:config:2',
    image_node_id: 'free:image:5',
    video_node_id: 'free:video:6',
    reference_node_id: 'free:reference:7',
    keyboard_activations: [
      {
        key: 'Enter',
        node_id: 'free:image:5',
        focus_retained: true,
        exact_selection_verified: true,
        inspector_open_verified: true,
      },
      {
        key: 'Space',
        node_id: 'free:image:5',
        focus_retained: true,
        exact_selection_verified: true,
        inspector_open_verified: true,
      },
    ],
    marquee_selected_node_ids: ['free:text:1', 'free:config:2'],
    clone_node_ids: ['free:text:3', 'free:config:4'],
    edge_endpoints: [
      { id: 'free:edge:1', source: 'free:text:1', target: 'free:config:2' },
      { id: 'free:edge:2', source: 'free:text:3', target: 'free:config:4' },
    ],
    text_sha256: 'd'.repeat(64),
    mode: 'free',
    background: 'lines',
    viewport: { x: 24, y: 32, zoom: 1.1 },
    config_status: 'idle',
    config_runtime_status: 'blocked',
    storyboard_target_id: 9,
    storyboard_description_sha256: 'e'.repeat(64),
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
  }
}

async function writeValidEvidence(root) {
  const screenshotRoot = path.join(root, 'screenshots')
  await mkdir(screenshotRoot, { recursive: true })
  const screenshots = []
  for (const [id, width, height, theme, inspectorOpen] of CAPTURES) {
    const bytes = createPng(width, height, width + height + theme.length)
    const relativePath = `screenshots/${id}.png`
    await writeFile(path.join(root, ...relativePath.split('/')), bytes)
    screenshots.push({
      id,
      path: relativePath,
      viewport: { width, height },
      theme,
      bytes: bytes.length,
      sha256: sha256(bytes),
      captured_at: '2026-07-27T00:00:00.000Z',
      step: 'acceptance_capture',
      inspector_open: inspectorOpen,
      geometry: {
        node_count: 7,
        toolbar_visible: true,
        minimap_visible: true,
        sidebar_visible: true,
        inspector_visible: inspectorOpen,
      },
    })
  }
  const manifest = {
    schema: 'localminidrama.free-canvas-e2e-evidence.v1',
    status: 'passed',
    generated_at: '2026-07-27T00:00:01.000Z',
    git_revision: 'a'.repeat(40),
    source: CLEAN_SOURCE_BINDING,
    urls: {
      frontend: 'http://127.0.0.1:3013',
      backend: 'http://127.0.0.1:5679',
      canvas: 'http://127.0.0.1:3013/film/41/canvas',
    },
    suite: 'free-canvas',
    steps: REQUIRED_STEP_NAMES.map((name) => ({
      name,
      status: 'passed',
      at: '2026-07-27T00:00:00.000Z',
    })),
    flow: createValidFlowEvidence(),
    cleanup: {
      status: 'passed',
      fixtures: [
        { drama_id: 41, title: 'E2E Novel2Anime Free Canvas primary', verified: true },
        { drama_id: 42, title: 'E2E Novel2Anime Free Canvas isolation', verified: true },
      ],
      failures: [],
    },
    failure: null,
    screenshots,
  }
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

function verifyEvidence(root, sourceBinding = CLEAN_SOURCE_BINDING) {
  return verifier.verifyFreeCanvasEvidence(root, {
    sourceBindingProvider: () => sourceBinding,
  })
}

test('service URL policy defaults both services to 127.0.0.1 and rejects remote hosts without an opt-in', () => {
  assert.deepEqual(e2e.resolveServiceUrls({}), {
    frontendUrl: 'http://127.0.0.1:3013',
    backendUrl: 'http://127.0.0.1:5679',
    frontendOrigin: 'http://127.0.0.1:3013',
  })
  assert.throws(
    () => e2e.resolveServiceUrls({ FRONTEND_URL: 'https://example.com' }),
    /loopback/,
  )
  assert.equal(
    e2e.resolveServiceUrls({
      FRONTEND_URL: 'https://frontend.example.com',
      BACKEND_URL: 'https://backend.example.com',
      E2E_ALLOW_REMOTE_SERVICES: '1',
    }).frontendOrigin,
    'https://frontend.example.com',
  )
})

test('API origin is derived from the approved frontend URL and cannot be overridden by caller headers', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 1 } }) }
  }
  const services = e2e.resolveServiceUrls({})

  await e2e.apiFetch('/dramas', {
    method: 'POST',
    headers: { Origin: 'https://attacker.invalid', Authorization: 'Bearer ignored' },
    body: '{}',
  }, fetchImpl, services)

  assert.equal(calls[0].options.headers.Origin, 'http://127.0.0.1:3013')
  assert.equal(calls[0].url, 'http://127.0.0.1:5679/api/v1/dramas')
})

test('fixture identity guard reads through the frontend proxy and rejects duplicate exact titles', async () => {
  const title = 'E2E Novel2Anime Free Canvas identity'
  const fixture = { id: 41, title, metadata: { e2e: true, e2e_suite: 'free-canvas' } }
  const backendRequest = async () => fixture
  const frontendRequest = async (pathname) => (
    pathname.startsWith('/dramas?') ? { items: [fixture], pagination: { total: 1 } } : fixture
  )

  const verified = await e2e.assertFixtureIdentity({
    apiRequest: backendRequest,
    frontendApiRequest: frontendRequest,
    dramaId: 41,
    expectedTitle: title,
  })
  assert.equal(verified.id, 41)

  await assert.rejects(
    e2e.assertFixtureIdentity({
      apiRequest: backendRequest,
      frontendApiRequest: async (pathname) => (
        pathname.startsWith('/dramas?')
          ? { items: [fixture, { ...fixture, id: 99 }], pagination: { total: 2 } }
          : fixture
      ),
      dramaId: 41,
      expectedTitle: title,
    }),
    /exactly one fixture title/,
  )
})

test('guarded hard purge validates fixture identity before invoking the smoke purge helper', async () => {
  const calls = []
  const result = await e2e.purgeFixtureSafely({
    fixture: { drama: { id: 41 }, title: 'E2E Novel2Anime Free Canvas purge' },
    assertIdentity: async () => calls.push('identity'),
    fixturePurger: async (value) => {
      calls.push(value)
      return { verified: true, residual: {}, media_cleanup: { candidates: 0, deleted: 0, missing: 0, shared: 0 } }
    },
  })
  assert.deepEqual(calls, [
    'identity',
    { dramaId: 41, expectedTitle: 'E2E Novel2Anime Free Canvas purge' },
  ])
  assert.equal(result.verified, true)
})

test('browser flow wrapper rejects an empty implementation result', async () => {
  await assert.rejects(
    e2e.runBrowserFlow(async () => ({}), {}),
    /browser flow result is incomplete/,
  )
})

test('main rejects an injected empty browser flow and still hard-purges both guarded fixtures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-main-empty-'))
  const fixtures = [
    { drama: { id: 41 }, title: 'E2E Novel2Anime Free Canvas primary' },
    { drama: { id: 42 }, title: 'E2E Novel2Anime Free Canvas isolation' },
  ]
  const purged = []
  try {
    await assert.rejects(
      e2e.main({
        ensureServices: async () => {},
        apiRequest: async () => ({}),
        frontendApiRequest: async () => ({}),
        fixtureFactory: async () => fixtures.shift(),
        fixtureSeeder: async () => ({ character: { id: 7 }, episode: { id: 8 }, storyboard: { id: 9 } }),
        identityGuard: async () => ({}),
        fixturePurger: async ({ dramaId }) => {
          purged.push(dramaId)
          return { verified: true }
        },
        launchBrowser: async () => ({
          newPage: async () => ({ url: () => '' }),
          close: async () => {},
        }),
        browserFlow: async () => ({}),
        sourceBindingProvider: () => ({ head: 'c'.repeat(40), worktree_state: 'clean' }),
        evidenceRoot: path.join(root, 'free-canvas'),
        evidenceRootResetter: async (candidate) => {
          await mkdir(candidate, { recursive: true })
          return candidate
        },
        logger: { log() {}, error() {}, warn() {} },
        now: () => 1722038400000,
      }),
      /browser flow result is incomplete/i,
    )
    assert.deepEqual(purged.sort((a, b) => a - b), [41, 42])
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('browser flow evidence rejects duplicate IDs and missing fixture identity', () => {
  assert.throws(
    () => e2e.assertBrowserFlowResult({
      completed: true,
      node_ids: ['n1', 'n1', 'n2', 'n3', 'n4'],
      edge_ids: ['e1', 'e1'],
      copy_paste_verified: true,
      delete_undo_redo_verified: true,
      save_recovery_verified: true,
      upload_failure_verified: true,
      conversion_verified: true,
      isolation_verified: true,
    }),
    /incomplete|unique|fixture/i,
  )
})

test('browser flow evidence requires unique image and video node identities', () => {
  const valid = createValidFlowEvidence()
  assert.equal(e2e.assertBrowserFlowResult(valid), valid)
  assert.throws(
    () => e2e.assertBrowserFlowResult({ ...valid, image_node_id: undefined }),
    /image|role node/i,
  )
  assert.throws(
    () => e2e.assertBrowserFlowResult({ ...valid, video_node_id: valid.image_node_id }),
    /video|unique|role node/i,
  )
})

test('browser flow evidence rejects legacy Enter-only evidence that omits Space', () => {
  const valid = createValidFlowEvidence()
  const enterOnly = valid.keyboard_activations[0]
  assert.throws(
    () => e2e.assertBrowserFlowResult({
      ...valid,
      keyboard_activations: [enterOnly],
      keyboard_activated_node_id: enterOnly.node_id,
      keyboard_activation_key: enterOnly.key,
      keyboard_focus_verified: true,
      keyboard_selection_verified: true,
    }),
    /Enter|Space|keyboard|complete|unique/i,
  )
})

test('browser flow evidence requires exactly one Enter and one Space activation result', () => {
  const valid = createValidFlowEvidence()
  assert.equal(e2e.assertBrowserFlowResult(valid), valid)
  const enter = valid.keyboard_activations[0]
  const space = valid.keyboard_activations[1]
  for (const keyboardActivations of [
    [enter],
    [enter, { ...enter }],
    [enter, { ...space, key: 'Escape' }],
  ]) {
    assert.throws(
      () => e2e.assertBrowserFlowResult({ ...valid, keyboard_activations: keyboardActivations }),
      /Enter|Space|keyboard|complete|unique|unknown/i,
    )
  }
})

test('browser flow evidence requires per-key focus, selection, inspector, and node semantics', () => {
  const valid = createValidFlowEvidence()
  for (const [index, patch] of [
    [0, { focus_retained: false }],
    [1, { focus_retained: false }],
    [0, { exact_selection_verified: false }],
    [1, { inspector_open_verified: false }],
    [0, { node_id: 'free:missing' }],
  ]) {
    const keyboardActivations = valid.keyboard_activations.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    ))
    assert.throws(
      () => e2e.assertBrowserFlowResult({ ...valid, keyboard_activations: keyboardActivations }),
      /keyboard|focus|selection|inspector|node|incomplete/i,
    )
  }
})

test('evidence manifest preserves complete per-key keyboard activation results without a scalar fallback', () => {
  const flow = createValidFlowEvidence()
  const manifest = e2e.buildEvidenceManifest({
    status: 'passed',
    sourceBinding: CLEAN_SOURCE_BINDING,
    services: e2e.resolveServiceUrls({}),
    canvasUrl: 'http://127.0.0.1:3013/film/41/canvas',
    flow,
    cleanup: { status: 'passed', fixtures: [], failures: [] },
  })
  assert.deepEqual(manifest.flow.keyboard_activations, flow.keyboard_activations)
  assert.equal(Object.hasOwn(manifest.flow, 'keyboard_activation_key'), false)
})

test('browser implementation uses exact free-node IDs and never soft-deletes fixtures', () => {
  assert.doesNotMatch(e2eSource, /\.first\s*\(/)
  assert.doesNotMatch(e2eSource, /method:\s*['"]DELETE['"]/)
  assert.match(e2eSource, /data-free-node-id/)
  assert.match(e2eSource, /data-asset-section="characters"/)
  assert.match(e2eSource, /new Set\(/)
})

test('browser script uses a real marquee and exact selected IDs for clipboard and history actions', () => {
  assert.match(e2eSource, /async function marqueeSelectExactNodes\(/)
  assert.match(e2eSource, /mouse\.down\(\{ button: 'left' \}\)[\s\S]*mouse\.move\([\s\S]*mouse\.up\(\{ button: 'left' \}\)/)
  assert.match(e2eSource, /marqueeSelectExactNodes\(\{[\s\S]*nodeIds: \[textNodeId, configNodeId\][\s\S]*\}\)/)
  assert.match(e2eSource, /assertExactSelectedFreeNodeIds\(page, \[textNodeId, configNodeId\]\)/)
  assert.match(e2eSource, /marquee_selection_verified: true/)
  assert.doesNotMatch(e2eSource, /keyboard\.press\(`\$\{modifier\}\+A`\)/)
})

test('browser script converts the retained reference into the explicit seeded storyboard target', () => {
  assert.match(e2eSource, /storyboardOption = page\.getByRole\('option',[\s\S]*seeded\.storyboard\.title/)
  assert.match(e2eSource, /apiRequest\(`\/storyboards\/\$\{seeded\.storyboard\.id\}`\)/)
  assert.match(e2eSource, /expectedStoryboardDescription/)
  assert.match(e2eSource, /assert\.equal\(convertedStoryboard\.description, expectedStoryboardDescription/)
  assert.match(e2eSource, /await exactFreeNode\(page, referenceNodeId\)/)
  assert.match(e2eSource, /storyboard_conversion_verified: true/)
})

test('connection flow separates overlapping exact nodes and verifies browser pointer hit targets', () => {
  assert.match(e2eSource, /function moveExactNodeAwayFrom\(/)
  assert.match(e2eSource, /elementFromPoint\(/)
  assert.match(e2eSource, /pointer hit target.*source/i)
  assert.match(e2eSource, /pointer hit target.*target/i)
  assert.match(e2eSource, /async function fitViewAndSettle\(/)
  assert.match(e2eSource, /async function readFreeNodeHitAtHandle\(/)
  assert.match(e2eSource, /fitViewAndSettle\(page\)[\s\S]*connectExactNodes\(/)
  assert.match(e2eSource, /waitForValue\([\s\S]*readFreeNodeHitAtHandle\(page, targetHandle\)/)
})

test('save recovery waits for the injected failure before retrying the same layout request', () => {
  assert.match(e2eSource, /injected canvas layout save failure/)
  assert.match(e2eSource, /clickUniqueButton\(page, '重试保存画布'\)/)
  assert.doesNotMatch(
    e2eSource.match(/await page\.route\(savePattern, saveHandler\)[\s\S]*?finally/)?.[0] || '',
    /unroute\(savePattern, saveHandler\)\s*\n\s*await clickUniqueButton\(page, '重试保存画布'\)/,
  )
})

test('connection flow uses Vue Flow connect-on-click with exact source and target handles', () => {
  assert.match(e2eSource, /sourceHandle\.click\(\)[\s\S]*targetHandle\.click\(\)/)
  assert.match(e2eSource, /source handle did not enter click-connecting state/)
})

test('browser script compares persisted and refreshed viewports without an old snapshot threshold', () => {
  const viewportBlock = e2eSource.match(/const renderedBeforeZoom[\s\S]*?const uploadBefore/)?.[0] || ''
  assert.match(viewportBlock, /browser zoom transform/)
  assert.match(viewportBlock, /browser pan transform/)
  assert.match(viewportBlock, /viewportWithinTolerance\(state\.viewport, renderedPanned\)/)
  assert.doesNotMatch(viewportBlock, /backgroundState\.viewport/)
  assert.equal(typeof e2e.viewportWithinTolerance, 'function')
  assert.equal(e2e.viewportWithinTolerance(
    { x: 10.5, y: -4.5, zoom: 1.1 },
    { x: 12, y: -3, zoom: 1.12 },
  ), true)
})

test('rendered viewport checks read the Vue Flow transformation pane', () => {
  assert.match(
    e2eSource,
    /function readRenderedViewport\(page\) \{[\s\S]*page\.locator\('\.vue-flow__transformationpane'\)/,
  )
})

test('failure evidence removes credentials, query strings, response bodies, and full stacks while retaining cleanup failure', () => {
  const document = e2e.buildEvidenceManifest({
    status: 'failed',
    sourceBinding: { head: 'b'.repeat(40), worktree_state: 'clean' },
    services: e2e.resolveServiceUrls({}),
    canvasUrl: 'http://127.0.0.1:3013/film/41/canvas?token=secret#node',
    steps: [{ name: 'failed_step', status: 'failed', at: '2026-07-27T00:00:00.000Z' }],
    cleanup: {
      status: 'failed',
      fixtures: [],
      failures: [{ label: 'fixture', error: new Error('Authorization: Bearer top-secret') }],
    },
    error: Object.assign(new Error('request failed api_key=top-secret response={"secret":"value"}'), {
      stack: 'full internal stack must not survive',
    }),
    screenshots: [],
  })
  const serialized = JSON.stringify(document)

  assert.equal(document.status, 'failed')
  assert.equal(document.cleanup.status, 'failed')
  assert.equal(serialized.includes('top-secret'), false)
  assert.equal(serialized.includes('?token='), false)
  assert.equal(serialized.includes('full internal stack'), false)
  assert.equal(serialized.includes('response='), false)
})

test('free canvas verifier accepts six real original PNG files with matching hashes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-valid-'))
  try {
    await writeValidEvidence(root)
    const result = await verifyEvidence(root)
    assert.deepEqual(result, { status: 'passed', screenshots: 6, gitRevision: 'a'.repeat(40) })
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas verifier requires image and video browser evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-interactions-'))
  try {
    const manifest = await writeValidEvidence(root)
    delete manifest.flow.image_node_id
    await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await assert.rejects(verifyEvidence(root), /image|browser flow/i)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas verifier rejects missing, duplicate, and unknown keyboard activation keys', async () => {
  const valid = createValidFlowEvidence()
  const enter = valid.keyboard_activations[0]
  const space = valid.keyboard_activations[1]
  const cases = [
    ['missing Space', [enter]],
    ['duplicate Enter', [enter, { ...enter }]],
    ['unknown Escape', [enter, { ...space, key: 'Escape' }]],
    ['failed Space semantics', [enter, { ...space, inspector_open_verified: false }]],
  ]
  for (const [name, keyboardActivations] of cases) {
    const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-keyboard-'))
    try {
      const manifest = await writeValidEvidence(root)
      manifest.flow.keyboard_activations = keyboardActivations
      manifest.flow.keyboard_activated_node_id = enter.node_id
      manifest.flow.keyboard_activation_key = enter.key
      manifest.flow.keyboard_focus_verified = true
      manifest.flow.keyboard_selection_verified = true
      await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await assert.rejects(verifyEvidence(root), /Enter|Space|keyboard|complete|unique|unknown|inspector/i, name)
    } finally {
      await removeFixtureTree(root, { force: true })
    }
  }
})

test('free canvas verifier rejects an evidence root symbolic link', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-root-link-'))
  const realRoot = path.join(parent, 'real')
  const linkedRoot = path.join(parent, 'linked')
  try {
    await writeValidEvidence(realRoot)
    await symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(verifyEvidence(linkedRoot), /symbolic link|symlink|outside|escape/i)
  } finally {
    await unlink(linkedRoot).catch(() => {})
    await removeFixtureTree(parent, { force: true })
  }
})

test('free canvas verifier rejects a screenshots directory symbolic link that escapes its root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-screenshot-link-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-screenshot-outside-'))
  const screenshotRoot = path.join(root, 'screenshots')
  const outsideScreenshots = path.join(outside, 'screenshots')
  try {
    await writeValidEvidence(root)
    await rename(screenshotRoot, outsideScreenshots)
    await symlink(outsideScreenshots, screenshotRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(verifyEvidence(root), /symbolic link|symlink|outside|escape/i)
  } finally {
    await unlink(screenshotRoot).catch(() => {})
    await removeFixtureTree(root, { force: true })
    await removeFixtureTree(outside, { force: true })
  }
})

test('free canvas verifier rejects a missing real screenshot file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-missing-'))
  try {
    const manifest = await writeValidEvidence(root)
    await unlink(path.join(root, ...manifest.screenshots[0].path.split('/')))
    await assert.rejects(verifyEvidence(root), /missing screenshot/i)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas verifier rejects a real PNG whose bytes no longer match its manifest SHA-256', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-hash-'))
  try {
    const manifest = await writeValidEvidence(root)
    const first = manifest.screenshots[0]
    const original = await readFile(path.join(root, ...first.path.split('/')))
    const changed = Buffer.from(original)
    changed[changed.length - 1] ^= 0x01
    await writeFile(path.join(root, ...first.path.split('/')), changed)
    await assert.rejects(verifyEvidence(root), /SHA-256 mismatch/)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas verifier rejects a manifest with a required browser step missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-step-'))
  try {
    const manifest = await writeValidEvidence(root)
    manifest.steps = manifest.steps.filter((step) => step.name !== 'recovered_canvas_save')
    await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await assert.rejects(verifyEvidence(root), /required.*step|recovered_canvas_save/i)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas verifier rejects cleanup evidence that does not match both flow fixtures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-cleanup-'))
  try {
    const manifest = await writeValidEvidence(root)
    manifest.cleanup.fixtures[0].drama_id = 999
    await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await assert.rejects(verifyEvidence(root), /cleanup.*fixture|flow fixture/i)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('clean source binding and verifier fail closed for dirty or different trees', async () => {
  assert.equal(typeof e2e.createCleanSourceBinding, 'function')
  assert.deepEqual(e2e.createCleanSourceBinding('a'.repeat(40), ''), CLEAN_SOURCE_BINDING)
  assert.throws(
    () => e2e.createCleanSourceBinding('a'.repeat(40), ' M frontweb/src/App.vue'),
    /dirty|clean/i,
  )

  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-source-'))
  try {
    await writeValidEvidence(root)
    await assert.rejects(
      verifyEvidence(root, { head: 'b'.repeat(40), worktree_state: 'clean' }),
      /source|revision|HEAD/i,
    )
    await assert.rejects(
      verifier.verifyFreeCanvasEvidence(root, {
        sourceBindingProvider: () => { throw new Error('dirty source tree') },
      }),
      /dirty source tree/i,
    )
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('six captures require inspector-open geometry at every required viewport', async () => {
  const inspectorCaptures = verifier.REQUIRED_CAPTURES.filter((capture) => capture.inspectorOpen)
  assert.deepEqual(inspectorCaptures.map((capture) => capture.width), [1280, 1366, 1440])
  assert.equal(inspectorCaptures.every((capture) => capture.theme === 'dark'), true)
  assert.match(e2eSource, /async function assertCaptureGeometry\(/)
  assert.match(e2eSource, /inspector_open: capture\.inspectorOpen/)

  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-evidence-inspector-'))
  try {
    const manifest = await writeValidEvidence(root)
    const inspectorEntry = manifest.screenshots.find((entry) => entry.inspector_open)
    inspectorEntry.inspector_open = false
    await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await assert.rejects(verifyEvidence(root), /inspector|geometry/i)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('evidence reset rejects an external production evidence directory without deleting it', async () => {
  assert.equal(typeof e2e.resetEvidenceRoot, 'function')
  const root = await mkdtemp(path.join(tmpdir(), 'free-canvas-reset-'))
  const outside = path.join(root, 'acceptance-report')
  const sentinel = path.join(outside, 'keep.txt')
  try {
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'keep', 'utf8')
    await assert.rejects(e2e.resetEvidenceRoot(outside), /exact|repository-owned|outside/i)
    assert.equal(await readFile(sentinel, 'utf8'), 'keep')
    assert.match(e2eSource, /fs\.realpath\(/)
    assert.match(e2eSource, /path\.relative\(/)
  } finally {
    await removeFixtureTree(root, { force: true })
  }
})

test('free canvas evidence is retained beside rather than inside the strict acceptance-report tree', () => {
  assert.equal(e2e.ACCEPTANCE_ROOT, EXPECTED_EVIDENCE_ROOT)
  assert.equal(verifier.DEFAULT_EVIDENCE_ROOT, EXPECTED_EVIDENCE_ROOT)
  assert.equal(
    path.relative(path.join(PROJECT_ROOT, 'artifacts', 'e2e-production', 'acceptance-report'), EXPECTED_EVIDENCE_ROOT)
      .startsWith('..'),
    true,
  )
})

test('browser and verifier require the same complete interaction step set', () => {
  assert.deepEqual([...e2e.REQUIRED_STEP_NAMES], REQUIRED_STEP_NAMES)
  assert.deepEqual([...verifier.REQUIRED_STEPS], REQUIRED_STEP_NAMES)
})

test('production E2E gate serially runs free canvas E2E and its verifier after production evidence', () => {
  assert.equal(
    frontendPackage.scripts['e2e:production'],
    'npm run e2e:production:raw && npm run verify:acceptance-report:final && npm run e2e:free-canvas && npm run verify:free-canvas-evidence',
  )
  assert.equal(frontendPackage.scripts.verify.includes('free-canvas'), false)
})
