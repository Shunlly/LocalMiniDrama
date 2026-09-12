'use strict';

// 网络素材错误文案：统一错误工厂与用户可见中文，避免服务主文件散落提示语。
const { isTimeoutLikeError, isUserFacingAbort } = require('./providerErrorSanitizer');

function serviceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function badRequest(message) {
  return serviceError('BAD_REQUEST', message, 400);
}

const NETWORK_MEDIA_MESSAGES = Object.freeze({
  KEYWORD_REQUIRED: '关键词不能为空',
  MEDIA_TYPE_CONFLICT: '素材类型参数不能冲突',
  MEDIA_TYPE_UNSUPPORTED: '素材类型仅支持全部、图片或视频',
  SOURCE_UNSUPPORTED: '来源仅支持全部、Wikimedia Commons 或 Openverse',
  COMMONS_SEARCH_FAILED: 'Wikimedia Commons 搜索请求失败',
  OPENVERSE_SEARCH_FAILED: 'Openverse 搜索请求失败',
  OPENVERSE_NO_VIDEO: 'Openverse 目前不提供视频素材，请改用 Wikimedia Commons，或将类型改为图片。',
  OPENVERSE_IMAGE_ONLY: 'Openverse 目前只提供图片，视频结果不会出现在此来源中。',
  OPENVERSE_SKIPPED: 'Openverse 暂时不可用，已跳过该来源。',
  COMMONS_SKIPPED: 'Wikimedia Commons 暂时不可用，已跳过该来源。',
  UPSTREAM_UNAVAILABLE: '网络素材服务暂时不可用',
  COMMONS_SOURCE_URL_REQUIRED: '来源地址必须是 Wikimedia Commons 的 HTTPS 文件页',
  COMMONS_TITLE_INVALID: '来源地址包含无效的文件标题',
  OPENVERSE_SOURCE_URL_REQUIRED: '来源地址必须是 Openverse 的 HTTPS 作品页',
  NOT_FOUND: '网络素材不存在或格式不受支持',
  THUMBNAIL_REQUEST_INVALID: '缩略图请求无效',
  THUMBNAIL_URL_NOT_ALLOWED: '缩略图地址必须由服务端按搜索结果代理，不能直接指定',
  THUMBNAIL_NOT_FOUND: '缩略图不存在或已过期，请重新搜索后再试',
  THUMBNAIL_NOT_IN_ALLOWLIST: '缩略图地址不在允许列表中',
  THUMBNAIL_DOWNLOAD_FAILED: '网络素材缩略图下载失败',
  THUMBNAIL_TYPE_UNSUPPORTED: '网络素材缩略图格式不受支持',
  THUMBNAIL_TOO_LARGE: '网络素材缩略图为空或超过允许的大小限制',
  CLEANUP_SYMLINK: '网络素材清理目录包含符号链接或目录联接',
  CLEANUP_DIRECTORY_ESCAPE: '网络素材清理目录越界',
  CLEANUP_TARGET_ESCAPE: '网络素材清理目标越界',
  CLEANUP_TARGET_CHANGED: '网络素材清理目标在删除前发生变化',
  IMPORT_REQUEST_INVALID: '网络素材导入请求必须为对象',
  LICENSE_MISSING: '该网络素材没有可验证的许可信息，已拒绝导入',
  MEDIA_TYPE_MISMATCH: '素材类型与来源记录不一致',
  FILE_TOO_LARGE: '网络素材超过允许的大小限制',
  DOWNLOAD_FAILED: '网络素材下载失败',
  CONTENT_TYPE_MISMATCH: '网络素材内容类型不受支持或与来源不一致',
  DOWNLOAD_MUST_HTTPS: '网络素材下载地址必须保持 HTTPS',
  EMPTY_OR_TOO_LARGE: '网络素材为空或超过允许的大小限制',
  CONTENT_INVALID: '网络素材内容校验失败',
  CONTENT_MISMATCH: '网络素材内容与声明格式不一致',
  HASH_MISSING: 'Wikimedia Commons 未提供可验证的内容哈希',
  HASH_MISMATCH: '网络素材内容与 Wikimedia Commons 哈希不一致',
  UNSAFE_URL: '网络素材地址未通过公网安全校验',
  TIMEOUT: '网络素材服务请求超时',
  CANCELLED: '网络素材请求已取消',
  INVALID_RESPONSE: '网络素材服务返回了无效内容',
  DEFAULT_UPSTREAM: '网络素材服务',
  COMMONS_UPSTREAM: 'Wikimedia Commons 服务',
  OPENVERSE_UPSTREAM: 'Openverse 服务',
  COMMONS_SOURCE_NAME: 'Wikimedia Commons',
  OPENVERSE_SOURCE_NAME: 'Openverse',
  UNNAMED_TITLE: '未命名网络素材',
  UNKNOWN_AUTHOR: '未知',
  LICENSE_UNSPECIFIED: '未注明',
});

