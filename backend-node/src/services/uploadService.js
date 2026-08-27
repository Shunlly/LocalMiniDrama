// 与 Go UploadService 对齐：保存到 local_path，返回 url / local_path
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { execFile } = require('child_process');
const { createHash, randomUUID } = require('crypto');
const sharp = require('sharp');
const { getFfprobePath } = require('../utils/ffmpegPath');

const UPLOAD_SIGNATURE_BYTES = 64 * 1024;
const DEFAULT_UPLOAD_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STORY_SOURCE_ORIGINAL_BYTES = 20 * 1024 * 1024;
const MAX_DECODED_IMAGE_PIXELS = 64 * 1024 * 1024;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
const DEFAULT_REMOTE_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_REMOTE_MEDIA_REDIRECTS = 5;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'avc1', 'M4V ', 'F4V ', 'MSNV', 'dash', 'cmfc', 'cmfs',
]);
const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'M4A\0']);
const FILE_TYPES = Object.freeze({
  jpeg: Object.freeze({ mimeType: 'image/jpeg', extension: '.jpg', mediaType: 'image' }),
  png: Object.freeze({ mimeType: 'image/png', extension: '.png', mediaType: 'image' }),
  gif: Object.freeze({ mimeType: 'image/gif', extension: '.gif', mediaType: 'image' }),
  webp: Object.freeze({ mimeType: 'image/webp', extension: '.webp', mediaType: 'image' }),
  mp4: Object.freeze({ mimeType: 'video/mp4', extension: '.mp4', mediaType: 'video' }),
  mov: Object.freeze({ mimeType: 'video/quicktime', extension: '.mov', mediaType: 'video' }),
  webm: Object.freeze({ mimeType: 'video/webm', extension: '.webm', mediaType: 'video' }),
  mkv: Object.freeze({ mimeType: 'video/x-matroska', extension: '.mkv', mediaType: 'video' }),
  avi: Object.freeze({ mimeType: 'video/x-msvideo', extension: '.avi', mediaType: 'video' }),
  mp3: Object.freeze({ mimeType: 'audio/mpeg', extension: '.mp3', mediaType: 'audio' }),
  wav: Object.freeze({ mimeType: 'audio/wav', extension: '.wav', mediaType: 'audio' }),
  m4a: Object.freeze({ mimeType: 'audio/mp4', extension: '.m4a', mediaType: 'audio' }),
  ogg: Object.freeze({ mimeType: 'audio/ogg', extension: '.ogg', mediaType: 'audio' }),
});

class UnsupportedUploadTypeError extends Error {
  constructor(expectedMediaType = null) {
    const message = expectedMediaType === 'image'
      ? '只支持图片格式 (jpg, png, gif, webp)'
      : expectedMediaType === 'audio'
        ? '只支持音频格式 (mp3, wav, m4a, ogg)'
      : '只支持图片或视频格式 (jpg, png, gif, webp, mp4, webm, mov, avi, mkv)';
    super(message);
    this.name = 'UnsupportedUploadTypeError';
    this.code = 'UNSUPPORTED_UPLOAD_TYPE';
  }
}

class InvalidMediaContentError extends Error {
  constructor(expectedMediaType = null) {
    const target = expectedMediaType === 'image'
      ? '图片'
      : expectedMediaType === 'audio'
        ? '音频文件'
        : '媒体文件';
    super(`${target}内容无效、已截断或无法解码`);
    this.name = 'InvalidMediaContentError';
    this.code = 'INVALID_MEDIA_CONTENT';
  }
}

class MediaValidationUnavailableError extends Error {
  constructor(message = '音视频校验服务暂不可用') {
    super(message);
    this.name = 'MediaValidationUnavailableError';
    this.code = 'MEDIA_VALIDATION_UNAVAILABLE';
  }
}

class InsufficientUploadStorageError extends Error {
  constructor(requiredBytes, availableBytes, reserveBytes) {
    super('存储空间不足，请清理磁盘后重试');
    this.name = 'InsufficientUploadStorageError';
    this.code = 'INSUFFICIENT_STORAGE';
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
    this.reserveBytes = reserveBytes;
  }
}

class UnsafeMediaReferenceError extends Error {
  constructor(
    message = 'Media reference is not a safe storage resource or public HTTP(S) URL.',
    reason = 'UNSAFE_PATH'
  ) {
    super(message);
    this.name = 'UnsafeMediaReferenceError';
    this.code = 'UNSAFE_MEDIA_REFERENCE';
    this.reason = reason;
  }
}

class StorySourceStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorySourceStorageError';
    this.code = code;
  }
}

function decodeReferencePath(value) {
  let decoded = String(value || '');
  for (let count = 0; count < 3; count += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch (_) {
      throw new UnsafeMediaReferenceError('Media reference contains invalid percent encoding.');
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) {
    throw new UnsafeMediaReferenceError('Media reference contains nested percent encoding.');
  }
  return decoded;
}

function ipv4Number(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    result = (result * 256) + value;
  }
  return result >>> 0;
}

function ipv4InCidr(address, base, prefix) {
  const value = ipv4Number(address);
  const network = ipv4Number(base);
  if (value == null || network == null) return false;
  const shift = 32 - prefix;
  return shift === 32 ? true : (value >>> shift) === (network >>> shift);
}

