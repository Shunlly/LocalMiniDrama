'use strict';

const SHUTDOWN_TIMEOUT_MS = 50_000;

function describeError(error) {
  if (!error) return 'unknown error';
  return error.stack || error.message || String(error);
}

function isServerAlreadyClosed(error) {
  return error?.code === 'ERR_SERVER_NOT_RUNNING';
}

function createShutdownController(options = {}) {
  const app = options.app;
  if (!app || (typeof app.exit !== 'function' && typeof app.quit !== 'function')) {
    throw new TypeError('createShutdownController requires an Electron app exit method');
  }

  const log = typeof options.log === 'function' ? options.log : () => {};
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  let resources = null;
  let server = null;
  let phase = 'running';
  let shutdownPromise = null;
  let resolveShutdown = null;
  let timeoutHandle = null;
  let requestedExitCode = 0;
  let exitAuthorized = false;
  let exitCloseDetached = false;
  let httpClosed = false;
  let backgroundDrained = false;

  function writeLog(message, fields) {
    let suffix = '';
    if (fields && Object.keys(fields).length > 0) {
      try {
        suffix = ` ${JSON.stringify(fields)}`;
      } catch (_) {
        suffix = ' [unserializable shutdown details]';
      }
    }
    log(`[shutdown] ${message}${suffix}`);
  }

  function clearShutdownTimeout() {
    if (timeoutHandle === null) return;
    clearTimeoutFn(timeoutHandle);
    timeoutHandle = null;
  }

  function detachExitResourceClose() {
    if (exitCloseDetached) return;
    exitCloseDetached = true;
    try {
      resources?.detachExitClose?.();
    } catch (error) {
      writeLog('failed to detach backend exit cleanup', { error: describeError(error) });
    }
  }

  function exitApplication(exitCode) {
    try {
      if (typeof app.exit === 'function') {
        app.exit(exitCode);
      } else {
        app.quit();
      }
    } catch (error) {
      writeLog('Electron app.exit failed', { error: describeError(error), exitCode });
      if (typeof app.quit === 'function') app.quit();
    }
  }

  function finish(outcome) {
    if (phase === 'exiting') return;
    phase = 'exiting';
    exitAuthorized = true;
    clearShutdownTimeout();
    writeLog(outcome.message, outcome.fields);
    resolveShutdown?.(outcome);
    exitApplication(outcome.exitCode);
  }

  function failWithoutClosingResources(message, fields = {}) {
    if (phase === 'exiting') return;
    detachExitResourceClose();
    finish({ ok: false, exitCode: 1, message, fields });
  }

  function readBackgroundState() {
    try {
      return resources?.backgroundTasks?.getState?.() || null;
    } catch (error) {
      writeLog('failed to inspect background tasks', { error: describeError(error) });
      return null;
    }
  }

  function handleTimeout() {
    const backgroundState = readBackgroundState();
    failWithoutClosingResources('graceful shutdown timed out; backend resources remain open', {
      timeoutMs,
      httpClosed,
      backgroundDrained,
      activeBackgroundTasks: backgroundState?.active,
      acceptingBackgroundTasks: backgroundState?.accepting,
    });
  }

  function stopAndDrainBackgroundTasks() {
    if (!resources?.backgroundTasks?.shutdown) {
      backgroundDrained = true;
      return Promise.resolve(null);
    }

    try {
      return Promise.resolve(resources.backgroundTasks.shutdown()).then(
        () => {
          backgroundDrained = true;
          return null;
        },
        (error) => error
      );
    } catch (error) {
      return Promise.resolve(error);
    }
  }

  function stopHttpServer() {
    return new Promise((resolve) => {
      if (!server) {
        httpClosed = true;
        resolve(null);
        return;
      }

      let settled = false;
      const onClosed = (error) => {
        if (settled) return;
        settled = true;
        if (!error || isServerAlreadyClosed(error)) {
          httpClosed = true;
          resolve(null);
          return;
        }
        resolve(error);
      };

      try {
        server.close(onClosed);
      } catch (error) {
        onClosed(error);
      }
    });
  }

  function closeResourcesAndExit() {
    try {
      resources?.close?.();
    } catch (error) {
      failWithoutClosingResources('backend resource cleanup failed', {
        error: describeError(error),
      });
      return;
    }

    finish({
      ok: requestedExitCode === 0,
      exitCode: requestedExitCode,
      message: 'graceful shutdown completed',
      fields: { exitCode: requestedExitCode },
    });
  }

  function beginShutdown(reason) {
    phase = 'draining';
    shutdownPromise = new Promise((resolve) => {
      resolveShutdown = resolve;
    });
    writeLog('graceful shutdown started', { reason, timeoutMs, requestedExitCode });

    timeoutHandle = setTimeoutFn(handleTimeout, timeoutMs);
    timeoutHandle?.unref?.();

    // shutdown() flips the scheduler to non-accepting synchronously. Start it before
    // server.close() so an in-flight request cannot enqueue work during this turn.
    const backgroundDrain = stopAndDrainBackgroundTasks();
    const httpClose = stopHttpServer();

    Promise.all([backgroundDrain, httpClose]).then(([backgroundError, httpError]) => {
      if (phase === 'exiting') return;
      if (backgroundError) {
        failWithoutClosingResources('background task drain failed; backend resources remain open', {
          error: describeError(backgroundError),
          httpClosed,
        });
        return;
      }
      if (httpError) {
        failWithoutClosingResources('HTTP server close failed; backend resources remain open', {
          error: describeError(httpError),
          backgroundDrained,
        });
        return;
      }
      closeResourcesAndExit();
    }, (error) => {
      failWithoutClosingResources('unexpected graceful shutdown failure; backend resources remain open', {
        error: describeError(error),
      });
    });

    return shutdownPromise;
  }

  function requestShutdown(reason = 'unspecified', exitCode = 0) {
    if (Number(exitCode) !== 0) requestedExitCode = 1;
    if (shutdownPromise) return shutdownPromise;
    return beginShutdown(reason);
  }

  function interceptExit(event, reason, exitCode = 0) {
    if (exitAuthorized) return null;
    event?.preventDefault?.();
    return requestShutdown(reason, exitCode);
  }

  function setBackendResources(nextResources) {
    if (!nextResources || typeof nextResources !== 'object') {
      throw new TypeError('backend resources must be an object');
    }
    if (resources && resources !== nextResources) {
      throw new Error('backend resources are already registered');
    }
    if (phase !== 'running') {
      throw new Error('cannot register backend resources after shutdown starts');
    }
    resources = nextResources;
    return nextResources;
  }

  function setHttpServer(nextServer) {
    if (!nextServer || typeof nextServer.close !== 'function') {
      throw new TypeError('HTTP server must expose close(callback)');
    }
    if (server && server !== nextServer) {
      throw new Error('HTTP server is already registered');
    }
    if (phase !== 'running') {
      throw new Error('cannot register an HTTP server after shutdown starts');
    }
    server = nextServer;
    return nextServer;
  }

  return {
    getState() {
      return {
        backgroundDrained,
        exitAuthorized,
        httpClosed,
        phase,
        requestedExitCode,
      };
    },
    handleBeforeQuit(event) {
      return interceptExit(event, 'before-quit');
    },
    handleWindowClose(event) {
      return interceptExit(event, 'window-close');
    },
    isExitAuthorized() {
      return exitAuthorized;
    },
    isShutdownRequested() {
      return phase !== 'running';
    },
    requestShutdown,
    setBackendResources,
    setHttpServer,
  };
}

module.exports = {
  SHUTDOWN_TIMEOUT_MS,
  createShutdownController,
};
