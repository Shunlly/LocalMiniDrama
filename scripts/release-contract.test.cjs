'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
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
  MAX_ROLLBACK_RESULT_STREAM_BYTES,
  ROLLBACK_RESULT_MARKER_PREFIX,
  ROLLBACK_RESULT_SCHEMA,
  createRollbackResultMarker,
  evidenceOutputPath,
  parseDrillArguments,
  prepareEvidenceTarget,
  publishEvidence,
  serializeEvidence,
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
const rollbackPowerShellSupportScriptPath = path.join(root, 'scripts', 'rollback-powershell-support.ps1')
const rollbackEvidencePlanPath = path.join(root, 'docs', 'superpowers', 'plans', '2026-07-20-rollback-evidence-binding.md')
const quickstartPath = path.join(root, 'docs', 'quickstart.md')
const rollbackTaskFourReportPath = path.join(root, '.superpowers', 'sdd', 'rollback-security-task-4-report.md')
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
const rollbackEvidenceScript = fs.readFileSync(path.join(root, 'scripts', 'rollback-drill-evidence.cjs'), 'utf8')
const rollbackEvidencePlan = fs.readFileSync(rollbackEvidencePlanPath, 'utf8')
const quickstart = fs.readFileSync(quickstartPath, 'utf8')
const rollbackTaskFourReport = fs.readFileSync(rollbackTaskFourReportPath, 'utf8')
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
  const explicitPwsh = String(process.env.LMD_PWSH_EXE || '').trim()
  const pwsh = explicitPwsh || findPowerShell('pwsh.exe')
  assert.ok(pwsh, 'PowerShell 7 is required for Windows release security coverage')
  hosts.push({ name: 'powershell-7', executable: pwsh })
  return hosts
}

function installNativeFakeDocker(binPath, fixtureRoot) {
  const dockerPath = path.join(binPath, 'docker.exe')
  const bootstrapPath = path.join(fixtureRoot, 'native-docker-bootstrap.cjs')
  fs.copyFileSync(process.execPath, dockerPath)
  fs.writeFileSync(bootstrapPath, `
'use strict'
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const executableName = path.basename(process.execPath).toLowerCase()
if (executableName === 'docker.exe') {
  const args = process.argv.slice(1)
  if (args.length > 0) args[0] = path.basename(args[0])
  const state = process.env.LMD_BIND_STATE
    ? JSON.parse(fs.readFileSync(process.env.LMD_BIND_STATE, 'utf8'))
    : null
  const formatIndex = args.indexOf('--format')
  const format = formatIndex >= 0 ? args[formatIndex + 1] : null
  let hangEvent = null
  if (args[0] === 'exec' && state && (
    state.scenario === 'timeout' ||
    state.scenario === 'termination_helper_error' ||
    state.scenario === 'termination_helper_hang'
  )) {
    hangEvent = 'docker_exec_hang'
  } else if (args[0] === 'exec' && state && state.scenario === 'transient_timeout') {
    state.timeoutAttempts = Number(state.timeoutAttempts || 0) + 1
    fs.writeFileSync(process.env.LMD_BIND_STATE, JSON.stringify(state))
    if (state.timeoutAttempts === 1) hangEvent = 'docker_exec_hang'
  } else if (args[0] === 'inspect' && format === '{{.Id}}' && state && state.scenario === 'id_resolution_timeout') {
    hangEvent = 'docker_id_resolution_hang'
  } else if (args[0] === 'inspect' && format === '{{json .}}' && state && state.scenario === 'reinspection_timeout') {
    hangEvent = 'docker_reinspection_hang'
  }
  if (hangEvent) {
    const descendantCode = [
      "'use strict'",
      "const fs = require('node:fs')",
      "fs.appendFileSync(process.env.LMD_BIND_EVENT_LOG, JSON.stringify({ event: 'docker_hang_descendant_ready', pid: process.pid }) + '\\\\n')",
      "process.stdout.write('descendant stdout held\\\\n')",
      "process.stderr.write('descendant stderr held\\\\n')",
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)',
    ].join(';')
    const descendant = spawn(process.env.LMD_NATIVE_DOCKER_NODE, ['-e', descendantCode], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    })
    fs.appendFileSync(
      process.env.LMD_BIND_EVENT_LOG,
      JSON.stringify({
        event: hangEvent,
        tool: 'docker',
        args,
        descendantPid: descendant.pid,
        parentPid: process.pid,
        stdioInherited: true,
      }) + '\\n',
    )
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
  }
  const result = spawnSync(
    process.env.LMD_NATIVE_DOCKER_NODE,
    [process.env.LMD_NATIVE_DOCKER_TOOL, 'docker', ...args],
    { env: process.env, stdio: 'inherit', windowsHide: true },
  )
  if (result.error) {
    process.stderr.write(String(result.error.message || result.error) + '\\n')
    process.exit(70)
  }
  process.exit(result.status == null ? 71 : result.status)
}
`, 'utf8')
  return { bootstrapPath, dockerPath }
}

function nodeOptionsWithRequire(modulePath) {
  return [`--require=${modulePath}`, process.env.NODE_OPTIONS].filter(Boolean).join(' ')
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

function terminateProcessTree(pid) {
  spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  })
}

function waitForProcessExit(pid, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
  }
  return !isProcessRunning(pid)
}

function runPowerShellStatements(statements, { executable, timeout } = {}) {
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
      timeout,
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

const rollbackWorkflowSha = '0123456789abcdef0123456789abcdef01234567'

function validStandaloneRollbackSummary() {
  return {
    schema: 'localminidrama.rollback-drill.v3',
    status: 'passed',
    input_mode: 'standalone',
    executed_at: '2026-07-20T00:00:00.000Z',
    source: {
      commit: rollbackWorkflowSha,
      version: '1.3.3',
      working_tree_dirty: false,
      data_root_sha256: 'b'.repeat(64),
      database: { relative_path: 'backend-node/data/drama_generator.db' },
    },
    focused_tests: {
      file: 'backend-node/test/dataBackupService.test.js',
      passed: 2,
      total: 2,
    },
    backup: {
      format_version: 2,
      archive_bytes: 64,
      archive_retained: false,
      archive_sha256: 'a'.repeat(64),
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
}

function rollbackResultMarkerForEvidence(evidence) {
  const evidenceBytes = serializeEvidence(evidence)
  const envelope = {
    schema: ROLLBACK_RESULT_SCHEMA,
    evidence_utf8_base64url: evidenceBytes.toString('base64url'),
    evidence_sha256: crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
    diagnostic_relative_path: `artifacts/rollback-drill/summary-v3-${evidence.source.commit}-${'1'.repeat(32)}.json`,
  }
  return `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')}`
}

function validCheckpointRollbackEvidence() {
  const evidence = validStandaloneRollbackSummary()
  evidence.input_mode = 'checkpoint-bound'
  evidence.source.commit = 'c'.repeat(40)
  evidence.source.version = '1.3.3-rc.1'
  evidence.backup.archive_retained = true
  evidence.backup.excluded_values = null
  return evidence
}

function standaloneRollbackEvidenceMutations() {
  const mutations = []
  const addInvalidValues = (field, pathParts, values) => {
    for (const [name, value] of Object.entries(values)) {
      mutations.push({ field, name, pathParts, value })
    }
    mutations.push({ field, name: 'missing', pathParts, missing: true })
  }

  addInvalidValues('schema', ['schema'], {
    'old v2 schema': 'localminidrama.rollback-drill.v2',
    'case drift': 'LocalMiniDrama.rollback-drill.v3',
    null: null,
    boolean: false,
    number: 3,
    array: [],
    object: {},
  })
  addInvalidValues('status', ['status'], {
    failed: 'failed',
    'case drift': 'PASSED',
    null: null,
    boolean: true,
    number: 1,
    array: [],
    object: {},
  })
  addInvalidValues('input mode', ['input_mode'], {
    'checkpoint-bound': 'checkpoint-bound',
    'case drift': 'STANDALONE',
    null: null,
    boolean: true,
    number: 1,
    array: [],
    object: {},
  })
  addInvalidValues('archive retention', ['backup', 'archive_retained'], {
    true: true,
    'boolean string': 'false',
    null: null,
    number: 0,
    array: [],
    object: {},
  })
  addInvalidValues('archive hash', ['backup', 'archive_sha256'], {
    uppercase: 'A'.repeat(64),
    'bad length': 'a'.repeat(63),
    'non-hex': `${'a'.repeat(63)}z`,
    null: null,
    boolean: false,
    number: 64,
    array: [],
    object: {},
  })
  addInvalidValues('root digest', ['source', 'data_root_sha256'], {
    uppercase: 'B'.repeat(64),
    'bad length': 'b'.repeat(65),
    'non-hex': `${'b'.repeat(63)}z`,
    null: null,
    boolean: false,
    number: 64,
    array: [],
    object: {},
  })
  addInvalidValues('root unchanged proof', ['operations', 'source_data_root_unchanged'], {
    false: false,
    'boolean string': 'true',
    null: null,
    number: 1,
    array: [],
    object: {},
  })
  addInvalidValues('commit', ['source', 'commit'], {
    mismatch: 'f'.repeat(40),
    'case drift': rollbackWorkflowSha.toUpperCase(),
    null: null,
    boolean: false,
    number: 1,
    array: [],
    object: {},
  })
  addInvalidValues('version', ['source', 'version'], {
    mismatch: '1.3.2',
    'case drift': 'V1.3.3',
    null: null,
    boolean: false,
    number: 133,
    array: [],
    object: {},
  })
  addInvalidValues('working tree dirty', ['source', 'working_tree_dirty'], {
    true: true,
    'boolean string': 'false',
    null: null,
    number: 0,
    array: [],
    object: {},
  })
  return mutations
}

function rollbackWorkflowValidator(workflowDocument, label) {
  const rollbackJob = workflowDocument.jobs?.['rollback-drill']
  assert.ok(rollbackJob, `${label} rollback-drill job is missing`)
  assert.ok(Array.isArray(rollbackJob.steps), `${label} rollback-drill steps are missing`)
  assert.equal(rollbackJob['runs-on'], 'ubuntu-latest')

  const nodeSetupSteps = rollbackJob.steps.filter((step) =>
    String(step.uses || '').startsWith('actions/setup-node@'))
  assert.equal(nodeSetupSteps.length, 1, `${label} must have exactly one Node setup step`)
  assert.equal(nodeSetupSteps[0].with?.['node-version'], '20')
  assert.equal(
    rollbackJob.steps.filter((step) => step.run === 'npm --prefix backend-node ci').length,
    1,
    `${label} must install backend dependencies exactly once`,
  )
  const initializeSteps = rollbackJob.steps.filter((step) =>
    step.name === 'Initialize isolated rollback source')
  assert.equal(initializeSteps.length, 1, `${label} must initialize the rollback source exactly once`)
  assert.ok(
    String(initializeSteps[0].run || '').split(/\r?\n/).includes('npm --prefix backend-node run migrate'),
    `${label} must migrate the isolated rollback source`,
  )

  const validateSteps = rollbackJob.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.name === 'Run and validate rollback drill')
  const uploadSteps = rollbackJob.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.name === 'Upload rollback evidence')
  assert.equal(validateSteps.length, 1, `${label} must have exactly one rollback validation step`)
  assert.equal(uploadSteps.length, 1, `${label} must have exactly one rollback evidence upload step`)

  const [{ step: validateStep, index: validateIndex }] = validateSteps
  const [{ step: uploadStep, index: uploadIndex }] = uploadSteps
  assert.ok(validateIndex < uploadIndex, `${label} must validate rollback evidence before upload`)
  assert.equal(validateStep.shell, 'bash')

  const runScript = String(validateStep.run || '')
  const lines = runScript.split(/\r?\n/)
  assert.equal(lines[0], 'set -euo pipefail')
  assert.match(runScript, /stdout_log="\$RUNNER_TEMP\/rollback-drill\.stdout\.log"/)
  assert.match(runScript, /stderr_log="\$RUNNER_TEMP\/rollback-drill\.stderr\.log"/)
  assert.match(runScript, /mkfifo "\$stderr_pipe"/)
  assert.match(runScript, /262144/)
  assert.match(runScript, /LMD_ROLLBACK_CIDFILE/)
  assert.match(runScript, /LMD_ROLLBACK_CONTAINER_LABEL/)
  assert.match(runScript, /LMD_ROLLBACK_CONTAINER_NAME/)
  assert.match(runScript, /cleanup_rollback_container/)
  assert.match(runScript, /docker container ls --all --no-trunc --quiet --filter "label=\$LMD_ROLLBACK_CONTAINER_LABEL"/)
  assert.match(runScript, /docker container ls --all --no-trunc --quiet --filter "id=\$recorded_id"/)
  assert.match(runScript, /docker container inspect --format/)
  assert.match(runScript, /docker create --pull never/)
  assert.match(runScript, /docker stop --time 3/)
  assert.match(runScript, /docker kill/)
  assert.match(runScript, /docker rm --force/)
  assert.match(runScript, /setsid --wait timeout --signal=TERM --kill-after=30s 720s/)
  assert.match(runScript, /timeout --signal=TERM --kill-after=30s 720s\s+npm run verify:rollback\s+2>"\$stderr_pipe"/)
  assert.match(runScript, /kill -0 -- "-\$session_pid"/)
  assert.match(runScript, /kill -TERM -- "-\$session_pid"/)
  assert.match(runScript, /kill -KILL -- "-\$session_pid"/)
  assert.match(runScript, /:\s*>"\$rollback_session_file"[\s\S]{0,300}setsid --wait timeout/)
  assert.match(runScript, /kill -KILL -- "-\$session_pid"[\s\S]{0,500}while kill -0 -- "-\$session_pid"/)
  const exitCleanup = runScript.slice(runScript.indexOf('cleanup_on_exit()'), runScript.indexOf("trap cleanup_on_exit EXIT"))
  assert.ok(exitCleanup.indexOf('terminate_rollback_session') < exitCleanup.indexOf('cleanup_rollback_container'))
  assert.match(exitCleanup, /if \(\( session_status == 0 \)\); then[\s\S]*cleanup_rollback_container/)
  assert.match(exitCleanup, /rollback session cleanup failed|container cleanup failed/i)
  assert.match(
    exitCleanup,
    /if \(\( original_status == 0 && session_status == 0 && cleanup_status == 0 \)\); then\s+rm -f "\$stderr_pipe" "\$pipeline_script" "\$pipeline_status_file"\s+rmdir "\$rollback_control_dir"/,
    `${label} must retain control evidence unless execution, session, and container cleanup all succeed`,
  )
  assert.match(
    runScript,
    /if \(\( rollback_execution_normal == 1 && session_cleanup_status == 0 && container_cleanup_status == 0 \)\); then\s+rm -f "\$stderr_pipe" "\$pipeline_script" "\$pipeline_status_file"\s+rmdir "\$rollback_control_dir"/,
    `${label} must retain final control evidence unless execution and both cleanup phases succeed`,
  )
  assert.match(runScript, /daemon completion is unproven and control evidence remains/i)
  assert.match(runScript, /drill_status=124/)
  assert.match(runScript, /tee "\$stdout_log"/)
  assert.match(runScript, /node scripts\/rollback-drill-evidence\.cjs[\s\\]+--validate-result-stream/)
  assert.match(runScript, /pipeline_status=\("\$\{PIPESTATUS\[@\]\}"\)/)
  assert.match(runScript, /while \(\( written < keep\.length \)\)/)
  assert.match(runScript, /stderr_deadline=\$\(\(SECONDS \+ 5\)\)/)
  assert.match(runScript, /kill -0 "\$stderr_pid"/)
  assert.match(runScript, /kill -KILL "\$stderr_pid"/)
  assert.match(runScript, /wait "\$stderr_pid"/)
  assert.match(runScript, /stderr_status=\$\?/)
  assert.match(runScript, /stderr_status=124/)
  assert.doesNotMatch(runScript, /2>&1|summary\.json|readFileSync|Get-Content/)

  const uploadedPaths = String(uploadStep.with?.path || '').split(/\r?\n/).map((value) => value.trim())
  assert.ok(uploadedPaths.includes('${{ runner.temp }}/rollback-drill.stdout.log'))
  assert.ok(uploadedPaths.includes('${{ runner.temp }}/rollback-drill.stderr.log'))
  assert.ok(
    uploadedPaths.includes('${{ runner.temp }}/rollback-container.*'),
    `${label} must upload retained rollback control evidence`,
  )
  assert.ok(
    uploadedPaths.includes('${{ runner.temp }}/rollback-drill.pipeline.sh'),
    `${label} must upload the retained rollback pipeline`,
  )
  assert.ok(
    uploadedPaths.includes('${{ runner.temp }}/rollback-drill.pipeline.status'),
    `${label} must upload the retained rollback pipeline statuses`,
  )
  return [
    path.join(root, 'scripts', 'rollback-drill-evidence.cjs'),
    '--validate-result-stream',
    '--expected-version', '1.3.3',
    '--expected-commit', rollbackWorkflowSha,
    '--expected-mode', 'standalone',
  ]
}

function runRollbackWorkflowValidator(validatorArgs, stream) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-workflow-rollback-'))
  const evidenceDirectory = path.join(fixtureRoot, 'artifacts', 'rollback-drill')
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(evidenceDirectory, 'summary.json'),
    '{"schema":"malicious-repo-diagnostic","status":"passed"}\n',
    'utf8',
  )
  try {
    return spawnSync(process.execPath, validatorArgs, {
      cwd: fixtureRoot,
      encoding: 'utf8',
      input: stream,
      env: { ...process.env, GITHUB_SHA: rollbackWorkflowSha },
      windowsHide: true,
    })
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function assertStandaloneRollbackWorkflowContract(workflowDocument, label) {
  const validator = rollbackWorkflowValidator(workflowDocument, label)
  const validSummary = validStandaloneRollbackSummary()
  const validMarker = createRollbackResultMarker({
    evidence: validSummary,
    evidenceBytes: serializeEvidence(validSummary),
    diagnosticRelativePath: `artifacts/rollback-drill/summary-v3-${rollbackWorkflowSha}-${'1'.repeat(32)}.json`,
  }, '1.3.3')
  const validResult = runRollbackWorkflowValidator(validator, `drill log\n${validMarker}\n`)
  assert.equal(validResult.status, 0, validResult.stderr || validResult.stdout)

  for (const mutation of standaloneRollbackEvidenceMutations()) {
    const summary = validStandaloneRollbackSummary()
    const parent = mutation.pathParts.slice(0, -1).reduce((value, key) => value[key], summary)
    const property = mutation.pathParts.at(-1)
    if (mutation.missing) delete parent[property]
    else parent[property] = mutation.value
    const result = runRollbackWorkflowValidator(validator, `${rollbackResultMarkerForEvidence(summary)}\n`)
    assert.notEqual(
      result.status,
      0,
      `${label} accepted invalid ${mutation.field} (${mutation.name})`,
    )
  }

  for (const [name, stream] of [
    ['missing marker', 'drill log only\n'],
    ['duplicate marker', `${validMarker}\n${validMarker}\n`],
    ['malformed marker', `${ROLLBACK_RESULT_MARKER_PREFIX}bad=\n`],
    ['oversized stream', Buffer.alloc(MAX_ROLLBACK_RESULT_STREAM_BYTES + 1, 0x61)],
  ]) {
    const malformedResult = runRollbackWorkflowValidator(validator, stream)
    assert.notEqual(malformedResult.status, 0, `${label} accepted ${name}`)
  }
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
  assert.match(rollbackDrillScript, /createRollbackResultMarker/)
  assert.match(rollbackDrillScript, /LOCALMINIDRAMA_ROLLBACK_RESULT_V1|createRollbackResultMarker\(result/)
  assert.doesNotMatch(rollbackDrillScript, /JSON\.stringify\(\{ output:/)
  assert.match(rollbackEvidenceScript, /--validate-result-stream/)
  assert.match(rollbackEvidenceScript, /FileMode|wx\+/)
  assert.doesNotMatch(rollbackEvidenceScript, /fsp\.(?:link|rename|unlink)\(/)
  assert.match(rootPackage.scripts['test:rollback-contract'], /rollback-drill-contract\.test\.cjs/)
  const syntaxCheck = rootPackage.scripts.check.indexOf('node --check scripts/rollback-drill-contract.test.cjs')
  const contractRun = rootPackage.scripts.check.indexOf('npm run test:rollback-contract')
  assert.ok(syntaxCheck >= 0 && syntaxCheck < contractRun)
  assert.match(rootPackage.scripts.check, /npm run test:release/)
  assert.match(rootPackage.scripts.check, /npm run test:local-contract/)
  assert.match(rootPackage.scripts.check, /npm run test:openclaw-contract/)
})

test('rollback drill diagnostics are append-only and preserve every prior record', async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-evidence-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const version = '1.3.3'
  const fixedPath = evidenceOutputPath(fixtureRoot)
  const evidenceRoot = path.dirname(fixedPath)
  const legacyPath = path.join(evidenceRoot, 'legacy-v1.json')
  const fixedBytes = Buffer.from('{"schema":"untrusted-fixed-record"}\n')
  const legacyBytes = Buffer.from('{"schema":"localminidrama.rollback-drill.v1"}\n')
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.writeFileSync(fixedPath, fixedBytes)
  fs.writeFileSync(legacyPath, legacyBytes)
  assert.equal(path.relative(fixtureRoot, fixedPath).replace(/\\/g, '/'), EVIDENCE_RELATIVE_PATH)
  assert.deepEqual(parseDrillArguments([]), { inputMode: 'standalone', archivePath: null, dataRoot: null })

  await prepareEvidenceTarget(fixtureRoot, version)
  assert.deepEqual(fs.readFileSync(fixedPath), fixedBytes)
  assert.deepEqual(fs.readFileSync(legacyPath), legacyBytes)

  const evidence = validStandaloneRollbackSummary()
  assert.equal(validateEvidenceV3(evidence, version), evidence)
  const first = await publishEvidence(fixtureRoot, version, evidence)
  const second = await publishEvidence(fixtureRoot, version, evidence)
  assert.notEqual(first.diagnosticRelativePath, second.diagnosticRelativePath)
  for (const publication of [first, second]) {
    const diagnosticPath = path.join(fixtureRoot, ...publication.diagnosticRelativePath.split('/'))
    assert.deepEqual(publication.evidenceBytes, serializeEvidence(evidence))
    assert.deepEqual(fs.readFileSync(diagnosticPath), publication.evidenceBytes)
  }
  assert.deepEqual(fs.readFileSync(fixedPath), fixedBytes)
  assert.deepEqual(fs.readFileSync(legacyPath), legacyBytes)

  const wrongVersionEvidence = validStandaloneRollbackSummary()
  wrongVersionEvidence.source.version = '9.9.9'
  await assert.rejects(
    publishEvidence(fixtureRoot, version, wrongVersionEvidence),
    /does not match the prepared version/,
  )
  const concurrent = await Promise.all([
    publishEvidence(fixtureRoot, version, evidence),
    publishEvidence(fixtureRoot, version, evidence),
  ])
  assert.notEqual(concurrent[0].diagnosticRelativePath, concurrent[1].diagnosticRelativePath)
  assert.deepEqual(fs.readFileSync(fixedPath), fixedBytes)
  assert.deepEqual(fs.readFileSync(legacyPath), legacyBytes)
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

test('checkpoint result marker parser is strict and bounded on every Windows PowerShell host', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell checkpoint marker contracts require Windows')
    return
  }
  const evidence = validCheckpointRollbackEvidence()
  const result = {
    evidence,
    evidenceBytes: serializeEvidence(evidence),
    diagnosticRelativePath: `artifacts/rollback-drill/summary-v3-${evidence.source.commit}-${'1'.repeat(32)}.json`,
  }
  const marker = createRollbackResultMarker(result, evidence.source.version)
  const validEnvelope = {
    schema: ROLLBACK_RESULT_SCHEMA,
    evidence_utf8_base64url: result.evidenceBytes.toString('base64url'),
    evidence_sha256: crypto.createHash('sha256').update(result.evidenceBytes).digest('hex'),
    diagnostic_relative_path: result.diagnosticRelativePath,
  }
  const malformedJsonMarker = `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from('{', 'utf8').toString('base64url')}`
  const invalidUtf8Marker = `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from([0xff]).toString('base64url')}`
  const mistypedEnvelopeMarker = `${ROLLBACK_RESULT_MARKER_PREFIX}${Buffer.from(JSON.stringify({
    ...validEnvelope,
    evidence_sha256: 7,
  }), 'utf8').toString('base64url')}`
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
$validOutput = [System.Text.UTF8Encoding]::new($false, $true).GetBytes(('focused test log' + [char]10 + ${powerShellLiteral(marker)} + [char]10))
$parsed = @(ConvertFrom-RollbackResultOutput -Bytes $validOutput)
if ($parsed.Count -ne 1) { throw 'Marker parser emitted an invalid result count.' }
$result = $parsed[0]
if ($result.Schema -cne 'localminidrama.rollback-result.v1') { throw 'Marker parser returned the wrong schema.' }
if ($result.DiagnosticRelativePath -cne ${powerShellLiteral(result.diagnosticRelativePath)}) { throw 'Marker parser returned the wrong diagnostic path.' }
if ([Convert]::ToBase64String($result.EvidenceBytes) -cne ${powerShellLiteral(result.evidenceBytes.toString('base64'))}) { throw 'Marker parser changed authoritative evidence bytes.' }
if ($result.Evidence.source.commit -cne ('c' * 40)) { throw 'Marker parser returned the wrong evidence object.' }

function Assert-ResultRejected {
  param([object[]]$Lines, [string]$Label)
  $threw = $false
  $bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes(($Lines -join [char]10))
  try { ConvertFrom-RollbackResultOutput -Bytes $bytes | Out-Null } catch { $threw = $true }
  if (-not $threw) { throw "Invalid rollback result was accepted: $Label" }
}
Assert-ResultRejected -Lines @() -Label 'missing marker'
Assert-ResultRejected -Lines @(${powerShellLiteral(marker)}, ${powerShellLiteral(marker)}) -Label 'duplicate marker'
Assert-ResultRejected -Lines @('LOCALMINIDRAMA_ROLLBACK_RESULT_V1=bad=') -Label 'malformed base64url'
Assert-ResultRejected -Lines @(${powerShellLiteral(invalidUtf8Marker)}) -Label 'invalid envelope UTF-8'
Assert-ResultRejected -Lines @(${powerShellLiteral(malformedJsonMarker)}) -Label 'malformed envelope JSON'
Assert-ResultRejected -Lines @(${powerShellLiteral(mistypedEnvelopeMarker)}) -Label 'mistyped envelope'
Assert-ResultRejected -Lines @(('x' * (${MAX_ROLLBACK_RESULT_STREAM_BYTES} + 1))) -Label 'oversized stream'
Assert-ResultRejected -Lines @('LOCALMINIDRAMA_ROLLBACK_RESULT_V1=' + ('A' * 1048576)) -Label 'oversized marker'
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable })
  }
})

