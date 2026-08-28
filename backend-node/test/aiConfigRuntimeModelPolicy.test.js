const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const aiConfigService = require('../src/services/aiConfigService');
const aiClient = require('../src/services/aiClient');

function config(overrides = {}) {
  return {
    id: 7,
    service_type: 'text',
    provider: 'openai_compatible',
    model: ['current-model', 'secondary-model'],
    default_model: 'current-model',
    is_active: true,
    ...overrides,
  };
}

test('runtime model resolution rejects a historical stale default before honoring a preferred model', () => {
  assert.throws(
    () => aiConfigService.resolveConfiguredModel(
      config({ default_model: 'retired-model' }),
      'current-model',
      'fallback-model',
    ),
    (error) => {
      assert.equal(error.code, 'INVALID_AI_CONFIG');
      assert.equal(error.status, 400);
      assert.deepEqual(error.details, {
        field: 'default_model',
        issue: 'not_in_model_list',
      });
      assert.doesNotMatch(error.message, /retired-model|current-model/);
      return true;
    },
  );
});

test('runtime model resolution rejects an unavailable preferred model instead of falling back', () => {
  assert.throws(
    () => aiConfigService.resolveConfiguredModel(config(), 'retired-model', 'fallback-model'),
    (error) => {
      assert.equal(error.code, 'INVALID_AI_CONFIG');
      assert.deepEqual(error.details, {
        field: 'model',
        issue: 'not_in_model_list',
      });
      assert.doesNotMatch(error.message, /retired-model|current-model/);
      return true;
    },
  );
});

test('runtime model resolution preserves normalized default, first-model, and empty-list fallback behavior', () => {
  assert.equal(
    aiConfigService.resolveConfiguredModel(config({ default_model: ' current-model ' })),
    'current-model',
  );
  assert.equal(
    aiConfigService.resolveConfiguredModel(config({ default_model: '  ', model: [' first ', '', 'first'] })),
    'first',
  );
  assert.equal(
    aiConfigService.resolveConfiguredModel(config({ default_model: null, model: [] }), null, ' fallback '),
    'fallback',
  );
});

test('text runtime uses the fail-closed shared model resolver', () => {
  assert.throws(
    () => aiClient.getModelFromConfig(config({ default_model: 'retired-model' }), 'current-model'),
    { code: 'INVALID_AI_CONFIG' },
  );
  assert.throws(
    () => aiClient.getModelFromConfig(config(), 'retired-model'),
    { code: 'INVALID_AI_CONFIG' },
  );
});

test('every Provider dispatch model selector delegates to the shared fail-closed policy', () => {
  const serviceRoot = path.join(__dirname, '..', 'src', 'services');
  const files = [
    'aiClient.js',
    'imageClient.js',
    'videoClient.js',
    'videoService.js',
    'ttsService.js',
    'sourceMediaExtractionService.js',
    'providerSdkService.js',
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(serviceRoot, file), 'utf8');
    assert.match(
      source,
      /resolveConfiguredModel\s*\(/,
      `${file} must resolve dispatch models through the shared fail-closed policy`,
    );
  }
});
