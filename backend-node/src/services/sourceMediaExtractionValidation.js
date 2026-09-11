// 从 sourceMediaExtractionService 拆出的 OCR/转写校验：文本结果、配置 URL、识别与转写响应解析。

const { TextDecoder } = require('node:util');
const aiConfigService = require('./aiConfigService');
const { actionableError } = require('./sourceMediaExtractionErrors');

const MAX_EXTRACTED_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRANSCODED_AUDIO_BYTES = 20 * 1024 * 1024;

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseSettings(value) {
  if (!value) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function ensureTextResult(value, emptyMessage = '未能从源文件抽取到可读文本。请更换文件，或检查 OCR/转写配置后重试。') {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw actionableError(emptyMessage);
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTRACTED_TEXT_BYTES) {
    throw actionableError('抽取到的源文本超过 2MB 上限。请拆分源文件后重试。');
  }
  return text;
}

function decodeUtf8Text(buffer) {
  if (buffer.includes(0)) throw actionableError('上传的文本文件包含二进制数据。请改用 UTF-8 纯文本后重试。');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (err) {
    throw actionableError('上传的文本文件必须是有效的 UTF-8 编码。请转换编码后重新上传。', err);
  }
  return ensureTextResult(text.replace(/^\uFEFF/, ''), '上传的文本文件为空。请填入可读文本后重新上传。');
}

function configuredModel(config) {
  let models = config?.model;
  if (typeof models === 'string') {
    try {
      models = JSON.parse(models);
    } catch (_) {
      models = [models];
    }
  }
  const model = aiConfigService.resolveConfiguredModel({ ...config, model: models });
  if (!model) throw actionableError('当前启用的抽取服务缺少模型名。请在「AI 配置」中补全。');
  if (/\r|\n|\0/.test(model)) throw actionableError('配置的模型名称无效。请在「AI 配置」中改为不含换行或空字符的名称。');
  return model.slice(0, 300);
}

function validateEndpointPath(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value || value.length > 1000 || /[\\\0\r\n]/.test(value) || value.includes('?') || value.includes('#')) {
    throw actionableError('配置的服务提交路径无效。请在「AI 配置」中填写相对路径。');
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    throw actionableError('服务提交路径必须相对于已配置的接口地址。请不要填写完整网址。');
  }
  const normalized = value.startsWith('/') ? value : `/${value}`;
  let decoded;
  try {
    decoded = decodeURIComponent(normalized);
  } catch (err) {
    throw actionableError('配置的服务提交路径无效。请在「AI 配置」中填写相对路径。', err);
  }
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw actionableError('配置的服务提交路径不能穿越目录。请改为当前服务下的相对路径。');
  }
  return normalized;
}

function buildConfiguredUrl(config, defaultEndpoint) {
  const rawBase = String(config?.base_url || '').trim();
  if (!rawBase || rawBase.length > 2048) {
    throw actionableError('当前启用的抽取服务缺少有效接口地址。请在「AI 配置」中填写网址。');
  }
  let url;
  try {
    url = new URL(rawBase);
  } catch (err) {
    throw actionableError('配置的服务接口地址无效。请填写合法的网址。', err);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw actionableError('配置的服务接口地址必须是不含账号、查询参数或片段的网址。请修改后重试。');
  }

  const endpoint = validateEndpointPath(config.endpoint || defaultEndpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  if (!basePath.endsWith(endpoint)) {
    url.pathname = endpoint.startsWith(`${basePath}/`) ? endpoint : `${basePath}${endpoint}`;
  }
  if (url.origin !== new URL(rawBase).origin) {
    throw actionableError('配置的服务提交路径必须与接口地址同源。请检查后再试。');
  }
  return url.toString();
}

function authorizationHeaders(config) {
  const key = String(config?.api_key || '');
  if (/\r|\n|\0/.test(key)) throw actionableError('配置的密钥无效。请去掉换行或空字符后重新保存。');
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    return String(part?.text || part?.output_text || part?.content || '');
  }).filter(Boolean).join('\n');
}

function extractVisionResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw actionableError('图片识别服务返回了无效数据。请检查「图片识别」配置的接口响应格式。', err);
  }
  const text = contentText(parsed?.choices?.[0]?.message?.content) ||
    contentText(parsed?.output_text) ||
    contentText(parsed?.output?.[0]?.content);
  return ensureTextResult(text, '图片识别服务未返回可读文本。请更换更清晰的图片，或检查「图片识别」配置。');
}

function transcriptionResponse(body, contentType) {
  if (contentType.startsWith('text/')) return ensureTextResult(body.toString('utf8'), '转写服务未返回文本。请检查音频内容，或核对「语音转写」配置。');
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw actionableError('转写服务返回了无效数据。请检查「语音转写」配置的接口响应格式。', err);
  }
  const text = parsed?.text || parsed?.transcript || parsed?.data?.text || '';
  return ensureTextResult(text, '转写服务未返回文本。请检查音频内容，或核对「语音转写」配置。');
}

function parseProbeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(stdout || '').toString('utf8'));
  } catch (err) {
    throw actionableError('FFprobe 返回了无效的媒体元数据。请更换视频文件后重试。', err);
  }
  const audioStreams = Array.isArray(parsed.streams) ? parsed.streams.filter((stream) => stream.codec_type === 'audio') : [];
  if (!audioStreams.length) throw actionableError('上传的视频没有可转写的音轨。请更换包含音频的视频后重试。');
  const durations = [parsed?.format?.duration, ...audioStreams.map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!durations.length) throw actionableError('无法安全确定上传视频的时长。请更换完整视频文件后重试。');
  return { duration: Math.max(...durations) };
}

function tesseractLanguage(settings) {
  const value = String(settings.tesseract_lang || process.env.SOURCE_OCR_TESSERACT_LANG || 'eng').trim();
  return /^[A-Za-z0-9_+-]{1,80}$/.test(value) ? value : 'eng';
}

function assertAudioWithinTranscriptionLimit(buffer) {
  if (buffer.length > MAX_TRANSCODED_AUDIO_BYTES) {
    throw actionableError('送去转写的音频超过 20MB 上限。请缩短或压缩源文件后重试。');
  }
}

module.exports = {
  MAX_EXTRACTED_TEXT_BYTES,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_TRANSCODED_AUDIO_BYTES,
  assertAudioWithinTranscriptionLimit,
  authorizationHeaders,
  buildConfiguredUrl,
  clampInteger,
  configuredModel,
  decodeUtf8Text,
  ensureTextResult,
  extractVisionResponse,
  parseProbeOutput,
  parseSettings,
  tesseractLanguage,
  transcriptionResponse,
  validateEndpointPath,
};
