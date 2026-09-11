// 模型目录发现：失败时 fail-closed，不把供应商原文或密钥回传给用户。

const { sanitizeProviderText } = require('./comfyUiClient');
const { isTrustedChineseUserError } = require('./providerErrorSanitizer');
const { requireCompleteProviderNetworkPolicy } = require('./providerNetworkPolicy');
const {
  getProviderNetworkOptions,
  normalizeProviderBaseUrl,
} = require('./aiConfigProviderPrivacy');
const {
  fetchConnectionProbe,
  openAiCompatibleModelsUrl,
  supportsOpenAiCompatibleModelDiscovery,
  isApiKeyOptionalConnection,
} = require('./aiConfigConnectionProbe');

const DISCOVER_MODELS_LIMIT = 200;
const DISCOVER_MODELS_MAX_BYTES = 2 * 1024 * 1024;
const DISCOVER_MODEL_ID_MAX_LEN = 128;
const UNSUPPORTED_MODEL_DISCOVERY_MESSAGE = '当前厂商不支持自动读取模型目录，请手工填写模型名';

function discoverModelsUserError(message, code = 'DISCOVER_MODELS_FAILED', extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = extra.status || 400;
  if (extra.name) error.name = extra.name;
  if (extra.isTimeout) error.isTimeout = true;
  return error;
}

function looksLikeSecretModelId(value) {
  const text = String(value || '');
  if (!text || text.length > DISCOVER_MODEL_ID_MAX_LEN) return true;
  if (/\bsk-[A-Za-z0-9._-]{6,}\b/i.test(text)) return true;
  if (/\bBearer\s+/i.test(text)) return true;
  if (/(api[-_]?key|access[-_]?token|secret|password|authorization)\s*[:=]/i.test(text)) return true;
  if (/-----BEGIN /i.test(text)) return true;
  return false;
}

function sanitizeDiscoveredModel(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string' || typeof entry === 'number') {
    return sanitizeDiscoveredModel({ id: entry });
  }
  if (typeof entry !== 'object' || Array.isArray(entry)) return null;
  const rawId = entry.id != null && String(entry.id).trim() !== ''
    ? entry.id
    : (entry.model != null && String(entry.model).trim() !== '' ? entry.model : entry.name);
  const id = String(rawId == null ? '' : rawId).trim();
  if (!id || id.length > DISCOVER_MODEL_ID_MAX_LEN) return null;
  if (id.includes('..') || id.includes('//') || id.includes('\\')) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/\-@+]{0,127}$/.test(id)) return null;
  if (looksLikeSecretModelId(id)) return null;
  const result = { id };
  const usedNameAsId = entry.id == null && entry.model == null && entry.name != null;
  const rawName = usedNameAsId ? entry.display_name : (entry.display_name != null ? entry.display_name : entry.name);
  if (rawName != null) {
    const name = String(rawName).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (name && name !== id && name.length <= DISCOVER_MODEL_ID_MAX_LEN && !looksLikeSecretModelId(name) && !/https?:\/\//i.test(name)) {
      result.name = name;
    }
  }
  return result;
}

function parseDiscoveredModelRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  return null;
}

function mapProviderUrlDiscoverMessage(message) {
  const raw = String(message || '');
  if (/合法/.test(raw)) return '请填写合法的接口地址';
  if (/仅支持/.test(raw)) return '接口地址仅支持 HTTP 或 HTTPS';
  if (/用户名或密码/.test(raw)) return '接口地址不得包含用户名或密码，请使用密钥字段';
  if (/查询参数/.test(raw)) return '接口地址不得包含查询参数';
  if (/片段/.test(raw)) return '接口地址不得包含网址片段';
  if (/拦截|不可路由|元数据/.test(raw)) return '服务地址指向被拦截或不可路由的网络位置';
  if (/私有或本地/.test(raw)) return '私有或本地服务地址需要使用已识别的本地厂商模式';
  if (/HTTPS/.test(raw)) return '公网服务地址必须使用 HTTPS';
  if (/必填/.test(raw)) return '请填写接口地址';
  return '接口地址无效，请检查后重试';
}

function collectDiscoverSecrets(opts = {}) {
  return [opts.api_key, opts.access_key_id, opts.secret_access_key, opts.session_token]
    .filter((value) => value != null && String(value).length >= 3)
    .map(String);
}