test('checkpoint summary is created and retained through one read-write authority', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell checkpoint authority contracts require Windows')
    return
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-checkpoint-summary-authority-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const summaryPath = path.join(fixtureRoot, 'rollback-drill-summary.json')
  const summaryText = '{"schema":"localminidrama.rollback-drill.v3","status":"passed"}\n'
  const summaryHash = crypto.createHash('sha256').update(summaryText, 'utf8').digest('hex')
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
$summaryBytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes(${powerShellLiteral(summaryText)})
$authority = New-RollbackFileAuthorityFromBytes -Path ${powerShellLiteral(summaryPath)} -Bytes $summaryBytes -Label 'Rollback checkpoint drill summary'
try {
  if (-not $authority.Stream.CanRead -or -not $authority.Stream.CanWrite) { throw 'Summary authority is not read-write.' }
  Assert-RollbackFileAuthority -Authority $authority | Out-Null
  if ((Get-RollbackFileAuthoritySha256 -Authority $authority) -cne ${powerShellLiteral(summaryHash)}) {
    throw 'Summary authority digest changed.'
  }
  $actual = [byte[]]::new($summaryBytes.Length)
  $authority.Stream.Position = 0
  $offset = 0
  while ($offset -lt $actual.Length) {
    $read = $authority.Stream.Read($actual, $offset, $actual.Length - $offset)
    if ($read -eq 0) { throw 'Summary authority bytes were truncated.' }
    $offset += $read
  }
  for ($index = 0; $index -lt $actual.Length; $index++) {
    if ($actual[$index] -ne $summaryBytes[$index]) { throw 'Summary authority bytes changed.' }
  }
  $writeBlocked = $false
  try {
    $writer = [System.IO.FileStream]::new(${powerShellLiteral(summaryPath)}, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    $writer.Dispose()
  } catch { $writeBlocked = $true }
  if (-not $writeBlocked) { throw 'Summary authority allowed a competing writer.' }
  $deleteBlocked = $false
  try { [System.IO.File]::Delete(${powerShellLiteral(summaryPath)}) } catch { $deleteBlocked = $true }
  if (-not $deleteBlocked) { throw 'Summary authority allowed deletion.' }
} finally {
  if ($null -ne $authority) { $authority.Stream.Dispose() }
}
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable })
    fs.rmSync(summaryPath, { force: true })
  }
})

test('checkpoint byte authority rejects existing targets and exposes no move-to-open boundary', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell checkpoint authority contracts require Windows')
    return
  }
  const helperStart = checkpointScript.indexOf('function New-RollbackFileAuthorityFromBytes')
  const helperEnd = checkpointScript.indexOf('\nfunction ConvertFrom-CanonicalRollbackBase64Url', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'checkpoint byte-authority helper is missing')
  const helperSource = checkpointScript.slice(helperStart, helperEnd)
  assert.match(helperSource, /\[System\.IO\.FileMode\]::CreateNew/)
  assert.match(helperSource, /\[System\.IO\.FileAccess\]::ReadWrite/)
  assert.match(helperSource, /\[System\.IO\.FileShare\]::Read/)
  assert.doesNotMatch(helperSource, /File\.Move|temporaryPath|Open-RollbackFileAuthority/)

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-checkpoint-existing-authority-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const targetPath = path.join(fixtureRoot, 'metadata.json')
  const sentinel = Buffer.from('pre-existing metadata\n', 'utf8')
  fs.writeFileSync(targetPath, sentinel)
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
$bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes('replacement metadata')
$rejected = $false
try {
  New-RollbackFileAuthorityFromBytes -Path ${powerShellLiteral(targetPath)} -Bytes $bytes -Label 'Rollback checkpoint metadata' | Out-Null
} catch { $rejected = $true }
if (-not $rejected) { throw 'A pre-existing metadata target was overwritten.' }
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable })
    assert.deepEqual(fs.readFileSync(targetPath), sentinel)
  }
})

test('checkpoint native reader returns bounded separate bytes and ignores stderr markers', (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell native stream contracts require Windows')
    return
  }
  const nativeStart = checkpointScript.indexOf('function Invoke-NativeCommandWithTimeout')
  const nativeEnd = checkpointScript.indexOf('\nfunction Write-NativeDiagnostic', nativeStart)
  const nativeSource = checkpointScript.slice(nativeStart, nativeEnd)
  const bridgeStart = checkpointScript.indexOf('function Initialize-NativeJobBridge')
  const bridgeEnd = checkpointScript.indexOf('\nfunction Resolve-NativeExecutablePath', bridgeStart)
  const bridgeSource = checkpointScript.slice(bridgeStart, bridgeEnd)
  assert.match(bridgeSource, /CreateProcess\(applicationName[\s\S]*CREATE_SUSPENDED/)
  assert.match(bridgeSource, /AssignProcessToJobObject/)
  assert.match(bridgeSource, /TerminateProcess/)
  assert.match(bridgeSource, /StartForAssignmentFailureTest/)
  assert.match(bridgeSource, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/)
  assert.match(bridgeSource, /TerminateJobObject/)
  assert.doesNotMatch(bridgeSource, /taskkill/i)
  assert.match(nativeSource, /catch\s*\{\s*\$primaryError\s*=\s*\$_/)
  assert.match(nativeSource, /try\s*\{[\s\S]*Stop-NativeProcessTreeBounded[\s\S]*catch\s*\{[\s\S]*\$cleanupErrors\.Add\(\$_\)/)
  assert.match(nativeSource, /try\s*\{[\s\S]*\$nativeProcess\.Dispose\(\)[\s\S]*\$cleanupErrors\.Add\(\$_\)/)
  assert.match(nativeSource, /Complete-RollbackInvocation -PrimaryError \$primaryError -CleanupErrors \$cleanupErrors/)
  const orphanPidPath = path.join(os.tmpdir(), `lmd-native-orphan-${process.pid}-${crypto.randomBytes(8).toString('hex')}.pid`)
  t.after(() => {
    try {
      const orphanPid = Number(fs.readFileSync(orphanPidPath, 'utf8'))
      if (Number.isSafeInteger(orphanPid) && orphanPid > 0) process.kill(orphanPid)
    } catch {}
    fs.rmSync(orphanPidPath, { force: true })
  })
  const orphanWriterScript = [
    "const fs=require('fs')",
    `fs.writeFileSync(${JSON.stringify(orphanPidPath)},String(process.pid))`,
    "setInterval(()=>{process.stdout.write('o');process.stderr.write('e')},25)",
  ].join(';')
  const orphanParentScript = [
    "const {spawn}=require('child_process')",
    "const fs=require('fs')",
    `const pidPath=${JSON.stringify(orphanPidPath)}`,
    `const writer=${JSON.stringify(orphanWriterScript)}`,
    'setTimeout(()=>{',
    "const child=spawn(process.execPath,['-e',writer],{detached:true,stdio:['ignore','inherit','inherit'],windowsHide:true})",
    'child.unref()',
    'const deadline=Date.now()+5000',
    'const timer=setInterval(()=>{',
    'if(fs.existsSync(pidPath)){clearInterval(timer);process.exit(0)}',
    'if(Date.now()>deadline){clearInterval(timer);process.exit(91)}',
    '},10)',
    '},250)',
  ].join(';')
  const checkpointEvidence = validStandaloneRollbackSummary()
  const stderrMarker = createRollbackResultMarker({
    evidence: checkpointEvidence,
    evidenceBytes: serializeEvidence(checkpointEvidence),
    diagnosticRelativePath: `artifacts/rollback-drill/summary-v3-${'c'.repeat(40)}-${'1'.repeat(32)}.json`,
  }, backendPackage.version)
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
$separate = Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
  '-e',
  ${powerShellLiteral(`process.stdout.write('stdout-only\\n'); process.stderr.write(${JSON.stringify(`${stderrMarker}\n`)})`)}
) -Label 'Separate native streams' -TimeoutMilliseconds 10000 -CaptureOutputBytes -MaximumOutputBytes 2097152 -MaximumErrorBytes 65536
$stdoutText = [System.Text.UTF8Encoding]::new($false, $true).GetString($separate.StandardOutputBytes)
$stderrText = [System.Text.UTF8Encoding]::new($false, $true).GetString($separate.StandardErrorBytes)
if ($stdoutText -cne ('stdout-only' + [char]10)) { throw 'Native stdout bytes changed.' }
if ($stderrText -cne ${powerShellLiteral(`${stderrMarker}\n`)}) { throw 'Native stderr bytes changed.' }
$stderrMarkerRejected = $false
try { ConvertFrom-RollbackResultOutput -Bytes $separate.StandardOutputBytes | Out-Null } catch { $stderrMarkerRejected = $true }
if (-not $stderrMarkerRejected) { throw 'A stderr-only marker was accepted.' }

$oversizedRejected = $false
try {
  Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
    '-e',
    'process.stdout.write(Buffer.alloc(2097153, 0x61)); process.stderr.write("stderr-drained")'
  ) -Label 'Oversized native stdout' -TimeoutMilliseconds 10000 -CaptureOutputBytes -MaximumOutputBytes 2097152 -MaximumErrorBytes 65536 | Out-Null
} catch {
  $oversizedRejected = $_.Exception.Message -match 'output exceeded.*2097152'
}
if (-not $oversizedRejected) { throw 'Oversized native stdout was accepted.' }

$deadlockTimedOut = $false
$deadlockStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
try {
  Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
    '-e',
    'process.stdout.write(Buffer.alloc(1048576, 0x62)); setTimeout(() => process.exit(0), 3000)'
  ) -Label 'Bidirectional native pump' -TimeoutMilliseconds 100 -CaptureOutputBytes -MaximumOutputBytes 2097152 -MaximumErrorBytes 65536 -StandardInputBytes ([byte[]]::new(2097152)) | Out-Null
} catch {
  $deadlockTimedOut = $_.Exception.Data['NativeTimedOut'] -eq $true
}
if (-not $deadlockTimedOut) { throw 'Blocking stdin bypassed the native timeout.' }
if ($deadlockStopwatch.ElapsedMilliseconds -gt 5000) { throw 'Bidirectional native timeout was not bounded.' }

$script:OriginalStopNativeProcessTreeBounded = \${function:Stop-NativeProcessTreeBounded}
$script:StreamCleanupFailure = [System.InvalidOperationException]::new('stream cleanup sentinel')
function Stop-NativeProcessTreeBounded {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]$Invocation,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )
  & $script:OriginalStopNativeProcessTreeBounded @PSBoundParameters | Out-Null
  throw $script:StreamCleanupFailure
}
$streamFailure = $null
try {
  Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
    '-e',
    'require("fs").closeSync(0); setInterval(() => {}, 1000)'
  ) -Label 'Native stdin failure' -TimeoutMilliseconds 1000 -CaptureOutputBytes -MaximumOutputBytes 65536 -MaximumErrorBytes 65536 -StandardInputBytes ([byte[]]::new(8388608)) | Out-Null
} catch { $streamFailure = $_ }
if ($null -eq $streamFailure) { throw 'Native stdin failure was not surfaced.' }
if ([object]::ReferenceEquals($streamFailure.Exception, $script:StreamCleanupFailure)) {
  throw 'Termination cleanup replaced the native stream error.'
}
$streamCleanupErrors = @($streamFailure.Exception.Data['RollbackCleanupErrors'])
if ($streamFailure.Exception.Data['NativeTimedOut'] -eq $true) {
  if ([string]$streamFailure.Exception.Data['NativeTerminationDetail'] -notmatch 'stream cleanup sentinel') {
    throw 'Timeout cleanup failure was not retained as bounded diagnostic detail.'
  }
} elseif ($streamCleanupErrors.Count -ne 1 -or -not [object]::ReferenceEquals($streamCleanupErrors[0].Exception, $script:StreamCleanupFailure)) {
  throw 'Termination cleanup was not attached to the native stream error.'
}
Set-Item -Path Function:Stop-NativeProcessTreeBounded -Value $script:OriginalStopNativeProcessTreeBounded

Remove-Item -LiteralPath ${powerShellLiteral(orphanPidPath)} -Force -ErrorAction SilentlyContinue
$orphanTimedOut = $false
try {
  Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
    '-e',
    ${powerShellLiteral(orphanParentScript)}
  ) -Label 'Exited native parent' -TimeoutMilliseconds 1000 -CaptureOutputBytes -MaximumOutputBytes 65536 -MaximumErrorBytes 65536 | Out-Null
} catch { $orphanTimedOut = $_.Exception.Data['NativeTimedOut'] -eq $true }
if (-not $orphanTimedOut) { throw 'Inherited native handles did not trigger the bounded timeout.' }
$orphanPid = [int][System.IO.File]::ReadAllText(${powerShellLiteral(orphanPidPath)})
Start-Sleep -Milliseconds 200
$orphan = Get-Process -Id $orphanPid -ErrorAction SilentlyContinue
if ($null -ne $orphan) {
  Stop-Process -Id $orphanPid -Force -ErrorAction SilentlyContinue
  throw 'Native timeout left an orphaned descendant running.'
}
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable, timeout: 30000 })
  }
})

test('checkpoint native job launcher terminates an unassigned suspended process', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows native launcher contracts require Windows')
    return
  }
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
Initialize-NativeJobBridge
$executable = Resolve-NativeExecutablePath -FilePath ${powerShellLiteral(process.execPath)}
$commandLine = ((@($executable, '-e', 'setInterval(() => {}, 1000)') | ForEach-Object {
  ConvertTo-WindowsCommandLineArgument -Argument ([string]$_)
}) -join ' ')
$failure = $null
try {
  [LocalMiniDrama.NativeJobLauncher]::StartForAssignmentFailureTest($executable, $commandLine, (Get-Location).Path) | Out-Null
} catch { $failure = $_ }
if ($null -eq $failure) { throw 'Injected Job assignment failure unexpectedly succeeded.' }
$nativeError = $failure.Exception
while ($null -ne $nativeError.InnerException -and -not $nativeError.Data.Contains('NativeProcessId')) {
  $nativeError = $nativeError.InnerException
}
$createdPid = [int]$nativeError.Data['NativeProcessId']
if ($createdPid -le 0) { throw 'Injected Job assignment failure did not report its process ID.' }
if ($nativeError.Data['NativeUnassignedProcessTerminated'] -ne $true) {
  throw 'Unassigned suspended process termination was not confirmed.'
}
Start-Sleep -Milliseconds 100
if ($null -ne (Get-Process -Id $createdPid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $createdPid -Force -ErrorAction SilentlyContinue
  throw 'Job assignment failure left a suspended process running.'
}
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable, timeout: 30000 })
  }
})

test('checkpoint native success waits until every Job Object descendant has exited', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows native launcher contracts require Windows')
    return
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-native-success-descendant-'))
  const descendantPidPath = path.join(fixtureRoot, 'descendant.pid')
  t.after(() => {
    try {
      const descendantPid = Number(fs.readFileSync(descendantPidPath, 'utf8'))
      if (Number.isSafeInteger(descendantPid) && descendantPid > 0) process.kill(descendantPid)
    } catch {}
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })
  const descendantScript = 'setTimeout(() => process.exit(0), 350)'
  const parentScript = [
    "const fs=require('node:fs')",
    "const {spawn}=require('node:child_process')",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{detached:true,stdio:'ignore',windowsHide:true})`,
    `fs.writeFileSync(${JSON.stringify(descendantPidPath)},String(child.pid))`,
    'child.unref()',
    'process.exit(0)',
  ].join(';')
  const statements = `
. ${powerShellLiteral(checkpointScriptPath)}
Initialize-NativeJobBridge
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-NativeCommandWithTimeout -FilePath ${powerShellLiteral(process.execPath)} -ArgumentList @(
  '-e',
  ${powerShellLiteral(parentScript)}
) -Label 'Successful native descendant' -TimeoutMilliseconds 5000 -CaptureOutputBytes -MaximumOutputBytes 65536 -MaximumErrorBytes 65536 | Out-Null
$stopwatch.Stop()
if ($stopwatch.ElapsedMilliseconds -lt 250) { throw 'Successful native invocation returned before its Job Object descendant exited.' }
$descendantPid = [int][System.IO.File]::ReadAllText(${powerShellLiteral(descendantPidPath)})
if ($null -ne (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $descendantPid -Force -ErrorAction SilentlyContinue
  throw 'Successful native invocation left a Job Object descendant running.'
}
`
  for (const host of windowsPowerShellHosts()) {
    fs.rmSync(descendantPidPath, { force: true })
    assertPowerShellStatements(statements, { executable: host.executable, timeout: 30000 })
  }
})

test('checkpoint native job launcher executes a renamed absolute Node binary', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows native launcher contracts require Windows')
    return
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-native-renamed-node-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const renamedNodePath = path.join(fixtureRoot, 'docker.exe')
  const probePath = path.join(fixtureRoot, 'probe.cjs')
  fs.copyFileSync(process.execPath, renamedNodePath)
  fs.writeFileSync(probePath, "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n")
  const expected = ['inspect', 'abc', '--format', '{{.Id}}']
  const statements = `
$env:PATH = ${powerShellLiteral(fixtureRoot)} + [IO.Path]::PathSeparator + $env:PATH
. ${powerShellLiteral(checkpointScriptPath)}
$actual = Invoke-NativeCommandWithTimeout -FilePath 'docker.exe' -ArgumentList @(
  ${powerShellLiteral(probePath)},
  ${expected.map((value) => powerShellLiteral(value)).join(',\n  ')}
) -Label 'Renamed Node probe' -TimeoutMilliseconds 10000 -CaptureOutput
if ($actual -cne ${powerShellLiteral(JSON.stringify(expected))}) {
  throw "Renamed Node arguments changed: $actual"
}
`
  for (const host of windowsPowerShellHosts()) {
    assertPowerShellStatements(statements, { executable: host.executable, timeout: 30000 })
  }
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

test('rollback retained file authorities block mutation and read exact bytes on every Windows host', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'file authority oracle must run under Node 20')
  const hosts = windowsPowerShellHosts()
  const overwriteProgram = "const fs=require('fs');try{fs.writeFileSync(process.argv[1],'mutated');process.exit(24)}catch{process.exit(23)}"
  const renameProgram = "const fs=require('fs');try{fs.renameSync(process.argv[1],process.argv[2]);process.exit(24)}catch{process.exit(23)}"
  const deleteProgram = "const fs=require('fs');try{fs.unlinkSync(process.argv[1]);process.exit(24)}catch{process.exit(23)}"
  const readerProgram = "const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[1]).toString('base64'))"
  const successfulOverwriteProgram = "require('fs').writeFileSync(process.argv[1],'released')"
  const successfulRenameProgram = "require('fs').renameSync(process.argv[1],process.argv[2])"
  const successfulDeleteProgram = "require('fs').unlinkSync(process.argv[1])"

  for (const host of hosts) {
    await t.test(host.name, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lmd-rollback-file-authority-${host.name}-`))
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
    const authorityPath = path.join(fixtureRoot, 'authority.txt')
    const renamedPath = path.join(fixtureRoot, 'authority-renamed.txt')
    const invalidUtf8Path = path.join(fixtureRoot, 'invalid-utf8.bin')
    const payloadText = 'authority bytes\r\nsecond line\n'
    const payload = Buffer.from(payloadText, 'utf8')
    fs.writeFileSync(authorityPath, payload)
    fs.writeFileSync(invalidUtf8Path, Buffer.from([0xc3, 0x28]))
    const stat = fs.statSync(authorityPath, { bigint: true })
    const oracleIdentity = `${stat.dev.toString(16).padStart(8, '0')}:${stat.ino.toString(16).padStart(16, '0')}`
    const expectedHash = require('node:crypto').createHash('sha256').update(payload).digest('hex')
    const statements = `
. ${powerShellLiteral(rollbackIdentityScriptPath)}
$authorityPath = ${powerShellLiteral(authorityPath)}
$renamedPath = ${powerShellLiteral(renamedPath)}
$authority = Open-RollbackFileAuthority -Path $authorityPath -Label 'Fixture authority'
try {
  $propertyNames = @($authority.PSObject.Properties.Name)
  if (($propertyNames -join ',') -cne 'Path,Label,Identity,Stream') { throw "Authority members are not exact: $($propertyNames -join ',')" }
  if ($authority.Path -cne [System.IO.Path]::GetFullPath($authorityPath)) { throw 'Authority path is not exact.' }
  if ($authority.Label -cne 'Fixture authority') { throw 'Authority label is not exact.' }
  if ($authority.Identity -cne ${powerShellLiteral(oracleIdentity)}) { throw "Authority identity mismatch: $($authority.Identity)" }
  if ($null -eq $authority.Stream -or -not $authority.Stream.CanRead) { throw 'Authority stream is not open for reading.' }
  Assert-RollbackFileAuthority -Authority $authority | Out-Null

  $authority.Stream.Position = 3
  $hash = Get-RollbackFileAuthoritySha256 -Authority $authority
  if ($hash -cne ${powerShellLiteral(expectedHash)}) { throw "Authority hash mismatch: $hash" }
  if ($authority.Stream.Position -ne 3) { throw 'Authority hashing did not restore the stream position.' }
  $text = Read-RollbackFileAuthorityUtf8 -Authority $authority
  if ($text -cne ${powerShellLiteral(payloadText)}) { throw 'Authority UTF-8 reader returned different bytes.' }
  if (-not $authority.Stream.CanRead) { throw 'Authority UTF-8 reader closed the stream.' }

  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(overwriteProgram)} $authorityPath
  if ($LASTEXITCODE -ne 23) { throw 'Separate Node overwrite was not blocked.' }
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(renameProgram)} $authorityPath $renamedPath
  if ($LASTEXITCODE -ne 23) { throw 'Separate Node rename was not blocked.' }
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(deleteProgram)} $authorityPath
  if ($LASTEXITCODE -ne 23) { throw 'Separate Node delete was not blocked.' }
  $readerOutput = & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(readerProgram)} $authorityPath
  if ($LASTEXITCODE -ne 0 -or ($readerOutput -join '') -cne ${powerShellLiteral(payload.toString('base64'))}) {
    throw 'Separate Node reader did not receive the exact retained bytes.'
  }
} finally {
  if ($null -ne $authority) { $authority.Stream.Dispose() }
}

& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(successfulOverwriteProgram)} $authorityPath
if ($LASTEXITCODE -ne 0) { throw 'Overwrite remained blocked after authority disposal.' }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(successfulRenameProgram)} $authorityPath $renamedPath
if ($LASTEXITCODE -ne 0) { throw 'Rename remained blocked after authority disposal.' }
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(successfulDeleteProgram)} $renamedPath
if ($LASTEXITCODE -ne 0) { throw 'Delete remained blocked after authority disposal.' }

$invalidAuthority = Open-RollbackFileAuthority -Path ${powerShellLiteral(invalidUtf8Path)} -Label 'Invalid UTF-8 fixture'
try {
  $invalidRejected = $false
  try { Read-RollbackFileAuthorityUtf8 -Authority $invalidAuthority | Out-Null } catch { $invalidRejected = $true }
  if (-not $invalidRejected) { throw 'Invalid UTF-8 was accepted.' }
  if (-not $invalidAuthority.Stream.CanRead) { throw 'Invalid UTF-8 handling closed the authority stream.' }
} finally {
  if ($null -ne $invalidAuthority) { $invalidAuthority.Stream.Dispose() }
}
`
    assertPowerShellStatements(statements, { executable: host.executable })
    })
  }
})

test('rollback retained directory locks are namespace-local and child authorities block replacement', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Win32 handle contracts require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'directory authority oracle must run under Node 20')
  const hosts = windowsPowerShellHosts()
  const blockedRenameProgram = "const fs=require('fs');try{fs.renameSync(process.argv[1],process.argv[2]);process.exit(24)}catch{process.exit(23)}"
  const replacementProgram = "const fs=require('fs');try{fs.renameSync(process.argv[1],process.argv[2]);fs.writeFileSync(process.argv[1],'replacement');process.exit(24)}catch{process.exit(23)}"
  const renameProgram = "require('fs').renameSync(process.argv[1],process.argv[2])"

  for (const host of hosts) {
    await t.test(host.name, () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lmd-rollback-namespace-authority-${host.name}-`))
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
    const rootPath = path.join(fixtureRoot, 'checkpoint')
    const renamedRootPath = path.join(fixtureRoot, 'checkpoint-renamed')
    const childPath = path.join(rootPath, 'metadata.json')
    const movedChildPath = path.join(rootPath, 'metadata-moved.json')
    fs.mkdirSync(rootPath)
    fs.writeFileSync(childPath, 'original metadata')
    const statements = `
. ${powerShellLiteral(rollbackIdentityScriptPath)}
$rootPath = ${powerShellLiteral(rootPath)}
$renamedRootPath = ${powerShellLiteral(renamedRootPath)}
$childPath = ${powerShellLiteral(childPath)}
$movedChildPath = ${powerShellLiteral(movedChildPath)}
$rootLock = Open-RollbackDirectoryIdentityLock -Path $rootPath -Label 'Checkpoint root'
try {
  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(blockedRenameProgram)} $rootPath $renamedRootPath
  if ($LASTEXITCODE -ne 23) { throw 'Checkpoint root rename was not blocked.' }

  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(replacementProgram)} $childPath $movedChildPath
  if ($LASTEXITCODE -ne 24) { throw 'Root lock recursively blocked an unlocked child replacement.' }
  [System.IO.File]::Delete($childPath)
  [System.IO.File]::Move($movedChildPath, $childPath)

  $childAuthority = Open-RollbackFileAuthority -Path $childPath -Label 'Checkpoint metadata'
  try {
    & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(replacementProgram)} $childPath $movedChildPath
    if ($LASTEXITCODE -ne 23) { throw 'Child replacement was not blocked by its authority.' }
    if ([System.IO.File]::ReadAllText($childPath) -cne 'original metadata') { throw 'Child authority did not retain original bytes.' }
  } finally {
    if ($null -ne $childAuthority) { $childAuthority.Stream.Dispose() }
  }

  & ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(replacementProgram)} $childPath $movedChildPath
  if ($LASTEXITCODE -ne 24) { throw 'Child replacement remained blocked after authority disposal.' }
  [System.IO.File]::Delete($childPath)
  [System.IO.File]::Move($movedChildPath, $childPath)
} finally {
  if ($null -ne $rootLock) { $rootLock.Dispose() }
}
& ${powerShellLiteral(process.execPath)} -e ${powerShellLiteral(renameProgram)} $rootPath $renamedRootPath
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint root rename remained blocked after lock disposal.' }
`
    assertPowerShellStatements(statements, { executable: host.executable })
    })
  }
})

test('rollback retained cleanup preserves the primary error and reports exhaustive cleanup failures', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('PowerShell cleanup contracts require Windows')
    return
  }
  for (const host of windowsPowerShellHosts()) {
    await t.test(host.name, () => {
    const statements = `
