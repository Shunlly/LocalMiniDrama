'use strict';

// 网络素材搜索、导入与缩略图代理。搜索规范化、结果装配和错误文案见拆出模块。

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { loadConfig } = require('../config');
const { secureHttpFetch } = require('./secureHttpFetch');
const uploadService = require('./uploadService');
const {
  NETWORK_MEDIA_MESSAGES,
  badRequest,
  commonsSearchFailed,
  downloadFailed,
  fileTooLarge,
  hashMismatch,
  hashMissing,
  invalidContent,
  invalidContentType,
  invalidNetworkMediaResponse,
  licenseMissing,
  networkMediaNotFound,
  openverseSearchFailed,
  storageUnsafe,
  thumbnailDownloadFailed,
  thumbnailNotFound,
  translateFetchFailure,
  unsafeNetworkMediaUrl,
  upstreamTemporarilyUnavailable,
} = require('./networkMediaErrors');
const {
  ALLOWED_MIME_TYPES,
  COMMONS_API_URL,
  OPENVERSE_API_URL,
  OPENVERSE_ORIGIN,
  THUMBNAIL_PROXY_PATH,
  commonsTitleFromSource,
  detectImportSource,
  extractOpenverseId,
  isOfficialOpenverseThumbUrl,
  isOpenverseId,
  mediaTypeForMime,
  mimeTypeOf,
  normalizeCommonsPage,
  normalizeOpenverseImage,
  officialOpenverseThumbUrl,
  parseSearchQuery,
  textValue,
} = require('./networkMediaNormalize');
const {
  assembleCommonsSearch,
  assembleMergedSearch,
  assembleOpenverseSearch,
  assembleOpenverseVideoUnavailable,
  withOpenverseVideoNotice,
} = require('./networkMediaAssembly');

const USER_AGENT = 'LocalMiniDrama/1.0 (Wikimedia Commons and Openverse media search)';
const SEARCH_RESPONSE_LIMIT = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const THUMBNAIL_CACHE_LIMIT = 400;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const thumbnailAllowlist = new Map();

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

function rememberPublicOpenverseItems(items) {
  for (const item of items || []) {
    if (item?.source === 'openverse') rememberOpenverseThumbnail(item.openverse_id);
  }
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
  const upstreamName = options.upstreamName || NETWORK_MEDIA_MESSAGES.DEFAULT_UPSTREAM;
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: options.signal,
    }, networkOptions(options, maxBytes));
  } catch (error) {
    throw translateFetchFailure(error, upstreamName);
  }
}

async function fetchJson(url, options = {}, upstreamName = NETWORK_MEDIA_MESSAGES.DEFAULT_UPSTREAM) {
  const response = await fetchResponse(url, SEARCH_RESPONSE_LIMIT, { ...options, upstreamName }, 'application/json');
  if (!response.ok) {
    throw upstreamTemporarilyUnavailable(upstreamName);
  }
  if (mimeTypeOf(response.headers.get('content-type')) !== 'application/json') {
    throw invalidNetworkMediaResponse();
  }
  try {
    return await response.json();
  } catch (_) {
    throw invalidNetworkMediaResponse();
  }
}

async function fetchCommonsJson(params, options = {}) {
  const url = new URL(COMMONS_API_URL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return fetchJson(url, options, NETWORK_MEDIA_MESSAGES.COMMONS_UPSTREAM);
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
    throw commonsSearchFailed();
  }
  return assembleCommonsSearch(payload, parsed);
}

async function searchOpenverse(parsed, options = {}) {
  if (parsed.mediaType === 'video') {
    return assembleOpenverseVideoUnavailable(parsed);
  }
  const url = new URL(`${OPENVERSE_API_URL}/images/`);
  url.searchParams.set('q', parsed.keyword);
  url.searchParams.set('page', String(parsed.page));
  url.searchParams.set('page_size', String(Math.min(20, parsed.pageSize)));
  url.searchParams.set('mature', 'false');
  const payload = await fetchJson(url, options, NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM);
  const results = Array.isArray(payload?.results) ? payload.results : null;
  if (!results) {
    throw openverseSearchFailed();
  }
  const assembled = assembleOpenverseSearch(payload, parsed);
  rememberPublicOpenverseItems(assembled.items);
  return assembled;
}

async function searchOneSource(source, parsed, options) {
  return source === 'openverse' ? searchOpenverse(parsed, options) : searchCommons(parsed, options);
}

async function search(query, options = {}) {
  const parsed = parseSearchQuery(query);
  if (parsed.source === 'all' && parsed.mediaType === 'video') {
    return withOpenverseVideoNotice(await searchCommons(parsed, options));
  }
  const sources = parsed.source === 'all' ? ['commons', 'openverse'] : [parsed.source];
  if (sources.length === 1) {
    return searchOneSource(sources[0], parsed, options);
  }

  const settled = await Promise.allSettled(sources.map((source) => searchOneSource(source, parsed, options)));
  return assembleMergedSearch(settled, sources, parsed);
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
  if (!item) throw networkMediaNotFound();
  return item;
}

