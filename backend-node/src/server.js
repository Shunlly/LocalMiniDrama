const { createApp: defaultCreateApp } = require('./app.js');
const logger = require('./logger.js');

const SHUTDOWN_TIMEOUT_MS = 50_000;

function startServer(options = {}) {
  const createApp = options.createApp || defaultCreateApp;
  const log = options.logger || logger;
  const processRef = options.processRef || process;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const env = processRef.env || process.env;

  let resources = null;
  let server = null;
  let shutdownRequested = false;
  let shutdownStarted = false;
  let shutdownFinished = false;
  let shutdownPromise = null;
  let forceExitTimer = null;
  let backgroundDrained = false;
  let httpClosed = false;

  const removeSignalListeners = () => {
    processRef.removeListener('SIGINT', onSigint);
    processRef.removeListener('SIGTERM', onSigterm);
  };

  const finishShutdown = (requestedExitCode) => {
    if (shutdownFinished) return;
    shutdownFinished = true;
    removeSignalListeners();
    if (forceExitTimer !== null) {
      clearTimeoutFn(forceExitTimer);
      forceExitTimer = null;
    }

    let exitCode = requestedExitCode;
    try {
      resources?.close?.();
    } catch (error) {
      exitCode = 1;
      log.error?.('Failed to release server resources', { error: error.message });
    }
    log.info('Server exited', { exitCode });
    processRef.exit(exitCode);
  };

  const exitWithoutClosingResources = (message, fields = {}) => {
    if (shutdownFinished) return;
    shutdownFinished = true;
    removeSignalListeners();
    if (forceExitTimer !== null) {
      clearTimeoutFn(forceExitTimer);
      forceExitTimer = null;
    }

    try {
      resources?.detachExitClose?.();
    } catch (error) {
      log.error?.('Failed to disable exit resource cleanup after shutdown timeout', {
        error: error.message,
      });
    }

    log.error?.(message, fields);
    processRef.exit(1);
  };

  const failTimedOutShutdown = () => {
    let backgroundState;
    try {
      backgroundState = resources?.backgroundTasks?.getState?.();
    } catch (error) {
      log.error?.('Failed to inspect background tasks during shutdown timeout', {
        error: error.message,
      });
    }

    exitWithoutClosingResources(
      'Graceful shutdown timed out; exiting without closing application resources',
      {
        timeoutMs: shutdownTimeoutMs,
        httpClosed,
        backgroundDrained,
        activeBackgroundTasks: backgroundState?.active,
      }
    );
  };

  const stopHttpServer = () => new Promise((resolve) => {
    if (!server) {
      httpClosed = true;
      resolve(null);
      return;
    }

    let settled = false;
    const onClosed = (error) => {
      if (settled) return;
      settled = true;
      const closeFailed = error && error.code !== 'ERR_SERVER_NOT_RUNNING';
      if (closeFailed) {
        log.error?.('Failed to close HTTP server', { error: error.message });
      } else {
        httpClosed = true;
      }
      resolve(closeFailed ? error : null);
    };

    try {
      server.close(onClosed);
    } catch (error) {
      onClosed(error);
    }
  });

  const stopAndDrainBackgroundTasks = () => {
    const scheduler = resources?.backgroundTasks;
    if (!scheduler || typeof scheduler.shutdown !== 'function') {
      return Promise.resolve(new Error('Application background task scheduler is unavailable'));
    }
    try {
      const drain = scheduler.shutdown();
      return Promise.resolve(drain).then(
        () => {
          backgroundDrained = true;
          return null;
        },
        (error) => error
      );
    } catch (error) {
      return Promise.resolve(error);
    }
  };

  const beginShutdown = () => {
    if (shutdownStarted || shutdownFinished || !resources) return shutdownPromise;
    shutdownStarted = true;

    forceExitTimer = setTimeoutFn(() => {
      failTimedOutShutdown();
    }, shutdownTimeoutMs);
    forceExitTimer?.unref?.();

    const backgroundDrain = stopAndDrainBackgroundTasks();
    const httpClose = stopHttpServer();
    shutdownPromise = Promise.all([backgroundDrain, httpClose]).then(([backgroundError, httpError]) => {
      if (shutdownFinished) return;
      if (backgroundError) {
        exitWithoutClosingResources(
          'Background task drain failed; exiting without closing application resources',
          { error: backgroundError.message || String(backgroundError) }
        );
        return;
      }
      if (httpError) {
        exitWithoutClosingResources(
          'HTTP server close failed; exiting without closing application resources',
          { error: httpError.message || String(httpError) }
        );
        return;
      }
      finishShutdown(0);
    });
    return shutdownPromise;
  };

  const requestShutdown = (signal) => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      log.info('Shutting down server...', { signal });
    }
    return beginShutdown();
  };
  const onSigint = () => requestShutdown('SIGINT');
  const onSigterm = () => requestShutdown('SIGTERM');

  processRef.on('SIGINT', onSigint);
  processRef.on('SIGTERM', onSigterm);

  try {
    resources = createApp();
  } catch (error) {
    removeSignalListeners();
    throw error;
  }

  if (shutdownRequested) {
    beginShutdown();
    return { server, shutdown: requestShutdown };
  }

  const { app, config } = resources;
  const port = Number(env.PORT) || config.server?.port || 5679;
  const host = env.HOST || config.server?.host || '127.0.0.1';

  try {
    server = app.listen(port, host, () => {
      log.info('Server starting', { port, host });
      log.info('Frontend:  http://localhost:' + port);
      log.info('API:       http://localhost:' + port + '/api/v1');
      log.info('Health:    http://localhost:' + port + '/health');
      log.info('Server is ready!');
    });
  } catch (error) {
    removeSignalListeners();
    resources.close?.();
    throw error;
  }

  return { server, shutdown: requestShutdown };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  SHUTDOWN_TIMEOUT_MS,
  startServer,
};
