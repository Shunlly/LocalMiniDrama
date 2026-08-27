'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { validateMediaToolMetadata } = require('../desktop/scripts/media-tool-policy')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')
const { validateDefenderSignatureDetails } = require('../desktop/scripts/defender-signature-policy')
const { validatePackagedApplications } = require('./packaged-applications-contract.cjs')
const { assertReleaseVersion } = require('./verify-release-version.cjs')
const { validateSbomDocument } = require('./verify-release.cjs')

const root = path.resolve(__dirname, '..')
const releaseMetadataUsage = 'Usage: generate-release-metadata.cjs [--verify] [output-directory]'
const BACKEND_RUNTIME_BASE =
  'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0'
const BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE =
  'Trivy evaluates Dockerfile Config.User before the reviewed entrypoint transition. The pinned Node runtime maps node to UID 1000; after a same-filesystem one-time ownership migration, the entrypoint replaces PID 1 with the requested command under that account. Release evidence validation rejects any change to this source contract.'
const BACKEND_CONTAINER_USER_SOURCE_SHA256_LF = Object.freeze({
  'backend-node/Dockerfile': 'be1f4f77bff7fd9a094772041a04cace503fb48fbca2cc1775d5c55dc84270e4',
  'backend-node/docker-entrypoint.sh': 'e1bc2719bf21da00095f0380576092dcc590838fd8e02c88455dc98a2a79d972',
  'backend-node/.trivyignore.yaml': '97f051b0f207fd354177c36671085f974f6d1a481b438e247889df58609485e4',
})

function sha256(filePath) {
  const descriptor = fs.openSync(filePath, 'r')
  const hash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function currentCommit(environment = process.env) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, 'release metadata requires a readable Git commit')
  const commit = String(result.stdout || '').trim().toLowerCase()
  assert.match(commit, /^[a-f0-9]{40,64}$/, 'Git HEAD is not a full commit digest')

  const fromEnvironment = String(environment.GITHUB_SHA || '').trim()
  if (fromEnvironment) {
    assert.match(fromEnvironment, /^[a-f0-9]{40,64}$/i, 'GITHUB_SHA is not a full commit digest')
    assert.equal(fromEnvironment.toLowerCase(), commit, 'GITHUB_SHA does not match Git HEAD')
  }
  return commit
}

function normalizedSourceSha256(source, label) {
  assert.equal(typeof source, 'string', `${label} source is unavailable`)
  const normalized = source.replace(/\r\n/g, '\n')
  assert.doesNotMatch(normalized, /\r/, `${label} contains unsupported carriage returns`)
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function validateBackendContainerUserException(exception, {
  dockerfileSource = fs.readFileSync(path.join(root, 'backend-node', 'Dockerfile'), 'utf8'),
  entrypointSource = fs.readFileSync(path.join(root, 'backend-node', 'docker-entrypoint.sh'), 'utf8'),
  ignorePolicySource = fs.readFileSync(path.join(root, 'backend-node', '.trivyignore.yaml'), 'utf8'),
} = {}) {
  const sourceSha256Lf = {
    'backend-node/Dockerfile': normalizedSourceSha256(dockerfileSource, 'backend-node/Dockerfile'),
    'backend-node/docker-entrypoint.sh': normalizedSourceSha256(
      entrypointSource,
      'backend-node/docker-entrypoint.sh',
    ),
    'backend-node/.trivyignore.yaml': normalizedSourceSha256(
      ignorePolicySource,
      'backend-node/.trivyignore.yaml',
    ),
  }
  assert.deepEqual(
    sourceSha256Lf,
    BACKEND_CONTAINER_USER_SOURCE_SHA256_LF,
    'backend container user source contract changed; review or remove the Trivy exception',
  )
  assert.deepEqual(exception, {
    id: 'AVD-DS-0002',
    path: 'backend-node/Dockerfile',
    review_by: '2027-07-17',
    rationale: BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE,
    source_contract: {
      runtime_base: BACKEND_RUNTIME_BASE,
      process_user: 'node',
      process_uid: 1000,
      privilege_transition: 'setpriv --reuid=node --regid=node --init-groups',
      source_sha256_lf: sourceSha256Lf,
    },
  }, 'Trivy configuration exception is invalid')
  return exception
}

function assertCleanSourceTree(environment = process.env) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, 'release metadata requires a readable Git worktree')
  const dirty = Boolean(String(result.stdout || '').trim())
  if (dirty && environment.ALLOW_DIRTY_RELEASE !== '1') {
    assert.fail('release metadata refuses a dirty Git worktree; commit the exact source before packaging')
  }
  return dirty
}

