'use strict';

const https = require('https');

function tlsPolicyError(message) {
  const error = new Error(message);
  error.code = 'INSECURE_TLS_FORBIDDEN';
  return error;
}

function isEnabledFlag(value) {
  if (value === undefined || value === null) return false;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function pinHttpsCertificateVerification() {
  if (https.globalAgent && https.globalAgent.options) {
    https.globalAgent.options.rejectUnauthorized = true;
  }
}

function assertTlsVerificationRequired(options = {}) {
  const env = options.env || process.env;
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED) === '0') {
    throw tlsPolicyError('禁止通过环境变量关闭 TLS 证书校验。');
  }
  const server = options.config?.server || {};
  if (isEnabledFlag(server.insecure_tls) || isEnabledFlag(server.INSECURE_TLS)) {
    throw tlsPolicyError('禁止通过服务配置关闭 TLS 证书校验。');
  }
  if (options.applyGlobalPin !== false) pinHttpsCertificateVerification();
}

function secureHttpsRequestOptions(options = {}) {
  const next = { ...options };
  delete next.agent;
  next.rejectUnauthorized = true;
  return next;
}

module.exports = {
  assertTlsVerificationRequired,
  pinHttpsCertificateVerification,
  secureHttpsRequestOptions,
};
