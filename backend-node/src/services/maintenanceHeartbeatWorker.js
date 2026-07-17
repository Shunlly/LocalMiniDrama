'use strict';

const fs = require('node:fs');
const { workerData } = require('node:worker_threads');

const state = new Int32Array(workerData.stateBuffer);

function writeHeartbeat() {
  let fd;
  try {
    fd = fs.openSync(workerData.lockPath, 'r+');
    const payload = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (
      payload.token !== workerData.token ||
      Number(payload.pid) !== workerData.pid ||
      payload.contract !== workerData.contract
    ) {
      throw new Error('Maintenance recovery lease ownership changed.');
    }
    payload.heartbeatAt = new Date().toISOString();
    const data = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
    fs.ftruncateSync(fd, 0);
    let offset = 0;
    while (offset < data.length) {
      offset += fs.writeSync(fd, data, offset, data.length - offset, offset);
    }
    fs.fsyncSync(fd);
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
