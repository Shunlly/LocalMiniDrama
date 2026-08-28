'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const EXPECTED_EXAMPLE_DRAMA = Object.freeze({
  relativePath: 'example_drama/衣服设计天才302.zip',
  fileName: '衣服设计天才302.zip',
  bytes: 82156132,
  sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
})

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const file = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    while ((bytesRead = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(file)
  }
  return hash.digest('hex')
}

function isGitLfsPointer(filePath, bytes) {
  if (bytes > 1024) return false
  const contents = fs.readFileSync(filePath, 'utf8')
  return /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(contents)
}

function comparablePath(filePath) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

function verifyExampleDrama(root, expected = EXPECTED_EXAMPLE_DRAMA) {
  const resolvedRoot = path.resolve(root)
  const absolutePath = path.resolve(resolvedRoot, expected.relativePath)
  const relativePath = path.relative(resolvedRoot, absolutePath)
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(`Example drama path must stay below the repository root: ${absolutePath}`)
  }

  let stat
  try {
    stat = fs.lstatSync(absolutePath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Example drama file is missing: ${absolutePath}`)
    }
    throw error
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Example drama file must not be a symbolic link: ${absolutePath}`)
  }
  if (!stat.isFile()) {
    throw new Error(`Example drama path must be a regular file: ${absolutePath}`)
  }

  const realPath = fs.realpathSync(absolutePath)
  if (comparablePath(realPath) !== comparablePath(absolutePath)) {
    throw new Error(`Example drama file must resolve directly without symbolic-link parents: ${absolutePath}`)
  }
  if (isGitLfsPointer(absolutePath, stat.size)) {
    throw new Error(`Example drama file is an unresolved Git LFS pointer: ${absolutePath}`)
  }
  if (stat.size !== expected.bytes) {
    throw new Error(
      `Example drama size mismatch: expected ${expected.bytes} bytes, received ${stat.size} bytes`,
    )
  }

  const sha256 = sha256File(absolutePath)
  if (sha256 !== expected.sha256) {
    throw new Error(
      `Example drama SHA-256 digest mismatch: expected ${expected.sha256}, received ${sha256}`,
    )
  }

  return { ...expected, absolutePath }
}

if (require.main === module) {
  const result = verifyExampleDrama(path.resolve(__dirname, '..'))
  process.stdout.write(`${result.absolutePath}\n${result.bytes}\n${result.sha256}\n`)
}

module.exports = {
  EXPECTED_EXAMPLE_DRAMA,
  sha256File,
  verifyExampleDrama,
}