. ${powerShellLiteral(rollbackPowerShellSupportScriptPath)}
$events = [System.Collections.ArrayList]::new()
$cleanupErrors = [System.Collections.ArrayList]::new()
$primaryError = $null
try { throw 'distinct primary failure' } catch { $primaryError = $_ }
$actions = @(
  { [void]$events.Add('first'); throw 'first cleanup failure' },
  { [void]$events.Add('later') },
  { [void]$events.Add('last'); throw 'last cleanup failure' }
)
foreach ($action in $actions) {
  try { & $action } catch { [void]$cleanupErrors.Add($_) }
}
if (($events -join ',') -cne 'first,later,last') { throw 'A cleanup failure skipped later cleanup actions.' }
$caughtPrimary = $null
try { Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors } catch { $caughtPrimary = $_ }
if ($null -eq $caughtPrimary) { throw 'Primary failure was not rethrown.' }
if ($caughtPrimary.Exception.Message -cne 'distinct primary failure') { throw "Cleanup masked the primary message: $($caughtPrimary.Exception.Message)" }
if (-not [object]::ReferenceEquals($caughtPrimary.Exception, $primaryError.Exception)) { throw 'Cleanup replaced the primary exception authority.' }
if ($caughtPrimary.FullyQualifiedErrorId -cne $primaryError.FullyQualifiedErrorId) { throw 'Cleanup replaced the primary ErrorRecord metadata.' }
$attached = @($caughtPrimary.Exception.Data['RollbackCleanupErrors'])
if ($attached.Count -ne 2 -or
    $attached[0].Exception.Message -cne 'first cleanup failure' -or
    $attached[1].Exception.Message -cne 'last cleanup failure') {
  throw 'Cleanup details were not attached in execution order.'
}
$cleanupOnly = $null
try { Complete-RollbackInvocation -PrimaryError $null -CleanupErrors $cleanupErrors } catch { $cleanupOnly = $_ }
if ($null -eq $cleanupOnly -or
    $cleanupOnly.Exception.Message -notmatch 'first cleanup failure' -or
    $cleanupOnly.Exception.Message -notmatch 'last cleanup failure') {
  throw 'Cleanup-only invocation did not throw the cleanup failures.'
}

$nestedPrimary = $null
try { throw 'nested primary failure' } catch { $nestedPrimary = $_ }
$nestedCleanup = [System.Collections.ArrayList]::new()
try { throw 'nested cleanup failure' } catch { [void]$nestedCleanup.Add($_) }
$nestedPrimary.Exception.Data['RollbackCleanupErrors'] = [object[]]@($nestedCleanup)
$outerCleanup = [System.Collections.ArrayList]::new()
try { throw 'outer cleanup failure' } catch { [void]$outerCleanup.Add($_) }
$caughtNestedPrimary = $null
try { Complete-RollbackInvocation -PrimaryError $nestedPrimary -CleanupErrors $outerCleanup } catch { $caughtNestedPrimary = $_ }
if ($null -eq $caughtNestedPrimary -or
    -not [object]::ReferenceEquals($caughtNestedPrimary.Exception, $nestedPrimary.Exception)) {
  throw 'Nested cleanup merging replaced the primary exception.'
}
$mergedCleanup = @($caughtNestedPrimary.Exception.Data['RollbackCleanupErrors'])
if ($mergedCleanup.Count -ne 2 -or
    $mergedCleanup[0].Exception.Message -cne 'nested cleanup failure' -or
    $mergedCleanup[1].Exception.Message -cne 'outer cleanup failure') {
  throw 'Nested and outer cleanup failures were not merged in order.'
}
`
    assertPowerShellStatements(statements, { executable: host.executable })
    })
  }
})

test('rollback restore reasserts backup and config authorities at the archived Node boundary', () => {
  assert.match(
    rollbackRestoreScript,
    /Assert-RollbackFileAuthority -Authority \$backupAuthority \| Out-Null\r?\n\s*Assert-RollbackFileAuthority -Authority \$configAuthority \| Out-Null\r?\n\s*Invoke-Checked -FilePath 'npm'[^\r\n]*'restore:data'[^\r\n]*\$backupPath/,
  )
})

test('release rollback checkpoint and restore consume shared native-lock v5 interfaces', () => {
  assert.equal(fs.existsSync(rollbackIdentityScriptPath), true, 'shared rollback identity helper is missing')
  const identityScript = fs.readFileSync(rollbackIdentityScriptPath, 'utf8')
  for (const functionName of [
    'Get-RollbackPathIdentity',
    'Assert-RollbackPathIdentity',
    'Open-RollbackFileAuthority',
    'Assert-RollbackFileAuthority',
    'Get-RollbackFileAuthoritySha256',
    'Read-RollbackFileAuthorityUtf8',
    'Open-RollbackArchiveReadLock',
    'Open-RollbackDirectoryIdentityLock',
  ]) {
    assert.match(identityScript, new RegExp(`function ${functionName}`))
  }
  assert.equal(fs.existsSync(rollbackPowerShellSupportScriptPath), true, 'rollback PowerShell support helper is missing')
  const powerShellSupportScript = fs.existsSync(rollbackPowerShellSupportScriptPath)
    ? fs.readFileSync(rollbackPowerShellSupportScriptPath, 'utf8')
    : ''
  assert.match(powerShellSupportScript, /function Complete-RollbackInvocation/)
  for (const source of [checkpointScript, rollbackRestoreScript]) {
    assert.match(source, /rollback-powershell-support\.ps1/)
  }
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(checkpointScript, /data_root_sha256\s*=\s*\$validatedEvidence\.data_root_sha256/)
  assert.match(checkpointScript, /data_root_identity\s*=\s*\$validatedEvidence\.data_root_identity/)
  assert.match(
    checkpointScript,
    /run-rollback-drill\.cjs'[\s\S]*'--archive', \$backupPath,[\s\S]*'--data-root', \$runtimeDataDirectory/,
  )
  assert.match(checkpointScript, /function Assert-CheckpointDrillEvidence/)
  assert.match(checkpointScript, /function ConvertFrom-RollbackResultOutput/)
  assert.match(checkpointScript, /LOCALMINIDRAMA_ROLLBACK_RESULT_V1=/)
  assert.match(
    checkpointScript,
    /\$drillInvocation\s*=\s*Invoke-NativeCommandWithTimeout[\s\S]*-FilePath 'node'[\s\S]*run-rollback-drill\.cjs[\s\S]*-CaptureOutputBytes[\s\S]*-MaximumOutputBytes 2097152/,
  )
  assert.match(
    checkpointScript,
    /\$validatorInvocation\s*=\s*Invoke-NativeCommandWithTimeout[\s\S]*rollback-drill-evidence\.cjs[\s\S]*--validate-result-stream[\s\S]*-StandardInputBytes \$drillInvocation\.StandardOutputBytes/,
  )
  assert.match(checkpointScript, /ConvertFrom-RollbackResultOutput -Bytes \$drillInvocation\.StandardOutputBytes/)
  assert.doesNotMatch(checkpointScript, /Invoke-Checked[^\r\n]*-Label 'Rollback drill'/)
  assert.doesNotMatch(checkpointScript, /artifacts\\rollback-drill\\summary\.json/)
  assert.doesNotMatch(checkpointScript, /Get-Content[^\r\n]*rollback-drill[^\r\n]*summary/i)
  assert.match(checkpointScript, /Open-RollbackDirectoryIdentityLock/)
  assert.match(checkpointScript, /Open-RollbackArchiveReadLock/)
  assert.match(checkpointScript, /function New-RollbackFileAuthorityFromBytes/)
  assert.match(checkpointScript, /\[System\.IO\.FileMode\]::CreateNew/)
  assert.match(checkpointScript, /\[System\.IO\.FileAccess\]::ReadWrite/)
  assert.match(checkpointScript, /\[System\.IO\.FileShare\]::Read/)
  assert.match(checkpointScript, /\$summaryAuthority\s*=\s*New-RollbackFileAuthorityFromBytes -Path \$summaryArchive -Bytes \$rollbackResult\.EvidenceBytes/)
  assert.doesNotMatch(checkpointScript, /Publish-BytesAtomically -Path \$summaryArchive/)
  assert.doesNotMatch(checkpointScript, /Open-RollbackFileAuthority -Path \$summaryArchive -Label 'Rollback checkpoint drill summary'/)
  assert.match(checkpointScript, /Get-RollbackFileAuthoritySha256 -Authority \$summaryAuthority/)
  assert.doesNotMatch(checkpointScript, /\[System\.IO\.File\]::Move|File\.Move|\$temporaryPath/)
  const drillInvocation = checkpointScript.indexOf('$drillInvocation = Invoke-NativeCommandWithTimeout')
  const nodeValidation = checkpointScript.indexOf('$validatorInvocation = Invoke-NativeCommandWithTimeout')
  const powerShellParsing = checkpointScript.indexOf('ConvertFrom-RollbackResultOutput -Bytes $drillInvocation.StandardOutputBytes')
  assert.ok(drillInvocation >= 0 && drillInvocation < nodeValidation && nodeValidation < powerShellParsing)
  const summaryAuthorityOpen = checkpointScript.indexOf('$summaryAuthority = New-RollbackFileAuthorityFromBytes')
  const metadataPublication = checkpointScript.indexOf('$metadataAuthority = New-RollbackFileAuthorityFromBytes')
  const readyOutput = checkpointScript.indexOf('Write-Output "Rollback checkpoint ready: $checkpoint"')
  const metadataAuthorityDispose = checkpointScript.indexOf('if ($null -ne $metadataAuthority) { $metadataAuthority.Stream.Dispose() }')
  const summaryAuthorityDispose = checkpointScript.indexOf('if ($null -ne $summaryAuthority) { $summaryAuthority.Stream.Dispose() }')
  const checkpointLockDispose = checkpointScript.indexOf('if ($null -ne $checkpointDirectoryLock) { $checkpointDirectoryLock.Dispose() }')
  assert.ok(summaryAuthorityOpen >= 0 && summaryAuthorityOpen < metadataPublication)
  assert.ok(metadataPublication < readyOutput && readyOutput < metadataAuthorityDispose)
  assert.ok(metadataAuthorityDispose < summaryAuthorityDispose && summaryAuthorityDispose < checkpointLockDispose)
  assert.match(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v5/)
  assert.match(rollbackRestoreScript, /localminidrama\.rollback-drill\.v3/)
  assert.doesNotMatch(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v4/)
  assert.match(
    rollbackRestoreScript,
    /Open-RollbackDirectoryIdentityLock -Path \$checkpoint -Label 'Rollback checkpoint'[\s\S]*Open-RollbackDirectoryIdentityLock -Path \$configDirectory -Label 'Rollback checkpoint config directory'[\s\S]*Open-RollbackFileAuthority -Path \$metadataPath[\s\S]*Open-RollbackFileAuthority -Path \$backupPath[\s\S]*Open-RollbackFileAuthority -Path \$hashPath[\s\S]*Open-RollbackFileAuthority -Path \$composePath[\s\S]*Open-RollbackFileAuthority -Path \$configPath[\s\S]*Open-RollbackFileAuthority -Path \$dataBindSourcePath[\s\S]*Open-RollbackFileAuthority -Path \$imageArchivePath[\s\S]*Open-RollbackFileAuthority -Path \$summaryPath[\s\S]*Read-RollbackFileAuthorityUtf8/,
  )
})

test('release rollback checkpoint container bind proof is retained, exact, and ordered before artifacts', () => {
  assert.match(
    checkpointScript,
    /function Confirm-RollbackContainerBindAuthority[\s\S]*\[string\]\$ContainerId[\s\S]*\[string\]\$Destination[\s\S]*\[string\]\$HostDirectory[\s\S]*\[Microsoft\.Win32\.SafeHandles\.SafeFileHandle\]\$DirectoryHandle/,
  )
  assert.match(checkpointScript, /\.localminidrama-bind-proof-.*ToString\('N'\).*\.tmp/)
  assert.match(checkpointScript, /\[System\.IO\.FileMode\]::CreateNew/)
  assert.match(checkpointScript, /\[System\.IO\.FileShare\]::Read/)
  assert.match(checkpointScript, /\[byte\[\]\]::new\(32\)/)
  assert.match(checkpointScript, /RandomNumberGenerator/)
  assert.match(checkpointScript, /\.Flush\(\$true\)/)
  assert.match(
    checkpointScript,
    /\$dockerExecArguments\s*=\s*@\('exec', \$fullContainerId, 'node', '-e', \$reader, '--', \$containerMarkerPath, \$expectedHex\)/,
  )
  assert.match(checkpointScript, /function Invoke-NativeCommandWithTimeout/)
  assert.match(checkpointScript, /function Stop-NativeProcessTreeBounded/)
  assert.match(checkpointScript, /function Initialize-NativeJobBridge/)
  assert.match(checkpointScript, /CreateProcess\(applicationName[\s\S]*CREATE_SUSPENDED/)
  assert.match(checkpointScript, /AssignProcessToJobObject/)
  assert.match(checkpointScript, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/)
  assert.match(checkpointScript, /TerminateJobObject/)
  assert.match(checkpointScript, /QueryInformationJobObject/)
  assert.doesNotMatch(checkpointScript, /\.Result\b/)
  assert.doesNotMatch(checkpointScript, /ReadToEndAsync/)
  assert.doesNotMatch(checkpointScript, /taskkill/i)
  assert.match(checkpointScript, /NativeProcessTreeTerminated/)
  assert.match(checkpointScript, /\[byte\[\]\]::new\(\$MaximumOutputBytes\)/)
  assert.match(checkpointScript, /\[byte\[\]\]::new\(\$MaximumErrorBytes\)/)
  assert.match(checkpointScript, /\[switch\]\$CaptureOutputBytes/)
  assert.match(checkpointScript, /CreateParentReadPipe/)
  assert.match(checkpointScript, /CreateParentWritePipe/)
  assert.match(checkpointScript, /StandardOutputBytes/)
  assert.match(checkpointScript, /StandardErrorBytes/)
  assert.match(checkpointScript, /NativeExitCode/)
  assert.doesNotMatch(checkpointScript, /dockerTransportRetryExitCode/)
  assert.match(checkpointScript, /\$dockerExecTimeoutMilliseconds\s*=\s*10000/)
  assert.match(checkpointScript, /\$dockerExecMaximumAttempts\s*=\s*2/)
  assert.match(checkpointScript, /NativeTimedOut[\s\S]*NativeProcessTreeTerminated/)
  assert.match(
    checkpointScript,
    /Running container ID resolution[^\r\n]*-CaptureOutput/,
  )
  assert.match(
    checkpointScript,
    /Running container data bind reinspection[^\r\n]*-CaptureOutput/,
  )
  assert.match(
    checkpointScript,
    /Running container data bind byte proof[^\r\n]*TimeoutMilliseconds[^\r\n]*\| Out-Null/,
  )
  assert.doesNotMatch(checkpointScript, /(?:cmd|sh|bash)(?:\.exe)?\s+\/c/i)
  assert.match(checkpointScript, /Get-RollbackPathIdentity -Handle \$DirectoryHandle/)
  assert.match(checkpointScript, /Assert-RollbackPathIdentity[\s\S]*retained container bind proof/)

  const checkpointMain = checkpointScript.slice(checkpointScript.indexOf('$repoRoot ='))
  const bindCapture = checkpointMain.indexOf(
    "Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/data' -RequireReadWrite",
  )
  const lockOpen = checkpointMain.indexOf('Open-RollbackDirectoryIdentityLock -Path $runtimeDataDirectory')
  const identityCapture = checkpointMain.indexOf('Get-RollbackPathIdentity -Handle $directoryLock')
  const proof = checkpointMain.indexOf(
    "Confirm-RollbackContainerBindAuthority -ContainerId $backend.container_id -Destination '/app/data' -HostDirectory $runtimeDataDirectory -DirectoryHandle $directoryLock",
  )
  const checkpointCreation = checkpointMain.indexOf('New-Item -ItemType Directory -Path $checkpoint')
  const imageSave = checkpointMain.indexOf("@('image', 'save'")
  const shutdown = checkpointMain.indexOf("@('compose', 'down')")
  const backup = checkpointMain.indexOf("'backup:data'")
  const rollbackDrill = checkpointMain.indexOf('run-rollback-drill.cjs')
  for (const [label, index] of [
    ['bind capture', bindCapture],
    ['directory lock', lockOpen],
    ['identity capture', identityCapture],
    ['container proof', proof],
    ['checkpoint creation', checkpointCreation],
    ['image save', imageSave],
    ['shutdown', shutdown],
    ['backup', backup],
    ['rollback drill', rollbackDrill],
  ]) assert.notEqual(index, -1, `${label} is missing from checkpoint creation`)
  assert.ok(bindCapture < lockOpen)
  assert.ok(lockOpen < identityCapture)
  assert.ok(identityCapture < proof)
  for (const later of [checkpointCreation, imageSave, shutdown, backup, rollbackDrill]) assert.ok(proof < later)
  assert.doesNotMatch(rollbackRestoreScript, /Confirm-RollbackContainerBindAuthority/)
})

test('release rollback checkpoint proves the captured container sees exact locked-root bytes', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Checkpoint bind authority behavior requires Windows PowerShell')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'checkpoint bind authority must run under Node 20')
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-checkpoint-bind-proof-'))
  const binPath = path.join(fixtureRoot, 'bin')
  const eventLog = path.join(fixtureRoot, 'events.jsonl')
  const summaryPath = path.join(root, 'artifacts', 'rollback-drill', 'summary.json')
  const summaryExisted = fs.existsSync(summaryPath)
  const previousSummary = summaryExisted ? fs.readFileSync(summaryPath) : null
  fs.mkdirSync(binPath)
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  t.after(() => {
    if (summaryExisted) fs.writeFileSync(summaryPath, previousSummary)
    else fs.rmSync(summaryPath, { force: true })
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  const fakeToolPath = path.join(fixtureRoot, 'fake-bind-tool.cjs')
  fs.writeFileSync(fakeToolPath, `
'use strict'
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const tool = process.argv[2]
const args = process.argv.slice(3)
const statePath = process.env.LMD_BIND_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state))
const markers = (rootPath) => fs.existsSync(rootPath)
  ? fs.readdirSync(rootPath).filter((name) => /^\\.localminidrama-bind-proof-/.test(name))
  : []
const record = (event, extra = {}) => fs.appendFileSync(
  process.env.LMD_BIND_EVENT_LOG,
  JSON.stringify({ event, tool, args, ...extra }) + '\\n',
)
const valueAfter = (name) => args[args.indexOf(name) + 1]
const backendId = 'b'.repeat(64)
const backendShortId = backendId.slice(0, 12)
const frontendId = 'c'.repeat(64)
const capturedBackendId = state.scenario.startsWith('short_id_') ? backendShortId : backendId
const isBackendId = (value) => value === backendId || value === backendShortId
const blocked = (operation) => {
  try {
    operation()
    return false
  } catch {
    return true
  }
}
const markerSharingProbe = (markerPath) => {
  const renamedPath = markerPath + '.renamed'
  const replacementPath = markerPath + '.replacement'
  fs.writeFileSync(replacementPath, Buffer.alloc(32, 0x5a))
  const result = {
    writeBlocked: blocked(() => fs.writeFileSync(markerPath, Buffer.alloc(32, 0x41))),
    deleteBlocked: blocked(() => fs.rmSync(markerPath)),
    renameBlocked: blocked(() => fs.renameSync(markerPath, renamedPath)),
    replacementBlocked: blocked(() => fs.renameSync(replacementPath, markerPath)),
  }
  fs.rmSync(replacementPath, { force: true })
  fs.rmSync(renamedPath, { force: true })
  return result
}
const mounts = ({ reinspection = false } = {}) => {
  const dataMount = {
    Type: reinspection && state.scenario === 'reinspect_type' ? 'volume' : 'bind',
    Source: reinspection && state.scenario === 'reinspect_source' ? state.alternateRoot : state.dataRoot,
    Destination: reinspection && state.scenario === 'reinspect_destination'
      ? '/app/not-data'
      : reinspection && state.scenario === 'reinspect_destination_case'
        ? '/APP/DATA'
        : '/app/data',
    RW: !(reinspection && state.scenario === 'reinspect_read_only'),
  }
  const result = [
    dataMount,
    { Type: 'bind', Source: state.configRoot, Destination: '/app/config-source', RW: false },
  ]
  if (reinspection && state.scenario === 'reinspect_duplicate') result.push({ ...dataMount })
  return result
}

