const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const videoService = require('../src/services/videoService');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');
const dramaService = require('../src/services/dramaService');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');
const { VALID_PNG_BYTES, writeFixtureVideoFile } = require('./mediaFixture');

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function writeStorageFile(storageRoot, relativePath, contents) {
  const absolutePath = path.join(storageRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

describe('storyboard video_local_path', () => {
  it('backfills only the latest completed generation and never moves storyboard.local_path', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE storyboards (
          id INTEGER PRIMARY KEY,
          local_path TEXT
        );
        CREATE TABLE video_generations (
          id INTEGER PRIMARY KEY,
          storyboard_id INTEGER,
          status TEXT,
          local_path TEXT,
          completed_at TEXT,
          updated_at TEXT,
          created_at TEXT,
          deleted_at TEXT
        );

        INSERT INTO storyboards (id, local_path) VALUES
          (1, 'images/shot-1.png'),
          (2, 'legacy/ambiguous.mp4'),
          (3, 'images/shot-3.png');

        INSERT INTO video_generations
          (id, storyboard_id, status, local_path, completed_at, updated_at, created_at, deleted_at)
        VALUES
          (1, 1, 'completed', 'videos/older.mp4', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL),
          (2, 1, 'completed', 'videos/latest.mp4', '2026-02-01T00:00:00.000Z', NULL, NULL, NULL),
          (3, 1, 'failed', 'videos/failed.mp4', '2026-03-01T00:00:00.000Z', NULL, NULL, NULL),
          (4, 1, 'completed', 'videos/deleted.mp4', '2026-04-01T00:00:00.000Z', NULL, NULL, '2026-04-02T00:00:00.000Z'),
          (5, 3, 'completed', 'videos/previous.mp4', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL),
          (6, 3, 'completed', NULL, '2026-02-01T00:00:00.000Z', NULL, NULL, NULL);
      `);

      const migration = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', '25_storyboard_video_local_path.sql'),
        'utf8'
      );
      db.exec(migration);

      const rows = db.prepare(
        'SELECT id, local_path, video_local_path FROM storyboards ORDER BY id'
      ).all();
      assert.deepEqual(rows, [
        { id: 1, local_path: 'images/shot-1.png', video_local_path: 'videos/latest.mp4' },
        { id: 2, local_path: 'legacy/ambiguous.mp4', video_local_path: null },
        { id: 3, local_path: 'images/shot-3.png', video_local_path: null },
      ]);
    } finally {
      db.close();
    }
  });

  it('persists completed video paths without overwriting the storyboard image path', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE storyboards (
          id INTEGER PRIMARY KEY,
          local_path TEXT,
          video_url TEXT,
          video_local_path TEXT,
          updated_at TEXT,
          deleted_at TEXT
        );
        CREATE TABLE video_generations (
          id INTEGER PRIMARY KEY,
          status TEXT,
          video_url TEXT,
          local_path TEXT,
          completed_at TEXT,
          updated_at TEXT
        );
        INSERT INTO storyboards (id, local_path, video_url, video_local_path)
        VALUES (7, 'images/main-frame.png', 'https://old.example/video.mp4', 'videos/old.mp4');
        INSERT INTO video_generations (id, status) VALUES (11, 'processing');
      `);

      const now = '2026-07-16T10:00:00.000Z';
      videoService.persistCompletedVideo(
        db,
        11,
        { storyboard_id: 7 },
        'https://cdn.example/new.mp4',
        'videos/new.mp4',
        now
      );

      assert.deepEqual(
        db.prepare(
          'SELECT local_path, video_url, video_local_path, updated_at FROM storyboards WHERE id = 7'
        ).get(),
        {
          local_path: 'images/main-frame.png',
          video_url: 'https://cdn.example/new.mp4',
          video_local_path: 'videos/new.mp4',
          updated_at: now,
        }
      );
      assert.deepEqual(
        db.prepare(
          'SELECT status, video_url, local_path, completed_at FROM video_generations WHERE id = 11'
        ).get(),
        {
          status: 'completed',
          video_url: 'https://cdn.example/new.mp4',
          local_path: 'videos/new.mp4',
          completed_at: now,
        }
      );
    } finally {
      db.close();
    }
  });

  it('round-trips packaged storyboard media while dropping remote URLs on import', (t) => {
    const sourceStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-video-path-source-'));
    const targetStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-video-path-target-'));
    const sourceDb = new Database(':memory:');
    const targetDb = new Database(':memory:');
    t.after(() => {
      sourceDb.close();
      targetDb.close();
      fs.rmSync(sourceStorage, { recursive: true, force: true });
      fs.rmSync(targetStorage, { recursive: true, force: true });
    });

    runMigrationsAndEnsure(sourceDb);
    runMigrationsAndEnsure(targetDb);

    const now = '2026-07-16T09:00:00.000Z';
    const imagePath = 'projects/source/images/main-frame.png';
    const videoPath = 'projects/source/videos/shot.mp4';
    writeStorageFile(sourceStorage, imagePath, VALID_PNG_BYTES);
    const videoBytes = writeFixtureVideoFile(
      getFfmpegPath(),
      path.join(sourceStorage, ...videoPath.split('/'))
    );

    sourceDb.prepare(
      `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
       VALUES (1, 'Video Path Test', 'draft', '{}', ?, ?)`
    ).run(now, now);
    sourceDb.prepare(
      `INSERT INTO episodes (id, drama_id, episode_number, title, status, created_at, updated_at)
       VALUES (1, 1, 1, 'Episode 1', 'draft', ?, ?)`
    ).run(now, now);
    sourceDb.prepare(
      `INSERT INTO storyboards
       (id, episode_id, storyboard_number, title, image_url, local_path, video_url,
        video_local_path, status, created_at, updated_at)
       VALUES (1, 1, 1, 'Shot 1', '/static/images/main-frame.png', ?,
        'https://cdn.example/shot.mp4', ?, 'completed', ?, ?)`
    ).run(imagePath, videoPath, now, now);
    const imageGen = sourceDb.prepare(
      `INSERT INTO image_generations
       (drama_id, storyboard_id, provider, prompt, frame_type, status, local_path,
        completed_at, created_at, updated_at)
       VALUES (1, 1, 'test', 'frame prompt', 'first', 'completed', ?, ?, ?, ?)`
    ).run(imagePath, now, now, now);
    sourceDb.prepare(
      'UPDATE storyboards SET first_frame_image_id = ? WHERE id = 1'
    ).run(imageGen.lastInsertRowid);
    sourceDb.prepare(
      `INSERT INTO video_generations
       (drama_id, storyboard_id, provider, prompt, status, video_url, local_path,
        completed_at, created_at, updated_at)
       VALUES (1, 1, 'test', 'video prompt', 'completed',
        'https://cdn.example/shot.mp4', ?, ?, ?, ?)`
    ).run(videoPath, now, now, now);

    const exported = dramaExportService.exportDrama(
      sourceDb,
      { storage: { local_path: sourceStorage } },
      log,
      1
    );
    const archive = new AdmZip(exported.buffer);
    const project = JSON.parse(archive.readAsText('project.json'));
    const exportedStoryboard = project.episodes[0].storyboards[0];
    assert.equal(exportedStoryboard.video_url, 'https://cdn.example/shot.mp4');
    assert.equal(exportedStoryboard.video_local_path, videoPath);
    assert.match(exportedStoryboard.video_file, /^media\/videos\/sb_1\.mp4$/);
    assert.deepEqual(archive.readFile(exportedStoryboard.video_file), videoBytes);

    const imported = dramaImportService.importDrama(
      targetDb,
      { storage: { local_path: targetStorage } },
      log,
      exported.buffer
    );
    const importedEpisode = targetDb.prepare(
      'SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
    ).get(imported.drama_id);
    const importedStoryboard = targetDb.prepare(
      `SELECT local_path, video_url, video_local_path
       FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL`
    ).get(importedEpisode.id);

    assert.match(importedStoryboard.local_path, /\/images\//);
    assert.match(importedStoryboard.video_local_path, /\/videos\//);
    assert.notEqual(importedStoryboard.local_path, importedStoryboard.video_local_path);
    assert.equal(importedStoryboard.video_url, null);
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, importedStoryboard.local_path)),
      VALID_PNG_BYTES
    );
    assert.deepEqual(
      fs.readFileSync(path.join(targetStorage, importedStoryboard.video_local_path)),
      videoBytes
    );

    const dto = episodeStoryboardService.getStoryboardsForEpisode(targetDb, importedEpisode.id)[0];
    assert.equal(dto.video_local_path, importedStoryboard.video_local_path);
    const dramaDetailStoryboard = dramaService.getDrama(targetDb, imported.drama_id).episodes[0].storyboards[0];
    assert.equal(dramaDetailStoryboard.video_local_path, importedStoryboard.video_local_path);
    assert.equal(
      targetDb.prepare(
        `SELECT local_path FROM video_generations
         WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL`
      ).get(dto.id).local_path,
      importedStoryboard.video_local_path
    );
  });
});
