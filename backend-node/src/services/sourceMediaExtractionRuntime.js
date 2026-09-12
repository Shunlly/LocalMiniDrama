// 从 sourceMediaExtractionService 拆出的运行时工具：受限 HTTP、临时目录与子进程边界。

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { secureHttpFetch } = require('./secureHttpFetch');
const {
  actionableError,
  processChildError,
  processDiagnosticOverflowError,
  processFailedError,
  processOutputOverflowError,
  processTimeoutError,
  processUnavailableError,
  providerBadResponseError,
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

async function readBoundedResponse(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw actionableError('抽取服务返回内容过大。请缩短源文件后重试。');
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
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
  const controller = new AbortController();
  const timeoutReason = providerTimeoutError(options.label);
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  timer.unref?.();
  try {
    let response;
    try {
      if (typeof options.fetchImpl === 'function') {
        response = await options.fetchImpl(url, {
          ...init,
          redirect: 'error',
          signal: controller.signal,
        });
      } else {
        response = await secureHttpFetch(url, {
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
      }
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'TimeoutError' || err?.isTimeout === true || err?.name === 'AbortError') {
        throw providerTimeoutError(options.label, err);
      }
      throw providerUnreachableError(options.label, err);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw providerBadResponseError(options.label);
    }
    return {
      body: await readBoundedResponse(response, maxResponseBytes),
      contentType: normalizeMime(response.headers.get('content-type')),
    };
  } finally {
    clearTimeout(timer);
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
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(processTimeoutError(label));
    }, timeoutMs);
    timer.unref?.();

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
