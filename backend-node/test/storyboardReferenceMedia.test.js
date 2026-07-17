const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const storyboardService = require('../src/services/storyboardService');
const dramaService = require('../src/services/dramaService');
const videoService = require('../src/services/videoService');
const videoClient = require('../src/services/videoClient');
const imageService = require('../src/services/imageService');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = '2026-07-16T12:00:00.000Z';
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (1, 'Reference Test', 'draft', '{}', ?, ?),
            (2, 'Other Drama', 'draft', '{}', ?, ?)`
  ).run(now, now, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (1, 1, 1, 'Episode 1', 'draft', ?, ?),
            (2, 2, 1, 'Other Episode', 'draft', ?, ?)`
  ).run(now, now, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, status, created_at, updated_at)
     VALUES (11, 1, 1, 'Shot 1', 'pending', ?, ?),
            (12, 1, 2, 'Shot 2', 'pending', ?, ?),
            (21, 2, 1, 'Other Shot', 'pending', ?, ?)`
  ).run(now, now, now, now, now, now);
  return db;
}

function insertGrid(db, options = {}) {
  const now = '2026-07-16T12:00:00.000Z';
  const info = db.prepare(
    `INSERT INTO image_generations
     (id, drama_id, storyboard_id, provider, prompt, frame_type, image_url, local_path,
      status, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'test', 'grid', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.id ?? null,
    options.dramaId ?? 1,
    options.storyboardId ?? 11,
    options.frameType || 'quad_grid',
    options.imageUrl || null,
    options.localPath || 'projects/reference/grid.png',
    options.status || 'completed',
    now,
    now,
    now
  );
  return Number(options.id ?? info.lastInsertRowid);
}

function insertVideoConfig(db, options = {}) {
  const now = '2026-07-16T12:00:00.000Z';
  db.prepare(
    `INSERT INTO ai_service_configs
     (service_type, provider, api_protocol, name, base_url, api_key, model, default_model,
      endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
     VALUES ('video', ?, ?, 'Video Test', 'https://video.example/v1', 'test-key', ?, ?,
      '/videos', '/videos/{taskId}', 10, 1, 1, ?, ?, ?)`
  ).run(
    options.provider || 'testvideo',
    options.protocol || 'openai_video',
    JSON.stringify([options.model || 'video-test-model']),
    options.model || 'video-test-model',
    JSON.stringify({ supports_grid_reference: options.supportsGrid === true }),
    now,
    now
  );
}

