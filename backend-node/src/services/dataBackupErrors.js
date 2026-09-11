'use strict';

// 备份错误类型：把错误码映射成用户可见中文。

const BACKUP_PUBLIC_MESSAGES = require('./backupPublicMessages');

const MAX_CLEANUP_ERROR_DETAILS = 8;

class DataBackupError extends Error {
  constructor(code, publicMessage, cause) {
    super(publicMessage, cause ? { cause } : undefined);
    this.name = 'DataBackupError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function backupError(code, message, cause) {
  if (message instanceof Error && cause === undefined) {
    cause = message;
    message = undefined;
  }
  const mapped = BACKUP_PUBLIC_MESSAGES[code];
  return new DataBackupError(code, mapped || message, cause);
}

function isPermissionDeniedError(error) {
  const code = String(error?.code || '');
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

function permissionDeniedError(cause) {
  return backupError('PERMISSION_DENIED', cause);
}

function wrapUnknownBackupError(error, fallbackCode, fallbackMessage) {
  if (error instanceof DataBackupError) return error;
  if (isPermissionDeniedError(error)) return permissionDeniedError(error);
  return backupError(fallbackCode, fallbackMessage, error);
}

function attachCleanupErrors(primaryError, cleanupErrors) {
  let existing = [];
  try {
    const descriptor = Object.getOwnPropertyDescriptor(primaryError, 'cleanupErrors');
    if (descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value)) {
      for (let index = 0; index < Math.min(MAX_CLEANUP_ERROR_DETAILS, descriptor.value.length); index += 1) {
        const entry = Object.getOwnPropertyDescriptor(descriptor.value, String(index));
        if (entry && Object.hasOwn(entry, 'value')) existing.push(entry.value);
      }
    }
  } catch (_) {}
  const bounded = existing.slice(0, MAX_CLEANUP_ERROR_DETAILS);
  for (const cleanupError of cleanupErrors) {
    if (bounded.length >= MAX_CLEANUP_ERROR_DETAILS) break;
    bounded.push(cleanupError);
  }
  if (bounded.length === 0) return primaryError;
  try {
    Object.defineProperty(primaryError, 'cleanupErrors', {
      configurable: true,
      enumerable: false,
      value: Object.freeze(bounded),
    });
  } catch (_) {}
  return primaryError;
}

function assertOperationNotAborted(signal) {
  if (signal?.aborted) {
    throw backupError('OPERATION_ABORTED');
  }
}

module.exports = {
  DataBackupError,
  attachCleanupErrors,
  assertOperationNotAborted,
  backupError,
  isPermissionDeniedError,
  permissionDeniedError,
  wrapUnknownBackupError,
};