function parseIpv6(address) {
  let input = String(address || '').toLowerCase();
  if (!input || input.includes('%')) return null;
  if (input.includes('.')) {
    const splitAt = input.lastIndexOf(':');
    if (splitAt < 0) return null;
    const ipv4 = ipv4Number(input.slice(splitAt + 1));
    if (ipv4 == null) return null;
    input = `${input.slice(0, splitAt)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if ((input.match(/::/g) || []).length > 1) return null;
  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  let value = 0n;
  for (const part of parts) value = (value << 16n) | BigInt(parseInt(part, 16));
  return value;
}

function ipv6InCidr(value, base, prefix) {
  const baseValue = parseIpv6(base);
  if (value == null || baseValue == null) return false;
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (baseValue >> shift);
}

function isGloballyRoutableIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return ![
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  if (value == null) return false;
  if (ipv6InCidr(value, '::ffff:0:0', 96)) {
    const mapped = Number(value & 0xffffffffn);
    return isGloballyRoutableIp([
      (mapped >>> 24) & 255,
      (mapped >>> 16) & 255,
      (mapped >>> 8) & 255,
      mapped & 255,
    ].join('.'));
  }
  return ![
    ['::', 128], ['::1', 128], ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
    ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fec0::', 10],
    ['fe80::', 10], ['ff00::', 8],
  ].some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

function isMetadataIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return address === '169.254.169.254' ||
      address === '169.254.170.2' ||
      address === '100.100.100.200' ||
      address === '168.63.129.16';
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  return value != null && value === parseIpv6('fd00:ec2::254');
}

function isAllowedPrivateProviderIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return [
      ['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
    ].some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  return value != null && (
    ipv6InCidr(value, '::1', 128) ||
    ipv6InCidr(value, 'fc00::', 7)
  );
}

function normalizedHostname(hostname) {
  return String(hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isBlockedHostname(hostname) {
  const host = normalizedHostname(hostname);
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host.endsWith('.home.arpa') || host === 'metadata' ||
    host === 'instance-data' || host === 'metadata.google.internal';
}

function isMetadataHostname(hostname) {
  const host = normalizedHostname(hostname);
  return host === 'metadata' || host === 'instance-data' ||
    host === 'metadata.google.internal' || host === 'metadata.azure.internal' ||
    host.endsWith('.metadata.google.internal');
}

function parseHttpUrlSyntax(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 4096 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new UnsafeMediaReferenceError('Media URL is empty, too long, or contains control characters.');
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new UnsafeMediaReferenceError('Media URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new UnsafeMediaReferenceError('Media URL must be credential-free HTTP(S).');
  }
  return parsed;
}

function trustedOriginMatch(parsed, trustedOrigins) {
  if (!Array.isArray(trustedOrigins) || trustedOrigins.length === 0) return false;
  return trustedOrigins.some((value) => {
    try {
      const trusted = parseHttpUrlSyntax(value);
      return trusted.origin === parsed.origin;
    } catch (_) {
      return false;
    }
  });
}

function isExplicitLocalProviderHostname(hostname) {
  const host = normalizedHostname(hostname);
  if (!host) return false;
  if (net.isIP(host)) return isAllowedPrivateProviderIp(host);
  return !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host.endsWith('.internal') ||
    host.endsWith('.home.arpa') || host.endsWith('.docker.internal');
}

function assertPublicHttpUrlSyntax(value) {
  const parsed = parseHttpUrlSyntax(value);
  const host = normalizedHostname(parsed.hostname);
  if (isBlockedHostname(host)) throw new UnsafeMediaReferenceError('Media URL host is not public.');
  if (net.isIP(host) && !isGloballyRoutableIp(host)) {
    throw new UnsafeMediaReferenceError('Media URL resolves to a non-public address.');
  }
  return parsed;
}

async function validatePublicHttpUrl(value, options = {}) {
  const basic = parseHttpUrlSyntax(value);
  const basicHost = normalizedHostname(basic.hostname);
  if (isMetadataHostname(basicHost)) {
    throw new UnsafeMediaReferenceError('Media URL targets a metadata service.');
  }
  const trustedOrigin = trustedOriginMatch(basic, options.trustedOrigins);
  const explicitPrivateOrigin = trustedOriginMatch(basic, options.allowPrivateOrigins);
  const privateAddressAllowed = explicitPrivateOrigin || (
    trustedOrigin && isExplicitLocalProviderHostname(basicHost)
  );
  const parsed = trustedOrigin ? basic : assertPublicHttpUrlSyntax(value);
  const host = normalizedHostname(parsed.hostname);
  let records;
  if (net.isIP(host)) {
    records = [{ address: host, family: net.isIP(host) }];
  } else {
    const lookup = options.lookup || dns.promises.lookup;
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch (error) {
      throw new UnsafeMediaReferenceError(`Media URL DNS lookup failed: ${error?.code || 'DNS_ERROR'}.`);
    }
  }
  if (!Array.isArray(records)) records = records ? [records] : [];
  const invalidDnsAnswer = records.some((record) => !net.isIP(String(record?.address || '')));
  const metadataAnswer = records.some((record) => isMetadataIp(record?.address));
  const unsafeAnswer = records.some((record) => {
    if (isGloballyRoutableIp(record?.address)) return false;
    return !privateAddressAllowed || !isAllowedPrivateProviderIp(record?.address);
  });
  if (records.length === 0 || invalidDnsAnswer || metadataAnswer || unsafeAnswer) {
    throw new UnsafeMediaReferenceError('Media URL resolves to a non-public address.');
  }
  return {
    url: parsed.toString(),
    parsed,
    trustedOrigin,
    privateAddressAllowed,
    addresses: records.map((record) => ({ address: record.address, family: Number(record.family) || net.isIP(record.address) })),
  };
}

function createPinnedDnsLookup(selected) {
  const address = String(selected?.address || '');
  const family = Number(selected?.family) || net.isIP(address);
  if (!family) throw new UnsafeMediaReferenceError('Pinned DNS address is invalid.');
  return (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === 'function') {
      callback = lookupOptions;
      lookupOptions = {};
    }
    if (lookupOptions?.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function normalizeStorageRelativeReference(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f?#]/.test(text)) {
    throw new UnsafeMediaReferenceError('Local media reference is invalid.');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || path.isAbsolute(text) || /^[\\/]{2}/.test(text)) {
    throw new UnsafeMediaReferenceError('Absolute local media paths are not allowed.');
  }
  let relative = decodeReferencePath(text).replace(/\\/g, '/');
  relative = relative.replace(/^\/+/, '');
  if (relative.toLowerCase().startsWith('static/')) relative = relative.slice('static/'.length);
  const segments = relative.split('/');
  if (!relative || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new UnsafeMediaReferenceError('Local media reference would escape storage.');
  }
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) {
    throw new UnsafeMediaReferenceError('Local media reference would escape storage.');
  }
  return normalized;
}

function localReferenceFromValue(value) {
  const text = String(value || '').trim();
  if (!text) throw new UnsafeMediaReferenceError('Media reference is empty.');
  if (text.startsWith('/static/')) return normalizeStorageRelativeReference(text.slice('/static/'.length));
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch (_) {
      throw new UnsafeMediaReferenceError('Media URL is invalid.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new UnsafeMediaReferenceError('Media URL must be credential-free HTTP(S).');
    }
    const host = normalizedHostname(parsed.hostname);
    const isKnownLocal = host === 'localhost' || host.endsWith('.localhost') || host === '::1' ||
      (net.isIP(host) === 4 && ipv4InCidr(host, '127.0.0.0', 8));
    if (isKnownLocal && parsed.pathname.startsWith('/static/')) {
      return normalizeStorageRelativeReference(parsed.pathname.slice('/static/'.length));
    }
    return null;
  }
  return normalizeStorageRelativeReference(text);
}

function inspectStorageRoot(storagePath, options = {}) {
  if (!storagePath) throw new UnsafeMediaReferenceError('Storage root is required for local media.');
  const root = path.resolve(storagePath);
  const parsed = path.parse(root);
  const segments = root.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const pathsToInspect = [current];
  for (const segment of segments) {
    current = path.join(current, segment);
    pathsToInspect.push(current);
  }

  for (const candidate of pathsToInspect) {
    let stat;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT' || !options.create) {
        throw new UnsafeMediaReferenceError('Storage root is unavailable.', 'NOT_FOUND');
      }
      try {
        fs.mkdirSync(candidate);
        stat = fs.lstatSync(candidate);
      } catch (mkdirError) {
        throw new UnsafeMediaReferenceError('Storage root could not be created safely.', 'CREATE_FAILED');
      }
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError(
        'Storage root path cannot contain symbolic links or non-directory entries.',
        stat.isSymbolicLink() ? 'SYMLINK' : 'NOT_DIRECTORY'
      );
    }
  }
  return { root, rootReal: fs.realpathSync(root) };
}

function ensureStorageDirectory(storagePath, relativeDirectory) {
  const relative = normalizeStorageRelativeReference(relativeDirectory);
  const { root, rootReal } = inspectStorageRoot(storagePath, { create: true });
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError(
        'Storage directories cannot contain symbolic links or non-directory entries.',
        stat.isSymbolicLink() ? 'SYMLINK' : 'NOT_DIRECTORY'
      );
    }
    const currentReal = fs.realpathSync(current);
    const relation = path.relative(rootReal, currentReal);
    if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new UnsafeMediaReferenceError('Storage directory would escape its root.');
    }
  }
  return { root, rootReal, directory: current, relativePath: relative };
}

function resolveStorageReference(storagePath, value, options = {}) {
  const relativePath = localReferenceFromValue(value);
  if (!relativePath) return null;
  const { root, rootReal } = inspectStorageRoot(storagePath);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  const relation = path.relative(root, candidate);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new UnsafeMediaReferenceError('Local media reference would escape storage.');
  }
  if (options.mustExist === false) {
    return { relativePath, absolutePath: candidate, canonical: `/static/${relativePath}` };
  }
  let current = root;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT' && options.allowMissing) return null;
      throw new UnsafeMediaReferenceError('Local media file does not exist.', 'NOT_FOUND');
    }
    if (stat.isSymbolicLink()) {
      throw new UnsafeMediaReferenceError('Symbolic links are not allowed for local media.', 'SYMLINK');
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new UnsafeMediaReferenceError('Local media path contains a non-directory entry.', 'NOT_DIRECTORY');
    }
  }
  const candidateReal = fs.realpathSync(candidate);
  const realRelation = path.relative(rootReal, candidateReal);
  const stat = fs.statSync(candidateReal);
  if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation) || !stat.isFile()) {
    throw new UnsafeMediaReferenceError('Local media file is outside storage or is not a regular file.');
  }
  return { relativePath, absolutePath: candidateReal, canonical: `/static/${relativePath}` };
}

function sameFileIdentity(left, right) {
  if (!left || !right || !left.isFile() || !right.isFile()) return false;
  if (Number(left.ino) !== 0 || Number(right.ino) !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function openStorageFile(storagePath, value) {
  const resolved = resolveStorageReference(storagePath, value);
  if (!resolved) throw new UnsafeMediaReferenceError('Local storage file is required.');
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let fd;
  try {
    fd = fs.openSync(resolved.absolutePath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(fd);
    const verified = resolveStorageReference(storagePath, resolved.relativePath);
    const verifiedStat = fs.statSync(verified.absolutePath);
    if (
      verified.absolutePath !== resolved.absolutePath ||
      !sameFileIdentity(openedStat, verifiedStat)
    ) {
      throw new UnsafeMediaReferenceError('Local media file changed during secure open.', 'CHANGED');
    }
    return { ...verified, fd, stat: openedStat };
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    throw error;
  }
}

function createSiblingStagingPath(finalPath, label = 'tmp') {
  const resolved = path.resolve(finalPath);
  return path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${randomUUID()}.${label}`
  );
}

