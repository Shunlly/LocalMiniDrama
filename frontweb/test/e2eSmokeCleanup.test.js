import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const {
  E2E_TITLE_PREFIX,
  main,
  parsePurgeResult,
  requireE2eDataDirectory,
  registerCleanup,
  runDockerFixturePurge,
  runCleanup,
  verifyE2eContainerDataMount,
} = require('../scripts/e2e-smoke.cjs')
const { validateE2eDataDirectory } = require('../../scripts/docker-compose-with-revision.cjs')
const { removeFixtureTreeSync } = require('../scripts/fixture-cleanup.cjs')
const scriptSource = readFileSync(new URL('../scripts/e2e-smoke.cjs', import.meta.url), 'utf8')
const repositoryRoot = path.resolve(
  process.env.LOCALMINIDRAMA_REPOSITORY_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
)
const e2eDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'localminidrama-e2e-smoke-test-'))
const previousDataDirectory = process.env.LOCALMINIDRAMA_DATA_DIR
process.env.LOCALMINIDRAMA_DATA_DIR = e2eDataDirectory
test.after(() => {
  if (previousDataDirectory === undefined) delete process.env.LOCALMINIDRAMA_DATA_DIR
  else process.env.LOCALMINIDRAMA_DATA_DIR = previousDataDirectory
  removeFixtureTreeSync(e2eDataDirectory, { force: true })
})

function quietLogger(warnings = []) {
  return {
    log() {},
    warn(message) {
      warnings.push(message)
    },
  }
}

function successfulPage(seenLabels) {
  const waitable = { waitFor: async () => {} }
  const stepper = {
    getByText(label) {
      seenLabels.push(label)
      return waitable
    },
  }

  return {
    async goto() {},
    getByText(label) {
      seenLabels.push(label)
      return waitable
    },
    getByRole(role, options) {
      seenLabels.push(options?.name || role)
      return role === 'navigation' ? stepper : waitable
    },
  }
}

test('cleanup actions run in reverse order and continue after a failure', async () => {
  const events = []
  const warnings = []
  const actions = []
  registerCleanup(actions, 'drama 1', async () => events.push('drama'))
  registerCleanup(actions, 'source directory', async () => {
    events.push('source directory')
    throw new Error('file locked')
  })
  registerCleanup(actions, 'browser', async () => events.push('browser'))

  const failures = await runCleanup(actions, quietLogger(warnings))

  assert.deepEqual(events, ['browser', 'source directory', 'drama'])
  assert.equal(failures.length, 1)
  assert.equal(failures[0].label, 'source directory')
  assert.match(warnings[0], /source directory: file locked/)
})

test('an intermediate failure still cleans every tracked fixture without masking the primary error', async () => {
  const primaryError = new Error('page creation failed')
  const events = []
  const warnings = []
  const apiRequest = async (pathname, options = {}) => {
    const method = options.method || 'GET'
    if (method === 'DELETE') {
      events.push(`delete ${pathname}`)
      throw new Error('drama cleanup failed')
    }
    if (pathname === '/dramas') return { id: 77 }
    return {
      source: {
        id: 91,
        raw_text_path: 'data/story_sources/77/hash.txt',
        content_hash: 'hash',
      },
    }
  }

  await assert.rejects(
    main({
      apiRequest,
      containerMountVerifier: async () => {},
      launchBrowser: async () => ({
        async newPage() {
          throw primaryError
        },
        async close() {
          events.push('close browser')
          throw new Error('browser cleanup failed')
        },
      }),
      sourceDirectoryRemover: async () => {
        events.push('remove source directory')
        throw new Error('source cleanup failed')
      },
      fixturePurger: async () => {
        events.push('hard purge')
        throw new Error('hard purge failed')
      },
      logger: quietLogger(warnings),
      now: () => 123,
    }),
    (error) => error === primaryError,
  )

  assert.deepEqual(events, ['close browser', 'delete /dramas/77', 'hard purge'])
  assert.equal(warnings.length, 3)
})

