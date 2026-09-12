'use strict';

// 从 uploadValidation 拆出的媒体探测：魔数识别、图片解码与音视频 ffprobe。

const fs = require('fs');
const os = require('os');
const path = require('path');
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

module.exports = {
  FILE_TYPES,
  InvalidMediaContentError,
  MediaValidationUnavailableError,
  UnsupportedUploadTypeError,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  probeMediaFile,
  validateAudioUpload,
  validateImageUpload,
  validateVideoUpload,
};
