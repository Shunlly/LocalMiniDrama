'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { removeFixtureTree } = require('./fixture-fs');
const { FUSE_POLICY } = require('../scripts/electron-fuses');
const mediaToolPolicy = require('../scripts/media-tool-policy');
const {
  artifactNames,
  createBackendContainerUserException,
  createVerifiedZip,
  DEFENDER_SIGNATURE_MAX_AGE_HOURS,
  normalizeTrivyScanDetails,
  normalizeDefenderSignatureDetails,
  parseFuseReport,
  validateDefenderSignatureDetails,
  validateScanPassMarker,
  validateArtifactScanInventory,
  verifyPackagedExampleApplications,
} = require('../scripts/verify-windows-artifacts');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendDockerfile = fs.readFileSync(path.join(repoRoot, 'backend-node', 'Dockerfile'), 'utf8');
const backendEntrypoint = fs.readFileSync(path.join(repoRoot, 'backend-node', 'docker-entrypoint.sh'), 'utf8');
const backendTrivyIgnore = fs.readFileSync(path.join(repoRoot, 'backend-node', '.trivyignore.yaml'), 'utf8');
const BACKEND_RUNTIME_BASE =
  'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';
const BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE =
  'Trivy evaluates Dockerfile Config.User before the reviewed entrypoint transition. The pinned Node runtime maps node to UID 1000; after a same-filesystem one-time ownership migration, the entrypoint replaces PID 1 with the requested command under that account. Release evidence validation rejects any change to this source contract.';

function normalizedSourceSha256(source) {
  return crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

const EXAMPLE_DRAMA_DESCRIPTOR = Object.freeze({
  path: 'resources/example_drama/衣服设计天才302.zip',
  bytes: 82156132,
  sha256: 'f2aa6ec793270761b295e5ccc1fa5adb367dd36937db99e0b064667d8bb592f9',
});
const FIXTURE_MEDIA_CONTENTS = Object.freeze({
  ffmpeg: Buffer.from('trusted ffmpeg fixture\n'),
  ffprobe: Buffer.from('trusted ffprobe fixture\n'),
});
const FIXTURE_MEDIA_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(FIXTURE_MEDIA_CONTENTS).map(([name, contents]) => [
    name,
    crypto.createHash('sha256').update(contents).digest('hex'),
  ])
));

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
      example_drama: {
        ...EXAMPLE_DRAMA_DESCRIPTOR,
        path: `${kind}/${EXAMPLE_DRAMA_DESCRIPTOR.path}`,
      },
      fuses: fuseStates(),
    })),
  };
}

function writeFixtureMediaTools(resourcesDirectory, mediaFiles = []) {
  const release = mediaToolPolicy.getTrustedMediaToolRelease('win32', 'x64');
  const mediaDirectory = path.join(resourcesDirectory, 'ffmpeg');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  for (const expectedName of ['ffmpeg', 'ffprobe']) {
    const filePath = path.join(mediaDirectory, release.tools[expectedName].fileName);
    fs.writeFileSync(filePath, FIXTURE_MEDIA_CONTENTS[expectedName]);
    mediaFiles.push({ expectedName, filePath });
  }
  return mediaFiles;
}

function extractedArtifactFixture(t) {
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-media-artifact-scan-'));
  t.after(() => removeFixtureTree(scanRoot));

  const exampleContents = Buffer.from('tiny verified example drama\n');
  const expectedExampleDrama = {
    relativePath: 'example_drama/example.zip',
    fileName: 'example.zip',
    bytes: exampleContents.length,
    sha256: crypto.createHash('sha256').update(exampleContents).digest('hex'),
  };
  const applicationDirectories = {
    setup: 'setup/installed',
    portable: 'portable/extracted',
    unpacked: 'unpacked',
  };
  const mediaFiles = [];
  const applications = Object.values(applicationDirectories).map((applicationDirectory) => {
    const resourcesDirectory = path.join(scanRoot, ...applicationDirectory.split('/'), 'resources');
    const examplePath = path.join(resourcesDirectory, expectedExampleDrama.relativePath);
    fs.mkdirSync(path.dirname(examplePath), { recursive: true });
    fs.writeFileSync(examplePath, exampleContents);
    writeFixtureMediaTools(resourcesDirectory, mediaFiles);

    return {
      executable: `${applicationDirectory}/LocalMiniDrama.exe`,
      asar: `${applicationDirectory}/resources/app.asar`,
      example_drama: {
        path: `${applicationDirectory}/resources/${expectedExampleDrama.relativePath}`,
        bytes: expectedExampleDrama.bytes,
        sha256: expectedExampleDrama.sha256,
      },
      fuses: fuseStates(),
    };
  });
  const inventory = scanInventory();
  inventory.packaged_applications = applications;
  return { inventory, mediaFiles, scanRoot, expectedExampleDrama };
}

