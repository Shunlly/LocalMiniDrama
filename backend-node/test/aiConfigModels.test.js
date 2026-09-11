const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const aiConfigService = require('../src/services/aiConfigService');
const aiConfigModels = require('../src/services/aiConfigModels');

function config(overrides = {}) {
  return {
    model: ['current-model', 'secondary-model'],
    default_model: 'current-model',
    is_active: true,
    ...overrides,
  };
}

describe('aiConfigModels 默认配置解析', () => {
  it('由 aiConfigService 原样再导出', () => {
    assert.equal(aiConfigService.resolveConfiguredModel, aiConfigModels.resolveConfiguredModel);
    assert.equal(aiConfigService.normalizeConfigModels, aiConfigModels.normalizeConfigModels);
    assert.equal(aiConfigService.assertDefaultModelMembership, aiConfigModels.assertDefaultModelMembership);
  });

  it('请求的模型不在列表中时 fail-closed，不回退到 fallback', () => {
    assert.throws(
      () => aiConfigModels.resolveConfiguredModel(config(), 'retired-model', 'fallback-model'),
      (error) => error.code === 'INVALID_AI_CONFIG' && error.details.issue === 'not_in_model_list'
    );
  });

  it('历史默认模型不在列表中时先拒绝，不继续解析 preferred', () => {
    assert.throws(
      () => aiConfigModels.resolveConfiguredModel(config({ default_model: 'retired-model' }), 'current-model'),
      (error) => error.details.field === 'default_model'
    );
  });

  it('停用配置允许暂存非法默认模型，启用配置必须成员合法', () => {
    assert.deepEqual(
      aiConfigModels.normalizeWritableConfigModels(config({
        is_active: false,
        default_model: 'retired-model',
      })),
      { model: ['current-model', 'secondary-model'], default_model: 'retired-model' }
    );
    assert.throws(
      () => aiConfigModels.normalizeWritableConfigModels(config({ default_model: 'retired-model' })),
      { code: 'INVALID_AI_CONFIG' }
    );
  });
});