function writeStorageFile(storageRoot, relativePath, contents) {
  const absolutePath = path.join(storageRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

describe('storyboard reference media', () => {
  it('rejects video generation before creating a task when the provider is not ready', (t) => {
    const db = createDb();
    t.after(() => db.close());

    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1,
        storyboard_id: 11,
        image_url: '/static/projects/reference/first.png',
      }, { defer_processing: true }),
      /缺少已启用的视频生成配置/
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);

    insertVideoConfig(db);
    db.prepare("UPDATE ai_service_configs SET model = '[]', default_model = NULL WHERE service_type = 'video'").run();
    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1,
        storyboard_id: 11,
        image_url: '/static/projects/reference/first.png',
      }, { defer_processing: true }),
      /尚未选择可用模型/
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
  });

  it('rejects traversal, encoded static traversal, and more than ten free references', () => {
    assert.throws(
      () => storyboardService.normalizeReferenceImages([{ local_path: '../secret.png' }]),
      /本地路径无效/
    );
    assert.throws(
      () => storyboardService.normalizeReferenceImages([{ image_url: '/static/%2e%2e/secret.png' }]),
      /静态地址无效/
    );
    assert.throws(
      () => storyboardService.normalizeReferenceImages(
        Array.from({ length: 11 }, (_, index) => ({ image_url: `https://cdn.example/${index}.png` }))
      ),
      /最多保存 10 张/
    );
  });

  it('keeps sanitized cross-project provenance and drops unrelated metadata', () => {
    const normalized = JSON.parse(storyboardService.normalizeReferenceImages([{
      name: 'Source image',
      local_path: 'projects/reference/source.png',
      asset_id: 42,
      source_drama_id: 7,
      source_drama_title: 'Source\r\nProject',
      api_key: 'must-not-persist',
    }]));
    assert.deepEqual(normalized, [{
      name: 'Source image',
      local_path: 'projects/reference/source.png',
      image_url: null,
      asset_id: 42,
      source_drama_id: 7,
      source_drama_title: 'Source  Project',
    }]);
    assert.throws(
      () => storyboardService.normalizeReferenceImages([{ local_path: 'projects/reference/source.png', asset_id: -1 }]),
      /素材 ID 无效/
    );
  });

  it('returns persisted free references through the drama detail aggregate', (t) => {
    const db = createDb();
    t.after(() => db.close());
    const reference = {
      name: 'Shared source',
      local_path: 'projects/reference/shared.png',
      asset_id: 42,
      source_drama_id: 2,
      source_drama_title: 'Other Drama',
    };
    storyboardService.updateStoryboard(db, log, 11, { reference_images: [reference] });

    const detail = dramaService.getDrama(db, 1);
    const storyboard = detail.episodes[0].storyboards.find((item) => item.id === 11);
    assert.deepEqual(storyboard.reference_images, [{ ...reference, image_url: null }]);
    assert.equal(storyboard.video_reference_image_id, null);
  });

  it('rejects grid IDs from another storyboard or drama', (t) => {
    const db = createDb();
    t.after(() => db.close());
    const otherShotGrid = insertGrid(db, { storyboardId: 12 });
    const otherDramaGrid = insertGrid(db, { dramaId: 2, storyboardId: 21 });

    assert.throws(
      () => storyboardService.updateStoryboard(db, log, 11, { video_reference_image_id: otherShotGrid }),
      /不属于当前分镜/
    );
    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1,
        storyboard_id: 11,
        video_reference_image_id: otherDramaGrid,
      }, { defer_processing: true }),
      /不属于当前分镜/
    );
  });

  it('enforces model capability and rejects a mismatched primary URL', (t) => {
    const db = createDb();
    t.after(() => db.close());
    const gridId = insertGrid(db);
    insertVideoConfig(db, { supportsGrid: false });

    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1,
        storyboard_id: 11,
        provider: 'testvideo',
        video_reference_image_id: gridId,
      }, { defer_processing: true }),
      /未声明支持宫格整图参考/
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);

    db.prepare(
      `UPDATE ai_service_configs SET settings = '{"supports_grid_reference":true}' WHERE service_type = 'video'`
    ).run();
    assert.throws(
      () => videoService.createVideoGeneration(db, log, {
        drama_id: 1,
        storyboard_id: 11,
        provider: 'testvideo',
        video_reference_image_id: gridId,
        image_url: 'https://attacker.example/not-the-grid.png',
      }, { defer_processing: true }),
      /ID 与提交的主图地址不一致/
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
  });

  it('canonicalizes a valid grid reference and clears the binding when the image is deleted', (t) => {
    const db = createDb();
    t.after(() => db.close());
    const gridId = insertGrid(db);
    insertVideoConfig(db, { supportsGrid: true });
    storyboardService.updateStoryboard(db, log, 11, { video_reference_image_id: gridId });

    const created = videoService.createVideoGeneration(db, log, {
      drama_id: 1,
      storyboard_id: 11,
      provider: 'testvideo',
      video_reference_image_id: gridId,
      first_frame_url: 'http://localhost:3013/static/projects/reference/grid.png',
      reference_image_urls: [
        'http://localhost:3013/static/projects/reference/grid.png',
        'https://cdn.example/character.png',
      ],
    }, { defer_processing: true });
    const row = db.prepare(
      'SELECT image_url, first_frame_url, reference_image_urls FROM video_generations WHERE id = ?'
    ).get(created.id);
    assert.equal(row.image_url, '/static/projects/reference/grid.png');
    assert.equal(row.first_frame_url, '/static/projects/reference/grid.png');
    assert.deepEqual(JSON.parse(row.reference_image_urls), [
      '/static/projects/reference/grid.png',
      'https://cdn.example/character.png',
    ]);
    const listed = videoService.list(db, { storyboard_id: 11 }).items[0];
    assert.equal(listed.first_frame_url, '/static/projects/reference/grid.png');
    assert.deepEqual(listed.reference_image_urls, [
      '/static/projects/reference/grid.png',
      'https://cdn.example/character.png',
    ]);

    assert.equal(imageService.deleteById(db, log, gridId), true);
    assert.equal(
      db.prepare('SELECT video_reference_image_id FROM storyboards WHERE id = 11').get().video_reference_image_id,
      null
    );
  });

  it('keeps the classic primary frame when additional reference URLs are present', async (t) => {
    const db = createDb();
    t.after(() => db.close());
    insertVideoConfig(db, { supportsGrid: false });
    const created = videoService.createVideoGeneration(db, log, {
      drama_id: 1,
      storyboard_id: 11,
      provider: 'testvideo',
      image_url: '/static/projects/reference/first.png',
      first_frame_url: '/static/projects/reference/first.png',
      reference_image_urls: ['/static/projects/reference/first.png', 'https://cdn.example/extra.png'],
    }, { defer_processing: true });

    const originalCallVideoApi = videoClient.callVideoApi;
    let captured = null;
    videoClient.callVideoApi = async (_db, _log, options) => {
      captured = options;
      return { error: 'expected test stop' };
    };
    t.after(() => { videoClient.callVideoApi = originalCallVideoApi; });

    await videoService.processVideoGeneration(db, log, created.id);
    assert.equal(captured.image_url, '/static/projects/reference/first.png');
    assert.equal(captured.first_frame_url, '/static/projects/reference/first.png');
    assert.deepEqual(captured.reference_urls, [
      '/static/projects/reference/first.png',
      'https://cdn.example/extra.png',
    ]);
  });

  it('round-trips packaged reference files and drops remote references during ZIP import', (t) => {
    const sourceStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-reference-source-'));
    const targetStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-reference-target-'));
    const sourceDb = createDb();
    const targetDb = new Database(':memory:');
    runMigrationsAndEnsure(targetDb);
    t.after(() => {
      sourceDb.close();
      targetDb.close();
      fs.rmSync(sourceStorage, { recursive: true, force: true });
      fs.rmSync(targetStorage, { recursive: true, force: true });
    });

    const freePath = 'projects/reference/references/sketch.png';
    const gridPath = 'projects/reference/images/grid.png';
    writeStorageFile(sourceStorage, freePath, VALID_PNG_BYTES);
    writeStorageFile(sourceStorage, gridPath, VALID_PNG_BYTES);
    const gridId = insertGrid(sourceDb, { id: 77, localPath: gridPath, frameType: 'nine_grid' });
    storyboardService.updateStoryboard(sourceDb, log, 11, {
      reference_images: [
        { name: 'Sketch', local_path: freePath },
        { name: 'Remote', image_url: 'https://cdn.example/remote.png' },
      ],
      video_reference_image_id: gridId,
    });

    const exported = dramaExportService.exportDrama(
      sourceDb,
      { storage: { local_path: sourceStorage } },
      log,
      1
    );
    const archive = new AdmZip(exported.buffer);
    const project = JSON.parse(archive.readAsText('project.json'));
    const exportedStoryboard = project.episodes[0].storyboards.find((item) => item.storyboard_number === 1);
    assert.equal(project.version, '1.6');
    assert.equal(exportedStoryboard.video_reference_image_original_id, 77);
    assert.equal(exportedStoryboard.reference_images.length, 2);
    assert.deepEqual(
      archive.readFile(exportedStoryboard.reference_images[0].zip_file),
      VALID_PNG_BYTES
    );

    const imported = dramaImportService.importDrama(
      targetDb,
      { storage: { local_path: targetStorage } },
      log,
      exported.buffer
    );
    const importedStoryboard = targetDb.prepare(
      `SELECT s.* FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
       WHERE e.drama_id = ? AND s.storyboard_number = 1 AND s.deleted_at IS NULL`
    ).get(imported.drama_id);
    const restoredReferences = JSON.parse(importedStoryboard.reference_images);
    assert.equal(restoredReferences.length, 1);
    assert.match(restoredReferences[0].local_path, /\/references\//);
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, restoredReferences[0].local_path)),
      VALID_PNG_BYTES
    );
    assert.equal(restoredReferences.some((item) => item.image_url === 'https://cdn.example/remote.png'), false);

    const restoredGrid = targetDb.prepare(
      `SELECT id, frame_type, local_path FROM image_generations
       WHERE storyboard_id = ? AND frame_type = 'nine_grid' AND deleted_at IS NULL`
    ).get(importedStoryboard.id);
    assert.ok(restoredGrid);
    assert.equal(importedStoryboard.video_reference_image_id, restoredGrid.id);
    assert.notEqual(restoredGrid.id, 77);
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, restoredGrid.local_path)),
      VALID_PNG_BYTES
    );
  });
});
