'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMinimaxVideo,
  pollMinimaxVideo,
} = require('../src/services/videoGateway/minimaxVideoAdapter');

const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const config = {
  provider: 'minimax',
  api_protocol: 'minimax',
  base_url: 'https://api.minimax.example/v1',
  api_key: 'minimax-test-key',
  cancel_endpoint: '/video_generation/{taskId}',
  provider_dns_lookup: providerDnsLookup,
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('MiniMax 在创建响应晚到时等待 task id，且并发取消只发送一次 DELETE', async () => {
  const postResponse = deferred();
  const postStarted = deferred();
  const calls = [];
  let remoteCancel;
  const controller = new AbortController();

  const creation = createMinimaxVideo(config, { prompt: 'race' }, {
    signal: controller.signal,
    register_remote_cancel: (callback) => { remoteCancel = callback; },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      if (options.method === 'POST') {
        assert.notEqual(options.signal, controller.signal);
        options.signal.addEventListener('abort', () => {
          throw new Error('创建请求不应被调用方取消提前截断');
        }, { once: true });
        postStarted.resolve();
        return postResponse.promise;
      }
      return new Response(JSON.stringify({ status: 'cancelled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await postStarted.promise;
  assert.equal(typeof remoteCancel, 'function');
  controller.abort(new DOMException('本地任务已取消', 'AbortError'));
  const firstCancel = remoteCancel();
  const secondCancel = remoteCancel();
  await Promise.resolve();
  assert.deepEqual(calls.map(({ method }) => method), ['POST']);

  postResponse.resolve(new Response(JSON.stringify({
    task_id: 'minimax_late_task',
    status: 'submitted',
    base_resp: { status_code: 0 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  await assert.rejects(creation, (error) => error?.name === 'AbortError');
  assert.deepEqual(await firstCancel, { confirmed: true });
  assert.deepEqual(await secondCancel, { confirmed: true });
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
  assert.equal(calls[1].url, 'https://api.minimax.example/v1/video_generation/minimax_late_task');
});

test('MiniMax 取消只确认明确 cancelled/deleted 语义', async () => {
  const cases = [
    [{ success: true, status: 'completed' }, false],
    [{ success: true, status: 'success' }, false],
    [{ success: true }, false],
    [{ status: 'cancelled' }, true],
    [{ status: 'deleted' }, true],
    [{ deleted: true }, true],
  ];

  for (const [payload, confirmed] of cases) {
    let remoteCancel;
    await createMinimaxVideo(config, { prompt: 'cancel semantics' }, {
      register_remote_cancel: (callback) => { remoteCancel = callback; },
      fetch: async (_url, options) => new Response(JSON.stringify(
        options.method === 'POST'
          ? { task_id: 'minimax_cancel_task', status: 'processing', base_resp: { status_code: 0 } }
          : payload
      ), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.deepEqual(await remoteCancel(), { confirmed }, JSON.stringify(payload));
  }
});

test('MiniMax 创建与轮询保持兼容的任务和视频结果', async () => {
  const created = await createMinimaxVideo(config, {
    model: 'MiniMax-Hailuo-2.3',
    prompt: 'create',
    duration: 6,
    image_url: 'https://media.example/frame.jpg',
  }, {
    fetch: async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.ok(options.signal === undefined || options.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(options.body), {
        model: 'MiniMax-Hailuo-2.3',
        prompt: 'create',
        duration: 6,
        first_frame_image: 'https://media.example/frame.jpg',
      });
      return new Response(JSON.stringify({
        task_id: 'minimax_task_1',
        status: 'processing',
        base_resp: { status_code: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(created, { status: 'processing', task_id: 'minimax_task_1' });

  const completed = await pollMinimaxVideo(config, 'minimax_task_1', {
    fetch: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(url, 'https://api.minimax.example/v1/query/video_generation?task_id=minimax_task_1');
      return new Response(JSON.stringify({
        status: 'completed',
        video_url: 'https://media.example/minimax.mp4',
        base_resp: { status_code: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(completed, {
    status: 'completed',
    video_url: 'https://media.example/minimax.mp4',
  });
});

test('MiniMax 在 POST 失败且没有 task id 时取消不会发送 DELETE', async () => {
  let remoteCancel;
  let deleteCalls = 0;
  await assert.rejects(
    createMinimaxVideo(config, { prompt: 'failure' }, {
      register_remote_cancel: (callback) => { remoteCancel = callback; },
      fetch: async (_url, options) => {
        if (options.method === 'DELETE') deleteCalls += 1;
        return new Response('failed', { status: 500 });
      },
    }),
    /HTTP 500/
  );
  assert.deepEqual(await remoteCancel(), { confirmed: false });
  assert.equal(deleteCalls, 0);
});