function toDiscoverModelsError(error, secrets = []) {
  if (error?.code === 'UNSUPPORTED_MODEL_DISCOVERY') {
    return discoverModelsUserError(UNSUPPORTED_MODEL_DISCOVERY_MESSAGE, 'UNSUPPORTED_MODEL_DISCOVERY');
  }
  const sanitized = sanitizeProviderText(error?.message, secrets) || '';
  if (error?.code === 'ERR_CANCELED' || error?.name === 'AbortError') {
    return discoverModelsUserError('读取模型目录已取消', 'ERR_CANCELED', { name: 'AbortError' });
  }
  if (error?.isTimeout === true || error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT' || /超时/.test(sanitized)) {
    return discoverModelsUserError('读取模型目录超时，请检查服务地址或网络', 'ETIMEDOUT', { isTimeout: true });
  }
  if (error?.code === 'INVALID_PROVIDER_URL') {
    return discoverModelsUserError(mapProviderUrlDiscoverMessage(sanitized), 'INVALID_PROVIDER_URL');
  }
  if (error?.name === 'UnsafeMediaReferenceError' || error?.code === 'UNSAFE_MEDIA_REFERENCE') {
    const mapped = isTrustedChineseUserError(sanitized) ? sanitized : '当前地址不允许访问，请检查接口地址';
    return discoverModelsUserError(mapped, error.code || 'UNSAFE_MEDIA_REFERENCE');
  }
  if (error?.code === 'DISCOVER_MODELS_RESPONSE_TOO_LARGE') {
    return discoverModelsUserError('模型目录响应过大，请手工填写模型名', 'DISCOVER_MODELS_RESPONSE_TOO_LARGE');
  }
  if (error?.code === 'DISCOVER_MODELS_UNAUTHORIZED') {
    return discoverModelsUserError('认证失败，请检查密钥', 'DISCOVER_MODELS_UNAUTHORIZED');
  }
  if (isTrustedChineseUserError(sanitized)) {
    const safe = discoverModelsUserError(sanitized, error?.code || 'DISCOVER_MODELS_FAILED');
    if (error?.status) safe.status = error.status;
    return safe;
  }
  return discoverModelsUserError('读取模型目录失败，请检查接口地址和密钥');
}

async function readDiscoverModelsPayload(res) {
  const contentLength = Number(res.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > DISCOVER_MODELS_MAX_BYTES) {
    throw discoverModelsUserError('模型目录响应过大，请手工填写模型名', 'DISCOVER_MODELS_RESPONSE_TOO_LARGE');
  }
  const text = await res.text();
  if (String(text || '').length > DISCOVER_MODELS_MAX_BYTES) {
    throw discoverModelsUserError('模型目录响应过大，请手工填写模型名', 'DISCOVER_MODELS_RESPONSE_TOO_LARGE');
  }
  return text;
}

/**
 * 从 OpenAI 兼容 /v1/models 读取模型目录，供前端合并进模型列表。
 * @param opts { base_url, api_key, provider, service_type, signal }
 * @returns Promise<{ models: Array<{ id: string, name?: string }> }>
 */
async function discoverModelsUnsafe(opts = {}) {
  if (!supportsOpenAiCompatibleModelDiscovery(opts)) {
    throw discoverModelsUserError(UNSUPPORTED_MODEL_DISCOVERY_MESSAGE, 'UNSUPPORTED_MODEL_DISCOVERY');
  }
  const provider = String(opts.provider || '').trim();
  if (!provider) throw discoverModelsUserError('请填写厂商');
  if (!String(opts.base_url || '').trim()) throw discoverModelsUserError('请填写接口地址');
  if (!opts.api_key && !isApiKeyOptionalConnection(opts)) {
    throw discoverModelsUserError('请填写密钥');
  }

  const base = normalizeProviderBaseUrl(opts.base_url, opts);
  const providerNetwork = opts.provider_network_policy
    ? requireCompleteProviderNetworkPolicy(opts.provider_network_policy, base)
    : getProviderNetworkOptions(opts, { lookup: opts.provider_dns_lookup });
  const networkOptions = {
    ...providerNetwork,
    fetchImpl: opts.fetch_impl,
    signal: opts.signal,
  };
  const url = openAiCompatibleModelsUrl(base);
  const headers = {};
  if (opts.api_key) headers.Authorization = `Bearer ${opts.api_key}`;
  const res = await fetchConnectionProbe(url, { method: 'GET', headers }, networkOptions);
  if (res.status === 401 || res.status === 403) {
    throw discoverModelsUserError('认证失败，请检查密钥', 'DISCOVER_MODELS_UNAUTHORIZED');
  }
  const text = await readDiscoverModelsPayload(res);
  if (!res.ok) {
    throw discoverModelsUserError('读取模型目录失败，请检查接口地址和密钥');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw discoverModelsUserError('模型目录响应不是有效的数据，请手工填写模型名');
  }
  const rows = parseDiscoveredModelRows(parsed);
  if (!rows) {
    throw discoverModelsUserError('模型目录响应缺少模型列表，请手工填写模型名');
  }
  const models = [];
  const seen = new Set();
  for (const row of rows) {
    const item = sanitizeDiscoveredModel(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    models.push(item);
    if (models.length >= DISCOVER_MODELS_LIMIT) break;
  }
  return { models };
}

module.exports = {
  DISCOVER_MODELS_LIMIT,
  DISCOVER_MODELS_MAX_BYTES,
  DISCOVER_MODEL_ID_MAX_LEN,
  UNSUPPORTED_MODEL_DISCOVERY_MESSAGE,
  parseDiscoveredModelRows,
  sanitizeDiscoveredModel,
  looksLikeSecretModelId,
  mapProviderUrlDiscoverMessage,
  discoverModelsUserError,
  collectDiscoverSecrets,
  toDiscoverModelsError,
  readDiscoverModelsPayload,
  discoverModelsUnsafe,
};
