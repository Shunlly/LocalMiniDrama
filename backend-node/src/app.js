const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { randomUUID } = require('crypto');
const { getDb, closeDb } = require('./db/index.js');
const { loadConfig } = require('./config/index.js');
const logger = require('./logger.js');
const response = require('./response.js');
const { setupRouter } = require('./routes/index.js');
const uploadService = require('./services/uploadService.js');
const dramaWriteGuard = require('./services/dramaWriteGuard.js');
const { backgroundTasks } = require('./services/legacyAsyncSchedulerService.js');
const {
  createRuntimeInstanceId,
  findWorkspaceRoot,
} = require('./utils/runtimeInstanceId.js');

const RUNTIME_INSTANCE_ID = createRuntimeInstanceId({
  rootDirectory: findWorkspaceRoot(__dirname),
});

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const STORAGE_MEDIA_MIME_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.avi', 'video/x-msvideo'],
  ['.bmp', 'image/bmp'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.m4a', 'audio/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.srt', 'text/plain; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.vtt', 'text/vtt; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://upload.wikimedia.org",
  "media-src 'self' data: blob: https://upload.wikimedia.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()'
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

function requestContext(req, res, next) {
  const supplied = String(req.headers?.['x-request-id'] || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

function createBackgroundTaskContextMiddleware(tasks = backgroundTasks, log = logger) {
  if (!tasks || typeof tasks.runTracked !== 'function') {
    throw new Error('API background task tracking requires a scheduler');
  }
  return (req, _res, next) => {
    try {
      tasks.runTracked(log, 'api_request_async', next, {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
      });
    } catch (error) {
      next(error);
    }
  };
}

function normalizeHostname(value) {
  let hostname = String(value || '').trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
}

function isLoopbackHostname(value) {
  const hostname = normalizeHostname(value);
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (net.isIP(hostname) !== 4) return false;
  return Number(hostname.split('.')[0]) === 127;
}

function isLoopbackAddress(value) {
  let address = String(value || '').trim().toLowerCase();
  const zoneIndex = address.indexOf('%');
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex);
  if (address.startsWith('::ffff:')) address = address.slice('::ffff:'.length);
  if (address === '::1') return true;
  if (net.isIP(address) !== 4) return false;
  return Number(address.split('.')[0]) === 127;
}

function isVerifiedLoopbackRendererRequest(req, requestAuthority) {
  if (!isLoopbackHostname(requestAuthority?.hostname)) return false;
  if (req?.headers?.['sec-fetch-site'] !== 'same-origin') return false;
  if (Number(req?.socket?.localPort) !== requestAuthority.port) return false;
  return isLoopbackAddress(req?.socket?.remoteAddress)
    && isLoopbackAddress(req?.socket?.localAddress);
}

function parseHttpOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  if (value !== value.trim() || value.includes(',')) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/') return null;
    return {
      origin: parsed.origin,
      hostname: normalizeHostname(parsed.hostname),
    };
  } catch {
    return null;
  }
}

function parseConfiguredHost(value) {
  const raw = String(value || '').trim();
  if (!raw || ['*', '0.0.0.0', '::', '[::]'].includes(raw)) return null;
  if (/[/\\@,\s]/.test(raw)) return null;
  const unwrapped = normalizeHostname(raw);
  if (net.isIP(unwrapped)) return unwrapped;
  try {
    return normalizeHostname(new URL(`http://${raw}`).hostname);
  } catch {
    return null;
  }
}

