'use strict';

// image_proxy_cache 本地缓存，供 Gemini 参考图图床复用。

const crypto = require('crypto');
const uploadService = require('../uploadService');
const { loadConfig } = require('../../config');

// 惰性加载配置，避免循环依赖与启动顺序问题
let _appConfig = null;
function getAppConfig() {
  if (!_appConfig) {
    try { _appConfig = loadConfig(); } catch (_) { _appConfig = {}; }
  }
  return _appConfig;
}

/** 从配置读取图床 URL 有效期（小时），默认 23h 留出余量 */
function getProxyExpireHours() {
  return Number(getAppConfig()?.image_proxy?.expire_hours ?? 23);
}

/**
 * 从 image_proxy_cache 表查询已缓存的图床 URL。
 * cache_key 规则：本地相对路径 或 data URL 的 sha256 前 16 字符。
 * 若缓存已过期（超过 config.image_proxy.expire_hours），自动删除并返回 null，触发重新上传。
 */
function getProxyCache(db, cacheKey) {
  try {
    const row = db.prepare('SELECT proxy_url, created_at FROM image_proxy_cache WHERE cache_key = ?').get(cacheKey);
    if (!row?.proxy_url) return null;

    const expireMs = getProxyExpireHours() * 3600 * 1000;
    const createdAt = new Date(row.created_at).getTime();
    if (isNaN(createdAt) || Date.now() - createdAt > expireMs) {
      // 过期或时间无效：删除旧记录，返回 null 触发重新上传
      deleteProxyCache(db, cacheKey);
      return null;
    }

    return row.proxy_url;
  } catch (_) { return null; }
}

function deleteProxyCache(db, cacheKey) {
  try { db.prepare('DELETE FROM image_proxy_cache WHERE cache_key = ?').run(cacheKey); } catch (_) {}
}

/** 探测图床 URL 是否仍可访问（远端拉取失败时视为失效） */
async function isProxyUrlAlive(url, timeoutMs = 8000) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    await uploadService.downloadBufferViaNodeHttp(url, timeoutMs, 0, {
      headers: { Range: 'bytes=0-0' },
      maxBytes: 1024 * 1024,
      maxRedirects: 2,
      accept: 'image/*',
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 读取图床缓存并在使用前校验 URL 仍有效；404/超时等则删缓存并返回 null 以触发重新上传。
 */
async function getProxyCacheValidated(db, cacheKey, log, tag) {
  const url = getProxyCache(db, cacheKey);
  if (!url) return null;
  if (await isProxyUrlAlive(url)) return url;
  deleteProxyCache(db, cacheKey);
  log?.warn?.('[图床缓存] URL 已失效，将重新上传', { tag, cache_key: cacheKey, url_head: url.slice(0, 80) });
  return null;
}

/** 写入 image_proxy_cache 缓存记录 */
function setProxyCache(db, cacheKey, proxyUrl) {
  try {
    db.prepare(
      'INSERT OR REPLACE INTO image_proxy_cache (cache_key, proxy_url, created_at) VALUES (?, ?, ?)'
    ).run(cacheKey, proxyUrl, new Date().toISOString());
  } catch (_) {}
}

/** 根据 ref 字符串计算缓存 key：本地路径直接使用；data URL 取 buffer sha256 前 16 字节的 hex */
function buildCacheKey(ref, imageBuffer) {
  if (!ref.startsWith('data:')) return ref;
  return 'sha256:' + crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 32);
}

module.exports = {
  getProxyCache,
  getProxyCacheValidated,
  deleteProxyCache,
  isProxyUrlAlive,
  setProxyCache,
  buildCacheKey,
};
