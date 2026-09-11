
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const videoClient = require('../src/services/videoClient');
const aiConfigService = require('../src/services/aiConfigService');
const uploadService = require('../src/services/uploadService');
const { callKlingImageApi } = require('../src/services/imageGateway/klingImageAdapter');
const { callNanoBananaImageApi } = require('../src/services/imageGateway/nanoBananaImageAdapter');
const { imageRequestContext } = require('../src/services/imageGateway/runtime');
const {
  isRequestCanceled,
  isRequestTimeout,
  isProviderTaskCancelledStatus,
} = require('../src/services/imageGateway/requestError');
const { assembleVideoApiCall, toVideoProtocolDispatchArgs } = require('../src/services/videoGateway/videoApiAssembly');
const { fetchVideoWithTimeout } = require('../src/services/videoGateway/providerRuntime');

const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

function assertDistinctIds(dramaId, jobId, providerTaskId) {
  assert.notEqual(Number(dramaId), Number(jobId));
  assert.notEqual(String(dramaId), String(providerTaskId));
  assert.notEqual(String(jobId), String(providerTaskId));
}

function openaiVideoConfig() {
  return {
    provider: 'custom-provider',
    api_protocol: 'openai',
    base_url: 'https://video.example.com/v1',
    api_key: 'secret',
    is_active: 1,
    is_default: 1,
    model: ['demo-video'],
    default_model: 'demo-video',
    endpoint: '/videos',
  };
}

