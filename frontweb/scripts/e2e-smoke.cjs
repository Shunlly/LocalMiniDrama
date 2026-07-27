const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { chromium } = require('playwright')
const { removeFixtureTree } = require('./fixture-cleanup.cjs')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3013'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5679'
const COMPOSE_WORKDIR = path.resolve(process.env.COMPOSE_WORKDIR || path.join(__dirname, '..', '..'))
const BACKEND_WORKDIR = path.resolve(
  process.env.BACKEND_WORKDIR || path.join(__dirname, '..', '..', 'backend-node'),
)
const STORY_SOURCE_ROOT = path.join(BACKEND_WORKDIR, 'data', 'story_sources')
const E2E_TITLE_PREFIX = 'E2E Novel2Anime '
const execFileAsync = promisify(execFile)

async function apiFetch(pathname, options = {}) {
  const res = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/v1${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    throw new Error(`API ${pathname} failed: ${res.status} ${JSON.stringify(body)}`)
  }
  return body.data
}

function registerCleanup(actions, label, run) {
  actions.push({ label, run })
}

async function runCleanup(actions, logger = console) {
  const failures = []
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index]
    try {
      await action.run()
    } catch (error) {
      failures.push({ label: action.label, error })
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`E2E cleanup failed for ${action.label}: ${message}`)
    }
  }
  return failures
}

function normalizeDramaId(value) {
  const dramaId = Number(value)
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) {
    throw new Error('E2E cleanup requires a positive integer drama id')
  }
  return dramaId
}

function resolveSourceFixtureDirectory(dramaId) {
  const normalizedId = normalizeDramaId(dramaId)
  const root = path.resolve(STORY_SOURCE_ROOT)
  const target = path.resolve(root, String(normalizedId))
  if (path.dirname(target) !== root || path.basename(target) !== String(normalizedId)) {
    throw new Error(`Refusing to remove unexpected story source directory: ${target}`)
  }
  return target
}

