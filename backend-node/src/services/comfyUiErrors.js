'use strict';

// 从 comfyUiClient 拆出的错误装配：用户可见中文、密钥脱敏与失败分类。本模块不接真实 ComfyUI。

const {
  isTrustedChineseUserError,
  toUserFacingGatewayError,
  toUserFacingProcessError,
} = require('./providerErrorSanitizer');

class ComfyUiError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ComfyUiError';
    this.code = code || 'COMFYUI_ERROR';
    if (details.status != null) this.status = details.status;
    if (details.promptId) this.promptId = details.promptId;
  }
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

function trustedChineseDetail(value, secrets = []) {
  const text = sanitizeProviderText(value, secrets);
  return isTrustedChineseUserError(text) ? text : '';
}

function comfyFallbackMessage(error, fallback, secrets = []) {
  const trusted = trustedChineseDetail(error?.message || error, secrets);
  if (trusted) return trusted;
  const mapped = toUserFacingProcessError(error, fallback);
  return isTrustedChineseUserError(mapped) ? mapped : fallback;
}

function comfyProviderFailure(response, operation, detail, context) {
  const trusted = trustedChineseDetail(detail, context.secrets);
  const mapped = toUserFacingGatewayError(
    Object.assign(new Error('provider error'), { status: response.status }),
    { provider: 'ComfyUI', operation }
  );
  const message = trusted || mapped;
  return new ComfyUiError(message, 'COMFYUI_PROVIDER', {
    status: response.status,
    promptId: context.promptId,
  });
}

function createAbortError(code, promptId) {
  if (code === 'COMFYUI_CANCELLED') {
    return new ComfyUiError('ComfyUI 任务已取消', code, { promptId });
  }
  return new ComfyUiError('ComfyUI 任务超时', 'COMFYUI_TIMEOUT', { promptId });
}

function parseProviderErrorDetail(raw) {
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
  return detail;
}

async function readProviderError(response, operation, context) {
  let raw = '';
  try {
    raw = await response.text();
  } catch (_) {}
  return comfyProviderFailure(response, operation, parseProviderErrorDetail(raw), context);
}

function wrapUnknownComfyError(error, secrets, promptId) {
  if (error instanceof ComfyUiError) return error;
  return new ComfyUiError(comfyFallbackMessage(error, 'ComfyUI 请求失败，请稍后重试', secrets), 'COMFYUI_ERROR', { promptId });
}

module.exports = {
  ComfyUiError,
  comfyFallbackMessage,
  comfyProviderFailure,
  createAbortError,
  parseProviderErrorDetail,
  readProviderError,
  sanitizeProviderText,
  trustedChineseDetail,
  wrapUnknownComfyError,
};
