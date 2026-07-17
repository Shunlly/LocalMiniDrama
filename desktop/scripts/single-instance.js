'use strict';

function focusMainWindow(getMainWindow, log) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  log('second-instance focused main window');
  return true;
}

function acquireSingleInstanceLock(app, getMainWindow, log) {
  if (!app.requestSingleInstanceLock()) {
    log('single-instance lock denied; exiting');
    app.quit();
    return false;
  }

  log('single-instance lock acquired');
  app.on('second-instance', () => {
    log('second-instance received');
    if (!focusMainWindow(getMainWindow, log)) {
      log('second-instance received before main window was available');
    }
  });
  return true;
}

module.exports = { acquireSingleInstanceLock, focusMainWindow };
