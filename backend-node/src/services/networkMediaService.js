'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { loadConfig } = require('../config');
const { secureHttpFetch } = require('./secureHttpFetch');
const uploadService = require('./uploadService');

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_ORIGIN = 'https://commons.wikimedia.org';
const OPENVERSE_API_ORIGIN = 'https://api.openverse.org';
const OPENVERSE_API_URL = `${OPENVERSE_API_ORIGIN}/v1`;
const OPENVERSE_ORIGIN = 'https://openverse.org';
const THUMBNAIL_PROXY_PATH = '/api/v1/assets/network-thumbnail';
const USER_AGENT = 'LocalMiniDrama/1.0 (Wikimedia Commons and Openverse media search)';
const SEARCH_RESPONSE_LIMIT = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const THUMBNAIL_CACHE_LIMIT = 400;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const OPENVERSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/gif', 'image'],
  ['image/webp', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
]);
const OPENVERSE_FILETYPES = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
]);

const thumbnailAllowlist = new Map();

function serviceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function badRequest(message) {
  return serviceError('BAD_REQUEST', message, 400);
}

function textValue(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeHttpsUrl(value, maxLength = 4096) {
  const raw = textValue(value, maxLength);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainMetadata(value, maxLength = 1000) {
  const raw = value && typeof value === 'object' ? value.value : value;
  return decodeHtmlEntities(String(raw || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function mimeTypeOf(value) {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function mediaTypeForMime(mimeType) {
  return ALLOWED_MIME_TYPES.get(mimeTypeOf(mimeType)) || null;
}

function isOpenverseId(value) {
  return OPENVERSE_ID_RE.test(String(value || '').trim());
}

function commonsSourceUrl(title) {
  return `${COMMONS_ORIGIN}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function openverseWorkUrl(id) {
  return `${OPENVERSE_ORIGIN}/image/${id}`;
}

function officialOpenverseThumbUrl(id) {
  return `${OPENVERSE_API_URL}/images/${id}/thumb/`;
}

function proxyThumbnailUrl(id) {
  const params = new URLSearchParams({ source: 'openverse', id });
  return `${THUMBNAIL_PROXY_PATH}?${params.toString()}`;
}

function resetNetworkMediaCaches() {
  thumbnailAllowlist.clear();
}

function pruneThumbnailAllowlist(now = Date.now()) {
  for (const [key, entry] of thumbnailAllowlist) {
    if (!entry || entry.expiresAt <= now) thumbnailAllowlist.delete(key);
  }
  while (thumbnailAllowlist.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailAllowlist.keys().next().value;
    thumbnailAllowlist.delete(oldest);
  }
}

function rememberOpenverseThumbnail(id, now = Date.now()) {
  const normalized = String(id || '').trim().toLowerCase();
  if (!isOpenverseId(normalized)) return;
  pruneThumbnailAllowlist(now);
  const key = `openverse:${normalized}`;
  thumbnailAllowlist.delete(key);
  thumbnailAllowlist.set(key, {
    remoteUrl: officialOpenverseThumbUrl(normalized),
    expiresAt: now + THUMBNAIL_CACHE_TTL_MS,
  });
}

function isOfficialOpenverseThumbUrl(value, id) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.origin === OPENVERSE_API_ORIGIN
      && parsed.pathname === `/v1/images/${id}/thumb/`
      && !parsed.username
      && !parsed.password;
  } catch (_) {
    return false;
  }
}

function displaySourceSite(value) {
  const raw = textValue(value, 80);
  if (!raw) return 'Openverse';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatOpenverseLicense(license, version) {
  const raw = textValue(license, 40).toLowerCase();
  const ver = textValue(version, 20);
  if (!raw) return '';
  if (raw === 'cc0') return ver ? `CC0 ${ver}` : 'CC0';
  if (raw === 'pdm') return 'Public Domain Mark';
  if (raw === 'by' || raw.startsWith('by-')) {
    const body = `CC ${raw.toUpperCase()}`;
    return ver ? `${body} ${ver}` : body;
  }
  return plainMetadata(license, 200);
}

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


function normalizeCommonsPage(page) {
  if (!page || page.missing || typeof page.title !== 'string') return null;
  const imageInfo = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  const mimeType = mimeTypeOf(imageInfo?.mime);
  const mediaType = mediaTypeForMime(mimeType);
  const downloadUrl = textValue(imageInfo?.url, 4096);
  if (!mediaType || !downloadUrl) return null;
  let parsedDownload;
  try {
    parsedDownload = new URL(downloadUrl);
  } catch (_) {
    return null;
  }
  if (parsedDownload.protocol !== 'https:' || parsedDownload.username || parsedDownload.password) return null;

  const metadata = imageInfo.extmetadata || {};
  const title = page.title.replace(/^File:/i, '').trim() || '未命名网络素材';
  return {
    kind: 'wikimedia_commons',
    source: 'commons',
    source_provider: 'Wikimedia Commons',
    source_site: 'Wikimedia Commons',
    title: title.slice(0, 500),
    thumbnail_url: textValue(imageInfo.thumburl, 4096) || downloadUrl,
    source_url: commonsSourceUrl(page.title),
    download_url: downloadUrl,
    author: plainMetadata(metadata.Artist, 500) || '未知',
    license: plainMetadata(metadata.LicenseShortName, 200) || plainMetadata(metadata.UsageTerms, 200) || '未注明',
    license_url: safeHttpsUrl(metadata.LicenseUrl?.value, 2048),
    commons_page_id: positiveInteger(page.pageid),
    commons_revision_timestamp: textValue(imageInfo.timestamp, 64),
    commons_sha1: /^[a-f0-9]{40}$/i.test(String(imageInfo.sha1 || ''))
      ? String(imageInfo.sha1).toLowerCase()
      : '',
    media_type: mediaType,
    mime_type: mimeType,
    width: positiveInteger(imageInfo.width),
    height: positiveInteger(imageInfo.height),
    file_size: positiveInteger(imageInfo.size),
    commons_title: page.title,
  };
}

function normalizeOpenverseImage(record) {
  if (!record || record.mature === true) return null;
  const id = textValue(record.id, 80).toLowerCase();
  if (!isOpenverseId(id)) return null;
  const downloadUrl = safeHttpsUrl(record.url, 4096);
  if (!downloadUrl) return null;
  const filetype = textValue(record.filetype, 20).toLowerCase().replace(/^\./, '');
  const mimeType = OPENVERSE_FILETYPES.get(filetype) || '';
  if (filetype && !mimeType) return null;
  const license = formatOpenverseLicense(record.license, record.license_version) || '未注明';
  return {
    kind: 'openverse',
    source: 'openverse',
    source_provider: 'Openverse',
    source_site: displaySourceSite(record.provider || record.source),
    title: textValue(record.title, 500) || '未命名网络素材',
    thumbnail_url: proxyThumbnailUrl(id),
    source_url: openverseWorkUrl(id),
    download_url: downloadUrl,
    author: textValue(record.creator, 500) || '未知',
    license,
    license_url: safeHttpsUrl(record.license_url, 2048),
    landing_page: safeHttpsUrl(record.foreign_landing_url, 4096),
    openverse_id: id,
    media_type: 'image',
    mime_type: mimeType,
    width: positiveInteger(record.width),
    height: positiveInteger(record.height),
    file_size: positiveInteger(record.filesize),
    indexed_on: textValue(record.indexed_on, 64),
  };
}

function toPublicSearchItem(item) {
  if (!item) return null;
  if (item.kind === 'openverse' || item.source === 'openverse') {
    rememberOpenverseThumbnail(item.openverse_id);
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
      source_provider: 'Openverse',
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
    source_provider: 'Wikimedia Commons',
    source_site: 'Wikimedia Commons',
  };
}

function networkOptions(options, maxBytes) {
  return {
    requireHttpsForPublic: true,
    lookup: options.lookup,
    timeoutMs: options.timeoutMs || 30000,
    maxBytes,
    maxRedirects: options.maxRedirects ?? 5,
  };
}

async function fetchResponse(url, maxBytes, options = {}, accept = 'application/json') {
  const fetchImpl = options.fetch || secureHttpFetch;
  const upstreamName = options.upstreamName || '\u7f51\u7edc\u7d20\u6750\u670d\u52a1';
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: options.signal,
    }, networkOptions(options, maxBytes));
  } catch (error) {
    if (error?.code === 'UNSAFE_MEDIA_REFERENCE') {
      throw serviceError('UNSAFE_NETWORK_MEDIA_URL', '网络素材地址未通过公网安全校验', 400);
    }
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw serviceError('NETWORK_MEDIA_TIMEOUT', '网络素材服务请求超时', 504);
    }
    throw serviceError('NETWORK_MEDIA_UPSTREAM', `${upstreamName}\u6682\u65f6\u4e0d\u53ef\u7528`, 502);
  }
}

async function fetchJson(url, options = {}, upstreamName = '\u7f51\u7edc\u7d20\u6750\u670d\u52a1') {
  const response = await fetchResponse(url, SEARCH_RESPONSE_LIMIT, { ...options, upstreamName }, 'application/json');
  if (!response.ok) {
    throw serviceError('NETWORK_MEDIA_UPSTREAM', `${upstreamName}\u6682\u65f6\u4e0d\u53ef\u7528`, 502);
  }
  if (mimeTypeOf(response.headers.get('content-type')) !== 'application/json') {
    throw serviceError('NETWORK_MEDIA_INVALID_RESPONSE', '网络素材服务返回了无效内容', 502);
  }
  try {
    return await response.json();
  } catch (_) {
    throw serviceError('NETWORK_MEDIA_INVALID_RESPONSE', '网络素材服务返回了无效内容', 502);
  }
}

async function fetchCommonsJson(params, options = {}) {
  const url = new URL(COMMONS_API_URL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return fetchJson(url, options, 'Wikimedia Commons \u670d\u52a1');
}


function parseSearchQuery(query = {}) {
  const keyword = textValue(query.keyword, 200);
  if (!keyword) throw badRequest('关键词不能为空');
  const type = textValue(query.type, 20);
  const legacyMediaType = textValue(query.media_type, 20);
  if (type && legacyMediaType && type !== legacyMediaType) {
    throw badRequest('素材类型参数不能冲突');
  }
  const mediaType = type || legacyMediaType || 'all';
  if (!['all', 'image', 'video'].includes(mediaType)) {
    throw badRequest('素材类型仅支持全部、图片或视频');
  }
  const source = textValue(query.source, 20) || 'all';
  if (!['all', 'commons', 'openverse'].includes(source)) {
    throw badRequest('来源仅支持全部、Wikimedia Commons 或 Openverse');
  }
  const page = Math.max(1, Math.min(100, Number.parseInt(query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(query.page_size, 10) || 20));
  return { keyword, mediaType, source, page, pageSize };
}

async function searchCommons(parsed, options = {}) {
  const requestedLimit = Math.min(50, parsed.mediaType === 'all' ? parsed.pageSize : parsed.pageSize * 2);
  const payload = await fetchCommonsJson({
    action: 'query',
    format: 'json',
    formatversion: 2,
    generator: 'search',
    gsrnamespace: 6,
    gsrsearch: parsed.keyword,
    gsrlimit: requestedLimit,
    gsroffset: (parsed.page - 1) * requestedLimit,
    prop: 'imageinfo',
    iiprop: 'url|mime|size|timestamp|sha1|extmetadata',
    iiurlwidth: 480,
  }, options);
  if (payload?.error) {
    throw serviceError('NETWORK_MEDIA_UPSTREAM', 'Wikimedia Commons 搜索请求失败', 502);
  }
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  const items = pages
    .map(normalizeCommonsPage)
    .filter((item) => item && (parsed.mediaType === 'all' || item.media_type === parsed.mediaType))
    .slice(0, parsed.pageSize)
    .map(toPublicSearchItem);
  return {
    items,
    page: parsed.page,
    page_size: parsed.pageSize,
    has_more: Boolean(payload?.continue),
    source: 'Wikimedia Commons',
    notice: '',
  };
}

async function searchOpenverse(parsed, options = {}) {
  if (parsed.mediaType === 'video') {
    return {
      items: [],
      page: parsed.page,
      page_size: parsed.pageSize,
      has_more: false,
      source: 'Openverse',
      notice: 'Openverse 目前不提供视频素材，请改用 Wikimedia Commons，或将类型改为图片。',
    };
  }
  const url = new URL(`${OPENVERSE_API_URL}/images/`);
  url.searchParams.set('q', parsed.keyword);
  url.searchParams.set('page', String(parsed.page));
  url.searchParams.set('page_size', String(Math.min(20, parsed.pageSize)));
  url.searchParams.set('mature', 'false');
  const payload = await fetchJson(url, options, 'Openverse \u670d\u52a1');
  const results = Array.isArray(payload?.results) ? payload.results : null;
  if (!results) {
    throw serviceError('NETWORK_MEDIA_UPSTREAM', 'Openverse 搜索请求失败', 502);
  }
  const items = results.map(normalizeOpenverseImage).filter(Boolean).map(toPublicSearchItem);
  const page = positiveInteger(payload?.page) || parsed.page;
  const pageCount = positiveInteger(payload?.page_count) || 0;
  return {
    items,
    page: parsed.page,
    page_size: parsed.pageSize,
    has_more: Boolean(pageCount && page < pageCount),
    source: 'Openverse',
    notice: parsed.mediaType === 'all' ? 'Openverse 目前只提供图片，视频结果不会出现在此来源中。' : '',
  };
}

async function searchOneSource(source, parsed, options) {
  return source === 'openverse' ? searchOpenverse(parsed, options) : searchCommons(parsed, options);
}

async function search(query, options = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.source === 'all' && parsed.mediaType === 'video') {
    const commons = await searchCommons(parsed, options);
    return {
      ...commons,
      notice: joinNotices([commons.notice, 'Openverse 目前不提供视频素材，请改用 Wikimedia Commons，或将类型改为图片。']),
    };
  }
  const sources = parsed.source === 'all' ? ['commons', 'openverse'] : [parsed.source];
  if (sources.length === 1) {
    return searchOneSource(sources[0], parsed, options);
  }

  const settled = await Promise.allSettled(sources.map((source) => searchOneSource(source, parsed, options)));
  const fulfilled = [];
  const notices = [];
  const labels = { commons: 'Wikimedia Commons', openverse: 'Openverse' };
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') fulfilled.push({ source, result: result.value });
    else notices.push(source === 'openverse' ? 'Openverse 暂时不可用，已跳过该来源。' : 'Wikimedia Commons 暂时不可用，已跳过该来源。');
  });
  if (!fulfilled.length) {
    const firstError = settled.find((result) => result.status === 'rejected')?.reason;
    throw firstError || serviceError('NETWORK_MEDIA_UPSTREAM', '网络素材服务暂时不可用', 502);
  }
  const mergedItems = interleaveLists(fulfilled.map((entry) => entry.result.items), parsed.pageSize);
  const leftover = fulfilled.reduce((sum, entry) => sum + entry.result.items.length, 0) > parsed.pageSize;
  return {
    items: mergedItems,
    page: parsed.page,
    page_size: parsed.pageSize,
    has_more: leftover || fulfilled.some((entry) => entry.result.has_more),
    source: fulfilled.map((entry) => labels[entry.source]).join('\u3001'),
    notice: joinNotices([
      ...fulfilled.map((entry) => entry.result.notice),
      ...notices,
    ]),
  };
}

function commonsTitleFromSource(sourceUrl) {
  const raw = textValue(sourceUrl, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw badRequest('来源地址必须是 Wikimedia Commons 的 HTTPS 文件页');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== COMMONS_ORIGIN || parsed.username || parsed.password) {
    throw badRequest('来源地址必须是 Wikimedia Commons 的 HTTPS 文件页');
  }
  const match = parsed.pathname.match(/^\/wiki\/(File%3A|File:)(.+)$/i);
  if (!match) throw badRequest('来源地址必须是 Wikimedia Commons 的 HTTPS 文件页');
  let title;
  try {
    title = `File:${decodeURIComponent(match[2]).replace(/_/g, ' ')}`;
  } catch (_) {
    throw badRequest('来源地址包含无效的文件标题');
  }
  if (title.length > 600 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw badRequest('来源地址包含无效的文件标题');
  }
  return title;
}

async function resolveCommonsItem(sourceUrl, options = {}) {
  const title = commonsTitleFromSource(sourceUrl);
  const payload = await fetchCommonsJson({
    action: 'query',
    format: 'json',
    formatversion: 2,
    redirects: 1,
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|mime|size|timestamp|sha1|extmetadata',
    iiurlwidth: 480,
  }, options);
  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  const item = normalizeCommonsPage(pages[0]);
  if (!item) throw serviceError('NETWORK_MEDIA_NOT_FOUND', '网络素材不存在或格式不受支持', 404);
  return item;
}

function extractOpenverseId(request = {}) {
  const explicit = textValue(request.openverse_id, 80).toLowerCase();
  if (isOpenverseId(explicit)) return explicit;
  const raw = textValue(request.source_url, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw badRequest('来源地址必须是 Openverse 的 HTTPS 作品页');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw badRequest('来源地址必须是 Openverse 的 HTTPS 作品页');
  }
  if (parsed.origin === OPENVERSE_ORIGIN) {
    const match = parsed.pathname.match(/^\/image\/([0-9a-f-]{36})\/?$/i);
    if (match && isOpenverseId(match[1])) return match[1].toLowerCase();
  }
  if (parsed.origin === OPENVERSE_API_ORIGIN) {
    const match = parsed.pathname.match(/^\/v1\/images\/([0-9a-f-]{36})\/?$/i);
    if (match && isOpenverseId(match[1])) return match[1].toLowerCase();
  }
  throw badRequest('来源地址必须是 Openverse 的 HTTPS 作品页');
}

function detectImportSource(request = {}) {
  const explicit = textValue(request.source, 20).toLowerCase();
  if (explicit === 'openverse' || explicit === 'commons') return explicit;
  if (isOpenverseId(request.openverse_id)) return 'openverse';
  const raw = textValue(request.source_url, 4096);
  try {
    const parsed = new URL(raw);
    if (parsed.origin === OPENVERSE_ORIGIN || parsed.origin === OPENVERSE_API_ORIGIN) return 'openverse';
    if (parsed.origin === COMMONS_ORIGIN) return 'commons';
  } catch (_) {}
  return 'commons';
}

async function resolveOpenverseItem(request, options = {}) {
  const id = extractOpenverseId(request);
  const payload = await fetchJson(`${OPENVERSE_API_URL}/images/${id}/`, options, 'Openverse \u670d\u52a1');
  const item = normalizeOpenverseImage(payload);
  if (!item) throw serviceError('NETWORK_MEDIA_NOT_FOUND', '网络素材不存在或格式不受支持', 404);
  rememberOpenverseThumbnail(item.openverse_id);
  return item;
}

async function proxyThumbnail(query = {}, options = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw badRequest('缩略图请求无效');
  }
  if (query.url != null && String(query.url).trim() !== '') {
    throw badRequest('缩略图地址必须由服务端按搜索结果代理，不能直接指定');
  }
  const source = textValue(query.source, 20).toLowerCase();
  const id = textValue(query.id, 80).toLowerCase();
  if (source !== 'openverse' || !isOpenverseId(id)) {
    throw badRequest('缩略图请求无效');
  }
  pruneThumbnailAllowlist(Number(options.nowMs) || Date.now());
  const allowed = thumbnailAllowlist.get(`openverse:${id}`);
  if (!allowed) {
    throw serviceError('NETWORK_MEDIA_THUMBNAIL_NOT_FOUND', '缩略图不存在或已过期，请重新搜索后再试', 404);
  }
  if (!isOfficialOpenverseThumbUrl(allowed.remoteUrl, id)) {
    throw badRequest('缩略图地址不在允许列表中');
  }
  const response = await fetchResponse(
    allowed.remoteUrl,
    MAX_THUMBNAIL_BYTES,
    { ...options, upstreamName: 'Openverse \u670d\u52a1' },
    'image/*'
  );
  if (!response.ok) {
    throw serviceError('NETWORK_MEDIA_THUMBNAIL_FAILED', '网络素材缩略图下载失败', 502);
  }
  const responseMime = mimeTypeOf(response.headers.get('content-type'));
  if (mediaTypeForMime(responseMime) !== 'image') {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT_TYPE', '网络素材缩略图格式不受支持', 415);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_THUMBNAIL_BYTES) {
    throw serviceError('NETWORK_MEDIA_TOO_LARGE', '网络素材缩略图为空或超过允许的大小限制', 413);
  }
  return { buffer, contentType: responseMime };
}

function configuredStorage(options = {}) {
  if (options.storageRoot) {
    return { root: path.resolve(options.storageRoot), reserveBytes: options.reserveBytes ?? 0 };
  }
  const config = loadConfig();
  const rawRoot = config?.storage?.local_path || './data/storage';
  return {
    root: path.isAbsolute(rawRoot) ? rawRoot : path.join(process.cwd(), rawRoot),
    reserveBytes: config?.storage?.upload_disk_reserve_bytes,
  };
}

function isWithinDirectory(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function resolveControlledCleanupDirectory(storageRoot) {
  const root = path.resolve(storageRoot);
  const segments = [root, path.join(root, 'library'), path.join(root, 'library', 'uploads')];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    let stat;
    try {
      stat = fs.lstatSync(segment);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw serviceError('NETWORK_MEDIA_STORAGE_UNSAFE', '网络素材清理目录包含符号链接或目录联接', 500);
    }
  }
  const realRoot = fs.realpathSync.native(root);
  const directory = segments[segments.length - 1];
  const realDirectory = fs.realpathSync.native(directory);
  if (!isWithinDirectory(realRoot, realDirectory)) {
    throw serviceError('NETWORK_MEDIA_STORAGE_UNSAFE', '网络素材清理目录越界', 500);
  }
  return { directory, realDirectory };
}

function sameFileIdentity(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs;
}

function cleanupOrphans(referencedLocalPaths, options = {}) {
  const storage = configuredStorage(options);
  const controlled = resolveControlledCleanupDirectory(storage.root);
  if (!controlled) return { removed: [], skipped: [] };
  const { directory, realDirectory } = controlled;

  const referenced = new Set(
    [...(referencedLocalPaths || [])].map((value) => String(value || '').replace(/\\/g, '/'))
  );
  const now = Number(options.nowMs) || Date.now();
  const minAgeMs = Math.max(ORPHAN_MIN_AGE_MS, Number(options.minAgeMs) || 0);
  const removablePart = /^\.network_[0-9a-f-]+\.part$/i;
  const removableFinal = /^network_[0-9a-f-]+\.(?:jpe?g|png|gif|webp|mp4|webm)$/i;
  const removed = [];
  const skipped = [];

  for (const name of fs.readdirSync(directory)) {
    const isPart = removablePart.test(name);
    const isFinal = removableFinal.test(name);
    if (!isPart && !isFinal) continue;
    const localPath = `library/uploads/${name}`;
    if (isFinal && referenced.has(localPath)) continue;
    const candidate = path.join(directory, name);
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || now - stat.mtimeMs < minAgeMs) {
      skipped.push(localPath);
      continue;
    }
    const realCandidate = fs.realpathSync.native(candidate);
    if (path.dirname(realCandidate) !== realDirectory) {
      throw serviceError('NETWORK_MEDIA_STORAGE_UNSAFE', '网络素材清理目标越界', 500);
    }
    let finalStat;
    let finalRealCandidate;
    try {
      finalStat = fs.lstatSync(candidate);
      finalRealCandidate = fs.realpathSync.native(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (
      !finalStat.isFile()
      || finalStat.isSymbolicLink()
      || finalRealCandidate !== realCandidate
      || !sameFileIdentity(stat, finalStat)
    ) {
      throw serviceError('NETWORK_MEDIA_STORAGE_UNSAFE', '网络素材清理目标在删除前发生变化', 500);
    }
    fs.unlinkSync(candidate);
    removed.push(localPath);
  }
  return { removed, skipped };
}

function removeIfPresent(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function prepareImport(request, options = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw badRequest('网络素材导入请求必须为对象');
  }
  const source = detectImportSource(request);
  const item = source === 'openverse'
    ? await resolveOpenverseItem(request, options)
    : await resolveCommonsItem(request.source_url, options);
  if (!item.license || item.license === '未注明') {
    throw serviceError('NETWORK_MEDIA_LICENSE_MISSING', '该网络素材没有可验证的许可信息，已拒绝导入', 422);
  }
  if (request.media_type && request.media_type !== item.media_type) {
    throw badRequest('素材类型与来源记录不一致');
  }
  const maxBytes = item.media_type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (item.file_size && item.file_size > maxBytes) {
    throw serviceError('NETWORK_MEDIA_TOO_LARGE', '网络素材超过允许的大小限制', 413);
  }

  const response = await fetchResponse(
    item.download_url,
    maxBytes,
    { ...options, upstreamName: source === 'openverse' ? 'Openverse \u670d\u52a1' : 'Wikimedia Commons \u670d\u52a1' },
    `${item.media_type}/*`
  );
  if (!response.ok) {
    throw serviceError('NETWORK_MEDIA_DOWNLOAD_FAILED', '网络素材下载失败', 502);
  }
  const responseMime = mimeTypeOf(response.headers.get('content-type'));
  if (mediaTypeForMime(responseMime) !== item.media_type) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT_TYPE', '网络素材内容类型不受支持或与来源不一致', 415);
  }
  if (item.mime_type && responseMime !== item.mime_type) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT_TYPE', '网络素材内容类型不受支持或与来源不一致', 415);
  }
  const finalUrl = new URL(response.url || item.download_url);
  if (finalUrl.protocol !== 'https:') {
    throw serviceError('UNSAFE_NETWORK_MEDIA_URL', '网络素材下载地址必须保持 HTTPS', 400);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) {
    throw serviceError('NETWORK_MEDIA_TOO_LARGE', '网络素材为空或超过允许的大小限制', 413);
  }

  let detected;
  try {
    detected = await uploadService.validateAllowedUpload(buffer, item.media_type);
  } catch (_) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT', '网络素材内容校验失败', 415);
  }
  if (item.mime_type && detected.mimeType !== item.mime_type) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT', '网络素材内容与声明格式不一致', 415);
  }
  const isCommons = item.kind !== 'openverse' && item.source !== 'openverse';
  if (isCommons) {
    if (!item.commons_sha1) {
      throw serviceError('NETWORK_MEDIA_HASH_MISSING', 'Wikimedia Commons 未提供可验证的内容哈希', 422);
    }
    const contentSha1 = createHash('sha1').update(buffer).digest('hex');
    if (contentSha1 !== item.commons_sha1) {
      throw serviceError('NETWORK_MEDIA_HASH_MISMATCH', '网络素材内容与 Wikimedia Commons 哈希不一致', 422);
    }
  }
  const contentSha256 = createHash('sha256').update(buffer).digest('hex');

  const storage = configuredStorage(options);
  uploadService.assertUploadDiskCapacity(storage.root, buffer.length, storage.reserveBytes);
  const directory = uploadService.ensureStorageDirectory(storage.root, 'library/uploads');
  const basename = `network_${randomUUID()}`;
  const finalName = `${basename}${detected.extension}`;
  const temporaryName = `.${basename}.part`;
  const finalPath = path.join(directory.directory, finalName);
  const temporaryPath = path.join(directory.directory, temporaryName);
  const localPath = `library/uploads/${finalName}`;
  let fd;
  try {
    fd = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
  } catch (error) {
    removeIfPresent(temporaryPath);
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  let finalized = false;
  return {
    item: {
      ...item,
      file_size: buffer.length,
      mime_type: detected.mimeType,
      resolved_download_url: finalUrl.href,
      content_sha256: contentSha256,
    },
    localPath,
    finalize() {
      if (finalized) return;
      fs.renameSync(temporaryPath, finalPath);
      finalized = true;
    },
    cleanup() {
      removeIfPresent(temporaryPath);
      if (finalized) removeIfPresent(finalPath);
    },
  };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  COMMONS_API_URL,
  OPENVERSE_API_URL,
  OPENVERSE_ORIGIN,
  THUMBNAIL_PROXY_PATH,
  MAX_IMAGE_BYTES,
  MAX_THUMBNAIL_BYTES,
  MAX_VIDEO_BYTES,
  ORPHAN_CLEANUP_INTERVAL_MS,
  commonsTitleFromSource,
  cleanupOrphans,
  detectImportSource,
  isOpenverseId,
  prepareImport,
  proxyThumbnail,
  resetNetworkMediaCaches,
  resolveCommonsItem,
  resolveOpenverseItem,
  search,
};
