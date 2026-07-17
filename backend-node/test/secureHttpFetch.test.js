'use strict';

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { secureHttpFetch } = require('../src/services/secureHttpFetch');

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
  return server.address().port;
}

function localLookup(counter) {
  return async () => {
    counter.calls += 1;
    return [{ address: '127.0.0.1', family: 4 }];
  };
}

describe('secureHttpFetch', () => {
  it('pins the DNS answer used by the validated request', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const counter = { calls: 0 };
    const origin = `http://provider.test:${port}`;

    const response = await secureHttpFetch(`${origin}/health`, {}, {
      trustedOrigins: [origin],
      allowPrivateOrigins: [origin],
      requireHttpsForPublic: true,
      lookup: localLookup(counter),
    });

    assert.equal(counter.calls, 1);
    assert.equal(response.url, `${origin}/health`);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it('revalidates every redirect target before opening a socket', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    });
    const origin = `http://provider.test:${port}`;

    await assert.rejects(
      secureHttpFetch(`${origin}/redirect`, {}, {
        trustedOrigins: [origin],
        allowPrivateOrigins: [origin],
        lookup: async (hostname) => [{
          address: hostname === 'provider.test' ? '127.0.0.1' : '169.254.169.254',
          family: 4,
        }],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  });

  it('removes credentials when a redirect changes origin', async () => {
    let receivedHeaders = null;
    const targetPort = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('done');
    });
    const sourcePort = await startServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/result` });
      res.end();
    });
    const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
    const targetOrigin = `http://127.0.0.1:${targetPort}`;

    const response = await secureHttpFetch(`${sourceOrigin}/start`, {
      headers: {
        Authorization: 'Bearer must-not-cross-origin',
        Cookie: 'session=must-not-cross-origin',
        'X-Api-Key': 'must-not-cross-origin',
      },
    }, {
      trustedOrigins: [sourceOrigin, targetOrigin],
    });

    assert.equal(await response.text(), 'done');
    assert.equal(response.redirected, true);
    assert.equal(receivedHeaders.authorization, undefined);
    assert.equal(receivedHeaders.cookie, undefined);
    assert.equal(receivedHeaders['x-api-key'], undefined);
  });

  it('does not let a trusted public hostname rebind to a private address', async () => {
    const origin = 'http://provider.example:8080';
    await assert.rejects(
      secureHttpFetch(`${origin}/health`, {}, {
        trustedOrigins: [origin],
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  });

  it('rejects public HTTP providers before DNS or credential transmission', async () => {
    let lookupCalls = 0;
    await assert.rejects(
      secureHttpFetch('http://provider.example/v1/models', {
        headers: { Authorization: 'Bearer must-not-be-sent' },
      }, {
        requireHttpsForPublic: true,
        lookup: async () => {
          lookupCalls += 1;
          return [{ address: '93.184.216.34', family: 4 }];
        },
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE' && /HTTPS/.test(error.message)
    );
    assert.equal(lookupCalls, 0);
  });

  it('requires an exact private-origin exception and rejects mixed DNS answers for HTTP', async () => {
    const origin = 'http://local-provider:8080';
    await assert.rejects(
      secureHttpFetch(`${origin}/health`, {}, {
        trustedOrigins: [origin],
        requireHttpsForPublic: true,
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );

    await assert.rejects(
      secureHttpFetch(`${origin}/health`, {}, {
        trustedOrigins: [origin],
        allowPrivateOrigins: [origin],
        requireHttpsForPublic: true,
        lookup: async () => [
          { address: '127.0.0.1', family: 4 },
          { address: '93.184.216.34', family: 4 },
        ],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  });

  it('rejects cross-origin redirects that would replay a request body', async () => {
    let targetCalls = 0;
    const targetPort = await startServer((_req, res) => {
      targetCalls += 1;
      res.end('unexpected');
    });
    const sourcePort = await startServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${targetPort}/collect` });
      res.end();
    });

    await assert.rejects(
      secureHttpFetch(`http://127.0.0.1:${sourcePort}/submit`, {
        method: 'POST',
        headers: { Authorization: 'Bearer must-not-cross-origin' },
        body: JSON.stringify({ prompt: 'private request body' }),
      }, {
        trustedOrigins: [`http://127.0.0.1:${sourcePort}`],
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
    assert.equal(targetCalls, 0);
  });

  it('enforces a response body limit even without content-length', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write(Buffer.alloc(8, 0x61));
      res.end(Buffer.alloc(8, 0x62));
    });
    const origin = `http://provider.test:${port}`;

    await assert.rejects(
      secureHttpFetch(`${origin}/large`, {}, {
        trustedOrigins: [origin],
        allowPrivateOrigins: [origin],
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
        maxBytes: 10,
      }),
      (error) => error?.code === 'UNSAFE_MEDIA_REFERENCE'
    );
  });
});
