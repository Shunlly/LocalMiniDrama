import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const cleanupHelperPath = fileURLToPath(new URL('../scripts/fixture-cleanup.cjs', import.meta.url))

const CLEANUP_CONSUMERS = [
  ['acceptance report verifier fixtures', './acceptanceReportVerifier.test.js', 'removeFixtureTreeSync', 1],
  ['production E2E contract fixtures', './e2eProductionContract.test.js', 'removeFixtureTree', 5],
  ['free canvas E2E contract fixtures', './freeCanvasE2eContract.test.js', 'removeFixtureTree', 14],
  ['smoke E2E source fixtures', '../scripts/e2e-smoke.cjs', 'removeFixtureTree', 1],
  ['production E2E evidence fixtures', '../scripts/e2e-production.cjs', 'removeFixtureTree', 1],
  ['free canvas E2E evidence fixtures', '../scripts/e2e-free-canvas.cjs', 'removeFixtureTree', 1],
  ['bundle budget build fixtures', '../scripts/check-bundle-budget.cjs', 'removeFixtureTreeSync', 1],
]

const DIRECT_RECURSIVE_REMOVE = /\b(?:fs\.)?rm(?:Sync)?\s*\([\s\S]{0,300}?\brecursive\s*:\s*true/g

for (const [label, relativePath, helperName, expectedCalls] of CLEANUP_CONSUMERS) {
  test(`${label} use the shared bounded cleanup policy`, () => {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const directCalls = source.match(DIRECT_RECURSIVE_REMOVE) || []
    const helperCalls = source.match(new RegExp(`\\b${helperName}\\s*\\(`, 'g')) || []

    assert.equal(directCalls.length, 0, `${relativePath} still calls recursive fs.rm directly`)
    assert.match(source, /fixture-cleanup\.cjs/, `${relativePath} must import the shared cleanup policy`)
    assert.equal(helperCalls.length, expectedCalls, `${relativePath} cleanup call count changed`)
  })
}

test('shared cleanup passes finite native retries and surfaces terminal errors', async (t) => {
  assert.equal(fs.existsSync(cleanupHelperPath), true, 'shared cleanup helper must exist')

  const syncCalls = []
  const asyncCalls = []
  const syncError = Object.assign(new Error('sync cleanup exhausted'), { code: 'ENOTEMPTY' })
  const asyncError = Object.assign(new Error('async cleanup exhausted'), { code: 'ENOTEMPTY' })
  t.mock.method(fs, 'rmSync', (target, options) => {
    syncCalls.push({ target, options })
    throw syncError
  })
  t.mock.method(fsPromises, 'rm', async (target, options) => {
    asyncCalls.push({ target, options })
    throw asyncError
  })

  delete require.cache[require.resolve(cleanupHelperPath)]
  const { removeFixtureTree, removeFixtureTreeSync } = require(cleanupHelperPath)

  assert.throws(
    () => removeFixtureTreeSync('sync-fixture', { force: true }),
    (error) => error === syncError,
  )
  await assert.rejects(
    removeFixtureTree('async-fixture'),
    (error) => error === asyncError,
  )
  assert.deepEqual(syncCalls, [{
    target: 'sync-fixture',
    options: { recursive: true, force: true, maxRetries: 3, retryDelay: 250 },
  }])
  assert.deepEqual(asyncCalls, [{
    target: 'async-fixture',
    options: { recursive: true, force: false, maxRetries: 3, retryDelay: 250 },
  }])
})

test('shared cleanup preserves sync and async force behavior on real fixture trees', async (t) => {
  assert.equal(fs.existsSync(cleanupHelperPath), true, 'shared cleanup helper must exist')

  delete require.cache[require.resolve(cleanupHelperPath)]
  const { removeFixtureTree, removeFixtureTreeSync } = require(cleanupHelperPath)
  const parent = fs.mkdtempSync(path.join(tmpdir(), 'frontweb-cleanup-contract-'))
  t.after(() => removeFixtureTreeSync(parent, { force: true }))

  const syncRoot = path.join(parent, 'sync')
  fs.mkdirSync(path.join(syncRoot, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(syncRoot, 'nested', 'fixture.txt'), 'fixture')
  removeFixtureTreeSync(syncRoot, { force: true })
  assert.equal(fs.existsSync(syncRoot), false)

  const asyncRoot = path.join(parent, 'async')
  await fsPromises.mkdir(path.join(asyncRoot, 'nested'), { recursive: true })
  await fsPromises.writeFile(path.join(asyncRoot, 'nested', 'fixture.txt'), 'fixture')
  await removeFixtureTree(asyncRoot, { force: true })
  assert.equal(fs.existsSync(asyncRoot), false)

  const missing = path.join(parent, 'missing')
  assert.throws(() => removeFixtureTreeSync(missing), { code: 'ENOENT' })
  await assert.rejects(removeFixtureTree(missing), { code: 'ENOENT' })
  removeFixtureTreeSync(missing, { force: true })
  await removeFixtureTree(missing, { force: true })
})
