const assert = require('node:assert/strict');
const test = require('node:test');

const assetService = require('../src/services/assetService');
const assembly = require('../src/services/assetServiceAssembly');
const {
  rowToItem,
  parseNetworkSourceMetadata,
  encodeNetworkSourceMetadata,
  isUnchangedNetworkSource,
} = assembly;

const DRAMA_ACTIVE = 11;
const ASSET_ACTIVE = 1101;
const LIBRARY_DRAMA = 6606;
const OPENVERSE_ID = '123e4567-e89b-12d3-a456-426614174000';
const OPENVERSE_ID_OTHER = '223e4567-e89b-12d3-a456-426614174000';

function commonsMetadata(overrides = {}) {
  return {
    kind: 'wikimedia_commons',
    source_provider: 'Wikimedia Commons',
    source_url: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    author: '示例作者',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commons_title: 'File:Example.jpg',
    commons_page_id: 42,
    commons_revision_timestamp: '2026-01-01T00:00:00Z',
    commons_sha1: 'abc123',
    resolved_download_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg',
    content_sha256: 'sha-a',
    ...overrides,
  };
}

function openverseMetadata(overrides = {}) {
  return {
    kind: 'openverse',
    source_provider: 'Openverse',
    source_url: `https://openverse.org/image/${OPENVERSE_ID}`,
    author: '开源作者',
    license: 'by-sa',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    landing_page: `https://openverse.org/image/${OPENVERSE_ID}`,
    openverse_id: OPENVERSE_ID,
    source_site: 'flickr',
    indexed_on: '2026-01-01',
    resolved_download_url: 'https://openverse.org/image/download',
    content_sha256: 'sha-b',
    ...overrides,
  };
}

test('跨模块 ID 在装配用例里互不相等，避免碰巧同值假通过', () => {
  assert.notEqual(DRAMA_ACTIVE, ASSET_ACTIVE);
  assert.notEqual(DRAMA_ACTIVE, LIBRARY_DRAMA);
  assert.notEqual(ASSET_ACTIVE, LIBRARY_DRAMA);
});

test('assetService 不把行装配函数暴露为公开 API', () => {
  assert.equal(typeof assetService.rowToItem, 'undefined');
  assert.equal(typeof assetService.parseNetworkSourceMetadata, 'undefined');
  assert.equal(typeof assetService.encodeNetworkSourceMetadata, 'undefined');
  assert.equal(typeof assetService.isUnchangedNetworkSource, 'undefined');
});

test('行装配保留 drama_id / asset id，不把 library_id 写进结果', () => {
  const item = rowToItem({
    id: ASSET_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    library_id: LIBRARY_DRAMA,
    name: '码头夜雨',
    type: 'image',
    category: 'prop',
    url: '/static/library/uploads/a.png',
    local_path: 'library/uploads/a.png',
    file_size: 12,
    mime_type: 'image/png',
    width: 64,
    height: 96,
    duration: null,
    image_gen_id: 9,
    video_gen_id: null,
    source_drama_title: '夜雨',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  });
  assert.equal(item.id, ASSET_ACTIVE);
  assert.equal(item.drama_id, DRAMA_ACTIVE);
  assert.equal(item.library_id, undefined);
  assert.notEqual(item.id, item.drama_id);
  assert.notEqual(item.drama_id, LIBRARY_DRAMA);
  assert.equal(item.category, 'prop');
  assert.equal(item.source_drama_title, '夜雨');
  assert.equal(rowToItem({ id: ASSET_ACTIVE, drama_id: 0 }).drama_id, 0);
  assert.equal(rowToItem({ id: ASSET_ACTIVE, drama_id: null, source_drama_title: '' }).source_drama_title, null);
});

