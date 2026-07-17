const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const {
  createCorsMiddleware,
  createOriginGuard,
  createRequestOriginPolicy,
  requestContext,
} = require('../src/app');
const { setupRouter } = require('../src/routes');

function request(server, {
  origin,
  host,
  body = 'value=changed',
  method = 'POST',
  requestPath = '/mutate',
  secFetchSite,
} = {}) {
  const address = server.address();
  const headers = {};
  if (body != null) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['content-length'] = Buffer.byteLength(body);
  }
  if (origin !== undefined) headers.origin = origin;
  if (host !== undefined) headers.host = host;
  if (secFetchSite !== undefined) headers['sec-fetch-site'] = secFetchSite;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: requestPath,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}

test('production origin policy keeps trusted read-only requests and requires an origin for writes', () => {
  const policy = createRequestOriginPolicy({
    host: 'api.example.test',
    cors_origins: ['https://ui.example.test', '*'],
  }, { nodeEnv: 'production' });

  assert.equal(policy({ method: 'GET', headers: { host: 'api.example.test:5679' }, socket: {} }, undefined), true);
  assert.equal(policy({ method: 'POST', headers: { host: 'api.example.test:5679' }, socket: {} }, undefined), false);
  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'https://ui.example.test'), true);
  assert.equal(policy({ method: 'PUT', headers: { host: 'api.example.test:5679' }, socket: {} }, 'http://api.example.test:5679'), true);
  assert.equal(policy({ method: 'DELETE', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'http://127.0.0.1:5679'), true);

  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'http://localhost:49152'), false);
  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'http://127.9.8.7:3013'), false);
  assert.equal(policy({ method: 'POST', headers: { host: 'attacker.example:5679' }, socket: {} }, 'http://attacker.example:5679'), false);
  assert.equal(policy({ method: 'GET', headers: { host: 'attacker.example:5679' }, socket: {} }, undefined), false);
  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'http://localhost.attacker.example'), false);
  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'http://192.168.1.20:3013'), false);
  assert.equal(policy({ method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} }, 'null'), false);
});

test('CORS origins do not become trusted backend Hosts', () => {
  const policy = createRequestOriginPolicy({
    host: 'api.example.test',
    cors_origins: ['https://ui.example.test'],
  }, { nodeEnv: 'production' });

  assert.equal(
    policy(
      { method: 'POST', headers: { host: 'ui.example.test' }, socket: { encrypted: true } },
      'https://ui.example.test'
    ),
    false
  );
});

test('loopback desktop Hosts and explicitly trusted Docker Hosts remain available', () => {
  const desktopPolicy = createRequestOriginPolicy({
    host: '127.0.0.1',
    cors_origins: [],
  }, { nodeEnv: 'production' });
  assert.equal(
    desktopPolicy(
      { method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} },
      'http://127.0.0.1:5679'
    ),
    true
  );
  assert.equal(
    desktopPolicy({
      method: 'POST',
      headers: {
        host: '127.0.0.1:5679',
        'sec-fetch-site': 'same-origin',
      },
      socket: {
        localAddress: '127.0.0.1',
        localPort: 5679,
        remoteAddress: '::ffff:127.0.0.1',
      },
    }, undefined),
    true
  );

  const dockerPolicy = createRequestOriginPolicy({
    host: '0.0.0.0',
    trusted_hosts: ['backend'],
    cors_origins: ['http://localhost:3013'],
  }, { nodeEnv: 'production' });
  assert.equal(
    dockerPolicy(
      { method: 'POST', headers: { host: 'backend:5679' }, socket: {} },
      'http://localhost:3013'
    ),
    true
  );
});

test('originless writes cannot rely on a forged Host or unverified Fetch Metadata', () => {
  const policy = createRequestOriginPolicy({ host: '127.0.0.1' }, { nodeEnv: 'production' });
  const baseRequest = {
    method: 'POST',
    headers: { host: '127.0.0.1:5679' },
    socket: { localAddress: '127.0.0.1', localPort: 5679, remoteAddress: '127.0.0.1' },
  };

  assert.equal(policy(baseRequest, undefined), false);
  assert.equal(policy({
    ...baseRequest,
    headers: { ...baseRequest.headers, 'sec-fetch-site': 'cross-site' },
  }, undefined), false);
  assert.equal(policy({
    ...baseRequest,
    headers: { ...baseRequest.headers, 'sec-fetch-site': 'same-origin' },
    socket: { localAddress: '127.0.0.1', localPort: 5679, remoteAddress: '203.0.113.10' },
  }, undefined), false);
  assert.equal(policy({
    ...baseRequest,
    headers: { host: '127.0.0.1:5680', 'sec-fetch-site': 'same-origin' },
  }, undefined), false);
  assert.equal(policy({
    ...baseRequest,
    headers: { host: 'attacker.example:5679', 'sec-fetch-site': 'same-origin' },
  }, undefined), false);
});

