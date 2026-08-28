/**
 * TTS synthesis service for MiniMax and OpenAI-compatible providers.
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

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
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
    if (error?.name === 'TimeoutError') {
      const timeoutError = new Error(`${providerName} TTS 请求超时`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
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

  if (response.status !== 200) throw new Error(`MiniMax TTS 请求失败（HTTP ${response.status}）`);
  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error('MiniMax TTS 返回了无效 JSON');
  }
  if (data.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax TTS 返回错误 ${data.base_resp?.status_code ?? 'unknown'}`);
  }
  const audioHex = data.data?.audio;
  if (!audioHex) throw new Error('MiniMax TTS 未返回音频');
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
    throw new Error(`OpenAI TTS 请求失败（HTTP ${response.status}）`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesize(db, log, {
  text,
  storyboard_id,
  config,
  storage_base,
  voice_id,
  speed,
  idempotency_key,
  provider_dns_lookup,
  signal,
}) {
  if (signal?.aborted) throw signal.reason;
  if (!text || !text.trim()) throw badRequest('text 不能为空');
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
  const filename = `tts_sb${storyboard_id || 'x'}_${filenameSuffix}.mp3`;
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
    throw new Error(`不支持的 TTS Provider：${provider}`);
  }

  if (signal?.aborted) throw signal.reason;
  const temporaryPath = path.join(audioDir, `.${filename}.${randomUUID()}.tmp`);
  let publication = null;
  try {
    fs.writeFileSync(temporaryPath, audioBuffer, { flag: 'wx' });
    if (signal?.aborted) throw signal.reason;
    publication = uploadService.publishStagedFile(temporaryPath, filePath);
    if (signal?.aborted) {
      publication.rollback();
      publication = null;
      throw signal.reason;
    }
    publication.commit();
  } catch (error) {
    publication?.rollback();
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
    throw error;
  }
  log.info('[TTS] synthesis complete', { storyboard_id, local_path: localPath, provider });
  try { const cloudService = require('./cloudService'); cloudService.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath };
}

module.exports = {
  DEFAULT_TTS_TIMEOUT_MS,
  normalizeTtsTimeoutMs,
  synthesize,
  synthesizeWithMinimax,
  synthesizeWithOpenai,
};