test('网络来源元数据编解码覆盖 Wikimedia / Openverse 与非法输入', () => {
  const commons = commonsMetadata();
  const parsedCommons = parseNetworkSourceMetadata(JSON.stringify(commons));
  assert.equal(parsedCommons.kind, 'wikimedia_commons');
  assert.equal(parsedCommons.commons_title, 'File:Example.jpg');
  assert.deepEqual(JSON.parse(encodeNetworkSourceMetadata(commons)), {
    kind: 'wikimedia_commons',
    source_provider: 'Wikimedia Commons',
    source_url: commons.source_url,
    author: commons.author,
    license: commons.license,
    license_url: commons.license_url,
    commons_title: commons.commons_title,
    commons_page_id: 42,
    commons_revision_timestamp: commons.commons_revision_timestamp,
    commons_sha1: commons.commons_sha1,
    resolved_download_url: commons.resolved_download_url,
    content_sha256: commons.content_sha256,
  });

  const openverse = openverseMetadata({ source: 'openverse' });
  const parsedOpenverse = parseNetworkSourceMetadata(JSON.stringify(openverse));
  assert.equal(parsedOpenverse.kind, 'openverse');
  assert.equal(parsedOpenverse.openverse_id, OPENVERSE_ID);
  assert.deepEqual(JSON.parse(encodeNetworkSourceMetadata(openverse)), {
    kind: 'openverse',
    source_provider: 'Openverse',
    source_url: openverse.source_url,
    author: openverse.author,
    license: openverse.license,
    license_url: openverse.license_url,
    landing_page: openverse.landing_page,
    openverse_id: OPENVERSE_ID,
    source_site: openverse.source_site,
    indexed_on: openverse.indexed_on,
    resolved_download_url: openverse.resolved_download_url,
    content_sha256: openverse.content_sha256,
  });

  const networked = rowToItem({
    id: ASSET_ACTIVE,
    drama_id: DRAMA_ACTIVE,
    name: '网络图',
    type: 'image',
    category: JSON.stringify(commons),
    url: '/static/library/uploads/n.png',
    local_path: 'library/uploads/n.png',
  });
  assert.equal(networked.category, 'network');
  assert.equal(networked.source_provider, 'Wikimedia Commons');
  assert.equal(networked.source_url, commons.source_url);
  assert.equal(networked.source_metadata.commons_title, 'File:Example.jpg');

  assert.equal(parseNetworkSourceMetadata('prop'), null);
  assert.equal(parseNetworkSourceMetadata('{bad'), null);
  assert.equal(parseNetworkSourceMetadata(JSON.stringify({ kind: 'openverse', source_provider: 'Openverse' })), null);
  assert.equal(parseNetworkSourceMetadata(JSON.stringify({
    ...commons,
    source_url: 'http://commons.wikimedia.org/wiki/File:Example.jpg',
  })), null);
  assert.equal(parseNetworkSourceMetadata(JSON.stringify({
    ...openverse,
    source_url: `https://user:pass@openverse.org/image/${OPENVERSE_ID}`,
  })), null);
  assert.equal(parseNetworkSourceMetadata(JSON.stringify({
    ...openverse,
    openverse_id: 'not-a-uuid',
  })), null);
});

test('网络来源是否变化按 Wikimedia 修订或 Openverse 内容哈希判断', () => {
  const commons = commonsMetadata();
  assert.equal(isUnchangedNetworkSource(commons, commons), true);
  assert.equal(isUnchangedNetworkSource(commons, commonsMetadata({ commons_sha1: 'changed' })), false);
  assert.equal(isUnchangedNetworkSource({
    commons_revision_timestamp: commons.commons_revision_timestamp,
    commons_sha1: commons.commons_sha1,
    content_sha256: commons.content_sha256,
  }, commons), true);

  const openverse = openverseMetadata();
  assert.equal(isUnchangedNetworkSource(openverse, openverseMetadata({
    openverse_id: OPENVERSE_ID.toUpperCase(),
  })), true);
  assert.equal(isUnchangedNetworkSource(openverse, openverseMetadata({
    openverse_id: OPENVERSE_ID_OTHER,
  })), false);
  assert.equal(isUnchangedNetworkSource(openverse, openverseMetadata({
    content_sha256: 'sha-other',
  })), false);

  assert.equal(isUnchangedNetworkSource({
    kind: 'other',
    content_sha256: 'x',
    source_url: 'https://example.com/a',
  }, {
    content_sha256: 'x',
    source_url: 'https://example.com/a',
  }), true);
});