function parseRequestAuthority(req) {
  const rawHost = req?.headers?.host;
  if (typeof rawHost !== 'string' || !rawHost || rawHost.length > 512) return null;
  if (/[/\\@,\s]/.test(rawHost)) return null;
  const protocol = req?.socket?.encrypted ? 'https:' : 'http:';
  try {
    const parsed = new URL(`${protocol}//${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return {
      origin: parsed.origin,
      hostname: normalizeHostname(parsed.hostname),
      port: Number(parsed.port || (protocol === 'https:' ? 443 : 80)),
    };
  } catch {
    return null;
  }
}

function createRequestOriginPolicy(serverConfig = {}, options = {}) {
  const configuredValues = Array.isArray(serverConfig.cors_origins)
    ? serverConfig.cors_origins
    : [serverConfig.cors_origins].filter(Boolean);
  const runtimeValues = String(options.additionalOrigins ?? process.env.LOCALMINIDRAMA_CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 32);
  const configuredOrigins = new Set();
  const trustedHostnames = new Set();

  for (const value of [...configuredValues, ...runtimeValues]) {
    const parsed = parseHttpOrigin(value);
    if (!parsed) continue;
    configuredOrigins.add(parsed.origin);
  }
  const configuredHosts = [
    serverConfig.host,
    ...(Array.isArray(serverConfig.trusted_hosts)
      ? serverConfig.trusted_hosts
      : [serverConfig.trusted_hosts].filter(Boolean)),
  ];
  for (const value of configuredHosts) {
    const configuredHost = parseConfiguredHost(value);
    if (configuredHost) trustedHostnames.add(configuredHost);
  }
  const development = (options.nodeEnv ?? process.env.NODE_ENV) === 'development';

  return (req, suppliedOrigin = req?.headers?.origin) => {
    const requestAuthority = parseRequestAuthority(req);
    if (!requestAuthority) return false;
    const trustedHost = isLoopbackHostname(requestAuthority.hostname)
      || trustedHostnames.has(requestAuthority.hostname);
    if (!trustedHost) return false;

    if (suppliedOrigin === undefined || suppliedOrigin === null) {
      const method = String(req?.method || '').toUpperCase();
      if (READ_ONLY_METHODS.has(method)) return true;
      return isVerifiedLoopbackRendererRequest(req, requestAuthority);
    }
    const parsedOrigin = parseHttpOrigin(suppliedOrigin);
    if (!parsedOrigin) return false;

    if (configuredOrigins.has(parsedOrigin.origin)) return true;
    if (parsedOrigin.origin === requestAuthority.origin) return true;
    return development && isLoopbackHostname(parsedOrigin.hostname);
  };
}

function createOriginGuard(originAllowed, log = logger) {
  return (req, res, next) => {
    const origin = req?.headers?.origin;
    if (originAllowed(req, origin)) return next();
    log.warnw?.('Rejected request source', {
      request_id: req.requestId,
      method: req.method,
      host: req.headers?.host,
      origin,
      sec_fetch_site: req.headers?.['sec-fetch-site'],
    });
    return res.status(403).json({
      success: false,
      error: {
        code: 'REQUEST_SOURCE_NOT_ALLOWED',
        message: 'Request host or origin is not allowed',
        request_id: req.requestId,
      },
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
    });
  };
}

function createCorsMiddleware(originAllowed) {
  return cors((req, callback) => {
    const origin = req?.headers?.origin;
    callback(null, {
      origin: typeof origin === 'string' && originAllowed(req, origin) ? origin : false,
    });
  });
}

function parseByteRange(value, size) {
  if (typeof value !== 'string' || !value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
  }
  if (start < 0 || end < start || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

function createStorageStaticMiddleware(storageRoot, log = logger, db = null) {
  return (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const encodedPath = String(req.url || '').split('?')[0].replace(/^\/+/, '');
    if (!encodedPath) return res.status(404).send('Not Found');
    let rawPath;
    try {
      rawPath = uploadService.decodeReferencePath(encodedPath).replace(/\\/g, '/').replace(/^\/+/, '');
    } catch (_) {
      return res.status(400).send('Not Found');
    }
    if (!rawPath) return res.status(404).send('Not Found');

    if (db) {
      try {
        dramaWriteGuard.assertMediaPathReadable(db, rawPath);
      } catch (error) {
        if (error?.code === 'UNSAFE_STORAGE_PATH') {
          return res.status(403).json({
            success: false,
            error: { code: 'UNSAFE_STORAGE_PATH', message: 'Static storage path is not allowed' },
            request_id: req.requestId,
            timestamp: new Date().toISOString(),
          });
        }
        return res.status(404).send('Not Found');
      }
    }

    let opened;
    try {
      opened = uploadService.openStorageFile(storageRoot, rawPath);
    } catch (error) {
      if (error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'NOT_FOUND') {
        return res.status(404).send('Not Found');
      }
      log.warnw?.('Rejected unsafe static storage path', {
        request_id: req.requestId,
        code: error?.code,
        reason: error?.reason,
      });
      return res.status(403).json({
        success: false,
        error: { code: 'UNSAFE_STORAGE_PATH', message: 'Static storage path is not allowed' },
        request_id: req.requestId,
        timestamp: new Date().toISOString(),
      });
    }

    let fd = opened.fd;
    const closeFd = () => {
      if (fd === undefined) return;
      try { fs.closeSync(fd); } catch (_) {}
      fd = undefined;
    };
    const size = Number(opened.stat.size);
    const range = parseByteRange(req.headers.range, size);
    if (range === false) {
      closeFd();
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, size - 1);
    const responseBytes = size === 0 ? 0 : end - start + 1;
    const extension = path.extname(opened.absolutePath).toLowerCase();
    const mediaMimeType = STORAGE_MEDIA_MIME_TYPES.get(extension);
    res.setHeader('Content-Type', mediaMimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!mediaMimeType) res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', responseBytes);
    res.setHeader('Last-Modified', opened.stat.mtime.toUTCString());
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    if (req.method === 'HEAD' || size === 0) {
      closeFd();
      return res.end();
    }

    const stream = fs.createReadStream(opened.absolutePath, {
      fd,
      autoClose: true,
      start,
      end,
    });
    fd = undefined;
    stream.on('error', (error) => {
      if (res.headersSent) return res.destroy(error);
      return next(error);
    });
    return stream.pipe(res);
  };
}

function createAppCloseHandler(maintenanceGuard, closeDatabase = closeDb, beforeDatabaseClose = []) {
  let closed = false;
  return () => {
    if (closed) return false;
    closed = true;
    let firstError = null;
    for (const closeResource of beforeDatabaseClose) {
      try {
        closeResource?.();
      } catch (error) {
        firstError ||= error;
      }
    }
    try {
      closeDatabase();
    } catch (error) {
      firstError ||= error;
    }
    try {
      maintenanceGuard?.release?.();
    } catch (error) {
      firstError ||= error;
    }
    if (firstError) throw firstError;
    return true;
  };
}

function createNotFoundHandler() {
  return (req, res) => {
    if (req.path.startsWith('/api')) {
      return response.notFound(res, 'API endpoint not found');
    }
    return res.status(404).send('Not Found');
  };
}

function initializeWithMaintenanceGuard(maintenanceGuard, initialize, closeDatabase) {
  try {
    return initialize();
  } catch (error) {
    try {
      closeDatabase?.();
    } catch (_) {
      // 保留原始启动错误，同时继续释放维护锁。
    }
    try {
      maintenanceGuard?.release?.();
    } catch (_) {
      // 保留原始启动错误，避免清理异常掩盖根因。
    }
    throw error;
  }
}

function createProductionErrorResponseSanitizer(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  return (req, res, next) => {
    if (!production) return next();
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode !== 500) return sendJson(body);
      const requestId = req.requestId || randomUUID();
      return sendJson({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          request_id: requestId,
        },
        request_id: requestId,
        timestamp: new Date().toISOString(),
      });
    };
    return next();
  };
}

function classifyExpectedError(error) {
  const code = String(error?.code || '');
  if (code === 'LEGACY_ASYNC_SCHEDULER_CLOSED') {
    return { status: 503, code, message: error.message };
  }
  if (code === 'LIMIT_FILE_SIZE') {
    return { status: 413, code: 'FILE_TOO_LARGE', message: 'Uploaded file exceeds the allowed size' };
  }
  if (code === 'INSUFFICIENT_STORAGE' || code === 'ENOSPC') {
    return { status: 507, code: 'INSUFFICIENT_STORAGE', message: 'Insufficient storage space' };
  }
  if ([
    'ARCHIVE_TOO_LARGE',
    'ENTRY_SIZE_LIMIT',
    'TOTAL_SIZE_LIMIT',
    'MATERIALIZED_SIZE_LIMIT',
    'SOURCE_ORIGINAL_QUOTA_EXCEEDED',
    'EXPORT_FILE_COUNT_LIMIT',
    'EXPORT_FILE_SIZE_LIMIT',
    'EXPORT_TOTAL_SIZE_LIMIT',
    'EXPORT_MEMORY_LIMIT',
  ].includes(code)) {
    return { status: 413, code, message: error.message };
  }
  if (
    error?.name === 'DramaImportError' ||
    code === 'BAD_REQUEST' ||
    code === 'INVALID_ARGUMENT' ||
    code === 'UNSAFE_MEDIA_REFERENCE' ||
    code.startsWith('INVALID_') ||
    code.startsWith('UNSAFE_')
  ) {
    return { status: 400, code: code || 'BAD_REQUEST', message: error.message || 'Invalid request' };
  }
  const status = Number(error?.status || error?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, code: code || 'REQUEST_REJECTED', message: error.message || 'Request rejected' };
  }
  return null;
}

function createErrorHandler(log, options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  return (err, req, res, next) => {
    const requestId = req.requestId || randomUUID();
    log.errorw?.('Unhandled request error', {
      request_id: requestId,
      method: req.method,
      path: req.path,
      code: err?.code,
      error: err?.message,
      stack: err?.stack,
    });
    if (res.headersSent) return next(err);
    const expected = classifyExpectedError(err);
    const status = expected?.status || 500;
    const code = expected?.code || 'INTERNAL_ERROR';
    const message = expected?.message || (production ? 'Internal server error' : (err?.message || 'Internal server error'));
    res.status(status).json({
      success: false,
      error: { code, message, request_id: requestId },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    });
  };
}

function createApp() {
  const config = loadConfig();
  const databasePath = path.isAbsolute(config.database?.path || '')
    ? config.database.path
    : path.resolve(process.cwd(), config.database?.path || './data/drama_generator.db');
  const storageRoot = config.storage?.local_path
    ? (path.isAbsolute(config.storage.local_path)
        ? config.storage.local_path
        : path.join(process.cwd(), config.storage.local_path))
    : path.join(process.cwd(), 'data', 'storage');
  const maintenanceGuard = require('./services/dataBackupService').acquireServiceMaintenanceLockSync({
    databasePath,
    storagePath: storageRoot,
    log: logger,
  });
  return initializeWithMaintenanceGuard(maintenanceGuard, () => {
  const db = getDb(config.database);
  const { runMigrationsAndEnsure } = require('./db/migrate.js');
  runMigrationsAndEnsure(db);
  require('./services/skillRegistryService').ensureDefaultSkills(db);

  // 厂商锁定模式：在迁移完成后同步 vendor_lock 配置
  const { applyVendorLock } = require('./services/aiConfigService');
  applyVendorLock(db, logger, config);
  const log = logger;

  const taskService = require('./services/taskService');
  const assetService = require('./services/assetService');
  assetService.cleanupNetworkImportOrphans(db, log, { schedule: false });
  taskService.failOrphanedAsyncTasksOnStartup(db, log);

  const { resumeProcessingVideoGenerations } = require('./services/videoService');
  resumeProcessingVideoGenerations(db, log);
  require('./services/dramaService').recoverInterruptedTrashOperations(db, log);

  const workflowService = require('./services/workflowService');
  workflowService.resumeActiveWorkflowRunsOnStartup(db, log);

  const app = express();
  const originAllowed = createRequestOriginPolicy({
    ...config.server,
    host: process.env.HOST || config.server?.host,
  });
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(createProductionErrorResponseSanitizer());
  app.use(createOriginGuard(originAllowed, log));
  app.use(createCorsMiddleware(originAllowed));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    log.info(req.method, req.path, { request_id: req.requestId });
    next();
  });

  // 静态资源目录：统一转为绝对路径（打包 exe 下相对路径可能解析异常）
  try {
    if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });
    app.use('/static', createStorageStaticMiddleware(storageRoot, log, db));
  } catch (e) {
    console.warn('Static storage mount skipped:', e.message);
  }

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: config.app.name,
      version: config.app.version,
      instance_id: RUNTIME_INSTANCE_ID,
    });
  });

  app.get('/ready', (req, res) => {
    const readiness = require('./services/readinessService').checkReadiness(db, storageRoot, {
      maintenanceGuard,
    });
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      checks: readiness.checks,
    });
  });

  app.use('/api/v1', createBackgroundTaskContextMiddleware(backgroundTasks, log));
  app.use('/api/v1', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const pathname = String(req.path || '');
    const storyboardId = /^\/storyboards\/(\d+)$/.exec(pathname)?.[1];
    const episodeId = /^\/episodes\/(\d+)\/storyboards$/.exec(pathname)?.[1];
    if ((storyboardId && !dramaWriteGuard.canReadResource(db, 'storyboards', storyboardId))
      || (episodeId && !dramaWriteGuard.canReadResource(db, 'episodes', episodeId))) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
    }
    return next();
  });
  app.use('/api/v1', setupRouter(config, db, log));

  // 前端静态资源（sxy：web/dist）；Electron 打包时可设 WEB_DIST_PATH
  const webDist = process.env.WEB_DIST_PATH || path.join(process.cwd(), '..', 'frontweb', 'dist');
  console.log('webDist', webDist);
  if (fs.existsSync(webDist)) {
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    // 服务 dist 根目录的静态文件（如 wx.jpg、favicon.ico 等）
    app.use(express.static(webDist, { index: false }));
    app.get('/favicon.ico', (req, res) => {
      const fav = path.join(webDist, 'favicon.ico');
      if (fs.existsSync(fav)) res.sendFile(fav);
      else res.status(404).end();
    });
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(webDist, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else next();
    });
  } else {
    app.get('/', (req, res) => {
      res.send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LocalMiniDrama</title></head><body>' +
          '<h1>LocalMiniDrama API</h1><p>后端已启动。请先构建前端：</p>' +
          '<pre>cd web &amp;&amp; pnpm install &amp;&amp; pnpm build</pre>' +
          '<p>然后将 <code>web/dist</code> 放到与 backend-node 同级的 <code>web/dist</code>，或访问 <a href="/health">/health</a> 检查接口。</p></body></html>'
      );
    });
  }

  app.use(createNotFoundHandler());

  app.use(createErrorHandler(log));

  const networkCleanupController = assetService.startNetworkImportOrphanCleanup(db, log);
  const closeResources = createAppCloseHandler(maintenanceGuard, closeDb, [
    () => networkCleanupController.close(),
  ]);
  const closeOnExit = () => closeResources();
  process.prependOnceListener('exit', closeOnExit);
  const detachExitClose = () => process.removeListener('exit', closeOnExit);
  const close = () => {
    detachExitClose();
    return closeResources();
  };

  return {
    app,
    config,
    db,
    maintenanceGuard,
    backgroundTasks,
    close,
    detachExitClose,
  };
  }, closeDb);
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  classifyExpectedError,
  createApp,
  createAppCloseHandler,
  createBackgroundTaskContextMiddleware,
  createCorsMiddleware,
  createErrorHandler,
  createNotFoundHandler,
  createOriginGuard,
  createProductionErrorResponseSanitizer,
  createRequestOriginPolicy,
  createStorageStaticMiddleware,
  initializeWithMaintenanceGuard,
  isLoopbackHostname,
  parseHttpOrigin,
  requestContext,
  securityHeaders,
};
