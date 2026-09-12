'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const videoService = require('../src/services/videoService');
const { createVideoServiceProcess } = require('../src/services/videoServiceProcess');
const { toUserFacingProcessError } = require('../src/services/providerErrorSanitizer');

const DRAMA_ID = 11;
const VIDEO_ID = 101;
const OTHER_VIDEO_ID = 202;

const processApi = createVideoServiceProcess({
  providerMessages: videoService.VIDEO_PROVIDER_TASK_MESSAGES,
  processMessages: {
    missingTaskOrUrl: '未返回任务编号或视频地址',
    missingRemoteCancel: '供应商已返回任务编号，但未注册远端取消函数',
  },
});

test('videoService 公开执行入口仍是函数，且不把即梦改成轮询', () => {
  assert.equal(typeof videoService.processVideoGeneration, 'function');
  assert.equal(typeof processApi.processVideoGeneration, 'function');
  const processSource = [
    fs.readFileSync(
      path.join(__dirname, '../src/services/videoServiceProcess.js'),
      'utf8'
    ),
    fs.readFileSync(
      path.join(__dirname, '../src/services/videoServiceProcessNormalize.js'),
      'utf8'
    ),
  ].join('\n');
  assert.equal(processSource.includes("protocol === 'jimeng_ai_api'"), false);
  assert.equal(processSource.includes('不应进入轮询'), false);
  const clientSource = [
    fs.readFileSync(path.join(__dirname, '../src/services/videoClient.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/services/videoClientPoll.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/pollTask.js'), 'utf8'),
  ].join('\n');
  assert.match(clientSource, /if \(protocol === 'jimeng_ai_api'\)/);
  assert.match(clientSource, /即梦视频为同步返回视频地址，不应进入轮询/);
});

test('跨模块 ID 互不相等，避免碰巧同值假通过', () => {
  assert.notEqual(DRAMA_ID, VIDEO_ID);
  assert.notEqual(VIDEO_ID, OTHER_VIDEO_ID);
});

test('远程视频地址只接受 http(s)，文案失败不当成可下载地址', () => {
  assert.deepEqual(
    processApi.resolveRemoteVideoUrl('https://cdn.example/v.mp4'),
    { ok: true, video_url: 'https://cdn.example/v.mp4' }
  );
  assert.equal(processApi.resolveRemoteVideoUrl('not a url', '超时或失败').ok, false);
  assert.equal(processApi.resolveRemoteVideoUrl('FAILURE: model overloaded').ok, false);
});

test('失败持久化会把英文系统错误收成中文，且只改目标记录', async () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (?, '视频执行甲', 'draft', ?, ?)`
  ).run(DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO video_generations (id, drama_id, provider, prompt, status, created_at, updated_at)
     VALUES (?, ?, 'test', '夜雨', 'processing', ?, ?)`
  ).run(VIDEO_ID, DRAMA_ID, now, now);
  db.prepare(
    `INSERT INTO video_generations (id, drama_id, provider, prompt, status, created_at, updated_at)
     VALUES (?, ?, 'test', '晴天', 'completed', ?, ?)`
  ).run(OTHER_VIDEO_ID, DRAMA_ID, now, now);

  await processApi.persistVideoFailure(db, { id: VIDEO_ID }, new Error('ENOENT: no such file or directory'));
  const failed = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(VIDEO_ID);
  const other = db.prepare('SELECT status, error_msg FROM video_generations WHERE id = ?').get(OTHER_VIDEO_ID);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_msg, '视频生成失败');
  assert.equal(other.status, 'completed');
  assert.equal(other.error_msg, null);
  assert.equal(
    toUserFacingProcessError(new Error('ENOENT: no such file or directory'), '视频生成失败'),
    '视频生成失败'
  );
  db.close();
});
