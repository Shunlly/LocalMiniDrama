'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const asar = require('@electron/asar');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { archive } = require('app-builder-lib/out/targets/archive');
const packageJson = require('../package.json');
const { FUSE_POLICY } = require('./electron-fuses');
const mediaToolPolicy = require('./media-tool-policy');
const {
  DEFENDER_SIGNATURE_MAX_AGE_HOURS,
  normalizeDefenderSignatureDetails,
  validateDefenderSignatureDetails,
} = require('./defender-signature-policy');
const {
  EXPECTED_PACKAGED_APPLICATION_ROOTS,
  validatePackagedApplications,
} = require('../../scripts/packaged-applications-contract.cjs');
const {
  EXPECTED_EXAMPLE_DRAMA,
  verifyExampleDrama,
} = require('../../scripts/example-drama-contract.cjs');

const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..');
const releaseRoot = path.join(desktopRoot, 'release');
const scanRoot = path.join(releaseRoot, '.artifact-scan');
const scanEvidenceRoot = path.join(scanRoot, '.evidence');
const fuseCli = path.join(path.dirname(require.resolve('@electron/fuses')), 'bin.js');
const REQUIRED_SCANNERS = Object.freeze(['gitleaks', 'trivy', 'defender']);
const BACKEND_RUNTIME_BASE =
  'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';
const BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE =
  'Trivy evaluates Dockerfile Config.User before the reviewed entrypoint transition. The pinned Node runtime maps node to UID 1000; after a same-filesystem one-time ownership migration, the entrypoint replaces PID 1 with the requested command under that account. Release evidence validation rejects any change to this source contract.';
const BACKEND_CONTAINER_USER_SOURCE_SHA256_LF = Object.freeze({
  'backend-node/Dockerfile': 'be1f4f77bff7fd9a094772041a04cace503fb48fbca2cc1775d5c55dc84270e4',
  'backend-node/docker-entrypoint.sh': 'e1bc2719bf21da00095f0380576092dcc590838fd8e02c88455dc98a2a79d972',
  'backend-node/.trivyignore.yaml': '97f051b0f207fd354177c36671085f974f6d1a481b438e247889df58609485e4',
});

function artifactNames(version = packageJson.version) {
  return {
    portable: `LocalMiniDrama-Portable-${version}-x64.exe`,
    setup: `LocalMiniDrama-Setup-${version}-x64.exe`,
    unpacked: `LocalMiniDrama-Unpacked-${version}-x64.zip`,
  };
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 10 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status}): ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout || '');
}

function parseFuseReport(output) {
  const states = {};
  const normalizedOutput = stripVTControlCharacters(String(output || ''));
  for (const line of normalizedOutput.split(/\r?\n/)) {
    const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9]+) is (Enabled|Disabled|Removed)$/);
    if (match) states[match[1]] = match[2];
  }
  return states;
}

function assertFusePolicy(executable) {
  const output = run(process.execPath, [fuseCli, 'read', '--app', executable], { timeout: 30000 });
  const states = parseFuseReport(output);
  assert.deepEqual(
    Object.keys(states).sort(),
    Object.keys(FUSE_POLICY).sort(),
    `Packaged Electron fuse inventory is incomplete: ${JSON.stringify(states)}`
  );
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    assert.equal(states[name], enabled ? 'Enabled' : 'Disabled', `${name} does not match the release fuse policy`);
  }
  return states;
}

