'use strict';

// 从 comfyUiClient 拆出的协议解析：配置、工作流占位符与历史输出解释。本模块不接真实 ComfyUI。

const crypto = require('crypto');
const path = require('path');
const { isSensitiveFieldKey } = require('./sensitiveFieldPolicy');
const { ComfyUiError, trustedChineseDetail } = require('./comfyUiErrors');

function parseSettings(config) {
  const raw = config?.settings;
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const nested = raw.comfyui && typeof raw.comfyui === 'object' ? raw.comfyui : {};
    return { ...raw, ...nested };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const nested = parsed.comfyui && typeof parsed.comfyui === 'object' ? parsed.comfyui : {};
    return { ...parsed, ...nested };
  } catch (_) {
    throw new ComfyUiError('ComfyUI 配置不是有效的 JSON', 'INVALID_SETTINGS');
  }
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new ComfyUiError('ComfyUI 接口地址未配置', 'INVALID_CONFIG');
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new ComfyUiError('ComfyUI 接口地址无效', 'INVALID_CONFIG');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ComfyUiError('ComfyUI 接口地址必须是无内嵌凭据的 HTTP(S) 地址', 'INVALID_CONFIG');
  }
  return text;
}

function joinUrl(baseUrl, endpoint) {
  const suffix = String(endpoint || '').trim() || '/';
  return `${baseUrl}/${suffix.replace(/^\/+/, '')}`;
}

function numericSetting(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function normalizeHeaderValue(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeCustomHeaders(settings) {
  const headers = {};
  for (const [key, value] of Object.entries(settings?.headers || {})) {
    const normalizedValue = normalizeHeaderValue(value);
    if (normalizedValue) headers[key] = normalizedValue;
  }
  return headers;
}

function collectSecrets(config, settings) {
  const secrets = [];
  const apiKey = normalizeHeaderValue(config?.api_key);
  if (apiKey) secrets.push(apiKey);
  for (const [key, value] of Object.entries(normalizeCustomHeaders(settings))) {
    if (isSensitiveFieldKey(key)) secrets.push(value);
  }
  return [...new Set(secrets)];
}

function buildHeaders(config, settings, json = false) {
  const headers = {};
  for (const [key, value] of Object.entries(normalizeCustomHeaders(settings))) {
    if (!json && key.toLowerCase() === 'content-type') continue;
    headers[key] = value;
  }
  const apiKey = normalizeHeaderValue(config?.api_key);
  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function parseDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  try {
    const buffer = match[2]
      ? Buffer.from(match[3].replace(/\s/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(match[3]));
    return { buffer, mimeType, filename: `reference.${extensionForMime(mimeType)}` };
  } catch (_) {
    throw new ComfyUiError('ComfyUI 参考图内嵌地址无效', 'INVALID_REFERENCE');
  }
}

function extensionForMime(mimeType) {
  const normalized = String(mimeType || '').split(';')[0].toLowerCase();
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  }[normalized] || 'png';
}

function mimeForFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
  }[ext] || 'application/octet-stream';
}

function getWorkflowTemplate(config, settings) {
  let template = settings.workflow ?? settings.workflow_json ?? settings.workflow_template ?? config?.workflow;
  if (typeof template === 'string') {
    try {
      template = JSON.parse(template);
    } catch (_) {
      throw new ComfyUiError('ComfyUI 工作流模板不是有效的 JSON', 'INVALID_WORKFLOW');
    }
  }
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new ComfyUiError('ComfyUI 工作流模板未配置', 'INVALID_WORKFLOW');
  }
  return template;
}

function tokenMatches(value) {
  const text = String(value);
  const exact = text.match(/^\s*(?:\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\$\{\s*([A-Za-z0-9_.-]+)\s*\}|__([A-Za-z0-9_.-]+)__)\s*$/);
  return exact ? (exact[1] || exact[2] || exact[3]) : null;
}

function replaceWorkflowPlaceholders(template, replacements) {
  const values = new Map(Object.entries(replacements || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
  const unresolved = new Set();
  const lookup = (name) => {
    const key = String(name).toLowerCase();
    if (values.has(key)) return values.get(key);
    if (/^(?:reference|input)_image_?\d+$/.test(key)) return '';
    unresolved.add(name);
    return undefined;
  };
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    }
    if (typeof value !== 'string') return value;
    const exactName = tokenMatches(value);
    if (exactName) {
      const exactValue = lookup(exactName);
      return exactValue === undefined ? value : exactValue;
    }
    return value.replace(
      /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\$\{\s*([A-Za-z0-9_.-]+)\s*\}|__([A-Za-z0-9_.-]+)__/g,
      (match, curly, dollar, underscored) => {
        const replacement = lookup(curly || dollar || underscored);
        if (replacement === undefined) return match;
        return Array.isArray(replacement) || (replacement && typeof replacement === 'object')
          ? JSON.stringify(replacement)
          : String(replacement);
      }
    );
  };
  const workflow = visit(template);
  if (unresolved.size > 0) {
    throw new ComfyUiError(`ComfyUI 工作流存在未定义占位符：${Array.from(unresolved).join(', ')}`, 'INVALID_WORKFLOW');
  }
  return workflow;
}

