'use strict';

/**
 * Windows 下 path.isAbsolute('/static/...') 为 true，必须先剥 /static/ 前缀，
 * 不能把该路径当成绝对盘符路径。反斜杠也先归一成 /。
 */

function normalizeMediaSlashes(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function relativePathAfterStatic(value, filesBaseUrl) {
  const normalized = normalizeMediaSlashes(value);
  if (!normalized) return '';
  const marker = '/static/';
  const index = normalized.toLowerCase().indexOf(marker);
  if (index >= 0) {
    return normalized.slice(index + marker.length).split(/[?#]/)[0].replace(/^\/+/, '');
  }
  const baseUrl = normalizeMediaSlashes(filesBaseUrl).replace(/\/$/, '');
  if (baseUrl && (normalized === baseUrl || normalized.startsWith(`${baseUrl}/`))) {
    return normalized.slice(baseUrl.length).replace(/^\/+/, '').split(/[?#]/)[0];
  }
  return '';
}

function localRefKeyFromRaw(raw) {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('data:')) return null;
  const normalized = normalizeMediaSlashes(s);
  if (normalized.toLowerCase().includes('/static/')) {
    return relativePathAfterStatic(normalized) || null;
  }
  if (/^https?:\/\//i.test(normalized)) return null;
  return normalized.replace(/^\/+/, '') || null;
}

module.exports = {
  normalizeMediaSlashes,
  relativePathAfterStatic,
  localRefKeyFromRaw,
};
