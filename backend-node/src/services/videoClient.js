'use strict';

// 视频生成客户端：协议路由、轮询与公开 API。厂商请求实现位于 videoGateway。
const uploadService = require('./uploadService');
const aiConfigService = require('./aiConfigService');
const {
  sanitizeProviderException,
  sanitizeProviderResult,
  summarizeProviderResponse,
} = require('./providerErrorSanitizer');
const {
  pollMinimaxVideo,
} = require('./videoGateway/minimaxVideoAdapter');
const {
  pollSoraVideo,
} = require('./videoGateway/openAiSoraAdapter');
const {
  createSafeVideoLogger,
  videoRequestContext,
  normalizeIdempotencyKey,
  fetchVideoWithTimeout,
  videoProviderFailure,
  resolveVideoProtocol,
  getModelFromConfig,
  buildQueryUrl,
  isPlausibleHttpVideoUrl,
  extractPollTaskStatus,
  isPollTaskCancelled,
  isPollTaskFailed,
  extractPollFailureMessage,
  videoUrlFromRecord,
  pickProxyVideoUrl,
  parseDashScopeVideoUrl,
  formatVideoPostBodyForLog,
  normalizeAspectRatioForApi,
} = require('./videoGateway/helpers');
const {
  isRequestCanceled,
  isRequestTimeout,
  operationCancelledError,
} = require('./videoGateway/requestError');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  validateProviderRequestUrl,
  createProviderNetworkOptions,
  loadReferenceImageBuffer,
} = require('./videoGateway/mediaRefs');
const {
  applyKlingOmniEnvOverrides,
  resolveKlingOmniBaseUrl,
  resolveKlingOmniQueryPathTemplate,
  resolveKlingOmniBearerToken,
  parseKlingOmniPollVideoUrl,
} = require('./videoGateway/klingVideoAdapter');
const {
  buildAgnesVideoImagePayload,
} = require('./videoGateway/agnesVideoAdapter');
const {
  resolveJimengApiImageBuffer,
} = require('./videoGateway/jimengVideoAdapter');
const { resolveVideoTimeoutMs } = require('./videoGateway/providerRuntime');
const {
  VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME,
  applySeedance2CertifiedAssetUrlsToVideoOpts,
  collectActiveCharacterVoiceRefs,
} = require('./videoGateway/seedanceCertifiedAssets');
const {
  dispatchVideoProtocol,
  createAdapterRuntime,
} = require('./videoGateway/protocolDispatch');

// 按 is_default、priority 选择当前启用的视频配置。
function getDefaultVideoConfig(db, preferredModel, preferredProvider) {
  const configs = aiConfigService.listConfigs(db, 'video');
  const selectedModel = String(preferredModel ?? '').trim();
  let active = configs.filter((c) => c.is_active);
  if (active.length === 0) return null;
  if (preferredProvider && String(preferredProvider).trim()) {
    const wanted = String(preferredProvider).trim().toLowerCase();
    const matchingProvider = active.filter((config) => (
      String(config.provider || '').trim().toLowerCase() === wanted
    ));
    if (matchingProvider.length === 0) return null;
    active = matchingProvider;
  }
  if (selectedModel) {
    for (const c of active) {
      const models = aiConfigService.normalizeConfigModels(c).model;
      if (models.includes(selectedModel)) return c;
    }
  }
  const defaultOne = active.find((c) => c.is_default);
  return defaultOne != null ? defaultOne : active[0];
}

/**
 * 调用视频生成 API。
 * @returns {Promise<{ task_id?: string, video_url?: string, error?: string }>}
 */
