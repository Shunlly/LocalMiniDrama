'use strict';

const {
  sanitizeProviderException,
  sanitizeProviderResult,
  summarizeProviderResponse,
} = require('./providerErrorSanitizer');
const { pollMinimaxVideo } = require('./videoGateway/minimaxVideoAdapter');
const { pollSoraVideo } = require('./videoGateway/openAiSoraAdapter');
const {
  createSafeVideoLogger,
  videoProviderLabel,
  fetchVideoWithTimeout,
  videoProviderFailure,
  buildQueryUrl,
  extractPollTaskStatus,
  isPollTaskCancelled,
} = require('./videoGateway/helpers');
const {
  validateProviderDispatch,
  validateProviderRequestUrl,
  createProviderNetworkOptions,
} = require('./videoGateway/mediaRefs');
const { resolveVideoTimeoutMs } = require('./videoGateway/providerRuntime');
const { createAdapterRuntime } = require('./videoGateway/protocolDispatch');
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
    log.warn('[poll] 即梦视频不应进入轮询', { video_gen_id: videoGenId, task_id: taskId });
    return { error: '即梦视频为同步返回视频地址，不应进入轮询' };
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
          return videoProviderFailure(videoProviderLabel(provider), 'video task', res.status, raw);
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
  const provider = videoProviderLabel(config?.provider);
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
  pollVideoTask,
};
