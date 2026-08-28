'use strict';

function policyError(code, message) {
  const error = new Error(message);
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
    throw policyError(
      'PROVIDER_NETWORK_POLICY_REQUIRED',
      'A complete provider network policy is required before credentials may be used.'
    );
  }
  const trustedOrigins = validOrigins(policy.trustedOrigins);
  const allowPrivateOrigins = validOrigins(policy.allowPrivateOrigins);
  if (policy.requireHttpsForPublic !== true
    || !trustedOrigins?.length
    || !allowPrivateOrigins
    || (policy.lookup != null && typeof policy.lookup !== 'function')) {
    throw policyError(
      'PROVIDER_NETWORK_POLICY_INVALID',
      'The provider network policy is incomplete or invalid.'
    );
  }
  if (baseUrl && !hasOrigin(trustedOrigins, baseUrl)) {
    throw policyError(
      'PROVIDER_NETWORK_AUTHORITY_MISMATCH',
      'The provider endpoint is not authorized by the saved network policy.'
    );
  }
  if (allowPrivateOrigins.some((value) => !hasOrigin(trustedOrigins, value))) {
    throw policyError(
      'PROVIDER_NETWORK_POLICY_INVALID',
      'Private provider origins must also be trusted provider origins.'
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
