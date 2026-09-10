const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const imageRoutes = require('../src/routes/images');
const videoRoutes = require('../src/routes/videos');
const taskRoutes = require('../src/routes/task');

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function throwingDb(message) {
  return {
    prepare() {
      throw new Error(message);
    },
  };
}

describe('图片视频任务路由对用户返回中文错误', () => {
  it('源码不再把 err.message 直接交给 internalError', () => {
    for (const file of ['images.js', 'videos.js', 'storyboards.js', 'task.js', 'videoMerges.js']) {
      const source = fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8');
      assert.equal(source.includes('response.internalError(res, err.message)'), false, file);
      assert.match(source, /sendCaughtRouteError/, file);
    }
  });

  it('列表和任务查询失败映射为中文，不回传 SQLITE 英文', () => {
    const silent = { error() {}, errorw() {} };
    const imageRes = mockRes();
    imageRoutes(throwingDb('SQLITE_ERROR: no such table: images'), {}, silent).list({ query: {} }, imageRes);
    assert.equal(imageRes.statusCode, 400);
    assert.equal(hasCjk(imageRes.body.error.message), true);
    assert.doesNotMatch(imageRes.body.error.message, /SQLITE_ERROR|no such table/i);

    const videoRes = mockRes();
    videoRoutes(throwingDb('SQLITE_ERROR: no such table: videos'), silent).list({ query: {} }, videoRes);
    assert.equal(videoRes.statusCode, 400);
    assert.equal(hasCjk(videoRes.body.error.message), true);
    assert.doesNotMatch(videoRes.body.error.message, /SQLITE_ERROR|no such table/i);

    const taskRes = mockRes();
    taskRoutes(throwingDb('SQLITE_ERROR: no such table: async_tasks'), silent).getTaskStatus(
      { params: { task_id: '1' } },
      taskRes,
    );
    assert.equal(taskRes.statusCode, 400);
    assert.equal(hasCjk(taskRes.body.error.message), true);
    assert.doesNotMatch(taskRes.body.error.message, /SQLITE_ERROR|no such table/i);
  });
});
