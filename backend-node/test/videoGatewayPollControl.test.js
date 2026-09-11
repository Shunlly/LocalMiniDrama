'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const videoClient = require('../src/services/videoClient');
const {
  isVideoPollCancelled,
  throwVideoTaskCancelled,
  throwIfVideoPollAborted,
  delayVideoPoll,
} = require('../src/services/videoGateway/pollControl');

const VIDEO_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '../src/services/videoClient.js'), 'utf8');
const POLL_CONTROL_SRC = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/pollControl.js'), 'utf8');
const JIMENG_SYNC_SENTENCE = 'Jimeng AI API 为同步返回视频地址，不应进入轮询';
const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

function assertCancelledError(error) {
  assert.equal(error && error.name, 'AbortError');
  assert.equal(error.code, 'OPERATION_CANCELLED');
  assert.equal(error.message, '视频任务已取消');
  assert.notEqual(error.retryable, true);
  assert.doesNotMatch(String(error.message), /超时/);
  assert.match(String(error.message), /[\u4e00-\u9fff]/);
  return true;
}

function assertDistinctScopeIds(dramaId, videoGenId, taskId) {
  assert.notEqual(Number(dramaId), Number(videoGenId));
  assert.notEqual(String(dramaId), String(taskId));
  assert.notEqual(String(videoGenId), String(taskId));
}

describe('videoGateway 轮询取消控制', () => {
  it('取消/延迟辅助函数已从 videoClient 拆到 pollControl，即梦同步短路仍留在 pollVideoTaskInternal', () => {
    assert.ok(VIDEO_CLIENT_SRC.includes("require('./videoGateway/pollControl')"));
    assert.doesNotMatch(VIDEO_CLIENT_SRC, /function isVideoPollCancelled\s*\(/);
    assert.doesNotMatch(VIDEO_CLIENT_SRC, /function throwVideoTaskCancelled\s*\(/);
    assert.doesNotMatch(VIDEO_CLIENT_SRC, /function throwIfVideoPollAborted\s*\(/);
    assert.doesNotMatch(VIDEO_CLIENT_SRC, /function delayVideoPoll\s*\(/);

    const marker = 'async function pollVideoTaskInternal';
    const start = VIDEO_CLIENT_SRC.indexOf(marker);
    assert.notEqual(start, -1);
    const pollSrc = VIDEO_CLIENT_SRC.slice(start);
    assert.ok(pollSrc.includes(JIMENG_SYNC_SENTENCE));
    assert.ok(pollSrc.includes("if (protocol === 'jimeng_ai_api')"));
    assert.match(pollSrc, /pollSoraVideo|pollMinimaxVideo/);
    assert.ok(pollSrc.includes('interpretVideoPollResponse'));

    assert.match(POLL_CONTROL_SRC, /function isVideoPollCancelled\s*\(/);
    assert.match(POLL_CONTROL_SRC, /function throwVideoTaskCancelled\s*\(/);
    assert.match(POLL_CONTROL_SRC, /function throwIfVideoPollAborted\s*\(/);
    assert.match(POLL_CONTROL_SRC, /function delayVideoPoll\s*\(/);
    assert.equal(POLL_CONTROL_SRC.includes('jimeng_ai_api'), false);
    assert.equal(POLL_CONTROL_SRC.includes(JIMENG_SYNC_SENTENCE), false);
    assert.equal(POLL_CONTROL_SRC.includes('interpretVideoPollResponse'), false);
    assert.equal(POLL_CONTROL_SRC.includes('pollSoraVideo'), false);
  });

  it('pollVideoTask / callVideoApi 仍从 videoClient 公开导出', () => {
    assert.equal(typeof videoClient.pollVideoTask, 'function');
    assert.equal(typeof videoClient.callVideoApi, 'function');
    assert.equal(videoClient.isVideoPollCancelled, undefined);
    assert.equal(videoClient.delayVideoPoll, undefined);
  });

  it('本地 abort 视为取消；超时错误不视为取消', () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(isVideoPollCancelled(null, controller.signal), true);

    const canceled = Object.assign(new Error('视频任务已取消'), {
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
    });
    assert.equal(isVideoPollCancelled(canceled), true);

    const timeout = Object.assign(new Error('视频请求超时'), {
      name: 'TimeoutError',
      isTimeout: true,
      code: 'ETIMEDOUT',
      retryable: true,
    });
    assert.equal(isVideoPollCancelled(timeout), false);

    const timeoutController = new AbortController();
    timeoutController.abort(timeout);
    assert.equal(isVideoPollCancelled(timeout, timeoutController.signal), false);
    assert.equal(isVideoPollCancelled(null, timeoutController.signal), false);
  });

  it('throwVideoTaskCancelled 抛出不可重试的中文取消错误', () => {
    assert.throws(throwVideoTaskCancelled, assertCancelledError);
  });

  it('throwIfVideoPollAborted 仅在 signal 已 abort 时抛出取消', () => {
    throwIfVideoPollAborted();
    throwIfVideoPollAborted(undefined);
    throwIfVideoPollAborted({ aborted: false });
    const controller = new AbortController();
    throwIfVideoPollAborted(controller.signal);
    controller.abort();
    assert.throws(() => throwIfVideoPollAborted(controller.signal), assertCancelledError);
  });

  it('delayVideoPoll 可被中途取消，且已 abort 时同步抛出', async () => {
    await delayVideoPoll(0);
    await delayVideoPoll(1, undefined);

    const already = new AbortController();
    already.abort();
    assert.throws(() => delayVideoPoll(20, already.signal), assertCancelledError);

    const controller = new AbortController();
    const pending = delayVideoPoll(1000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(() => pending, assertCancelledError);
  });

  it('即梦同步协议在进入轮询循环前短路，不发查询请求', async () => {
    const dramaId = 91073;
    const videoGenId = 81071;
    const taskId = 'jimeng-sync-81072';
    assertDistinctScopeIds(dramaId, videoGenId, taskId);

    let fetchCalls = 0;
    const controller = new AbortController();
    controller.abort();
    const result = await videoClient.pollVideoTask(
      null,
      createCapturingLogger(),
      videoGenId,
      taskId,
      {
        provider: 'jimeng_ai_api',
        api_protocol: 'jimeng_ai_api',
        base_url: 'https://jimeng.example.com/v1',
        api_key: 'jimeng-key',
        drama_id: dramaId,
        provider_dns_lookup: providerDnsLookup,
        fetch_impl: async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({ status: 'processing' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      4,
      0,
      controller.signal
    );

    assert.deepEqual(result, { error: JIMENG_SYNC_SENTENCE });
    assert.equal(fetchCalls, 0);
  });
});