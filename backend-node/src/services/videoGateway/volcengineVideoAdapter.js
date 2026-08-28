'use strict';

const fs = require('fs');
const path = require('path');
const uploadService = require('../uploadService');
const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  buildVideoUrl,
  getModelFromConfig,
  normalizeVolcModel,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const { resolveVolcOmniImageAsync, loadStorageFile } = require('./mediaRefs');

/**
 * 火山 Seedance 系列：按模型版本归一化时长（秒）。
 * - 2.x：4–15
 * - 1.5 Pro/Lite：5–12（官方文档）
 * - 1.0 Pro/Lite：仅 5 或 10
 */
function normalizeVolcengineDuration(modelName, durationNum) {
  const m = String(modelName || '').toLowerCase();
  const d = Number(durationNum);
  const safe = Number.isFinite(d) && d > 0 ? Math.round(d) : 5;

  if (/seedance[-_]?2|seedance2|2[-_]0[-_]/.test(m)) {
    return Math.min(15, Math.max(4, safe));
  }

  if (/seedance[-_]?1[-_.]?5|1-5-pro|1-5-lite|251215/.test(m)) {
    return Math.min(12, Math.max(5, safe));
  }

  if (/seedance|doubao-seedance/.test(m)) {
    return safe <= 7 ? 5 : 10;
  }

  return Math.min(12, Math.max(5, safe));
}

/** @deprecated 名称保留，实现与 normalizeVolcengineDuration 一致 */
function normalizeVolcOmniDuration(modelName, durationNum) {
  return normalizeVolcengineDuration(modelName, durationNum);
}

/**
 * 火山引擎方舟 — Seedance 2.0 等「全能/多参考图」视频
 * 与标准 volcengine 共用：POST {base}/contents/generations/tasks，GET {base}/contents/generations/tasks/{id}
 * content：首条 text；全能模式每张均为参考图（场景/角色/道具…），每张必须带 role：一律 reference_image
 */
