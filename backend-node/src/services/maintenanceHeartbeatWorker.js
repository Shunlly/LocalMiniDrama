'use strict';

const fs = require('node:fs');
const { workerData } = require('node:worker_threads');
const { updateMaintenanceHeartbeatFd } = require('./maintenanceLockFile');

const state = new Int32Array(workerData.stateBuffer);

function writeHeartbeat() {
  let fd;
  try {
    fd = fs.openSync(workerData.lockPath, 'r+');
    updateMaintenanceHeartbeatFd(fd, {
      contract: workerData.contract,
      pid: workerData.pid,
      token: workerData.token,
    });
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function failClosed() {
  const wasRunning = Atomics.exchange(state, 0, -1) === 1;
  Atomics.notify(state, 0);
  if (wasRunning) {
    try { process.kill(workerData.pid, 'SIGKILL'); } catch (_) {}
  }
}

try {
  if (Atomics.load(state, 0) === 2) {
    Atomics.store(state, 0, 3);
    Atomics.notify(state, 0);
    process.exit(0);
  }
  writeHeartbeat();
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
  while (Atomics.load(state, 0) === 1) {
    Atomics.wait(state, 0, 1, workerData.intervalMs);
    if (Atomics.load(state, 0) === 1) writeHeartbeat();
  }
  Atomics.store(state, 0, 3);
  Atomics.notify(state, 0);
} catch (_) {
  failClosed();
}