test('arbitrary loopback origins are enabled only in explicit development mode', () => {
  const req = { method: 'POST', headers: { host: '127.0.0.1:5679' }, socket: {} };
  const developmentPolicy = createRequestOriginPolicy(
    { host: '127.0.0.1', cors_origins: [] },
    { nodeEnv: 'development' }
  );
  const productionPolicy = createRequestOriginPolicy(
    { host: '127.0.0.1', cors_origins: [] },
    { nodeEnv: 'production' }
  );
  assert.equal(developmentPolicy(req, 'http://localhost:49152'), true);
  assert.equal(productionPolicy(req, 'http://localhost:49152'), false);
});

test('origin guard evaluates the Host policy when Origin is absent', () => {
  const req = {
    headers: { host: 'attacker.example:5679' },
    method: 'GET',
    requestId: 'originless-host-test',
  };
  let evaluatedRequest;
  let evaluatedOrigin = 'not-called';
  let nextCalled = false;
  let responseStatus;
  let responseBody;
  const res = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  const guard = createOriginGuard((candidateRequest, candidateOrigin) => {
    evaluatedRequest = candidateRequest;
    evaluatedOrigin = candidateOrigin;
    return false;
  }, { warnw() {} });

  guard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(evaluatedRequest, req);
  assert.equal(evaluatedOrigin, undefined);
  assert.equal(nextCalled, false);
  assert.equal(responseStatus, 403);
  assert.equal(responseBody.error.code, 'REQUEST_SOURCE_NOT_ALLOWED');
});

test('malicious and unverifiable POSTs are rejected before route side effects', async (t) => {
  const app = express();
  const policy = createRequestOriginPolicy({
    host: '127.0.0.1',
    cors_origins: ['http://localhost:3013'],
  }, { nodeEnv: 'production' });
  let sideEffects = 0;
  let reads = 0;

  app.use(requestContext);
  app.use(createOriginGuard(policy, { warnw() {} }));
  app.use(createCorsMiddleware(policy));
  app.use(express.urlencoded({ extended: true }));
  app.post('/mutate', (_req, res) => {
    sideEffects += 1;
    res.json({ success: true });
  });
  app.get('/read', (_req, res) => {
    reads += 1;
    res.json({ secret: 'local-only' });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const rejected = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
    origin: 'https://attacker.example',
    secFetchSite: 'cross-site',
  });
  assert.equal(rejected.status, 403);
  assert.equal(JSON.parse(rejected.body).error.code, 'REQUEST_SOURCE_NOT_ALLOWED');
  assert.equal(sideEffects, 0);

  const rejectedLocalPort = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
    origin: 'http://localhost:49321',
  });
  assert.equal(rejectedLocalPort.status, 403);
  assert.equal(sideEffects, 0);

  const originlessPost = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
  });
  assert.equal(originlessPost.status, 403);
  assert.equal(sideEffects, 0);

  const originlessGet = await request(server, {
    body: null,
    host: 'attacker.example:5679',
    method: 'GET',
    requestPath: '/read',
  });
  assert.equal(originlessGet.status, 403);
  assert.equal(reads, 0);

  const curlLikeGet = await request(server, {
    body: null,
    host: `127.0.0.1:${server.address().port}`,
    method: 'GET',
    requestPath: '/read',
  });
  assert.equal(curlLikeGet.status, 200);
  assert.equal(reads, 1);

  const allowed = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
    origin: 'http://localhost:3013',
    secFetchSite: 'same-origin',
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3013');
  assert.equal(sideEffects, 1);

  const unverifiedOriginless = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
  });
  assert.equal(unverifiedOriginless.status, 403);
  assert.equal(sideEffects, 1);

  const verifiedElectron = await request(server, {
    host: `127.0.0.1:${server.address().port}`,
    secFetchSite: 'same-origin',
  });
  assert.equal(verifiedElectron.status, 200);
  assert.equal(verifiedElectron.headers['access-control-allow-origin'], undefined);
  assert.equal(sideEffects, 2);
});

test('provider-consuming storyboard generation is POST-only while reads remain GET', () => {
  const realMkdtempSync = fs.mkdtempSync;
  const importRoot = realMkdtempSync(path.join(os.tmpdir(), 'lmd-origin-routes-'));
  fs.mkdtempSync = (prefix, options) => (
    String(prefix).includes('localminidrama-import-upload-')
      ? importRoot
      : realMkdtempSync(prefix, options)
  );

  const statement = {
    all() { return []; },
    get() { return null; },
    run() { return { changes: 0, lastInsertRowid: 0 }; },
  };
  const db = {
    prepare() { return statement; },
    transaction(fn) { return fn; },
  };
  let router;
  try {
    router = setupRouter({ storage: {}, server: {} }, db, {
      error() {},
      info() {},
      warn() {},
    });
  } finally {
    fs.mkdtempSync = realMkdtempSync;
    fs.rmSync(importRoot, { recursive: true, force: true });
  }

  const generationRoutes = router.stack.filter(
    (layer) => layer.route?.path === '/storyboards/episode/:episode_id/generate'
  );
  assert.equal(generationRoutes.length, 1);
  assert.deepEqual(Object.keys(generationRoutes[0].route.methods), ['post']);

  const readRoute = router.stack.find((layer) => layer.route?.path === '/storyboards/:id');
  assert.equal(readRoute.route.methods.get, true);
});
