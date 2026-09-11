'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaExportService = require('../src/services/dramaExportService');
const {
  tryNormalizeFreeCanvasExportPath,
  normalizeFreeCanvasExportPath,
  validateFreeCanvasForExport,
  detectedFreeCanvasMediaFormat,
  assertFreeCanvasMediaExtension,
  assertFreeCanvasMediaScope,
  inspectFreeCanvasMedia,
  parseFreeCanvasExportReference,
  collectFreeCanvasImportManifest,
} = require('../src/services/dramaExportFreeCanvas');
const storageLayout = require('../src/services/storageLayout');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaExportService.js'),
  'utf8',
);
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaExportFreeCanvas.js'),
  'utf8',
);
const PUBLIC_API = [
  'DEFAULT_EXPORT_LIMITS',
  'DramaExportError',
  'exportDrama',
  'normalizeExportLimits',
  'resolveExportLimits',
];
const EXTRACTED_FUNCTIONS = [
  'function tryNormalizeFreeCanvasExportPath',
  'function normalizeFreeCanvasExportPath',
  'function validateFreeCanvasForExport',
  'function detectedFreeCanvasMediaFormat',
  'function assertFreeCanvasMediaExtension',
  'function assertFreeCanvasMediaScope',
  'function inspectFreeCanvasMedia',
  'function parseFreeCanvasExportReference',
  'function collectFreeCanvasImportManifest',
];
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const NOW = '2026-07-27T00:00:00.000Z';

function expectExportError(action, code, message, statusCode = 400) {
  assert.throws(action, (error) => (
    error instanceof dramaExportService.DramaExportError
    && error.name === 'DramaExportError'
    && error.code === code
    && error.statusCode === statusCode
    && error.message === message
  ), message);
}

function jpegBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
}

function createCanvasDb() {
  const db = new Database(':memory:');
  db.exec([
    'CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, metadata TEXT, deleted_at TEXT);',
    'CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);',
    'CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, deleted_at TEXT);',
    'CREATE TABLE assets (id INTEGER PRIMARY KEY, drama_id INTEGER, local_path TEXT, deleted_at TEXT);',
    'CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER NOT NULL, deleted_at TEXT);',
    'INSERT INTO episodes (id, drama_id) VALUES (10, 1), (20, 2);',
    'INSERT INTO storyboards (id, episode_id) VALUES (100, 10), (200, 20);',
    "INSERT INTO dramas (id, title, created_at, deleted_at) VALUES (1, 'project', '2026-07-27', NULL), (2, 'other', '2026-07-27', NULL);",
    'INSERT INTO assets (id, drama_id, local_path) VALUES',
    "  (1000, 1, 'projects/0001_20260727_project/images/frame.png'),",
    "  (2000, 2, 'projects/0002_20260727_other/images/frame.png');",
    'INSERT INTO scenes (id, drama_id) VALUES (10000, 1), (20000, 2);',
  ].join('\n'));
  return db;
}

function validCanvas() {
  return {
    version: 1,
    nodes: [{
      id: 'free:image:one',
      type: 'image',
      position: { x: 0, y: 0 },
      content: 'projects/0001_20260727_project/images/frame.png',
      storageKey: 'projects/0001_20260727_project/images/frame.png',
      assetId: 1000,
      storyboardId: 100,
    }],
    edges: [],
  };
}

function createWorkspace(t) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-fc-export-'));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => {
    db.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });
  return { db, storage };
}

