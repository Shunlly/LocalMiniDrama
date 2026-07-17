'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  DEFAULT_WINDOW_SIZE,
  RECOVERY_COOLDOWN_MS,
  createRendererRecoveryController,
  getInitialWindowBounds,
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
    /win\.on\(['"]close['"], \(event\) => shutdownController\.handleWindowClose\(event\)\)/
  );
  assert.doesNotMatch(mainSource, /win\.on\(['"]closed['"][\s\S]{0,160}app\.quit\(\)/);
});

test('startup failure uses the same failure-status graceful shutdown path', () => {
  assert.match(
    mainSource,
    /await shutdownController\.requestShutdown\(['"]startup-failure['"], 1\)/
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

test('main process wires recovery handling and screen-constrained bounds through helpers', () => {
  assert.match(mainSource, /const initialBounds = getInitialWindowBounds\(screen\.getPrimaryDisplay\(\)\);/);
  assert.match(mainSource, /minWidth: Math\.min\(1024, initialBounds\.width\)/);
  assert.match(mainSource, /minHeight: Math\.min\(640, initialBounds\.height\)/);
  assert.match(mainSource, /const recoveryController = createRendererRecoveryController\(/);
  assert.match(mainSource, /recoveryController\.handleFailure\('did-fail-load'/);
  assert.match(mainSource, /recoveryController\.handleFailure\(\s*'render-process-gone'/);
  assert.match(mainSource, /recoveryController\.handleFailure\('unresponsive'/);
});
