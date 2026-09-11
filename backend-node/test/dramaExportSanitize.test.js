const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dramaExportService = require('../src/services/dramaExportService');
const {
  sanitizeProjectExport,
  sanitizeSourceMetadataNode,
} = require('../src/services/dramaExportSanitize');

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../src/services/dramaExportService.js'),
  'utf8',
);
const PUBLIC_API = [
  'DEFAULT_EXPORT_LIMITS',
  'DramaExportError',
  'exportDrama',
  'normalizeExportLimits',
  'resolveExportLimits',
];

describe('dramaExportSanitize 纯函数拆分', () => {
  it('dramaExportService 公开 API 不变', () => {
    assert.deepEqual(Object.keys(dramaExportService).sort(), [...PUBLIC_API].sort());
  });

  it('清洗实现已从导出服务文件中移出', () => {
    for (const name of [
      'function sensitiveKeyParts',
      'function isSensitiveExportKey',
      'function isSensitiveUrlQueryKey',
      'function normalizeHeaderAlias',
      'function isRelativeUrlReference',
      'function parseUrlReference',
      'function sanitizeUrlReference',
      'function sanitizeStructuredJsonString',
      'function sanitizeHeaderArray',
      'function sanitizeProjectExport',
      'function sanitizeSourceMetadataNode',
      'SENSITIVE_KEY_WORDS',
      'SENSITIVE_URL_QUERY_KEYS',
      'SENSITIVE_KEY_COMPOUNDS',
      'RELATIVE_URL_SCHEME',
      'MAX_EXPORT_SANITIZE_DEPTH',
    ]) {
      assert.equal(SERVICE_SRC.includes(name), false, name);
    }
    assert.match(SERVICE_SRC, /require\('\.\/dramaExportSanitize'\)/);
  });

  it('递归删除敏感键并保留非敏感字段', () => {
    assert.equal(sanitizeProjectExport(null), null);
    assert.equal(sanitizeProjectExport(0), 0);
    assert.equal(sanitizeProjectExport(false), false);
    assert.equal(sanitizeProjectExport('plain text'), 'plain text');
    const input = {
      api_key: 'secret-api-key',
      clientSecret: 'secret-client',
      nested: {
        authorization: 'Bearer abc',
        Cookie: 'session=1',
        session_id: 'sid',
        tokenizer_label: 'retained non-sensitive key name',
        safe_label: 'keep-me',
        items: [{ token: 't', media_url: 'https://assets.example.test/item.png?crop=fill' }],
      },
    };
    const original = structuredClone(input);
    const sanitized = sanitizeProjectExport(input);
    assert.deepEqual(input, original);
    assert.equal(Object.hasOwn(sanitized, 'api_key'), false);
    assert.equal(Object.hasOwn(sanitized, 'clientSecret'), false);
    assert.equal(Object.hasOwn(sanitized.nested, 'authorization'), false);
    assert.equal(Object.hasOwn(sanitized.nested, 'Cookie'), false);
    assert.equal(Object.hasOwn(sanitized.nested, 'session_id'), false);
    assert.equal(sanitized.nested.tokenizer_label, 'retained non-sensitive key name');
    assert.equal(sanitized.nested.safe_label, 'keep-me');
    assert.deepEqual(sanitized.nested.items, [{ media_url: 'https://assets.example.test/item.png?crop=fill' }]);
  });

  it('清洗所有支持的 URL 形态并丢掉凭证与敏感查询参数', () => {
    const ordinary = 'https://cdn.example.test/ordinary.png?style=cinematic&download=1&variant=poster#hero';
    const sanitized = sanitizeProjectExport({
      ordinary_media_url: ordinary,
      userinfo_media_url: 'https://viewer:userinfo@cdn.example.test/frame.png?style=cinematic&token=abs-query&width=1280#preview',
      protocol_relative_media_url: '//preview:userinfo@cdn.example.test/reference.png?format=webp&X-Amz-Credential=proto-query&variant=poster',
      root_relative_media_url: '/static/reference.png?width=640&access_token=rel-query&variant=poster#frame',
      path_relative_media_url: 'media/storyboards/frame.png?download=1&api_key=rel-query&cache=keep',
      parent_relative_media_url: '../shared/voice.mp3?quality=high&Authorization=rel-query',
      dot_relative_media_url: './thumb.jpg?maxTokens=rel-query&fit=cover',
      filename_media_url: 'poster.png?signature=rel-query&fit=cover',
      query_only_media_url: '?token=rel-query&code=oauth-code&nonce=n&policy=p&view=grid',
      malformed_media_url: 'https://[invalid.example/frame.png?token=bad',
      unknown_scheme_url: 'javascript:alert(1)',
      data_url: 'data:image/png;base64,abc',
    });

    assert.equal(sanitized.ordinary_media_url, ordinary);
    assert.equal(
      sanitized.userinfo_media_url,
      'https://cdn.example.test/frame.png?style=cinematic&width=1280#preview',
    );
    assert.equal(
      sanitized.protocol_relative_media_url,
      '//cdn.example.test/reference.png?format=webp&variant=poster',
    );
    assert.equal(
      sanitized.root_relative_media_url,
      '/static/reference.png?width=640&variant=poster#frame',
    );
    assert.equal(
      sanitized.path_relative_media_url,
      'media/storyboards/frame.png?download=1&cache=keep',
    );
    assert.equal(sanitized.parent_relative_media_url, '../shared/voice.mp3?quality=high');
    assert.equal(sanitized.dot_relative_media_url, './thumb.jpg?fit=cover');
    assert.equal(sanitized.filename_media_url, 'poster.png?fit=cover');
    assert.equal(sanitized.query_only_media_url, '?view=grid');
    assert.equal(sanitized.malformed_media_url, null);
    assert.equal(sanitized.unknown_scheme_url, 'javascript:alert(1)');
    assert.equal(sanitized.data_url, 'data:image/png;base64,abc');
  });

  it('无敏感内容的 JSON 字符串保持原文，含密钥时重写为清洗后的 JSON', () => {
    const untouched = '{\n  "safe_label": "ok"\n}';
    assert.equal(sanitizeProjectExport(untouched), untouched);
    assert.equal(sanitizeProjectExport('{not-json'), '{not-json');
    assert.equal(
      sanitizeProjectExport('{"apiKey":"secret","safe_label":"ok"}'),
      '{"safe_label":"ok"}',
    );
    assert.deepEqual(
      JSON.parse(sanitizeProjectExport('[{"authorization":"Bearer x","n":1}]')),
      [{ n: 1 }],
    );
  });

  it('按规范化别名清洗 header 数组中的凭证', () => {
    const sanitized = sanitizeProjectExport({
      integrations: {
        headers: [
          { name: 'Authorization', value: 'Bearer header-array-secret' },
          { key: 'X-Api-Key', values: ['api-key-array-secret'] },
          { name: 'Accept', value: 'application/json' },
          'plain-entry',
        ],
        custom_headers: [
          { name: 'Cookie', value: 'session=cookie-array-secret' },
        ],
        customHeaders: [
          { Name: 'Authorization', Value: 'Bearer camel-header-secret' },
          { Name: 'Accept', Value: 'application/vnd.lmd+json' },
        ],
        Headers: [
          { KEY: 'X-Api-Key', VALUES: ['pascal-header-secret'] },
          {
            Name: 'Accept',
            KEY: 'Authorization',
            Value: 'ambiguous-name-header-secret',
          },
        ],
        'custom-headers': [
          { 'N-a_me': 'Cookie', 'V-a_lue': 'hyphen-header-secret' },
        ],
        CUSTOM_HEADERS: [
          { name: 'Authorization', VALUES: ['case-snake-header-secret'] },
        ],
      },
    });

    const text = JSON.stringify(sanitized);
    for (const secret of [
      'header-array-secret',
      'api-key-array-secret',
      'cookie-array-secret',
      'camel-header-secret',
      'pascal-header-secret',
      'ambiguous-name-header-secret',
      'hyphen-header-secret',
      'case-snake-header-secret',
    ]) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.equal(sanitized.integrations.headers[2].value, 'application/json');
    assert.equal(sanitized.integrations.headers[3], 'plain-entry');
    assert.equal(sanitized.integrations.customHeaders[1].Value, 'application/vnd.lmd+json');
  });

  it('超过清洗深度的嵌套结构收敛为 null', () => {
    let nested = 'leaf';
    for (let i = 0; i < 70; i += 1) nested = { child: nested };
    const sanitized = sanitizeProjectExport(nested);
    let cursor = sanitized;
    for (let i = 0; i < 65; i += 1) cursor = cursor.child;
    assert.equal(cursor, null);
  });

  it('来源元数据去掉 original_file 与敏感键，并截断过长文本与过深结构', () => {
    assert.equal(sanitizeSourceMetadataNode(null), null);
    assert.equal(sanitizeSourceMetadataNode(undefined), undefined);
    assert.equal(sanitizeSourceMetadataNode(12), 12);
    assert.equal(sanitizeSourceMetadataNode(true), true);
    assert.equal(sanitizeSourceMetadataNode('abc'), 'abc');
    assert.equal(sanitizeSourceMetadataNode('x'.repeat(2001)).length, 2000);
    assert.equal(sanitizeSourceMetadataNode(Symbol('x')), null);

    const metadata = {
      original_file: { path: 'secret.bin', size: 9 },
      api_key: 'k',
      transcript: 'raw speech',
      ocr_text: 'raw ocr',
      title: 'keep',
      count: 3,
      tags: Array.from({ length: 120 }, (_, i) => `t${i}`),
    };
    const sanitized = sanitizeSourceMetadataNode(metadata);
    assert.equal(Object.hasOwn(sanitized, 'original_file'), false);
    assert.equal(Object.hasOwn(sanitized, 'api_key'), false);
    assert.equal(Object.hasOwn(sanitized, 'transcript'), false);
    assert.equal(Object.hasOwn(sanitized, 'ocr_text'), false);
    assert.equal(sanitized.title, 'keep');
    assert.equal(sanitized.count, 3);
    assert.equal(sanitized.tags.length, 100);
    assert.equal(sanitized.tags[0], 't0');
    assert.equal(sanitized.tags[99], 't99');

    const keys = {};
    for (let i = 0; i < 120; i += 1) keys[`k${i}`] = i;
    assert.equal(Object.keys(sanitizeSourceMetadataNode(keys)).length, 100);

    let deep = 'leaf';
    for (let i = 0; i < 8; i += 1) deep = { child: deep };
    let cursor = sanitizeSourceMetadataNode(deep);
    for (let i = 0; i < 7; i += 1) cursor = cursor.child;
    assert.equal(cursor, null);
  });
});
