const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigList = require('../src/services/aiConfigList');
const aiConfigModels = require('../src/services/aiConfigModels');
const imageClient = require('../src/services/imageClient');
const videoClient = require('../src/services/videoClient');

const PUBLIC_API = [
  'CONNECTION_TEST_TIMEOUT_MS',
  'DISCOVER_MODELS_LIMIT',
  'DISCOVER_MODELS_MAX_BYTES',
  'fetchConnectionProbe',
  'probeOpenAICompatibleModels',
  'probeOllamaConnection',
  'ollamaProbeUrls',
  'openAiCompatibleModelsUrl',
  'supportsOpenAiCompatibleModelDiscovery',
  'discoverModels',
  'isApiKeyOptionalConnection',
  'listConfigs',
  'getConfig',
  'createConfig',
  'updateConfig',
  'deleteConfig',
  'testConnection',
  'getVendorLockStatus',
  'applyVendorLock',
  'bulkUpdateApiKey',
  'configForResponse',
  'hasStoredCredentials',
  'normalizeConfigModels',
  'assertDefaultModelMembership',
  'resolveConfiguredModel',
  'getProviderNetworkOptions',
  'isExplicitLocalProviderConfig',
  'isExplicitLocalProviderHost',
  'isMaskedSecret',
  'maskSensitiveSettings',
  'preserveMaskedSettings',
  'normalizeProviderBaseUrl',
  'normalizeProviderEndpoint',
  'sanitizeProviderUrlForResponse',
  'sanitizeProviderEndpointForResponse',
];

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function config(overrides = {}) {
  return {
    id: 1,
    is_active: true,
    is_default: false,
    provider: 'openai',
    service_type: 'text',
    model: ['cloud-default'],
    default_model: 'cloud-default',
    ...overrides,
  };
}