function isReleaseArtifact(name) {
  return /(?:\.exe(?:\.blockmap)?|\.cdx\.json|\.zip)$/i.test(name)
    || name === 'artifact-security.json'
    || name === 'media-tools.json'
}

function expectedReleaseArtifactNames(version) {
  assertReleaseVersion(version, 'release artifact version')
  return [
    `LocalMiniDrama-Portable-${version}-x64.exe`,
    `LocalMiniDrama-Setup-${version}-x64.exe`,
    `LocalMiniDrama-Setup-${version}-x64.exe.blockmap`,
    `LocalMiniDrama-Unpacked-${version}-x64.zip`,
    `LocalMiniDrama-${version}.cdx.json`,
    'artifact-security.json',
    'media-tools.json',
    'sbom-backend.cdx.json',
    'sbom-desktop.cdx.json',
    'sbom-frontend.cdx.json',
  ].sort((a, b) => a.localeCompare(b, 'en'))
}

function assertExactArtifactSet(names, version) {
  assert.deepEqual(
    [...names].sort((a, b) => a.localeCompare(b, 'en')),
    expectedReleaseArtifactNames(version),
    'release directory contains missing, stale, or unexpected release artifacts'
  )
}

function readJson(filePath, label = path.basename(filePath)) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function releaseVersion() {
  const version = readJson(path.join(root, 'desktop', 'package.json'), 'desktop/package.json').version
  return assertReleaseVersion(version, 'desktop release version')
}

function releaseTag(version, environment = process.env) {
  const refType = String(environment.GITHUB_REF_TYPE || '').trim()
  const fullRef = String(environment.GITHUB_REF || '').trim()
  const refName = String(environment.GITHUB_REF_NAME || '').trim()
  const isTagContext = refType === 'tag' || fullRef.startsWith('refs/tags/')
  const tag = isTagContext ? (refName || fullRef.slice('refs/tags/'.length)) : `v${version}`
  assert.equal(tag, `v${version}`, `release tag ${tag} does not match package version ${version}`)
  return tag
}

function releaseArtifactNames(output) {
  return fs.readdirSync(output)
    .filter((name) => fs.statSync(path.join(output, name)).isFile() && isReleaseArtifact(name))
    .sort((a, b) => a.localeCompare(b, 'en'))
}

function parseReleaseMetadataArguments(args = process.argv.slice(2)) {
  assert.ok(Array.isArray(args), releaseMetadataUsage)
  const verifyMode = args[0] === '--verify'
  const remaining = verifyMode ? args.slice(1) : [...args]
  if (remaining.length > 1 || remaining.some((argument) => (
    typeof argument !== 'string' || !argument || argument.startsWith('-')
  ))) {
    assert.fail(releaseMetadataUsage)
  }
  return {
    mode: verifyMode ? 'verify' : 'generate',
    outputDirectory: remaining[0],
  }
}

function assertNoUnexpectedTopLevelFiles(output, version) {
  const allowedNames = new Set([
    ...expectedReleaseArtifactNames(version),
    'release-manifest.json',
    'SHA256SUMS',
  ])
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile() && !allowedNames.has(entry.name)) {
      assert.fail(`unexpected top-level release file: ${entry.name}`)
    }
  }
}

