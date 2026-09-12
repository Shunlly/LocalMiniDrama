'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const {
  isRealMediaPath,
  isMockProviderName,
  containsMockReference,
  firstRealAsset,
  isNonMockProviderRow,
  isNonMockGenerationRow,
  hasTimelineForEpisodes,
  runQaChecks,
} = require('../src/services/qaServiceChecks');

test('真实媒体路径规则拒绝空值、mock 和 placeholder', () => {
  assert.equal(isRealMediaPath(''), false);
  assert.equal(isRealMediaPath('mock://characters/aria.png'), false);
  assert.equal(isRealMediaPath('placeholder://scene.png'), false);
  assert.equal(isRealMediaPath('storage/characters/aria.png'), true);
});

test('mock 提供方与嵌套引用判定', () => {
  assert.equal(isMockProviderName('mock-compositor'), true);
  assert.equal(isMockProviderName('mock-image'), true);
  assert.equal(isMockProviderName('dashscope'), false);
  assert.equal(containsMockReference({ reference_asset: 'mock://a.png' }), true);
  assert.equal(containsMockReference({ nested: [{ url: 'placeholder://b.png' }] }), true);
  assert.equal(containsMockReference({ nested: [{ url: 'storage/a.png' }] }), false);
  assert.equal(firstRealAsset({ image_url: 'mock://a.png', local_path: 'storage/a.png' }, ['image_url', 'local_path']), 'storage/a.png');
});

test('非占位生成与提供方行判定', () => {
  assert.equal(isNonMockGenerationRow({
    provider: 'dashscope',
    image_url: 'storage/a.png',
  }), true);
  assert.equal(isNonMockGenerationRow({
    provider: 'mock',
    image_url: 'storage/a.png',
  }), false);
  assert.equal(isNonMockProviderRow({
    provider_name: 'dashscope',
    provider_type: 'text',
    mode: 'live',
    status: 'success',
    output_json: JSON.stringify({ response_text: 'ok', response_sha256: 'abc' }),
  }), true);
  assert.equal(isNonMockProviderRow({
    provider_name: 'dashscope',
    provider_type: 'image',
    mode: 'live',
    status: 'success',
    output_json: JSON.stringify({ image_url: 'mock://a.png' }),
  }), false);
});

test('无分集时时间线检查直接失败', () => {
  const db = new Database(':memory:');
  const result = hasTimelineForEpisodes(db, []);
  assert.deepEqual(result, { ok: false, trackCount: 0, itemCount: 0, trackTypes: [], episodes: [] });
  db.close();
});

test('runQaChecks 在项目缺失时只返回缺失标记', () => {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const result = runQaChecks(db, { drama_id: 999, mode: 'production' });
  assert.deepEqual(result, { dramaMissing: true, dramaId: 999 });
  db.close();
});