function normalizedSourceSha256(source, label) {
  assert.equal(typeof source, 'string', `${label} source is unavailable`);
  const normalized = source.replace(/\r\n/g, '\n');
  assert.doesNotMatch(normalized, /\r/, `${label} contains unsupported carriage returns`);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function createBackendContainerUserException({
  dockerfileSource = fs.readFileSync(path.join(repoRoot, 'backend-node', 'Dockerfile'), 'utf8'),
  entrypointSource = fs.readFileSync(path.join(repoRoot, 'backend-node', 'docker-entrypoint.sh'), 'utf8'),
  ignorePolicySource = fs.readFileSync(path.join(repoRoot, 'backend-node', '.trivyignore.yaml'), 'utf8'),
} = {}) {
  const sourceSha256Lf = {
    'backend-node/Dockerfile': normalizedSourceSha256(dockerfileSource, 'backend-node/Dockerfile'),
    'backend-node/docker-entrypoint.sh': normalizedSourceSha256(
      entrypointSource,
      'backend-node/docker-entrypoint.sh'
    ),
    'backend-node/.trivyignore.yaml': normalizedSourceSha256(
      ignorePolicySource,
      'backend-node/.trivyignore.yaml'
    ),
  };
  assert.deepEqual(
    sourceSha256Lf,
    BACKEND_CONTAINER_USER_SOURCE_SHA256_LF,
    'backend container user source contract changed; review or remove the Trivy exception'
  );
  return {
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
  };
}

function sha256(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function sourceArtifactHashes(version, sourceDirectory) {
  return Object.fromEntries(Object.values(artifactNames(version)).map((name) => {
    const filePath = path.join(sourceDirectory, name);
    assert.ok(fs.statSync(filePath, { throwIfNoEntry: false })?.isFile(), `${name} is missing`);
    return [name, sha256(filePath)];
  }));
}

function verifyPackagedExampleApplications(applications, scanRoot, expected = EXPECTED_EXAMPLE_DRAMA) {
  validatePackagedApplications(applications, expected);
  const resolvedScanRoot = path.resolve(scanRoot);
  return applications.map((application) => {
    const resourcesRoot = path.resolve(resolvedScanRoot, path.dirname(application.asar));
    const verified = verifyExampleDrama(resourcesRoot, expected);
    return {
      path: path.relative(resolvedScanRoot, verified.absolutePath).replace(/\\/g, '/'),
      bytes: verified.bytes,
      sha256: verified.sha256,
    };
  });
}

function assertPhysicalPathWithinRoot(root, candidate, label, expectedKind) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const lexicalRelative = path.relative(resolvedRoot, resolvedCandidate);
  assert.ok(
    lexicalRelative && !lexicalRelative.startsWith(`..${path.sep}`) && lexicalRelative !== '..' && !path.isAbsolute(lexicalRelative),
    `${label} path escapes the scan root`
  );

  const pathsToInspect = [resolvedRoot];
  let current = resolvedRoot;
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    pathsToInspect.push(current);
  }
  for (const inspectedPath of pathsToInspect) {
    const entry = fs.lstatSync(inspectedPath, { throwIfNoEntry: false });
    assert.ok(entry, `${label} path is missing: ${inspectedPath}`);
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `${label} path contains a symbolic link or reparse point: ${inspectedPath}`
    );
  }

  const physicalRoot = fs.realpathSync.native(resolvedRoot);
  const physicalCandidate = fs.realpathSync.native(resolvedCandidate);
  const physicalRelative = path.relative(physicalRoot, physicalCandidate);
  assert.ok(
    physicalRelative && !physicalRelative.startsWith(`..${path.sep}`) && physicalRelative !== '..' && !path.isAbsolute(physicalRelative),
    `${label} physical path escapes the scan root`
  );
  const candidateEntry = fs.lstatSync(resolvedCandidate);
  if (expectedKind === 'directory') assert.equal(candidateEntry.isDirectory(), true, `${label} must be a directory`);
  if (expectedKind === 'file') assert.equal(candidateEntry.isFile(), true, `${label} must be a regular file`);
  return physicalCandidate;
}

