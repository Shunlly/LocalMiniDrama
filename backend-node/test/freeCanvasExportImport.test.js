'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');
const storageLayout = require('../src/services/storageLayout');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { VALID_PNG_BYTES, writeFixtureVideoFile } = require('./mediaFixture');

const log = { debug() {}, info() {}, warn() {}, error() {} };
const now = '2026-07-27T00:00:00.000Z';

function createWorkspace(t, prefix) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  t.after(() => {
    db.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });
  return { db, storage };
}

function insertProjectGraph(db, ids, metadata) {
  db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?)`
  ).run(ids.drama, ids.title, JSON.stringify(metadata), now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
     VALUES (?, ?, 1, 'Episode 1', ?, ?)`
  ).run(ids.episode, ids.drama, now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, created_at, updated_at)
     VALUES (?, ?, 1, 'Shot 1', ?, ?)`
  ).run(ids.storyboard, ids.episode, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, created_at, updated_at)
     VALUES (?, ?, ?, 'Studio', 'day', ?, ?)`
  ).run(ids.scene, ids.drama, ids.episode, now, now);
}

function importedGraph(db, dramaId) {
  const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(dramaId);
  const episode = db.prepare('SELECT id FROM episodes WHERE drama_id = ?').get(dramaId);
  const storyboard = db.prepare(
    `SELECT s.id FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id
     WHERE e.drama_id = ?`
  ).get(dramaId);
  const scene = db.prepare('SELECT id FROM scenes WHERE drama_id = ?').get(dramaId);
  return { metadata: JSON.parse(drama.metadata), episode, storyboard, scene };
}

function projectDirFor(ids) {
  return storageLayout.buildProjectRelativeDir({
    id: ids.drama,
    title: ids.title,
    created_at: now,
    metadata: '{}',
  });
}

