const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  backupColumnRedactionPolicy,
  backupKeyWords,
  isBackupHeaderContainerKey,
  isSafeBackupHeaderName,
  isSensitiveBackupKey,
  isSensitiveBackupStructuredKey,
  normalizeBackupQueryKey,
  redactBackupHeaders,
  redactLooseBackupText,
  redactSecretObject,
  redactSettingsText,
  redactStructuredBackupText,
  sanitizeBackupAbsoluteUrl,
  sanitizeBackupLocation,
  sanitizeBackupRelativeUrl,
  sanitizeBackupUrlColumn,
} = require('../src/services/dataBackupRedaction');

test('isSensitiveBackupKey 识别凭证类字段，放过业务 key 和 maxTokens', () => {
  for (const key of [
    'auth',
    'X-Auth',
    'authentication',
    'mutual_authentication',
    'api_key',
    'api-key',
    'access_key',
    'credential',
    'client_secret',
    'signature',
    'sig',
    'password',
    'authorization',
    'cookie',
    'private_key',
    'session',
    'token',
    'provider_access_token',
    'refresh-token',
    'accessToken',
    'refreshToken',
  ]) {
    assert.equal(isSensitiveBackupKey(key), true, key);
  }
  for (const key of ['business_key', 'shortcut_keys', 'maxTokens', 'provider_name', 'quality', 'region']) {
    assert.equal(isSensitiveBackupKey(key), false, key);
  }
});

test('isSensitiveBackupStructuredKey 把 key/keys/passwd/passphrase 当敏感，但 business_key 不是', () => {
  assert.equal(isSensitiveBackupKey('key'), false);
  assert.equal(isSensitiveBackupStructuredKey('key'), true);
  assert.equal(isSensitiveBackupStructuredKey('keys'), true);
  assert.equal(isSensitiveBackupStructuredKey('passwd'), true);
  assert.equal(isSensitiveBackupStructuredKey('passphrase'), true);
  assert.equal(isSensitiveBackupStructuredKey('business_key'), false);
  assert.equal(isSensitiveBackupStructuredKey('shortcut_keys'), false);
  assert.equal(isSensitiveBackupStructuredKey('maxTokens'), false);
});

test('backupKeyWords 按驼峰和分隔符拆词', () => {
  assert.deepEqual(backupKeyWords('Content-Type'), ['content', 'type']);
  assert.deepEqual(backupKeyWords('acceptEncoding'), ['accept', 'encoding']);
  assert.deepEqual(backupKeyWords('header_list'), ['header', 'list']);
  assert.deepEqual(backupKeyWords('X-Auth'), ['x', 'auth']);
  assert.deepEqual(backupKeyWords(''), []);
});

test('请求头容器和安全请求头名称按词识别', () => {
  assert.equal(isBackupHeaderContainerKey('headers'), true);
  assert.equal(isBackupHeaderContainerKey('header_list'), true);
  assert.equal(isBackupHeaderContainerKey('responseHeaders'), true);
  assert.equal(isBackupHeaderContainerKey('nested'), false);
  assert.equal(isSafeBackupHeaderName('Accept'), true);
  assert.equal(isSafeBackupHeaderName('accept-encoding'), true);
  assert.equal(isSafeBackupHeaderName('Cache-Control'), true);
  assert.equal(isSafeBackupHeaderName('Content-Type'), true);
  assert.equal(isSafeBackupHeaderName('User-Agent'), true);
  assert.equal(isSafeBackupHeaderName('Authorization'), false);
  assert.equal(isSafeBackupHeaderName('X-Auth'), false);
  assert.equal(isSafeBackupHeaderName('Authentication'), false);
});

test('sanitizeBackupRelativeUrl 只保留安全查询参数并去掉 hash', () => {
  assert.equal(normalizeBackupQueryKey('api-version'), 'apiversion');
  assert.equal(
    sanitizeBackupRelativeUrl('/chat/completions?sig=secret&api-version=2026-01-01#frag'),
    '/chat/completions?api-version=2026-01-01',
  );
  assert.equal(
    sanitizeBackupRelativeUrl('/tasks/{taskId}?credential=c&view=summary'),
    '/tasks/{taskId}?view=summary',
  );
  assert.equal(sanitizeBackupRelativeUrl('/path#hash-only'), '/path');
  assert.equal(sanitizeBackupRelativeUrl('events?sig=bypass'), 'events');
});