function fsyncFile(filePath) {
  let fd;
  try {
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDWR);
    } catch (_) {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY);
    }
    fs.fsyncSync(fd);
  } catch (error) {
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(fd);
  } catch (error) {
    // Windows 不支持对目录句柄执行 fsync；文件 fsync 和同盘 rename 仍然必须成功。
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch (_) {}
}

/**
 * 发布一个已完整写入的同盘暂存文件。调用方在数据库提交后调用 commit；提交失败则调用 rollback。
 */
function publishStagedFile(stagedPath, finalPath) {
  const staged = path.resolve(stagedPath);
  const final = path.resolve(finalPath);
  const finalDirectory = path.dirname(final);
  const stagedDirectory = path.dirname(staged);
  if (fs.statSync(stagedDirectory).dev !== fs.statSync(finalDirectory).dev) {
    throw new Error('暂存文件必须与最终文件位于同一文件系统');
  }
  const stagedStat = fs.statSync(staged);
  if (!stagedStat.isFile() || stagedStat.size <= 0) {
    throw new Error('暂存文件为空或不是普通文件');
  }

  fsyncFile(staged);
  let backupPath = null;
  let published = false;
  try {
    if (fs.existsSync(final)) {
      const finalStat = fs.lstatSync(final);
      if (finalStat.isSymbolicLink() || !finalStat.isFile()) {
        throw new UnsafeMediaReferenceError('Local media output is not a regular file.', 'OUTPUT_TYPE');
      }
      backupPath = createSiblingStagingPath(final, 'backup');
      try {
        fs.linkSync(final, backupPath);
      } catch (_) {
        fs.copyFileSync(final, backupPath, fs.constants.COPYFILE_EXCL);
        fsyncFile(backupPath);
      }
    }
    fs.renameSync(staged, final);
    published = true;
    fsyncDirectory(stagedDirectory);
    fsyncDirectory(finalDirectory);
  } catch (error) {
    if (published) removeFileQuietly(final);
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, final); } catch (_) {}
    }
    removeFileQuietly(staged);
    removeFileQuietly(backupPath);
    throw error;
  }

  let settled = false;
  return {
    finalPath: final,
    commit() {
      if (settled) return;
      settled = true;
      removeFileQuietly(backupPath);
      fsyncDirectory(finalDirectory);
    },
    rollback() {
      if (settled) return;
      settled = true;
      removeFileQuietly(final);
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, final);
      fsyncDirectory(finalDirectory);
    },
  };
}

function writeFileAtomically(finalPath, writeStagedFile) {
  const stagedPath = createSiblingStagingPath(finalPath);
  let publication = null;
  try {
    writeStagedFile(stagedPath);
    publication = publishStagedFile(stagedPath, finalPath);
    publication.commit();
    return finalPath;
  } catch (error) {
    publication?.rollback();
    removeFileQuietly(stagedPath);
    throw error;
  }
}

function writeStorageBuffer(storagePath, value, buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Local storage output must be a Buffer.');
  }
  const relativePath = normalizeStorageRelativeReference(value);
  const segments = relativePath.split('/');
  const filename = segments.pop();
  const parent = segments.length
    ? ensureStorageDirectory(storagePath, segments.join('/'))
    : inspectStorageRoot(storagePath, { create: true });
  const absolutePath = path.join(parent.directory || parent.root, filename);
  writeFileAtomically(absolutePath, (stagedPath) => {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(
      stagedPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
      0o600
    );
    try {
      fs.writeFileSync(fd, buffer);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  });
  return resolveStorageReference(storagePath, relativePath);
}

async function validateMediaReference(value, options = {}) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('data:') || text.startsWith('file:')) {
    throw new UnsafeMediaReferenceError('Reference media must come from storage or a public HTTP(S) URL.');
  }
  let local = null;
  try {
    local = resolveStorageReference(options.storagePath, text, { mustExist: options.mustExist !== false });
  } catch (error) {
    if (!/^https?:\/\//i.test(text) || text.startsWith('/static/')) throw error;
  }
  if (local) return { kind: 'local', ...local };
  const remote = await validatePublicHttpUrl(text, options);
  return { kind: 'remote', canonical: remote.url, ...remote };
}

