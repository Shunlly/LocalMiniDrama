'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const networkMediaService = require('../src/services/networkMediaService');
const {
  NETWORK_MEDIA_MESSAGES,
} = require('../src/services/networkMediaErrors');
const {
  SUPPORTED_SEARCH_SOURCES,
  commonsTitleFromSource,
  detectImportSource,
  extractOpenverseId,
  formatOpenverseLicense,
  isOpenverseId,
  normalizeCommonsPage,
  normalizeOpenverseImage,
  parseSearchQuery,
  proxyThumbnailUrl,
} = require('../src/services/networkMediaNormalize');

const COMMONS_PAGE_ID = 10;
const OPENVERSE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPENVERSE_ID = '22222222-2222-4222-8222-222222222222';
const COMMONS_SOURCE_URL = 'https://commons.wikimedia.org/wiki/File%3ASafe_Test.png';
const OPENVERSE_SOURCE_URL = `https://openverse.org/image/${OPENVERSE_ID}`;
const DOWNLOAD_URL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Safe_Test.png';

test('跨来源 ID 在规范化用例里互不相等，避免碰巧同值假通过', () => {
  assert.notEqual(String(COMMONS_PAGE_ID), OPENVERSE_ID);
  assert.notEqual(OPENVERSE_ID, OTHER_OPENVERSE_ID);
  assert.equal(isOpenverseId(OPENVERSE_ID), true);
  assert.equal(isOpenverseId(COMMONS_PAGE_ID), false);
  assert.equal(isOpenverseId(String(COMMONS_PAGE_ID)), false);
});

test('networkMediaService 不把查询规范化函数暴露为公开 API', () => {
  assert.equal(typeof networkMediaService.parseSearchQuery, 'undefined');
  assert.equal(typeof networkMediaService.normalizeCommonsPage, 'undefined');
  assert.equal(typeof networkMediaService.normalizeOpenverseImage, 'undefined');
  assert.equal(typeof networkMediaService.extractOpenverseId, 'undefined');
  assert.equal(networkMediaService.commonsTitleFromSource, commonsTitleFromSource);
  assert.equal(networkMediaService.detectImportSource, detectImportSource);
  assert.equal(networkMediaService.isOpenverseId, isOpenverseId);
});

test('搜索参数规范化拒绝空关键词、冲突类型和付费图库来源', () => {
  assert.throws(
    () => parseSearchQuery({ keyword: '  ' }),
    (error) => error.code === 'BAD_REQUEST' && error.message === NETWORK_MEDIA_MESSAGES.KEYWORD_REQUIRED
  );
  assert.throws(
    () => parseSearchQuery({ keyword: 'rain', type: 'image', media_type: 'video' }),
    (error) => error.code === 'BAD_REQUEST' && error.message === NETWORK_MEDIA_MESSAGES.MEDIA_TYPE_CONFLICT
  );
  assert.throws(
    () => parseSearchQuery({ keyword: 'rain', type: 'audio' }),
    (error) => error.code === 'BAD_REQUEST' && error.message === NETWORK_MEDIA_MESSAGES.MEDIA_TYPE_UNSUPPORTED
  );
  assert.throws(
    () => parseSearchQuery({ keyword: 'rain', source: 'pexels' }),
    (error) => error.code === 'BAD_REQUEST'
      && error.message === NETWORK_MEDIA_MESSAGES.SOURCE_UNSUPPORTED
      && !error.message.includes('pexels')
      && !error.message.includes('source')
  );
  assert.throws(
    () => parseSearchQuery({ keyword: 'rain', source: 'unsplash' }),
    (error) => error.message === NETWORK_MEDIA_MESSAGES.SOURCE_UNSUPPORTED
  );
  assert.deepEqual(SUPPORTED_SEARCH_SOURCES, ['all', 'commons', 'openverse']);
  assert.deepEqual(parseSearchQuery({ keyword: '  safe  ', media_type: 'image', page: '0', page_size: '999' }), {
    keyword: 'safe',
    mediaType: 'image',
    source: 'all',
    page: 1,
    pageSize: 50,
  });
});

