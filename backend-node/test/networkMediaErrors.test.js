'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isTrustedChineseUserError } = require('../src/services/providerErrorSanitizer');
const {
  NETWORK_MEDIA_MESSAGES,
  badRequest,
  commonsSearchFailed,
  downloadFailed,
  fileTooLarge,
  hashMismatch,
  hashMissing,
  invalidContent,
  invalidContentType,
  invalidNetworkMediaResponse,
  licenseMissing,
  networkMediaNotFound,
  networkMediaTimeout,
  openverseSearchFailed,
  storageUnsafe,
  thumbnailDownloadFailed,
  thumbnailNotFound,
  translateFetchFailure,
  unsafeNetworkMediaUrl,
  upstreamTemporarilyUnavailable,
} = require('../src/services/networkMediaErrors');

function assertChineseError(error, code, statusCode, message) {
  assert.equal(error.code, code);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.message, message);
  assert.equal(isTrustedChineseUserError(error.message), true, error.message);
}

test('错误工厂保持原错误码、状态码和中文文案', () => {
  assertChineseError(badRequest(NETWORK_MEDIA_MESSAGES.KEYWORD_REQUIRED), 'BAD_REQUEST', 400, '关键词不能为空');
  assertChineseError(networkMediaNotFound(), 'NETWORK_MEDIA_NOT_FOUND', 404, NETWORK_MEDIA_MESSAGES.NOT_FOUND);
  assertChineseError(invalidNetworkMediaResponse(), 'NETWORK_MEDIA_INVALID_RESPONSE', 502, NETWORK_MEDIA_MESSAGES.INVALID_RESPONSE);
  assertChineseError(networkMediaTimeout(), 'NETWORK_MEDIA_TIMEOUT', 504, NETWORK_MEDIA_MESSAGES.TIMEOUT);
  assertChineseError(commonsSearchFailed(), 'NETWORK_MEDIA_UPSTREAM', 502, NETWORK_MEDIA_MESSAGES.COMMONS_SEARCH_FAILED);
  assertChineseError(openverseSearchFailed(), 'NETWORK_MEDIA_UPSTREAM', 502, NETWORK_MEDIA_MESSAGES.OPENVERSE_SEARCH_FAILED);
  assertChineseError(upstreamTemporarilyUnavailable(), 'NETWORK_MEDIA_UPSTREAM', 502, '网络素材服务暂时不可用');
  assertChineseError(upstreamTemporarilyUnavailable(NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM), 'NETWORK_MEDIA_UPSTREAM', 502, 'Openverse 服务暂时不可用');
  assertChineseError(licenseMissing(), 'NETWORK_MEDIA_LICENSE_MISSING', 422, NETWORK_MEDIA_MESSAGES.LICENSE_MISSING);
  assertChineseError(fileTooLarge(), 'NETWORK_MEDIA_TOO_LARGE', 413, NETWORK_MEDIA_MESSAGES.FILE_TOO_LARGE);
  assertChineseError(fileTooLarge(NETWORK_MEDIA_MESSAGES.THUMBNAIL_TOO_LARGE), 'NETWORK_MEDIA_TOO_LARGE', 413, NETWORK_MEDIA_MESSAGES.THUMBNAIL_TOO_LARGE);
  assertChineseError(downloadFailed(), 'NETWORK_MEDIA_DOWNLOAD_FAILED', 502, NETWORK_MEDIA_MESSAGES.DOWNLOAD_FAILED);
  assertChineseError(invalidContentType(), 'NETWORK_MEDIA_INVALID_CONTENT_TYPE', 415, NETWORK_MEDIA_MESSAGES.CONTENT_TYPE_MISMATCH);
  assertChineseError(invalidContent(), 'NETWORK_MEDIA_INVALID_CONTENT', 415, NETWORK_MEDIA_MESSAGES.CONTENT_INVALID);
  assertChineseError(hashMissing(), 'NETWORK_MEDIA_HASH_MISSING', 422, NETWORK_MEDIA_MESSAGES.HASH_MISSING);
  assertChineseError(hashMismatch(), 'NETWORK_MEDIA_HASH_MISMATCH', 422, NETWORK_MEDIA_MESSAGES.HASH_MISMATCH);
  assertChineseError(thumbnailNotFound(), 'NETWORK_MEDIA_THUMBNAIL_NOT_FOUND', 404, NETWORK_MEDIA_MESSAGES.THUMBNAIL_NOT_FOUND);
  assertChineseError(thumbnailDownloadFailed(), 'NETWORK_MEDIA_THUMBNAIL_FAILED', 502, NETWORK_MEDIA_MESSAGES.THUMBNAIL_DOWNLOAD_FAILED);
  assertChineseError(unsafeNetworkMediaUrl(), 'UNSAFE_NETWORK_MEDIA_URL', 400, NETWORK_MEDIA_MESSAGES.UNSAFE_URL);
  assertChineseError(storageUnsafe(NETWORK_MEDIA_MESSAGES.CLEANUP_SYMLINK), 'NETWORK_MEDIA_STORAGE_UNSAFE', 500, NETWORK_MEDIA_MESSAGES.CLEANUP_SYMLINK);
});

test('抓取失败按原因翻译，不把上游英文细节暴露给用户', () => {
  const unsafe = Object.assign(new Error('Unsafe media reference.'), { code: 'UNSAFE_MEDIA_REFERENCE' });
  assertChineseError(translateFetchFailure(unsafe), 'UNSAFE_NETWORK_MEDIA_URL', 400, NETWORK_MEDIA_MESSAGES.UNSAFE_URL);

  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assertChineseError(translateFetchFailure(aborted), 'NETWORK_MEDIA_TIMEOUT', 504, NETWORK_MEDIA_MESSAGES.TIMEOUT);

  const timedOut = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  assertChineseError(translateFetchFailure(timedOut, NETWORK_MEDIA_MESSAGES.COMMONS_UPSTREAM), 'NETWORK_MEDIA_TIMEOUT', 504, NETWORK_MEDIA_MESSAGES.TIMEOUT);

  const generic = new Error('connect ECONNREFUSED 127.0.0.1:443');
  const wrapped = translateFetchFailure(generic, NETWORK_MEDIA_MESSAGES.OPENVERSE_UPSTREAM);
  assertChineseError(wrapped, 'NETWORK_MEDIA_UPSTREAM', 502, 'Openverse 服务暂时不可用');
  assert.doesNotMatch(wrapped.message, /ECONNREFUSED|127\.0\.0\.1/);
});