function readUploadHead(source) {
  if (Buffer.isBuffer(source)) {
    return {
      head: source.subarray(0, UPLOAD_SIGNATURE_BYTES),
      size: source.length,
    };
  }
  if (typeof source !== 'string' || !source) {
    throw new TypeError('upload source must be a Buffer or file path');
  }

  const fd = fs.openSync(source, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const length = Math.min(stat.size, UPLOAD_SIGNATURE_BYTES);
    const head = Buffer.alloc(length);
    if (length > 0) fs.readSync(fd, head, 0, length, 0);
    return { head, size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

function startsWithBytes(buffer, signature) {
  return buffer.length >= signature.length
    && buffer.subarray(0, signature.length).equals(signature);
}

function readEbmlVint(buffer, offset, preserveMarker = false) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buffer.length) return null;

  let value = preserveMarker ? first : (first & (marker - 1));
  for (let i = 1; i < length; i += 1) {
    value = (value * 256) + buffer[offset + i];
    if (!Number.isSafeInteger(value)) return null;
  }
  if (!preserveMarker && value === (2 ** (7 * length)) - 1) return null;
  return { length, value };
}

function detectEbmlType(buffer) {
  if (!startsWithBytes(buffer, EBML_SIGNATURE)) return null;
  const headerSize = readEbmlVint(buffer, EBML_SIGNATURE.length);
  if (!headerSize) return null;

  let cursor = EBML_SIGNATURE.length + headerSize.length;
  const headerEnd = Math.min(cursor + headerSize.value, buffer.length);
  while (cursor < headerEnd) {
    const id = readEbmlVint(buffer, cursor, true);
    if (!id) return null;
    cursor += id.length;
    const size = readEbmlVint(buffer, cursor);
    if (!size) return null;
    cursor += size.length;
    const dataEnd = cursor + size.value;
    if (dataEnd > headerEnd) return null;
    if (id.value === 0x4282) {
      const docType = buffer.toString('ascii', cursor, dataEnd).toLowerCase();
      if (docType === 'webm') return FILE_TYPES.webm;
      if (docType === 'matroska') return FILE_TYPES.mkv;
      return null;
    }
    cursor = dataEnd;
  }
  return null;
}

function readIsoBmffBrands(buffer, totalSize) {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;

  const compactSize = buffer.readUInt32BE(0);
  let boxSize = compactSize;
  let brandOffset = 8;
  if (compactSize === 1) {
    if (buffer.length < 24) return null;
    const extendedSize = buffer.readBigUInt64BE(8);
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    boxSize = Number(extendedSize);
    brandOffset = 16;
  }
  if (boxSize < brandOffset + 8 || boxSize > totalSize) return null;

  const brands = [buffer.toString('ascii', brandOffset, brandOffset + 4)];
  const availableEnd = Math.min(boxSize, buffer.length);
  for (let offset = brandOffset + 8; offset + 4 <= availableEnd; offset += 4) {
    brands.push(buffer.toString('ascii', offset, offset + 4));
  }
  return brands;
}

function detectIsoBmffType(buffer, totalSize) {
  const brands = readIsoBmffBrands(buffer, totalSize);
  if (!brands) return null;
  if (brands.includes('qt  ')) return FILE_TYPES.mov;
  if (brands.some((brand) => MP4_BRANDS.has(brand))) return FILE_TYPES.mp4;
  return null;
}

function hasMpegAudioFrameSync(buffer) {
  const end = Math.min(buffer.length - 3, 4096);
  for (let offset = 0; offset <= end; offset += 1) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) continue;
    const version = (buffer[offset + 1] >> 3) & 0x03;
    const layer = (buffer[offset + 1] >> 1) & 0x03;
    const bitrate = (buffer[offset + 2] >> 4) & 0x0f;
    const sampleRate = (buffer[offset + 2] >> 2) & 0x03;
    if (version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3) {
      return true;
    }
  }
  return false;
}

function hasId3Signature(buffer) {
  return buffer.length >= 10
    && buffer.toString('ascii', 0, 3) === 'ID3'
    && buffer[3] !== 0xff
    && buffer[4] !== 0xff
    && (buffer[6] & 0x80) === 0
    && (buffer[7] & 0x80) === 0
    && (buffer[8] & 0x80) === 0
    && (buffer[9] & 0x80) === 0;
}

function detectAllowedAudioUpload(source) {
  const { head, size } = readUploadHead(source);
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
    return { ...FILE_TYPES.wav };
  }
  if (head.length >= 4 && head.toString('ascii', 0, 4) === 'OggS') {
    return { ...FILE_TYPES.ogg };
  }
  if (hasId3Signature(head) || hasMpegAudioFrameSync(head)) {
    return { ...FILE_TYPES.mp3 };
  }
  const brands = readIsoBmffBrands(head, size);
  if (brands && brands.some((brand) => M4A_BRANDS.has(brand) || MP4_BRANDS.has(brand))) {
    return { ...FILE_TYPES.m4a };
  }
  return null;
}

function detectAllowedUpload(source) {
  const { head, size } = readUploadHead(source);
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { ...FILE_TYPES.jpeg };
  }
  if (startsWithBytes(head, PNG_SIGNATURE)) return { ...FILE_TYPES.png };

  const gifHeader = head.length >= 6 ? head.toString('ascii', 0, 6) : '';
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return { ...FILE_TYPES.gif };

  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF') {
    const riffType = head.toString('ascii', 8, 12);
    if (riffType === 'WEBP') return { ...FILE_TYPES.webp };
    if (riffType === 'AVI ') return { ...FILE_TYPES.avi };
  }

  const ebmlType = detectEbmlType(head);
  if (ebmlType) return { ...ebmlType };
  const isoBmffType = detectIsoBmffType(head, size);
  return isoBmffType ? { ...isoBmffType } : null;
}

function assertAllowedUpload(source, expectedMediaType = null) {
  const detected = detectAllowedUpload(source);
  if (!detected || (expectedMediaType && detected.mediaType !== expectedMediaType)) {
    throw new UnsupportedUploadTypeError(expectedMediaType);
  }
  return detected;
}

function isUploadValidationError(err) {
  return Boolean(err && [
    'UNSUPPORTED_UPLOAD_TYPE',
    'INVALID_MEDIA_CONTENT',
    'MEDIA_VALIDATION_UNAVAILABLE',
    'UNSAFE_MEDIA_REFERENCE',
  ].includes(err.code));
}

