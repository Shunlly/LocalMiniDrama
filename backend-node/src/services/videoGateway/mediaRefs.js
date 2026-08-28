'use strict';

const fs = require('fs');
const path = require('path');
const uploadService = require('../uploadService');
const { uploadLocalImageToProxy, uploadToImageProxy } = uploadService;
const imageClient = require('../imageClient');
const { requireCompleteProviderNetworkPolicy } = require('../providerNetworkPolicy');
const { validateHttpRequestTarget } = require('../secureHttpFetch');
const aiConfigService = require('../aiConfigService');
const { resolveVideoTimeoutMs } = require('./providerRuntime');

const VIDEO_REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

function resolveImageInputForOmniLocalBase64(rawUrl, files_base_url, storage_local_path, log, video_gen_id) {
  const raw = (rawUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;
  try {
    const local = loadStorageImage(raw, storage_local_path);
    if (local) {
      log.info('[KlingOmni] 图床失败后使用 storage 图片 base64', { file: local.relativePath, video_gen_id });
      return `data:${local.mimeType};base64,${local.buffer.toString('base64')}`;
    }
  } catch (e) {
    log.warn('[KlingOmni] 读取 storage 图片失败', { error: e.message, video_gen_id });
  }
  return raw;
}

/**
 * Omni 参考图：已是公网 http(s) 则直传；否则优先 uploadService 图床（中转可拉取），失败再 base64
 */
async function resolveImageInputForOmniAsync(rawUrl, files_base_url, storage_local_path, log, video_gen_id, index) {
  const raw = (rawUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;

  const isPublicHttp = /^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw);
  if (isPublicHttp) return (await uploadService.validatePublicHttpUrl(raw)).url;

  if (storage_local_path) {
    const tag = `kling_omni_vg${video_gen_id}_${index}`;
    const proxyUrl = await uploadLocalImageToProxy(storage_local_path, raw, log, tag);
    if (proxyUrl) {
      log.info('[KlingOmni] 已上传图床', { video_gen_id, index, url_head: proxyUrl.slice(0, 64) });
      return proxyUrl;
    }
    log.warn('[KlingOmni] 图床上传未返回 URL，尝试 base64', { video_gen_id, index });
  }

  return resolveImageInputForOmniLocalBase64(raw, files_base_url, storage_local_path, log, video_gen_id);
}

/** config.yaml：image_proxy.use_for_video=true 时才对视频全能模式走中转图床（默认 false，避免私有网关拉不到图床） */
function useImageProxyForVideo() {
  try {
    const { loadConfig } = require('../../config');
    return !!(loadConfig()?.image_proxy?.use_for_video);
  } catch (_) {
    return false;
  }
}

/**
 * 火山方舟 Seedance 全能/多图参考：公网 URL 直传；本地图默认 base64；可选图床（use_for_video）
 */
async function resolveVolcOmniImageAsync(rawUrl, files_base_url, storage_local_path, log, video_gen_id, index) {
  const raw = (rawUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;

  const isPublicHttp = /^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw);
  if (isPublicHttp) return (await uploadService.validatePublicHttpUrl(raw)).url;

  if (storage_local_path && !useImageProxyForVideo()) {
    const b64 = resolveVolcClassicImage(raw, files_base_url, storage_local_path, log, video_gen_id, `ref_${index}`);
    if (b64 && String(b64).startsWith('data:')) {
      log.info('[VolcOmni] 本地参考图 → base64（image_proxy.use_for_video 未启用）', { video_gen_id, index });
      return b64;
    }
  }

  if (storage_local_path && useImageProxyForVideo()) {
    const tag = `volc_omni_vg${video_gen_id}_${index}`;
    const proxyUrl = await uploadLocalImageToProxy(storage_local_path, raw, log, tag);
    if (proxyUrl) {
      log.info('[VolcOmni] 已上传图床', { video_gen_id, index, url_head: proxyUrl.slice(0, 64) });
      return proxyUrl;
    }
    log.warn('[VolcOmni] 图床上传未返回 URL，尝试 base64', { video_gen_id, index });
  }

  return resolveImageInputForOmniLocalBase64(raw, files_base_url, storage_local_path, log, video_gen_id);
}

/**
 * Agnes Video：仅接受公网 http(s) 图片 URL，本地/localhost 须先上传图床，禁止 base64。
 */
function isPublicHttpUrl(url) {
  return /^https?:\/\//i.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);
}

function isPublicFilesBaseUrl(files_base_url) {
  const fb = (files_base_url || '').trim();
  if (!fb || !/^https?:\/\//i.test(fb)) return false;
  return !/localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(fb);
}

function localRefKeyFromRaw(raw) {
  const s = (raw || '').trim();
  if (!s || s.startsWith('data:')) return null;
  if (s.includes('/static/')) {
    return (s.split('/static/')[1] || '').split(/[?#]/)[0].replace(/^\/+/, '') || null;
  }
  if (/^https?:\/\//i.test(s)) return null;
  return s.replace(/^\/+/, '') || null;
}

function publicUrlFromLocalRef(raw, files_base_url) {
  const rel = localRefKeyFromRaw(raw);
  if (!rel || !isPublicFilesBaseUrl(files_base_url)) return null;
  return `${String(files_base_url).replace(/\/$/, '')}/${rel}`;
}

async function resolveImageInputForAgnesAsync(db, rawUrl, files_base_url, storage_local_path, log, video_gen_id, index) {
  const raw = (rawUrl || '').trim();
  if (!raw) return null;

  if (isPublicHttpUrl(raw)) return (await uploadService.validatePublicHttpUrl(raw)).url;

  const publicFromBase = publicUrlFromLocalRef(raw, files_base_url);
  if (publicFromBase) {
    log.info('[Agnes] 使用公网 static URL（跳过图床）', { video_gen_id, index, url_head: publicFromBase.slice(0, 64) });
    return publicFromBase;
  }

  const cacheKey = localRefKeyFromRaw(raw);
  if (db && cacheKey) {
    const cached = await imageClient.getProxyCacheValidated(db, cacheKey, log, `agnes_vg${video_gen_id}_${index}`);
    if (cached) {
      log.info('[Agnes] 使用图床缓存 URL', { video_gen_id, index, cache_key: cacheKey });
      return cached;
    }
  }

  if (raw.startsWith('data:')) {
    const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(raw);
    if (m) {
      const mime = (m[1] || 'image/jpeg').trim();
      const b64 = String(m[2] || '').replace(/\s/g, '');
      try {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 0) {
          const tag = `agnes_vg${video_gen_id}_${index}`;
          const proxyUrl = await uploadToImageProxy(buf, mime, log, tag);
          if (proxyUrl) {
            log.info('[Agnes] base64 参考图已上传图床', { video_gen_id, index, url_head: proxyUrl.slice(0, 64) });
            if (db && cacheKey) imageClient.setProxyCache(db, cacheKey, proxyUrl);
            return proxyUrl;
          }
        }
      } catch (e) {
        log.warn('[Agnes] base64 解码或上传失败', { video_gen_id, index, error: e.message });
      }
    }
    return null;
  }

  if (storage_local_path) {
    const tag = `agnes_vg${video_gen_id}_${index}`;
    const proxyUrl = await uploadLocalImageToProxy(storage_local_path, raw, log, tag);
    if (proxyUrl) {
      log.info('[Agnes] 本地参考图已上传图床', { video_gen_id, index, url_head: proxyUrl.slice(0, 64) });
      if (db && cacheKey) imageClient.setProxyCache(db, cacheKey, proxyUrl);
      return proxyUrl;
    }
  }

  log.warn('[Agnes] 参考图无法转为公网 URL', {
    video_gen_id,
    index,
    reference_type: raw.startsWith('data:') ? 'data' : /^https?:\/\//i.test(raw) ? 'url' : 'local',
    reference_length: raw.length,
  });
  return null;
}

/**
 * 火山 Seedance 系列：按模型版本归一化时长（秒）。
 * - 2.x：4–15
 * - 1.5 Pro/Lite：5–12（官方文档）
 * - 1.0 Pro/Lite：仅 5 或 10
 */

/**
 * 单张参考图：公网 URL 优先（图床 / 已是图床链），失败再 data URL。Veo3 与 xAI 视频共用（与可灵 Omni 一致）。
 * @returns {Promise<{ kind: 'url'|'data', value: string }|null>}
 */
async function resolveVeo3ImageForApi(rawImgUrl, storage_local_path, log, video_gen_id) {
  const raw = (rawImgUrl || '').trim();
  if (!raw) return null;
  const tag = `videoref_${video_gen_id || '0'}`;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === 'imageproxy.zhongzhuan.chat') {
      const validated = await uploadService.validatePublicHttpUrl(raw);
      return { kind: 'url', value: validated.url };
    }
  } catch (_) {
    /* 非绝对 URL */
  }

  if (!raw.startsWith('data:') && storage_local_path) {
    const proxyUrl = await uploadLocalImageToProxy(storage_local_path, raw, log, tag);
    if (proxyUrl) return { kind: 'url', value: proxyUrl };
  }

  if (raw.startsWith('data:')) {
    const m = raw.match(/^data:([\w/+.-]+);base64,(.+)$/is);
    if (m) {
      try {
        const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
        const mt = (m[1] || 'image/jpeg').toLowerCase();
        const mime = mt.includes('png') ? 'image/png' : mt.includes('webp') ? 'image/webp' : 'image/jpeg';
        const proxyUrl = await uploadToImageProxy(buf, mime, log, tag);
        if (proxyUrl) return { kind: 'url', value: proxyUrl };
        log.warn('[视频参考图] data 图床失败，回退内联 data', { video_gen_id });
      } catch (e) {
        log.warn('[视频参考图] data 解析失败', { error: e.message, video_gen_id });
      }
    }
    return { kind: 'data', value: raw };
  }

  let relAfterStatic = '';
  if (raw.includes('/static/')) {
    relAfterStatic = (raw.split('/static/')[1] || '').split(/[?#]/)[0].replace(/^\/+/, '');
  }
  if (relAfterStatic && storage_local_path) {
    try {
      let safeRel = relAfterStatic;
      try {
        safeRel = decodeURIComponent(relAfterStatic);
      } catch (_) {
        /* keep */
      }
      const localFile = uploadService.resolveStorageReference(storage_local_path, safeRel).absolutePath;
      const resolved = path.resolve(localFile);
      const baseResolved = path.resolve(storage_local_path);
      if (resolved.startsWith(baseResolved) && fs.existsSync(localFile)) {
        const buf = fs.readFileSync(localFile);
        const ext = path.extname(localFile).toLowerCase();
        const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
        const proxyUrl = await uploadToImageProxy(buf, mime, log, tag);
        if (proxyUrl) return { kind: 'url', value: proxyUrl };
        log.warn('[视频参考图] 本地图床失败 → base64', { video_gen_id });
        return { kind: 'data', value: `data:${mime};base64,${buf.toString('base64')}` };
      }
    } catch (e) {
      log.warn('[视频参考图] 读本地文件失败', { error: e.message, video_gen_id });
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const downloaded = await uploadService.downloadBufferViaNodeHttp(raw, resolveVideoTimeoutMs('media'), 0, {
        maxBytes: VIDEO_REFERENCE_MAX_BYTES,
        accept: 'image/*,application/octet-stream',
      });
      const dlRes = {
        ok: true,
        status: 200,
        headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? downloaded.contentType : null },
        arrayBuffer: async () => downloaded.buffer,
      };
      if (dlRes.ok) {
        const buf = Buffer.from(await dlRes.arrayBuffer());
        const ct = (dlRes.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
        const mime = ct.startsWith('image/') ? ct : 'image/jpeg';
        const proxyUrl = await uploadToImageProxy(buf, mime, log, tag);
        if (proxyUrl) return { kind: 'url', value: proxyUrl };
        log.warn('[视频参考图] 拉取后图床失败 → base64', { video_gen_id });
        return { kind: 'data', value: `data:${mime};base64,${buf.toString('base64')}` };
      }
      log.warn('[视频参考图] fetch 非 2xx', {
        status: dlRes.status,
        reference_type: /^https?:\/\//i.test(raw) ? 'url' : 'other',
        reference_length: raw.length,
        video_gen_id,
      });
    } catch (e) {
      log.warn('[视频参考图] fetch 失败', {
        error: e,
        reference_type: /^https?:\/\//i.test(raw) ? 'url' : 'other',
        reference_length: raw.length,
        video_gen_id,
      });
    }
    return { kind: 'url', value: raw };
  }

  return { kind: 'url', value: raw };
}

async function validateVideoMediaReferences(opts = {}) {
  const out = { ...opts };
  const validationOptions = {
    storagePath: opts.storage_local_path,
    lookup: opts.media_dns_lookup,
  };
  for (const key of [
    'image_url',
    'first_frame_url',
    'last_frame_url',
    'first_frame_local_path',
    'last_frame_local_path',
    'voice_reference_url',
  ]) {
    if (out[key] == null || String(out[key]).trim() === '') continue;
    const validated = await uploadService.validateMediaReference(out[key], validationOptions);
    out[key] = validated.canonical;
  }
  if (Array.isArray(out.reference_urls)) {
    const references = [];
    for (const value of out.reference_urls.slice(0, 10)) {
      if (value == null || String(value).trim() === '') continue;
      const validated = await uploadService.validateMediaReference(value, validationOptions);
      references.push(validated.canonical);
    }
    out.reference_urls = references;
  }
  if (out.files_base_url) {
    try {
      const validatedBase = await uploadService.validatePublicHttpUrl(out.files_base_url, {
        lookup: opts.media_dns_lookup,
      });
      out.files_base_url = validatedBase.url.replace(/\/$/, '');
    } catch (_) {
      out.files_base_url = '';
    }
  }
  return out;
}

function isEnabledSavedProvider(config) {
  return Boolean(String(config?.base_url || '').trim())
    && (config?.is_active === true || config?.is_active === 1 || config?.is_active === '1');
}

function normalizeSavedProviderOrigin(config) {
  const raw = String(config?.base_url || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new uploadService.UnsafeMediaReferenceError('厂商地址无效。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new uploadService.UnsafeMediaReferenceError('厂商地址必须是不含凭据的 HTTP(S) 源。');
  }
  return parsed.toString().replace(/\/$/, '');
}

function createProviderNetworkOptions(config, options = {}) {
  const existing = options.provider_network_policy || options.networkOptions || {};
  const networkOptions = {
    ...existing,
    fetchImpl: existing.fetchImpl || options.fetchImpl || options.fetch_impl || config?.fetch_impl,
    lookup: existing.lookup || options.lookup || options.provider_dns_lookup || config?.provider_dns_lookup,
    signal: options.signal || existing.signal,
  };
  let policy;
  try {
    policy = aiConfigService.getProviderNetworkOptions(config, networkOptions);
  } catch (error) {
    // 兼容已保存的历史私有配置；来源仍只信任这一条已启用的精确 origin。
    if (error?.code !== 'INVALID_PROVIDER_URL'
      || error.message !== 'Private or local provider URLs require an explicitly recognized local provider mode'
      || !isEnabledSavedProvider(config)) {
      throw error;
    }
    const baseUrl = normalizeSavedProviderOrigin(config);
    policy = {
      ...networkOptions,
      baseUrl,
      trustedOrigins: [baseUrl],
      allowPrivateOrigins: [baseUrl],
      requireHttpsForPublic: true,
    };
  }
  return requireCompleteProviderNetworkPolicy(policy, config?.base_url);
}

async function validateProviderRequestUrl(url, config, options = {}) {
  const value = String(url || '').trim();
  if (!value) throw new uploadService.UnsafeMediaReferenceError('未配置厂商地址。');
  if (config?.is_active === false || config?.is_active === 0 || config?.is_active === '0') {
    throw new uploadService.UnsafeMediaReferenceError('厂商配置必须已保存并启用。');
  }
  const policy = options.provider_network_policy
    || options.networkOptions
    || createProviderNetworkOptions(config, options);
  const completePolicy = requireCompleteProviderNetworkPolicy(policy, config?.base_url);
  const validated = await validateHttpRequestTarget(value, completePolicy);
  const privateOnly = validated.addresses.length > 0
    && validated.addresses.every((record) => !uploadService.isGloballyRoutableIp(record.address));
  if (privateOnly && !isEnabledSavedProvider(config)) {
    throw new uploadService.UnsafeMediaReferenceError('私有厂商配置必须已保存并启用。');
  }
  return validated;
}

async function validateProviderDispatch(config, options = {}) {
  return validateProviderRequestUrl(config?.base_url, config, options);
}

function loadStorageFile(value, storageLocalPath, maxBytes = VIDEO_REFERENCE_MAX_BYTES) {
  if (!storageLocalPath || !value) return null;
  const resolved = uploadService.resolveStorageReference(storageLocalPath, value);
  if (!resolved) return null;
  const stat = fs.statSync(resolved.absolutePath);
  if (stat.size <= 0 || stat.size > maxBytes) {
    throw new uploadService.UnsafeMediaReferenceError('本地参考媒体超过大小限制。');
  }
  return {
    buffer: fs.readFileSync(resolved.absolutePath),
    filename: path.basename(resolved.absolutePath),
    extension: path.extname(resolved.absolutePath).toLowerCase(),
    relativePath: resolved.relativePath,
  };
}

function loadStorageImage(value, storageLocalPath, maxBytes = uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES) {
  if (!storageLocalPath || !value) return null;
  const local = loadStorageFile(value, storageLocalPath, maxBytes);
  if (!local) return null;
  const ext = local.extension;
  const mimeType = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[ext];
  if (!mimeType) throw new Error('不支持该本地参考图片格式。');
  return {
    ...local,
    mimeType,
  };
}

function decodeInlineImage(value, maxBytes = VIDEO_REFERENCE_MAX_BYTES) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) return null;
  const encoded = match[2].replace(/\s/g, '');
  if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new uploadService.UnsafeMediaReferenceError('内联参考图超过大小限制。');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length <= 0 || buffer.length > maxBytes) {
    throw new uploadService.UnsafeMediaReferenceError('内联参考图超过大小限制。');
  }
  return {
    buffer,
    filename: 'reference.' + (match[1].toLowerCase() === 'image/jpeg' ? 'jpg' : match[1].slice(6).toLowerCase()),
    mimeType: match[1].toLowerCase(),
  };
}

async function loadReferenceImageBuffer(value, storageLocalPath, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const inline = decodeInlineImage(raw, options.maxBytes);
  if (inline) return inline;

  let local;
  try {
    local = loadStorageImage(raw, storageLocalPath, options.maxBytes || VIDEO_REFERENCE_MAX_BYTES);
  } catch (error) {
    if (!/^https?:\/\//i.test(raw)) throw error;
  }
  if (local) return local;
  if (!/^https?:\/\//i.test(raw)) {
    throw new uploadService.UnsafeMediaReferenceError('参考图必须是安全的本地存储文件或公网 URL。');
  }

  const downloaded = await uploadService.downloadBufferViaNodeHttp(
    raw,
    options.timeoutMs || resolveVideoTimeoutMs('media'),
    0,
    {
      maxBytes: options.maxBytes || VIDEO_REFERENCE_MAX_BYTES,
      accept: 'image/*,application/octet-stream',
      lookup: options.lookup,
    }
  );
  const detected = await uploadService.validateAllowedUpload(downloaded.buffer, 'image');
  return {
    buffer: downloaded.buffer,
    filename: `reference${detected.extension}`,
    mimeType: detected.mimeType,
  };
}

/**
 * 火山经典 Seedance（非 omni）路径：本地图片转 base64（或直传公网 URL）。
 * 同时支持 first_frame / last_frame 专用字段，以及回退到 image_url。
 */
function resolveVolcClassicImage(rawUrl, files_base_url, storage_local_path, log, video_gen_id, roleHint) {
  let u = String(rawUrl || '').trim();
  if (!u) return null;
  if (u.startsWith('data:') || u.startsWith('asset://')) return u;

  // 已经是公网 https 且不含 localhost 的，直接返回
  if (/^https?:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)) return u;

  try {
    const local = loadStorageImage(u, storage_local_path);
    if (local) {
      if (log && log.info) {
        log.info('[Volc] storage 首/尾帧已转为 base64 提交', {
          video_gen_id,
          role: roleHint,
          rel: local.relativePath.slice(0, 80),
        });
      }
      return `data:${local.mimeType};base64,${local.buffer.toString('base64')}`;
    }
  } catch (_) {
    return null;
  }
  // Remote values were DNS-validated by callVideoApi immediately before dispatch.
  return u;
}

module.exports = {
  VIDEO_REFERENCE_MAX_BYTES,
  useImageProxyForVideo,
  resolveImageInputForOmniLocalBase64,
  resolveImageInputForOmniAsync,
  resolveVolcOmniImageAsync,
  isPublicHttpUrl,
  isPublicFilesBaseUrl,
  localRefKeyFromRaw,
  publicUrlFromLocalRef,
  resolveImageInputForAgnesAsync,
  resolveVeo3ImageForApi,
  validateVideoMediaReferences,
  isEnabledSavedProvider,
  normalizeSavedProviderOrigin,
  createProviderNetworkOptions,
  validateProviderRequestUrl,
  validateProviderDispatch,
  loadStorageFile,
  loadStorageImage,
  decodeInlineImage,
  loadReferenceImageBuffer,
  resolveVolcClassicImage,
};
