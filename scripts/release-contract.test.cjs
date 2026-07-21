'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  artifactInventory,
  currentCommit,
  expectedChecksumText,
  expectedReleaseArtifactNames,
  isReleaseArtifact,
  verify,
} = require('./generate-release-metadata.cjs')
const { validatePackagedApplications } = require('./packaged-applications-contract.cjs')
const {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  evidenceOutputPath,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
  validateEvidenceV3,
} = require('./rollback-drill-evidence.cjs')
const {
  expectedVersion,
  releaseTagVersion,
  verifyReleaseVersion,
} = require('./verify-release-version.cjs')
const {
  assertMacReleaseFailsClosed,
  assertReleaseBuilderNeverPublishes,
  npmInvocation,
  validateSbomDocument,
  verifyRemoteReleaseTag,
  writeReleaseSboms,
  writeSbomOutput,
} = require('./verify-release.cjs')
const { sanitizeRuntimeConfig, sanitizeRuntimeConfigFile } = require('./runtime-config-policy.cjs')
const { getTrustedMediaToolRelease } = require('../desktop/scripts/media-tool-policy')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')

const root = path.resolve(__dirname, '..')
const checkpointScriptPath = path.join(root, 'scripts', 'create-release-rollback-checkpoint.ps1')
const rollbackRestoreScriptPath = path.join(root, 'scripts', 'restore-release-rollback-checkpoint.ps1')
const rollbackIdentityScriptPath = path.join(root, 'scripts', 'rollback-path-identity.ps1')
const backendRequire = createRequire(path.join(root, 'backend-node', 'package.json'))
const { parse: parseToml } = backendRequire('smol-toml')
const { load: parseYaml } = backendRequire('js-yaml')
const gitAttributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8')
const checkpointScript = fs.readFileSync(path.join(root, 'scripts', 'create-release-rollback-checkpoint.ps1'), 'utf8')
const rollbackRestoreScript = fs.readFileSync(path.join(root, 'scripts', 'restore-release-rollback-checkpoint.ps1'), 'utf8')
const backupDataScript = fs.readFileSync(path.join(root, 'backend-node', 'scripts', 'backup-data.js'), 'utf8')
const restoreDataScript = fs.readFileSync(path.join(root, 'backend-node', 'scripts', 'restore-data.js'), 'utf8')
const rollbackDrillScript = fs.readFileSync(path.join(root, 'scripts', 'run-rollback-drill.cjs'), 'utf8')
const dockerComposeRevisionScript = fs.readFileSync(path.join(root, 'scripts', 'docker-compose-with-revision.cjs'), 'utf8')
const backendTrivyIgnore = fs.readFileSync(path.join(root, 'backend-node', '.trivyignore.yaml'), 'utf8')
const backendDockerfile = fs.readFileSync(path.join(root, 'backend-node', 'Dockerfile'), 'utf8')
const backendEntrypoint = fs.readFileSync(path.join(root, 'backend-node', 'docker-entrypoint.sh'), 'utf8')
const frontendDockerfile = fs.readFileSync(path.join(root, 'frontweb', 'Dockerfile.prod'), 'utf8')
const dockerCompose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')
const ciWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const windowsReleaseSecurityWorkflowPath = path.join(
  root,
  '.github',
  'workflows',
  'windows-release-security.yml',
)
const windowsReleaseSecurityWorkflow = fs.existsSync(windowsReleaseSecurityWorkflowPath)
  ? fs.readFileSync(windowsReleaseSecurityWorkflowPath, 'utf8')
  : ''
const dockerArtifactVerifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-docker-artifact.cjs'), 'utf8')
const releaseVerifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-release.cjs'), 'utf8')
const windowsArtifactVerifierSource = fs.readFileSync(
  path.join(root, 'desktop', 'scripts', 'verify-windows-artifacts.js'),
  'utf8',
)
const sourceGitleaksConfig = fs.readFileSync(path.join(root, '.gitleaks.toml'), 'utf8')
const sourceGitleaksIgnore = fs.readFileSync(path.join(root, '.gitleaksignore'), 'utf8')
const artifactGitleaksConfig = fs.readFileSync(path.join(root, '.gitleaks-artifacts.toml'), 'utf8')
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const backendPackage = JSON.parse(fs.readFileSync(path.join(root, 'backend-node', 'package.json'), 'utf8'))
const frontendPackage = JSON.parse(fs.readFileSync(path.join(root, 'frontweb', 'package.json'), 'utf8'))
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
const ciWorkflowDocument = parseYaml(ciWorkflow)
const releaseWorkflowDocument = parseYaml(workflow)
const gitHeadResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
assert.equal(gitHeadResult.status, 0, gitHeadResult.stderr || 'unable to read fixture Git HEAD')
const gitHead = String(gitHeadResult.stdout || '').trim().toLowerCase()
assert.match(gitHead, /^[a-f0-9]{40,64}$/)

function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function findPowerShell(command) {
  const result = spawnSync('where.exe', [command], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) return null
  return String(result.stdout).split(/\r?\n/).find(Boolean) || null
}

function windowsPowerShellHosts() {
  const hosts = [{ name: 'windows-powershell-5.1', executable: 'powershell.exe' }]
  const pwsh = findPowerShell('pwsh.exe')
  if (pwsh) hosts.push({ name: 'powershell-7', executable: pwsh })
  return hosts
}

function runPowerShellStatements(statements, { executable } = {}) {
  const shell = executable || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh')
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-ps-probe-'))
  const probePath = path.join(fixtureRoot, 'probe.ps1')
  fs.writeFileSync(probePath, `$ErrorActionPreference = 'Stop'\n${statements}\n`, 'utf8')
  try {
    return spawnSync(shell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      probePath,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    })
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function assertPowerShellStatements(statements, options) {
  const result = runPowerShellStatements(statements, options)
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
  return result
}

function rollbackHostProbeStatements(fixtureRoot) {
  const identityDirectory = path.join(fixtureRoot, 'identity-directory')
  const identityFile = path.join(fixtureRoot, 'identity-file.bin')
  const callerDirectory = path.join(fixtureRoot, 'caller-directory')
  const callerDirectoryRenamed = path.join(fixtureRoot, 'caller-directory-renamed')
  const callerArchive = path.join(fixtureRoot, 'caller-archive.zip')
  const callerArchiveRenamed = path.join(fixtureRoot, 'caller-archive-renamed.zip')
  const failureDirectory = path.join(fixtureRoot, 'failure-directory')
  const failureDirectoryRenamed = path.join(fixtureRoot, 'failure-directory-renamed')
  const failureArchive = path.join(fixtureRoot, 'failure-archive.zip')
  const failureArchiveRenamed = path.join(fixtureRoot, 'failure-archive-renamed.zip')
  fs.mkdirSync(identityDirectory)
  fs.writeFileSync(identityFile, 'identity')
  fs.mkdirSync(callerDirectory)
  fs.writeFileSync(callerArchive, 'caller archive')
  fs.mkdirSync(failureDirectory)
  fs.writeFileSync(failureArchive, 'failure archive')
  const identityOf = (target) => {
    const stat = fs.statSync(target, { bigint: true })
    return `${stat.dev.toString(16).padStart(8, '0')}:${stat.ino.toString(16).padStart(16, '0')}`
  }
  const blockedRenameProgram = "const fs=require('fs');try{fs.renameSync(process.argv[1],process.argv[2]);process.exit(24)}catch{process.exit(23)}"
  const blockedDeleteProgram = "const fs=require('fs');try{fs.rmdirSync(process.argv[1]);process.exit(24)}catch{process.exit(23)}"
  const renameProgram = "require('fs').renameSync(process.argv[1],process.argv[2])"
  const deleteDirectoryProgram = "require('fs').rmdirSync(process.argv[1])"
  const readerProgram = "const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[1],'utf8'))"
  return `
$ErrorActionPreference = 'Stop'
$identityDirectory = ${powerShellLiteral(identityDirectory)}
$identityFile = ${powerShellLiteral(identityFile)}
$directoryIdentity = Get-RollbackPathIdentity -Path $identityDirectory
$fileIdentity = Get-RollbackPathIdentity -Path $identityFile
if ($directoryIdentity -cne ${powerShellLiteral(identityOf(identityDirectory))}) { throw 'Directory native identity mismatch.' }
if ($fileIdentity -cne ${powerShellLiteral(identityOf(identityFile))}) { throw 'File native identity mismatch.' }
. ${powerShellLiteral(rollbackIdentityScriptPath)}
$reloadedIdentity = Get-RollbackPathIdentity -Path $identityFile
if ($reloadedIdentity -cne $fileIdentity) { throw 'Native helper re-entry changed identity.' }

$summary = @'
{
  "schema": "localminidrama.rollback-drill.v3",
  "status": "passed",
  "input_mode": "checkpoint-bound",
  "source": {
    "commit": "cccccccccccccccccccccccccccccccccccccccc",
    "version": "1.3.3-rc.1",
    "working_tree_dirty": false,
    "data_root_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "backup": {
    "archive_retained": true,
    "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "operations": { "source_data_root_unchanged": true }
}
'@ | ConvertFrom-Json
$validated = @(Assert-CheckpointDrillEvidence -Summary $summary -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity $directoryIdentity -ActualDataRootIdentity $directoryIdentity)
if ($validated.Count -ne 1 -or $validated[0].data_root_identity -cne $directoryIdentity) { throw 'Validator host probe failed.' }

$callerDirectory = ${powerShellLiteral(callerDirectory)}
$callerDirectoryRenamed = ${powerShellLiteral(callerDirectoryRenamed)}
$directoryLock = Open-RollbackDirectoryIdentityLock -Path $callerDirectory
$intentionalDirectoryFailure = $false
try {
  $retainedDirectoryIdentity = Get-RollbackPathIdentity -Handle $directoryLock
  Assert-RollbackPathIdentity -Path $callerDirectory -ExpectedIdentity $retainedDirectoryIdentity -Label 'host directory lock' | Out-Null
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(blockedRenameProgram)} $callerDirectory $callerDirectoryRenamed
  if ($LASTEXITCODE -ne 23) { throw 'Directory rename was not blocked during caller failure probe.' }
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(blockedDeleteProgram)} $callerDirectory
  if ($LASTEXITCODE -ne 23) { throw 'Directory delete was not blocked during caller failure probe.' }
  $child = Join-Path $callerDirectory 'child.txt'
  [System.IO.File]::WriteAllText($child, 'first')
  [System.IO.File]::WriteAllText($child, 'second')
  if ([System.IO.File]::ReadAllText($child) -cne 'second') { throw 'Directory descendant access failed.' }
  [System.IO.File]::Delete($child)
  throw 'intentional directory caller failure'
} catch {
  if ($_.Exception.Message -cne 'intentional directory caller failure') { throw }
  $intentionalDirectoryFailure = $true
} finally {
  $directoryLock.Dispose()
}
if (-not $intentionalDirectoryFailure) { throw 'Directory caller failure did not execute.' }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(renameProgram)} $callerDirectory $callerDirectoryRenamed
if ($LASTEXITCODE -ne 0) { throw 'Directory rename release control failed.' }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(deleteDirectoryProgram)} $callerDirectoryRenamed
if ($LASTEXITCODE -ne 0) { throw 'Directory delete release control failed.' }

$callerArchive = ${powerShellLiteral(callerArchive)}
$callerArchiveRenamed = ${powerShellLiteral(callerArchiveRenamed)}
$archiveLock = Open-RollbackArchiveReadLock -Path $callerArchive
$intentionalArchiveFailure = $false
try {
  $retainedArchiveIdentity = Get-RollbackPathIdentity -Handle $archiveLock.SafeFileHandle
  Assert-RollbackPathIdentity -Path $callerArchive -ExpectedIdentity $retainedArchiveIdentity -Label 'host archive lock' | Out-Null
  $readerOutput = & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(readerProgram)} $callerArchive
  if ($LASTEXITCODE -ne 0 -or ($readerOutput -join [Environment]::NewLine) -cne 'caller archive') { throw 'Node 20 archive read failed.' }
  $writeBlocked = $false
  try { [System.IO.File]::WriteAllText($callerArchive, 'mutated') } catch { $writeBlocked = $true }
  if (-not $writeBlocked) { throw 'Archive write was not blocked during caller failure probe.' }
  $deleteBlocked = $false
  try { [System.IO.File]::Delete($callerArchive) } catch { $deleteBlocked = $true }
  if (-not $deleteBlocked) { throw 'Archive delete was not blocked during caller failure probe.' }
  $renameBlocked = $false
  try { [System.IO.File]::Move($callerArchive, $callerArchiveRenamed) } catch { $renameBlocked = $true }
  if (-not $renameBlocked) { throw 'Archive rename was not blocked during caller failure probe.' }
  throw 'intentional archive caller failure'
} catch {
  if ($_.Exception.Message -cne 'intentional archive caller failure') { throw }
  $intentionalArchiveFailure = $true
} finally {
  $archiveLock.Dispose()
}
if (-not $intentionalArchiveFailure) { throw 'Archive caller failure did not execute.' }
[System.IO.File]::WriteAllText($callerArchive, 'release control')
[System.IO.File]::Move($callerArchive, $callerArchiveRenamed)
[System.IO.File]::Delete($callerArchiveRenamed)

function Assert-RollbackPathIdentity { throw 'forced post-open validation failure' }
$failureDirectory = ${powerShellLiteral(failureDirectory)}
$failureDirectoryRenamed = ${powerShellLiteral(failureDirectoryRenamed)}
$directoryFailureRejected = $false
$unexpectedDirectoryLock = $null
try { $unexpectedDirectoryLock = Open-RollbackDirectoryIdentityLock -Path $failureDirectory } catch {
  if ($_.Exception.Message -cne 'forced post-open validation failure') { throw }
  $directoryFailureRejected = $true
} finally {
  if ($null -ne $unexpectedDirectoryLock) { $unexpectedDirectoryLock.Dispose() }
}
if (-not $directoryFailureRejected) { throw 'Directory post-open validation failure was not induced.' }
[System.IO.Directory]::Move($failureDirectory, $failureDirectoryRenamed)
[System.IO.Directory]::Delete($failureDirectoryRenamed)

$failureArchive = ${powerShellLiteral(failureArchive)}
$failureArchiveRenamed = ${powerShellLiteral(failureArchiveRenamed)}
$archiveFailureRejected = $false
$unexpectedArchiveLock = $null
try { $unexpectedArchiveLock = Open-RollbackArchiveReadLock -Path $failureArchive } catch {
  if ($_.Exception.Message -cne 'forced post-open validation failure') { throw }
  $archiveFailureRejected = $true
} finally {
  if ($null -ne $unexpectedArchiveLock) { $unexpectedArchiveLock.Dispose() }
}
if (-not $archiveFailureRejected) { throw 'Archive post-open validation failure was not induced.' }
[System.IO.File]::Move($failureArchive, $failureArchiveRenamed)
[System.IO.File]::Delete($failureArchiveRenamed)
`
}

function runRollbackPathProbe(scriptSource, statements) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-path-probe-'))
  const probePath = path.join(fixtureRoot, 'probe.ps1')
  if (scriptSource === checkpointScript) {
    fs.writeFileSync(probePath, `. ${powerShellLiteral(checkpointScriptPath)}\n${statements}\n`, 'utf8')
  } else {
    fs.writeFileSync(probePath, `. ${powerShellLiteral(rollbackRestoreScriptPath)}\n${statements}\n`, 'utf8')
  }
  try {
    return spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      probePath,
      '-CheckpointDirectory',
      fixtureRoot,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    })
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function assertRollbackPathProbe(scriptSource, statements) {
  const result = runRollbackPathProbe(scriptSource, statements)
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
}

function jobBlock(name, source = workflow) {
  const marker = `  ${name}:`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `workflow job ${name} is missing`)
  const remainder = source.slice(start + marker.length)
  const nextJob = remainder.search(/\r?\n  [a-z][a-z0-9-]*:\r?\n/)
  return source.slice(start, nextJob === -1 ? source.length : start + marker.length + nextJob)
}

function assertExampleDramaLfsGate(workflowDocument, jobName) {
  const job = workflowDocument.jobs[jobName]
  assert.ok(job, `workflow job ${jobName} is missing`)
  const steps = job.steps || []
  const checkout = steps.find((step) => String(step.uses || '').startsWith('actions/checkout@'))
  assert.ok(checkout, `${jobName} must check out the repository`)
  assert.equal(checkout.with?.lfs, true, `${jobName} checkout must enable Git LFS`)

  const pinnedNodeSetup = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
  const nodeSetupIndex = steps.findIndex((step) => step.uses === pinnedNodeSetup)
  assert.notEqual(nodeSetupIndex, -1, `${jobName} must use the pinned Node.js setup action`)
  assert.equal(steps[nodeSetupIndex].with?.['node-version'], '20')

  const gate = steps[nodeSetupIndex + 1]
  assert.equal(gate?.name, 'Verify Git LFS example source')
  assert.deepEqual(String(gate?.run || '').trim().split(/\r?\n/), [
    'git lfs fsck',
    'npm run verify:example-drama',
  ])
}

function trustedMediaMetadata() {
  const release = getTrustedMediaToolRelease('win32', 'x64')
  return {
    schema: 'localminidrama.media-tools.v1',
    platform: release.platform,
    arch: release.arch,
    releaseVersion: release.releaseVersion,
    source: {
      packageUrl: release.package.url,
      packageSha256: release.package.sha256,
      payloadPath: release.payload.path,
      payloadSha256: release.payload.sha256,
    },
    tools: [
      {
        name: release.tools.ffmpeg.fileName,
        version: 'ffmpeg version 8.1.2-essentials_build-www.gyan.dev Copyright',
        sha256: release.tools.ffmpeg.sha256,
      },
      {
        name: release.tools.ffprobe.fileName,
        version: 'ffprobe version 8.1.2-essentials_build-www.gyan.dev Copyright',
        sha256: release.tools.ffprobe.sha256,
      },
    ],
  }
}

function passedArtifactSecurity(version, output, commit = gitHead) {
  const sourceArtifacts = [
    `LocalMiniDrama-Portable-${version}-x64.exe`,
    `LocalMiniDrama-Setup-${version}-x64.exe`,
    `LocalMiniDrama-Unpacked-${version}-x64.zip`,
  ]
  return {
    schema: 'localminidrama.artifact-security.v1',
    version,
    commit,
    generated_at: '2026-07-17T00:00:00.000Z',
    source_artifacts: sourceArtifacts,
    source_artifact_sha256: Object.fromEntries(
      artifactInventory(output, sourceArtifacts).map((artifact) => [artifact.name, artifact.sha256])
    ),
    extracted_applications: 3,
    packaged_applications: ['setup', 'portable', 'unpacked'].map((kind) => ({
      executable: `${kind}/LocalMiniDrama.exe`,
      asar: `${kind}/resources/app.asar`,
      example_drama: {
        path: `${kind}/resources/example_drama/衣服设计天才302.zip`,
        bytes: 82156132,
        sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
      },
      fuses: Object.fromEntries(
        Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
      ),
    })),
    fuses: FUSE_POLICY,
    scans: {
      gitleaks: { version: '8.28.0', status: 'passed', generated_at: '2026-07-17T00:00:00.000Z' },
      trivy: {
        version: '0.64.1',
        status: 'passed',
        generated_at: '2026-07-17T00:00:00.000Z',
        threshold: 'HIGH,CRITICAL',
        ignore_unfixed: true,
        scope: 'release CycloneDX SBOMs and source Dockerfiles',
        configuration_files: [
          'backend-node/Dockerfile',
          'frontweb/Dockerfile',
          'frontweb/Dockerfile.prod',
        ],
        configuration_exceptions: [{
          id: 'AVD-DS-0002',
          path: 'backend-node/Dockerfile',
          review_by: '2027-07-17',
          rationale: 'The entrypoint repairs bind-mounted data ownership before immediately executing as node via setpriv.',
        }],
        vulnerability_database: {
          schema_version: 2,
          updated_at: '2026-07-17T13:09:25.875519042Z',
          next_update: '2026-07-18T13:09:25.87551825Z',
        },
        checks_bundle: {
          digest: `sha256:${'b'.repeat(64)}`,
          downloaded_at: '2026-07-17T17:36:34.087206269Z',
        },
      },
      defender: {
        version: '1.1.25060.6-1.437.42.0',
        status: 'passed',
        generated_at: '2026-07-17T00:00:00.000Z',
        scope: 'release bundle and extracted payloads',
      },
    },
  }
}

function releaseSbomPackages(version) {
  return new Map([
    ['sbom-backend.cdx.json', 'backend-node'],
    ['sbom-frontend.cdx.json', 'frontweb'],
    ['sbom-desktop.cdx.json', 'desktop'],
    [`LocalMiniDrama-${version}.cdx.json`, 'desktop'],
  ])
}

function createReleaseFixture(t, { commit = gitHead } = {}) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-release-contract-'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  const version = desktopPackage.version
  const names = expectedReleaseArtifactNames(version)
  for (const name of names) {
    const filePath = path.join(output, name)
    if (name === 'media-tools.json') {
      fs.writeFileSync(filePath, `${JSON.stringify(trustedMediaMetadata(), null, 2)}\n`)
    } else if (name === 'artifact-security.json') {
      continue
    } else if (name.endsWith('.cdx.json')) {
      const packageDirectory = releaseSbomPackages(version).get(name)
      assert.ok(packageDirectory, `release fixture has no package mapping for ${name}`)
      fs.writeFileSync(filePath, `${JSON.stringify(completeDirectDependencySbom(packageDirectory), null, 2)}\n`)
    } else {
      fs.writeFileSync(filePath, `fixture:${name}\n`)
    }
  }
  fs.writeFileSync(
    path.join(output, 'artifact-security.json'),
    `${JSON.stringify(passedArtifactSecurity(version, output, commit), null, 2)}\n`,
  )

  const artifacts = artifactInventory(output, names)
  const manifest = {
    schema: 'localminidrama.release-manifest.v1',
    version,
    tag: `v${version}`,
    commit,
    source_dirty: false,
    generated_at: '2026-07-17T00:00:00.000Z',
    artifacts,
  }
  fs.writeFileSync(path.join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), expectedChecksumText(output, artifacts))
  return { artifacts, output, version }
}

function createSbomFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-sbom-contract-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const packageDirectory = path.join(fixtureRoot, 'package')
  const outputDirectory = path.join(fixtureRoot, 'release')
  fs.mkdirSync(packageDirectory, { recursive: true })

  const packageJson = {
    name: 'fixture-app',
    version: '1.0.0',
    dependencies: { alpha: '^1.0.0' },
    devDependencies: { beta: '^2.0.0' },
  }
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: { ...packageJson.dependencies },
        devDependencies: { ...packageJson.devDependencies },
      },
      'node_modules/alpha': { version: '1.4.0' },
      'node_modules/beta': { version: '2.1.0', dev: true },
    },
  }
  fs.writeFileSync(path.join(packageDirectory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  fs.writeFileSync(path.join(packageDirectory, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`)

  const rootRef = 'fixture-app@1.0.0'
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: {
      component: {
        'bom-ref': rootRef,
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
      },
    },
    components: [
      { 'bom-ref': 'alpha@1.4.0', type: 'library', name: 'alpha', version: '1.4.0' },
      { 'bom-ref': 'beta@2.1.0', type: 'library', name: 'beta', version: '2.1.0' },
    ],
    dependencies: [
      { ref: rootRef, dependsOn: ['alpha@1.4.0', 'beta@2.1.0'] },
      { ref: 'alpha@1.4.0', dependsOn: [] },
      { ref: 'beta@2.1.0', dependsOn: [] },
    ],
  }
  return { outputDirectory, packageDirectory, packageLock, sbom }
}

function completeDirectDependencySbom(packageDirectory) {
  const packageRoot = path.join(root, packageDirectory)
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const packageLock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-lock.json'), 'utf8'))
  const directNames = [...new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ])].sort((a, b) => a.localeCompare(b, 'en'))
  const rootRef = `${packageJson.name}@${packageJson.version}`
  const components = directNames.map((name) => {
    const version = packageLock.packages[`node_modules/${name}`].version
    return { 'bom-ref': `${name}@${version}`, type: 'library', name, version }
  })
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: {
      component: {
        'bom-ref': rootRef,
        type: 'application',
        name: packageJson.name,
        version: packageJson.version,
      },
    },
    components,
    dependencies: [
      { ref: rootRef, dependsOn: components.map((component) => component['bom-ref']) },
      ...components.map((component) => ({ ref: component['bom-ref'], dependsOn: [] })),
    ],
  }
}

test('all desktop release builders explicitly disable electron-builder publishing', () => {
  assertReleaseBuilderNeverPublishes()
  assert.equal(desktopPackage.build.beforePack, './scripts/media-tool-policy.js')
  for (const scriptName of ['pack', 'dist']) {
    assert.match(desktopPackage.scripts[scriptName], /electron-builder[^&]*--publish never(?:\s|$)/)
  }
})

test('user ZIP parsers pin the four-gigabyte allocation fix', () => {
  assert.equal(backendPackage.dependencies['adm-zip'], '0.6.0')
  assert.equal(desktopPackage.dependencies['adm-zip'], '0.6.0')
})

test('root source gate syntax-checks and executes the OpenClaw contract', () => {
  assert.equal(
    rootPackage.scripts['test:openclaw-contract'],
    'node --test scripts/openclaw-contract.test.cjs'
  )
  const syntaxGate = rootPackage.scripts.check.indexOf(
    'node --check scripts/openclaw-contract.test.cjs'
  )
  const executionGate = rootPackage.scripts.check.indexOf('npm run test:openclaw-contract')
  assert.ok(syntaxGate >= 0, 'root check must syntax-check the OpenClaw contract')
  assert.ok(executionGate > syntaxGate, 'root check must execute it after syntax validation')
})

test('root check runs only the fixture-sized example drama contract', () => {
  assert.equal(
    rootPackage.scripts['test:example-drama-contract'],
    'node --test scripts/example-drama-contract.test.cjs',
  )
  assert.equal(
    rootPackage.scripts['verify:example-drama'],
    'node scripts/example-drama-contract.cjs',
  )
  assert.match(rootPackage.scripts.check, /npm run test:example-drama-contract/)
  assert.doesNotMatch(rootPackage.scripts.check, /npm run verify:example-drama/)

  const verifierSyntaxGate = rootPackage.scripts.check.indexOf(
    'node --check scripts/example-drama-contract.cjs',
  )
  const testSyntaxGate = rootPackage.scripts.check.indexOf(
    'node --check scripts/example-drama-contract.test.cjs',
  )
  const executionGate = rootPackage.scripts.check.indexOf('npm run test:example-drama-contract')
  assert.ok(verifierSyntaxGate >= 0, 'root check must syntax-check the example drama verifier')
  assert.ok(testSyntaxGate >= 0, 'root check must syntax-check the example drama fixture contract')
  assert.ok(executionGate > testSyntaxGate, 'root check must run fixture tests after syntax validation')
})

test('CI desktop LFS checkout verifies the example drama immediately after Node setup', () => {
  assertExampleDramaLfsGate(ciWorkflowDocument, 'desktop')
})

test('release build-windows LFS checkout verifies the example drama immediately after Node setup', () => {
  assertExampleDramaLfsGate(releaseWorkflowDocument, 'build-windows')
})

test('only the two Windows build jobs hydrate and verify the production LFS example', () => {
  const actual = []
  for (const [workflowName, document] of [
    ['ci', ciWorkflowDocument],
    ['release', releaseWorkflowDocument],
  ]) {
    for (const [jobName, job] of Object.entries(document.jobs || {})) {
      const steps = job.steps || []
      const hydratesLfs = steps.some((step) => (
        String(step.uses || '').startsWith('actions/checkout@') && step.with?.lfs === true
      ))
      const verifiesExample = steps.some((step) => (
        String(step.run || '').split(/\r?\n/).some((line) => line.trim() === 'npm run verify:example-drama')
      ))
      if (hydratesLfs || verifiesExample) {
        assert.equal(hydratesLfs, true, `${workflowName}:${jobName} verifies without LFS hydration`)
        assert.equal(verifiesExample, true, `${workflowName}:${jobName} hydrates LFS without verification`)
        actual.push(`${workflowName}:${jobName}`)
      }
    }
  }
  assert.deepEqual(actual, ['ci:desktop', 'release:build-windows'])
})

test('verified Docker startup binds images to a clean full Git revision', () => {
  assert.equal(rootPackage.scripts['docker:up'], 'node scripts/docker-compose-with-revision.cjs')
  assert.equal(rootPackage.scripts['docker:e2e:up'], 'node scripts/docker-compose-with-revision.cjs --profile e2e')
  assert.match(dockerComposeRevisionScript, /git[\s\S]*status[\s\S]*clean Git working tree/)
  assert.match(dockerComposeRevisionScript, /rev-parse[\s\S]*LOCALMINIDRAMA_BUILD_REVISION: revision/)
  assert.match(dockerComposeRevisionScript, /LOCALMINIDRAMA_IMAGE_TAG: imageTag/)
  assert.match(dockerComposeRevisionScript, /'docker',\s*\['image',\s*'inspect'[\s\S]*org\.opencontainers\.image\.revision/)
  assert.deepEqual(require('./docker-compose-with-revision.cjs').parseArguments(['--profile', 'e2e']), ['e2e'])
  assert.throws(() => require('./docker-compose-with-revision.cjs').parseArguments(['--profile', '../bad']))
})

test('source release verification uses the clean revision-bound Docker launcher', () => {
  assert.match(releaseVerifierSource, /runNpm\(\['run', 'docker:e2e:up'\]\)/)
  assert.doesNotMatch(
    releaseVerifierSource,
    /run\(dockerCommand, \['compose', '--profile', 'e2e', 'up', '-d', '--build', '--wait'\]\)/,
  )
})

test('release contract jobs install the runtime YAML parser before root checks', () => {
  const ciContract = jobBlock('release-contract', ciWorkflow)
  const windowsRelease = jobBlock('build-windows', workflow)
  for (const [label, source] of [['CI release contract', ciContract], ['Windows release', windowsRelease]]) {
    const install = source.indexOf('working-directory: backend-node')
    const rootCheck = source.indexOf('npm run check')
    assert.ok(install >= 0 && install < rootCheck, `${label} must install backend dependencies before npm run check`)
  }
})

test('production containers and tag releases bind, harden, and scan final images', () => {
  for (const dockerfile of [backendDockerfile, frontendDockerfile]) {
    assert.match(dockerfile, /ARG LOCALMINIDRAMA_BUILD_REVISION=unknown/)
    assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision="\$\{LOCALMINIDRAMA_BUILD_REVISION\}"/)
  }
  assert.match(dockerCompose, /LOCALMINIDRAMA_BUILD_REVISION: \$\{LOCALMINIDRAMA_BUILD_REVISION:-unknown\}/)
  assert.match(dockerCompose, /read_only: true/)
  assert.match(dockerCompose, /no-new-privileges:true/)
  assert.match(dockerCompose, /cap_drop:\s*\r?\n\s*- ALL/)
  assert.match(dockerCompose, /source: \$\{LOCALMINIDRAMA_CONFIG_DIR:-\.\/backend-node\/configs\}/)
  assert.match(dockerCompose, /target: \/app\/config-source/)
  assert.match(dockerCompose, /LOCALMINIDRAMA_CONFIG_SOURCE: \/app\/config-source\/config\.yaml/)
  assert.match(backendEntrypoint, /runtime-config-policy\.cjs "\$config_source" "\$config_target"/)

  const releaseProduction = jobBlock('production-e2e')
  assert.match(releaseProduction, /LOCALMINIDRAMA_BUILD_REVISION: \$\{\{ github\.sha \}\}/)
  assert.match(releaseProduction, /git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main/)
  assert.match(releaseProduction, /docker image inspect[\s\S]*org\.opencontainers\.image\.revision/)
  assert.match(releaseProduction, /trivy-backend\.json[\s\S]*trivy-frontend\.json/)
  assert.match(releaseProduction, /--severity HIGH,CRITICAL/)

  const ciProduction = jobBlock('docker-production-e2e', ciWorkflow)
  assert.match(ciProduction, /LOCALMINIDRAMA_BUILD_REVISION: \$\{\{ github\.sha \}\}/)
  assert.match(ciProduction, /docker-image-ids\.txt/)
  assert.match(ciProduction, /trivy-backend\.json[\s\S]*trivy-frontend\.json/)
})

test('tag releases require a successful pre-tag push CI run for the exact main commit', () => {
  const gate = jobBlock('release-source-gate')
  const production = jobBlock('production-e2e')
  const rollback = jobBlock('rollback-drill')

  assert.match(workflow, /^permissions:\s*\{\}\s*$/m)
  assert.match(gate, /permissions:\r?\n      actions: read/)
  assert.doesNotMatch(gate, /contents:|actions: write/)
  assert.match(gate, /actions\/github-script@[a-f0-9]{40}/)
  assert.match(gate, /workflow_id:\s*['"]ci\.yml['"]/)
  assert.match(gate, /branch:\s*['"]main['"]/)
  assert.match(gate, /event:\s*['"]push['"]/)
  assert.match(gate, /status:\s*['"]success['"]/)
  assert.match(gate, /head_sha:\s*context\.sha/)
  assert.match(gate, /runs\.push\(\.\.\.response\.data\)/)
  assert.doesNotMatch(gate, /response\.data\.workflow_runs/)
  assert.match(gate, /run\.event === ['"]push['"]/)
  assert.match(gate, /run\.head_branch === ['"]main['"]/)
  assert.match(gate, /run\.head_sha === context\.sha/)
  assert.match(gate, /run\.conclusion === ['"]success['"]/)
  assert.match(gate, /Date\.parse\(run\.updated_at\) < releaseCreatedAt/)
  assert.match(production, /needs: release-source-gate/)
  assert.match(rollback, /needs: release-source-gate/)
})

test('pre-tag CI gate executes against normalized Octokit pages and rejects inexact runs', async () => {
  const script = releaseWorkflowDocument.jobs['release-source-gate'].steps[0].with.script
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const execute = new AsyncFunction('github', 'context', script)
  const sha = '1'.repeat(40)
  const releaseCreatedAt = '2026-07-20T10:00:01.000Z'
  const validRun = {
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-07-20T10:00:00.000Z',
  }

  async function invoke(runs) {
    const queries = []
    const github = {
      rest: {
        actions: {
          getWorkflowRun: async () => ({ data: { created_at: releaseCreatedAt } }),
          listWorkflowRuns: () => {},
        },
      },
      paginate: {
        iterator: async function* (method, query) {
          assert.equal(method, github.rest.actions.listWorkflowRuns)
          queries.push(query)
          yield { data: runs }
        },
      },
    }
    await execute(github, {
      repo: { owner: 'fixture-owner', repo: 'fixture-repo' },
      runId: 123,
      sha,
    })
    return queries
  }

  const [query] = await invoke([validRun])
  assert.deepEqual(query, {
    owner: 'fixture-owner',
    repo: 'fixture-repo',
    workflow_id: 'ci.yml',
    branch: 'main',
    event: 'push',
    status: 'success',
    head_sha: sha,
    per_page: 100,
  })

  for (const invalidRun of [
    { ...validRun, event: 'pull_request' },
    { ...validRun, head_branch: 'feature' },
    { ...validRun, head_sha: '2'.repeat(40) },
    { ...validRun, conclusion: 'failure' },
    { ...validRun, updated_at: releaseCreatedAt },
  ]) {
    await assert.rejects(() => invoke([invalidRun]), /no successful pre-tag main push run/)
  }
})

test('release metadata contract loads without desktop packaging dependencies', () => {
  const script = `
    const Module = require('node:module')
    const path = require('node:path')
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      const local = request.startsWith('.') || path.isAbsolute(request)
      if (!local && !Module.isBuiltin(request)) {
        throw new Error('unexpected third-party release metadata dependency: ' + request)
      }
      return originalLoad.call(this, request, parent, isMain)
    }
    require('./scripts/generate-release-metadata.cjs')
  `
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('packaged application contract rejects ambiguous or spoofed evidence paths', () => {
  const fuseEvidence = Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  )
  const valid = ['setup', 'portable', 'unpacked'].map((kind) => ({
    executable: `${kind}/LocalMiniDrama.exe`,
    asar: `${kind}/resources/app.asar`,
    example_drama: {
      path: `${kind}/resources/example_drama/衣服设计天才302.zip`,
      bytes: 82156132,
      sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
    },
    fuses: { ...fuseEvidence },
  }))
  assert.equal(validatePackagedApplications(valid), valid)

  const invalidPaths = [
    ['executable', 'portable/LocalMiniDrama.cmd', /not an application executable/],
    ['asar', 'portable/resources/not-app.asar', /not an application ASAR/],
    ['executable', 'C:portable/LocalMiniDrama.exe', /drive prefix/],
    ['asar', '//server/share/resources/app.asar', /must be relative/],
    ['executable', 'portable./LocalMiniDrama.exe', /Windows-ambiguous/],
    ['asar', 'portable/resources /app.asar', /Windows-ambiguous/],
    ['executable', 'portable/app/LocalMiniDrama.exe', /same packaged application/],
    ['executable', 'portable/LocalMiniDrama\n.exe', /control character/],
    ['asar', 'portable/resources:payload/app.asar', /alternate-stream separator/],
    ['executable', 'portable/CON.exe', /Windows device name/],
    ['executable', 'portable/COM\u00b9.exe', /Windows device name/],
    ['executable', 'portable/Bad?.exe', /invalid Windows filename character/],
    ['executable', 'portable/Bad|Name.exe', /invalid Windows filename character/],
  ]
  for (const [field, value, expectedError] of invalidPaths) {
    const applications = valid.map((application) => ({ ...application, fuses: { ...application.fuses } }))
    applications[1][field] = value
    assert.throws(() => validatePackagedApplications(applications), expectedError)
  }
})

test('strict rollback drill and data root fingerprint source contracts publish v3 evidence', () => {
  assert.equal(EVIDENCE_SCHEMA, 'localminidrama.rollback-drill.v3')
  assert.match(rollbackDrillScript, /input_mode/)
  assert.match(rollbackDrillScript, /archive_retained/)
  assert.match(rollbackDrillScript, /data_root_sha256/)
  assert.match(rollbackDrillScript, /source_data_root_unchanged/)
  assert.match(rollbackDrillScript, /require\.main\s*===\s*module/)
  assert.match(rollbackDrillScript, /executeRollbackDrill/)
  assert.match(rootPackage.scripts['test:rollback-contract'], /rollback-drill-contract\.test\.cjs/)
  const syntaxCheck = rootPackage.scripts.check.indexOf('node --check scripts/rollback-drill-contract.test.cjs')
  const contractRun = rootPackage.scripts.check.indexOf('npm run test:rollback-contract')
  assert.ok(syntaxCheck >= 0 && syntaxCheck < contractRun)
  assert.match(rootPackage.scripts.check, /npm run test:release/)
  assert.match(rootPackage.scripts.check, /npm run test:local-contract/)
  assert.match(rootPackage.scripts.check, /npm run test:openclaw-contract/)
})

test('rollback drill evidence is fixed, exclusive, and only replaces a same-version PASS record', async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-evidence-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const version = '1.3.3'
  const outputPath = evidenceOutputPath(fixtureRoot)
  assert.equal(path.relative(fixtureRoot, outputPath).replace(/\\/g, '/'), EVIDENCE_RELATIVE_PATH)
  assert.deepEqual(parseDrillArguments([]), { inputMode: 'standalone', archivePath: null, dataRoot: null })

  await prepareEvidenceTarget(fixtureRoot, version)
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    status: 'passed',
    input_mode: 'standalone',
    executed_at: '2026-07-20T00:00:00.000Z',
    source: {
      version,
      commit: 'c'.repeat(40),
      working_tree_dirty: false,
      data_root_sha256: 'a'.repeat(64),
      database: { relative_path: 'backend-node/data/drama_generator.db' },
    },
    focused_tests: {
      file: 'backend-node/test/dataBackupService.test.js',
      passed: 2,
      total: 2,
    },
    backup: {
      format_version: 1,
      archive_bytes: 64,
      archive_sha256: 'b'.repeat(64),
      archive_retained: false,
      file_count: 3,
      storage_files: 1,
      story_source_files: 1,
      active_story_source_references: 0,
      secret_policy: 'excluded',
      excluded_values: 0,
    },
    restore: {
      isolated: true,
      integrity_check: 'ok',
      credential_rows_checked: 0,
      credentials_excluded: true,
      restored_counts: {},
      rollback_copies: { database: true, storage: true, story_sources: true },
    },
    operations: {
      source_database_unchanged: true,
      source_data_root_unchanged: true,
      credential_reconfiguration_required: true,
      workspace_cleanup_verified: true,
    },
  }
  assert.equal(validateEvidenceV3(evidence, version), evidence)
  assert.equal(await publishEvidence(fixtureRoot, version, evidence), outputPath)
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), evidence)

  await prepareEvidenceTarget(fixtureRoot, version)
  assert.equal(fs.existsSync(outputPath), false)
  fs.writeFileSync(outputPath, '{"schema":"untrusted"}\n')
  await assert.rejects(prepareEvidenceTarget(fixtureRoot, version), /not recognized/)
  assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"schema":"untrusted"}\n')
  await assert.rejects(publishEvidence(fixtureRoot, version, evidence), /target changed/)
  assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"schema":"untrusted"}\n')

  fs.unlinkSync(outputPath)
  const legacy = {
    schema: 'localminidrama.rollback-drill.v1',
    status: 'passed',
    source_version: '1.2.8',
    backup: { archive_sha256: 'a'.repeat(64) },
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(legacy)}\n`)
  await prepareEvidenceTarget(fixtureRoot, version)
  assert.equal(fs.existsSync(outputPath), false)
  const archiveRoot = path.join(fixtureRoot, 'artifacts', 'rollback-drill', 'archive')
  const archives = fs.readdirSync(archiveRoot)
  assert.equal(archives.length, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(archiveRoot, archives[0]), 'utf8')), legacy)

  await assert.rejects(
    publishEvidence(fixtureRoot, version, { ...evidence, source: { version: '9.9.9' } }),
    /does not match the prepared version/
  )
  const concurrent = await Promise.allSettled([
    publishEvidence(fixtureRoot, version, evidence),
    publishEvidence(fixtureRoot, version, evidence),
  ])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1)
})

test('rollback drill evidence rejects a symbolic-link artifact directory', async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-evidence-link-'))
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-evidence-outside-'))
  t.after(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
    fs.rmSync(outsideRoot, { recursive: true, force: true })
  })
  fs.symlinkSync(outsideRoot, path.join(fixtureRoot, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareEvidenceTarget(fixtureRoot, '1.3.3'), /must not be a symbolic link/)
})

test('release rollback scripts dot-source without side effects in Windows PowerShell 5.1', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-ps51-host-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const hostProbe = rollbackHostProbeStatements(fixtureRoot)
  assertPowerShellStatements(`
$ErrorActionPreference = 'Continue'
Set-StrictMode -Off
  $output = @(
    . ${powerShellLiteral(checkpointScriptPath)}
    . ${powerShellLiteral(rollbackRestoreScriptPath)}
    . ${powerShellLiteral(rollbackIdentityScriptPath)}
    . ${powerShellLiteral(rollbackIdentityScriptPath)}
    Get-Command Assert-CheckpointDrillEvidence -ErrorAction Stop | Out-Null
    Get-Command Assert-RollbackEvidenceBinding -ErrorAction Stop | Out-Null
  Get-Command Get-RollbackPathIdentity -ErrorAction Stop | Out-Null
  Get-Command Assert-RollbackPathIdentity -ErrorAction Stop | Out-Null
  Get-Command Open-RollbackArchiveReadLock -ErrorAction Stop | Out-Null
  Get-Command Open-RollbackDirectoryIdentityLock -ErrorAction Stop | Out-Null
)
if ($output.Count -ne 0) { throw "Dot-source produced incidental output: $($output -join ', ')" }
if ($ErrorActionPreference -cne 'Continue') { throw 'Dot-source changed caller ErrorActionPreference.' }
$strictModeChanged = $false
try { $null = $undefinedAfterCheckpointDotSource } catch { $strictModeChanged = $true }
if ($strictModeChanged) { throw 'Dot-source changed caller strict mode.' }
${hostProbe}
`, { executable: 'powershell.exe' })
  const cli = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    checkpointScriptPath,
  ], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.notEqual(cli.status, 0, 'checkpoint CLI must require CheckpointDirectory')
  assert.match(`${cli.stderr}\n${cli.stdout}`, /CheckpointDirectory is required/)
  const restoreCli = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    rollbackRestoreScriptPath,
  ], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.notEqual(restoreCli.status, 0, 'restore CLI must require CheckpointDirectory')
  assert.match(`${restoreCli.stderr}\n${restoreCli.stdout}`, /CheckpointDirectory is required/)
})

test('release rollback scripts dot-source without side effects in PowerShell 7', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  const pwsh = findPowerShell('pwsh.exe')
  if (!pwsh) {
    t.skip('PowerShell 7 is unavailable on this host')
    return
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-ps7-host-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const hostProbe = rollbackHostProbeStatements(fixtureRoot)
  assertPowerShellStatements(`
$ErrorActionPreference = 'Continue'
Set-StrictMode -Off
  $output = @(
    . ${powerShellLiteral(checkpointScriptPath)}
    . ${powerShellLiteral(rollbackRestoreScriptPath)}
    . ${powerShellLiteral(rollbackIdentityScriptPath)}
    . ${powerShellLiteral(rollbackIdentityScriptPath)}
    Get-Command Assert-CheckpointDrillEvidence -ErrorAction Stop | Out-Null
    Get-Command Assert-RollbackEvidenceBinding -ErrorAction Stop | Out-Null
  Get-Command Get-RollbackPathIdentity -ErrorAction Stop | Out-Null
)
if ($output.Count -ne 0) { throw 'Dot-source produced incidental output.' }
if ($ErrorActionPreference -cne 'Continue') { throw 'Dot-source changed caller ErrorActionPreference.' }
$strictModeChanged = $false
try { $null = $undefinedAfterCheckpointDotSource } catch { $strictModeChanged = $true }
if ($strictModeChanged) { throw 'Dot-source changed caller strict mode.' }
${hostProbe}
`, { executable: pwsh })
})

test('release rollback checkpoint evidence validator rejects malformed and unbound v3 summaries', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell checkpoint contracts require Windows')
    return
  }
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
function New-ValidSummary {
  return @'
{
  "schema": "localminidrama.rollback-drill.v3",
  "status": "passed",
  "input_mode": "checkpoint-bound",
  "source": {
    "commit": "cccccccccccccccccccccccccccccccccccccccc",
    "version": "1.3.3-rc.1",
    "working_tree_dirty": false,
    "data_root_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "backup": {
    "archive_retained": true,
    "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "operations": { "source_data_root_unchanged": true }
}
'@ | ConvertFrom-Json
}
function Assert-Rejected {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Mutation,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $candidate = New-ValidSummary
  & $Mutation $candidate
  $threw = $false
  try {
    Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a' | Out-Null
  } catch { $threw = $true }
  if (-not $threw) { throw "Malformed checkpoint drill evidence was accepted: $Label" }
}
function Set-EvidenceArray {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][object]$Value,
    [switch]$Nested
  )
  $result = [object[]]::new(1)
  if ($Nested) {
    $inner = [object[]]::new(1)
    $inner[0] = $Value
    $result[0] = $inner
  } else {
    $result[0] = $Value
  }
  $Object.PSObject.Properties[$Name].Value = $result
}
$valid = New-ValidSummary
$result = @(Assert-CheckpointDrillEvidence -Summary $valid -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a')
if ($result.Count -ne 1) { throw 'Validator emitted incidental pipeline output.' }
$names = @($result[0].PSObject.Properties.Name)
if (($names -join ',') -cne 'data_root_sha256,data_root_identity') { throw "Unexpected validator return properties: $($names -join ',')" }
if ($result[0].data_root_sha256 -cne ('d' * 64)) { throw 'Validated root digest was not returned.' }
if ($result[0].data_root_identity -cne '484dc672:011e00000001785a') { throw 'Validated root identity was not returned.' }

$mutations = @(
  { param($s) $s.PSObject.Properties.Remove('status') },
  { param($s) $s.status = 'failed' },
  { param($s) $s.status = 'PASSED' },
  { param($s) $s.status = $true },
  { param($s) $s.status = 1 },
  { param($s) $s.status = $null },
  { param($s) $s.schema = 'localminidrama.rollback-drill.v2' },
  { param($s) $s.schema = 'LocalMiniDrama.rollback-drill.v3' },
  { param($s) $s.input_mode = 'standalone' },
  { param($s) $s.input_mode = 'Checkpoint-bound' },
  { param($s) $s.source.working_tree_dirty = $true },
  { param($s) $s.source.working_tree_dirty = 'false' },
  { param($s) $s.backup.archive_retained = $false },
  { param($s) $s.backup.archive_retained = 'true' },
  { param($s) $s.operations.source_data_root_unchanged = $false },
  { param($s) $s.operations.source_data_root_unchanged = 'true' },
  { param($s) $s.backup.archive_sha256 = ('b' * 64) },
  { param($s) $s.backup.archive_sha256 = ('A' * 64) },
  { param($s) $s.backup.archive_sha256 = 'short' },
  { param($s) $s.source.data_root_sha256 = ('D' * 64) },
  { param($s) $s.source.data_root_sha256 = 'short' },
  { param($s) $s.source.data_root_sha256 = 7 },
  { param($s) $s.source.commit = ('b' * 40) },
  { param($s) $s.source.commit = ('C' * 40) },
  { param($s) $s.source.version = '1.3.4-rc.1' },
  { param($s) $s.source.version = '1.3.3-RC.1' },
  { param($s) Set-EvidenceArray -Object $s -Name 'schema' -Value 'localminidrama.rollback-drill.v3' },
  { param($s) Set-EvidenceArray -Object $s -Name 'schema' -Value 'localminidrama.rollback-drill.v3' -Nested },
  { param($s) Set-EvidenceArray -Object $s -Name 'status' -Value 'passed' },
  { param($s) Set-EvidenceArray -Object $s -Name 'status' -Value 'passed' -Nested },
  { param($s) Set-EvidenceArray -Object $s -Name 'input_mode' -Value 'checkpoint-bound' },
  { param($s) Set-EvidenceArray -Object $s -Name 'input_mode' -Value 'checkpoint-bound' -Nested },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'commit' -Value ('c' * 40) },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'commit' -Value ('c' * 40) -Nested },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'version' -Value '1.3.3-rc.1' },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'version' -Value '1.3.3-rc.1' -Nested },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'data_root_sha256' -Value ('d' * 64) },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'data_root_sha256' -Value ('d' * 64) -Nested },
  { param($s) Set-EvidenceArray -Object $s.backup -Name 'archive_sha256' -Value ('a' * 64) },
  { param($s) Set-EvidenceArray -Object $s.backup -Name 'archive_sha256' -Value ('a' * 64) -Nested },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'working_tree_dirty' -Value $false },
  { param($s) Set-EvidenceArray -Object $s.source -Name 'working_tree_dirty' -Value $false -Nested },
  { param($s) Set-EvidenceArray -Object $s.backup -Name 'archive_retained' -Value $true },
  { param($s) Set-EvidenceArray -Object $s.backup -Name 'archive_retained' -Value $true -Nested },
  { param($s) Set-EvidenceArray -Object $s.operations -Name 'source_data_root_unchanged' -Value $true },
  { param($s) Set-EvidenceArray -Object $s.operations -Name 'source_data_root_unchanged' -Value $true -Nested }
)
$mutationIndex = 0
foreach ($mutation in $mutations) {
  Assert-Rejected -Mutation $mutation -Label "mutation[$mutationIndex]"
  $mutationIndex++
}

