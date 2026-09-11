'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const imageService = require('../src/services/imageService');
const pipeline = require('../src/services/imageServicePipeline');

const DRAMA_ID = 11;
const EPISODE_ID = 1101;
const SCENE_ID = 8808;
const SCENE_OTHER = 9909;
const STORYBOARD_ID = 4404;
const CHARACTER_ID = 5501;
const IMAGE_ID = 11111;
const CACHED_IMAGE_ID = 12222;

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '可读', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一集', 'draft', ?, ?)`
  ).run(EPISODE_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, image_url, local_path, extra_images, status, created_at, updated_at)
     VALUES (?, ?, ?, '码头', '夜', '雨', '/static/old.png', 'projects/old.png', ?, 'generated', ?, ?)`
  ).run(SCENE_ID, DRAMA_ID, EPISODE_ID, JSON.stringify(['projects/history.png']), now, now);
  db.prepare(
    `INSERT INTO scenes (id, drama_id, episode_id, location, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, '已删', 'generated', ?, ?, ?)`
  ).run(SCENE_OTHER, DRAMA_ID, EPISODE_ID, now, now, now);
  const ids = [DRAMA_ID, EPISODE_ID, SCENE_ID, SCENE_OTHER, STORYBOARD_ID, CHARACTER_ID, IMAGE_ID, CACHED_IMAGE_ID];
  assert.equal(new Set(ids).size, ids.length);
  return db;
}

async function writeSolidJpeg(absPath, width, height, color) {
  const sharp = require('sharp');
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const buf = await sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg({ quality: 90 }).toBuffer();
  fs.writeFileSync(absPath, buf);
}

test('imageService 公开 API 仍指向管线模块的同一绑定函数', () => {
  assert.equal(imageService.bindCompletedSceneImage, pipeline.bindCompletedSceneImage);
});

test('任务取消判定覆盖信号、错误码和 AbortError', () => {
  const controller = new AbortController();
  assert.equal(pipeline.imageTaskCancelled(null, null), false);
  assert.equal(pipeline.imageTaskCancelled({ message: '失败' }, { aborted: false }), false);
  controller.abort();
  assert.equal(pipeline.imageTaskCancelled(null, controller.signal), true);
  assert.equal(pipeline.imageTaskCancelled({ code: 'OPERATION_CANCELLED' }, null), true);
  assert.equal(pipeline.imageTaskCancelled({ name: 'AbortError' }, null), true);
});

test('无任务编号时中止信号会让管线断言抛出取消错误', () => {
  const controller = new AbortController();
  assert.equal(pipeline.assertImageTaskActive({}, { task_id: null }, null), null);
  controller.abort();
  assert.throws(
    () => pipeline.assertImageTaskActive({}, { id: IMAGE_ID }, controller.signal),
    (error) => error.code === 'OPERATION_CANCELLED' && error.name === 'AbortError' && error.message === '操作已取消'
  );
});

test('存储根路径对绝对路径原样返回，相对路径拼到 cwd', () => {
  const abs = path.resolve(os.tmpdir(), 'localminidrama-storage-root');
  assert.equal(pipeline.resolveStorageRoot({ storage: { local_path: abs } }), abs);
  const resolved = pipeline.resolveStorageRoot({ storage: { local_path: './data/storage' } });
  assert.equal(resolved, path.join(process.cwd(), './data/storage'));
  assert.throws(() => pipeline.resolveStorageRoot({ storage: {} }));
});

test('未提交图片清理会删除 storage 内文件，缺文件时不抛', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-uncommitted-'));
  try {
    const rel = 'images/uncommitted.jpg';
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
    pipeline.removeUncommittedImage(root, rel, log);
    assert.equal(fs.existsSync(abs), false);
    assert.doesNotThrow(() => pipeline.removeUncommittedImage(root, rel, log));
    assert.doesNotThrow(() => pipeline.removeUncommittedImage(null, rel, log));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('场景绑定在分镜图、全景图和主图之间互不串改，且 ID 不相等', () => {
  const db = createDb();
  const now = new Date().toISOString();
  try {
    assert.notEqual(IMAGE_ID, SCENE_ID);
    assert.notEqual(SCENE_ID, SCENE_OTHER);
    assert.deepEqual(
      pipeline.bindCompletedSceneImage(db, { id: IMAGE_ID, scene_id: SCENE_ID, storyboard_id: STORYBOARD_ID }, '/static/n.png', 'projects/n.png', now),
      { bound: false }
    );
    assert.deepEqual(
      pipeline.bindCompletedSceneImage(db, { id: IMAGE_ID, scene_id: null, storyboard_id: null }, '/static/n.png', 'projects/n.png', now),
      { bound: false }
    );

    const panorama = pipeline.bindCompletedSceneImage(
      db,
      { id: IMAGE_ID, scene_id: SCENE_ID, storyboard_id: null, frame_type: 'scene_panorama' },
      '/static/pano.png',
      'projects/pano.png',
      now
    );
    assert.deepEqual(panorama, { bound: true, target: 'panorama' });
    const afterPano = db.prepare(
      'SELECT image_url, local_path, extra_images, panorama_image_url, panorama_local_path, panorama_image_id FROM scenes WHERE id = ?'
    ).get(SCENE_ID);
    assert.equal(afterPano.image_url, '/static/old.png');
    assert.equal(afterPano.local_path, 'projects/old.png');
    assert.equal(afterPano.extra_images, JSON.stringify(['projects/history.png']));
    assert.equal(afterPano.panorama_image_url, '/static/pano.png');
    assert.equal(afterPano.panorama_local_path, 'projects/pano.png');
    assert.equal(afterPano.panorama_image_id, IMAGE_ID);

    const main = pipeline.bindCompletedSceneImage(
      db,
      { id: CACHED_IMAGE_ID, scene_id: SCENE_ID, storyboard_id: null, frame_type: 'scene' },
      '/static/new.png',
      'projects/new.png',
      now
    );
    assert.deepEqual(main, { bound: true, target: 'main' });
    const afterMain = db.prepare(
      'SELECT image_url, local_path, extra_images, panorama_image_url, status FROM scenes WHERE id = ?'
    ).get(SCENE_ID);
    assert.equal(afterMain.image_url, '/static/new.png');
    assert.equal(afterMain.local_path, 'projects/new.png');
    assert.equal(afterMain.status, 'generated');
    assert.deepEqual(JSON.parse(afterMain.extra_images), ['projects/history.png', 'projects/old.png']);
    assert.equal(afterMain.panorama_image_url, '/static/pano.png');

    const deleted = pipeline.bindCompletedSceneImage(
      db,
      { id: IMAGE_ID, scene_id: SCENE_OTHER, storyboard_id: null, frame_type: 'scene_panorama' },
      '/static/x.png',
      'projects/x.png',
      now
    );
    assert.deepEqual(deleted, { bound: false, target: 'panorama' });
  } finally {
    db.close();
  }
});

test('主图绑定在 extra_images 更新被拒绝时回退为不写该列', () => {
  const db = createDb();
  const now = new Date().toISOString();
  db.exec(
    `CREATE TRIGGER reject_extra_images BEFORE UPDATE OF extra_images ON scenes
     WHEN NEW.id = ${SCENE_ID}
     BEGIN SELECT RAISE(ABORT, 'no such column: extra_images'); END;`
  );
  try {
    const result = pipeline.bindCompletedSceneImage(
      db,
      { id: IMAGE_ID, scene_id: SCENE_ID, storyboard_id: null, frame_type: 'scene' },
      '/static/fallback.png',
      'projects/fallback.png',
      now
    );
    assert.deepEqual(result, { bound: true, target: 'main' });
    const scene = db.prepare('SELECT image_url, local_path, extra_images FROM scenes WHERE id = ?').get(SCENE_ID);
    assert.equal(scene.image_url, '/static/fallback.png');
    assert.equal(scene.local_path, 'projects/fallback.png');
    assert.equal(scene.extra_images, JSON.stringify(['projects/history.png']));
  } finally {
    db.close();
  }
});

test('宫格提示词优先复用带多角度标记的缓存，旧缓存不复用', async () => {
  const db = createDb();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO image_generations (id, drama_id, storyboard_id, provider, prompt, frame_type, status, created_at, updated_at)
       VALUES (?, ?, ?, 'openai', ?, 'quad_grid', 'completed', ?, ?)`
    ).run(CACHED_IMAGE_ID, DRAMA_ID, STORYBOARD_ID, 'cached eye-level shot grid', now, now);
    const current = {
      id: IMAGE_ID,
      storyboard_id: STORYBOARD_ID,
      frame_type: 'quad_grid',
      model: 'm1',
      prompt: '原始四宫格',
    };
    await pipeline.applyGridPromptIfNeeded(db, log, current, null, IMAGE_ID);
    assert.equal(current.prompt, 'cached eye-level shot grid');

    db.prepare('UPDATE image_generations SET prompt = ? WHERE id = ?').run('旧版单一角度', CACHED_IMAGE_ID);
    const stale = {
      id: IMAGE_ID,
      storyboard_id: STORYBOARD_ID,
      frame_type: 'quad_grid',
      model: 'm1',
      prompt: '原始四宫格',
    };
    await pipeline.applyGridPromptIfNeeded(db, log, stale, null, IMAGE_ID);
    assert.equal(stale.prompt, '原始四宫格');

    const skipped = { id: IMAGE_ID, storyboard_id: STORYBOARD_ID, frame_type: 'first', prompt: '单帧' };
    await pipeline.applyGridPromptIfNeeded(db, log, skipped, null, IMAGE_ID);
    assert.equal(skipped.prompt, '单帧');
  } finally {
    db.close();
  }
});

