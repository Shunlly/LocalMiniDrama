'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { removeFixtureTree } = require('./fixture-fs');
const {
  DEFAULT_WINDOW_SIZE,
  RECOVERY_COOLDOWN_MS,
  WINDOW_STATE_FILE_NAME,
  buildStartupFailureDialogMessage,
  createRendererRecoveryController,
  createStartupFailureController,
  createWindowStateController,
  describeRendererFailure,
  getInitialWindowBounds,
  readWindowState,
  resolveWindowBounds,
  writeWindowState,
} = require('../scripts/window-shell');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function loadMainLogHelpers() {
  const electronImport = mainSource.indexOf(
    "const { app, BrowserWindow, Menu, dialog, screen, shell } = require('electron');"
  );
  assert.notEqual(electronImport, -1);
  const context = { URL };
  vm.runInNewContext(
    `${mainSource.slice(0, electronImport)}\nthis.helpers = { sanitizeMainLogString, summarizeExternalUrl };`,
    context
  );
  return context.helpers;
}

const { sanitizeMainLogString, summarizeExternalUrl } = loadMainLogHelpers();

test('main log redaction covers credentials, cookies, JWTs, and non-absolute URLs', () => {
  const jwt = [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiJzeW50aGV0aWMifQ',
    'syntheticDesktopSignature',
  ].join('.');
  const sanitized = sanitizeMainLogString([
    'Authorization: Bearer synthetic-desktop-bearer',
    'Authorization=Basic c3ludGhldGljOmRlc2t0b3A=',
    'Authorization: Token token="synthetic-desktop-token"',
    'Authorization: API-Key synthetic-desktop-auth-key',
    'X-API-Key: synthetic-desktop-api-key',
    'Cookie: session=synthetic-desktop-cookie',
    'Set-Cookie: sid=synthetic-desktop-set-cookie; Path=/',
    `jwt=${jwt}`,
    'absolute=https://synthetic-user:synthetic-pass@example.test/path?access_token=synthetic-desktop-access&safe=visible',
    'protocol=//synthetic-user:synthetic-pass@cdn.example.test/asset?sig=synthetic-desktop-signature&width=100',
    'relative=/callback?api%5Fkey=synthetic-desktop-query&page=2',
  ].join('\n'));

  for (const marker of [
    'synthetic-desktop-bearer',
    'c3ludGhldGljOmRlc2t0b3A=',
    'synthetic-desktop-token',
    'synthetic-desktop-auth-key',
    'synthetic-desktop-api-key',
    'synthetic-desktop-cookie',
    'synthetic-desktop-set-cookie',
    jwt,
    'synthetic-user',
    'synthetic-pass',
    'synthetic-desktop-access',
    'synthetic-desktop-signature',
    'synthetic-desktop-query',
  ]) {
    assert.equal(sanitized.includes(marker), false, `desktop log leaked ${marker}`);
  }
  assert.match(sanitized, /https:\/\/example\.test\/path\?access_token=\[REDACTED\]/);
  assert.match(sanitized, /\/\/cdn\.example\.test\/asset\?sig=\[REDACTED\]/);
  assert.match(sanitized, /\/callback\?api%5Fkey=\[REDACTED\]&page=2/);
});

