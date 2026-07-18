const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sanitizeRuntimeConfig } = require('../../scripts/runtime-config-policy.cjs');
const { loadConfig } = require('../src/config');

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

test('config loader prioritizes the explicit sanitized runtime path', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-runtime-config-'));
  const runtimeConfig = path.join(tempRoot, 'config.yaml');
  fs.writeFileSync(runtimeConfig, 'app:\n  name: Runtime Override\n  version: 1.3.3\n', 'utf8');
  const previousPath = process.env.LOCALMINIDRAMA_CONFIG_PATH;
  process.env.LOCALMINIDRAMA_CONFIG_PATH = runtimeConfig;
  t.after(() => {
    if (previousPath === undefined) delete process.env.LOCALMINIDRAMA_CONFIG_PATH;
    else process.env.LOCALMINIDRAMA_CONFIG_PATH = previousPath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(loadConfig().app.name, 'Runtime Override');
});