test('源素材导入失败时仍清理数据库夹具', async () => {
  const primaryError = new Error('source response lost')
  const events = []
  const apiRequest = async (pathname, options = {}) => {
    if (pathname === '/dramas' && options.method === 'POST') return { id: 79 }
    if (pathname === '/dramas/79/story-sources') throw primaryError
    if (pathname === '/dramas/79' && options.method === 'DELETE') {
      events.push('api delete')
      return null
    }
    throw new Error(`unexpected API request: ${pathname}`)
  }

  await assert.rejects(
    main({
      apiRequest,
      containerMountVerifier: async () => {},
      launchBrowser: async () => {
        throw new Error('browser must not launch after source failure')
      },
      fixturePurger: async ({ dramaId, expectedTitle }) => {
        events.push(`hard purge ${dramaId}`)
        assert.equal(expectedTitle, `${E2E_TITLE_PREFIX}789`)
        return { verified: true, residual: {} }
      },
      logger: quietLogger(),
      now: () => 789,
    }),
    (error) => error === primaryError,
  )

  assert.deepEqual(events, ['api delete', 'hard purge 79'])
})

test('cleanup failure fails an otherwise successful smoke run while preserving UI assertions', async () => {
  const seenLabels = []
  const cleanupEvents = []
  const apiRequest = async (pathname, options = {}) => {
    if (options.method === 'DELETE') {
      cleanupEvents.push('api delete')
      throw new Error('delete unavailable')
    }
    if (pathname === '/dramas') return { id: 88 }
    return {
      source: {
        id: 92,
        raw_text_path: 'data/story_sources/88/hash.txt',
        content_hash: 'hash',
      },
    }
  }

  await assert.rejects(
    main({
      apiRequest,
      containerMountVerifier: async () => {},
      launchBrowser: async () => ({
        newPage: async () => successfulPage(seenLabels),
        close: async () => {},
      }),
      fixturePurger: async () => {
        cleanupEvents.push('hard purge')
        return { verified: true, residual: {} }
      },
      logger: quietLogger(),
      now: () => 456,
    }),
    (error) => error instanceof AggregateError && /drama 88/.test(error.message),
  )

  assert.deepEqual(cleanupEvents, ['api delete', 'hard purge'])

  for (const label of [
    '项目就绪度',
    '故事素材流程',
    '素材处理步骤',
    '导入素材',
    '启动处理',
    'QA',
    '修复',
    '剧集 / 时间线',
    '1 份素材已导入',
    '以 草稿预演 启动',
  ]) {
    assert.ok(seenLabels.includes(label), `missing successful-path assertion for ${label}`)
  }
})

test('quick smoke targets the default draft-preview source launch command', () => {
  assert.match(
    scriptSource,
    /getByRole\('button', \{ name: '以 草稿预演 启动', exact: true \}\)/,
  )
  assert.doesNotMatch(
    scriptSource,
    /getByRole\('button', \{ name: '启动处理', exact: true \}\)/,
  )
})

test('夹具创建位于保护范围内且清理在断言前登记', () => {
  const mainStart = scriptSource.indexOf('async function main(')
  const mainSource = scriptSource.slice(mainStart)
  const tryStart = mainSource.indexOf('\n  try {')
  const finallyStart = mainSource.indexOf('\n  } finally {')
  const dramaCreate = mainSource.indexOf("apiRequest('/dramas'")
  const sourceCreate = mainSource.indexOf('apiRequest(`/dramas/${drama.id}/story-sources`')

  assert.ok(tryStart >= 0 && finallyStart > tryStart)
  assert.ok(dramaCreate > tryStart && dramaCreate < finallyStart)
  assert.ok(sourceCreate > tryStart && sourceCreate < finallyStart)
  assert.ok(
    mainSource.indexOf('registerCleanup(cleanupActions, `drama') <
      mainSource.indexOf("assert.ok(drama?.id, 'created drama id is required')"),
  )
  assert.equal(mainSource.includes('sourceDirectoryRemover'), false)
  assert.equal(mainSource.includes('removeSourceFixtureDirectory'), false)
  assert.ok(mainSource.indexOf('await containerMountVerifier()') < dramaCreate)
  assert.ok(mainSource.indexOf('registerCleanup(cleanupActions, `hard purge drama') < sourceCreate)
})

test('Docker E2E only accepts an explicit absolute empty directory outside the repository', () => {
  assert.equal(requireE2eDataDirectory(), e2eDataDirectory)
  assert.throws(() => validateE2eDataDirectory('backend-node/data'), /必须是绝对路径/)
  assert.throws(() => validateE2eDataDirectory(path.join(repositoryRoot, 'backend-node', 'data')), /默认 backend-node\/data/)

  const nonEmptyDirectory = mkdtempSync(path.join(os.tmpdir(), 'localminidrama-e2e-non-empty-'))
  try {
    writeFileSync(path.join(nonEmptyDirectory, 'fixture.txt'), 'fixture', 'utf8')
    assert.throws(() => validateE2eDataDirectory(nonEmptyDirectory), /必须保持为空/)
  } finally {
    removeFixtureTreeSync(nonEmptyDirectory, { force: true })
  }
  assert.throws(() => validateE2eDataDirectory(path.join(repositoryRoot, 'artifacts')), /危险重叠/)
})