function getExistingDiskPath(targetPath) {
  let current = path.resolve(targetPath || process.cwd());
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function getAvailableDiskBytes(targetPath) {
  if (typeof fs.statfsSync !== 'function') return Number.POSITIVE_INFINITY;
  const stat = fs.statfsSync(getExistingDiskPath(targetPath));
  const availableBlocks = stat.bavail ?? stat.bfree;
  const availableBytes = Number(availableBlocks) * Number(stat.bsize);
  return Number.isFinite(availableBytes) ? availableBytes : Number.POSITIVE_INFINITY;
}

function assertUploadDiskCapacity(
  targetPath,
  requiredBytes,
  reserveBytes = DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  getAvailableBytes = getAvailableDiskBytes
) {
  const required = Math.max(0, Number(requiredBytes) || 0);
  const reserve = Math.max(0, Number(reserveBytes) || 0);
  let available;
  try {
    available = Number(getAvailableBytes(targetPath));
  } catch (err) {
    if (err?.code === 'ENOSPC') {
      throw new InsufficientUploadStorageError(required, 0, reserve);
    }
    throw err;
  }
  if (Number.isFinite(available) && available - required < reserve) {
    throw new InsufficientUploadStorageError(required, available, reserve);
  }
  return { availableBytes: available, requiredBytes: required, reserveBytes: reserve };
}

function isUploadStorageError(err) {
  return Boolean(err && [
    'INSUFFICIENT_STORAGE',
    'SOURCE_ORIGINAL_QUOTA_EXCEEDED',
    'ENOSPC',
  ].includes(err.code));
}

function storySourceStorageId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', `${label} must be a positive integer.`);
  }
  return parsed;
}

function sourceOriginalExtension(source) {
  const allowed = new Set([
    '.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json',
    '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga',
    '.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv',
  ]);
  const supplied = String(source?.extension || '').trim().toLowerCase();
  if (allowed.has(supplied)) return supplied === '.jpeg' ? '.jpg' : supplied;
  const format = String(source?.format || '').trim().toLowerCase();
  const byFormat = {
    jpeg: '.jpg',
    ogg_audio: '.ogg',
    ogg_video: '.ogv',
  };
  const inferred = byFormat[format] || `.${format || 'txt'}`;
  if (!allowed.has(inferred)) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', 'The detected source extension is not allowed.');
  }
  return inferred;
}

function sourceOriginalMime(value) {
  const mime = String(value || '').trim().toLowerCase();
  if (
    mime.length > 200 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', 'The detected source MIME type is invalid.');
  }
  return mime;
}

function ensureSecureStorageDirectory(storagePath, relativeDirectory) {
  try {
    const secured = ensureStorageDirectory(storagePath, relativeDirectory);
    return {
      root: secured.root,
      rootReal: secured.rootReal,
      directory: secured.directory,
      relativeDirectory: secured.relativePath,
    };
  } catch (error) {
    if (error?.code === 'UNSAFE_MEDIA_REFERENCE') {
      throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', error.message);
    }
    throw error;
  }
}

function directoryFileBytes(directory, stopAfter = Number.MAX_SAFE_INTEGER) {
  if (!fs.existsSync(directory)) return 0;
  const pending = [directory];
  let total = 0;
  while (pending.length) {
    const current = pending.pop();
    const currentStat = fs.lstatSync(current);
    if (currentStat.isSymbolicLink()) {
      throw new StorySourceStorageError(
        'UNSAFE_SOURCE_STORAGE',
        'Story source storage cannot contain symbolic links.'
      );
    }
    if (currentStat.isFile()) {
      total += currentStat.size;
      if (total > stopAfter) return total;
      continue;
    }
    if (!currentStat.isDirectory()) {
      throw new StorySourceStorageError(
        'UNSAFE_SOURCE_STORAGE',
        'Story source storage can contain only regular files and directories.'
      );
    }
    for (const entry of fs.readdirSync(current)) {
      pending.push(path.join(current, entry));
    }
  }
  return total;
}

function persistStorySourceOriginal(storagePath, dramaIdValue, sourceIdValue, source, options = {}) {
  const dramaId = storySourceStorageId(dramaIdValue, 'drama_id');
  const sourceId = storySourceStorageId(sourceIdValue, 'source_id');
  if (!Buffer.isBuffer(source?.buffer) || source.buffer.length === 0) {
    throw new StorySourceStorageError('INVALID_SOURCE_ORIGINAL', 'The source original is empty or unavailable.');
  }
  const maxBytes = Math.max(1, Number(options.maxBytes) || MAX_STORY_SOURCE_ORIGINAL_BYTES);
  if (source.buffer.length > maxBytes) {
    throw new StorySourceStorageError('SOURCE_ORIGINAL_TOO_LARGE', 'The source original exceeds the upload limit.');
  }

  const quotaBytes = Math.max(1, Number(options.quotaBytes) || DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES);
  const dramaRelativeDirectory = `story_sources/${dramaId}`;
  const dramaDirectory = ensureSecureStorageDirectory(storagePath, dramaRelativeDirectory);
  const existingBytes = directoryFileBytes(dramaDirectory.directory, quotaBytes);
  if (existingBytes + source.buffer.length > quotaBytes) {
    throw new StorySourceStorageError(
      'SOURCE_ORIGINAL_QUOTA_EXCEEDED',
      'The story source original quota for this drama has been exceeded.'
    );
  }
  assertUploadDiskCapacity(
    dramaDirectory.root,
    source.buffer.length,
    options.reserveBytes ?? DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
    options.getAvailableBytes ?? getAvailableDiskBytes
  );

  const sourceRelativeDirectory = `${dramaRelativeDirectory}/${sourceId}`;
  const sourceDirectory = ensureSecureStorageDirectory(storagePath, sourceRelativeDirectory);
  const originalRelativeDirectory = `${sourceRelativeDirectory}/original`;
  const originalDirectory = ensureSecureStorageDirectory(storagePath, originalRelativeDirectory);
  const extension = sourceOriginalExtension(source);
  const mime = sourceOriginalMime(source.mime);
  const serverFilename = `${randomUUID()}${extension}`;
  const relativePath = `${originalRelativeDirectory}/${serverFilename}`;
  const absolutePath = path.join(originalDirectory.directory, serverFilename);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow;
  try {
    writeFileAtomically(absolutePath, (stagedPath) => {
      const fd = fs.openSync(stagedPath, flags, 0o600);
      try {
        fs.writeFileSync(fd, source.buffer);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    });
    const written = fs.lstatSync(absolutePath);
    if (written.isSymbolicLink() || !written.isFile() || written.size !== source.buffer.length) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_WRITE_FAILED', 'The source original was not written safely.');
    }
  } catch (error) {
    try { fs.unlinkSync(absolutePath); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }

  const sha256 = createHash('sha256').update(source.buffer).digest('hex');
  return {
    absolutePath,
    cleanupDirectories: [originalDirectory.directory, sourceDirectory.directory],
    metadata: {
      storage_path: relativePath,
      server_filename: serverFilename,
      sha256,
      size: source.buffer.length,
      mime,
      download_url: `/api/v1/story-sources/${sourceId}/original`,
    },
  };
}

function removeStorySourceOriginal(artifact, log = null) {
  if (!artifact) return;
  removeFile(artifact.absolutePath, log);
  for (const directory of artifact.cleanupDirectories || []) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code) && log?.warn) {
        log.warn('Failed to remove empty story source directory', { error: error.message });
      }
    }
  }
}

