'use strict';

const fs = require('fs');
const path = require('path');
const uploadService = require('../uploadService');
const { uploadLocalImageToProxy } = uploadService;
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const { resolveVideoTimeoutMs } = require('./providerRuntime');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  videoProviderException,
  getModelFromConfig,
} = require('./helpers');
const { loadStorageImage, VIDEO_REFERENCE_MAX_BYTES } = require('./mediaRefs');

function isJimengFreeApiSeedanceModel(model) {
  const m = String(model || '').toLowerCase();
  return m.includes('seedance');
}

/**
 * 参考图 URL → Buffer（multipart），供用户自托管的 Jimeng 免费 API 使用
 */
async function resolveJimengApiImageBuffer(rawUrl, files_base_url, storage_local_path, log, video_gen_id, index) {
  const raw = (rawUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw.replace(/\s/g, ''));
    if (m) {
      const mime = (m[1] || '').toLowerCase();
      const buf = Buffer.from(m[2], 'base64');
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      return { buffer: buf, filename: 'ref_' + index + '.' + ext };
    }
    return null;
  }
  try {
    const local = loadStorageImage(raw, storage_local_path);
    if (local) {
      return { buffer: local.buffer, filename: `ref_${index}${local.extension}` };
    }
  } catch (error) {
    if (!/^https?:\/\//i.test(raw)) throw error;
  }
  if (/localhost|127\.0\.0\.1/i.test(raw) && storage_local_path) {
    const baseUrl = (files_base_url || '').replace(/\/$/, '');
    const afterStatic = raw.split('/static/')[1] || (baseUrl ? raw.replace(baseUrl + '/', '').replace(baseUrl, '') : null);
    const relPath = afterStatic ? afterStatic.replace(/^\//, '') : null;
    if (relPath) {
      const filePath = uploadService.resolveStorageReference(storage_local_path, relPath).absolutePath;
      try {
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          return { buffer: buf, filename: path.basename(filePath) || 'ref_' + index + '.jpg' };
        }
      } catch (e) {
        log.warn('[JimengAI] 读本地参考图失败', { error: e.message, video_gen_id, index });
      }
    }
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new uploadService.UnsafeMediaReferenceError('不允许使用绝对路径作为参考图。');
  }
  const isPublicHttp = /^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw);
  if (isPublicHttp) {
    const downloaded = await uploadService.downloadBufferViaNodeHttp(raw, resolveVideoTimeoutMs('media'), 0, {
      maxBytes: VIDEO_REFERENCE_MAX_BYTES,
      accept: 'image/*,application/octet-stream',
    });
    const res = { ok: true, status: 200, arrayBuffer: async () => downloaded.buffer };
    if (!res.ok) throw new Error('拉取参考图失败 HTTP ' + res.status);
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), filename: 'ref_' + index + '.jpg' };
  }
  if (storage_local_path) {
    const proxyUrl = await uploadLocalImageToProxy(storage_local_path, raw, log, 'jimeng_ai_vg' + video_gen_id + '_' + index);
    if (proxyUrl) {
      const downloaded = await uploadService.downloadBufferViaNodeHttp(proxyUrl, resolveVideoTimeoutMs('media'), 0, {
        maxBytes: VIDEO_REFERENCE_MAX_BYTES,
        accept: 'image/*,application/octet-stream',
      });
      const res = { ok: true, status: 200, arrayBuffer: async () => downloaded.buffer };
      if (!res.ok) throw new Error('图床参考图拉取失败 HTTP ' + res.status);
      const ab = await res.arrayBuffer();
      return { buffer: Buffer.from(ab), filename: 'ref_' + index + '.jpg' };
    }
  }
  return null;
}

/**
 * 用户自托管 jimeng-free-api-all：POST /v1/videos/generations（multipart 或 JSON）
 * @returns {Promise<{ video_url?: string, error?: string }>}
 */
