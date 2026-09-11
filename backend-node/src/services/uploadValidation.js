'use strict';

// 从 uploadService 拆出的上传校验：魔数识别、图片/音视频解码、公网 URL 安全检查。

const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { getFfprobePath } = require('../utils/ffmpegPath');

const UPLOAD_SIGNATURE_BYTES = 64 * 1024;
const MAX_DECODED_IMAGE_PIXELS = 64 * 1024 * 1024;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
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

class UnsafeMediaReferenceError extends Error {
  constructor(
    message = '媒体引用必须是安全的本地存储资源或公网 HTTP(S) URL',
    reason = 'UNSAFE_PATH'
  ) {
    super(message);
    this.name = 'UnsafeMediaReferenceError';
    this.code = 'UNSAFE_MEDIA_REFERENCE';
    this.reason = reason;
  }
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
    throw new UnsafeMediaReferenceError('媒体 URL 为空、过长或包含控制字符');
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new UnsafeMediaReferenceError('媒体 URL 无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new UnsafeMediaReferenceError('媒体 URL 必须是不含凭据的 HTTP(S) 地址');
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
  if (isBlockedHostname(host)) throw new UnsafeMediaReferenceError('媒体 URL 主机不是公网地址');
  if (net.isIP(host) && !isGloballyRoutableIp(host)) {
    throw new UnsafeMediaReferenceError('媒体 URL 解析到非公网地址');
  }
  return parsed;
}

async function validatePublicHttpUrl(value, options = {}) {
  const basic = parseHttpUrlSyntax(value);
  const basicHost = normalizedHostname(basic.hostname);
  if (isMetadataHostname(basicHost)) {
    throw new UnsafeMediaReferenceError('媒体 URL 指向元数据服务，已被拒绝');
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
      throw new UnsafeMediaReferenceError('媒体地址无法解析，请检查链接是否正确');
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
    throw new UnsafeMediaReferenceError('媒体 URL 解析到非公网地址');
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
  if (!family) throw new UnsafeMediaReferenceError('固定的 DNS 地址无效');
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

function readUploadHead(source) {
  if (Buffer.isBuffer(source)) {
    return {
      head: source.subarray(0, UPLOAD_SIGNATURE_BYTES),
      size: source.length,
    };
  }
  if (typeof source !== 'string' || !source) {
    throw new TypeError('上传源必须是 Buffer 或文件路径');
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

module.exports = {
  FILE_TYPES,
  InvalidMediaContentError,
  MediaValidationUnavailableError,
  UnsafeMediaReferenceError,
  UnsupportedUploadTypeError,
  assertAllowedUpload,
  assertPublicHttpUrlSyntax,
  createPinnedDnsLookup,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  ipv4InCidr,
  isGloballyRoutableIp,
  isUploadValidationError,
  normalizedHostname,
  validateAllowedUpload,
  validateAudioUpload,
  validatePublicHttpUrl,
};
