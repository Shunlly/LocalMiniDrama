const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigService = require('../src/services/aiConfigService');
const providerSdkService = require('../src/services/providerSdkService');
const {
  normalizeModelCandidates,
  configHasSelectedModel,
  filterConfigsByPreferredProvider,
  filterConfigsByPreferredModel,
  getActiveTtsConfig,
} = require('../src/services/providerSdkModels');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  return db;
}

function insertTts(db, overrides = {}) {
  return aiConfigService.createConfig(db, log, {
    service_type: 'tts',
    provider: 'openai_compatible',
    name: 'TTS',
    base_url: 'https://provider.example/v1',
    api_key: 'tts-key',
    model: ['speech-01'],
    default_model: 'speech-01',
    is_default: false,
    is_active: true,
    ...overrides,
  });
}

describe('providerSdkModels 模型列表规范化', () => {
  it('候选模型包含 model 列表和 default_model，空值不参与命中', () => {
    assert.deepEqual(
      normalizeModelCandidates({ model: [' speech-01 ', 'speech-01'], default_model: 'speech-02' }),
      [' speech-01 ', 'speech-01', 'speech-02'],
    );
    assert.equal(configHasSelectedModel({ model: ['speech-01'], default_model: 'speech-02' }, 'speech-02'), true);
    assert.equal(configHasSelectedModel({ model: 'speech-01', default_model: null }, 'speech-01'), true);
    assert.equal(configHasSelectedModel({ model: ['speech-01'], default_model: '  ' }, ''), true);
    assert.equal(configHasSelectedModel({ model: ['speech-01'] }, 'missing'), false);
  });

  it('指定供应商或模型未命中时不回退到其他配置', () => {
    const configs = [
      { id: 1, provider: 'minimax', model: ['speech-01'], default_model: 'speech-01', is_default: true },
      { id: 2, provider: 'openai_compatible', model: ['tts-1'], default_model: 'tts-1' },
    ];
    assert.deepEqual(filterConfigsByPreferredProvider(configs, 'dashscope').map((item) => item.id), []);
    assert.deepEqual(filterConfigsByPreferredModel(configs, 'retired-model').map((item) => item.id), []);
    assert.deepEqual(filterConfigsByPreferredProvider(configs, null).map((item) => item.id), [1, 2]);
    assert.deepEqual(filterConfigsByPreferredModel(configs, '').map((item) => item.id), [1, 2]);
  });

  it('getActiveTtsConfig 不跨服务类型，也不把项目 ID 当成配置 ID', () => {
    const db = createDb();
    try {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO dramas (id, title, status, created_at, updated_at)
         VALUES (11, '模型筛选项目', 'draft', ?, ?)`
      ).run(now, now);

      const text = aiConfigService.createConfig(db, log, {
        service_type: 'text',
        provider: 'openai_compatible',
        name: 'Text',
        base_url: 'https://provider.example/v1',
        api_key: 'text-key',
        model: ['speech-01'],
        default_model: 'speech-01',
        is_default: true,
      });
      const inactive = insertTts(db, {
        name: 'Inactive TTS',
        provider: 'minimax',
        model: ['speech-01'],
        default_model: 'speech-01',
        is_default: true,
      });
      db.prepare('UPDATE ai_service_configs SET is_active = 0 WHERE id = ?').run(inactive.id);
      const otherProvider = insertTts(db, {
        name: 'Other TTS',
        provider: 'minimax',
        model: ['speech-02'],
        default_model: 'speech-02',
      });
      const selected = insertTts(db, {
        name: 'Selected TTS',
        provider: 'openai_compatible',
        model: ['speech-01', 'speech-03'],
        default_model: 'speech-01',
        is_default: true,
      });
      db.prepare('UPDATE ai_service_configs SET default_model = ? WHERE id = ?').run('speech-alias', selected.id);

      assert.notEqual(11, selected.id);
      assert.notEqual(text.id, selected.id);
      assert.notEqual(inactive.id, selected.id);

      const byDefault = getActiveTtsConfig(db);
      assert.equal(byDefault.id, selected.id);

      const byProvider = getActiveTtsConfig(db, null, 'minimax');
      assert.equal(byProvider.id, otherProvider.id);

      const missingProvider = getActiveTtsConfig(db, null, 'dashscope');
      assert.equal(missingProvider, null);

      const byListedModel = getActiveTtsConfig(db, 'speech-01', 'openai_compatible');
      assert.equal(byListedModel.id, selected.id);

      const byDefaultModel = getActiveTtsConfig(db, 'speech-alias');
      assert.equal(byDefaultModel.id, selected.id);

      const missingModel = getActiveTtsConfig(db, 'retired-model');
      assert.equal(missingModel, null);

      const wrongService = getActiveTtsConfig(db, 'speech-01', 'openai_compatible');
      assert.equal(wrongService.service_type, 'tts');
      assert.notEqual(wrongService.id, text.id);
    } finally {
      db.close();
    }
  });

  it('providerSdkService 公开 API 不变，并仍走共享 fail-closed 模型解析', () => {
    assert.deepEqual(Object.keys(providerSdkService).sort(), [
      'assertProductionReadiness',
      'buildProductionTimelineCompositePlan',
      'compositeEpisodes',
      'generateAssetBibleImagesProduction',
      'generateStoryboardAudio',
      'generateStoryboardImages',
      'generateStoryboardVideos',
      'recordProviderInvocation',
    ].sort());

    const source = fs.readFileSync(path.join(__dirname, '../src/services/providerSdkService.js'), 'utf8');
    assert.match(source, /resolveConfiguredModel\s*\(/);
    assert.match(source, /require\('\.\/providerSdkProtocol'\)/);
    assert.match(source, /require\('\.\/providerSdkModels'\)/);
    assert.match(source, /require\('\.\/providerSdkErrors'\)/);
    assert.doesNotMatch(source, /function isProductionMode\s*\(/);
    assert.doesNotMatch(source, /function getActiveTtsConfig\s*\(/);
    assert.doesNotMatch(source, /function productionCompositeError\s*\(/);
  });
});