describe('aiConfigService 列表选择/默认配置解析拆分', () => {
  it('公开 API 不变，并把列表与模型解析委托给 helper', () => {
    assert.deepEqual(Object.keys(aiConfigService).sort(), [...PUBLIC_API].sort());
    assert.equal(aiConfigService.listConfigs, aiConfigList.listConfigs);
    assert.equal(aiConfigService.getConfig, aiConfigList.getConfig);
    assert.equal(aiConfigService.normalizeConfigModels, aiConfigModels.normalizeConfigModels);
    assert.equal(aiConfigService.assertDefaultModelMembership, aiConfigModels.assertDefaultModelMembership);
    assert.equal(aiConfigService.resolveConfiguredModel, aiConfigModels.resolveConfiguredModel);

    const serviceSrc = fs.readFileSync(path.join(__dirname, '../src/services/aiConfigService.js'), 'utf8');
    assert.match(serviceSrc, /require\('\.\/aiConfigList'\)/);
    assert.match(serviceSrc, /require\('\.\/aiConfigModels'\)/);
    assert.doesNotMatch(serviceSrc, /function listConfigs\s*\(/);
    assert.doesNotMatch(serviceSrc, /function getConfig\s*\(/);
    assert.doesNotMatch(serviceSrc, /function resolveConfiguredModel\s*\(/);
    assert.doesNotMatch(serviceSrc, /function normalizeConfigModels\s*\(/);
    assert.doesNotMatch(serviceSrc, /function rowToConfig\s*\(/);
    assert.doesNotMatch(serviceSrc, /imageGateway|videoGateway/);
  });

  it('listConfigs 不跨服务类型回退，也不返回已删除行', () => {
    const db = createDb();
    try {
      const text = aiConfigService.createConfig(db, log, {
        service_type: 'text',
        provider: 'openai_compatible',
        name: 'Text default',
        base_url: 'https://provider.example/v1',
        api_key: 'text-key',
        model: ['text-model'],
        default_model: 'text-model',
        is_default: true,
        priority: 1,
      });
      const image = aiConfigService.createConfig(db, log, {
        service_type: 'image',
        provider: 'openai_compatible',
        name: 'Image default',
        base_url: 'https://provider.example/v1',
        api_key: 'image-key',
        model: ['image-model'],
        default_model: 'image-model',
        is_default: true,
        priority: 9,
      });
      db.prepare('UPDATE ai_service_configs SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), image.id);

      const listed = aiConfigService.listConfigs(db, 'text');
      assert.deepEqual(listed.map((item) => item.id), [text.id]);
      assert.equal(aiConfigService.listConfigs(db, 'image').length, 0);
      assert.equal(aiConfigService.getConfig(db, image.id), null);
      assert.equal(aiConfigService.getConfig(db, text.id).id, text.id);
    } finally {
      db.close();
    }
  });

  it('listConfigs 按默认、优先级、创建时间排序', () => {
    const db = createDb();
    try {
      const older = aiConfigService.createConfig(db, log, {
        service_type: 'text',
        provider: 'openai_compatible',
        name: 'Older high priority',
        base_url: 'https://provider.example/v1',
        api_key: 'k1',
        model: ['a'],
        default_model: 'a',
        priority: 5,
      });
      const newer = aiConfigService.createConfig(db, log, {
        service_type: 'text',
        provider: 'openai_compatible',
        name: 'Newer same priority',
        base_url: 'https://provider.example/v1',
        api_key: 'k2',
        model: ['b'],
        default_model: 'b',
        priority: 5,
      });
      const markedDefault = aiConfigService.createConfig(db, log, {
        service_type: 'text',
        provider: 'openai_compatible',
        name: 'Default lower priority',
        base_url: 'https://provider.example/v1',
        api_key: 'k3',
        model: ['c'],
        default_model: 'c',
        is_default: true,
        priority: 1,
      });
      db.prepare('UPDATE ai_service_configs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', older.id);
      db.prepare('UPDATE ai_service_configs SET created_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', newer.id);
      db.prepare('UPDATE ai_service_configs SET created_at = ? WHERE id = ?').run('2026-01-03T00:00:00.000Z', markedDefault.id);
      assert.deepEqual(
        aiConfigService.listConfigs(db, 'text').map((item) => item.id),
        [markedDefault.id, newer.id, older.id],
      );
    } finally {
      db.close();
    }
  });
});

describe('aiConfigList fail-closed 选择', () => {
  it('指定不存在的供应商时不偷用其他配置', () => {
    const selected = aiConfigList.selectServiceConfig([
      config({ id: 10, is_default: true, provider: 'openai' }),
    ], { preferredProvider: 'dashscope' });
    assert.equal(selected.config, null);
    assert.equal(selected.reason, 'provider_not_found');
  });

  it('跨供应商同名模型没有默认可消歧时返回 null', () => {
    const selected = aiConfigList.selectServiceConfig([
      config({ id: 1, provider: 'cloud-a', model: ['same-name'] }),
      config({ id: 2, provider: 'custom-gateway', model: ['same-name'] }),
    ], { preferredModel: 'same-name' });
    assert.equal(selected.config, null);
    assert.equal(selected.ambiguous, true);
  });

  it('有默认配置时可消歧同名模型，同供应商则取排序后的第一条', () => {
    const withDefault = aiConfigList.selectServiceConfig([
      config({ id: 1, provider: 'cloud-a', model: ['same-name'], is_default: true }),
      config({ id: 2, provider: 'custom-gateway', model: ['same-name'] }),
    ], { preferredModel: ' same-name ' });
    assert.equal(withDefault.config.id, 1);

    const sameProvider = aiConfigList.selectServiceConfig([
      config({ id: 3, provider: 'openai', model: ['dup'] }),
      config({ id: 4, provider: 'openai', model: ['dup'] }),
    ], { preferredModel: 'dup' });
    assert.equal(sameProvider.config.id, 3);
    assert.equal(sameProvider.ambiguous, false);
  });

  it('指定模型未命中时回到默认配置，不改用其他模型名', () => {
    const selected = aiConfigList.selectServiceConfig([
      config({ id: 40, is_default: true, model: ['video-default'], default_model: 'video-default' }),
    ], { preferredModel: 'retired-video-model' });
    assert.equal(selected.config.id, 40);
    assert.equal(selected.reason, 'default');
    assert.throws(
      () => aiConfigService.resolveConfiguredModel(selected.config, 'retired-video-model'),
      { code: 'INVALID_AI_CONFIG' },
    );
  });

  it('忽略未启用配置，没有启用项时不回退', () => {
    const selected = aiConfigList.selectServiceConfig([
      config({ id: 8, is_active: false, is_default: true }),
    ]);
    assert.equal(selected.config, null);
    assert.equal(selected.reason, 'no_active');
  });

  it('rowToConfig 展开 TTS settings 中的 voice_id / group_id', () => {
    const mapped = aiConfigList.rowToConfig({
      id: 9,
      service_type: 'tts',
      provider: 'minimax',
      settings: JSON.stringify({ voice_id: 'voice-1', group_id: 'group-1' }),
      model: JSON.stringify(['speech-01']),
      default_model: 'speech-01',
      is_default: 1,
      is_active: 1,
      priority: 0,
    });
    assert.equal(mapped.voice_id, 'voice-1');
    assert.equal(mapped.group_id, 'group-1');
    assert.deepEqual(mapped.model, ['speech-01']);
    assert.equal(mapped.is_default, true);
  });
});

describe('客户端列表选择走共享 helper', () => {
  it('图片和视频在跨供应商歧义时也不偷用配置', () => {
    const original = aiConfigService.listConfigs;
    aiConfigService.listConfigs = () => [
      config({ id: 1, provider: 'cloud-a', model: ['same-name'] }),
      config({ id: 2, provider: 'custom-gateway', model: ['same-name'] }),
    ];
    try {
      assert.equal(imageClient.getDefaultImageConfig({}, 'same-name', null, 'image'), null);
      assert.equal(videoClient.getDefaultVideoConfig({}, 'same-name', null), null);
    } finally {
      aiConfigService.listConfigs = original;
    }
  });
});
