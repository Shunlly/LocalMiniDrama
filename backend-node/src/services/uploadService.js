// 与 Go UploadService 对齐：保存到 local_path，返回 url / local_path
// 校验、路径与元数据装配分别位于 uploadValidation / uploadPaths / uploadMetadata。
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  InvalidMediaContentError,
  UnsafeMediaReferenceError,
  UnsupportedUploadTypeError,
  assertAllowedUpload,
  assertPublicHttpUrlSyntax,
  createPinnedDnsLookup,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  isGloballyRoutableIp,
  isUploadValidationError,
  validateAllowedUpload,
  validateAudioUpload,
  validatePublicHttpUrl,
} = require('./uploadValidation');
const {
  DEFAULT_UPLOAD_DISK_RESERVE_BYTES,
  assertUploadDiskCapacity,
  decodeReferencePath,
  ensureStorageDirectory,
  fsyncDirectory,
  fsyncFile,
  getAvailableDiskBytes,
  isUploadStorageError,
  normalizeStorageRelativeReference,
  openStorageFile,
  publishStagedFile,
  removeFile,
  resolveCategoryPaths,
  resolveStorageReference,
  writeFileAtomically,
  writeStorageBuffer,
} = require('./uploadPaths');
const {
  DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES,
  persistDetectedUpload,
  persistStorySourceOriginal,
  readStorySourceOriginal,
  removeStorySourceOriginal,
} = require('./uploadMetadata');

const DEFAULT_REMOTE_MEDIA_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_REMOTE_MEDIA_REDIRECTS = 5;

async function validateMediaReference(value, options = {}) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('data:') || text.startsWith('file:')) {
    throw new UnsafeMediaReferenceError('参考媒体必须来自本地存储或公网 HTTP(S) URL');
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

/**
 * 用 Node.js 原生 http/https 模块下载 URL 到 Buffer。
 * 比 native fetch 在 Electron 打包环境中更可靠，支持自动跟随 301/302 重定向（最多 5 次）。
 */
async function downloadBufferViaNodeHttp(url, timeoutMs = 30000, redirectCount = 0, options = {}) {
  const configuredMaxRedirects = Number(options.maxRedirects ?? DEFAULT_REMOTE_MEDIA_REDIRECTS);
  const maxRedirects = Number.isInteger(configuredMaxRedirects) && configuredMaxRedirects >= 0
    ? configuredMaxRedirects
    : DEFAULT_REMOTE_MEDIA_REDIRECTS;
  if (redirectCount > maxRedirects) throw new UnsafeMediaReferenceError('媒体 URL 重定向次数过多');
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
  if (!response.ok) {
    const status = Number(response.status);
    if (status === 404) throw new Error('远程媒体不存在，请检查地址后重试');
    if (status === 401 || status === 403) throw new Error('没有权限下载该远程媒体');
    if (status === 429) throw new Error('远程媒体请求过于频繁，请稍后重试');
    if (status >= 500) throw new Error('远程媒体暂时不可用，请稍后重试');
    throw new Error('无法下载远程媒体，请稍后重试');
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
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
        throw new UnsafeMediaReferenceError('内联图片超过大小限制');
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
      throw new UnsafeMediaReferenceError('本地图片超过代理上传大小限制');
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
  decodeReferencePath,
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
