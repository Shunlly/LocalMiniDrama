const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  fetchWithLimits,
  generateComfyUiImage,
  replaceWorkflowPlaceholders,
} = require('../src/services/comfyUiClient');

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function startServer(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  });
  res.end(data);
}

function workflowSettings(overrides = {}) {
  return {
    workflow: {
      1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
      2: { class_type: 'LoadImage', inputs: { image: '{{reference_image_1}}' } },
      3: {
        class_type: 'KSampler',
        inputs: {
          width: '{{width}}',
          height: '${height}',
          seed: '__SEED__',
          model_name: '{{model}}',
        },
      },
    },
    poll_interval_ms: 5,
    request_timeout_ms: 1000,
    ...overrides,
  };
}

function localNetworkPolicy(baseUrl) {
  return {
    trustedOrigins: [baseUrl],
    allowPrivateOrigins: [baseUrl],
    requireHttpsForPublic: true,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  };
}

describe('ComfyUI production protocol', () => {
  it('uploads references, submits a replaced workflow, polls history, and downloads /view output', async () => {
    const state = { historyCalls: 0, uploaded: null, submitted: null, submitKey: null, viewQuery: null };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const baseUrl = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake.local');
      if (req.method === 'POST' && url.pathname === '/upload/image') {
        state.uploaded = {
          contentType: req.headers['content-type'],
          body: (await readBody(req)).toString('latin1'),
        };
        return json(res, 200, { name: 'uploaded-ref.png', subfolder: 'localmini', type: 'input' });
      }
      if (req.method === 'POST' && url.pathname === '/prompt') {
        state.submitted = JSON.parse((await readBody(req)).toString('utf8'));
        state.submitKey = req.headers['idempotency-key'];
        assert.equal(req.headers.authorization, 'Bearer local-comfy-secret');
        return json(res, 200, { prompt_id: 'prompt-123', number: 1, node_errors: {} });
      }
      if (req.method === 'GET' && url.pathname === '/history/prompt-123') {
        state.historyCalls += 1;
        if (state.historyCalls === 1) return json(res, 200, {});
        return json(res, 200, {
          'prompt-123': {
            status: { status_str: 'success', completed: true },
            outputs: {
              9: { images: [{ filename: 'final image.png', subfolder: 'renders/day 1', type: 'output' }] },
            },
          },
        });
      }
      if (req.method === 'GET' && url.pathname === '/view') {
        state.viewQuery = Object.fromEntries(url.searchParams);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
        return res.end(png);
      }
      return json(res, 404, { error: 'not found' });
    });

    const result = await generateComfyUiImage({
      base_url: baseUrl,
      api_key: 'local-comfy-secret',
      endpoint: '/prompt',
      query_endpoint: '/history/{promptId}',
      default_model: 'dream-checkpoint.safetensors',
      settings: workflowSettings(),
    }, null, {
      prompt: 'rainy neon street',
      model: 'dream-checkpoint.safetensors',
      size: '768x1024',
      seed: 42,
      reference_image_urls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'],
      idempotency_key: 'workflow:test:comfyui:image',
      provider_network_policy: localNetworkPolicy(baseUrl),
    });

    assert.match(state.uploaded.contentType, /^multipart\/form-data; boundary=/);
    assert.match(state.uploaded.body, /name="image"; filename="reference-[a-f0-9]{8}\.png"/);
    assert.match(state.uploaded.body, /name="type"/);
    assert.equal(state.submitted.prompt['1'].inputs.text, 'rainy neon street');
    assert.equal(state.submitted.prompt['2'].inputs.image, 'localmini/uploaded-ref.png');
    assert.equal(state.submitted.prompt['3'].inputs.width, 768);
    assert.equal(state.submitted.prompt['3'].inputs.height, 1024);
    assert.equal(state.submitted.prompt['3'].inputs.seed, 42);
    assert.equal(state.submitted.prompt['3'].inputs.model_name, 'dream-checkpoint.safetensors');
    assert.match(state.submitted.client_id, /^localminidrama-/);
    assert.equal(state.submitKey, 'workflow:test:comfyui:image');
    assert.equal(state.historyCalls, 2);
    assert.deepEqual(state.viewQuery, {
      filename: 'final image.png',
      subfolder: 'renders/day 1',
      type: 'output',
    });
    assert.equal(result.prompt_id, 'prompt-123');
    assert.equal(result.image_url, `data:image/png;base64,${png.toString('base64')}`);
  });

  it('cancels the queued prompt after a total timeout', async () => {
    const cancelled = { queue: null, interrupts: 0 };
    const baseUrl = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake.local');
      if (req.method === 'POST' && url.pathname === '/prompt') {
        await readBody(req);
        return json(res, 200, { prompt_id: 'slow-prompt' });
      }
      if (req.method === 'GET' && url.pathname === '/history/slow-prompt') return json(res, 200, {});
      if (req.method === 'POST' && url.pathname === '/queue') {
        cancelled.queue = JSON.parse((await readBody(req)).toString('utf8'));
        return json(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/interrupt') {
        cancelled.interrupts += 1;
        await readBody(req);
        return json(res, 200, {});
      }
      return json(res, 404, {});
    });

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        settings: workflowSettings({ workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } } }),
      }, null, {
        prompt: 'slow',
        timeout_ms: 30,
        poll_interval_ms: 5,
        provider_network_policy: localNetworkPolicy(baseUrl),
      }),
      (error) => error.code === 'COMFYUI_TIMEOUT' && /超时/.test(error.message)
    );
    assert.deepEqual(cancelled.queue, { delete: ['slow-prompt'] });
    assert.equal(cancelled.interrupts, 1);
  });

  it('honors AbortSignal cancellation and removes the ComfyUI prompt', async () => {
    let queueDeletes = 0;
    const baseUrl = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake.local');
      if (req.method === 'POST' && url.pathname === '/prompt') {
        await readBody(req);
        return json(res, 200, { prompt_id: 'cancel-me' });
      }
      if (req.method === 'GET' && url.pathname === '/history/cancel-me') return json(res, 200, {});
      if (req.method === 'POST' && url.pathname === '/queue') {
        queueDeletes += 1;
        await readBody(req);
        return json(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/interrupt') {
        await readBody(req);
        return json(res, 200, {});
      }
      return json(res, 404, {});
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        settings: workflowSettings({ workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } } }),
      }, null, {
        prompt: 'cancel',
        signal: controller.signal,
        poll_interval_ms: 5,
        provider_network_policy: localNetworkPolicy(baseUrl),
      }),
      (error) => error.code === 'COMFYUI_CANCELLED' && /已取消/.test(error.message)
    );
    assert.equal(queueDeletes, 1);
  });

  it('redacts provider secrets and signed query strings from errors', async () => {
    const secret = 'sk-comfy-super-secret';
    const baseUrl = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake.local');
      if (req.method === 'POST' && url.pathname === '/prompt') {
        await readBody(req);
        return json(res, 500, {
          error: { message: `upstream rejected Bearer ${secret} at https://vendor.invalid/run?token=${secret}` },
        });
      }
      return json(res, 404, {});
    });

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        api_key: secret,
        settings: workflowSettings({ workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } } }),
      }, null, { prompt: 'error', provider_network_policy: localNetworkPolicy(baseUrl) }),
      (error) => {
        assert.match(error.message, /HTTP 500/);
        assert.doesNotMatch(error.message, /sk-comfy-super-secret/);
        assert.doesNotMatch(error.message, /\?token=/);
        return true;
      }
    );
  });

  it('redacts credential-bearing custom headers without hiding token budgets', async () => {
    const secretHeaders = {
      'X-Client-Credential': 'synthetic-client-credential',
      'X-Service-Password': 'synthetic-service-password',
      'X-Request-Signature': 'synthetic-request-signature',
      'X-Access-Key': 'synthetic-access-key',
    };
    const baseUrl = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        await readBody(req);
        return json(res, 500, {
          error: {
            message: `provider echoed ${Object.values(secretHeaders).join(' ')}; token_budget=4096`,
          },
        });
      }
      return json(res, 404, {});
    });

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        settings: workflowSettings({
          headers: {
            ...secretHeaders,
            'X-Token-Budget': '4096',
          },
          workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } },
        }),
      }, null, { prompt: 'error', provider_network_policy: localNetworkPolicy(baseUrl) }),
      (error) => {
        for (const secret of Object.values(secretHeaders)) {
          assert.doesNotMatch(error.message, new RegExp(secret));
        }
        assert.match(error.message, /token_budget=4096/);
        return true;
      }
    );
  });

  it('treats signature token metrics as secrets when providers echo them', async () => {
    const signatureHeaders = {
      'X-Signature-Token-Usage': 'synthetic-signature-usage-secret',
      'X-Sig-Token-Count': 'synthetic-sig-count-secret',
    };
    const baseUrl = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/prompt') {
        await readBody(req);
        return json(res, 500, {
          error: {
            message: `provider echoed ${Object.values(signatureHeaders).join(' ')}`,
          },
        });
      }
      return json(res, 404, {});
    });

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        settings: workflowSettings({
          headers: signatureHeaders,
          workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } },
        }),
      }, null, { prompt: 'error', provider_network_policy: localNetworkPolicy(baseUrl) }),
      (error) => {
        for (const secret of Object.values(signatureHeaders)) {
          assert.doesNotMatch(error.message, new RegExp(secret));
        }
        return true;
      }
    );
  });

  it('normalizes custom secret headers once and redacts every nonempty transmitted value', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, headers: options.headers });
      const received = Object.fromEntries(new Headers(options.headers).entries());
      return new Response(JSON.stringify({
        error: {
          message: `provider echoed [${received['x-short-secret']}] [${received['x-padded-credential']}]`,
        },
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const baseUrl = 'https://comfy.example';

    await assert.rejects(
      generateComfyUiImage({
        base_url: baseUrl,
        settings: workflowSettings({
          headers: {
            'X-Short-Secret': ' Q ',
            'X-Padded-Credential': ' padded-value ',
          },
          workflow: { 1: { class_type: 'EmptyLatentImage', inputs: {} } },
        }),
      }, null, {
        prompt: 'error',
        fetch_impl: fetchImpl,
        provider_network_policy: {
          trustedOrigins: [baseUrl],
          allowPrivateOrigins: [],
          requireHttpsForPublic: true,
          lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        },
      }),
      (error) => {
        assert.doesNotMatch(error.message, /\[Q\]/);
        assert.doesNotMatch(error.message, /padded-value/);
        return true;
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['X-Short-Secret'], 'Q');
    assert.equal(calls[0].headers['X-Padded-Credential'], 'padded-value');
  });
});