test('Commons 记录规范化会清洗作者 HTML，并丢弃不安全或不受支持的文件', () => {
  const page = {
    pageid: COMMONS_PAGE_ID,
    title: 'File:Safe Test.png',
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
        Artist: { value: '<a href="/wiki/User:Alice">Alice &amp; Bob</a>' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      },
    }],
  };
  const item = normalizeCommonsPage(page);
  assert.equal(item.source, 'commons');
  assert.equal(item.commons_page_id, COMMONS_PAGE_ID);
  assert.equal(item.author, 'Alice & Bob');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.source_url, COMMONS_SOURCE_URL);
  assert.equal(normalizeCommonsPage({ missing: true, title: 'File:Gone.png' }), null);
  assert.equal(normalizeCommonsPage({
    ...page,
    imageinfo: [{ ...page.imageinfo[0], url: 'http://upload.wikimedia.org/unsafe.png' }],
  }), null);
  assert.equal(normalizeCommonsPage({
    ...page,
    imageinfo: [{ ...page.imageinfo[0], mime: 'image/svg+xml' }],
  }), null);
});

test('Openverse 记录规范化会丢掉成熟内容、非法 ID 和视频文件类型', () => {
  const record = {
    id: OPENVERSE_ID,
    title: 'Openverse Safe',
    foreign_landing_url: 'https://www.flickr.com/photos/alice/123',
    url: 'https://live.staticflickr.com/65535/openverse-safe.png',
    creator: 'Ada',
    license: 'by-sa',
    license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    provider: 'flickr',
    filetype: 'png',
    width: 1,
    height: 1,
    mature: false,
  };
  const item = normalizeOpenverseImage(record);
  assert.equal(item.openverse_id, OPENVERSE_ID);
  assert.equal(item.source, 'openverse');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.source_site, 'Flickr');
  assert.equal(item.thumbnail_url, proxyThumbnailUrl(OPENVERSE_ID));
  assert.equal(normalizeOpenverseImage({ ...record, mature: true }), null);
  assert.equal(normalizeOpenverseImage({ ...record, id: String(COMMONS_PAGE_ID) }), null);
  assert.equal(normalizeOpenverseImage({ ...record, filetype: 'mp4' }), null);
  assert.equal(formatOpenverseLicense('cc0', '1.0'), 'CC0 1.0');
  assert.equal(formatOpenverseLicense('pdm', ''), 'Public Domain Mark');
});

test('导入来源识别不把 Commons 页面 ID 当成 Openverse ID', () => {
  assert.equal(detectImportSource({ source: 'openverse', source_url: COMMONS_SOURCE_URL }), 'openverse');
  assert.equal(detectImportSource({ source: 'commons', openverse_id: OPENVERSE_ID }), 'commons');
  assert.equal(detectImportSource({ openverse_id: OPENVERSE_ID }), 'openverse');
  assert.equal(detectImportSource({ openverse_id: String(COMMONS_PAGE_ID) }), 'commons');
  assert.equal(detectImportSource({ source_url: OPENVERSE_SOURCE_URL }), 'openverse');
  assert.equal(detectImportSource({ source_url: COMMONS_SOURCE_URL }), 'commons');
  assert.equal(extractOpenverseId({ openverse_id: OPENVERSE_ID, source_url: COMMONS_SOURCE_URL }), OPENVERSE_ID);
  assert.equal(extractOpenverseId({ source_url: OPENVERSE_SOURCE_URL }), OPENVERSE_ID);
  assert.throws(
    () => extractOpenverseId({ source_url: COMMONS_SOURCE_URL }),
    (error) => error.message === NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_URL_REQUIRED
  );
  assert.throws(
    () => commonsTitleFromSource(OPENVERSE_SOURCE_URL),
    (error) => error.message === NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_URL_REQUIRED
  );
  assert.equal(commonsTitleFromSource(COMMONS_SOURCE_URL), 'File:Safe Test.png');
});
