'use strict';

// 参考图加载、压缩与分镜参考上限。

const fs = require('fs');
const path = require('path');
const uploadService = require('../uploadService');
const { inferProtocol } = require('./runtime');

const IMAGE_REFERENCE_TIMEOUT_MS = 30000;
const IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_REFERENCE_TOTAL_MAX_BYTES = 40 * 1024 * 1024;
const IMAGE_REFERENCE_MAX_REDIRECTS = 3;

function trustedProviderOrigins(config) {
  const baseUrl = String(config?.base_url || '').trim();
  const enabled = config?.is_active === true || config?.is_active === 1 || config?.is_active === '1';
  return baseUrl && enabled ? [baseUrl] : [];
}

// sharp 惰性加载（参考图压缩用，sharp 已在 package.json 中声明）
let _sharp = null;
function getSharp() {
  if (!_sharp) {
    try { _sharp = require('sharp'); } catch (_) {}
  }
  return _sharp;
}

/**
 * 压缩单张参考图 buffer，目标 ≤ targetKB（默认 2048KB=2MB）
 * 用 JPEG 递减质量压缩直到达标或质量降到最低阈值。
 * 若 sharp 不可用或压缩后更大，返回原始 buffer。
 */
async function compressImageBuffer(buffer, mimeType, targetKB = 2048, log = null) {
  const sharp = getSharp();
  if (!sharp) return { buffer, mimeType };
  const targetBytes = targetKB * 1024;
  if (buffer.length <= targetBytes) return { buffer, mimeType };
  try {
    let quality = 80;
    let compressed = await sharp(buffer).jpeg({ quality }).toBuffer();
    while (compressed.length > targetBytes && quality > 30) {
      quality -= 15;
      compressed = await sharp(buffer).jpeg({ quality }).toBuffer();
    }
    if (compressed.length < buffer.length) {
      if (log) log.info('[参考图压缩] 压缩完成', {
        original_kb: Math.round(buffer.length / 1024),
        compressed_kb: Math.round(compressed.length / 1024),
        quality,
      });
      return { buffer: compressed, mimeType: 'image/jpeg' };
    }
  } catch (e) {
    if (log) log.warn('[参考图压缩] sharp 压缩失败，使用原图', { error: e.message });
  }
  return { buffer, mimeType };
}

function resolveImageRef(value) {
  const text = String(value || '').trim();
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(text) ? text : null;
}

async function validateImageReferenceBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > IMAGE_REFERENCE_MAX_BYTES) {
    throw new uploadService.UnsafeMediaReferenceError('Image reference exceeds the size limit.');
  }
  const detected = await uploadService.validateAllowedUpload(buffer, 'image');
  return {
    buffer,
    mimeType: detected.mimeType || 'image/jpeg',
  };
}

async function loadImageReference(value, opts, config) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (text.startsWith('data:')) {
    const match = text.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    const encodedLimit = Math.ceil(IMAGE_REFERENCE_MAX_BYTES * 4 / 3) + 16;
    if (!match || match[2].length > encodedLimit) {
      throw new uploadService.UnsafeMediaReferenceError('Image reference data URL is invalid or too large.');
    }
    return validateImageReferenceBuffer(Buffer.from(match[2].replace(/\s/g, ''), 'base64'));
  }

  if (opts.storage_local_path) {
    let local = null;
    try {
      local = uploadService.resolveStorageReference(opts.storage_local_path, text);
    } catch (error) {
      if (!/^https?:\/\//i.test(text) || text.startsWith('/static/')) throw error;
    }
    if (local) {
      const opened = uploadService.openStorageFile(opts.storage_local_path, local.relativePath);
      try {
        if (opened.stat.size > IMAGE_REFERENCE_MAX_BYTES) {
          throw new uploadService.UnsafeMediaReferenceError('Image reference exceeds the size limit.');
        }
        return validateImageReferenceBuffer(fs.readFileSync(opened.fd));
      } finally {
        fs.closeSync(opened.fd);
      }
    }
  }

  if (!/^https?:\/\//i.test(text)) {
    throw new uploadService.UnsafeMediaReferenceError('Image reference must be inside storage or use HTTP(S).');
  }
  const downloaded = await uploadService.downloadBufferViaNodeHttp(text, IMAGE_REFERENCE_TIMEOUT_MS, 0, {
    maxBytes: IMAGE_REFERENCE_MAX_BYTES,
    maxRedirects: IMAGE_REFERENCE_MAX_REDIRECTS,
    accept: 'image/*',
    trustedOrigins: trustedProviderOrigins(config),
    lookup: opts.media_dns_lookup,
    signal: opts.signal,
  });
  return validateImageReferenceBuffer(downloaded.buffer);
}