it('injected ComfyUI redirects strip credentials when the origin changes', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(options.headers).entries()) });
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://cdn.example/output' },
      });
    }
    return new Response('ok', { status: 200 });
  };

  const response = await fetchWithLimits('https://comfy.example/view', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer synthetic-token',
      Cookie: 'session=synthetic-token',
      'X-Api-Key': 'synthetic-token',
      'X-Request-Sig': 'synthetic-request-signature',
      'X-Session-Cookie': 'synthetic-session-cookie',
      'X-Trace-Id': 'trace-123',
    },
  }, {
    fetchImpl,
    useSecureFetch: false,
    deadline: Date.now() + 5000,
    requestTimeoutMs: 5000,
    maxResponseBytes: 1024,
    secrets: [],
    trustedOrigins: ['https://comfy.example', 'https://cdn.example'],
    allowPrivateOrigins: [],
    networkLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    requireHttpsForPublic: true,
  });

  assert.equal(await response.text(), 'ok');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.authorization, undefined);
  assert.equal(calls[1].headers.cookie, undefined);
  assert.equal(calls[1].headers['x-api-key'], undefined);
  assert.equal(calls[1].headers['x-request-sig'], undefined);
  assert.equal(calls[1].headers['x-session-cookie'], undefined);
  assert.equal(calls[1].headers['x-trace-id'], 'trace-123');
});

it('workflow replacement preserves exact placeholder value types', () => {
  const workflow = replaceWorkflowPlaceholders({
    string: 'prefix {{prompt}} suffix',
    number: '{{width}}',
    array: '${reference_images}',
    optional: '{{reference_image_9}}',
  }, {
    prompt: 'scene',
    width: 640,
    reference_images: ['one.png', 'two.png'],
  });
  assert.deepEqual(workflow, {
    string: 'prefix scene suffix',
    number: 640,
    array: ['one.png', 'two.png'],
    optional: '',
  });
});
