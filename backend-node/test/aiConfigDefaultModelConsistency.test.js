const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigRoutes = require('../src/routes/aiConfig');
const aiConfigService = require('../src/services/aiConfigService');
const imageService = require('../src/services/imageService');
const providerSdkService = require('../src/services/providerSdkService');

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => db.close());
  return db;
}

function configRequest(overrides = {}) {
  return {
    service_type: 'text',
    provider: 'openai_compatible',
    name: 'Default model consistency',
    base_url: 'https://provider.example/v1',
    api_key: 'fixture-api-key',
    model: ['current-model'],
    default_model: 'current-model',
    ...overrides,
  };
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function addDramaAndCharacter(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (1, 'Runtime model guard', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO characters (id, drama_id, name, appearance, created_at, updated_at)
     VALUES (1, 1, 'Lead', 'Production reference', ?, ?)`
  ).run(now, now);
}

test('create rejects an enabled config whose non-empty default model is not a normalized model member', (t) => {
  const db = createDb(t);
  const secret = 'LMD_SYNTHETIC_CREATE_CREDENTIAL';

  assert.throws(
    () => aiConfigService.createConfig(db, log, configRequest({
      api_key: secret,
      model: [' current-model ', '', 'current-model'],
      default_model: ' retired-model ',
    })),
    (error) => {
      assert.equal(error.code, 'INVALID_AI_CONFIG');
      assert.equal(error.status, 400);
      assert.deepEqual(error.details, {
        field: 'default_model',
        issue: 'not_in_model_list',
      });
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    }
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_service_configs').get().count, 0);
});

test('create normalizes string and array model formats while preserving a legal or empty default', (t) => {
  const db = createDb(t);
  const stringModel = aiConfigService.createConfig(db, log, configRequest({
    name: 'String model',
    model: ' current-model ',
    default_model: ' current-model ',
  }));
  const emptyDefault = aiConfigService.createConfig(db, log, configRequest({
    name: 'Array model',
    model: [' model-a ', '', 'model-a', ' model-b ', 'model-b'],
    default_model: '   ',
  }));

  assert.deepEqual(stringModel.model, ['current-model']);
  assert.equal(stringModel.default_model, 'current-model');
  assert.deepEqual(emptyDefault.model, ['model-a', 'model-b']);
  assert.equal(emptyDefault.default_model, null);
});

test('update rejects an enabled invalid candidate atomically', (t) => {
  const db = createDb(t);
  const created = aiConfigService.createConfig(db, log, configRequest({
    model: ['current-model', 'retired-model'],
    default_model: 'retired-model',
    is_default: true,
  }));

  assert.throws(
    () => aiConfigService.updateConfig(db, log, created.id, {
      model: [' current-model ', 'current-model'],
    }),
    (error) => error.code === 'INVALID_AI_CONFIG' && error.status === 400
  );

  const unchanged = aiConfigService.getConfig(db, created.id);
  assert.deepEqual(unchanged.model, ['current-model', 'retired-model']);
  assert.equal(unchanged.default_model, 'retired-model');
  assert.equal(unchanged.is_default, true);
});

test('disabled historical configs remain editable but must be repaired before activation', (t) => {
  const db = createDb(t);
  const created = aiConfigService.createConfig(db, log, configRequest());
  db.prepare(
    'UPDATE ai_service_configs SET model = ?, default_model = ?, is_active = 0 WHERE id = ?'
  ).run(JSON.stringify(['current-model']), 'retired-model', created.id);

  const edited = aiConfigService.updateConfig(db, log, created.id, {
    name: 'Editable disabled history',
    model: [' current-model ', '', 'current-model'],
  });
  assert.equal(edited.is_active, false);
  assert.equal(edited.name, 'Editable disabled history');
  assert.deepEqual(edited.model, ['current-model']);
  assert.equal(edited.default_model, 'retired-model');

  assert.throws(
    () => aiConfigService.updateConfig(db, log, created.id, { is_active: true }),
    (error) => error.code === 'INVALID_AI_CONFIG'
  );
  const repaired = aiConfigService.updateConfig(db, log, created.id, {
    model: ['current-model', 'retired-model'],
    is_active: true,
  });
  assert.equal(repaired.is_active, true);
  assert.equal(repaired.default_model, 'retired-model');
});

test('create API returns a structured sanitized config error for an invalid default model', (t) => {
  const db = createDb(t);
  const routes = aiConfigRoutes(db, log, {});
  const res = mockResponse();
  const secret = 'LMD_SYNTHETIC_API_CREDENTIAL';

  routes.create({ body: configRequest({
    api_key: secret,
    model: ['current-model'],
    default_model: 'retired-model',
  }) }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'INVALID_AI_CONFIG');
  assert.deepEqual(res.body.error.details, {
    field: 'default_model',
    issue: 'not_in_model_list',
  });
  assert.equal(JSON.stringify(res.body).includes(secret), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_service_configs').get().count, 0);
});

test('update API returns the same structured config error without mutating credentials', (t) => {
  const db = createDb(t);
  const created = aiConfigService.createConfig(db, log, configRequest());
  const routes = aiConfigRoutes(db, log, {});
  const res = mockResponse();
  const secret = 'LMD_SYNTHETIC_UPDATE_CREDENTIAL';

  routes.update({
    params: { id: String(created.id) },
    body: {
      api_key: secret,
      model: ['current-model'],
      default_model: 'retired-model',
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'INVALID_AI_CONFIG');
  assert.deepEqual(res.body.error.details, {
    field: 'default_model',
    issue: 'not_in_model_list',
  });
  assert.equal(JSON.stringify(res.body).includes(secret), false);
  const unchanged = aiConfigService.getConfig(db, created.id);
  assert.equal(unchanged.api_key, 'fixture-api-key');
  assert.deepEqual(unchanged.model, ['current-model']);
  assert.equal(unchanged.default_model, 'current-model');
});

test('JSON import keeps successful creates while an invalid item rolls back its own default mutation', (t) => {
  const db = createDb(t);
  const routes = aiConfigRoutes(db, log, {});
  const imported = JSON.parse(JSON.stringify([
    configRequest({ name: 'Imported default', is_default: true }),
    configRequest({
      name: 'Imported invalid',
      model: ['current-model'],
      default_model: 'retired-model',
      is_default: true,
    }),
    configRequest({
      name: 'Imported secondary',
      model: ' secondary-model ',
      default_model: 'secondary-model',
      is_default: false,
    }),
  ]));

  const statuses = imported.map((body) => {
    const res = mockResponse();
    routes.create({ body }, res);
    return res.statusCode;
  });

  assert.deepEqual(statuses, [201, 400, 201]);
  assert.deepEqual(
    aiConfigService.listConfigs(db, 'text').map((config) => ({
      name: config.name,
      model: config.model,
      is_default: config.is_default,
    })),
    [
      { name: 'Imported default', model: ['current-model'], is_default: true },
      { name: 'Imported secondary', model: ['secondary-model'], is_default: false },
    ]
  );
});

test('provider runtime rejects a historical invalid default before dispatching credentials', async (t) => {
  const db = createDb(t);
  addDramaAndCharacter(db);
  const secret = 'LMD_SYNTHETIC_RUNTIME_CREDENTIAL';
  const created = aiConfigService.createConfig(db, log, configRequest({
    service_type: 'image',
    api_key: secret,
  }));
  db.prepare('UPDATE ai_service_configs SET default_model = ? WHERE id = ?')
    .run('retired-model', created.id);

  const originalCreate = imageService.createAndProcessImage;
  let dispatchCount = 0;
  imageService.createAndProcessImage = async () => {
    dispatchCount += 1;
    return {
      id: 1,
      image_url: '/static/dispatched.png',
      local_path: 'images/dispatched.png',
      provider: 'unexpected-provider',
      model: 'retired-model',
    };
  };
  t.after(() => { imageService.createAndProcessImage = originalCreate; });

  let caught = null;
  try {
    await providerSdkService.generateAssetBibleImagesProduction(db, log, { drama_id: 1 });
  } catch (error) {
    caught = error;
  }

  assert.equal(dispatchCount, 0);
  assert.equal(caught?.code, 'INVALID_AI_CONFIG');
  assert.equal(caught?.status, 400);
  assert.match(caught?.message || '', /默认模型/);
  assert.equal((caught?.message || '').includes(secret), false);
});

test('provider runtime keeps the first normalized model fallback when the default is empty', async (t) => {
  const db = createDb(t);
  addDramaAndCharacter(db);
  aiConfigService.createConfig(db, log, configRequest({
    service_type: 'image',
    model: [' first-model ', '', 'first-model', 'second-model'],
    default_model: '   ',
  }));

  const originalCreate = imageService.createAndProcessImage;
  let dispatchedModel = null;
  imageService.createAndProcessImage = async (_db, _log, params) => {
    dispatchedModel = params.model;
    return {
      id: 1,
      image_url: '/static/generated.png',
      local_path: 'images/generated.png',
      provider: params.provider,
      model: params.model,
    };
  };
  t.after(() => { imageService.createAndProcessImage = originalCreate; });

  const result = await providerSdkService.generateAssetBibleImagesProduction(db, log, { drama_id: 1 });

  assert.equal(result.asset_created, 1);
  assert.equal(dispatchedModel, 'first-model');
});
