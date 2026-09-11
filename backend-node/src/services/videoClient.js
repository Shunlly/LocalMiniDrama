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
  pickProxyVideoUrl,
  formatVideoPostBodyForLog,
  normalizeAspectRatioForApi,
} = require('./videoGateway/helpers');
const {
  validateVideoMediaReferences,
  validateProviderDispatch,
  validateProviderRequestUrl,
  createProviderNetworkOptions,
  loadReferenceImageBuffer,
} = require('./videoGateway/mediaRefs');
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
const {
  resolveVideoPollFlags,
  buildVideoPollRequest,
  interpretVideoPollResponse,
} = require('./videoGateway/pollDispatch');
const {
  isVideoPollCancelled,
  throwVideoTaskCancelled,
  throwIfVideoPollAborted,
  delayVideoPoll,
} = require('./videoGateway/pollControl');

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

/**
 * 轮询视频生成任务。OpenAI 兼容、ChatFire、火山、可灵、DashScope 等走查询接口；即梦同步协议在进入循环前短路。
 */
async function pollVideoTaskInternal(db, log, videoGenId, taskId, config, maxAttempts = 300, intervalMs = 10000, signal) {
  log = createSafeVideoLogger(log);
  const providerNetworkOptions = createProviderNetworkOptions(config, {
    fetch_impl: config.fetch_impl,
    provider_dns_lookup: config.provider_dns_lookup,
    signal,
  });
  await validateProviderDispatch(config, { provider_network_policy: providerNetworkOptions });
  const flags = resolveVideoPollFlags(config, taskId);
  const provider = flags.provider;
  const protocol = flags.protocol;
  if (protocol === 'jimeng_ai_api') {
    log.warn('[poll] Jimeng AI API 不应进入轮询', { video_gen_id: videoGenId, task_id: taskId });
    return { error: 'Jimeng AI API 为同步返回视频地址，不应进入轮询' };
  }
  const queryUrl = () => buildQueryUrl(config, taskId);
  log.info('[poll] 开始轮询', { video_gen_id: videoGenId, task_id: taskId, protocol, poll_url: queryUrl() });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    throwIfVideoPollAborted(signal);
    await delayVideoPoll(intervalMs, signal);
    try {
      if (flags.isSora || flags.isMinimax) {
        const runtime = createAdapterRuntime(config, {
          signal,
          fetch_impl: config.fetch_impl,
          provider_dns_lookup: config.provider_dns_lookup,
          register_remote_cancel: config.register_remote_cancel,
          provider_network_policy: providerNetworkOptions,
        }, log);
        const result = flags.isSora
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
      const { url, headers } = buildVideoPollRequest(config, taskId, flags, log);
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
      const interpreted = interpretVideoPollResponse({
        flags,
        data,
        res,
        log,
        videoGenId,
        taskId,
        attempt,
        pollRound,
        provider,
      });
      if (interpreted.action === 'continue') continue;
      return interpreted.value;
    } catch (e) {
      if (isVideoPollCancelled(e, signal)) throwVideoTaskCancelled();
      log.warn('[poll] 查询请求失败', { attempt, error: e.message });
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