function installFixtureMediaTrust(t) {
  const calls = [];
  t.mock.method(
    mediaToolPolicy,
    'assertTrustedMediaToolFile',
    (expectedName, filePath, platform, arch) => {
      calls.push({ expectedName, filePath, platform, arch });
      return mediaToolPolicy.assertTrustedSha256(
        filePath,
        FIXTURE_MEDIA_SHA256[expectedName],
        `${expectedName} for ${platform}-${arch}`
      );
    }
  );
  return calls;
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
  duplicateSetup.packaged_applications[1].example_drama.path =
    'setup/second/resources/example_drama/衣服设计天才302.zip';
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

test('cross-run release inventory rejects invalid bundled example drama descriptors', () => {
  const missing = scanInventory();
  delete missing.packaged_applications[0].example_drama;
  assert.throws(
    () => validateArtifactScanInventory(missing, missing.version),
    /example drama descriptor is invalid/
  );

  const wrongBytes = scanInventory();
  wrongBytes.packaged_applications[0].example_drama.bytes += 1;
  assert.throws(
    () => validateArtifactScanInventory(wrongBytes, wrongBytes.version),
    /example drama bytes are invalid/
  );

  const wrongDigest = scanInventory();
  wrongDigest.packaged_applications[0].example_drama.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateArtifactScanInventory(wrongDigest, wrongDigest.version),
    /example drama digest is invalid/
  );

  const traversal = scanInventory();
  traversal.packaged_applications[0].example_drama.path = '../example_drama/衣服设计天才302.zip';
  assert.throws(
    () => validateArtifactScanInventory(traversal, traversal.version),
    /example drama path must not escape the scan root/
  );

  const anotherApplication = scanInventory();
  anotherApplication.packaged_applications[0].example_drama.path =
    'portable/resources/example_drama/衣服设计天才302.zip';
  assert.throws(
    () => validateArtifactScanInventory(anotherApplication, anotherApplication.version),
    /example drama does not belong to the packaged application/
  );
});

test('bundled example drama evidence is independently re-hashed from every extracted application', (t) => {
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-example-drama-scan-'));
  t.after(() => removeFixtureTree(scanRoot));
  installFixtureMediaTrust(t);
  const contents = Buffer.from('tiny verified example drama\n');
  const expected = {
    relativePath: 'example_drama/example.zip',
    fileName: 'example.zip',
    bytes: contents.length,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
  };
  const applications = ['setup', 'portable', 'unpacked'].map((kind) => {
    const resources = path.join(scanRoot, kind, 'resources');
    const examplePath = path.join(resources, expected.relativePath);
    fs.mkdirSync(path.dirname(examplePath), { recursive: true });
    fs.writeFileSync(examplePath, contents);
    writeFixtureMediaTools(resources);
    return {
      executable: `${kind}/LocalMiniDrama.exe`,
      asar: `${kind}/resources/app.asar`,
      example_drama: {
        path: `${kind}/resources/${expected.relativePath}`,
        bytes: expected.bytes,
        sha256: expected.sha256,
      },
      fuses: fuseStates(),
    };
  });

  assert.deepEqual(
    verifyPackagedExampleApplications(applications, scanRoot, expected),
    applications.map((application) => application.example_drama)
  );

  const inventory = scanInventory();
  inventory.packaged_applications = applications;
  validateArtifactScanInventory(inventory, inventory.version, {
    scanRoot,
    expectedExampleDrama: expected,
  });

  const setupExample = path.join(scanRoot, 'setup', 'resources', expected.relativePath);
  fs.rmSync(setupExample);
  assert.throws(
    () => verifyPackagedExampleApplications(applications, scanRoot, expected),
    /Example drama file is missing/
  );
  fs.writeFileSync(setupExample, contents);

  const portableExample = path.join(scanRoot, 'portable', 'resources', expected.relativePath);
  fs.appendFileSync(portableExample, 'resized');
  assert.throws(
    () => verifyPackagedExampleApplications(applications, scanRoot, expected),
    /Example drama size mismatch/
  );
  fs.writeFileSync(portableExample, contents);

  const unpackedExample = path.join(scanRoot, 'unpacked', 'resources', expected.relativePath);
  fs.writeFileSync(unpackedExample, Buffer.from('tiny verified example dramA\n'));
  assert.throws(
    () => validateArtifactScanInventory(inventory, inventory.version, {
      scanRoot,
      expectedExampleDrama: expected,
    }),
    /Example drama SHA-256 digest mismatch/
  );
});

