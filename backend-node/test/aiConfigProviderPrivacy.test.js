const test = require('node:test');
const assert = require('node:assert/strict');

const aiConfigService = require('../src/services/aiConfigService');
const privacy = require('../src/services/aiConfigProviderPrivacy');

test('aiConfigService 公开脱敏 API 仍指向隐私模块的同一函数', () => {
  assert.equal(aiConfigService.normalizeProviderBaseUrl, privacy.normalizeProviderBaseUrl);
  assert.equal(aiConfigService.configForResponse, privacy.configForResponse);
  assert.equal(aiConfigService.isMaskedSecret, privacy.isMaskedSecret);
  assert.equal(aiConfigService.hasStoredCredentials, privacy.hasStoredCredentials);
});

test('接口地址拒绝内嵌凭证，合法 HTTPS 去掉末尾斜杠', () => {
  assert.throws(
    () => privacy.normalizeProviderBaseUrl('https://user:pass@provider.example/v1'),
    (error) => error.code === 'INVALID_PROVIDER_URL'
      && error.message === '接口地址不得包含用户名或密码，请使用认证字段'
  );
  assert.equal(
    privacy.normalizeProviderBaseUrl('https://provider.example/v1/'),
    'https://provider.example/v1'
  );
});

test('响应脱敏会掩盖密钥并去掉地址里的用户信息', () => {
  const masked = privacy.configForResponse({
    id: 11,
    api_key: 'sk-secret-value',
    base_url: 'https://user:pass@provider.example/v1',
    settings: JSON.stringify({ access_key: 'ak', secret_key: 'sk' }),
  });
  assert.equal(masked.api_key, '********');
  assert.equal(masked.api_key_set, true);
  assert.equal(masked.base_url, 'https://provider.example/v1');
  assert.match(String(masked.settings), /\*{8}/);
  assert.doesNotMatch(String(masked.settings), /sk-secret-value|ak|sk(?!-)/);
});
