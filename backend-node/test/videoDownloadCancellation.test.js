'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = require('../src/config');
const uploadService = require('../src/services/uploadService');
const storageLayout = require('../src/services/storageLayout');
const taskService = require('../src/services/taskService');
const videoService = require('../src/services/videoService');

const log = { debug() {}, info() {}, warn() {}, error() {} };

test('视频下载传播取消信号，并删除取消决议前已落盘但未提交的文件', async (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-video-cancel-'));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, status TEXT, video_url TEXT, local_path TEXT,
      completed_at TEXT, updated_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, video_url TEXT, video_local_path TEXT,
      updated_at TEXT, deleted_at TEXT
    );
    INSERT INTO video_generations (id, status) VALUES (7, 'processing');
  `);

  const controller = new AbortController();
  let receivedSignal = null;
  let cancellationChecks = 0;
  t.mock.method(config, 'loadConfig', () => ({ storage: { local_path: storageRoot } }));
  t.mock.method(storageLayout, 'getProjectStorageSubdir', () => 'projects/1');
  t.mock.method(uploadService, 'validatePublicHttpUrl', async (url) => ({ url }));
  t.mock.method(uploadService, 'assertUploadDiskCapacity', () => {});
  t.mock.method(uploadService, 'downloadBufferViaNodeHttp', async (_url, _timeout, _redirects, options) => {
    receivedSignal = options.signal;
    return { buffer: Buffer.from('video-bytes'), contentType: 'video/mp4' };
  });
  t.mock.method(taskService, 'waitForTaskCancellationDecision', async () => {
    cancellationChecks += 1;
    if (cancellationChecks === 3) {
      const error = new Error('用户已取消');
      error.name = 'AbortError';
      error.code = 'OPERATION_CANCELLED';
      controller.abort(error);
      throw error;
    }
  });

  const row = { task_id: 'task-7', drama_id: 1, storyboard_id: null };
  await assert.rejects(
    videoService.finalizeSuccessfulVideo(
      db, log, 7, row, row, 'https://provider.example/video.mp4', '',
      { is_active: 1, base_url: 'https://provider.example' }, controller.signal
    ),
    (error) => error.code === 'OPERATION_CANCELLED'
  );

  assert.equal(receivedSignal, controller.signal);
  const videoDirectory = path.join(storageRoot, 'projects', '1', 'videos');
  assert.deepEqual(fs.existsSync(videoDirectory) ? fs.readdirSync(videoDirectory) : [], []);
  assert.deepEqual(
    db.prepare('SELECT status, video_url, local_path FROM video_generations WHERE id = 7').get(),
    { status: 'processing', video_url: null, local_path: null }
  );
});