foreach ($nested in @($false, $true)) {
  $arguments = @{
    Summary = New-ValidSummary
    ExpectedCommit = ('c' * 40)
    ExpectedVersion = '1.3.3-rc.1'
    ExpectedBackupHash = ('a' * 64)
    ActualBackupHash = ('a' * 64)
    ExpectedDataRootIdentity = '484dc672:011e00000001785a'
    ActualDataRootIdentity = '484dc672:011e00000001785a'
  }
  foreach ($argumentName in @('ExpectedCommit', 'ExpectedVersion', 'ExpectedBackupHash', 'ActualBackupHash', 'ExpectedDataRootIdentity', 'ActualDataRootIdentity')) {
    $candidateArguments = $arguments.Clone()
    $arrayValue = [object[]]::new(1)
    if ($nested) {
      $innerValue = [object[]]::new(1)
      $innerValue[0] = $arguments[$argumentName]
      $arrayValue[0] = $innerValue
    } else {
      $arrayValue[0] = $arguments[$argumentName]
    }
    $candidateArguments[$argumentName] = $arrayValue
    $threw = $false
    try { Assert-CheckpointDrillEvidence @candidateArguments | Out-Null } catch { $threw = $true }
    if (-not $threw) { throw "Array-shaped validator argument was accepted: $argumentName nested=$nested" }
  }
}

foreach ($expectedHash in @(('b' * 64), ('A' * 64), 'short')) {
  $candidate = New-ValidSummary
  $threw = $false
  try { Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash $expectedHash -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a' | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Malformed or mismatched expected archive hash was accepted.' }
}
foreach ($actualHash in @(('b' * 64), ('A' * 64), 'short')) {
  $candidate = New-ValidSummary
  $threw = $false
  try { Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash $actualHash -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a' | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Malformed or mismatched current archive hash was accepted.' }
}
foreach ($commitPair in @(
  @('short', 'short'),
  @(('C' * 40), ('C' * 40))
)) {
  $candidate = New-ValidSummary
  $candidate.source.commit = $commitPair[1]
  $threw = $false
  try { Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit $commitPair[0] -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a' | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Equally malformed captured/source commits were accepted.' }
}
foreach ($versionPair in @(
  @('1.03.3', '1.03.3'),
  @('v1.3.3', 'v1.3.3'),
  @('1.3.3+build', '1.3.3+build')
)) {
  $candidate = New-ValidSummary
  $candidate.source.version = $versionPair[1]
  $threw = $false
  try { Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit ('c' * 40) -ExpectedVersion $versionPair[0] -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity '484dc672:011e00000001785a' -ActualDataRootIdentity '484dc672:011e00000001785a' | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Equally malformed captured/source versions were accepted.' }
}
foreach ($identityPair in @(
  @('484dc672:011e00000001785a', '484dc672:011e00000001785b'),
  @('484DC672:011e00000001785a', '484DC672:011e00000001785a'),
  @('484dc67:011e00000001785a', '484dc67:011e00000001785a'),
  @('484dc672::011e00000001785a', '484dc672::011e00000001785a'),
  @(7, 7)
)) {
  $candidate = New-ValidSummary
  $threw = $false
  try { Assert-CheckpointDrillEvidence -Summary $candidate -ExpectedCommit ('c' * 40) -ExpectedVersion '1.3.3-rc.1' -ExpectedBackupHash ('a' * 64) -ActualBackupHash ('a' * 64) -ExpectedDataRootIdentity $identityPair[0] -ActualDataRootIdentity $identityPair[1] | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw 'Malformed or changed root identity was accepted.' }
}
`
  const executables = ['powershell.exe']
  const pwsh = findPowerShell('pwsh.exe')
  if (pwsh) executables.push(pwsh)
  for (const executable of executables) assertPowerShellStatements(statements, { executable })
})

test('rollback restore evidence binding accepts only exact scalar v5 and v3 relationships', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell restore contracts require Windows')
    return
  }
  const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-live-drift-'))
  t.after(() => fs.rmSync(liveRoot, { recursive: true, force: true }))
  fs.writeFileSync(path.join(liveRoot, 'before.txt'), 'before')
  const statements = `
. ${powerShellLiteral(rollbackRestoreScriptPath)}
function New-ValidMetadata {
  return @'
{
  "schema": "localminidrama.release-rollback-checkpoint.v5",
  "version": "1.3.3-rc.1",
  "previous_commit": "cccccccccccccccccccccccccccccccccccccccc",
  "backup_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "data_root_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "data_root_identity": "484dc672:011e00000001785a"
}
'@ | ConvertFrom-Json
}
function New-ValidSummary {
  return @'
{
  "schema": "localminidrama.rollback-drill.v3",
  "status": "passed",
  "input_mode": "checkpoint-bound",
  "source": {
    "commit": "cccccccccccccccccccccccccccccccccccccccc",
    "version": "1.3.3-rc.1",
    "working_tree_dirty": false,
    "data_root_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "backup": {
    "archive_retained": true,
    "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "operations": { "source_data_root_unchanged": true }
}
'@ | ConvertFrom-Json
}
function Set-EvidenceArray {
  param([object]$Object, [string]$Name, [object]$Value, [switch]$Nested)
  $result = [object[]]::new(1)
  if ($Nested) {
    $inner = [object[]]::new(1)
    $inner[0] = $Value
    $result[0] = $inner
  } else {
    $result[0] = $Value
  }
  $Object.PSObject.Properties[$Name].Value = $result
}
function Assert-Rejected {
  param([scriptblock]$Mutation, [string]$Label)
  $metadata = New-ValidMetadata
  $summary = New-ValidSummary
  & $Mutation $metadata $summary
  $threw = $false
  try {
    Assert-RollbackEvidenceBinding -Metadata $metadata -Summary $summary -ActualBackupHash ('a' * 64) -ActualDataRootIdentity '484dc672:011e00000001785a'
  } catch { $threw = $true }
  if (-not $threw) { throw "Unbound rollback evidence was accepted: $Label" }
}

$validOutput = @(Assert-RollbackEvidenceBinding -Metadata (New-ValidMetadata) -Summary (New-ValidSummary) -ActualBackupHash ('a' * 64) -ActualDataRootIdentity '484dc672:011e00000001785a')
if ($validOutput.Count -ne 0) { throw 'Restore evidence validator emitted incidental pipeline output.' }

$mutations = @(
  { param($m, $s) $m.PSObject.Properties.Remove('schema') },
  { param($m, $s) $m.schema = 'localminidrama.release-rollback-checkpoint.v4' },
  { param($m, $s) $m.schema = 'LocalMiniDrama.release-rollback-checkpoint.v5' },
  { param($m, $s) $m.schema = $null },
  { param($m, $s) $m.schema = $true },
  { param($m, $s) $m.schema = 5 },
  { param($m, $s) $m.schema = [pscustomobject]@{ value = 'localminidrama.release-rollback-checkpoint.v5' } },
  { param($m, $s) $s.PSObject.Properties.Remove('schema') },
  { param($m, $s) $s.schema = 'localminidrama.rollback-drill.v2' },
  { param($m, $s) $s.schema = 'LocalMiniDrama.rollback-drill.v3' },
  { param($m, $s) $s.schema = $null },
  { param($m, $s) $s.schema = 3 },
  { param($m, $s) $s.schema = [pscustomobject]@{ value = 'localminidrama.rollback-drill.v3' } },
  { param($m, $s) $s.PSObject.Properties.Remove('input_mode') },
  { param($m, $s) $s.input_mode = 'standalone' },
  { param($m, $s) $s.input_mode = 'Checkpoint-bound' },
  { param($m, $s) $s.input_mode = $null },
  { param($m, $s) $s.input_mode = $true },
  { param($m, $s) $s.input_mode = 1 },
  { param($m, $s) $s.input_mode = [pscustomobject]@{ value = 'checkpoint-bound' } },
  { param($m, $s) $s.PSObject.Properties.Remove('status') },
  { param($m, $s) $s.status = 'failed' },
  { param($m, $s) $s.status = 'PASSED' },
  { param($m, $s) $s.status = $true },
  { param($m, $s) $s.status = 1 },
  { param($m, $s) $s.status = $null },
  { param($m, $s) $s.status = [pscustomobject]@{ value = 'passed' } },
  { param($m, $s) $s.backup.archive_retained = $false },
  { param($m, $s) $s.backup.archive_retained = 'true' },
  { param($m, $s) $s.backup.archive_retained = 1 },
  { param($m, $s) $s.backup.archive_retained = $null },
  { param($m, $s) $s.backup.archive_retained = [pscustomobject]@{ value = $true } },
  { param($m, $s) $s.backup.PSObject.Properties.Remove('archive_retained') },
  { param($m, $s) $s.operations.source_data_root_unchanged = $false },
  { param($m, $s) $s.operations.source_data_root_unchanged = 'true' },
  { param($m, $s) $s.operations.source_data_root_unchanged = 1 },
  { param($m, $s) $s.operations.source_data_root_unchanged = $null },
  { param($m, $s) $s.operations.source_data_root_unchanged = [pscustomobject]@{ value = $true } },
  { param($m, $s) $s.operations.PSObject.Properties.Remove('source_data_root_unchanged') },
  { param($m, $s) $s.PSObject.Properties.Remove('source') },
  { param($m, $s) $s.source = $null },
  { param($m, $s) $s.source = 'source' },
  { param($m, $s) $s.PSObject.Properties.Remove('backup') },
  { param($m, $s) $s.backup = $null },
  { param($m, $s) $s.backup = 'backup' },
  { param($m, $s) $s.PSObject.Properties.Remove('operations') },
  { param($m, $s) $s.operations = $null },
  { param($m, $s) $s.operations = 'operations' },
  { param($m, $s) $s.source.working_tree_dirty = $true },
  { param($m, $s) $s.source.working_tree_dirty = 'false' },
  { param($m, $s) $s.source.working_tree_dirty = 0 },
  { param($m, $s) $s.source.working_tree_dirty = $null },
  { param($m, $s) $s.source.working_tree_dirty = [pscustomobject]@{ value = $false } },
  { param($m, $s) $s.source.PSObject.Properties.Remove('working_tree_dirty') },
  { param($m, $s) $m.PSObject.Properties.Remove('previous_commit') },
  { param($m, $s) $m.previous_commit = $null },
  { param($m, $s) $m.previous_commit = 7 },
  { param($m, $s) $m.previous_commit = [pscustomobject]@{ value = ('c' * 40) } },
  { param($m, $s) $m.previous_commit = ('b' * 40) },
  { param($m, $s) $m.previous_commit = ('C' * 40); $s.source.commit = ('C' * 40) },
  { param($m, $s) $m.previous_commit = ('c' * 39); $s.source.commit = ('c' * 39) },
  { param($m, $s) $m.previous_commit = ('c' * 41); $s.source.commit = ('c' * 41) },
  { param($m, $s) $m.previous_commit = ('z' * 40); $s.source.commit = ('z' * 40) },
  { param($m, $s) $s.source.PSObject.Properties.Remove('commit') },
  { param($m, $s) $s.source.commit = $null },
  { param($m, $s) $s.source.commit = 7 },
  { param($m, $s) $s.source.commit = [pscustomobject]@{ value = ('c' * 40) } },
  { param($m, $s) $s.source.commit = ('b' * 40) },
  { param($m, $s) $m.PSObject.Properties.Remove('version') },
  { param($m, $s) $m.version = $null },
  { param($m, $s) $m.version = 7 },
  { param($m, $s) $m.version = [pscustomobject]@{ value = '1.3.3-rc.1' } },
  { param($m, $s) $m.version = '1.3.4-rc.1' },
  { param($m, $s) $m.version = '1.03.3'; $s.source.version = '1.03.3' },
  { param($m, $s) $m.version = 'v1.3.3'; $s.source.version = 'v1.3.3' },
  { param($m, $s) $m.version = '1.3.3+build'; $s.source.version = '1.3.3+build' },
  { param($m, $s) $s.source.PSObject.Properties.Remove('version') },
  { param($m, $s) $s.source.version = $null },
  { param($m, $s) $s.source.version = 7 },
  { param($m, $s) $s.source.version = [pscustomobject]@{ value = '1.3.3-rc.1' } },
  { param($m, $s) $s.source.version = '1.3.3-RC.1' },
  { param($m, $s) $m.backup_sha256 = ('A' * 64) },
  { param($m, $s) $s.backup.archive_sha256 = ('A' * 64) },
  { param($m, $s) $m.data_root_sha256 = ('D' * 64) },
  { param($m, $s) $s.source.data_root_sha256 = ('D' * 64) },
  { param($m, $s) $m.backup_sha256 = ('b' * 63) },
  { param($m, $s) $s.backup.archive_sha256 = ('b' * 65) },
  { param($m, $s) $m.data_root_sha256 = ('z' * 64) },
  { param($m, $s) $s.source.data_root_sha256 = 7 },
  { param($m, $s) $m.PSObject.Properties.Remove('backup_sha256') },
  { param($m, $s) $s.backup.PSObject.Properties.Remove('archive_sha256') },
  { param($m, $s) $m.PSObject.Properties.Remove('data_root_sha256') },
  { param($m, $s) $s.source.PSObject.Properties.Remove('data_root_sha256') },
  { param($m, $s) $s.backup.archive_sha256 = ('b' * 64) },
  { param($m, $s) $m.data_root_sha256 = ('e' * 64) },
  { param($m, $s) $s.source.data_root_sha256 = ('e' * 64) },
  { param($m, $s) $m.data_root_identity = '484DC672:011e00000001785a' },
  { param($m, $s) $m.data_root_identity = '484dc67:011e00000001785a' },
  { param($m, $s) $m.data_root_identity = '484dc672-011e00000001785a' },
  { param($m, $s) $m.data_root_identity = '484dc672:011e00000001785z' },
  { param($m, $s) $m.data_root_identity = 7 },
  { param($m, $s) $m.PSObject.Properties.Remove('data_root_identity') },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'schema' -Value 'localminidrama.release-rollback-checkpoint.v5' },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'schema' -Value 'localminidrama.release-rollback-checkpoint.v5' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'previous_commit' -Value ('c' * 40) },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'previous_commit' -Value ('c' * 40) -Nested },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'version' -Value '1.3.3-rc.1' },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'version' -Value '1.3.3-rc.1' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'backup_sha256' -Value ('a' * 64) },
  { param($m, $s) Set-EvidenceArray -Object $m -Name 'data_root_identity' -Value '484dc672:011e00000001785a' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'input_mode' -Value 'checkpoint-bound' },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'input_mode' -Value 'checkpoint-bound' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'schema' -Value 'localminidrama.rollback-drill.v3' },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'schema' -Value 'localminidrama.rollback-drill.v3' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'status' -Value 'passed' },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'status' -Value 'passed' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'source' -Value $s.source },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'source' -Value $s.source -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'backup' -Value $s.backup },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'backup' -Value $s.backup -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'operations' -Value $s.operations },
  { param($m, $s) Set-EvidenceArray -Object $s -Name 'operations' -Value $s.operations -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'commit' -Value ('c' * 40) },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'commit' -Value ('c' * 40) -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'version' -Value '1.3.3-rc.1' },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'version' -Value '1.3.3-rc.1' -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'working_tree_dirty' -Value $false },
  { param($m, $s) Set-EvidenceArray -Object $s.source -Name 'working_tree_dirty' -Value $false -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.backup -Name 'archive_retained' -Value $true },
  { param($m, $s) Set-EvidenceArray -Object $s.backup -Name 'archive_retained' -Value $true -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.backup -Name 'archive_sha256' -Value ('a' * 64) -Nested },
  { param($m, $s) Set-EvidenceArray -Object $s.operations -Name 'source_data_root_unchanged' -Value $true },
  { param($m, $s) Set-EvidenceArray -Object $s.operations -Name 'source_data_root_unchanged' -Value $true -Nested }
)
$index = 0
foreach ($mutation in $mutations) {
  Assert-Rejected -Mutation $mutation -Label "mutation[$index]"
  $index++
}

function Assert-HashFieldRejected {
  param(
    [string]$Field,
    [AllowNull()][object]$Value,
    [switch]$Missing,
    [string]$Label
  )
  $metadata = New-ValidMetadata
  $summary = New-ValidSummary
  $arguments = @{
    Metadata = $metadata
    Summary = $summary
    ActualBackupHash = ('a' * 64)
    ActualDataRootIdentity = '484dc672:011e00000001785a'
  }
  switch ($Field) {
    'metadata.backup_sha256' {
      if ($Missing) { $metadata.PSObject.Properties.Remove('backup_sha256') } else { $metadata.backup_sha256 = $Value }
    }
    'summary.backup.archive_sha256' {
      if ($Missing) { $summary.backup.PSObject.Properties.Remove('archive_sha256') } else { $summary.backup.archive_sha256 = $Value }
    }
    'actual_backup_sha256' {
      if ($Missing) { $arguments.Remove('ActualBackupHash') } else { $arguments.ActualBackupHash = $Value }
    }
    'metadata.data_root_sha256' {
      if ($Missing) { $metadata.PSObject.Properties.Remove('data_root_sha256') } else { $metadata.data_root_sha256 = $Value }
    }
    'summary.source.data_root_sha256' {
      if ($Missing) { $summary.source.PSObject.Properties.Remove('data_root_sha256') } else { $summary.source.data_root_sha256 = $Value }
    }
  }
  $threw = $false
  try { Assert-RollbackEvidenceBinding @arguments } catch { $threw = $true }
  if (-not $threw) { throw "Malformed hash field was accepted: $Field/$Label" }
}
$hashFields = @(
  'metadata.backup_sha256',
  'summary.backup.archive_sha256',
  'actual_backup_sha256',
  'metadata.data_root_sha256',
  'summary.source.data_root_sha256'
)
$hashVariants = @(
  [pscustomobject]@{ Label = 'uppercase'; Value = ('A' * 64) },
  [pscustomobject]@{ Label = 'length-63'; Value = ('a' * 63) },
  [pscustomobject]@{ Label = 'length-65'; Value = ('a' * 65) },
  [pscustomobject]@{ Label = 'non-hex'; Value = ('z' * 64) },
  [pscustomobject]@{ Label = 'number'; Value = 7 },
  [pscustomobject]@{ Label = 'null'; Value = $null },
  [pscustomobject]@{ Label = 'object'; Value = [pscustomobject]@{ value = ('a' * 64) } }
)
foreach ($field in $hashFields) {
  foreach ($variant in $hashVariants) {
    Assert-HashFieldRejected -Field $field -Value $variant.Value -Label $variant.Label
  }
  foreach ($nested in @($false, $true)) {
    $array = [object[]]::new(1)
    if ($nested) {
      $inner = [object[]]::new(1)
      $inner[0] = ('a' * 64)
      $array[0] = $inner
    } else { $array[0] = ('a' * 64) }
    Assert-HashFieldRejected -Field $field -Value $array -Label "array-nested=$nested"
  }
  Assert-HashFieldRejected -Field $field -Missing -Label 'missing'
}
Assert-HashFieldRejected -Field 'summary.backup.archive_sha256' -Value ('b' * 64) -Label 'otherwise-valid-mismatch'
Assert-HashFieldRejected -Field 'actual_backup_sha256' -Value ('b' * 64) -Label 'otherwise-valid-mismatch'

function Assert-IdentityFieldRejected {
  param(
    [string]$Field,
    [AllowNull()][object]$Value,
    [switch]$Missing,
    [string]$Label
  )
  $metadata = New-ValidMetadata
  $arguments = @{
    Metadata = $metadata
    Summary = New-ValidSummary
    ActualBackupHash = ('a' * 64)
    ActualDataRootIdentity = '484dc672:011e00000001785a'
  }
  if ($Field -ceq 'metadata.data_root_identity') {
    if ($Missing) { $metadata.PSObject.Properties.Remove('data_root_identity') } else { $metadata.data_root_identity = $Value }
  } elseif ($Missing) {
    $arguments.Remove('ActualDataRootIdentity')
  } else {
    $arguments.ActualDataRootIdentity = $Value
  }
  $threw = $false
  try { Assert-RollbackEvidenceBinding @arguments } catch { $threw = $true }
  if (-not $threw) { throw "Malformed identity field was accepted: $Field/$Label" }
}
$identityFields = @('metadata.data_root_identity', 'actual_data_root_identity')
$identityVariants = @(
  [pscustomobject]@{ Label = 'uppercase'; Value = '484DC672:011e00000001785a' },
  [pscustomobject]@{ Label = 'serial-short'; Value = '484dc67:011e00000001785a' },
  [pscustomobject]@{ Label = 'serial-long'; Value = '484dc6720:011e00000001785a' },
  [pscustomobject]@{ Label = 'index-short'; Value = '484dc672:011e00000001785' },
  [pscustomobject]@{ Label = 'index-long'; Value = '484dc672:011e00000001785aa' },
  [pscustomobject]@{ Label = 'separator'; Value = '484dc672-011e00000001785a' },
  [pscustomobject]@{ Label = 'non-hex'; Value = '484dc672:011e00000001785z' },
  [pscustomobject]@{ Label = 'number'; Value = 7 },
  [pscustomobject]@{ Label = 'null'; Value = $null },
  [pscustomobject]@{ Label = 'object'; Value = [pscustomobject]@{ value = '484dc672:011e00000001785a' } }
)
foreach ($field in $identityFields) {
  foreach ($variant in $identityVariants) {
    Assert-IdentityFieldRejected -Field $field -Value $variant.Value -Label $variant.Label
  }
  foreach ($nested in @($false, $true)) {
    $array = [object[]]::new(1)
    if ($nested) {
      $inner = [object[]]::new(1)
      $inner[0] = '484dc672:011e00000001785a'
      $array[0] = $inner
    } else { $array[0] = '484dc672:011e00000001785a' }
    Assert-IdentityFieldRejected -Field $field -Value $array -Label "array-nested=$nested"
  }
  Assert-IdentityFieldRejected -Field $field -Missing -Label 'missing'
}
Assert-IdentityFieldRejected -Field 'actual_data_root_identity' -Value '484dc672:011e00000001785b' -Label 'mismatch'
foreach ($argumentName in @('Metadata', 'Summary', 'ActualBackupHash', 'ActualDataRootIdentity')) {
  foreach ($nested in @($false, $true)) {
    $arguments = @{
      Metadata = New-ValidMetadata
      Summary = New-ValidSummary
      ActualBackupHash = ('a' * 64)
      ActualDataRootIdentity = '484dc672:011e00000001785a'
    }
    $array = [object[]]::new(1)
    if ($nested) {
      $inner = [object[]]::new(1)
      $inner[0] = $arguments[$argumentName]
      $array[0] = $inner
    } else { $array[0] = $arguments[$argumentName] }
    $arguments[$argumentName] = $array
    $threw = $false
    try { Assert-RollbackEvidenceBinding @arguments } catch { $threw = $true }
    if (-not $threw) { throw "Array-shaped validator argument was accepted: $argumentName nested=$nested" }
  }
}

