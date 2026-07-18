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
  expectedChecksumText,
  expectedReleaseArtifactNames,
  isReleaseArtifact,
  verify,
} = require('./generate-release-metadata.cjs')
const { validatePackagedApplications } = require('./packaged-applications-contract.cjs')
const {
  EVIDENCE_RELATIVE_PATH,
  EVIDENCE_SCHEMA,
  assertNoCliArguments,
  evidenceOutputPath,
  prepareEvidenceTarget,
  publishEvidence,
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
} = require('./verify-release.cjs')
const { sanitizeRuntimeConfig, sanitizeRuntimeConfigFile } = require('./runtime-config-policy.cjs')
const { getTrustedMediaToolRelease } = require('../desktop/scripts/media-tool-policy')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')

const root = path.resolve(__dirname, '..')
const backendRequire = createRequire(path.join(root, 'backend-node', 'package.json'))
const { parse: parseToml } = backendRequire('smol-toml')
const gitAttributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8')
const checkpointScript = fs.readFileSync(path.join(root, 'scripts', 'create-release-rollback-checkpoint.ps1'), 'utf8')
const rollbackRestoreScript = fs.readFileSync(path.join(root, 'scripts', 'restore-release-rollback-checkpoint.ps1'), 'utf8')
const rollbackDrillScript = fs.readFileSync(path.join(root, 'scripts', 'run-rollback-drill.cjs'), 'utf8')
const dockerComposeRevisionScript = fs.readFileSync(path.join(root, 'scripts', 'docker-compose-with-revision.cjs'), 'utf8')
const backendTrivyIgnore = fs.readFileSync(path.join(root, 'backend-node', '.trivyignore.yaml'), 'utf8')
const backendDockerfile = fs.readFileSync(path.join(root, 'backend-node', 'Dockerfile'), 'utf8')
const backendEntrypoint = fs.readFileSync(path.join(root, 'backend-node', 'docker-entrypoint.sh'), 'utf8')
const frontendDockerfile = fs.readFileSync(path.join(root, 'frontweb', 'Dockerfile.prod'), 'utf8')
const dockerCompose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')
const ciWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
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

function jobBlock(name, source = workflow) {
  const marker = `  ${name}:`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `workflow job ${name} is missing`)
  const remainder = source.slice(start + marker.length)
  const nextJob = remainder.search(/\r?\n  [a-z][a-z0-9-]*:\r?\n/)
  return source.slice(start, nextJob === -1 ? source.length : start + marker.length + nextJob)
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