if (tool === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write(state.commit + '\\n')
  process.exit(0)
}
if (tool === 'node') {
  if (args[0] === '-p') {
    process.stdout.write(state.version + '\\n')
  } else if (path.basename(args[0]) === 'run-rollback-drill.cjs') {
    const drillResult = spawnSync(
      process.execPath,
      [__filename, 'npm', 'run', 'verify:rollback', '--', ...args.slice(1)],
      { env: process.env, stdio: 'inherit', windowsHide: true },
    )
    if (drillResult.error) process.exit(63)
    process.exit(drillResult.status == null ? 64 : drillResult.status)
  } else if (path.basename(args[0]) === 'rollback-drill-evidence.cjs') {
    const validatorResult = spawnSync(
      process.execPath,
      args,
      { env: process.env, input: fs.readFileSync(0), stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true },
    )
    if (validatorResult.error) process.exit(65)
    process.exit(validatorResult.status == null ? 66 : validatorResult.status)
  } else {
    fs.writeFileSync(args[2], 'server:\\n  port: 5679\\n')
  }
  process.exit(0)
}
if (tool === 'docker') {
  if (args[0] === 'compose' && args[1] === 'ps') {
    process.stdout.write((args[3] === 'backend' ? capturedBackendId : frontendId) + '\\n')
    process.exit(0)
  }
  if (args[0] === 'compose' && args[1] === 'config') process.exit(0)
  if (args[0] === 'compose' && args[1] === 'down') {
    record('shutdown', { markers: markers(state.dataRoot) })
    process.exit(0)
  }
  if (args[0] === 'compose' && args[1] === 'up') {
    record('recovery_up')
    process.exit(0)
  }
  if (args[0] === 'inspect') {
    const format = valueAfter('--format')
    if (format === '{{.State.Status}}') process.stdout.write('running\\n')
    else if (format.includes('.State.Health')) process.stdout.write('healthy\\n')
    else if (format === '{{.Image}}') process.stdout.write('sha256:' + (isBackendId(args[1]) ? '1' : '2').repeat(64) + '\\n')
    else if (format === '{{.Id}}') {
      const resolvedId = state.scenario === 'short_id_nonmatching' ? 'd'.repeat(64) : backendId
      record('container_id_resolution', { capturedId: args[1], resolvedId })
      if (state.scenario === 'id_resolution_output_flood') {
        record('container_id_resolution_output_flood', { bytes: 2 * 1024 * 1024 })
        const chunk = Buffer.alloc(8192, 0x78)
        for (let written = 0; written < 2 * 1024 * 1024; written += chunk.length) fs.writeSync(1, chunk)
        process.exit(0)
      }
      process.stdout.write(resolvedId + '\\n')
    }
    else if (format === '{{json .Mounts}}') {
      if (isBackendId(args[1]) && !state.initialMountReported) {
        state.initialMountReported = true
        if (state.scenario === 'swap_before_lock') {
          fs.renameSync(state.dataRoot, state.visibleRoot)
          fs.mkdirSync(state.dataRoot)
        } else {
          state.visibleRoot = state.dataRoot
        }
        saveState()
      }
      process.stdout.write(JSON.stringify(mounts()) + '\\n')
    } else if (format === '{{json .}}') {
      const id = state.scenario === 'reinspect_container' ? 'd'.repeat(64) : backendId
      record('reinspect', { id, mounts: mounts({ reinspection: true }) })
      process.stdout.write(JSON.stringify({ Id: id, Mounts: mounts({ reinspection: true }) }) + '\\n')
    } else process.exit(45)
    process.exit(0)
  }
  if (args[0] === 'image' && args[1] === 'inspect') {
    process.stdout.write(JSON.stringify({ 'org.opencontainers.image.revision': state.commit }) + '\\n')
    process.exit(0)
  }
  if (args[0] === 'exec') {
    state.execAttempts += 1
    saveState()
    const containerPath = args[6]
    const expectedHex = args[7]
    const markerPath = path.join(state.visibleRoot, path.posix.basename(containerPath || ''))
    let readerMarkerPath = markerPath
    let readerExpectedHex = expectedHex
    let temporaryReaderPath = null
    if (state.scenario === 'missing_marker' ||
        (state.scenario === 'missing_then_success' && state.execAttempts === 1)) {
      readerMarkerPath = markerPath + '.missing'
    }
    if (state.scenario === 'wrong_bytes' ||
        (state.scenario === 'mismatch_then_success' && state.execAttempts === 1)) {
      temporaryReaderPath = markerPath + '.mismatch'
      const wrongBytes = Buffer.from(fs.readFileSync(markerPath))
      wrongBytes[0] ^= 0xff
      fs.writeFileSync(temporaryReaderPath, wrongBytes)
      readerMarkerPath = temporaryReaderPath
    }
    if (state.scenario === 'malformed_expected_hex') readerExpectedHex = 'not-hex'
    if (state.scenario === 'wrong_expected_length') readerExpectedHex = expectedHex.slice(0, -2)
    const sharing = state.scenario === 'success' ? markerSharingProbe(markerPath) : null
    const readerResult = spawnSync(
      process.env.LMD_NATIVE_DOCKER_NODE,
      ['-e', args[4], '--', readerMarkerPath, readerExpectedHex],
      { encoding: 'utf8', env: process.env, windowsHide: true },
    )
    const actual = fs.existsSync(readerMarkerPath) ? fs.readFileSync(readerMarkerPath) : null
    record('docker_exec', {
      actualHex: actual ? actual.toString('hex') : null,
      containerPath,
      expectedHex,
      markerNames: markers(state.dataRoot),
      reader: args[4],
      readerArgv: [readerMarkerPath, readerExpectedHex],
      readerError: readerResult.error ? String(readerResult.error.message || readerResult.error) : null,
      readerExecuted: true,
      readerExitCode: readerResult.status,
      sharing,
    })
    if (temporaryReaderPath) fs.rmSync(temporaryReaderPath, { force: true })
    if (readerResult.error) process.exit(61)
    process.exit(readerResult.status == null ? 62 : readerResult.status)
  }
  if (args[0] === 'image' && args[1] === 'save') {
    record('image_save', { markers: markers(state.dataRoot) })
    fs.writeFileSync(valueAfter('--output'), 'fake image archive')
    process.exit(0)
  }
  if (args[0] === 'image' && args[1] === 'tag') process.exit(0)
  process.exit(48)
}
if (tool === 'npm') {
  if (args.includes('backup:data')) {
    const dataRoot = valueAfter('--data-root')
    record('backup', { markers: markers(dataRoot) })
    fs.writeFileSync(valueAfter('--output'), 'fake retained rollback archive')
    process.exit(0)
  }
  if (args[0] === 'run' && args[1] === 'verify:rollback') {
    const dataRoot = valueAfter('--data-root')
    const archivePath = valueAfter('--archive')
    record('fingerprint', { markers: markers(dataRoot) })
    const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
    const summary = {
      schema: 'localminidrama.rollback-drill.v3',
      status: 'passed',
      input_mode: 'checkpoint-bound',
      executed_at: '2026-07-20T00:00:00.000Z',
      source: {
        commit: state.commit,
        version: state.version,
        working_tree_dirty: false,
        data_root_sha256: 'd'.repeat(64),
        database: { relative_path: '[external-database]' },
      },
      focused_tests: { file: 'backend-node/test/dataBackupService.test.js', passed: 2, total: 2 },
      backup: {
        format_version: 2,
        archive_bytes: fs.statSync(archivePath).size,
        archive_sha256: archiveHash,
        archive_retained: true,
        file_count: 3,
        storage_files: 1,
        story_source_files: 1,
        active_story_source_references: 0,
        secret_policy: 'excluded',
        excluded_values: null,
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
    const evidenceBytes = Buffer.from(JSON.stringify(summary, null, 2) + '\\n', 'utf8')
    const envelope = {
      schema: 'localminidrama.rollback-result.v1',
      evidence_utf8_base64url: evidenceBytes.toString('base64url'),
      evidence_sha256: crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
      diagnostic_relative_path: 'artifacts/rollback-drill/summary-v3-' + state.commit + '-' + '1'.repeat(32) + '.json',
    }
    fs.writeFileSync(process.env.LMD_BIND_SUMMARY, '{"schema":"malicious-bind-diagnostic"}\\n')
    process.stdout.write('LOCALMINIDRAMA_ROLLBACK_RESULT_V1=' + Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url') + '\\n')
    process.exit(0)
  }
}
process.exit(49)
`, 'utf8')

  const driverPath = path.join(fixtureRoot, 'bind-proof-driver.ps1')
  fs.writeFileSync(driverPath, `
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$CheckpointDirectory)
$ErrorActionPreference = 'Stop'
$requestedCheckpointDirectory = $CheckpointDirectory
. ${powerShellLiteral(checkpointScriptPath)}
$script:OriginalInvokeChecked = \${function:Invoke-Checked}
$script:OriginalInvokeNativeCommandWithTimeout = \${function:Invoke-NativeCommandWithTimeout}
$script:OriginalStopNativeProcessTreeBounded = \${function:Stop-NativeProcessTreeBounded}
$script:OriginalClearDataSourceEnvironment = \${function:Clear-DataSourceEnvironment}
$script:OriginalClearRuntimeConfigEnvironment = \${function:Clear-RuntimeConfigEnvironment}
$script:LastProofError = $null
$script:HostIdentityReplaced = $false

function Write-BindEvent {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [hashtable]$Details = @{}
  )
  $event = [ordered]@{ event = $Name; driver = 'bind-proof' }
  foreach ($key in $Details.Keys) { $event[$key] = $Details[$key] }
  $line = ConvertTo-Json -Compress -InputObject $event
  [System.IO.File]::AppendAllText($env:LMD_BIND_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label
  )
  try {
    & $script:OriginalInvokeChecked @PSBoundParameters
  } catch {
    if ($FilePath -ceq 'docker' -and $ArgumentList.Count -gt 0 -and $ArgumentList[0] -ceq 'exec') {
      $script:LastProofError = $_
    }
    throw
  }
}

function Stop-NativeProcessTreeBounded {
  param(
    [Parameter(Mandatory = $true)]$Invocation,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )
  if ($env:LMD_TEST_TERMINATION_HELPER_ERROR -ceq 'true') {
    throw [System.IO.IOException]::new('Injected termination helper failure')
  }
  & $script:OriginalStopNativeProcessTreeBounded -Invocation $Invocation -TimeoutMilliseconds $TimeoutMilliseconds
}

function Invoke-NativeCommandWithTimeout {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds,
    [switch]$CaptureOutput,
    [switch]$CaptureOutputBytes,
    [int]$MaximumOutputBytes = 262144,
    [int]$MaximumErrorBytes = 65536,
    [AllowNull()][byte[]]$StandardInputBytes = $null,
    [int]$TerminationTimeoutMilliseconds = 2000
  )
  $forward = @{}
  foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    $forward[$entry.Key] = $entry.Value
  }
  if ($FilePath -ceq 'node') {
    $forward['FilePath'] = $env:LMD_NATIVE_DOCKER_NODE
    $forward['ArgumentList'] = @($env:LMD_FAKE_TOOL, 'node') + @($ArgumentList)
  } else {
    $forward['TimeoutMilliseconds'] = [int]$env:LMD_TEST_NATIVE_TIMEOUT_MS
    $forward['TerminationTimeoutMilliseconds'] = [int]$env:LMD_TEST_TERMINATION_TIMEOUT_MS
  }
  try {
    & $script:OriginalInvokeNativeCommandWithTimeout @forward
  } catch {
    $script:LastProofError = $_
    throw
  }
}

function Remove-Item {
  [CmdletBinding(DefaultParameterSetName = 'Path')]
  param(
    [Parameter(ParameterSetName = 'Path', Position = 0)][string[]]$Path,
    [Parameter(Mandatory = $true, ParameterSetName = 'LiteralPath')][string[]]$LiteralPath,
    [switch]$Force,
    [switch]$Recurse
  )
  $itemPaths = if ($PSCmdlet.ParameterSetName -ceq 'LiteralPath') { $LiteralPath } else { $Path }
  foreach ($itemPath in @($itemPaths)) {
    $name = [System.IO.Path]::GetFileName($itemPath)
    if ($name -match '^\\.localminidrama-bind-proof-[a-f0-9]{32}\\.tmp$' -and $env:LMD_MARKER_CLEANUP_FAILURE -ceq 'true') {
      Write-BindEvent -Name 'marker_cleanup_failed' -Details @{ marker = $name }
      throw [System.IO.IOException]::new('Injected marker cleanup failure: ' + $name)
    }
  }
  Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters
  foreach ($itemPath in @($itemPaths)) {
    $name = [System.IO.Path]::GetFileName($itemPath)
    if ($name -match '^\\.localminidrama-bind-proof-') {
      Write-BindEvent -Name 'marker_removed' -Details @{ marker = $name }
      if ($env:LMD_MARKER_CLEANUP_DETAIL -ceq 'true') {
        throw [System.IO.IOException]::new('Injected marker cleanup detail after removal: ' + $name)
      }
      if ($env:LMD_REPLACE_DATA_AFTER_PROOF -ceq 'true' -and -not $script:HostIdentityReplaced) {
        $state = Get-Content -LiteralPath $env:LMD_BIND_STATE -Raw | ConvertFrom-Json
        $originalPath = ([string]$state.dataRoot) + '.proof-original'
        try {
          [System.IO.Directory]::Move([string]$state.dataRoot, $originalPath)
          [void][System.IO.Directory]::CreateDirectory([string]$state.dataRoot)
          $script:HostIdentityReplaced = $true
          Write-BindEvent -Name 'host_identity_replaced' -Details @{
            original = $originalPath
            replacement = [string]$state.dataRoot
          }
        } catch {
          Write-BindEvent -Name 'host_identity_replacement_blocked' -Details @{
            original = [string]$state.dataRoot
            replacement = $originalPath
            message = $_.Exception.Message
          }
          throw
        }
      }
    }
  }
}

function Clear-DataSourceEnvironment {
  Write-BindEvent -Name 'cleanup:data'
  & $script:OriginalClearDataSourceEnvironment
}
function Clear-RuntimeConfigEnvironment {
  Write-BindEvent -Name 'cleanup:config'
  & $script:OriginalClearRuntimeConfigEnvironment
}
function Pop-Location {
  Write-BindEvent -Name 'cleanup:location'
  Microsoft.PowerShell.Management\\Pop-Location
}

