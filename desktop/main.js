const MAX_MAIN_LOG_STRING_LENGTH = 2048;
const REDACTED = '[REDACTED]';
const AUTHORIZATION_LABEL_SOURCE = '(?:(?:proxy[-_ ]?)?authorization|auth(?:orization)?[-_ ]?header)';
const COOKIE_LABEL_SOURCE = '(?:set[-_ ]?cookie|cookie)';
const SECRET_LABEL_SOURCE = '(?:x[-_ ]?api[-_ ]?key|api[-_ ]?key|access[-_ ]?key(?:[-_ ]?id)?|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|passphrase|credential|(?:access|refresh|id|session|csrf|xsrf|auth)[-_ ]?token|token|signature|sig)';
const SENSITIVE_QUERY_KEY_PATTERN = /^(?:auth(?:orization)?|api[-_ ]?key|apikey|key|access[-_ ]?key(?:[-_ ]?id)?|awsaccesskeyid|client[-_ ]?secret|private[-_ ]?key|secret|password|passwd|passphrase|credential|(?:access|refresh|id|session|csrf|xsrf|auth)[-_ ]?token|token|signature|sig|code|cookie|x[-_ ]?amz[-_ ]?(?:signature|credential|security[-_ ]?token)|x[-_ ]?goog[-_ ]?(?:signature|credential))$/i;
const URL_USERINFO_PATTERN = /((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#\s"'<>]*@/gi;
const QUERY_PARAMETER_PATTERN = /([?&#;])([^?&#;=\s"'<>]+)([ \t]*=[ \t]*)["']?([^?&#;\s"'<>]*)/g;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{8,}\b/g;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token|API[-_ ]?Key)\b[ \t]+(?:token[ \t]*=[ \t]*)?(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}"']+)/gi;

function assignmentPatterns(labelSource) {
  const prefix = `(\\b${labelSource}\\b["']?[ \\t]*[:=][ \\t]*)`;
  return {
    doubleQuoted: new RegExp(`${prefix}"(?:\\\\.|[^"\\\\\\r\\n])*"`, 'gi'),
    singleQuoted: new RegExp(`${prefix}'(?:\\\\.|[^'\\\\\\r\\n])*'`, 'gi'),
    unquoted: new RegExp(`${prefix}(?!["'])[^\\s,;}"'&?#]+`, 'gi'),
  };
}

const AUTHORIZATION_PATTERNS = assignmentPatterns(AUTHORIZATION_LABEL_SOURCE);
AUTHORIZATION_PATTERNS.unquoted = new RegExp(
  `(\\b${AUTHORIZATION_LABEL_SOURCE}\\b["']?[ \\t]*[:=][ \\t]*)(?!["'])[^\\r\\n]+`,
  'gi'
);
const COOKIE_PATTERNS = assignmentPatterns(COOKIE_LABEL_SOURCE);
COOKIE_PATTERNS.unquoted = new RegExp(
  `(\\b${COOKIE_LABEL_SOURCE}\\b["']?[ \\t]*[:=][ \\t]*)(?!["'])[^\\r\\n]+`,
  'gi'
);
const SECRET_PATTERNS = assignmentPatterns(SECRET_LABEL_SOURCE);

function redactAssignments(text, patterns) {
  return text
    .replace(patterns.doubleQuoted, `$1"${REDACTED}"`)
    .replace(patterns.singleQuoted, `$1'${REDACTED}'`)
    .replace(patterns.unquoted, `$1${REDACTED}`);
}

function decodeQueryKey(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (_) {
    return value;
  }
}

function redactUrlCredentials(text) {
  const withoutUserinfo = text.replace(URL_USERINFO_PATTERN, '$1');
  return withoutUserinfo.replace(
    QUERY_PARAMETER_PATTERN,
    (match, delimiter, key, equals) => {
      if (!SENSITIVE_QUERY_KEY_PATTERN.test(decodeQueryKey(key))) return match;
      return `${delimiter}${key}${equals}${REDACTED}`;
    }
  );
}

function sanitizeMainLogString(value, maxLength = MAX_MAIN_LOG_STRING_LENGTH) {
  let text = redactUrlCredentials(String(value ?? ''));
  text = redactAssignments(text, AUTHORIZATION_PATTERNS);
  text = text.replace(AUTH_SCHEME_PATTERN, (_match, scheme) => `${scheme} ${REDACTED}`);
  text = redactAssignments(text, COOKIE_PATTERNS);
  text = redactAssignments(text, SECRET_PATTERNS);
  text = text.replace(JWT_PATTERN, REDACTED);
  text = text.replace(/\bsk-[A-Za-z0-9._-]{6,}\b/gi, REDACTED);
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
  }
  return text;
}

function summarizeExternalUrl(value) {
  const raw = String(value ?? '');
  const protocolRelative = raw.startsWith('//');
  const relative = !protocolRelative && /^(?:\/|\.\.?\/)/.test(raw);
  try {
    const parsed = new URL(
      protocolRelative ? `https:${raw}` : raw,
      relative ? 'https://local.invalid/' : undefined
    );
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '[disallowed-url]';
    const pathSummary = parsed.pathname || '/';
    if (relative) return sanitizeMainLogString(pathSummary, 1024);
    if (protocolRelative) return sanitizeMainLogString(`//${parsed.host}${pathSummary}`, 1024);
    return sanitizeMainLogString(`${parsed.origin}${pathSummary}`, 1024);
  } catch (_) {
    return '[invalid-url]';
  }
}

const { app, BrowserWindow, Menu, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const IMPORT_IMAGE_VALIDATOR_FLAG = '--localminidrama-import-image-validator';
const importImageValidatorIndex = process.argv.indexOf(IMPORT_IMAGE_VALIDATOR_FLAG);

if (importImageValidatorIndex >= 0) {
  const backendRoot = app.isPackaged
    ? path.join(__dirname, 'backend-app')
    : path.join(__dirname, '..', 'backend-node');
  const { runImportImageValidatorCli } = require(
    path.join(backendRoot, 'src', 'services', 'importImageValidator.js')
  );
  runImportImageValidatorCli(process.argv.slice(importImageValidatorIndex + 1)).then(
    (exitCode) => app.exit(exitCode),
    (error) => {
      process.stderr.write(`${sanitizeMainLogString(error && error.stack ? error.stack : error)}\n`);
      app.exit(1);
    }
  );
} else {
const {
  migrateLegacyUserData,
  resolveDesktopUserDataDir,
} = require('./scripts/user-data-migration');

// Keep development data separate from installed application data.
const APP_DATA_DIR = app.getPath('appData');
const USERDATA_DIR = resolveDesktopUserDataDir({
  appDataDir: APP_DATA_DIR,
  isPackaged: app.isPackaged,
  environment: process.env,
});
const LEGACY_USERDATA_DIR = process.env.LOCALMINIDRAMA_USER_DATA_DIR &&
  process.env.LOCALMINIDRAMA_LEGACY_USER_DATA_DIR
  ? path.resolve(process.env.LOCALMINIDRAMA_LEGACY_USER_DATA_DIR)
  : undefined;
const SHOULD_MIGRATE_LEGACY_USER_DATA = app.isPackaged || Boolean(LEGACY_USERDATA_DIR);

// This must run before any logger or Electron API can create the new userData directory.
const legacyUserDataMigration = migrateLegacyUserData({
  appDataDir: APP_DATA_DIR,
  userDataDir: USERDATA_DIR,
  legacyUserDataDir: LEGACY_USERDATA_DIR,
  enabled: SHOULD_MIGRATE_LEGACY_USER_DATA,
});
app.setPath('userData', USERDATA_DIR);

const MAIN_STARTUP_LOG = path.join(USERDATA_DIR, 'main-startup.log');
function writeMainLog(msg) {
  const line = `${new Date().toISOString()} ${sanitizeMainLogString(msg)}\n`;
  try {
    if (!fs.existsSync(USERDATA_DIR)) fs.mkdirSync(USERDATA_DIR, { recursive: true });
    fs.appendFileSync(MAIN_STARTUP_LOG, line);
  } catch (_) {}
}

let mainWindow = null;
const { acquireSingleInstanceLock } = require('./scripts/single-instance');
const hasSingleInstanceLock = acquireSingleInstanceLock(app, () => mainWindow, writeMainLog);

process.on('uncaughtException', (err) => {
  writeMainLog(`uncaughtException: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (reason) => {
  const text = reason instanceof Error ? reason.stack : String(reason);
  writeMainLog(`unhandledRejection: ${text}`);
});

writeMainLog(
  `main.js loaded pid=${process.pid} primary=${hasSingleInstanceLock} packaged=${app.isPackaged} ` +
  `appData=${APP_DATA_DIR} userData=${USERDATA_DIR} migration=${legacyUserDataMigration.reason} ` +
  `exec=${process.execPath}`
);
if (legacyUserDataMigration.migrated) {
  writeMainLog(
    `migrated legacy userData directory source=${legacyUserDataMigration.source} ` +
    `destination=${legacyUserDataMigration.destination}`
  );
} else if (legacyUserDataMigration.reason === 'rename-failed') {
  writeMainLog(
    `legacy userData migration failed source=${legacyUserDataMigration.source} ` +
    `destination=${legacyUserDataMigration.destination} error=${legacyUserDataMigration.error.message}`
  );
}

const {
  isAllowedExternalUrl,
  isAllowedRendererPermission,
  isTrustedAppUrl,
} = require('./scripts/url-security');
const { createShutdownController } = require('./scripts/shutdown-controller');
const {
  WINDOW_STATE_FILE_NAME,
  buildStartupFailureDialogMessage,
  createRendererRecoveryController,
  createStartupFailureController,
  createWindowStateController,
  describeRendererFailure,
} = require('./scripts/window-shell');

const shutdownController = hasSingleInstanceLock
  ? createShutdownController({ app, log: writeMainLog })
  : null;
if (shutdownController) {
  app.on('before-quit', (event) => shutdownController.handleBeforeQuit(event));
}

const startupFailureController = hasSingleInstanceLock
  ? createStartupFailureController({
      dialog,
      log: writeMainLog,
      relaunchApp: () => {
        if (typeof app.relaunch === 'function') app.relaunch();
        return shutdownController.requestShutdown('startup-failure-relaunch', 1);
      },
      requestQuit: () => shutdownController.requestShutdown('startup-failure', 1),
    })
  : null;

const BACKEND_APP_PATH = path.join(__dirname, 'backend-app');
const BACKEND_NODE_PATH = path.join(__dirname, '..', 'backend-node');
const DEFAULT_PORT = 5679;

/** 开发模式用 backend-node（改代码即生效）；打包后用 backend-app */
function getBackendModulePath() {
  if (app.isPackaged) return BACKEND_APP_PATH;
  // Electron 开发模式必须用 backend-app：require 会向上解析到 desktop/node_modules，
  // 其中 better-sqlite3 已由 postinstall 的 electron-builder install-app-deps 对准当前 Electron ABI。
  // 若直接用 backend-node，则会加载 backend-node/node_modules（多为本机 Node 编的 ABI，必炸）。
  if (process.versions.electron && fs.existsSync(path.join(BACKEND_APP_PATH, 'src', 'app.js'))) {
    return BACKEND_APP_PATH;
  }
  return fs.existsSync(BACKEND_NODE_PATH) ? BACKEND_NODE_PATH : BACKEND_APP_PATH;
}

function getBackendCwd() {
  return path.join(app.getPath('userData'), 'backend');
}

function ensureBackendCwd(backendCwd) {
  if (!fs.existsSync(backendCwd)) {
    fs.mkdirSync(backendCwd, { recursive: true });
  }
  const configsDir = path.join(backendCwd, 'configs');
  const dataDir = path.join(backendCwd, 'data');
  const logsDir = path.join(backendCwd, 'logs');
  const configPath = path.join(configsDir, 'config.yaml');

  if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  // 首次安装时，从打包内置的 config.yaml 复制到用户数据目录
  const bundledConfig = path.join(getBackendModulePath(), 'configs', 'config.yaml');
  if (!fs.existsSync(configPath) && fs.existsSync(bundledConfig)) {
    fs.copyFileSync(bundledConfig, configPath);
  }

  // 每次启动时，将内置 config.yaml 中的 vendor_lock 节强制同步到用户 config.yaml，
  // 确保打包时配置的锁定策略对所有用户生效，不受首次安装后遗留旧配置影响。
  if (fs.existsSync(bundledConfig) && fs.existsSync(configPath)) {
    try {
      const yaml = require('js-yaml');
      const userCfg = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      const bundledCfg = yaml.load(fs.readFileSync(bundledConfig, 'utf8')) || {};
      if (bundledCfg.vendor_lock !== undefined) {
        userCfg.vendor_lock = bundledCfg.vendor_lock;
        fs.writeFileSync(configPath, yaml.dump(userCfg, { lineWidth: -1 }), 'utf8');
      }
    } catch (e) {
      console.warn(
        '[config] Failed to sync vendor_lock from bundled config:',
        sanitizeMainLogString(e.message)
      );
    }
  }
}

/**
 * 首次启动时，将打包内置的 ffmpeg 自动复制到 userData/backend/tools/ffmpeg/。
 * 来源：process.resourcesPath/ffmpeg/（由 electron-builder extraResources 写入）。
 * 已存在则跳过，不会重复覆盖，也不影响用户手动替换版本。
 */
function ensureFfmpeg(backendCwd) {
  if (!app.isPackaged) return;
  const isWin = process.platform === 'win32';
  const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe';

  const destDir = path.join(backendCwd, 'tools', 'ffmpeg');
  const srcDir = path.join(process.resourcesPath, 'ffmpeg');

  for (const name of [ffmpegName, ffprobeName]) {
    const destination = path.join(destDir, name);
    if (fs.existsSync(destination)) {
      console.log(`[ffmpeg] ${name} already exists at`, destination);
      continue;
    }

    const source = path.join(srcDir, name);
    if (!fs.existsSync(source)) {
      console.warn(`[ffmpeg] Bundled ${name} not found. Expected:`, source);
      continue;
    }

    try {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(source, destination);
      if (!isWin) fs.chmodSync(destination, 0o755);
      console.log(`[ffmpeg] Auto-extracted ${name} to`, destination);
    } catch (e) {
      console.warn(
        `[ffmpeg] Failed to auto-extract ${name}:`,
        sanitizeMainLogString(e.message)
      );
    }
  }
}

function getWebDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontweb', 'dist');
  }
  return path.join(__dirname, '..', 'frontweb', 'dist');
}

/**
 * 探测端口是否空闲：优先使用 preferredPort，被占用时让 OS 分配一个随机空闲端口。
 * 返回最终可用的端口号。
 */
function findFreePort(preferredPort) {
  const net = require('net');
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      // 首选端口被占，让 OS 随机分配
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferredPort, '127.0.0.1', () => {
      probe.close(() => resolve(preferredPort));
    });
  });
}

function createWindow(port) {
  Menu.setApplicationMenu(null);
  const windowState = createWindowStateController({
    filePath: path.join(app.getPath('userData'), WINDOW_STATE_FILE_NAME),
    getDisplays: () => (
      typeof screen.getAllDisplays === 'function'
        ? screen.getAllDisplays()
        : [screen.getPrimaryDisplay()]
    ),
    getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    log: writeMainLog,
  });
  const restored = windowState.restoreBounds();
  const initialBounds = {
    x: restored.x,
    y: restored.y,
    width: restored.width,
    height: restored.height,
  };
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: Math.min(1024, initialBounds.width),
    minHeight: Math.min(640, initialBounds.height),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
    show: false,
  });
  mainWindow = win;
  if (restored.isMaximized && typeof win.maximize === 'function') {
    win.maximize();
  }
  const persistWindowState = () => windowState.persist();
  win.on('moved', () => windowState.persistSoon());
  win.on('resized', () => windowState.persistSoon());
  win.on('maximize', persistWindowState);
  win.on('unmaximize', persistWindowState);
  const onDisplayChange = () => windowState.handleDisplayChange();
  if (screen && typeof screen.on === 'function') {
    screen.on('display-metrics-changed', onDisplayChange);
  }
  const recoveryController = createRendererRecoveryController({
    dialog,
    getWindow: () => mainWindow === win ? mainWindow : null,
    log: writeMainLog,
    reloadWindow: ({ trigger }) => {
      if (win.isDestroyed()) return null;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      writeMainLog(`renderer recovery reload requested trigger=${trigger}`);
      win.focus();
      win.webContents.reloadIgnoringCache();
      return null;
    },
    requestQuit: ({ trigger }) => {
      writeMainLog(`renderer recovery quit requested trigger=${trigger}`);
      return shutdownController.requestShutdown(`renderer-recovery-${trigger}`, 1);
    },
  });

  let rendererLoaded = false;
  let windowReady = false;
  let readinessLogged = false;
  const reportWindowRendererReady = () => {
    if (readinessLogged || !rendererLoaded || !windowReady) return;
    readinessLogged = true;
    writeMainLog('window-renderer ready');
  };

  const openExternal = (url) => {
    if (!isAllowedExternalUrl(url)) return;
    shell.openExternal(url).catch((err) => {
      const errorTypeCandidate = String(err && (err.code || err.name) || 'unknown');
      const errorType = /^[A-Za-z0-9_.-]{1,64}$/.test(errorTypeCandidate)
        ? errorTypeCandidate
        : 'unknown';
      writeMainLog(`openExternal failed target=${summarizeExternalUrl(url)} error=${errorType}`);
    });
  };
  const guardNavigation = (event, url) => {
    if (isTrustedAppUrl(url, port)) return;
    event.preventDefault();
    openExternal(url);
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const appSession = win.webContents.session;
  const canUsePermission = (webContents, permission, url, details) =>
    webContents === win.webContents &&
    isAllowedRendererPermission(permission, url, port, details && details.isMainFrame);
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(canUsePermission(webContents, permission, details.requestingUrl, details));
  });
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    canUsePermission(
      webContents,
      permission,
      details.requestingUrl || requestingOrigin,
      details
    )
  );
  if (typeof appSession.setDevicePermissionHandler === 'function') {
    appSession.setDevicePermissionHandler(() => false);
  }

  win.webContents.on('did-finish-load', () => {
    rendererLoaded = true;
    reportWindowRendererReady();
  });
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    const mainFrame = isMainFrame !== false;
    writeMainLog(`did-fail-load code=${code} mainFrame=${mainFrame}`);
    if (!mainFrame || code === -3) return;
    recoveryController.handleFailure(
      'did-fail-load',
      describeRendererFailure('did-fail-load', { code, description })
    );
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason ? details.reason : 'unknown';
    const exitCode = details && Number.isInteger(details.exitCode) ? details.exitCode : 'unknown';
    writeMainLog(`renderer error render-process-gone reason=${reason} exitCode=${exitCode}`);
    recoveryController.handleFailure(
      'render-process-gone',
      describeRendererFailure('render-process-gone', details)
    );
  });
  win.webContents.on('console-message', (_event, detailsOrLevel) => {
    const level = detailsOrLevel && typeof detailsOrLevel === 'object'
      ? detailsOrLevel.level
      : detailsOrLevel;
    if (level === 'error' || level === 3) writeMainLog('renderer error console-message');
  });
  win.on('unresponsive', () => {
    writeMainLog('renderer error unresponsive');
    recoveryController.handleFailure(
      'unresponsive',
      describeRendererFailure('unresponsive')
    );
  });

  win.once('ready-to-show', () => {
    windowReady = true;
    win.show();
    writeMainLog('window ready-to-show');
    reportWindowRendererReady();
  });
  // 若页面长期不触发 ready-to-show，避免用户误以为“点了没反应”
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      writeMainLog('window shown (fallback timeout, check page load)');
    }
  }, 8000);
  writeMainLog(`createWindow loadURL http://127.0.0.1:${port}`);
  win.loadURL(`http://127.0.0.1:${port}`);
  win.on('close', (event) => {
    persistWindowState();
    shutdownController.handleWindowClose(event);
  });
  win.on('closed', () => {
    if (screen && typeof screen.removeListener === 'function') {
      screen.removeListener('display-metrics-changed', onDisplayChange);
    }
    if (mainWindow === win) mainWindow = null;
  });
  if (process.env.LOCALMINIDRAMA_DEVTOOLS === '1') {
    win.webContents.openDevTools();
  }
}

/** 后端始终在主进程内运行（打包用子进程会重复启动 exe 导致大量进程，故取消） */
async function startBackend() {
  const backendCwd = getBackendCwd();
  ensureBackendCwd(backendCwd);
  ensureFfmpeg(backendCwd);
  process.env.WEB_DIST_PATH = getWebDistPath();
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production';
    process.env.LOG_FILE = path.join(backendCwd, 'logs', 'app.log');
    process.env.EXAMPLE_DRAMA_PATH = path.join(process.resourcesPath, 'example_drama');
  } else {
    process.env.EXAMPLE_DRAMA_PATH = path.join(__dirname, '..', 'example_drama');
  }
  process.chdir(backendCwd);

  const backendModulePath = getBackendModulePath();
  try {
    require(path.join(backendModulePath, 'src', 'db', 'migrate.js'));
  } catch (err) {
    console.warn('Migration warning:', sanitizeMainLogString(err.message));
  }

  const { createApp } = require(path.join(backendModulePath, 'src', 'app.js'));
  const { createServer } = require('http');
  const backendResources = createApp();
  shutdownController.setBackendResources(backendResources);
  const { app: expressApp, config } = backendResources;
  const preferredPort = config.server?.port || DEFAULT_PORT;

  // 自动探测空闲端口：优先默认端口，被其他应用占用时由 OS 分配。
  const port = await findFreePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} in use, using ${port}`);
  }
  if (shutdownController.isShutdownRequested()) return null;

  return new Promise((resolve, reject) => {
    const server = createServer(expressApp);
    shutdownController.setHttpServer(server);
    let startupSettled = false;
    server.on('error', (error) => {
      if (!startupSettled) {
        startupSettled = true;
        reject(error);
        return;
      }
      writeMainLog(`HTTP server error after startup: ${error.stack || error}`);
      shutdownController.requestShutdown('http-server-error', 1);
    });
    server.listen(port, '127.0.0.1', () => {
      if (startupSettled) return;
      startupSettled = true;
      console.log('Backend listening on', port);
      resolve(shutdownController.isShutdownRequested() ? null : port);
    });
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  writeMainLog('app.whenReady');
  let port;
  try {
    port = await startBackend();
    if (port === null || shutdownController.isShutdownRequested()) return;
    writeMainLog(`startBackend ok port=${port}`);
  } catch (err) {
    if (shutdownController.isShutdownRequested()) return;
    const stack = err && err.stack ? err.stack : String(err);
    writeMainLog(`Failed to start backend\n${stack}`);
    console.error('Failed to start backend', sanitizeMainLogString(stack));
    await startupFailureController.handleFailure({
      message: buildStartupFailureDialogMessage(MAIN_STARTUP_LOG, err, sanitizeMainLogString),
    });
    return;
  }
  // startBackend 的 Promise 在 listen 回调中 resolve，服务器此时已就绪，直接建窗口
  createWindow(port);
});
}