async function callVideoApiInternal(db, log, opts) {
  log = createSafeVideoLogger(log);
  opts = await validateVideoMediaReferences(opts);
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
    first_frame_url,
    last_frame_url,
    first_frame_local_path,
    last_frame_local_path,
    files_base_url,
    storage_local_path,
    video_gen_id
  } = opts;
  const config = getDefaultVideoConfig(
    db,
    preferredModel,
    opts.preferred_provider || opts.preferredProvider || opts.provider
  );
  if (!config) {
    throw new Error('请先在 AI 配置中添加并启用视频服务');
  }
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: opts.fetch_impl,
    provider_dns_lookup: opts.provider_dns_lookup,
    signal: opts.signal,
  });
  const requestContext = videoRequestContext.getStore();
  if (requestContext) {
    requestContext.networkOptions = providerNetworkOptions;
  }
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const model = getModelFromConfig(config, preferredModel);
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config, preferredModel);
  if (db && opts.drama_id && VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME.has(protocol)) {
    opts = applySeedance2CertifiedAssetUrlsToVideoOpts(db, log, opts);
  }

  // Seedance 2.0 自动注入角色音色参考（仅当模型为 SD2 且未显式指定 voice_reference_url 时）
  const isSeedance2 = /seedance[-_]?2|seedance2|2[-_]0[-_]/.test(String(model || ''));
  if (isSeedance2 && db && opts.drama_id && !opts.voice_reference_url) {
    const voiceMap = collectActiveCharacterVoiceRefs(db, opts.drama_id);
    if (voiceMap.size > 0) {
      // 优先使用分镜显式指定的角色（如果有），否则取第一个
      let chosen = null;
      if (opts.storyboard_id) {
        try {
          const sbRow = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(opts.storyboard_id);
          if (sbRow && sbRow.characters) {
            const charList = typeof sbRow.characters === 'string' ? JSON.parse(sbRow.characters) : sbRow.characters;
            const ids = Array.isArray(charList) ? charList.map(c => Number(c?.id || c)).filter(Boolean) : [];
            for (const cid of ids) {
              if (voiceMap.has(cid)) { chosen = voiceMap.get(cid); break; }
            }
          }
        } catch (_) {}
      }
      if (!chosen) {
        // 取 Map 中的第一个
        chosen = voiceMap.values().next().value;
      }
      if (chosen) {
        const validatedVoice = await uploadService.validateMediaReference(chosen, {
          storagePath: opts.storage_local_path,
          lookup: opts.media_dns_lookup,
        });
        opts.voice_reference_url = validatedVoice.canonical;
        log.info('[视频][SD2][全能] 自动为 Seedance 2.0 注入角色音色参考（来自角色 seedance2_voice_asset）', {
          video_gen_id,
          storyboard_id: opts.storyboard_id,
          voice_ref_url: String(chosen).slice(0, 100)
        });
      } else {
        log.info('[视频][SD2][全能] 检测到活跃音色参考但未匹配到当前分镜角色', {
          video_gen_id,
          storyboard_id: opts.storyboard_id,
          available_voice_char_ids: Array.from(voiceMap.keys())
        });
      }
    } else {
      log.info('[视频][SD2][全能] Seedance 2.0 模型但本剧暂无 active 音色参考', { video_gen_id, drama_id: opts.drama_id });
    }
  }
  log.info('[视频] 路由协议', {
    video_gen_id,
    provider,
    api_protocol_raw: config.api_protocol || '(empty→auto)',
    protocol_used: protocol,
    model,
    endpoint: config.endpoint || '(auto)',
  });

  return dispatchVideoProtocol({
    db,
    log,
    opts,
    config,
    protocol,
    model,
    preferredModel,
    prompt,
    duration,
    aspect_ratio,
    resolution,
    seed,
    camera_fixed,
    watermark,
    image_url,
    first_frame_url,
    last_frame_url,
    first_frame_local_path,
    last_frame_local_path,
    files_base_url,
    storage_local_path,
    video_gen_id,
    providerNetworkOptions,
  });
}

async function callVideoApi(db, log, opts = {}) {
  const idempotencyKey = normalizeIdempotencyKey(opts.idempotency_key);
  return videoRequestContext.run({ idempotencyKey }, async () => {
    const provider = opts.preferred_provider || opts.preferredProvider || opts.provider || 'Video provider';
    try {
      const result = await callVideoApiInternal(db, log, opts);
      return sanitizeProviderResult(result, { provider, operation: '视频生成' });
    } catch (error) {
      if (error?.code === 'VIDEO_INPUT_INVALID') throw error;
      throw sanitizeProviderException(error, { provider, operation: '视频生成' });
    }
  });
}

