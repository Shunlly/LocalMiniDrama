'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  classifyHttpFailure,
  createTimeoutController,
  describeProviderRequestError,
  isRequestCanceled,
  isRequestTimeout,
  normalizeProviderRequestError,
  operationCancelledError,
  shouldRetryRequest,
  withRequestRetry,
} = require('../src/services/imageGateway/requestError');
const videoRequestError = require('../src/services/videoGateway/requestError');
const {
  imageProviderException,
  isOperationCancelled,
} = require('../src/services/imageGateway/runtime');
const { fetchVideoWithTimeout } = require('../src/services/videoGateway/providerRuntime');
const { isPollTaskCancelled, isPollTaskFailed } = require('../src/services/videoGateway/helpers');
const { createSoraVideo, pollSoraVideo } = require('../src/services/videoGateway/openAiSoraAdapter');
const { pollMinimaxVideo } = require('../src/services/videoGateway/minimaxVideoAdapter');

const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const soraConfig = {
  provider: 'openai',
  api_protocol: 'sora',
  base_url: 'https://api.openai.example/v1',
  api_key: 'sora-test-key',
  endpoint: '/v1/videos',
  cancel_endpoint: '/v1/videos/{taskId}',
  provider_dns_lookup: providerDnsLookup,
};

describe('imageGateway/videoGateway 共用 requestError', () => {
  it('videoGateway 复用同一套 requestError，不另接真实厂商', () => {
    assert.equal(videoRequestError.isRequestCanceled, isRequestCanceled);
    assert.equal(videoRequestError.shouldRetryRequest, shouldRetryRequest);
  });

  it('超时不是取消，且可重试；取消不可重试', () => {
    const timeout = Object.assign(new Error('Image generation HTTP timeout after 15ms'), {
      name: 'AbortError',
      isTimeout: true,
      code: 'ETIMEDOUT',
    });
    assert.equal(isRequestTimeout(timeout), true);
    assert.equal(isRequestCanceled(timeout), false);
    assert.equal(shouldRetryRequest(timeout), true);
    assert.equal(isOperationCancelled(timeout), false);

    const canceled = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
      code: 'OPERATION_CANCELLED',
    });
    assert.equal(isRequestCanceled(canceled), true);
    assert.equal(isRequestTimeout(canceled), false);
    assert.equal(shouldRetryRequest(canceled), false);
    assert.equal(isOperationCancelled(canceled), true);
  });

  it('timeout abort 信号视为可重试超时而不是取消', async () => {
    const timeout = createTimeoutController(20);
    const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    try {
      await new Promise((_, reject) => {
        timeout.signal.addEventListener('abort', () => reject(abortError), { once: true });
      });
      assert.fail('应当超时');
    } catch (error) {
      assert.equal(timeout.didTimeout(), true);
      assert.equal(isRequestTimeout(error, timeout.signal), true);
      assert.equal(isRequestCanceled(error, timeout.signal), false);
      assert.equal(shouldRetryRequest(error, 1, timeout.signal), true);
      const classified = normalizeProviderRequestError(error, {
        signal: timeout.signal,
        provider: 'Kling',
        operation: 'image request',
      });
      assert.match(classified.message, /超时/);
      assert.doesNotMatch(classified.message, /timed out|timeout after/i);
      assert.equal(classified.retryable, true);
    } finally {
      timeout.dispose();
    }
  });

  it('withRequestRetry 超时会重试一次，取消不会重试', async () => {
    let timeoutAttempts = 0;
    const result = await withRequestRetry(async () => {
      timeoutAttempts += 1;
      if (timeoutAttempts === 1) {
        const error = new Error('timeout of 15000ms exceeded');
        error.code = 'ECONNABORTED';
        throw error;
      }
      return 'ok';
    }, { delayMs: 1 });
    assert.equal(result, 'ok');
    assert.equal(timeoutAttempts, 2);

    let canceledAttempts = 0;
    await assert.rejects(withRequestRetry(async () => {
      canceledAttempts += 1;
      throw operationCancelledError('用户取消');
    }, { delayMs: 1 }), (error) => isRequestCanceled(error));
    assert.equal(canceledAttempts, 1);
  });

  it('HTTP 失败对用户返回中文，并保留 status/code/bytes', () => {
    const error = classifyHttpFailure({
      provider: 'Kling',
      operation: 'image request',
      status: 401,
      code: 'AUTH_DENIED',
      responseBody: JSON.stringify({ code: 'AUTH_DENIED', error: 'Bearer sk-provider-secret' }),
    });
    assert.match(error.message, /HTTP 401/);
    assert.match(error.message, /AUTH_DENIED/);
    assert.match(error.message, /response_bytes=/);
    assert.match(error.message, /认证失败/);
    assert.doesNotMatch(error.message, /authentication rejected|sk-provider-secret/);
    assert.equal(shouldRetryRequest(error), false);
  });
});