describe('图片/视频 Provider 取消、超时与 ID 隔离', () => {
  it('isProviderTaskCancelledStatus 覆盖 cancelled 别名，且不把 failed 当取消', () => {
    assert.equal(isProviderTaskCancelledStatus('cancelled'), true);
    assert.equal(isProviderTaskCancelledStatus('canceled'), true);
    assert.equal(isProviderTaskCancelledStatus('cancelled_by_user'), true);
    assert.equal(isProviderTaskCancelledStatus('failed'), false);
    assert.equal(isProviderTaskCancelledStatus('succeed'), false);
  });

  it('callVideoApi 在已取消信号下不得当成功，且不把项目 id 当任务 id', async (t) => {
    const dramaId = 91003;
    const videoGenId = 81001;
    const providerTaskId = 'vendor-task-81002';
    assertDistinctIds(dramaId, videoGenId, providerTaskId);

    t.mock.method(aiConfigService, 'listConfigs', () => [openaiVideoConfig()]);
    const controller = new AbortController();
    controller.abort();
    let fetchCalls = 0;
    await assert.rejects(
      videoClient.callVideoApi(null, createCapturingLogger(), {
        prompt: 'cancel-before',
        drama_id: dramaId,
        video_gen_id: videoGenId,
        idempotency_key: `video-generation-${videoGenId}`,
        signal: controller.signal,
        provider_dns_lookup: providerDnsLookup,
        fetch_impl: async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({ id: providerTaskId, status: 'queued' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
      (error) => {
        assert.equal(isRequestCanceled(error), true);
        assert.equal(isRequestTimeout(error), false);
        assert.match(String(error.message), /[\u4e00-\u9fff]/);
        assert.match(String(error.message), /取消/);
        assert.doesNotMatch(String(error.message), /timeout|aborted|成功/i);
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  });

  it('callVideoApi 厂商已返回后取消，仍不得把结果当成功', async (t) => {
    const dramaId = 92013;
    const videoGenId = 82011;
    const providerTaskId = 'vendor-task-82012';
    assertDistinctIds(dramaId, videoGenId, providerTaskId);

    t.mock.method(aiConfigService, 'listConfigs', () => [openaiVideoConfig()]);
    const controller = new AbortController();
    let fetchCalls = 0;
    await assert.rejects(
      videoClient.callVideoApi(null, createCapturingLogger(), {
        prompt: 'cancel-after',
        drama_id: dramaId,
        video_gen_id: videoGenId,
        idempotency_key: `video-generation-${videoGenId}`,
        signal: controller.signal,
        provider_dns_lookup: providerDnsLookup,
        fetch_impl: async (_url, options) => {
          fetchCalls += 1;
          assert.ok(options.signal instanceof AbortSignal);
          controller.abort();
          return new Response(JSON.stringify({
            id: providerTaskId,
            status: 'completed',
            video_url: 'https://cdn.example.com/late.mp4',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
      (error) => isRequestCanceled(error) && /取消/.test(String(error.message))
    );
    assert.equal(fetchCalls, 1);
  });

  it('OpenAI 兼容创建请求挂起时取消会中止，且幂等键用任务 id 而不是项目 id', async (t) => {
    const dramaId = 93023;
    const videoGenId = 83021;
    const providerTaskId = 'vendor-task-83022';
    assertDistinctIds(dramaId, videoGenId, providerTaskId);

    t.mock.method(aiConfigService, 'listConfigs', () => [openaiVideoConfig()]);
    const controller = new AbortController();
    let fetchStarted;
    const started = new Promise((resolve) => { fetchStarted = resolve; });
    const pending = videoClient.callVideoApi(null, createCapturingLogger(), {
      prompt: 'cancel-hang',
      drama_id: dramaId,
      video_gen_id: videoGenId,
      idempotency_key: `video-generation-${videoGenId}`,
      signal: controller.signal,
      provider_dns_lookup: providerDnsLookup,
      fetch_impl: (_url, options) => new Promise((_, reject) => {
        assert.equal(options.headers['Idempotency-Key'], `video-generation-${videoGenId}`);
        assert.notEqual(options.headers['Idempotency-Key'], `video-generation-${dramaId}`);
        fetchStarted();
        options.signal.addEventListener('abort', () => {
          const error = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
          reject(error);
        }, { once: true });
      }),
    });
    await started;
    controller.abort();
    await assert.rejects(
      pending,
      (error) => {
        assert.equal(isRequestCanceled(error), true);
        assert.equal(isRequestTimeout(error), false);
        assert.match(String(error.message), /取消/);
        assert.doesNotMatch(String(error.message), /timeout of|The operation was aborted/i);
        return true;
      }
    );
  });

  it('assembleVideoApiCall 透传 db，且不把项目 id 当成视频生成 id', async (t) => {
    const dramaId = 94033;
    const videoGenId = 84031;
    assert.notEqual(dramaId, videoGenId);
    const db = { marker: 'assembly-db-94033' };
    t.mock.method(aiConfigService, 'listConfigs', () => [openaiVideoConfig()]);
    const assembled = await assembleVideoApiCall(db, createCapturingLogger(), {
      prompt: 'scope',
      drama_id: dramaId,
      video_gen_id: videoGenId,
      provider_dns_lookup: providerDnsLookup,
    });
    assert.equal(assembled.db, db);
    assert.equal(assembled.video_gen_id, videoGenId);
    assert.notEqual(assembled.video_gen_id, dramaId);
    const dispatched = toVideoProtocolDispatchArgs(assembled);
    assert.equal(dispatched.db, db);
    assert.equal(dispatched.video_gen_id, videoGenId);
    assert.notEqual(dispatched.video_gen_id, dramaId);
  });

  it('可灵图生轮询 cancelled 视为取消，查询用厂商任务 id 而不是项目 id', async (t) => {
    const dramaId = 701;
    const imageGenId = 802;
    const providerTaskId = 'kling-img-903';
    assertDistinctIds(dramaId, imageGenId, providerTaskId);
    t.mock.method(uploadService, 'downloadBufferViaNodeHttp', async (url) => {
      assert.match(String(url), /kling-img-903/);
      assert.doesNotMatch(String(url), /701/);
      assert.doesNotMatch(String(url), /802/);
      return { buffer: Buffer.from(JSON.stringify({ data: { task_status: 'cancelled' } })) };
    });
    const klingOrigin = 'https://api.klingai.example';
    await imageRequestContext.run({
      networkOptions: {
        lookup: providerDnsLookup,
        trustedOrigins: [klingOrigin],
        allowPrivateOrigins: [],
        requireHttpsForPublic: true,
        fetchImpl: async () => new Response(JSON.stringify({
          code: 0,
          data: { task_id: providerTaskId },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      },
    }, async () => {
      await assert.rejects(
        callKlingImageApi(
          { base_url: klingOrigin, api_key: 'k', endpoint: '/v1/images/generations' },
          createCapturingLogger(),
          { prompt: 'night', image_gen_id: imageGenId, poll_interval_ms: 0 }
        ),
        (error) => isRequestCanceled(error) && /取消/.test(String(error.message)) && !/超时/.test(String(error.message))
      );
    });
  });

  it('NanoBanana 轮询 canceled 视为取消，不得落到超时成功', async (t) => {
    const dramaId = 711;
    const imageGenId = 812;
    const providerTaskId = 'nano-img-913';
    assertDistinctIds(dramaId, imageGenId, providerTaskId);
    t.mock.method(uploadService, 'downloadBufferViaNodeHttp', async (url) => {
      assert.match(String(url), /nano-img-913/);
      assert.doesNotMatch(String(url), /711|812/);
      return { buffer: Buffer.from(JSON.stringify({ data: { state: 'canceled' } })) };
    });
    const nanoOrigin = 'https://api.nanobanana.example';
    await imageRequestContext.run({
      networkOptions: {
        lookup: providerDnsLookup,
        trustedOrigins: [nanoOrigin],
        allowPrivateOrigins: [],
        requireHttpsForPublic: true,
        fetchImpl: async () => new Response(JSON.stringify({
          data: { taskId: providerTaskId },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      },
    }, async () => {
      await assert.rejects(
        callNanoBananaImageApi(
          { base_url: nanoOrigin, api_key: 'n' },
          createCapturingLogger(),
          { prompt: 'night', image_gen_id: imageGenId, poll_interval_ms: 0 }
        ),
        (error) => isRequestCanceled(error) && /取消/.test(String(error.message)) && !/超时/.test(String(error.message))
      );
    });
  });

  it('视频请求超时使用中文视频服务，不泄漏 Video', async () => {
    await assert.rejects(
      fetchVideoWithTimeout('https://video.example.com/v1/videos', {}, 20, {
        lookup: providerDnsLookup,
        trustedOrigins: ['https://video.example.com'],
        allowPrivateOrigins: [],
        requireHttpsForPublic: true,
        fetchImpl: (_url, options) => new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            const reason = options.signal.reason || Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
            reject(reason);
          }, { once: true });
        }),
      }),
      (error) => {
        assert.match(String(error.message), /视频服务/);
        assert.match(String(error.message), /超时/);
        assert.doesNotMatch(String(error.message), /\bVideo\b|video request|timed out/i);
        return true;
      }
    );
  });
});