async function callVolcengineOmniVideoApi(config, log, opts) {
  const {
    prompt,
    model: preferredModel,
    duration,
    aspect_ratio,
    resolution,
    seed,
    camera_fixed,
    watermark,
    image_url,
    reference_urls,
    files_base_url,
    storage_local_path,
    video_gen_id,
    voice_reference_url,   // Seedance 2.0 音色参考（全能模式专用）
  } = opts;

  const url = buildVideoUrl(config, { defaultEndpoint: '/v1/videos/generations' });
  const model = getModelFromConfig(config, preferredModel);
  const finalModel = normalizeVolcModel(model);
  const ratio = aspect_ratio || '16:9';
  const effectiveDuration = normalizeVolcOmniDuration(finalModel, duration);

  const refList = Array.isArray(reference_urls) ? reference_urls.filter(Boolean) : [];
  const primary = (image_url || '').trim();
  const orderedUrls = [...(primary ? [primary] : []), ...refList.filter((u) => u !== primary)];
  const maxRef = 9;
  const urls = orderedUrls.slice(0, maxRef);

  const body = {
    model: finalModel,
    content: [{ type: 'text', text: (prompt || '').trim() }],
    ratio,
    duration: effectiveDuration,
    watermark: watermark != null ? Boolean(watermark) : false,
  };
  if (resolution) body.resolution = resolution;
  if (seed != null) body.seed = Number(seed);
  if (camera_fixed != null) body.camera_fixed = Boolean(camera_fixed);

  if (urls.length) {
    for (let i = 0; i < urls.length; i++) {
      let u = await resolveVolcOmniImageAsync(
        urls[i],
        files_base_url,
        storage_local_path,
        log,
        video_gen_id,
        i
      );
      if (!u) continue;
      if (/localhost|127\.0\.0\.1/i.test(u) && storage_local_path && (files_base_url || '').match(/localhost|127\.0\.0\.1/i)) {
        const baseUrl = (files_base_url || '').replace(/\/$/, '');
        const afterStatic = u.split('/static/')[1] || (baseUrl ? u.replace(baseUrl + '/', '').replace(baseUrl, '') : null);
        const relPath = afterStatic ? afterStatic.replace(/^\//, '') : null;
        if (relPath) {
          const filePath = uploadService.resolveStorageReference(storage_local_path, relPath).absolutePath;
          try {
            if (fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              const ext = path.extname(filePath).toLowerCase();
              const mime =
                { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' }[
                  ext
                ] || 'image/png';
              u = 'data:' + mime + ';base64,' + buf.toString('base64');
            }
          } catch (_) {}
        }
      }
      const part = {
        type: 'image_url',
        image_url: { url: u },
        role: 'reference_image',
      };
      body.content.push(part);
    }
    if (body.content.length > 1) body.task_type = 'i2v';
  }

  // Seedance 2.0 音色参考音频支持（仅 Seedance 2.x 模型有效）
  const isSeedance2 = /seedance[-_]?2|seedance2|2[-_]0[-_]/.test(finalModel);
  if (isSeedance2 && opts.voice_reference_url) {
    let voiceUrl = String(opts.voice_reference_url).trim();
    if (voiceUrl) {
      const localVoice = loadStorageFile(voiceUrl, storage_local_path, uploadService.DEFAULT_REMOTE_MEDIA_MAX_BYTES);
      if (localVoice) {
        const mime = {
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.m4a': 'audio/mp4',
          '.ogg': 'audio/ogg',
        }[localVoice.extension];
        if (!mime) throw new uploadService.UnsafeMediaReferenceError('不支持该本地参考音频格式。');
        voiceUrl = `data:${mime};base64,${localVoice.buffer.toString('base64')}`;
      }
      // 复用图片的本地文件转 base64 逻辑
      if (/localhost|127\.0\.0\.1/i.test(voiceUrl) && storage_local_path && (files_base_url || '').match(/localhost|127\.0\.0\.1/i)) {
        const baseUrl = (files_base_url || '').replace(/\/$/, '');
        const afterStatic = voiceUrl.split('/static/')[1] || (baseUrl ? voiceUrl.replace(baseUrl + '/', '').replace(baseUrl, '') : null);
        const relPath = afterStatic ? afterStatic.replace(/^\//, '') : null;
        if (relPath) {
          const filePath = uploadService.resolveStorageReference(storage_local_path, relPath).absolutePath;
          try {
            if (fs.existsSync(filePath)) {
              const buf = fs.readFileSync(filePath);
              const ext = path.extname(filePath).toLowerCase();
              const mime =
                { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' }[ext] || 'audio/mpeg';
              voiceUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
            }
          } catch (_) {}
        }
      }
      body.content.push({
        type: 'audio_url',
        audio_url: { url: voiceUrl },
        role: 'reference_audio',
      });
      log.info('[VolcOmni] 已注入 Seedance 2.0 音色参考音频', { video_gen_id, voice_ref: String(opts.voice_reference_url).slice(0, 80) });
    }
  }

  // ===== 全能模式（Seedance 2.0 / Omni）最终请求结构体日志 =====
  // 方便调试确认：图片参考 + 音色参考是否真正被加入 content 数组
  try {
    const contentSummary = body.content.map((part, idx) => {
      const t = part.type || 'unknown';
      const role = part.role || null;
      let valueLength = 0;
      if (t === 'text' && part.text) {
        valueLength = String(part.text).length;
      } else if (part.image_url?.url) {
        valueLength = String(part.image_url.url).length;
      } else if (part.audio_url?.url) {
        valueLength = String(part.audio_url.url).length;
      }
      return { idx, type: t, role, value_length: valueLength };
    });

    const hasAudioRef = body.content.some(p => p.role === 'reference_audio' || p.type === 'audio_url');

    log.info('[VolcOmni][全能结构体] 最终发往火山的 content 概览（含音色参考验证）', {
      video_gen_id,
      model: finalModel,
      content_length: body.content.length,
      has_reference_audio: hasAudioRef,
      voice_reference_url_from_opts: voice_reference_url ? String(voice_reference_url).slice(0, 100) : null,
      content_summary: contentSummary
    });
  } catch (e) {
    log.warn('[VolcOmni] 结构体日志序列化失败', { error: e.message });
  }

  log.info('[VolcOmni] 创建任务', {
    url,
    model: finalModel,
    ratio,
    duration: effectiveDuration,
    image_count: urls.length,
    has_voice_ref: !!voice_reference_url,
    video_gen_id,
  });
  logVideoPostRequest(log, 'VolcOmni', url, body, video_gen_id, {
    model: finalModel,
    ratio,
    duration: effectiveDuration,
    image_count: urls.length,
    has_voice_ref: !!voice_reference_url,
  });

  const res = await fetchVideoWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.api_key || ''),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  log.info('[VolcOmni] 创建响应', {
    video_gen_id,
    status: res.status,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    return videoProviderFailure('VolcOmni', 'video request', res.status, raw);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return videoProviderFailure('VolcOmni', 'video response', res.status, raw);
  }

  const taskId = data.id || data.task_id || (data.data && data.data.id);
  const status = data.status || (data.data && data.data.status);
  const videoUrl = pickProxyVideoUrl(data);
  if (videoUrl) {
    log.info('[VolcOmni] 直接返回 video_url', { video_gen_id });
    return { video_url: videoUrl };
  }
  if (taskId) {
    log.info('[VolcOmni] 返回 task_id', { video_gen_id, task_id: taskId, status });
    return { task_id: taskId, status: status || 'processing' };
  }
  return videoProviderFailure('VolcOmni', 'video response', res.status, data);
}

module.exports = {
  normalizeVolcengineDuration,
  normalizeVolcOmniDuration,
  callVolcengineOmniVideoApi,
};