async function resolveOpenverseItem(request, options = {}) {
  const id = extractOpenverseId(request);
  const payload = await fetchJson(`${OPENVERSE_API_URL}/images/${id}/`, options, NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM);
  const item = normalizeOpenverseImage(payload);
  if (!item) throw networkMediaNotFound();
  rememberOpenverseThumbnail(item.openverse_id);
  return item;
}

async function proxyThumbnail(query = {}, options = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.THUMBNAIL_REQUEST_INVALID);
  }
  if (query.url != null && String(query.url).trim() !== '') {
    throw badRequest(NETWORK_MEDIA_MESSAGES.THUMBNAIL_URL_NOT_ALLOWED);
  }
  const source = textValue(query.source, 20).toLowerCase();
  const id = textValue(query.id, 80).toLowerCase();
  if (source !== 'openverse' || !isOpenverseId(id)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.THUMBNAIL_REQUEST_INVALID);
  }
  pruneThumbnailAllowlist(Number(options.nowMs) || Date.now());
  const allowed = thumbnailAllowlist.get(`openverse:${id}`);
  if (!allowed) {
    throw thumbnailNotFound();
  }
  if (!isOfficialOpenverseThumbUrl(allowed.remoteUrl, id)) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.THUMBNAIL_NOT_IN_ALLOWLIST);
  }
  const response = await fetchResponse(
    allowed.remoteUrl,
    MAX_THUMBNAIL_BYTES,
    { ...options, upstreamName: NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM },
    'image/*'
  );
  if (!response.ok) {
    throw thumbnailDownloadFailed();
  }
  const responseMime = mimeTypeOf(response.headers.get('content-type'));
  if (mediaTypeForMime(responseMime) !== 'image') {
    throw invalidContentType(NETWORK_MEDIA_MESSAGES.THUMBNAIL_TYPE_UNSUPPORTED);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_THUMBNAIL_BYTES) {
    throw fileTooLarge(NETWORK_MEDIA_MESSAGES.THUMBNAIL_TOO_LARGE);
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
      throw storageUnsafe(NETWORK_MEDIA_MESSAGES.CLEANUP_SYMLINK);
    }
  }
  const realRoot = fs.realpathSync.native(root);
  const directory = segments[segments.length - 1];
  const realDirectory = fs.realpathSync.native(directory);
  if (!isWithinDirectory(realRoot, realDirectory)) {
    throw storageUnsafe(NETWORK_MEDIA_MESSAGES.CLEANUP_DIRECTORY_ESCAPE);
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
      throw storageUnsafe(NETWORK_MEDIA_MESSAGES.CLEANUP_TARGET_ESCAPE);
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
      throw storageUnsafe(NETWORK_MEDIA_MESSAGES.CLEANUP_TARGET_CHANGED);
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
    throw badRequest(NETWORK_MEDIA_MESSAGES.IMPORT_REQUEST_INVALID);
  }
  const source = detectImportSource(request);
  const item = source === 'openverse'
    ? await resolveOpenverseItem(request, options)
    : await resolveCommonsItem(request.source_url, options);
  if (!item.license || item.license === NETWORK_MEDIA_MESSAGES.LICENSE_UNSPECIFIED) {
    throw licenseMissing();
  }
  if (request.media_type && request.media_type !== item.media_type) {
    throw badRequest(NETWORK_MEDIA_MESSAGES.MEDIA_TYPE_MISMATCH);
  }
  const maxBytes = item.media_type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (item.file_size && item.file_size > maxBytes) {
    throw fileTooLarge();
  }

  const response = await fetchResponse(
    item.download_url,
    maxBytes,
    { ...options, upstreamName: source === 'openverse' ? NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM : NETWORK_MEDIA_MESSAGES.COMMONS_UPSTREAM },
    `${item.media_type}/*`
  );
  if (!response.ok) {
    throw downloadFailed();
  }
  const responseMime = mimeTypeOf(response.headers.get('content-type'));
  if (mediaTypeForMime(responseMime) !== item.media_type) {
    throw invalidContentType();
  }
  if (item.mime_type && responseMime !== item.mime_type) {
    throw invalidContentType();
  }
  const finalUrl = new URL(response.url || item.download_url);
  if (finalUrl.protocol !== 'https:') {
    throw unsafeNetworkMediaUrl(NETWORK_MEDIA_MESSAGES.DOWNLOAD_MUST_HTTPS);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) {
    throw fileTooLarge(NETWORK_MEDIA_MESSAGES.EMPTY_OR_TOO_LARGE);
  }

  let detected;
  try {
    detected = await uploadService.validateAllowedUpload(buffer, item.media_type);
  } catch (_) {
    throw invalidContent();
  }
  if (item.mime_type && detected.mimeType !== item.mime_type) {
    throw invalidContent(NETWORK_MEDIA_MESSAGES.CONTENT_MISMATCH);
  }
  const isCommons = item.kind !== 'openverse' && item.source !== 'openverse';
  if (isCommons) {
    if (!item.commons_sha1) {
      throw hashMissing();
    }
    const contentSha1 = createHash('sha1').update(buffer).digest('hex');
    if (contentSha1 !== item.commons_sha1) {
      throw hashMismatch();
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
