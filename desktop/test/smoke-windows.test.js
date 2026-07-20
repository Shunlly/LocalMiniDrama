'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertExampleImportResponse,
  assertExampleListResponse,
  assertRendererLog,
  assertSuccessfulSpawnResult,
  expectedArtifactName,
  sameOriginWriteHeaders,
  verifyBundledExampleImport,
} = require('../scripts/smoke-windows');
const {
  assertExactArtifactSet,
  expectedReleaseArtifactNames,
} = require('../../scripts/generate-release-metadata.cjs');
const packageJson = require('../package.json');

const bundledExampleFilename = '衣服设计天才302.zip';
const smokeWindowsSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'smoke-windows.js'),
  'utf8'
);

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

test('bundled example response contracts reject malformed list and import responses', () => {
  assert.doesNotThrow(() => assertExampleListResponse({
    statusCode: 200,
    body: { success: true, data: [{ filename: bundledExampleFilename }] },
  }));
  assert.doesNotThrow(() => assertExampleImportResponse({
    statusCode: 201,
    body: { success: true, data: { drama_id: 42, title: 'fixture' } },
  }));

  assert.throws(
    () => assertExampleListResponse({ statusCode: 200, body: { success: true, data: [{}] } }),
    /filename/
  );
  assert.throws(
    () => assertExampleImportResponse({
      statusCode: 200,
      body: { success: true, data: { drama_id: 42, title: 'fixture' } },
    }),
    /201/
  );
  for (const dramaId of [0, -1]) {
    assert.throws(
      () => assertExampleImportResponse({
        statusCode: 201,
        body: { success: true, data: { drama_id: dramaId, title: 'fixture' } },
      }),
      /drama_id/
    );
  }
  assert.throws(
    () => assertExampleImportResponse({
      statusCode: 201,
      body: { success: true, data: { drama_id: 42, title: '  ' } },
    }),
    /title/
  );
});

test('bundled example smoke imports the authoritative example and reads it back', async () => {
  const calls = [];
  const responseByEndpoint = new Map([
    ['/api/v1/dramas/examples', {
      statusCode: 200,
      body: { success: true, data: [{ filename: bundledExampleFilename }] },
    }],
    ['/api/v1/dramas/import-example', {
      statusCode: 201,
      body: { success: true, data: { drama_id: 42, title: 'fixture' } },
    }],
    ['/api/v1/dramas/42', {
      statusCode: 200,
      body: { success: true, data: { id: 42, title: 'fixture' } },
    }],
  ]);

  await verifyBundledExampleImport(
    { label: 'fixture', port: 58123 },
    {
      importTimeoutMs: 9876,
      requestJson: async (port, endpoint, options) => {
        calls.push({ port, endpoint, options });
        return responseByEndpoint.get(endpoint);
      },
    }
  );

  assert.deepEqual(calls, [
    { port: 58123, endpoint: '/api/v1/dramas/examples', options: undefined },
    {
      port: 58123,
      endpoint: '/api/v1/dramas/import-example',
      options: {
        method: 'POST',
        headers: sameOriginWriteHeaders(58123),
        body: { filename: bundledExampleFilename },
        timeoutMs: 9876,
      },
    },
    { port: 58123, endpoint: '/api/v1/dramas/42', options: undefined },
  ]);
  assert.match(smokeWindowsSource, /timeout: options\.timeoutMs \|\| 2000/);
});

test('bundled example smoke rejects a mismatched read-back identity or title', async () => {
  for (const data of [
    { id: 41, title: 'fixture' },
    { id: 42, title: 'different fixture' },
  ]) {
    await assert.rejects(
      verifyBundledExampleImport(
        { label: 'fixture', port: 58123 },
        {
          requestJson: async (_port, endpoint) => {
            if (endpoint === '/api/v1/dramas/examples') {
              return { statusCode: 200, body: { success: true, data: [{ filename: bundledExampleFilename }] } };
            }
            if (endpoint === '/api/v1/dramas/import-example') {
              return { statusCode: 201, body: { success: true, data: { drama_id: 42, title: 'fixture' } } };
            }
            return { statusCode: 200, body: { success: true, data } };
          },
        }
      ),
      /read-back/
    );
  }
});

test('bundled example smoke rejects a string read-back ID for a numeric import ID', async () => {
  await assert.rejects(
    verifyBundledExampleImport(
      { label: 'fixture', port: 58123 },
      {
        requestJson: async (_port, endpoint) => {
          if (endpoint === '/api/v1/dramas/examples') {
            return { statusCode: 200, body: { success: true, data: [{ filename: bundledExampleFilename }] } };
          }
          if (endpoint === '/api/v1/dramas/import-example') {
            return { statusCode: 201, body: { success: true, data: { drama_id: 42, title: 'fixture' } } };
          }
          return { statusCode: 200, body: { success: true, data: { id: '42', title: 'fixture' } } };
        },
      }
    ),
    /read-back/
  );
});

test('unpacked example import launch precedes the other Unpacked migration fixtures', () => {
  const exampleImport = smokeWindowsSource.indexOf("'unpacked-example-import'");
  const fresh = smokeWindowsSource.indexOf("'unpacked-fresh'");
  const legacy = smokeWindowsSource.indexOf("'unpacked-legacy-user-data'");
  const ffmpeg = smokeWindowsSource.indexOf("'unpacked-ffmpeg-only'");
  assert.ok(exampleImport >= 0, 'dedicated Unpacked example import launch is missing');
  assert.ok(exampleImport < fresh, 'example import must run before the fresh migration fixture');
  assert.ok(exampleImport < legacy, 'example import must run before the legacy migration fixture');
  assert.ok(exampleImport < ffmpeg, 'example import must run before the media-tool fixture');
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