function passedArtifactSecurity(version, output) {
  const sourceArtifacts = [
    `LocalMiniDrama-Portable-${version}-x64.exe`,
    `LocalMiniDrama-Setup-${version}-x64.exe`,
    `LocalMiniDrama-Unpacked-${version}-x64.zip`,
  ]
  return {
    schema: 'localminidrama.artifact-security.v1',
    version,
    commit: 'a'.repeat(40),
    generated_at: '2026-07-17T00:00:00.000Z',
    source_artifacts: sourceArtifacts,
    source_artifact_sha256: Object.fromEntries(
      artifactInventory(output, sourceArtifacts).map((artifact) => [artifact.name, artifact.sha256])
    ),
    extracted_applications: 3,
    packaged_applications: ['setup', 'portable', 'unpacked'].map((kind) => ({
      executable: `${kind}/LocalMiniDrama.exe`,
      asar: `${kind}/resources/app.asar`,
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

function createReleaseFixture(t) {
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
      fs.writeFileSync(filePath, `${JSON.stringify({ bomFormat: 'CycloneDX', components: [] })}\n`)
    } else {
      fs.writeFileSync(filePath, `fixture:${name}\n`)
    }
  }
  fs.writeFileSync(
    path.join(output, 'artifact-security.json'),
    `${JSON.stringify(passedArtifactSecurity(version, output), null, 2)}\n`,
  )

  const artifacts = artifactInventory(output, names)
  const manifest = {
    schema: 'localminidrama.release-manifest.v1',
    version,
    tag: `v${version}`,
    commit: 'a'.repeat(40),
    source_dirty: false,
    generated_at: '2026-07-17T00:00:00.000Z',
    artifacts,
  }
  fs.writeFileSync(path.join(output, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), expectedChecksumText(output, artifacts))
  return { artifacts, output, version }
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

test('rollback drill evidence is fixed, exclusive, and only replaces a same-version PASS record', async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-evidence-'))
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }))
  const version = '1.3.3'
  const outputPath = evidenceOutputPath(fixtureRoot)
  assert.equal(path.relative(fixtureRoot, outputPath).replace(/\\/g, '/'), EVIDENCE_RELATIVE_PATH)
  assert.throws(() => assertNoCliArguments(['outside.json']), /does not accept a custom output path/)
  assertNoCliArguments([])

  await prepareEvidenceTarget(fixtureRoot, version)
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    status: 'passed',
    source: { version },
  }
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
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v3/)
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
  assert.match(rollbackDrillScript, /database:\s*\{[\s\S]*relative_path: safeEvidencePath\(root, databasePath/)
  assert.doesNotMatch(rollbackDrillScript, /database:\s*\{[\s\S]*path: databasePath/)

  const restoreMain = rollbackRestoreScript.slice(rollbackRestoreScript.indexOf('Push-Location $repoRoot'))
  const imageVerification = restoreMain.indexOf('Backend rollback image verification')
  const composeValidation = restoreMain.indexOf('Archived Docker Compose validation')
  const currentCapture = restoreMain.indexOf("Get-RunningServiceEvidence -Service 'backend'")
  const currentShutdown = restoreMain.indexOf('Current Docker shutdown')
  const compensationBackup = restoreMain.indexOf('Pre-rollback compensation backup')
  const rollbackRestore = restoreMain.indexOf('Rollback data restore')
  assert.ok(
    imageVerification >= 0
      && imageVerification < currentCapture
      && currentCapture < composeValidation
      && composeValidation < currentShutdown
      && currentCapture < currentShutdown
      && currentShutdown < compensationBackup
      && compensationBackup < rollbackRestore,
  )
})

test('rollback restore captures the running container ID needed for compensation', () => {
  const evidenceFunction = rollbackRestoreScript.slice(
    rollbackRestoreScript.indexOf('function Get-RunningServiceEvidence'),
    rollbackRestoreScript.indexOf('function Test-ApplicationHealth'),
  )

  assert.match(evidenceFunction, /container_id\s*=\s*\$containerId/)
  assert.match(rollbackRestoreScript, /Get-ContainerBindSource -ContainerId \$currentBackend\.container_id/)
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

test('release workflow separates read-only build, artifact verification and publishing', () => {
  assert.match(workflow, /^permissions:\r?\n  contents: read$/m)
  const build = jobBlock('build-windows')
  const artifactScan = jobBlock('scan-windows-artifacts')
  const trivyScan = jobBlock('scan-trivy-artifacts')
  const artifactVerification = jobBlock('verify-artifacts')
  const publish = jobBlock('publish-release')

  assert.match(build, /needs: production-e2e/)
  assert.match(build, /permissions:\r?\n      contents: read/)
  assert.doesNotMatch(build, /contents: write|GH_TOKEN|action-gh-release|attest-build-provenance/)
  assert.match(build, /npm run dist/)
  assert.match(build, /npm run package:unpacked/)
  assert.match(build, /writeReleaseSboms/)
  assert.match(build, /verify-package[\s\S]*verify-payload[\s\S]*verify-tools/)
  assert.match(build, /windows-release-unverified-/)
  assert.doesNotMatch(build, /release:manifest|record:artifact-security/)
  assert.doesNotMatch(build, /choco install|Get-FileHash/)

  assert.match(artifactScan, /needs: build-windows/)
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

  assert.match(trivyScan, /needs: \[build-windows, scan-windows-artifacts\]/)
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
  assert.match(
    trivyScan,
    /windows-release-security-evidence-[\s\S]*path: desktop\/release\/\.artifact-scan[\s\S]*mark trivy "\$version"/,
  )
  assert.match(trivyScan, /run_trivy --version --format json/)
  assert.match(trivyScan, /cat \/root\/\.cache\/trivy\/policy\/metadata\.json/)
  assert.match(trivyScan, /mark trivy "\$version" "\$version_metadata" "\$policy_metadata"/)
  assert.match(trivyScan, /mark trivy "\$version"[\s\S]*record:artifact-security[\s\S]*release:manifest[\s\S]*verify:release:artifacts/)
  assert.match(trivyScan, /desktop\/release\/release-manifest\.json/)
  assert.match(trivyScan, /desktop\/release\/SHA256SUMS/)
  assert.doesNotMatch(trivyScan, /contents: write|attest-build-provenance|action-gh-release/)
  assert.match(
    windowsArtifactVerifierSource,
    /source_artifact_sha256: sourceArtifactHashes\(packageJson\.version, releaseRoot\)/,
  )
  assert.match(
    windowsArtifactVerifierSource,
    /function recordArtifactSecurity\(\)[\s\S]*sourceDirectory: releaseRoot[\s\S]*source_artifact_sha256: inventory\.source_artifact_sha256/,
  )

  assert.match(artifactVerification, /needs: scan-trivy-artifacts/)
  assert.match(artifactVerification, /npm run verify:release:artifacts/)
  assert.match(artifactVerification, /attestations: write/)
  assert.match(artifactVerification, /id-token: write/)

  assert.match(publish, /needs: \[production-e2e, scan-trivy-artifacts, verify-artifacts\]/)
  assert.match(publish, /permissions:\r?\n      contents: write/)
  assert.match(publish, /softprops\/action-gh-release@[a-f0-9]{40}/)
  for (const block of [trivyScan, artifactVerification, publish]) {
    assert.doesNotMatch(block, /desktop\/release\/\*\.zip/)
    assert.match(block, /desktop\/release\/LocalMiniDrama-Unpacked-\*-x64\.zip/)
  }
  assert.doesNotMatch(publish, /electron-builder|npm run dist/)
})

test('third-party workflow actions are pinned to full commit digests', () => {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1])
  assert.ok(uses.length > 0)
  for (const action of uses) assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${action} is not commit-pinned`)
})

test('release workflow uses the Node 20 baseline from CI', () => {
  const setupNodeActions = [...workflow.matchAll(/^\s*- uses: actions\/setup-node@[a-f0-9]{40}/gm)]
  const nodeVersions = [...workflow.matchAll(/^\s+node-version:\s*['"]?(\d+)['"]?\s*$/gm)]
    .map((match) => match[1])

  assert.ok(setupNodeActions.length > 0)
  assert.equal(nodeVersions.length, setupNodeActions.length, 'every setup-node action must declare a Node version')
  assert.deepEqual([...new Set(nodeVersions)], ['20'])
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
  assert.doesNotMatch(desktopJob, /release-manifest\.json|SHA256SUMS/)
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

test('source secret scanning uses exact generated-output paths and historical fingerprints', () => {
  assert.deepEqual(parseToml(sourceGitleaksConfig), {
    extend: { useDefault: true },
    allowlist: {
      description: 'Generated outputs and local runtime data are scanned by separate artifact gates',
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
  ])
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
