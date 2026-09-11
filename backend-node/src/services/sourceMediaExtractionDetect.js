// 从 sourceMediaExtractionService 拆出的文件探测：魔数识别、扩展名/MIME 校验与上传描述。

const path = require('node:path');
const { actionableError } = require('./sourceMediaExtractionErrors');

const MAX_SOURCE_UPLOAD_BYTES = 20 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.tsv', '.srt', '.vtt', '.ass', '.json']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.ogv']);

const MIME_TYPES = {
  pdf: new Set(['application/pdf']),
  png: new Set(['image/png']),
  jpeg: new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']),
  webp: new Set(['image/webp']),
  gif: new Set(['image/gif']),
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  wav: new Set(['audio/wav', 'audio/wave', 'audio/x-wav']),
  m4a: new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a']),
  aac: new Set(['audio/aac', 'audio/x-aac']),
  flac: new Set(['audio/flac', 'audio/x-flac']),
  ogg_audio: new Set(['audio/ogg']),
  mp4: new Set(['video/mp4']),
  mov: new Set(['video/quicktime']),
  mkv: new Set(['video/x-matroska', 'video/matroska']),
  avi: new Set(['video/x-msvideo', 'video/avi']),
  webm: new Set(['video/webm']),
  ogg_video: new Set(['video/ogg']),
};

function sanitizeFilename(value) {
  const leaf = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .trim();
  return (leaf || 'source').slice(0, 255);
}

function normalizeMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function startsWithBytes(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((value, index) => buffer[index] === value);
}

function asciiAt(buffer, start, length) {
  if (buffer.length < start + length) return '';
  return buffer.subarray(start, start + length).toString('ascii');
}

function detectMagic(buffer) {
  if (asciiAt(buffer, 0, 5) === '%PDF-') return 'pdf';
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP') return 'webp';
  if (asciiAt(buffer, 0, 6) === 'GIF87a' || asciiAt(buffer, 0, 6) === 'GIF89a') return 'gif';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WAVE') return 'wav';
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'AVI ') return 'avi';
  if (asciiAt(buffer, 0, 4) === 'fLaC') return 'flac';
  if (asciiAt(buffer, 0, 4) === 'OggS') return 'ogg';
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'ebml';
  if (asciiAt(buffer, 4, 4) === 'ftyp') return 'iso_bmff';
  if (asciiAt(buffer, 0, 3) === 'ID3') return 'mp3';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mpeg_audio';
  return '';
}

function descriptorForContainer(magic, ext, mime) {
  if (magic === 'iso_bmff') {
    if (ext === '.m4a' || mime.startsWith('audio/')) return { kind: 'audio', format: 'm4a', mime: 'audio/mp4' };
    return { kind: 'video', format: ext === '.mov' || mime === 'video/quicktime' ? 'mov' : 'mp4', mime: ext === '.mov' ? 'video/quicktime' : 'video/mp4' };
  }
  if (magic === 'ebml') {
    if (mime.startsWith('audio/')) return { kind: 'audio', format: 'webm', mime: 'audio/webm' };
    return { kind: 'video', format: ext === '.webm' || mime === 'video/webm' ? 'webm' : 'mkv', mime: ext === '.webm' ? 'video/webm' : 'video/x-matroska' };
  }
  if (magic === 'ogg') {
    if (ext === '.ogv' || mime.startsWith('video/')) return { kind: 'video', format: 'ogg_video', mime: 'video/ogg' };
    return { kind: 'audio', format: 'ogg_audio', mime: 'audio/ogg' };
  }
  if (magic === 'mpeg_audio') {
    if (ext === '.aac' || /aac/.test(mime)) return { kind: 'audio', format: 'aac', mime: 'audio/aac' };
    return { kind: 'audio', format: 'mp3', mime: 'audio/mpeg' };
  }
  return null;
}

