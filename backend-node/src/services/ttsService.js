/**
 * MiniMax / OpenAI 兼容 TTS 合成。
 * 用户可见错误使用简体中文；取消不记失败；超时可重试。
 */
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const aiConfigService = require('./aiConfigService');
const { secureHttpFetch } = require('./secureHttpFetch');
const uploadService = require('./uploadService');

const DEFAULT_TTS_TIMEOUT_MS = 120000;
const MAX_TTS_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TTS_RESPONSE_BYTES = 25 * 1024 * 1024;
const TTS_USER_ERROR = Symbol.for('localMiniDrama.ttsUserError');

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return markTtsUserError(error);
}

function markTtsUserError(error) {
  if (error && typeof error === 'object' && !error[TTS_USER_ERROR]) {
    Object.defineProperty(error, TTS_USER_ERROR, { value: true });
  }
  return error;
}

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function errorMessageOf(error) {
  if (error instanceof Error) return String(error.message || '');
  return String(error || '');
}

function isTimeoutLike(error) {
  if (!error || typeof error !== 'object') {
    return /timeout|timed\s*out|超时/i.test(String(error || ''));
  }
  if (error.isTimeout === true) return true;
  const code = String(error.code || error.providerCode || '');
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'TIMEOUT' || /(?:^|_)TIME(?:D)?OUT$/i.test(code)) {
    return true;
  }
  if (String(error.name || '') === 'TimeoutError') return true;
  return /timeout|timed\s*out|超时/i.test(errorMessageOf(error));
}

function isAbortLike(error) {
  if (!error || typeof error !== 'object') return false;
  const name = String(error.name || '');
  const code = String(error.code || '');
  return name === 'AbortError'
    || name === 'CanceledError'
    || code === 'ERR_CANCELED'
    || code === 'OPERATION_CANCELLED'
    || code === 'ABORT_ERR';
}

function isTtsTimeout(error, signal) {
  return isTimeoutLike(error)
    || isTimeoutLike(error?.cause)
    || isTimeoutLike(signal?.reason);
}

function isTtsCanceled(error, signal) {
  if (isTtsTimeout(error, signal)) return false;
  if (isAbortLike(error) || isAbortLike(error?.cause)) return true;
  if (signal?.aborted === true && !isTimeoutLike(signal?.reason)) {
    return error == null || isAbortLike(error) || error === signal.reason || isAbortLike(error?.cause);
  }
  return false;
}

function ttsTimeoutError(source) {
  if (source && source[TTS_USER_ERROR] && isTtsTimeout(source)) return source;
  const error = new Error('配音生成超时，请稍后重试');
  error.name = 'TimeoutError';
  error.code = 'ETIMEDOUT';
  error.isTimeout = true;
  error.retryable = true;
  if (source instanceof Error) error.cause = source;
  return markTtsUserError(error);
}

function ttsCanceledError(reason) {
  if (reason && typeof reason === 'object' && isTtsTimeout(reason)) {
    return ttsTimeoutError(reason);
  }
  if (reason && reason[TTS_USER_ERROR] && isTtsCanceled(reason) && reason.code === 'OPERATION_CANCELLED') {
    return reason;
  }
  const raw = errorMessageOf(reason);
  const error = new Error(hasCjk(raw) ? raw : '配音已取消');
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  error.retryable = false;
  if (reason instanceof Error) error.cause = reason;
  return markTtsUserError(error);
}

function ttsHttpFailureMessage(status) {
  if (status === 401 || status === 403) return 'TTS 认证失败，请检查「AI 配置」中的密钥后重试';
  if (status === 404) return 'TTS 接口不存在，请检查「AI 配置」后重试';
  if (status === 408 || status === 429) return '配音生成繁忙，请稍后重试';
  return '配音生成失败，请稍后重试';
}

function ttsHttpRetryable(status) {
  return status === 408 || status === 429 || status >= 500;
}