[System.IO.File]::WriteAllText((Join-Path ${powerShellLiteral(liveRoot)} 'after.txt'), 'legitimate live drift')
$driftOutput = @(Assert-RollbackEvidenceBinding -Metadata (New-ValidMetadata) -Summary (New-ValidSummary) -ActualBackupHash ('a' * 64) -ActualDataRootIdentity '484dc672:011e00000001785a')
if ($driftOutput.Count -ne 0) { throw 'Legitimate descendant drift changed validator output.' }
`
  const executables = ['powershell.exe']
  const pwsh = findPowerShell('pwsh.exe')
  if (pwsh) executables.push(pwsh)
  for (const executable of executables) assertPowerShellStatements(statements, { executable })
})

test('rollback path identity matches Node 20 dev and ino and directory identity lock enforces lifecycle sharing', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'identity oracle must run under Node 20')
  const hosts = windowsPowerShellHosts()
  assert.ok(hosts.some((host) => host.name === 'powershell-7'), 'PowerShell 7 is required for directory lock coverage')
  const formatIdentity = (target) => {
    const stat = fs.statSync(target, { bigint: true })
    return `${stat.dev.toString(16).padStart(8, '0')}:${stat.ino.toString(16).padStart(16, '0')}`
  }
  for (const host of hosts) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lmd-rollback-directory-lock-${host.name}-`))
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
    const oracleDirectory = path.join(fixtureRoot, 'oracle-directory')
    const oracleFile = path.join(fixtureRoot, 'oracle-file.bin')
    fs.mkdirSync(oracleDirectory)
    fs.writeFileSync(oracleFile, 'oracle')
    const statements = `
. ${powerShellLiteral(rollbackIdentityScriptPath)}
$directoryIdentity = Get-RollbackPathIdentity -Path ${powerShellLiteral(oracleDirectory)}
$fileIdentity = Get-RollbackPathIdentity -Path ${powerShellLiteral(oracleFile)}
if ($directoryIdentity -cne ${powerShellLiteral(formatIdentity(oracleDirectory))}) { throw "Directory identity oracle mismatch: $directoryIdentity" }
if ($fileIdentity -cne ${powerShellLiteral(formatIdentity(oracleFile))}) { throw "File identity oracle mismatch: $fileIdentity" }

$renameRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'rename-root'
$renamedRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'renamed-root'
[System.IO.Directory]::CreateDirectory($renameRoot) | Out-Null
$renameLock = Open-RollbackDirectoryIdentityLock -Path $renameRoot
try {
  $retained = Get-RollbackPathIdentity -Handle $renameLock
  Assert-RollbackPathIdentity -Path $renameRoot -ExpectedIdentity $retained -Label 'rename root' | Out-Null
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral("const fs=require('fs');try{fs.renameSync(process.argv[1],process.argv[2])}catch{process.exit(23)}")} $renameRoot $renamedRoot
  if ($LASTEXITCODE -ne 23) { throw 'Directory rename was not blocked while locked.' }
} finally { $renameLock.Dispose() }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral("require('fs').renameSync(process.argv[1],process.argv[2])")} $renameRoot $renamedRoot
if ($LASTEXITCODE -ne 0) { throw 'Directory rename positive control failed.' }
if (-not [System.IO.Directory]::Exists($renamedRoot)) { throw 'Directory rename positive control failed.' }

$deleteRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'delete-root'
[System.IO.Directory]::CreateDirectory($deleteRoot) | Out-Null
$deleteLock = Open-RollbackDirectoryIdentityLock -Path $deleteRoot
try {
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral("const fs=require('fs');try{fs.rmdirSync(process.argv[1])}catch{process.exit(23)}")} $deleteRoot
  if ($LASTEXITCODE -ne 23) { throw 'Empty directory delete was not blocked while locked.' }
} finally { $deleteLock.Dispose() }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral("require('fs').rmdirSync(process.argv[1])")} $deleteRoot
if ($LASTEXITCODE -ne 0) { throw 'Directory delete positive control failed.' }
if ([System.IO.Directory]::Exists($deleteRoot)) { throw 'Directory delete positive control failed.' }

$descendantRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'descendant-root'
[System.IO.Directory]::CreateDirectory($descendantRoot) | Out-Null
$descendantLock = Open-RollbackDirectoryIdentityLock -Path $descendantRoot
try {
  $before = Get-RollbackPathIdentity -Handle $descendantLock
  $child = Join-Path $descendantRoot 'child.txt'
  [System.IO.File]::WriteAllText($child, 'first')
  if ([System.IO.File]::ReadAllText($child) -cne 'first') { throw 'Descendant read failed.' }
  [System.IO.File]::WriteAllText($child, 'second')
  [System.IO.File]::Delete($child)
  Assert-RollbackPathIdentity -Path $descendantRoot -ExpectedIdentity $before -Label 'descendant root' | Out-Null
} finally { $descendantLock.Dispose() }

$replacementRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'replacement-root'
[System.IO.Directory]::CreateDirectory($replacementRoot) | Out-Null
$oldIdentity = Get-RollbackPathIdentity -Path $replacementRoot
[System.IO.Directory]::Delete($replacementRoot)
[System.IO.Directory]::CreateDirectory($replacementRoot) | Out-Null
$newIdentity = Get-RollbackPathIdentity -Path $replacementRoot
if ($newIdentity -ceq $oldIdentity) { throw 'Same-path directory replacement retained the old identity.' }
$rejected = $false
try { Assert-RollbackPathIdentity -Path $replacementRoot -ExpectedIdentity $oldIdentity -Label 'replacement root' | Out-Null } catch { $rejected = $true }
if (-not $rejected) { throw 'Replacement directory was accepted as the retained object.' }

$raceRoot = Join-Path ${powerShellLiteral(fixtureRoot)} 'final-object-race'
$raceRenamed = Join-Path ${powerShellLiteral(fixtureRoot)} 'final-object-race-renamed'
[System.IO.Directory]::CreateDirectory($raceRoot) | Out-Null
$script:raceReplacementPerformed = $false
function Get-Item {
  param([string]$LiteralPath, [switch]$Force)
  if (-not $script:raceReplacementPerformed -and $LiteralPath -ceq $raceRoot) {
    $oldItem = Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath -Force:$Force
    [System.IO.Directory]::Delete($LiteralPath)
    [System.IO.File]::WriteAllText($LiteralPath, 'replacement file')
    $script:raceReplacementPerformed = $true
    return $oldItem
  }
  return Microsoft.PowerShell.Management\\Get-Item @PSBoundParameters
}
$unexpectedRaceLock = $null
$raceRejected = $false
$raceError = $null
try {
  $unexpectedRaceLock = Open-RollbackDirectoryIdentityLock -Path $raceRoot
} catch {
  $raceRejected = $true
  $raceError = $_
} finally {
  if ($null -ne $unexpectedRaceLock) { $unexpectedRaceLock.Dispose() }
}
Remove-Item -LiteralPath Function:\\Get-Item
if (-not $script:raceReplacementPerformed) { throw "Deterministic final-object race did not run: $raceError" }
[System.IO.File]::Move($raceRoot, $raceRenamed)
[System.IO.File]::Delete($raceRenamed)
if (-not $raceRejected) { throw 'Directory helper accepted a non-directory retained final object.' }
`
    assertPowerShellStatements(statements, { executable: host.executable })
  }
})

test('rollback archive read lock blocks mutation but allows a Node 20 reader', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'archive reader must run under Node 20')
  const hosts = windowsPowerShellHosts()
  assert.ok(hosts.some((host) => host.name === 'powershell-7'), 'PowerShell 7 is required for archive lock coverage')
  const readerProgram = "const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[1]).toString('utf8'))"
  for (const host of hosts) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lmd-rollback-archive-lock-${host.name}-`))
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
    const archivePath = path.join(fixtureRoot, 'data.zip')
    const renamePath = path.join(fixtureRoot, 'renamed.zip')
    const payload = 'retained archive bytes'
    fs.writeFileSync(archivePath, payload)
    const stat = fs.statSync(archivePath, { bigint: true })
    const oracleIdentity = `${stat.dev.toString(16).padStart(8, '0')}:${stat.ino.toString(16).padStart(16, '0')}`
    const statements = `
. ${powerShellLiteral(rollbackIdentityScriptPath)}
$archive = ${powerShellLiteral(archivePath)}
$renamed = ${powerShellLiteral(renamePath)}
$lock = Open-RollbackArchiveReadLock -Path $archive
try {
  $retainedIdentity = Get-RollbackPathIdentity -Handle $lock.SafeFileHandle
  if ($retainedIdentity -cne ${powerShellLiteral(oracleIdentity)}) { throw "Archive identity oracle mismatch: $retainedIdentity" }
  Assert-RollbackPathIdentity -Path $archive -ExpectedIdentity $retainedIdentity -Label 'archive' | Out-Null
  $firstHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $currentHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($currentHash -cne $firstHash) { throw 'Archive changed while locked.' }
  $readerOutput = & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(readerProgram)} $archive
  if ($LASTEXITCODE -ne 0 -or ($readerOutput -join [Environment]::NewLine) -cne ${powerShellLiteral(payload)}) { throw 'Node 20 reader could not read the locked archive.' }
  $writeBlocked = $false
  try { [System.IO.File]::WriteAllText($archive, 'mutated') } catch { $writeBlocked = $true }
  if (-not $writeBlocked) { throw 'Archive write was not blocked.' }
  $deleteBlocked = $false
  try { [System.IO.File]::Delete($archive) } catch { $deleteBlocked = $true }
  if (-not $deleteBlocked) { throw 'Archive delete was not blocked.' }
  $renameBlocked = $false
  try { [System.IO.File]::Move($archive, $renamed) } catch { $renameBlocked = $true }
  if (-not $renameBlocked) { throw 'Archive rename was not blocked.' }
} finally { $lock.Dispose() }
[System.IO.File]::WriteAllText($archive, 'write positive control')
[System.IO.File]::Move($archive, $renamed)
[System.IO.File]::Delete($renamed)
if ([System.IO.File]::Exists($renamed)) { throw 'Archive mutation positive controls failed.' }

[System.IO.File]::WriteAllText($archive, ${powerShellLiteral(payload)})
$oldIdentity = Get-RollbackPathIdentity -Path $archive
$replacementLock = Open-RollbackArchiveReadLock -Path $archive
try { Assert-RollbackPathIdentity -Path $archive -ExpectedIdentity (Get-RollbackPathIdentity -Handle $replacementLock.SafeFileHandle) -Label 'replacement archive' | Out-Null } finally { $replacementLock.Dispose() }
[System.IO.File]::Delete($archive)
[System.IO.File]::WriteAllText($archive, ${powerShellLiteral(payload)})
$newIdentity = Get-RollbackPathIdentity -Path $archive
if ($newIdentity -ceq $oldIdentity) { throw 'Same-path archive replacement retained the old identity.' }
`
    assertPowerShellStatements(statements, { executable: host.executable })
  }
})

test('release rollback checkpoint and restore consume shared native-lock v5 interfaces', () => {
  assert.equal(fs.existsSync(rollbackIdentityScriptPath), true, 'shared rollback identity helper is missing')
  const identityScript = fs.readFileSync(rollbackIdentityScriptPath, 'utf8')
  for (const functionName of [
    'Get-RollbackPathIdentity',
    'Assert-RollbackPathIdentity',
    'Open-RollbackArchiveReadLock',
    'Open-RollbackDirectoryIdentityLock',
  ]) {
    assert.match(identityScript, new RegExp(`function ${functionName}`))
  }
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(checkpointScript, /data_root_sha256\s*=\s*\$validatedEvidence\.data_root_sha256/)
  assert.match(checkpointScript, /data_root_identity\s*=\s*\$validatedEvidence\.data_root_identity/)
  assert.match(
    checkpointScript,
    /'run', 'verify:rollback', '--',[\s\S]*'--archive', \$backupPath,[\s\S]*'--data-root', \$runtimeDataDirectory/,
  )
  assert.match(checkpointScript, /function Assert-CheckpointDrillEvidence/)
  assert.match(checkpointScript, /Open-RollbackDirectoryIdentityLock/)
  assert.match(checkpointScript, /Open-RollbackArchiveReadLock/)
  assert.match(checkpointScript, /\[System\.IO\.File\]::Move\(\$metadataTemporaryPath, \$metadataPath\)/)
  assert.match(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(rollbackRestoreScript, /localminidrama\.rollback-drill\.v3/)
  assert.doesNotMatch(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v4/)
})

test('release rollback checkpoint fake toolchain retains locks through v5 metadata publication and failure recovery', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Checkpoint orchestration contract requires Windows PowerShell')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'checkpoint orchestration must run under Node 20')
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-checkpoint-orchestration-'))
  const binPath = path.join(fixtureRoot, 'bin')
  const dataRoot = path.join(fixtureRoot, 'data')
  const configRoot = path.join(fixtureRoot, 'config')
  const logPath = path.join(fixtureRoot, 'events.jsonl')
  const summaryPath = path.join(root, 'artifacts', 'rollback-drill', 'summary.json')
  const summaryExisted = fs.existsSync(summaryPath)
  const previousSummary = summaryExisted ? fs.readFileSync(summaryPath) : null
  fs.mkdirSync(binPath)
  fs.mkdirSync(dataRoot)
  fs.mkdirSync(configRoot)
  fs.writeFileSync(path.join(configRoot, 'config.yaml'), 'server:\n  port: 5679\n')
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  t.after(() => {
    if (summaryExisted) fs.writeFileSync(summaryPath, previousSummary)
    else fs.rmSync(summaryPath, { force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  const fakeToolPath = path.join(fixtureRoot, 'fake-tool.cjs')
  fs.writeFileSync(fakeToolPath, `
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const tool = process.argv[2]
const args = process.argv.slice(3)
const record = (event, extra = {}) => fs.appendFileSync(process.env.LMD_EVENT_LOG, JSON.stringify({ event, tool, args, ...extra }) + '\\n')
const valueAfter = (name) => args[args.indexOf(name) + 1]
const commit = process.env.LMD_COMMIT
const version = process.env.LMD_VERSION
const dataRoot = process.env.LMD_DATA_ROOT
const configRoot = process.env.LMD_CONFIG_ROOT
const archivePath = process.env.LMD_ARCHIVE_PATH
const summaryPath = process.env.LMD_SUMMARY_PATH
record(tool)
if (tool === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write(commit + '\\n')
  process.exit(0)
}
if (tool === 'node') {
  if (args[0] === '-p') {
    record('version')
    process.stdout.write(version + '\\n')
  } else {
    fs.writeFileSync(args[2], 'server:\\n  port: 5679\\n')
  }
  process.exit(0)
}
if (tool === 'docker') {
  if (args[0] === 'compose' && args[1] === 'ps') {
    process.stdout.write((args[3] === 'backend' ? 'b' : 'c').repeat(64) + '\\n')
  } else if (args[0] === 'compose' && args[1] === 'config' && args.includes('--format')) {
    process.stdout.write(JSON.stringify({ services: { backend: { volumes: [{ type: 'bind', source: dataRoot, target: '/app/data', read_only: false }] } } }) + '\\n')
  } else if (args[0] === 'compose' && args[1] === 'down') {
    record('shutdown')
  } else if (args[0] === 'inspect') {
    const format = valueAfter('--format')
    if (format === '{{json .Mounts}}') {
      process.stdout.write(JSON.stringify([
        { Type: 'bind', Source: dataRoot, Destination: '/app/data', RW: true },
        { Type: 'bind', Source: configRoot, Destination: '/app/config-source', RW: false },
      ]) + '\\n')
    } else if (format === '{{.State.Status}}') process.stdout.write('running\\n')
    else if (format.includes('.State.Health')) process.stdout.write('healthy\\n')
    else if (format === '{{.Image}}') process.stdout.write('sha256:' + (args[1][0] === 'b' ? '1' : '2').repeat(64) + '\\n')
  } else if (args[0] === 'image' && args[1] === 'inspect') {
    process.stdout.write(JSON.stringify({ 'org.opencontainers.image.revision': commit }) + '\\n')
  } else if (args[0] === 'image' && args[1] === 'save') {
    fs.writeFileSync(valueAfter('--output'), 'fake image archive')
  }
  process.exit(0)
}
if (tool === 'npm') {
  if (args.includes('backup:data')) {
    record('backup')
    fs.writeFileSync(valueAfter('--output'), 'fake retained rollback archive')
    process.exit(0)
  }
  if (args[0] === 'run' && args[1] === 'verify:rollback') {
    record('drill')
    if (JSON.stringify(args) !== JSON.stringify(['run', 'verify:rollback', '--', '--archive', archivePath, '--data-root', dataRoot])) process.exit(31)
    const blocked = (operation) => { try { operation(); return false } catch { return true } }
    const renamedArchive = archivePath + '.renamed'
    const renamedRoot = dataRoot + '.renamed'
    if (!blocked(() => fs.writeFileSync(archivePath, 'changed'))) process.exit(32)
    if (!blocked(() => fs.unlinkSync(archivePath))) process.exit(33)
    if (!blocked(() => fs.renameSync(archivePath, renamedArchive))) process.exit(34)
    if (!blocked(() => fs.renameSync(dataRoot, renamedRoot))) process.exit(35)
    if (!blocked(() => fs.rmdirSync(dataRoot))) process.exit(36)
    if (fs.readFileSync(archivePath, 'utf8') !== 'fake retained rollback archive') process.exit(37)
    const child = path.join(dataRoot, 'during-drill.txt')
    fs.writeFileSync(child, 'first')
    fs.writeFileSync(child, 'second')
    if (fs.readFileSync(child, 'utf8') !== 'second') process.exit(38)
    fs.unlinkSync(child)
    const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
    const summary = {
      schema: 'localminidrama.rollback-drill.v3',
      status: process.env.LMD_SUMMARY_STATUS,
      input_mode: 'checkpoint-bound',
      source: { commit, version, working_tree_dirty: false, data_root_sha256: 'd'.repeat(64) },
      backup: { archive_retained: true, archive_sha256: archiveHash },
      operations: { source_data_root_unchanged: true },
    }
    fs.writeFileSync(summaryPath, JSON.stringify(summary) + '\\n')
    if (process.env.LMD_PRECREATE_METADATA === 'true') {
      fs.writeFileSync(path.join(path.dirname(archivePath), 'metadata.json'), '{"schema":"untrusted"}\\n')
    }
    process.exit(0)
  }
}
process.exit(40)
`, 'utf8')
  const lockProbePath = path.join(fixtureRoot, 'lock-probe.cjs')
  fs.writeFileSync(lockProbePath, `
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const [dataRoot, archivePath, stage] = process.argv.slice(2)
const fail = (message) => { process.stderr.write(stage + ': ' + message + '\\n'); process.exit(50) }
const requireBlocked = (label, operation) => {
  try { operation() } catch { return }
  fail(label + ' was not blocked')
}
requireBlocked('archive write', () => fs.writeFileSync(archivePath, 'mutated'))
requireBlocked('archive delete', () => fs.unlinkSync(archivePath))
requireBlocked('archive rename', () => fs.renameSync(archivePath, archivePath + '.locked-probe'))
if (fs.readFileSync(archivePath, 'utf8') !== 'fake retained rollback archive') fail('archive read failed')
requireBlocked('root rename', () => fs.renameSync(dataRoot, dataRoot + '.locked-probe'))
requireBlocked('empty root delete', () => fs.rmdirSync(dataRoot))
const child = path.join(dataRoot, 'lock-probe-child.txt')
fs.writeFileSync(child, 'first')
fs.writeFileSync(child, 'second')
if (fs.readFileSync(child, 'utf8') !== 'second') fail('descendant read/write failed')
fs.unlinkSync(child)
`, 'utf8')
  const checkpointDriverPath = path.join(fixtureRoot, 'checkpoint-driver.ps1')
  fs.writeFileSync(checkpointDriverPath, `
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$CheckpointDirectory)
$ErrorActionPreference = 'Stop'
$requestedCheckpointDirectory = $CheckpointDirectory
. ${powerShellLiteral(checkpointScriptPath)}

$script:OriginalInvokeChecked = \${function:Invoke-Checked}
$script:OriginalAssertCheckpointDrillEvidence = \${function:Assert-CheckpointDrillEvidence}
$script:OriginalWriteUtf8File = \${function:Write-Utf8File}
$script:OriginalPublishUtf8FileAtomically = \${function:Publish-Utf8FileAtomically}
$script:OriginalStartCapturedDeployment = \${function:Start-CapturedDeployment}

function Write-TestEvent {
  param([Parameter(Mandatory = $true)][string]$Name)
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{ event = $Name; driver = 'checkpoint' })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Assert-TestLocks {
  param([Parameter(Mandatory = $true)][string]$Stage)
  $probeOutput = @(& $env:LMD_NODE_EXE $env:LMD_LOCK_PROBE $env:LMD_DATA_ROOT $env:LMD_ARCHIVE_PATH $Stage 2>&1)
  $probeExitCode = [int]$LASTEXITCODE
  if ($probeExitCode -ne 0) {
    throw ('Lock probe failed during ' + $Stage + ' with exit code ' + $probeExitCode + ': ' + ($probeOutput -join [Environment]::NewLine))
  }
  Write-TestEvent -Name $Stage
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Label -ceq 'Rollback drill') { Write-TestEvent -Name 'paired_drill' }
  & $script:OriginalInvokeChecked @PSBoundParameters
}

function Assert-CheckpointDrillEvidence {
  param(
    [Parameter(Mandatory = $true)][object]$Summary,
    [Parameter(Mandatory = $true)][object]$ExpectedCommit,
    [Parameter(Mandatory = $true)][object]$ExpectedVersion,
    [Parameter(Mandatory = $true)][object]$ExpectedBackupHash,
    [Parameter(Mandatory = $true)][object]$ActualBackupHash,
    [Parameter(Mandatory = $true)][object]$ExpectedDataRootIdentity,
    [Parameter(Mandatory = $true)][object]$ActualDataRootIdentity
  )
  Assert-TestLocks -Stage 'validator'
  & $script:OriginalAssertCheckpointDrillEvidence @PSBoundParameters
}

function Write-Utf8File {
  param([string]$Path, [string]$Value)
  & $script:OriginalWriteUtf8File @PSBoundParameters
  $fileName = [System.IO.Path]::GetFileName($Path)
  if ([string]::Equals($fileName, 'data.sha256.txt', [System.StringComparison]::Ordinal)) {
    Assert-TestLocks -Stage 'first_locked_hash'
  } elseif ([string]::Equals($fileName, 'rollback-drill-summary.json', [System.StringComparison]::Ordinal)) {
    Assert-TestLocks -Stage 'summary_archive'
  }
}

function Publish-Utf8FileAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )
  Assert-TestLocks -Stage 'metadata_publish'
  & $script:OriginalPublishUtf8FileAtomically @PSBoundParameters
}

function Start-CapturedDeployment {
  param(
    [Parameter(Mandatory = $true)]$Backend,
    [Parameter(Mandatory = $true)]$Frontend,
    [Parameter(Mandatory = $true)][string]$Revision,
    [Parameter(Mandatory = $true)][string]$ConfigDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [Parameter(Mandatory = $true)][string]$CheckpointDirectory
  )
  Assert-TestLocks -Stage 'failure_recovery'
  & $script:OriginalStartCapturedDeployment @PSBoundParameters
}

