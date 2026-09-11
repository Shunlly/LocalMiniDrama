'use strict';

/**
 * 视频合成执行：引用规范化、存储根路径与严格生产分镜覆盖校验。
 */

const path = require('path');
const uploadService = require('./uploadService');
const {
  MAX_STRICT_SCENES,
  exactTrustedOrigin,
  assertStrictSceneCoverage,
} = require('./videoMergePlanning');

function configuredProviderOrigins(db) {
  try {
    return db.prepare(
      'SELECT base_url FROM ai_service_configs WHERE deleted_at IS NULL AND is_active = 1 AND base_url IS NOT NULL'
    ).all().map((row) => String(row.base_url || '').trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function normalizeMergeVideoReference(value, storageRoot, trustedOrigins = []) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const local = uploadService.resolveStorageReference(storageRoot, text);
      if (local) return local.relativePath;
    } catch (error) {
      if (text.startsWith('/static/')) throw error;
    }
    if (exactTrustedOrigin(text, trustedOrigins)) return new URL(text).toString();
    return uploadService.assertPublicHttpUrlSyntax(text).toString();
  }
  const local = uploadService.resolveStorageReference(storageRoot, text);
  if (!local) throw new uploadService.UnsafeMediaReferenceError('视频引用必须位于本地存储目录内');
  return local.relativePath;
}

function normalizeMergeScenes(reqScenes, db) {
  if (reqScenes == null) return [];
  if (!Array.isArray(reqScenes) || reqScenes.length > MAX_STRICT_SCENES) {
    throw new uploadService.UnsafeMediaReferenceError('合成分镜列表无效或数量过多');
  }
  const storageRoot = getStorageRoot();
  const trustedOrigins = configuredProviderOrigins(db);
  return reqScenes.map((scene) => ({
    ...(scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : {}),
    video_url: normalizeMergeVideoReference(scene?.video_url, storageRoot, trustedOrigins),
  }));
}

/** 获取 storage 根目录（绝对路径） */
function getStorageRoot() {
  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function validateStrictSceneCoverage(db, episodeId, scenes) {
  const expected = db.prepare(
    `SELECT id, storyboard_number
       FROM storyboards
      WHERE episode_id = ? AND deleted_at IS NULL
      ORDER BY storyboard_number ASC, id ASC`
  ).all(Number(episodeId));
  return assertStrictSceneCoverage(scenes, expected);
}

module.exports = {
  configuredProviderOrigins,
  normalizeMergeVideoReference,
  normalizeMergeScenes,
  getStorageRoot,
  validateStrictSceneCoverage,
};