describe('Gateway 取消不记失败、超时可重试，且 dramaId 与 jobId 不相等', () => {
  it('取消抛出后不记入失败列表，且不把 dramaId 当成 jobId', async () => {
    const dramaId = 101;
    const jobId = 202;
    const providerTaskId = 'sora_job_303';
    assert.notEqual(dramaId, jobId);
    assert.notEqual(String(dramaId), providerTaskId);
    assert.notEqual(String(jobId), providerTaskId);

    const failures = [];
    const controller = new AbortController();
    controller.abort(operationCancelledError('本地任务已取消'));
    try {
      await createSoraVideo(soraConfig, { prompt: 'cancel-record', duration: 4 }, {
        signal: controller.signal,
        fetch: async () => {
          throw new Error('取消后不应再访问厂商');
        },
      });
      failures.push({ dramaId, jobId, error: 'completed' });
    } catch (error) {
      if (!isRequestCanceled(error)) {
        failures.push({ dramaId, jobId, error: error.message });
      }
    }
    assert.deepEqual(failures, []);
    assert.match(describeProviderRequestError(operationCancelledError('本地任务已取消')), /取消/);
  });

  it('Sora 轮询 cancelled 不记成 unknown 失败，查询用 jobId 而不是 dramaId', async () => {
    const dramaId = 101;
    const jobId = 202;
    const providerTaskId = 'sora_job_303';
    assert.notEqual(dramaId, jobId);
    const failures = [];
    try {
      await pollSoraVideo(soraConfig, providerTaskId, {
        fetch: async (url) => {
          assert.match(String(url), /sora_job_303/);
          assert.doesNotMatch(String(url), /101/);
          assert.doesNotMatch(String(url), /202/);
          return new Response(JSON.stringify({ status: 'cancelled' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      });
      failures.push({ dramaId, jobId, error: 'unknown' });
    } catch (error) {
      assert.equal(isRequestCanceled(error), true);
      assert.doesNotMatch(String(error.message), /unknown/i);
      if (!isRequestCanceled(error)) {
        failures.push({ dramaId, jobId, error: error.message });
      }
    }
    assert.deepEqual(failures, []);
  });

  it('Sora 有幂等键时超时会重试，且不把 dramaId 当成远端 jobId', async () => {
    const dramaId = 101;
    const jobId = 202;
    const providerTaskId = 'sora_job_404';
    assert.notEqual(dramaId, jobId);
    let calls = 0;
    const result = await createSoraVideo(soraConfig, { prompt: 'timeout-retry', duration: 4 }, {
      idempotency_key: `video-generation-${jobId}`,
      fetch: async (_url, options) => {
        calls += 1;
        assert.equal(options.headers['Idempotency-Key'], `video-generation-${jobId}`);
        assert.notEqual(options.headers['Idempotency-Key'], `video-generation-${dramaId}`);
        if (calls === 1) {
          const error = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
          error.cause = Object.assign(new Error('请求超时'), { isTimeout: true, code: 'ETIMEDOUT' });
          throw error;
        }
        return new Response(JSON.stringify({ id: providerTaskId, status: 'queued' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(result, { status: 'queued', task_id: providerTaskId });
    assert.notEqual(result.task_id, String(dramaId));
    assert.notEqual(result.task_id, String(jobId));
  });

  it('MiniMax 轮询 cancelled 不返回 unknown 失败', async () => {
    const config = {
      provider: 'minimax',
      api_protocol: 'minimax',
      base_url: 'https://api.minimax.example',
      api_key: 'minimax-test-key',
      endpoint: '/video_generation',
      query_endpoint: '/query/video_generation?task_id=',
      provider_dns_lookup: providerDnsLookup,
    };
    await assert.rejects(
      pollMinimaxVideo(config, 'minimax_job_9', {
        fetch: async (url) => {
          assert.match(String(url), /minimax_job_9/);
          return new Response(JSON.stringify({ status: 'cancelled' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
      (error) => isRequestCanceled(error) && !/unknown/i.test(String(error.message))
    );
  });

  it('视频请求超时报中文且可重试，而不是取消', async () => {
    await assert.rejects(
      fetchVideoWithTimeout('https://video.example.com/hang', {}, 20, {
        fetchImpl: (_url, options) => new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
            reject(error);
          }, { once: true });
        }),
        lookup: providerDnsLookup,
        trustedOrigins: ['https://video.example.com'],
        allowPrivateOrigins: [],
        requireHttpsForPublic: true,
      }),
      (error) => {
        assert.equal(isRequestTimeout(error), true);
        assert.equal(isRequestCanceled(error), false);
        assert.equal(shouldRetryRequest(error), true);
        assert.match(String(error.message), /超时/);
        assert.doesNotMatch(String(error.message), /timed out after/i);
        return true;
      }
    );
  });

  it('imageProviderException 把取消继续抛出，不包装成失败', () => {
    const canceled = operationCancelledError('用户取消');
    assert.throws(
      () => imageProviderException(canceled, 'Kling', 'image request'),
      (error) => isRequestCanceled(error) && error.code === 'OPERATION_CANCELLED'
    );
    const timeout = Object.assign(new Error('Image generation HTTP timeout after 10ms'), { name: 'AbortError' });
    assert.throws(
      () => imageProviderException(timeout, 'Kling', 'image request'),
      (error) => isRequestTimeout(error) && error.retryable === true && /超时/.test(error.message)
    );
  });

  it('轮询状态 cancelled 仍走失败分支入口，但分类为取消而不是 unknown', () => {
    assert.equal(isPollTaskCancelled('cancelled'), true);
    assert.equal(isPollTaskCancelled('failed'), false);
    assert.equal(isPollTaskFailed('cancelled'), true);
    assert.equal(isPollTaskFailed('failed'), true);
  });
});

describe('Gateway 用户可见错误为简体中文', () => {
  it('参考图越界错误不再使用英文', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/imageGateway/referenceUtils.js'), 'utf8');
    assert.match(src, /参考图超过大小限制/);
    assert.doesNotMatch(src, /Image reference exceeds the size limit/);
  });

  it('Sora/MiniMax 不再把失败写成 unknown status', () => {
    const sora = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/openAiSoraAdapter.js'), 'utf8');
    const minimax = fs.readFileSync(path.join(__dirname, '../src/services/videoGateway/minimaxVideoAdapter.js'), 'utf8');
    assert.doesNotMatch(sora, /returned an unknown status/);
    assert.doesNotMatch(minimax, /returned an unknown status/);
    assert.match(sora, /无法识别的状态/);
    assert.match(minimax, /无法识别的状态/);
  });
});
