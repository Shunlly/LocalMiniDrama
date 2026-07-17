'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const {
  copyBackend,
  isAllowedBackendFile,
} = require('../scripts/copy-backend');

function writeFixture(root, relativePath, contents = relativePath) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-backend-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const sourceRoot = path.join(root, 'backend-source');
  const destinationRoot = path.join(root, 'backend-app');
  const initialMigrationsRoot = path.join(root, 'initial-migrations');

  writeFixture(sourceRoot, 'src/app.js', 'module.exports = {};');
  writeFixture(sourceRoot, 'src/services/runtime.js', 'module.exports = true;');
  writeFixture(sourceRoot, 'migrations/01_init.sql', 'SELECT 1;');
  writeFixture(sourceRoot, 'prompts/skills/runtime.md', '# runtime');
  writeFixture(sourceRoot, 'configs/config.yaml', [
    'app:',
    '  name: fixture',
    '  version: 1.2.8',
    '  debug: true',
    'vendor_lock:',
    '  enabled: true',
    'ai:',
    '  default_text_provider: openai',
    '  api_key: synthetic-secret-marker',
  ].join('\n'));

  writeFixture(sourceRoot, 'configs/config.local.yaml', 'api_key: local-secret');
  writeFixture(sourceRoot, 'configs/secrets.yaml', 'token: local-secret');
  writeFixture(sourceRoot, 'data/drama_generator.db', 'private database');
  writeFixture(sourceRoot, 'data/storage/private.png', 'private asset');
  writeFixture(sourceRoot, 'scripts/debug.js', 'console.log(process.env);');
  writeFixture(sourceRoot, 'src/app.js.map', '{"sourcesContent":["secret"]}');
  writeFixture(sourceRoot, 'prompts/skills/private.env', 'TOKEN=secret');
  writeFixture(sourceRoot, '.env', 'TOKEN=secret');
  writeFixture(sourceRoot, 'secret.txt', 'secret');

  writeFixture(initialMigrationsRoot, '02_desktop.sql', 'SELECT 2;');
  writeFixture(initialMigrationsRoot, 'local-secret.txt', 'secret');
  writeFixture(destinationRoot, 'data/stale-secret.db', 'stale secret');

  return { sourceRoot, destinationRoot, initialMigrationsRoot };
}

test('copyBackend emits only the explicit runtime allowlist', (t) => {
  const fixture = createFixture(t);
  const result = copyBackend(fixture);

  assert.deepEqual(result.files, [
    'configs/config.yaml',
    'migrations/01_init.sql',
    'migrations/02_desktop.sql',
    'prompts/skills/runtime.md',
    'src/app.js',
    'src/services/runtime.js',
  ]);
  assert.ok(result.files.every(isAllowedBackendFile));
  assert.equal(result.mergedInitialMigrations, 1);
  const runtimeConfig = yaml.load(
    fs.readFileSync(path.join(fixture.destinationRoot, 'configs', 'config.yaml'), 'utf8')
  );
  assert.equal(runtimeConfig.app.name, 'fixture');
  assert.equal(runtimeConfig.app.debug, false);
  assert.equal(runtimeConfig.vendor_lock.enabled, false);
  assert.equal(Object.hasOwn(runtimeConfig.ai, 'api_key'), false);
  assert.equal(JSON.stringify(runtimeConfig).includes('synthetic-secret-marker'), false);

  for (const forbidden of [
    '.env',
    'configs/config.local.yaml',
    'configs/secrets.yaml',
    'data/drama_generator.db',
    'data/storage/private.png',
    'data/stale-secret.db',
    'prompts/skills/private.env',
    'scripts/debug.js',
    'secret.txt',
    'src/app.js.map',
  ]) {
    assert.equal(fs.existsSync(path.join(fixture.destinationRoot, forbidden)), false, forbidden);
  }
});

test('backend file allowlist rejects config, data, script, source-map, and secret paths', () => {
  assert.equal(isAllowedBackendFile('configs/config.yaml'), true);
  assert.equal(isAllowedBackendFile('src/routes/index.js'), true);
  assert.equal(isAllowedBackendFile('migrations/01_init.sql'), true);
  assert.equal(isAllowedBackendFile('prompts/skills/runtime.md'), true);

  for (const forbidden of [
    'config.yaml',
    'configs/config.local.yaml',
    'data/drama_generator.db',
    'scripts/backup-data.js',
    'secret.env',
    'src/app.js.map',
  ]) {
    assert.equal(isAllowedBackendFile(forbidden), false, forbidden);
  }
});