function validateSboms(output, names, version) {
  const sbomNames = names.filter((name) => name.endsWith('.cdx.json'))
  assert.equal(sbomNames.length, 4, 'release bundle must contain exactly four CycloneDX SBOM files')
  const packageDirectories = new Map([
    ['sbom-backend.cdx.json', 'backend-node'],
    ['sbom-frontend.cdx.json', 'frontweb'],
    ['sbom-desktop.cdx.json', 'desktop'],
    [`LocalMiniDrama-${version}.cdx.json`, 'desktop'],
  ])
  for (const sbomName of sbomNames) {
    const packageDirectory = packageDirectories.get(sbomName)
    assert.ok(packageDirectory, `release SBOM has no package mapping: ${sbomName}`)
    const sbom = readJson(path.join(output, sbomName), sbomName)
    validateSbomDocument(packageDirectory, sbom)
  }
}

function validateMediaMetadata(output, names) {
  const mediaToolsName = 'media-tools.json'
  assert.ok(names.includes(mediaToolsName), 'media tool provenance is missing')
  return validateMediaToolMetadata(readJson(path.join(output, mediaToolsName), mediaToolsName))
}

function validateArtifactSecurity(output, names, version) {
  const securityName = 'artifact-security.json'
  assert.ok(names.includes(securityName), 'artifact security evidence is missing')
  const evidence = readJson(path.join(output, securityName), securityName)
  assert.equal(evidence.schema, 'localminidrama.artifact-security.v1', 'artifact security schema is invalid')
  assert.equal(evidence.version, version, 'artifact security version does not match the release version')
  assert.match(String(evidence.commit || ''), /^[a-f0-9]{40,64}$/, 'artifact security commit is invalid')
  assert.ok(Number.isFinite(Date.parse(evidence.generated_at)), 'artifact security generated_at is invalid')
  validatePackagedApplications(evidence.packaged_applications)
  assert.equal(evidence.extracted_applications, evidence.packaged_applications.length,
    'artifact security extracted application count is invalid')
  assert.deepEqual(evidence.source_artifacts, [
    `LocalMiniDrama-Portable-${version}-x64.exe`,
    `LocalMiniDrama-Setup-${version}-x64.exe`,
    `LocalMiniDrama-Unpacked-${version}-x64.zip`,
  ], 'artifact security source inventory is invalid')
  assert.deepEqual(
    Object.keys(evidence.source_artifact_sha256 || {}),
    evidence.source_artifacts,
    'artifact security source hash inventory is invalid'
  )
  for (const name of evidence.source_artifacts) {
    const digest = String(evidence.source_artifact_sha256[name] || '')
    assert.match(digest, /^[a-f0-9]{64}$/, `${name} artifact security SHA-256 is invalid`)
    assert.equal(
      sha256(path.join(output, name)),
      digest,
      `${name} SHA-256 does not match the Windows artifact scan evidence`
    )
  }
  assert.deepEqual(evidence.fuses, FUSE_POLICY, 'artifact security Electron fuse policy is invalid')
  assert.deepEqual(Object.keys(evidence.scans || {}).sort(), ['defender', 'gitleaks', 'trivy'])
  for (const scanner of ['gitleaks', 'trivy', 'defender']) {
    const result = evidence.scans[scanner]
    assert.equal(result?.status, 'passed', `${scanner} artifact scan did not pass`)
    assert.match(String(result?.version || ''), /^[A-Za-z0-9][A-Za-z0-9._+() /:-]{0,127}$/, `${scanner} version is invalid`)
    assert.ok(Number.isFinite(Date.parse(result?.generated_at)), `${scanner} scan timestamp is invalid`)
  }
  assert.equal(evidence.scans.trivy.threshold, 'HIGH,CRITICAL', 'Trivy release threshold is invalid')
  assert.equal(evidence.scans.trivy.ignore_unfixed, true, 'Trivy release policy must record ignore_unfixed')
  assert.equal(evidence.scans.trivy.scope, 'release CycloneDX SBOMs and source Dockerfiles',
    'Trivy release scope is invalid')
  assert.deepEqual(evidence.scans.trivy.configuration_files, [
    'backend-node/Dockerfile',
    'frontweb/Dockerfile',
    'frontweb/Dockerfile.prod',
  ], 'Trivy configuration inventory is invalid')
  assert.equal(
    evidence.scans.trivy.configuration_exceptions?.length,
    1,
    'Trivy configuration exceptions are invalid',
  )
  validateBackendContainerUserException(evidence.scans.trivy.configuration_exceptions[0])
  assert.ok(
    Number.isInteger(evidence.scans.trivy.vulnerability_database?.schema_version)
      && evidence.scans.trivy.vulnerability_database.schema_version > 0,
    'Trivy vulnerability DB schema version is invalid',
  )
  assert.ok(
    Number.isFinite(Date.parse(evidence.scans.trivy.vulnerability_database?.updated_at)),
    'Trivy vulnerability DB updated_at is invalid',
  )
  assert.ok(
    Number.isFinite(Date.parse(evidence.scans.trivy.vulnerability_database?.next_update)),
    'Trivy vulnerability DB next_update is invalid',
  )
  assert.match(
    String(evidence.scans.trivy.checks_bundle?.digest || ''),
    /^sha256:[a-f0-9]{64}$/,
    'Trivy checks bundle digest is invalid',
  )
  assert.ok(
    Number.isFinite(Date.parse(evidence.scans.trivy.checks_bundle?.downloaded_at)),
    'Trivy checks bundle downloaded_at is invalid',
  )
  assert.equal(evidence.scans.defender.scope, 'release bundle and extracted payloads', 'Defender release scope is invalid')
  validateDefenderSignatureDetails({
    antivirus_signature_last_updated: evidence.scans.defender.antivirus_signature_last_updated,
    maximum_age_hours: evidence.scans.defender.maximum_age_hours,
  })
  return evidence
}