test('startup failure dialog uses Chinese reasons and omits raw secrets', () => {
  const jwt = [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiJzdGFydHVwLWRpYWxvZyJ9',
    'syntheticStartupSignature',
  ].join('.');
  const secrets = [
    'synthetic-startup-bearer',
    'synthetic-url-user',
    'synthetic-url-password',
    'synthetic-query-secret',
    'synthetic-custom-authorization',
    'synthetic-startup-cookie',
    jwt,
    'sk-syntheticStartupSecret',
  ];
  const secretError = new Error([
    `Bearer ${secrets[0]}`,
    `https://${secrets[1]}:${secrets[2]}@example.test/start?access_token=${secrets[3]}`,
    `X-Custom-Authorization: ${secrets[4]}`,
    `Cookie: session=${secrets[5]}`,
    jwt,
    secrets[7],
  ].join('\n'));
  const logPath = 'C:\\Users\\synthetic\\LocalMiniDrama\\logs\\main.log';
  const occupied = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:5679'), {
    code: 'EADDRINUSE',
  });
  const occupiedMessage = buildStartupFailureDialogMessage(logPath, occupied, sanitizeMainLogString);
  const secretMessage = buildStartupFailureDialogMessage(logPath, secretError, sanitizeMainLogString);

  for (const secret of secrets) {
    assert.equal(secretMessage.includes(secret), false, `startup dialog leaked ${secret}`);
  }
  assert.match(occupiedMessage, /后端服务未能启动/);
  assert.match(occupiedMessage, /本地服务端口已被占用/);
  assert.doesNotMatch(occupiedMessage, /EADDRINUSE|address already in use/);
  assert.ok(occupiedMessage.includes(logPath));
  assert.match(secretMessage, /请查看日志了解详细原因/);
  assert.doesNotMatch(secretMessage, /Bearer |https:\/\/synthetic-url-user/);
  assert.doesNotMatch(mainSource, /showErrorBox\(/);
  assert.match(mainSource, /startupFailureController\.handleFailure\(/);
  assert.match(mainSource, /buildStartupFailureDialogMessage\(MAIN_STARTUP_LOG, err, sanitizeMainLogString\)/);
});

