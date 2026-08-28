'use strict';

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const { resolveVeo3ImageForApi } = require('./mediaRefs');

/**
 * Veo3 (api_protocol = 'veo3')
 * body: { model, prompt, enhance_prompt: true, images: [base64 or url] }
 * endpoint default: /v1/video/create
 */
async function callVeo3VideoApi(config, log, opts) {
  const { prompt, model, image_url, storage_local_path, video_gen_id } = opts;

  const base = (config.base_url || '').replace(/\/$/, '');
  let ep = config.endpoint || '/v1/video/create';
  if (!ep.startsWith('/')) ep = '/' + ep;
  const url = base + ep;

  const body = {
    model: model || '',
    prompt: prompt || '',
    enhance_prompt: true,
  };

  const rawImgUrl = (image_url || '').trim();
  if (rawImgUrl) {
    const resolved = await resolveVeo3ImageForApi(rawImgUrl, storage_local_path, log, video_gen_id);
    if (resolved && resolved.value) {
      body.images = [resolved.value];
      log.info('[视频参考图] Veo3 已解析', {
        transport: resolved.kind,
        value_head: String(resolved.value).slice(0, 80),
        video_gen_id,
      });
    }
  }

  log.info('[Veo3] Video API request', {
    url, model,
    has_image: !!body.images,
    prompt_len: (prompt || '').length,
    video_gen_id,
  });
  logVideoPostRequest(log, 'Veo3', url, body, video_gen_id, { model });

  const res = await fetchVideoWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.api_key || ''),
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  log.info('[Veo3] response summary', {
    status: res.status,
    video_gen_id,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    return videoProviderFailure('Veo3', 'video request', res.status, raw);
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    return videoProviderFailure('Veo3', 'video response', res.status, raw);
  }

  const directUrl = pickProxyVideoUrl(data);
  if (directUrl) {
    log.info('[Veo3] direct video URL', { video_url: directUrl, video_gen_id });
    return { video_url: directUrl };
  }

  const taskId = data.task_id || data.id || data.request_id || data.data?.task_id || data.data?.id;
  if (taskId) {
    log.info('[Veo3] task ID returned', { task_id: taskId, status: data.status, video_gen_id });
    return { task_id: String(taskId), status: data.status || 'processing' };
  }

  log.error('[Veo3] cannot parse task_id or video_url', {
    video_gen_id,
    ...summarizeProviderResponse(data),
  });
  return videoProviderFailure('Veo3', 'video response', res.status, data);
}

module.exports = {
  callVeo3VideoApi,
};
