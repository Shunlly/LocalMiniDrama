const { randomUUID } = require('crypto');

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function isSafeRequestId(value) {
  return typeof value === 'string' && SAFE_REQUEST_ID_PATTERN.test(value);
}

function headerRequestId(res) {
  if (typeof res?.getHeader !== 'function') return undefined;
  return res.getHeader('X-Request-Id');
}

function resolveRequestId(req, res) {
  if (isSafeRequestId(req?.requestId)) return req.requestId;
  const header = headerRequestId(res);
  if (isSafeRequestId(header)) return header;
  const supplied = String(req?.headers?.['x-request-id'] || '').trim();
  if (isSafeRequestId(supplied)) return supplied;
  return randomUUID();
}

function ensureRequestId(res, preferred) {
  const requestId = isSafeRequestId(preferred) ? preferred : resolveRequestId(undefined, res);
  if (typeof res?.setHeader === 'function') {
    res.setHeader('X-Request-Id', requestId);
  }
  return requestId;
}

function attachRequestIdToErrorBody(body, requestId) {
  if (!isSafeRequestId(requestId)) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (body.success !== false && !(body.error && typeof body.error === 'object' && !Array.isArray(body.error))) {
    return body;
  }
  const next = { ...body, request_id: requestId };
  if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
    next.error = { ...body.error, request_id: requestId };
  }
  return next;
}

// 和 Go 端 pkg/response 保持一致，方便前端复用
function send(res, statusCode, body) {
  const payload = {
    ...body,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(payload);
}

function success(res, data) {
  send(res, 200, { success: true, data });
}

function created(res, data) {
  send(res, 201, { success: true, data });
}

function successWithPagination(res, items, total, page, pageSize) {
  const totalPages = Math.ceil(total / pageSize) || 0;
  send(res, 200, {
    success: true,
    data: {
      items,
      pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    },
  });
}

function error(res, statusCode, code, message, details) {
  const requestId = ensureRequestId(res);
  send(res, statusCode, attachRequestIdToErrorBody({
    success: false,
    error: { code, message, ...(details && { details }) },
  }, requestId));
}

function badRequest(res, message) {
  error(res, 400, 'BAD_REQUEST', message);
}

function notFound(res, message) {
  error(res, 404, 'NOT_FOUND', message);
}

function forbidden(res, message) {
  error(res, 403, 'FORBIDDEN', message);
}

function internalError(res, message) {
  const requestId = ensureRequestId(res);
  const safeMessage = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : (message || '服务器错误');
  send(res, 500, {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: safeMessage, request_id: requestId },
    request_id: requestId,
  });
}

module.exports = {
  attachRequestIdToErrorBody,
  ensureRequestId,
  isSafeRequestId,
  resolveRequestId,
  success,
  created,
  successWithPagination,
  error,
  badRequest,
  notFound,
  forbidden,
  internalError,
};
