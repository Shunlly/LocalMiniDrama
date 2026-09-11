const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeImageUrl,
  parseJsonColumn,
  parseStoryboardCharacters,
  rowToDrama,
  rowToEpisode,
  rowToStoryboard,
  rowToCharacter,
  rowToScene,
  rowToProp,
} = require('../src/services/dramaAssembly');

test('装配会丢掉 data URL，保留普通图片地址', () => {
  assert.equal(sanitizeImageUrl(null), null);
  assert.equal(sanitizeImageUrl(''), null);
  assert.equal(sanitizeImageUrl('data:image/png;base64,abc'), null);
  assert.equal(sanitizeImageUrl('/static/dramas/1/cover.png'), '/static/dramas/1/cover.png');
});

test('JSON 列解析兼容对象、空值和损坏字符串', () => {
  assert.equal(parseJsonColumn(null), null);
  assert.equal(parseJsonColumn(''), null);
  assert.deepEqual(parseJsonColumn({ a: 1 }), { a: 1 });
  assert.deepEqual(parseJsonColumn('{"a":2}'), { a: 2 });
  assert.equal(parseJsonColumn('{not-json'), null);
});

test('分镜角色字段同时接受对象 ID 和纯数字', () => {
  assert.deepEqual(parseStoryboardCharacters(null), []);
  assert.deepEqual(parseStoryboardCharacters('{"id":1}'), []);
  assert.deepEqual(parseStoryboardCharacters('[1, {"id":"2"}, "x"]'), [1, 2]);
});

test('剧本行装配会解析 metadata，并标出回收状态', () => {
  const drama = rowToDrama({
    id: 8,
    title: '示例',
    metadata: '{"aspect_ratio":"16:9"}',
    deleted_at: '2026-07-01',
    trash_state: 'recycling',
  });
  assert.equal(drama.id, 8);
  assert.deepEqual(drama.metadata, { aspect_ratio: '16:9' });
  assert.equal(drama.is_removed, true);
  assert.equal(drama.removed_at, '2026-07-01');
  assert.equal(drama.recycle_state, 'recycling');
  assert.equal(drama.style, 'realistic');
  assert.deepEqual(rowToDrama({ id: 9, metadata: '{bad' }).metadata, {});
  assert.deepEqual(rowToDrama({ id: 10, metadata: { keep: true } }).metadata, { keep: true });
});

test('分镜行装配会清洗图片并规范化创作模式', () => {
  const storyboard = rowToStoryboard({
    id: 3,
    episode_id: 1,
    storyboard_number: 2,
    duration: null,
    creation_mode: 'other',
    image_url: 'data:image/png;base64,xx',
    last_frame_image_url: 'https://cdn.example.test/last.webp',
    characters: '[4, {"id":5}]',
    reference_images: '[{"id":9}]',
  });
  assert.equal(storyboard.image_url, null);
  assert.equal(storyboard.last_frame_image_url, 'https://cdn.example.test/last.webp');
  assert.equal(storyboard.creation_mode, 'classic');
  assert.deepEqual(storyboard.characters, [4, 5]);
  assert.deepEqual(storyboard.reference_images, [{ id: 9 }]);
  assert.equal(rowToStoryboard({ id: 4, creation_mode: 'universal' }).creation_mode, 'universal');
});

test('角色场景道具装配会清洗主图并解析 Seedance 素材 JSON', () => {
  const character = rowToCharacter({
    id: 1,
    drama_id: 2,
    name: '阿宁',
    image_url: 'data:image/png;base64,xx',
    seedance2_asset: '{"asset_id":"a1"}',
    seedance2_voice_asset: '{bad',
  });
  assert.equal(character.image_url, null);
  assert.deepEqual(character.seedance2_asset, { asset_id: 'a1' });
  assert.equal(character.seedance2_voice_asset, null);
  assert.equal(rowToScene({ id: 2, image_url: 'data:image/jpeg;base64,yy' }).image_url, null);
  assert.equal(rowToProp({ id: 3, image_url: '/static/prop.webp' }).image_url, '/static/prop.webp');
  assert.equal(rowToEpisode({ id: 7, drama_id: 2 }).status, 'draft');
});
