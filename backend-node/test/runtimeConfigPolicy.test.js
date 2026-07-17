const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeRuntimeConfig } = require('../../scripts/runtime-config-policy.cjs');

test('runtime config policy strips local credentials and unsafe packaging overrides', () => {
  const result = sanitizeRuntimeConfig({
    app: { name: 'Fixture', version: '1.2.8', debug: true },
    server: { port: 5679, host: '0.0.0.0', cors_origins: ['http://localhost:3013?token=fixture'] },
    database: { path: 'C:\\private\\fixture.db' },
    storage: { local_path: '../../private-storage', base_url: 'https://user:pass@example.invalid/static' },
    ai: { default_text_provider: 'openai', api_key: 'synthetic-secret-marker' },
    vendor_lock: { enabled: true, config_file: '../private-provider.json' },
    image_proxy: { upload_url: 'https://example.invalid/upload?signature=synthetic' },
    provider_credentials: { token: 'synthetic-secret-marker' },
  });

  assert.equal(result.app.debug, false);
  assert.equal(result.server.host, '127.0.0.1');
  assert.deepEqual(result.server.cors_origins, []);
  assert.equal(result.database.path, './data/drama_generator.db');
  assert.equal(result.storage.local_path, './data/storage');
  assert.equal(result.storage.base_url, 'http://localhost:5679/static');
  assert.equal(result.vendor_lock.enabled, false);
  assert.equal(result.vendor_lock.config_file, 'ai-configs.json');
  assert.equal(result.image_proxy.upload_url, '');
  assert.equal(Object.hasOwn(result.ai, 'api_key'), false);
  assert.equal(Object.hasOwn(result, 'provider_credentials'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-secret-marker'), false);
});
