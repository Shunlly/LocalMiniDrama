'use strict';

class DramaExportError extends Error {
  constructor(code, message, statusCode = 413, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DramaExportError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function exportError(code, message, details = null, statusCode = 413, cause = null) {
  return new DramaExportError(code, message, statusCode, details, cause);
}

module.exports = {
  DramaExportError,
  exportError,
};