async function prepareImageReferences(values, opts, config) {
  const prepared = [];
  let totalBytes = 0;
  for (const value of (Array.isArray(values) ? values : []).filter(Boolean).slice(0, 10)) {
    const loaded = await loadImageReference(value, opts, config);
    if (!loaded) continue;
    totalBytes += loaded.buffer.length;
    if (totalBytes > IMAGE_REFERENCE_TOTAL_MAX_BYTES) {
      throw new uploadService.UnsafeMediaReferenceError('Combined image references exceed the size limit.');
    }
    prepared.push(`data:${loaded.mimeType};base64,${loaded.buffer.toString('base64')}`);
  }
  return prepared;
}


/** 分镜参考图上限（与 callGeminiImageApi 的 MAX_GEMINI_REF_IMAGES、可灵单图参考等对齐） */
function getStoryboardReferenceLimits(config, modelName) {
  const provider = (config?.provider || '').toLowerCase();
  const protocol = (config?.api_protocol || '').toLowerCase() || inferProtocol(provider, modelName || config?.model);
  if (protocol === 'kling') {
    return { total: 1, maxCharacters: 1, maxObjects: 1 };
  }
  return { total: 4, maxCharacters: 3, maxObjects: 4 };
}

function countStoryboardRefsFromLabels(refLabels) {
  let characters = 0;
  let objects = 0;
  for (const lbl of refLabels || []) {
    if (/character appearance/i.test(lbl)) characters += 1;
    else if (/scene background|prop\/object/i.test(lbl)) objects += 1;
  }
  return { characters, objects };
}

function canAddStoryboardCharacterRef(refLabels, limits) {
  const { characters } = countStoryboardRefsFromLabels(refLabels);
  return refLabels.length < limits.total && characters < limits.maxCharacters;
}

function canAddStoryboardObjectRef(refLabels, limits) {
  const { objects } = countStoryboardRefsFromLabels(refLabels);
  return refLabels.length < limits.total && objects < limits.maxObjects;
}

/** 去重：同一本地路径或 URL（忽略 query）不重复加入参考图列表 */
function canonicalRefKey(ref) {
  if (ref == null || ref === '') return '';
  let s = String(ref).trim().replace(/\\/g, '/');
  if (s.startsWith('data:')) return s.slice(0, 120);
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return `${u.origin}${u.pathname}`.toLowerCase();
    } catch (_) {
      return s.split('?')[0].toLowerCase();
    }
  }
  try {
    return path.normalize(s).toLowerCase();
  } catch (_) {
    return s.toLowerCase();
  }
}

function refListHasCanonical(list, ref) {
  const key = canonicalRefKey(ref);
  if (!key) return false;
  return (list || []).some((item) => canonicalRefKey(item) === key);
}

module.exports = {
  resolveImageRef,
  prepareImageReferences,
  compressImageBuffer,
  getStoryboardReferenceLimits,
  canAddStoryboardCharacterRef,
  canAddStoryboardObjectRef,
  canonicalRefKey,
  refListHasCanonical,
};