async function callJimengAiApiVideo(config, log, opts) {
  const base = (config.base_url || '').toString().replace(/\/$/, '').trim();
  if (!base) {
    return { error: 'Jimeng AI API 未配置 Base URL（请填写自建服务地址，如 http://127.0.0.1:8000）' };
  }
  let apiKey = (config.api_key || '').trim();
  if (/^bearer\s+/i.test(apiKey)) apiKey = apiKey.replace(/^bearer\s+/i, '').trim();
  if (!apiKey) {
    return { error: 'Jimeng AI API 未配置 Session（填入 API Key 字段，多个用英文逗号分隔）' };
  }

  const model = getModelFromConfig(config, opts.model);
  const seedance = isJimengFreeApiSeedanceModel(model);
  let ratio = (opts.aspect_ratio || '16:9').toString().trim().replace(/\uFF1A/g, ':');
  let dur = opts.duration != null ? Number(opts.duration) : seedance ? 4 : 5;
  if (!Number.isFinite(dur) || dur < 1) dur = seedance ? 4 : 5;
  if (seedance) {
    if (dur === 5) dur = 4;
    dur = Math.min(15, Math.max(4, Math.round(dur)));
    if (ratio === '1:1') ratio = '4:3';
  } else {
    dur = dur <= 7 ? 5 : 10;
  }

  const resolution = (opts.resolution || '720p').toString().trim() || '720p';
  const pathSuffix = (config.endpoint || '/v1/videos/generations').toString().trim();
  const apiPath = pathSuffix.startsWith('/') ? pathSuffix : '/' + pathSuffix;
  const url = base + apiPath;
  const video_gen_id = opts.video_gen_id;

  const urlList = [];
  const refs = Array.isArray(opts.reference_urls) ? opts.reference_urls.filter(Boolean) : [];
  for (const u of refs) urlList.push(String(u).trim());
  if (opts.image_url && String(opts.image_url).trim()) urlList.push(String(opts.image_url).trim());
  if (opts.first_frame_url && String(opts.first_frame_url).trim()) urlList.push(String(opts.first_frame_url).trim());
  if (opts.last_frame_url && String(opts.last_frame_url).trim()) urlList.push(String(opts.last_frame_url).trim());
  const seen = new Set();
  const orderedUrls = [];
  for (const u of urlList) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    orderedUrls.push(u);
  }

  const fileParts = [];
  for (let i = 0; i < orderedUrls.length; i++) {
    try {
      const part = await resolveJimengApiImageBuffer(
        orderedUrls[i],
        opts.files_base_url,
        opts.storage_local_path,
        log,
        video_gen_id,
        i
      );
      if (part && part.buffer && part.buffer.length) fileParts.push(part);
    } catch (e) {
      log.warn('[JimengAI] 解析参考图失败', { video_gen_id, index: i, message: e.message });
    }
  }

  if (seedance && fileParts.length === 0) {
    return { error: 'Jimeng Seedance 需要至少一张参考图（请设置分镜参考图或 image_url）' };
  }

  const prompt = (opts.prompt || '').toString();
  const headers = { Authorization: 'Bearer ' + apiKey };
  let fetchOpts = { method: 'POST', headers };

  const longWaitMs = resolveVideoTimeoutMs('synchronous');
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    fetchOpts.signal = AbortSignal.timeout(longWaitMs);
  }

  if (fileParts.length > 0) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('ratio', ratio);
    form.append('duration', String(dur));
    form.append('resolution', resolution);
    for (const { buffer, filename } of fileParts) {
      const blob = new Blob([buffer]);
      form.append('files', blob, filename || 'image.jpg');
    }
    fetchOpts.body = form;
    log.info('[JimengAI] multipart 提交', {
      video_gen_id,
      url,
      model,
      ratio,
      duration: dur,
      resolution,
      file_count: fileParts.length,
    });
  } else {
    fetchOpts.headers = { ...headers, 'Content-Type': 'application/json' };
    fetchOpts.body = JSON.stringify({
      model,
      prompt,
      ratio,
      duration: dur,
      resolution,
    });
    log.info('[JimengAI] JSON 提交（无参考图）', { video_gen_id, url, model, ratio, duration: dur, resolution });
  }

  let res;
  try {
    res = await fetchVideoWithTimeout(url, fetchOpts, longWaitMs);
  } catch (e) {
    const safeError = videoProviderException(e, 'JimengAI', 'video request');
    log.error('[JimengAI] 请求失败', { video_gen_id, error: safeError });
    return { error: safeError.message };
  }

  const raw = await res.text();
  log.info('[JimengAI] 响应', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return videoProviderFailure('JimengAI', 'video response', res.status, raw);
  }

  if (!res.ok) {
    return videoProviderFailure('JimengAI', 'video request', res.status, data, data?.code);
  }

  const videoUrl = data?.data?.[0]?.url || data?.data?.[0]?.video_url;
  if (videoUrl) {
    log.info('[JimengAI] 得到视频地址', { video_gen_id, video_url_head: String(videoUrl).slice(0, 96) });
    return { video_url: String(videoUrl) };
  }

  return videoProviderFailure('JimengAI', 'video response', res.status, data);
}

module.exports = {
  isJimengFreeApiSeedanceModel,
  resolveJimengApiImageBuffer,
  callJimengAiApiVideo,
};