function validateReleaseArtifacts(output, version) {
  assert.ok(fs.statSync(output, { throwIfNoEntry: false })?.isDirectory(), `release directory does not exist: ${output}`)
  const names = releaseArtifactNames(output)
  assertExactArtifactSet(names, version)
  validateSboms(output, names, version)
  validateMediaMetadata(output, names)
  validateArtifactSecurity(output, names, version)
  return names
}

function artifactInventory(output, names) {
  return names.map((name) => {
    assert.equal(path.basename(name), name, `unsafe release artifact name: ${name}`)
    const filePath = path.join(output, name)
    const bytes = fs.statSync(filePath).size
    assert.ok(Number.isSafeInteger(bytes) && bytes > 0, `${name} must not be empty`)
    return { name, bytes, sha256: sha256(filePath) }
  })
}

function expectedChecksumText(output, artifacts) {
  const manifestPath = path.join(output, 'release-manifest.json')
  const rows = [
    ...artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`),
    `${sha256(manifestPath)}  release-manifest.json`,
  ]
  return `${rows.join('\n')}\n`
}

function generate(outputDirectory, { environment = process.env } = {}) {
  const sourceDirty = assertCleanSourceTree(environment)
  const output = path.resolve(root, outputDirectory || 'desktop/release')
  const version = releaseVersion()
  const names = validateReleaseArtifacts(output, version)
  const commit = currentCommit(environment)
  const securityEvidence = validateArtifactSecurity(output, names, version)
  assert.equal(securityEvidence.commit, commit, 'artifact security evidence was not produced from the release commit')
  const artifacts = artifactInventory(output, names)
  const manifest = {
    schema: 'localminidrama.release-manifest.v1',
    version,
    tag: releaseTag(version, environment),
    commit,
    git_commit: commit,
    source_dirty: sourceDirty,
    generated_at: new Date().toISOString(),
    artifacts,
  }
  const manifestPath = path.join(output, 'release-manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), expectedChecksumText(output, artifacts), 'utf8')

  for (const artifact of artifacts) {
    assert.equal(sha256(path.join(output, artifact.name)), artifact.sha256)
  }
  console.log(JSON.stringify({ output, version, artifact_count: artifacts.length, verified: true }))
  return manifest
}

function verify(outputDirectory, { environment = process.env } = {}) {
  const output = path.resolve(root, outputDirectory || 'desktop/release')
  const version = releaseVersion()
  const names = validateReleaseArtifacts(output, version)
  assertNoUnexpectedTopLevelFiles(output, version)
  const manifestPath = path.join(output, 'release-manifest.json')
  const checksumPath = path.join(output, 'SHA256SUMS')
  assert.ok(fs.statSync(manifestPath, { throwIfNoEntry: false })?.isFile(), 'release-manifest.json is missing')
  assert.ok(fs.statSync(checksumPath, { throwIfNoEntry: false })?.isFile(), 'SHA256SUMS is missing')

  const manifest = readJson(manifestPath, 'release-manifest.json')
  assert.equal(manifest.schema, 'localminidrama.release-manifest.v1')
  assert.equal(manifest.version, version, 'release manifest version does not match desktop/package.json')
  assert.equal(manifest.tag, releaseTag(version, environment), 'release manifest tag does not match the release tag')
  assert.equal(manifest.source_dirty, false, 'release manifest records a dirty source tree')
  assert.match(String(manifest.commit || ''), /^[a-f0-9]{40,64}$/, 'release manifest commit is invalid')
  assert.equal(manifest.commit, currentCommit(environment), 'release manifest commit does not match Git HEAD')
  assert.equal(manifest.git_commit, manifest.commit, 'release manifest git_commit does not match commit')
  assert.ok(Number.isFinite(Date.parse(manifest.generated_at)), 'release manifest generated_at is invalid')
  assert.ok(Array.isArray(manifest.artifacts), 'release manifest artifacts must be an array')
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.name), names, 'release manifest artifact order or names differ')
  assert.equal(
    validateArtifactSecurity(output, names, version).commit,
    manifest.git_commit,
    'artifact security evidence commit does not match the release manifest'
  )

  const seen = new Set()
  for (const artifact of manifest.artifacts) {
    assert.equal(path.basename(artifact.name), artifact.name, `unsafe manifest artifact name: ${artifact.name}`)
    assert.equal(seen.has(artifact.name), false, `duplicate manifest artifact: ${artifact.name}`)
    seen.add(artifact.name)
    assert.match(String(artifact.sha256 || ''), /^[a-f0-9]{64}$/, `${artifact.name} has an invalid SHA-256`)
    const filePath = path.join(output, artifact.name)
    assert.equal(fs.statSync(filePath).size, artifact.bytes, `${artifact.name} byte count does not match manifest`)
    assert.equal(sha256(filePath), artifact.sha256, `${artifact.name} SHA-256 does not match manifest`)
  }

  assert.equal(
    fs.readFileSync(checksumPath, 'utf8'),
    expectedChecksumText(output, manifest.artifacts),
    'SHA256SUMS does not exactly match the release manifest and files'
  )
  return { output, version, artifact_count: names.length, verified: true }
}

module.exports = {
  artifactInventory,
  assertCleanSourceTree,
  assertExactArtifactSet,
  currentCommit,
  expectedChecksumText,
  expectedReleaseArtifactNames,
  generate,
  isReleaseArtifact,
  readJson,
  releaseTag,
  sha256,
  validateBackendContainerUserException,
  validateArtifactSecurity,
  validateReleaseArtifacts,
  parseReleaseMetadataArguments,
  verify,
}

if (require.main === module) {
  const { mode, outputDirectory } = parseReleaseMetadataArguments()
  if (mode === 'verify') verify(outputDirectory)
  else generate(outputDirectory)
}