function writeStorageMedia(storage, relativePath, bytes) {
  const absolutePath = path.join(storage, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return absolutePath;
}

function exportProject(source, dramaId) {
  return dramaExportService.exportDrama(
    source.db,
    { storage: { local_path: source.storage } },
    log,
    dramaId,
  );
}

function detectedFormatForArchivePath(archivePath) {
  const extension = path.extname(String(archivePath || '')).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension.slice(1);
}

function rewriteProjectArchive(buffer, mutate) {
  const archive = new AdmZip(buffer);
  const project = JSON.parse(archive.readAsText('project.json'));
  const manifest = project.free_canvas_import;
  if (manifest) {
    manifest.hash_algorithm = 'sha256';
    for (const media of manifest.media || []) {
      const bytes = archive.readFile(media.archive_path);
      if (!bytes) continue;
      media.sha256 = createHash('sha256').update(bytes).digest('hex');
      media.size = bytes.length;
      media.detected_format = detectedFormatForArchivePath(media.archive_path);
    }
  }
  mutate({ archive, project, manifest });
  archive.updateFile('project.json', Buffer.from(JSON.stringify(project, null, 2), 'utf8'));
  return archive.toBuffer();
}

function assertImportBadRequestRollback(target, archiveBuffer, messagePattern = null) {
  const tables = ['dramas', 'assets', 'video_generations'];
  const before = new Map(tables.map((table) => [
    table,
    target.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
  let caught = null;
  try {
    dramaImportService.importDrama(
      target.db,
      { storage: { local_path: target.storage } },
      log,
      archiveBuffer,
    );
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'expected project import to fail');
  assert.equal(caught.code, 'BAD_REQUEST');
  if (messagePattern) assert.match(caught.message, messagePattern);
  for (const table of tables) {
    assert.equal(
      target.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      before.get(table),
    );
  }
  assert.deepEqual(fs.readdirSync(target.storage), []);
  return caught;
}

function createSingleImageExport(t, options = {}) {
  const source = createWorkspace(t, options.prefix || 'lmd-canvas-image-source-');
  const ids = {
    drama: 401,
    episode: 410,
    storyboard: 420,
    scene: 430,
    asset: 450,
    title: options.title || 'Portable Canvas Image',
  };
  const imagePath = options.globalAsset
    ? 'uploads/free-canvas-global.png'
    : `${projectDirFor(ids)}/uploads/free-canvas.png`;
  writeStorageMedia(source.storage, imagePath, VALID_PNG_BYTES);
  const assetRef = typeof options.assetRef === 'function'
    ? options.assetRef(ids)
    : (options.assetRef ?? ids.asset);
  const node = {
    id: 'free:image:portable',
    type: 'image',
    position: { x: 10, y: 20 },
    content: imagePath,
    storageKey: imagePath,
  };
  if (options.assetId !== false) node.assetId = ids.asset;
  if (assetRef !== false) node.asset_ref = assetRef;
  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      dramaId: ids.drama,
      nodes: [node],
      edges: [],
    },
  });
  source.db.prepare(
    `INSERT INTO assets
     (id, drama_id, name, type, local_path, file_size, mime_type, width, height, created_at, updated_at)
     VALUES (?, ?, 'Portable image', 'image', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ids.asset,
    options.globalAsset ? null : ids.drama,
    imagePath,
    options.declaredFileSize ?? VALID_PNG_BYTES.length,
    options.declaredMimeType ?? 'image/png',
    options.declaredWidth ?? 1,
    options.declaredHeight ?? 1,
    now,
    now,
  );
  if (options.category != null) {
    source.db.prepare('UPDATE assets SET category = ? WHERE id = ?')
      .run(options.category, ids.asset);
  }
  return { source, ids, imagePath, exported: exportProject(source, ids.drama) };
}

function commonsCategory(
  contentSha256 = createHash('sha256').update(VALID_PNG_BYTES).digest('hex'),
  overrides = {},
) {
  return JSON.stringify({
    kind: 'wikimedia_commons',
    source_provider: 'Wikimedia Commons',
    source_url: 'https://commons.wikimedia.org/wiki/File%3APortable_Test.png',
    author: '用于验证长元数据可恢复性的作者名称'.repeat(8),
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commons_title: 'File:Portable Test.png',
    commons_page_id: 42,
    commons_revision_timestamp: '2026-08-02T00:00:00Z',
    commons_sha1: createHash('sha1').update(VALID_PNG_BYTES).digest('hex'),
    resolved_download_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Portable_Test.png',
    content_sha256: contentSha256,
    ...overrides,
  });
}

test('Commons 网络素材元数据可随项目包完整导出并恢复', (t) => {
  const category = commonsCategory();
  assert.ok(category.length > 128);
  const fixture = createSingleImageExport(t, { category });
  const target = createWorkspace(t, 'lmd-canvas-commons-target-');

  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    fixture.exported.buffer,
  );
  const restored = target.db.prepare(
    'SELECT category FROM assets WHERE drama_id = ? AND deleted_at IS NULL'
  ).get(imported.drama_id);
  assert.equal(restored.category, category);
});

test('项目导入拒绝 Commons 内容哈希与归档媒体不一致', (t) => {
  const fixture = createSingleImageExport(t, { category: commonsCategory() });
  const target = createWorkspace(t, 'lmd-canvas-commons-hash-import-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    const metadata = JSON.parse(manifest.assets[0].category);
    metadata.content_sha256 = 'c'.repeat(64);
    manifest.assets[0].category = JSON.stringify(metadata);
  });

  assertImportBadRequestRollback(target, tampered, /网络素材内容哈希|SHA-256|hash/i);
});

test('项目导入拒绝 Commons SHA-1 与归档媒体不一致', (t) => {
  const fixture = createSingleImageExport(t, { category: commonsCategory() });
  const target = createWorkspace(t, 'lmd-canvas-commons-sha1-import-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    const metadata = JSON.parse(manifest.assets[0].category);
    metadata.commons_sha1 = 'd'.repeat(40);
    manifest.assets[0].category = JSON.stringify(metadata);
  });

  assertImportBadRequestRollback(target, tampered, /Commons SHA-1|网络素材/i);
});

test('项目导入拒绝缺少可验证字段或标题错配的 Commons 证据', async (t) => {
  for (const [label, mutate] of [
    ['missing-license', (metadata) => { delete metadata.license; }],
    ['missing-revision', (metadata) => { delete metadata.commons_revision_timestamp; }],
    ['mismatched-title', (metadata) => { metadata.commons_title = 'File:Different.png'; }],
  ]) {
    await t.test(label, (subtest) => {
      const fixture = createSingleImageExport(subtest, { category: commonsCategory() });
      const target = createWorkspace(subtest, `lmd-canvas-commons-evidence-${label}-`);
      const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
        const metadata = JSON.parse(manifest.assets[0].category);
        mutate(metadata);
        manifest.assets[0].category = JSON.stringify(metadata);
      });
      assertImportBadRequestRollback(target, tampered, /网络素材元数据/);
    });
  }
});

test('项目导出拒绝 Commons 证据哈希与当前本地媒体不一致', async (t) => {
  const fixture = createSingleImageExport(t, { category: commonsCategory() });
  const replacement = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#654321' },
  }).png().toBuffer();
  writeStorageMedia(fixture.source.storage, fixture.imagePath, replacement);

  assert.throws(
    () => exportProject(fixture.source, fixture.ids.drama),
    (error) => error?.code === 'NETWORK_MEDIA_CONTENT_HASH_MISMATCH'
      && error?.statusCode === 400,
  );
});

test('项目导入拒绝伪装成长分类的非 Commons 元数据', (t) => {
  const fixture = createSingleImageExport(t);
  const target = createWorkspace(t, 'lmd-canvas-category-reject-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    manifest.assets[0].category = JSON.stringify({
      kind: 'wikimedia_commons',
      source_provider: 'Wikimedia Commons',
      source_url: 'https://attacker.example/file',
      commons_title: `File:${'x'.repeat(200)}`,
    });
  });

  assertImportBadRequestRollback(target, tampered, /网络素材元数据/);
});

function createTwoImageExport(t, options = {}) {
  const source = createWorkspace(t, options.prefix || 'lmd-canvas-two-images-source-');
  const ids = {
    drama: 501,
    episode: 510,
    storyboard: 520,
    scene: 530,
    firstAsset: 550,
    secondAsset: 551,
    title: 'Portable Canvas Two Images',
  };
  const projectDir = projectDirFor(ids);
  const firstPath = `${projectDir}/uploads/first.png`;
  const secondPath = `${projectDir}/uploads/second.png`;
  writeStorageMedia(source.storage, firstPath, VALID_PNG_BYTES);
  writeStorageMedia(source.storage, secondPath, VALID_PNG_BYTES);
  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      nodes: [
        {
          id: 'free:image:first',
          type: 'image',
          position: { x: 0, y: 0 },
          content: firstPath,
          storageKey: firstPath,
          assetId: ids.firstAsset,
          asset_ref: options.dualMismatch ? ids.secondAsset : ids.firstAsset,
        },
        {
          id: 'free:image:second',
          type: 'image',
          position: { x: 320, y: 0 },
          content: secondPath,
          storageKey: secondPath,
          assetId: ids.secondAsset,
          asset_ref: ids.secondAsset,
        },
      ],
      edges: [],
    },
  });
  const insertAsset = source.db.prepare(
    `INSERT INTO assets
     (id, drama_id, name, type, local_path, file_size, mime_type, width, height, created_at, updated_at)
     VALUES (?, ?, ?, 'image', ?, ?, 'image/png', 1, 1, ?, ?)`
  );
  insertAsset.run(ids.firstAsset, ids.drama, 'First image', firstPath, VALID_PNG_BYTES.length, now, now);
  insertAsset.run(ids.secondAsset, ids.drama, 'Second image', secondPath, VALID_PNG_BYTES.length, now, now);
  return { source, ids, firstPath, secondPath, exported: exportProject(source, ids.drama) };
}

function createRichVideoExport(t, options = {}) {
  const source = createWorkspace(t, options.prefix || 'lmd-canvas-video-source-');
  const ids = {
    drama: 201,
    episode: 210,
    storyboard: 220,
    scene: 230,
    imageAsset: 250,
    videoAsset: 260,
    videoGeneration: 270,
    title: 'Portable Canvas Media',
  };
  const projectDir = projectDirFor(ids);
  const imagePath = `${projectDir}/uploads/free.png`;
  const videoPath = `${projectDir}/videos/free.mp4`;
  const directVideoPath = `${projectDir}/videos/direct.mp4`;
  const imageAbsolute = writeStorageMedia(source.storage, imagePath, VALID_PNG_BYTES);
  const videoAbsolute = path.join(source.storage, ...videoPath.split('/'));
  writeFixtureVideoFile(getFfmpegPath(), videoAbsolute);
  const directVideoAbsolute = path.join(source.storage, ...directVideoPath.split('/'));
  fs.copyFileSync(videoAbsolute, directVideoAbsolute);

  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      nodes: [
        {
          id: 'free:image:upload',
          type: 'image',
          position: { x: 0, y: 0 },
          content: imagePath,
          storageKey: imagePath,
          assetId: ids.imageAsset,
          asset_ref: ids.imageAsset,
        },
        {
          id: 'free:video:asset',
          type: 'video',
          position: { x: 320, y: 0 },
          content: videoPath,
          storageKey: videoPath,
          assetId: ids.videoAsset,
          asset_ref: ids.videoAsset,
        },
        {
          id: 'free:video:direct',
          type: 'video',
          position: { x: 640, y: 0 },
          content: directVideoPath,
          storageKey: directVideoPath,
        },
      ],
      edges: [],
    },
  });
  dbSetStoryboardVideo(
    source.db,
    ids.storyboard,
    options.selectDirectStoryboardVideo ? directVideoPath : videoPath,
  );
  source.db.prepare(
    `INSERT INTO video_generations
     (id, drama_id, storyboard_id, scene_id, provider, prompt, model, duration, aspect_ratio,
      status, local_path, completed_at, error_msg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ids.videoGeneration,
    ids.drama,
    ids.storyboard,
    ids.scene,
    'fixture-provider',
    'portable video prompt',
    'fixture-video-v2',
    0.2,
    '4:3',
    'completed',
    videoPath,
    now,
    null,
    now,
    now,
  );
  source.db.prepare(
    `INSERT INTO assets
     (id, drama_id, name, type, local_path, file_size, mime_type, width, height, created_at, updated_at)
     VALUES (?, ?, 'Uploaded image', 'image', ?, ?, 'image/png', 1, 1, ?, ?)`
  ).run(ids.imageAsset, ids.drama, imagePath, VALID_PNG_BYTES.length, now, now);
  source.db.prepare(
    `INSERT INTO assets
     (id, drama_id, name, type, local_path, file_size, mime_type, width, height, duration,
      video_gen_id, created_at, updated_at)
     VALUES (?, ?, 'Generated video', 'video', ?, ?, 'video/mp4', 64, 48, 0.2, ?, ?, ?)`
  ).run(
    ids.videoAsset,
    ids.drama,
    videoPath,
    fs.statSync(videoAbsolute).size,
    ids.videoGeneration,
    now,
    now,
  );
  return {
    source,
    ids,
    imagePath,
    videoPath,
    directVideoPath,
    imageAbsolute,
    videoAbsolute,
    exported: exportProject(source, ids.drama),
  };
}

test('real project ZIP remaps free canvas identities when imported into an empty database', (t) => {
  const source = createWorkspace(t, 'lmd-canvas-portable-source-');
  const target = createWorkspace(t, 'lmd-canvas-portable-target-');
  const ids = { drama: 101, episode: 110, storyboard: 120, scene: 130, title: 'Portable Canvas' };
  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      dramaId: ids.drama,
      episodeId: ids.episode,
      nodes: [{
        id: 'free:text:portable',
        type: 'text',
        position: { x: 10, y: 20 },
        content: 'portable note',
        storyboardId: ids.storyboard,
        storyboard_ref: `storyboard:${ids.storyboard}`,
        episodeId: ids.episode,
        sceneId: ids.scene,
      }],
      edges: [],
    },
  });

  const exported = dramaExportService.exportDrama(
    source.db,
    { storage: { local_path: source.storage } },
    log,
    ids.drama,
  );
  const packagedProject = JSON.parse(new AdmZip(exported.buffer).readAsText('project.json'));
  assert.equal(packagedProject.free_canvas_import.manifest_version, 1);
  assert.equal(packagedProject.free_canvas_import.source_drama_id, ids.drama);
  assert.deepEqual(packagedProject.free_canvas_import.episode_ids, [ids.episode]);
  assert.deepEqual(packagedProject.free_canvas_import.storyboard_ids, [ids.storyboard]);
  assert.deepEqual(packagedProject.free_canvas_import.scene_refs, [{
    source_id: ids.scene,
    export_index: 0,
  }]);
  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    exported.buffer,
  );
  const graph = importedGraph(target.db, imported.drama_id);
  const canvas = graph.metadata.free_canvas;
  const node = canvas.nodes[0];

  assert.equal(canvas.projectId, imported.drama_id);
  assert.equal(canvas.dramaId, imported.drama_id);
  assert.equal(canvas.episodeId, graph.episode.id);
  assert.equal(node.episodeId, graph.episode.id);
  assert.equal(node.storyboardId, graph.storyboard.id);
  assert.equal(node.storyboard_ref, graph.storyboard.id);
  assert.equal(node.sceneId, graph.scene.id);
  assert.notEqual(node.episodeId, ids.episode);
  assert.notEqual(node.storyboardId, ids.storyboard);
  assert.notEqual(node.sceneId, ids.scene);
});