function extractHttpStatus(error) {
  if (error && typeof error === 'object') {
    for (const candidate of [error.status, error.statusCode, error.httpStatus, error.http_status, error.response?.status]) {
      const status = Number(candidate);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
  }
  const match = errorMessageOf(error).match(/\bHTTP\s*[:=]?\s*(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function ttsHttpError(status, source) {
  const code = Number(status);
  const error = new Error(ttsHttpFailureMessage(code));
  error.status = code;
  error.retryable = ttsHttpRetryable(code);
  if (source instanceof Error) error.cause = source;
  return markTtsUserError(error);
}

function ttsFailedError(message, options = {}) {
  const error = new Error(message || '配音生成失败，请稍后重试');
  error.retryable = options.retryable !== false;
  if (options.code) error.code = options.code;
  if (options.status) error.status = options.status;
  if (options.cause instanceof Error) error.cause = options.cause;
  return markTtsUserError(error);
}

function looksPassthroughPolicyError(error) {
  const code = String(error?.code || '');
  return code === 'BAD_REQUEST'
    || code === 'INVALID_PROVIDER_URL'
    || code === 'INVALID_AI_CONFIG'
    || code === 'UNSAFE_MEDIA_REFERENCE'
    || error?.name === 'UnsafeMediaReferenceError';
}

function toUserFacingTtsError(error, signal) {
  if (error && error[TTS_USER_ERROR]) {
    if (isTtsTimeout(error, signal) && error.retryable !== true) error.retryable = true;
    return error;
  }
  if (isTtsTimeout(error, signal)) return ttsTimeoutError(error);
  if (isTtsCanceled(error, signal)) return ttsCanceledError(error || signal?.reason);
  if (looksPassthroughPolicyError(error)) {
    if (hasCjk(errorMessageOf(error))) return markTtsUserError(error);
    return ttsFailedError('当前 TTS 地址不可用，请检查「AI 配置」后重试', {
      retryable: false,
      code: error.code || 'UNSAFE_MEDIA_REFERENCE',
      cause: error,
    });
  }
  const status = extractHttpStatus(error);
  if (status) return ttsHttpError(status, error);
  const message = errorMessageOf(error);
  if (/redirect/i.test(message)) {
    return ttsFailedError('TTS 请求被重定向，已拦截，请检查服务地址后重试', {
      retryable: false,
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|ERR_NETWORK|network error|fetch failed|socket hang up/i.test(`${error?.code || ''} ${message}`)) {
    return ttsFailedError('配音服务连接失败，请检查网络后重试', {
      retryable: true,
      code: error?.code || 'ERR_NETWORK',
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (hasCjk(message) && !/unknown|invalid JSON|cannot be empty|not allowed/i.test(message)) {
    const wrapped = new Error(message);
    wrapped.name = error?.name || 'Error';
    wrapped.code = error?.code;
    wrapped.retryable = error?.retryable === true;
    if (error instanceof Error) wrapped.cause = error;
    return markTtsUserError(wrapped);
  }
  return ttsFailedError('配音生成失败，请稍后重试', {
    retryable: true,
    cause: error instanceof Error ? error : undefined,
  });
}

function normalizeOptionalId(value, fieldLabel) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(`${fieldLabel} 无效`);
  return parsed;
}

function lookupStoryboardDramaId(db, storyboardId) {
  if (!db || typeof db.prepare !== 'function' || storyboardId == null) return null;
  try {
    const stmt = db.prepare(
      `SELECT e.drama_id AS drama_id
         FROM storyboards s
         JOIN episodes e ON e.id = s.episode_id
        WHERE s.id = ?
          AND s.deleted_at IS NULL
          AND e.deleted_at IS NULL`
    );
    if (typeof stmt.get !== 'function') return null;
    const row = stmt.get(storyboardId);
    return row || null;
  } catch (_) {
    return null;
  }
}

function assertStoryboardDramaScope(db, storyboardId, dramaId) {
  if (storyboardId == null || dramaId == null) return;
  const row = lookupStoryboardDramaId(db, storyboardId);
  if (!row) throw badRequest('分镜不存在或已删除');
  if (Number(row.drama_id) !== Number(dramaId)) {
    throw badRequest('分镜不属于当前项目，无法合成语音');
  }
}

function normalizeIdempotencyKey(value) {
  return String(value || '').trim().slice(0, 200);
}

function normalizeTtsTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTS_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(parsed), 1000), MAX_TTS_TIMEOUT_MS);
}

async function postTtsRequest(url, body, headers, timeoutMs, providerName, networkOptions = {}) {
  try {
    return await secureHttpFetch(url, {
      method: 'POST',
      headers,
      body,
      signal: networkOptions.signal,
      redirect: 'error',
    }, {
      ...networkOptions,
      requireHttpsForPublic: true,
      maxRedirects: 0,
      maxBytes: MAX_TTS_RESPONSE_BYTES,
      timeoutMs: normalizeTtsTimeoutMs(timeoutMs),
    });
  } catch (error) {
    throw toUserFacingTtsError(error, networkOptions.signal);
  }
}

async function synthesizeWithMinimax(
  text,
  voiceId,
  apiKey,
  groupId,
  model,
  baseUrl,
  timeoutMs,
  idempotencyKey,
  networkOptions = {}
) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const base = (baseUrl || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
  const url = `${base}/t2a_v2?GroupId=${encodeURIComponent(groupId || '')}`;
  const response = await postTtsRequest(url, body, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(normalizeIdempotencyKey(idempotencyKey)
      ? { 'Idempotency-Key': normalizeIdempotencyKey(idempotencyKey) }
      : {}),
  }, timeoutMs, 'MiniMax', networkOptions);

  if (response.status !== 200) throw ttsHttpError(response.status);
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw ttsFailedError('配音生成失败，请稍后重试', { retryable: true, cause: error });
  }
  if (data.base_resp?.status_code !== 0) {
    throw ttsFailedError('配音生成失败，请稍后重试', { retryable: true });
  }
  const audioHex = data.data?.audio;
  if (!audioHex) throw ttsFailedError('配音生成失败，请稍后重试', { retryable: true });
  return Buffer.from(audioHex, 'hex');
}

async function synthesizeWithOpenai(
  text,
  voice,
  apiKey,
  baseUrl,
  model,
  speed,
  timeoutMs,
  idempotencyKey,
  networkOptions = {}
) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  const response = await postTtsRequest(url, body, {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(normalizeIdempotencyKey(idempotencyKey)
      ? { 'Idempotency-Key': normalizeIdempotencyKey(idempotencyKey) }
      : {}),
  }, timeoutMs, 'OpenAI', networkOptions);

  if (response.status < 200 || response.status >= 300) {
    throw ttsHttpError(response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesize(db, log, {
  text,
  storyboard_id,
  drama_id,
  config,
  storage_base,
  voice_id,
  speed,
  idempotency_key,
  provider_dns_lookup,
  signal,
}) {
  try {
    if (signal?.aborted) throw ttsCanceledError(signal.reason);
    const storyboardId = normalizeOptionalId(storyboard_id, '分镜 ID');
    const dramaId = normalizeOptionalId(drama_id, '项目 ID');
    assertStoryboardDramaScope(db, storyboardId, dramaId);
    if (!text || !text.trim()) throw badRequest('对白为空，无法合成语音');
    const ttsConfig = config || (() => {
      const configs = aiConfigService.listConfigs(db, 'tts');
      const active = configs.filter((item) => item.is_active);
      return active.find((item) => item.is_default) || active[0];
    })();
    if (!ttsConfig) throw badRequest('未配置 TTS 服务，请在「AI 配置」中启用配音模型');

    const provider = String(ttsConfig.provider || '').toLowerCase();
    let ttsSettings = {};
    if (ttsConfig.settings && typeof ttsConfig.settings === 'object') {
      ttsSettings = ttsConfig.settings;
    } else {
      try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
    }
    const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
    const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
    const ttsModel = aiConfigService.resolveConfiguredModel(ttsConfig, null, '');
    const finalSpeed = speed || ttsSettings.speed || 1.0;
    const timeoutMs = normalizeTtsTimeoutMs(ttsSettings.timeout_ms || ttsSettings.timeout);
    const idempotencyKey = normalizeIdempotencyKey(idempotency_key);
    const networkOptions = aiConfigService.getProviderNetworkOptions(ttsConfig, {
      lookup: provider_dns_lookup,
      signal,
    });

    const audioDir = path.join(storage_base, 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    const filenameSuffix = idempotencyKey
      ? createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 16)
      : randomUUID().slice(0, 8);
    const filename = `tts_sb${storyboardId || 'x'}_${filenameSuffix}.mp3`;
    const filePath = path.join(audioDir, filename);
    const localPath = `audio/${filename}`;
    if (idempotencyKey && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return { local_path: localPath, idempotent_reuse: true };
    }

    let audioBuffer;
    if (provider === 'minimax') {
      audioBuffer = await synthesizeWithMinimax(
        text,
        voiceId || 'female-shaonv',
        ttsConfig.api_key,
        groupId,
        ttsModel || 'speech-02-hd',
        ttsConfig.base_url,
        timeoutMs,
        idempotencyKey,
        networkOptions
      );
    } else if (provider === 'openai' || ttsConfig.base_url) {
      audioBuffer = await synthesizeWithOpenai(
        text,
        voiceId || 'alloy',
        ttsConfig.api_key,
        ttsConfig.base_url,
        ttsModel || 'tts-1',
        finalSpeed,
        timeoutMs,
        idempotencyKey,
        networkOptions
      );
    } else {
      throw badRequest('当前 TTS 配置不受支持，请在「AI 配置」中更换配音模型');
    }

    if (signal?.aborted) throw ttsCanceledError(signal.reason);
    const temporaryPath = path.join(audioDir, `.${filename}.${randomUUID()}.tmp`);
    let publication = null;
    try {
      fs.writeFileSync(temporaryPath, audioBuffer, { flag: 'wx' });
      if (signal?.aborted) throw ttsCanceledError(signal.reason);
      publication = uploadService.publishStagedFile(temporaryPath, filePath);
      if (signal?.aborted) {
        publication.rollback();
        publication = null;
        throw ttsCanceledError(signal.reason);
      }
      publication.commit();
    } catch (error) {
      publication?.rollback();
      try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
      throw error;
    }
    log.info('[TTS] synthesis complete', { storyboard_id: storyboardId, local_path: localPath, provider });
    try { const cloudService = require('./cloudService'); cloudService.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
    return { local_path: localPath };
  } catch (error) {
    throw toUserFacingTtsError(error, signal);
  }
}

module.exports = {
  DEFAULT_TTS_TIMEOUT_MS,
  assertStoryboardDramaScope,
  isTtsCanceled,
  isTtsTimeout,
  normalizeOptionalId,
  normalizeTtsTimeoutMs,
  synthesize,
  synthesizeWithMinimax,
  synthesizeWithOpenai,
  toUserFacingTtsError,
};
