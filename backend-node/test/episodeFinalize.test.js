const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { performance } = require('node:perf_hooks');
const Database = require('better-sqlite3');

const configModule = require('../src/config');
const ffmpegPath = require('../src/utils/ffmpegPath');
const uploadService = require('../src/services/uploadService');
const { writeFixtureVideoFile } = require('./mediaFixture');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-finalize-'));
const storageRoot = path.join(testRoot, 'storage');
const originalLoadConfig = configModule.loadConfig;
configModule.loadConfig = () => ({
  app: { name: 'episode-finalize-test' },
  storage: { local_path: storageRoot, base_url: 'http://localhost:5679/static' },
});

const dramaRoutes = require('../src/routes/drama');
const {
  getLegacyAsyncSchedulerState,
  shutdownLegacyAsyncScheduler,
} = require('../src/services/legacyAsyncSchedulerService');

const log = {
  info() {},
  warn() {},
  error() {},
  errorw() {},
};

after(() => {
  configModule.loadConfig = originalLoadConfig;
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      episode_number INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      video_url TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      storyboard_number INTEGER DEFAULT 0,
      duration REAL,
      video_url TEXT,
      video_local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      video_url TEXT,
      local_path TEXT,
      status TEXT,
      completed_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      drama_id INTEGER,
      title TEXT,
      provider TEXT,
      model TEXT,
      status TEXT,
      scenes TEXT,
      merge_options TEXT,
      task_id TEXT,
      merged_url TEXT,
      duration INTEGER,
      completed_at TEXT,
      error_msg TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT,
      cancel_context TEXT,
      cancel_operation_id TEXT,
      cancel_state TEXT,
      cancel_attempt INTEGER DEFAULT 0,
      cancel_next_retry_at TEXT,
      cancel_requested_at TEXT,
      cancel_confirmed_at TEXT
    );
  `);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO dramas (id, title, metadata, created_at, updated_at) VALUES (1, ?, ?, ?, ?)'
  ).run('Finalize Test', '{}', now, now);
  db.prepare(
    'INSERT INTO episodes (id, drama_id, episode_number, status, updated_at) VALUES (1, 1, 1, ?, ?)'
  ).run('draft', now);
  return db;
}

function createResponse() {
  return {
    statusCode: null,
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

function finalize(handler, body = {}) {
  const res = createResponse();
  handler({ params: { episode_id: '1' }, body }, res);
  return res;
}

async function waitForTerminalMerge(db, mergeId, timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const merge = db.prepare('SELECT * FROM video_merges WHERE id = ?').get(mergeId);
    if (merge && ['completed', 'failed'].includes(merge.status)) return merge;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`merge ${mergeId} did not reach a terminal state`);
}

async function waitForBackgroundIdle(timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (getLegacyAsyncSchedulerState().active === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('episode finalize background task did not settle');
}

function tempMergeDirectories(mergeId) {
  const prefix = `drama-video-merge-${mergeId}-`;
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)).sort();
}

function productionFfmpegUnavailableReason() {
  const tools = ffmpegPath.validateFfmpegTools();
  if (!tools.ok) return tools.error;
  const encoders = ffmpegPath.getAvailableFfmpegEncoders();
  const supported = encoders.ok
    && encoders.encoders.includes('aac')
    && (encoders.encoders.includes('libx264') || encoders.encoders.includes('libopenh264'));
  return supported ? null : (encoders.error || 'required production FFmpeg encoders are unavailable');
}

test('finalize rejects an episode with no composable video clips', () => {
  const db = createDb();
  try {
    const res = finalize(dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'EPISODE_NOT_READY');
    assert.equal(res.body.error.details.reason, 'NO_VIDEO_CLIPS');
    assert.equal(db.prepare('SELECT status FROM episodes WHERE id = 1').get().status, 'draft');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, 0);
  } finally {
    db.close();
  }
});

test('finalize fails closed when the random FFmpeg staging output cannot be published', async (t) => {
  const unavailableReason = productionFfmpegUnavailableReason();
  if (unavailableReason) return t.skip(unavailableReason);

  const db = createDb();
  let mergeId;
  let stagedOutputPath = null;
  let finalOutputPath = null;
  try {
    const clipPath = path.join(storageRoot, 'inputs', 'clip.mp4');
    writeFixtureVideoFile(ffmpegPath.getFfmpegPath(), clipPath);
    db.prepare(
      'INSERT INTO video_merges (id, status, deleted_at) VALUES (9000000, ?, ?)'
    ).run('test-sequence-seed', new Date().toISOString());
    db.prepare(
      `INSERT INTO storyboards
         (id, episode_id, storyboard_number, duration, video_local_path, updated_at)
       VALUES (101, 1, 1, 0.2, ?, ?)`
    ).run('inputs/clip.mp4', new Date().toISOString());

    const originalSpawn = childProcess.spawn;
    t.mock.method(childProcess, 'spawn', function spawnTrackingConcat(command, args, options) {
      const outputPath = args[args.length - 1];
      if (args.includes('concat') && /\.tmp\.mp4$/i.test(outputPath)) {
        stagedOutputPath = outputPath;
      }
      return originalSpawn.call(this, command, args, options);
    });
    t.mock.method(uploadService, 'publishStagedFile', (stagedPath, finalPath) => {
      assert.equal(stagedPath, stagedOutputPath);
      assert.equal(fs.statSync(stagedPath).isFile(), true);
      assert.ok(fs.statSync(stagedPath).size > 0);
      finalOutputPath = finalPath;
      throw new Error('测试模拟发布失败');
    });

    const res = finalize(dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode);
    assert.equal(res.statusCode, 200);
    mergeId = Number(res.body.data.merge_id);
    assert.ok(mergeId > 0);

    const tempBefore = tempMergeDirectories(mergeId);

    const merge = await waitForTerminalMerge(db, mergeId);
    await waitForBackgroundIdle();
    const episode = db.prepare('SELECT status, video_url FROM episodes WHERE id = 1').get();
    const task = db.prepare('SELECT status, error, result FROM async_tasks WHERE id = ?').get(res.body.data.task_id);
    const options = JSON.parse(merge.merge_options || '{}');

    assert.match(path.basename(stagedOutputPath), /^\.merged_.+\.tmp\.mp4$/);
    assert.ok(finalOutputPath, '测试桩应拦截随机暂存输出的发布');
    assert.equal(merge.status, 'failed');
    assert.equal(merge.merged_url, null);
    assert.match(merge.error_msg, /测试模拟发布失败/);
    assert.equal(episode.status, 'failed');
    assert.equal(episode.video_url, null);
    assert.equal(task.status, 'failed');
    assert.ok(task.error);
    assert.equal(task.result, null);
    assert.equal(options.mode, 'strict_production');
    assert.equal(fs.existsSync(stagedOutputPath), false);
    assert.equal(fs.existsSync(finalOutputPath), false);
    assert.deepEqual(tempMergeDirectories(mergeId), tempBefore);
  } finally {
    if (getLegacyAsyncSchedulerState().active > 0) await waitForBackgroundIdle();
    if (stagedOutputPath) fs.rmSync(stagedOutputPath, { recursive: true, force: true });
    if (finalOutputPath) fs.rmSync(finalOutputPath, { recursive: true, force: true });
    db.close();
  }
});

test('finalize still completes when FFmpeg produces a verified merged output', async (t) => {
  const unavailableReason = productionFfmpegUnavailableReason();
  if (unavailableReason) return t.skip(unavailableReason);

  const db = createDb();
  let mergeId;
  try {
    const clipPath = path.join(storageRoot, 'inputs', 'successful-clip.mp4');
    writeFixtureVideoFile(ffmpegPath.getFfmpegPath(), clipPath);
    db.prepare(
      'INSERT INTO video_merges (id, status, deleted_at) VALUES (9100000, ?, ?)'
    ).run('test-sequence-seed', new Date().toISOString());
    db.prepare(
      `INSERT INTO storyboards
         (id, episode_id, storyboard_number, duration, video_local_path, updated_at)
       VALUES (201, 1, 1, 0.2, ?, ?)`
    ).run('inputs/successful-clip.mp4', new Date().toISOString());

    const res = finalize(dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode);
    assert.equal(res.statusCode, 200);
    mergeId = Number(res.body.data.merge_id);
    const tempBefore = tempMergeDirectories(mergeId);

    const merge = await waitForTerminalMerge(db, mergeId);
    await waitForBackgroundIdle();
    const episode = db.prepare('SELECT status, video_url FROM episodes WHERE id = 1').get();
    const task = db.prepare('SELECT status, error, result FROM async_tasks WHERE id = ?').get(res.body.data.task_id);

    assert.equal(merge.status, 'completed');
    assert.notEqual(merge.merged_url, 'inputs/successful-clip.mp4');
    assert.equal(episode.status, 'completed');
    assert.equal(episode.video_url, merge.merged_url);
    assert.equal(task.status, 'completed');
    assert.equal(task.error, null);
    assert.ok(task.result);
    assert.equal(fs.existsSync(path.join(storageRoot, merge.merged_url.replace(/\//g, path.sep))), true);
    assert.deepEqual(tempMergeDirectories(mergeId), tempBefore);
  } finally {
    if (getLegacyAsyncSchedulerState().active > 0) await waitForBackgroundIdle();
    db.close();
  }
});

test('repeated finalize requests reuse the active merge for an episode', async () => {
  const db = createDb();
  try {
    const clipPath = path.join(storageRoot, 'inputs', 'duplicate-finalize.mp4');
    fs.mkdirSync(path.dirname(clipPath), { recursive: true });
    fs.writeFileSync(clipPath, Buffer.from('invalid media is sufficient for scheduling'));
    db.prepare(
      `INSERT INTO storyboards
         (id, episode_id, storyboard_number, duration, video_local_path, updated_at)
       VALUES (301, 1, 1, 0.2, ?, ?)`
    ).run('inputs/duplicate-finalize.mp4', new Date().toISOString());

    const handler = dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode;
    const first = finalize(handler);
    const second = finalize(handler);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.data.merge_id, first.body.data.merge_id);
    assert.equal(second.body.data.task_id, first.body.data.task_id);
    assert.equal(second.body.data.reused, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 1);
  } finally {
    if (getLegacyAsyncSchedulerState().active > 0) await waitForBackgroundIdle();
    db.close();
  }
});

test('finalize reuses an episode merge that is awaiting QA', () => {
  const db = createDb();
  try {
    const taskId = 'qa-pending-task';
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks
         (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, 'video_merge', 'completed', 100, '', '1', ?, ?, ?)`
    ).run(taskId, now, now, now);
    const merge = db.prepare(
      `INSERT INTO video_merges
         (episode_id, drama_id, status, scenes, task_id, created_at)
       VALUES (1, 1, 'qa_pending', '[]', ?, ?)`
    ).run(taskId, now);

    const res = finalize(dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode);

    assert.equal(res.statusCode, 200);
    assert.equal(Number(res.body.data.merge_id), Number(merge.lastInsertRowid));
    assert.equal(res.body.data.task_id, taskId);
    assert.equal(res.body.data.reused, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, 1);
  } finally {
    db.close();
  }
});

test('finalize creates no merge or task after the scheduler stops accepting work', async () => {
  const db = createDb();
  try {
    const clipPath = path.join(storageRoot, 'inputs', 'scheduler-closed.mp4');
    fs.mkdirSync(path.dirname(clipPath), { recursive: true });
    fs.writeFileSync(clipPath, Buffer.from('content is never processed'));
    db.prepare(
      `INSERT INTO storyboards
         (id, episode_id, storyboard_number, duration, video_local_path, updated_at)
       VALUES (401, 1, 1, 0.2, ?, ?)`
    ).run('inputs/scheduler-closed.mp4', new Date().toISOString());

    await shutdownLegacyAsyncScheduler();
    assert.throws(
      () => finalize(dramaRoutes(db, { storage: { base_url: '' } }, log).finalizeEpisode),
      (error) => error.code === 'LEGACY_ASYNC_SCHEDULER_CLOSED'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM async_tasks').get().count, 0);
    assert.equal(db.prepare('SELECT status FROM episodes WHERE id = 1').get().status, 'draft');
  } finally {
    db.close();
  }
});
