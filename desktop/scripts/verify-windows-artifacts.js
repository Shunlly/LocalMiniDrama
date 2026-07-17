'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const { archive } = require('app-builder-lib/out/targets/archive');
const packageJson = require('../package.json');
const { FUSE_POLICY } = require('./electron-fuses');

const desktopRoot = path.join(__dirname, '..');
const repoRoot = path.join(desktopRoot, '..');
const releaseRoot = path.join(desktopRoot, 'release');
const scanRoot = path.join(releaseRoot, '.artifact-scan');
const scanEvidenceRoot = path.join(scanRoot, '.evidence');
const fuseCli = path.join(path.dirname(require.resolve('@electron/fuses')), 'bin.js');
const REQUIRED_SCANNERS = Object.freeze(['gitleaks', 'trivy', 'defender']);

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
  for (const line of String(output || '').split(/\r?\n/)) {
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
  fs.rmSync(output, { force: true });
  await archive('zip', output, unpackedDirectory, { compression: 'normal' });
  assert.ok(fs.statSync(output).size > 0, 'Unpacked release archive is empty');
  return output;
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
  assert.ok(applications.length >= 3, `Expected packaged applications from Setup, Portable, and Unpacked; found ${applications.length}`);
  for (const application of applications) assertFusePolicy(application.executable);
  const inventory = {
    schema: 'localminidrama.artifact-scan-inventory.v1',
    version: packageJson.version,
    source_artifacts: Object.values(names),
    packaged_applications: applications.map((entry) => ({
      executable: path.relative(scanRoot, entry.executable).replace(/\\/g, '/'),
      asar: path.relative(scanRoot, entry.asarPath).replace(/\\/g, '/'),
    })),
  };
  fs.writeFileSync(path.join(scanRoot, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return inventory;
}

function currentCommit() {
  return run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, timeout: 30000 }).trim();
}

function recordScanPass(scanner, version) {
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
  fs.writeFileSync(path.join(scanEvidenceRoot, `${scanner}.json`), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return marker;
}

function readScanPass(scanner, commit) {
  const markerPath = path.join(scanEvidenceRoot, `${scanner}.json`);
  assert.ok(fs.statSync(markerPath, { throwIfNoEntry: false })?.isFile(), `${scanner} scan pass marker is missing`);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.schema, 'localminidrama.artifact-scan-pass.v1', `${scanner} marker schema is invalid`);
  assert.equal(marker.scanner, scanner, `${scanner} marker scanner is invalid`);
  assert.equal(marker.status, 'passed', `${scanner} scan did not pass`);
  assert.equal(marker.commit, commit, `${scanner} scan was not run against the current commit`);
  assert.match(String(marker.version || ''), /^[A-Za-z0-9][A-Za-z0-9._+() /:-]{0,127}$/, `${scanner} version is invalid`);
  assert.ok(Number.isFinite(Date.parse(marker.generated_at)), `${scanner} marker timestamp is invalid`);
  return marker;
}

function recordArtifactSecurity() {
  const inventory = JSON.parse(fs.readFileSync(path.join(scanRoot, 'inventory.json'), 'utf8'));
  const applications = findPackagedApplications(scanRoot);
  for (const application of applications) assertFusePolicy(application.executable);
  const commit = currentCommit();
  const scanPasses = Object.fromEntries(REQUIRED_SCANNERS.map((scanner) => [scanner, readScanPass(scanner, commit)]));
  const evidence = {
    schema: 'localminidrama.artifact-security.v1',
    version: packageJson.version,
    commit,
    generated_at: new Date().toISOString(),
    source_artifacts: inventory.source_artifacts,
    extracted_applications: applications.length,
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
        configuration_exceptions: [{
          id: 'AVD-DS-0002',
          path: 'backend-node/Dockerfile',
          review_by: '2027-07-17',
          rationale: 'The entrypoint repairs bind-mounted data ownership before immediately executing as node via setpriv.',
        }],
      },
      defender: {
        version: scanPasses.defender.version,
        status: 'passed',
        generated_at: scanPasses.defender.generated_at,
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
  if (mode === 'mark') return recordScanPass(args[1], args[2]);
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
  parseFuseReport,
  prepareArtifactScan,
  recordArtifactSecurity,
  recordScanPass,
};