function writeStorageMedia(storage, relativePath, bytes) {
  const absolutePath = path.join(storage, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return absolutePath;
}

function createMemoryArchive() {
  const files = new Map();
  return {
    files,
    readStorageFile(storagePath, sourcePath) {
      const absolutePath = path.join(storagePath, ...String(sourcePath).split('/'));
      if (!fs.existsSync(absolutePath)) return null;
      return fs.readFileSync(absolutePath);
    },
    addBuffer(archivePath, buffer) {
      files.set(archivePath, buffer);
    },
  };
}

function sampleDrama(id = 1, title = 'Demo') {
  return { id, title, created_at: NOW, metadata: '{}' };
}

function collectArgs(overrides = {}) {
  const drama = overrides.drama || sampleDrama();
  return {
    db: overrides.db,
    drama,
    storagePath: overrides.storagePath,
    archive: overrides.archive || createMemoryArchive(),
    metadata: overrides.metadata || {
      free_canvas: {
        version: 1,
        nodes: overrides.nodes || [],
      },
    },
    episodes: overrides.episodes || [],
    storyboardsByEp: overrides.storyboardsByEp || {},
    scenes: overrides.scenes || [],
    sceneIdToIndex: overrides.sceneIdToIndex || {},
    imageFilesToPack: overrides.imageFilesToPack || [],
    videosBySb: overrides.videosBySb || {},
  };
}

function insertAsset(db, values) {
  db.prepare(`
    INSERT INTO assets (id, drama_id, name, type, category, local_path, file_size, mime_type, width, height, video_gen_id, created_at, updated_at)
    VALUES (@id, @drama_id, @name, @type, @category, @local_path, @file_size, @mime_type, @width, @height, @video_gen_id, @created_at, @updated_at)
  `).run({
    name: '素材',
    type: 'image',
    category: null,
    file_size: VALID_PNG_BYTES.length,
    mime_type: 'image/png',
    width: 1,
    height: 1,
    video_gen_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...values,
  });
}
function commonsCategory(contentSha256, sha1) {
  return JSON.stringify({
    kind: 'wikimedia_commons',
    source_provider: 'Wikimedia Commons',
    source_url: 'https://commons.wikimedia.org/wiki/File%3APortable_Test.png',
    license: 'CC BY-SA 4.0',
    commons_title: 'File:Portable Test.png',
    commons_page_id: 42,
    commons_revision_timestamp: '2026-08-02T00:00:00Z',
    commons_sha1: sha1,
    resolved_download_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portable_Test.png',
    content_sha256: contentSha256,
  });
}

describe('dramaExportFreeCanvas 自由画布导出拆分', () => {
  it('dramaExportService 公开 API 不变', () => {
    assert.deepEqual(Object.keys(dramaExportService).sort(), [...PUBLIC_API].sort());
  });

  it('自由画布导出实现已从导出服务文件中移出', () => {
    for (const name of EXTRACTED_FUNCTIONS) {
      assert.equal(SERVICE_SRC.includes(name), false, name);
      assert.equal(MODULE_SRC.includes(name), true, name);
    }
    assert.match(SERVICE_SRC, /require\('\.\/dramaExportFreeCanvas'\)/);
    assert.match(MODULE_SRC, /项目导出拒绝了跨项目的自由画布媒体/);
    for (const phrase of [
      'Project export',
      'must be an object',
      'invalid free canvas',
      'free_canvas_import ${field}',
    ]) {
      assert.equal(MODULE_SRC.includes(phrase), false, phrase);
    }
  });

  it('normalizeFreeCanvasExportPath 规范化静态前缀并拒绝不安全路径', () => {
    assert.equal(
      normalizeFreeCanvasExportPath('/static/uploads/frame.png', 'content'),
      'uploads/frame.png',
    );
    assert.equal(
      normalizeFreeCanvasExportPath('  uploads/frame.png  ', 'content'),
      'uploads/frame.png',
    );
    expectExportError(
      () => normalizeFreeCanvasExportPath('', 'content'),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了无效的自由画布 content。',
    );
    expectExportError(
      () => normalizeFreeCanvasExportPath('../secret.png', 'content'),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了不安全的自由画布 content。',
    );
  });

  it('tryNormalizeFreeCanvasExportPath 把无效引用收敛为 null', () => {
    assert.equal(tryNormalizeFreeCanvasExportPath('uploads/ok.png', 'media path'), 'uploads/ok.png');
    assert.equal(tryNormalizeFreeCanvasExportPath('../escape.png', 'media path'), null);
    assert.equal(tryNormalizeFreeCanvasExportPath('', 'media path'), null);
  });

  it('validateFreeCanvasForExport 包装原校验错误并保留成功结果', () => {
    const db = createCanvasDb();
    try {
      expectExportError(
        () => validateFreeCanvasForExport(db, 1, null),
        'INVALID_FREE_CANVAS_REFERENCE',
        '项目导出拒绝了无效的自由画布数据：自由画布必须为对象',
      );
      const validated = validateFreeCanvasForExport(db, 1, validCanvas());
      assert.equal(validated.version, 1);
      assert.equal(validated.nodes[0].assetId, 1000);
    } finally {
      db.close();
    }
  });

  it('detectedFreeCanvasMediaFormat 把 jpeg 别名收敛为 jpeg', () => {
    assert.equal(detectedFreeCanvasMediaFormat({ extension: '.jpg' }), 'jpeg');
    assert.equal(detectedFreeCanvasMediaFormat({ extension: '.JPEG' }), 'jpeg');
    assert.equal(detectedFreeCanvasMediaFormat({ extension: '.png' }), 'png');
    assert.equal(detectedFreeCanvasMediaFormat({ extension: 'png' }), '');
    assert.equal(detectedFreeCanvasMediaFormat({}), '');
  });

  it('assertFreeCanvasMediaExtension 要求扩展名与检测格式一致', () => {
    assert.equal(assertFreeCanvasMediaExtension('a.jpg', 'jpeg'), undefined);
    assert.equal(assertFreeCanvasMediaExtension('a.jpeg', 'jpeg'), undefined);
    assert.equal(assertFreeCanvasMediaExtension('a.png', 'png'), undefined);
    expectExportError(
      () => assertFreeCanvasMediaExtension('a.png', 'jpeg'),
      'INVALID_FREE_CANVAS_MEDIA',
      '项目导出拒绝了内容与扩展名不符的自由画布媒体。',
    );
  });
  it('assertFreeCanvasMediaScope 只允许库、已授权全局上传和当前项目路径', () => {
    const drama = sampleDrama(7, 'Scope');
    const projectDir = storageLayout.buildProjectRelativeDir(drama);
    const allowed = new Set(['uploads/global.png']);
    assert.equal(assertFreeCanvasMediaScope(drama, 'library/a.png', allowed), undefined);
    assert.equal(assertFreeCanvasMediaScope(drama, 'uploads/global.png', allowed), undefined);
    assert.equal(assertFreeCanvasMediaScope(drama, `${projectDir}/uploads/a.png`, allowed), undefined);
    assert.equal(assertFreeCanvasMediaScope(drama, 'dramas/7/uploads/a.png', allowed), undefined);
    expectExportError(
      () => assertFreeCanvasMediaScope(drama, 'uploads/other.png', allowed),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了跨项目的自由画布媒体。',
    );
    expectExportError(
      () => assertFreeCanvasMediaScope(drama, 'projects/0008_20260727_Other/a.png', allowed),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了跨项目的自由画布媒体。',
    );
  });

  it('inspectFreeCanvasMedia 校验内容并返回摘要', () => {
    const png = inspectFreeCanvasMedia(VALID_PNG_BYTES, 'frame.png', 'images');
    assert.equal(png.detected_format, 'png');
    assert.equal(png.size, VALID_PNG_BYTES.length);
    assert.equal(png.sha256, createHash('sha256').update(VALID_PNG_BYTES).digest('hex'));

    const jpeg = inspectFreeCanvasMedia(jpegBytes(), 'frame.jpg', 'images');
    assert.equal(jpeg.detected_format, 'jpeg');

    expectExportError(
      () => inspectFreeCanvasMedia(VALID_PNG_BYTES, 'frame.jpg', 'images'),
      'INVALID_FREE_CANVAS_MEDIA',
      '项目导出拒绝了内容与扩展名不符的自由画布媒体。',
    );
    expectExportError(
      () => inspectFreeCanvasMedia(Buffer.from('not-media'), 'frame.png', 'images'),
      'INVALID_FREE_CANVAS_MEDIA',
      '项目导出拒绝了无效的自由画布媒体内容。',
    );
  });

  it('parseFreeCanvasExportReference 接受数字、直接引用和同项目作用域引用', () => {
    assert.equal(parseFreeCanvasExportReference(12, 5, 'assetId', 'asset'), 12);
    assert.equal(parseFreeCanvasExportReference('12', 5, 'assetId', 'asset'), 12);
    assert.equal(parseFreeCanvasExportReference('asset:12', 5, 'assetId', 'asset'), 12);
    assert.equal(parseFreeCanvasExportReference('project:5:asset:12', 5, 'assetId', 'asset'), 12);
    expectExportError(
      () => parseFreeCanvasExportReference('project:9:asset:12', 5, 'assetId', 'asset'),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了跨项目的自由画布 assetId。',
    );
    expectExportError(
      () => parseFreeCanvasExportReference('nope', 5, 'assetId', 'asset'),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了无效的自由画布 assetId。',
    );
  });
  it('collectFreeCanvasImportManifest 在缺少画布时返回 null，并跳过未使用的不安全分镜路径', (t) => {
    const { db, storage } = createWorkspace(t);
    assert.equal(collectFreeCanvasImportManifest(collectArgs({
      db,
      storagePath: storage,
      metadata: {},
    })), null);
    assert.equal(collectFreeCanvasImportManifest(collectArgs({
      db,
      storagePath: storage,
      metadata: { free_canvas: { version: 2, nodes: [] } },
    })), null);

    const drama = sampleDrama();
    const sourcePath = `${storageLayout.buildProjectRelativeDir(drama)}/uploads/frame.png`;
    writeStorageMedia(storage, sourcePath, VALID_PNG_BYTES);
    const archive = createMemoryArchive();
    const manifest = collectFreeCanvasImportManifest(collectArgs({
      db,
      drama,
      storagePath: storage,
      archive,
      nodes: [{
        id: 'n1',
        type: 'image',
        asset_ref: null,
        content: sourcePath,
        storageKey: sourcePath,
      }],
      imageFilesToPack: [{
        localRelPath: '../secret.png',
        zipPath: 'media/storyboards/sb_1_gen_1.png',
        sourceGenerationId: 1,
      }],
    }));
    assert.equal(manifest.manifest_version, 1);
    assert.equal(manifest.media.length, 1);
    assert.equal(manifest.media[0].source_path, sourcePath);
    assert.equal(manifest.media[0].archive_path, 'media/free-canvas/media_0001.png');
    assert.equal(archive.files.has('media/free-canvas/media_0001.png'), true);
  });

  it('collectFreeCanvasImportManifest 复用分镜图片路径并拒绝冲突资产类型', (t) => {
    const { db, storage } = createWorkspace(t);
    const drama = sampleDrama();
    const sourcePath = `${storageLayout.buildProjectRelativeDir(drama)}/uploads/frame.png`;
    writeStorageMedia(storage, sourcePath, VALID_PNG_BYTES);
    insertAsset(db, { id: 11, drama_id: drama.id, local_path: sourcePath });

    const archive = createMemoryArchive();
    const manifest = collectFreeCanvasImportManifest(collectArgs({
      db,
      drama,
      storagePath: storage,
      archive,
      nodes: [{
        id: 'n1',
        type: 'image',
        assetId: 11,
        content: sourcePath,
        storageKey: sourcePath,
      }],
      imageFilesToPack: [{
        localRelPath: sourcePath,
        zipPath: 'media/storyboards/sb_9_gen_3.png',
        sourceGenerationId: 3,
      }],
    }));
    assert.equal(manifest.assets[0].source_id, 11);
    assert.equal(manifest.media[0].archive_path, 'media/storyboards/sb_9_gen_3.png');
    assert.equal(manifest.media[0].image_generation_id, 3);

    expectExportError(
      () => collectFreeCanvasImportManifest(collectArgs({
        db,
        drama,
        storagePath: storage,
        nodes: [
          { id: 'img', type: 'image', assetId: 11 },
          { id: 'vid', type: 'video', assetId: 11 },
        ],
      })),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了被当成冲突媒体类型的自由画布资产。',
    );
  });
  it('collectFreeCanvasImportManifest 拒绝跨项目资产、缺失媒体和哈希不符的网络证据', (t) => {
    const { db, storage } = createWorkspace(t);
    const drama = sampleDrama();
    const sourcePath = `${storageLayout.buildProjectRelativeDir(drama)}/uploads/frame.png`;
    writeStorageMedia(storage, sourcePath, VALID_PNG_BYTES);
    insertAsset(db, { id: 21, drama_id: 99, local_path: sourcePath });
    expectExportError(
      () => collectFreeCanvasImportManifest(collectArgs({
        db,
        drama,
        storagePath: storage,
        nodes: [{ id: 'n1', type: 'image', assetId: 21 }],
      })),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了缺失或跨项目的自由画布资产。',
    );

    insertAsset(db, { id: 22, drama_id: drama.id, local_path: null });
    expectExportError(
      () => collectFreeCanvasImportManifest(collectArgs({
        db,
        drama,
        storagePath: storage,
        nodes: [{ id: 'n2', type: 'image', assetId: 22 }],
      })),
      'INVALID_FREE_CANVAS_REFERENCE',
      '项目导出拒绝了没有本地文件的自由画布媒体。',
    );

    insertAsset(db, {
      id: 23,
      drama_id: drama.id,
      local_path: `${storageLayout.buildProjectRelativeDir(drama)}/uploads/missing.png`,
    });
    expectExportError(
      () => collectFreeCanvasImportManifest(collectArgs({
        db,
        drama,
        storagePath: storage,
        nodes: [{ id: 'n3', type: 'image', assetId: 23 }],
      })),
      'FREE_CANVAS_MEDIA_MISSING',
      '项目导出无法打包引用的自由画布媒体，请检查素材后重试。',
    );

    const sha256 = createHash('sha256').update(VALID_PNG_BYTES).digest('hex');
    const sha1 = createHash('sha1').update(VALID_PNG_BYTES).digest('hex');
    insertAsset(db, {
      id: 24,
      drama_id: drama.id,
      local_path: sourcePath,
      category: commonsCategory('0'.repeat(64), sha1),
    });
    expectExportError(
      () => collectFreeCanvasImportManifest(collectArgs({
        db,
        drama,
        storagePath: storage,
        nodes: [{ id: 'n4', type: 'image', assetId: 24, content: sourcePath }],
      })),
      'NETWORK_MEDIA_CONTENT_HASH_MISMATCH',
      '项目导出拒绝了证据与本地文件不符的网络素材。',
    );

    insertAsset(db, {
      id: 25,
      drama_id: drama.id,
      local_path: sourcePath,
      category: commonsCategory(sha256, sha1),
    });
    const ok = collectFreeCanvasImportManifest(collectArgs({
      db,
      drama,
      storagePath: storage,
      nodes: [{ id: 'n5', type: 'image', assetId: 25, content: sourcePath }],
    }));
    assert.equal(ok.media[0].sha256, sha256);
  });

  it('exportDrama 仍通过新模块打包自由画布导入清单', (t) => {
    const { db, storage } = createWorkspace(t);
    const drama = sampleDrama(401, 'Portable Canvas Image');
    const sourcePath = `${storageLayout.buildProjectRelativeDir(drama)}/uploads/free-canvas.png`;
    writeStorageMedia(storage, sourcePath, VALID_PNG_BYTES);
    db.prepare(`
      INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?)
    `).run(drama.id, drama.title, JSON.stringify({
      free_canvas: {
        version: 1,
        projectId: drama.id,
        dramaId: drama.id,
        nodes: [{
          id: 'free:image:portable',
          type: 'image',
          position: { x: 10, y: 20 },
          content: sourcePath,
          storageKey: sourcePath,
          assetId: 450,
        }],
        edges: [],
      },
    }), NOW, NOW);
    db.prepare(`
      INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
      VALUES (410, ?, 1, 'Episode 1', ?, ?)
    `).run(drama.id, NOW, NOW);
    db.prepare(`
      INSERT INTO storyboards (id, episode_id, storyboard_number, title, created_at, updated_at)
      VALUES (420, 410, 1, 'Shot 1', ?, ?)
    `).run(NOW, NOW);
    db.prepare(`
      INSERT INTO scenes (id, drama_id, episode_id, location, time, created_at, updated_at)
      VALUES (430, ?, 410, 'Studio', 'day', ?, ?)
    `).run(drama.id, NOW, NOW);
    insertAsset(db, {
      id: 450,
      drama_id: drama.id,
      name: 'Portable image',
      local_path: sourcePath,
    });

    const exported = dramaExportService.exportDrama(
      db,
      { storage: { local_path: storage } },
      silentLog,
      drama.id,
    );
    const zip = new AdmZip(exported.buffer);
    const project = JSON.parse(zip.readAsText('project.json'));
    assert.equal(project.free_canvas_import.manifest_version, 1);
    assert.equal(project.free_canvas_import.assets[0].source_id, 450);
    assert.equal(project.free_canvas_import.media[0].detected_format, 'png');
    assert.ok(zip.getEntry(project.free_canvas_import.media[0].archive_path));
  });
});
