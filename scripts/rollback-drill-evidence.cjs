'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

const EVIDENCE_SCHEMA = 'localminidrama.rollback-drill.v2'
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

function assertNoCliArguments(args) {
  assert.deepEqual(args, [], 'rollback drill does not accept a custom output path')
}

async function lstatIfExists(targetPath) {
  try {
    return await fsp.lstat(targetPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
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
  if (evidence?.schema !== EVIDENCE_SCHEMA && evidence?.schema !== LEGACY_EVIDENCE_SCHEMA) {
    assert.fail('existing rollback evidence is not recognized')
  }
  assert.equal(evidence?.status, 'passed', 'existing rollback evidence is not a completed PASS record')
  if (evidence?.schema === EVIDENCE_SCHEMA) {
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
  const generation = evidence.schema === LEGACY_EVIDENCE_SCHEMA ? 'legacy-v1' : 'v2'
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
  const evidenceRoot = await ensureEvidenceDirectory(repoRoot)
  const outputPath = evidenceOutputPath(repoRoot)
  assert.equal(await lstatIfExists(outputPath), null, 'rollback evidence target changed during the drill')
  assert.equal(evidence?.schema, EVIDENCE_SCHEMA, 'rollback evidence schema is invalid')
  assert.equal(evidence?.status, 'passed', 'only completed rollback evidence may be published')
  assert.equal(evidence?.source?.version, expectedVersion, 'rollback evidence version does not match the prepared version')

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

module.exports = {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  assertNoCliArguments,
  evidenceOutputPath,
  prepareEvidenceTarget,
  publishEvidence,
}
