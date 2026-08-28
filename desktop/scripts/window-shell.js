'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WINDOW_SIZE = Object.freeze({
  width: 1366,
  height: 768,
});

const RECOVERY_COOLDOWN_MS = 1500;
const WINDOW_STATE_DEBOUNCE_MS = 400;
const WINDOW_STATE_FILE_NAME = 'window-state.json';
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 80;

function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function describeError(error) {
  if (!error) return 'unknown error';
  return error.stack || error.message || String(error);
}

function getWorkArea(display, defaults = DEFAULT_WINDOW_SIZE) {
  const workArea = display && display.workArea ? display.workArea : display || {};
  return {
    x: Math.floor(toFiniteNumber(workArea.x, 0)),
    y: Math.floor(toFiniteNumber(workArea.y, 0)),
    width: Math.max(1, Math.floor(toFiniteNumber(workArea.width, defaults.width))),
    height: Math.max(1, Math.floor(toFiniteNumber(workArea.height, defaults.height))),
  };
}

function listWorkAreas(displays, defaults = DEFAULT_WINDOW_SIZE) {
  const list = Array.isArray(displays) ? displays.filter(Boolean) : (displays ? [displays] : []);
  if (list.length === 0) {
    return [getWorkArea({ x: 0, y: 0, width: defaults.width, height: defaults.height }, defaults)];
  }
  return list.map((display) => getWorkArea(display, defaults));
}

function getInitialWindowBounds(display, defaults = DEFAULT_WINDOW_SIZE) {
  const area = getWorkArea(display, defaults);
  const width = Math.min(defaults.width, area.width);
  const height = Math.min(defaults.height, area.height);

  return {
    width,
    height,
    x: area.x + Math.max(0, Math.floor((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - height) / 2)),
  };
}

function isUsableBounds(bounds) {
  return Boolean(
    bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width >= 1
    && bounds.height >= 1
  );
}

function overlapSize(bounds, area) {
  const x = Math.max(bounds.x, area.x);
  const y = Math.max(bounds.y, area.y);
  const right = Math.min(bounds.x + bounds.width, area.x + area.width);
  const bottom = Math.min(bounds.y + bounds.height, area.y + area.height);
  return {
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function isVisiblyOnDisplay(bounds, area) {
  const overlap = overlapSize(bounds, area);
  return overlap.width >= Math.min(MIN_VISIBLE_WIDTH, bounds.width)
    && overlap.height >= Math.min(MIN_VISIBLE_HEIGHT, bounds.height);
}

function clampBoundsToWorkArea(bounds, area) {
  const width = Math.min(Math.max(1, Math.floor(bounds.width)), area.width);
  const height = Math.min(Math.max(1, Math.floor(bounds.height)), area.height);
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  return {
    x: Math.min(Math.max(Math.floor(bounds.x), area.x), maxX),
    y: Math.min(Math.max(Math.floor(bounds.y), area.y), maxY),
    width,
    height,
  };
}

function resolveWindowBounds(displays, savedState, defaults = DEFAULT_WINDOW_SIZE) {
  const workAreas = listWorkAreas(displays, defaults);
  const primary = workAreas[0];
  const saved = isUsableBounds(savedState) ? savedState : null;

  if (saved) {
    const containing = workAreas.find((area) => isVisiblyOnDisplay(saved, area));
    if (containing) {
      return {
        ...clampBoundsToWorkArea(saved, containing),
        isMaximized: savedState.isMaximized === true,
      };
    }
    return {
      ...clampBoundsToWorkArea(saved, primary),
      isMaximized: false,
    };
  }

  return {
    ...getInitialWindowBounds({ workArea: primary }, defaults),
    isMaximized: false,
  };
}

function readWindowState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isUsableBounds(parsed)) return null;
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      isMaximized: parsed.isMaximized === true,
    };
  } catch (_) {
    return null;
  }
}

