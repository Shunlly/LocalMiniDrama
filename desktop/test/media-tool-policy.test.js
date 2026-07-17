'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  assertTrustedSha256,
  beforePack,
  getTrustedMediaToolRelease,
  publicSourceDescriptor,
  validateMediaToolMetadata,
} = require('../scripts/media-tool-policy');

function trustedMetadata() {
  const release = getTrustedMediaToolRelease('win32', 'x64');
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
  };
}

test('trusted media manifest is fixed to reviewed Windows x64 artifacts', () => {
  const release = getTrustedMediaToolRelease('win32', 'x64');
  assert.equal(release.releaseVersion, '8.1.2');
  assert.equal(release.package.url, 'https://packages.chocolatey.org/ffmpeg.8.1.2.nupkg');
  assert.equal(release.package.sha256, '6c5746c8f0da8334d367131012ec1280bdd490651e108c35e19933587b06aed8');
  assert.equal(release.payload.sha256, 'e25b682664025d49034c981afb4bae36238a40f29a3cc1c713ad9a8b5b3528f6');
  assert.equal(release.tools.ffmpeg.sha256, '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e');
  assert.equal(release.tools.ffprobe.sha256, 'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07');
  assert.ok(Object.isFrozen(release));
  assert.equal(typeof beforePack, 'function');
  assert.deepEqual(publicSourceDescriptor(release).tools.ffmpeg, release.tools.ffmpeg);
  assert.throws(() => getTrustedMediaToolRelease('linux', 'x64'), /No trusted media tool SHA-256 manifest/);
});

test('trusted SHA-256 verification rejects changed bytes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-media-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, 'fixture.bin');
  fs.writeFileSync(fixture, 'abc');
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(assertTrustedSha256(fixture, digest, 'fixture'), digest);
  fs.appendFileSync(fixture, 'changed');
  assert.throws(() => assertTrustedSha256(fixture, digest, 'fixture'), /does not match trusted SHA-256/);
});

test('media provenance must exactly match the repository trust manifest', () => {
  const metadata = trustedMetadata();
  assert.equal(validateMediaToolMetadata(metadata).releaseVersion, '8.1.2');

  const changedBinary = structuredClone(metadata);
  changedBinary.tools[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateMediaToolMetadata(changedBinary), /does not match the trusted manifest/);

  const changedPackage = structuredClone(metadata);
  changedPackage.source.packageSha256 = '0'.repeat(64);
  assert.throws(() => validateMediaToolMetadata(changedPackage), /source packageSha256 does not match/);

  const changedPlatform = structuredClone(metadata);
  changedPlatform.platform = 'linux';
  assert.throws(() => validateMediaToolMetadata(changedPlatform), /No trusted media tool SHA-256 manifest/);
});
