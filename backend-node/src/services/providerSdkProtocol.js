'use strict';

// 从 providerSdkService 拆出的生产协议探测：模式判断、占位协议识别、本地媒体是否真实落盘。
// 保持原语义，不是新增真实厂商接入。

const fs = require('fs');
const path = require('path');

function isProductionMode(params) {
  return params?.mode === 'production' || params?.qa_mode === 'production';
}

function isMockValue(value) {
  return /^(?:mock|placeholder):\/\//i.test(String(value || '').trim());
}

function isMockProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return !provider || provider === 'mock' || provider === 'mock-compositor' || provider.startsWith('mock-');
}

function isFilesystemAbsolute(text) {
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(text) || /^\\\\[^\\]+\\/.test(text);
  }
  return text.startsWith('/');
}

function getStorageRoot() {
  const cfg = require('../config').loadConfig();
  const configured = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function resolveUnderStorageRoot(relativeText) {
  const relative = String(relativeText || '')
    .replace(/^[/\\]+/, '')
    .replace(/[\\/]/g, path.sep);
  const root = path.resolve(getStorageRoot());
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function resolveLocalMediaPath(value) {
  const text = String(value || '').trim();
  if (!text || isMockValue(text)) return null;
  const staticMatch = text.match(/^(?:\/?static[\\/])(.+)$/i);
  if (staticMatch) return resolveUnderStorageRoot(staticMatch[1]);
  if (isFilesystemAbsolute(text)) return text;
  return resolveUnderStorageRoot(text);
}

function localMediaExists(value) {
  const target = resolveLocalMediaPath(value);
  return !!target && fs.existsSync(target) && fs.statSync(target).isFile();
}

function firstLocalAsset(row, fields) {
  for (const field of fields) {
    if (localMediaExists(row?.[field])) return row[field];
  }
  return null;
}

module.exports = {
  isProductionMode,
  isMockValue,
  isMockProvider,
  getStorageRoot,
  resolveLocalMediaPath,
  localMediaExists,
  firstLocalAsset,
};