test('Setup, Portable, and Unpacked media tools are re-hashed through the trusted policy', (t) => {
  const fixture = extractedArtifactFixture(t);
  const calls = installFixtureMediaTrust(t);

  validateArtifactScanInventory(fixture.inventory, fixture.inventory.version, {
    scanRoot: fixture.scanRoot,
    expectedExampleDrama: fixture.expectedExampleDrama,
  });

  assert.deepEqual(
    calls.map(({ expectedName, filePath, platform, arch }) => ({
      expectedName,
      path: path.relative(fixture.scanRoot, filePath).replace(/\\/g, '/'),
      platform,
      arch,
    })),
    fixture.mediaFiles.map(({ expectedName, filePath }) => ({
      expectedName,
      path: path.relative(fixture.scanRoot, filePath).replace(/\\/g, '/'),
      platform: 'win32',
      arch: 'x64',
    }))
  );
});

test('a one-byte change to any packaged ffmpeg or ffprobe fails artifact validation', (t) => {
  const fixture = extractedArtifactFixture(t);
  installFixtureMediaTrust(t);

  for (const { filePath } of fixture.mediaFiles) {
    const original = fs.readFileSync(filePath);
    const tampered = Buffer.from(original);
    tampered[0] ^= 0x01;
    fs.writeFileSync(filePath, tampered);
    assert.throws(
      () => validateArtifactScanInventory(fixture.inventory, fixture.inventory.version, {
        scanRoot: fixture.scanRoot,
        expectedExampleDrama: fixture.expectedExampleDrama,
      }),
      /does not match trusted SHA-256/,
      path.relative(fixture.scanRoot, filePath)
    );
    fs.writeFileSync(filePath, original);
  }
});

