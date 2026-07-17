const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertPublicHttpUrl,
  extractTextFromWebPayload,
  fetchWebSource,
  isPrivateAddress,
  stripHtmlToText,
} = require('../src/services/webSourceImportService');

function resolver(addresses) {
  return async () => addresses.map((address) => ({ address }));
}

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    async text() {
      return body;
    },
  };
}

test('web source import blocks local and private targets', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);

  await assert.rejects(
    () => assertPublicHttpUrl('http://localhost:3013/story'),
    /not public|localhost/
  );
  await assert.rejects(
    () => assertPublicHttpUrl('https://example.test/story', resolver(['10.0.0.8'])),
    /non-public|内网/
  );
});

test('web source import extracts article text and title from html', () => {
  const html = `
    <html><head><title>Fallback title</title><script>ignore()</script></head>
    <body><nav>menu</nav><article><h1>公开故事大纲</h1><p>第一段：角色收到一封信。</p><p>第二段：她决定出发。</p></article></body></html>
  `;
  const extracted = extractTextFromWebPayload(html, 'text/html; charset=utf-8');
  assert.equal(extracted.title, '公开故事大纲');
  assert.match(extracted.text, /第一段/);
  assert.match(extracted.text, /第二段/);
  assert.doesNotMatch(extracted.text, /ignore|menu/);
  assert.match(stripHtmlToText('<p>A&nbsp;&amp;&nbsp;B</p>'), /A & B/);
});

test('web source import fetches public text and validates redirects', async () => {
  let receivedOptions = null;
  const fetched = await fetchWebSource('https://example.com/source.txt', {
    resolver: resolver(['93.184.216.34']),
    downloadImpl: async (_url, _timeout, _redirectCount, options) => {
      receivedOptions = options;
      return {
        buffer: Buffer.from('Characters: Aria\nLocation: Gate\nAria finds a clue and starts the story.'),
        contentType: 'text/plain',
        finalUrl: 'https://example.com/source.txt',
      };
    },
  });
  assert.equal(fetched.url, 'https://example.com/source.txt');
  assert.match(fetched.text, /Aria finds/);
  assert.equal(receivedOptions.maxRedirects, 3);
  assert.equal(typeof receivedOptions.lookup, 'function');

  await assert.rejects(
    () => fetchWebSource('https://example.com/redirect', {
      resolver: async (host) => [{ address: host === 'example.com' ? '93.184.216.34' : '127.0.0.1' }],
      downloadImpl: async () => {
        throw new Error('Media URL resolves to a non-public address.');
      },
    }),
    /non-public|内网|回环|链路本地/
  );
});
