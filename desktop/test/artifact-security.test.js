'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FUSE_POLICY } = require('../scripts/electron-fuses');
const {
  artifactNames,
  createVerifiedZip,
  normalizeTrivyScanDetails,
  parseFuseReport,
  validateArtifactScanInventory,
} = require('../scripts/verify-windows-artifacts');

function fuseStates() {
  return Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  );
}

function scanInventory(version = '1.3.0') {
  const sourceArtifacts = Object.values(artifactNames(version));
  return {
    schema: 'localminidrama.artifact-scan-inventory.v1',
    version,
    source_artifacts: sourceArtifacts,
    source_artifact_sha256: Object.fromEntries(sourceArtifacts.map((name) => [name, '0'.repeat(64)])),
    packaged_applications: ['setup', 'portable', 'unpacked'].map((kind) => ({
      executable: `${kind}/LocalMiniDrama.exe`,
      asar: `${kind}/resources/app.asar`,
      fuses: fuseStates(),
    })),
  };
}

test('release fuse report recognizes every Electron 43 fuse and its required state', () => {
  const lines = ['Analyzing app: LocalMiniDrama.exe', 'Fuse Version: v1'];
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    lines.push(`  ${name} is ${enabled ? 'Enabled' : 'Disabled'}`);
  }
  assert.deepEqual(parseFuseReport(lines.join('\n')), Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  ));
  assert.equal(Object.hasOwn(FUSE_POLICY, 'WasmTrapHandlers'), true);
  assert.equal(FUSE_POLICY.WasmTrapHandlers, false);
});

test('release fuse report ignores ANSI styling emitted by the Node 20 fuse CLI', () => {
  const lines = ['Analyzing app: \u001b[36mLocalMiniDrama.exe\u001b[39m', 'Fuse Version: \u001b[36mv1\u001b[39m'];
  for (const [name, enabled] of Object.entries(FUSE_POLICY)) {
    const state = enabled ? '\u001b[32mEnabled\u001b[39m' : '\u001b[31mDisabled\u001b[39m';
    lines.push(`  \u001b[33m${name}\u001b[39m is ${state}`);
  }
  assert.deepEqual(parseFuseReport(lines.join('\r\n')), Object.fromEntries(
    Object.entries(FUSE_POLICY).map(([name, enabled]) => [name, enabled ? 'Enabled' : 'Disabled'])
  ));
});

test('release scan requires Setup, Portable, and Unpacked artifacts from one version', () => {
  assert.deepEqual(artifactNames('1.3.0'), {
    portable: 'LocalMiniDrama-Portable-1.3.0-x64.exe',
    setup: 'LocalMiniDrama-Setup-1.3.0-x64.exe',
    unpacked: 'LocalMiniDrama-Unpacked-1.3.0-x64.zip',
  });
});

test('cross-run release inventory preserves source artifacts and verified fuse states', () => {
  const inventory = scanInventory();
  assert.equal(validateArtifactScanInventory(inventory, inventory.version), inventory);
});

test('cross-run release inventory rejects path traversal and tampered fuse evidence', () => {
  const traversal = scanInventory();
  traversal.packaged_applications[0].executable = '../LocalMiniDrama.exe';
  assert.throws(
    () => validateArtifactScanInventory(traversal, traversal.version),
    /must not escape the scan root/
  );

  const tamperedFuse = scanInventory();
  tamperedFuse.packaged_applications[0].fuses.RunAsNode = 'Enabled';
  assert.throws(
    () => validateArtifactScanInventory(tamperedFuse, tamperedFuse.version),
    /fuse evidence is invalid/
  );

  const duplicateSetup = scanInventory();
  duplicateSetup.packaged_applications[1].executable = 'setup/second/LocalMiniDrama.exe';
  duplicateSetup.packaged_applications[1].asar = 'setup/second/resources/app.asar';
  assert.throws(
    () => validateArtifactScanInventory(duplicateSetup, duplicateSetup.version),
    /cover Setup, Portable, and Unpacked exactly once/
  );

  const splitApplication = scanInventory();
  splitApplication.packaged_applications[0].asar = 'portable/resources/app.asar';
  assert.throws(
    () => validateArtifactScanInventory(splitApplication, splitApplication.version),
    /belong to different release artifacts/
  );
});

test('cross-run release inventory rejects source artifact bytes changed after Windows scans', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-scan-inventory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inventory = scanInventory();
  for (const name of inventory.source_artifacts) {
    const content = `verified:${name}\n`;
    fs.writeFileSync(path.join(directory, name), content);
    inventory.source_artifact_sha256[name] = crypto.createHash('sha256').update(content).digest('hex');
  }

  validateArtifactScanInventory(inventory, inventory.version, { sourceDirectory: directory });
  fs.appendFileSync(path.join(directory, inventory.source_artifacts[0]), 'tampered');
  assert.throws(
    () => validateArtifactScanInventory(inventory, inventory.version, { sourceDirectory: directory }),
    /source bytes do not match the Windows scan inventory/
  );
});

test('Trivy scan evidence records the vulnerability database and checks bundle identities', () => {
  assert.deepEqual(normalizeTrivyScanDetails({
    Version: '0.64.1',
    VulnerabilityDB: {
      Version: 2,
      UpdatedAt: '2026-07-17T13:09:25.875519042Z',
      NextUpdate: '2026-07-18T13:09:25.87551825Z',
    },
  }, {
    Digest: `sha256:${'a'.repeat(64)}`,
    DownloadedAt: '2026-07-17T17:36:34.087206269Z',
  }, '0.64.1'), {
    version: '0.64.1',
    vulnerability_database: {
      schema_version: 2,
      updated_at: '2026-07-17T13:09:25.875519042Z',
      next_update: '2026-07-18T13:09:25.87551825Z',
    },
    checks_bundle: {
      digest: `sha256:${'a'.repeat(64)}`,
      downloaded_at: '2026-07-17T17:36:34.087206269Z',
    },
  });
  assert.throws(
    () => normalizeTrivyScanDetails({ Version: '0.64.1', VulnerabilityDB: {} }, { Digest: 'latest' }, '0.64.1'),
    /Trivy DB schema version is invalid/
  );
});

test('Unpacked ZIP packaging retries a failed CRC test and accepts only a verified archive', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'candidate.zip');
  let writes = 0;
  let checks = 0;

  const result = await createVerifiedZip(directory, output, {
    sevenZip: '7za',
    archiveWriter: async (_format, archivePath) => {
      writes += 1;
      fs.writeFileSync(archivePath, `attempt-${writes}`);
    },
    runCommand: () => {
      checks += 1;
      if (checks === 1) throw new Error('CRC Failed');
    },
  });

  assert.equal(result.attempts, 2);
  assert.equal(writes, 2);
  assert.equal(checks, 2);
  assert.equal(fs.readFileSync(output, 'utf8'), 'attempt-2');
});

test('Unpacked ZIP packaging removes an archive that fails CRC validation twice', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-archive-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'candidate.zip');

  await assert.rejects(
    createVerifiedZip(directory, output, {
      sevenZip: '7za',
      archiveWriter: async (_format, archivePath) => fs.writeFileSync(archivePath, 'invalid'),
      runCommand: () => { throw new Error('CRC Failed'); },
    }),
    /failed CRC validation after two attempts/
  );
  assert.equal(fs.existsSync(output), false);
});
