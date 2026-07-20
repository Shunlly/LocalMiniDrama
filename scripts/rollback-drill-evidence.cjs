'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

const EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v3'
const V2_EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v2'
const LEGACY_EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v1'
const EVIDENCE_RELATIVE_PATH = 'artifacts/rollback-drill/summary.json'
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/

function comparablePath(value) {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function evidenceOutputPath(repoRoot) {
  return path.join(path.resolve(repoRoot), ...EVIDENCE_RELATIVE_PATH.split('/'))
}

function parseDrillArguments(args) {
  assert.ok(Array.isArray(args), 'rollback drill arguments must be an array')
  if (args.length === 0) {
    return {
      inputMode: 'standalone',
      archivePath: null,
      dataRoot: null,
    }
  }

  assert.equal(args.length, 4, 'checkpoint-bound rollback drill requires one --archive and one --data-root pair')
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    assert.ok(flag === '--archive' || flag === '--data-root', `unknown rollback drill argument: ${flag}`)
    assert.equal(values.has(flag), false, `duplicate rollback drill argument: ${flag}`)
    assert.equal(typeof value, 'string', `${flag} requires an absolute path`)
    assert.equal(path.isAbsolute(value), true, `${flag} requires an absolute path`)
    assert.equal(comparablePath(path.resolve(value)), comparablePath(value), `${flag} path must be fully resolved`)
    values.set(flag, value)
  }
  assert.equal(values.has('--archive'), true, 'checkpoint-bound rollback drill requires --archive')
  assert.equal(values.has('--data-root'), true, 'checkpoint-bound rollback drill requires --data-root')
  return {
    inputMode: 'checkpoint-bound',
    archivePath: values.get('--archive'),
    dataRoot: values.get('--data-root'),
  }
}

async function lstatIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function statType(stat) {
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'directory'
  return 'unsupported'
}

async function assertNoRedirectingPathComponents(targetPath) {
  const resolved = path.resolve(targetPath)
  assert.equal(comparablePath(resolved), comparablePath(targetPath), `${targetPath} must be an absolute resolved path`)
  const parsed = path.parse(resolved)
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  let current = parsed.root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await fsp.lstat(current, { bigint: true })
    assert.equal(stat.isSymbolicLink(), false, `${current} must not contain a symbolic link or reparse point`)
    const realPath = await fsp.realpath(current)
    assert.equal(comparablePath(realPath), comparablePath(current), `${current} must resolve to its real path without reparse redirection`)
  }
  return resolved
}

async function capturePathIdentity(target, expectedType) {
  assert.ok(expectedType === 'file' || expectedType === 'directory', 'expected path type must be file or directory')
  const targetPath = typeof target === 'string' ? target : target?.path
  const handle = typeof target === 'object' && target !== null ? target.handle : null
  assert.equal(typeof targetPath, 'string', 'path identity target must include a path')
  const resolved = await assertNoRedirectingPathComponents(targetPath)
  const stat = handle
    ? await handle.stat({ bigint: true })
    : await fsp.lstat(resolved, { bigint: true })
  const type = statType(stat)
  assert.equal(type, expectedType, `${resolved} must be a regular ${expectedType}`)
  const realPath = await fsp.realpath(resolved)
  const identity = {
    dev: stat.dev,
    ino: stat.ino,
    type,
    size: stat.size,
    ctimeNs: stat.ctimeNs,
    realPath,
  }
  if (handle) {
    const pathStat = await fsp.lstat(resolved, { bigint: true })
    assertSamePathIdentity(identity, {
      dev: pathStat.dev,
      ino: pathStat.ino,
      type: statType(pathStat),
      size: pathStat.size,
      ctimeNs: pathStat.ctimeNs,
      realPath,
    }, 'open descriptor and path')
  }
  return identity
}

function assertSamePathIdentity(before, after, label) {
  assert.ok(before && after, `${label} identity is missing`)
  for (const field of ['dev', 'ino', 'type', 'size', 'ctimeNs']) {
    assert.equal(after[field], before[field], `${label} ${field} identity changed`)
  }
  assert.equal(
    comparablePath(after.realPath),
    comparablePath(before.realPath),
    `${label} real path identity changed`
  )
}

