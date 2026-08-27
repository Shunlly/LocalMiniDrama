const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowRoutes = require('../src/routes/workflows');
const workflowService = require('../src/services/workflowService');
const {
  checkReadiness,
  checkNovel2AnimeReadiness,
  serviceConfigReadiness,
} = require('../src/services/readinessService');
const {
  acquireServiceMaintenanceLockSync,
} = require('../src/services/dataBackupService');

const log = {
  info() {},
  error() {},
};

function createWorkflowDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (1, 'Readiness test', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

function addConfig(db, serviceType, options = {}) {
  const now = new Date().toISOString();
  const provider = options.provider || 'openai';
  const model = options.model || `${serviceType}-model`;
  const apiKey = options.apiKey === undefined ? 'secret-key' : options.apiKey;
  const result = db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, is_default, is_active, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    serviceType,
    provider,
    options.apiProtocol || '',
    options.name || `${serviceType} config`,
    options.baseUrl || 'https://provider.invalid/v1',
    apiKey,
    JSON.stringify([model]),
    model,
    options.isDefault === false ? 0 : 1,
    options.settings ? JSON.stringify(options.settings) : null,
    now,
    now
  );
  return Number(result.lastInsertRowid);
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

function makeReadinessWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-ready-workspace-'));
  const storage = path.join(root, 'storage');
  const storySources = path.join(root, 'story_sources');
  const databasePath = path.join(root, 'drama_generator.db');
  fs.mkdirSync(storage);
  fs.mkdirSync(storySources);
  const db = new Database(databasePath);
  runMigrationsAndEnsure(db);
  const maintenanceGuard = acquireServiceMaintenanceLockSync({
    databasePath,
    storagePath: storage,
    storySourcesPath: storySources,
    ownerScope: 'readiness-test-' + process.pid,
  });
  t.after(() => {
    try {
      if (db.open) db.close();
    } finally {
      try { maintenanceGuard.release(); } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
  return { root, storage, storySources, databasePath, db, maintenanceGuard };
}

test('readiness requires both a queryable database and writable storage', (t) => {
  const workspace = makeReadinessWorkspace(t);
  const before = workspace.db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count;
  const result = checkReadiness(workspace.db, workspace.storage, {
    maintenanceGuard: workspace.maintenanceGuard,
  });
  const after = workspace.db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count;
  assert.equal(result.ready, true);
  assert.equal(result.checks.database.ok, true);
  assert.equal(result.checks.storage.ok, true);
  assert.equal(result.checks.maintenance.ok, true);
  assert.equal(after, before);
});

test('readiness performs a real file write and fsync, then removes the probe', (t) => {
  const workspace = makeReadinessWorkspace(t);
  const calls = [];
  const fileSystem = Object.create(fs);
  fileSystem.writeSync = (...args) => {
    calls.push('write');
    return fs.writeSync(...args);
  };
  fileSystem.fsyncSync = (...args) => {
    calls.push('fsync');
    return fs.fsyncSync(...args);
  };
  fileSystem.unlinkSync = (...args) => {
    calls.push('unlink');
    return fs.unlinkSync(...args);
  };

  const result = checkReadiness(workspace.db, workspace.storage, {
    fs: fileSystem,
    maintenanceGuard: workspace.maintenanceGuard,
  });

  assert.equal(result.ready, true);
  assert.ok(calls.includes('write'));
  assert.ok(calls.includes('fsync'));
  assert.ok(calls.includes('unlink'));
  assert.deepEqual(fs.readdirSync(workspace.storage), []);
});

test('readiness fails without exposing filesystem details or allowing a missing maintenance lease', (t) => {
  const workspace = makeReadinessWorkspace(t);
  fs.rmSync(workspace.storage, { recursive: true, force: true });
  const secretPath = path.join(workspace.root, 'private', 'lease.json');
  const result = checkReadiness(workspace.db, workspace.storage, {
    assertMaintenanceLease() {
      throw new Error('敏感路径 ' + secretPath);
    },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.checks.storage, { ok: false, error: 'storage unavailable' });
  assert.deepEqual(result.checks.maintenance, { ok: false, error: 'maintenance lease unavailable' });
  assert.equal(JSON.stringify(result).includes(secretPath), false);
});

test('readiness refuses a closed database even when storage and lease are healthy', (t) => {
  const workspace = makeReadinessWorkspace(t);
  workspace.db.close();
  const result = checkReadiness(workspace.db, workspace.storage, {
    maintenanceGuard: workspace.maintenanceGuard,
  });
  assert.equal(result.ready, false);
  assert.equal(result.checks.database.ok, false);
  assert.equal(result.checks.storage.ok, true);
  assert.equal(result.checks.maintenance.ok, true);
});

test('production workflow readiness reports concrete missing capabilities without secrets or local paths', (t) => {
  const db = createWorkflowDb(t);
  addConfig(db, 'storyboard_image');
  addConfig(db, 'video');

  const result = checkNovel2AnimeReadiness(db, {
    drama_id: 1,
    qa_mode: 'production',
  }, {
    validateMediaTools: () => ({
      ok: false,
      ffmpeg: { ok: false, path: 'C:\\private\\ffmpeg.exe' },
      ffprobe: { ok: false, path: 'C:\\private\\ffprobe.exe' },
    }),
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    result.missing_capabilities.map((item) => item.key),
    ['text', 'asset_image', 'tts', 'ffmpeg']
  );
  assert.equal(result.capabilities.find((item) => item.key === 'image').ready, true);
  assert.equal(result.capabilities.find((item) => item.key === 'video').ready, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(serialized.includes('C:\\private'), false);
});

test('production workflow readiness is ready only when every required capability is available', (t) => {
  const db = createWorkflowDb(t);
  for (const serviceType of ['text', 'image', 'storyboard_image', 'video', 'tts']) addConfig(db, serviceType);

  const result = checkNovel2AnimeReadiness(db, {
    drama_id: 1,
    qa_mode: 'production',
  }, {
    validateMediaTools: () => ({
      ok: true,
      ffmpeg: { ok: true, path: 'ffmpeg' },
      ffprobe: { ok: true, path: 'ffprobe' },
    }),
  });

  assert.equal(result.ready, true);
  assert.equal(result.missing_capabilities.length, 0);
  assert.equal(result.capabilities.length, 6);
  assert.equal(result.capabilities.every((item) => item.required && item.ready), true);
});

test('production readiness rejects an enabled default with no usable model', (t) => {
  const db = createWorkflowDb(t);
  addConfig(db, 'text');
  addConfig(db, 'image');
  addConfig(db, 'storyboard_image');
  addConfig(db, 'video');
  addConfig(db, 'tts');
  db.prepare('UPDATE ai_service_configs SET model = ?, default_model = NULL WHERE service_type = ?')
    .run('[]', 'video');

  const result = checkNovel2AnimeReadiness(db, { drama_id: 1, qa_mode: 'production' }, {
    validateMediaTools: () => ({ ok: true, ffmpeg: { ok: true }, ffprobe: { ok: true } }),
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing_capabilities.map((item) => item.key), ['video']);
  assert.equal(result.capabilities.find((item) => item.key === 'video').detail.includes('可用模型'), true);
  assert.equal(serviceConfigReadiness({ service_type: 'video', model: [], default_model: '' }).ready, false);
});

test('production readiness reports an actionable reason for a historical invalid default model', (t) => {
  const db = createWorkflowDb(t);
  for (const serviceType of ['text', 'image', 'storyboard_image', 'video', 'tts']) addConfig(db, serviceType);
  db.prepare(
    'UPDATE ai_service_configs SET model = ?, default_model = ? WHERE service_type = ?'
  ).run(JSON.stringify(['current-video-model']), 'retired-video-model', 'video');

  const direct = serviceConfigReadiness({
    service_type: 'video',
    provider: 'openai',
    api_key: 'LMD_SYNTHETIC_READINESS_CREDENTIAL',
    model: [' current-video-model ', '', 'current-video-model'],
    default_model: ' retired-video-model ',
  });
  assert.equal(direct.ready, false);
  assert.equal(direct.issue, 'invalid_default_model');

  const result = checkNovel2AnimeReadiness(db, { drama_id: 1, qa_mode: 'production' }, {
    validateMediaTools: () => ({ ok: true, ffmpeg: { ok: true }, ffprobe: { ok: true } }),
  });
  const video = result.capabilities.find((item) => item.key === 'video');
  assert.equal(result.ready, false);
  assert.equal(video.ready, false);
  assert.equal(video.issue, 'invalid_default_model');
  assert.match(video.detail, /默认模型.*可用模型列表.*重新选择/);
  assert.equal(JSON.stringify(result).includes('LMD_SYNTHETIC_READINESS_CREDENTIAL'), false);
});

test('production readiness rejects remote provider configs without credentials', (t) => {
  const db = createWorkflowDb(t);
  for (const serviceType of ['text', 'image', 'storyboard_image', 'video', 'tts']) {
    addConfig(db, serviceType, { apiKey: serviceType === 'video' ? '' : 'secret-key' });
  }

  const result = checkNovel2AnimeReadiness(db, { drama_id: 1, qa_mode: 'production' }, {
    validateMediaTools: () => ({ ok: true, ffmpeg: { ok: true }, ffprobe: { ok: true } }),
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing_capabilities.map((item) => item.key), ['video']);
  assert.equal(result.missing_capabilities[0].issue, 'missing_credentials');
  assert.match(result.missing_capabilities[0].detail, /生产凭据/);
  assert.equal(JSON.stringify(result).includes('secret-key'), false);
});

test('only explicit local protocols and real alternate credentials may omit api_key', () => {
  const ollama = serviceConfigReadiness({
    service_type: 'text',
    provider: 'ollama',
    base_url: 'http://127.0.0.1:11434/v1',
    model: ['qwen3:8b'],
  });
  assert.equal(ollama.ready, true);
  assert.equal(ollama.credentialOptional, true);

  const kling = serviceConfigReadiness({
    service_type: 'video',
    provider: 'klingai',
    api_protocol: 'kling_omni',
    model: ['kling-video-o1'],
    settings: JSON.stringify({ kling_access_key: 'synthetic-ak', kling_secret_key: 'synthetic-sk' }),
  });
  assert.equal(kling.ready, true);
  assert.equal(kling.credentialSet, true);

  const maskedSpoof = serviceConfigReadiness({
    service_type: 'video',
    provider: 'klingai',
    api_protocol: 'kling_omni',
    model: ['kling-video-o1'],
    settings: JSON.stringify({ kling_access_key: '********', kling_secret_key: '********' }),
  });
  assert.equal(maskedSpoof.ready, false);
  assert.equal(maskedSpoof.issue, 'missing_credentials');
});

test('only a valid ComfyUI image workflow may omit a model', (t) => {
  const db = createWorkflowDb(t);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, api_protocol, name, base_url, model, default_model, is_default, is_active, settings, created_at, updated_at)
     VALUES ('storyboard_image', 'comfyui', 'comfyui', 'Comfy workflow', 'http://127.0.0.1:8188', '[]', NULL, 1, 1, ?, ?, ?)`
  ).run(JSON.stringify({ workflow: { '1': { class_type: 'KSampler' } } }), now, now);

  const result = checkNovel2AnimeReadiness(db, { drama_id: 1, qa_mode: 'production' }, {
    validateMediaTools: () => ({ ok: true, ffmpeg: { ok: true }, ffprobe: { ok: true } }),
  });
  const image = result.capabilities.find((item) => item.key === 'image');
  assert.equal(image.ready, true);
  assert.equal(serviceConfigReadiness({
    service_type: 'storyboard_image',
    api_protocol: 'comfyui',
    model: [],
    settings: JSON.stringify({ workflow: { '1': { class_type: 'KSampler' } } }),
  }).ready, true);
  const modelCannotBypassWorkflow = serviceConfigReadiness({
    service_type: 'storyboard_image',
    api_protocol: 'comfyui',
    model: ['custom-workflow'],
    settings: '{}',
  });
  assert.equal(modelCannotBypassWorkflow.ready, false);
  assert.equal(modelCannotBypassWorkflow.issue, 'missing_workflow');
});

test('draft workflow readiness observes capabilities without blocking startup', (t) => {
  const db = createWorkflowDb(t);
  const result = checkNovel2AnimeReadiness(db, { drama_id: 1, qa_mode: 'draft' }, {
    validateMediaTools: () => ({ ok: false, ffmpeg: { ok: false }, ffprobe: { ok: false } }),
  });

  assert.equal(result.ready, true);
  assert.equal(result.missing_capabilities.length, 0);
  assert.equal(result.capabilities.every((item) => item.required === false), true);
});

test('production start route refuses to create a run when authoritative readiness fails', (t) => {
  const db = createWorkflowDb(t);
  const routes = workflowRoutes(db, log);
  const res = mockResponse();

  routes.startNovel2Anime({ body: { drama_id: 1, qa_mode: 'production' } }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'WORKFLOW_NOT_READY');
  assert.match(res.body.error.message, /文本模型/);
  assert.equal(Array.isArray(res.body.error.details.missing_capabilities), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workflow_runs').get().count, 0);
});

test('production retry and resume recheck the original run selection and return the start-route 409 DTO', (t) => {
  const db = createWorkflowDb(t);
  const routes = workflowRoutes(db, log);
  for (const serviceType of ['text', 'image', 'storyboard_image', 'video', 'tts']) addConfig(db, serviceType);
  const selectedImageConfigId = addConfig(db, 'storyboard_image', {
    model: 'selected-storyboard-model',
    name: 'Selected storyboard config',
    isDefault: false,
  });
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    type: 'novel2anime',
    qa_mode: 'production',
    text: 'Production source',
    image_model: 'selected-storyboard-model',
    image_provider: 'openai',
  });
  assert.equal(run.input_json.options.image_model, 'selected-storyboard-model');
  assert.equal(run.input_json.options.image_provider, 'openai');

  db.prepare('DELETE FROM ai_service_configs WHERE id = ?').run(selectedImageConfigId);
  const startResponse = mockResponse();
  routes.startNovel2Anime({
    body: {
      drama_id: 1,
      qa_mode: 'production',
      options: run.input_json.options,
    },
  }, startResponse);
  assert.equal(startResponse.statusCode, 409);
  assert.equal(startResponse.body.error.code, 'WORKFLOW_NOT_READY');
  assert.equal(
    startResponse.body.error.details.missing_capabilities.some((item) => item.key === 'image'),
    true,
  );

  db.prepare("UPDATE workflow_runs SET status = 'failed', error = 'provider failed' WHERE id = ?").run(run.id);
  db.prepare("UPDATE workflow_steps SET status = 'failed', error = 'provider failed' WHERE run_id = ? AND sort_order = 0").run(run.id);
  const retryResponse = mockResponse();
  routes.retry({
    params: { run_id: run.id },
    body: { options: { image_model: 'storyboard_image-model' } },
  }, retryResponse);

  assert.equal(retryResponse.statusCode, 409);
  assert.equal(retryResponse.body.error.code, 'WORKFLOW_NOT_READY');
  assert.equal(retryResponse.body.error.message, startResponse.body.error.message);
  assert.equal(
    retryResponse.body.error.details.missing_capabilities.some((item) => item.key === 'image'),
    true,
  );
  const { checked_at: _startCheckedAt, ...startDetails } = startResponse.body.error.details;
  const { checked_at: _retryCheckedAt, ...retryDetails } = retryResponse.body.error.details;
  assert.deepEqual(retryDetails, startDetails);
  assert.equal(db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(run.id).status, 'failed');

  db.prepare("UPDATE workflow_runs SET status = 'paused', error = 'paused' WHERE id = ?").run(run.id);
  const resumeResponse = mockResponse();
  routes.resume({ params: { run_id: run.id } }, resumeResponse);

  assert.equal(resumeResponse.statusCode, 409);
  assert.equal(resumeResponse.body.error.code, 'WORKFLOW_NOT_READY');
  assert.equal(resumeResponse.body.error.message, startResponse.body.error.message);
  const { checked_at: _resumeCheckedAt, ...resumeDetails } = resumeResponse.body.error.details;
  assert.deepEqual(resumeDetails, startDetails);
  assert.equal(db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(run.id).status, 'paused');
});
