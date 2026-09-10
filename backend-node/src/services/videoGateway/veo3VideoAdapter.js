'use strict';

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  videoProviderException,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const {
  isRequestCanceled,
  isRequestTimeout,
  operationCancelledError,
  requestTimeoutError,
} = require('./requestError');
const { resolveVeo3ImageForApi } = require('./mediaRefs');

function classifyVeo3RequestError(error, signal) {
  if (isRequestTimeout(error, signal)) {
    throw requestTimeoutError(error, { provider: 'Veo3', operation: 'video request' });
  }
  if (isRequestCanceled(error, signal)) {
    throw operationCancelledError(error);
  }
  return videoProviderException(error, 'Veo3', 'video request', signal);
}

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

  let res;
  let raw;
  try {
    res = await fetchVideoWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (config.api_key || ''),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    raw = await res.text();
  } catch (error) {
    return { error: classifyVeo3RequestError(error, opts.signal) };
  }
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
    return { error: 'Veo3 视频返回格式异常' };
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
  return { error: 'Veo3 未返回任务编号或视频地址' };
}

module.exports = {
  callVeo3VideoApi,
};