function readStorySourceOriginal(storagePath, source) {
  const dramaId = storySourceStorageId(source?.drama_id, 'drama_id');
  const sourceId = storySourceStorageId(source?.id, 'source_id');
  const metadata = source?.metadata?.original_file;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new StorySourceStorageError('SOURCE_ORIGINAL_NOT_FOUND', 'This story source has no retained original.');
  }
  const expectedDirectory = `story_sources/${dramaId}/${sourceId}/original`;
  const relativePath = normalizeStorageRelativeReference(metadata.storage_path);
  const serverFilename = String(metadata.server_filename || '');
  if (
    path.posix.dirname(relativePath) !== expectedDirectory ||
    path.posix.basename(relativePath) !== serverFilename ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/.test(serverFilename)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', 'Story source original metadata is not bound to this source.');
  }
  const expectedSize = Number(metadata.size);
  const expectedHash = String(metadata.sha256 || '').toLowerCase();
  const mime = sourceOriginalMime(metadata.mime);
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_STORY_SOURCE_ORIGINAL_BYTES ||
    !/^[0-9a-f]{64}$/.test(expectedHash)
  ) {
    throw new StorySourceStorageError('UNSAFE_SOURCE_STORAGE', 'Story source original integrity metadata is invalid.');
  }

  const opened = openStorageFile(storagePath, relativePath);
  let fd = opened.fd;
  try {
    const before = opened.stat;
    if (!before.isFile() || before.size !== expectedSize) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', 'The retained source original size no longer matches its metadata.');
    }
    const buffer = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', 'The retained source original changed while it was being read.');
    }
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== expectedHash) {
      throw new StorySourceStorageError('SOURCE_ORIGINAL_INTEGRITY_FAILED', 'The retained source original hash no longer matches its metadata.');
    }
    return {
      buffer,
      mime,
      serverFilename,
      sha256: expectedHash,
      size: expectedSize,
    };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function imageTypeFromSharpFormat(format) {
  const key = String(format || '').toLowerCase();
  return FILE_TYPES[key] || null;
}

async function validateImageUpload(source, expectedMediaType = null) {
  try {
    const image = sharp(source, {
      animated: true,
      failOn: 'error',
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const detected = imageTypeFromSharpFormat(metadata.format);
    if (!detected || detected.mediaType !== 'image' || !metadata.width || !metadata.height) {
      throw new UnsupportedUploadTypeError(expectedMediaType);
    }
    await image.stats();
    return { ...detected };
  } catch (err) {
    if (err?.code === 'UNSUPPORTED_UPLOAD_TYPE') throw err;
    throw new InvalidMediaContentError(expectedMediaType || 'image');
  }
}

function probeMediaFile(filePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:format_tags=major_brand',
    '-show_entries', 'stream=codec_type,codec_name,width,height,duration,channels,sample_rate',
    '-of', 'json',
    filePath,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      getFfprobePath(),
      args,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: FFPROBE_TIMEOUT_MS,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          return resolve(JSON.parse(stdout));
        } catch (parseError) {
          return reject(parseError);
        }
      }
    );
  });
}