/** 本地 abort 与厂商 cancelled 都视为取消，不得落到超时。 */
const VIDEO_TASK_CANCELLED_MESSAGE = '视频任务已取消';

function isVideoPollCancelled(error, signal) {
  return !isRequestTimeout(error, signal)
    && (isRequestCanceled(error, signal) || signal?.aborted === true);
}

function throwVideoTaskCancelled() {
  throw operationCancelledError(VIDEO_TASK_CANCELLED_MESSAGE);
}

function throwIfVideoPollAborted(signal) {
  if (signal?.aborted) throwVideoTaskCancelled();
}

function delayVideoPoll(intervalMs, signal) {
  throwIfVideoPollAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(operationCancelledError(VIDEO_TASK_CANCELLED_MESSAGE));
    };
    const timer = setTimeout(finish, intervalMs);
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * ??????????????????/ChatFire ? ???? DashScope?
 */
async function pollVideoTaskInternal(db, log, videoGenId, taskId, config, maxAttempts = 300, intervalMs = 10000, signal) {
  log = createSafeVideoLogger(log);
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: config.fetch_impl,
    provider_dns_lookup: config.provider_dns_lookup,
    signal,
  });
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const provider = (config.provider || '').toLowerCase();
  const protocol = resolveVideoProtocol(config);
  const isDashScope = protocol === 'dashscope';
  const isGemini = protocol === 'gemini';
  const isVidu = protocol === 'vidu';
  const isSora = protocol === 'sora';
  const isMinimax = protocol === 'minimax';
  const isAgnes = protocol === 'agnes';
  const isKling = protocol === 'kling';
  const isKlingOmni = protocol === 'kling_omni' || (typeof taskId === 'string' && taskId.startsWith('omni:'));
  const isVeo3 = protocol === 'veo3';
  const isVolcPoll =
    provider === 'volces' ||
    provider === 'volcengine' ||
    provider === 'volc' ||
    protocol === 'volcengine' ||
    protocol === 'volcengine_omni';
  if (protocol === 'jimeng_ai_api') {
    log.warn('[poll] Jimeng AI API 不应进入轮询', { video_gen_id: videoGenId, task_id: taskId });
    return { error: 'Jimeng AI API 为同步返回视频地址，不应进入轮询' };
  }
  const queryUrl = () => buildQueryUrl(config, taskId);
  log.info('[poll] ????', { video_gen_id: videoGenId, task_id: taskId, protocol, poll_url: queryUrl() });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfVideoPollAborted(signal);
    await delayVideoPoll(intervalMs, signal);
    try {
      if (isSora || isMinimax) {
        const runtime = createAdapterRuntime(config, {
          signal,
          fetch_impl: config.fetch_impl,
          provider_dns_lookup: config.provider_dns_lookup,
          register_remote_cancel: config.register_remote_cancel,
          provider_network_policy: providerNetworkOptions,
        }, log);
        const result = isSora
          ? await pollSoraVideo(config, taskId, runtime)
          : await pollMinimaxVideo(config, taskId, runtime);
        if (result.status === 'pending') continue;
        const adapterCancelledStatus = extractPollTaskStatus(result);
        if (isPollTaskCancelled(adapterCancelledStatus)) {
          log.info('[poll] 厂商任务已取消', {
            video_gen_id: videoGenId,
            task_id: taskId,
            status: adapterCancelledStatus,
          });
          throwVideoTaskCancelled();
        }
        return result;
      }
      let url, headers;
      if (isKling) {
        // task_id 编码格式：`t2v:xxx` / `i2v:xxx` / `mc:xxx`
        const klingBase = (config.base_url || 'https://api.klingai.com').replace(/\/$/, '');
        let actualTaskId = taskId;
        let videoType = 'text2video';
        if (taskId.startsWith('i2v:')) { actualTaskId = taskId.slice(4); videoType = 'image2video'; }
        else if (taskId.startsWith('t2v:')) { actualTaskId = taskId.slice(4); videoType = 'text2video'; }
        else if (taskId.startsWith('mc:'))  { actualTaskId = taskId.slice(3); videoType = 'motion-control'; }
        // 若用户配置了 query_endpoint，优先使用
        let qep = config.query_endpoint || `/v1/videos/${videoType}/{taskId}`;
        qep = String(qep).replace(/\{taskId\}/gi, encodeURIComponent(actualTaskId)).replace(/\{task_id\}/gi, encodeURIComponent(actualTaskId)).replace(/\{id\}/gi, encodeURIComponent(actualTaskId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = klingBase + qep;
        headers = { Authorization: 'Bearer ' + (config.api_key || '') };
      } else if (isKlingOmni) {
        const cfgOmni = applyKlingOmniEnvOverrides(config);
        const omniBase = resolveKlingOmniBaseUrl(cfgOmni);
        let actualId = String(taskId);
        if (actualId.startsWith('omni:')) actualId = actualId.slice(5);
        let qep = resolveKlingOmniQueryPathTemplate(cfgOmni, omniBase);
        qep = String(qep)
          .replace(/\{taskId\}/gi, encodeURIComponent(actualId))
          .replace(/\{task_id\}/gi, encodeURIComponent(actualId))
          .replace(/\{id\}/gi, encodeURIComponent(actualId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = omniBase + qep;
        const bt = resolveKlingOmniBearerToken(cfgOmni, log);
        headers = bt
          ? { Authorization: bt.startsWith('Bearer ') ? bt : `Bearer ${bt}` }
          : {};
      } else if (isGemini) {
        const base = (config.base_url || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        url = `${base}/v1beta/${taskId}`;
        headers = { 'x-goog-api-key': config.api_key || '' };
      } else if (isVidu) {
        const viduBase = (config.base_url || 'https://api.vidu.cn').replace(/\/$/, '');
        const isOfficialVidu = /api\.vidu\.cn/i.test(viduBase);
        const defaultQep = isOfficialVidu ? '/ent/v2/tasks/{taskId}/creations' : '/ent/v2/tasks/{taskId}/creations';
        let qep = config.query_endpoint || defaultQep;
        qep = String(qep).replace(/\{taskId\}/gi, encodeURIComponent(taskId)).replace(/\{task_id\}/gi, encodeURIComponent(taskId)).replace(/\{id\}/gi, encodeURIComponent(taskId));
        if (!qep.startsWith('/')) qep = '/' + qep;
        url = viduBase + qep;
        headers = { Authorization: (isOfficialVidu ? 'Token ' : 'Bearer ') + (config.api_key || '') };
      } else {
        url = queryUrl();
        headers = { Authorization: 'Bearer ' + (config.api_key || '') };
      }
      const pollRound = attempt + 1;
      await validateProviderRequestUrl(url, config, {
        provider_network_policy: providerNetworkOptions,
      });
      log.info('[poll] 发起查询', { video_gen_id: videoGenId, round: pollRound, url });
      const res = await fetchVideoWithTimeout(
        url,
        { method: 'GET', headers },
        resolveVideoTimeoutMs('poll'),
        providerNetworkOptions
      );
      const raw = await res.text();
      log.info('[poll] 查询 HTTP 结果', {
        video_gen_id: videoGenId,
        round: pollRound,
        http_status: res.status,
        ...summarizeProviderResponse(raw),
      });
      if (!res.ok) {
        log.warn('[poll] 查询非 2xx', {
          video_gen_id: videoGenId,
          round: pollRound,
          http_status: res.status,
          ...summarizeProviderResponse(raw),
        });
        if (res.status >= 400 && res.status < 500) {
          return videoProviderFailure(provider || 'Video provider', 'video task', res.status, raw);
        }
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        log.warn('[poll] 响应非 JSON', {
          video_gen_id: videoGenId,
          round: pollRound,
          ...summarizeProviderResponse(raw),
        });
        continue;
      }

      const cancelledStatus = extractPollTaskStatus(data);
      if (isPollTaskCancelled(cancelledStatus)) {
        log.info('[poll] 厂商任务已取消', {
          video_gen_id: videoGenId,
          task_id: taskId,
          status: cancelledStatus,
        });
        throwVideoTaskCancelled();
      }

      if (isKling) {
        if (data.code !== undefined && data.code !== 0) {
          log.warn('[Kling poll] API 错误', { video_gen_id: videoGenId, code: data.code });
          return videoProviderFailure('Kling', 'video task', res.status, data, data.code);
        }
        const status = (data?.data?.task_status || '').toLowerCase();
        log.info('[Kling poll] 状态', { video_gen_id: videoGenId, attempt, status, task_id: taskId });
        if (status === 'succeed') {
          const videoUrl = data?.data?.task_result?.videos?.[0]?.url;
          if (videoUrl) {
            log.info('[Kling poll] 视频生成完成', { video_gen_id: videoGenId, video_url: videoUrl });
            return { video_url: videoUrl };
          }
          return { error: '可灵任务完成但未返回视频地址' };
        }
        if (status === 'failed') {
          log.warn('[Kling poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Kling', 'video task', res.status, data, data.code);
        }
        // submitted / processing → 继续轮询
        continue;
      }

      if (isKlingOmni) {
        if (data.code !== undefined && Number(data.code) !== 0) {
          log.warn('[KlingOmni poll] API 错误', { video_gen_id: videoGenId, code: data.code });
          return videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code);
        }
        const st = (data?.data?.task_status || data?.task_status || data?.status || '').toLowerCase();
        const videoUrlOmni = parseKlingOmniPollVideoUrl(data);
        log.info('[KlingOmni poll] 状态', { video_gen_id: videoGenId, attempt, status: st, has_url: !!videoUrlOmni });
        if (videoUrlOmni) {
          log.info('[KlingOmni poll] 完成', { video_gen_id: videoGenId });
          return { video_url: videoUrlOmni };
        }
        if (st === 'succeed' || st === 'success' || st === 'completed' || st === 'succeeded' || st === 'done') {
          return videoProviderFailure('KlingOmni', 'video task response', res.status, data);
        }
        if (st === 'failed' || st === 'error') {
          return videoProviderFailure('KlingOmni', 'video task', res.status, data, data.code);
        }
        continue;
      }

      if (isVeo3) {
        const status = extractPollTaskStatus(data);
        log.info('[Veo3 poll] task status', { video_gen_id: videoGenId, attempt, status, id: data.task_id || data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Veo3 poll] task failed', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Veo3', 'video task', res.status, data, data?.error?.code);
        }
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl) {
          log.info('[Veo3 poll] video completed', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Veo3 poll] completed but no video_url', summarizeProviderResponse(data));
          return videoProviderFailure('Veo3', 'video task response', res.status, data);
        }
        continue;
      }

      if (isSora) {
        const status = extractPollTaskStatus(data);
        log.info('[Sora poll] ????', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Sora poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Sora', 'video task', res.status, data, data?.error?.code);
        }
        // succeeded / completed / done ? ??? URL
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
          log.info('[Sora poll] ????', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Sora poll] ????????? video_url', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Sora', 'video task response', res.status, data);
        }
        // queued / processing / running ? ????
        continue;
      }

      if (isAgnes) {
        const status = extractPollTaskStatus(data);
        log.info('[Agnes poll] 状态', { video_gen_id: videoGenId, attempt, status, progress: data.progress, id: data.id });
        if (isPollTaskFailed(status)) {
          log.warn('[Agnes poll] 任务失败', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Agnes', 'video task', res.status, data, data?.error?.code);
        }
        const videoUrl = pickProxyVideoUrl(data);
        if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) {
          log.info('[Agnes poll] 完成', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (status === 'succeeded' || status === 'completed' || status === 'done') {
          log.warn('[Agnes poll] 标记完成但未返回 video_url', {
            video_gen_id: videoGenId,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('Agnes', 'video task response', res.status, data);
        }
        continue;
      }

      if (isVidu) {
        const state = (data?.state || data?.status || data?.data?.status || '').toLowerCase();
        log.info('[Vidu poll] ????', { video_gen_id: videoGenId, attempt, state, id: taskId });
        if (state === 'failed' || state === 'error') {
          log.warn('[Vidu poll] ????', { video_gen_id: videoGenId, ...summarizeProviderResponse(data) });
          return videoProviderFailure('Vidu', 'video task', res.status, data, data?.err_code);
        }
        // ?? ent/v2 ???????? success???? creations[0].url
        // ??????????????? succeeded/completed/done???? video_url/url ?
        const videoUrl =
          data?.creations?.[0]?.url ||
          videoUrlFromRecord(data?.creations?.[0]) ||
          pickProxyVideoUrl(data);
        if (videoUrl) {
          log.info('[Vidu poll] ????', { video_gen_id: videoGenId, video_url: videoUrl });
          return { video_url: videoUrl };
        }
        if (state === 'success' || state === 'succeeded' || state === 'completed' || state === 'done') {
          log.warn('[Vidu poll] ???????? video_url', summarizeProviderResponse(data));
          return { error: 'Vidu 任务完成但未返回视频地址' };
        }
        continue;
      }

      if (isGemini) {
        if (data.error) {
          return videoProviderFailure('Gemini', 'video task', res.status, data, data.error?.code);
        }
        if (data.done === true) {
          const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
          if (videoUri) return { video_url: videoUri };
          return { error: 'Gemini 任务完成但未返回视频地址' };
        }
        continue;
      }

      if (isDashScope) {
        const taskStatus = data?.output?.task_status;
        const videoUrl = parseDashScopeVideoUrl(data);
        if (videoUrl) return { video_url: videoUrl };
        if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
          log.warn('DashScope ????????? download image failed????? URL ???????? localhost?', {
            video_gen_id: videoGenId,
            task_id: taskId,
            task_status: taskStatus,
            ...summarizeProviderResponse(data),
          });
          return videoProviderFailure('DashScope', 'video task', res.status, data, data?.code);
        }
        continue;
      }
      const status = extractPollTaskStatus(data);
      const videoUrl = pickProxyVideoUrl(data);
      const failMsg = extractPollFailureMessage(data);
      const errMsg = data.error && (typeof data.error === 'string' ? data.error : data.error.message);
      if (isVolcPoll) {
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
        return videoProviderFailure(provider || 'Video provider', 'video task', res.status, data, data?.error?.code);
      }
      if (videoUrl && isPlausibleHttpVideoUrl(videoUrl)) return { video_url: videoUrl };
      if (failMsg) {
        log.warn('[poll] 上游返回失败文案', {
          video_gen_id: videoGenId,
          round: pollRound,
          ...summarizeProviderResponse(data),
        });
        return videoProviderFailure(provider || 'Video provider', 'video task', res.status, data, data?.error?.code);
      }
    } catch (e) {
      if (isVideoPollCancelled(e, signal)) throwVideoTaskCancelled();
      log.warn('Video poll request failed', { attempt, error: e.message });
    }
  }
  return { error: '视频生成超时，请稍后重试' };
}

async function pollVideoTask(db, log, videoGenId, taskId, config, maxAttempts = 300, intervalMs = 10000, signal) {
  const provider = config?.provider || 'Video provider';
  try {
    const result = await pollVideoTaskInternal(
      db,
      log,
      videoGenId,
      taskId,
      config,
      maxAttempts,
      intervalMs,
      signal
    );
    return sanitizeProviderResult(result, { provider, operation: '视频任务' });
  } catch (error) {
    if (isVideoPollCancelled(error, signal)) throwVideoTaskCancelled();
    throw sanitizeProviderException(error, { provider, operation: '视频任务' });
  }
}

module.exports = {
  getDefaultVideoConfig,
  callVideoApi,
  pollVideoTask,
  normalizeAspectRatioForApi,
  isPlausibleHttpVideoUrl,
  pickProxyVideoUrl,
  buildAgnesVideoImagePayload,
  formatVideoPostBodyForLog,
  resolveVideoProtocol,
  fetchVideoWithTimeout,
  createSafeVideoLogger,
  loadReferenceImageBuffer,
  resolveJimengApiImageBuffer,
  validateProviderDispatch,
  validateProviderRequestUrl,
  validateVideoMediaReferences,
};
