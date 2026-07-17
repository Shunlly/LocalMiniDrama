'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  acquireSingleInstanceLock,
  focusMainWindow,
} = require('../scripts/single-instance');

function createApp(lockGranted) {
  const listeners = new Map();
  return {
    quitCalls: 0,
    listeners,
    requestSingleInstanceLock() {
      return lockGranted;
    },
    quit() {
      this.quitCalls += 1;
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
  };
}

test('a secondary process exits without registering backend startup work', () => {
  const app = createApp(false);
  const logs = [];
  const acquired = acquireSingleInstanceLock(app, () => null, (message) => logs.push(message));

  assert.equal(acquired, false);
  assert.equal(app.quitCalls, 1);
  assert.equal(app.listeners.has('second-instance'), false);
  assert.deepEqual(logs, ['single-instance lock denied; exiting']);
});

test('a second-instance event restores, shows, and focuses the primary window', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  const app = createApp(true);
  const logs = [];

  assert.equal(acquireSingleInstanceLock(app, () => window, (message) => logs.push(message)), true);
  app.listeners.get('second-instance')();

  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  assert.deepEqual(logs, [
    'single-instance lock acquired',
    'second-instance received',
    'second-instance focused main window',
  ]);
});

test('focusMainWindow ignores a destroyed or unavailable window', () => {
  const log = () => assert.fail('no focus log expected');
  assert.equal(focusMainWindow(() => null, log), false);
  assert.equal(focusMainWindow(() => ({ isDestroyed: () => true }), log), false);
});
