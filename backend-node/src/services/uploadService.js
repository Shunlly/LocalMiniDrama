// 与 Go UploadService 对齐：保存到 local_path，返回 url / local_path
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const { getFfprobePath } = require('../utils/ffmpegPath');

const UPLOAD_SIGNATURE_BYTES = 64 * 1024;
const DEFAULT_UPLOAD_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const MAX_DECODED_IMAGE_PIXELS = 64 * 1024 * 1024;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'avc1', 'M4V ', 'F4V ', 'MSNV', 'dash', 'cmfc', 'cmfs',
]);
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
});

class UnsupportedUploadTypeError extends Error {
  constructor(expectedMediaType = null) {
    const message = expectedMediaType === 'image'
      ? '只支持图片格式 (jpg, png, gif, webp)'
      : '只支持图片或视频格式 (jpg, png, gif, webp, mp4, webm, mov, avi, mkv)';
    super(message);
    this.name = 'UnsupportedUploadTypeError';
    this.code = 'UNSUPPORTED_UPLOAD_TYPE';
  }
}

class InvalidMediaContentError extends Error {
  constructor(expectedMediaType = null) {
    const target = expectedMediaType === 'image' ? '图片' : '媒体文件';
    super(`${target}内容无效、已截断或无法解码`);
    this.name = 'InvalidMediaContentError';
    this.code = 'INVALID_MEDIA_CONTENT';
  }
}

class MediaValidationUnavailableError extends Error {
  constructor(message = '视频校验服务暂不可用') {
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

function detectIsoBmffType(buffer, totalSize) {
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
  if (brands.includes('qt  ')) return FILE_TYPES.mov;
  if (brands.some((brand) => MP4_BRANDS.has(brand))) return FILE_TYPES.mp4;
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
  return Boolean(err && (err.code === 'INSUFFICIENT_STORAGE' || err.code === 'ENOSPC'));
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

function probeVideoFile(filePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=format_name:format_tags=major_brand',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json',
    filePath,
  ];
  return new Promise((resolve, reject) => {
    execFile(
      getFfprobePath(),
      args,
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: FFPROBE_TIMEOUT_MS },
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
    const probe = await probeVideoFile(probePath);
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

async function validateAllowedUpload(source, expectedMediaType = null) {
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
function downloadBufferViaNodeHttp(url, timeoutMs = 30000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LocalMiniDrama/1.0)',
        'Accept': 'image/*,*/*',
      },
      timeout: timeoutMs,
    };
    const req = mod.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        res.resume();
        return resolve(downloadBufferViaNodeHttp(location, timeoutMs, redirectCount + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Download timeout after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.end();
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** @returns {{ dir: string, relPrefix: string }} */
function resolveCategoryPaths(storagePath, category, projectSubdir) {
  const sub = projectSubdir && String(projectSubdir).trim();
  if (sub) {
    const relPrefix = `${sub.replace(/\\/g, '/')}/${category}`;
    return { dir: path.join(storagePath, sub, category), relPrefix };
  }
  return { dir: path.join(storagePath, category), relPrefix: category };
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
  ensureDir(categoryPath);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const name = `${timestamp}_${randomUUID()}${detected.extension}`;
  const filePath = path.join(categoryPath, name);
  try {
    writeFile(filePath);
  } catch (err) {
    removeFile(filePath, log);
    throw err;
  }
  const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${relativePath}` : `/static/${relativePath}`;
  log.info('File uploaded', { path: filePath, url, mime_type: detected.mimeType });
  return {
    url,
    local_path: relativePath,
    absolute_path: filePath,
    mime_type: detected.mimeType,
    extension: detected.extension,
    media_type: detected.mediaType,
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
    (filePath) => fs.writeFileSync(filePath, fileBuffer, { flag: 'wx' })
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
    (filePath) => fs.copyFileSync(sourcePath, filePath, fs.constants.COPYFILE_EXCL)
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
  const { dir: categoryPath, relPrefix } = resolveCategoryPaths(storagePath, category, projectSubdir);
  try {
    ensureDir(categoryPath);
    let buffer;
    let ext = 'png';
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) {
        log.warn('downloadImageToLocal: invalid data URL');
        return null;
      }
      buffer = Buffer.from(match[2], 'base64');
      ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    } else {
      // 使用 Node.js 原生 http/https 模块下载，比 native fetch 在 Electron 打包环境更可靠
      // 失败自动重试最多 3 次
      let lastErr;
      let contentType = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await downloadBufferViaNodeHttp(imageUrl, 30000);
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
    const name = `${prefix}${prefix ? '_' : ''}${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(categoryPath, name);
    fs.writeFileSync(filePath, buffer);
    const relativePath = `${relPrefix}/${name}`.replace(/\\/g, '/');
    log.info('Image saved to local', { category, local_path: relativePath, projectSubdir: projectSubdir || '(root)' });
    return relativePath;
  } catch (e) {
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
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text();
      const ms = Date.now() - t0;
      if (!res.ok) {
        log.warn('[图床上传] 失败', { tag, attempt, status: res.status, ms, body: raw.slice(0, 200) });
        if (attempt < maxAttempts) continue;
        return null;
      }
      const data = JSON.parse(raw);
      const url = data?.url || null;
      if (url) { log.info('[图床上传] ✓ 成功', { tag, attempt, url, ms }); return url; }
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
    let filePath = null;
    let mimeType = 'image/jpeg';
    if (localPathOrUrl && localPathOrUrl.startsWith('http')) {
      // localhost URL → 提取 /static/ 后的相对路径
      const afterStatic = localPathOrUrl.split('/static/')[1];
      if (afterStatic && storagePath) {
        filePath = path.join(storagePath, afterStatic.replace(/^\//, ''));
      }
    } else if (localPathOrUrl && storagePath) {
      filePath = path.isAbsolute(localPathOrUrl)
        ? localPathOrUrl
        : path.join(storagePath, localPathOrUrl.replace(/^\//, ''));
    }
    if (!filePath || !fs.existsSync(filePath)) {
      log.warn('[图床上传] 本地文件不存在', { tag, filePath });
      return null;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    mimeType = mimeMap[ext] || 'image/jpeg';
    const buf = fs.readFileSync(filePath);
    return await uploadToImageProxy(buf, mimeType, log, tag);
  } catch (e) {
    log.warn('[图床上传] uploadLocalImageToProxy 异常', { tag, err: e.message });
    return null;
  }
}

module.exports = {
  DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  assertUploadDiskCapacity,
  assertAllowedUpload,
  detectAllowedUpload,
  getAvailableDiskBytes,
  isUploadStorageError,
  isUploadValidationError,
  removeFile,
  uploadFile,
  uploadFileFromPath,
  validateAllowedUpload,
  downloadImageToLocal,
  uploadToImageProxy,
  uploadLocalImageToProxy,
};
