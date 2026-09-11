'use strict';

/**
 * 视频轮询的协议请求与响应解释。
 * 即梦同步短路仍留在 videoClient，这里不发真实厂商请求。
 */

const { summarizeProviderResponse } = require('../providerErrorSanitizer');
const {
  videoProviderFailure,
  videoProviderLabel,
  resolveVideoProtocol,
  buildQueryUrl,
  isPlausibleHttpVideoUrl,
  extractPollTaskStatus,
  isPollTaskFailed,
  extractPollFailureMessage,
  videoUrlFromRecord,
  pickProxyVideoUrl,
  parseDashScopeVideoUrl,
} = require('./helpers');
const {
  applyKlingOmniEnvOverrides,
  resolveKlingOmniBaseUrl,
  resolveKlingOmniQueryPathTemplate,
  resolveKlingOmniBearerToken,
  parseKlingOmniPollVideoUrl,
} = require('./klingVideoAdapter');

function resolveVideoPollFlags(config, taskId) {
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config);
  return {
    provider,
    protocol,
    isDashScope: protocol === 'dashscope',
    isGemini: protocol === 'gemini',
    isVidu: protocol === 'vidu',
    isSora: protocol === 'sora',
    isMinimax: protocol === 'minimax',
    isAgnes: protocol === 'agnes',
    isKling: protocol === 'kling',
    isKlingOmni: protocol === 'kling_omni' || (typeof taskId === 'string' && taskId.startsWith('omni:')),
    isVeo3: protocol === 'veo3',
    isVolcPoll:
      provider === 'volces' ||
      provider === 'volcengine' ||
      provider === 'volc' ||
      protocol === 'volcengine' ||
      protocol === 'volcengine_omni',
  };
}

function replaceTaskIdTemplate(template, taskId) {
  return String(template)
    .replace(/\{taskId\}/gi, encodeURIComponent(taskId))
    .replace(/\{task_id\}/gi, encodeURIComponent(taskId))
    .replace(/\{id\}/gi, encodeURIComponent(taskId));
}

