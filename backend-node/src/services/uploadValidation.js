'use strict';

// 从 uploadService 拆出的上传校验入口：编排媒体探测与公网 URL 安全检查。
// 网络/URL 校验与媒体探测分别位于 uploadValidationNetwork.js / uploadValidationMedia.js。

const {
  UnsafeMediaReferenceError,
  assertPublicHttpUrlSyntax,
  createPinnedDnsLookup,
  ipv4InCidr,
  isGloballyRoutableIp,
  normalizedHostname,
  validatePublicHttpUrl,
} = require('./uploadValidationNetwork');
const {
  FILE_TYPES,
  InvalidMediaContentError,
  MediaValidationUnavailableError,
  UnsupportedUploadTypeError,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  validateAudioUpload,
  validateImageUpload,
  validateVideoUpload,
} = require('./uploadValidationMedia');

function assertAllowedUpload(source, expectedMediaType = null) {
  const detected = detectAllowedUpload(source);
  if (!detected || (expectedMediaType && detected.mediaType !== expectedMediaType)) {
    throw new UnsupportedUploadTypeError(expectedMediaType);
  }
  return detected;
}

function isUploadValidationError(err) {
  return Boolean(err && [
    'UNSUPPORTED_UPLOAD_TYPE',
    'INVALID_MEDIA_CONTENT',
    'MEDIA_VALIDATION_UNAVAILABLE',
    'UNSAFE_MEDIA_REFERENCE',
  ].includes(err.code));
}

async function validateAllowedUpload(source, expectedMediaType = null) {
  if (expectedMediaType === 'audio') return validateAudioUpload(source, expectedMediaType);
  const candidate = detectAllowedUpload(source);
  if (candidate?.mediaType === 'image' || expectedMediaType === 'image') {
    const detected = await validateImageUpload(source, expectedMediaType);
    if (expectedMediaType && detected.mediaType !== expectedMediaType) {
      throw new UnsupportedUploadTypeError(expectedMediaType);
    }
    return detected;
  }
  if (candidate?.mediaType === 'video') {
    const detected = await validateVideoUpload(source, expectedMediaType);
    if (expectedMediaType && detected.mediaType !== expectedMediaType) {
      throw new UnsupportedUploadTypeError(expectedMediaType);
    }
    return detected;
  }
  if (!expectedMediaType) {
    try {
      return await validateImageUpload(source);
    } catch (_) {
      return validateVideoUpload(source);
    }
  }
  throw new UnsupportedUploadTypeError(expectedMediaType);
}

module.exports = {
  FILE_TYPES,
  InvalidMediaContentError,
  MediaValidationUnavailableError,
  UnsafeMediaReferenceError,
  UnsupportedUploadTypeError,
  assertAllowedUpload,
  assertPublicHttpUrlSyntax,
  createPinnedDnsLookup,
  detectAllowedAudioUpload,
  detectAllowedUpload,
  ipv4InCidr,
  isGloballyRoutableIp,
  isUploadValidationError,
  normalizedHostname,
  validateAllowedUpload,
  validateAudioUpload,
  validatePublicHttpUrl,
};