async function removeSourceFixtureDirectory(dramaId) {
  const directory = resolveSourceFixtureDirectory(dramaId)
  let stat
  try {
    stat = await fs.lstat(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove symlinked story source directory: ${directory}`)
  }
  await removeFixtureTree(directory, { force: true })
}

function parsePurgeResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'))
  if (!jsonLine) throw new Error('E2E hard purge did not return a JSON verification result')
  const result = JSON.parse(jsonLine)
  const media = result.media_cleanup
  const mediaCounts = ['candidates', 'deleted', 'missing', 'shared']
    .map((key) => Number(media?.[key]))
  const mediaVerified = mediaCounts.every((value) => Number.isSafeInteger(value) && value >= 0)
    && mediaCounts[0] === mediaCounts.slice(1).reduce((sum, value) => sum + value, 0)
  if (
    result.verified !== true ||
    Object.keys(result.residual || {}).length > 0 ||
    !mediaVerified
  ) {
    throw new Error(`E2E hard purge verification failed: ${jsonLine}`)
  }
  return result
}

async function runDockerFixturePurge({ dramaId, expectedTitle }, execFileRunner = execFileAsync) {
  const normalizedId = normalizeDramaId(dramaId)
  if (typeof expectedTitle !== 'string' || !expectedTitle.startsWith(E2E_TITLE_PREFIX)) {
    throw new Error(`E2E cleanup title must start with ${JSON.stringify(E2E_TITLE_PREFIX)}`)
  }
  const { stdout } = await execFileRunner('docker', [
    'compose',
    'exec',
    '-T',
    '--user',
    'node',
    '-e',
    'NODE_ENV=test',
    '-e',
    'LOCALMINIDRAMA_E2E_PURGE=1',
    'backend',
    'node',
    'scripts/purge-e2e-fixture.js',
    '--confirm-local-e2e',
    '--drama-id',
    String(normalizedId),
    '--expected-title',
    expectedTitle,
  ], {
    cwd: COMPOSE_WORKDIR,
    windowsHide: true,
  })
  return parsePurgeResult(stdout)
}

async function main({
  apiRequest = apiFetch,
  launchBrowser = (options) => chromium.launch(options),
  fixturePurger = runDockerFixturePurge,
  sourceDirectoryRemover = removeSourceFixtureDirectory,
  logger = console,
  now = Date.now,
} = {}) {
  const cleanupActions = []
  let primaryError = null

  try {
    const stamp = now()
    const fixtureTitle = `${E2E_TITLE_PREFIX}${stamp}`
    const drama = await apiRequest('/dramas', {
      method: 'POST',
      body: JSON.stringify({
        title: fixtureTitle,
        description: 'Browser smoke test drama',
        style: 'anime style',
        total_episodes: 1,
        metadata: { aspect_ratio: '16:9', e2e: true },
      }),
    })
    if (drama?.id) {
      registerCleanup(cleanupActions, `hard purge drama ${drama.id}`, () => (
        fixturePurger({ dramaId: drama.id, expectedTitle: fixtureTitle })
      ))
      registerCleanup(cleanupActions, `drama ${drama.id}`, () => (
        apiRequest(`/dramas/${drama.id}`, { method: 'DELETE' })
      ))
      registerCleanup(cleanupActions, `story source directory ${drama.id}`, () => (
        sourceDirectoryRemover(drama.id)
      ))
    }
    assert.ok(drama?.id, 'created drama id is required')

    const source = await apiRequest(`/dramas/${drama.id}/story-sources`, {
      method: 'POST',
      body: JSON.stringify({
        title: `E2E Source ${stamp}`,
        source_type: 'storyboard',
        target_episode_count: 1,
        text: [
          `shot 1 Characters: Aria, Bo. Location: Gate. Aria finds a secret warning letter. Fixture ${stamp}.`,
          'shot 2 Because the guards arrive, Bo starts a fight and they escape.',
        ].join('\n'),
        metadata: { e2e: true },
      }),
    })
    const sourceRecord = source?.source
    assert.ok(sourceRecord?.id, 'created source id is required')

    const launchOptions = { headless: process.env.HEADED !== '1' }
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
    } else if (process.env.PLAYWRIGHT_CHANNEL) {
      launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL
    } else if (process.platform === 'win32') {
      launchOptions.channel = 'msedge'
    }

    const browser = await launchBrowser(launchOptions)
    registerCleanup(cleanupActions, 'browser', () => browser.close())
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    await page.goto(`${FRONTEND_URL.replace(/\/$/, '')}/drama/${drama.id}`, { waitUntil: 'networkidle' })
    await page.getByText('项目就绪度').waitFor({ timeout: 15000 })
    await page.getByText('故事素材流程').waitFor({ timeout: 15000 })
    const stepper = page.getByRole('navigation', { name: '素材处理步骤' })
    for (const label of ['导入素材', '启动处理', 'QA', '修复', '剧集 / 时间线']) {
      await stepper.getByText(label, { exact: true }).waitFor({ timeout: 15000 })
    }
    await stepper.getByText('1 份素材已导入', { exact: true }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '以 草稿预演 启动', exact: true }).waitFor({ timeout: 15000 })
    logger.log(`E2E smoke passed for drama ${drama.id}`)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    const cleanupFailures = await runCleanup(cleanupActions, logger)
    if (cleanupFailures.length && !primaryError) {
      throw new AggregateError(
        cleanupFailures.map(({ error }) => error),
        `E2E cleanup failed for ${cleanupFailures.map(({ label }) => label).join(', ')}`,
      )
    }
  }
}

module.exports = {
  E2E_TITLE_PREFIX,
  main,
  parsePurgeResult,
  registerCleanup,
  resolveSourceFixtureDirectory,
  runDockerFixturePurge,
  runCleanup,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
