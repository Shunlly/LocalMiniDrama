import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditCleanupSources } from '../scripts/fixture-cleanup-policy.js'

const require = createRequire(import.meta.url)
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const cleanupHelperPath = fileURLToPath(new URL('../scripts/fixture-cleanup.cjs', import.meta.url))
const frontwebRoot = fileURLToPath(new URL('..', import.meta.url))

function createPolicyFixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'frontweb-cleanup-policy-'))
  fs.mkdirSync(path.join(root, 'test'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts', 'fixture-cleanup.cjs'), '// Shared policy implementation.\n')
  t.after(() => {
    delete require.cache[require.resolve(cleanupHelperPath)]
    require(cleanupHelperPath).removeFixtureTreeSync(root, { force: true })
  })
  return root
}

function writePolicySource(root, relativePath, source) {
  const target = path.join(root, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function formatPolicyViolations(violations) {
  return violations.map(({ file, line, column, method }) => (
    `${file}:${line}:${column} calls recursive fs.${method} directly`
  )).join('\n')
}

test('automatic discovery rejects a new test file using an imported recursive rm alias', (t) => {
  const root = createPolicyFixture(t)
  writePolicySource(root, 'test/newCleanup.test.js', [
    "import { rm as removeTree } from 'node:fs/promises'",
    "await removeTree('fixture', { recursive: true, force: true })",
    '',
  ].join('\n'))

  const result = auditCleanupSources(root)

  assert.deepEqual(result.files, ['test/newCleanup.test.js'])
  assert.deepEqual(
    result.violations.map(({ file, line, method }) => ({ file, line, method })),
    [{ file: 'test/newCleanup.test.js', line: 2, method: 'rm' }],
  )
})

test('automatic discovery permits additional shared cleanup helper calls', (t) => {
  const root = createPolicyFixture(t)
  writePolicySource(root, 'test/additionalCleanup.test.js', [
    "const { removeFixtureTreeSync: cleanup } = require('../scripts/fixture-cleanup.cjs')",
    "cleanup('first-fixture', { force: true })",
    "cleanup('second-fixture', { force: true })",
    '',
  ].join('\n'))

  const result = auditCleanupSources(root)

  assert.deepEqual(result.files, ['test/additionalCleanup.test.js'])
  assert.deepEqual(result.violations, [])
})

test('cleanup policy scans only authored test and script sources in deterministic order', (t) => {
  const root = createPolicyFixture(t)
  writePolicySource(root, 'scripts/e2e/nested-runner.mjs', 'export const runner = true\n')
  writePolicySource(root, 'test/z-last.test.js', 'export const last = true\n')
  writePolicySource(root, 'test/a-first.test.js', 'export const first = true\n')
  writePolicySource(root, 'src/ignored.js', "require('node:fs').rmSync('src', { recursive: true })\n")
  writePolicySource(root, 'browser-fixtures/ignored.cjs', "require('node:fs').rmSync('profile', { recursive: true })\n")
  writePolicySource(root, 'test/node_modules/vendor.cjs', "require('node:fs').rmSync('vendor', { recursive: true })\n")
  writePolicySource(root, 'test/coverage/generated.js', "require('node:fs').rmSync('coverage', { recursive: true })\n")
  writePolicySource(root, 'scripts/dist/generated.js', "require('node:fs').rmSync('dist', { recursive: true })\n")

  const result = auditCleanupSources(root)

  assert.deepEqual(result.files, [
    'scripts/e2e/nested-runner.mjs',
    'test/a-first.test.js',
    'test/z-last.test.js',
  ])
  assert.deepEqual(result.violations, [])
})

test('cleanup policy resolves common fs namespaces, destructuring, aliases, and static options', (t) => {
  const root = createPolicyFixture(t)
  writePolicySource(root, 'scripts/alias-cleanup.cjs', [
    "const disk = require('node:fs')",
    "const { rmSync: removeNow } = require('fs')",
    "const promiseDisk = disk.promises",
    'const removeLater = promiseDisk.rm',
    'const recursive = true',
    'const baseOptions = { force: true }',
    'const cleanupOptions = { ...baseOptions, recursive }',
    "disk['rmSync']('namespace-fixture', { recursive: true })",
    "removeNow('destructured-fixture', { recursive: true })",
    "removeLater('member-alias-fixture', cleanupOptions)",
    '',
  ].join('\n'))

  const result = auditCleanupSources(root)

  assert.deepEqual(
    result.violations.map(({ line, method }) => ({ line, method })),
    [
      { line: 8, method: 'rmSync' },
      { line: 9, method: 'rmSync' },
      { line: 10, method: 'rm' },
    ],
  )
})

test('authored frontend tests and scripts reject direct recursive removal', () => {
  const result = auditCleanupSources(frontwebRoot)

  assert.ok(result.files.some((file) => file.startsWith('test/')))
  assert.ok(result.files.some((file) => file.startsWith('scripts/')))
  assert.equal(result.files.includes('scripts/fixture-cleanup.cjs'), false)
  assert.deepEqual(
    result.violations,
    [],
    `Use scripts/fixture-cleanup.cjs for recursive fixture removal:\n${formatPolicyViolations(result.violations)}`,
  )
})

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