test('project ZIP round-trips uploaded image, video asset, and direct free video media', (t) => {
  const fixture = createRichVideoExport(t);
  const target = createWorkspace(t, 'lmd-canvas-media-target-');
  const archive = new AdmZip(fixture.exported.buffer);
  const packagedProject = JSON.parse(archive.readAsText('project.json'));
  const directVideoMedia = packagedProject.free_canvas_import.media.find(
    (media) => media.source_path === fixture.directVideoPath
  );
  assert.ok(directVideoMedia);
  assert.ok(archive.getEntry(directVideoMedia.archive_path));
  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    fixture.exported.buffer,
  );
  const assets = target.db.prepare(
    'SELECT * FROM assets WHERE drama_id = ? AND deleted_at IS NULL ORDER BY name'
  ).all(imported.drama_id);
  assert.equal(assets.length, 2);
  const uploaded = assets.find((asset) => asset.name === 'Uploaded image');
  const generated = assets.find((asset) => asset.name === 'Generated video');
  assert.equal(uploaded.image_gen_id, null);
  assert.ok(uploaded.local_path);
  assert.ok(generated.local_path);
  assert.ok(generated.video_gen_id);
  assert.notEqual(generated.video_gen_id, fixture.ids.videoGeneration);
  assert.deepEqual(fs.readFileSync(path.join(target.storage, ...uploaded.local_path.split('/'))), VALID_PNG_BYTES);
  assert.equal(fs.statSync(path.join(target.storage, ...generated.local_path.split('/'))).isFile(), true);
  const linkedVideo = target.db.prepare(
    'SELECT drama_id, local_path FROM video_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(generated.video_gen_id);
  assert.equal(linkedVideo.drama_id, imported.drama_id);
  assert.equal(linkedVideo.local_path, generated.local_path);

  const graph = importedGraph(target.db, imported.drama_id);
  const directVideo = graph.metadata.free_canvas.nodes.find((node) => node.id === 'free:video:direct');
  assert.ok(directVideo.content);
  assert.notEqual(directVideo.content, fixture.directVideoPath);
  assert.equal(fs.statSync(path.join(target.storage, ...directVideo.content.split('/'))).isFile(), true);
});

