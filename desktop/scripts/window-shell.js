'use strict';

const DEFAULT_WINDOW_SIZE = Object.freeze({
  width: 1366,
  height: 768,
});

const RECOVERY_COOLDOWN_MS = 1500;

function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function getInitialWindowBounds(display, defaults = DEFAULT_WINDOW_SIZE) {
  const workArea = display && display.workArea ? display.workArea : {};
  const areaX = Math.floor(toFiniteNumber(workArea.x, 0));
  const areaY = Math.floor(toFiniteNumber(workArea.y, 0));
  const areaWidth = Math.max(1, Math.floor(toFiniteNumber(workArea.width, defaults.width)));
  const areaHeight = Math.max(1, Math.floor(toFiniteNumber(workArea.height, defaults.height)));
  const width = Math.min(defaults.width, areaWidth);
  const height = Math.min(defaults.height, areaHeight);

  return {
    width,
    height,
    x: areaX + Math.max(0, Math.floor((areaWidth - width) / 2)),
    y: areaY + Math.max(0, Math.floor((areaHeight - height) / 2)),
  };
}

function describeError(error) {
  if (!error) return 'unknown error';
  return error.stack || error.message || String(error);
}

function createRendererRecoveryController(options = {}) {
  const dialog = options.dialog;
  const getWindow = options.getWindow;
  const reloadWindow = options.reloadWindow;
  const requestQuit = options.requestQuit;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const nowFn = options.nowFn || Date.now;
  const cooldownMs = options.cooldownMs ?? RECOVERY_COOLDOWN_MS;

  if (!dialog || typeof dialog.showMessageBox !== 'function') {
    throw new TypeError('createRendererRecoveryController requires dialog.showMessageBox');
  }
  if (typeof getWindow !== 'function') {
    throw new TypeError('createRendererRecoveryController requires getWindow()');
  }
  if (typeof reloadWindow !== 'function') {
    throw new TypeError('createRendererRecoveryController requires reloadWindow()');
  }
  if (typeof requestQuit !== 'function') {
    throw new TypeError('createRendererRecoveryController requires requestQuit()');
  }

  let activePrompt = null;
  let suppressUntil = 0;

  function hasUsableWindow() {
    const win = getWindow();
    return win && typeof win.isDestroyed === 'function' && !win.isDestroyed() ? win : null;
  }

  async function handleFailure(trigger, detail = '') {
    const now = nowFn();
    if (activePrompt) {
      log(`renderer recovery coalesced trigger=${trigger}`);
      return activePrompt;
    }
    if (now < suppressUntil) {
      log(`renderer recovery suppressed trigger=${trigger}`);
      return null;
    }

    const win = hasUsableWindow();
    if (!win) {
      log(`renderer recovery skipped trigger=${trigger} window=missing`);
      return null;
    }

    const detailSuffix = detail ? `\n\n${detail}` : '';
    const message = `桌面壳检测到页面异常。${detailSuffix}`;
    const promise = Promise.resolve(dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: '本地短剧助手需要恢复',
      message,
      detail: '可以尝试重新加载当前窗口，或者退出应用后重新启动。',
    })).then(({ response }) => {
      suppressUntil = nowFn() + cooldownMs;
      if (response === 0) {
        log(`renderer recovery reload trigger=${trigger}`);
        return reloadWindow({ trigger, detail });
      }
      log(`renderer recovery quit trigger=${trigger}`);
      return requestQuit({ trigger, detail });
    }, (error) => {
      suppressUntil = nowFn() + cooldownMs;
      log(`renderer recovery dialog failed trigger=${trigger} error=${describeError(error)}`);
      return requestQuit({ trigger, detail, error });
    });

    activePrompt = promise;
    promise.finally(() => {
      if (activePrompt === promise) activePrompt = null;
    });
    return activePrompt;
  }

  return {
    getState() {
      return {
        promptActive: activePrompt !== null,
        suppressUntil,
      };
    },
    handleFailure,
  };
}

module.exports = {
  DEFAULT_WINDOW_SIZE,
  RECOVERY_COOLDOWN_MS,
  createRendererRecoveryController,
  getInitialWindowBounds,
};