async function assertCheckpointInputPaths(options) {
  assert.equal(options?.inputMode, 'checkpoint-bound', 'checkpoint input validation requires checkpoint-bound mode')
  assert.equal(path.isAbsolute(options?.archivePath || ''), true, 'checkpoint archive path must be absolute')
  assert.equal(path.isAbsolute(options?.dataRoot || ''), true, 'checkpoint data root must be absolute')
  assert.equal(
    comparablePath(path.resolve(options.archivePath)),
    comparablePath(options.archivePath),
    'checkpoint archive path must be fully resolved'
  )
  assert.equal(
    comparablePath(path.resolve(options.dataRoot)),
    comparablePath(options.dataRoot),
    'checkpoint data root must be fully resolved'
  )
  const archiveIdentity = await capturePathIdentity(options.archivePath, 'file')
  const dataRootIdentity = await capturePathIdentity(options.dataRoot, 'directory')
  const relativeArchive = path.relative(options.dataRoot, options.archivePath)
  assert.ok(
    relativeArchive.startsWith(`..${path.sep}`) || relativeArchive === '..',
    'checkpoint archive must be outside the data root'
  )
  return { archiveIdentity, dataRootIdentity }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizedRelativePath(value) {
  return value.split(path.sep).join('/')
}

function updateLengthFrame(hash, length) {
  const value = typeof length === 'bigint' ? length : BigInt(length)
  assert.ok(value >= 0n && value <= 0xffffffffffffffffn, 'fingerprint frame length is out of range')
  const frame = Buffer.allocUnsafe(8)
  frame.writeBigUInt64BE(value)
  hash.update(frame)
}

function updateBytesFrame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  updateLengthFrame(hash, bytes.length)
  hash.update(bytes)
}

async function readFileIntoHash(handle, expectedSize, hash) {
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let total = 0n
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    total += BigInt(bytesRead)
    assert.ok(total <= expectedSize, 'fingerprinted file grew while it was read')
    hash.update(buffer.subarray(0, bytesRead))
  }
  assert.equal(total, expectedSize, 'fingerprinted file length changed while it was read')
}

async function fingerprintDataRoot(root, hooks = {}) {
  const resolvedRoot = path.resolve(root)
  assert.equal(comparablePath(resolvedRoot), comparablePath(root), 'data root path must be fully resolved')
  const rootIdentity = await capturePathIdentity(resolvedRoot, 'directory')
  const entries = []
  const directories = []

  async function discoverDirectory(absolutePath, relativePath) {
    const identity = await capturePathIdentity(absolutePath, 'directory')
    const dirents = await fsp.readdir(absolutePath, { withFileTypes: true })
    const names = dirents.map((dirent) => dirent.name).sort(compareUtf8)
    directories.push({ absolutePath, relativePath, identity, names })
    const byName = new Map(dirents.map((dirent) => [dirent.name, dirent]))
    for (const name of names) {
      const dirent = byName.get(name)
      const childAbsolutePath = path.join(absolutePath, name)
      const childRelativePath = normalizedRelativePath(relativePath ? path.join(relativePath, name) : name)
      assert.equal(dirent.isSymbolicLink(), false, `${childRelativePath} must not be a symbolic link or reparse point`)
      const type = dirent.isFile() ? 'file' : dirent.isDirectory() ? 'directory' : 'unsupported'
      assert.notEqual(type, 'unsupported', `${childRelativePath} has an unsupported entry type`)
      const childIdentity = await capturePathIdentity(childAbsolutePath, type)
      entries.push({
        absolutePath: childAbsolutePath,
        relativePath: childRelativePath,
        type,
        identity: childIdentity,
      })
      if (type === 'directory') await discoverDirectory(childAbsolutePath, childRelativePath)
    }
  }

  await discoverDirectory(resolvedRoot, '')
  entries.sort((left, right) => compareUtf8(left.relativePath, right.relativePath))

  const hash = crypto.createHash('sha256')
  hash.update('localminidrama-data-root-fingerprint-v1\0', 'utf8')
  for (const entry of entries) {
    await hooks.onEntry?.({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      type: entry.type,
    })
    const beforeRead = await capturePathIdentity(entry.absolutePath, entry.type)
    assertSamePathIdentity(entry.identity, beforeRead, `data root entry ${entry.relativePath}`)
    updateBytesFrame(hash, entry.type)
    updateBytesFrame(hash, entry.relativePath)
    updateLengthFrame(hash, entry.type === 'file' ? beforeRead.size : 0n)
    if (entry.type === 'file') {
      let handle
      try {
        handle = await fsp.open(entry.absolutePath, 'r')
        const descriptorIdentity = await capturePathIdentity({ handle, path: entry.absolutePath }, 'file')
        assertSamePathIdentity(beforeRead, descriptorIdentity, `data root entry ${entry.relativePath}`)
        await readFileIntoHash(handle, beforeRead.size, hash)
        const descriptorAfterRead = await capturePathIdentity({ handle, path: entry.absolutePath }, 'file')
        assertSamePathIdentity(descriptorIdentity, descriptorAfterRead, `data root entry ${entry.relativePath}`)
      } finally {
        if (handle) await handle.close()
      }
    }
    await hooks.afterEntryRead?.({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      type: entry.type,
    })
    const afterRead = await capturePathIdentity(entry.absolutePath, entry.type)
    assertSamePathIdentity(beforeRead, afterRead, `data root entry ${entry.relativePath}`)
  }

  for (const directory of [...directories].reverse()) {
    await hooks.beforeDirectoryPostCheck?.({
      absolutePath: directory.absolutePath,
      relativePath: directory.relativePath,
    })
    if (directory.relativePath === '') await hooks.beforeRootPostCheck?.({ absolutePath: directory.absolutePath })
    const names = (await fsp.readdir(directory.absolutePath)).sort(compareUtf8)
    assert.deepEqual(names, directory.names, `data root directory ${directory.relativePath || '.'} entries changed`)
    const after = await capturePathIdentity(directory.absolutePath, 'directory')
    assertSamePathIdentity(directory.identity, after, `data root directory ${directory.relativePath || '.'}`)
  }
  const finalRootIdentity = await capturePathIdentity(resolvedRoot, 'directory')
  assertSamePathIdentity(rootIdentity, finalRootIdentity, 'data root')
  return hash.digest('hex')
}

