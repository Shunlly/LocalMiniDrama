const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logger = require('../src/logger');
const {
  logCaughtRouteError,
  publicErrorMessage,
  sendCaughtRouteError,
} = require('../src/routes/serviceFailure');
const taskRoutes = require('../src/routes/task');
const workflowRoutes = require('../src/routes/workflows');
const audioRoutes = require('../src/routes/audio');
const aiConfigRoutes = require('../src/routes/aiConfig');
const taskService = require('../src/services/taskService');
const ttsService = require('../src/services/ttsService');
const aiConfigService = require('../src/services/aiConfigService');

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function capturingLog() {
  const events = [];
  return {
    events,
    error(message, metadata) { events.push({ level: 'error', message, metadata }); },
    errorw(message, metadata) { events.push({ level: 'errorw', message, metadata }); },
    operation(event) { events.push({ level: 'operation', event }); },
    info() {},
    warn() {},
  };
}

describe('路由日志把技术错误和用户文案拆开', () => {
  it('logCaughtRouteError 保留技术错误、单独给用户文案，并带上 request_id', () => {
    const log = capturingLog();
    logger.runWithRequestId('trace-route-obs-1', () => {
      logCaughtRouteError(log, 'workflows list', new Error('SQLITE_ERROR: no such table: workflow_runs'), {
        fallback: '工作流操作失败',
      });
    });
    assert.equal(log.events.length, 2);
    const errorEvent = log.events.find((item) => item.level === 'error');
    const operation = log.events.find((item) => item.level === 'operation');
    assert.equal(errorEvent.metadata.error, 'SQLITE_ERROR: no such table: workflow_runs');
    assert.equal(errorEvent.metadata.userError, '工作流操作失败');
    assert.equal(errorEvent.metadata.request_id, 'trace-route-obs-1');
    assert.equal(operation.event.phase, 'error');
    assert.equal(operation.event.userError, '工作流操作失败');
    assert.equal(operation.event.request_id, 'trace-route-obs-1');
    assert.doesNotMatch(JSON.stringify(log.events), /requestId/);
  });

  it('技术错误里的密钥会被脱敏，用户文案仍是中文', () => {
    const log = capturingLog();
    const secret = 'sk-route-obs-secret-123456';
    logCaughtRouteError(log, 'AI config discover models failed', new Error(`invalid api key ${secret}`), {
      fallback: '读取模型目录失败，请检查接口地址和密钥',
    });
    const serialized = JSON.stringify(log.events);
    assert.doesNotMatch(serialized, /sk-route-obs-secret-123456/);
    assert.equal(log.events[0].metadata.userError, '读取模型目录失败，请检查接口地址和密钥');
    assert.match(log.events[0].metadata.error, /invalid api key/);
  });

  it('任务取消抛错不再复用查询失败文案，并写入 userError', async () => {
    const log = capturingLog();
    const original = taskService.cancelTask;
    taskService.cancelTask = async () => {
      throw new Error('SQLITE_ERROR: no such table: async_tasks');
    };
    try {
      const res = mockRes();
      await taskRoutes({}, log).cancelTaskStatus({ params: { task_id: 'task-9' }, body: {} }, res);
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.error.code, 'INTERNAL_ERROR');
      assert.equal(res.body.error.message, '任务取消失败，请稍后重试');
      assert.doesNotMatch(res.body.error.message, /任务查询失败|SQLITE_ERROR|no such table/);
      const errorEvent = log.events.find((item) => item.message === 'Cancel task failed');
      assert.ok(errorEvent);
      assert.match(errorEvent.metadata.error, /SQLITE_ERROR/);
      assert.equal(errorEvent.metadata.userError, '任务取消失败，请稍后重试');
      assert.equal(errorEvent.metadata.task_id, 'task-9');
    } finally {
      taskService.cancelTask = original;
    }
  });

  it('任务取消抛出项目边界错误仍返回 409 中文', async () => {
    const log = capturingLog();
    const original = taskService.cancelTask;
    const recycle = Object.assign(new Error('项目正在回收站流程中，暂不可访问'), {
      code: 'DRAMA_RECYCLE_IN_PROGRESS',
      statusCode: 409,
    });
    taskService.cancelTask = async () => { throw recycle; };
    try {
      const res = mockRes();
      await taskRoutes({}, log).cancelTaskStatus({ params: { task_id: 'task-9' }, body: {} }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.error.code, 'DRAMA_RECYCLE_IN_PROGRESS');
      assert.equal(res.body.error.message, '项目正在回收站流程中，暂不可访问');
      assert.equal(log.events.length, 0);
    } finally {
      taskService.cancelTask = original;
    }
  });

  it('工作流列表失败把 SQLITE 留在日志，用户只看到中文', () => {
    const log = capturingLog();
    const res = mockRes();
    workflowRoutes({
      prepare() { throw new Error('SQLITE_ERROR: no such table: workflow_runs'); },
    }, log).list({ query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(hasCjk(res.body.error.message), true);
    assert.doesNotMatch(res.body.error.message, /SQLITE_ERROR|no such table/i);
    const errorEvent = log.events.find((item) => item.message === 'workflows list');
    assert.ok(errorEvent);
    assert.match(errorEvent.metadata.error, /SQLITE_ERROR/);
    assert.equal(errorEvent.metadata.userError, '工作流操作失败');
  });

  it('配音落库失败会记日志，不再静默吞掉', async (t) => {
    const log = capturingLog();
    t.mock.method(ttsService, 'synthesize', async () => ({ local_path: 'audio/demo.wav' }));
    const db = {
      prepare(sql) {
        if (/UPDATE storyboards/.test(sql)) {
          return { run() { throw new Error('SQLITE_BUSY: database is locked'); } };
        }
        return { get() { return { dialogue: '巷口只剩一把油纸伞。' }; } };
      },
    };
    const res = mockRes();
    await audioRoutes(db, log, { storage: { local_path: './data/storage' } }).extract({
      body: { storyboard_id: 22, text: '巷口只剩一把油纸伞。' },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'AUDIO_PERSIST_FAILED');
    assert.equal(res.body.error.message, '配音已生成，但分镜记录未能更新，请稍后重试');
    assert.doesNotMatch(res.body.error.message, /SQLITE_BUSY|database is locked/i);
    const persist = log.events.find((item) => item.message === 'audio extract persist');
    assert.ok(persist);
    assert.match(persist.metadata.error, /SQLITE_BUSY/);
    assert.equal(persist.metadata.userError, '配音已生成，但分镜记录未能更新，请稍后重试');
    assert.equal(persist.metadata.storyboard_id, 22);
  });

  it('批量配音单项失败会记日志，响应仍是中文', async (t) => {
    const log = capturingLog();
    t.mock.method(ttsService, 'synthesize', async () => {
      throw new Error('fetch failed');
    });
    const db = {
      prepare() {
        return { get() { return { id: 33, dialogue: '雨夜对峙。' }; } };
      },
    };
    const res = mockRes();
    await audioRoutes(db, log, { storage: { local_path: './data/storage' } }).extractBatch({
      body: { storyboard_ids: [33] },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].storyboard_id, 33);
    assert.equal(hasCjk(res.body.data[0].error), true);
    assert.doesNotMatch(res.body.data[0].error, /fetch failed/i);
    const itemLog = log.events.find((item) => item.message === 'audio extract batch item');
    assert.ok(itemLog);
    assert.match(itemLog.metadata.error, /fetch failed/i);
    assert.equal(itemLog.metadata.storyboard_id, 33);
    assert.equal(itemLog.metadata.userError, res.body.data[0].error);
  });

  it('读取模型目录失败日志保留脱敏后的技术错误，响应不回传密钥', async (t) => {
    const log = capturingLog();
    const secret = 'sk-discover-obs-secret-123456';
    t.mock.method(aiConfigService, 'discoverModels', async () => {
      throw new Error(`invalid api key ${secret}`);
    });
    const res = mockRes();
    await aiConfigRoutes({}, log, {}).discoverModels({
      body: {
        provider: 'openai_compatible',
        service_type: 'text',
        base_url: 'https://provider.example.com/v1',
        api_key: secret,
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /读取模型目录失败/);
    const serialized = JSON.stringify({ body: res.body, logged: log.events });
    assert.doesNotMatch(serialized, /sk-discover-obs-secret-123456/);
    const errorEvent = log.events.find((item) => item.message === 'AI config discover models failed');
    assert.ok(errorEvent);
    assert.match(errorEvent.metadata.error, /invalid api key/);
    assert.equal(errorEvent.metadata.userError, res.body.error.message);
  });

  it('任务取消路由源码不再把查询失败文案套到取消失败上', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/task.js'), 'utf8');
    assert.match(source, /任务取消失败，请稍后重试/);
    assert.equal(source.includes("sendCaughtRouteError(res, err, '任务查询失败，请稍后重试');\n    }"), false);
    const cancelBlock = source.slice(source.indexOf('function cancelTaskStatus'));
    assert.doesNotMatch(cancelBlock, /任务查询失败/);
    assert.match(cancelBlock, /if \(sendBoundaryError\(res, err\)\) return;/);
  });
});