try {
  Invoke-ReleaseRollbackCheckpoint -CheckpointDirectory $requestedCheckpointDirectory
} catch {
  $cleanupDetails = @()
  $attachedCleanupErrors = $_.Exception.Data['RollbackCleanupErrors']
  if ($null -ne $attachedCleanupErrors) {
    $cleanupDetails = @($attachedCleanupErrors) | ForEach-Object { $_.Exception.Message }
  }
  $sameProofException = $false
  if ($null -ne $script:LastProofError) {
    $sameProofException = [object]::ReferenceEquals($_.Exception, $script:LastProofError.Exception)
  }
  Write-BindEvent -Name 'driver_failure' -Details @{
    cleanup_errors = @($cleanupDetails)
    native_timed_out = $_.Exception.Data['NativeTimedOut']
    process_tree_terminated = $_.Exception.Data['NativeProcessTreeTerminated']
    primary_error_id = $_.FullyQualifiedErrorId
    primary_message = $_.Exception.Message
    same_proof_exception = $sameProofException
    termination_detail = $_.Exception.Data['NativeTerminationDetail']
  }
  throw
}
`, 'utf8')

  const nativeDocker = installNativeFakeDocker(binPath, fixtureRoot)
  for (const tool of ['git', 'npm', 'node']) {
    fs.writeFileSync(
      path.join(binPath, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fakeToolPath}" ${tool} %*\r\n`,
      'utf8',
    )
  }

  const commit = 'a'.repeat(40)
  const version = backendPackage.version
  let scenarioSequence = 0
  const runScenario = (host, scenario, {
    cleanupDetail = false,
    cleanupFailure = false,
    nativeTimeout = 1000,
    terminationTimeout = 1000,
    timeout = 30000,
  } = {}) => {
    scenarioSequence += 1
    const scenarioRoot = path.join(fixtureRoot, `${host.name}-${scenario}-${scenarioSequence}`)
    const dataRoot = path.join(scenarioRoot, 'data')
    const visibleRoot = path.join(scenarioRoot, 'container-visible-data')
    const alternateRoot = path.join(scenarioRoot, 'alternate-data')
    const configRoot = path.join(scenarioRoot, 'config')
    const checkpointPath = path.join(scenarioRoot, 'checkpoint')
    const statePath = path.join(scenarioRoot, 'state.json')
    fs.mkdirSync(dataRoot, { recursive: true })
    fs.mkdirSync(alternateRoot)
    fs.mkdirSync(configRoot)
    fs.writeFileSync(path.join(configRoot, 'config.yaml'), 'server:\n  port: 5679\n')
    fs.writeFileSync(statePath, JSON.stringify({
      alternateRoot,
      commit,
      configRoot,
      dataRoot,
      execAttempts: 0,
      initialMountReported: false,
      scenario,
      timeoutAttempts: 0,
      version,
      visibleRoot,
    }))
    const eventStart = fs.existsSync(eventLog)
      ? fs.readFileSync(eventLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).length
      : 0
    const startedAt = Date.now()
    const result = spawnSync(host.executable, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      driverPath,
      '-CheckpointDirectory',
      checkpointPath,
    ], {
      cwd: root,
      encoding: 'utf8',
      stdio: scenario === 'termination_helper_error' ? 'ignore' : 'pipe',
      timeout,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${binPath};${process.env.PATH}`,
        LMD_BIND_EVENT_LOG: eventLog,
        LMD_BIND_STATE: statePath,
        LMD_BIND_SUMMARY: summaryPath,
        LMD_FAKE_TOOL: fakeToolPath,
        LMD_MARKER_CLEANUP_DETAIL: String(cleanupDetail),
        LMD_MARKER_CLEANUP_FAILURE: String(cleanupFailure),
        LMD_NATIVE_DOCKER_NODE: process.execPath,
        LMD_NATIVE_DOCKER_TOOL: fakeToolPath,
        LMD_REPLACE_DATA_AFTER_PROOF: String(scenario === 'replace_identity_after_proof'),
        LMD_TEST_NATIVE_TIMEOUT_MS: String(nativeTimeout),
        LMD_TEST_TERMINATION_HELPER_ERROR: String(scenario === 'termination_helper_error'),
        LMD_TEST_TERMINATION_TIMEOUT_MS: String(terminationTimeout),
        NODE_OPTIONS: nodeOptionsWithRequire(nativeDocker.bootstrapPath),
      },
    })
    const events = fs.existsSync(eventLog)
      ? fs.readFileSync(eventLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).slice(eventStart)
      : []
    return {
      alternateRoot,
      checkpointPath,
      dataRoot,
      durationMs: Date.now() - startedAt,
      events,
      result,
      visibleRoot: JSON.parse(fs.readFileSync(statePath, 'utf8')).visibleRoot,
    }
  }

  const markerNames = (rootPath) => fs.existsSync(rootPath)
    ? fs.readdirSync(rootPath).filter((name) => /^\.localminidrama-bind-proof-/.test(name))
    : []
  const assertNoLateOperations = (run) => {
    const eventNames = run.events.map((event) => event.event)
    for (const forbidden of ['image_save', 'shutdown', 'backup', 'fingerprint', 'recovery_up']) {
      assert.equal(eventNames.includes(forbidden), false, `${forbidden} ran after bind proof rejection`)
    }
    assert.equal(fs.existsSync(run.checkpointPath), false, 'checkpoint directory was created before bind proof completed')
  }
  const assertMarkerRemoved = (run) => {
    assert.deepEqual(markerNames(run.dataRoot), [])
    assert.deepEqual(markerNames(run.visibleRoot), [])
  }
  const assertOuterCleanupRan = (run) => {
    const eventNames = run.events.map((event) => event.event)
    const dataCleanup = eventNames.indexOf('cleanup:data')
    const configCleanup = eventNames.indexOf('cleanup:config')
    const locationCleanup = eventNames.indexOf('cleanup:location')
    assert.ok(dataCleanup >= 0 && dataCleanup < configCleanup)
    assert.ok(configCleanup < locationCleanup)
  }

  for (const host of windowsPowerShellHosts()) {
    await t.test(host.name, async (t) => {
      await t.test('rejects a source swapped after inspect while the container retains the original source', () => {
        const run = runScenario(host, 'swap_before_lock')
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertNoLateOperations(run)
        assertMarkerRemoved(run)
        const execs = run.events.filter((event) => event.event === 'docker_exec')
        assert.ok(
          execs.length >= 1 && execs.length <= 3,
          `container proof retry count was not short and bounded; events=${JSON.stringify(run.events)}; stderr=${run.result.stderr}; stdout=${run.result.stdout}`,
        )
        assert.ok(execs.every((event) => event.actualHex === null))
      })

      for (const scenario of ['missing_marker', 'wrong_bytes']) {
        await t.test(`rejects ${scenario.replace('_', ' ')}, removes the marker, and leaves deployment running`, () => {
          const run = runScenario(host, scenario)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assertNoLateOperations(run)
          assertMarkerRemoved(run)
          const execs = run.events.filter((event) => event.event === 'docker_exec')
          assert.equal(execs.length, 1, `reader-confirmed rejection was retried; events=${JSON.stringify(run.events)}`)
          const first = execs[0]
          assert.match(first.containerPath, /^\/app\/data\/\.localminidrama-bind-proof-[a-f0-9]{32}\.tmp$/)
          if (scenario === 'missing_marker') assert.equal(first.actualHex, null)
          else assert.notEqual(first.actualHex, first.expectedHex)
        })
      }

      for (const [scenario, expectedReaderExit] of [
        ['missing_then_success', 53],
        ['mismatch_then_success', 56],
        ['malformed_expected_hex', 51],
        ['wrong_expected_length', 52],
      ]) {
        await t.test(`never hides ${scenario.replaceAll('_', ' ')} with a later success`, () => {
          const run = runScenario(host, scenario)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assertNoLateOperations(run)
          assertMarkerRemoved(run)
          const execs = run.events.filter((event) => event.event === 'docker_exec')
          assert.equal(execs.length, 1, `reader failure was retried; events=${JSON.stringify(run.events)}`)
          assert.equal(execs[0].readerExecuted, true)
          assert.equal(execs[0].readerExitCode, expectedReaderExit)
        })
      }

      for (const scenario of [
        'reinspect_source',
        'reinspect_destination',
        'reinspect_destination_case',
        'reinspect_read_only',
        'reinspect_duplicate',
        'reinspect_type',
        'reinspect_container',
      ]) {
        await t.test(`rejects ${scenario.replaceAll('_', ' ')} before shutdown`, () => {
          const run = runScenario(host, scenario)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assertNoLateOperations(run)
          assertMarkerRemoved(run)
          assert.equal(
            run.events.filter((event) => event.event === 'docker_exec').length,
            1,
            `container proof did not reach reinspection; events=${JSON.stringify(run.events)}; stderr=${run.result.stderr}; stdout=${run.result.stdout}`,
          )
          assert.equal(run.events.filter((event) => event.event === 'reinspect').length, 1)
        })
      }

      await t.test('accepts a matching short captured ID only after resolving its full Docker ID', () => {
        const run = runScenario(host, 'short_id_matching')
        assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout)
        const resolution = run.events.find((event) => event.event === 'container_id_resolution')
        assert.ok(resolution)
        assert.equal(resolution.capturedId, 'b'.repeat(12))
        assert.equal(resolution.resolvedId, 'b'.repeat(64))
        const execs = run.events.filter((event) => event.event === 'docker_exec')
        assert.equal(execs.length, 1)
        assert.equal(execs[0].args[1], 'b'.repeat(64))
        assertMarkerRemoved(run)
      })

      await t.test('rejects a short captured ID that resolves to a nonmatching full Docker ID', () => {
        const run = runScenario(host, 'short_id_nonmatching')
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertNoLateOperations(run)
        assert.equal(run.events.filter((event) => event.event === 'docker_exec').length, 0)
      })

      await t.test('rejects an attempted same-text host directory identity replacement after byte proof', () => {
        const run = runScenario(host, 'replace_identity_after_proof')
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertNoLateOperations(run)
        assert.equal(run.events.filter((event) => event.event === 'docker_exec').length, 1)
        assert.equal(run.events.filter((event) => event.event === 'host_identity_replaced').length, 0)
        assert.equal(run.events.filter((event) => event.event === 'host_identity_replacement_blocked').length, 1)
        assert.match(run.result.stderr, /Rollback cleanup failed:/i)
      })

      await t.test('uses one unpredictable exact marker across one confirmed timeout retry', () => {
        const firstRun = runScenario(host, 'transient_timeout', { timeout: 7000 })
        const hang = firstRun.events.find((event) => event.event === 'docker_exec_hang')
        const leaked = hang ? [hang.parentPid, hang.descendantPid].filter(isProcessRunning) : []
        if (hang && isProcessRunning(hang.parentPid)) terminateProcessTree(hang.parentPid)
        assert.equal(firstRun.result.status, 0, firstRun.result.stderr || firstRun.result.stdout)
        const firstExecs = firstRun.events.filter((event) => event.event === 'docker_exec')
        assert.equal(firstExecs.length, 1, 'confirmed timeout was not retried exactly once')
        const [successfulExec] = firstExecs
        assert.ok(hang)
        assert.equal(hang.args[0], 'exec')
        assert.equal(hang.args[1], 'b'.repeat(64))
        assert.equal(hang.args[2], 'node')
        assert.equal(hang.args[3], '-e')
        assert.equal(hang.args[5], '--')
        assert.deepEqual(hang.args, successfulExec.args)
        assert.equal(hang.stdioInherited, true)
        assert.deepEqual(leaked, [])
        assert.equal(waitForProcessExit(hang.parentPid), true)
        assert.equal(waitForProcessExit(hang.descendantPid), true)
        assert.match(successfulExec.containerPath, /^\/app\/data\/\.localminidrama-bind-proof-[a-f0-9]{32}\.tmp$/)
        assert.match(successfulExec.expectedHex, /^[a-f0-9]{64}$/)
        assert.equal(successfulExec.readerExecuted, true)
        assert.equal(successfulExec.readerExitCode, 0)
        assert.equal(successfulExec.actualHex, successfulExec.expectedHex)
        assert.match(successfulExec.reader, /readFileSync/)
        assert.match(successfulExec.reader, /Buffer\.from/)
        assert.match(successfulExec.reader, /\.equals/)
        assert.equal(successfulExec.args.some((arg) => /^(?:sh|bash|cmd|powershell)(?:\.exe)?$/i.test(arg)), false)
        for (const event of firstRun.events.filter((entry) => ['image_save', 'shutdown', 'backup', 'fingerprint'].includes(entry.event))) {
          assert.deepEqual(event.markers, [], `marker reached ${event.event} input`)
        }
        assertMarkerRemoved(firstRun)
        const checkpointNames = fs.readdirSync(firstRun.checkpointPath, { recursive: true })
        assert.equal(checkpointNames.some((name) => /^\.localminidrama-bind-proof-/.test(path.basename(name))), false)

        const secondRun = runScenario(host, 'success')
        assert.equal(secondRun.result.status, 0, secondRun.result.stderr || secondRun.result.stdout)
        const repeatedExec = secondRun.events.find((event) => event.event === 'docker_exec')
        assert.notEqual(repeatedExec.containerPath, successfulExec.containerPath, 'marker basename was reused across invocations')
        assert.notEqual(repeatedExec.expectedHex, successfulExec.expectedHex, 'marker token was reused across invocations')
        assert.equal(repeatedExec.reader, successfulExec.reader, 'container reader must remain fixed')
        assertMarkerRemoved(secondRun)
      })

      await t.test('executes the exact reader argv and enforces Windows marker sharing from another process', () => {
        const run = runScenario(host, 'success')
        assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout)
        const proof = run.events.find((event) => event.event === 'docker_exec')
        assert.ok(proof)
        assert.equal(proof.readerExecuted, true)
        assert.equal(proof.readerExitCode, 0)
        assert.equal(proof.reader, proof.args[4])
        assert.equal(proof.readerArgv[1], proof.expectedHex)
        assert.equal(path.basename(proof.readerArgv[0]), path.posix.basename(proof.containerPath))
        assert.deepEqual(proof.sharing, {
          writeBlocked: true,
          deleteBlocked: true,
          renameBlocked: true,
          replacementBlocked: true,
        })
        assert.equal(proof.actualHex, proof.expectedHex)
        assertMarkerRemoved(run)
      })

      await t.test('times out both exec attempts, kills both process trees, and retains cleanup detail', () => {
        const run = runScenario(host, 'timeout', { cleanupDetail: true, timeout: 10000 })
        const hangs = run.events.filter((event) => event.event === 'docker_exec_hang')
        const leaked = hangs.flatMap((event) => [event.parentPid, event.descendantPid]).filter(isProcessRunning)
        for (const event of hangs) {
          if (isProcessRunning(event.parentPid)) terminateProcessTree(event.parentPid)
        }
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assert.equal(run.result.signal, null, 'outer test timeout fired instead of the production timeout')
        assert.ok(run.durationMs < 10000, `production timeout was not bounded: ${run.durationMs}ms`)
        assert.equal(hangs.length, 2, `timeout-only retry count was not one; events=${JSON.stringify(run.events)}`)
        assert.deepEqual(leaked, [], `timed-out process tree leaked PIDs: ${leaked.join(', ')}`)
        assert.ok(hangs.every((event) => event.stdioInherited === true))
        assert.match(run.result.stderr, /timed out after \d+ milliseconds/i)
        assertNoLateOperations(run)
        assertOuterCleanupRan(run)
        assertMarkerRemoved(run)
        const failure = run.events.find((event) => event.event === 'driver_failure')
        assert.ok(failure)
        assert.equal(failure.native_timed_out, true)
        assert.equal(failure.process_tree_terminated, true)
        assert.equal(failure.same_proof_exception, true)
        assert.match(failure.primary_message, /timed out after \d+ milliseconds/i)
        assert.equal(failure.cleanup_errors.length, 1)
        assert.match(failure.cleanup_errors[0], /Injected marker cleanup detail after removal/)
      })

      for (const [scenario, hangEvent] of [
        ['id_resolution_timeout', 'docker_id_resolution_hang'],
        ['reinspection_timeout', 'docker_reinspection_hang'],
      ]) {
        await t.test(`bounds and cleans up ${scenario.replaceAll('_', ' ')}`, () => {
          const run = runScenario(host, scenario, { timeout: 7000 })
          const hang = run.events.find((event) => event.event === hangEvent)
          assert.ok(hang, `bounded inspect hang was not reached; events=${JSON.stringify(run.events)}`)
          const leaked = [hang.parentPid, hang.descendantPid].filter(isProcessRunning)
          if (isProcessRunning(hang.parentPid)) terminateProcessTree(hang.parentPid)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assert.equal(run.result.signal, null)
          assert.ok(run.durationMs < 7000, `${scenario} exceeded its outer bound: ${run.durationMs}ms`)
          assert.deepEqual(leaked, [], `${scenario} leaked PIDs: ${leaked.join(', ')}`)
          assert.match(run.result.stderr, /timed out after \d+ milliseconds/i)
          assertNoLateOperations(run)
          assertOuterCleanupRan(run)
          assertMarkerRemoved(run)
          if (scenario === 'id_resolution_timeout') {
            assert.equal(run.events.filter((event) => event.event === 'docker_exec').length, 0)
          } else {
            assert.equal(run.events.filter((event) => event.event === 'docker_exec').length, 1)
          }
        })
      }

      await t.test('bounds inspect output in memory and fails closed on overflow', () => {
        const run = runScenario(host, 'id_resolution_output_flood', { nativeTimeout: 5000, timeout: 10000 })
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assert.equal(run.result.signal, null)
        assert.ok(run.durationMs < 10000, `output flood exceeded its outer bound: ${run.durationMs}ms`)
        assert.ok(run.events.some((event) => event.event === 'container_id_resolution_output_flood'))
        assert.match(run.result.stderr, /output exceeded the 262144-byte bound/i)
        assert.ok(Buffer.byteLength(run.result.stderr || '') < 65536, 'bounded diagnostic expanded unexpectedly')
        assertNoLateOperations(run)
        assertOuterCleanupRan(run)
        assertMarkerRemoved(run)
      })

      await t.test('confirms Job Object termination for a detached tree', () => {
        const run = runScenario(host, 'termination_helper_hang', { timeout: 7000 })
        const hang = run.events.find((event) => event.event === 'docker_exec_hang')
        const dockerWasRunning = hang ? isProcessRunning(hang.parentPid) : false
        const descendantWasRunning = hang ? isProcessRunning(hang.descendantPid) : false
        try {
          assert.ok(hang)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assert.equal(run.result.signal, null)
          assert.ok(run.durationMs < 7000, `Job termination was not bounded: ${run.durationMs}ms`)
          assert.equal(dockerWasRunning, false, 'Job Object left the timed-out parent running')
          assert.equal(descendantWasRunning, false, 'Job Object left the detached descendant running')
          assertNoLateOperations(run)
          assertOuterCleanupRan(run)
          assertMarkerRemoved(run)
          const failure = run.events.find((event) => event.event === 'driver_failure')
          assert.ok(failure)
          assert.equal(failure.native_timed_out, true)
          assert.equal(failure.process_tree_terminated, true)
          assert.match(failure.primary_message, /timed out after \d+ milliseconds/i)
          assert.match(failure.termination_detail, /Job terminated and has no active processes/i)
        } finally {
          if (hang && isProcessRunning(hang.parentPid)) terminateProcessTree(hang.parentPid)
          if (hang) {
            waitForProcessExit(hang.parentPid)
            waitForProcessExit(hang.descendantPid)
          }
        }
      })

      await t.test('retains timeout and job-close containment when the termination helper throws', () => {
        const run = runScenario(host, 'termination_helper_error', { cleanupDetail: true, timeout: 7000 })
        const hang = run.events.find((event) => event.event === 'docker_exec_hang')
        const dockerWasRunning = hang ? isProcessRunning(hang.parentPid) : false
        const descendantWasRunning = hang ? isProcessRunning(hang.descendantPid) : false
        try {
          assert.ok(hang)
          assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
          assert.equal(run.result.signal, null)
          assert.ok(run.durationMs < 7000, `termination helper failure was not bounded: ${run.durationMs}ms`)
          assert.equal(dockerWasRunning, false, 'Job close left the parent running after helper failure')
          assert.equal(descendantWasRunning, false, 'Job close left the detached descendant running after helper failure')
          assertNoLateOperations(run)
          assertOuterCleanupRan(run)
          assertMarkerRemoved(run)
          const failure = run.events.find((event) => event.event === 'driver_failure')
          assert.ok(failure)
          assert.equal(failure.native_timed_out, true)
          assert.equal(failure.process_tree_terminated, false)
          assert.equal(failure.same_proof_exception, true)
          assert.match(failure.primary_message, /timed out after \d+ milliseconds/i)
          assert.match(failure.termination_detail, /termination helper failed: Injected termination helper failure/i)
          assert.equal(failure.cleanup_errors.length, 1)
          assert.match(failure.cleanup_errors[0], /Injected marker cleanup detail after removal/)
        } finally {
          if (hang && isProcessRunning(hang.parentPid)) terminateProcessTree(hang.parentPid)
          if (hang) {
            waitForProcessExit(hang.parentPid)
            waitForProcessExit(hang.descendantPid)
          }
        }
      })

      await t.test('surfaces marker cleanup failure and still runs every outer cleanup', () => {
        const run = runScenario(host, 'success', { cleanupFailure: true })
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertNoLateOperations(run)
        assertOuterCleanupRan(run)
        const failure = run.events.find((event) => event.event === 'driver_failure')
        assert.ok(failure)
        assert.match(failure.primary_message, /Rollback cleanup failed: Injected marker cleanup failure/)
        assert.equal(failure.same_proof_exception, false)
        assert.equal(failure.cleanup_errors.length, 1)
        assert.match(failure.cleanup_errors[0], /Injected marker cleanup failure/)
        assert.equal(markerNames(run.dataRoot).length, 1)
      })

      await t.test('retains container read failure over marker cleanup failure and attaches cleanup detail', () => {
        const run = runScenario(host, 'wrong_bytes', { cleanupFailure: true })
        assert.notEqual(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertNoLateOperations(run)
        assertOuterCleanupRan(run)
        const failure = run.events.find((event) => event.event === 'driver_failure')
        assert.ok(failure)
        assert.match(failure.primary_message, /container data bind byte proof failed with exit code 56/i)
        assert.doesNotMatch(failure.primary_message, /^Rollback cleanup failed:/)
        assert.equal(failure.same_proof_exception, true)
        assert.equal(failure.cleanup_errors.length, 1)
        assert.match(failure.cleanup_errors[0], /Injected marker cleanup failure/)
        assert.equal(markerNames(run.dataRoot).length, 1)
      })
    })
  }
})

test('release rollback checkpoint fake toolchain retains locks through v5 metadata publication and failure recovery', async (t) => {
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
const { spawnSync } = require('node:child_process')
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
const dockerMounts = [
  { Type: 'bind', Source: dataRoot, Destination: '/app/data', RW: true },
  { Type: 'bind', Source: configRoot, Destination: '/app/config-source', RW: false },
]
record(tool)
if (tool === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write(commit + '\\n')
  process.exit(0)
}
if (tool === 'node') {
  if (args[0] === '-p') {
    record('version')
    process.stdout.write(version + '\\n')
  } else if (path.basename(args[0]) === 'run-rollback-drill.cjs') {
    const drillResult = spawnSync(
      process.execPath,
      [__filename, 'npm', 'run', 'verify:rollback', '--', ...args.slice(1)],
      { env: process.env, stdio: 'inherit', windowsHide: true },
    )
    if (drillResult.error) process.exit(41)
    process.exit(drillResult.status == null ? 42 : drillResult.status)
  } else if (path.basename(args[0]) === 'rollback-drill-evidence.cjs') {
    record('node_validator')
    const validatorResult = spawnSync(
      process.execPath,
      args,
      { env: process.env, input: fs.readFileSync(0), stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true },
    )
    if (validatorResult.error) process.exit(43)
    process.exit(validatorResult.status == null ? 44 : validatorResult.status)
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
  } else if (args[0] === 'compose' && args[1] === 'up') {
    record('recovery_up')
  } else if (args[0] === 'inspect') {
    const format = valueAfter('--format')
    if (format === '{{json .Mounts}}') {
      process.stdout.write(JSON.stringify(dockerMounts) + '\\n')
    } else if (format === '{{.Id}}') {
      process.stdout.write(args[1] + '\\n')
    } else if (format === '{{json .}}') {
      process.stdout.write(JSON.stringify({ Id: args[1], Mounts: dockerMounts }) + '\\n')
    } else if (format === '{{.State.Status}}') process.stdout.write('running\\n')
    else if (format.includes('.State.Health')) process.stdout.write('healthy\\n')
    else if (format === '{{.Image}}') process.stdout.write('sha256:' + (args[1][0] === 'b' ? '1' : '2').repeat(64) + '\\n')
  } else if (args[0] === 'exec') {
    const markerPath = path.join(dataRoot, path.posix.basename(args[6]))
    const actualHex = fs.existsSync(markerPath) ? fs.readFileSync(markerPath).toString('hex') : null
    const readerResult = spawnSync(
      process.env.LMD_NATIVE_DOCKER_NODE,
      ['-e', args[4], '--', markerPath, args[7]],
      { encoding: 'utf8', env: process.env, windowsHide: true },
    )
    record('bind_proof', {
      actualHex,
      expectedHex: args[7],
      reader: args[4],
      readerArgv: [markerPath, args[7]],
      readerExitCode: readerResult.status,
    })
    if (readerResult.error) process.exit(30)
    process.exit(readerResult.status == null ? 30 : readerResult.status)
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
      executed_at: '2026-07-20T00:00:00.000Z',
      source: {
        commit,
        version,
        working_tree_dirty: false,
        data_root_sha256: 'd'.repeat(64),
        database: { relative_path: '[external-database]' },
      },
      focused_tests: {
        file: 'backend-node/test/dataBackupService.test.js',
        passed: 2,
        total: 2,
      },
      backup: {
        format_version: 2,
        archive_bytes: fs.statSync(archivePath).size,
        archive_sha256: archiveHash,
        archive_retained: true,
        file_count: 3,
        storage_files: 1,
        story_source_files: 1,
        active_story_source_references: 0,
        secret_policy: 'excluded',
        excluded_values: null,
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
    if (process.env.LMD_MARKER_MODE === 'extra-evidence') summary.unexpected = true
    const evidenceBytes = Buffer.from(JSON.stringify(summary, null, 2) + '\\n', 'utf8')
    const envelope = {
      schema: 'localminidrama.rollback-result.v1',
      evidence_utf8_base64url: evidenceBytes.toString('base64url'),
      evidence_sha256: crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
      diagnostic_relative_path: 'artifacts/rollback-drill/summary-v3-' + commit + '-' + '1'.repeat(32) + '.json',
    }
    const markerPrefix = 'LOCALMINIDRAMA_ROLLBACK_RESULT_V1='
    const marker = markerPrefix + Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')
    fs.writeFileSync(summaryPath, '{"schema":"malicious-repo-diagnostic","status":"passed"}\\n')
    if (process.env.LMD_PRECREATE_METADATA === 'true') {
      fs.writeFileSync(path.join(path.dirname(archivePath), 'metadata.json'), '{"schema":"untrusted"}\\n')
    }
    process.stdout.write('focused test log\\n')
    if (process.env.LMD_MARKER_MODE === 'stderr-only') process.stderr.write(marker + '\\n')
    else if (process.env.LMD_MARKER_MODE === 'duplicate') process.stdout.write(marker + '\\n' + marker + '\\n')
    else if (process.env.LMD_MARKER_MODE === 'malformed') process.stdout.write(markerPrefix + 'bad=\\n')
    else if (process.env.LMD_MARKER_MODE === 'oversized') process.stdout.write(markerPrefix + 'A'.repeat(1024 * 1024) + '\\n')
    else if (process.env.LMD_MARKER_MODE !== 'missing') process.stdout.write(marker + '\\n')
    process.exit(0)
  }
}
process.exit(40)
`, 'utf8')
  const nativeDocker = installNativeFakeDocker(binPath, fixtureRoot)
  const lockProbePath = path.join(fixtureRoot, 'lock-probe.cjs')
  fs.writeFileSync(lockProbePath, `
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const [dataRoot, archivePath, checkpointPath, stage] = process.argv.slice(2)
const fail = (message) => { process.stderr.write(stage + ': ' + message + '\\n'); process.exit(50) }
const requireBlocked = (label, operation) => {
  try { operation() } catch { return }
  fail(label + ' was not blocked')
}
requireBlocked('checkpoint root rename', () => fs.renameSync(checkpointPath, checkpointPath + '.locked-probe'))
const configRoot = path.join(checkpointPath, 'configs')
requireBlocked('checkpoint config root rename', () => fs.renameSync(configRoot, configRoot + '.locked-probe'))
requireBlocked('archive write', () => fs.writeFileSync(archivePath, 'mutated'))
requireBlocked('archive delete', () => fs.unlinkSync(archivePath))
requireBlocked('archive rename', () => fs.renameSync(archivePath, archivePath + '.locked-probe'))
if (fs.readFileSync(archivePath, 'utf8') !== 'fake retained rollback archive') fail('archive read failed')
const summaryPath = path.join(checkpointPath, 'rollback-drill-summary.json')
if (fs.existsSync(summaryPath)) {
  const summaryBytes = fs.readFileSync(summaryPath)
  requireBlocked('summary write', () => fs.writeFileSync(summaryPath, 'mutated'))
  requireBlocked('summary delete', () => fs.unlinkSync(summaryPath))
  requireBlocked('summary rename', () => fs.renameSync(summaryPath, summaryPath + '.locked-probe'))
  if (!fs.readFileSync(summaryPath).equals(summaryBytes)) fail('summary bytes changed while retained')
}
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
$script:OriginalInvokeNativeCommandWithTimeout = \${function:Invoke-NativeCommandWithTimeout}
$script:OriginalAssertCheckpointDrillEvidence = \${function:Assert-CheckpointDrillEvidence}
$script:OriginalWriteUtf8File = \${function:Write-Utf8File}
$script:OriginalNewRollbackFileAuthorityFromBytes = \${function:New-RollbackFileAuthorityFromBytes}
$script:OriginalStartCapturedDeployment = \${function:Start-CapturedDeployment}
$script:OriginalClearDataSourceEnvironment = \${function:Clear-DataSourceEnvironment}
$script:OriginalClearRuntimeConfigEnvironment = \${function:Clear-RuntimeConfigEnvironment}
$script:MetadataConflictAuthority = $null
$script:PublicationError = $null

function Write-TestEvent {
  param([Parameter(Mandatory = $true)][string]$Name)
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{ event = $Name; driver = 'checkpoint' })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Assert-TestLocks {
  param([Parameter(Mandatory = $true)][string]$Stage)
  $probeOutput = @(& $env:LMD_NODE_EXE $env:LMD_LOCK_PROBE $env:LMD_DATA_ROOT $env:LMD_ARCHIVE_PATH $requestedCheckpointDirectory $Stage 2>&1)
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

function Invoke-NativeCommandWithTimeout {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds,
    [switch]$CaptureOutput,
    [switch]$CaptureOutputBytes,
    [int]$MaximumOutputBytes = 262144,
    [int]$MaximumErrorBytes = 65536,
    [AllowNull()][byte[]]$StandardInputBytes = $null,
    [int]$TerminationTimeoutMilliseconds = 2000
  )
  $forward = @{}
  foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    $forward[$entry.Key] = $entry.Value
  }
  if ($FilePath -ceq 'node') {
    if ($Label -ceq 'Rollback drill') { Write-TestEvent -Name 'paired_drill' }
    $forward['FilePath'] = $env:LMD_NODE_EXE
    $forward['ArgumentList'] = @($env:LMD_FAKE_TOOL, 'node') + @($ArgumentList)
  }
  & $script:OriginalInvokeNativeCommandWithTimeout @forward
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
  }
}

function New-RollbackFileAuthorityFromBytes {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $authority = $null
  $isMetadata = $Label -ceq 'Rollback checkpoint metadata'
  if ($isMetadata) {
    Assert-TestLocks -Stage 'metadata_publish'
    if ($env:LMD_HOLD_METADATA_AUTHORITY -ceq 'true') {
      $script:MetadataConflictAuthority = Open-RollbackFileAuthority -Path $Path -Label 'Held metadata conflict'
    }
  }
  try {
    $authority = & $script:OriginalNewRollbackFileAuthorityFromBytes @PSBoundParameters
    if ($Label -ceq 'Rollback checkpoint drill summary') {
      Assert-TestLocks -Stage 'summary_archive'
    }
    return $authority
  } catch {
    if ($null -ne $authority) { $authority.Stream.Dispose() }
    if ($isMetadata) {
      $script:PublicationError = $_
      $line = ConvertTo-Json -Compress -InputObject ([ordered]@{
        event = 'publication_failure'
        primary_message = $_.Exception.Message
        primary_error_id = $_.FullyQualifiedErrorId
      })
      [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    }
    throw
  }
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

function Clear-DataSourceEnvironment {
  Write-TestEvent -Name 'cleanup:data'
  & $script:OriginalClearDataSourceEnvironment
}

function Clear-RuntimeConfigEnvironment {
  Write-TestEvent -Name 'cleanup:config'
  & $script:OriginalClearRuntimeConfigEnvironment
}

function Pop-Location {
  Write-TestEvent -Name 'cleanup:location'
  Microsoft.PowerShell.Management\\Pop-Location
}

Write-TestEvent -Name 'driver_ready'
try {
  Invoke-ReleaseRollbackCheckpoint -CheckpointDirectory $requestedCheckpointDirectory
} catch {
  $cleanupDetails = @()
  $attachedCleanupErrors = $_.Exception.Data['RollbackCleanupErrors']
  if ($null -ne $attachedCleanupErrors) {
    $cleanupDetails = @($attachedCleanupErrors) | ForEach-Object { $_.Exception.Message }
  }
  $samePublicationException = $false
  if ($null -ne $script:PublicationError) {
    $samePublicationException = [object]::ReferenceEquals($_.Exception, $script:PublicationError.Exception)
  }
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{
    event = 'driver_failure'
    primary_message = $_.Exception.Message
    primary_error_id = $_.FullyQualifiedErrorId
    same_publication_exception = $samePublicationException
    cleanup_errors = @($cleanupDetails)
  })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  throw
} finally {
  if ($null -ne $script:MetadataConflictAuthority) {
    $script:MetadataConflictAuthority.Stream.Dispose()
    Write-TestEvent -Name 'metadata_authority_released'
  }
}
`, 'utf8')
  for (const tool of ['git', 'npm', 'node']) {
    fs.writeFileSync(
      path.join(binPath, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${fakeToolPath}" ${tool} %*\r\n`,
      'utf8',
    )
  }

  const commit = 'c'.repeat(40)
  const version = backendPackage.version
  const readEvents = () => fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : []
  const assertNamespacesMovable = (checkpointPath) => {
    const configPath = path.join(checkpointPath, 'configs')
    const movedConfigPath = path.join(checkpointPath, 'configs.released')
    fs.renameSync(configPath, movedConfigPath)
    fs.renameSync(movedConfigPath, configPath)
    const movedCheckpointPath = `${checkpointPath}.released`
    fs.renameSync(checkpointPath, movedCheckpointPath)
    fs.renameSync(movedCheckpointPath, checkpointPath)
  }
  const runCheckpoint = (
    host,
    checkpointPath,
    status,
    capturedVersion = version,
    precreateMetadata = false,
    holdMetadataAuthority = false,
    markerMode = 'valid',
  ) => {
    const archivePath = path.join(checkpointPath, 'data.zip')
    return spawnSync(host.executable, [
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
        LMD_FAKE_TOOL: fakeToolPath,
        LMD_HOLD_METADATA_AUTHORITY: String(holdMetadataAuthority),
        LMD_LOCK_PROBE: lockProbePath,
        LMD_MARKER_MODE: markerMode,
        LMD_NODE_EXE: process.execPath,
        LMD_NATIVE_DOCKER_HANG: 'false',
        LMD_NATIVE_DOCKER_NODE: process.execPath,
        LMD_NATIVE_DOCKER_TOOL: fakeToolPath,
        LMD_SUMMARY_PATH: summaryPath,
        LMD_SUMMARY_STATUS: status,
        LMD_VERSION: capturedVersion,
        LMD_PRECREATE_METADATA: String(precreateMetadata),
        NODE_OPTIONS: nodeOptionsWithRequire(nativeDocker.bootstrapPath),
      },
    })
  }

  for (const host of windowsPowerShellHosts()) {
  await t.test(host.name, () => {
  const validStart = readEvents().length
  const checkpointPath = path.join(fixtureRoot, `${host.name}-valid-checkpoint`)
  const valid = runCheckpoint(host, checkpointPath, 'passed')
  assert.equal(valid.status, 0, valid.stderr || valid.stdout)
  const metadata = JSON.parse(fs.readFileSync(path.join(checkpointPath, 'metadata.json'), 'utf8'))
  const archivedSummaryBytes = fs.readFileSync(path.join(checkpointPath, 'rollback-drill-summary.json'))
  const archivedSummary = JSON.parse(archivedSummaryBytes.toString('utf8'))
  assert.equal(metadata.schema, 'localminidrama.release-rollback-checkpoint.v5')
  assert.equal(metadata.data_root_sha256, 'd'.repeat(64))
  assert.equal(archivedSummary.schema, 'localminidrama.rollback-drill.v3')
  assert.equal(archivedSummary.status, 'passed')
  assert.equal(archivedSummary.source.commit, commit)
  assert.equal(
    metadata.rollback_evidence_sha256,
    crypto.createHash('sha256').update(archivedSummaryBytes).digest('hex'),
  )
  assert.equal(
    fs.readFileSync(summaryPath, 'utf8'),
    '{"schema":"malicious-repo-diagnostic","status":"passed"}\n',
    'checkpoint trusted the malicious repo diagnostic',
  )
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
  const events = readEvents().slice(validStart)
  const eventIndex = (name) => events.findIndex((entry) => entry.event === name)
  const bindProof = events.find((entry) => entry.event === 'bind_proof')
  assert.ok(bindProof)
  assert.equal(bindProof.readerExitCode, 0)
  assert.equal(bindProof.reader, bindProof.args[4])
  assert.equal(bindProof.readerArgv[1], bindProof.expectedHex)
  assert.equal(path.basename(bindProof.readerArgv[0]), path.posix.basename(bindProof.args[6]))
  assert.equal(bindProof.actualHex, bindProof.expectedHex)
  assert.ok(eventIndex('bind_proof') < eventIndex('shutdown'))
  assert.ok(eventIndex('version') < eventIndex('shutdown'))
  assert.ok(eventIndex('shutdown') < eventIndex('backup'))
  assert.ok(eventIndex('backup') < eventIndex('drill'))
  for (const name of ['first_locked_hash', 'paired_drill', 'node_validator', 'validator', 'summary_archive', 'metadata_publish']) {
    assert.notEqual(eventIndex(name), -1, `checkpoint orchestration event is missing: ${name}; ${events.map((entry) => entry.event).join(',')}`)
  }
  assert.ok(eventIndex('first_locked_hash') < eventIndex('paired_drill'))
  assert.ok(eventIndex('paired_drill') < eventIndex('node_validator'))
  assert.ok(eventIndex('node_validator') < eventIndex('validator'))
  assert.ok(eventIndex('validator') < eventIndex('summary_archive'))
  assert.ok(eventIndex('summary_archive') < eventIndex('metadata_publish'))

  assertNamespacesMovable(checkpointPath)

  for (const markerMode of ['missing', 'duplicate', 'malformed', 'oversized', 'stderr-only', 'extra-evidence']) {
    const markerFailureStart = readEvents().length
    const markerFailurePath = path.join(fixtureRoot, `${host.name}-${markerMode}-marker-checkpoint`)
    const markerFailure = runCheckpoint(
      host,
      markerFailurePath,
      'passed',
      version,
      false,
      false,
      markerMode,
    )
    assert.notEqual(markerFailure.status, 0, `${markerMode} marker must fail checkpoint creation`)
    assert.equal(fs.existsSync(path.join(markerFailurePath, 'metadata.json')), false)
    assert.equal(fs.existsSync(path.join(markerFailurePath, 'rollback-drill-summary.json')), false)
    const markerFailureEvents = readEvents().slice(markerFailureStart).map((entry) => entry.event)
    assert.notEqual(markerFailureEvents.indexOf('drill'), -1)
    assert.notEqual(markerFailureEvents.indexOf('node_validator'), -1)
    assert.equal(markerFailureEvents.indexOf('validator'), -1)
    assert.equal(markerFailureEvents.indexOf('summary_archive'), -1)
    assert.equal(markerFailureEvents.indexOf('metadata_publish'), -1)
    assert.notEqual(markerFailureEvents.indexOf('failure_recovery'), -1)
    assertNamespacesMovable(markerFailurePath)
  }

  const malformedVersionStart = readEvents().length
  const malformedVersionPath = path.join(fixtureRoot, `${host.name}-malformed-version-checkpoint`)
  const malformedVersion = runCheckpoint(host, malformedVersionPath, 'passed', '1.03.3')
  assert.notEqual(malformedVersion.status, 0, 'malformed captured version must fail checkpoint creation')
  const afterMalformedVersion = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.equal(
    afterMalformedVersion.slice(malformedVersionStart).some((entry) => entry.event === 'shutdown'),
    false,
    'captured version format must be rejected before shutdown',
  )

  const unlockedConflictPath = path.join(fixtureRoot, `${host.name}-unlocked-metadata-conflict-checkpoint`)
  const unlockedConflictStart = readEvents().length
  const unlockedConflict = runCheckpoint(host, unlockedConflictPath, 'passed', version, true)
  assert.notEqual(unlockedConflict.status, 0, 'unlocked metadata publication conflict must fail checkpoint creation')
  const unlockedMetadataPath = path.join(unlockedConflictPath, 'metadata.json')
  assert.equal(
    fs.existsSync(unlockedMetadataPath),
    true,
    'failed metadata publication deleted an unowned final path',
  )
  assert.equal(fs.readFileSync(unlockedMetadataPath, 'utf8'), '{"schema":"untrusted"}\n')
  assert.equal(fs.readdirSync(unlockedConflictPath).some((name) => name.startsWith('.metadata.')), false)
  const unlockedConflictRecords = readEvents().slice(unlockedConflictStart)
  const unlockedPublicationFailure = unlockedConflictRecords.find((entry) => entry.event === 'publication_failure')
  const unlockedDriverFailure = unlockedConflictRecords.find((entry) => entry.event === 'driver_failure')
  assert.ok(unlockedPublicationFailure, `${host.name} did not capture the unlocked publication error`)
  assert.ok(unlockedDriverFailure, `${host.name} did not capture the unlocked checkpoint error`)
  assert.equal(unlockedDriverFailure.same_publication_exception, true)
  assert.deepEqual(unlockedDriverFailure.cleanup_errors, [])
  assert.ok(unlockedConflictRecords.some((entry) => entry.event === 'recovery_up'))
  assertNamespacesMovable(unlockedConflictPath)

  const publishFailurePath = path.join(fixtureRoot, `${host.name}-publish-failure-checkpoint`)
  const publishFailureStart = readEvents().length
  const publishFailure = runCheckpoint(host, publishFailurePath, 'passed', version, true, true)
  assert.notEqual(publishFailure.status, 0, 'metadata publication conflict must fail checkpoint creation')
  assert.equal(
    fs.existsSync(path.join(publishFailurePath, 'metadata.json')),
    true,
    'failed metadata publication must not delete the unrelated conflicting authority',
  )
  assert.equal(fs.readFileSync(path.join(publishFailurePath, 'metadata.json'), 'utf8'), '{"schema":"untrusted"}\n')
  assert.equal(fs.readdirSync(publishFailurePath).some((name) => name.startsWith('.metadata.')), false)
  const afterPublishFailure = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const publishFailureRecords = afterPublishFailure.slice(publishFailureStart)
  const publishFailureEvents = publishFailureRecords.map((entry) => entry.event)
  const publicationFailure = publishFailureRecords.find((entry) => entry.event === 'publication_failure')
  const driverFailure = publishFailureRecords.find((entry) => entry.event === 'driver_failure')
  assert.ok(publicationFailure, `${host.name} did not capture the atomic publication error`)
  assert.ok(driverFailure, `${host.name} did not capture the checkpoint invocation error`)
  assert.equal(driverFailure.same_publication_exception, true, 'checkpoint cleanup replaced the publication exception')
  assert.equal(driverFailure.primary_message, publicationFailure.primary_message)
  assert.equal(driverFailure.primary_error_id, publicationFailure.primary_error_id)
  assert.doesNotMatch(driverFailure.primary_error_id, /RemoveFileSystemItemIOError/)
  assert.deepEqual(driverFailure.cleanup_errors, [], 'unowned metadata removal must not be attempted')
  assert.notEqual(publishFailureEvents.indexOf('metadata_publish'), -1)
  assert.notEqual(publishFailureEvents.indexOf('failure_recovery'), -1)
  assert.notEqual(publishFailureEvents.indexOf('recovery_up'), -1, 'deployment recovery command did not execute')
  assert.ok(publishFailureEvents.indexOf('metadata_publish') < publishFailureEvents.indexOf('failure_recovery'))
  const cleanupDataIndex = publishFailureEvents.indexOf('cleanup:data')
  const cleanupConfigIndex = publishFailureEvents.indexOf('cleanup:config')
  const cleanupLocationIndex = publishFailureEvents.indexOf('cleanup:location')
  const authorityReleaseIndex = publishFailureEvents.indexOf('metadata_authority_released')
  assert.ok(cleanupDataIndex >= 0 && cleanupDataIndex < cleanupConfigIndex)
  assert.ok(cleanupConfigIndex < cleanupLocationIndex)
  assert.ok(cleanupLocationIndex < authorityReleaseIndex)
  const heldMetadataPath = path.join(publishFailurePath, 'metadata.json')
  const movedMetadataPath = `${heldMetadataPath}.released`
  fs.renameSync(heldMetadataPath, movedMetadataPath)
  fs.renameSync(movedMetadataPath, heldMetadataPath)
  assertNamespacesMovable(publishFailurePath)

  const failedCheckpointPath = path.join(fixtureRoot, `${host.name}-failed-checkpoint`)
  const failedStart = afterPublishFailure.length
  const failed = runCheckpoint(host, failedCheckpointPath, 'PASSED')
  assert.notEqual(failed.status, 0, 'case-invalid drill status must fail checkpoint creation')
  assert.equal(fs.existsSync(path.join(failedCheckpointPath, 'metadata.json')), false)
  assert.equal(fs.readdirSync(failedCheckpointPath).some((name) => name.startsWith('.metadata.')), false)
  const afterFailed = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const failedEvents = afterFailed.slice(failedStart).map((entry) => entry.event)
  assert.notEqual(failedEvents.indexOf('node_validator'), -1)
  assert.equal(failedEvents.indexOf('validator'), -1)
  assert.notEqual(failedEvents.indexOf('failure_recovery'), -1)
  assert.ok(failedEvents.indexOf('node_validator') < failedEvents.indexOf('failure_recovery'))
  const failedArchive = path.join(failedCheckpointPath, 'data.zip')
  fs.writeFileSync(failedArchive, 'archive lock release positive control')
  const renamedFailedArchive = `${failedArchive}.renamed`
  fs.renameSync(failedArchive, renamedFailedArchive)
  fs.unlinkSync(renamedFailedArchive)
  assertNamespacesMovable(failedCheckpointPath)
  const renamedDataRoot = `${dataRoot}.released`
  fs.renameSync(dataRoot, renamedDataRoot)
  fs.renameSync(renamedDataRoot, dataRoot)
  fs.rmdirSync(dataRoot)
  fs.mkdirSync(dataRoot)
  })
  }
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
  const fixedCheckpointFiles = [
    'metadata.json',
    'data.zip',
    'data.sha256.txt',
    'docker-compose.yml',
    'configs/config.yaml',
    'data-bind-source.txt',
    'images.tar',
    'rollback-drill-summary.json',
  ]

  const compensationProbePath = path.join(fixtureRoot, 'compensation-sharing-probe.cjs')
  fs.writeFileSync(compensationProbePath, `
'use strict'
const fs = require('node:fs')

const record = (entry) => {
  fs.appendFileSync(process.env.LMD_EVENT_LOG, JSON.stringify({ ...entry, driver: 'sharing-probe' }) + '\\n')
}

const requireOriginalBytes = (archivePath, originalBytes, stage) => {
  if (!fs.existsSync(archivePath) || !fs.readFileSync(archivePath).equals(originalBytes)) {
    throw new Error(stage + ': compensation archive original bytes were not retained')
  }
}

function probeCompensation(archivePath, directoryPath, stage) {
  const result = {
    event: 'compensation-sharing-probe',
    stage,
    directory_path: directoryPath,
    directory_rename_blocked: null,
    archive_path: archivePath,
    archive_present: fs.existsSync(archivePath),
    archive_regular: false,
    mutations: {},
    original_bytes_retained: null,
  }

  const movedDirectoryPath = directoryPath + '.sharing-probe'
  let directoryMoved = false
  try {
    fs.renameSync(directoryPath, movedDirectoryPath)
    directoryMoved = true
    result.directory_rename_blocked = false
  } catch {
    result.directory_rename_blocked = true
  } finally {
    if (directoryMoved) fs.renameSync(movedDirectoryPath, directoryPath)
  }

  if (result.archive_present && fs.statSync(archivePath).isFile()) {
    result.archive_regular = true
    const originalBytes = fs.readFileSync(archivePath)

    let overwritten = false
    try {
      fs.writeFileSync(archivePath, 'attacker overwrite')
      overwritten = true
      result.mutations.overwrite_blocked = false
    } catch {
      result.mutations.overwrite_blocked = true
    } finally {
      if (overwritten) fs.writeFileSync(archivePath, originalBytes)
    }
    requireOriginalBytes(archivePath, originalBytes, stage)

    const renamedPath = archivePath + '.renamed-probe'
    let renamed = false
    try {
      fs.renameSync(archivePath, renamedPath)
      renamed = true
      result.mutations.rename_blocked = false
    } catch {
      result.mutations.rename_blocked = true
    } finally {
      if (renamed) fs.renameSync(renamedPath, archivePath)
    }
    requireOriginalBytes(archivePath, originalBytes, stage)

    let deleted = false
    try {
      fs.unlinkSync(archivePath)
      deleted = true
    } catch {
      deleted = false
    }
    result.mutations.delete_recreate_blocked = !deleted
    try {
      if (deleted) {
        if (process.env.LMD_COMPENSATION_PROBE_FAULT === 'fail-after-delete') {
          throw new Error('injected recreate failure after delete')
        }
        fs.writeFileSync(archivePath, 'attacker recreate')
      }
    } catch {
      // The destructive unlink result remains authoritative.
    } finally {
      if (deleted) {
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath)
        fs.writeFileSync(archivePath, originalBytes)
      }
    }
    requireOriginalBytes(archivePath, originalBytes, stage)

    const displacedPath = archivePath + '.displaced-probe'
    const replacementPath = archivePath + '.replacement-probe'
    fs.writeFileSync(replacementPath, 'attacker replacement')
    let displaced = false
    let swapped = false
    try {
      fs.renameSync(archivePath, displacedPath)
      displaced = true
    } catch {
      displaced = false
    }
    result.mutations.swap_before_open_blocked = !displaced
    try {
      if (displaced) {
        if (process.env.LMD_COMPENSATION_PROBE_FAULT === 'fail-after-displace') {
          throw new Error('injected replacement failure after displacement')
        }
        fs.renameSync(replacementPath, archivePath)
        swapped = true
      }
    } catch {
      // The destructive displacement result remains authoritative.
    } finally {
      if (swapped && fs.existsSync(archivePath)) fs.unlinkSync(archivePath)
      if (displaced) fs.renameSync(displacedPath, archivePath)
      if (fs.existsSync(replacementPath)) fs.unlinkSync(replacementPath)
    }
    requireOriginalBytes(archivePath, originalBytes, stage)
    result.original_bytes_retained = true
  }

  record(result)
  return result
}

module.exports = { probeCompensation }
`, 'utf8')

  const fakeToolPath = path.join(fixtureRoot, 'fake-restore-tool.cjs')
  fs.writeFileSync(fakeToolPath, `
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { probeCompensation } = require(process.env.LMD_COMPENSATION_PROBE)
const tool = process.argv[2]
const args = process.argv.slice(3)
const record = (event, extra = {}) => fs.appendFileSync(process.env.LMD_EVENT_LOG, JSON.stringify({ event, tool, args, ...extra }) + '\\n')
const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(63) }
const valueAfter = (name) => args[args.indexOf(name) + 1]
const mode = process.env.LMD_FAKE_MODE
const checkpointPath = process.env.LMD_CHECKPOINT_PATH
const expectedFiles = JSON.parse(process.env.LMD_EXPECTED_CHECKPOINT_FILES)
const wrongExpectedBytes = (relativePath) => Buffer.concat([
  Buffer.from(expectedFiles[relativePath], 'base64'),
  Buffer.from('archived-down-mutation'),
]).toString('base64')
const requireCheckpointFile = (label, actualPath, relativePath, expectedBytes = expectedFiles[relativePath]) => {
  const expectedPath = path.join(checkpointPath, ...relativePath.split('/'))
  if (actualPath !== expectedPath) fail(label + ' path mismatch: ' + actualPath)
  const actualBytes = fs.readFileSync(actualPath).toString('base64')
  if (actualBytes !== expectedBytes) fail(label + ' bytes mismatch')
}
const requireArchivedConfig = (event, expectedBytes) => {
  requireCheckpointFile('archived config', process.env.LOCALMINIDRAMA_CONFIG_PATH, 'configs/config.yaml', expectedBytes)
  record(event)
}
const composeIndex = args.indexOf('compose')
const composeOperation = composeIndex >= 0 ? args.slice(composeIndex + 1).find((value) => ['ps', 'config', 'down', 'up'].includes(value)) : null
record('tool:' + tool)
if (tool === 'docker') {
  const composeFileIndex = args.indexOf('-f')
  if (composeIndex >= 0 && composeFileIndex >= 0) {
    const composeExpectedBytes = mode === 'archived-down-compose-bytes-mismatch' && composeOperation === 'down'
      ? wrongExpectedBytes('docker-compose.yml')
      : undefined
    requireCheckpointFile('archived Compose', args[composeFileIndex + 1], 'docker-compose.yml', composeExpectedBytes)
    record('consumer:compose:' + composeOperation)
    const configExpectedBytes = mode === 'archived-down-config-bytes-mismatch' && composeOperation === 'down'
      ? wrongExpectedBytes('configs/config.yaml')
      : undefined
    requireArchivedConfig('consumer:config:docker-compose:' + composeOperation, configExpectedBytes)
  }
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
  } else if (args[0] === 'image' && args[1] === 'load') {
    requireCheckpointFile('rollback image archive', valueAfter('--input'), 'images.tar')
    record('consumer:image-load')
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
  if (args.includes('backup:data')) {
    const outputPath = valueAfter('--output')
    if (mode === 'compensation-backup-failure') fail('injected compensation backup failure')
    if (mode === 'compensation-authority-invalid') fs.mkdirSync(outputPath)
    else fs.writeFileSync(outputPath, 'durable compensation bytes')
  }
  if (args.includes('restore:data')) {
    const inputPath = valueAfter('--input')
    const rollbackArchivePath = path.join(checkpointPath, 'data.zip')
    if (inputPath === rollbackArchivePath) {
      requireCheckpointFile('rollback data archive', inputPath, 'data.zip')
      record('consumer:rollback-data-restore')
      requireArchivedConfig('consumer:config:npm-restore')
    } else {
      probeCompensation(inputPath, path.dirname(inputPath), 'consumer:' + process.env.LMD_SCENARIO)
      if (fs.readFileSync(inputPath, 'utf8') !== 'durable compensation bytes') {
        fail('compensation archive bytes mismatch')
      }
      record('consumer:compensation-data-restore')
      if (mode === 'compensation-restore-failure') fail('injected compensation restore failure')
    }
  }
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
const { probeCompensation } = require(process.env.LMD_COMPENSATION_PROBE)
const [dataRoot, checkpointPath, stage] = process.argv.slice(2)
const fail = (message) => { process.stderr.write(stage + ': ' + message + '\\n'); process.exit(70) }
const failures = []
const requireBlocked = (label, operation) => {
  try { operation() } catch { return }
  failures.push(label + ' was not blocked')
}
const requireRenameBlocked = (label, target) => {
  const renamed = target + '.authority-probe'
  try {
    fs.renameSync(target, renamed)
  } catch {
    return
  }
  try {
    fs.renameSync(renamed, target)
  } catch (error) {
    fail(label + ' probe could not restore the path: ' + error.message)
  }
  failures.push(label + ' was not blocked')
}
requireRenameBlocked('checkpoint root rename', checkpointPath)
const configRoot = path.join(checkpointPath, 'configs')
requireRenameBlocked('checkpoint config root rename', configRoot)
const fixedFiles = ${JSON.stringify(fixedCheckpointFiles)}
for (const relativePath of fixedFiles) {
  requireRenameBlocked(relativePath + ' rename', path.join(checkpointPath, ...relativePath.split('/')))
}
const expectedFiles = JSON.parse(process.env.LMD_EXPECTED_CHECKPOINT_FILES)
for (const relativePath of fixedFiles) {
  const actual = fs.readFileSync(path.join(checkpointPath, ...relativePath.split('/'))).toString('base64')
  if (actual !== expectedFiles[relativePath]) failures.push(relativePath + ' bytes changed before consumption')
}
const archivePath = path.join(checkpointPath, 'data.zip')
requireBlocked('archive write', () => fs.writeFileSync(archivePath, 'mutated'))
requireBlocked('archive delete', () => fs.unlinkSync(archivePath))
requireBlocked('archive rename', () => fs.renameSync(archivePath, archivePath + '.renamed'))
fs.readFileSync(archivePath)
const compensationDirectories = fs.readdirSync(checkpointPath)
  .filter((entry) => entry.startsWith('compensation-'))
if (compensationDirectories.length > 1) fail('multiple compensation directories were published')
if (compensationDirectories.length === 1) {
  const compensationName = compensationDirectories[0]
  const compensationDirectory = path.join(checkpointPath, compensationName)
  probeCompensation(path.join(compensationDirectory, 'data.zip'), compensationDirectory, stage)
}
requireBlocked('root rename', () => fs.renameSync(dataRoot, dataRoot + '.renamed'))
requireBlocked('root delete', () => fs.rmdirSync(dataRoot))
const child = path.join(dataRoot, 'lock-probe-child.txt')
fs.writeFileSync(child, 'first')
fs.writeFileSync(child, 'second')
if (fs.readFileSync(child, 'utf8') !== 'second') fail('descendant read/write failed')
fs.unlinkSync(child)
if (failures.length > 0) fail(failures.join('; '))
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
$script:OriginalOpenRollbackFileAuthority = \${function:Open-RollbackFileAuthority}
$script:OriginalOpenRollbackDirectoryIdentityLock = \${function:Open-RollbackDirectoryIdentityLock}
$script:OriginalAssertRollbackFileAuthority = \${function:Assert-RollbackFileAuthority}
$script:OriginalAssertRollbackFileAuthorityHash = \${function:Assert-RollbackFileAuthorityHash}
$script:OriginalClearDataSourceEnvironment = \${function:Clear-DataSourceEnvironment}
$script:OriginalClearRuntimeConfigEnvironment = \${function:Clear-RuntimeConfigEnvironment}
$script:EvidenceValidated = $false
$script:AuthorityAssertionOrder = 0
$script:AuthoritiesSinceBoundary = [System.Collections.ArrayList]::new()
$script:LastAuthorityAssertion = $null
$script:PendingRecoveryLabel = $null

function Write-TestEvent {
  param([string]$Name)
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{ event = $Name; driver = 'restore' })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
function Write-TestRecord {
  param([Parameter(Mandatory = $true)][object]$Record)
  $line = ConvertTo-Json -Compress -Depth 4 -InputObject $Record
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
function Open-RollbackFileAuthority {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Label -ceq 'Pre-rollback compensation backup') {
    Write-TestRecord -Record ([ordered]@{
      event = 'compensation-authority-attempt'
      path = [System.IO.Path]::GetFullPath($Path)
      driver = 'restore'
    })
  }
  $authority = & $script:OriginalOpenRollbackFileAuthority @PSBoundParameters
  if ($Label -ceq 'Pre-rollback compensation backup') {
    Write-TestRecord -Record ([ordered]@{
      event = 'compensation-authority-opened'
      path = [string]$authority.Path
      identity = [string]$authority.Identity
      driver = 'restore'
    })
  }
  return $authority
}
function Open-RollbackDirectoryIdentityLock {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Label = 'Rollback data root'
  )
  $lock = & $script:OriginalOpenRollbackDirectoryIdentityLock @PSBoundParameters
  if ($Label -ceq 'Rollback compensation directory') {
    Write-TestRecord -Record ([ordered]@{
      event = 'compensation-directory-lock-opened'
      path = [System.IO.Path]::GetFullPath($Path)
      driver = 'restore'
    })
  }
  return $lock
}
function Assert-RollbackFileAuthority {
  param([Parameter(Mandatory = $true)][object]$Authority)
  $result = & $script:OriginalAssertRollbackFileAuthority @PSBoundParameters
  $script:AuthorityAssertionOrder += 1
  $script:LastAuthorityAssertion = [string]$Authority.Label
  if ($env:LMD_SUPPRESS_AUTHORITY_LABEL -cne $Authority.Label) {
    [void]$script:AuthoritiesSinceBoundary.Add([string]$Authority.Label)
    Write-TestRecord -Record ([ordered]@{
      event = 'production-authority'
      authority = [string]$Authority.Label
      order = $script:AuthorityAssertionOrder
      driver = 'restore'
    })
  }
  return $result
}
function Assert-RollbackFileAuthorityHash {
  param(
    [Parameter(Mandatory = $true)][object]$Authority,
    [Parameter(Mandatory = $true)][object]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $result = & $script:OriginalAssertRollbackFileAuthorityHash @PSBoundParameters
  if ($Label -like '*compensation data backup') { Write-TestEvent -Name ('hash:' + $Label) }
  return $result
}
function Record-ProductionAuthorityBoundary {
  param([Parameter(Mandatory = $true)][string]$Label)
  $authorities = [object[]]@($script:AuthoritiesSinceBoundary)
  Write-TestRecord -Record ([ordered]@{
    event = 'production-authority-boundary'
    boundary = $Label
    authorities = $authorities
    driver = 'restore'
  })
  $script:AuthoritiesSinceBoundary.Clear()
}
function Assert-TestLocks {
  param([string]$Stage)
  $output = @(& $env:LMD_NODE_EXE $env:LMD_LOCK_PROBE $env:LMD_DATA_ROOT $requestedCheckpointDirectory $Stage 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Lock probe failed during $($Stage): $($output -join [Environment]::NewLine)" }
  Write-TestEvent -Name ('locks:' + $Stage)
  Write-TestEvent -Name ('authority-ok:' + $Stage)
}
function Assert-RollbackEvidenceBinding {
  param([object]$Metadata, [object]$Summary, [object]$ActualBackupHash, [object]$ActualDataRootIdentity)
  & $script:OriginalEvidenceBinding @PSBoundParameters
  $script:EvidenceValidated = $true
  $script:AuthoritiesSinceBoundary.Clear()
  $script:LastAuthorityAssertion = $null
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
  $result = & $script:OriginalRootGuard @PSBoundParameters
  Write-TestEvent -Name ('root-ok:' + $Label)
  return $result
}
function Assert-FileHash {
  param([string]$Path, [string]$Expected, [string]$Label)
  & $script:OriginalFileHash @PSBoundParameters
  if ($Label -ceq 'Compensation data bind source') {
    $sourcePath = Join-Path $requestedCheckpointDirectory 'data-bind-source.txt'
    $sourceBytes = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($sourcePath))
    $destinationBytes = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Path))
    if ($sourceBytes -cne $env:LMD_EXPECTED_BIND_SOURCE_BASE64 -or $destinationBytes -cne $sourceBytes) {
      throw 'Compensation data bind source copy bytes do not match.'
    }
    Write-TestEvent -Name 'consumer:bind-source-copy'
    Record-ProductionAuthorityBoundary -Label 'Compensation data bind source copy'
  }
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
  Write-TestRecord -Record ([ordered]@{
    event = 'production-immediate-authority'
    boundary = $Label
    authority = $script:LastAuthorityAssertion
    driver = 'restore'
  })
  $script:LastAuthorityAssertion = $null
  if ($mutationLabels -ccontains $Label) {
    Write-TestEvent -Name $Label
    Assert-TestLocks -Stage $Label
  }
  if ($script:EvidenceValidated) {
    Assert-TestLocks -Stage ('invoke:' + $Label)
    Record-ProductionAuthorityBoundary -Label $Label
  }
  if ($env:LMD_FAIL_AFTER_RECOVERY_UP -ceq 'true' -and
      $script:PendingRecoveryLabel -ceq 'Preparation forward deployment recovery' -and
      $Label -ceq 'Preparation forward backend container lookup') {
    Write-TestEvent -Name 'injected-post-up-verification-failure'
    throw 'Injected failure after recovery compose up and before health.'
  }
  $fail = switch ($env:LMD_SCENARIO) {
    'shutdown_failure' { $Label -ceq 'Current Docker shutdown' }
    'restore_failure' { $Label -ceq 'Rollback data restore' }
    'startup_failure' { $Label -ceq 'Rollback container startup' }
    'terminal_failure' { $Label -ceq 'Rollback container startup' -or $Label -ceq 'Forward deployment recovery' }
    default { $false }
  }
  if ($fail) {
    Write-TestEvent -Name ('injected-boundary:' + $Label)
    throw "Injected failure: $Label"
  }
  $result = & $script:OriginalInvokeChecked @PSBoundParameters
  if ($Label -in @(
      'Rollback container startup',
      'Preparation forward deployment recovery',
      'Forward deployment recovery'
    )) {
    $script:PendingRecoveryLabel = $Label
  }
  return $result
}
function Clear-DataSourceEnvironment {
  Write-TestEvent -Name 'cleanup:data'
  & $script:OriginalClearDataSourceEnvironment
  if ($env:LMD_CLEANUP_FAILURE -ceq 'true') { throw 'injected cleanup failure' }
}
function Clear-RuntimeConfigEnvironment {
  Write-TestEvent -Name 'cleanup:config'
  & $script:OriginalClearRuntimeConfigEnvironment
}
function Pop-Location {
  Write-TestEvent -Name 'cleanup:location'
  Microsoft.PowerShell.Management\\Pop-Location
}
function Test-ApplicationHealth {
  if ($null -eq $script:PendingRecoveryLabel) {
    Assert-TestLocks -Stage 'health'
    Write-TestEvent -Name 'health'
    return
  }
  $recoveryLabel = $script:PendingRecoveryLabel
  Assert-TestLocks -Stage ('health:' + $recoveryLabel)
  Write-TestEvent -Name ('health:' + $recoveryLabel)
  Write-TestEvent -Name ('recovery-complete:' + $recoveryLabel)
  $script:PendingRecoveryLabel = $null
}

try {
  Invoke-ReleaseRollbackCheckpointRestore -CheckpointDirectory $requestedCheckpointDirectory
} catch {
  $cleanupDetails = @()
  $attachedCleanupErrors = $_.Exception.Data['RollbackCleanupErrors']
  if ($null -ne $attachedCleanupErrors) {
    $cleanupDetails = @($attachedCleanupErrors) | ForEach-Object { $_.Exception.Message }
  }
  $line = ConvertTo-Json -Compress -InputObject ([ordered]@{
    event = 'driver_failure'
    primary_message = $_.Exception.Message
    primary_error_id = $_.FullyQualifiedErrorId
    cleanup_errors = @($cleanupDetails)
  })
  [System.IO.File]::AppendAllText($env:LMD_EVENT_LOG, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  throw
}
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
    const fixedBytes = Object.fromEntries(fixedCheckpointFiles.map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(checkpointPath, ...relativePath.split('/'))).toString('base64'),
    ]))
    return {
      actualIdentity,
      alternateDataRoot,
      checkpointPath,
      configRoot,
      dataRoot,
      eventLog,
      fixedBytes,
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
        LMD_CHECKPOINT_PATH: fixture.checkpointPath,
        LMD_COMMIT: commit,
        LMD_CONFIG_ROOT: fixture.configRoot,
        LMD_CURRENT_BACKEND_IMAGE: currentBackendImageId,
        LMD_CURRENT_FRONTEND_IMAGE: currentFrontendImageId,
        LMD_DATA_ROOT: fixture.dataRoot,
        LMD_EXPECTED_CHECKPOINT_FILES: JSON.stringify(fixture.fixedBytes),
        LMD_EXPECTED_BIND_SOURCE_BASE64: fixture.fixedBytes['data-bind-source.txt'],
        LMD_EVENT_LOG: fixture.eventLog,
        LMD_FAKE_MODE: options.fakeMode || '',
        LMD_FAIL_AFTER_RECOVERY_UP: String(Boolean(options.failAfterRecoveryUp)),
        LMD_FORWARD_COMMIT: forwardCommit,
        LMD_FRONTEND_IMAGE: frontendImageId,
        LMD_LOCK_PROBE: lockProbePath,
        LMD_NODE_EXE: process.execPath,
        LMD_CLEANUP_FAILURE: String(Boolean(options.cleanupFailure)),
        LMD_COMPENSATION_PROBE: compensationProbePath,
        LMD_SCENARIO: options.runtimeScenario || name,
        LMD_SUPPRESS_AUTHORITY_LABEL: options.suppressAuthorityLabel || '',
      },
    })
    const events = fs.existsSync(fixture.eventLog)
      ? fs.readFileSync(fixture.eventLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
      : []
    const eventNames = events.map((entry) => entry.event)
    const compensationDirectories = fs.readdirSync(fixture.checkpointPath)
      .filter((entry) => entry.startsWith('compensation-'))
    const compensationArtifacts = compensationDirectories.map((name) => {
      const directoryPath = path.join(fixture.checkpointPath, name)
      const archivePath = path.join(directoryPath, 'data.zip')
      const archiveExists = fs.existsSync(archivePath)
      const archiveType = archiveExists
        ? (fs.statSync(archivePath).isFile() ? 'file' : 'other')
        : 'missing'
      const archiveBytes = archiveType === 'file' ? fs.readFileSync(archivePath) : null
      if (archiveExists) {
        const movedArchivePath = archivePath + '.released'
        fs.renameSync(archivePath, movedArchivePath)
        fs.renameSync(movedArchivePath, archivePath)
      }
      const movedDirectoryPath = directoryPath + '.released'
      fs.renameSync(directoryPath, movedDirectoryPath)
      fs.renameSync(movedDirectoryPath, directoryPath)
      return {
        archiveBytes,
        archivePath,
        archiveType,
        directoryPath,
        name,
        nameIsUnpredictable: /^compensation-\d{8}T\d{6}Z-[a-f0-9]{32}$/.test(name),
        releasedAfterExit: true,
      }
    })
    for (const relativePath of fixedCheckpointFiles) {
      const originalPath = path.join(fixture.checkpointPath, ...relativePath.split('/'))
      const movedPath = `${originalPath}.released`
      fs.renameSync(originalPath, movedPath)
      fs.renameSync(movedPath, originalPath)
    }
    const checkpointConfigPath = path.join(fixture.checkpointPath, 'configs')
    const movedCheckpointConfigPath = path.join(fixture.checkpointPath, 'configs.released')
    fs.renameSync(checkpointConfigPath, movedCheckpointConfigPath)
    fs.renameSync(movedCheckpointConfigPath, checkpointConfigPath)
    const movedCheckpointPath = `${fixture.checkpointPath}.released`
    fs.renameSync(fixture.checkpointPath, movedCheckpointPath)
    fs.renameSync(movedCheckpointPath, fixture.checkpointPath)
    const renamedArchive = path.join(path.dirname(fixture.checkpointPath), 'released-data.zip')
    fs.writeFileSync(path.join(fixture.checkpointPath, 'data.zip'), 'released archive')
    fs.renameSync(path.join(fixture.checkpointPath, 'data.zip'), renamedArchive)
    fs.unlinkSync(renamedArchive)
    const renamedRoot = `${fixture.dataRoot}.released`
    fs.renameSync(fixture.dataRoot, renamedRoot)
    fs.rmdirSync(renamedRoot)
    return { compensationArtifacts, compensationDirectories, eventNames, events, fixture, result }
  }

  const runCompensationProbeFault = (fault) => {
    const probeRoot = fs.mkdtempSync(path.join(fixtureRoot, 'mutation-oracle-'))
    const archivePath = path.join(probeRoot, 'data.zip')
    const eventLog = path.join(probeRoot, 'events.jsonl')
    const originalBytes = Buffer.from('mutation oracle original bytes')
    fs.writeFileSync(archivePath, originalBytes)
    const runner = `
const { probeCompensation } = require(process.argv[1])
const result = probeCompensation(process.argv[2], process.argv[3], process.argv[4])
process.stdout.write(JSON.stringify(result))
`
    const result = spawnSync(process.execPath, [
      '-e', runner, compensationProbePath, archivePath, probeRoot, fault,
    ], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        LMD_COMPENSATION_PROBE_FAULT: fault,
        LMD_EVENT_LOG: eventLog,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(fs.readFileSync(archivePath).equals(originalBytes), true, `${fault} did not restore fixture bytes`)
    return JSON.parse(result.stdout)
  }

  return { runCompensationProbeFault, runScenario }
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
  assert.equal(
    run.eventNames.some((event) => event.startsWith('locks:') && !event.startsWith('locks:invoke:')),
    false,
    `${label} reached a mutation boundary`,
  )
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

function assertRestoreAuthorityProbeCoverage(run, label) {
  const bindingIndex = run.eventNames.indexOf('binding accepted')
  assert.notEqual(bindingIndex, -1, `${label} never completed checkpoint validation`)
  const toolIndices = run.events.flatMap((entry, index) =>
    index > bindingIndex && String(entry.event).startsWith('tool:') ? [index] : [])
  assert.ok(toolIndices.length > 0, `${label} executed no post-validation fake command`)
  let previousToolIndex = bindingIndex
  for (const toolIndex of toolIndices) {
    const probe = run.events.slice(previousToolIndex + 1, toolIndex)
      .find((entry) => String(entry.event).startsWith('locks:invoke:'))
    assert.ok(probe, `${label} did not retain every checkpoint authority at fake command index ${toolIndex}`)
    previousToolIndex = toolIndex
  }
}

function assertRestoreConsumerEvents(run, label, expectedEvents) {
  for (const event of expectedEvents) {
    assert.ok(run.eventNames.includes(event), label + ' did not prove ' + event)
  }
}

function assertFinalAuthorityProbe(run, label, stage, commandPredicate) {
  const authorityEvent = 'authority-ok:invoke:' + stage
  const authorityIndex = run.eventNames.lastIndexOf(authorityEvent)
  assert.notEqual(authorityIndex, -1, label + ' did not complete the final authority probe for ' + stage)
  const commandIndex = run.events.findIndex((entry, index) =>
    index > authorityIndex && entry.event === 'tool:docker' && commandPredicate(entry.args))
  assert.notEqual(commandIndex, -1, label + ' did not execute the final fake command for ' + stage)
}

function assertInjectedAuthorityBoundary(run, label, stage) {
  const authorityIndex = run.eventNames.lastIndexOf('authority-ok:invoke:' + stage)
  const boundaryIndex = run.eventNames.lastIndexOf('injected-boundary:' + stage)
  assert.notEqual(authorityIndex, -1, label + ' did not complete the authority probe for ' + stage)
  assert.ok(boundaryIndex > authorityIndex, label + ' did not reach the intentional injected boundary for ' + stage)
}

function assertProductionAuthorityEventOrder(run, label) {
  const assertions = run.events.filter((entry) => entry.event === 'production-authority')
  assert.ok(assertions.length > 0, label + ' recorded no production authority assertions')
  for (let index = 1; index < assertions.length; index += 1) {
    assert.ok(
      assertions[index - 1].order < assertions[index].order,
      label + ' production authority assertion order is not strictly increasing',
    )
  }
}

function assertProductionAuthorityBoundary(run, label, boundary, expectedAuthorities) {
  const records = run.events.filter((entry) =>
    entry.event === 'production-authority-boundary' && entry.boundary === boundary)
  assert.ok(records.length > 0, label + ' did not record production authorities for ' + boundary)
  const actual = [...new Set(records.at(-1).authorities)].sort()
  const expected = [...expectedAuthorities].sort()
  assert.deepEqual(actual, expected, label + ' asserted the wrong authorities for ' + boundary)
}

const archivedComposeAuthorities = ['Archived Compose file', 'Archived runtime config']

function assertCheckpointPreparationAuthorityBoundaries(run, label, options = {}) {
  assertProductionAuthorityBoundary(
    run,
    label,
    'Archived rollback Compose data bind resolution',
    archivedComposeAuthorities,
  )
  assertProductionAuthorityBoundary(
    run,
    label,
    'Archived Docker Compose validation',
    archivedComposeAuthorities,
  )
  assertProductionAuthorityBoundary(run, label, 'Rollback image archive load', ['Archived Docker images'])
  if (options.bindSource !== false) {
    assertProductionAuthorityBoundary(
      run,
      label,
      'Compensation data bind source copy',
      ['Archived data bind source'],
    )
  }
  if (options.rollbackRestore) {
    assertProductionAuthorityBoundary(
      run,
      label,
      'Rollback data restore',
      ['Rollback data backup', 'Archived runtime config', 'Pre-rollback compensation backup'],
    )
  }
  if (options.rollbackStartup) {
    assertProductionAuthorityBoundary(
      run,
      label,
      'Rollback Compose data bind resolution',
      archivedComposeAuthorities,
    )
    assertProductionAuthorityBoundary(run, label, 'Rollback container startup', archivedComposeAuthorities)
  }
  if (options.rollbackBackendLookup) {
    assertProductionAuthorityBoundary(
      run,
      label,
      'Rollback backend container lookup',
      archivedComposeAuthorities,
    )
  }
  if (options.failedRollbackShutdown) {
    assertProductionAuthorityBoundary(run, label, 'Failed rollback shutdown', archivedComposeAuthorities)
  }
}

function findDockerToolAfter(run, startIndex, predicate, message) {
  const index = run.events.findIndex((entry, eventIndex) =>
    eventIndex > startIndex && entry.event === 'tool:docker' && predicate(entry.args))
  assert.notEqual(index, -1, message)
  return index
}

function assertAutomaticRecoveryCompleted(run, label, recoveryLabel, backendLabel) {
  const recoveryIndex = run.eventNames.lastIndexOf(recoveryLabel)
  assert.notEqual(recoveryIndex, -1, label + ' did not reach ' + recoveryLabel)
  const upProbeIndex = run.eventNames.indexOf('authority-ok:invoke:' + recoveryLabel, recoveryIndex)
  assert.ok(upProbeIndex > recoveryIndex, label + ' did not pass the recovery compose-up authority probe')
  const upToolIndex = findDockerToolAfter(
    run,
    upProbeIndex,
    (args) => Array.isArray(args) && args.includes('compose') && args.includes('up'),
    label + ' did not execute recovery compose up',
  )

  const lookupLabel = backendLabel + ' container lookup'
  const lookupProbeIndex = run.eventNames.indexOf('authority-ok:invoke:' + lookupLabel, upToolIndex)
  assert.ok(lookupProbeIndex > upToolIndex, label + ' did not probe the recovered backend lookup')
  const lookupToolIndex = findDockerToolAfter(
    run,
    lookupProbeIndex,
    (args) => Array.isArray(args) && args.includes('compose') && args.includes('ps') && args.includes('backend'),
    label + ' did not execute the recovered backend lookup',
  )

  const mountProbeIndex = run.eventNames.indexOf('authority-ok:invoke:/app/data mount capture', lookupToolIndex)
  assert.ok(mountProbeIndex > lookupToolIndex, label + ' did not probe recovered bind inspection')
  const mountToolIndex = findDockerToolAfter(
    run,
    mountProbeIndex,
    (args) => Array.isArray(args) && args[0] === 'inspect' && args.includes('{{json .Mounts}}'),
    label + ' did not inspect the recovered data bind',
  )

  const rootVerifiedIndex = run.eventNames.indexOf('root-ok:' + backendLabel + ' data root', mountToolIndex)
  assert.ok(rootVerifiedIndex > mountToolIndex, label + ' did not verify the recovered data root')
  const healthIndex = run.eventNames.indexOf('health:' + recoveryLabel, rootVerifiedIndex)
  assert.ok(healthIndex > rootVerifiedIndex, label + ' did not run post-verification health')
  const completionIndex = run.eventNames.indexOf('recovery-complete:' + recoveryLabel, healthIndex)
  assert.ok(completionIndex > healthIndex, label + ' did not record completed automatic recovery')
  assert.equal(
    run.eventNames.includes('Preparation compensation failure shutdown'),
    false,
    label + ' entered preparation terminal shutdown after successful recovery',
  )
  assert.equal(
    run.eventNames.includes('Compensation failure shutdown'),
    false,
    label + ' entered compensation terminal shutdown after successful recovery',
  )
}

test('rollback restore final-authority oracle rejects bypassed probes and missing commands', () => {
  const dockerUp = (args) => Array.isArray(args) && args.includes('up')
  const missingProbe = {
    eventNames: ['tool:docker'],
    events: [{ event: 'tool:docker', tool: 'docker', args: ['compose', 'up'] }],
  }
  assert.throws(
    () => assertFinalAuthorityProbe(missingProbe, 'oracle/missing-probe', 'Rollback container startup', dockerUp),
    /did not complete the final authority probe/,
  )

  const missingCommand = {
    eventNames: ['authority-ok:invoke:Rollback container startup'],
    events: [{ event: 'authority-ok:invoke:Rollback container startup', driver: 'restore' }],
  }
  assert.throws(
    () => assertFinalAuthorityProbe(missingCommand, 'oracle/missing-command', 'Rollback container startup', dockerUp),
    /did not execute the final fake command/,
  )
})

test('rollback restore real-authority oracle rejects a suppressed production assertion', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Restore authority instrumentation requires Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'restore authority oracle must run under Node 20')
  const { runScenario } = createRollbackRestoreHarness(t)
  for (const host of windowsPowerShellHosts()) {
    await t.test(host.name, () => {
      const baseline = runScenario(host, 'real-authority-oracle-baseline')
      assert.equal(baseline.result.status, 0, baseline.result.stderr || baseline.result.stdout)
      assertProductionAuthorityEventOrder(baseline, `${host.name}/real-authority-oracle-baseline`)
      assertProductionAuthorityBoundary(
        baseline,
        `${host.name}/real-authority-oracle-baseline`,
        'Rollback image archive load',
        ['Archived Docker images'],
      )

      const mutation = runScenario(host, 'real-authority-oracle-mutation', {
        suppressAuthorityLabel: 'Archived Docker images',
      })
      assert.equal(mutation.result.status, 0, mutation.result.stderr || mutation.result.stdout)
      assert.throws(
        () => assertProductionAuthorityBoundary(
          mutation,
          `${host.name}/real-authority-oracle-mutation`,
          'Rollback image archive load',
          ['Archived Docker images'],
        ),
        /asserted the wrong authorities|did not record production authorities/,
      )
    })
  }
})

test('rollback restore recovery-completion oracle rejects post-up verification failure', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Restore recovery completion requires Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'restore recovery oracle must run under Node 20')
  const { runScenario } = createRollbackRestoreHarness(t)
  for (const host of windowsPowerShellHosts()) {
    await t.test(host.name, () => {
      const baseline = runScenario(host, 'recovery-completion-oracle-baseline', {
        runtimeScenario: 'shutdown_failure',
      })
      assert.notEqual(baseline.result.status, 0)
      assertAutomaticRecoveryCompleted(
        baseline,
        `${host.name}/recovery-completion-oracle-baseline`,
        'Preparation forward deployment recovery',
        'Preparation forward backend',
      )

      const mutation = runScenario(host, 'recovery-completion-oracle-mutation', {
        runtimeScenario: 'shutdown_failure',
        failAfterRecoveryUp: true,
      })
      assert.notEqual(mutation.result.status, 0)
      assert.ok(mutation.eventNames.includes('injected-post-up-verification-failure'))
      assert.throws(
        () => assertAutomaticRecoveryCompleted(
          mutation,
          `${host.name}/recovery-completion-oracle-mutation`,
          'Preparation forward deployment recovery',
          'Preparation forward backend',
        ),
        /did not probe the recovered backend lookup|did not execute the recovered backend lookup|did not record completed automatic recovery/,
      )
    })
  }
})

test('rollback restore archived-down oracle rejects missing exact-byte success events', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Restore archived shutdown consumers require Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'restore archived-down oracle must run under Node 20')
  const { runScenario } = createRollbackRestoreHarness(t)
  for (const host of windowsPowerShellHosts()) {
    await t.test(host.name, async (t) => {
      const baseline = runScenario(host, 'archived-down-oracle-baseline', {
        runtimeScenario: 'startup_failure',
      })
      assert.notEqual(baseline.result.status, 0)
      assertRestoreConsumerEvents(baseline, `${host.name}/archived-down-oracle-baseline`, [
        'consumer:compose:down',
        'consumer:config:docker-compose:down',
      ])

      await t.test('rejects archived Compose down byte mismatch', () => {
        const mutation = runScenario(host, 'archived-down-compose-oracle-mutation', {
          runtimeScenario: 'startup_failure',
          fakeMode: 'archived-down-compose-bytes-mismatch',
        })
        assert.notEqual(mutation.result.status, 0)
        assert.throws(
          () => assertRestoreConsumerEvents(mutation, `${host.name}/archived-down-compose-oracle-mutation`, [
            'consumer:compose:down',
            'consumer:config:docker-compose:down',
          ]),
          /did not prove consumer:compose:down/,
        )
        assert.equal(mutation.eventNames.includes('consumer:compose:down'), false)
        assert.equal(mutation.eventNames.includes('consumer:config:docker-compose:down'), false)
      })

      await t.test('rejects archived config down byte mismatch after Compose success', () => {
        const mutation = runScenario(host, 'archived-down-config-oracle-mutation', {
          runtimeScenario: 'startup_failure',
          fakeMode: 'archived-down-config-bytes-mismatch',
        })
        assert.notEqual(mutation.result.status, 0)
        assertRestoreConsumerEvents(mutation, `${host.name}/archived-down-config-oracle-mutation`, [
          'consumer:compose:down',
        ])
        assert.throws(
          () => assertRestoreConsumerEvents(mutation, `${host.name}/archived-down-config-oracle-mutation`, [
            'consumer:config:docker-compose:down',
          ]),
          /did not prove consumer:config:docker-compose:down/,
        )
        assert.equal(mutation.eventNames.includes('consumer:config:docker-compose:down'), false)
      })
    })
  }
})

const blockedCompensationMutations = {
  delete_recreate_blocked: true,
  overwrite_blocked: true,
  rename_blocked: true,
  swap_before_open_blocked: true,
}

function assertCompensationSharingProbe(run, label, stage, { archivePresent = true } = {}) {
  const records = run.events.filter((entry) =>
    entry.event === 'compensation-sharing-probe' && entry.stage === stage)
  assert.equal(records.length, 1, `${label} did not run exactly one compensation sharing probe at ${stage}`)
  const record = records[0]
  assert.equal(record.archive_present, archivePresent, `${label} observed the wrong archive state at ${stage}`)
  if (archivePresent) {
    assert.equal(record.archive_regular, true, `${label} did not retain a regular compensation archive at ${stage}`)
    assert.deepEqual(record.mutations, blockedCompensationMutations, `${label} allowed an archive mutation at ${stage}`)
    assert.equal(record.original_bytes_retained, true, `${label} lost the original archive bytes at ${stage}`)
  }
  assert.equal(record.directory_rename_blocked, true, `${label} allowed compensation directory replacement at ${stage}`)
  assert.match(
    path.basename(record.directory_path),
    /^compensation-\d{8}T\d{6}Z-[a-f0-9]{32}$/,
    `${label} used a predictable compensation directory name`,
  )
  return record
}

function assertCompensationPublishedAndReleased(run, label, expectedArchiveType = 'file') {
  assert.equal(run.compensationArtifacts.length, 1, `${label} did not retain exactly one compensation directory`)
  const artifact = run.compensationArtifacts[0]
  assert.equal(artifact.nameIsUnpredictable, true, `${label} retained a predictable compensation directory`)
  assert.equal(artifact.archiveType, expectedArchiveType, `${label} retained the wrong compensation archive type`)
  assert.equal(artifact.releasedAfterExit, true, `${label} did not release compensation handles after exit`)
  if (expectedArchiveType === 'file') {
    assert.equal(artifact.archiveBytes.toString('utf8'), 'durable compensation bytes')
  }
  return artifact
}

function assertSingleCompensationAuthority(run, label, artifact) {
  const attempts = run.events.filter((entry) => entry.event === 'compensation-authority-attempt')
  const opened = run.events.filter((entry) => entry.event === 'compensation-authority-opened')
  const directoryLocks = run.events.filter((entry) => entry.event === 'compensation-directory-lock-opened')
  assert.equal(attempts.length, 1, `${label} did not attempt exactly one compensation authority acquisition`)
  assert.equal(opened.length, 1, `${label} did not open exactly one compensation authority`)
  assert.equal(directoryLocks.length, 1, `${label} did not open exactly one compensation directory lock`)
  assert.equal(attempts[0].path, artifact.archivePath, `${label} acquired authority for the wrong archive path`)
  assert.equal(opened[0].path, artifact.archivePath, `${label} retained authority for the wrong archive path`)
  assert.equal(directoryLocks[0].path, artifact.directoryPath, `${label} locked the wrong compensation directory`)
}

function assertCompensationRestoreConsumer(run, label, boundary, artifact) {
  const immediate = run.events.filter((entry) =>
    entry.event === 'production-immediate-authority' && entry.boundary === boundary)
  assert.equal(immediate.length, 1, `${label} did not record exactly one ${boundary} boundary`)
  assert.equal(
    immediate[0].authority,
    'Pre-rollback compensation backup',
    `${label} did not assert the compensation authority immediately before ${boundary}`,
  )
  const consumers = run.events.filter((entry) => entry.event === 'consumer:compensation-data-restore')
  assert.equal(consumers.length, 1, `${label} did not execute exactly one compensation restore consumer`)
  const inputIndex = consumers[0].args.indexOf('--input')
  assert.notEqual(inputIndex, -1, `${label} compensation restore omitted --input`)
  assert.equal(consumers[0].args[inputIndex + 1], artifact.archivePath, `${label} restored from a recomputed path`)
}

test('rollback compensation mutation oracle rejects destructive partial success', async (t) => {
  assert.equal(process.versions.node.split('.')[0], '20', 'compensation mutation oracle must run under Node 20')
  const { runCompensationProbeFault } = createRollbackRestoreHarness(t)

  await t.test('reports delete/recreate unblocked when unlink succeeds before recreate fails', () => {
    const probe = runCompensationProbeFault('fail-after-delete')
    assert.equal(
      probe.mutations.delete_recreate_blocked,
      false,
      'successful unlink was hidden by the later recreate failure',
    )
  })

  await t.test('reports swap unblocked when displacement succeeds before replacement fails', () => {
    const probe = runCompensationProbeFault('fail-after-displace')
    assert.equal(
      probe.mutations.swap_before_open_blocked,
      false,
      'successful displacement was hidden by the later replacement failure',
    )
  })
})

test('rollback compensation authority retains the published archive across every branch', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Compensation sharing behavior requires Windows')
    return
  }
  assert.equal(process.versions.node.split('.')[0], '20', 'compensation sharing behavior must run under Node 20')
  const hosts = windowsPowerShellHosts()
  assert.ok(hosts.some((host) => host.name === 'powershell-7'), 'PowerShell 7 is required for compensation coverage')
  const { runScenario } = createRollbackRestoreHarness(t)

  for (const host of hosts) {
    await t.test(host.name, async (t) => {
      await t.test('restore_failure rejects every archive mutation before preparation compensation', () => {
        const run = runScenario(host, 'task2-restore-failure', { runtimeScenario: 'restore_failure' })
        const label = `${host.name}/restore_failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'consumer:restore_failure')
        const artifact = assertCompensationPublishedAndReleased(run, label)
        assertSingleCompensationAuthority(run, label, artifact)
        assertCompensationRestoreConsumer(run, label, 'Preparation compensation data restore', artifact)
        assert.ok(run.eventNames.includes('recovery-complete:Preparation forward deployment recovery'))
      })

      await t.test('startup_failure rejects every archive mutation before failed-startup compensation', () => {
        const run = runScenario(host, 'task2-startup-failure', { runtimeScenario: 'startup_failure' })
        const label = `${host.name}/startup_failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'consumer:startup_failure')
        const artifact = assertCompensationPublishedAndReleased(run, label)
        assertSingleCompensationAuthority(run, label, artifact)
        assertCompensationRestoreConsumer(run, label, 'Compensation data restore', artifact)
        assert.ok(run.eventNames.includes('recovery-complete:Forward deployment recovery'))
      })

      await t.test('terminal_failure retains authority after the compensation restore fails', () => {
        const run = runScenario(host, 'task2-terminal-failure', {
          fakeMode: 'compensation-restore-failure',
          runtimeScenario: 'startup_failure',
        })
        const label = `${host.name}/terminal_failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'Compensation failure shutdown')
        const artifact = assertCompensationPublishedAndReleased(run, label)
        assertSingleCompensationAuthority(run, label, artifact)
        assertCompensationRestoreConsumer(run, label, 'Compensation data restore', artifact)
        assert.ok(run.eventNames.includes('Compensation failure shutdown'))
        assert.equal(run.eventNames.some((event) => event.startsWith('recovery-complete:')), false)
      })

      await t.test('preparation terminal shutdown retains the same archive authority', () => {
        const run = runScenario(host, 'task2-preparation-terminal-failure', {
          failAfterRecoveryUp: true,
          runtimeScenario: 'restore_failure',
        })
        const label = `${host.name}/preparation-terminal-failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'Preparation compensation failure shutdown')
        const artifact = assertCompensationPublishedAndReleased(run, label)
        assertSingleCompensationAuthority(run, label, artifact)
        assertCompensationRestoreConsumer(run, label, 'Preparation compensation data restore', artifact)
        assert.ok(run.eventNames.includes('Preparation compensation failure shutdown'))
      })

      await t.test('successful rollback retains locks through final health and releases them after exit', () => {
        const run = runScenario(host, 'task2-success')
        const label = `${host.name}/success`
        assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout)
        assertCompensationSharingProbe(run, label, 'Pre-rollback compensation backup', { archivePresent: false })
        assertCompensationSharingProbe(run, label, 'health:Rollback container startup')
        const artifact = assertCompensationPublishedAndReleased(run, label)
        assertSingleCompensationAuthority(run, label, artifact)
      })

      await t.test('backup creation failure performs forward recovery without archive dereference', () => {
        const run = runScenario(host, 'task2-backup-failure', {
          fakeMode: 'compensation-backup-failure',
        })
        const label = `${host.name}/backup-failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'Pre-rollback compensation backup', { archivePresent: false })
        assertCompensationSharingProbe(run, label, 'health:Preparation forward deployment recovery', { archivePresent: false })
        assertCompensationPublishedAndReleased(run, label, 'missing')
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-authority-attempt').length, 0)
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-authority-opened').length, 0)
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-directory-lock-opened').length, 1)
        assert.equal(run.eventNames.includes('Rollback data restore'), false)
        assert.equal(run.eventNames.includes('consumer:rollback-data-restore'), false)
        assert.ok(run.eventNames.includes('recovery-complete:Preparation forward deployment recovery'))
        const failure = run.events.find((entry) => entry.event === 'driver_failure')
        assert.match(failure.primary_message, /Pre-rollback compensation backup failed/)
        assert.doesNotMatch(failure.primary_message, /null-valued expression|cannot bind.*authority/i)
      })

      await t.test('authority acquisition failure performs forward recovery before rollback mutation', () => {
        const run = runScenario(host, 'task2-authority-failure', {
          fakeMode: 'compensation-authority-invalid',
        })
        const label = `${host.name}/authority-failure`
        assert.notEqual(run.result.status, 0)
        assertCompensationSharingProbe(run, label, 'Pre-rollback compensation backup', { archivePresent: false })
        assertCompensationPublishedAndReleased(run, label, 'other')
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-authority-attempt').length, 1)
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-authority-opened').length, 0)
        assert.equal(run.events.filter((entry) => entry.event === 'compensation-directory-lock-opened').length, 1)
        assert.equal(run.eventNames.includes('Rollback data restore'), false)
        assert.equal(run.eventNames.includes('consumer:rollback-data-restore'), false)
        assert.ok(run.eventNames.includes('recovery-complete:Preparation forward deployment recovery'))
        const failure = run.events.find((entry) => entry.event === 'driver_failure')
        assert.match(failure.primary_message, /Pre-rollback compensation backup.*(?:authority|regular non-reparse file)/i)
      })
    })
  }
})