test('sanitizeBackupAbsoluteUrl 去掉用户名、密码、查询和片段', () => {
  assert.equal(
    sanitizeBackupAbsoluteUrl('https://user:pass@provider.example/v1/?sig=x#fragment'),
    'https://provider.example/v1',
  );
  assert.equal(
    sanitizeBackupAbsoluteUrl('//user:pass@callback.example/result?sig=x', true),
    '//callback.example/result',
  );
  assert.equal(sanitizeBackupAbsoluteUrl('not a url'), '');
});

test('sanitizeBackupLocation 覆盖绝对、协议相对、相对和内嵌 URL', () => {
  assert.equal(sanitizeBackupLocation(12), 12);
  assert.equal(sanitizeBackupLocation('   '), '   ');
  assert.equal(
    sanitizeBackupLocation('https://user:marker@provider.example/v1?sig=x#fragment'),
    'https://provider.example/v1',
  );
  assert.equal(
    sanitizeBackupLocation('//user:pass@callback.example/result?sig=x'),
    '//callback.example/result',
  );
  assert.equal(
    sanitizeBackupLocation('/chat/completions?sig=x&api-version=2026-01-01'),
    '/chat/completions?api-version=2026-01-01',
  );
  assert.equal(
    sanitizeBackupLocation('v1/events?sig=x&view=summary'),
    'v1/events?view=summary',
  );
  assert.equal(sanitizeBackupLocation('events?sig=bypass'), 'events');
  assert.equal(sanitizeBackupLocation('callback=events?unknown=bypass'), 'callback=events');
  assert.equal(
    sanitizeBackupLocation('callback=v1/events?sig=x&view=summary'),
    'callback=v1/events?view=summary',
  );
  assert.equal(
    sanitizeBackupLocation('note:[//user:pass@callback.example/result?sig=bypass]'),
    'note:[//callback.example/result]',
  );
  assert.equal(sanitizeBackupLocation('note:v1/events?sig=bypass'), 'note:v1/events');
});

test('sanitizeBackupUrlColumn 只接受 URL 形态，其它文本清空', () => {
  assert.equal(sanitizeBackupUrlColumn(''), '');
  assert.equal(sanitizeBackupUrlColumn('   '), '');
  assert.equal(sanitizeBackupUrlColumn('not a url'), '');
  assert.equal(
    sanitizeBackupUrlColumn('https://images.example/frame.png?sig=secret'),
    'https://images.example/frame.png',
  );
  assert.equal(
    sanitizeBackupUrlColumn('/tasks/{taskId}?credential=c&view=summary'),
    '/tasks/{taskId}?view=summary',
  );
});

test('redactSecretObject 递归抹除密钥并清洗 URL，保留非敏感字段', () => {
  const redacted = redactSecretObject({
    provider_name: 'custom-safe-provider',
    key: 'wipe-me',
    nested: {
      keys: ['array-secret', { value: 'object-secret' }],
      token: 'nested-token',
      accessToken: 'hidden-access-token',
      refreshToken: 'hidden-refresh-token',
      maxTokens: 4096,
      region: 'cn-north-1',
    },
    transports: [
      { passwd: 'hidden-passwd', timeout_ms: 1200 },
      { tls: { passphrase: 'hidden-passphrase', verify_peer: true }, retry_count: 3 },
    ],
    headers: {
      Authorization: 'Bearer hidden',
      'X-Auth': 'header-secret',
      Accept: 'application/json',
    },
    header_list: [
      { name: 'Authentication', value: 'header-secret', enabled: true },
      { name: 'Content-Type', value: 'application/json' },
    ],
    sig: 'signature-secret',
    credential: 'credential-secret',
    callback_url: 'https://callback.example/result?sig=x',
    protocol_relative_url: '//user:pass@callback.example/result?sig=x',
    bare_relative_url: 'v1/events?sig=x&view=summary',
    models: ['safe-model-a'],
    quality: 'high',
  });
  assert.equal(redacted.provider_name, 'custom-safe-provider');
  assert.equal(redacted.key, '');
  assert.equal(redacted.nested.keys, '');
  assert.equal(redacted.nested.token, '');
  assert.equal(redacted.nested.accessToken, '');
  assert.equal(redacted.nested.refreshToken, '');
  assert.equal(redacted.nested.maxTokens, 4096);
  assert.equal(redacted.nested.region, 'cn-north-1');
  assert.equal(redacted.transports[0].passwd, '');
  assert.equal(redacted.transports[0].timeout_ms, 1200);
  assert.equal(redacted.transports[1].tls.passphrase, '');
  assert.equal(redacted.transports[1].tls.verify_peer, true);
  assert.equal(redacted.headers.Authorization, '');
  assert.equal(redacted.headers['X-Auth'], '');
  assert.equal(redacted.headers.Accept, 'application/json');
  assert.deepEqual(redacted.header_list, [
    { name: 'Authentication', value: '', enabled: true },
    { name: 'Content-Type', value: 'application/json' },
  ]);
  assert.equal(redacted.sig, '');
  assert.equal(redacted.credential, '');
  assert.equal(redacted.callback_url, 'https://callback.example/result');
  assert.equal(redacted.protocol_relative_url, '//callback.example/result');
  assert.equal(redacted.bare_relative_url, 'v1/events?view=summary');
  assert.deepEqual(redacted.models, ['safe-model-a']);
  assert.equal(redacted.quality, 'high');
  assert.equal(redactSecretObject(null), null);
  assert.equal(redactSecretObject(4096), 4096);
});