test('external-link failure logs retain only a safe origin/path summary', () => {
  const sensitiveUrl =
    'https://synthetic-user:synthetic-pass@docs.example.test/guide/page?access_token=synthetic-external-token&next=/private#synthetic-fragment';

  assert.equal(
    summarizeExternalUrl(sensitiveUrl),
    'https://docs.example.test/guide/page'
  );
  assert.equal(
    summarizeExternalUrl(
      '//synthetic-user:synthetic-pass@cdn.example.test/asset?signature=synthetic-signature'
    ),
    '//cdn.example.test/asset'
  );
  assert.equal(
    summarizeExternalUrl('/callback?token=synthetic-relative-token#synthetic-fragment'),
    '/callback'
  );
  assert.match(
    mainSource,
    /openExternal failed target=\$\{summarizeExternalUrl\(url\)\} error=\$\{errorType\}/
  );
  assert.doesNotMatch(mainSource, /openExternal failed[^`\r\n]*\$\{url\}/);
  assert.doesNotMatch(mainSource, /openExternal failed[^`\r\n]*err\.message/);
});
test('legacy userData migration runs before Electron selects the new directory', () => {
  const migrate = mainSource.indexOf('const legacyUserDataMigration = migrateLegacyUserData({');
  const setPath = mainSource.indexOf("app.setPath('userData', USERDATA_DIR);");

  assert.notEqual(migrate, -1);
  assert.ok(setPath > migrate);
  assert.doesNotMatch(mainSource, /function migrateOldUserData/);
  assert.match(
    mainSource,
    /process\.env\.LOCALMINIDRAMA_USER_DATA_DIR\s*&&\s*\n\s*process\.env\.LOCALMINIDRAMA_LEGACY_USER_DATA_DIR/
  );
});
test('main process resolves isolated development and packaged userData before migration', () => {
  assert.match(
    mainSource,
    /resolveDesktopUserDataDir\(\{\s*appDataDir: APP_DATA_DIR,\s*isPackaged: app\.isPackaged,\s*environment: process\.env,?\s*\}\)/
  );
  assert.match(
    mainSource,
    /const SHOULD_MIGRATE_LEGACY_USER_DATA\s*=\s*app\.isPackaged\s*\|\|\s*Boolean\(LEGACY_USERDATA_DIR\)/
  );
});
test('development and packaged backends keep mutable data under stable userData', () => {
  const start = mainSource.indexOf('function getBackendCwd()');
  const end = mainSource.indexOf('\nfunction ensureBackendCwd(', start);
  const implementation = mainSource.slice(start, end);

  assert.notEqual(start, -1);
  assert.match(implementation, /return path\.join\(app\.getPath\('userData'\), 'backend'\)/);
  assert.doesNotMatch(implementation, /app\.isPackaged|getBackendModulePath\(\)/);
});
test('main process registers complete createApp resources before asynchronous startup work', () => {
  const createResources = mainSource.indexOf('const backendResources = createApp();');
  const registerResources = mainSource.indexOf(
    'shutdownController.setBackendResources(backendResources);'
  );
  const findPort = mainSource.indexOf('await findFreePort(preferredPort)');

  assert.notEqual(createResources, -1);
  assert.ok(registerResources > createResources);
  assert.ok(findPort > registerResources);
  assert.doesNotMatch(mainSource, /let serverInstance\s*=/);
});
test('window and Electron quit events delegate to the async shutdown controller', () => {
  assert.match(
    mainSource,
    /app\.on\(['"]before-quit['"], \(event\) => shutdownController\.handleBeforeQuit\(event\)\)/
  );
  assert.match(
    mainSource,
    /win\.on\(['"]close['"], \(event\) => \{[\s\S]*persistWindowState\(\);[\s\S]*shutdownController\.handleWindowClose\(event\)/
  );
  assert.doesNotMatch(mainSource, /win\.on\(['"]closed['"][\s\S]{0,160}app\.quit\(\)/);
});
test('startup failure uses the same failure-status graceful shutdown path', () => {
  assert.match(
    mainSource,
    /requestShutdown\(['"]startup-failure['"], 1\)/
  );
  assert.match(
    mainSource,
    /requestShutdown\(['"]startup-failure-relaunch['"], 1\)/
  );
  assert.doesNotMatch(mainSource, /serverInstance\.close\(/);
});
test('desktop shell constrains the initial window to 1366x768 inside the current work area', () => {
  assert.deepEqual(
    getInitialWindowBounds({ workArea: { x: 10, y: 20, width: 1920, height: 1080 } }),
    {
      width: DEFAULT_WINDOW_SIZE.width,
      height: DEFAULT_WINDOW_SIZE.height,
      x: 287,
      y: 176,
    }
  );
  assert.deepEqual(
    getInitialWindowBounds({ workArea: { x: 0, y: 0, width: 1280, height: 720 } }),
    {
      width: 1280,
      height: 720,
      x: 0,
      y: 0,
    }
  );
});
test('renderer recovery dialog coalesces concurrent failures and reloads once', async () => {
  let resolveDialog;
  const dialogCalls = [];
  const reloadCalls = [];
  const recovery = createRendererRecoveryController({
    dialog: {
      showMessageBox(windowRef, options) {
        dialogCalls.push({ windowRef, options });
        return new Promise((resolve) => {
          resolveDialog = resolve;
        });
      },
    },
    getWindow: () => ({
      isDestroyed: () => false,
    }),
    reloadWindow: (payload) => reloadCalls.push(payload),
    requestQuit: () => assert.fail('quit should not be requested'),
  });

  const first = recovery.handleFailure('did-fail-load', 'load failed');
  const second = recovery.handleFailure('render-process-gone', 'crashed');

  assert.equal(dialogCalls.length, 1);
  assert.equal(recovery.getState().promptActive, true);

  resolveDialog({ response: 0 });
  await Promise.all([first, second]);
  await Promise.resolve();

  assert.equal(dialogCalls[0].options.buttons[0], '重新加载');
  assert.deepEqual(reloadCalls, [{ trigger: 'did-fail-load', detail: 'load failed' }]);
  assert.equal(recovery.getState().promptActive, false);
});
test('renderer recovery can exit and suppress repeat failures during cooldown', async () => {
  const quitCalls = [];
  const dialogCalls = [];
  let now = 5_000;
  const recovery = createRendererRecoveryController({
    cooldownMs: RECOVERY_COOLDOWN_MS,
    dialog: {
      showMessageBox() {
        dialogCalls.push('show');
        return Promise.resolve({ response: 1 });
      },
    },
    getWindow: () => ({
      isDestroyed: () => false,
    }),
    nowFn: () => now,
    reloadWindow: () => assert.fail('reload should not be requested'),
    requestQuit: (payload) => quitCalls.push(payload),
  });

  const firstResult = await recovery.handleFailure('unresponsive', 'hung');
  await Promise.resolve();
  assert.deepEqual(quitCalls, [{ trigger: 'unresponsive', detail: 'hung' }]);
  assert.equal(firstResult, 1);
  assert.equal(dialogCalls.length, 1);

  now += RECOVERY_COOLDOWN_MS - 1;
  assert.equal(await recovery.handleFailure('did-fail-load', 'repeat'), null);
  assert.equal(dialogCalls.length, 1);

  now += 1;
  await recovery.handleFailure('did-fail-load', 'retry');
  assert.equal(dialogCalls.length, 2);
});

test('main process wires recovery handling and restored bounds through helpers', () => {
  assert.match(mainSource, /const restored = windowState\.restoreBounds\(\)/);
  assert.match(mainSource, /minWidth: Math\.min\(1024, initialBounds\.width\)/);
  assert.match(mainSource, /minHeight: Math\.min\(640, initialBounds\.height\)/);
  assert.match(mainSource, /const recoveryController = createRendererRecoveryController\(/);
  assert.match(mainSource, /describeRendererFailure\('did-fail-load'/);
  assert.match(mainSource, /describeRendererFailure\('render-process-gone'/);
  assert.match(mainSource, /describeRendererFailure\('unresponsive'\)/);
  assert.match(mainSource, /persistWindowState\(\)/);
  assert.match(mainSource, /display-metrics-changed/);
});

test('packaged image validation bypasses user data and single-instance startup', () => {
  const helperDispatch = mainSource.indexOf('runImportImageValidatorCli');
  const userDataResolution = mainSource.indexOf('resolveDesktopUserDataDir({');
  const singleInstanceLock = mainSource.indexOf('acquireSingleInstanceLock(app');

  assert.ok(helperDispatch >= 0, 'main process must expose the fixed image validator helper mode');
  assert.ok(helperDispatch < userDataResolution, 'helper mode must run before user data initialization');
  assert.ok(helperDispatch < singleInstanceLock, 'helper mode must run before the single-instance lock');
  assert.match(mainSource, /--localminidrama-import-image-validator/);
});

test('startup failure can relaunch instead of permanently exiting', async () => {
  const actions = [];
  const dialogCalls = [];
  const controller = createStartupFailureController({
    dialog: {
      showMessageBox(options) {
        dialogCalls.push(options);
        return Promise.resolve({ response: 0 });
      },
    },
    relaunchApp: async () => actions.push('relaunch'),
    requestQuit: async () => actions.push('quit'),
  });

  assert.equal(await controller.handleFailure({ message: '后端服务未能启动。' }), 'relaunch');
  assert.deepEqual(actions, ['relaunch']);
  assert.equal(dialogCalls[0].title, '本地短剧助手启动失败');
  assert.deepEqual(dialogCalls[0].buttons, ['重新启动', '退出']);
});

test('startup failure quits when relaunch is declined or the dialog fails', async () => {
  const quitOnly = createStartupFailureController({
    dialog: {
      showMessageBox() {
        return Promise.resolve({ response: 1 });
      },
    },
    relaunchApp: async () => assert.fail('relaunch should not be requested'),
    requestQuit: async () => 'quit-call',
  });
  assert.equal(await quitOnly.handleFailure({ message: '后端服务未能启动。' }), 'quit');

  const failedDialog = createStartupFailureController({
    dialog: {
      showMessageBox() {
        return Promise.reject(new Error('dialog backend unavailable'));
      },
    },
    relaunchApp: async () => assert.fail('relaunch should not be requested'),
    requestQuit: async () => 'quit-after-dialog-error',
  });
  assert.equal(await failedDialog.handleFailure({ message: '后端服务未能启动。' }), 'quit');

  const relaunchFailed = createStartupFailureController({
    dialog: {
      showMessageBox() {
        return Promise.resolve({ response: 0 });
      },
    },
    relaunchApp: async () => {
      throw new Error('relaunch unavailable');
    },
    requestQuit: async () => 'quit-after-relaunch-error',
  });
  assert.equal(await relaunchFailed.handleFailure({ message: '后端服务未能启动。' }), 'quit');
});

test('renderer recovery reveals a hidden window before asking the user', async () => {
  const calls = [];
  const recovery = createRendererRecoveryController({
    dialog: {
      showMessageBox(windowRef) {
        calls.push(['dialog', windowRef.visible, windowRef.minimized]);
        return Promise.resolve({ response: 0 });
      },
    },
    getWindow: () => ({
      isDestroyed: () => false,
      isMinimized: () => true,
      isVisible: () => false,
      restore() {
        this.minimized = false;
        calls.push('restore');
      },
      show() {
        this.visible = true;
        calls.push('show');
      },
      minimized: true,
      visible: false,
    }),
    reloadWindow: (payload) => calls.push(['reload', payload.trigger]),
    requestQuit: () => assert.fail('quit should not be requested'),
  });

  await recovery.handleFailure('did-fail-load', describeRendererFailure('did-fail-load', {
    code: -102,
    description: 'ERR_CONNECTION_REFUSED',
  }));

  assert.deepEqual(calls.slice(0, 3), ['restore', 'show', ['dialog', true, false]]);
  assert.equal(calls.at(-1)[0], 'reload');
});

test('renderer failure details stay in Chinese and drop Chromium English text', () => {
  assert.equal(
    describeRendererFailure('did-fail-load', { code: -102, description: 'ERR_CONNECTION_REFUSED' }),
    '无法连接到本地服务，页面加载失败。'
  );
  assert.equal(
    describeRendererFailure('render-process-gone', { reason: 'crashed', exitCode: 1 }),
    '渲染进程崩溃。'
  );
  assert.doesNotMatch(
    describeRendererFailure('did-fail-load', { code: -7, description: 'ERR_TIMED_OUT' }),
    /ERR_|unknown|crashed/
  );
});

test('window bounds restore saved work-area geometry and clamp off-screen windows', (t) => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 1920, y: 0, width: 1280, height: 800 } },
  ];
  assert.deepEqual(
    resolveWindowBounds(displays, { x: 2000, y: 40, width: 1100, height: 700, isMaximized: true }),
    { x: 2000, y: 40, width: 1100, height: 700, isMaximized: true }
  );
  assert.deepEqual(
    resolveWindowBounds(displays, { x: 8000, y: -400, width: 1400, height: 900, isMaximized: true }),
    { x: 520, y: 0, width: 1400, height: 900, isMaximized: false }
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-window-state-'));
  t.after(() => removeFixtureTree(root));
  const filePath = path.join(root, WINDOW_STATE_FILE_NAME);
  assert.equal(readWindowState(filePath), null);
  assert.equal(writeWindowState(filePath, { x: 48, y: 64, width: 1280, height: 720, isMaximized: true }), true);
  assert.deepEqual(readWindowState(filePath), {
    x: 48,
    y: 64,
    width: 1280,
    height: 720,
    isMaximized: true,
  });
  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.equal(readWindowState(filePath), null);
});

test('window state controller persists restored bounds and recenters after display loss', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-window-controller-'));
  t.after(() => removeFixtureTree(root));
  const filePath = path.join(root, WINDOW_STATE_FILE_NAME);
  let bounds = { x: 80, y: 90, width: 1200, height: 700 };
  const win = {
    isDestroyed: () => false,
    isMaximized: () => false,
    isMinimized: () => false,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds(next) {
      bounds = { ...next };
    },
  };
  const controller = createWindowStateController({
    filePath,
    getDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getWindow: () => win,
  });

  assert.deepEqual(controller.restoreBounds(), {
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    x: 277,
    y: 156,
    isMaximized: false,
  });
  assert.equal(controller.persist(), true);
  assert.deepEqual(readWindowState(filePath), { ...bounds, isMaximized: false });

  bounds = { x: 5000, y: 20, width: 1200, height: 700 };
  const restored = controller.handleDisplayChange();
  assert.deepEqual(restored, { x: 720, y: 20, width: 1200, height: 700, isMaximized: false });
  assert.deepEqual(bounds, { x: 720, y: 20, width: 1200, height: 700 });

  let minimized = true;
  const normalBounds = { x: 64, y: 80, width: 1280, height: 720 };
  const minimizedWindow = {
    isDestroyed: () => false,
    isMaximized: () => false,
    isMinimized: () => minimized,
    getBounds: () => ({ x: -32000, y: -32000, width: 160, height: 28 }),
    getNormalBounds: () => ({ ...normalBounds }),
    setBounds() {
      assert.fail('minimized window should not be moved');
    },
  };
  const minimizedController = createWindowStateController({
    filePath,
    getDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getWindow: () => minimizedWindow,
  });
  assert.equal(minimizedController.persist(), true);
  assert.deepEqual(readWindowState(filePath), { ...normalBounds, isMaximized: false });
});
