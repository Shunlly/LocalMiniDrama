const response = require('../response');
const { isTrustedChineseUserError } = require('../services/providerErrorSanitizer');

const NOT_FOUND_MESSAGES = Object.freeze({
  'character not found': '角色不存在',
  'scene not found': '场景不存在',
  'prop not found': '道具不存在',
  'library item not found': '角色库项不存在',
  'episode not found': '剧集不存在',
});

const CANCEL_MESSAGES = Object.freeze({
  'The operation was aborted.': '操作已取消',
  'The operation was aborted': '操作已取消',
  AbortError: '操作已取消',
});

function sendMappedServiceFailure(res, out, options = {}) {
  if (!out || out.ok !== false) return false;
  const error = String(out.error || '');
  const notFoundMessage = NOT_FOUND_MESSAGES[error];
  if (notFoundMessage) {
    response.notFound(res, notFoundMessage);
    return true;
  }
  if (error === 'unauthorized') {
    if (options.unauthorizedAsForbidden) response.forbidden(res, '无权限');
    else response.notFound(res, options.unauthorizedMessage || '剧集不存在或无权限');
    return true;
  }
  const cancelMessage = CANCEL_MESSAGES[error];
  if (cancelMessage) {
    response.badRequest(res, cancelMessage);
    return true;
  }
  if (/AbortError|operation was aborted|ECONNABORTED/i.test(error) && !isTrustedChineseUserError(error)) {
    response.badRequest(res, '操作已取消');
    return true;
  }
  if (isTrustedChineseUserError(error)) {
    response.badRequest(res, error);
    return true;
  }
  response.badRequest(res, options.fallback || '操作失败，请稍后重试');
  return true;
}

function publicErrorMessage(err, fallback = '操作失败，请稍后重试') {
  const raw = String((err && err.message) || err || '');
  return isTrustedChineseUserError(raw) ? raw : fallback;
}

const UPLOAD_FORM_ERROR_MESSAGES = Object.freeze({
  LIMIT_UNEXPECTED_FILE: '不支持的上传字段，请按页面提示选择文件',
  LIMIT_FILE_COUNT: '一次只能上传一个文件',
  LIMIT_PART_COUNT: '上传内容过多，请更换文件后重试',
  LIMIT_FIELD_COUNT: '上传表单字段过多，请更换文件后重试',
  LIMIT_FIELD_KEY: '上传表单字段无效，请更换文件后重试',
  LIMIT_FIELD_VALUE: '上传表单字段过大，请更换文件后重试',
});

function uploadFormErrorMessage(err, fallback = '上传失败，请更换文件后重试') {
  const code = String((err && err.code) || '');
  if (UPLOAD_FORM_ERROR_MESSAGES[code]) return UPLOAD_FORM_ERROR_MESSAGES[code];
  return publicErrorMessage(err, fallback);
}

function sendCaughtRouteError(res, err, fallback = '操作失败，请稍后重试') {
  const raw = String((err && err.message) || err || '');
  if (err && err.code === 'BAD_REQUEST') {
    response.badRequest(res, isTrustedChineseUserError(raw) ? raw : fallback);
    return true;
  }
  return sendMappedServiceFailure(res, { ok: false, error: raw }, { fallback });
}

module.exports = {
  sendMappedServiceFailure,
  sendCaughtRouteError,
  publicErrorMessage,
  uploadFormErrorMessage,
};
