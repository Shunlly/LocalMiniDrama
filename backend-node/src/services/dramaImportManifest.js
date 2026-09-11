// 项目导入清单解析：故事素材与自由画布导入清单
const path = require('path');
const sourceMediaExtractionService = require('./sourceMediaExtractionService');
const {
  importError,
  validateZipEntryName,
} = require('./dramaImportValidation');

const SOURCE_INTAKE_MANIFEST_VERSION = 1;
const MAX_SOURCE_METADATA_BYTES = 64 * 1024;
const SOURCE_TYPES = new Set(['novel', 'outline', 'script', 'storyboard', 'comic', 'transcript']);
const SENSITIVE_SOURCE_METADATA_KEY = /api[_-]?key|access[_-]?key|client[_-]?secret|secret|password|token|authorization|cookie|private[_-]?key|raw[_-]?text|full[_-]?text|extracted[_-]?text|ocr[_-]?text|transcript/i;

function sanitizeSourceMetadataNode(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return null;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeSourceMetadataNode(item, depth + 1));
  }
  if (typeof value !== 'object') return null;
  const safe = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (key === 'original_file' || SENSITIVE_SOURCE_METADATA_KEY.test(key)) continue;
    safe[key] = sanitizeSourceMetadataNode(child, depth + 1);
  }
  return safe;
}

function normalizeImportedDate(value, fallback) {
  const text = String(value || '').trim();
  if (!text || text.length > 64) return fallback;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeSourceIntakeManifest(data, limits, now) {
  if (data.source_intake == null) return [];
  const manifest = data.source_intake;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw importError('INVALID_SOURCE_MANIFEST', '素材导入清单必须是对象');
  }
  if (Number(manifest.manifest_version) !== SOURCE_INTAKE_MANIFEST_VERSION || manifest.hash_algorithm !== 'sha256') {
    throw importError('UNSUPPORTED_SOURCE_MANIFEST', '素材导入清单版本或哈希算法不受支持');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length > limits.maxSourceOriginals) {
    throw importError('SOURCE_MANIFEST_LIMIT', '素材导入清单中的原始素材数量超过上限');
  }

  const sourceRefs = new Set();
  const archivePaths = new Set();
  return manifest.sources.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw importError('INVALID_SOURCE_MANIFEST', `素材导入清单第 ${index + 1} 条无效`);
    }
    const sourceRef = String(source.source_ref || '');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceRef) || sourceRefs.has(sourceRef)) {
      throw importError('INVALID_SOURCE_MANIFEST', '素材导入来源引用无效或重复');
    }
    sourceRefs.add(sourceRef);

    const original = source.original;
    if (!original || typeof original !== 'object' || Array.isArray(original)) {
      throw importError('INVALID_SOURCE_MANIFEST', `素材导入 ${sourceRef} 缺少原始文件描述`);
    }
    const archivePath = validateZipEntryName(String(original.archive_path || ''), limits);
    const extension = path.posix.extname(archivePath).toLowerCase();
    const expectedPath = `source-intake/originals/${sourceRef}/original${extension}`;
    if (!extension || archivePath !== expectedPath || archivePaths.has(archivePath)) {
      throw importError('UNSAFE_SOURCE_ORIGINAL_PATH', '素材导入原始文件路径不安全或被重复映射');
    }
    archivePaths.add(archivePath);

    const size = Number(original.size);
    const sha256 = String(original.sha256 || '').toLowerCase();
    const mime = String(original.mime || '').trim().toLowerCase();
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > sourceMediaExtractionService.MAX_SOURCE_UPLOAD_BYTES ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      throw importError('INVALID_SOURCE_ORIGINAL_INTEGRITY', '素材导入原始文件大小或哈希无效');
    }
    if (
      mime.length > 200 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)
    ) {
      throw importError('INVALID_SOURCE_ORIGINAL_MIME', '素材导入原始文件媒体类型无效');
    }

    const sourceType = String(source.source_type || '').trim().toLowerCase();
    if (!SOURCE_TYPES.has(sourceType)) {
      throw importError('INVALID_SOURCE_MANIFEST', `素材导入 ${sourceRef} 的素材类型不受支持`);
    }
    const metadata = sanitizeSourceMetadataNode(source.metadata);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw importError('INVALID_SOURCE_MANIFEST', `素材导入 ${sourceRef} 的元数据无效`);
    }
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_SOURCE_METADATA_BYTES) {
      throw importError('SOURCE_METADATA_LIMIT', `素材导入 ${sourceRef} 的元数据超过安全上限`);
    }
    const contentHash = String(source.content_hash || '').toLowerCase();
    if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash)) {
      throw importError('INVALID_SOURCE_MANIFEST', `素材导入 ${sourceRef} 的内容哈希无效`);
    }

    return {
      source_ref: sourceRef,
      source_type: sourceType,
      title: String(source.title || '导入素材').trim().slice(0, 500) || '导入素材',
      content_hash: contentHash || null,
      metadata,
      created_at: normalizeImportedDate(source.created_at, now),
      original: { archive_path: archivePath, extension, size, sha256, mime },
    };
  });
}

const {
  declaredFreeCanvasDramaId,
  freeCanvasImportFieldLabel,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasImportManifest,
  normalizeFreeCanvasManifestSourcePath,
  parseFreeCanvasReferenceId,
} = require('./dramaImportFreeCanvasManifest');

module.exports = {
  declaredFreeCanvasDramaId,
  freeCanvasImportFieldLabel,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasImportManifest,
  normalizeFreeCanvasManifestSourcePath,
  normalizeSourceIntakeManifest,
  parseFreeCanvasReferenceId,
};