test('redactBackupHeaders 保留 name/key 元数据和安全请求头值', () => {
  assert.deepEqual(redactBackupHeaders('not-headers'), '');
  assert.deepEqual(redactBackupHeaders(['skip', null]), ['', '']);
  assert.deepEqual(
    redactBackupHeaders({
      Authorization: 'Bearer hidden',
      Accept: 'application/json',
    }),
    { Authorization: '', Accept: 'application/json' },
  );
  assert.deepEqual(
    redactBackupHeaders([
      { key: 'Authorization', value: 'secret', enabled: true },
      { name: 'X-Auth', value: 'secret', enabled: false },
      { key: 'Content-Type', value: 'application/json' },
    ]),
    [
      { key: 'Authorization', value: '', enabled: true },
      { name: 'X-Auth', value: '', enabled: false },
      { key: 'Content-Type', value: 'application/json' },
    ],
  );
});

test('redactSettingsText 非法 JSON 返回 null，合法 JSON 递归脱敏', () => {
  assert.equal(redactSettingsText(null), null);
  assert.equal(redactSettingsText(''), '');
  assert.equal(redactSettingsText('not-json'), null);
  assert.equal(
    redactSettingsText(JSON.stringify({ api_key: 'secret', quality: 'high' })),
    JSON.stringify({ api_key: '', quality: 'high' }),
  );
});

test('redactLooseBackupText 抹除 Bearer 和赋值形式密钥', () => {
  assert.equal(redactLooseBackupText('Authorization=Bearer hidden-token'), 'Authorization= ');
  assert.equal(redactLooseBackupText('password: "secret-value"'), 'password: ');
  assert.equal(
    redactLooseBackupText('see https://user:pass@provider.example/v1?sig=x'),
    'see https://provider.example/v1',
  );
});

test('redactStructuredBackupText JSON 失败时回退到松散文本', () => {
  assert.equal(redactStructuredBackupText(null), null);
  assert.equal(redactStructuredBackupText(''), '');
  assert.equal(
    redactStructuredBackupText(JSON.stringify({ token: 'hidden', quality: 'high' })),
    JSON.stringify({ token: '', quality: 'high' }),
  );
  assert.equal(redactStructuredBackupText('token: abc'), 'token: ');
});

test('backupColumnRedactionPolicy 按列名选择 secret/url/structured/loose', () => {
  assert.equal(backupColumnRedactionPolicy('api_key'), 'secret');
  assert.equal(backupColumnRedactionPolicy('image_url'), 'url');
  assert.equal(backupColumnRedactionPolicy('query_endpoint'), 'url');
  assert.equal(backupColumnRedactionPolicy('proxy_url'), 'url');
  assert.equal(backupColumnRedactionPolicy('output_json'), 'structured');
  assert.equal(backupColumnRedactionPolicy('result'), 'structured');
  assert.equal(backupColumnRedactionPolicy('settings'), 'structured');
  assert.equal(backupColumnRedactionPolicy('extra_images'), 'structured');
  assert.equal(backupColumnRedactionPolicy('reference_images'), 'structured');
  assert.equal(backupColumnRedactionPolicy('scenes'), 'structured');
  assert.equal(backupColumnRedactionPolicy('error_message'), 'loose');
  assert.equal(backupColumnRedactionPolicy('log'), 'loose');
  assert.equal(backupColumnRedactionPolicy('business_key'), null);
  assert.equal(backupColumnRedactionPolicy('shortcut_keys'), null);
});