Write-TestEvent -Name 'driver_ready'
Invoke-ReleaseRollbackCheckpoint -CheckpointDirectory $requestedCheckpointDirectory
`, 'utf8')
  for (const tool of ['git', 'docker', 'npm', 'node']) {
    fs.writeFileSync(
      path.join(binPath, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fakeToolPath}" ${tool} %*\r\n`,
      'utf8',
    )
  }

  const commit = 'c'.repeat(40)
  const version = backendPackage.version
  const runCheckpoint = (checkpointPath, status, capturedVersion = version, precreateMetadata = false) => {
    const archivePath = path.join(checkpointPath, 'data.zip')
    return spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      checkpointDriverPath,
      '-CheckpointDirectory',
      checkpointPath,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${binPath};${process.env.PATH}`,
        LMD_ARCHIVE_PATH: archivePath,
        LMD_COMMIT: commit,
        LMD_CONFIG_ROOT: configRoot,
        LMD_DATA_ROOT: dataRoot,
        LMD_EVENT_LOG: logPath,
        LMD_LOCK_PROBE: lockProbePath,
        LMD_NODE_EXE: process.execPath,
        LMD_SUMMARY_PATH: summaryPath,
        LMD_SUMMARY_STATUS: status,
        LMD_VERSION: capturedVersion,
        LMD_PRECREATE_METADATA: String(precreateMetadata),
      },
    })
  }

  const checkpointPath = path.join(fixtureRoot, 'valid-checkpoint')
  const valid = runCheckpoint(checkpointPath, 'passed')
  assert.equal(valid.status, 0, valid.stderr || valid.stdout)
  const metadata = JSON.parse(fs.readFileSync(path.join(checkpointPath, 'metadata.json'), 'utf8'))
  assert.equal(metadata.schema, 'localminidrama.release-rollback-checkpoint.v5')
  assert.equal(metadata.data_root_sha256, 'd'.repeat(64))
  assert.match(metadata.data_root_identity, /^[a-f0-9]{8}:[a-f0-9]{16}$/)
  for (const property of [
    'created_at', 'version', 'previous_commit', 'backend', 'frontend', 'backup_file', 'backup_sha256',
    'compose_file', 'compose_sha256', 'runtime_config_file', 'runtime_config_source_file',
    'runtime_config_sha256', 'data_bind_source', 'data_bind_source_file', 'data_bind_source_sha256',
    'image_archive_file', 'image_archive_sha256', 'rollback_evidence_file', 'rollback_evidence_sha256',
  ]) assert.ok(Object.hasOwn(metadata, property), `v4 metadata property ${property} was not preserved`)
  assert.equal(metadata.runtime_config_sanitized, true)
  assert.equal(metadata.runtime_config_credentials_excluded, true)
  assert.equal(metadata.credential_reconfiguration_required, true)
  const events = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const eventIndex = (name) => events.findIndex((entry) => entry.event === name)
  assert.ok(eventIndex('version') < eventIndex('shutdown'))
  assert.ok(eventIndex('shutdown') < eventIndex('backup'))
  assert.ok(eventIndex('backup') < eventIndex('drill'))
  for (const name of ['first_locked_hash', 'paired_drill', 'validator', 'summary_archive', 'metadata_publish']) {
    assert.notEqual(eventIndex(name), -1, `checkpoint orchestration event is missing: ${name}; ${events.map((entry) => entry.event).join(',')}`)
  }
  assert.ok(eventIndex('first_locked_hash') < eventIndex('paired_drill'))
  assert.ok(eventIndex('paired_drill') < eventIndex('validator'))
  assert.ok(eventIndex('validator') < eventIndex('summary_archive'))
  assert.ok(eventIndex('summary_archive') < eventIndex('metadata_publish'))

  const malformedVersionStart = events.length
  const malformedVersionPath = path.join(fixtureRoot, 'malformed-version-checkpoint')
  const malformedVersion = runCheckpoint(malformedVersionPath, 'passed', '1.03.3')
  assert.notEqual(malformedVersion.status, 0, 'malformed captured version must fail checkpoint creation')
  const afterMalformedVersion = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.equal(
    afterMalformedVersion.slice(malformedVersionStart).some((entry) => entry.event === 'shutdown'),
    false,
    'captured version format must be rejected before shutdown',
  )

  const publishFailurePath = path.join(fixtureRoot, 'publish-failure-checkpoint')
  const publishFailureStart = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).length
  const publishFailure = runCheckpoint(publishFailurePath, 'passed', version, true)
  assert.notEqual(publishFailure.status, 0, 'metadata publication conflict must fail checkpoint creation')
  assert.equal(
    fs.existsSync(path.join(publishFailurePath, 'metadata.json')),
    false,
    'failed metadata publication must not leave final authority',
  )
  assert.equal(fs.readdirSync(publishFailurePath).some((name) => name.startsWith('.metadata.')), false)
  const afterPublishFailure = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const publishFailureEvents = afterPublishFailure.slice(publishFailureStart).map((entry) => entry.event)
  assert.notEqual(publishFailureEvents.indexOf('metadata_publish'), -1)
  assert.notEqual(publishFailureEvents.indexOf('failure_recovery'), -1)
  assert.ok(publishFailureEvents.indexOf('metadata_publish') < publishFailureEvents.indexOf('failure_recovery'))

  const failedCheckpointPath = path.join(fixtureRoot, 'failed-checkpoint')
  const failedStart = afterPublishFailure.length
  const failed = runCheckpoint(failedCheckpointPath, 'PASSED')
  assert.notEqual(failed.status, 0, 'case-invalid drill status must fail checkpoint creation')
  assert.equal(fs.existsSync(path.join(failedCheckpointPath, 'metadata.json')), false)
  assert.equal(fs.readdirSync(failedCheckpointPath).some((name) => name.startsWith('.metadata.')), false)
  const afterFailed = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const failedEvents = afterFailed.slice(failedStart).map((entry) => entry.event)
  assert.notEqual(failedEvents.indexOf('validator'), -1)
  assert.notEqual(failedEvents.indexOf('failure_recovery'), -1)
  assert.ok(failedEvents.indexOf('validator') < failedEvents.indexOf('failure_recovery'))
  const failedArchive = path.join(failedCheckpointPath, 'data.zip')
  fs.writeFileSync(failedArchive, 'archive lock release positive control')
  const renamedFailedArchive = `${failedArchive}.renamed`
  fs.renameSync(failedArchive, renamedFailedArchive)
  fs.unlinkSync(renamedFailedArchive)
  const renamedDataRoot = `${dataRoot}.released`
  fs.renameSync(dataRoot, renamedDataRoot)
  fs.renameSync(renamedDataRoot, dataRoot)
  fs.rmdirSync(dataRoot)
  fs.mkdirSync(dataRoot)
})

function createRollbackRestoreHarness(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-restore-orchestration-'))
  const binPath = path.join(fixtureRoot, 'bin')
  fs.mkdirSync(binPath)
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const hash = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex')
  const commit = 'c'.repeat(40)
  const forwardCommit = 'e'.repeat(40)
  const backendImageId = `sha256:${'1'.repeat(64)}`
  const frontendImageId = `sha256:${'2'.repeat(64)}`
  const currentBackendImageId = `sha256:${'3'.repeat(64)}`
  const currentFrontendImageId = `sha256:${'4'.repeat(64)}`

  const fakeToolPath = path.join(fixtureRoot, 'fake-restore-tool.cjs')
  fs.writeFileSync(fakeToolPath, `
'use strict'
const fs = require('node:fs')
const tool = process.argv[2]
const args = process.argv.slice(3)
const record = (event, extra = {}) => fs.appendFileSync(process.env.LMD_EVENT_LOG, JSON.stringify({ event, tool, args, ...extra }) + '\\n')
const valueAfter = (name) => args[args.indexOf(name) + 1]
const mode = process.env.LMD_FAKE_MODE
const composeIndex = args.indexOf('compose')
const composeOperation = composeIndex >= 0 ? args.slice(composeIndex + 1).find((value) => ['ps', 'config', 'down', 'up'].includes(value)) : null
record('tool:' + tool)
if (tool === 'docker') {
  if (composeOperation === 'ps') {
    const service = args[args.length - 1]
    const containerId = (service === 'frontend' ? 'f' : 'b').repeat(64)
    process.stdout.write((mode === 'current-container-id-invalid' && service === 'backend' ? 'invalid' : containerId) + '\\n')
  } else if (composeOperation === 'config' && args.includes('--format')) {
    const composeSource = mode === 'compose-data-source-mismatch' ? process.env.LMD_ALT_DATA_ROOT : process.env.LMD_DATA_ROOT
    const composeType = mode === 'compose-data-type-invalid' ? 'volume' : 'bind'
    const composeReadOnly = mode === 'compose-data-read-only'
    process.stdout.write(JSON.stringify({ services: { backend: { volumes: [{ type: composeType, source: composeSource, target: '/app/data', read_only: composeReadOnly }] } } }) + '\\n')
  } else if (args[0] === 'inspect') {
    const format = valueAfter('--format')
    const containerId = args[1]
    if (format === '{{json .Mounts}}') {
      const dataSource = mode === 'inspect-data-source-mismatch' ? process.env.LMD_ALT_DATA_ROOT : process.env.LMD_DATA_ROOT
      const dataType = mode === 'inspect-data-type-invalid' ? 'volume' : 'bind'
      const dataReadWrite = mode !== 'inspect-data-read-only'
      const dataDestination = mode === 'inspect-data-destination-invalid' ? '/app/other' : '/app/data'
      const dataMounts = [
        { Type: dataType, Source: dataSource, Destination: dataDestination, RW: dataReadWrite },
        { Type: 'bind', Source: process.env.LMD_CONFIG_ROOT, Destination: '/app/config-source', RW: false },
      ]
      if (mode === 'inspect-data-duplicate') dataMounts.push({ Type: 'bind', Source: dataSource, Destination: '/app/data', RW: true })
      process.stdout.write(JSON.stringify(dataMounts) + '\\n')
    } else if (format === '{{.State.Status}}') process.stdout.write('running\\n')
    else if (format.includes('.State.Health')) process.stdout.write('healthy\\n')
    else if (format === '{{.Image}}') {
      const currentImageId = containerId[0] === 'f' ? process.env.LMD_CURRENT_FRONTEND_IMAGE : process.env.LMD_CURRENT_BACKEND_IMAGE
      process.stdout.write((mode === 'current-image-id-invalid' && containerId[0] === 'b' ? 'invalid' : currentImageId) + '\\n')
    }
  } else if (args[0] === 'image' && args[1] === 'inspect') {
    const target = args[2]
    const format = valueAfter('--format')
    if (format === '{{.Id}}') {
      const expected = target.includes('frontend') ? process.env.LMD_FRONTEND_IMAGE : process.env.LMD_BACKEND_IMAGE
      const mismatch = (mode === 'loaded-backend-image-id-mismatch' && target.includes('backend')) ||
        (mode === 'loaded-frontend-image-id-mismatch' && target.includes('frontend'))
      process.stdout.write((mismatch ? 'sha256:' + '9'.repeat(64) : expected) + '\\n')
    } else {
      const currentImage = target === process.env.LMD_CURRENT_BACKEND_IMAGE || target === process.env.LMD_CURRENT_FRONTEND_IMAGE
      let revision = currentImage ? process.env.LMD_FORWARD_COMMIT : process.env.LMD_COMMIT
      if (mode === 'loaded-backend-image-revision-mismatch' && target.includes('backend')) revision = '9'.repeat(40)
      if (mode === 'loaded-frontend-image-revision-mismatch' && target.includes('frontend')) revision = '9'.repeat(40)
      if (mode === 'current-image-revision-invalid' && target === process.env.LMD_CURRENT_BACKEND_IMAGE) revision = 'invalid'
      if (mode === 'current-image-revision-mismatch' && target === process.env.LMD_CURRENT_FRONTEND_IMAGE) revision = '8'.repeat(40)
      process.stdout.write(JSON.stringify({ 'org.opencontainers.image.revision': revision }) + '\\n')
    }
  }
  process.exit(0)
}
if (tool === 'npm') {
  const dataRoot = valueAfter('--data-root')
  if (dataRoot !== process.env.LMD_DATA_ROOT) process.exit(61)
  if (args.includes('backup:data')) fs.writeFileSync(valueAfter('--output'), 'durable compensation bytes')
  if (args.includes('restore:data')) fs.readFileSync(valueAfter('--input'))
  process.exit(0)
}
process.exit(62)
`, 'utf8')
  for (const tool of ['docker', 'npm']) {
    fs.writeFileSync(
      path.join(binPath, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fakeToolPath}" ${tool} %*\r\n`,
      'utf8',
    )
  }

  const lockProbePath = path.join(fixtureRoot, 'restore-lock-probe.cjs')
  fs.writeFileSync(lockProbePath, `
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const [dataRoot, archivePath, stage] = process.argv.slice(2)
const fail = (message) => { process.stderr.write(stage + ': ' + message + '\\n'); process.exit(70) }
const requireBlocked = (label, operation) => {
  try { operation() } catch { return }
  fail(label + ' was not blocked')
}
requireBlocked('archive write', () => fs.writeFileSync(archivePath, 'mutated'))
requireBlocked('archive delete', () => fs.unlinkSync(archivePath))
requireBlocked('archive rename', () => fs.renameSync(archivePath, archivePath + '.renamed'))
fs.readFileSync(archivePath)
requireBlocked('root rename', () => fs.renameSync(dataRoot, dataRoot + '.renamed'))
requireBlocked('root delete', () => fs.rmdirSync(dataRoot))
const child = path.join(dataRoot, 'lock-probe-child.txt')
fs.writeFileSync(child, 'first')
fs.writeFileSync(child, 'second')
if (fs.readFileSync(child, 'utf8') !== 'second') fail('descendant read/write failed')
fs.unlinkSync(child)
`, 'utf8')

  const driverPath = path.join(fixtureRoot, 'restore-driver.ps1')
  fs.writeFileSync(driverPath, `
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$CheckpointDirectory)
$ErrorActionPreference = 'Stop'
$requestedCheckpointDirectory = $CheckpointDirectory
. ${powerShellLiteral(rollbackRestoreScriptPath)}
$script:OriginalInvokeChecked = \${function:Invoke-Checked}
$script:OriginalEvidenceBinding = \${function:Assert-RollbackEvidenceBinding}
$script:OriginalRootGuard = \${function:Assert-CurrentRollbackRoot}
$script:OriginalFileHash = \${function:Assert-FileHash}

function Write-TestEvent {
  param([string]$Name)
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{ event = $Name; driver = 'restore' })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
function Assert-TestLocks {
  param([string]$Stage)
  $output = @(& $env:LMD_NODE_EXE $env:LMD_LOCK_PROBE $env:LMD_DATA_ROOT (Join-Path $requestedCheckpointDirectory 'data.zip') $Stage 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Lock probe failed during $($Stage): $($output -join [Environment]::NewLine)" }
  Write-TestEvent -Name ('locks:' + $Stage)
}
function Assert-RollbackEvidenceBinding {
  param([object]$Metadata, [object]$Summary, [object]$ActualBackupHash, [object]$ActualDataRootIdentity)
  & $script:OriginalEvidenceBinding @PSBoundParameters
  Write-TestEvent -Name 'binding accepted'
}
function Push-Location {
  param([string]$Path)
  Microsoft.PowerShell.Management\\Push-Location -Path $Path
  Write-TestEvent -Name 'Push'
}
function Assert-CurrentRollbackRoot {
  param([string]$CheckpointDirectory, [string]$DataDirectory, [object]$RetainedIdentity, [object]$MetadataIdentity, [string]$Label)
  if ($env:LMD_SCENARIO -ceq 'identity_after_mutation' -and $Label -ceq 'Rollback data root before rollback restore') {
    Write-TestEvent -Name 'identity failure after mutation'
    throw 'Injected post-mutation identity failure.'
  }
  & $script:OriginalRootGuard @PSBoundParameters
}
function Assert-FileHash {
  param([string]$Path, [string]$Expected, [string]$Label)
  & $script:OriginalFileHash @PSBoundParameters
  if ($Label -like '*compensation data backup') { Write-TestEvent -Name ('hash:' + $Label) }
}
function Invoke-Checked {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$Label)
  $mutationLabels = @(
    'Rollback image archive load', 'Current backend compensation tag', 'Current frontend compensation tag',
    'Current Docker shutdown', 'Pre-rollback compensation backup', 'Rollback data restore',
    'Failed rollback preparation shutdown', 'Preparation compensation data restore',
    'Preparation forward deployment recovery', 'Rollback container startup', 'Failed rollback shutdown',
    'Compensation data restore', 'Forward deployment recovery', 'Preparation compensation failure shutdown',
    'Compensation failure shutdown'
  )
  if ($mutationLabels -ccontains $Label) {
    Write-TestEvent -Name $Label
    Assert-TestLocks -Stage $Label
  }
  $fail = switch ($env:LMD_SCENARIO) {
    'shutdown_failure' { $Label -ceq 'Current Docker shutdown' }
    'restore_failure' { $Label -ceq 'Rollback data restore' }
    'startup_failure' { $Label -ceq 'Rollback container startup' }
    'terminal_failure' { $Label -ceq 'Rollback container startup' -or $Label -ceq 'Forward deployment recovery' }
    default { $false }
  }
  if ($fail) { throw "Injected failure: $Label" }
  & $script:OriginalInvokeChecked @PSBoundParameters
}
function Test-ApplicationHealth { Write-TestEvent -Name 'health' }

Invoke-ReleaseRollbackCheckpointRestore -CheckpointDirectory $requestedCheckpointDirectory
`, 'utf8')

  const createScenario = (name, options = {}) => {
    const scenarioRoot = path.join(fixtureRoot, name)
    const checkpointPath = path.join(scenarioRoot, 'checkpoint')
    const dataRoot = path.join(scenarioRoot, 'data')
    const alternateDataRoot = path.join(scenarioRoot, 'alternate-data')
    const configRoot = path.join(scenarioRoot, 'config')
    const eventLog = path.join(scenarioRoot, 'events.jsonl')
    fs.mkdirSync(path.join(checkpointPath, 'configs'), { recursive: true })
    fs.mkdirSync(dataRoot)
    fs.mkdirSync(alternateDataRoot)
    fs.mkdirSync(configRoot)
    fs.writeFileSync(path.join(configRoot, 'config.yaml'), 'server:\n  port: 5679\n')
    const archiveBytes = Buffer.from('retained rollback archive ' + name)
    const composeBytes = Buffer.from('services:\n  backend: {}\n')
    const configBytes = Buffer.from('server:\n  port: 5679\n')
    const bindBytes = Buffer.from(dataRoot + '\n')
    const imageBytes = Buffer.from('image archive ' + name)
    fs.writeFileSync(path.join(checkpointPath, 'data.zip'), archiveBytes)
    fs.writeFileSync(path.join(checkpointPath, 'docker-compose.yml'), composeBytes)
    fs.writeFileSync(path.join(checkpointPath, 'configs', 'config.yaml'), configBytes)
    fs.writeFileSync(path.join(checkpointPath, 'data-bind-source.txt'), bindBytes)
    fs.writeFileSync(path.join(checkpointPath, 'images.tar'), imageBytes)
    const archiveHash = hash(archiveBytes)
    const boundArchiveHash = options.archiveMismatch ? 'a'.repeat(64) : archiveHash
    fs.writeFileSync(path.join(checkpointPath, 'data.sha256.txt'), boundArchiveHash + '\n')
    const stat = fs.statSync(dataRoot, { bigint: true })
    const actualIdentity = `${stat.dev.toString(16).padStart(8, '0')}:${stat.ino.toString(16).padStart(16, '0')}`
    const summary = {
      schema: 'localminidrama.rollback-drill.v3',
      status: 'passed',
      input_mode: 'checkpoint-bound',
      source: { commit, version: backendPackage.version, working_tree_dirty: false, data_root_sha256: 'd'.repeat(64) },
      backup: { archive_retained: true, archive_sha256: boundArchiveHash },
      operations: { source_data_root_unchanged: true },
    }
    if (options.mutateSummary) options.mutateSummary(summary)
    const summaryBytes = Buffer.from(JSON.stringify(summary) + '\n')
    fs.writeFileSync(path.join(checkpointPath, 'rollback-drill-summary.json'), summaryBytes)
    const rollbackTag = `rollback-checkpoint-${commit.slice(0, 12)}`
    const metadata = {
      schema: 'localminidrama.release-rollback-checkpoint.v5',
      version: backendPackage.version,
      previous_commit: commit,
      backend: { image_id: backendImageId, revision: commit, rollback_ref: `localminidrama-backend:${rollbackTag}` },
      frontend: { image_id: frontendImageId, revision: commit, rollback_ref: `localminidrama-frontend:${rollbackTag}` },
      backup_sha256: boundArchiveHash,
      compose_sha256: hash(composeBytes),
      runtime_config_sha256: hash(configBytes),
      runtime_config_sanitized: true,
      runtime_config_credentials_excluded: true,
      credential_reconfiguration_required: true,
      data_bind_type: 'bind',
      data_bind_destination: '/app/data',
      data_bind_read_write: true,
      data_bind_source: dataRoot,
      data_bind_source_file: 'data-bind-source.txt',
      data_bind_source_sha256: hash(bindBytes),
      image_archive_sha256: hash(imageBytes),
      rollback_evidence_sha256: hash(summaryBytes),
      data_root_sha256: 'd'.repeat(64),
      data_root_identity: options.identityMismatch ? '00000000:0000000000000001' : actualIdentity,
    }
    if (options.mutateMetadata) {
      options.mutateMetadata(metadata, { alternateDataRoot, archiveHash, checkpointPath, dataRoot })
    }
    fs.writeFileSync(path.join(checkpointPath, 'metadata.json'), JSON.stringify(metadata) + '\n')
    let replacementIdentity = null
    if (options.replaceDataRootAfterMetadata) {
      fs.renameSync(dataRoot, `${dataRoot}-original`)
      fs.mkdirSync(dataRoot)
      const replacementStat = fs.statSync(dataRoot, { bigint: true })
      replacementIdentity = `${replacementStat.dev.toString(16).padStart(8, '0')}:${replacementStat.ino.toString(16).padStart(16, '0')}`
      assert.notEqual(replacementIdentity, actualIdentity, 'same-path replacement fixture reused the original native identity')
    }
    return {
      actualIdentity,
      alternateDataRoot,
      checkpointPath,
      configRoot,
      dataRoot,
      eventLog,
      replacementIdentity,
    }
  }

  const runScenario = (host, name, options = {}) => {
    const fixture = createScenario(`${host.name}-${name}`, options)
    const result = spawnSync(host.executable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driverPath,
      '-CheckpointDirectory', fixture.checkpointPath,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${binPath};${process.env.PATH}`,
        LMD_ALT_DATA_ROOT: fixture.alternateDataRoot,
        LMD_BACKEND_IMAGE: backendImageId,
        LMD_COMMIT: commit,
        LMD_CONFIG_ROOT: fixture.configRoot,
        LMD_CURRENT_BACKEND_IMAGE: currentBackendImageId,
        LMD_CURRENT_FRONTEND_IMAGE: currentFrontendImageId,
        LMD_DATA_ROOT: fixture.dataRoot,
        LMD_EVENT_LOG: fixture.eventLog,
        LMD_FAKE_MODE: options.fakeMode || '',
        LMD_FORWARD_COMMIT: forwardCommit,
        LMD_FRONTEND_IMAGE: frontendImageId,
        LMD_LOCK_PROBE: lockProbePath,
        LMD_NODE_EXE: process.execPath,
        LMD_SCENARIO: options.runtimeScenario || name,
      },
    })
    const events = fs.existsSync(fixture.eventLog)
      ? fs.readFileSync(fixture.eventLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
      : []
    const eventNames = events.map((entry) => entry.event)
    const compensationDirectories = fs.readdirSync(fixture.checkpointPath)
      .filter((entry) => entry.startsWith('compensation-'))
    const renamedArchive = path.join(path.dirname(fixture.checkpointPath), 'released-data.zip')
    fs.writeFileSync(path.join(fixture.checkpointPath, 'data.zip'), 'released archive')
    fs.renameSync(path.join(fixture.checkpointPath, 'data.zip'), renamedArchive)
    fs.unlinkSync(renamedArchive)
    const renamedRoot = `${fixture.dataRoot}.released`
    fs.renameSync(fixture.dataRoot, renamedRoot)
    fs.rmdirSync(renamedRoot)
    return { compensationDirectories, eventNames, events, fixture, result }
  }

  return { runScenario }
}

function findUnsafeRestoreToolEvent(run, { allowImageLoad = false } = {}) {
  return run.events.find((entry) => {
    if (!Array.isArray(entry.args)) return false
    if (entry.tool === 'npm') return entry.args.includes('backup:data') || entry.args.includes('restore:data')
    if (entry.tool !== 'docker') return false
    const imageMutation = entry.args[0] === 'image' &&
      (entry.args[1] === 'tag' || (!allowImageLoad && entry.args[1] === 'load'))
    return imageMutation || entry.args.includes('down') || entry.args.includes('up')
  })
}

function assertRestoreStoppedBeforeMutation(run, label) {
  assert.notEqual(run.result.status, 0, `${label} must fail before mutation`)
  assert.equal(run.eventNames.includes('Push'), false, `${label} reached Push-Location`)
  assert.equal(run.eventNames.some((event) => event.startsWith('locks:')), false, `${label} reached a mutation boundary`)
  assert.deepEqual(run.compensationDirectories, [], `${label} published compensation evidence`)
  const unsafeToolEvent = findUnsafeRestoreToolEvent(run)
  assert.equal(unsafeToolEvent, undefined, `${label} executed an unsafe fake tool command`)
}

function assertRestoreStoppedAfterImageValidation(run, label) {
  assert.notEqual(run.result.status, 0, `${label} must fail image validation`)
  assert.equal(run.eventNames.includes('Push'), true, `${label} did not pass the evidence gate`)
  assert.equal(run.eventNames.includes('Rollback image archive load'), true, `${label} did not load the image archive`)
  for (const forbidden of [
    'Current backend compensation tag',
    'Current frontend compensation tag',
    'Current Docker shutdown',
    'Pre-rollback compensation backup',
    'Rollback data restore',
    'Preparation forward deployment recovery',
    'Forward deployment recovery',
  ]) assert.equal(run.eventNames.includes(forbidden), false, `${label} continued to ${forbidden}`)
  assert.deepEqual(run.compensationDirectories, [], `${label} published compensation evidence`)
  assert.equal(findUnsafeRestoreToolEvent(run, { allowImageLoad: true }), undefined, `${label} executed an unsafe fake tool command`)
}

test('rollback restore fake toolchain keeps evidence locks through success and compensation paths', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Restore orchestration lock contracts require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'restore orchestration must run under Node 20')
  const hosts = windowsPowerShellHosts()
  assert.ok(hosts.some((host) => host.name === 'powershell-7'), 'PowerShell 7 is required for restore orchestration coverage')
  const { runScenario } = createRollbackRestoreHarness(t)
  const gateScenarios = [
    ['metadata-v4', { mutateMetadata: (metadata) => { metadata.schema = 'localminidrama.release-rollback-checkpoint.v4' } }],
    ['summary-v2', { mutateSummary: (summary) => { summary.schema = 'localminidrama.rollback-drill.v2' } }],
    ['standalone-mode', { mutateSummary: (summary) => { summary.input_mode = 'standalone' } }],
    ['status-failed', { mutateSummary: (summary) => { summary.status = 'failed' } }],
    ['status-uppercase', { mutateSummary: (summary) => { summary.status = 'PASSED' } }],
    ['status-boolean', { mutateSummary: (summary) => { summary.status = true } }],
    ['status-null', { mutateSummary: (summary) => { summary.status = null } }],
    ['status-collection', { mutateSummary: (summary) => { summary.status = ['passed'] } }],
    ['archive-retained-false', { mutateSummary: (summary) => { summary.backup.archive_retained = false } }],
    ['archive-retained-string', { mutateSummary: (summary) => { summary.backup.archive_retained = 'true' } }],
    ['archive-retained-missing', { mutateSummary: (summary) => { delete summary.backup.archive_retained } }],
    ['root-unchanged-false', { mutateSummary: (summary) => { summary.operations.source_data_root_unchanged = false } }],
    ['root-unchanged-number', { mutateSummary: (summary) => { summary.operations.source_data_root_unchanged = 1 } }],
    ['root-unchanged-missing', { mutateSummary: (summary) => { delete summary.operations.source_data_root_unchanged } }],
    ['working-tree-dirty-true', { mutateSummary: (summary) => { summary.source.working_tree_dirty = true } }],
    ['working-tree-dirty-string', { mutateSummary: (summary) => { summary.source.working_tree_dirty = 'false' } }],
    ['working-tree-dirty-missing', { mutateSummary: (summary) => { delete summary.source.working_tree_dirty } }],
    ['commit-mismatch', { mutateSummary: (summary) => { summary.source.commit = 'b'.repeat(40) } }],
    ['commit-uppercase', { mutateSummary: (summary) => { summary.source.commit = 'C'.repeat(40) } }],
    ['version-mismatch', { mutateSummary: (summary) => { summary.source.version = '9.9.9' } }],
    ['metadata-version-mismatch', { mutateMetadata: (metadata) => { metadata.version = '9.9.9' } }],
    ['metadata-backup-hash-uppercase', { mutateMetadata: (metadata) => { metadata.backup_sha256 = metadata.backup_sha256.toUpperCase() } }],
    ['summary-archive-hash-mismatch', { mutateSummary: (summary) => { summary.backup.archive_sha256 = 'e'.repeat(64) } }],
    ['metadata-root-digest-mismatch', { mutateMetadata: (metadata) => { metadata.data_root_sha256 = 'e'.repeat(64) } }],
    ['summary-root-digest-mismatch', { mutateSummary: (summary) => { summary.source.data_root_sha256 = 'e'.repeat(64) } }],
    ['archive-current-bytes-mismatch', { archiveMismatch: true }],
    ['metadata-identity-mismatch', { identityMismatch: true }],
    ['same-path-native-root-replacement', { replaceDataRootAfterMetadata: true }],
  ]
  const preservedPreMutationScenarios = [
    ['metadata-backend-image-id-invalid', { mutateMetadata: (metadata) => { metadata.backend.image_id = 'not-an-image-id' } }],
    ['metadata-frontend-image-id-invalid', { mutateMetadata: (metadata) => { metadata.frontend.image_id = 'not-an-image-id' } }],
    ['metadata-backend-image-revision-mismatch', { mutateMetadata: (metadata) => { metadata.backend.revision = 'b'.repeat(40) } }],
    ['metadata-frontend-image-revision-mismatch', { mutateMetadata: (metadata) => { metadata.frontend.revision = 'b'.repeat(40) } }],
    ['metadata-backend-image-ref-mismatch', { mutateMetadata: (metadata) => { metadata.backend.rollback_ref = 'localminidrama-backend:wrong' } }],
    ['metadata-frontend-image-ref-mismatch', { mutateMetadata: (metadata) => { metadata.frontend.rollback_ref = 'localminidrama-frontend:wrong' } }],
    ['current-container-id-invalid', { fakeMode: 'current-container-id-invalid' }],
    ['current-image-id-invalid', { fakeMode: 'current-image-id-invalid' }],
    ['current-image-revision-invalid', { fakeMode: 'current-image-revision-invalid' }],
    ['current-image-revision-mismatch', { fakeMode: 'current-image-revision-mismatch' }],
    ['compose-file-hash-mismatch', { mutateMetadata: (metadata) => { metadata.compose_sha256 = '0'.repeat(64) } }],
    ['config-file-hash-mismatch', { mutateMetadata: (metadata) => { metadata.runtime_config_sha256 = '0'.repeat(64) } }],
    ['image-file-hash-mismatch', { mutateMetadata: (metadata) => { metadata.image_archive_sha256 = '0'.repeat(64) } }],
    ['summary-file-hash-mismatch', { mutateMetadata: (metadata) => { metadata.rollback_evidence_sha256 = '0'.repeat(64) } }],
    ['runtime-config-not-sanitized', { mutateMetadata: (metadata) => { metadata.runtime_config_sanitized = false } }],
    ['runtime-config-sanitized-string', { mutateMetadata: (metadata) => { metadata.runtime_config_sanitized = 'true' } }],
    ['runtime-config-sanitized-missing', { mutateMetadata: (metadata) => { delete metadata.runtime_config_sanitized } }],
    ['runtime-config-credentials-present', { mutateMetadata: (metadata) => { metadata.runtime_config_credentials_excluded = false } }],
    ['runtime-config-credentials-string', { mutateMetadata: (metadata) => { metadata.runtime_config_credentials_excluded = 'true' } }],
    ['runtime-config-credentials-missing', { mutateMetadata: (metadata) => { delete metadata.runtime_config_credentials_excluded } }],
    ['credential-reconfiguration-not-required', { mutateMetadata: (metadata) => { metadata.credential_reconfiguration_required = false } }],
    ['credential-reconfiguration-string', { mutateMetadata: (metadata) => { metadata.credential_reconfiguration_required = 'true' } }],
    ['credential-reconfiguration-missing', { mutateMetadata: (metadata) => { delete metadata.credential_reconfiguration_required } }],
    ['bind-source-file-hash-mismatch', { mutateMetadata: (metadata) => { metadata.data_bind_source_sha256 = '0'.repeat(64) } }],
    ['bind-source-path-mismatch', { mutateMetadata: (metadata, context) => { metadata.data_bind_source = context.alternateDataRoot } }],
    ['bind-source-type-invalid', { mutateMetadata: (metadata) => { metadata.data_bind_type = 'volume' } }],
    ['bind-source-read-only', { mutateMetadata: (metadata) => { metadata.data_bind_read_write = false } }],
    ['bind-source-read-write-string', { mutateMetadata: (metadata) => { metadata.data_bind_read_write = 'true' } }],
    ['bind-source-destination-invalid', { mutateMetadata: (metadata) => { metadata.data_bind_destination = '/app/other' } }],
    ['bind-source-record-name-invalid', { mutateMetadata: (metadata) => { metadata.data_bind_source_file = 'other.txt' } }],
    ['inspect-data-source-mismatch', { fakeMode: 'inspect-data-source-mismatch' }],
    ['inspect-data-type-invalid', { fakeMode: 'inspect-data-type-invalid' }],
    ['inspect-data-read-only', { fakeMode: 'inspect-data-read-only' }],
    ['inspect-data-destination-invalid', { fakeMode: 'inspect-data-destination-invalid' }],
    ['inspect-data-duplicate', { fakeMode: 'inspect-data-duplicate' }],
    ['compose-data-source-mismatch', { fakeMode: 'compose-data-source-mismatch' }],
    ['compose-data-type-invalid', { fakeMode: 'compose-data-type-invalid' }],
    ['compose-data-read-only', { fakeMode: 'compose-data-read-only' }],
  ]
  const postImageValidationScenarios = [
    ['loaded-backend-image-id-mismatch', { fakeMode: 'loaded-backend-image-id-mismatch' }],
    ['loaded-frontend-image-id-mismatch', { fakeMode: 'loaded-frontend-image-id-mismatch' }],
    ['loaded-backend-image-revision-mismatch', { fakeMode: 'loaded-backend-image-revision-mismatch' }],
    ['loaded-frontend-image-revision-mismatch', { fakeMode: 'loaded-frontend-image-revision-mismatch' }],
  ]

  for (const host of hosts) {
    for (const [name, options] of [...gateScenarios, ...preservedPreMutationScenarios]) {
      const run = runScenario(host, name, options)
      assertRestoreStoppedBeforeMutation(run, `${host.name}/${name}`)
    }
    for (const [name, options] of postImageValidationScenarios) {
      const run = runScenario(host, name, options)
      assertRestoreStoppedAfterImageValidation(run, `${host.name}/${name}`)
    }

    const success = runScenario(host, 'success')
    assert.equal(success.result.status, 0, success.result.stderr || success.result.stdout)
    const successIndex = (name) => success.eventNames.indexOf(name)
    assert.ok(successIndex('binding accepted') < successIndex('Push'))
    assert.ok(successIndex('Push') < successIndex('Rollback image archive load'))
    assert.ok(successIndex('Rollback image archive load') < successIndex('Current Docker shutdown'))
    assert.ok(successIndex('Current Docker shutdown') < successIndex('Pre-rollback compensation backup'))
    assert.ok(successIndex('Pre-rollback compensation backup') < successIndex('Rollback data restore'))
    assert.ok(successIndex('Rollback data restore') < successIndex('Rollback container startup'))

    const shutdownFailure = runScenario(host, 'shutdown_failure')
    assert.notEqual(shutdownFailure.result.status, 0)
    assert.ok(shutdownFailure.eventNames.indexOf('Current Docker shutdown') < shutdownFailure.eventNames.indexOf('Failed rollback preparation shutdown'))
    assert.ok(shutdownFailure.eventNames.includes('Preparation forward deployment recovery'))

    const restoreFailure = runScenario(host, 'restore_failure')
    assert.notEqual(restoreFailure.result.status, 0)
    assert.ok(restoreFailure.eventNames.includes('hash:Preparation compensation data backup'))
    assert.ok(restoreFailure.eventNames.includes('Preparation compensation data restore'))
    assert.ok(restoreFailure.eventNames.includes('Preparation forward deployment recovery'))

    const identityFailure = runScenario(host, 'identity_after_mutation')
    assert.notEqual(identityFailure.result.status, 0)
    assert.ok(identityFailure.eventNames.includes('identity failure after mutation'))
    assert.ok(identityFailure.eventNames.includes('Preparation compensation data restore'))
    assert.ok(identityFailure.eventNames.includes('Preparation forward deployment recovery'))

    const startupFailure = runScenario(host, 'startup_failure')
    assert.notEqual(startupFailure.result.status, 0)
    assert.ok(startupFailure.eventNames.includes('Failed rollback shutdown'))
    assert.ok(startupFailure.eventNames.includes('hash:Compensation data backup'))
    assert.ok(startupFailure.eventNames.includes('Compensation data restore'))
    assert.ok(startupFailure.eventNames.includes('Forward deployment recovery'))

    const terminalFailure = runScenario(host, 'terminal_failure')
    assert.notEqual(terminalFailure.result.status, 0)
    assert.ok(terminalFailure.eventNames.includes('Forward deployment recovery'))
    assert.ok(terminalFailure.eventNames.includes('Compensation failure shutdown'))
    assert.ok(terminalFailure.eventNames.includes('locks:Compensation failure shutdown'))
  }
})

test('release rollback scripts fail closed and verify the retained backup before restore', () => {
  for (const source of [checkpointScript, rollbackRestoreScript]) {
    assert.match(source, /\$ErrorActionPreference = 'Stop'/)
    assert.match(source, /function Invoke-Checked/)
    assert.match(source, /Docker Compose writes normal progress to stderr on Windows/)
    assert.match(source, /\$ErrorActionPreference = 'Continue'[\s\S]*\$exitCode = \[int\]\$LASTEXITCODE/)
    assert.match(source, /\$exitCode -ne 0/)
    assert.match(source, /docker[\s\S]*compose[\s\S]*down/)
  }
  assert.match(checkpointScript, /function Get-RunningServiceEvidence[\s\S]*Get-ImageRevision/)
  assert.match(checkpointScript, /function Get-ImageRevision[\s\S]*org\.opencontainers\.image\.revision/)
  assert.match(checkpointScript, /function Get-ImageRevision[\s\S]*\{\{json \.Config\.Labels\}\}/)
  assert.match(checkpointScript, /ConvertFrom-Json -InputObject \$mountJson[\s\S]*ForEach-Object/)
  assert.match(checkpointScript, /docker-compose\.yml[\s\S]*config\.yaml[\s\S]*composeHash[\s\S]*configHash/)
  assert.match(checkpointScript, /backup:data[\s\S]*Get-FileHash[\s\S]*verify:rollback/)
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(checkpointScript, /Get-ContainerBindSource[\s\S]*\/app\/config-source/)
  assert.match(checkpointScript, /LOCALMINIDRAMA_CONFIG_PATH/)
  assert.match(checkpointScript, /runtime_config_source_file/)
  assert.doesNotMatch(checkpointScript, /database_path\s*=/)
  assert.match(checkpointScript, /function Start-CapturedDeployment[\s\S]*ConfigDirectory[\s\S]*ConfigPath[\s\S]*Set-RuntimeConfigEnvironment/)
  assert.match(checkpointScript, /function Set-RuntimeConfigEnvironment[\s\S]*LOCALMINIDRAMA_CONFIG_DIR[\s\S]*LOCALMINIDRAMA_CONFIG_PATH/)
  assert.match(checkpointScript, /Set-RuntimeConfigEnvironment[\s\S]*Data backup[\s\S]*Rollback drill/)
  assert.match(checkpointScript, /docker[\s\S]*image[\s\S]*save[\s\S]*images\.tar/)
  assert.match(checkpointScript, /image_archive_sha256/)
  assert.match(rollbackRestoreScript, /image[\s\S]*load[\s\S]*imageArchivePath/)
  assert.match(rollbackRestoreScript, /Loaded rollback image IDs do not match/)
  assert.match(checkpointScript, /Start-CapturedDeployment[\s\S]*checkpoint failed/)
  assert.match(rollbackRestoreScript, /Get-ContainerBindSource[\s\S]*\/app\/config-source/)
  assert.match(rollbackRestoreScript, /forwardConfigDirectory[\s\S]*forwardConfigPath/)
  assert.match(rollbackRestoreScript, /Set-RuntimeConfigEnvironment[\s\S]*Pre-rollback compensation backup/)
  assert.match(rollbackRestoreScript, /Set-RuntimeConfigEnvironment[\s\S]*Rollback data restore/)
  assert.match(rollbackRestoreScript, /Compensation data restore[\s\S]*Forward deployment recovery/)
  assert.match(rollbackRestoreScript, /preRollbackError[\s\S]*Preparation compensation data restore[\s\S]*Preparation forward deployment recovery/)
  assert.match(rollbackRestoreScript, /Rollback preparation failed[\s\S]*service may remain stopped/i)
  assert.match(rollbackRestoreScript, /compensation also failed[\s\S]*service may remain stopped/i)

  const checkpointMain = checkpointScript.slice(checkpointScript.indexOf('$repoRoot ='))
  const commitCapture = checkpointMain.indexOf("@('rev-parse', 'HEAD')")
  const runningCapture = checkpointMain.indexOf("Get-RunningServiceEvidence -Service 'backend'")
  const shutdown = checkpointMain.indexOf("@('compose', 'down')")
  assert.ok(commitCapture >= 0 && commitCapture < runningCapture && runningCapture < shutdown)

  assert.match(rollbackRestoreScript, /Assert-FileHash[\s\S]*backup_sha256[\s\S]*compose_sha256[\s\S]*runtime_config_sha256[\s\S]*rollback_evidence_sha256/)
  assert.match(rollbackRestoreScript, /org\.opencontainers\.image\.revision[\s\S]*Archived Docker Compose validation/)
  assert.match(rollbackRestoreScript, /function Get-ImageRevision[\s\S]*\{\{json \.Config\.Labels\}\}/)
  assert.match(rollbackRestoreScript, /Pre-rollback compensation backup[\s\S]*Rollback data restore/)
  assert.match(rollbackRestoreScript, /rollbackStartError[\s\S]*Compensation data restore[\s\S]*Forward deployment recovery/)
  assert.match(rollbackRestoreScript, /--no-build/)
  assert.match(rollbackRestoreScript, /\/health[\s\S]*\/ready/)
  assert.match(
    rollbackDrillScript,
    /database:\s*\{[\s\S]*relative_path: safeEvidencePath\(repoRoot, sourcePaths\.databasePath/
  )
  assert.doesNotMatch(rollbackDrillScript, /database:\s*\{[\s\S]*path: sourcePaths\.databasePath/)

  const restoreMain = rollbackRestoreScript.slice(rollbackRestoreScript.indexOf('function Invoke-ReleaseRollbackCheckpointRestore'))
  const push = restoreMain.indexOf('Push-Location $repoRoot')
  const imageLoad = restoreMain.indexOf('Rollback image archive load')
  const imageVerification = restoreMain.indexOf('Backend rollback image verification')
  const composeValidation = restoreMain.indexOf('Archived Docker Compose validation')
  const currentCapture = restoreMain.indexOf("Get-RunningServiceEvidence -Service 'backend'")
  const currentDataCapture = restoreMain.indexOf("-Destination '/app/data' -RequireReadWrite")
  const physicalBoundary = restoreMain.indexOf(
    'Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory',
    currentDataCapture,
  )
  const currentShutdown = restoreMain.indexOf('Current Docker shutdown')
  const compensationBackup = restoreMain.indexOf('Pre-rollback compensation backup')
  const rollbackRestore = restoreMain.indexOf('Rollback data restore')
  const bindingValidation = restoreMain.indexOf('Assert-RollbackEvidenceBinding')
  const earliestMutation = Math.min(imageLoad, currentShutdown, compensationBackup, rollbackRestore)
  assert.ok(
    currentCapture >= 0
      && currentCapture < currentDataCapture
      && currentDataCapture < physicalBoundary
      && physicalBoundary < bindingValidation
      && bindingValidation < composeValidation
      && composeValidation < push
      && push < earliestMutation
      && push < imageLoad
      && imageLoad < imageVerification
      && imageVerification < currentShutdown
      && currentShutdown < compensationBackup
      && compensationBackup < rollbackRestore,
  )
})

test('release rollback data bind source is captured, archived, and used for checkpoint backup', () => {
  assert.match(
    checkpointScript,
    /Get-ContainerBindSource -ContainerId \$backend\.container_id -Destination '\/app\/data' -RequireReadWrite/,
  )
  assert.match(
    checkpointScript,
    /Test-ContainerPathEqual -Expected \(\[string\]\$_.Destination\) -Actual \$Destination[\s\S]*\.Count -ne 1[\s\S]*\.Type -ne 'bind'/,
  )
  assert.match(checkpointScript, /RequireReadWrite[\s\S]*\.RW/)
  assert.match(checkpointScript, /Assert-RealDirectory[\s\S]*\$runtimeDataDirectory/)
  assert.match(checkpointScript, /Assert-OutsideDirectory[\s\S]*\$runtimeDataDirectory[\s\S]*\$checkpoint/)
  assert.match(checkpointScript, /\$dataBindSourceArchive = Join-Path \$checkpoint 'data-bind-source\.txt'/)
  assert.match(checkpointScript, /Write-Utf8File[\s\S]*\$dataBindSourceArchive[\s\S]*\$runtimeDataDirectory/)
  assert.match(checkpointScript, /Get-FileHash[\s\S]*\$dataBindSourceArchive[\s\S]*dataBindSourceHash/)
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(checkpointScript, /data_bind_source\s*=\s*\$runtimeDataDirectory/)
  assert.match(checkpointScript, /data_bind_source_file\s*=\s*'data-bind-source\.txt'/)
  assert.match(checkpointScript, /data_bind_source_sha256\s*=\s*\$dataBindSourceHash/)
  assert.match(
    checkpointScript,
    /backup:data[\s\S]*'--data-root', \$runtimeDataDirectory[\s\S]*Data backup/,
  )
  assert.match(
    checkpointScript,
    /function Set-DataSourceEnvironment[\s\S]*LOCALMINIDRAMA_DATA_DIR[\s\S]*Start-CapturedDeployment[\s\S]*DataDirectory/,
  )

  const checkpointMain = checkpointScript.slice(checkpointScript.indexOf('$repoRoot ='))
  assert.ok(
    checkpointMain.indexOf("-Destination '/app/data' -RequireReadWrite")
      < checkpointMain.indexOf("@('compose', 'down')"),
  )
})

test('release rollback restore binds every data operation to the inspected source and rejects path redirection', () => {
  assert.match(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(rollbackRestoreScript, /\$dataBindSourcePath = Join-Path \$checkpoint 'data-bind-source\.txt'/)
  assert.match(
    rollbackRestoreScript,
    /Assert-FileHash -Path \$dataBindSourcePath -Expected \$metadata\.data_bind_source_sha256/,
  )
  assert.match(
    rollbackRestoreScript,
    /Get-ContainerBindSource -ContainerId \$currentBackend\.container_id -Destination '\/app\/data' -RequireReadWrite/,
  )
  assert.match(
    rollbackRestoreScript,
    /Assert-SamePath[\s\S]*\$recordedDataBindSource[\s\S]*\$forwardDataDirectory/,
  )
  assert.doesNotMatch(rollbackRestoreScript, /Join-Path\s+\$checkpoint\s+\$metadata\./)
  assert.doesNotMatch(rollbackRestoreScript, /Join-Path \$checkpoint \$metadata\.data_bind_source_file/)
  assert.doesNotMatch(rollbackRestoreScript, /'--data-root', \$metadata\./)
  assert.doesNotMatch(rollbackRestoreScript, /Set-DataSourceEnvironment[^\r\n]*\$metadata\./)
  assert.equal(
    [...rollbackRestoreScript.matchAll(/'--data-root', \$forwardDataDirectory/g)].length,
    4,
    'checkpoint restore and all compensation operations must use the inspected data bind source',
  )
  assert.equal(
    [...rollbackRestoreScript.matchAll(/Assert-FileHash -Path \$compensationBackup -Expected \$compensationHash/g)].length,
    2,
    'both automatic compensation restores must verify the retained backup hash',
  )
  assert.match(
    rollbackRestoreScript,
    /function Set-DataSourceEnvironment[\s\S]*LOCALMINIDRAMA_DATA_DIR[\s\S]*Rollback container startup/,
  )
  assert.match(rollbackRestoreScript, /data_bind_source\s*=\s*\$forwardDataDirectory/)
  assert.match(rollbackRestoreScript, /data_bind_source_sha256\s*=\s*\$metadata\.data_bind_source_sha256/)

  const restoreMain = rollbackRestoreScript.slice(rollbackRestoreScript.indexOf('function Invoke-ReleaseRollbackCheckpointRestore'))
  const compensationBackup = restoreMain.indexOf('Pre-rollback compensation backup')
  const compensationMetadata = restoreMain.indexOf("schema = 'localminidrama.rollback-compensation.v2'")
  const rollbackRestore = restoreMain.indexOf('Rollback data restore')
  const currentDataCapture = restoreMain.indexOf("-Destination '/app/data' -RequireReadWrite")
  const currentShutdown = restoreMain.indexOf('Current Docker shutdown')
  assert.ok(
    compensationBackup >= 0
      && compensationBackup < compensationMetadata
      && compensationMetadata < rollbackRestore,
    'forward compensation evidence must be durable before the rollback mutates live data',
  )
  assert.ok(currentDataCapture >= 0 && currentDataCapture < currentShutdown)
  assert.match(
    restoreMain,
    /\$currentComposePrefix = \[string\[\]\]@\('compose', '--project-directory', \$repoRoot\)[\s\S]*Get-RunningServiceEvidence -Service 'backend' -ComposePrefix \$currentComposePrefix/,
  )
})

test('rollback path contracts execute platform-aware host and case-sensitive container comparisons', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-case-contract-'))
  try {
    const upperPath = path.join(fixtureRoot, 'Data')
    const lowerPath = path.join(fixtureRoot, 'data')
    const statements = `
Assert-SamePath -Expected ${powerShellLiteral(upperPath)} -Actual ${powerShellLiteral(lowerPath)} -Label 'Windows host' -Platform Windows
$posixRejected = $false
try {
  Assert-SamePath -Expected ${powerShellLiteral(upperPath)} -Actual ${powerShellLiteral(lowerPath)} -Label 'POSIX host' -Platform Posix
} catch {
  $posixRejected = $true
}
if (-not $posixRejected) { throw 'POSIX host paths must be case-sensitive.' }
if (-not (Test-ContainerPathEqual -Expected '/app/data' -Actual '/app/data')) { throw 'Exact container target did not match.' }
if (Test-ContainerPathEqual -Expected '/app/data' -Actual '/app/Data') { throw 'Container targets must be case-sensitive.' }
`
    for (const source of [checkpointScript, rollbackRestoreScript]) {
      assertRollbackPathProbe(source, statements)
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('rollback path contracts reject either direction of data and checkpoint nesting', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-boundary-contract-'))
  try {
    const dataPath = path.join(fixtureRoot, 'data')
    const nestedCheckpoint = path.join(dataPath, 'checkpoint')
    const outerCheckpoint = path.join(fixtureRoot, 'outer')
    const nestedData = path.join(outerCheckpoint, 'data')
    const siblingCheckpoint = path.join(fixtureRoot, 'checkpoint')
    const statements = `
$firstRejected = $false
try { Assert-SeparateDirectories -First ${powerShellLiteral(dataPath)} -Second ${powerShellLiteral(nestedCheckpoint)} -Platform Windows } catch { $firstRejected = $true }
if (-not $firstRejected) { throw 'Checkpoint nested in data was accepted.' }
$secondRejected = $false
try { Assert-SeparateDirectories -First ${powerShellLiteral(nestedData)} -Second ${powerShellLiteral(outerCheckpoint)} -Platform Windows } catch { $secondRejected = $true }
if (-not $secondRejected) { throw 'Data nested in checkpoint was accepted.' }
Assert-SeparateDirectories -First ${powerShellLiteral(dataPath)} -Second ${powerShellLiteral(siblingCheckpoint)} -Platform Windows
`
    for (const source of [checkpointScript, rollbackRestoreScript]) {
      assertRollbackPathProbe(source, statements)
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('rollback path contracts reject a reparse-point parent of a future checkpoint path', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-reparse-contract-'))
  try {
    const targetPath = path.join(fixtureRoot, 'target')
    const linkPath = path.join(fixtureRoot, 'linked-parent')
    fs.mkdirSync(targetPath)
    try {
      fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      t.skip(`directory links are unavailable on this platform: ${error.message}`)
      return
    }
    const futureCheckpoint = path.join(linkPath, 'future', 'checkpoint')
    const statements = `
Get-Command Assert-NoReparsePathComponents -ErrorAction Stop | Out-Null
$rejected = $false
try { Assert-NoReparsePathComponents -Path ${powerShellLiteral(futureCheckpoint)} -Label 'Rollback checkpoint' } catch { $rejected = $true }
if (-not $rejected) { throw 'A reparse-point checkpoint parent was accepted.' }
`
    for (const source of [checkpointScript, rollbackRestoreScript]) {
      assertRollbackPathProbe(source, statements)
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('rollback scripts revalidate physical boundaries before destructive data and image operations', () => {
  for (const source of [checkpointScript, rollbackRestoreScript]) {
    assert.match(
      source,
      /function Assert-SafeRollbackPaths[\s\S]*Assert-NoReparsePathComponents[\s\S]*Assert-RealDirectory[\s\S]*Assert-SeparateDirectories/,
    )
  }

  assert.match(
    checkpointScript,
    /Assert-SafeRollbackPaths[^\r\n]*CheckpointMayNotExist[\s\S]*New-Item -ItemType Directory -Path \$checkpoint/,
  )
  assert.match(
    checkpointScript,
    /Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Backend checkpoint image tag[\s\S]*Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Docker shutdown[\s\S]*Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Data backup/,
  )
  assert.match(
    rollbackRestoreScript,
    /function Assert-CurrentRollbackRoot[\s\S]*Assert-SafeRollbackPaths[\s\S]*Rollback image archive load[\s\S]*Assert-CurrentRollbackRoot[^\r\n]*[\s\S]*Current backend compensation tag[\s\S]*Assert-CurrentRollbackRoot[^\r\n]*[\s\S]*Current Docker shutdown/,
  )
  for (const label of [
    'Pre-rollback compensation backup',
    'Rollback data restore',
    'Failed rollback preparation shutdown',
    'Preparation compensation data restore',
    'Failed rollback shutdown',
    'Compensation data restore',
  ]) {
    const operation = rollbackRestoreScript.indexOf(`-Label '${label}'`)
    assert.ok(operation > 0, `${label} operation is missing`)
    const command = rollbackRestoreScript.lastIndexOf('Invoke-Checked', operation)
    const guard = rollbackRestoreScript.lastIndexOf('Assert-CurrentRollbackRoot', operation)
    const previousOperation = Math.max(
      rollbackRestoreScript.lastIndexOf("backup:data'", command - 1),
      rollbackRestoreScript.lastIndexOf("restore:data'", command - 1),
      rollbackRestoreScript.lastIndexOf("'down')", command - 1),
      rollbackRestoreScript.lastIndexOf("image', 'load", command - 1),
      rollbackRestoreScript.lastIndexOf("image', 'tag", command - 1),
    )
    assert.ok(
      guard > previousOperation && guard < command,
      `${label} must have a fresh physical-boundary guard`,
    )
  }
})

test('release rollback verifies the resolved Compose data bind before every recovery startup', () => {
  for (const source of [checkpointScript, rollbackRestoreScript]) {
    assert.match(source, /function Assert-ComposeDataSource[\s\S]*'config', '--format', 'json'/)
    assert.match(
      source,
      /Test-ContainerPathEqual -Expected \(\[string\]\$_.target\) -Actual '\/app\/data'[\s\S]*\.Count -ne 1[\s\S]*\.type -ne 'bind'/,
    )
    assert.match(source, /Assert-ComposeDataSource[\s\S]*Assert-SamePath/)
  }

  const checkpointRecovery = checkpointScript.slice(checkpointScript.indexOf('function Start-CapturedDeployment'))
  assert.match(
    checkpointRecovery,
    /Assert-ComposeDataSource[\s\S]*Captured deployment recovery[\s\S]*Assert-RunningBackendDataSource/,
  )

  const restoreMain = rollbackRestoreScript.slice(rollbackRestoreScript.indexOf('Push-Location $repoRoot'))
  assert.match(
    restoreMain,
    /Assert-ComposeDataSource[\s\S]*Rollback container startup[\s\S]*Assert-RunningBackendDataSource/,
  )
  assert.match(
    restoreMain,
    /Assert-ComposeDataSource[\s\S]*Forward deployment recovery[\s\S]*Assert-RunningBackendDataSource/,
  )
})

test('release data tools and Compose accept an explicit inspected data root', () => {
  assert.match(dockerCompose, /source:\s*\$\{LOCALMINIDRAMA_DATA_DIR:-\.\/backend-node\/data\}/)

  for (const source of [backupDataScript, restoreDataScript]) {
    assert.match(source, /'--data-root': 'dataRoot'/)
    assert.match(source, /path\.join\(dataRoot, 'drama_generator\.db'\)/)
    assert.match(source, /path\.join\(dataRoot, 'storage'\)/)
    assert.match(source, /path\.join\(dataRoot, 'story_sources'\)/)
  }
})

test('rollback restore captures the running container ID needed for compensation', () => {
  const evidenceFunction = rollbackRestoreScript.slice(
    rollbackRestoreScript.indexOf('function Get-RunningServiceEvidence'),
    rollbackRestoreScript.indexOf('function Test-ApplicationHealth'),
  )

  assert.match(evidenceFunction, /container_id\s*=\s*\$containerId/)
  assert.match(rollbackRestoreScript, /Get-ContainerBindSource -ContainerId \$currentBackend\.container_id/)
  assert.match(evidenceFunction, /@\(\$ComposePrefix\) \+ @\('ps', '-a', '-q'/)
  assert.match(
    rollbackRestoreScript,
    /\$currentComposePrefix = \[string\[\]\]@\('compose', '--project-directory', \$repoRoot\)/,
  )
  assert.doesNotMatch(evidenceFunction, /must be running and healthy before rollback/)
  assert.match(evidenceFunction, /status\s*=\s*\$status[\s\S]*health\s*=\s*\$health/)
})

test('rollback checkpoints archive only sanitized runtime config and require credential reconfiguration', (t) => {
  assert.match(
    checkpointScript,
    /runtime-config-policy\.cjs[\s\S]*\$runtimeConfigSource[\s\S]*\$configArchive/,
  )
  assert.doesNotMatch(
    checkpointScript,
    /Copy-Item -LiteralPath \$runtimeConfigSource -Destination \$configArchive/,
  )
  for (const field of [
    'runtime_config_sanitized',
    'runtime_config_credentials_excluded',
    'credential_reconfiguration_required',
  ]) {
    assert.match(checkpointScript, new RegExp(`${field}\\s*=\\s*\\$true`))
    assert.match(rollbackRestoreScript, new RegExp(`\\$metadata\\.${field}`))
    assert.match(
      rollbackRestoreScript,
      new RegExp(`\\$metadata\\.${field}\\s+-isnot\\s+\\[bool\\]`),
    )
  }
  assert.match(rollbackRestoreScript, /configure[\s\S]*credentials[\s\S]*test again/i)
  const sanitization = checkpointScript.indexOf('Runtime config sanitization')
  const sanitizedConfigHash = checkpointScript.indexOf('$configHash =')
  const restorePolicyValidation = rollbackRestoreScript.indexOf("Properties['runtime_config_sanitized']")
  const rollbackImageLoad = rollbackRestoreScript.indexOf('Rollback image archive load')
  assert.ok(sanitization >= 0 && sanitization < sanitizedConfigHash)
  assert.ok(restorePolicyValidation >= 0 && restorePolicyValidation < rollbackImageLoad)

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-checkpoint-config-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const sourcePath = path.join(fixtureRoot, 'source.yaml')
  const archivePath = path.join(fixtureRoot, 'checkpoint', 'configs', 'config.yaml')
  const secretMarkers = [
    'fixture-api-key-secret',
    'fixture-token-secret',
    'fixture-password-secret',
    'fixture-authorization-secret',
    'fixture-header-secret',
  ]
  fs.writeFileSync(sourcePath, [
    'app:',
    '  name: Sanitized checkpoint fixture',
    'server:',
    '  port: 5679',
    'storage:',
    '  base_url: "https://user:fixture-password-secret@example.invalid/static?token=fixture-token-secret"',
    'ai:',
    '  default_text_provider: openai',
    '  api_key: fixture-api-key-secret',
    '  token: fixture-token-secret',
    '  password: fixture-password-secret',
    '  authorization: fixture-authorization-secret',
    '  headers:',
    '    X-Provider-Key: fixture-header-secret',
    'providers:',
    '  custom:',
    '    API-Key: fixture-api-key-secret',
    '    Authorization: fixture-authorization-secret',
    '    custom_headers:',
    '      X-Token: fixture-header-secret',
    '',
  ].join('\n'), 'utf8')

  sanitizeRuntimeConfigFile(sourcePath, archivePath)
  const archivedConfig = fs.readFileSync(archivePath, 'utf8')
  assert.match(archivedConfig, /name: Sanitized checkpoint fixture/)
  assert.match(archivedConfig, /default_text_provider: openai/)
  assert.doesNotMatch(archivedConfig, /api[-_]?key|token|password|authorization|headers?/i)
  for (const marker of secretMarkers) assert.equal(archivedConfig.includes(marker), false)

  assert.throws(
    () => sanitizeRuntimeConfig({ style: { default_style: 'cinematic sk-EXAMPLESECRET123456' } }),
    /credential-like data/,
  )
})

test('dist:mac fails closed before any build or upload command can run', () => {
  assertMacReleaseFailsClosed()
  assert.equal(desktopPackage.scripts['dist:mac'], 'bash dist-mac.sh')
  assert.equal(desktopPackage.scripts['predist:mac'], undefined)
  assert.equal(desktopPackage.scripts['postdist:mac'], undefined)
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'desktop')).filter((name) => /^electron-builder-mac.*\.json$/i.test(name)),
    [],
  )
})

test('CI scans source dependencies and configuration with pinned Trivy before release tagging', () => {
  const sourceSecurity = jobBlock('source-security', ciWorkflow)
  assert.match(sourceSecurity, /runs-on: ubuntu-latest/)
  assert.match(
    sourceSecurity,
    /TRIVY_IMAGE: ghcr\.io\/aquasecurity\/trivy@sha256:a8ca29078522f30393bdb34225e4c0994d38f37083be81a42da3a2a7e1488e9e/,
  )
  assert.match(sourceSecurity, /readonly expected_version='0\.64\.1'/)
  assert.match(sourceSecurity, /test "\$version" = "\$expected_version"/)
  assert.match(sourceSecurity, /run_trivy fs/)
  assert.match(sourceSecurity, /--scanners vuln,misconfig/)
  assert.match(sourceSecurity, /--severity HIGH,CRITICAL/)
  assert.match(sourceSecurity, /--ignore-unfixed/)
  assert.match(sourceSecurity, /--include-dev-deps/)
  assert.match(sourceSecurity, /--ignorefile backend-node\/\.trivyignore\.yaml/)
  assert.match(sourceSecurity, /trivy-source\.json/)
})

test('backend Trivy exception covers direct and repository-root scan targets', () => {
  assert.match(backendTrivyIgnore, /paths:\s*\r?\n\s*- Dockerfile\r?\n\s*- backend-node\/Dockerfile/)
})

test('CI and release reuse one complete Windows artifact security workflow', () => {
  assert.equal(fs.existsSync(windowsReleaseSecurityWorkflowPath), true)
  assert.match(windowsReleaseSecurityWorkflow, /^on:\r?\n  workflow_call:/m)
  assert.match(windowsReleaseSecurityWorkflow, /artifact-key:\r?\n\s+required: true\r?\n\s+type: string/)

  const ciSecurity = jobBlock('windows-release-security', ciWorkflow)
  assert.match(ciSecurity, /needs: desktop/)
  assert.match(ciSecurity, /uses: \.\/\.github\/workflows\/windows-release-security\.yml/)
  assert.match(ciSecurity, /artifact-key: ci-\$\{\{ github\.sha \}\}/)

  const releaseSecurity = jobBlock('windows-release-security', workflow)
  assert.match(releaseSecurity, /needs: build-windows/)
  assert.match(releaseSecurity, /uses: \.\/\.github\/workflows\/windows-release-security\.yml/)
  assert.match(releaseSecurity, /artifact-key: \$\{\{ github\.ref_name \}\}-\$\{\{ github\.sha \}\}/)
})

test('Windows artifact recording re-extracts physical applications after scanner handoff', () => {
  const artifactScan = jobBlock('scan-windows-artifacts', windowsReleaseSecurityWorkflow)
  const trivyScan = jobBlock('scan-trivy-artifacts', windowsReleaseSecurityWorkflow)

  assert.match(trivyScan, /name: windows-release-trivy-evidence-\$\{\{ inputs\['artifact-key'\] \}\}/)
  assert.match(trivyScan, /path: desktop\/release\/\.artifact-scan\/\.evidence\/trivy\.json/)
  assert.equal([...trivyScan.matchAll(/actions\/upload-artifact@/g)].length, 1)
  assert.doesNotMatch(trivyScan, /windows-release-security-evidence-|inventory\.json/)
  assert.doesNotMatch(trivyScan, /record:artifact-security|release:manifest|verify:release:artifacts/)
  assert.doesNotMatch(trivyScan, /name: windows-release-\$\{\{ inputs\['artifact-key'\] \}\}/)

  const record = jobBlock('record-windows-artifacts', windowsReleaseSecurityWorkflow)
  assert.match(record, /runs-on: windows-latest/)
  assert.match(record, /needs: \[scan-windows-artifacts, scan-trivy-artifacts\]/)
  assert.match(record, /node-version: '20'/)
  assert.match(record, /npm --prefix desktop ci --ignore-scripts/)
  assert.match(
    record,
    /windows-release-unverified-[\s\S]*path: desktop\/release[\s\S]*windows-release-security-evidence-[\s\S]*path: desktop\/security-evidence\/windows[\s\S]*windows-release-trivy-evidence-[\s\S]*path: desktop\/security-evidence\/trivy/,
  )

  const prepareIndex = record.indexOf('npm --prefix desktop run prepare:artifact-scan')
  const firstParseIndex = record.indexOf('JSON.parse')
  const equalityIndex = record.indexOf('assert.deepEqual(regeneratedInventory, firstInventory)')
  const evidenceDirectoryIndex = record.indexOf('New-Item -ItemType Directory -Path $evidenceRoot -Force')
  const markerIndex = record.indexOf('Copy-Item')
  const recordIndex = record.indexOf('npm --prefix desktop run record:artifact-security')
  assert.ok(prepareIndex !== -1 && prepareIndex < firstParseIndex)
  assert.match(record, /JSON\.parse[\s\S]*JSON\.parse/)
  assert.match(record, /sort\(\(left, right\) => left\.executable\.localeCompare\(right\.executable\)\)/)
  assert.ok(equalityIndex !== -1 && equalityIndex < markerIndex)
  assert.ok(evidenceDirectoryIndex !== -1 && evidenceDirectoryIndex < markerIndex)
  assert.match(record, /gitleaks\.json[\s\S]*defender\.json[\s\S]*trivy\.json/)
  assert.equal([...record.matchAll(/Copy-Item -LiteralPath/g)].length, 3)
  assert.ok(recordIndex !== -1 && markerIndex < recordIndex)
  assert.match(record, /record:artifact-security[\s\S]*release:manifest[\s\S]*verify:release:artifacts/)
  assert.match(record, /name: windows-release-\$\{\{ inputs\['artifact-key'\] \}\}/)
  assert.match(record, /desktop\/release\/release-manifest\.json/)
  assert.match(record, /desktop\/release\/SHA256SUMS/)

  assert.match(artifactScan, /desktop\/release\/\.artifact-scan\/inventory\.json/)
  assert.match(artifactScan, /desktop\/release\/\.artifact-scan\/\.evidence\/gitleaks\.json/)
  assert.match(artifactScan, /desktop\/release\/\.artifact-scan\/\.evidence\/defender\.json/)
  assert.doesNotMatch(artifactScan, /\.artifact-scan\/(?:setup|portable|unpacked)/)
})

test('release workflow separates read-only build, artifact verification and publishing', () => {
  assert.match(workflow, /^permissions:\s*\{\}\s*$/m)
  const rollback = jobBlock('rollback-drill')
  const build = jobBlock('build-windows')
  const releaseSecurity = jobBlock('windows-release-security')
  const artifactScan = jobBlock('scan-windows-artifacts', windowsReleaseSecurityWorkflow)
  const trivyScan = jobBlock('scan-trivy-artifacts', windowsReleaseSecurityWorkflow)
  const record = jobBlock('record-windows-artifacts', windowsReleaseSecurityWorkflow)
  const artifactVerification = jobBlock('verify-artifacts')
  const publish = jobBlock('publish-release')

  assert.match(rollback, /runs-on: ubuntu-latest/)
  assert.match(rollback, /node-version: '20'/)
  assert.match(rollback, /npm --prefix backend-node ci/)
  assert.match(rollback, /npm --prefix backend-node run migrate/)
  assert.match(rollback, /npm run verify:rollback/)
  assert.match(rollback, /summary\.source\.commit[\s\S]*GITHUB_SHA/)
  assert.match(rollback, /name: release-rollback-drill-\$\{\{ github\.sha \}\}/)

  assert.match(build, /needs: \[production-e2e, rollback-drill\]/)
  assert.match(build, /permissions:\r?\n      contents: read/)
  assert.doesNotMatch(build, /contents: write|GH_TOKEN|action-gh-release|attest-build-provenance/)
  assert.match(build, /npm run dist/)
  assert.match(build, /npm run package:unpacked/)
  assert.match(build, /writeReleaseSboms/)
  assert.match(build, /verify-package[\s\S]*verify-payload[\s\S]*verify-tools/)
  assert.match(build, /windows-release-unverified-/)
  assert.doesNotMatch(build, /release:manifest|record:artifact-security/)
  assert.doesNotMatch(build, /choco install|Get-FileHash/)

  assert.match(releaseSecurity, /needs: build-windows/)
  assert.match(releaseSecurity, /permissions:\r?\n      contents: read/)
  assert.match(releaseSecurity, /uses: \.\/\.github\/workflows\/windows-release-security\.yml/)
  assert.match(artifactScan, /runs-on: windows-latest/)
  assert.match(artifactScan, /permissions:\r?\n      contents: read/)
  assert.match(artifactScan, /DA6458E8864AF553807DE1C46A7A8EAC0880BD6B99BA56288E87E86A45AF884F/)
  assert.match(artifactScan, /gitleaks dir desktop\/release --config \.gitleaks-artifacts\.toml/)
  assert.doesNotMatch(artifactScan, /gitleaks dir desktop\/release --config \.gitleaks\.toml/)
  assert.match(artifactScan, /prepare:artifact-scan[\s\S]*mark gitleaks \$version[\s\S]*MpCmdRun\.exe[\s\S]*mark defender \$version/)
  assert.match(artifactScan, /name: windows-release-security-evidence-/)
  for (const name of [
    'desktop/release/.artifact-scan/inventory.json',
    'desktop/release/.artifact-scan/.evidence/gitleaks.json',
    'desktop/release/.artifact-scan/.evidence/defender.json',
  ]) {
    assert.match(artifactScan, new RegExp(name.replaceAll('.', '\\.')))
  }
  assert.match(artifactScan, /include-hidden-files: true/)
  assert.doesNotMatch(artifactScan, /setup-trivy|trivy (?:sbom|config)|mark trivy|\.evidence\/trivy\.json/)
  assert.doesNotMatch(artifactScan, /artifact-security\.json|release-manifest\.json|SHA256SUMS/)
  assert.doesNotMatch(artifactScan, /contents: write|attest-build-provenance|action-gh-release/)

  assert.match(trivyScan, /needs: scan-windows-artifacts/)
  assert.match(trivyScan, /runs-on: ubuntu-latest/)
  assert.match(trivyScan, /permissions:\r?\n      contents: read/)
  assert.match(
    trivyScan,
    /^      TRIVY_IMAGE: ghcr\.io\/aquasecurity\/trivy@sha256:a8ca29078522f30393bdb34225e4c0994d38f37083be81a42da3a2a7e1488e9e\r?$/m,
  )
  assert.match(trivyScan, /docker run --rm[\s\S]*"\$TRIVY_IMAGE" "\$@"/)
  assert.match(trivyScan, /readonly expected_version='0\.64\.1'[\s\S]*test "\$version" = "\$expected_version"/)
  assert.match(trivyScan, /LocalMiniDrama-\$desktop_version\.cdx\.json/)
  for (const name of ['sbom-backend.cdx.json', 'sbom-frontend.cdx.json', 'sbom-desktop.cdx.json']) {
    assert.match(trivyScan, new RegExp(name.replaceAll('.', '\\.')))
  }
  assert.match(trivyScan, /for sbom in "\$\{sboms\[@\]\}"; do[\s\S]*run_trivy sbom/)
  assert.match(trivyScan, /--ignorefile backend-node\/\.trivyignore\.yaml backend-node\/Dockerfile/)
  for (const name of ['frontweb/Dockerfile', 'frontweb/Dockerfile.prod']) {
    assert.match(trivyScan, new RegExp(`run_trivy config[^\r\n]*${name.replaceAll('.', '\\.')}`))
  }
  assert.doesNotMatch(trivyScan, /--scanners misconfig desktop\/release\/\.artifact-scan/)
  assert.doesNotMatch(trivyScan, /--scanners vuln,misconfig desktop\/release\/\.artifact-scan/)
  assert.match(backendTrivyIgnore, /id:\s*AVD-DS-0002/)
  assert.match(backendTrivyIgnore, /paths:\s*\r?\n\s*- Dockerfile/)
  assert.match(backendTrivyIgnore, /expired_at:\s*2027-07-17/)
  assert.match(backendTrivyIgnore, /setpriv/)
  assert.match(trivyScan, /windows-release-unverified-[\s\S]*path: desktop\/release/)
  assert.match(trivyScan, /run_trivy --version --format json/)
  assert.match(trivyScan, /cat \/root\/\.cache\/trivy\/policy\/metadata\.json/)
  assert.match(trivyScan, /mark trivy "\$version" "\$version_metadata" "\$policy_metadata"/)
  assert.match(trivyScan, /name: windows-release-trivy-evidence-/)
  assert.doesNotMatch(trivyScan, /windows-release-security-evidence-|record:artifact-security|release:manifest|verify:release:artifacts/)
  assert.doesNotMatch(trivyScan, /contents: write|attest-build-provenance|action-gh-release/)

  assert.match(record, /needs: \[scan-windows-artifacts, scan-trivy-artifacts\]/)
  assert.match(record, /runs-on: windows-latest/)
  assert.match(record, /npm --prefix desktop run prepare:artifact-scan/)
  assert.match(record, /assert\.deepEqual\(regeneratedInventory, firstInventory\)/)
  assert.match(record, /record:artifact-security[\s\S]*release:manifest[\s\S]*verify:release:artifacts/)
  for (const name of [
    'desktop/release/*.exe',
    'desktop/release/*.exe.blockmap',
    'desktop/release/LocalMiniDrama-Unpacked-*-x64.zip',
    'desktop/release/*.cdx.json',
    'desktop/release/artifact-security.json',
    'desktop/release/media-tools.json',
    'desktop/release/release-manifest.json',
    'desktop/release/SHA256SUMS',
  ]) {
    assert.ok(record.includes(name), `final Windows bundle upload must include ${name}`)
  }
  assert.doesNotMatch(record, /\.artifact-scan\/(?:setup|portable|unpacked)/)
  assert.match(
    windowsArtifactVerifierSource,
    /source_artifact_sha256: sourceArtifactHashes\(packageJson\.version, releaseRoot\)/,
  )
  assert.match(
    windowsArtifactVerifierSource,
    /function recordArtifactSecurity\(\)[\s\S]*sourceDirectory: releaseRoot[\s\S]*source_artifact_sha256: inventory\.source_artifact_sha256/,
  )

  assert.match(artifactVerification, /needs: windows-release-security/)
  assert.match(artifactVerification, /npm run verify:release:artifacts/)
  assert.match(artifactVerification, /attestations: write/)
  assert.match(artifactVerification, /id-token: write/)

  assert.match(publish, /needs: \[production-e2e, rollback-drill, windows-release-security, verify-artifacts\]/)
  assert.match(publish, /permissions:\r?\n      contents: write/)
  assert.match(publish, /softprops\/action-gh-release@[a-f0-9]{40}/)
  for (const block of [record, artifactVerification, publish]) {
    assert.doesNotMatch(block, /desktop\/release\/\*\.zip/)
    assert.match(block, /desktop\/release\/LocalMiniDrama-Unpacked-\*-x64\.zip/)
  }
  assert.doesNotMatch(publish, /electron-builder|npm run dist/)
})

test('remote release tag verification supports lightweight and annotated tags and fails closed', () => {
  const commit = '1'.repeat(40)
  const tagObject = '2'.repeat(40)
  const movedCommit = '3'.repeat(40)
  const environment = {
    GITHUB_REF: 'refs/tags/v1.3.3',
    GITHUB_REF_NAME: 'v1.3.3',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_SHA: commit,
  }
  const response = (stdout, status = 0) => ({ status, stdout, stderr: '', error: null })
  const annotated = verifyRemoteReleaseTag(environment, {
    spawnSync: (command, args) => {
      assert.equal(command, 'git')
      assert.deepEqual(args, [
        'ls-remote',
        '--exit-code',
        'origin',
        'refs/tags/v1.3.3',
        'refs/tags/v1.3.3^{}',
      ])
      return response([
        `${tagObject}\trefs/tags/v1.3.3`,
        `${commit}\trefs/tags/v1.3.3^{}`,
        '',
      ].join('\n'))
    },
  })
  assert.equal(annotated.commit, commit)
  assert.equal(annotated.annotated, true)

  const lightweight = verifyRemoteReleaseTag(environment, {
    spawnSync: () => response(`${commit}\trefs/tags/v1.3.3\n`),
  })
  assert.equal(lightweight.commit, commit)
  assert.equal(lightweight.annotated, false)

  assert.throws(
    () => verifyRemoteReleaseTag(environment, { spawnSync: () => response('', 2) }),
    /remote release tag is missing/,
  )
  assert.throws(
    () => verifyRemoteReleaseTag(environment, {
      spawnSync: () => response(`${movedCommit}\trefs/tags/v1.3.3\n`),
    }),
    /does not match GITHUB_SHA/,
  )
})

test('publish re-resolves the remote tag immediately before creating the draft release', () => {
  const publish = jobBlock('publish-release')
  const checkout = publish.indexOf('actions/checkout@')
  const remoteTagGate = publish.indexOf('node scripts/verify-release.cjs --verify-remote-tag')
  const releaseAction = publish.indexOf('softprops/action-gh-release@')

  assert.ok(checkout >= 0 && checkout < remoteTagGate && remoteTagGate < releaseAction)
  assert.match(publish, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(publish, /node-version: ['"]20['"]/)
})

test('CI runs the isolated rollback drill before a release tag is created', () => {
  const rollback = jobBlock('rollback-drill', ciWorkflow)
  assert.match(rollback, /runs-on: ubuntu-latest/)
  assert.match(rollback, /node-version: '20'/)
  assert.match(rollback, /npm --prefix backend-node ci/)
  assert.match(rollback, /npm --prefix backend-node run migrate/)
  assert.match(rollback, /npm run verify:rollback/)
  assert.match(rollback, /summary\.source\.commit[\s\S]*GITHUB_SHA/)
})

test('third-party workflow actions are pinned to full commit digests', () => {
  const uses = [workflow, ciWorkflow, windowsReleaseSecurityWorkflow]
    .flatMap((source) => [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]))
  assert.ok(uses.length > 0)
  for (const action of uses) {
    if (action.startsWith('./')) {
      assert.equal(action, './.github/workflows/windows-release-security.yml')
    } else {
      assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${action} is not commit-pinned`)
    }
  }
})