async function ensureRealDirectory(targetPath) {
  const stat = await lstatIfExists(targetPath)
  if (stat) {
    assert.equal(stat.isSymbolicLink(), false, `${targetPath} must not be a symbolic link`)
    assert.equal(stat.isDirectory(), true, `${targetPath} must be a directory`)
  } else {
    await fsp.mkdir(targetPath)
  }
  const realPath = await fsp.realpath(targetPath)
  assert.equal(comparablePath(realPath), comparablePath(targetPath), `${targetPath} must be a real directory`)
}

async function ensureEvidenceDirectory(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot)
  const artifactsRoot = path.join(resolvedRoot, 'artifacts')
  const evidenceRoot = path.join(artifactsRoot, 'rollback-drill')
  await ensureRealDirectory(artifactsRoot)
  await ensureRealDirectory(evidenceRoot)
  return evidenceRoot
}

function recognizedEvidenceVersion(evidence) {
  if (![EVIDENCE_SCHEMA, V2_EVIDENCE_SCHEMA, LEGACY_EVIDENCE_SCHEMA].includes(evidence?.schema)) {
    assert.fail('existing rollback evidence is not recognized')
  }
  assert.equal(typeof evidence?.status, 'string', 'existing rollback evidence status must be a string')
  assert.equal(evidence?.status, 'passed', 'existing rollback evidence is not a completed PASS record')
  if (evidence?.schema === EVIDENCE_SCHEMA) {
    validateEvidenceV3(evidence, evidence?.source?.version)
    return evidence.source.version
  }
  if (evidence?.schema === V2_EVIDENCE_SCHEMA) {
    assert.match(evidence?.source?.version || '', VERSION_PATTERN, 'existing rollback evidence version is invalid')
    return evidence.source.version
  }
  if (evidence?.schema === LEGACY_EVIDENCE_SCHEMA) {
    assert.match(evidence?.source_version || '', VERSION_PATTERN, 'legacy rollback evidence version is invalid')
    assert.match(evidence?.backup?.archive_sha256 || '', /^[a-f0-9]{64}$/i, 'legacy rollback evidence hash is invalid')
    return evidence.source_version
  }
  assert.fail('existing rollback evidence is not recognized')
}

async function archivePriorEvidence(evidenceRoot, outputPath, contents, evidence, version) {
  const archiveRoot = path.join(evidenceRoot, 'archive')
  await ensureRealDirectory(archiveRoot)
  const digest = crypto.createHash('sha256').update(contents).digest('hex')
  const generation = evidence.schema === LEGACY_EVIDENCE_SCHEMA
    ? 'legacy-v1'
    : evidence.schema === V2_EVIDENCE_SCHEMA
      ? 'v2'
      : 'v3'
  const archivePath = path.join(archiveRoot, `${generation}-${version}-${digest.slice(0, 16)}.json`)
  const existingArchive = await lstatIfExists(archivePath)
  if (existingArchive) {
    assert.equal(existingArchive.isSymbolicLink(), false, 'rollback evidence archive must not be a symbolic link')
    assert.equal(existingArchive.isFile(), true, 'rollback evidence archive must be a regular file')
    assert.equal(
      crypto.createHash('sha256').update(await fsp.readFile(archivePath)).digest('hex'),
      digest,
      'rollback evidence archive collision detected'
    )
  } else {
    await fsp.link(outputPath, archivePath)
  }
  await fsp.unlink(outputPath)
}

