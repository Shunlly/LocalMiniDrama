const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const http = require('node:http');

const aiClient = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');

const originalListConfigs = aiConfigService.listConfigs;
const servers = [];

afterEach(async () => {
  aiConfigService.listConfigs = originalListConfigs;
  await Promise.all(servers.splice(0).map(async ({ server, sockets }) => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }));
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function startServer(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  servers.push({ server, sockets });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeDb() {
  return {
    prepare(sql) {
      assert.match(sql, /ai_model_map/);
      return { get: () => null };
    },
  };
}

function useLocalProvider(baseUrl) {
  aiConfigService.listConfigs = () => [{
    id: 1,
    name: '本地取消测试',
    service_type: 'text',
    provider: 'local_openai',
    base_url: `${baseUrl}/v1`,
    endpoint: '/chat/completions',
    api_key: '',
    model: ['cancel-test'],
    default_model: 'cancel-test',
    is_active: true,
    is_default: true,
    settings: JSON.stringify({ allow_local_http: true }),
  }];
}

const log = { info() {}, warn() {}, error() {} };
const localLookup = async () => [{ address: '127.0.0.1', family: 4 }];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function waitForResponseClose(res) {
  const closed = deferred();
  res.once('close', () => closed.resolve(!res.writableEnded));
  return closed.promise;
}

async function assertAbort(promise) {
  await assert.rejects(promise, (error) => error?.name === 'AbortError');
}

describe('AI HTTP 取消传播', () => {
  it('预取消时不执行 DNS 校验或建立请求', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('调用前已取消', 'AbortError'));
    let lookupCalls = 0;
    useLocalProvider('http://127.0.0.1:9');

    await assertAbort(aiClient.generateText(fakeDb(), log, 'text', '测试', '', {
      signal: controller.signal,
      provider_dns_lookup: async () => {
        lookupCalls += 1;
        return [{ address: '127.0.0.1', family: 4 }];
      },
    }));

    assert.equal(lookupCalls, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  for (const [label, invoke] of [
    ['generateText', (signal) => aiClient.generateText(fakeDb(), log, 'text', '测试', '', {
      signal,
      provider_dns_lookup: localLookup,
    })],
    ['streamGenerateText', (signal) => aiClient.streamGenerateText(fakeDb(), log, 'text', '测试', '', {
      signal,
      provider_dns_lookup: localLookup,
    }, () => {})],
  ]) {
    it(`${label} 取消时销毁真实 SSE 请求并移除监听`, async () => {
      const requestArrived = deferred();
      const requestClosed = deferred();
      const baseUrl = await startServer((_req, res) => {
        waitForResponseClose(res).then(requestClosed.resolve);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        requestArrived.resolve();
      });
      useLocalProvider(baseUrl);
      const controller = new AbortController();
      const pending = invoke(controller.signal);

      await requestArrived.promise;
      controller.abort(new DOMException('用户取消', 'AbortError'));

      await assertAbort(pending);
      assert.equal(await requestClosed.promise, true);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    });
  }

  it('generateTextWithVision 取消时销毁非流式 Provider 请求', async () => {
    const requestArrived = deferred();
    const requestClosed = deferred();
    const baseUrl = await startServer((_req, res) => {
      waitForResponseClose(res).then(requestClosed.resolve);
      requestArrived.resolve();
    });
    useLocalProvider(baseUrl);
    const controller = new AbortController();
    const pending = aiClient.generateTextWithVision(
      fakeDb(),
      log,
      'text',
      '描述图片',
      '',
      { imageUrl: `data:image/png;base64,${png.toString('base64')}` },
      { signal: controller.signal, provider_dns_lookup: localLookup },
    );

    await requestArrived.promise;
    controller.abort(new DOMException('用户取消', 'AbortError'));

    await assertAbort(pending);
    assert.equal(await requestClosed.promise, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  it('generateTextWithVision 在远程图片下载阶段传播取消且不请求 Provider', async () => {
    const imageRequestArrived = deferred();
    const imageRequestClosed = deferred();
    let providerCalls = 0;
    const baseUrl = await startServer((req, res) => {
      if (req.url === '/image.png') {
        waitForResponseClose(res).then(imageRequestClosed.resolve);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.flushHeaders();
        imageRequestArrived.resolve();
        return;
      }
      providerCalls += 1;
      res.writeHead(500);
      res.end();
    });
    useLocalProvider(baseUrl);
    const controller = new AbortController();
    const pending = aiClient.generateTextWithVision(
      fakeDb(),
      log,
      'text',
      '描述图片',
      '',
      { imageUrl: `${baseUrl}/image.png` },
      {
        signal: controller.signal,
        media_dns_lookup: localLookup,
        provider_dns_lookup: localLookup,
      },
    );

    await imageRequestArrived.promise;
    controller.abort(new DOMException('用户取消', 'AbortError'));

    await assertAbort(pending);
    assert.equal(await imageRequestClosed.promise, true);
    assert.equal(providerCalls, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  it('成功完成后移除取消监听且后续 abort 不改变结果', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n');
    });
    useLocalProvider(baseUrl);
    const controller = new AbortController();

    const result = await aiClient.generateText(fakeDb(), log, 'text', '测试', '', {
      signal: controller.signal,
      provider_dns_lookup: localLookup,
    });

    assert.equal(result, '完成');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    controller.abort(new DOMException('完成后取消', 'AbortError'));
    assert.equal(result, '完成');
  });
});