test('release workflow uses the Node 20 baseline from CI', () => {
  for (const source of [ciWorkflow, workflow, windowsReleaseSecurityWorkflow]) {
    const setupNodeActions = [...source.matchAll(/^\s*- uses: actions\/setup-node@[a-f0-9]{40}/gm)]
    const nodeVersions = [...source.matchAll(/^\s+node-version:\s*['"]?(\d+)['"]?\s*$/gm)]
      .map((match) => match[1])

    assert.ok(setupNodeActions.length > 0)
    assert.equal(nodeVersions.length, setupNodeActions.length, 'every setup-node action must declare a Node version')
    assert.deepEqual([...new Set(nodeVersions)], ['20'])
  }
})

test('package test scripts use Node discovery instead of shell-expanded globs', () => {
  assert.equal(frontendPackage.scripts.test, 'node --test')
  assert.equal(backendPackage.scripts.test, 'node --test --test-concurrency=1')
  for (const packageJson of [frontendPackage, backendPackage]) {
    assert.doesNotMatch(packageJson.scripts.test, /[?*]/)
  }
})

test('Docker entrypoint remains executable across Windows checkouts', () => {
  assert.ok(gitAttributes.split(/\r?\n/).includes('*.sh text eol=lf'))
  assert.equal(backendEntrypoint.includes('\r'), false)
  assert.match(backendEntrypoint, /^#!\/bin\/sh\n/)
  assert.ok(backendDockerfile.includes("sed -i 's/\\r$//' /usr/local/bin/localminidrama-entrypoint"))
  assert.match(dockerArtifactVerifierSource, /runtime entrypoint contains CRLF line endings/)
  assert.match(dockerArtifactVerifierSource, /runtime entrypoint has an invalid shebang/)
})

test('Windows release verification executes npm through node instead of spawning a batch file', () => {
  const invocation = npmInvocation(['run', 'verify'], {
    platform: 'win32',
    execPath: 'C:\\runtime\\node.exe',
    environment: { npm_execpath: 'C:\\runtime\\node_modules\\npm\\bin\\npm-cli.js' },
  })

  assert.equal(invocation.command, 'C:\\runtime\\node.exe')
  assert.deepEqual(invocation.args, [
    'C:\\runtime\\node_modules\\npm\\bin\\npm-cli.js',
    'run',
    'verify',
  ])
})

test('Windows CI builds the complete unverified candidate before independent security scans', () => {
  const verifyWindowsStart = releaseVerifierSource.indexOf('function verifyWindowsArtifacts()')
  const verifyWindowsEnd = releaseVerifierSource.indexOf('\nfunction main(', verifyWindowsStart)
  const verifyWindows = releaseVerifierSource.slice(verifyWindowsStart, verifyWindowsEnd)
  assert.match(verifyWindows, /runNpm\(\['--prefix', 'desktop', 'run', 'dist'\]\)/)
  assert.match(verifyWindows, /runNpm\(\['--prefix', 'desktop', 'run', 'smoke:windows'\]\)/)
  assert.match(verifyWindows, /runNpm\(\['--prefix', 'desktop', 'run', 'package:unpacked'\]\)/)
  assert.doesNotMatch(verifyWindows, /release:manifest|verify:release:artifacts/)

  const desktopJob = jobBlock('desktop', ciWorkflow)
  assert.match(desktopJob, /npm run verify:release:windows/)
  assert.match(desktopJob, /ChocolateyInstall[\s\S]*media-tool-policy\.js verify-tools/)
  assert.doesNotMatch(desktopJob, /Get-Command ffmpeg\.exe/)
  assert.match(desktopJob, /desktop\/release\/\*\.zip/)
  assert.match(desktopJob, /name: windows-release-unverified-ci-\$\{\{ github\.sha \}\}/)
  assert.doesNotMatch(desktopJob, /release-manifest\.json|SHA256SUMS/)

  const securityJob = jobBlock('windows-release-security', ciWorkflow)
  assert.match(securityJob, /needs: desktop/)
  assert.match(securityJob, /uses: \.\/\.github\/workflows\/windows-release-security\.yml/)
})

test('Docker artifact boundaries are checked before production bind mounts change ownership', () => {
  assert.equal(rootPackage.scripts['verify:docker'], 'npm run verify:docker:artifact && npm run verify:docker:containers')
  assert.equal(rootPackage.scripts['verify:docker:artifact'], 'node scripts/verify-docker-artifact.cjs')
  assert.match(rootPackage.scripts['verify:docker:containers'], /backend-verify[\s\S]*frontend-verify/)

  for (const source of [jobBlock('docker-production-e2e', ciWorkflow), jobBlock('production-e2e', workflow)]) {
    const artifact = source.indexOf('npm run verify:docker:artifact')
    const start = source.indexOf('docker compose --profile e2e up')
    const containers = source.indexOf('npm run verify:docker:containers')
    assert.ok(artifact >= 0 && artifact < start, 'Docker artifact boundary check must run before production startup')
    assert.ok(start >= 0 && start < containers, 'container verification must run after production startup')
  }

  const sourceVerificationStart = releaseVerifierSource.indexOf('function verifySourceAndContainers()')
  const sourceVerificationEnd = releaseVerifierSource.indexOf('\nfunction writeSbom(', sourceVerificationStart)
  const sourceVerification = releaseVerifierSource.slice(sourceVerificationStart, sourceVerificationEnd)
  const artifactVerification = sourceVerification.indexOf("['run', 'verify:docker:artifact']")
  const productionStartup = sourceVerification.indexOf("['run', 'docker:e2e:up']")
  const containerVerification = sourceVerification.indexOf("['run', 'verify:docker:containers']")
  assert.ok(artifactVerification >= 0, 'release verification is missing the Docker artifact boundary check')
  assert.ok(productionStartup >= 0, 'release verification is missing production container startup')
  assert.ok(containerVerification >= 0, 'release verification is missing container verification')
  assert.ok(
    artifactVerification < productionStartup,
    'release verification must check the Docker build context before mounting production data'
  )
  assert.ok(
    productionStartup < containerVerification,
    'release verification must run container tests after production startup'
  )
})

test('artifact secret scanning excludes only pass markers and raw ASAR containers', () => {
  assert.match(artifactGitleaksConfig, /\.artifact-scan\/\\\.evidence/)
  assert.match(artifactGitleaksConfig, /\\\.asar\$/)
  assert.doesNotMatch(artifactGitleaksConfig, /desktop\/release|node_modules|\(\?:\[\^\/\]\+\)\?/)
})

test('artifact secret scanning bounds archive traversal before redaction', () => {
  assert.match(
    windowsReleaseSecurityWorkflow,
    /gitleaks dir desktop\/release --config \.gitleaks-artifacts\.toml --max-archive-depth 1 --max-target-megabytes 256 --redact --no-banner/
  )
})

test('source secret scanning covers every tracked path and isolates worktree output exclusions', () => {
  assert.deepEqual(parseToml(sourceGitleaksConfig), { extend: { useDefault: true } })

  const worktreeConfigPath = path.join(root, '.gitleaks-worktree.toml')
  assert.equal(fs.existsSync(worktreeConfigPath), true, 'worktree-only Gitleaks config is missing')
  assert.deepEqual(parseToml(fs.readFileSync(worktreeConfigPath, 'utf8')), {
    extend: { useDefault: true },
    allowlist: {
      description: 'Untracked runtime, dependency, evidence, and build outputs are scanned by their artifact-specific gates',
      paths: [
        '(^|/)\\.codex-audit/',
        '(^|/)artifacts/',
        '(^|/)node_modules/',
        '(^|/)backend-node/data/',
        '(^|/)desktop/backend-app/',
        '(^|/)desktop/frontweb-dist/',
        '(^|/)desktop/release(?:-[^/]+)?/',
        '(^|/)frontweb/dist/',
      ],
    },
  })

  const ignoredFingerprints = sourceGitleaksIgnore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  assert.deepEqual(ignoredFingerprints, [
    'ececcdcb6b14f40b8d3fec42a38a2633593b4613:desktop/backend-app-secure/src/app.js:generic-api-key:1',
    '6b216ed727772ab794d5c0bfd6c717b3425d164a:frontweb/test/acceptanceReportVerifier.test.js:generic-api-key:396',
    'dcf6cc47fe3b526cf57c294e3a0b72a7719d1a45:backend-node/test/maintenanceRecoveryCli.test.js:generic-api-key:50',
  ])

  for (const secretScanJob of [
    jobBlock('secret-scan', ciWorkflow),
    jobBlock('production-e2e', workflow),
  ]) {
    assert.match(secretScanJob, /gitleaks\/gitleaks-action@[a-f0-9]{40}/)
    assert.match(
      secretScanJob,
      /GITLEAKS_IMAGE:\s*ghcr\.io\/gitleaks\/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f/,
    )
    assert.match(secretScanJob, /docker run --rm "\$GITLEAKS_IMAGE" version[\s\S]*v8\.30\.1/)
    assert.match(secretScanJob, /--volume "\$GITHUB_WORKSPACE:\/repo:ro"/)
    assert.match(secretScanJob, /git --config \.gitleaks\.toml --redact --no-banner --log-opts=--all/)
  }
})

test('release tag parsing fails closed in tag context', () => {
  const version = desktopPackage.version
  assert.equal(releaseTagVersion({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}` }), version)
  assert.throws(
    () => releaseTagVersion({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `release-${version}` }),
    /invalid release tag/
  )
  assert.throws(
    () => expectedVersion({ RELEASE_VERSION: '0.0.0', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}` }, version),
    /does not match tag version/
  )
  assert.equal(verifyReleaseVersion({ environment: {}, rootDirectory: root }).verified, true)
})

test('release metadata generation rejects GITHUB_SHA values that differ from Git HEAD', () => {
  const differentCommit = gitHead === 'f'.repeat(40) ? 'e'.repeat(40) : 'f'.repeat(40)
  assert.equal(currentCommit({}), gitHead)
  assert.throws(
    () => currentCommit({ GITHUB_SHA: differentCommit }),
    /GITHUB_SHA does not match Git HEAD/,
  )
})

test('offline artifact verification rejects a manifest and evidence from an older commit', (t) => {
  const oldCommit = gitHead === 'a'.repeat(40) ? 'b'.repeat(40) : 'a'.repeat(40)
  const fixture = createReleaseFixture(t, { commit: oldCommit })
  assert.throws(
    () => verify(fixture.output, { environment: {} }),
    /release manifest commit does not match Git HEAD/,
  )
})

for (const [sbomName, packageDirectory] of releaseSbomPackages(desktopPackage.version)) {
  test(`offline artifact verification rejects an empty ${sbomName}`, (t) => {
    const fixture = createReleaseFixture(t)
    const emptySbom = completeDirectDependencySbom(packageDirectory)
    emptySbom.components = []
    emptySbom.dependencies = []
    fs.writeFileSync(path.join(fixture.output, sbomName), `${JSON.stringify(emptySbom, null, 2)}\n`)
    assert.throws(
      () => verify(fixture.output, { environment: {} }),
      /SBOM component inventory is empty/,
    )
  })
}

test('offline artifact verification rejects a numeric CycloneDX specVersion', (t) => {
  const fixture = createReleaseFixture(t)
  const sbomPath = path.join(fixture.output, 'sbom-backend.cdx.json')
  const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'))
  sbom.specVersion = 1.5
  fs.writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)
  assert.throws(
    () => verify(fixture.output, { environment: {} }),
    /CycloneDX specVersion must be a JSON string/,
  )
})

test('release verification rejects missing or failed artifact security evidence', (t) => {
  const fixture = createReleaseFixture(t)
  const securityPath = path.join(fixture.output, 'artifact-security.json')
  const evidence = JSON.parse(fs.readFileSync(securityPath, 'utf8'))
  evidence.scans.gitleaks.status = 'failed'
  fs.writeFileSync(securityPath, `${JSON.stringify(evidence, null, 2)}\n`)
  assert.throws(() => verify(fixture.output, { environment: {} }), /gitleaks artifact scan did not pass/)
})

test('offline artifact verification detects changed bytes and checksum rows', (t) => {
  const fixture = createReleaseFixture(t)
  assert.equal(verify(fixture.output, { environment: {} }).verified, true)

  assert.equal(isReleaseArtifact('rogue.zip'), true)
  fs.writeFileSync(path.join(fixture.output, 'rogue.zip'), 'not in the verified artifact set')
  assert.throws(
    () => verify(fixture.output, { environment: {} }),
    /missing, stale, or unexpected release artifacts/
  )
  fs.rmSync(path.join(fixture.output, 'rogue.zip'))
  assert.equal(verify(fixture.output, { environment: {} }).verified, true)

  const executable = path.join(fixture.output, `LocalMiniDrama-Portable-${fixture.version}-x64.exe`)
  fs.appendFileSync(executable, 'tampered')
  assert.throws(() => verify(fixture.output, { environment: {} }), /byte count does not match manifest|SHA-256 does not match/)

  fs.writeFileSync(executable, `fixture:LocalMiniDrama-Portable-${fixture.version}-x64.exe\n`)
  fs.appendFileSync(path.join(fixture.output, 'SHA256SUMS'), `${'0'.repeat(64)}  unexpected.exe\n`)
  assert.throws(() => verify(fixture.output, { environment: {} }), /SHA256SUMS does not exactly match/)
})

test('SBOM validation rejects a missing CycloneDX specVersion', (t) => {
  const fixture = createSbomFixture(t)
  delete fixture.sbom.specVersion
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /unsupported CycloneDX specVersion/,
  )
})

test('SBOM validation rejects an unsupported CycloneDX specVersion', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.specVersion = '9.9'
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /unsupported CycloneDX specVersion/,
  )
})

