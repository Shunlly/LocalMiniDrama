const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadService = require('./uploadService');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const { redirectRequestOptions, secureHttpFetch, validateHttpRequestTarget } = require('./secureHttpFetch');
const { isSensitiveFieldKey } = require('./sensitiveFieldPolicy');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;

class ComfyUiError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ComfyUiError';
    this.code = code || 'COMFYUI_ERROR';
    if (details.status != null) this.status = details.status;
    if (details.promptId) this.promptId = details.promptId;
  }
}

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
    throw new ComfyUiError('ComfyUI settings 不是有效的 JSON', 'INVALID_SETTINGS');
  }
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new ComfyUiError('ComfyUI Base URL 未配置', 'INVALID_CONFIG');
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new ComfyUiError('ComfyUI Base URL 无效', 'INVALID_CONFIG');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ComfyUiError('ComfyUI Base URL 必须是无内嵌凭据的 HTTP(S) 地址', 'INVALID_CONFIG');
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

function sanitizeProviderText(value, secrets = []) {
  let text = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  for (const secret of secrets) {
    text = text.split(secret).join('********');
  }
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ********')
    .replace(/((?:api[-_]?key|access[-_]?token|token|secret|authorization)["'\s:=]+)[^\s,"'}]+/gi, '$1********')
    .replace(/https?:\/\/[^\s"']+/gi, (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch (_) {
        return '[redacted-url]';
      }
    });
  return text.slice(0, 300);
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

function createAbortError(code, promptId) {
  if (code === 'COMFYUI_CANCELLED') {
    return new ComfyUiError('ComfyUI 任务已取消', code, { promptId });
  }
  return new ComfyUiError('ComfyUI 任务超时', 'COMFYUI_TIMEOUT', { promptId });
}

async function fetchWithLimits(url, options, context) {
  const controller = new AbortController();
  const externalSignal = context.signal;
  let reason = '';
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) throw createAbortError('COMFYUI_TIMEOUT', context.promptId);

  const onAbort = () => {
    reason = 'cancelled';
    controller.abort();
  };
  if (externalSignal?.aborted) throw createAbortError('COMFYUI_CANCELLED', context.promptId);
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    reason = 'timeout';
    controller.abort();
  }, Math.min(context.requestTimeoutMs, remaining));

  try {
    if (context.useSecureFetch) {
      return await secureHttpFetch(url, {
        ...options,
        redirect: 'follow',
        signal: controller.signal,
      }, {
        trustedOrigins: context.trustedOrigins,
        allowPrivateOrigins: context.allowPrivateOrigins,
        lookup: context.networkLookup,
        requireHttpsForPublic: context.requireHttpsForPublic,
        timeoutMs: Math.min(context.requestTimeoutMs, remaining),
        maxBytes: context.maxResponseBytes || DEFAULT_MAX_IMAGE_BYTES,
        maxRedirects: 5,
      });
    }
    let currentUrl = String(url);
    let currentOptions = { ...options };
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await validateHttpRequestTarget(currentUrl, {
        trustedOrigins: context.trustedOrigins,
        allowPrivateOrigins: context.allowPrivateOrigins,
        lookup: context.networkLookup,
        requireHttpsForPublic: context.requireHttpsForPublic,
      });
      const response = await context.fetchImpl(currentUrl, {
        ...currentOptions,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirects === 5) throw new ComfyUiError('ComfyUI redirect limit exceeded', 'COMFYUI_REDIRECT');
      const location = response.headers?.get?.('location');
      if (!location) throw new ComfyUiError('ComfyUI redirect has no Location', 'COMFYUI_REDIRECT');
      const nextUrl = new URL(location, currentUrl).toString();
      const crossOrigin = new URL(currentUrl).origin !== new URL(nextUrl).origin;
      const method = String(currentOptions?.method || 'GET').toUpperCase();
      if (crossOrigin && !['GET', 'HEAD'].includes(method)) {
        throw new ComfyUiError('ComfyUI write request redirect rejected', 'COMFYUI_REDIRECT');
      }
      currentOptions = redirectRequestOptions(currentOptions, response.status, currentUrl, nextUrl);
      currentUrl = nextUrl;
    }
    throw new ComfyUiError('ComfyUI redirect limit exceeded', 'COMFYUI_REDIRECT');
  } catch (error) {
    if (error instanceof ComfyUiError) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw createAbortError(reason === 'cancelled' ? 'COMFYUI_CANCELLED' : 'COMFYUI_TIMEOUT', context.promptId);
    }
    throw new ComfyUiError(`ComfyUI 网络请求失败: ${sanitizeProviderText(error?.message, context.secrets) || '连接失败'}`, 'COMFYUI_NETWORK', {
      promptId: context.promptId,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

async function readProviderError(response, operation, context) {
  let raw = '';
  try {
    raw = await response.text();
  } catch (_) {}
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed?.error?.message
      || parsed?.message
      || parsed?.error
      || parsed?.node_errors
      || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch (_) {}
  const safeDetail = sanitizeProviderText(detail, context.secrets);
  const suffix = safeDetail ? `: ${safeDetail}` : '';
  return new ComfyUiError(`ComfyUI ${operation}失败 (HTTP ${response.status})${suffix}`, 'COMFYUI_PROVIDER', {
    status: response.status,
    promptId: context.promptId,
  });
}

async function requestJson(baseUrl, endpoint, options, operation, context) {
  const response = await fetchWithLimits(joinUrl(baseUrl, endpoint), options, context);
  if (!response.ok) throw await readProviderError(response, operation, context);
  try {
    return await response.json();
  } catch (_) {
    throw new ComfyUiError(`ComfyUI ${operation}返回格式异常`, 'COMFYUI_RESPONSE', {
      status: response.status,
      promptId: context.promptId,
    });
  }
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
    throw new ComfyUiError('ComfyUI 参考图 data URL 无效', 'INVALID_REFERENCE');
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

function resolveLocalReference(value, storageLocalPath, maxBytes) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('data:')) return null;
  const resolved = uploadService.resolveStorageReference(storageLocalPath, text);
  if (!resolved) return null;
  const filename = resolved.absolutePath;
  if (fs.statSync(filename).size > maxBytes) {
    throw new ComfyUiError('ComfyUI local reference exceeds the size limit', 'REFERENCE_TOO_LARGE');
  }
  return {
    buffer: fs.readFileSync(filename),
    mimeType: mimeForFilename(filename),
    filename: path.basename(filename),
  };
}

async function loadReference(value, index, opts, context) {
  const data = parseDataUrl(value);
  if (data) {
    if (data.buffer.length === 0 || data.buffer.length > opts.maxReferenceBytes) {
      throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图超过大小限制`, 'REFERENCE_TOO_LARGE');
    }
    return data;
  }
  let local;
  try {
    local = resolveLocalReference(value, opts.storage_local_path, opts.maxReferenceBytes);
  } catch (error) {
    if (!/^https?:\/\//i.test(String(value || ''))) {
      if (error instanceof ComfyUiError) throw error;
      throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图不在 storage 内`, 'INVALID_REFERENCE');
    }
  }
  if (local) return local;

  let sourceUrl;
  try {
    sourceUrl = new URL(String(value || ''));
  } catch (_) {
    throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图不可读取`, 'INVALID_REFERENCE');
  }
  if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
    throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图协议不受支持`, 'INVALID_REFERENCE');
  }
  let downloaded;
  try {
    downloaded = await uploadService.downloadBufferViaNodeHttp(sourceUrl.toString(), context.requestTimeoutMs, 0, {
      maxBytes: opts.maxReferenceBytes,
      accept: 'image/*',
      lookup: context.networkLookup,
    });
  } catch (error) {
    const code = error?.code === 'UNSAFE_MEDIA_REFERENCE' ? 'INVALID_REFERENCE' : 'REFERENCE_DOWNLOAD';
    throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图下载被拒绝`, code);
  }
  const buffer = downloaded.buffer;
  const mimeType = String(downloaded.contentType || '').split(';')[0] || mimeForFilename(sourceUrl.pathname);
  const basename = path.basename(sourceUrl.pathname) || `reference-${index + 1}.${extensionForMime(mimeType)}`;
  return { buffer, mimeType, filename: basename };
}

function safeUploadFilename(filename, mimeType, index) {
  const ext = path.extname(String(filename || '')) || `.${extensionForMime(mimeType)}`;
  const base = path.basename(String(filename || `reference-${index + 1}`), path.extname(String(filename || '')))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `reference-${index + 1}`;
  return `${base}-${crypto.randomUUID().slice(0, 8)}${ext.toLowerCase()}`;
}

async function uploadReference(baseUrl, config, settings, value, index, opts, context) {
  const loaded = await loadReference(value, index, opts, context);
  const form = new FormData();
  const filename = safeUploadFilename(loaded.filename, loaded.mimeType, index);
  form.append('image', new Blob([loaded.buffer], { type: loaded.mimeType }), filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  if (settings.upload_subfolder) form.append('subfolder', String(settings.upload_subfolder));
  const response = await fetchWithLimits(joinUrl(baseUrl, settings.upload_endpoint || '/upload/image'), {
    method: 'POST',
    headers: buildHeaders(config, settings, false),
    body: form,
  }, context);
  if (!response.ok) throw await readProviderError(response, '参考图上传', context);
  let result;
  try {
    result = await response.json();
  } catch (_) {
    throw new ComfyUiError('ComfyUI 参考图上传返回格式异常', 'COMFYUI_RESPONSE');
  }
  const name = result?.name || result?.filename;
  if (!name) throw new ComfyUiError('ComfyUI 参考图上传未返回文件名', 'COMFYUI_RESPONSE');
  const subfolder = result?.subfolder ? String(result.subfolder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  return subfolder ? `${subfolder}/${name}` : String(name);
}

function getWorkflowTemplate(config, settings) {
  let template = settings.workflow ?? settings.workflow_json ?? settings.workflow_template ?? config?.workflow;
  if (typeof template === 'string') {
    try {
      template = JSON.parse(template);
    } catch (_) {
      throw new ComfyUiError('ComfyUI workflow 模板不是有效的 JSON', 'INVALID_WORKFLOW');
    }
  }
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    throw new ComfyUiError('ComfyUI workflow 模板未配置', 'INVALID_WORKFLOW');
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
    throw new ComfyUiError(`ComfyUI workflow 存在未定义占位符: ${Array.from(unresolved).join(', ')}`, 'INVALID_WORKFLOW');
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
  return 'workflow 执行失败';
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

async function waitForCompletion(baseUrl, config, settings, promptId, context) {
  const endpointTemplate = config.query_endpoint || settings.history_endpoint || '/history/{promptId}';
  const endpoint = endpointTemplate
    .replace(/\{promptId\}/g, encodeURIComponent(promptId))
    .replace(/\{taskId\}/g, encodeURIComponent(promptId));
  while (true) {
    if (context.signal?.aborted) throw createAbortError('COMFYUI_CANCELLED', promptId);
    if (Date.now() >= context.deadline) throw createAbortError('COMFYUI_TIMEOUT', promptId);
    context.promptId = promptId;
    const history = await requestJson(baseUrl, endpoint, {
      method: 'GET',
      headers: buildHeaders(config, settings, false),
    }, '历史查询', context);
    const entry = getHistoryEntry(history, promptId);
    if (entry) {
      const providerError = historyErrorMessage(entry);
      if (providerError) {
        const safe = sanitizeProviderText(providerError, context.secrets);
        throw new ComfyUiError(`ComfyUI workflow 执行失败${safe ? `: ${safe}` : ''}`, 'COMFYUI_EXECUTION', { promptId });
      }
      const images = extractOutputs(entry, settings);
      if (images.length > 0) return images;
      if (entry?.status?.completed === true) {
        throw new ComfyUiError('ComfyUI workflow 已完成但没有图片输出', 'COMFYUI_NO_OUTPUT', { promptId });
      }
    }
    await abortableDelay(context.pollIntervalMs, context.signal, promptId);
  }
}

function abortableDelay(ms, signal, promptId) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createAbortError('COMFYUI_CANCELLED', promptId));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError('COMFYUI_CANCELLED', promptId));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function downloadOutput(baseUrl, config, settings, descriptor, context) {
  const params = new URLSearchParams({
    filename: String(descriptor.filename),
    subfolder: String(descriptor.subfolder || ''),
    type: String(descriptor.type || 'output'),
  });
  const endpoint = `${settings.view_endpoint || '/view'}?${params.toString()}`;
  const response = await fetchWithLimits(joinUrl(baseUrl, endpoint), {
    method: 'GET',
    headers: buildHeaders(config, settings, false),
  }, context);
  if (!response.ok) throw await readProviderError(response, '输出下载', context);
  const contentLength = Number(response.headers.get('content-length') || 0);
  const maxOutputBytes = numericSetting(settings.max_output_bytes, DEFAULT_MAX_IMAGE_BYTES);
  if (contentLength > maxOutputBytes) {
    throw new ComfyUiError('ComfyUI 图片输出超过大小限制', 'COMFYUI_OUTPUT_TOO_LARGE', { promptId: context.promptId });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new ComfyUiError('ComfyUI 图片输出为空', 'COMFYUI_NO_OUTPUT', { promptId: context.promptId });
  if (buffer.length > maxOutputBytes) {
    throw new ComfyUiError('ComfyUI 图片输出超过大小限制', 'COMFYUI_OUTPUT_TOO_LARGE', { promptId: context.promptId });
  }
  let mimeType = response.headers.get('content-type')?.split(';')[0];
  if (!mimeType || mimeType === 'application/octet-stream') mimeType = mimeForFilename(descriptor.filename);
  if (!String(mimeType).startsWith('image/')) mimeType = 'image/png';
  return { buffer, mimeType };
}

async function bestEffortJson(baseUrl, endpoint, headers, body, requestContext) {
  try {
    await fetchWithLimits(joinUrl(baseUrl, endpoint), {
      method: 'POST',
      redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, {
      ...requestContext,
      deadline: Date.now() + 3000,
      requestTimeoutMs: 3000,
      signal: undefined,
    });
  } catch (_) {}
}

async function cancelPrompt(baseUrl, config, settings, promptId, requestContext = {}) {
  if (!promptId) return;
  const headers = buildHeaders(config, settings, false);
  const requests = [
    bestEffortJson(baseUrl, settings.queue_endpoint || '/queue', headers, { delete: [promptId] }, requestContext),
  ];
  if (settings.interrupt_on_cancel !== false) {
    requests.push(bestEffortJson(baseUrl, settings.interrupt_endpoint || '/interrupt', headers, {}, requestContext));
  }
  await Promise.all(requests);
}

async function generateComfyUiImage(config, log, opts = {}) {
  const settings = parseSettings(config);
  const baseUrl = normalizeBaseUrl(config?.base_url);
  const networkPolicy = requireCompleteProviderNetworkPolicy(opts.provider_network_policy, baseUrl);
  const timeoutMs = numericSetting(opts.timeout_ms ?? settings.timeout_ms, DEFAULT_TIMEOUT_MS);
  const context = {
    fetchImpl: opts.fetch_impl || global.fetch,
    useSecureFetch: typeof opts.fetch_impl !== 'function',
    signal: opts.signal,
    deadline: Date.now() + timeoutMs,
    requestTimeoutMs: numericSetting(settings.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS),
    pollIntervalMs: numericSetting(opts.poll_interval_ms ?? settings.poll_interval_ms, DEFAULT_POLL_INTERVAL_MS),
    secrets: collectSecrets(config, settings),
    promptId: null,
    trustedOrigins: networkPolicy.trustedOrigins,
    allowPrivateOrigins: networkPolicy.allowPrivateOrigins,
    networkLookup: networkPolicy.lookup,
    requireHttpsForPublic: networkPolicy.requireHttpsForPublic,
    maxResponseBytes: numericSetting(settings.max_response_bytes, DEFAULT_MAX_IMAGE_BYTES),
  };
  if (typeof context.fetchImpl !== 'function') {
    throw new ComfyUiError('当前 Node.js 环境不支持 fetch', 'COMFYUI_UNSUPPORTED');
  }
  const references = Array.isArray(opts.reference_image_urls) ? opts.reference_image_urls.filter(Boolean) : [];
  const referenceOptions = {
    storage_local_path: opts.storage_local_path,
    maxReferenceBytes: numericSetting(settings.max_reference_bytes, DEFAULT_MAX_IMAGE_BYTES),
  };

  let promptId = null;
  try {
    const uploadedReferences = [];
    for (let index = 0; index < references.length; index += 1) {
      uploadedReferences.push(await uploadReference(baseUrl, config, settings, references[index], index, referenceOptions, context));
    }
    const workflow = buildWorkflow(config, settings, opts, uploadedReferences);
    const idempotencyKey = String(opts.idempotency_key || '').trim().slice(0, 200);
    const clientId = String(settings.client_id || (idempotencyKey
      ? `localminidrama-${crypto.createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 24)}`
      : `localminidrama-${crypto.randomUUID()}`));
    const submitHeaders = buildHeaders(config, settings, true);
    if (idempotencyKey) submitHeaders['Idempotency-Key'] = idempotencyKey;
    const submitted = await requestJson(baseUrl, config.endpoint || settings.prompt_endpoint || '/prompt', {
      method: 'POST',
      headers: submitHeaders,
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    }, '任务提交', context);
    promptId = submitted?.prompt_id || submitted?.promptId;
    if (!promptId) {
      const nodeErrors = sanitizeProviderText(JSON.stringify(submitted?.node_errors || ''), context.secrets);
      throw new ComfyUiError(`ComfyUI 任务提交未返回 prompt_id${nodeErrors ? `: ${nodeErrors}` : ''}`, 'COMFYUI_RESPONSE');
    }
    context.promptId = String(promptId);
    log?.info?.('ComfyUI image task submitted', {
      image_gen_id: opts.image_gen_id,
      prompt_id: context.promptId,
      reference_count: uploadedReferences.length,
    });
    const outputs = await waitForCompletion(baseUrl, config, settings, context.promptId, context);
    const outputIndex = Math.max(0, Math.floor(Number(settings.output_index) || 0));
    const descriptor = outputs[outputIndex] || outputs[0];
    const downloaded = await downloadOutput(baseUrl, config, settings, descriptor, context);
    log?.info?.('ComfyUI image task completed', {
      image_gen_id: opts.image_gen_id,
      prompt_id: context.promptId,
      output_filename: path.basename(String(descriptor.filename)),
      output_bytes: downloaded.buffer.length,
    });
    return {
      image_url: `data:${downloaded.mimeType};base64,${downloaded.buffer.toString('base64')}`,
      prompt_id: context.promptId,
      filename: descriptor.filename,
    };
  } catch (error) {
    const safeError = error instanceof ComfyUiError
      ? error
      : new ComfyUiError(`ComfyUI 请求失败: ${sanitizeProviderText(error?.message, context.secrets) || '未知错误'}`, 'COMFYUI_ERROR', { promptId });
    if (promptId && (safeError.code === 'COMFYUI_TIMEOUT' || safeError.code === 'COMFYUI_CANCELLED')) {
      await cancelPrompt(baseUrl, config, settings, String(promptId), context);
    }
    log?.error?.('ComfyUI image task failed', {
      image_gen_id: opts.image_gen_id,
      prompt_id: promptId || undefined,
      code: safeError.code,
      status: safeError.status,
    });
    throw safeError;
  }
}

async function probeComfyUiConnection(config, options = {}) {
  const settings = parseSettings(config);
  const baseUrl = normalizeBaseUrl(config?.base_url);
  const networkPolicy = requireCompleteProviderNetworkPolicy(options.provider_network_policy, baseUrl);
  const context = {
    fetchImpl: options.fetch_impl || global.fetch,
    useSecureFetch: typeof options.fetch_impl !== 'function',
    signal: options.signal,
    deadline: Date.now() + numericSetting(options.timeout_ms, 15000),
    requestTimeoutMs: numericSetting(options.timeout_ms, 15000),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    secrets: collectSecrets(config, settings),
    promptId: null,
    trustedOrigins: networkPolicy.trustedOrigins,
    allowPrivateOrigins: networkPolicy.allowPrivateOrigins,
    networkLookup: networkPolicy.lookup,
    requireHttpsForPublic: networkPolicy.requireHttpsForPublic,
    maxResponseBytes: 2 * 1024 * 1024,
  };
  const endpoints = [settings.system_stats_endpoint || '/system_stats', '/prompt'];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithLimits(joinUrl(baseUrl, endpoint), {
        method: 'GET',
        headers: buildHeaders(config, settings, false),
      }, context);
      if (response.ok) return;
      lastError = await readProviderError(response, '连接探测', context);
      if (response.status === 401 || response.status === 403) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new ComfyUiError('ComfyUI 连接探测失败', 'COMFYUI_NETWORK');
}

module.exports = {
  ComfyUiError,
  buildWorkflow,
  cancelPrompt,
  fetchWithLimits,
  generateComfyUiImage,
  parseSettings,
  probeComfyUiConnection,
  replaceWorkflowPlaceholders,
  sanitizeProviderText,
};
