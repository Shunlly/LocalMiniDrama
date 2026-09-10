'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveVideoPollFlags,
  buildVideoPollRequest,
  interpretVideoPollResponse,
} = require('../src/services/videoGateway/pollDispatch');

function silentLog() {
  const log = {};
  for (const level of ['debug', 'info', 'warn', 'error']) log[level] = () => {};
  return log;
}

describe('videoGateway 轮询分发', () => {
  it('即梦协议只标记 flags，不在这里短路', () => {
    const flags = resolveVideoPollFlags({
      provider: 'jimeng_ai_api',
      api_protocol: 'jimeng_ai_api',
      base_url: 'https://example.invalid',
    }, 'task-1');
    assert.equal(flags.protocol, 'jimeng_ai_api');
    assert.equal(flags.isKling, false);
  });

  it('可灵轮询按 task_id 前缀拼查询地址', () => {
    const config = {
      provider: 'kling',
      api_protocol: 'kling',
      base_url: 'https://api.klingai.example',
      api_key: 'k',
    };
    const flags = resolveVideoPollFlags(config, 'i2v:abc');
    const request = buildVideoPollRequest(config, 'i2v:abc', flags, silentLog());
    assert.equal(request.url, 'https://api.klingai.example/v1/videos/image2video/abc');
    assert.equal(request.headers.Authorization, 'Bearer k');
  });

  it('可灵成功响应返回视频地址，失败返回中文错误', () => {
    const flags = resolveVideoPollFlags({
      provider: 'kling',
      api_protocol: 'kling',
      base_url: 'https://api.klingai.example',
    }, 't2v:abc');
    const ok = interpretVideoPollResponse({
      flags,
      data: { code: 0, data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.example/a.mp4' }] } } },
      res: { status: 200 },
      log: silentLog(),
      videoGenId: 1,
      taskId: 't2v:abc',
      attempt: 0,
      pollRound: 1,
      provider: 'kling',
    });
    assert.deepEqual(ok, { action: 'return', value: { video_url: 'https://cdn.example/a.mp4' } });

    const missing = interpretVideoPollResponse({
      flags,
      data: { code: 0, data: { task_status: 'succeed', task_result: { videos: [] } } },
      res: { status: 200 },
      log: silentLog(),
      videoGenId: 1,
      taskId: 't2v:abc',
      attempt: 0,
      pollRound: 1,
      provider: 'kling',
    });
    assert.equal(missing.action, 'return');
    assert.match(missing.value.error, /可灵任务完成但未返回视频地址/);
  });

  it('Vidu 完成但无地址时返回中文错误，处理中则继续', () => {
    const flags = resolveVideoPollFlags({
      provider: 'vidu',
      api_protocol: 'vidu',
      base_url: 'https://api.vidu.cn',
    }, 'vidu-1');
    const pending = interpretVideoPollResponse({
      flags,
      data: { state: 'processing' },
      res: { status: 200 },
      log: silentLog(),
      videoGenId: 2,
      taskId: 'vidu-1',
      attempt: 0,
      pollRound: 1,
      provider: 'vidu',
    });
    assert.deepEqual(pending, { action: 'continue' });

    const done = interpretVideoPollResponse({
      flags,
      data: { state: 'success', creations: [] },
      res: { status: 200 },
      log: silentLog(),
      videoGenId: 2,
      taskId: 'vidu-1',
      attempt: 0,
      pollRound: 1,
      provider: 'vidu',
    });
    assert.equal(done.action, 'return');
    assert.match(done.value.error, /Vidu 任务完成但未返回视频地址/);
  });
});
