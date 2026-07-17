'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { callModelArkAsset } = require('../src/services/modelArkAssetProxyService');

async function startServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('ModelArk errors never expose the upstream payload or attach it to the exception', async (t) => {
  const sourceMarker = 'do-not-expose-provider-marker';
  const baseUrl = await startServer(t, (_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: sourceMarker, signed_url: `https://vendor.invalid/file?token=${sourceMarker}` }));
  });

  await assert.rejects(
    callModelArkAsset({
      base_url: baseUrl,
      api_key: 'synthetic-token',
      action: 'ListAssets',
      path_mode: 'flat',
      http_method: 'GET',
      auth_mode: 'bearer',
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.payload, undefined);
      assert.doesNotMatch(error.message, new RegExp(sourceMarker));
      assert.doesNotMatch(error.message, /vendor\.invalid|signed_url/);
      return true;
    }
  );
});

test('ModelArk write requests do not follow redirects or forward credentials', async (t) => {
  let targetCalls = 0;
  const target = await startServer(t, (_req, res) => {
    targetCalls += 1;
    res.end('{}');
  });
  const source = await startServer(t, (_req, res) => {
    res.writeHead(307, { Location: `${target}/collect` });
    res.end();
  });

  await assert.rejects(callModelArkAsset({
    base_url: source,
    api_key: 'synthetic-token',
    action: 'CreateAsset',
    body: { Name: 'test' },
    path_mode: 'flat',
    http_method: 'POST',
    auth_mode: 'bearer',
  }));
  assert.equal(targetCalls, 0);
});

test('a saved public ModelArk hostname cannot rebind to a private address', async () => {
  await assert.rejects(
    callModelArkAsset({
      base_url: 'http://modelark.example:8090',
      api_key: 'synthetic-token',
      action: 'ListAssets',
      path_mode: 'flat',
      http_method: 'GET',
      auth_mode: 'bearer',
      network_lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
  );
});
