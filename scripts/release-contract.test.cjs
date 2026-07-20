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
  validateSbomDocument,
  verifyRemoteReleaseTag,
  writeReleaseSboms,
  writeSbomOutput,
} = require('./verify-release.cjs')
const { sanitizeRuntimeConfig, sanitizeRuntimeConfigFile } = require('./runtime-config-policy.cjs')
const { getTrustedMediaToolRelease } = require('../desktop/scripts/media-tool-policy')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')

const root = path.resolve(__dirname, '..')
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

function runRollbackPathProbe(scriptSource, statements) {
  const mainStart = scriptSource.indexOf('$repoRoot =')
  assert.ok(mainStart > 0, 'rollback script main entrypoint is missing')
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-rollback-path-probe-'))
  const probePath = path.join(fixtureRoot, 'probe.ps1')
  fs.writeFileSync(probePath, `${scriptSource.slice(0, mainStart)}\n${statements}\n`, 'utf8')
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
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v4/)
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
  assert.ok(
    currentCapture >= 0
      && currentCapture < currentDataCapture
      && currentDataCapture < physicalBoundary
      && physicalBoundary < composeValidation
      && composeValidation < imageLoad
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
  assert.match(checkpointScript, /localminidrama\.release-rollback-checkpoint\.v4/)
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
  assert.match(rollbackRestoreScript, /localminidrama\.release-rollback-checkpoint\.v4/)
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

  const restoreMain = rollbackRestoreScript.slice(rollbackRestoreScript.indexOf('Push-Location $repoRoot'))
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
    /Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Rollback image archive load[\s\S]*Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Current backend compensation tag[\s\S]*Assert-SafeRollbackPaths[^\r\n]*[\s\S]*Current Docker shutdown/,
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
    const guard = rollbackRestoreScript.lastIndexOf('Assert-SafeRollbackPaths', operation)
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
  assert.match(evidenceFunction, /compose', 'ps', '-a', '-q'/)
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