test('九宫格缓存命中 worm\'s eye view 标记，非宫格或无分镜不改 prompt', async () => {
  const db = createDb();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO image_generations (id, drama_id, storyboard_id, provider, prompt, frame_type, status, created_at, updated_at)
       VALUES (?, ?, ?, 'openai', ?, 'nine_grid', 'completed', ?, ?)`
    ).run(CACHED_IMAGE_ID, DRAMA_ID, STORYBOARD_ID, "nine worm's eye view cache", now, now);
    const current = {
      id: IMAGE_ID,
      storyboard_id: STORYBOARD_ID,
      frame_type: 'nine_grid',
      prompt: '原始九宫格',
    };
    await pipeline.applyGridPromptIfNeeded(db, log, current, null, IMAGE_ID);
    assert.equal(current.prompt, "nine worm's eye view cache");

    const noBoard = { id: IMAGE_ID, storyboard_id: null, frame_type: 'nine_grid', prompt: '无分镜' };
    await pipeline.applyGridPromptIfNeeded(db, log, noBoard, null, IMAGE_ID);
    assert.equal(noBoard.prompt, '无分镜');
  } finally {
    db.close();
  }
});

test('输出尺寸对齐：非法尺寸或缺文件跳过，目标一致时不改文件，不一致时按 contain 缩放', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-normalize-'));
  try {
    const abs = path.join(root, 'keep.jpg');
    await writeSolidJpeg(abs, 40, 40, { r: 12, g: 34, b: 56 });
    const before = fs.readFileSync(abs);
    await pipeline.normalizeLocalImageToTargetSize(abs, 'bad-size', log, { id: IMAGE_ID });
    await pipeline.normalizeLocalImageToTargetSize(path.join(root, 'missing.jpg'), '64x64', log, { id: IMAGE_ID });
    await pipeline.normalizeSavedImageToTargetPixels(path.join(root, 'missing2.jpg'), '64x64', log, { id: IMAGE_ID });
    assert.deepEqual(fs.readFileSync(abs), before);

    await pipeline.normalizeLocalImageToTargetSize(abs, '64x48', log, { id: IMAGE_ID });
    const sharp = require('sharp');
    const aligned = await sharp(abs).metadata();
    assert.equal(aligned.width, 64);
    assert.equal(aligned.height, 48);

    const matched = path.join(root, 'matched.jpg');
    await writeSolidJpeg(matched, 64, 64, { r: 200, g: 10, b: 10 });
    const matchedBefore = fs.readFileSync(matched);
    await pipeline.normalizeSavedImageToTargetPixels(matched, '64x64', log, { id: IMAGE_ID });
    assert.deepEqual(fs.readFileSync(matched), matchedBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})

test('四宫格拆分写入 4 条面板记录并保留 character_id，九宫格不写 character_id', async () => {
  const db = createDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-grid-split-'));
  try {
    const quadRel = 'images/ig_quad.jpg';
    const quadAbs = path.join(root, ...quadRel.split('/'));
    await writeSolidJpeg(quadAbs, 120, 120, { r: 255, g: 0, b: 0 });
    await pipeline.splitQuadGridToImages(
      db,
      log,
      {
        id: IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        scene_id: SCENE_ID,
        character_id: CHARACTER_ID,
        provider: 'openai',
        prompt: '夜雨',
        model: 'm1',
      },
      quadAbs,
      root,
      '/static/images/ig_quad.jpg'
    );
    const quadPanels = db.prepare(
      "SELECT frame_type, character_id, scene_id, drama_id, storyboard_id, local_path FROM image_generations WHERE frame_type LIKE 'quad_panel_%' ORDER BY frame_type"
    ).all();
    assert.equal(quadPanels.length, 4);
    assert.deepEqual(quadPanels.map((row) => row.frame_type), ['quad_panel_0', 'quad_panel_1', 'quad_panel_2', 'quad_panel_3']);
    assert.ok(quadPanels.every((row) => row.character_id === CHARACTER_ID));
    assert.ok(quadPanels.every((row) => row.scene_id === SCENE_ID));
    assert.ok(quadPanels.every((row) => row.drama_id === DRAMA_ID));
    assert.ok(quadPanels.every((row) => row.storyboard_id === STORYBOARD_ID));
    assert.ok(quadPanels.every((row) => fs.existsSync(path.join(root, ...row.local_path.split('/')))));

    const nineRel = 'images/ig_nine.jpg';
    const nineAbs = path.join(root, ...nineRel.split('/'));
    await writeSolidJpeg(nineAbs, 90, 90, { r: 0, g: 0, b: 255 });
    await pipeline.splitNineGridToImages(
      db,
      log,
      {
        id: CACHED_IMAGE_ID,
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        scene_id: SCENE_ID,
        character_id: CHARACTER_ID,
        provider: 'openai',
        prompt: '晨雾',
        model: 'm1',
      },
      nineAbs,
      root,
      '/static/images/ig_nine.jpg'
    );
    const ninePanels = db.prepare(
      "SELECT frame_type, character_id FROM image_generations WHERE frame_type LIKE 'nine_panel_%' ORDER BY frame_type"
    ).all();
    assert.equal(ninePanels.length, 9);
    assert.ok(ninePanels.every((row) => row.character_id == null));
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('生成后拆宫格对非宫格是空操作，四宫格会落地面板', async () => {
  const db = createDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-grid-needed-'));
  try {
    assert.equal(
      pipeline.splitGeneratedGridIfNeeded(db, log, { frame_type: 'first' }, 'images/a.jpg', '/static/a.jpg', { storage: { local_path: root } }, IMAGE_ID),
      undefined
    );
    const rel = 'images/ig_needed.jpg';
    const abs = path.join(root, ...rel.split('/'));
    await writeSolidJpeg(abs, 80, 80, { r: 8, g: 16, b: 32 });
    await pipeline.splitGeneratedGridIfNeeded(
      db,
      log,
      {
        id: IMAGE_ID,
        frame_type: 'quad_grid',
        storyboard_id: STORYBOARD_ID,
        drama_id: DRAMA_ID,
        scene_id: SCENE_ID,
        character_id: CHARACTER_ID,
        provider: 'openai',
        prompt: '拆分',
        model: 'm1',
      },
      rel,
      '/static/images/ig_needed.jpg',
      { storage: { local_path: root } },
      IMAGE_ID
    );
    const count = db.prepare("SELECT COUNT(*) AS n FROM image_generations WHERE frame_type LIKE 'quad_panel_%'").get().n;
    assert.equal(count, 4);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('缺少本地路径时宫格拆分直接跳过', async () => {
  const db = createDb();
  const warnings = [];
  const warnLog = { info() {}, warn(message) { warnings.push(message); }, error() {} };
  try {
    await pipeline.splitQuadGridToImages(db, warnLog, { id: IMAGE_ID }, '', rootUnused(), null);
    await pipeline.splitNineGridToImages(db, warnLog, { id: IMAGE_ID }, null, rootUnused(), null);
    assert.ok(warnings.some((message) => String(message).includes('四宫格拆分')));
    assert.ok(warnings.some((message) => String(message).includes('九宫格拆分')));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 0);
  } finally {
    db.close();
  }
});

function rootUnused() {
  return path.join(os.tmpdir(), 'localminidrama-unused-storage');
}