async function prepareEvidenceTarget(repoRoot, version) {
  assert.match(version || '', VERSION_PATTERN, 'expected rollback evidence version is invalid')
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const outputPath = evidenceOutputPath(repoRoot)
  const stat = await lstatIfExists(outputPath)
  if (!stat) return outputPath
  assert.equal(stat.isSymbolicLink(), false, 'rollback evidence must not be a symbolic link')
  assert.equal(stat.isFile(), true, 'rollback evidence must be a regular file')
  const contents = await fsp.readFile(outputPath)
  const existing = JSON.parse(contents.toString('utf8'))
  const existingVersion = recognizedEvidenceVersion(existing)
  if (existing.schema === EVIDENCE_SCHEMA && existingVersion === version) {
    await fsp.unlink(outputPath)
  } else {
    await archivePriorEvidence(evidenceRoot, outputPath, contents, existing, existingVersion)
  }
  return outputPath
}

async function publishEvidence(repoRoot, expectedVersion, evidence) {
  validateEvidenceV3(evidence, expectedVersion)
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const outputPath = evidenceOutputPath(repoRoot)
  assert.equal(await lstatIfExists(outputPath), null, 'rollback evidence target changed during the drill')

  const temporaryPath = path.join(evidenceRoot, `.summary-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`)
  let handle
  try {
    handle = await fsp.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.link(temporaryPath, outputPath)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await fsp.rm(temporaryPath, { force: true }).catch(() => {})
  }
  return outputPath
}

function validateEvidenceV3(evidence, expectedVersion) {
  assert.equal(evidence?.schema, EVIDENCE_SCHEMA, 'rollback evidence schema is invalid')
  assert.equal(typeof evidence?.status, 'string', 'rollback evidence status must be a string')
  assert.equal(evidence.status, 'passed', 'only completed rollback evidence may be published')
  assert.ok(
    evidence?.input_mode === 'standalone' || evidence?.input_mode === 'checkpoint-bound',
    'rollback evidence input_mode is invalid'
  )
  assert.match(expectedVersion || '', VERSION_PATTERN, 'expected rollback evidence version is invalid')
  assert.equal(
    evidence?.source?.version,
    expectedVersion,
    'rollback evidence source.version does not match the prepared version'
  )
  assert.equal(
    typeof evidence?.source?.working_tree_dirty,
    'boolean',
    'rollback evidence source.working_tree_dirty must be a boolean'
  )
  assert.equal(evidence.source.working_tree_dirty, false, 'rollback evidence source.working_tree_dirty must be false')
  assert.match(
    evidence?.source?.data_root_sha256 || '',
    /^[a-f0-9]{64}$/,
    'rollback evidence source.data_root_sha256 is invalid'
  )
  assert.match(
    evidence?.backup?.archive_sha256 || '',
    /^[a-f0-9]{64}$/,
    'rollback evidence backup.archive_sha256 is invalid'
  )
  assert.equal(
    typeof evidence?.backup?.archive_retained,
    'boolean',
    'rollback evidence backup.archive_retained must be a boolean'
  )
  assert.equal(
    evidence.backup.archive_retained,
    evidence.input_mode === 'checkpoint-bound',
    'rollback evidence backup.archive_retained does not match input_mode'
  )
  if (evidence.input_mode === 'checkpoint-bound') {
    assert.equal(
      evidence.backup.excluded_values,
      null,
      'rollback evidence backup.excluded_values must be null in checkpoint-bound mode'
    )
  } else {
    assert.ok(
      Number.isInteger(evidence.backup.excluded_values) && evidence.backup.excluded_values >= 0,
      'rollback evidence backup.excluded_values must be a non-negative integer in standalone mode'
    )
  }
  assert.equal(
    typeof evidence?.operations?.source_data_root_unchanged,
    'boolean',
    'rollback evidence operations.source_data_root_unchanged must be a boolean'
  )
  assert.equal(
    evidence.operations.source_data_root_unchanged,
    true,
    'rollback evidence operations.source_data_root_unchanged must be true'
  )
  return evidence
}

module.exports = {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  assertCheckpointInputPaths,
  assertSamePathIdentity,
  capturePathIdentity,
  evidenceOutputPath,
  fingerprintDataRoot,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
  validateEvidenceV3,
}
