'use strict';

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  fetchVideoWithTimeout,
  videoProviderFailure,
  pickProxyVideoUrl,
  logVideoPostRequest,
} = require('./helpers');
const { resolveImageInputForAgnesAsync } = require('./mediaRefs');

/** Agnes Video V2.0：POST /videos JSON，轮询 GET /videos/{task_id} */
const AGNES_ALLOWED_NUM_FRAMES = [81, 121, 161, 241, 441];

function agnesDimensionsFromAspectRatio(ratio) {
  const map = {
    '16:9': { width: 1152, height: 768 },
    '9:16': { width: 768, height: 1152 },
    '4:3': { width: 1024, height: 768 },
    '3:4': { width: 768, height: 1024 },
    '1:1': { width: 768, height: 768 },
    '21:9': { width: 1344, height: 576 },
  };
  return map[ratio] || map['16:9'];
}

function agnesSnapNumFrames(durationSec, frameRate = 24) {
  const target = Math.round((Number(durationSec) || 5) * frameRate);
  let best = AGNES_ALLOWED_NUM_FRAMES[0];
  for (const v of AGNES_ALLOWED_NUM_FRAMES) {
    if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  }
  return best;
}

/**
 * Agnes 视频入参图片策略（可单测）：
 * - 顶层 image 仅支持 string（服务端 Go 结构体不接受 array）
 * - 全能多图参考：extra_body.image 数组，且禁止 mode: keyframes
 * - 经典首尾帧：extra_body.mode = keyframes + 恰好两张图
 */
function buildAgnesVideoImagePayload({ useOmniReference, resolvedRefs, firstResolved, lastResolved }) {
  const refs = Array.isArray(resolvedRefs) ? resolvedRefs.filter(Boolean) : [];
  if (useOmniReference && refs.length >= 2) {
    return {
      strategy: 'omni_reference_extra_body',
      extra_body: { image: refs.slice(0, 10) },
    };
  }
  if (useOmniReference && refs.length === 1) {
    return {
      strategy: 'omni_reference_single',
      image: refs[0],
    };
  }
  if (!useOmniReference && firstResolved && lastResolved && firstResolved !== lastResolved) {
    return {
      strategy: 'classic_keyframes',
      extra_body: { mode: 'keyframes', image: [firstResolved, lastResolved] },
    };
  }
  if (firstResolved) {
    return {
      strategy: 'classic_i2v',
      image: firstResolved,
    };
  }
  return { strategy: 'text_only' };
}

async function callAgnesVideoApi(db, config, log, opts) {
  const {
    prompt,
    model,
    duration,
    aspect_ratio,
    image_url,
    first_frame_url,
    last_frame_url,
    reference_urls,
    files_base_url,
    storage_local_path,
    video_gen_id,
  } = opts;

  const base = (config.base_url || 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '');
  let ep = config.endpoint || '/videos';
  if (!ep.startsWith('/')) ep = '/' + ep;
  const url = base + ep;

  const frameRate = 24;
  const dims = agnesDimensionsFromAspectRatio(aspect_ratio || '16:9');
  const numFrames = agnesSnapNumFrames(duration, frameRate);

  const body = {
    model: model || 'agnes-video-v2.0',
    prompt: prompt || '',
    width: dims.width,
    height: dims.height,
    num_frames: numFrames,
    frame_rate: frameRate,
  };

  const rawRefList = Array.isArray(reference_urls) ? reference_urls.filter(Boolean) : [];
  const resolvedRefs = [];
  const seen = new Set();
  for (let i = 0; i < rawRefList.length; i++) {
    const r = await resolveImageInputForAgnesAsync(
      db,
      rawRefList[i],
      files_base_url,
      storage_local_path,
      log,
      video_gen_id,
      `ref_${i}`
    );
    if (r && !seen.has(r)) {
      seen.add(r);
      resolvedRefs.push(r);
    }
  }

  const rawFirst = (first_frame_url || image_url || '').toString().trim();
  const rawLast = (last_frame_url || '').toString().trim();
  const useOmniReference = rawRefList.length > 0;

  let firstResolved = null;
  let lastResolved = null;
  if (!useOmniReference) {
    firstResolved = rawFirst
      ? await resolveImageInputForAgnesAsync(db, rawFirst, files_base_url, storage_local_path, log, video_gen_id, 'first_frame')
      : null;
    lastResolved = rawLast
      ? await resolveImageInputForAgnesAsync(db, rawLast, files_base_url, storage_local_path, log, video_gen_id, 'last_frame')
      : null;
  }

  if (rawRefList.length > 0 && resolvedRefs.length === 0) {
    return {
      error: 'Agnes 视频参考图须为公网 URL，本地图上传图床失败（imageproxy.zhongzhuan.chat 可能无法访问）。请检查网络/代理，或将 storage.base_url 配置为 Agnes 可访问的公网地址后重试。',
    };
  }

  const imagePayload = buildAgnesVideoImagePayload({
    useOmniReference,
    resolvedRefs,
    firstResolved,
    lastResolved,
  });
  if (imagePayload.image != null) {
    body.image = imagePayload.image;
  }
  if (imagePayload.extra_body) {
    body.extra_body = imagePayload.extra_body;
  }

  log.info('[Agnes] 参考图输入（解析前）', {
    video_gen_id,
    use_omni_reference: useOmniReference,
    raw_ref_count: rawRefList.length,
    raw_refs: rawRefList.map((u, i) => ({ index: i, url: String(u) })),
    raw_first_frame: rawFirst || null,
    raw_last_frame: rawLast || null,
  });
  log.info('[Agnes] 参考图解析结果', {
    video_gen_id,
    resolved_ref_count: resolvedRefs.length,
    resolved_refs: resolvedRefs.map((u, i) => ({ index: i, url: u })),
    first_resolved: firstResolved,
    last_resolved: lastResolved,
    image_strategy: imagePayload.strategy,
  });

  logVideoPostRequest(log, 'Agnes', url, body, video_gen_id, {
    model: body.model,
    width: body.width,
    height: body.height,
    num_frames: body.num_frames,
    frame_rate: body.frame_rate,
    duration_sec: duration,
    aspect_ratio: aspect_ratio || '16:9',
    image_strategy: imagePayload.strategy,
    extra_body_mode: body.extra_body?.mode || null,
    omni_reference: useOmniReference,
    prompt_len: (body.prompt || '').length,
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
  log.info('[Agnes] response summary', {
    status: res.status,
    video_gen_id,
    ...summarizeProviderResponse(raw),
  });

  if (!res.ok) {
    return videoProviderFailure('Agnes', 'video request', res.status, raw);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return videoProviderFailure('Agnes', 'video response', res.status, raw);
  }

  const directUrl = pickProxyVideoUrl(data);
  if (directUrl) {
    log.info('[Agnes] 直接返回 video_url', { video_url: directUrl, video_gen_id });
    return { video_url: directUrl };
  }

  const taskId = data.id || data.task_id || data.data?.id || data.data?.task_id;
  if (taskId) {
    log.info('[Agnes] 返回 task_id', { task_id: taskId, status: data.status, video_gen_id });
    return { task_id: String(taskId), status: data.status || 'processing' };
  }

  log.error('[Agnes] 无 task_id 或 video_url', { video_gen_id, ...summarizeProviderResponse(data) });
  return videoProviderFailure('Agnes', 'video response', res.status, data);
}

module.exports = {
  buildAgnesVideoImagePayload,
  callAgnesVideoApi,
};
