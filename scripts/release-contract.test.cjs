'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  artifactInventory,
  expectedChecksumText,
  expectedReleaseArtifactNames,
  verify,
} = require('./generate-release-metadata.cjs')
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
const { getTrustedMediaToolRelease } = require('../desktop/scripts/media-tool-policy')
const { FUSE_POLICY } = require('../desktop/scripts/electron-fuses')

const root = path.resolve(__dirname, '..')
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8')
const backendTrivyIgnore = fs.readFileSync(path.join(root, 'backend-node', '.trivyignore.yaml'), 'utf8')
const ciWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const releaseVerifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-release.cjs'), 'utf8')
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

function passedArtifactSecurity(version) {
  return {
    schema: 'localminidrama.artifact-security.v1',
    version,
    commit: 'a'.repeat(40),
    generated_at: '2026-07-17T00:00:00.000Z',
    source_artifacts: [
      `LocalMiniDrama-Portable-${version}-x64.exe`,
      `LocalMiniDrama-Setup-${version}-x64.exe`,
      `LocalMiniDrama-Unpacked-${version}-x64.zip`,
    ],
    extracted_applications: 3,
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
      fs.writeFileSync(filePath, `${JSON.stringify(passedArtifactSecurity(version), null, 2)}\n`)
    } else if (name.endsWith('.cdx.json')) {
      fs.writeFileSync(filePath, `${JSON.stringify({ bomFormat: 'CycloneDX', components: [] })}\n`)
    } else {
      fs.writeFileSync(filePath, `fixture:${name}\n`)
    }
  }

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
  assert.match(artifactScan, /aquasecurity\/setup-trivy@[a-f0-9]{40}/)
  assert.match(artifactScan, /DA6458E8864AF553807DE1C46A7A8EAC0880BD6B99BA56288E87E86A45AF884F/)
  assert.match(artifactScan, /gitleaks dir desktop\/release --config \.gitleaks-artifacts\.toml/)
  assert.doesNotMatch(artifactScan, /gitleaks dir desktop\/release --config \.gitleaks\.toml/)
  assert.match(artifactScan, /LocalMiniDrama-\$desktopVersion\.cdx\.json/)
  for (const name of ['sbom-backend.cdx.json', 'sbom-frontend.cdx.json', 'sbom-desktop.cdx.json']) {
    assert.match(artifactScan, new RegExp(name.replaceAll('.', '\\.')))
  }
  assert.match(artifactScan, /trivy sbom[\s\S]*trivy config/)
  for (const name of ['backend-node/Dockerfile', 'frontweb/Dockerfile', 'frontweb/Dockerfile.prod']) {
    assert.match(artifactScan, new RegExp(name.replaceAll('.', '\\.')))
  }
  assert.doesNotMatch(artifactScan, /--scanners misconfig desktop\/release\/\.artifact-scan/)
  assert.doesNotMatch(artifactScan, /--scanners vuln,misconfig desktop\/release\/\.artifact-scan/)
  assert.match(artifactScan, /--ignorefile backend-node\/\.trivyignore\.yaml backend-node\/Dockerfile/)
  assert.match(backendTrivyIgnore, /id:\s*AVD-DS-0002/)
  assert.match(backendTrivyIgnore, /paths:\s*\r?\n\s*- Dockerfile/)
  assert.match(backendTrivyIgnore, /expired_at:\s*2027-07-17/)
  assert.match(backendTrivyIgnore, /setpriv/)
  assert.match(artifactScan, /gitleaks[\s\S]*trivy sbom[\s\S]*MpCmdRun\.exe[\s\S]*record:artifact-security[\s\S]*release:manifest/)
  assert.match(artifactScan, /prepare:artifact-scan/)
  assert.doesNotMatch(artifactScan, /contents: write|attest-build-provenance|action-gh-release/)

  assert.match(artifactVerification, /needs: scan-windows-artifacts/)
  assert.match(artifactVerification, /npm run verify:release:artifacts/)
  assert.match(artifactVerification, /attestations: write/)
  assert.match(artifactVerification, /id-token: write/)

  assert.match(publish, /needs: \[production-e2e, scan-windows-artifacts, verify-artifacts\]/)
  assert.match(publish, /permissions:\r?\n      contents: write/)
  assert.match(publish, /softprops\/action-gh-release@[a-f0-9]{40}/)
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
  const productionStartup = sourceVerification.indexOf("['compose', '--profile', 'e2e', 'up'")
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

  const executable = path.join(fixture.output, `LocalMiniDrama-Portable-${fixture.version}-x64.exe`)
  fs.appendFileSync(executable, 'tampered')
  assert.throws(() => verify(fixture.output, { environment: {} }), /byte count does not match manifest|SHA-256 does not match/)

  fs.writeFileSync(executable, `fixture:LocalMiniDrama-Portable-${fixture.version}-x64.exe\n`)
  fs.appendFileSync(path.join(fixture.output, 'SHA256SUMS'), `${'0'.repeat(64)}  unexpected.exe\n`)
  assert.throws(() => verify(fixture.output, { environment: {} }), /SHA256SUMS does not exactly match/)
})