function verifyPackagedMediaTools(applications, scanRoot, expectedExampleDrama = EXPECTED_EXAMPLE_DRAMA) {
  validatePackagedApplications(applications, expectedExampleDrama);
  const resolvedScanRoot = path.resolve(scanRoot);
  const platform = 'win32';
  const arch = 'x64';
  const release = mediaToolPolicy.getTrustedMediaToolRelease(platform, arch);
  const physicalResourcesRoots = new Set();
  const physicalMediaRoots = new Set();

  for (const application of applications) {
    const resourcesRoot = path.resolve(resolvedScanRoot, path.dirname(application.asar));
    const mediaRoot = path.join(resourcesRoot, 'ffmpeg');
    const physicalResourcesRoot = assertPhysicalPathWithinRoot(
      resolvedScanRoot,
      resourcesRoot,
      'Packaged resources',
      'directory'
    );
    const physicalMediaRoot = assertPhysicalPathWithinRoot(
      resolvedScanRoot,
      mediaRoot,
      'Packaged media directory',
      'directory'
    );
    assert.equal(
      physicalResourcesRoots.has(physicalResourcesRoot),
      false,
      'Packaged application resources roots must be physically distinct'
    );
    assert.equal(
      physicalMediaRoots.has(physicalMediaRoot),
      false,
      'Packaged application media roots must be physically distinct'
    );
    physicalResourcesRoots.add(physicalResourcesRoot);
    physicalMediaRoots.add(physicalMediaRoot);
    for (const expectedName of ['ffmpeg', 'ffprobe']) {
      const executable = path.join(mediaRoot, release.tools[expectedName].fileName);
      assertPhysicalPathWithinRoot(resolvedScanRoot, executable, `Packaged ${expectedName}`, 'file');
      mediaToolPolicy.assertTrustedMediaToolFile(expectedName, executable, platform, arch);
    }
  }
  return applications;
}

function validateArtifactScanInventory(inventory, version = packageJson.version, options = {}) {
  assert.equal(inventory?.schema, 'localminidrama.artifact-scan-inventory.v1', 'Artifact scan inventory schema is invalid');
  assert.equal(inventory.version, version, 'Artifact scan inventory version is invalid');
  const expectedArtifacts = Object.values(artifactNames(version));
  assert.deepEqual(inventory.source_artifacts, expectedArtifacts, 'Artifact scan source inventory is invalid');
  assert.deepEqual(
    Object.keys(inventory.source_artifact_sha256 || {}),
    expectedArtifacts,
    'Artifact scan source hash inventory is invalid'
  );
  for (const [name, digest] of Object.entries(inventory.source_artifact_sha256 || {})) {
    assert.match(String(digest), /^[a-f0-9]{64}$/, `${name} source artifact SHA-256 is invalid`);
  }
  if (options.sourceDirectory) {
    assert.deepEqual(
      inventory.source_artifact_sha256,
      sourceArtifactHashes(version, options.sourceDirectory),
      'Artifact scan source bytes do not match the Windows scan inventory'
    );
  }
  validatePackagedApplications(inventory.packaged_applications, options.expectedExampleDrama);
  if (options.scanRoot) {
    verifyPackagedMediaTools(inventory.packaged_applications, options.scanRoot, options.expectedExampleDrama);
    assert.deepEqual(
      inventory.packaged_applications.map((application) => application.example_drama),
      verifyPackagedExampleApplications(inventory.packaged_applications, options.scanRoot, options.expectedExampleDrama),
      'Artifact scan example drama bytes do not match the Windows scan inventory'
    );
  }
  return inventory;
}

function findPackagedApplications(root) {
  const applications = [];
  for (const asarPath of walkFiles(root).filter((file) => path.basename(file).toLowerCase() === 'app.asar')) {
    const resources = path.dirname(asarPath);
    const appDirectory = path.dirname(resources);
    const executables = fs.readdirSync(appDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !/^unins/i.test(entry.name))
      .map((entry) => path.join(appDirectory, entry.name));
    if (executables.length === 1) applications.push({ asarPath, executable: executables[0] });
  }
  return applications;
}

async function packageUnpacked() {
  if (process.platform !== 'win32') throw new Error('Windows unpacked packaging requires Windows');
  const unpackedDirectory = path.join(releaseRoot, 'win-unpacked');
  const executable = require('./electron-fuses').findWindowsExecutable(unpackedDirectory);
  assertFusePolicy(executable);
  const output = path.join(releaseRoot, artifactNames().unpacked);
  await createVerifiedZip(unpackedDirectory, output);
  assert.ok(fs.statSync(output).size > 0, 'Unpacked release archive is empty');
  return output;
}

