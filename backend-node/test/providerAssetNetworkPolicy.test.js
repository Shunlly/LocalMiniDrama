'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { createProviderNetworkBoundary } = require('../src/routes');
const { callModelArkAsset } = require('../src/services/modelArkAssetProxyService');
const modelArkConfig = require('../src/services/modelArkAssetConfigService');
const jimengHub = require('../src/services/jimengMaterialHubService');

const PUBLIC_HTTP_BASE = 'http://93.184.216.34/provider';
const PUBLIC_HTTPS_BASE = 'https://provider.example.test/v1';

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function insertConfig(db, overrides = {}) {
  const config = {
    service_type: 'model_ark_asset',
    provider: 'model_ark',
    name: 'Synthetic legacy provider',
    base_url: PUBLIC_HTTP_BASE,
    api_key: '',
    settings: '{}',
    is_active: 1,
    ...overrides,
  };
  const result = db.prepare(
    `INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, api_key, settings, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    config.service_type,
    config.provider,
    config.name,
    config.base_url,
    config.api_key,
    config.settings,
    config.is_active
  );
  return Number(result.lastInsertRowid);
}

function responseRecorder() {
  const recorded = { statusCode: null, body: null };
  return {
    recorded,
    response: {
      status(value) { recorded.statusCode = value; return this; },
      json(value) { recorded.body = value; return this; },
    },
  };
}

async function invokeBoundary(boundary, body, downstream) {
  const req = { body };
  const { recorded, response } = responseRecorder();
  let nextCalled = false;
  await boundary(req, response, async () => {
    nextCalled = true;
    await downstream(req);
  });
  return { ...recorded, nextCalled, req };
}

function observeNetworkTransports(t) {
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const requests = [];
  const observe = (protocol) => (options) => {
    requests.push({ protocol, headers: { ...(options?.headers || {}) } });
    const error = new Error('synthetic transport observer stopped the request');
    error.code = 'SYNTHETIC_TRANSPORT_OBSERVED';
    throw error;
  };
  http.request = observe('http:');
  https.request = observe('https:');
  t.after(() => {
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  });
  return requests;
}

const legacyCredentialScenarios = [
  {
    label: 'ModelArk Bearer',
    row: {
      api_key: 'SYNTHETIC_MODELARK_BEARER_DO_NOT_SEND',
      settings: JSON.stringify({ auth_mode: 'bearer', path_mode: 'flat' }),
    },
    body(id) { return { config_id: id, action: 'ListAssets' }; },
    async downstream(req) {
      await callModelArkAsset({
        base_url: PUBLIC_HTTP_BASE,
        api_key: 'SYNTHETIC_MODELARK_BEARER_DO_NOT_SEND',
        action: 'ListAssets',
        path_mode: 'flat',
        http_method: 'GET',
        auth_mode: 'bearer',
        network_policy: req.providerNetworkPolicy,
      }).catch(() => {});
    },
  },
  {
    label: 'ModelArk AK/SK',
    row: {
      settings: JSON.stringify({
        auth_mode: 'volc_sign',
        access_key_id: 'SYNTHETIC_ACCESS_KEY_ID_DO_NOT_SEND',
        secret_access_key: 'SYNTHETIC_SECRET_ACCESS_KEY_DO_NOT_SEND',
        path_mode: 'open_api_query',
      }),
    },
    body(id) { return { config_id: id, action: 'ListAssets' }; },
    async downstream(req) {
      await callModelArkAsset({
        base_url: PUBLIC_HTTP_BASE,
        action: 'ListAssets',
        path_mode: 'open_api_query',
        auth_mode: 'volc_sign',
        access_key_id: 'SYNTHETIC_ACCESS_KEY_ID_DO_NOT_SEND',
        secret_access_key: 'SYNTHETIC_SECRET_ACCESS_KEY_DO_NOT_SEND',
        network_policy: req.providerNetworkPolicy,
      }).catch(() => {});
    },
  },
  {
    label: 'Jimeng material hub',
    row: {
      service_type: 'jimeng2_character_auth',
      provider: 'jimeng2_character_auth',
      api_key: 'SYNTHETIC_JIMENG_TOKEN_DO_NOT_SEND',
    },
    body(id) { return { config_id: id }; },
    async downstream(req) {
      await jimengHub.listAssets({
        baseUrl: PUBLIC_HTTP_BASE,
        token: 'SYNTHETIC_JIMENG_TOKEN_DO_NOT_SEND',
        networkPolicy: req.providerNetworkPolicy,
      }, {});
    },
  },
];

for (const scenario of legacyCredentialScenarios) {
  test(`legacy public HTTP ${scenario.label} is rejected before DNS or credential transport`, async (t) => {
    const db = createDb(t);
    const id = insertConfig(db, scenario.row);
    let lookupCalls = 0;
    const requests = observeNetworkTransports(t);
    const boundary = createProviderNetworkBoundary(db, {
      lookup: async () => {
        lookupCalls += 1;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });

    const result = await invokeBoundary(boundary, scenario.body(id), scenario.downstream);

    assert.equal(result.statusCode, 400);
    assert.equal(result.nextCalled, false);
    assert.equal(lookupCalls, 0);
    assert.deepEqual(requests, []);
  });
}

test('ModelArk and Jimeng services fail closed without a complete provider network policy', async (t) => {
  let lookupCalls = 0;
  const requests = observeNetworkTransports(t);
  const lookup = async () => {
    lookupCalls += 1;
    return [{ address: '93.184.216.34', family: 4 }];
  };

  await assert.rejects(
    callModelArkAsset({
      base_url: PUBLIC_HTTPS_BASE,
      api_key: 'SYNTHETIC_MODELARK_BEARER_DO_NOT_SEND',
      action: 'ListAssets',
      path_mode: 'flat',
      http_method: 'GET',
      auth_mode: 'bearer',
      network_lookup: lookup,
    }),
    (error) => error?.code === 'PROVIDER_NETWORK_POLICY_REQUIRED'
  );

  const jimengResult = await jimengHub.listAssets({
    baseUrl: PUBLIC_HTTPS_BASE,
    token: 'SYNTHETIC_JIMENG_TOKEN_DO_NOT_SEND',
    networkLookup: lookup,
  }, {});
  assert.equal(jimengResult.ok, false);
  assert.match(jimengResult.error, /PROVIDER_NETWORK_POLICY_REQUIRED/);
  assert.equal(lookupCalls, 0);
  assert.deepEqual(requests, []);
});

test('saved HTTPS and explicit recognized local HTTP configs receive complete network policies', async (t) => {
  const db = createDb(t);
  const httpsId = insertConfig(db, { base_url: PUBLIC_HTTPS_BASE });
  const localBase = 'http://127.0.0.1:5688/v1';
  const localId = insertConfig(db, {
    provider: 'openai_compatible',
    base_url: localBase,
    settings: JSON.stringify({ allow_local_http: true }),
  });
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const boundary = createProviderNetworkBoundary(db, { lookup });

  const httpsResult = await invokeBoundary(boundary, { config_id: httpsId }, async () => {});
  assert.equal(httpsResult.nextCalled, true);
  assert.equal(httpsResult.req.providerNetworkPolicy.requireHttpsForPublic, true);
  assert.deepEqual(httpsResult.req.providerNetworkPolicy.trustedOrigins, [PUBLIC_HTTPS_BASE]);
  assert.deepEqual(httpsResult.req.providerNetworkPolicy.allowPrivateOrigins, []);
  assert.equal(httpsResult.req.providerNetworkPolicy.lookup, lookup);

  const localResult = await invokeBoundary(boundary, { config_id: localId }, async () => {});
  assert.equal(localResult.nextCalled, true);
  assert.equal(localResult.req.providerNetworkPolicy.requireHttpsForPublic, true);
  assert.deepEqual(localResult.req.providerNetworkPolicy.trustedOrigins, [localBase]);
  assert.deepEqual(localResult.req.providerNetworkPolicy.allowPrivateOrigins, [localBase]);
});

test('internal ModelArk and Jimeng contexts reject legacy public HTTP rows before exposing credentials', (t) => {
  const modelDb = createDb(t);
  insertConfig(modelDb, {
    api_key: 'SYNTHETIC_MODELARK_BEARER_DO_NOT_SEND',
    settings: JSON.stringify({
      auth_mode: 'bearer',
      asset_group_id: 'synthetic-asset-group',
      path_mode: 'flat',
    }),
  });
  const modelContext = modelArkConfig.buildModelArkContext(modelDb);
  assert.equal(modelContext.ready, false);
  assert.equal(modelContext.callOpts, undefined);
  assert.equal(modelContext.diag.network_policy_error, 'INVALID_PROVIDER_URL');

  const jimengDb = createDb(t);
  insertConfig(jimengDb, {
    service_type: 'jimeng2_character_auth',
    provider: 'jimeng2_character_auth',
    api_key: 'SYNTHETIC_JIMENG_TOKEN_DO_NOT_SEND',
  });
  const jimengContext = jimengHub.buildHubContext({}, jimengDb);
  assert.equal(jimengContext.token, '');
  assert.equal(jimengContext.networkPolicy, null);
  assert.equal(jimengContext.networkPolicyError, 'INVALID_PROVIDER_URL');
});