function upstreamFailed(message = NETWORK_MEDIA_MESSAGES.UPSTREAM_UNAVAILABLE) {
  return serviceError('NETWORK_MEDIA_UPSTREAM', message, 502);
}

function upstreamTemporarilyUnavailable(upstreamName = NETWORK_MEDIA_MESSAGES.DEFAULT_UPSTREAM) {
  return upstreamFailed(`${upstreamName}暂时不可用`);
}

function commonsSearchFailed() {
  return upstreamFailed(NETWORK_MEDIA_MESSAGES.COMMONS_SEARCH_FAILED);
}

function openverseSearchFailed() {
  return upstreamFailed(NETWORK_MEDIA_MESSAGES.OPENVERSE_SEARCH_FAILED);
}

function networkMediaNotFound() {
  return serviceError('NETWORK_MEDIA_NOT_FOUND', NETWORK_MEDIA_MESSAGES.NOT_FOUND, 404);
}

function invalidNetworkMediaResponse() {
  return serviceError('NETWORK_MEDIA_INVALID_RESPONSE', NETWORK_MEDIA_MESSAGES.INVALID_RESPONSE, 502);
}

function networkMediaTimeout() {
  return serviceError('NETWORK_MEDIA_TIMEOUT', NETWORK_MEDIA_MESSAGES.TIMEOUT, 504);
}

function networkMediaCancelled() {
  return serviceError('NETWORK_MEDIA_CANCELLED', NETWORK_MEDIA_MESSAGES.CANCELLED, 400);
}

function unsafeNetworkMediaUrl(message = NETWORK_MEDIA_MESSAGES.UNSAFE_URL) {
  return serviceError('UNSAFE_NETWORK_MEDIA_URL', message, 400);
}

function storageUnsafe(message) {
  return serviceError('NETWORK_MEDIA_STORAGE_UNSAFE', message, 500);
}

function licenseMissing() {
  return serviceError('NETWORK_MEDIA_LICENSE_MISSING', NETWORK_MEDIA_MESSAGES.LICENSE_MISSING, 422);
}

function fileTooLarge(message = NETWORK_MEDIA_MESSAGES.FILE_TOO_LARGE) {
  return serviceError('NETWORK_MEDIA_TOO_LARGE', message, 413);
}

function downloadFailed() {
  return serviceError('NETWORK_MEDIA_DOWNLOAD_FAILED', NETWORK_MEDIA_MESSAGES.DOWNLOAD_FAILED, 502);
}

function invalidContentType(message = NETWORK_MEDIA_MESSAGES.CONTENT_TYPE_MISMATCH) {
  return serviceError('NETWORK_MEDIA_INVALID_CONTENT_TYPE', message, 415);
}

function invalidContent(message = NETWORK_MEDIA_MESSAGES.CONTENT_INVALID) {
  return serviceError('NETWORK_MEDIA_INVALID_CONTENT', message, 415);
}

function hashMissing() {
  return serviceError('NETWORK_MEDIA_HASH_MISSING', NETWORK_MEDIA_MESSAGES.HASH_MISSING, 422);
}

function hashMismatch() {
  return serviceError('NETWORK_MEDIA_HASH_MISMATCH', NETWORK_MEDIA_MESSAGES.HASH_MISMATCH, 422);
}

function thumbnailNotFound() {
  return serviceError('NETWORK_MEDIA_THUMBNAIL_NOT_FOUND', NETWORK_MEDIA_MESSAGES.THUMBNAIL_NOT_FOUND, 404);
}

function thumbnailDownloadFailed() {
  return serviceError('NETWORK_MEDIA_THUMBNAIL_FAILED', NETWORK_MEDIA_MESSAGES.THUMBNAIL_DOWNLOAD_FAILED, 502);
}

function translateFetchFailure(error, upstreamName = NETWORK_MEDIA_MESSAGES.DEFAULT_UPSTREAM) {
  if (error?.code === 'UNSAFE_MEDIA_REFERENCE') return unsafeNetworkMediaUrl();
  if (isTimeoutLikeError(error) || error?.name === 'TimeoutError') return networkMediaTimeout();
  if (isUserFacingAbort(error) || error?.name === 'AbortError') return networkMediaCancelled();
  return upstreamTemporarilyUnavailable(upstreamName);
}

module.exports = {
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
  networkMediaCancelled,
  openverseSearchFailed,
  serviceError,
  storageUnsafe,
  thumbnailDownloadFailed,
  thumbnailNotFound,
  translateFetchFailure,
  unsafeNetworkMediaUrl,
  upstreamFailed,
  upstreamTemporarilyUnavailable,
};
