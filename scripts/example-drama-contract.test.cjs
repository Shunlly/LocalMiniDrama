'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  EXPECTED_EXAMPLE_DRAMA,
  sha256File,
  verifyExampleDrama,
} = require('./example-drama-contract.cjs')

const fixtureBytes = Buffer.from('fixture bytes')
const expected = {
  relativePath: 'example_drama/fixture.zip',
  fileName: 'fixture.zip',
  bytes: Buffer.byteLength('fixture bytes'),
  sha256: crypto.createHash('sha256').update('fixture bytes').digest('hex'),
}

function createFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-example-drama-'))
  const root = path.join(fixtureRoot, 'repository')
  const exampleDirectory = path.join(root, 'example_drama')
  const filePath = path.join(exampleDirectory, 'fixture.zip')
  fs.mkdirSync(exampleDirectory, { recursive: true })
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  return { exampleDirectory, filePath, fixtureRoot, root }
}

function createSymbolicLinkOrSkip(t, targetPath, linkPath, type) {
  try {
    fs.symlinkSync(targetPath, linkPath, type)
    return true
  } catch (error) {
    if (process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`Windows denied symbolic-link creation: ${error.message}`)
      return false
    }
    throw error
  }
}

test('pins the authoritative production example descriptor', () => {
  assert.deepEqual(EXPECTED_EXAMPLE_DRAMA, {
    relativePath: 'example_drama/衣服设计天才302.zip',
    fileName: '衣服设计天才302.zip',
    bytes: 82156132,
    sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
  })
})

test('verifies the example drama fixture and returns its resolved descriptor', (t) => {
  const { filePath, root } = createFixture(t)
  fs.writeFileSync(filePath, fixtureBytes)

  assert.equal(sha256File(filePath), expected.sha256)
  assert.deepEqual(
    verifyExampleDrama(root, expected),
    { ...expected, absolutePath: path.join(root, 'example_drama', 'fixture.zip') },
  )
})

test('rejects a missing example drama file', (t) => {
  const { root } = createFixture(t)

  assert.throws(() => verifyExampleDrama(root, expected), /missing|does not exist/i)
})

test('rejects an unresolved Git LFS pointer even when its size and digest match', (t) => {
  const { filePath, root } = createFixture(t)
  const pointer = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 82156132\n`,
  )
  fs.writeFileSync(filePath, pointer)
  const pointerDescriptor = {
    ...expected,
    bytes: pointer.length,
    sha256: crypto.createHash('sha256').update(pointer).digest('hex'),
  }

  assert.throws(() => verifyExampleDrama(root, pointerDescriptor), /Git LFS pointer/i)
})

test('rejects changed example drama bytes with the expected size', (t) => {
  const { filePath, root } = createFixture(t)
  const changedBytes = Buffer.from('fixture bytez')
  assert.equal(changedBytes.length, fixtureBytes.length)
  fs.writeFileSync(filePath, changedBytes)

  assert.throws(() => verifyExampleDrama(root, expected), /SHA-256|digest/i)
})

test('rejects an example drama file with the wrong size', (t) => {
  const { filePath, root } = createFixture(t)
  fs.writeFileSync(filePath, fixtureBytes)

  assert.throws(
    () => verifyExampleDrama(root, { ...expected, bytes: expected.bytes + 1 }),
    /size|bytes/i,
  )
})

test('rejects a non-file example drama path', (t) => {
  const { filePath, root } = createFixture(t)
  fs.mkdirSync(filePath)

  assert.throws(() => verifyExampleDrama(root, expected), /regular file/i)
})

test('rejects an example drama descriptor that escapes the repository root', (t) => {
  const { fixtureRoot, root } = createFixture(t)
  const outsidePath = path.join(fixtureRoot, 'outside.zip')
  fs.writeFileSync(outsidePath, fixtureBytes)

  assert.throws(
    () => verifyExampleDrama(root, {
      ...expected,
      relativePath: '../outside.zip',
      fileName: 'outside.zip',
    }),
    /below|escape|outside/i,
  )
})

test('rejects a final symbolic-link example drama file', (t) => {
  const { filePath, fixtureRoot, root } = createFixture(t)
  const targetPath = path.join(fixtureRoot, 'target.zip')
  fs.writeFileSync(targetPath, fixtureBytes)
  if (!createSymbolicLinkOrSkip(t, targetPath, filePath, 'file')) return

  assert.throws(() => verifyExampleDrama(root, expected), /symbolic[- ]link/i)
})

test('rejects an example drama file reached through a symbolic-link parent', (t) => {
  const { exampleDirectory, fixtureRoot, root } = createFixture(t)
  const targetDirectory = path.join(fixtureRoot, 'example-target')
  fs.mkdirSync(targetDirectory)
  fs.writeFileSync(path.join(targetDirectory, 'fixture.zip'), fixtureBytes)
  fs.rmSync(exampleDirectory, { recursive: true })
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  if (!createSymbolicLinkOrSkip(t, targetDirectory, exampleDirectory, type)) return

  assert.throws(
    () => verifyExampleDrama(root, expected),
    /symbolic[- ]link|resolve directly/i,
  )
})
