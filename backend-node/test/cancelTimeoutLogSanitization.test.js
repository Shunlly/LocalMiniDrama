use strict;

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isTimeoutLikeError,
  isCancelLikeError,
  isUserFacingAbort,
  toUserFacingProcessError,
} = require('../src/services/providerErrorSanitizer');
const aiConfigRoutes = require('../src/routes/aiConfig');
const aiConfigService = require('../src/services/aiConfigService');
const { logCaughtRouteError } = require('../src/routes/serviceFailure');

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function capturingLog() {
  const events = [];
  return {
    events,
    error(message, metadata) { events.push({ level: 'error', message, metadata }); },
    warn(message, metadata) { events.push({ level: 'warn', message, metadata }); },
    operation(event) { events.push({ level: 'operation', event }); },
  };
}
