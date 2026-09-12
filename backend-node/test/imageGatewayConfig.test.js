const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const aiConfigService = require('../src/services/aiConfigService');
const {
  resolveAssetUserNegativeForApi,
  getDefaultImageConfig,
  buildImageUrl,
  getModelFromConfig,
} = require('../src/services/imageGateway/config');

const originalListConfigs = aiConfigService.listConfigs;

afterEach(() => {
  aiConfigService.listConfigs = originalListConfigs;
});

function config(overrides = {}) {
  return {
    id: 1,
    is_active: true,
    is_default: false,
    provider: 'openai',
    service_type: 'image',
    model: ['dall-e-3'],
    default_model: 'dall-e-3',
    base_url: 'https://api.openai.com/v1',
    endpoint: '/images/generations',
    ...overrides,
  };
}

test('没有显式模型时不带资产负面词', () => {
  assert.equal(resolveAssetUserNegativeForApi('', 'blurry'), '');
  assert.equal(resolveAssetUserNegativeForApi('dall-e-3', '  blurry  '), 'blurry');
  assert.equal(resolveAssetUserNegativeForApi('dall-e-3', ''), '');
});

test('分镜图配置为空时回退到普通图片配置', () => {
  aiConfigService.listConfigs = (_db, serviceType) => (
    serviceType === 'storyboard_image' ? [] : [config({ id: 8, is_default: true })]
  );
  assert.equal(getDefaultImageConfig({}, null, null, 'storyboard_image').id, 8);
});

test('指定不存在的供应商时不偷用其他配置', () => {
  aiConfigService.listConfigs = () => [config({ id: 3, is_default: true, provider: 'openai' })];
  assert.equal(getDefaultImageConfig({}, null, 'dashscope', 'image'), null);
});

test('拼接图片接口地址并解析模型', () => {
  const item = config({ base_url: 'https://gateway.example/v1/', endpoint: 'images/generations' });
  assert.equal(buildImageUrl(item), 'https://gateway.example/v1/images/generations');
  assert.equal(getModelFromConfig(item, ' dall-e-3 '), 'dall-e-3');
});
