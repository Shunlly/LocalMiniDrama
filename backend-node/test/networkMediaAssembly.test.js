'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const networkMediaService = require('../src/services/networkMediaService');
const { NETWORK_MEDIA_MESSAGES } = require('../src/services/networkMediaErrors');
const { normalizeCommonsPage, normalizeOpenverseImage, proxyThumbnailUrl } = require('../src/services/networkMediaNormalize');
const {
  assembleCommonsSearch,
  assembleMergedSearch,
  assembleOpenverseSearch,
  assembleOpenverseVideoUnavailable,
  interleaveLists,
  joinNotices,
  toPublicSearchItem,
  withOpenverseVideoNotice,
} = require('../src/services/networkMediaAssembly');

const COMMONS_PAGE_ID = 10;
const OPENVERSE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPENVERSE_ID = '22222222-2222-4222-8222-222222222222';
const DOWNLOAD_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Safe_Test.png';
const OPENVERSE_DOWNLOAD_URL = 'https://live.staticflickr.com/65535/openverse-safe.png';

function commonsPage(title, overrides = {}) {
  return {
    pageid: COMMONS_PAGE_ID,
    title,
    imageinfo: [{
      url: DOWNLOAD_URL,
      thumburl: 'https://upload.wikimedia.org/thumb/Safe_Test.png',
      mime: 'image/png',
      size: 12,
      width: 1,
      height: 1,
      timestamp: '2026-08-02T00:00:00Z',
      sha1: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      extmetadata: {
        Artist: { value: 'Alice' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
      },
      ...overrides,
    }],
  };
}

function openverseRecord(id, title) {
  return {
    id,
    title,
    url: OPENVERSE_DOWNLOAD_URL,
    creator: 'Ada',
    license: 'by-sa',
    license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    provider: 'flickr',
    filetype: 'png',
    width: 2,
    height: 3,
    mature: false,
    foreign_landing_url: 'https://www.flickr.com/photos/alice/123',
  };
}

test('跨来源 ID 在装配用例里互不相等', () => {
  assert.notEqual(String(COMMONS_PAGE_ID), OPENVERSE_ID);
  assert.notEqual(OPENVERSE_ID, OTHER_OPENVERSE_ID);
});

test('networkMediaService 不把结果装配函数暴露为公开 API', () => {
  assert.equal(typeof networkMediaService.toPublicSearchItem, 'undefined');
  assert.equal(typeof networkMediaService.assembleMergedSearch, 'undefined');
  assert.equal(typeof networkMediaService.joinNotices, 'undefined');
  assert.equal(typeof networkMediaService.interleaveLists, 'undefined');
});

test('公开搜索条目会藏起 Openverse 下载地址，并保留 Commons 哈希', () => {
  const commons = toPublicSearchItem(normalizeCommonsPage(commonsPage('File:Safe Test.png')));
  assert.equal(commons.source, 'commons');
  assert.equal(commons.commons_page_id, COMMONS_PAGE_ID);
  assert.equal(commons.download_url, DOWNLOAD_URL);
  assert.equal(commons.commons_sha1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(Object.prototype.hasOwnProperty.call(commons, 'openverse_id'), false);

  const openverse = toPublicSearchItem(normalizeOpenverseImage(openverseRecord(OPENVERSE_ID, 'Openverse Safe')));
  assert.equal(openverse.source, 'openverse');
  assert.equal(openverse.openverse_id, OPENVERSE_ID);
  assert.equal(openverse.download_url, '');
  assert.equal(openverse.thumbnail_url, proxyThumbnailUrl(OPENVERSE_ID));
  assert.equal(Object.prototype.hasOwnProperty.call(openverse, 'commons_page_id'), false);
  assert.equal(toPublicSearchItem(null), null);
});

test('Commons 搜索装配会按类型过滤并截断页大小', () => {
  const payload = {
    query: {
      pages: [
        commonsPage('File:Safe Test.png'),
        {
          pageid: 11,
          title: 'File:Clip.webm',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/clip.webm',
            mime: 'video/webm',
            size: 20,
            width: 4,
            height: 5,
            timestamp: '2026-08-02T00:00:00Z',
            sha1: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }],
        },
      ],
    },
    continue: { gsroffset: 20 },
  };
  const images = assembleCommonsSearch(payload, { mediaType: 'image', page: 1, pageSize: 1 });
  assert.equal(images.items.length, 1);
  assert.equal(images.items[0].media_type, 'image');
  assert.equal(images.has_more, true);
  assert.equal(images.source, NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME);

  const videos = assembleCommonsSearch(payload, { mediaType: 'video', page: 2, pageSize: 10 });
  assert.equal(videos.items.length, 1);
  assert.equal(videos.items[0].media_type, 'video');
  assert.equal(videos.page, 2);
});