function videoTypeFromProbe(probe, source) {
  const formatNames = String(probe?.format?.format_name || '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (formatNames.includes('avi')) return FILE_TYPES.avi;
  if (formatNames.includes('matroska') || formatNames.includes('webm')) {
    return detectAllowedUpload(source)?.extension === '.webm' ? FILE_TYPES.webm : FILE_TYPES.mkv;
  }
  if (formatNames.includes('mov') || formatNames.includes('mp4')) {
    const majorBrand = String(probe?.format?.tags?.major_brand || '');
    return majorBrand === 'qt  ' || detectAllowedUpload(source)?.extension === '.mov'
      ? FILE_TYPES.mov
      : FILE_TYPES.mp4;
  }
  return null;
}

async function validateVideoUpload(source, expectedMediaType = null) {
  let probePath = source;
  let temporaryDir = null;
  if (Buffer.isBuffer(source)) {
    temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-video-probe-'));
    probePath = path.join(temporaryDir, 'candidate.media');
    fs.writeFileSync(probePath, source, { flag: 'wx' });
  }

  try {
    const probe = await probeMediaFile(probePath);
    const videoStream = Array.isArray(probe?.streams)
      ? probe.streams.find((stream) => stream.codec_type === 'video')
      : null;
    const detected = videoTypeFromProbe(probe, source);
    if (!videoStream?.codec_name || !videoStream.width || !videoStream.height || !detected) {
      throw new InvalidMediaContentError(expectedMediaType);
    }
    return { ...detected };
  } catch (err) {
    if (err?.code === 'ENOENT') throw new MediaValidationUnavailableError();
    if (err?.code === 'INVALID_MEDIA_CONTENT') throw err;
    throw new InvalidMediaContentError(expectedMediaType);
  } finally {
    if (temporaryDir) fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function audioTypeFromProbe(probe, candidate) {
  const formatNames = String(probe?.format?.format_name || '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const expectedFormats = {
    '.mp3': new Set(['mp3']),
    '.wav': new Set(['wav']),
    '.m4a': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
    '.ogg': new Set(['ogg']),
  };
  const allowedFormats = expectedFormats[candidate?.extension];
  if (!allowedFormats || !formatNames.some((name) => allowedFormats.has(name))) return null;
  return FILE_TYPES[candidate.extension.slice(1)] || null;
}

async function validateAudioUpload(source, expectedMediaType = 'audio') {
  const candidate = detectAllowedAudioUpload(source);
  if (!candidate) throw new UnsupportedUploadTypeError(expectedMediaType);

  let probePath = source;
  let temporaryDir = null;
  if (Buffer.isBuffer(source)) {
    temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-audio-probe-'));
    probePath = path.join(temporaryDir, 'candidate.media');
    fs.writeFileSync(probePath, source, { flag: 'wx' });
  }

  try {
    const probe = await probeMediaFile(probePath);
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const audioStream = streams.find((stream) => stream.codec_type === 'audio');
    const hasVideoStream = streams.some((stream) => stream.codec_type === 'video');
    const detected = audioTypeFromProbe(probe, candidate);
    const duration = Number(probe?.format?.duration ?? audioStream?.duration);
    if (
      !audioStream?.codec_name
      || hasVideoStream
      || !detected
      || !Number.isFinite(duration)
      || duration <= 0
    ) {
      throw new InvalidMediaContentError(expectedMediaType);
    }
    return { ...detected, duration };
  } catch (err) {
    if (err?.code === 'ENOENT') throw new MediaValidationUnavailableError();
    if (err?.code === 'INVALID_MEDIA_CONTENT' || err?.code === 'UNSUPPORTED_UPLOAD_TYPE') throw err;
    throw new InvalidMediaContentError(expectedMediaType);
  } finally {
    if (temporaryDir) fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

async function validateAllowedUpload(source, expectedMediaType = null) {
  if (expectedMediaType === 'audio') return validateAudioUpload(source, expectedMediaType);
  const candidate = detectAllowedUpload(source);
  if (candidate?.mediaType === 'image' || expectedMediaType === 'image') {
    const detected = await validateImageUpload(source, expectedMediaType);
    if (expectedMediaType && detected.mediaType !== expectedMediaType) {
      throw new UnsupportedUploadTypeError(expectedMediaType);
    }
    return detected;
  }
  if (candidate?.mediaType === 'video') {
    const detected = await validateVideoUpload(source, expectedMediaType);
    if (expectedMediaType && detected.mediaType !== expectedMediaType) {
      throw new UnsupportedUploadTypeError(expectedMediaType);
    }
    return detected;
  }
  if (!expectedMediaType) {
    try {
      return await validateImageUpload(source);
    } catch (_) {
      return validateVideoUpload(source);
    }
  }
  throw new UnsupportedUploadTypeError(expectedMediaType);
}

/**
 * 用 Node.js 原生 http/https 模块下载 URL 到 Buffer。
 * 比 native fetch 在 Electron 打包环境中更可靠，支持自动跟随 301/302 重定向（最多 5 次）。
 */
async function downloadBufferViaNodeHttp(url, timeoutMs = 30000, redirectCount = 0, options = {}) {
  const configuredMaxRedirects = Number(options.maxRedirects ?? DEFAULT_REMOTE_MEDIA_REDIRECTS);
  const maxRedirects = Number.isInteger(configuredMaxRedirects) && configuredMaxRedirects >= 0
    ? configuredMaxRedirects
    : DEFAULT_REMOTE_MEDIA_REDIRECTS;
  if (redirectCount > maxRedirects) throw new UnsafeMediaReferenceError('Media URL has too many redirects.');
  const maxBytes = options.maxBytes ?? DEFAULT_REMOTE_MEDIA_MAX_BYTES;
  const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; LocalMiniDrama/1.0)',
    Accept: options.accept || 'image/*,*/*',
    ...(options.headers || {}),
  };
  const { secureHttpFetch } = require('./secureHttpFetch');
  const response = await secureHttpFetch(url, {
    method: options.method || 'GET',
    headers: requestHeaders,
    body: options.body,
    redirect: options.followRedirects === false ? 'error' : 'follow',
    signal: options.signal,
  }, {
    trustedOrigins: options.trustedOrigins,
    allowPrivateOrigins: options.allowPrivateOrigins,
    requireHttpsForPublic: options.requireHttpsForPublic === true,
    lookup: options.lookup,
    timeoutMs,
    maxBytes,
    maxRedirects: Math.max(0, maxRedirects - redirectCount),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
  };
}

/** @returns {{ dir: string, relPrefix: string }} */
function resolveCategoryPaths(storagePath, category, projectSubdir) {
  const sub = projectSubdir && String(projectSubdir).trim();
  const relPrefix = sub
    ? `${sub.replace(/\\/g, '/')}/${category}`
    : String(category || '');
  const secured = ensureStorageDirectory(storagePath, relPrefix);
  return { dir: secured.directory, relPrefix: secured.relativePath };
}

function removeFile(filePath, log = null) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT' && log?.warn) {
      log.warn('Failed to remove upload file', { path: filePath, error: err.message });
    }
  }
}

function persistDetectedUpload(storagePath, baseUrl, log, category, projectSubdir, detected, writeFile) {
  const { dir: categoryPath, relPrefix } = resolveCategoryPaths(storagePath, category, projectSubdir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const name = `${timestamp}_${randomUUID()}${detected.extension}`;
  const filePath = path.join(categoryPath, name);
  const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
  try {
    writeFile(filePath);
    const opened = openStorageFile(storagePath, relativePath);
    fs.closeSync(opened.fd);
  } catch (err) {
    removeFile(filePath, log);
    throw err;
  }
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${relativePath}` : `/static/${relativePath}`;
  log.info('File uploaded', { path: filePath, url, mime_type: detected.mimeType });
  return {
    url,
    local_path: relativePath,
    absolute_path: filePath,
    mime_type: detected.mimeType,
    extension: detected.extension,
    media_type: detected.mediaType,
    ...(Number.isFinite(detected.duration) ? { duration: detected.duration } : {}),
  };
}

function uploadFile(
  storagePath,
  baseUrl,
  log,
  fileBuffer,
  originalName,
  mimeType,
  category,
  projectSubdir = null,
  expectedMediaType = null,
  validatedType = null,
  options = {}
) {
  void originalName;
  void mimeType;
  if (expectedMediaType === 'audio' && !validatedType) {
    throw new InvalidMediaContentError('audio');
  }
  const detected = validatedType || assertAllowedUpload(fileBuffer, expectedMediaType);
  if (expectedMediaType && detected.mediaType !== expectedMediaType) {
    throw new UnsupportedUploadTypeError(expectedMediaType);
  }
  assertUploadDiskCapacity(
    storagePath,
    fileBuffer.length,
    options.reserveBytes ?? DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
    options.getAvailableBytes ?? getAvailableDiskBytes
  );
  return persistDetectedUpload(
    storagePath,
    baseUrl,
    log,
    category,
    projectSubdir,
    detected,
    (filePath) => writeFileAtomically(filePath, (stagedPath) => {
      fs.writeFileSync(stagedPath, fileBuffer, { flag: 'wx' });
    })
  );
}

function uploadFileFromPath(
  storagePath,
  baseUrl,
  log,
  sourcePath,
  originalName,
  mimeType,
  category,
  projectSubdir = null,
  expectedMediaType = null,
  validatedType = null,
  options = {}
) {
  void originalName;
  void mimeType;
  if (expectedMediaType === 'audio' && !validatedType) {
    throw new InvalidMediaContentError('audio');
  }
  const detected = validatedType || assertAllowedUpload(sourcePath, expectedMediaType);
  if (expectedMediaType && detected.mediaType !== expectedMediaType) {
    throw new UnsupportedUploadTypeError(expectedMediaType);
  }
  const fileSize = fs.statSync(sourcePath).size;
  assertUploadDiskCapacity(
    storagePath,
    fileSize,
    options.reserveBytes ?? DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
    options.getAvailableBytes ?? getAvailableDiskBytes
  );
  return persistDetectedUpload(
    storagePath,
    baseUrl,
    log,
    category,
    projectSubdir,
    detected,
    (filePath) => writeFileAtomically(filePath, (stagedPath) => {
      fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    })
  );
}

/**
 * 将远程/Base64 图片保存到本地 storage，避免 AI 链接过期后无法访问
 * @param {string} storagePath - 存储根目录（如 ./data/storage）
 * @param {string} imageUrl - 图片地址（http(s) URL 或 data:image/xxx;base64,...）
 * @param {string} category - 子目录：characters / scenes / images
 * @param {object} log - logger
 * @param {string} [prefix] - 文件名前缀，如 ig_123
 * @param {string|null} [projectSubdir] - 如 projects/0001_20250324_剧名 或 library，与 uploadFile 一致
 * @returns {Promise<string|null>} 相对路径如 characters/xxx.png，失败返回 null
 */
async function downloadImageToLocal(storagePath, imageUrl, category, log, prefix = '', projectSubdir = null) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  let writtenFilePath = null;
  try {
    const { dir: categoryPath, relPrefix } = resolveCategoryPaths(storagePath, category, projectSubdir);
    let buffer;
    let ext = 'png';
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
      if (!match) {
        log.warn('downloadImageToLocal: invalid data URL');
        return null;
      }
      buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      if (buffer.length === 0 || buffer.length > DEFAULT_REMOTE_MEDIA_MAX_BYTES) {
        throw new UnsafeMediaReferenceError('Inline image exceeds the size limit.');
      }
      ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    } else {
      // 使用 Node.js 原生 http/https 模块下载，比 native fetch 在 Electron 打包环境更可靠
      // 失败自动重试最多 3 次
      let lastErr;
      let contentType = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await downloadBufferViaNodeHttp(imageUrl, 30000, 0, {
            maxBytes: DEFAULT_REMOTE_MEDIA_MAX_BYTES,
            accept: 'image/*',
          });
          buffer = result.buffer;
          contentType = result.contentType;
          break;
        } catch (e) {
          lastErr = e;
          log.warn('downloadImageToLocal: 下载失败，准备重试', { category, attempt, error: e.message, url: imageUrl.slice(0, 100) });
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      if (!buffer) {
        log.warn('downloadImageToLocal: 3次重试均失败', { category, error: lastErr?.message });
        return null;
      }
      ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    }
    const detected = await validateAllowedUpload(buffer, 'image');
    ext = detected.extension.replace(/^\./, '');
    assertUploadDiskCapacity(storagePath, buffer.length);
    const name = `${prefix}${prefix ? '_' : ''}${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(categoryPath, name);
    writeFileAtomically(filePath, (stagedPath) => {
      fs.writeFileSync(stagedPath, buffer, { flag: 'wx' });
    });
    writtenFilePath = filePath;
    const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
    const opened = openStorageFile(storagePath, relativePath);
    fs.closeSync(opened.fd);
    log.info('Image saved to local', { category, local_path: relativePath, projectSubdir: projectSubdir || '(root)' });
    return relativePath;
  } catch (e) {
    removeFile(writtenFilePath, log);
    log.warn('downloadImageToLocal error', { category, error: e.message });
    return null;
  }
}

function getImageProxyUploadSettings() {
  try {
    const cfg = require('../config').loadConfig();
    const ip = cfg?.image_proxy || {};
    return {
      uploadUrl: String(ip.upload_url || '').trim(),
      timeoutMs: Math.max(5000, Number(ip.upload_timeout_seconds ?? 45) * 1000),
      maxAttempts: Math.max(1, Math.min(5, Number(ip.upload_max_attempts ?? 2))),
    };
  } catch (_) {
    return {
      uploadUrl: '',
      timeoutMs: 45000,
      maxAttempts: 2,
    };
  }
}

/**
 * 将图片 Buffer 上传到中转图床，返回公开访问 URL。
 * 接口：POST image_proxy.upload_url（multipart/form-data, field: file）
 * 响应：{ url: "https://configured-proxy.example/image/<hash>", created: ... }
 * 失败自动重试；成功返回 string URL，全部失败返回 null。
 */
async function uploadToImageProxy(imageBuffer, mimeType, log, tag) {
  const { uploadUrl, timeoutMs, maxAttempts } = getImageProxyUploadSettings();
  if (!uploadUrl) {
    log.warn('[图床上传] 已跳过：请先显式配置 image_proxy.upload_url', { tag });
    return null;
  }
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = extMap[mimeType] || 'jpg';
  const filename = `ref_${Date.now()}.${ext}`;
  log.info('[图床上传] ▶ 开始', {
    tag,
    filename,
    size_kb: Math.round(imageBuffer.length / 1024),
    upload_url: uploadUrl,
    timeout_sec: Math.round(timeoutMs / 1000),
    max_attempts: maxAttempts,
  });
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      const boundary = 'imgproxy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const headerLine = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const footerLine = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([Buffer.from(headerLine, 'utf-8'), imageBuffer, Buffer.from(footerLine, 'utf-8')]);
      const res = await downloadBufferViaNodeHttp(uploadUrl, timeoutMs, 0, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        accept: 'application/json',
        maxBytes: 1024 * 1024,
        maxRedirects: 0,
        followRedirects: false,
      });
      const raw = res.buffer.toString('utf8');
      const ms = Date.now() - t0;
      const data = JSON.parse(raw);
      const url = data?.url || null;
      if (url) {
        const validated = await validatePublicHttpUrl(url);
        log.info('[图床上传] 上传成功', { tag, attempt, url: validated.url, ms });
        return validated.url;
      }
      log.warn('[图床上传] 响应无 url 字段', { tag, attempt, ms, raw: raw.slice(0, 200) });
      if (attempt < maxAttempts) continue;
      return null;
    } catch (err) {
      const errMsg = err.name === 'TimeoutError' || err.name === 'AbortError'
        ? `请求超时（${Math.round(timeoutMs / 1000)}s）`
        : err.message;
      log.warn('[图床上传] 请求异常', { tag, attempt, ms: Date.now() - t0, err: errMsg });
      if (attempt < maxAttempts) continue;
      return null;
    }
  }
  return null;
}

