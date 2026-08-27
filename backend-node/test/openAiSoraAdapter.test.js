'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createSoraVideo,
  pollSoraVideo,
} = require('../src/services/videoGateway/openAiSoraAdapter');

const providerDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const config = {
  provider: 'openai',
  api_protocol: 'sora',
  base_url: 'https://api.openai.example/v1',
  api_key: 'sora-test-key',
  endpoint: '/v1/videos',
  cancel_endpoint: '/v1/videos/{taskId}',
  provider_dns_lookup: providerDnsLookup,
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('Sora 在创建响应晚到时等待 task id，且并发取消只发送一次 DELETE', async () => {
  const postResponse = deferred();
  const postStarted = deferred();
  const calls = [];
  let remoteCancel;
  const controller = new AbortController();

  const creation = createSoraVideo(config, { prompt: 'race', duration: 4 }, {
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
      return new Response(JSON.stringify({ status: 'deleted' }), {
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
    id: 'video_late_task',
    status: 'queued',
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  await assert.rejects(creation, (error) => error?.name === 'AbortError');
  assert.deepEqual(await firstCancel, { confirmed: true });
  assert.deepEqual(await secondCancel, { confirmed: true });
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
  assert.equal(calls[1].url, 'https://api.openai.example/v1/videos/video_late_task');
});

test('Sora 取消只确认明确 cancelled/deleted 语义', async () => {
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
    await createSoraVideo(config, { prompt: 'cancel semantics', duration: 4 }, {
      register_remote_cancel: (callback) => { remoteCancel = callback; },
      fetch: async (_url, options) => new Response(JSON.stringify(
        options.method === 'POST'
          ? { id: 'video_cancel_task', status: 'processing' }
          : payload
      ), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.deepEqual(await remoteCancel(), { confirmed }, JSON.stringify(payload));
  }
});

test('Sora 创建与轮询保持兼容的任务和视频结果', async () => {
  const created = await createSoraVideo(config, {
    model: 'sora-2',
    prompt: 'create',
    duration: 8,
    size: '1280x720',
  }, {
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.example/v1/videos');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('model'), 'sora-2');
      assert.equal(options.body.get('prompt'), 'create');
      assert.equal(options.body.get('seconds'), '8');
      assert.equal(options.body.get('size'), '1280x720');
      return new Response(JSON.stringify({ id: 'video_task_1', status: 'processing' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(created, { status: 'processing', task_id: 'video_task_1' });

  const completed = await pollSoraVideo(config, 'video_task_1', {
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.openai.example/v1/videos/video_task_1');
      assert.equal(options.method, 'GET');
      return new Response(JSON.stringify({
        status: 'completed',
        output: { video_url: 'https://media.example/sora.mp4' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(completed, {
    status: 'completed',
    video_url: 'https://media.example/sora.mp4',
  });
});

test('Sora 在 POST 失败且没有 task id 时取消不会发送 DELETE', async () => {
  let remoteCancel;
  let deleteCalls = 0;
  await assert.rejects(
    createSoraVideo(config, { prompt: 'failure', duration: 4 }, {
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

test('Sora 明确 204 删除响应确认取消', async () => {
  let remoteCancel;
  await createSoraVideo(config, { prompt: '204', duration: 4 }, {
    register_remote_cancel: (callback) => { remoteCancel = callback; },
    fetch: async (_url, options) => options.method === 'POST'
      ? new Response(JSON.stringify({ id: 'video_204_task', status: 'queued' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      : new Response(null, { status: 204 }),
  });
  assert.deepEqual(await remoteCancel(), { confirmed: true });
});

test('Sora 仅在有幂等键时重试瞬态创建错误', async () => {
  let idempotentCalls = 0;
  const recovered = await createSoraVideo(config, { prompt: 'retry', duration: 4 }, {
    idempotency_key: 'video-generation-42',
    fetch: async (_url, options) => {
      idempotentCalls += 1;
      assert.equal(options.headers['Idempotency-Key'], 'video-generation-42');
      if (idempotentCalls < 3) {
        return new Response('', { status: 503, headers: { 'retry-after': '0' } });
      }
      return new Response(JSON.stringify({ id: 'video_retry_task', status: 'queued' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(idempotentCalls, 3);
  assert.deepEqual(recovered, { status: 'queued', task_id: 'video_retry_task' });

  let unsafeCalls = 0;
  await assert.rejects(createSoraVideo(config, { prompt: 'no retry', duration: 4 }, {
    fetch: async () => {
      unsafeCalls += 1;
      return new Response('', { status: 503 });
    },
  }), /HTTP 503/);
  assert.equal(unsafeCalls, 1);
});

test('Sora 有幂等键时重试网络错误和无效 JSON，并为每次调用重建 FormData', async () => {
  const bodies = [];
  let calls = 0;
  const result = await createSoraVideo(config, {
    prompt: 'transport retry',
    input_reference: {
      buffer: Buffer.from([4, 5, 6]),
      mimeType: 'image/png',
      filename: 'retry.png',
    },
  }, {
    idempotency_key: 'transport-retry-1',
    fetch: async (_url, options) => {
      calls += 1;
      bodies.push(options.body);
      assert.equal(options.body.get('prompt'), 'transport retry');
      assert.ok(options.body.get('input_reference') instanceof Blob);
      if (calls === 1) {
        const error = new Error('connection reset');
        error.code = 'ECONNRESET';
        throw error;
      }
      if (calls === 2) {
        return new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'video_transport_retry', status: 'queued' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(calls, 3);
  assert.equal(new Set(bodies).size, 3);
  assert.deepEqual(result, { status: 'queued', task_id: 'video_transport_retry' });
});

test('Sora 轮询把瞬态 HTTP 错误保持为可继续轮询状态', async () => {
  for (const status of [408, 429, 503]) {
    const result = await pollSoraVideo(config, 'video_transient_task', {
      fetch: async () => new Response('', { status }),
    });
    assert.deepEqual(result, {
      status: 'pending',
      task_id: 'video_transient_task',
      retryable: true,
    });
  }
});

test('Sora 通过真实 HTTP 发送完整 multipart 文件和字段', async (t) => {
  let captured;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    captured = {
      method: req.method,
      authorization: req.headers.authorization,
      idempotency: req.headers['idempotency-key'],
      contentType: req.headers['content-type'],
      contentLength: Number(req.headers['content-length']),
      body: Buffer.concat(chunks),
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'video_multipart_task', status: 'queued' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const image = Buffer.from([0, 1, 2, 3, 255]);
  const result = await createSoraVideo({
    ...config,
    provider: 'openai_compatible',
    settings: JSON.stringify({ allow_local_http: true }),
    base_url: origin,
    endpoint: '/v1/videos',
  }, {
    model: 'sora-2',
    prompt: 'multipart evidence',
    duration: 4,
    size: '1280x720',
    input_reference: { buffer: image, mimeType: 'image/png', filename: 'reference.png' },
  }, {
    idempotency_key: 'multipart-1',
  });
  assert.deepEqual(result, { status: 'queued', task_id: 'video_multipart_task' });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.authorization, 'Bearer sora-test-key');
  assert.equal(captured.idempotency, 'multipart-1');
  assert.ok(captured.contentType.startsWith('multipart/form-data; boundary='));
  assert.equal(captured.contentLength, captured.body.length);
  const latin1 = captured.body.toString('latin1');
  assert.ok(latin1.includes('name="model"\r\n\r\nsora-2'));
  assert.ok(latin1.includes('name="size"\r\n\r\n1280x720'));
  assert.ok(latin1.includes('name="input_reference"; filename="reference.png"'));
  assert.ok(latin1.toLowerCase().includes('content-type: image/png'));
  assert.ok(captured.body.includes(image));
});