test('Openverse 搜索装配在全部类型时给出仅图片说明，视频请求不伪装结果', () => {
  const payload = {
    results: [
      openverseRecord(OPENVERSE_ID, 'Openverse Safe'),
      { ...openverseRecord(OTHER_OPENVERSE_ID, 'Mature'), mature: true },
    ],
    page: 3,
    page_count: 9,
  };
  const images = assembleOpenverseSearch(payload, { mediaType: 'all', page: 1, pageSize: 20 });
  assert.equal(images.items.length, 1);
  assert.equal(images.items[0].openverse_id, OPENVERSE_ID);
  assert.equal(images.page, 3);
  assert.equal(images.has_more, true);
  assert.equal(images.notice, NETWORK_MEDIA_MESSAGES.OPENVERSE_IMAGE_ONLY);

  const video = assembleOpenverseVideoUnavailable({ page: 4, pageSize: 8 });
  assert.deepEqual(video.items, []);
  assert.equal(video.page, 4);
  assert.equal(video.page_size, 8);
  assert.equal(video.has_more, false);
  assert.equal(video.notice, NETWORK_MEDIA_MESSAGES.OPENVERSE_NO_VIDEO);
});

test('合并搜索会交错来源、去重提示，并在全部失败时抛出第一个错误', () => {
  assert.deepEqual(interleaveLists([['c1', 'c2'], ['o1', 'o2']], 3), ['c1', 'o1', 'c2']);
  assert.equal(joinNotices([' a ', 'a', '', 'b']), 'a b');

  const parsed = { page: 1, pageSize: 3 };
  const commons = assembleCommonsSearch({
    query: { pages: [commonsPage('File:Safe Test.png'), commonsPage('File:Safe Two.png')] },
  }, { mediaType: 'image', ...parsed });
  const openverse = assembleOpenverseSearch({
    results: [openverseRecord(OPENVERSE_ID, 'A'), openverseRecord(OTHER_OPENVERSE_ID, 'B')],
    page: 1,
    page_count: 1,
  }, { mediaType: 'image', ...parsed });

  const merged = assembleMergedSearch([
    { status: 'fulfilled', value: commons },
    { status: 'fulfilled', value: openverse },
  ], ['commons', 'openverse'], parsed);
  assert.deepEqual(merged.items.map((item) => item.source), ['commons', 'openverse', 'commons']);
  assert.equal(merged.source, 'Wikimedia Commons、Openverse');
  assert.equal(merged.has_more, true);

  const partial = assembleMergedSearch([
    { status: 'rejected', reason: new Error('commons down') },
    { status: 'fulfilled', value: withOpenverseVideoNotice(openverse) },
  ], ['commons', 'openverse'], parsed);
  assert.match(partial.notice, /Wikimedia Commons 暂时不可用/);
  assert.match(partial.notice, /Openverse 目前不提供视频素材/);
  assert.equal(partial.source, NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME);

  const firstError = Object.assign(new Error('第一个失败'), { code: 'NETWORK_MEDIA_UPSTREAM' });
  const secondError = Object.assign(new Error('第二个失败'), { code: 'NETWORK_MEDIA_UPSTREAM' });
  assert.throws(
    () => assembleMergedSearch([
      { status: 'rejected', reason: firstError },
      { status: 'rejected', reason: secondError },
    ], ['commons', 'openverse'], parsed),
    (error) => error === firstError
  );
});
