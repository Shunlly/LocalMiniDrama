// 从 sourceMediaExtractionService 拆出的运行时工具：受限 HTTP、临时目录与子进程边界。

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { secureHttpFetch } = require('./secureHttpFetch');
const {
  actionableError,
  isExtractionCancelled,
  isExtractionTimeout,
  processChildError,
  processDiagnosticOverflowError,
  processFailedError,
  processOutputOverflowError,
  processTimeoutError,
  processUnavailableError,
  providerCancelledError,
  providerHttpFailureError,
  providerTimeoutError,
  providerUnreachableError,
} = require('./sourceMediaExtractionErrors');
const { normalizeMime } = require('./sourceMediaExtractionDetect');
const {
  MAX_PROVIDER_RESPONSE_BYTES,
  clampInteger,
  parseSettings,
} = require('./sourceMediaExtractionValidation');

function selectActiveConfig(db, serviceType) {
  const row = db.prepare(
    `SELECT * FROM ai_service_configs
     WHERE deleted_at IS NULL
       AND service_type = ?
       AND COALESCE(is_active, 1) = 1
     ORDER BY is_default DESC, priority DESC, created_at DESC, id ASC
     LIMIT 1`
  ).get(serviceType);
  if (!row) return null;
  return { ...row, settings_object: parseSettings(row.settings) };
}

async function readBoundedResponse(response, maxBytes, signal, onAbort) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw actionableError('抽取服务返回内容过大。请缩短源文件后重试。');
  if (!response.body) return Buffer.alloc(0);
  if (signal?.aborted) throw onAbort();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw onAbort();
      }
      const { done, value } = signal
        ? await new Promise((resolve, reject) => {
          const fail = () => {
            reader.cancel().catch(() => {});
            reject(onAbort());
          };
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail, { once: true });
          reader.read().then(
            (result) => {
              signal.removeEventListener('abort', fail);
              resolve(result);
            },
            (error) => {
              signal.removeEventListener('abort', fail);
              reject(error);
            }
          );
        })
        : await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw actionableError('抽取服务返回内容过大。请缩短源文件后重试。');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function requestBounded(url, init, options) {
  const timeoutMs = clampInteger(options.timeoutMs, 60000, 1000, 120000);
  const maxResponseBytes = clampInteger(options.maxResponseBytes, MAX_PROVIDER_RESPONSE_BYTES, 1024, MAX_PROVIDER_RESPONSE_BYTES);
  const label = options.label || '抽取服务';
  const parentSignal = options.signal;
  if (parentSignal?.aborted) throw providerCancelledError(label, parentSignal.reason);

  const controller = new AbortController();
  const timeoutReason = providerTimeoutError(label);
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason || providerCancelledError(label));
    }
  };
  if (parentSignal) parentSignal.addEventListener('abort', onParentAbort, { once: true });

  const classifyAbort = (error) => {
    const reason = controller.signal.reason || parentSignal?.reason || error;
    if (isExtractionTimeout(reason) || reason === timeoutReason || isExtractionTimeout(error)) {
      return providerTimeoutError(label, error);
    }
    if (isExtractionCancelled(reason) || isExtractionCancelled(error) || parentSignal?.aborted) {
      return providerCancelledError(label, error);
    }
    return providerTimeoutError(label, error);
  };

  try {
    let response;
    try {
      const fetchPromise = typeof options.fetchImpl === 'function'
        ? options.fetchImpl(url, {
          ...init,
          redirect: 'error',
          signal: controller.signal,
        })
        : secureHttpFetch(url, {
          ...init,
          redirect: 'error',
          signal: controller.signal,
        }, {
          trustedOrigins: options.trustedOrigins,
          allowPrivateOrigins: options.allowPrivateOrigins,
          lookup: options.networkLookup,
          timeoutMs,
          maxBytes: maxResponseBytes,
          maxRedirects: 0,
        });
      fetchPromise.catch(() => {});
      response = await new Promise((resolve, reject) => {
        const onAbort = () => reject(classifyAbort(controller.signal.reason));
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(fetchPromise).then(
          (value) => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error) => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(error);
          }
        );
      });
    } catch (err) {
      if (err?.code === 'OPERATION_CANCELLED' && isExtractionCancelled(err) && /取消/.test(String(err.message || ''))) {
        throw err;
      }
      if (isExtractionTimeout(err) && err.isTimeout === true && /超时/.test(String(err.message || ''))) {
        throw err;
      }
      if (controller.signal.aborted || isExtractionCancelled(err) || isExtractionTimeout(err) || err?.name === 'TimeoutError' || err?.isTimeout === true || err?.name === 'AbortError') {
        throw classifyAbort(err);
      }
      throw providerUnreachableError(label, err);
    }
    if (!response.ok) {
      let snippet = '';
      try {
        const buf = await readBoundedResponse(response, Math.min(maxResponseBytes, 4096), controller.signal, () => classifyAbort(controller.signal.reason));
        snippet = buf.toString('utf8');
      } catch (_) {
        await response.body?.cancel().catch(() => {});
      }
      throw providerHttpFailureError(label, response.status, snippet);
    }
    return {
      body: await readBoundedResponse(response, maxResponseBytes, controller.signal, () => classifyAbort(controller.signal.reason)),
      contentType: normalizeMime(response.headers.get('content-type')),
    };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function createTempDir(options, prefix) {
  const root = path.resolve(options.tempRoot || os.tmpdir());
  await fsp.mkdir(root, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(root, prefix));
  if (!isPathInside(dir, root)) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw actionableError('无法创建安全的临时抽取目录。请检查临时目录权限后重试。');
  }
  return { dir, root };
}

async function cleanupTempDir(temp) {
  if (!temp?.dir || !isPathInside(temp.dir, temp.root)) {
    throw actionableError('临时抽取路径校验失败。请检查临时目录配置后重试。');
  }
  try {
    await fsp.rm(temp.dir, { recursive: true, force: true });
  } catch (err) {
    throw actionableError('临时抽取文件无法删除。请检查临时目录权限后重试。', err);
  }
}

function runBoundedProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = clampInteger(options.timeoutMs, 30000, 1000, 300000);
    const maxStdoutBytes = clampInteger(options.maxStdoutBytes, 1024 * 1024, 1024, 4 * 1024 * 1024);
    const maxStderrBytes = clampInteger(options.maxStderrBytes, 64 * 1024, 1024, 256 * 1024);
    const label = options.label || '媒体处理工具';
    const parentSignal = options.signal;
    if (parentSignal?.aborted) {
      reject(providerCancelledError(label, parentSignal.reason));
      return;
    }
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(processUnavailableError(label, err));
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let overflow = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    };

    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish(providerCancelledError(label, parentSignal?.reason));
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(processTimeoutError(label));
    }, timeoutMs);
    if (parentSignal) parentSignal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        overflow = true;
        child.kill('SIGKILL');
        finish(processOutputOverflowError(label));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxStderrBytes) {
        overflow = true;
        child.kill('SIGKILL');
        finish(processDiagnosticOverflowError(label));
        return;
      }
      stderr.push(chunk);
    });
    child.on('error', (err) => {
      finish(processChildError(label, err));
    });
    child.on('close', (code) => {
      if (overflow || settled) return;
      if (code !== 0) {
        finish(processFailedError(label, code));
        return;
      }
      finish(null, {
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderr: Buffer.concat(stderr, stderrBytes),
      });
    });
  });
}

module.exports = {
  cleanupTempDir,
  createTempDir,
  requestBounded,
  runBoundedProcess,
  selectActiveConfig,
};
