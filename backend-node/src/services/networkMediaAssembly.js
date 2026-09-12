/**
 * 网络素材结果装配：把规范化后的 Commons/Openverse 记录转成搜索响应。
 * 路由仍通过 networkMediaService 调用，本模块不改变公开 API。
 */

'use strict';

const {
  NETWORK_MEDIA_MESSAGES,
  upstreamTemporarilyUnavailable,
} = require('./networkMediaErrors');
const {
  normalizeCommonsPage,
  normalizeOpenverseImage,
  positiveInteger,
  proxyThumbnailUrl,
  textValue,
} = require('./networkMediaNormalize');

const SOURCE_LABELS = Object.freeze({
  commons: NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
  openverse: NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME,
});

function joinNotices(values) {
  return [...new Set((values || []).map((value) => textValue(value, 240)).filter(Boolean))].join(' ');
}

function interleaveLists(lists, limit) {
  const items = [];
  const max = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < max && items.length < limit; index += 1) {
    for (const list of lists) {
      if (index < list.length && items.length < limit) items.push(list[index]);
    }
  }
  return items;
}

function toPublicSearchItem(item) {
  if (!item) return null;
  if (item.kind === 'openverse' || item.source === 'openverse') {
    return {
      title: item.title,
      thumbnail_url: proxyThumbnailUrl(item.openverse_id),
      source_url: item.source_url,
      download_url: '',
      author: item.author,
      license: item.license,
      license_url: item.license_url,
      media_type: 'image',
      width: item.width,
      height: item.height,
      source: 'openverse',
      source_provider: item.source_provider || NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME,
      source_site: item.source_site,
      openverse_id: item.openverse_id,
      landing_page: item.landing_page,
    };
  }
  return {
    title: item.title,
    thumbnail_url: item.thumbnail_url,
    source_url: item.source_url,
    download_url: item.download_url,
    author: item.author,
    license: item.license,
    license_url: item.license_url,
    commons_page_id: item.commons_page_id,
    commons_revision_timestamp: item.commons_revision_timestamp,
    commons_sha1: item.commons_sha1,
    media_type: item.media_type,
    width: item.width,
    height: item.height,
    source: 'commons',
    source_provider: item.source_provider || NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
    source_site: item.source_site || NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
  };
}

function assembleSearchPage({ items, page, pageSize, hasMore, source, notice }) {
  return {
    items,
    page,
    page_size: pageSize,
    has_more: hasMore,
    source,
    notice: notice || '',
  };
}

function assembleCommonsSearch(payload, parsed) {
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  const items = pages
    .map(normalizeCommonsPage)
    .filter((item) => item && (parsed.mediaType === 'all' || item.media_type === parsed.mediaType))
    .slice(0, parsed.pageSize)
    .map(toPublicSearchItem);
  return assembleSearchPage({
    items,
    page: parsed.page,
    pageSize: parsed.pageSize,
    hasMore: Boolean(payload?.continue),
    source: NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
    notice: '',
  });
}

function assembleOpenverseSearch(payload, parsed) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const items = results.map(normalizeOpenverseImage).filter(Boolean).map(toPublicSearchItem);
  const page = positiveInteger(payload?.page) || parsed.page;
  const pageCount = positiveInteger(payload?.page_count) || 0;
  return assembleSearchPage({
    items,
    page,
    pageSize: parsed.pageSize,
    hasMore: Boolean(pageCount && page < pageCount),
    source: NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME,
    notice: parsed.mediaType === 'all' ? NETWORK_MEDIA_MESSAGES.OPENVERSE_IMAGE_ONLY : '',
  });
}

function assembleOpenverseVideoUnavailable(parsed) {
  return assembleSearchPage({
    items: [],
    page: parsed.page,
    pageSize: parsed.pageSize,
    hasMore: false,
    source: NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME,
    notice: NETWORK_MEDIA_MESSAGES.OPENVERSE_NO_VIDEO,
  });
}

function withOpenverseVideoNotice(commonsResult) {
  return {
    ...commonsResult,
    notice: joinNotices([commonsResult?.notice, NETWORK_MEDIA_MESSAGES.OPENVERSE_NO_VIDEO]),
  };
}

function skippedNoticeFor(source) {
  return source === 'openverse'
    ? NETWORK_MEDIA_MESSAGES.OPENVERSE_SKIPPED
    : NETWORK_MEDIA_MESSAGES.COMMONS_SKIPPED;
}

function assembleMergedSearch(settled, sources, parsed) {
  const fulfilled = [];
  const notices = [];
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') fulfilled.push({ source, result: result.value });
    else notices.push(skippedNoticeFor(source));
  });
  if (!fulfilled.length) {
    const firstError = settled.find((result) => result.status === 'rejected')?.reason;
    throw firstError || upstreamTemporarilyUnavailable();
  }
  const mergedItems = interleaveLists(fulfilled.map((entry) => entry.result.items), parsed.pageSize);
  const leftover = fulfilled.reduce((sum, entry) => sum + entry.result.items.length, 0) > parsed.pageSize;
  return assembleSearchPage({
    items: mergedItems,
    page: parsed.page,
    pageSize: parsed.pageSize,
    hasMore: leftover || fulfilled.some((entry) => entry.result.has_more),
    source: fulfilled.map((entry) => SOURCE_LABELS[entry.source]).join('、'),
    notice: joinNotices([
      ...fulfilled.map((entry) => entry.result.notice),
      ...notices,
    ]),
  });
}

module.exports = {
  SOURCE_LABELS,
  assembleCommonsSearch,
  assembleMergedSearch,
  assembleOpenverseSearch,
  assembleOpenverseVideoUnavailable,
  assembleSearchPage,
  interleaveLists,
  joinNotices,
  skippedNoticeFor,
  toPublicSearchItem,
  withOpenverseVideoNotice,
};
