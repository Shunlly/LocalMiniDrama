/**
 * 网络素材搜索规范化：查询参数、来源 URL、Commons/Openverse 记录转内部条目。
 * 路由仍通过 networkMediaService 调用，本模块不改变公开 API。
 */

'use strict';

const { NETWORK_MEDIA_MESSAGES, badRequest } = require('./networkMediaErrors');

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_ORIGIN = 'https://commons.wikimedia.org';
const OPENVERSE_API_ORIGIN = 'https://api.openverse.org';
const OPENVERSE_API_URL = `${OPENVERSE_API_ORIGIN}/v1`;
const OPENVERSE_ORIGIN = 'https://openverse.org';
const THUMBNAIL_PROXY_PATH = '/api/v1/assets/network-thumbnail';
const OPENVERSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_SEARCH_SOURCES = Object.freeze(['all', 'commons', 'openverse']);
const SUPPORTED_MEDIA_TYPES = Object.freeze(['all', 'image', 'video']);
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
  if (!raw) return NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME;
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

function parseSearchQuery(query = {}) {
  const keyword = textValue(query.keyword, 200);
  if (!keyword) throw badRequest(NETWORK_MEDIA_MESSAGES.KEYWORD_REQUIRED);
  const type = textValue(query.type, 20);
  const legacyMediaType = textValue(query.media_type, 20);
  if (type && legacyMediaType && type !== legacyMediaType) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.MEDIA_TYPE_CONFLICT);
  }
  const mediaType = type || legacyMediaType || 'all';
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.MEDIA_TYPE_UNSUPPORTED);
  }
  const source = textValue(query.source, 20) || 'all';
  if (!SUPPORTED_SEARCH_SOURCES.includes(source)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.SOURCE_UNSUPPORTED);
  }
  const page = Math.max(1, Math.min(100, Number.parseInt(query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(query.page_size, 10) || 20));
  return { keyword, mediaType, source, page, pageSize };
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
  const title = page.title.replace(/^File:/i, '').trim() || NETWORK_MEDIA_MESSAGES.UNNAMED_TITLE;
  return {
    kind: 'wikimedia_commons',
    source: 'commons',
    source_provider: NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
    source_site: NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_NAME,
    title: title.slice(0, 500),
    thumbnail_url: textValue(imageInfo.thumburl, 4096) || downloadUrl,
    source_url: commonsSourceUrl(page.title),
    download_url: downloadUrl,
    author: plainMetadata(metadata.Artist, 500) || NETWORK_MEDIA_MESSAGES.UNKNOWN_AUTHOR,
    license: plainMetadata(metadata.LicenseShortName, 200) || plainMetadata(metadata.UsageTerms, 200) || NETWORK_MEDIA_MESSAGES.LICENSE_UNSPECIFIED,
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
  const license = formatOpenverseLicense(record.license, record.license_version) || NETWORK_MEDIA_MESSAGES.LICENSE_UNSPECIFIED;
  return {
    kind: 'openverse',
    source: 'openverse',
    source_provider: NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_NAME,
    source_site: displaySourceSite(record.provider || record.source),
    title: textValue(record.title, 500) || NETWORK_MEDIA_MESSAGES.UNNAMED_TITLE,
    thumbnail_url: proxyThumbnailUrl(id),
    source_url: openverseWorkUrl(id),
    download_url: downloadUrl,
    author: textValue(record.creator, 500) || NETWORK_MEDIA_MESSAGES.UNKNOWN_AUTHOR,
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

function commonsTitleFromSource(sourceUrl) {
  const raw = textValue(sourceUrl, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_URL_REQUIRED);
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== COMMONS_ORIGIN || parsed.username || parsed.password) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_URL_REQUIRED);
  }
  const match = parsed.pathname.match(/^\/wiki\/(File%3A|File:)(.+)$/i);
  if (!match) throw badRequest(NETWORK_MEDIA_MESSAGES.COMMONS_SOURCE_URL_REQUIRED);
  let title;
  try {
    title = `File:${decodeURIComponent(match[2]).replace(/_/g, ' ')}`;
  } catch (_) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.COMMONS_TITLE_INVALID);
  }
  if (title.length > 600 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.COMMONS_TITLE_INVALID);
  }
  return title;
}

function extractOpenverseId(request = {}) {
  const explicit = textValue(request.openverse_id, 80).toLowerCase();
  if (isOpenverseId(explicit)) return explicit;
  const raw = textValue(request.source_url, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_URL_REQUIRED);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_URL_REQUIRED);
  }
  if (parsed.origin === OPENVERSE_ORIGIN) {
    const match = parsed.pathname.match(/^\/image\/([0-9a-f-]{36})\/?$/i);
    if (match && isOpenverseId(match[1])) return match[1].toLowerCase();
  }
  if (parsed.origin === OPENVERSE_API_ORIGIN) {
    const match = parsed.pathname.match(/^\/v1\/images\/([0-9a-f-]{36})\/?$/i);
    if (match && isOpenverseId(match[1])) return match[1].toLowerCase();
  }
  throw badRequest(NETWORK_MEDIA_MESSAGES.OPENVERSE_SOURCE_URL_REQUIRED);
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

module.exports = {
  ALLOWED_MIME_TYPES,
  COMMONS_API_URL,
  COMMONS_ORIGIN,
  OPENVERSE_API_ORIGIN,
  OPENVERSE_API_URL,
  OPENVERSE_ORIGIN,
  SUPPORTED_MEDIA_TYPES,
  SUPPORTED_SEARCH_SOURCES,
  THUMBNAIL_PROXY_PATH,
  commonsTitleFromSource,
  detectImportSource,
  extractOpenverseId,
  formatOpenverseLicense,
  isOfficialOpenverseThumbUrl,
  isOpenverseId,
  mediaTypeForMime,
  mimeTypeOf,
  normalizeCommonsPage,
  normalizeOpenverseImage,
  officialOpenverseThumbUrl,
  parseSearchQuery,
  positiveInteger,
  proxyThumbnailUrl,
  safeHttpsUrl,
  textValue,
};