test('project ZIP imports when storyboard-selected video differs from the latest generation', (t) => {
  const fixture = createRichVideoExport(t, {
    prefix: 'lmd-canvas-selected-video-source-',
    selectDirectStoryboardVideo: true,
  });
  const target = createWorkspace(t, 'lmd-canvas-selected-video-target-');
  const packagedProject = JSON.parse(
    new AdmZip(fixture.exported.buffer).readAsText('project.json')
  );
  const packagedStoryboard = packagedProject.episodes[0].storyboards[0];
  const packagedGeneration = packagedProject.free_canvas_import.video_generations.find(
    (generation) => generation.source_id === fixture.ids.videoGeneration
  );

  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    fixture.exported.buffer,
  );

  assert.equal(packagedStoryboard.video_local_path, fixture.directVideoPath);
  assert.equal(packagedStoryboard.video_generation_original_id, null);
  assert.equal(packagedGeneration.source_path, fixture.videoPath);

  const graph = importedGraph(target.db, imported.drama_id);
  const importedStoryboard = target.db.prepare(
    'SELECT video_local_path FROM storyboards WHERE id = ?'
  ).get(graph.storyboard.id);
  const importedAsset = target.db.prepare(
    `SELECT local_path, video_gen_id FROM assets
     WHERE drama_id = ? AND name = 'Generated video' AND deleted_at IS NULL`
  ).get(imported.drama_id);
  const importedGeneration = target.db.prepare(
    'SELECT local_path FROM video_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(importedAsset.video_gen_id);

  assert.equal(importedGeneration.local_path, importedAsset.local_path);
  assert.notEqual(importedStoryboard.video_local_path, importedGeneration.local_path);
});

