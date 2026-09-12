const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');

const log = {
  info() {},
  warn() {},
  error() {},
};

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function writeVendorFile(t, configs) {
  const name = `vendor-lock-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const filePath = path.join(__dirname, '..', 'configs', name);
  fs.writeFileSync(filePath, JSON.stringify(configs), 'utf8');
  t.after(() => fs.rmSync(filePath, { force: true }));
  return name;
}

function createConfig(db, overrides) {
  return aiConfigService.createConfig(db, log, {
    service_type: 'text',
    provider: 'provider-a',
    name: 'Original config',
    base_url: 'https://provider.invalid/v1',
    api_key: 'fixture-existing-key',
    model: ['model-old'],
    default_model: 'model-old',
    settings: JSON.stringify({ maxTokens: 1024 }),
    ...overrides,
  });
}

function addModelMap(db, key, serviceType, configId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_model_map (key, service_type, config_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(key, serviceType, configId, now, now);
}

describe('aiConfigService vendor lock synchronization', () => {
  it('updates and inserts idempotently while preserving active IDs and model mappings', (t) => {
    const db = createDb(t);
    const retained = createConfig(db);
    const removed = createConfig(db, {
      service_type: 'image',
      provider: 'provider-removed',
      name: 'Removed config',
      model: ['image-old'],
      default_model: 'image-old',
    });
    addModelMap(db, 'retained-scene', 'text', retained.id);
    addModelMap(db, 'removed-scene', 'image', removed.id);

    const configFile = writeVendorFile(t, [
      {
        service_type: 'text',
        provider: 'provider-a',
        name: 'Locked config',
        base_url: 'https://locked.invalid/v1',
        api_key: 'fixture-file-key',
        model: ['model-new'],
        default_model: 'model-new',
        is_default: true,
        settings: { maxTokens: 4096 },
      },
      {
        service_type: 'video',
        provider: 'provider-new',
        name: 'New locked config',
        base_url: 'https://video.invalid/v1',
        api_key: 'fixture-new-key',
        model: ['video-model'],
        default_model: 'video-model',
      },
    ]);
    const cfg = { vendor_lock: { enabled: true, config_file: configFile } };

    assert.deepEqual(aiConfigService.applyVendorLock(db, log, cfg), {
      count: 2,
      inserted: 1,
      updated: 1,
    });

    const retainedAfter = db.prepare('SELECT * FROM ai_service_configs WHERE id = ?').get(retained.id);
    assert.equal(retainedAfter.deleted_at, null);
    assert.equal(retainedAfter.name, 'Locked config');
    assert.equal(retainedAfter.api_key, 'fixture-existing-key');
    assert.equal(JSON.parse(retainedAfter.settings).maxTokens, 4096);
    assert.equal(
      db.prepare('SELECT config_id FROM ai_model_map WHERE key = ?').get('retained-scene').config_id,
      retained.id
    );
    assert.equal(
      db.prepare('SELECT config_id FROM ai_model_map WHERE key = ?').get('removed-scene').config_id,
      null
    );

    const activeIds = db.prepare(
      'SELECT id FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY id'
    ).all().map((row) => row.id);
    assert.equal(activeIds.length, 2);
    assert.equal(activeIds.includes(retained.id), true);
    db.prepare("UPDATE ai_service_configs SET updated_at = 'stable-marker' WHERE deleted_at IS NULL").run();

    assert.deepEqual(aiConfigService.applyVendorLock(db, log, cfg), {
      count: 2,
      inserted: 0,
      updated: 0,
    });
    assert.deepEqual(
      db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY id').all().map((row) => row.id),
      activeIds
    );
    assert.deepEqual(
      db.prepare('SELECT DISTINCT updated_at FROM ai_service_configs WHERE deleted_at IS NULL').all(),
      [{ updated_at: 'stable-marker' }]
    );
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count
           FROM ai_model_map map
           LEFT JOIN ai_service_configs config
             ON config.id = map.config_id AND config.deleted_at IS NULL
          WHERE map.config_id IS NOT NULL AND config.id IS NULL`
      ).get().count,
      0
    );
  });

  it('rolls back all changes when synchronization is interrupted', (t) => {
    const db = createDb(t);
    const first = createConfig(db, { provider: 'provider-first', name: 'First original' });
    const second = createConfig(db, { provider: 'provider-second', name: 'Second original' });
    addModelMap(db, 'transaction-scene', 'text', first.id);
    const configFile = writeVendorFile(t, [
      {
        service_type: 'text',
        provider: 'provider-first',
        name: 'First changed',
        base_url: 'https://first.invalid/v1',
        model: ['first-model'],
      },
      {
        service_type: 'text',
        provider: 'provider-second',
        name: 'Second changed',
        base_url: 'https://second.invalid/v1',
        model: ['second-model'],
      },
    ]);
    db.exec(
      `CREATE TRIGGER abort_vendor_sync
       BEFORE UPDATE ON ai_service_configs
       WHEN OLD.id = ${Number(second.id)}
       BEGIN
         SELECT RAISE(ABORT, 'forced vendor lock failure');
       END`
    );

    assert.throws(
      () => aiConfigService.applyVendorLock(db, log, {
        vendor_lock: { enabled: true, config_file: configFile },
      }),
      /forced vendor lock failure/
    );

    const rows = db.prepare(
      'SELECT id, name, deleted_at FROM ai_service_configs ORDER BY id'
    ).all();
    assert.deepEqual(rows, [
      { id: first.id, name: 'First original', deleted_at: null },
      { id: second.id, name: 'Second original', deleted_at: null },
    ]);
    assert.equal(
      db.prepare('SELECT config_id FROM ai_model_map WHERE key = ?').get('transaction-scene').config_id,
      first.id
    );
  });

  it('leaves the database unchanged when a vendor JSON entry has an invalid default model', (t) => {
    const db = createDb(t);
    createConfig(db, { name: 'Original config' });
    const secret = 'LMD_SYNTHETIC_VENDOR_IMPORT_CREDENTIAL';
    const errors = [];
    const captureLog = {
      ...log,
      error(message, metadata) {
        errors.push(JSON.stringify({ message, metadata }));
      },
    };
    const configFile = writeVendorFile(t, [
      {
        service_type: 'text',
        provider: 'provider-a',
        name: 'Changed before invalid entry',
        base_url: 'https://provider.invalid/v1',
        model: [' model-new ', '', 'model-new'],
        default_model: 'model-new',
      },
      {
        service_type: 'video',
        provider: 'provider-invalid',
        name: 'Invalid imported config',
        base_url: 'https://video.invalid/v1',
        api_key: secret,
        model: ['current-video-model'],
        default_model: 'retired-video-model',
      },
    ]);

    const result = aiConfigService.applyVendorLock(db, captureLog, {
      vendor_lock: { enabled: true, config_file: configFile },
    });

    assert.equal(result, undefined);
    assert.deepEqual(
      aiConfigService.listConfigs(db).map((config) => ({
        name: config.name,
        model: config.model,
        default_model: config.default_model,
      })),
      [{
        name: 'Original config',
        model: ['model-old'],
        default_model: 'model-old',
      }]
    );
    assert.equal(errors.length, 1);
    assert.equal(errors.join('\n').includes(secret), false);
  });
});