async function createVerifiedZip(source, output, runtime = {}) {
  const archiveWriter = runtime.archiveWriter || archive;
  const sevenZip = runtime.sevenZip || await getPath7za();
  const runCommand = runtime.runCommand || run;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fs.rmSync(output, { force: true });
    await archiveWriter('zip', output, source, { compression: 'normal' });
    try {
      runCommand(sevenZip, ['t', '-bd', output]);
      return { output, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }

  fs.rmSync(output, { force: true });
  throw new Error(`Unpacked release archive failed CRC validation after two attempts: ${lastError?.message || 'unknown error'}`);
}

async function extractArchive(sevenZip, source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  run(sevenZip, ['x', '-bd', '-y', source, `-o${destination}`]);
}

async function expandNestedArchives(sevenZip, root) {
  const processed = new Set();
  for (;;) {
    const pending = walkFiles(root)
      .filter((file) => file.toLowerCase().endsWith('.7z') && !processed.has(file));
    if (!pending.length) break;
    if (processed.size + pending.length > 100) throw new Error('Artifact scan archive nesting exceeds the safety limit');
    for (const archivePath of pending) {
      processed.add(archivePath);
      await extractArchive(sevenZip, archivePath, `${archivePath}.contents`);
    }
  }
}

function expandAsars(root) {
  const archives = walkFiles(root).filter((file) => file.toLowerCase().endsWith('.asar'));
  for (const archivePath of archives) {
    const destination = `${archivePath}.contents`;
    fs.rmSync(destination, { recursive: true, force: true });
    asar.extractAll(archivePath, destination);
  }
  return archives.length;
}

async function prepareArtifactScan() {
  if (process.platform !== 'win32') throw new Error('Windows artifact extraction requires Windows');
  const names = artifactNames();
  for (const name of Object.values(names)) {
    assert.ok(fs.statSync(path.join(releaseRoot, name), { throwIfNoEntry: false })?.isFile(), `${name} is missing`);
  }
  fs.rmSync(scanRoot, { recursive: true, force: true });
  fs.mkdirSync(scanRoot, { recursive: true });
  const sevenZip = await getPath7za();
  for (const [kind, name] of Object.entries(names)) {
    const destination = path.join(scanRoot, kind);
    await extractArchive(sevenZip, path.join(releaseRoot, name), destination);
    await expandNestedArchives(sevenZip, destination);
    expandAsars(destination);
  }
  const applications = findPackagedApplications(scanRoot);
  assert.equal(applications.length, EXPECTED_PACKAGED_APPLICATION_ROOTS.length,
    `Expected exactly one packaged application from Setup, Portable, and Unpacked; found ${applications.length}`);
  const inventory = {
    schema: 'localminidrama.artifact-scan-inventory.v1',
    version: packageJson.version,
    source_artifacts: Object.values(names),
    source_artifact_sha256: sourceArtifactHashes(packageJson.version, releaseRoot),
    packaged_applications: applications.map((entry) => {
      const verifiedExampleDrama = verifyExampleDrama(path.dirname(entry.asarPath));
      return {
        executable: path.relative(scanRoot, entry.executable).replace(/\\/g, '/'),
        asar: path.relative(scanRoot, entry.asarPath).replace(/\\/g, '/'),
        example_drama: {
          path: path.relative(scanRoot, verifiedExampleDrama.absolutePath).replace(/\\/g, '/'),
          bytes: verifiedExampleDrama.bytes,
          sha256: verifiedExampleDrama.sha256,
        },
        fuses: assertFusePolicy(entry.executable),
      };
    }),
  };
  validateArtifactScanInventory(inventory, packageJson.version, {
    sourceDirectory: releaseRoot,
    scanRoot,
  });
  fs.writeFileSync(path.join(scanRoot, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return inventory;
}

function currentCommit() {
  return run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, timeout: 30000 }).trim();
}

function parseJsonArgument(value, label) {
  try {
    return JSON.parse(String(value || ''));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateTrivyScanDetails(details, expectedVersion) {
  assert.equal(details?.version, expectedVersion, 'Trivy metadata version is invalid');
  assert.ok(Number.isInteger(details?.vulnerability_database?.schema_version), 'Trivy DB schema version is invalid');
  assert.ok(details.vulnerability_database.schema_version > 0, 'Trivy DB schema version is invalid');
  assert.ok(Number.isFinite(Date.parse(details.vulnerability_database.updated_at)), 'Trivy DB updated_at is invalid');
  assert.ok(Number.isFinite(Date.parse(details.vulnerability_database.next_update)), 'Trivy DB next_update is invalid');
  assert.match(
    String(details?.checks_bundle?.digest || ''),
    /^sha256:[a-f0-9]{64}$/,
    'Trivy checks bundle digest is invalid'
  );
  assert.ok(Number.isFinite(Date.parse(details.checks_bundle.downloaded_at)), 'Trivy checks bundle downloaded_at is invalid');
  return details;
}

function normalizeTrivyScanDetails(versionMetadata, policyMetadata, expectedVersion) {
  const versionInfo = typeof versionMetadata === 'string'
    ? parseJsonArgument(versionMetadata, 'Trivy version metadata')
    : versionMetadata;
  const policyInfo = typeof policyMetadata === 'string'
    ? parseJsonArgument(policyMetadata, 'Trivy policy metadata')
    : policyMetadata;
  return validateTrivyScanDetails({
    version: versionInfo?.Version,
    vulnerability_database: {
      schema_version: versionInfo?.VulnerabilityDB?.Version,
      updated_at: versionInfo?.VulnerabilityDB?.UpdatedAt,
      next_update: versionInfo?.VulnerabilityDB?.NextUpdate,
    },
    checks_bundle: {
      digest: policyInfo?.Digest,
      downloaded_at: policyInfo?.DownloadedAt,
    },
  }, expectedVersion);
}

function recordScanPass(scanner, version, versionMetadata, policyMetadata) {
  assert.ok(REQUIRED_SCANNERS.includes(scanner), `Unsupported artifact scanner: ${scanner}`);
  const normalizedVersion = String(version || '').trim();
  assert.match(normalizedVersion, /^[A-Za-z0-9][A-Za-z0-9._+() /:-]{0,127}$/, `${scanner} version is invalid`);
  fs.mkdirSync(scanEvidenceRoot, { recursive: true });
  const marker = {
    schema: 'localminidrama.artifact-scan-pass.v1',
    scanner,
    version: normalizedVersion,
    status: 'passed',
    commit: currentCommit(),
    generated_at: new Date().toISOString(),
  };
  if (scanner === 'trivy') {
    marker.details = normalizeTrivyScanDetails(versionMetadata, policyMetadata, normalizedVersion);
  } else if (scanner === 'defender') {
    assert.equal(policyMetadata, undefined, 'defender policy metadata is not supported');
    marker.details = normalizeDefenderSignatureDetails(versionMetadata);
  } else {
    assert.equal(versionMetadata, undefined, `${scanner} scan metadata is not supported`);
    assert.equal(policyMetadata, undefined, `${scanner} policy metadata is not supported`);
  }
  fs.writeFileSync(path.join(scanEvidenceRoot, `${scanner}.json`), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return marker;
}

function validateScanPassMarker(marker, scanner, commit, options = {}) {
  assert.equal(marker.schema, 'localminidrama.artifact-scan-pass.v1', `${scanner} marker schema is invalid`);
  assert.equal(marker.scanner, scanner, `${scanner} marker scanner is invalid`);
  assert.equal(marker.status, 'passed', `${scanner} scan did not pass`);
  assert.equal(marker.commit, commit, `${scanner} scan was not run against the current commit`);
  assert.match(String(marker.version || ''), /^[A-Za-z0-9][A-Za-z0-9._+() /:-]{0,127}$/, `${scanner} version is invalid`);
  assert.ok(Number.isFinite(Date.parse(marker.generated_at)), `${scanner} marker timestamp is invalid`);
  if (scanner === 'trivy') validateTrivyScanDetails(marker.details, marker.version);
  else if (scanner === 'defender') validateDefenderSignatureDetails(marker.details, options);
  else assert.equal(marker.details, undefined, `${scanner} marker contains unsupported metadata`);
  return marker;
}

function readScanPass(scanner, commit) {
  const markerPath = path.join(scanEvidenceRoot, `${scanner}.json`);
  assert.ok(fs.statSync(markerPath, { throwIfNoEntry: false })?.isFile(), `${scanner} scan pass marker is missing`);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  return validateScanPassMarker(marker, scanner, commit);
}

function recordArtifactSecurity() {
  const inventory = validateArtifactScanInventory(
    JSON.parse(fs.readFileSync(path.join(scanRoot, 'inventory.json'), 'utf8')),
    packageJson.version,
    { sourceDirectory: releaseRoot, scanRoot }
  );
  const commit = currentCommit();
  const scanPasses = Object.fromEntries(REQUIRED_SCANNERS.map((scanner) => [scanner, readScanPass(scanner, commit)]));
  const evidence = {
    schema: 'localminidrama.artifact-security.v1',
    version: packageJson.version,
    commit,
    generated_at: new Date().toISOString(),
    source_artifacts: inventory.source_artifacts,
    source_artifact_sha256: inventory.source_artifact_sha256,
    extracted_applications: inventory.packaged_applications.length,
    packaged_applications: inventory.packaged_applications,
    fuses: FUSE_POLICY,
    scans: {
      gitleaks: { version: scanPasses.gitleaks.version, status: 'passed', generated_at: scanPasses.gitleaks.generated_at },
      trivy: {
        version: scanPasses.trivy.version,
        status: 'passed',
        generated_at: scanPasses.trivy.generated_at,
        threshold: 'HIGH,CRITICAL',
        ignore_unfixed: true,
        scope: 'release CycloneDX SBOMs and source Dockerfiles',
        configuration_files: [
          'backend-node/Dockerfile',
          'frontweb/Dockerfile',
          'frontweb/Dockerfile.prod',
        ],
        configuration_exceptions: [createBackendContainerUserException()],
        vulnerability_database: scanPasses.trivy.details.vulnerability_database,
        checks_bundle: scanPasses.trivy.details.checks_bundle,
      },
      defender: {
        version: scanPasses.defender.version,
        status: 'passed',
        generated_at: scanPasses.defender.generated_at,
        antivirus_signature_last_updated: scanPasses.defender.details.antivirus_signature_last_updated,
        maximum_age_hours: scanPasses.defender.details.maximum_age_hours,
        scope: 'release bundle and extracted payloads',
      },
    },
  };
  assert.match(evidence.commit, /^[a-f0-9]{40,64}$/);
  fs.writeFileSync(path.join(releaseRoot, 'artifact-security.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

async function main(args = process.argv.slice(2)) {
  const mode = args[0];
  if (mode === 'package') return packageUnpacked();
  if (mode === 'prepare') return prepareArtifactScan();
  if (mode === 'mark') return recordScanPass(args[1], args[2], args[3], args[4]);
  if (mode === 'record') return recordArtifactSecurity();
  if (mode === 'fuses') {
    const executable = require('./electron-fuses').findWindowsExecutable(path.join(releaseRoot, 'win-unpacked'));
    return assertFusePolicy(executable);
  }
  throw new Error('Usage: verify-windows-artifacts.js <package|prepare|mark <scanner> <version>|record|fuses>');
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify({ mode: process.argv[2], result, verified: true })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  artifactNames,
  assertFusePolicy,
  createBackendContainerUserException,
  createVerifiedZip,
  DEFENDER_SIGNATURE_MAX_AGE_HOURS,
  normalizeDefenderSignatureDetails,
  parseFuseReport,
  prepareArtifactScan,
  validatePackagedApplications,
  recordArtifactSecurity,
  recordScanPass,
  normalizeTrivyScanDetails,
  validateDefenderSignatureDetails,
  validateScanPassMarker,
  validateArtifactScanInventory,
  verifyPackagedExampleApplications,
  verifyPackagedMediaTools,
};
