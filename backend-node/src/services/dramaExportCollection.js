'use strict';

const path = require('path');
const uploadService = require('./uploadService');
const { sanitizeSourceMetadataNode } = require('./dramaExportSanitize');
const { exportError } = require('./dramaExportErrors');

const SOURCE_INTAKE_MANIFEST_VERSION = 1;
const MAX_SOURCE_METADATA_BYTES = 64 * 1024;
const EXPORT_FIRST_FRAME_TYPES = ['storyboard_first', 'first', 'first_frame'];
const EXPORT_LAST_FRAME_TYPES = ['storyboard_last', 'last', 'tail', 'last_frame'];

// 导出收集：原文、附加图、首尾帧提示词和角色 ID。

function getStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function extOf(relPath) {
  if (!relPath) return '.jpg';
  return path.extname(relPath) || '.jpg';
}

function parseJsonObject(value) {
  if (!value) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function collectSourceIntakeOriginals(db, storagePath, dramaId, archive) {
  const rows = db.prepare(
    `SELECT id, drama_id, source_type, title, content_hash, metadata, created_at
     FROM story_sources
     WHERE drama_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC`
  ).all(Number(dramaId));
  const sources = [];

  for (const row of rows) {
    const metadata = parseJsonObject(row.metadata);
    if (!metadata.original_file) continue;

    const sourceRef = `source_${String(sources.length + 1).padStart(4, '0')}`;
    const extension = path.extname(String(metadata.original_file.server_filename || '')).toLowerCase();
    if (!/^\.[a-z0-9]{1,8}$/.test(extension)) {
      throw exportError('UNSAFE_EXPORT_STORAGE', '项目导出拒绝了不安全的素材元数据。', null, 400);
    }
    const archivePath = `source-intake/originals/${sourceRef}/original${extension}`;
    archive.assertCanAdd(archivePath, Number(metadata.original_file.size));
    let original;
    try {
      original = uploadService.readStorySourceOriginal(storagePath, {
        ...row,
        metadata,
      });
    } catch (error) {
      throw exportError(
        'UNSAFE_EXPORT_STORAGE',
        '项目导出拒绝了不安全的原始素材文件。',
        null,
        400,
        error
      );
    }
    const safeMetadata = sanitizeSourceMetadataNode(metadata);
    if (Buffer.byteLength(JSON.stringify(safeMetadata), 'utf8') > MAX_SOURCE_METADATA_BYTES) {
      throw exportError(
        'EXPORT_SOURCE_METADATA_LIMIT',
        '项目导出的素材元数据超过安全上限。',
        { limit_bytes: MAX_SOURCE_METADATA_BYTES },
        400
      );
    }

    sources.push({
      source_ref: sourceRef,
      source_type: String(row.source_type || 'outline').slice(0, 32),
      title: String(row.title || '导入素材').slice(0, 500),
      content_hash: /^[a-f0-9]{64}$/i.test(String(row.content_hash || ''))
        ? String(row.content_hash).toLowerCase()
        : null,
      metadata: safeMetadata,
      created_at: String(row.created_at || '').slice(0, 64) || null,
      original: {
        archive_path: archivePath,
        sha256: original.sha256,
        size: original.size,
        mime: original.mime,
      },
    });
    archive.addBuffer(archivePath, original.buffer);
  }

  return {
    manifest: {
      manifest_version: SOURCE_INTAKE_MANIFEST_VERSION,
      hash_algorithm: 'sha256',
      sources,
    },
  };
}

/** 解析 extra_images JSON 字段，返回本地路径数组 */
function parseExtraImages(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (_) { return []; }
}

function parseStoryboardReferenceImages(raw) {
  if (!raw) return [];
  try {
    const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 10);
  } catch (_) {
    return [];
  }
}

/** frame_prompts 表无记录时，从首尾帧图生历史补全导出（避免仅生过图、未单独存帧提示词时丢失） */
function supplementFramePromptsFromImageGens(db, sbId, fps) {
  const out = Array.isArray(fps) ? [...fps] : [];
  const hasType = (t) => out.some((f) => f && f.frame_type === t);
  const pickPrompt = (types) => {
    const ph = types.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT prompt FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL
       AND frame_type IN (${ph}) AND prompt IS NOT NULL AND TRIM(prompt) != ''
       ORDER BY created_at DESC LIMIT 1`
    ).get(sbId, ...types);
    return (row?.prompt || '').trim();
  };
  const now = new Date().toISOString();
  if (!hasType('first')) {
    const p = pickPrompt(EXPORT_FIRST_FRAME_TYPES);
    if (p) out.push({ frame_type: 'first', prompt: p, description: null, layout: null, created_at: now, updated_at: now });
  }
  if (!hasType('last')) {
    const p = pickPrompt(EXPORT_LAST_FRAME_TYPES);
    if (p) out.push({ frame_type: 'last', prompt: p, description: null, layout: null, created_at: now, updated_at: now });
  }
  return out;
}

/** 解析 storyboard.characters JSON 字段，返回 ID 数组 */
function parseSbChars(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(Number).filter(n => !isNaN(n)) : [];
  } catch (_) { return []; }
}

module.exports = {
  getStoragePath,
  extOf,
  parseJsonObject,
  collectSourceIntakeOriginals,
  parseExtraImages,
  parseStoryboardReferenceImages,
  supplementFramePromptsFromImageGens,
  parseSbChars,
};
