const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');

const aiClient = require('../src/services/aiClient');
const aiConfigService = require('../src/services/aiConfigService');
const imageClient = require('../src/services/imageClient');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  createProviderHttpError,
  createSafeProviderLogger,
} = require('../src/services/providerErrorSanitizer');

const PRIVATE_PROMPT = 'private-prompt-regression-7f09b4';
const PROVIDER_BEARER = 'Bearer sk-provider-secret-123456';
const REQUEST_SECRET = 'sk-request-secret-654321';
const SIGNED_URL = 'https://cdn.example.com/output.png?X-Amz-Signature=signed-url-secret';
const LEAK_PATTERN = /private-prompt-regression-7f09b4|sk-provider-secret-123456|sk-request-secret-654321|signed-url-secret/i;

function createCapturingLogger() {
  const entries = [];
  const logger = { entries };
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return logger;
}

function providerPayload() {
  return JSON.stringify({
    code: 'AUTH_DENIED',
    error: {
      code: 'AUTH_DENIED',
      message: `${PROVIDER_BEARER}; rejected prompt ${PRIVATE_PROMPT}`,
    },
    prompt: PRIVATE_PROMPT,
    output_url: SIGNED_URL,
  });
}

async function startServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function providerConfig(serviceType, baseUrl) {
  return {
    id: 1,
    service_type: serviceType,
    provider: 'openai_compatible',
    api_protocol: 'openai',
    name: 'privacy fixture',
    base_url: baseUrl,
    api_key: REQUEST_SECRET,
    model: [`privacy-${serviceType}-model`],
    default_model: `privacy-${serviceType}-model`,
    endpoint: serviceType === 'text' ? '/chat/completions' : '/images/generations',
    is_active: true,
    is_default: true,
    settings: JSON.stringify({ allow_local_http: true }),
  };
}

async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for provider privacy fixture');
}

describe('provider error sanitizer', () => {
  it('redacts arbitrary custom logger arguments while preserving counts', () => {
    const target = createCapturingLogger();
    const log = createSafeProviderLogger(target);
    log.info('provider failure', {
      Authorization: PROVIDER_BEARER,
      prompt: PRIVATE_PROMPT,
      result_count: 3,
      url: SIGNED_URL,
      raw_response: providerPayload(),
    });

    const serialized = JSON.stringify(target.entries);
    assert.doesNotMatch(serialized, LEAK_PATTERN);
    assert.match(serialized, /REDACTED/);
    assert.match(serialized, /AUTH_DENIED/);
    assert.match(serialized, /"result_count":3/);
  });

  it('uses a generic malformed-response error without appending raw text', () => {
    const malformed = `${PROVIDER_BEARER} ${PRIVATE_PROMPT} ${SIGNED_URL}`;
    const error = createProviderHttpError({
      provider: 'Fixture',
      operation: 'request',
      status: 502,
      responseBody: malformed,
    });

    assert.match(error.message, /HTTP 502/);
    assert.match(error.message, /response_bytes=/);
    assert.match(error.message, /temporarily unavailable/);
    assert.doesNotMatch(error.message, LEAK_PATTERN);
  });
});

describe('text and image provider boundaries', () => {
  it('keeps the text protocol request intact but sanitizes the thrown provider error', async (t) => {
    let received;
    const baseUrl = await startServer(t, async (request, response) => {
      received = {
        authorization: request.headers.authorization,
        body: await readJsonBody(request),
      };
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(providerPayload());
    });
    const originalListConfigs = aiConfigService.listConfigs;
    aiConfigService.listConfigs = () => [providerConfig('text', baseUrl)];
    t.after(() => { aiConfigService.listConfigs = originalListConfigs; });
    const log = createCapturingLogger();

    let error;
    try {
      await aiClient.generateText({}, log, 'text', PRIVATE_PROMPT, 'private system prompt');
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.equal(received.authorization, `Bearer ${REQUEST_SECRET}`);
    assert.equal(received.body.messages[1].content, PRIVATE_PROMPT);
    assert.match(error.message, /HTTP 401/);
    assert.match(error.message, /AUTH_DENIED/);
    assert.match(error.message, /response_bytes=/);
    assert.doesNotMatch(error.message, LEAK_PATTERN);
    assert.doesNotMatch(JSON.stringify(log.entries), LEAK_PATTERN);
  });

  it('keeps the image protocol request intact but sanitizes return error and logs', async (t) => {
    let received;
    const baseUrl = await startServer(t, async (request, response) => {
      received = {
        authorization: request.headers.authorization,
        body: await readJsonBody(request),
      };
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(providerPayload());
    });
    const originalListConfigs = aiConfigService.listConfigs;
    aiConfigService.listConfigs = () => [providerConfig('image', baseUrl)];
    t.after(() => { aiConfigService.listConfigs = originalListConfigs; });
    const log = createCapturingLogger();

    const result = await imageClient.callImageApi({}, log, {
      prompt: PRIVATE_PROMPT,
      model: 'privacy-image-model',
      imageServiceType: 'image',
    });

    assert.equal(received.authorization, `Bearer ${REQUEST_SECRET}`);
    assert.equal(received.body.prompt, PRIVATE_PROMPT);
    assert.match(result.error, /HTTP 401/);
    assert.match(result.error, /AUTH_DENIED/);
    assert.match(result.error, /response_bytes=/);
    assert.doesNotMatch(result.error, LEAK_PATTERN);
    assert.doesNotMatch(JSON.stringify(log.entries), LEAK_PATTERN);
  });

  it('persists only the sanitized image error in generation and task rows', async (t) => {
    const baseUrl = await startServer(t, async (request, response) => {
      await readJsonBody(request);
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(providerPayload());
    });
    const db = new Database(':memory:');
    t.after(() => db.close());
    runMigrationsAndEnsure(db);
    const log = createCapturingLogger();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO dramas (id, title, status, created_at, updated_at)
       VALUES (1, 'privacy fixture', 'draft', ?, ?)`
    ).run(now, now);
    aiConfigService.createConfig(db, log, {
      service_type: 'image',
      provider: 'openai_compatible',
      api_protocol: 'openai',
      name: 'privacy image fixture',
      base_url: baseUrl,
      api_key: REQUEST_SECRET,
      model: ['privacy-image-model'],
      default_model: 'privacy-image-model',
      endpoint: '/images/generations',
      is_default: true,
      settings: JSON.stringify({ allow_local_http: true }),
    });

    const created = imageClient.createAndGenerateImage(db, log, {
      drama_id: 1,
      image_type: 'scene',
      prompt: PRIVATE_PROMPT,
      model: 'privacy-image-model',
      provider: 'openai_compatible',
      size: '1024x1024',
    });
    const generation = await waitFor(() => {
      const row = db.prepare(
        'SELECT status, error_msg, task_id FROM image_generations WHERE id = ?'
      ).get(created.id);
      return row?.status === 'failed' ? row : null;
    });
    const task = db.prepare('SELECT status, error FROM async_tasks WHERE id = ?').get(generation.task_id);

    assert.equal(task.status, 'failed');
    assert.match(generation.error_msg, /HTTP 403/);
    assert.match(generation.error_msg, /AUTH_DENIED/);
    assert.equal(task.error, generation.error_msg);
    assert.doesNotMatch(generation.error_msg, LEAK_PATTERN);
    assert.doesNotMatch(task.error, LEAK_PATTERN);
    assert.doesNotMatch(JSON.stringify(log.entries), LEAK_PATTERN);
  });
});