function writeWindowState(filePath, state) {
  if (!filePath || !isUsableBounds(state)) return false;
  const payload = `${JSON.stringify({
    x: Math.floor(state.x),
    y: Math.floor(state.y),
    width: Math.floor(state.width),
    height: Math.floor(state.height),
    isMaximized: state.isMaximized === true,
  })}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, payload, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  return true;
}

function createWindowStateController(options = {}) {
  const filePath = options.filePath;
  const getWindow = options.getWindow;
  const getDisplays = options.getDisplays;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const debounceMs = options.debounceMs ?? WINDOW_STATE_DEBOUNCE_MS;

  if (!filePath) {
    throw new TypeError('createWindowStateController requires filePath');
  }
  if (typeof getWindow !== 'function') {
    throw new TypeError('createWindowStateController requires getWindow()');
  }
  if (typeof getDisplays !== 'function') {
    throw new TypeError('createWindowStateController requires getDisplays()');
  }

  let timer = null;

  function usableWindow() {
    const win = getWindow();
    return win && typeof win.isDestroyed === 'function' && !win.isDestroyed() ? win : null;
  }

  function persist() {
    const win = usableWindow();
    if (!win) return false;
    const isMinimized = typeof win.isMinimized === 'function' && win.isMinimized();
    const isMaximized = typeof win.isMaximized === 'function' && win.isMaximized();
    const useNormalBounds = (isMinimized || isMaximized) && typeof win.getNormalBounds === 'function';
    const bounds = useNormalBounds
      ? win.getNormalBounds()
      : (typeof win.getBounds === 'function' ? win.getBounds() : null);
    if (!isUsableBounds(bounds)) return false;
    try {
      return writeWindowState(filePath, {
        ...bounds,
        isMaximized: isMaximized && !isMinimized,
      });
    } catch (error) {
      log(`window state save failed error=${describeError(error)}`);
      return false;
    }
  }

  function persistSoon() {
    const win = usableWindow();
    if (!win) return;
    if (typeof win.isMinimized === 'function' && win.isMinimized()) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      persist();
    }, debounceMs);
    timer?.unref?.();
  }

  function restoreBounds() {
    return resolveWindowBounds(getDisplays(), readWindowState(filePath));
  }

  function handleDisplayChange() {
    const win = usableWindow();
    if (!win) return null;
    if (typeof win.isMaximized === 'function' && win.isMaximized()) return null;
    if (typeof win.isMinimized === 'function' && win.isMinimized()) return null;
    if (typeof win.getBounds !== 'function' || typeof win.setBounds !== 'function') return null;
    const current = win.getBounds();
    const next = resolveWindowBounds(getDisplays(), { ...current, isMaximized: false });
    if (
      current.x === next.x
      && current.y === next.y
      && current.width === next.width
      && current.height === next.height
    ) {
      return current;
    }
    win.setBounds({
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    });
    log('window bounds restored after display change');
    return next;
  }

  return {
    handleDisplayChange,
    persist,
    persistSoon,
    restoreBounds,
  };
}

function describeStartupFailureReason(error) {
  const code = error && typeof error === 'object' ? String(error.code || '') : '';
  const rawMessage = error instanceof Error
    ? error.message
    : (error == null ? '' : String(error));
  const haystack = `${code} ${rawMessage}`;

  if (code === 'EADDRINUSE' || /\bEADDRINUSE\b/.test(haystack)) {
    return '本地服务端口已被占用，无法完成启动。';
  }
  if (code === 'EACCES' || code === 'EPERM' || /\bEACCES\b|\bEPERM\b/.test(haystack)) {
    return '没有权限启动本地服务。';
  }
  if (code === 'ENOENT' || /\bENOENT\b/.test(haystack)) {
    return '启动所需的文件或目录不存在。';
  }
  if (
    code === 'MODULE_NOT_FOUND'
    || /Cannot find module/i.test(rawMessage)
    || /\bMODULE_NOT_FOUND\b/.test(haystack)
  ) {
    return '启动所需的组件缺失或未正确安装。';
  }
  if (/NODE_MODULE_VERSION|compiled against a different Node\.js/i.test(haystack)) {
    return '本机组件与当前桌面运行时不匹配，请重新安装或重建桌面端。';
  }
  return '请查看日志了解详细原因。';
}

function defaultSanitizeLogPath(value, maxLength = 1024) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function buildStartupFailureDialogMessage(logPath, error, sanitizeLogPath = defaultSanitizeLogPath) {
  const reason = describeStartupFailureReason(error);
  const safePath = sanitizeLogPath ? sanitizeLogPath(logPath, 1024) : defaultSanitizeLogPath(logPath);
  return `后端服务未能启动。${reason}\n\n日志文件：\n${safePath}`;
}

function describeRendererFailure(trigger, details = {}) {
  if (trigger === 'unresponsive') return '页面长时间无响应。';
  if (trigger === 'render-process-gone') {
    const reasonMap = {
      'abnormal-exit': '渲染进程异常退出。',
      'clean-exit': '渲染进程已退出。',
      crashed: '渲染进程崩溃。',
      'integrity-failure': '渲染进程完整性校验失败。',
      killed: '渲染进程被系统结束。',
      'launch-failed': '渲染进程启动失败。',
      oom: '渲染进程因内存不足退出。',
    };
    return reasonMap[details.reason] || '渲染进程已退出。';
  }
  if (trigger === 'did-fail-load') {
    const code = details.code;
    const description = String(details.description || '');
    if (
      code === -6
      || /ERR_FILE_NOT_FOUND/i.test(description)
    ) {
      return '页面文件不存在，加载失败。';
    }
    if (
      code === -101
      || /ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED/i.test(description)
    ) {
      return '本地服务连接被中断，页面加载失败。';
    }
    if (
      code === -7
      || code === -102
      || code === -105
      || code === -106
      || code === -118
      || /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i.test(description)
    ) {
      return '无法连接到本地服务，页面加载失败。';
    }
    if (code === -324 || /ERR_EMPTY_RESPONSE/i.test(description)) {
      return '本地服务没有返回页面内容。';
    }
    return '页面加载失败。';
  }
  return '桌面壳检测到页面异常。';
}

function revealWindow(win) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return null;
  if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
    win.restore();
  }
  if (typeof win.isVisible === 'function' && !win.isVisible() && typeof win.show === 'function') {
    win.show();
  }
  return win;
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

    const win = revealWindow(hasUsableWindow());
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

function createStartupFailureController(options = {}) {
  const dialog = options.dialog;
  const relaunchApp = options.relaunchApp;
  const requestQuit = options.requestQuit;
  const log = typeof options.log === 'function' ? options.log : () => {};

  if (!dialog || typeof dialog.showMessageBox !== 'function') {
    throw new TypeError('createStartupFailureController requires dialog.showMessageBox');
  }
  if (typeof relaunchApp !== 'function') {
    throw new TypeError('createStartupFailureController requires relaunchApp()');
  }
  if (typeof requestQuit !== 'function') {
    throw new TypeError('createStartupFailureController requires requestQuit()');
  }

  async function handleFailure({ message } = {}) {
    const dialogOptions = {
      type: 'error',
      buttons: ['重新启动', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: '本地短剧助手启动失败',
      message: message || '后端服务未能启动。请查看日志了解详细原因。',
      detail: '可以尝试重新启动应用，或退出后稍后再试。',
    };

    let response = 1;
    try {
      const result = await Promise.resolve(dialog.showMessageBox(dialogOptions));
      response = result && Number.isInteger(result.response) ? result.response : 1;
    } catch (error) {
      log(`startup failure dialog failed error=${describeError(error)}`);
      response = 1;
    }

    if (response === 0) {
      log('startup failure relaunch requested');
      try {
        await relaunchApp();
        return 'relaunch';
      } catch (error) {
        log(`startup failure relaunch failed error=${describeError(error)}`);
      }
    }
    log('startup failure quit requested');
    await requestQuit();
    return 'quit';
  }

  return { handleFailure };
}

module.exports = {
  DEFAULT_WINDOW_SIZE,
  RECOVERY_COOLDOWN_MS,
  WINDOW_STATE_DEBOUNCE_MS,
  WINDOW_STATE_FILE_NAME,
  buildStartupFailureDialogMessage,
  createRendererRecoveryController,
  createStartupFailureController,
  createWindowStateController,
  describeRendererFailure,
  describeStartupFailureReason,
  getInitialWindowBounds,
  readWindowState,
  resolveWindowBounds,
  writeWindowState,
};
