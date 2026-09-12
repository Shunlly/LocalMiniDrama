'use strict';

const fs = require('node:fs');

function readFileDescriptorSync(fd) {
  const size = fs.fstatSync(fd).size;
  const data = Buffer.alloc(size);
  let offset = 0;
  while (offset < data.length) {
    const bytesRead = fs.readSync(fd, data, offset, data.length - offset, offset);
    if (bytesRead === 0) throw new Error('Maintenance lease read ended before the file boundary.');
    offset += bytesRead;
  }
  return data;
}

function updateMaintenanceHeartbeatFd(fd, expected, heartbeatAt = new Date().toISOString()) {
  const source = readFileDescriptorSync(fd);
  const payload = JSON.parse(source.toString('utf8'));
  if (
    payload.token !== expected.token ||
    Number(payload.pid) !== expected.pid ||
    payload.contract !== expected.contract
  ) {
    throw new Error('Maintenance lease ownership changed.');
  }

  const previousHeartbeat = String(payload.heartbeatAt || '');
  const nextHeartbeat = String(heartbeatAt || '');
  if (!previousHeartbeat || Buffer.byteLength(previousHeartbeat) !== Buffer.byteLength(nextHeartbeat)) {
    throw new Error('Maintenance lease heartbeat length changed.');
  }

  payload.heartbeatAt = nextHeartbeat;
  const data = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  if (data.length !== source.length) {
    throw new Error('Maintenance lease rewrite must preserve file length.');
  }

  let offset = 0;
  while (offset < data.length) {
    const bytesWritten = fs.writeSync(fd, data, offset, data.length - offset, offset);
    if (bytesWritten === 0) throw new Error('Maintenance lease write stopped before the file boundary.');
    offset += bytesWritten;
  }
  fs.fsyncSync(fd);
  return payload;
}

module.exports = { updateMaintenanceHeartbeatFd };
