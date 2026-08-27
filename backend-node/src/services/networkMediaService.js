'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { loadConfig } = require('../config');
const { secureHttpFetch } = require('./secureHttpFetch');
const uploadService = require('./uploadService');

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_ORIGIN = 'https://commons.wikimedia.org';
const USER_AGENT = 'LocalMiniDrama/1.0 (Wikimedia Commons media search)';
const SEARCH_RESPONSE_LIMIT = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/gif', 'image'],
  ['image/webp', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
]);

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
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function mediaTypeForMime(mimeType) {
  return ALLOWED_MIME_TYPES.get(mimeTypeOf(mimeType)) || null;
}

function commonsSourceUrl(title) {
  return `${COMMONS_ORIGIN}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
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
    throw serviceError('NETWORK_MEDIA_UPSTREAM', 'Wikimedia Commons 服务暂时不可用', 502);
  }
}

async function fetchCommonsJson(params, options = {}) {
  const url = new URL(COMMONS_API_URL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetchResponse(url, SEARCH_RESPONSE_LIMIT, options);
  if (!response.ok) {
    throw serviceError('NETWORK_MEDIA_UPSTREAM', 'Wikimedia Commons 服务暂时不可用', 502);
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

function parseSearchQuery(query = {}) {
  const keyword = textValue(query.keyword, 200);
  if (!keyword) throw badRequest('keyword 不能为空');
  const type = textValue(query.type, 20);
  const legacyMediaType = textValue(query.media_type, 20);
  if (type && legacyMediaType && type !== legacyMediaType) {
    throw badRequest('type 与 media_type 不能冲突');
  }
  const mediaType = type || legacyMediaType || 'all';
  if (!['all', 'image', 'video'].includes(mediaType)) {
    throw badRequest('type 仅支持 all、image 或 video');
  }
  const page = Math.max(1, Math.min(100, Number.parseInt(query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(query.page_size, 10) || 20));
  return { keyword, mediaType, page, pageSize };
}

async function search(query, options = {}) {
  const { keyword, mediaType, page, pageSize } = parseSearchQuery(query);
  const requestedLimit = Math.min(50, mediaType === 'all' ? pageSize : pageSize * 2);
  const payload = await fetchCommonsJson({
    action: 'query',
    format: 'json',
    formatversion: 2,
    generator: 'search',
    gsrnamespace: 6,
    gsrsearch: keyword,
    gsrlimit: requestedLimit,
    gsroffset: (page - 1) * requestedLimit,
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
    .filter((item) => item && (mediaType === 'all' || item.media_type === mediaType))
    .slice(0, pageSize)
    .map(({ mime_type, file_size, commons_title, ...item }) => item);
  return {
    items,
    page,
    page_size: pageSize,
    has_more: Boolean(payload?.continue),
    source: 'Wikimedia Commons',
  };
}

function commonsTitleFromSource(sourceUrl) {
  const raw = textValue(sourceUrl, 4096);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw badRequest('source_url 必须是 Wikimedia Commons 文件页');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== COMMONS_ORIGIN || parsed.username || parsed.password) {
    throw badRequest('source_url 必须是 Wikimedia Commons 的 HTTPS 文件页');
  }
  const match = parsed.pathname.match(/^\/wiki\/(File%3A|File:)(.+)$/i);
  if (!match) throw badRequest('source_url 必须是 Wikimedia Commons 文件页');
  let title;
  try {
    title = `File:${decodeURIComponent(match[2]).replace(/_/g, ' ')}`;
  } catch (_) {
    throw badRequest('source_url 包含无效的文件标题');
  }
  if (title.length > 600 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw badRequest('source_url 包含无效的文件标题');
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
  const item = await resolveCommonsItem(request.source_url, options);
  if (!item.license || item.license === '未注明') {
    throw serviceError('NETWORK_MEDIA_LICENSE_MISSING', '该网络素材没有可验证的许可信息，已拒绝导入', 422);
  }
  if (request.media_type && request.media_type !== item.media_type) {
    throw badRequest('media_type 与 Wikimedia Commons 素材类型不一致');
  }
  const maxBytes = item.media_type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (item.file_size && item.file_size > maxBytes) {
    throw serviceError('NETWORK_MEDIA_TOO_LARGE', '网络素材超过允许的大小限制', 413);
  }

  const response = await fetchResponse(item.download_url, maxBytes, options, `${item.media_type}/*`);
  if (!response.ok) {
    throw serviceError('NETWORK_MEDIA_DOWNLOAD_FAILED', '网络素材下载失败', 502);
  }
  const responseMime = mimeTypeOf(response.headers.get('content-type'));
  if (mediaTypeForMime(responseMime) !== item.media_type || responseMime !== item.mime_type) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT_TYPE', '网络素材 Content-Type 不受支持或与来源不一致', 415);
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
  if (detected.mimeType !== item.mime_type) {
    throw serviceError('NETWORK_MEDIA_INVALID_CONTENT', '网络素材内容与声明格式不一致', 415);
  }
  if (!item.commons_sha1) {
    throw serviceError('NETWORK_MEDIA_HASH_MISSING', 'Wikimedia Commons 未提供可验证的内容哈希', 422);
  }
  const contentSha1 = createHash('sha1').update(buffer).digest('hex');
  if (contentSha1 !== item.commons_sha1) {
    throw serviceError('NETWORK_MEDIA_HASH_MISMATCH', '网络素材内容与 Wikimedia Commons 哈希不一致', 422);
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
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ORPHAN_CLEANUP_INTERVAL_MS,
  commonsTitleFromSource,
  cleanupOrphans,
  prepareImport,
  resolveCommonsItem,
  search,
};