test('Docker E2E verifies the running backend data mount before creating fixtures', async () => {
  const calls = []
  const runner = async (executable, args, options) => {
    calls.push({ executable, args, options })
    if (args[0] === 'compose') return { stdout: 'a'.repeat(64) + '\n', stderr: '' }
    return {
      stdout: JSON.stringify([{
        Mounts: [{
          Destination: '/app/data',
          Type: 'bind',
          RW: true,
          Source: e2eDataDirectory,
        }],
      }]),
      stderr: '',
    }
  }
  const verified = await verifyE2eContainerDataMount(runner)
  assert.equal(verified.dataDirectory, e2eDataDirectory)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, ['compose', 'ps', '-q', 'backend'])
  assert.deepEqual(calls[1].args, ['container', 'inspect', 'a'.repeat(64)])
  assert.equal(calls[0].options.env.LOCALMINIDRAMA_DATA_DIR, e2eDataDirectory)

  await assert.rejects(
    verifyE2eContainerDataMount(async (_executable, args) => {
      if (args[0] === 'compose') return { stdout: 'b'.repeat(64), stderr: '' }
      return {
        stdout: JSON.stringify([{
          Mounts: [{
            Destination: '/app/data',
            Type: 'bind',
            RW: true,
          Source: repositoryRoot,
          }],
        }]),
        stderr: '',
      }
    }),
    /挂载源与 LOCALMINIDRAMA_DATA_DIR 不一致/,
  )
})

test('Docker purge invocation carries an exact fixture identity and explicit confirmation', async () => {
  const calls = []
  const expectedTitle = `${E2E_TITLE_PREFIX}999`
  const result = await runDockerFixturePurge(
    { dramaId: 91, expectedTitle },
    async (executable, args, options) => {
      calls.push({ executable, args, options })
      return {
        stdout: `${JSON.stringify({
          drama_id: 91,
          media_cleanup: { candidates: 0, deleted: 0, missing: 0, shared: 0 },
          residual: {},
          verified: true,
        })}\n`,
        stderr: '',
      }
    },
  )

  assert.equal(result.verified, true)
  assert.equal(calls[0].executable, 'docker')
  assert.deepEqual(calls[0].args.slice(0, 12), [
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
  ])
  assert.ok(calls[0].args.includes('--confirm-local-e2e'))
  assert.equal(calls[0].args.at(-1), expectedTitle)
  assert.equal(calls[0].options.env.LOCALMINIDRAMA_DATA_DIR, e2eDataDirectory)
  assert.equal(calls[0].options.windowsHide, true)
})

test('hard purge output must explicitly verify zero residual rows', () => {
  const media_cleanup = { candidates: 1, deleted: 1, missing: 0, shared: 0 }
  assert.throws(() => parsePurgeResult('not json'), /did not return a JSON/)
  assert.throws(
    () => parsePurgeResult(JSON.stringify({ verified: true, residual: { dramas: 1 }, media_cleanup })),
    /verification failed/,
  )
  assert.throws(
    () => parsePurgeResult(JSON.stringify({ verified: true, residual: {}, media_cleanup: null })),
    /verification failed/,
  )
  assert.equal(
    parsePurgeResult(JSON.stringify({ verified: true, residual: {}, media_cleanup })).verified,
    true,
  )
})

test('production E2E 必须接上 smoke 的剧集页文案，避免烟测脚本游离', () => {
  const productionSource = readFileSync(new URL('../scripts/e2e-production.cjs', import.meta.url), 'utf8')
  assert.match(productionSource, /UI\.readinessTitle/)
  assert.match(productionSource, /UI\.workflowTitle/)
  assert.match(productionSource, /UI\.intakeStepper/)
  assert.match(productionSource, /UI\.startDraft/)
  assert.match(scriptSource, /getByText\('项目就绪度'\)/)
  assert.match(scriptSource, /getByText\('故事素材流程'\)/)
  assert.match(scriptSource, /getByRole\('navigation', \{ name: '素材处理步骤' \}\)/)
  assert.match(scriptSource, /getByRole\('button', \{ name: '以 草稿预演 启动', exact: true \}\)/)
})