test('SBOM validation rejects a numeric CycloneDX specVersion', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.specVersion = 1.5
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /CycloneDX specVersion must be a JSON string/,
  )
})

for (const componentType of ['platform', 'data', 'cryptographic-asset']) {
  test(`CycloneDX 1.4 rejects component type ${componentType}`, (t) => {
    const fixture = createSbomFixture(t)
    fixture.sbom.specVersion = '1.4'
    fixture.sbom.components[0].type = componentType
    assert.throws(
      () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
      new RegExp(`type ${componentType} is not supported by CycloneDX 1\\.4`),
    )
  })
}

test('CycloneDX 1.5 rejects component type cryptographic-asset', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.specVersion = '1.5'
  fixture.sbom.components[0].type = 'cryptographic-asset'
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /type cryptographic-asset is not supported by CycloneDX 1\.5/,
  )
})

test('SBOM validation rejects a component without a type', (t) => {
  const fixture = createSbomFixture(t)
  delete fixture.sbom.components[0].type
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /component alpha@1\.4\.0 has no supported type/,
  )
})

test('SBOM validation rejects a root component name that differs from package.json', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.metadata.component.name = 'different-application'
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /root component name does not match package.json/,
  )
})

test('SBOM validation rejects a non-application root component type', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.metadata.component.type = 'library'
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /root component type must be application/,
  )
})

