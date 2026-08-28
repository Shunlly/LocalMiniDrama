const { randomUUID } = require('crypto');

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
  send(res, statusCode, {
    success: false,
    error: { code, message, ...(details && { details }) },
  });
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

function ensureRequestId(res) {
  const existing = typeof res.getHeader === 'function'
    ? res.getHeader('X-Request-Id')
    : undefined;
  const requestId = typeof existing === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(existing)
    ? existing
    : randomUUID();
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-Request-Id', requestId);
  }
  return requestId;
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
  success,
  created,
  successWithPagination,
  error,
  badRequest,
  notFound,
  forbidden,
  internalError,
};