test('packaged media validation rejects a junction or symlink outside the scan root', (t) => {
  const fixture = extractedArtifactFixture(t);
  installFixtureMediaTrust(t);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-external-media-'));
  t.after(() => removeFixtureTree(externalRoot));
  writeFixtureMediaTools(externalRoot);

  const packagedMediaDirectory = path.dirname(fixture.mediaFiles[0].filePath);
  removeFixtureTree(packagedMediaDirectory);
  fs.symlinkSync(
    path.join(externalRoot, 'ffmpeg'),
    packagedMediaDirectory,
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  assert.throws(
    () => validateArtifactScanInventory(fixture.inventory, fixture.inventory.version, {
      scanRoot: fixture.scanRoot,
      expectedExampleDrama: fixture.expectedExampleDrama,
    }),
    /symbolic link|reparse point|physical path escapes the scan root/
  );
});

test('cross-run release inventory rejects source artifact bytes changed after Windows scans', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-scan-inventory-'));
  t.after(() => removeFixtureTree(directory));
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

test('Windows evidence records the reviewed backend process UID and fails closed on source drift', () => {
  assert.equal(typeof createBackendContainerUserException, 'function');
  const sources = {
    dockerfileSource: backendDockerfile,
    entrypointSource: backendEntrypoint,
    ignorePolicySource: backendTrivyIgnore,
  };
  assert.deepEqual(createBackendContainerUserException(sources), {
    id: 'AVD-DS-0002',
    path: 'backend-node/Dockerfile',
    review_by: '2027-07-17',
    rationale: BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE,
    source_contract: {
      runtime_base: BACKEND_RUNTIME_BASE,
      process_user: 'node',
      process_uid: 1000,
      privilege_transition: 'setpriv --reuid=node --regid=node --init-groups',
      source_sha256_lf: {
        'backend-node/Dockerfile': normalizedSourceSha256(backendDockerfile),
        'backend-node/docker-entrypoint.sh': normalizedSourceSha256(backendEntrypoint),
        'backend-node/.trivyignore.yaml': normalizedSourceSha256(backendTrivyIgnore),
      },
    },
  });

  for (const [label, changedSources] of [
    ['runtime base', {
      dockerfileSource: backendDockerfile.replace(BACKEND_RUNTIME_BASE, 'node:20-bookworm-slim@sha256:' + '0'.repeat(64)),
    }],
    ['Dockerfile USER', { dockerfileSource: `${backendDockerfile}\nUSER node\n` }],
    ['entrypoint privilege transition', {
      entrypointSource: backendEntrypoint.replace(
        'exec setpriv --reuid=node --regid=node --init-groups -- "$@"',
        'exec "$@"'
      ),
    }],
    ['Trivy ignore policy', {
      ignorePolicySource: backendTrivyIgnore.replace(
        BACKEND_CONTAINER_USER_EXCEPTION_RATIONALE,
        'Legacy root entrypoint exception.'
      ),
    }],
  ]) {
    assert.throws(
      () => createBackendContainerUserException({ ...sources, ...changedSources }),
      /backend container user source contract/i,
      label
    );
  }
});

test('Defender signature evidence is UTC-normalized and bounded to 72 hours', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');
  assert.equal(DEFENDER_SIGNATURE_MAX_AGE_HOURS, 72);
  assert.deepEqual(
    normalizeDefenderSignatureDetails('2026-07-21T12:00:00Z', { now }),
    {
      antivirus_signature_last_updated: '2026-07-21T12:00:00.000Z',
      maximum_age_hours: 72,
    }
  );

  for (const [label, value, pattern] of [
    ['absent', undefined, /is required/],
    ['malformed', 'July sometime', /valid UTC/],
    ['future', '2026-07-24T12:00:00.001Z', /future/],
    ['stale', '2026-07-21T11:59:59.999Z', /older than 72 hours/],
    ['offset', '2026-07-21T12:00:00+00:00', /valid UTC/],
  ]) {
    assert.throws(() => normalizeDefenderSignatureDetails(value, { now }), pattern, label);
  }
});

test('Defender marker validation requires fresh signature metadata', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');
  const commit = 'a'.repeat(40);
  const marker = {
    schema: 'localminidrama.artifact-scan-pass.v1',
    scanner: 'defender',
    version: '1.1.25060.6-1.437.42.0',
    status: 'passed',
    commit,
    generated_at: '2026-07-24T11:30:00.000Z',
    details: {
      antivirus_signature_last_updated: '2026-07-24T10:00:00.000Z',
      maximum_age_hours: 72,
    },
  };

  assert.deepEqual(
    validateScanPassMarker(marker, 'defender', commit, { now }).details,
    validateDefenderSignatureDetails(marker.details, { now })
  );
  for (const details of [
    undefined,
    { maximum_age_hours: 72 },
    { antivirus_signature_last_updated: 'invalid', maximum_age_hours: 72 },
    { antivirus_signature_last_updated: '2026-07-24T13:00:00.000Z', maximum_age_hours: 72 },
    { antivirus_signature_last_updated: '2026-07-20T00:00:00.000Z', maximum_age_hours: 72 },
    { antivirus_signature_last_updated: '2026-07-24T10:00:00.000Z', maximum_age_hours: 96 },
  ]) {
    assert.throws(() => validateScanPassMarker({ ...marker, details }, 'defender', commit, { now }));
  }
});

test('Unpacked ZIP packaging retries a failed CRC test and accepts only a verified archive', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-archive-test-'));
  t.after(() => removeFixtureTree(directory));
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
  t.after(() => removeFixtureTree(directory));
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