function parseSize(size) {
  const match = String(size || '').match(/(\d+)\s*[xX*×]\s*(\d+)/);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function buildWorkflow(config, settings, opts, uploadedReferences) {
  const template = getWorkflowTemplate(config, settings);
  const { width, height } = parseSize(opts.size);
  const configuredSeed = opts.seed ?? settings.seed;
  const parsedSeed = Number(configuredSeed);
  const seed = configuredSeed == null || configuredSeed === '' || !Number.isFinite(parsedSeed)
    ? crypto.randomBytes(6).readUIntBE(0, 6)
    : parsedSeed;
  const customValues = {
    ...(settings.variables && typeof settings.variables === 'object' ? settings.variables : {}),
    ...(opts.workflow_variables && typeof opts.workflow_variables === 'object' ? opts.workflow_variables : {}),
  };
  const replacements = {
    ...customValues,
    prompt: String(opts.prompt || ''),
    negative_prompt: String(opts.negative_prompt || ''),
    model: String(opts.model || config.default_model || ''),
    width,
    height,
    size: String(opts.size || `${width}x${height}`),
    seed,
    batch_size: Number(opts.batch_size || 1),
    quality: String(opts.quality || ''),
    reference_image: uploadedReferences[0] || '',
    input_image: uploadedReferences[0] || '',
    reference_images: uploadedReferences,
  };
  uploadedReferences.forEach((reference, index) => {
    replacements[`reference_image_${index + 1}`] = reference;
    replacements[`input_image_${index + 1}`] = reference;
  });
  return replaceWorkflowPlaceholders(template, replacements);
}

function getHistoryEntry(history, promptId) {
  if (!history || typeof history !== 'object') return null;
  return history[promptId] || (history.prompt_id === promptId ? history : null);
}

function historyErrorMessage(entry) {
  const status = entry?.status;
  const statusText = String(status?.status_str || status?.status || '').toLowerCase();
  if (!/error|failed/.test(statusText)) return '';
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    const payload = Array.isArray(item) ? item[1] : item;
    const message = payload?.exception_message || payload?.message || payload?.error;
    if (message) return String(message);
  }
  return '工作流执行失败';
}

function extractOutputs(entry, settings) {
  const outputs = entry?.outputs;
  if (!outputs || typeof outputs !== 'object') return [];
  const configuredNodes = settings.output_node_ids || (settings.output_node_id != null ? [settings.output_node_id] : null);
  const nodeIds = configuredNodes
    ? configuredNodes.map(String)
    : Object.keys(outputs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const items = [];
  for (const nodeId of nodeIds) {
    const nodeOutput = outputs[nodeId];
    for (const image of nodeOutput?.images || []) {
      if (image?.filename) items.push(image);
    }
  }
  return items;
}

function interpretHistoryPoll(history, promptId, settings, secrets) {
  const entry = getHistoryEntry(history, promptId);
  if (!entry) return { status: 'pending' };
  const providerError = historyErrorMessage(entry);
  if (providerError) {
    const safe = trustedChineseDetail(providerError, secrets);
    return {
      status: 'failed',
      error: new ComfyUiError(safe ? `ComfyUI 工作流执行失败：${safe}` : 'ComfyUI 工作流执行失败', 'COMFYUI_EXECUTION', { promptId }),
    };
  }
  const images = extractOutputs(entry, settings);
  if (images.length > 0) return { status: 'completed', images };
  if (entry?.status?.completed === true) {
    return {
      status: 'failed',
      error: new ComfyUiError('ComfyUI 工作流已完成但没有图片输出', 'COMFYUI_NO_OUTPUT', { promptId }),
    };
  }
  return { status: 'pending' };
}

function resolveHistoryEndpoint(config, settings, promptId) {
  const endpointTemplate = config.query_endpoint || settings.history_endpoint || '/history/{promptId}';
  return endpointTemplate
    .replace(/\{promptId\}/g, encodeURIComponent(promptId))
    .replace(/\{taskId\}/g, encodeURIComponent(promptId));
}

function parseSubmittedPromptId(submitted) {
  return submitted?.prompt_id || submitted?.promptId || null;
}

module.exports = {
  buildHeaders,
  buildWorkflow,
  collectSecrets,
  extractOutputs,
  extensionForMime,
  getHistoryEntry,
  historyErrorMessage,
  interpretHistoryPoll,
  joinUrl,
  mimeForFilename,
  normalizeBaseUrl,
  numericSetting,
  parseDataUrl,
  parseSettings,
  parseSize,
  parseSubmittedPromptId,
  replaceWorkflowPlaceholders,
  resolveHistoryEndpoint,
};
