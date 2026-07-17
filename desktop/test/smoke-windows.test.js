'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertRendererLog,
  assertSuccessfulSpawnResult,
  expectedArtifactName,
  sameOriginWriteHeaders,
} = require('../scripts/smoke-windows');
const {
  assertExactArtifactSet,
  expectedReleaseArtifactNames,
} = require('../../scripts/generate-release-metadata.cjs');
const packageJson = require('../package.json');

test('renderer smoke contract requires readiness and rejects load or renderer failures', () => {
  assert.doesNotThrow(() => assertRendererLog('fixture', 'window ready-to-show\nwindow-renderer ready\n'));
  assert.throws(
    () => assertRendererLog('fixture', 'window ready-to-show\n'),
    /did not report renderer readiness/
  );
  assert.throws(
    () => assertRendererLog('fixture', 'did-fail-load code=-105 mainFrame=true\nwindow-renderer ready\n'),
    /reported a renderer failure/
  );
  assert.throws(
    () => assertRendererLog('fixture', 'renderer error render-process-gone reason=crashed\n'),
    /reported a renderer failure/
  );
});

test('process smoke contract requires an explicit zero exit status', () => {
  assert.equal(assertSuccessfulSpawnResult('fixture', { status: 0 }), 0);
  assert.throws(
    () => assertSuccessfulSpawnResult('fixture', { status: 2, stderr: 'failed' }),
    /exited with status 2: failed/
  );
  assert.throws(
    () => assertSuccessfulSpawnResult('fixture', { status: null, signal: 'SIGTERM' }),
    /status null signal=SIGTERM/
  );
  assert.throws(
    () => assertSuccessfulSpawnResult('fixture', { status: null, error: new Error('timed out') }),
    /could not run: timed out/
  );
});

test('desktop write probes carry the exact dynamic renderer origin', () => {
  assert.deepEqual(sameOriginWriteHeaders(58123), {
    Origin: 'http://127.0.0.1:58123',
    'Sec-Fetch-Site': 'same-origin',
  });
  assert.throws(() => sameOriginWriteHeaders(0), /valid loopback port/);
  assert.throws(() => sameOriginWriteHeaders(65536), /valid loopback port/);
});

test('release smoke and manifest accept only the current version artifact matrix', () => {
  const version = packageJson.version;
  assert.equal(expectedArtifactName('Setup'), `LocalMiniDrama-Setup-${version}-x64.exe`);
  assert.equal(expectedArtifactName('Portable'), `LocalMiniDrama-Portable-${version}-x64.exe`);
  const expected = expectedReleaseArtifactNames(version);
  assert.doesNotThrow(() => assertExactArtifactSet(expected, version));
  assert.throws(
    () => assertExactArtifactSet([...expected, 'LocalMiniDrama-Setup-0.0.0-x64.exe'], version),
    /missing, stale, or unexpected/
  );
});