/**
 * 将本地文件路径或 localhost URL 的图片上传到图床，返回公网 URL。
 * - localPath: 相对 storagePath 的路径，如 "images/ig_xxx.jpg"
 * - localhostUrl: 类似 "http://localhost:5679/static/images/ig_xxx.jpg" 的 URL
 * 两者传其中一个即可；失败返回 null。
 */
async function uploadLocalImageToProxy(storagePath, localPathOrUrl, log, tag) {
  try {
    const resolved = resolveStorageReference(storagePath, localPathOrUrl);
    if (!resolved) {
      log.warn('[图床上传] 引用不是本地 storage 文件', { tag });
      return null;
    }
    const filePath = resolved.absolutePath;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_REMOTE_MEDIA_MAX_BYTES) {
      throw new UnsafeMediaReferenceError('Local image exceeds the proxy upload size limit.');
    }
    const buf = fs.readFileSync(filePath);
    await validateAllowedUpload(buf, 'image');
    return await uploadToImageProxy(buf, mimeType, log, tag);
  } catch (e) {
    log.warn('[图床上传] uploadLocalImageToProxy 异常', { tag, err: e.message });
    return null;
  }
}

module.exports = {
  DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES,
  DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  DEFAULT_REMOTE_MEDIA_MAX_BYTES,
  UnsafeMediaReferenceError,
  assertUploadDiskCapacity,
  assertAllowedUpload,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  getAvailableDiskBytes,
  isUploadStorageError,
  isUploadValidationError,
  persistStorySourceOriginal,
  readStorySourceOriginal,
  removeFile,
  removeStorySourceOriginal,
  uploadFile,
  uploadFileFromPath,
  validateAllowedUpload,
  validateAudioUpload,
  assertPublicHttpUrlSyntax,
  validatePublicHttpUrl,
  createPinnedDnsLookup,
  isGloballyRoutableIp,
  ensureStorageDirectory,
  normalizeStorageRelativeReference,
  openStorageFile,
  writeStorageBuffer,
  writeFileAtomically,
  publishStagedFile,
  fsyncFile,
  fsyncDirectory,
  resolveStorageReference,
  validateMediaReference,
  downloadBufferViaNodeHttp,
  downloadImageToLocal,
  uploadToImageProxy,
  uploadLocalImageToProxy,
};
