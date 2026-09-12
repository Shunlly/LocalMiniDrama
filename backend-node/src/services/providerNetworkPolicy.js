'use strict';

const POLICY_MESSAGES = Object.freeze({
  PROVIDER_NETWORK_POLICY_REQUIRED: '\u4f7f\u7528\u51ed\u636e\u524d\u5fc5\u987b\u63d0\u4f9b\u5b8c\u6574\u7684\u5382\u5546\u7f51\u7edc\u7b56\u7565\u3002',
  PROVIDER_NETWORK_POLICY_INVALID: '\u5382\u5546\u7f51\u7edc\u7b56\u7565\u4e0d\u5b8c\u6574\u6216\u65e0\u6548\u3002',
  PROVIDER_NETWORK_AUTHORITY_MISMATCH: '\u8be5\u5382\u5546\u5730\u5740\u672a\u88ab\u5df2\u4fdd\u5b58\u7684\u7f51\u7edc\u7b56\u7565\u6388\u6743\u3002',
  PROVIDER_NETWORK_PRIVATE_ORIGIN_UNTRUSTED: '\u79c1\u6709\u5382\u5546\u6765\u6e90\u5fc5\u987b\u540c\u65f6\u5c5e\u4e8e\u53d7\u4fe1\u4efb\u7684\u5382\u5546\u6765\u6e90\u3002',
});

function policyError(code, message) {
  const error = new Error(message || POLICY_MESSAGES[code] || POLICY_MESSAGES.PROVIDER_NETWORK_POLICY_INVALID);
  error.code = code;
  error.status = 400;
  return error;
}

function validOrigins(values) {
  if (!Array.isArray(values)) return null;
  const origins = [];
  for (const value of values) {
    try {
      const parsed = new URL(String(value || '').trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      origins.push(String(value).trim());
    } catch (_) {
      return null;
    }
  }
  return origins;
}

function hasOrigin(values, target) {
  let targetOrigin;
  try {
    targetOrigin = new URL(target).origin;
  } catch (_) {
    return false;
  }
  return values.some((value) => new URL(value).origin === targetOrigin);
}

function requireCompleteProviderNetworkPolicy(policy, baseUrl) {
  if (!policy || typeof policy !== 'object') {
    throw policyError('PROVIDER_NETWORK_POLICY_REQUIRED');
  }
  const trustedOrigins = validOrigins(policy.trustedOrigins);
  const allowPrivateOrigins = validOrigins(policy.allowPrivateOrigins);
  if (policy.requireHttpsForPublic !== true
    || !trustedOrigins?.length
    || !allowPrivateOrigins
    || (policy.lookup != null && typeof policy.lookup !== 'function')) {
    throw policyError('PROVIDER_NETWORK_POLICY_INVALID');
  }
  if (baseUrl && !hasOrigin(trustedOrigins, baseUrl)) {
    throw policyError('PROVIDER_NETWORK_AUTHORITY_MISMATCH');
  }
  if (allowPrivateOrigins.some((value) => !hasOrigin(trustedOrigins, value))) {
    throw policyError(
      'PROVIDER_NETWORK_POLICY_INVALID',
      POLICY_MESSAGES.PROVIDER_NETWORK_PRIVATE_ORIGIN_UNTRUSTED
    );
  }
  return {
    ...policy,
    trustedOrigins,
    allowPrivateOrigins,
    requireHttpsForPublic: true,
  };
}

module.exports = { requireCompleteProviderNetworkPolicy };
