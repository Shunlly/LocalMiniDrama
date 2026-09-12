const assert = require('node:assert/strict');
const test = require('node:test');

const characterLibraryService = require('../src/services/characterLibraryService');
const assembly = require('../src/services/characterLibraryAssembly');
const { rowToItem, resolveImageUrl } = assembly;

const DRAMA_ACTIVE = 11;
const CHARACTER_ACTIVE = 1101;
const LIBRARY_DRAMA = 6606;

test('跨模块 ID 在装配用例里互不相等，避免碰巧同值假通过', () => {
  assert.notEqual(DRAMA_ACTIVE, CHARACTER_ACTIVE);
  assert.notEqual(DRAMA_ACTIVE, LIBRARY_DRAMA);
  assert.notEqual(CHARACTER_ACTIVE, LIBRARY_DRAMA);
});

test('characterLibraryService 不把行装配函数暴露为公开 API', () => {
  assert.equal(typeof characterLibraryService.rowToItem, 'undefined');
  assert.equal(typeof characterLibraryService.resolveImageUrl, 'undefined');
});

test('行装配会把空的 drama_id / source_id 转成 null，并给 source_type 默认值', () => {
  const item = rowToItem({
    id: LIBRARY_DRAMA,
    drama_id: null,
    name: '英雄',
    category: '主角',
    image_url: '/static/projects/hero.png',
    local_path: 'projects/hero.png',
    description: '黑发',
    tags: 'lead',
    source_type: null,
    source_id: null,
    created_at: '2026-01-03',
    updated_at: '2026-01-04',
  });
  assert.equal(item.id, LIBRARY_DRAMA);
  assert.equal(item.drama_id, null);
  assert.equal(item.name, '英雄');
  assert.equal(item.category, '主角');
  assert.equal(item.image_url, '/static/projects/hero.png');
  assert.equal(item.local_path, 'projects/hero.png');
  assert.equal(item.description, '黑发');
  assert.equal(item.tags, 'lead');
  assert.equal(item.source_type, 'generated');
  assert.equal(item.source_id, null);
  assert.equal(item.created_at, '2026-01-03');
  assert.equal(item.updated_at, '2026-01-04');
  assert.equal(rowToItem({ id: LIBRARY_DRAMA, drama_id: DRAMA_ACTIVE, source_type: 'character', source_id: String(CHARACTER_ACTIVE) }).drama_id, DRAMA_ACTIVE);
  assert.equal(rowToItem({ id: LIBRARY_DRAMA, drama_id: 0 }).drama_id, 0);
});

test('图片 URL 兜底不把 data URL 当最终地址，空值保持原语义', () => {
  assert.equal(resolveImageUrl('/static/a.png', 'projects/a.png'), '/static/a.png');
  assert.equal(resolveImageUrl('https://cdn.example/a.png', null), 'https://cdn.example/a.png');
  assert.equal(resolveImageUrl('', 'projects/hero.png'), '/static/projects/hero.png');
  assert.equal(resolveImageUrl(null, 'projects/hero.png'), '/static/projects/hero.png');
  assert.equal(resolveImageUrl('data:image/png;base64,abc', 'projects/hero.png'), '/static/projects/hero.png');
  assert.equal(resolveImageUrl('data:image/png;base64,abc', ''), 'data:image/png;base64,abc');
  assert.equal(resolveImageUrl('', ''), null);
  assert.equal(resolveImageUrl(null, null), null);
});