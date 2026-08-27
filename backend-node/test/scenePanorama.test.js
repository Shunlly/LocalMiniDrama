const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const sceneService = require('../src/services/sceneService');
const sceneRoutes = require('../src/routes/scenes');
const imageService = require('../src/services/imageService');
const imageClient = require('../src/services/imageClient');
const uploadService = require('../src/services/uploadService');
const configModule = require('../src/config');
const taskService = require('../src/services/taskService');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const log = {
  info() {},
  warn() {},
  error() {},
};

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function insertDrama(db, title = 'Panorama test') {
  const now = new Date().toISOString();
  const drama = db.prepare(
    `INSERT INTO dramas (title, status, created_at, updated_at)
     VALUES (?, 'draft', ?, ?)`
  ).run(title, now, now);
  const episode = db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, 1, 'Episode 1', 'draft', ?, ?)`
  ).run(drama.lastInsertRowid, now, now);
  return { dramaId: Number(drama.lastInsertRowid), episodeId: Number(episode.lastInsertRowid), now };
}

function insertScene(db, dramaId, episodeId, values = {}) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO scenes
     (drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images,
      status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?)`
  ).run(
    dramaId,
    episodeId,
    values.location || 'Atrium',
    values.time || 'day',
    values.prompt || 'A glass atrium',
    values.image_url ?? null,
    values.local_path ?? null,
    values.extra_images ?? null,
    now,
    now
  );
  return Number(info.lastInsertRowid);
}

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function writeStorageFile(root, relativePath, contents) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

test('migration 26 and compatibility ensure expose independent scene panorama columns', () => {
  const db = createDb();
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(scenes)').all().map((column) => column.name));
    assert.equal(columns.has('panorama_image_url'), true);
    assert.equal(columns.has('panorama_local_path'), true);
    assert.equal(columns.has('panorama_image_id'), true);
  } finally {
    db.close();
  }
});

test('panorama route rejects a scene without a usable main source image', () => {
  const db = createDb();
  try {
    const { dramaId, episodeId } = insertDrama(db);
    const sceneId = insertScene(db, dramaId, episodeId, {
      image_url: 'placeholder://scene-source',
      local_path: 'mock://scene-source',
    });
    const routes = sceneRoutes(db, log, {});
    const res = mockResponse();

    routes.generatePanorama({ params: { scene_id: sceneId }, body: {} }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.error.message, /场景.*主图/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
  } finally {
    db.close();
  }
});

test('scene panorama request uses the main image as one reference with a 2:1 equirectangular prompt', () => {
  const db = createDb();
  const originalCreate = imageService.create;
  const originalLoadConfig = configModule.loadConfig;
  const tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-panorama-request-'));
  try {
    configModule.loadConfig = () => ({ storage: { local_path: tempStorage } });
    const { dramaId, episodeId } = insertDrama(db);
    const sceneId = insertScene(db, dramaId, episodeId, {
      image_url: 'https://cdn.example.test/scenes/atrium.jpg',
      local_path: 'projects/panorama/scenes/atrium.jpg',
    });
    let request = null;
    imageService.create = (_db, _log, payload) => {
      request = payload;
      return { id: 91, task_id: 'task-91', status: 'pending' };
    };

    const result = sceneService.generateScenePanoramaImage(db, log, sceneId, 'image-model', 'cinematic');

    assert.equal(result.ok, true);
    assert.equal(result.image_generation.task_id, 'task-91');
    assert.equal(request.frame_type, 'scene_panorama');
    assert.deepEqual(request.reference_images, ['projects/panorama/scenes/atrium.jpg']);
    assert.equal(request.size, '2048x1024');
    assert.equal(Number(request.size.split('x')[0]) / Number(request.size.split('x')[1]), 2);
    assert.match(request.prompt, /equirectangular/i);
    assert.match(request.prompt, /360-degree/i);
    assert.match(request.prompt, /2:1/);
  } finally {
    imageService.create = originalCreate;
    configModule.loadConfig = originalLoadConfig;
    db.close();
    fs.rmSync(tempStorage, { recursive: true, force: true });
  }
});

test('completed scene panorama task binds panorama fields and leaves the main image unchanged', async () => {
  const db = createDb();
  const tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-panorama-task-'));
  const originals = {
    getDefaultImageConfig: imageClient.getDefaultImageConfig,
    getStoryboardReferenceLimits: imageClient.getStoryboardReferenceLimits,
    callImageApi: imageClient.callImageApi,
    downloadImageToLocalAbortable: imageClient.downloadImageToLocalAbortable,
    loadConfig: configModule.loadConfig,
  };
  try {
    const { dramaId, episodeId } = insertDrama(db);
    const mainPath = 'projects/panorama/scenes/main.jpg';
    const mainUrl = '/static/projects/panorama/scenes/main.jpg';
    const extras = JSON.stringify(['projects/panorama/scenes/older.jpg']);
    const sceneId = insertScene(db, dramaId, episodeId, {
      image_url: mainUrl,
      local_path: mainPath,
      extra_images: extras,
    });
    const panoramaPath = 'projects/panorama/scenes/generated-panorama.jpg';
    let apiRequest = null;

    imageClient.getDefaultImageConfig = () => ({ provider: 'test', model: 'test-image' });
    imageClient.getStoryboardReferenceLimits = () => ({ total: 4, maxCharacters: 3, maxObjects: 4 });
    imageClient.callImageApi = async (_db, _log, request) => {
      apiRequest = request;
      return { image_url: 'https://provider.example.test/generated-panorama.jpg' };
    };
    imageClient.downloadImageToLocalAbortable = async () => panoramaPath;
    configModule.loadConfig = () => ({
      storage: { local_path: tempStorage, base_url: 'http://localhost:5679/static' },
      style: {},
    });

    const created = imageService.create(db, log, {
      drama_id: dramaId,
      scene_id: sceneId,
      frame_type: 'scene_panorama',
      reference_images: [mainPath],
      prompt: sceneService.buildScenePanoramaPrompt({ location: 'Atrium', time: 'day' }),
      size: '2048x1024',
      __defer_processing: true,
    });
    await imageService.processImageGeneration(db, log, created.id);

    const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId);
    assert.equal(scene.image_url, mainUrl);
    assert.equal(scene.local_path, mainPath);
    assert.equal(scene.extra_images, extras);
    assert.equal(scene.panorama_image_url, `/static/${panoramaPath}`);
    assert.equal(scene.panorama_local_path, panoramaPath);
    assert.equal(scene.panorama_image_id, created.id);
    assert.equal(apiRequest.size, '2048x1024');
    assert.deepEqual(apiRequest.reference_image_urls, [mainPath]);

    const task = taskService.getTask(db, created.task_id);
    assert.equal(task.status, 'completed');
    const taskResult = JSON.parse(task.result);
    assert.equal(taskResult.frame_type, 'scene_panorama');
    assert.equal(taskResult.scene_binding, 'panorama');
  } finally {
    imageClient.getDefaultImageConfig = originals.getDefaultImageConfig;
    imageClient.getStoryboardReferenceLimits = originals.getStoryboardReferenceLimits;
    imageClient.callImageApi = originals.callImageApi;
    imageClient.downloadImageToLocalAbortable = originals.downloadImageToLocalAbortable;
    configModule.loadConfig = originals.loadConfig;
    db.close();
    fs.rmSync(tempStorage, { recursive: true, force: true });
  }
});

