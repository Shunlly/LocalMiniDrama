import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const {
  E2E_TITLE_PREFIX,
  main,
  parsePurgeResult,
  registerCleanup,
  resolveSourceFixtureDirectory,
  runDockerFixturePurge,
  runCleanup,
} = require('../scripts/e2e-smoke.cjs')
const scriptSource = readFileSync(new URL('../scripts/e2e-smoke.cjs', import.meta.url), 'utf8')

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

  assert.deepEqual(events, [
    'close browser',
    'remove source directory',
    'delete /dramas/77',
    'hard purge',
  ])
  assert.equal(warnings.length, 4)
})

test('a failed source import response still removes its pre-registered directory and database fixture', async () => {
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
      launchBrowser: async () => {
        throw new Error('browser must not launch after source failure')
      },
      sourceDirectoryRemover: async (dramaId) => {
        events.push(`remove directory ${dramaId}`)
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

  assert.deepEqual(events, ['remove directory 79', 'api delete', 'hard purge 79'])
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
      launchBrowser: async () => ({
        newPage: async () => successfulPage(seenLabels),
        close: async () => {},
      }),
      sourceDirectoryRemover: async () => cleanupEvents.push('source directory'),
      fixturePurger: async () => {
        cleanupEvents.push('hard purge')
        return { verified: true, residual: {} }
      },
      logger: quietLogger(),
      now: () => 456,
    }),
    (error) => error instanceof AggregateError && /drama 88/.test(error.message),
  )

  assert.deepEqual(cleanupEvents, ['source directory', 'api delete', 'hard purge'])

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
  ]) {
    assert.ok(seenLabels.includes(label), `missing successful-path assertion for ${label}`)
  }
})

test('fixture creation calls stay inside the guarded try and register cleanup before assertions', () => {
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
  assert.ok(
    mainSource.indexOf('registerCleanup(cleanupActions, `story source directory') < sourceCreate,
  )
  assert.ok(mainSource.indexOf('registerCleanup(cleanupActions, `hard purge drama') < sourceCreate)
})

test('story source directory cleanup is restricted to a numeric fixture directory', () => {
  assert.throws(() => resolveSourceFixtureDirectory('../README.md'), /positive integer drama id/)
  assert.throws(() => resolveSourceFixtureDirectory(0), /positive integer drama id/)
  assert.match(
    resolveSourceFixtureDirectory(77),
    /[\\/]story_sources[\\/]77$/,
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
        stdout: `${JSON.stringify({ drama_id: 91, residual: {}, verified: true })}\n`,
        stderr: '',
      }
    },
  )

  assert.equal(result.verified, true)
  assert.equal(calls[0].executable, 'docker')
  assert.deepEqual(calls[0].args.slice(0, 8), [
    'compose',
    'exec',
    '-T',
    '-e',
    'LOCALMINIDRAMA_E2E_PURGE=1',
    'backend',
    'node',
    'scripts/purge-e2e-fixture.js',
  ])
  assert.ok(calls[0].args.includes('--confirm-local-e2e'))
  assert.equal(calls[0].args.at(-1), expectedTitle)
  assert.equal(calls[0].options.windowsHide, true)
})

test('hard purge output must explicitly verify zero residual rows', () => {
  assert.throws(() => parsePurgeResult('not json'), /did not return a JSON/)
  assert.throws(
    () => parsePurgeResult(JSON.stringify({ verified: true, residual: { dramas: 1 } })),
    /verification failed/,
  )
  assert.equal(parsePurgeResult(JSON.stringify({ verified: true, residual: {} })).verified, true)
})