function descriptorForMagic(magic, ext, mime) {
  const container = descriptorForContainer(magic, ext, mime);
  if (container) return container;
  const descriptors = {
    pdf: { kind: 'pdf', format: 'pdf', mime: 'application/pdf' },
    png: { kind: 'image', format: 'png', mime: 'image/png' },
    jpeg: { kind: 'image', format: 'jpeg', mime: 'image/jpeg' },
    webp: { kind: 'image', format: 'webp', mime: 'image/webp' },
    gif: { kind: 'image', format: 'gif', mime: 'image/gif' },
    mp3: { kind: 'audio', format: 'mp3', mime: 'audio/mpeg' },
    wav: { kind: 'audio', format: 'wav', mime: 'audio/wav' },
    flac: { kind: 'audio', format: 'flac', mime: 'audio/flac' },
    avi: { kind: 'video', format: 'avi', mime: 'video/x-msvideo' },
  };
  return descriptors[magic] || null;
}

function extensionMatches(descriptor, ext) {
  if (!ext) return true;
  if (descriptor.kind === 'pdf') return ext === '.pdf';
  if (descriptor.kind === 'image') return IMAGE_EXTENSIONS.has(ext) && !(descriptor.format === 'jpeg' && !['.jpg', '.jpeg'].includes(ext)) && (descriptor.format === 'jpeg' || ext === `.${descriptor.format}`);
  if (descriptor.kind === 'audio') {
    if (descriptor.format === 'ogg_audio') return ['.ogg', '.oga'].includes(ext);
    if (descriptor.format === 'webm') return ext === '.webm';
    return AUDIO_EXTENSIONS.has(ext) && ext === `.${descriptor.format}`;
  }
  if (descriptor.kind === 'video') {
    if (descriptor.format === 'ogg_video') return ext === '.ogv';
    return VIDEO_EXTENSIONS.has(ext) && ext === `.${descriptor.format}`;
  }
  return false;
}

function mimeMatches(descriptor, declaredMime) {
  if (!declaredMime || declaredMime === 'application/octet-stream') return true;
  if (descriptor.format === 'webm' && descriptor.kind === 'audio') return declaredMime === 'audio/webm';
  const allowed = MIME_TYPES[descriptor.format];
  return Boolean(allowed && allowed.has(declaredMime));
}

function isTextMime(mime) {
  return !mime || mime === 'application/octet-stream' || mime.startsWith('text/') || [
    'application/json',
    'application/x-subrip',
    'application/vnd.ms-excel',
  ].includes(mime);
}

function inspectUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw actionableError('请上传源文件后再试。');
  const actualSize = file.buffer.length;
  const reportedSize = Number(file.size || 0);
  if (!actualSize) throw actionableError('上传的源文件为空。请选择包含内容的文件后重新上传。');
  if (actualSize > MAX_SOURCE_UPLOAD_BYTES || reportedSize > MAX_SOURCE_UPLOAD_BYTES) {
    throw actionableError('源文件上传上限为 20MB。请拆分或压缩后再试。');
  }

  const filename = sanitizeFilename(file.originalname);
  const ext = path.extname(filename).toLowerCase();
  const declaredMime = normalizeMime(file.mimetype);
  const magic = detectMagic(file.buffer);
  const descriptor = descriptorForMagic(magic, ext, declaredMime);

  if (descriptor) {
    if (!extensionMatches(descriptor, ext)) {
      throw actionableError('源文件扩展名与文件签名不一致。请确认文件未被改扩展名后重新上传。');
    }
    if (!mimeMatches(descriptor, declaredMime)) {
      throw actionableError('源文件 MIME 类型与文件签名不一致。请按实际格式重新上传。');
    }
    return { ...descriptor, filename, extension: ext, size: actualSize, declared_mime: declaredMime };
  }

  if ((TEXT_EXTENSIONS.has(ext) || (!ext && isTextMime(declaredMime))) && isTextMime(declaredMime)) {
    return { kind: 'text', format: ext ? ext.slice(1) : 'txt', mime: declaredMime || 'text/plain', filename, extension: ext, size: actualSize, declared_mime: declaredMime };
  }

  throw actionableError('不支持或无效的源文件。请使用文本、PDF、PNG/JPEG/WebP/GIF，或受支持的音频/视频容器后重试。');
}

module.exports = {
  MAX_SOURCE_UPLOAD_BYTES,
  detectMagic,
  inspectUploadedFile,
  normalizeMime,
  sanitizeFilename,
};