test('SBOM validation rejects a root component version that differs from package.json', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.metadata.component.version = '9.9.9'
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /root component version does not match package.json/,
  )
})

test('SBOM validation rejects package-lock root name drift', (t) => {
  const fixture = createSbomFixture(t)
  fixture.packageLock.packages[''].name = 'different-application'
  fs.writeFileSync(
    path.join(fixture.packageDirectory, 'package-lock.json'),
    `${JSON.stringify(fixture.packageLock, null, 2)}\n`,
  )
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /package-lock root name does not match package.json/,
  )
})

test('SBOM validation rejects package-lock root version drift', (t) => {
  const fixture = createSbomFixture(t)
  fixture.packageLock.packages[''].version = '9.9.9'
  fs.writeFileSync(
    path.join(fixture.packageDirectory, 'package-lock.json'),
    `${JSON.stringify(fixture.packageLock, null, 2)}\n`,
  )
  assert.throws(
    () => validateSbomDocument(fixture.packageDirectory, fixture.sbom),
    /package-lock root version does not match package.json/,
  )
})

test('SBOM output rejects empty generator output without creating an artifact', (t) => {
  const fixture = createSbomFixture(t)
  const outputName = 'fixture.cdx.json'
  assert.throws(
    () => writeSbomOutput(fixture.packageDirectory, outputName, '  \r\n', {
      outputDirectory: fixture.outputDirectory,
    }),
    /SBOM generation returned empty output/,
  )
  assert.equal(fs.existsSync(path.join(fixture.outputDirectory, outputName)), false)
})

test('SBOM output requires CycloneDX metadata, components, and dependencies before writing', (t) => {
  const fixture = createSbomFixture(t)
  const outputName = 'fixture.cdx.json'
  const incomplete = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    components: [],
    dependencies: [],
  }
  assert.throws(
    () => writeSbomOutput(fixture.packageDirectory, outputName, JSON.stringify(incomplete), {
      outputDirectory: fixture.outputDirectory,
    }),
    /metadata root component/,
  )
  assert.equal(fs.existsSync(path.join(fixture.outputDirectory, outputName)), false)
})

test('SBOM output rejects package and lock root dependency drift before writing', (t) => {
  const fixture = createSbomFixture(t)
  const outputName = 'fixture.cdx.json'
  delete fixture.packageLock.packages[''].devDependencies.beta
  fs.writeFileSync(
    path.join(fixture.packageDirectory, 'package-lock.json'),
    `${JSON.stringify(fixture.packageLock, null, 2)}\n`,
  )
  assert.throws(
    () => writeSbomOutput(fixture.packageDirectory, outputName, JSON.stringify(fixture.sbom), {
      outputDirectory: fixture.outputDirectory,
    }),
    /package-lock root devDependencies do not match package.json/,
  )
  assert.equal(fs.existsSync(path.join(fixture.outputDirectory, outputName)), false)
})

test('SBOM output rejects an incomplete root direct dependency graph before writing', (t) => {
  const fixture = createSbomFixture(t)
  const outputName = 'fixture.cdx.json'
  fixture.sbom.dependencies[0].dependsOn = ['alpha@1.4.0']
  assert.throws(
    () => writeSbomOutput(fixture.packageDirectory, outputName, JSON.stringify(fixture.sbom), {
      outputDirectory: fixture.outputDirectory,
    }),
    /SBOM root dependency graph is missing direct dependency beta/,
  )
  assert.equal(fs.existsSync(path.join(fixture.outputDirectory, outputName)), false)
})

test('SBOM output writes every requested artifact only after complete validation', (t) => {
  const fixture = createSbomFixture(t)
  const outputNames = ['fixture-primary.cdx.json', 'fixture-alias.cdx.json']
  const result = writeSbomOutput(
    fixture.packageDirectory,
    outputNames,
    `${JSON.stringify(fixture.sbom)}\n`,
    { outputDirectory: fixture.outputDirectory },
  )

  assert.deepEqual(result.outputNames, outputNames)
  for (const outputName of outputNames) {
    const outputPath = path.join(fixture.outputDirectory, outputName)
    assert.ok(fs.statSync(outputPath).size > 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), fixture.sbom)
  }
})

test('release SBOM generation validates every package before publishing any artifact', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-release-sboms-'))
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  fs.rmSync(outputDirectory, { recursive: true, force: true })
  const documents = Object.fromEntries(
    ['backend-node', 'frontweb', 'desktop'].map((packageDirectory) => [
      packageDirectory,
      completeDirectDependencySbom(packageDirectory),
    ]),
  )
  documents.desktop.dependencies[0].dependsOn.pop()

  assert.throws(
    () => writeReleaseSboms({
      outputDirectory,
      spawnSync: (command, args) => {
        const packageDirectory = args[args.indexOf('--prefix') + 1]
        return {
          status: 0,
          stdout: JSON.stringify(documents[packageDirectory]),
          stderr: '',
          error: null,
        }
      },
    }),
    /SBOM root dependency graph is missing direct dependency/,
  )
  assert.equal(fs.existsSync(outputDirectory), false)
})

test('release SBOM generation rejects a numeric specVersion before publishing artifacts', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-numeric-spec-sboms-'))
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  fs.rmSync(outputDirectory, { recursive: true, force: true })
  const documents = Object.fromEntries(
    ['backend-node', 'frontweb', 'desktop'].map((packageDirectory) => [
      packageDirectory,
      completeDirectDependencySbom(packageDirectory),
    ]),
  )
  documents['backend-node'].specVersion = 1.5

  assert.throws(
    () => writeReleaseSboms({
      outputDirectory,
      spawnSync: (command, args) => {
        const packageDirectory = args[args.indexOf('--prefix') + 1]
        return {
          status: 0,
          stdout: JSON.stringify(documents[packageDirectory]),
          stderr: '',
          error: null,
        }
      },
    }),
    /CycloneDX specVersion must be a JSON string/,
  )
  assert.equal(fs.existsSync(outputDirectory), false)
})

test('release SBOM generation normalizes npm-shaped roots before strict validation', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-npm-root-sboms-'))
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }))
  const documents = Object.fromEntries(
    ['backend-node', 'frontweb', 'desktop'].map((packageDirectory) => {
      const document = completeDirectDependencySbom(packageDirectory)
      document.metadata.component.name = path.basename(packageDirectory)
      document.metadata.component.type = 'library'
      return [packageDirectory, document]
    }),
  )

  writeReleaseSboms({
    outputDirectory,
    spawnSync: (command, args) => {
      const packageDirectory = args[args.indexOf('--prefix') + 1]
      return {
        status: 0,
        stdout: JSON.stringify(documents[packageDirectory]),
        stderr: '',
        error: null,
      }
    },
  })

  for (const [sbomName, packageDirectory] of releaseSbomPackages(desktopPackage.version)) {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, packageDirectory, 'package.json'), 'utf8'))
    const sbom = JSON.parse(fs.readFileSync(path.join(outputDirectory, sbomName), 'utf8'))
    assert.equal(sbom.metadata.component.name, packageJson.name)
    assert.equal(sbom.metadata.component.type, 'application')
    validateSbomDocument(packageDirectory, sbom)
  }
})

test('SBOM output canonicalizes duplicate npm refs without losing install paths', (t) => {
  const fixture = createSbomFixture(t)
  fixture.sbom.components[0].properties = [{
    name: 'cdx:npm:package:path',
    value: 'node_modules/first/node_modules/alpha',
  }]
  fixture.sbom.components[0].scope = 'required'
  fixture.sbom.components[0].externalReferences = [{
    type: 'distribution',
    url: 'https://registry.npmjs.org/alpha/-/alpha-1.4.0.tgz',
  }]
  fixture.sbom.components.push({
    ...fixture.sbom.components[0],
    scope: 'optional',
    properties: [{
      name: 'cdx:npm:package:path',
      value: 'node_modules/second/node_modules/alpha',
    }],
    externalReferences: [{
      type: 'distribution',
      url: 'https://registry.example.invalid/alpha/-/alpha-1.4.0.tgz',
    }],
  })
  fixture.sbom.dependencies.push({ ref: 'alpha@1.4.0', dependsOn: [] })
  const outputName = 'fixture.cdx.json'

  writeSbomOutput(fixture.packageDirectory, outputName, JSON.stringify(fixture.sbom), {
    outputDirectory: fixture.outputDirectory,
  })
  const written = JSON.parse(fs.readFileSync(path.join(fixture.outputDirectory, outputName), 'utf8'))
  const alphaComponents = written.components.filter((component) => component['bom-ref'] === 'alpha@1.4.0')
  const alphaDependencies = written.dependencies.filter((dependency) => dependency.ref === 'alpha@1.4.0')
  assert.equal(alphaComponents.length, 1)
  assert.equal(alphaDependencies.length, 1)
  assert.equal(alphaComponents[0].scope, 'required')
  assert.equal(alphaComponents[0].externalReferences.length, 2)
  assert.deepEqual(
    alphaComponents[0].properties.map((property) => property.value).sort(),
    [
      'node_modules/first/node_modules/alpha',
      'node_modules/second/node_modules/alpha',
    ],
  )
})