test('rollback restore fake toolchain keeps evidence locks through success and compensation paths', async (t) => {
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
  const composeCommand = (operation, requireArchivedFile = false) => (args) =>
    Array.isArray(args) &&
    args.includes('compose') &&
    args.includes(operation) &&
    (!requireArchivedFile || args.includes('-f'))
  const preRestoreConsumers = [
    'consumer:compose:config',
    'consumer:config:docker-compose:config',
    'consumer:image-load',
    'consumer:bind-source-copy',
  ]
  const rollbackRestoreConsumers = [
    'consumer:rollback-data-restore',
    'consumer:config:npm-restore',
  ]

  for (const host of hosts) {
    await t.test(host.name, () => {
    for (const [name, options] of [...gateScenarios, ...preservedPreMutationScenarios]) {
      const run = runScenario(host, name, options)
      assertRestoreStoppedBeforeMutation(run, `${host.name}/${name}`)
    }
    for (const [name, options] of postImageValidationScenarios) {
      const run = runScenario(host, name, options)
      assertRestoreStoppedAfterImageValidation(run, `${host.name}/${name}`)
      assertRestoreConsumerEvents(run, `${host.name}/${name}`, [
        'consumer:compose:config',
        'consumer:config:docker-compose:config',
        'consumer:image-load',
      ])
    }

    const success = runScenario(host, 'success')
    assert.equal(success.result.status, 0, success.result.stderr || success.result.stdout)
    assertRestoreAuthorityProbeCoverage(success, `${host.name}/success`)
    assertProductionAuthorityEventOrder(success, `${host.name}/success`)
    assertCheckpointPreparationAuthorityBoundaries(success, `${host.name}/success`, {
      rollbackRestore: true,
      rollbackStartup: true,
      rollbackBackendLookup: true,
    })
    const successIndex = (name) => success.eventNames.indexOf(name)
    assert.ok(successIndex('binding accepted') < successIndex('Push'))
    assert.ok(successIndex('Push') < successIndex('Rollback image archive load'))
    assert.ok(successIndex('Rollback image archive load') < successIndex('Current Docker shutdown'))
    assert.ok(successIndex('Current Docker shutdown') < successIndex('Pre-rollback compensation backup'))
    assert.ok(successIndex('Pre-rollback compensation backup') < successIndex('Rollback data restore'))
    assert.ok(successIndex('Rollback data restore') < successIndex('Rollback container startup'))
    assertRestoreConsumerEvents(success, `${host.name}/success`, [
      ...preRestoreConsumers,
      ...rollbackRestoreConsumers,
      'consumer:compose:up',
      'consumer:config:docker-compose:up',
    ])
    assertFinalAuthorityProbe(
      success,
      `${host.name}/success`,
      'Rollback container startup',
      composeCommand('up', true),
    )

    const shutdownFailure = runScenario(host, 'shutdown_failure')
    assert.notEqual(shutdownFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(shutdownFailure, `${host.name}/shutdown_failure`)
    assertCheckpointPreparationAuthorityBoundaries(shutdownFailure, `${host.name}/shutdown_failure`)
    assert.ok(shutdownFailure.eventNames.indexOf('Current Docker shutdown') < shutdownFailure.eventNames.indexOf('Failed rollback preparation shutdown'))
    assert.ok(shutdownFailure.eventNames.includes('Preparation forward deployment recovery'))
    assertRestoreConsumerEvents(shutdownFailure, `${host.name}/shutdown_failure`, preRestoreConsumers)
    assertInjectedAuthorityBoundary(shutdownFailure, `${host.name}/shutdown_failure`, 'Current Docker shutdown')
    assertFinalAuthorityProbe(
      shutdownFailure,
      `${host.name}/shutdown_failure`,
      'Preparation forward deployment recovery',
      composeCommand('up'),
    )
    assertAutomaticRecoveryCompleted(
      shutdownFailure,
      `${host.name}/shutdown_failure`,
      'Preparation forward deployment recovery',
      'Preparation forward backend',
    )

    const restoreFailure = runScenario(host, 'restore_failure')
    assert.notEqual(restoreFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(restoreFailure, `${host.name}/restore_failure`)
    assertCheckpointPreparationAuthorityBoundaries(restoreFailure, `${host.name}/restore_failure`, {
      rollbackRestore: true,
    })
    assert.ok(restoreFailure.eventNames.includes('hash:Preparation compensation data backup'))
    assert.ok(restoreFailure.eventNames.includes('Preparation compensation data restore'))
    assert.ok(restoreFailure.eventNames.includes('Preparation forward deployment recovery'))
    assertAutomaticRecoveryCompleted(
      restoreFailure,
      `${host.name}/restore_failure`,
      'Preparation forward deployment recovery',
      'Preparation forward backend',
    )

    const identityFailure = runScenario(host, 'identity_after_mutation')
    assert.notEqual(identityFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(identityFailure, `${host.name}/identity_after_mutation`)
    assertCheckpointPreparationAuthorityBoundaries(identityFailure, `${host.name}/identity_after_mutation`)
    assert.ok(identityFailure.eventNames.includes('identity failure after mutation'))
    assert.ok(identityFailure.eventNames.includes('Preparation compensation data restore'))
    assert.ok(identityFailure.eventNames.includes('Preparation forward deployment recovery'))
    assertAutomaticRecoveryCompleted(
      identityFailure,
      `${host.name}/identity_after_mutation`,
      'Preparation forward deployment recovery',
      'Preparation forward backend',
    )

    const startupFailure = runScenario(host, 'startup_failure')
    assert.notEqual(startupFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(startupFailure, `${host.name}/startup_failure`)
    assertCheckpointPreparationAuthorityBoundaries(startupFailure, `${host.name}/startup_failure`, {
      rollbackRestore: true,
      rollbackStartup: true,
      failedRollbackShutdown: true,
    })
    assert.ok(startupFailure.eventNames.includes('Failed rollback shutdown'))
    assert.ok(startupFailure.eventNames.includes('hash:Compensation data backup'))
    assert.ok(startupFailure.eventNames.includes('Compensation data restore'))
    assert.ok(startupFailure.eventNames.includes('Forward deployment recovery'))
    assertRestoreConsumerEvents(startupFailure, `${host.name}/startup_failure`, [
      ...preRestoreConsumers,
      ...rollbackRestoreConsumers,
      'consumer:compensation-data-restore',
      'consumer:compose:down',
      'consumer:config:docker-compose:down',
    ])
    assertInjectedAuthorityBoundary(startupFailure, `${host.name}/startup_failure`, 'Rollback container startup')
    assertFinalAuthorityProbe(
      startupFailure,
      `${host.name}/startup_failure`,
      'Forward deployment recovery',
      composeCommand('up'),
    )
    assertAutomaticRecoveryCompleted(
      startupFailure,
      `${host.name}/startup_failure`,
      'Forward deployment recovery',
      'Forward backend',
    )

    const terminalFailure = runScenario(host, 'terminal_failure')
    assert.notEqual(terminalFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(terminalFailure, `${host.name}/terminal_failure`)
    assertCheckpointPreparationAuthorityBoundaries(terminalFailure, `${host.name}/terminal_failure`, {
      rollbackRestore: true,
      rollbackStartup: true,
      failedRollbackShutdown: true,
    })
    assert.ok(terminalFailure.eventNames.includes('Forward deployment recovery'))
    assert.ok(terminalFailure.eventNames.includes('Compensation failure shutdown'))
    assert.ok(terminalFailure.eventNames.includes('locks:Compensation failure shutdown'))
    assertRestoreConsumerEvents(terminalFailure, `${host.name}/terminal_failure`, [
      ...preRestoreConsumers,
      ...rollbackRestoreConsumers,
      'consumer:compensation-data-restore',
      'consumer:compose:down',
      'consumer:config:docker-compose:down',
    ])
    assertInjectedAuthorityBoundary(terminalFailure, `${host.name}/terminal_failure`, 'Rollback container startup')
    assertInjectedAuthorityBoundary(terminalFailure, `${host.name}/terminal_failure`, 'Forward deployment recovery')
    assertFinalAuthorityProbe(
      terminalFailure,
      `${host.name}/terminal_failure`,
      'Compensation failure shutdown',
      composeCommand('down'),
    )
    assert.equal(
      terminalFailure.eventNames.some((event) => event.startsWith('recovery-complete:')),
      false,
      `${host.name}/terminal_failure reported false recovery completion`,
    )

    const cleanupFailure = runScenario(host, 'cleanup_failure', {
      cleanupFailure: true,
      runtimeScenario: 'startup_failure',
    })
    assert.notEqual(cleanupFailure.result.status, 0)
    assertRestoreAuthorityProbeCoverage(cleanupFailure, `${host.name}/cleanup_failure`)
    const driverFailure = cleanupFailure.events.find((entry) => entry.event === 'driver_failure')
    assert.ok(driverFailure, `${host.name}/cleanup_failure did not report the retained primary error`)
    assert.match(driverFailure.primary_message, /Rollback startup failed;/)
    assert.deepEqual(driverFailure.cleanup_errors, ['injected cleanup failure'])
    assert.match(cleanupFailure.result.stderr, /Rollback startup failed;/)
    const cleanupDataIndex = cleanupFailure.eventNames.indexOf('cleanup:data')
    const cleanupConfigIndex = cleanupFailure.eventNames.indexOf('cleanup:config')
    const cleanupLocationIndex = cleanupFailure.eventNames.indexOf('cleanup:location')
    assert.ok(cleanupDataIndex >= 0 && cleanupDataIndex < cleanupConfigIndex)
    assert.ok(cleanupConfigIndex < cleanupLocationIndex)
    })
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
  assert.match(checkpointScript, /backup:data[\s\S]*Get-FileHash[\s\S]*run-rollback-drill\.cjs/)
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
  assert.match(
    checkpointScript,
    /Start-CapturedDeployment[\s\S]*\$cleanupErrors\.Add\(\$_\)[\s\S]*throw \$checkpointError/,
  )
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
    /Assert-RollbackFileAuthorityHash -Authority \$dataBindSourceAuthority -Expected \$metadata\.data_bind_source_sha256/,
  )
  assert.match(rollbackRestoreScript, /Read-RollbackFileAuthorityUtf8 -Authority \$dataBindSourceAuthority/)
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
    [...rollbackRestoreScript.matchAll(/Open-RollbackFileAuthority -Path \$compensationBackup -Label 'Pre-rollback compensation backup'/g)].length,
    1,
    'the outer restore invocation must acquire exactly one compensation archive authority',
  )
  assert.equal(
    [...rollbackRestoreScript.matchAll(/Assert-RollbackFileAuthority -Authority \$compensationBackupAuthority \| Out-Null/g)].length,
    2,
    'both automatic compensation restores must assert the retained archive authority',
  )
  assert.equal(
    [...rollbackRestoreScript.matchAll(/Assert-RollbackFileAuthorityHash -Authority \$compensationBackupAuthority -Expected \$compensationHash/g)].length,
    2,
    'both automatic compensation restores must rehash the retained archive stream',
  )
  assert.equal(
    [...rollbackRestoreScript.matchAll(/'--input', \$compensationBackupAuthority\.Path/g)].length,
    2,
    'both automatic compensation restores must consume the retained authority path',
  )
  assert.match(rollbackRestoreScript, /\$compensationHash = Get-RollbackFileAuthoritySha256 -Authority \$compensationBackupAuthority/)
  assert.doesNotMatch(rollbackRestoreScript, /Assert-FileHash -Path \$compensationBackup/)
  assert.match(
    rollbackRestoreScript,
    /New-Item -ItemType Directory -Path \$compensationRoot \| Out-Null\r?\n\s*\$compensationDirectoryLock = Open-RollbackDirectoryIdentityLock -Path \$compensationRoot -Label 'Rollback compensation directory'/,
  )
  assert.match(
    rollbackRestoreScript,
    /\$compensationRoot = Join-Path \$checkpoint \("compensation-" \+ \[DateTime\]::UtcNow\.ToString\('yyyyMMddTHHmmssZ'\) \+ "-" \+ \[Guid\]::NewGuid\(\)\.ToString\('N'\)\)/,
  )
  assert.match(
    rollbackRestoreScript,
    /if \(\$null -ne \$compensationBackupAuthority\) \{ \$compensationBackupAuthority\.Stream\.Dispose\(\) \}[\s\S]*if \(\$null -ne \$compensationDirectoryLock\) \{ \$compensationDirectoryLock\.Dispose\(\) \}/,
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
  assert.match(rollback, /--expected-commit "\$GITHUB_SHA"/)
  assert.doesNotMatch(rollback, /summary\.json|readFileSync/)
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

test('CI isolated rollback workflow enforces standalone v3 evidence', () => {
  assertStandaloneRollbackWorkflowContract(ciWorkflowDocument, 'CI')
})

test('release rollback workflow enforces standalone v3 evidence', () => {
  assertStandaloneRollbackWorkflowContract(releaseWorkflowDocument, 'release')
})

test('rollback workflow shell propagates drill, tee, validator, stderr, and inherited-writer failures', (t) => {
  if (process.platform !== 'linux') {
    t.skip('Executable rollback workflow shell contract runs on the Ubuntu workflow host')
    return
  }
  const runScriptOf = (document) => String(document.jobs['rollback-drill'].steps
    .find((step) => step.name === 'Run and validate rollback drill').run)
  const ciRunScript = runScriptOf(ciWorkflowDocument)
  assert.equal(runScriptOf(releaseWorkflowDocument), ciRunScript)
  const executableRunScript = ciRunScript
    .replace('720s npm run verify:rollback', '1s npm run verify:rollback')
    .replace('760s bash "$pipeline_script"', '3s bash "$pipeline_script"')
  const realTee = spawnSync('sh', ['-c', 'command -v tee'], { encoding: 'utf8' }).stdout.trim()
  assert.ok(path.isAbsolute(realTee), 'system tee is unavailable')

  const runCase = (environment = {}) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-workflow-shell-'))
    const binDirectory = path.join(fixtureRoot, 'bin')
    const runnerTemp = path.join(fixtureRoot, 'runner-temp')
    const scriptsDirectory = path.join(fixtureRoot, 'scripts')
    fs.mkdirSync(binDirectory)
    fs.mkdirSync(runnerTemp)
    fs.mkdirSync(scriptsDirectory)
    const npmPath = path.join(binDirectory, 'npm')
    const teePath = path.join(binDirectory, 'tee')
    const dockerPath = path.join(binDirectory, 'docker')
    const shortWritePreloadPath = path.join(fixtureRoot, 'short-write-preload.cjs')
    const dockerStatePath = path.join(fixtureRoot, 'docker-state.json')
    const dockerEventsPath = path.join(fixtureRoot, 'docker-events.jsonl')
    const fullContainerId = 'c'.repeat(64)
    if (environment.EXERCISE_CID_ONLY_CLEANUP === '1') {
      fs.writeFileSync(dockerStatePath, JSON.stringify({ id: fullContainerId }))
    }
    fs.writeFileSync(npmPath, `#!/bin/sh
if [ "\${EXERCISE_CID_ONLY_CLEANUP:-0}" = 1 ]; then printf '%s\\n' '${fullContainerId}' >"$LMD_ROLLBACK_CIDFILE"; fi
printf 'stdout-line\\n'
if [ "\${LARGE_STDERR:-0}" = 1 ]; then
  dd if=/dev/zero bs=262145 count=1 2>/dev/null | tr '\\000' x >&2
else
  printf 'stderr-line\\n' >&2
fi
if [ "\${HOLD_STDERR:-0}" = 1 ]; then
  (trap 'exit 0' PIPE TERM; while :; do printf h >&2 || exit 0; sleep 1; done) &
fi
if [ "\${DETACH_WRITER:-0}" = 1 ]; then
  setsid sh -c 'trap "exit 0" PIPE TERM; while :; do printf o || exit 0; printf e >&2 || exit 0; sleep 1; done' &
fi
if [ "\${HANG_MAIN:-0}" = 1 ]; then
  trap 'exit 0' TERM
  while :; do sleep 1; done
fi
exit "\${DRILL_STATUS:-0}"
`, { mode: 0o755 })
    fs.writeFileSync(teePath, `#!/bin/sh
"\${REAL_TEE}" "$@"
actual=$?
if [ "\${TEE_STATUS:-0}" -ne 0 ]; then exit "\${TEE_STATUS}"; fi
exit "$actual"
`, { mode: 0o755 })
    fs.writeFileSync(dockerPath, `#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const args = process.argv.slice(2)
const statePath = process.env.FAKE_DOCKER_STATE_PATH
const eventsPath = process.env.FAKE_DOCKER_EVENTS_PATH
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null
const record = (event) => fs.appendFileSync(eventsPath, JSON.stringify({ event, args }) + '\\n')
if (args[0] === 'container' && args[1] === 'ls') {
  record('list')
  const state = readState()
  const filter = args[args.indexOf('--filter') + 1] || ''
  if (state && filter.startsWith('id=')) process.stdout.write(state.id + '\\n')
  process.exit(0)
}
if (args[0] === 'container' && args[1] === 'inspect') {
  record('inspect')
  if (!readState()) process.exit(1)
  process.stdout.write(String(process.env.LMD_ROLLBACK_CONTAINER_LABEL).split('=').slice(1).join('=') + '\\n')
  process.exit(0)
}
if (args[0] === 'stop') { record('stop'); process.exit(19) }
if (args[0] === 'kill') { record('kill'); process.exit(0) }
if (args[0] === 'rm') { record('rm'); fs.rmSync(statePath, { force: true }); process.exit(0) }
if (args[0] === 'create') {
  record('create')
  if (readState()) process.exit(1)
  const id = 'd'.repeat(64)
  fs.writeFileSync(statePath, JSON.stringify({ id }))
  process.stdout.write(id + '\\n')
  process.exit(0)
}
process.exit(41)
`, { mode: 0o755 })
    fs.writeFileSync(
      path.join(scriptsDirectory, 'rollback-drill-evidence.cjs'),
      `process.stdin.resume(); process.stdin.on('end', () => process.exit(Number(process.env.VALIDATOR_STATUS || 0)))\n`,
    )
    fs.writeFileSync(shortWritePreloadPath, `
const fs = require('node:fs')
const originalWriteSync = fs.writeSync
fs.writeSync = function (fd, buffer, offset, length, ...rest) {
  if (process.env.FORCE_SHORT_WRITE === '1' && ArrayBuffer.isView(buffer) && length > 1) {
    return originalWriteSync.call(this, fd, buffer, offset, Math.max(1, Math.floor(length / 2)), ...rest)
  }
  return originalWriteSync.call(this, fd, buffer, offset, length, ...rest)
}
`, 'utf8')
    try {
      const result = spawnSync('bash', ['-c', executableRunScript], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...environment,
          GITHUB_SHA: rollbackWorkflowSha,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
          REAL_TEE: realTee,
          RUNNER_TEMP: runnerTemp,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${shortWritePreloadPath}`.trim(),
          FAKE_DOCKER_EVENTS_PATH: dockerEventsPath,
          FAKE_DOCKER_STATE_PATH: dockerStatePath,
        },
        timeout: 20000,
      })
      return {
        result,
        stdout: fs.readFileSync(path.join(runnerTemp, 'rollback-drill.stdout.log')),
        stderr: fs.readFileSync(path.join(runnerTemp, 'rollback-drill.stderr.log')),
        dockerEvents: fs.existsSync(dockerEventsPath)
          ? fs.readFileSync(dockerEventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
          : [],
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  }

  const success = runCase()
  assert.equal(success.result.status, 0, success.result.stderr)
  assert.equal(success.stdout.toString('utf8'), 'stdout-line\n')
  assert.equal(success.stderr.toString('utf8'), 'stderr-line\n')

  const cidOnlyCleanup = runCase({ EXERCISE_CID_ONLY_CLEANUP: '1' })
  assert.equal(cidOnlyCleanup.result.status, 0, cidOnlyCleanup.result.stderr)
  for (const event of ['inspect', 'stop', 'kill', 'rm', 'create']) {
    assert.ok(cidOnlyCleanup.dockerEvents.some((entry) => entry.event === event), `missing Docker cleanup event ${event}`)
  }
  assert.ok(cidOnlyCleanup.dockerEvents.some((entry) => entry.event === 'list' && entry.args.includes('--no-trunc')))

  for (const [name, environment, expectedStatus] of [
    ['drill', { DRILL_STATUS: '7' }, 7],
    ['tee', { TEE_STATUS: '8' }, 8],
    ['validator', { VALIDATOR_STATUS: '9' }, 9],
  ]) {
    const failure = runCase(environment)
    assert.equal(failure.result.status, expectedStatus, `${name} failure was not propagated: ${failure.result.stderr}`)
  }

  const truncated = runCase({ LARGE_STDERR: '1' })
  assert.equal(truncated.result.status, 1, truncated.result.stderr)
  assert.equal(truncated.stderr.length, 262144)
  assert.equal(truncated.stdout.toString('utf8'), 'stdout-line\n')

  const shortWrite = runCase({ FORCE_SHORT_WRITE: '1' })
  assert.equal(shortWrite.result.status, 0, shortWrite.result.stderr)
  assert.equal(shortWrite.stderr.toString('utf8'), 'stderr-line\n')

  const hungMain = runCase({ HANG_MAIN: '1' })
  assert.equal(hungMain.result.status, 124, hungMain.result.stderr)
  assert.notEqual(hungMain.result.error?.code, 'ETIMEDOUT')

  const inheritedWriter = runCase({ HOLD_STDERR: '1' })
  assert.equal(inheritedWriter.result.status, 124, inheritedWriter.result.stderr)
  assert.notEqual(inheritedWriter.result.error?.code, 'ETIMEDOUT')

  const detachedWriter = runCase({ DETACH_WRITER: '1' })
  assert.equal(detachedWriter.result.status, 124, detachedWriter.result.stderr)
  assert.notEqual(detachedWriter.result.error?.code, 'ETIMEDOUT')
})

test('rollback acceptance plan never treats the repository diagnostic as authoritative', () => {
  const taskFive = rollbackEvidencePlan.slice(rollbackEvidencePlan.indexOf('### Task 5:'))
  assert.ok(taskFive.startsWith('### Task 5:'))
  assert.doesNotMatch(taskFive, /artifacts\/rollback-drill\/summary\.json/)
  assert.match(taskFive, /LOCALMINIDRAMA_ROLLBACK_RESULT_V1|live stdout|machine result/i)
  assert.match(taskFive, /checkpoint\/rollback-drill-summary\.json|checkpoint-bound summary/i)
})

test('operator and Task 4 reports state the final direct-authority model', () => {
  assert.match(
    quickstart,
    /rollback-drill-summary\.json[\s\S]{0,500}FileMode\.CreateNew[\s\S]{0,500}same retained|same retained[\s\S]{0,500}FileMode\.CreateNew/i,
  )
  assert.doesNotMatch(
    quickstart,
    /rollback-drill-summary\.json[\s\S]{0,300}atomically[^\n]*publish[\s\S]{0,200}(?:then|immediately) opens? a read-only/i,
  )
  const finalFix = rollbackTaskFourReport.slice(rollbackTaskFourReport.lastIndexOf('## Review Fix 5:'))
  assert.ok(finalFix.startsWith('## Review Fix 5:'))
  assert.match(finalFix, /direct|CreateNew/i)
  assert.doesNotMatch(finalFix, /opened once after atomic no-overwrite publication/i)
})

test('operator guide states the platform rollback containment boundaries', () => {
  assert.match(quickstart, /Windows[\s\S]{0,300}Job Object[\s\S]{0,300}NTFS\/ReFS/)
  assert.match(quickstart, /Linux[\s\S]{0,600}宿主[\s\S]{0,300}维护租约/)
  assert.match(quickstart, /只读挂载[\s\S]{0,400}禁用网络[\s\S]{0,400}私有 `\/tmp`/)
  assert.match(quickstart, /只有 `artifacts\/rollback-drill\/` 可写/)
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