test('project export and import carry panorama JSON, media, and a remapped generation binding', () => {
  const sourceDb = createDb();
  const targetDb = createDb();
  const sourceStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-panorama-export-'));
  const targetStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-panorama-import-'));
  try {
    const { dramaId, episodeId, now } = insertDrama(sourceDb, 'Panorama round trip');
    const mainPath = 'projects/source/scenes/main.png';
    const panoramaPath = 'projects/source/scenes/panorama.png';
    writeStorageFile(sourceStorage, mainPath, VALID_PNG_BYTES);
    writeStorageFile(sourceStorage, panoramaPath, VALID_PNG_BYTES);
    const sceneId = insertScene(sourceDb, dramaId, episodeId, {
      image_url: `/static/${mainPath}`,
      local_path: mainPath,
    });
    const generation = sourceDb.prepare(
      `INSERT INTO image_generations
       (drama_id, scene_id, provider, prompt, frame_type, image_url, local_path,
        status, completed_at, created_at, updated_at)
       VALUES (?, ?, 'test', 'panorama prompt', 'scene_panorama', ?, ?, 'completed', ?, ?, ?)`
    ).run(dramaId, sceneId, `/static/${panoramaPath}`, panoramaPath, now, now, now);
    sourceDb.prepare(
      `UPDATE scenes
          SET panorama_image_url = ?, panorama_local_path = ?, panorama_image_id = ?
        WHERE id = ?`
    ).run(`/static/${panoramaPath}`, panoramaPath, generation.lastInsertRowid, sceneId);

    const exported = dramaExportService.exportDrama(
      sourceDb, { storage: { local_path: sourceStorage } }, log, dramaId
    );
    const zip = new AdmZip(exported.buffer);
    const project = JSON.parse(zip.readAsText('project.json'));
    const exportedScene = project.scenes[0];
    assert.equal(exportedScene.panorama_image_url, `/static/${panoramaPath}`);
    assert.equal(exportedScene.panorama_local_path, panoramaPath);
    assert.equal(exportedScene.panorama_image_id, generation.lastInsertRowid);
    assert.ok(zip.getEntry(exportedScene.panorama_image_file));

    const imported = dramaImportService.importDrama(
      targetDb, { storage: { local_path: targetStorage } }, log, exported.buffer
    );
    const scene = targetDb.prepare('SELECT * FROM scenes WHERE drama_id = ?').get(imported.drama_id);
    assert.ok(scene.local_path);
    assert.ok(scene.panorama_local_path);
    assert.notEqual(scene.local_path, scene.panorama_local_path);
    assert.match(scene.local_path, /scene_imp_/);
    assert.match(scene.panorama_local_path, /scene_panorama_imp_/);
    assert.equal(scene.panorama_image_url, `/static/${scene.panorama_local_path}`);
    assert.equal(scene.extra_images, null);

    const importedGeneration = targetDb.prepare('SELECT * FROM image_generations WHERE id = ?')
      .get(scene.panorama_image_id);
    assert.equal(importedGeneration.scene_id, scene.id);
    assert.equal(importedGeneration.frame_type, 'scene_panorama');
    assert.equal(importedGeneration.local_path, scene.panorama_local_path);
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, ...scene.local_path.split('/'))),
      VALID_PNG_BYTES
    );
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, ...scene.panorama_local_path.split('/'))),
      VALID_PNG_BYTES
    );
  } finally {
    sourceDb.close();
    targetDb.close();
    fs.rmSync(sourceStorage, { recursive: true, force: true });
    fs.rmSync(targetStorage, { recursive: true, force: true });
  }
});
