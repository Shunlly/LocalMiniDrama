// 本地烟测入口。CI 走 npm run verify:e2e（e2e-production.cjs）。
// 剧集页可见文案必须同时出现在 production E2E，避免本脚本游离后假通过。
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { promisify } = require('node:util')
const { chromium } = require('playwright')
const { validateE2eDataDirectory } = require('../../scripts/docker-compose-with-revision.cjs')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3013'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5679'
const COMPOSE_WORKDIR = path.resolve(process.env.COMPOSE_WORKDIR || path.join(__dirname, '..', '..'))
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

function requireE2eDataDirectory() {
  return validateE2eDataDirectory(process.env.LOCALMINIDRAMA_DATA_DIR, { requireEmpty: false })
}

async function verifyE2eContainerDataMount(execFileRunner = execFileAsync) {
  const dataDirectory = requireE2eDataDirectory()
  const commandOptions = {
    cwd: COMPOSE_WORKDIR,
    env: { ...process.env, LOCALMINIDRAMA_DATA_DIR: dataDirectory },
    windowsHide: true,
  }
  const { stdout: containerOutput } = await execFileRunner(
    'docker',
    ['compose', 'ps', '-q', 'backend'],
    commandOptions,
  )
  const containerId = String(containerOutput || '').trim()
  if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
    throw new Error('Docker E2E 未找到唯一运行中的 backend 容器')
  }
  const { stdout: inspectOutput } = await execFileRunner(
    'docker',
    ['container', 'inspect', containerId],
    commandOptions,
  )
  let inspected
  try {
    inspected = JSON.parse(String(inspectOutput || ''))?.[0]
  } catch (_) {
    throw new Error('Docker E2E 无法解析 backend 容器挂载信息')
  }
  const dataMount = inspected?.Mounts?.find((mount) => mount?.Destination === '/app/data')
  if (dataMount?.Type !== 'bind' || dataMount?.RW !== true || typeof dataMount?.Source !== 'string') {
    throw new Error('Docker E2E 的 backend /app/data 必须是可写 bind mount')
  }
  let mountedSource
  try {
    mountedSource = fs.realpathSync(dataMount.Source)
  } catch (_) {
    throw new Error('Docker E2E 的 backend 数据挂载源不可读取')
  }
  const normalize = (value) => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  if (normalize(mountedSource) !== normalize(dataDirectory)) {
    throw new Error('Docker E2E 的 backend 数据挂载源与 LOCALMINIDRAMA_DATA_DIR 不一致')
  }
  return { containerId, dataDirectory }
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
  const dataDirectory = requireE2eDataDirectory()
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
    env: { ...process.env, LOCALMINIDRAMA_DATA_DIR: dataDirectory },
    windowsHide: true,
  })
  return parsePurgeResult(stdout)
}

async function main({
  apiRequest = apiFetch,
  launchBrowser = (options) => chromium.launch(options),
  fixturePurger = runDockerFixturePurge,
  containerMountVerifier = verifyE2eContainerDataMount,
  logger = console,
  now = Date.now,
} = {}) {
  const cleanupActions = []
  let primaryError = null

  try {
    requireE2eDataDirectory()
    await containerMountVerifier()
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
  requireE2eDataDirectory,
  registerCleanup,
  runDockerFixturePurge,
  runCleanup,
  verifyE2eContainerDataMount,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