test('free canvas export rejects cross-project media before archiving it', (t) => {
  const source = createWorkspace(t, 'lmd-canvas-cross-project-export-');
  const ids = { drama: 301, episode: 310, storyboard: 320, scene: 330, title: 'Canvas Scope Source' };
  const other = { drama: 302, title: 'Canvas Scope Other' };
  const otherProjectDir = storageLayout.buildProjectRelativeDir({
    id: other.drama,
    title: other.title,
    created_at: now,
    metadata: '{}',
  });
  const otherMediaPath = `${otherProjectDir}/images/private.png`;
  writeStorageMedia(source.storage, otherMediaPath, VALID_PNG_BYTES);
  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      nodes: [{
        id: 'free:image:cross-project',
        type: 'image',
        position: { x: 0, y: 0 },
        content: otherMediaPath,
        storageKey: otherMediaPath,
      }],
      edges: [],
    },
  });
  source.db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (?, ?, 'draft', '{}', ?, ?)`
  ).run(other.drama, other.title, now, now);

  assert.throws(
    () => exportProject(source, ids.drama),
    (error) => error?.statusCode === 400 && /free_canvas|canvas/i.test(error.message),
  );
});

test('free canvas export rejects malformed edges before creating a ZIP', (t) => {
  const source = createWorkspace(t, 'lmd-canvas-malformed-edge-export-');
  const ids = { drama: 311, episode: 312, storyboard: 313, scene: 314, title: 'Canvas Edge Source' };
  insertProjectGraph(source.db, ids, {
    free_canvas: {
      version: 1,
      projectId: ids.drama,
      nodes: [{
        id: 'free:text:source',
        type: 'text',
        position: { x: 0, y: 0 },
        content: 'source',
      }],
      edges: [{
        id: 'free:edge:missing-target',
        source: 'free:text:source',
        target: 'free:text:missing',
      }],
    },
  });

  assert.throws(
    () => exportProject(source, ids.drama),
    (error) => error?.statusCode === 400 && /free_canvas|canvas/i.test(error.message),
  );
});

test('referenced global upload asset exports and imports with trusted image metadata', (t) => {
  const fixture = createSingleImageExport(t, {
    globalAsset: true,
    declaredFileSize: 999999,
    declaredMimeType: 'image/jpeg',
    declaredWidth: 999,
    declaredHeight: 777,
    prefix: 'lmd-canvas-global-source-',
  });
  const target = createWorkspace(t, 'lmd-canvas-global-target-');
  const archive = new AdmZip(fixture.exported.buffer);
  const project = JSON.parse(archive.readAsText('project.json'));
  const media = project.free_canvas_import.media[0];
  assert.equal(project.free_canvas_import.hash_algorithm, 'sha256');
  assert.match(media.sha256, /^[a-f0-9]{64}$/);
  assert.equal(media.size, VALID_PNG_BYTES.length);
  assert.equal(media.detected_format, 'png');

  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    fixture.exported.buffer,
  );
  const asset = target.db.prepare(
    `SELECT drama_id, local_path, file_size, mime_type, width, height
     FROM assets WHERE drama_id = ? AND deleted_at IS NULL`
  ).get(imported.drama_id);
  assert.equal(asset.drama_id, imported.drama_id);
  assert.equal(asset.file_size, VALID_PNG_BYTES.length);
  assert.equal(asset.mime_type, 'image/png');
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  assert.deepEqual(
    fs.readFileSync(path.join(target.storage, ...asset.local_path.split('/'))),
    VALID_PNG_BYTES,
  );
});

test('video generation full metadata round-trips through the portable canvas manifest', (t) => {
  const fixture = createRichVideoExport(t);
  const target = createWorkspace(t, 'lmd-canvas-video-metadata-target-');
  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    fixture.exported.buffer,
  );
  const graph = importedGraph(target.db, imported.drama_id);
  const asset = target.db.prepare(
    `SELECT video_gen_id FROM assets
     WHERE drama_id = ? AND name = 'Generated video' AND deleted_at IS NULL`
  ).get(imported.drama_id);
  const generation = target.db.prepare(
    `SELECT drama_id, storyboard_id, scene_id, provider, prompt, model, duration,
            aspect_ratio, status, error_msg, local_path
     FROM video_generations WHERE id = ? AND deleted_at IS NULL`
  ).get(asset.video_gen_id);
  assert.equal(
    target.db.prepare('SELECT COUNT(*) AS count FROM video_generations WHERE drama_id = ?').get(imported.drama_id).count,
    1,
  );
  assert.equal(generation.drama_id, imported.drama_id);
  assert.equal(generation.storyboard_id, graph.storyboard.id);
  assert.equal(generation.scene_id, graph.scene.id);
  assert.equal(generation.provider, 'fixture-provider');
  assert.equal(generation.prompt, 'portable video prompt');
  assert.equal(generation.model, 'fixture-video-v2');
  assert.equal(generation.duration, 0.2);
  assert.equal(generation.aspect_ratio, '4:3');
  assert.equal(generation.status, 'completed');
  assert.equal(generation.error_msg, null);
  assert.equal(generation.local_path, target.db.prepare('SELECT local_path FROM assets WHERE video_gen_id = ?').get(asset.video_gen_id).local_path);
});

test('portable canvas import rejects mismatched asset and video-generation media', (t) => {
  const fixture = createRichVideoExport(t);
  const target = createWorkspace(t, 'lmd-canvas-video-mismatch-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    const generation = manifest.video_generations.find(
      (entry) => entry.source_id === fixture.ids.videoGeneration
    );
    generation.source_path = fixture.directVideoPath;
  });

  assertImportBadRequestRollback(target, tampered, /video|media|\u5a92\u4f53/i);
});

test('portable canvas import rejects a video-generation storyboard binding mismatch', (t) => {
  const fixture = createRichVideoExport(t);
  const target = createWorkspace(t, 'lmd-canvas-video-storyboard-mismatch-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    manifest.video_generations[0].storyboard_id = null;
  });

  assertImportBadRequestRollback(target, tampered, /video|storyboard|\u5206\u955c/i);
});

test('portable canvas import rejects an unbounded video-generation status', (t) => {
  const fixture = createRichVideoExport(t);
  const target = createWorkspace(t, 'lmd-canvas-video-status-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    manifest.video_generations[0].status = 'administrator-controlled';
  });

  assertImportBadRequestRollback(target, tampered, /status/i);
});

test('portable canvas import rejects media with a tampered SHA-256', async (t) => {
  const fixture = createSingleImageExport(t, { prefix: 'lmd-canvas-hash-source-' });
  const target = createWorkspace(t, 'lmd-canvas-hash-target-');
  const replacement = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#123456' },
  }).png().toBuffer();
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ archive, manifest }) => {
    const media = manifest.media[0];
    archive.updateFile(media.archive_path, replacement);
    media.size = replacement.length;
    media.detected_format = 'png';
  });

  assertImportBadRequestRollback(target, tampered, /SHA-256|hash|\u54c8\u5e0c/i);
});

test('portable canvas import rejects media with a tampered actual size', (t) => {
  const fixture = createSingleImageExport(t, { prefix: 'lmd-canvas-size-source-' });
  const target = createWorkspace(t, 'lmd-canvas-size-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    manifest.media[0].size += 1;
  });

  assertImportBadRequestRollback(target, tampered, /size|\u5927\u5c0f/i);
});

test('portable canvas import rejects media with a tampered detected format', (t) => {
  const fixture = createSingleImageExport(t, { prefix: 'lmd-canvas-format-source-' });
  const target = createWorkspace(t, 'lmd-canvas-format-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    manifest.media[0].detected_format = 'jpeg';
  });

  assertImportBadRequestRollback(target, tampered, /format|type|\u683c\u5f0f|\u7c7b\u578b/i);
});

test('portable canvas import rejects duplicate manifest archive paths', (t) => {
  const fixture = createTwoImageExport(t, { prefix: 'lmd-canvas-duplicate-source-' });
  const target = createWorkspace(t, 'lmd-canvas-duplicate-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ manifest }) => {
    assert.equal(manifest.media.length, 2);
    manifest.media[1].archive_path = manifest.media[0].archive_path;
  });

  assertImportBadRequestRollback(target, tampered, /archive|\u5f52\u6863|\u91cd\u590d/i);
});

test('project export removes credentials from header-array shapes', (t) => {
  const source = createWorkspace(t, 'lmd-canvas-header-redaction-');
  const ids = { drama: 601, episode: 610, storyboard: 620, scene: 630, title: 'Header Redaction' };
  insertProjectGraph(source.db, ids, {
    integrations: {
      headers: [
        { name: 'Authorization', value: 'Bearer header-array-secret' },
        { key: 'X-Api-Key', values: ['api-key-array-secret'] },
        { name: 'Accept', value: 'application/json' },
      ],
      custom_headers: [
        { name: 'Cookie', value: 'session=cookie-array-secret' },
      ],
    },
  });

  const exported = exportProject(source, ids.drama);
  const projectJson = new AdmZip(exported.buffer).readAsText('project.json');
  assert.equal(projectJson.includes('header-array-secret'), false);
  assert.equal(projectJson.includes('api-key-array-secret'), false);
  assert.equal(projectJson.includes('cookie-array-secret'), false);
  assert.equal(projectJson.includes('application/json'), true);
});

test('project export removes credentials from normalized header-array aliases', (t) => {
  const source = createWorkspace(t, 'lmd-canvas-header-alias-redaction-');
  const ids = { drama: 641, episode: 642, storyboard: 643, scene: 644, title: 'Header Alias Redaction' };
  const protectedValues = [
    'camel-header-secret',
    'pascal-header-secret',
    'hyphen-header-secret',
    'case-snake-header-secret',
    'ambiguous-name-header-secret',
  ];
  insertProjectGraph(source.db, ids, {
    integrations: {
      customHeaders: [
        { Name: 'Authorization', Value: 'Bearer camel-header-secret' },
        { Name: 'Accept', Value: 'application/vnd.lmd+json' },
      ],
      Headers: [
        { KEY: 'X-Api-Key', VALUES: ['pascal-header-secret'] },
        {
          Name: 'Accept',
          KEY: 'Authorization',
          Value: 'ambiguous-name-header-secret',
        },
      ],
      'custom-headers': [
        { 'N-a_me': 'Cookie', 'V-a_lue': 'hyphen-header-secret' },
      ],
      CUSTOM_HEADERS: [
        { name: 'Authorization', VALUES: ['case-snake-header-secret'] },
      ],
    },
  });

  const exported = exportProject(source, ids.drama);
  const projectJson = new AdmZip(exported.buffer).readAsText('project.json');
  assert.deepEqual(
    protectedValues.filter((value) => projectJson.includes(value)),
    [],
  );
  assert.equal(projectJson.includes('application/vnd.lmd+json'), true);
});

test('portable canvas manifest round-trips supported string asset references', async (t) => {
  for (const [label, reference] of [
    ['direct', (ids) => `asset:${ids.asset}`],
    ['project-scoped', (ids) => `project:${ids.drama}:asset:${ids.asset}`],
  ]) {
    await t.test(label, (subtest) => {
      const fixture = createSingleImageExport(subtest, {
        assetId: false,
        assetRef: reference,
        prefix: `lmd-canvas-string-${label}-`,
      });
      const target = createWorkspace(subtest, `lmd-canvas-string-target-${label}-`);
      const packaged = JSON.parse(new AdmZip(fixture.exported.buffer).readAsText('project.json'));
      assert.equal(packaged.free_canvas_import.assets[0].source_id, fixture.ids.asset);

      const imported = dramaImportService.importDrama(
        target.db,
        { storage: { local_path: target.storage } },
        log,
        fixture.exported.buffer,
      );
      const asset = target.db.prepare('SELECT id, local_path FROM assets WHERE drama_id = ?').get(imported.drama_id);
      const graph = importedGraph(target.db, imported.drama_id);
      assert.equal(graph.metadata.free_canvas.nodes[0].asset_ref, asset.id);
      assert.equal(graph.metadata.free_canvas.nodes[0].content, asset.local_path);
    });
  }
});

test('free canvas export rejects mismatched assetId and asset_ref before writing a manifest', (t) => {
  assert.throws(
    () => createTwoImageExport(t, { dualMismatch: true, prefix: 'lmd-canvas-dual-export-' }),
    (error) => error?.statusCode === 400 && /assetId|asset_ref|free_canvas/i.test(error.message),
  );
});

test('portable canvas manifest import rejects mismatched asset dual fields without residue', (t) => {
  const fixture = createTwoImageExport(t, { prefix: 'lmd-canvas-dual-import-source-' });
  const target = createWorkspace(t, 'lmd-canvas-dual-import-target-');
  const tampered = rewriteProjectArchive(fixture.exported.buffer, ({ project }) => {
    const nodes = project.drama.metadata.free_canvas.nodes;
    nodes[0].asset_ref = fixture.ids.secondAsset;
  });

  assertImportBadRequestRollback(target, tampered, /assetId|asset_ref|\u7d20\u6750/i);
});

test('export and import preserve distinct same-name scenes across episodes', (t) => {
  const source = createWorkspace(t, 'lmd-scene-identity-source-');
  source.db.prepare(
    `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
     VALUES (901, 'Scene identity', 'draft', '{}', ?, ?)`
  ).run(now, now);
  const insertEpisode = source.db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
     VALUES (?, 901, ?, ?, ?, ?)`
  );
  insertEpisode.run(910, 1, 'Episode 1', now, now);
  insertEpisode.run(911, 2, 'Episode 2', now, now);
  const insertScene = source.db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, created_at, updated_at)
     VALUES (?, 901, ?, 'Bedroom', 'night', ?, ?, ?)`
  );
  insertScene.run(920, 910, 'quiet blue room', now, now);
  insertScene.run(921, 911, 'damaged red room', now, now);
  const insertStoryboard = source.db.prepare(
    `INSERT INTO storyboards (id, episode_id, scene_id, storyboard_number, title, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  );
  insertStoryboard.run(930, 910, 920, 'First bedroom', now, now);
  insertStoryboard.run(931, 911, 921, 'Second bedroom', now, now);

  const exported = exportProject(source, 901);
  const project = JSON.parse(new AdmZip(exported.buffer).readAsText('project.json'));
  assert.deepEqual(project.scenes.map((scene) => scene.prompt), ['quiet blue room', 'damaged red room']);
  assert.deepEqual(project.episodes.map((episode) => episode.storyboards[0].scene_index), [0, 1]);

  const target = createWorkspace(t, 'lmd-scene-identity-target-');
  const imported = dramaImportService.importDrama(
    target.db,
    { storage: { local_path: target.storage } },
    log,
    exported.buffer,
  );
  const scenes = target.db.prepare(
    'SELECT episode_id, prompt FROM scenes WHERE drama_id = ? ORDER BY id'
  ).all(imported.drama_id);
  const storyboards = target.db.prepare(
    `SELECT s.scene_id FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id
     WHERE e.drama_id = ? ORDER BY e.episode_number`
  ).all(imported.drama_id);
  assert.deepEqual(scenes.map((scene) => scene.prompt), ['quiet blue room', 'damaged red room']);
  assert.equal(new Set(storyboards.map((storyboard) => storyboard.scene_id)).size, 2);
});

function dbSetStoryboardVideo(db, storyboardId, localPath) {
  db.prepare('UPDATE storyboards SET video_local_path = ?, video_url = ? WHERE id = ?')
    .run(localPath, `/static/${localPath}`, storyboardId);
}