function ensureLeadingSlash(pathValue) {
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function buildVideoPollRequest(config, taskId, flags, log) {
  if (flags.isKling) {
    const klingBase = (config.base_url || 'https://api.klingai.com').replace(/\/$/, '');
    let actualTaskId = taskId;
    let videoType = 'text2video';
    if (taskId.startsWith('i2v:')) { actualTaskId = taskId.slice(4); videoType = 'image2video'; }
    else if (taskId.startsWith('t2v:')) { actualTaskId = taskId.slice(4); videoType = 'text2video'; }
    else if (taskId.startsWith('mc:')) { actualTaskId = taskId.slice(3); videoType = 'motion-control'; }
    let qep = config.query_endpoint || `/v1/videos/${videoType}/{taskId}`;
    qep = ensureLeadingSlash(replaceTaskIdTemplate(qep, actualTaskId));
    return {
      url: klingBase + qep,
      headers: { Authorization: 'Bearer ' + (config.api_key || '') },
    };
  }

  if (flags.isKlingOmni) {
    const cfgOmni = applyKlingOmniEnvOverrides(config);
    const omniBase = resolveKlingOmniBaseUrl(cfgOmni);
    let actualId = String(taskId);
    if (actualId.startsWith('omni:')) actualId = actualId.slice(5);
    let qep = resolveKlingOmniQueryPathTemplate(cfgOmni, omniBase);
    qep = ensureLeadingSlash(replaceTaskIdTemplate(qep, actualId));
    const bt = resolveKlingOmniBearerToken(cfgOmni, log);
    return {
      url: omniBase + qep,
      headers: bt
        ? { Authorization: bt.startsWith('Bearer ') ? bt : `Bearer ${bt}` }
        : {},
    };
  }

  if (flags.isGemini) {
    const base = (config.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    return {
      url: `${base}/v1beta/${taskId}`,
      headers: { 'x-goog-api-key': config.api_key || '' },
    };
  }

  if (flags.isVidu) {
    const viduBase = (config.base_url || 'https://api.vidu.cn').replace(/\/$/, '');
    const isOfficialVidu = /api\.vidu\.cn/i.test(viduBase);
    const defaultQep = isOfficialVidu ? '/ent/v2/tasks/{taskId}/creations' : '/ent/v2/tasks/{taskId}/creations';
    let qep = config.query_endpoint || defaultQep;
    qep = ensureLeadingSlash(replaceTaskIdTemplate(qep, taskId));
    return {
      url: viduBase + qep,
      headers: { Authorization: (isOfficialVidu ? 'Token ' : 'Bearer ') + (config.api_key || '') },
    };
  }

  return {
    url: buildQueryUrl(config, taskId),
    headers: { Authorization: 'Bearer ' + (config.api_key || '') },
  };
}

function cont() {
  return { action: 'continue' };
}

function done(value) {
  return { action: 'return', value };
}

function interpretVideoPollResponse(ctx) {
  const {
    flags,
    data,
    res,
    log,
    videoGenId,
    taskId,
    attempt,
    pollRound,
    provider,
  } = ctx;

  if (flags.isKling) {
    if (data.code !== undefined && data.code !== 0) {
      log.warn('[Kling poll] API 错误', { video_gen_id: videoGenId, code: data.code });
      return done(videoProviderFailure('Kling', 'video task', res.status, data, data.code));
    }
    const status = (data?.data?.task_status || '').toLowerCase();
    log.info('[Kling poll] 状态', { video_gen_id: videoGenId, attempt, status, task_id: taskId });
    if (status === 'succeed') {
      const videoUrl = data?.data?.task_result?.videos?.[0]?.url;
      if (videoUrl) {
        log.info('[Kling poll] 视频生成完成', { video_gen_id: videoGenId, video_url: videoUrl });
        return done({ video_url: videoUrl });
      }
      return done({ error: '可灵任务完成但未返回视频地址' });
    }
    if (status === 'failed') {
      log.warn('[Kling poll] 任务失败', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Kling', 'video task', res.status, data, data.code));
    }
    return cont();
  }

  if (flags.isKlingOmni) {
    if (data.code !== undefined && Number(data.code) !== 0) {
      log.warn('[KlingOmni poll] API 错误', { video_gen_id: videoGenId, code: data.code });
      return done(videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code));
    }
    const st = (data?.data?.task_status || data?.task_status || data?.status || '').toLowerCase();
    const videoUrlOmni = parseKlingOmniPollVideoUrl(data);
    log.info('[KlingOmni poll] 状态', { video_gen_id: videoGenId, attempt, status: st, has_url: !!videoUrlOmni });
    if (videoUrlOmni) {
      log.info('[KlingOmni poll] 完成', { video_gen_id: videoGenId });
      return done({ video_url: videoUrlOmni });
    }
    if (st === 'succeed' || st === 'success' || st === 'completed' || st === 'succeeded' || st === 'done') {
      return done(videoProviderFailure('KlingOmni', 'video task response', res.status, data));
    }
    if (st === 'failed' || st === 'error') {
      return done(videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code));
    }
    return cont();
  }

  if (flags.isVeo3) {
    const status = extractPollTaskStatus(data);
    log.info('[Veo3 poll] 任务状态', { video_gen_id: videoGenId, attempt, status, id: data.task_id || data.id });
    if (isPollTaskFailed(status)) {
      log.warn('[Veo3 poll] 任务失败', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Veo3', 'video task', res.status, data, data?.error?.code));
    }
    const videoUrl = pickProxyVideoUrl(data);
    if (videoUrl) {
      log.info('[Veo3 poll] 视频完成', { video_gen_id: videoGenId, video_url: videoUrl });
      return done({ video_url: videoUrl });
    }
    if (status === 'succeeded' || status === 'completed' || status === 'done') {
      log.warn('[Veo3 poll] 状态为完成但未找到 video_url', summarizeProviderResponse(data));
      return done(videoProviderFailure('Veo3', 'video task response', res.status, data));
    }
    return cont();
  }

  if (flags.isSora) {
    const status = extractPollTaskStatus(data);
    log.info('[Sora poll] 任务状态', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
    if (isPollTaskFailed(status)) {
      log.warn('[Sora poll] 任务失败', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Sora', 'video task', res.status, data, data?.error?.code));
    }
    const videoUrl = pickProxyVideoUrl(data);
    if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
      log.info('[Sora poll] 视频完成', { video_gen_id: videoGenId, video_url: videoUrl });
      return done({ video_url: videoUrl });
    }
    if (status === 'succeeded' || status === 'completed' || status === 'done') {
      log.warn('[Sora poll] 状态为完成但未找到 video_url', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Sora', 'video task response', res.status, data));
    }
    return cont();
  }

  if (flags.isAgnes) {
    const status = extractPollTaskStatus(data);
    log.info('[Agnes poll] 状态', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
    if (isPollTaskFailed(status)) {
      log.warn('[Agnes poll] 任务失败', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Agnes', 'video task', res.status, data, data?.error?.code));
    }
    const videoUrl = pickProxyVideoUrl(data);
    if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
      log.info('[Agnes poll] 完成', { video_gen_id: videoGenId, video_url: videoUrl });
      return done({ video_url: videoUrl });
    }
    if (status === 'succeeded' || status === 'completed' || status === 'done') {
      log.warn('[Agnes poll] 标记完成但未返回 video_url', {
        video_gen_id: videoGenId,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('Agnes', 'video task response', res.status, data));
    }
    return cont();
  }

  if (flags.isVidu) {
    const state = (data?.state || data?.status || data?.data?.status || '').toLowerCase();
    log.info('[Vidu poll] 任务状态', { video_gen_id: videoGenId, attempt, state, id: taskId });
    if (state === 'failed' || state === 'error') {
      log.warn('[Vidu poll] 任务失败', { video_gen_id: videoGenId, ...summarizeProviderResponse(data) });
      return done(videoProviderFailure('Vidu', 'video task', res.status, data, data?.err_code));
    }
    const videoUrl =
      data?.creations?.[0]?.url ||
      videoUrlFromRecord(data?.creations?.[0]) ||
      pickProxyVideoUrl(data);
    if (videoUrl) {
      log.info('[Vidu poll] 视频完成', { video_gen_id: videoGenId, video_url: videoUrl });
      return done({ video_url: videoUrl });
    }
    if (state === 'success' || state === 'succeeded' || state === 'completed' || state === 'done') {
      log.warn('[Vidu poll] 状态为完成但未找到 video_url', summarizeProviderResponse(data));
      return done({ error: 'Vidu 任务完成但未返回视频地址' });
    }
    return cont();
  }

  if (flags.isGemini) {
    if (data.error) {
      return done(videoProviderFailure('Gemini', 'video task', res.status, data, data.error?.code));
    }
    if (data.done === true) {
      const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (videoUri) return done({ video_url: videoUri });
      return done({ error: 'Gemini 任务完成但未返回视频地址' });
    }
    return cont();
  }

  if (flags.isDashScope) {
    const taskStatus = data?.output?.task_status;
    const videoUrl = parseDashScopeVideoUrl(data);
    if (videoUrl) return done({ video_url: videoUrl });
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
      log.warn('DashScope 视频任务失败（若为 download image failed，多为图片 URL 非外网可访问，如 localhost）', {
        video_gen_id: videoGenId,
        task_id: taskId,
        task_status: taskStatus,
        ...summarizeProviderResponse(data),
      });
      return done(videoProviderFailure('DashScope', 'video task', res.status, data, data?.code));
    }
    return cont();
  }

  const status = extractPollTaskStatus(data);
  const videoUrl = pickProxyVideoUrl(data);
  const failMsg = extractPollFailureMessage(data);
  const errMsg = data.error && (typeof data.error === 'string' ? data.error : data.error.message);
  if (flags.isVolcPoll) {
    log.info('[poll] 方舟/火山 解析摘要', {
      video_gen_id: videoGenId,
      round: pollRound,
      top_level_status: status,
      has_video_url: !!videoUrl,
      ...summarizeProviderResponse(data),
    });
  }
  if (isPollTaskFailed(status) || errMsg) {
    log.warn('[poll] 任务失败', {
      video_gen_id: videoGenId,
      round: pollRound,
      status,
      ...summarizeProviderResponse(data),
    });
    return done(videoProviderFailure(videoProviderLabel(provider), 'video task', res.status, data, data?.error?.code));
  }
  if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) return done({ video_url: videoUrl });
  if (failMsg) {
    log.warn('[poll] 上游返回失败文案', {
      video_gen_id: videoGenId,
      round: pollRound,
      ...summarizeProviderResponse(data),
    });
    return done(videoProviderFailure(videoProviderLabel(provider), 'video task', res.status, data, data?.error?.code));
  }
  return cont();
}

module.exports = {
  resolveVideoPollFlags,
  buildVideoPollRequest,
  interpretVideoPollResponse,
};