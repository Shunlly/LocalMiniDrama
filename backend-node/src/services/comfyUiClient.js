const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadService = require('./uploadService');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const { redirectRequestOptions, secureHttpFetch, validateHttpRequestTarget } = require('./secureHttpFetch');
const {
  ComfyUiError,
  comfyFallbackMessage,
  createAbortError,
  readProviderError,
  sanitizeProviderText,
  trustedChineseDetail,
} = require('./comfyUiErrors');
const {
  buildHeaders,
  buildWorkflow,
  collectSecrets,
  extensionForMime,
  joinUrl,
  mimeForFilename,
  normalizeBaseUrl,
  numericSetting,
  parseDataUrl,
  parseSettings,
  replaceWorkflowPlaceholders,
  resolveHistoryEndpoint,
} = require('./comfyUiProtocol');
const { waitForComfyUiCompletion } = require('./comfyUiPollControl');

// ComfyUI 图片客户端：请求编排与公开 API。协议解析、错误装配、轮询控制已拆出；本模块不新增真实接入。

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;

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
      if (redirects === 5) throw new ComfyUiError('ComfyUI 重定向次数过多，请检查服务地址后重试', 'COMFYUI_REDIRECT');
      const location = response.headers?.get?.('location');
      if (!location) throw new ComfyUiError('ComfyUI 重定向缺少目标地址，请检查服务地址后重试', 'COMFYUI_REDIRECT');
      const nextUrl = new URL(location, currentUrl).toString();
      const crossOrigin = new URL(currentUrl).origin !== new URL(nextUrl).origin;
      const method = String(currentOptions?.method || 'GET').toUpperCase();
      if (crossOrigin && !['GET', 'HEAD'].includes(method)) {
        throw new ComfyUiError('ComfyUI 写入请求不允许跨源重定向，请检查服务地址后重试', 'COMFYUI_REDIRECT');
      }
      currentOptions = redirectRequestOptions(currentOptions, response.status, currentUrl, nextUrl);
      currentUrl = nextUrl;
    }
    throw new ComfyUiError('ComfyUI 重定向次数过多，请检查服务地址后重试', 'COMFYUI_REDIRECT');
  } catch (error) {
    if (error instanceof ComfyUiError) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw createAbortError(reason === 'cancelled' ? 'COMFYUI_CANCELLED' : 'COMFYUI_TIMEOUT', context.promptId);
    }
    throw new ComfyUiError(comfyFallbackMessage(error, 'ComfyUI 网络请求失败，请检查网络后重试', context.secrets), 'COMFYUI_NETWORK', {
      promptId: context.promptId,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
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

function resolveLocalReference(value, storageLocalPath, maxBytes) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('data:')) return null;
  const resolved = uploadService.resolveStorageReference(storageLocalPath, text);
  if (!resolved) return null;
  const filename = resolved.absolutePath;
  if (fs.statSync(filename).size > maxBytes) {
    throw new ComfyUiError('ComfyUI 本地参考图超过大小限制', 'REFERENCE_TOO_LARGE');
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
      throw new ComfyUiError(`ComfyUI 第 ${index + 1} 张参考图不在本地存储目录内`, 'INVALID_REFERENCE');
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

async function waitForCompletion(baseUrl, config, settings, promptId, context) {
  const endpoint = resolveHistoryEndpoint(config, settings, promptId);
  return waitForComfyUiCompletion({
    promptId,
    context,
    settings,
    queryHistory: () => requestJson(baseUrl, endpoint, {
      method: 'GET',
      headers: buildHeaders(config, settings, false),
    }, '历史查询', context),
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
    throw new ComfyUiError('当前运行环境不支持网络请求', 'COMFYUI_UNSUPPORTED');
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
      const nodeErrors = trustedChineseDetail(JSON.stringify(submitted?.node_errors || ''), context.secrets);
      throw new ComfyUiError(nodeErrors ? `ComfyUI 任务提交未返回任务编号：${nodeErrors}` : 'ComfyUI 任务提交未返回任务编号', 'COMFYUI_RESPONSE');
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
      : new ComfyUiError(comfyFallbackMessage(error, 'ComfyUI 请求失败，请稍后重试', context.secrets), 'COMFYUI_ERROR', { promptId });
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
