// 项目导出服务：将剧集所有数据和媒体文件打包为 ZIP
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const uploadService = require('./uploadService');

const EXPORT_VERSION = '1.6';  // 1.6: 分镜自由参考图与宫格视频引用可随项目导入导出
const SOURCE_INTAKE_MANIFEST_VERSION = 1;
const MAX_SOURCE_METADATA_BYTES = 64 * 1024;
const SENSITIVE_SOURCE_METADATA_KEY = /api[_-]?key|access[_-]?key|client[_-]?secret|secret|password|token|authorization|cookie|private[_-]?key|raw[_-]?text|full[_-]?text|extracted[_-]?text|ocr[_-]?text|transcript/i;
const HTTP_URL_REFERENCE = /^https?:/i;
const RELATIVE_URL_SCHEME = 'lmd-export-relative:';
const MAX_EXPORT_SANITIZE_DEPTH = 64;
const SENSITIVE_KEY_WORDS = new Set([
  'auth',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'csrf',
  'jwt',
  'key',
  'keys',
  'passphrase',
  'passwd',
  'password',
  'secret',
  'secrets',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
  'tokens',
  'xsrf',
]);
const SENSITIVE_URL_QUERY_KEYS = new Set(['code', 'nonce', 'policy']);
const SENSITIVE_KEY_COMPOUNDS = Object.freeze([
  'apikey',
  'accesskey',
  'accesskeyid',
  'accessid',
  'clientsecret',
  'privatekey',
  'secretkey',
  'signingkey',
  'encryptionkey',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'securitytoken',
  'authorization',
  'authentication',
  'credential',
  'signature',
]);
const DEFAULT_EXPORT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxMemoryBytes: 768 * 1024 * 1024,
});
const ZIP_ENTRY_MEMORY_OVERHEAD = 1024;

class DramaExportError extends Error {
  constructor(code, message, statusCode = 413, details = null, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DramaExportError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) this.details = details;
  }
}

function exportError(code, message, details = null, statusCode = 413, cause = null) {
  return new DramaExportError(code, message, statusCode, details, cause);
}

function normalizeExportLimits(overrides = {}) {
  const aliases = {
    maxFiles: ['maxFiles', 'max_files'],
    maxFileBytes: ['maxFileBytes', 'max_file_bytes'],
    maxTotalUncompressedBytes: ['maxTotalUncompressedBytes', 'max_total_uncompressed_bytes'],
    maxMemoryBytes: ['maxMemoryBytes', 'max_memory_bytes'],
  };
  const limits = { ...DEFAULT_EXPORT_LIMITS };
  for (const [key, names] of Object.entries(aliases)) {
    const suppliedName = names.find((name) => overrides?.[name] !== undefined);
    if (!suppliedName) continue;
    const value = Number(overrides[suppliedName]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw exportError(
        'INVALID_EXPORT_LIMIT',
        `Project export limit ${suppliedName} must be a positive integer.`,
        { limit: suppliedName },
        500
      );
    }
    limits[key] = value;
  }
  return limits;
}

function resolveExportLimits(cfg, overrides = {}) {
  const storage = cfg?.storage || {};
  const nested = storage.project_export_limits
    || storage.export_limits
    || cfg?.project_export?.limits
    || cfg?.project_export
    || {};
  return normalizeExportLimits({
    maxFiles: overrides.maxFiles ?? overrides.max_files
      ?? nested.maxFiles ?? nested.max_files
      ?? storage.project_export_max_files ?? storage.export_max_files
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_FILES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_FILES,
    maxFileBytes: overrides.maxFileBytes ?? overrides.max_file_bytes
      ?? nested.maxFileBytes ?? nested.max_file_bytes
      ?? storage.project_export_max_file_bytes ?? storage.export_max_file_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_FILE_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_FILE_BYTES,
    maxTotalUncompressedBytes: overrides.maxTotalUncompressedBytes ?? overrides.max_total_uncompressed_bytes
      ?? nested.maxTotalUncompressedBytes ?? nested.max_total_uncompressed_bytes
      ?? storage.project_export_max_total_uncompressed_bytes ?? storage.export_max_total_uncompressed_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_TOTAL_UNCOMPRESSED_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_TOTAL_UNCOMPRESSED_BYTES,
    maxMemoryBytes: overrides.maxMemoryBytes ?? overrides.max_memory_bytes
      ?? nested.maxMemoryBytes ?? nested.max_memory_bytes
      ?? storage.project_export_max_memory_bytes ?? storage.export_max_memory_bytes
      ?? process.env.LOCALMINIDRAMA_PROJECT_EXPORT_MAX_MEMORY_BYTES
      ?? process.env.LOCALMINIDRAMA_EXPORT_MAX_MEMORY_BYTES,
  });
}

function zipBufferUpperBound(totalBytes, fileCount) {
  const deflateOverhead = Math.ceil(totalBytes / 16383) * 5 + 6;
  return totalBytes + deflateOverhead + (fileCount * ZIP_ENTRY_MEMORY_OVERHEAD);
}

class ExportArchiveBuilder {
  constructor(limits) {
    this.limits = limits;
    this.zip = new AdmZip();
    this.fileCount = 0;
    this.totalUncompressedBytes = 0;
    this.archivePaths = new Set();
  }

  assertCanAdd(archivePath, size) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw exportError('EXPORT_FILE_SIZE_LIMIT', 'Project export encountered an invalid file size.');
    }
    if (this.archivePaths.has(archivePath)) {
      throw exportError(
        'EXPORT_DUPLICATE_PATH',
        'Project export generated a duplicate archive path.',
        { archive_path: archivePath },
        500
      );
    }
    const nextFileCount = this.fileCount + 1;
    if (nextFileCount > this.limits.maxFiles) {
      throw exportError(
        'EXPORT_FILE_COUNT_LIMIT',
        'Project export contains too many files.',
        { limit: this.limits.maxFiles, actual: nextFileCount }
      );
    }
    if (size > this.limits.maxFileBytes) {
      throw exportError(
        'EXPORT_FILE_SIZE_LIMIT',
        'A project export file exceeds the configured size limit.',
        { limit_bytes: this.limits.maxFileBytes, actual_bytes: size, archive_path: archivePath }
      );
    }
    const nextTotal = this.totalUncompressedBytes + size;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > this.limits.maxTotalUncompressedBytes) {
      throw exportError(
        'EXPORT_TOTAL_SIZE_LIMIT',
        'Project export exceeds the configured uncompressed size limit.',
        { limit_bytes: this.limits.maxTotalUncompressedBytes, actual_bytes: nextTotal }
      );
    }
    const estimatedMemory = nextTotal + zipBufferUpperBound(nextTotal, nextFileCount);
    if (!Number.isSafeInteger(estimatedMemory) || estimatedMemory > this.limits.maxMemoryBytes) {
      throw exportError(
        'EXPORT_MEMORY_LIMIT',
        'Project export exceeds the configured memory budget.',
        { limit_bytes: this.limits.maxMemoryBytes, estimated_bytes: estimatedMemory }
      );
    }
  }

  addBuffer(archivePath, buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw exportError('EXPORT_FILE_READ_FAILED', 'Project export could not materialize a file.', null, 500);
    }
    this.assertCanAdd(archivePath, buffer.length);
    this.zip.addFile(archivePath, buffer);
    this.archivePaths.add(archivePath);
    this.fileCount += 1;
    this.totalUncompressedBytes += buffer.length;
  }

  addStorageFile(storagePath, localPath, archivePath) {
    if (!localPath) return false;
    const reference = String(localPath).trim();
    if (/^(?:mock|placeholder):\/\//i.test(reference)) return false;
    let opened;
    try {
      const resolved = uploadService.resolveStorageReference(storagePath, reference, { allowMissing: true });
      if (!resolved) return false;
      opened = uploadService.openStorageFile(storagePath, resolved.relativePath);
    } catch (error) {
      if (error?.code === 'UNSAFE_MEDIA_REFERENCE' && error?.reason === 'NOT_FOUND') return false;
      const reason = /^[A-Z_]{2,64}$/.test(String(error?.reason || ''))
        ? String(error.reason)
        : 'INVALID_REFERENCE';
      throw exportError(
        'UNSAFE_EXPORT_STORAGE',
        'Project export rejected an unsafe storage path.',
        { archive_path: archivePath, reason },
        400,
        error
      );
    }

    try {
      this.assertCanAdd(archivePath, opened.stat.size);
      const buffer = Buffer.allocUnsafe(opened.stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const bytes = fs.readSync(opened.fd, buffer, offset, buffer.length - offset, offset);
        if (bytes <= 0) {
          throw exportError('EXPORT_FILE_CHANGED', 'Project export source changed while being read.', null, 409);
        }
        offset += bytes;
      }
      const after = fs.fstatSync(opened.fd);
      if (after.size !== opened.stat.size || after.mtimeMs !== opened.stat.mtimeMs) {
        throw exportError('EXPORT_FILE_CHANGED', 'Project export source changed while being read.', null, 409);
      }
      this.addBuffer(archivePath, buffer);
      return true;
    } finally {
      fs.closeSync(opened.fd);
    }
  }

  toBuffer() {
    const buffer = this.zip.toBuffer();
    const actualPeakBytes = this.totalUncompressedBytes + buffer.length;
    if (actualPeakBytes > this.limits.maxMemoryBytes) {
      throw exportError(
        'EXPORT_MEMORY_LIMIT',
        'Project export exceeds the configured memory budget.',
        { limit_bytes: this.limits.maxMemoryBytes, actual_bytes: actualPeakBytes }
      );
    }
    return buffer;
  }
}

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

function sensitiveKeyParts(key) {
  const separated = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return separated.split(/[^a-z0-9]+/).filter(Boolean);
}

function isSensitiveExportKey(key) {
  const parts = sensitiveKeyParts(key);
  if (parts.some((part) => SENSITIVE_KEY_WORDS.has(part))) return true;
  const compact = parts.join('');
  return SENSITIVE_KEY_COMPOUNDS.some((term) => compact.includes(term));
}

function isSensitiveUrlQueryKey(key) {
  const compact = sensitiveKeyParts(key).join('');
  return isSensitiveExportKey(key) || SENSITIVE_URL_QUERY_KEYS.has(compact);
}

function isRelativeUrlReference(value) {
  if (!value || /[\\\s]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (/^(?:\/|\.\/|\.\.\/|\?|#)/.test(value)) return true;
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname.includes('/') || /(?:^|\/)[^/]+\.[a-z0-9]{1,16}$/i.test(pathname);
}

function parseUrlReference(value) {
  const protocolRelative = value.startsWith('//');
  const httpReference = HTTP_URL_REFERENCE.test(value);
  const relative = !httpReference && !protocolRelative && isRelativeUrlReference(value);
  if (!httpReference && !protocolRelative && !relative) return null;

  try {
    if (protocolRelative) {
      const parsed = new URL(`https:${value}`);
      return {
        parsed,
        serialize: () => parsed.toString().slice('https:'.length),
      };
    }
    if (httpReference) {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) return { invalid: true };
      return { parsed, serialize: () => parsed.toString() };
    }
    const parsed = new URL(`${RELATIVE_URL_SCHEME}${value}`);
    return {
      parsed,
      serialize: () => parsed.toString().slice(RELATIVE_URL_SCHEME.length),
    };
  } catch (_) {
    return { invalid: true };
  }
}

function sanitizeUrlReference(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const reference = parseUrlReference(trimmed);
  if (!reference) return value;
  if (reference.invalid) return null;

  const { parsed } = reference;
  let changed = false;
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
    changed = true;
  }

  for (const key of new Set(parsed.searchParams.keys())) {
    if (!isSensitiveUrlQueryKey(key)) continue;
    parsed.searchParams.delete(key);
    changed = true;
  }
  if (!changed) return value;
  return reference.serialize();
}

function sanitizeStructuredJsonString(value, depth) {
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return value;
    const sanitized = sanitizeProjectExport(parsed, depth + 1);
    const before = JSON.stringify(parsed);
    const after = JSON.stringify(sanitized);
    return before === after ? value : after;
  } catch (_) {
    return value;
  }
}

function sanitizeProjectExport(value, depth = 0) {
  if (depth > MAX_EXPORT_SANITIZE_DEPTH) return null;
  if (typeof value === 'string') {
    const sanitizedUrl = sanitizeUrlReference(value);
    if (sanitizedUrl !== value) return sanitizedUrl;
    return sanitizeStructuredJsonString(value, depth);
  }
  if (Array.isArray(value)) {
    return value.map((child) => sanitizeProjectExport(child, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveExportKey(key)) continue;
    sanitized[key] = sanitizeProjectExport(child, depth + 1);
  }
  return sanitized;
}

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
      throw exportError('UNSAFE_EXPORT_STORAGE', 'Project export rejected unsafe source metadata.', null, 400);
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
        'Project export rejected an unsafe source original.',
        null,
        400,
        error
      );
    }
    const safeMetadata = sanitizeSourceMetadataNode(metadata);
    if (Buffer.byteLength(JSON.stringify(safeMetadata), 'utf8') > MAX_SOURCE_METADATA_BYTES) {
      throw exportError(
        'EXPORT_SOURCE_METADATA_LIMIT',
        'Project export source metadata exceeds the safe limit.',
        { limit_bytes: MAX_SOURCE_METADATA_BYTES },
        400
      );
    }

    sources.push({
      source_ref: sourceRef,
      source_type: String(row.source_type || 'outline').slice(0, 32),
      title: String(row.title || 'Imported source').slice(0, 500),
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

const EXPORT_FIRST_FRAME_TYPES = ['storyboard_first', 'first', 'first_frame'];
const EXPORT_LAST_FRAME_TYPES = ['storyboard_last', 'last', 'tail', 'last_frame'];

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

/**
 * 导出一个剧集为 ZIP Buffer
 * @returns {Buffer}
 */
function exportDrama(db, cfg, log, dramaId, options = {}) {
  const storagePath = getStoragePath(cfg);
  const limits = resolveExportLimits(cfg, options.limits || options.exportLimits || {});
  const archive = new ExportArchiveBuilder(limits);

  // ---- 1. 读取 drama 基本信息 ----
  const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
  if (!drama) throw new Error('剧本不存在');

  let metadata = {};
  try { metadata = drama.metadata ? (typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata) : {}; } catch (_) {}

  // ---- 2. 读取所有剧集 ----
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number'
  ).all(Number(dramaId));

  // ---- 3. 读取各集分镜 ----
  const episodeIds = episodes.map(e => e.id);
  const storyboardsByEp = {};
  for (const ep of episodes) {
    storyboardsByEp[ep.id] = db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number'
    ).all(ep.id);
  }

  // ---- 4. 读取分镜图（完整历史 + 首尾帧 first/last）和视频（取最新完成的） ----
  const allStoryboards = Object.values(storyboardsByEp).flat();
  const allSbIds = allStoryboards.map(s => s.id);
  const storyboardsById = new Map(allStoryboards.map(sb => [sb.id, sb]));
  const allImagesBySb = {};  // sbId -> 所有 image_generations 记录（用于导出历史和首尾帧绑定）
  const videosBySb = {};
  for (const sbId of allSbIds) {
    // 导出所有非删除的图片生成记录（含历史、首尾帧、各种 frame_type），仅打包有 local_path 的文件
    const igs = db.prepare(
      "SELECT * FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
    ).all(sbId);
    allImagesBySb[sbId] = igs.filter(Boolean);

    const vg = db.prepare(
      `SELECT video_url, local_path FROM video_generations
       WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
       ORDER BY COALESCE(NULLIF(completed_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), '') DESC, id DESC
       LIMIT 1`
    ).get(sbId);
    const sb = storyboardsById.get(sbId);
    const storyboardVideoLocalPath = String(sb?.video_local_path || '').trim();
    const video = {
      video_url: sb?.video_url || vg?.video_url || null,
      local_path: storyboardVideoLocalPath || vg?.local_path || null,
    };
    if (video.video_url || video.local_path) videosBySb[sbId] = video;
  }

  // 收集需要打包的分镜图片文件（完整历史）
  const imageFilesToPack = [];
  for (const [sbIdStr, igs] of Object.entries(allImagesBySb)) {
    const sbId = Number(sbIdStr);
    for (const ig of igs) {
      if (!ig.local_path) continue;
      const zipPath = `media/storyboards/sb_${sbId}_gen_${ig.id}${extOf(ig.local_path)}`;
      imageFilesToPack.push({ localRelPath: ig.local_path, zipPath });
    }
  }

  // 预查询各分镜的帧提示词（首尾帧专用提示词编辑器内容，必须导出否则导入后丢失）
  const framePromptsBySb = {};
  for (const sbId of allSbIds) {
    try {
      const fps = db.prepare('SELECT frame_type, prompt, description, layout, created_at, updated_at FROM frame_prompts WHERE storyboard_id = ? ORDER BY created_at ASC').all(sbId);
      framePromptsBySb[sbId] = supplementFramePromptsFromImageGens(db, sbId, fps);
    } catch (_) { framePromptsBySb[sbId] = []; }
  }

  // ---- 5. 读取角色 ----
  const characters = db.prepare(
    'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order, id'
  ).all(Number(dramaId));

  // ---- 6. 读取场景 ----
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
  ).all(Number(dramaId));

  // ---- 7. 读取道具 ----
  const props = db.prepare(
    'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
  ).all(Number(dramaId));

  const sourceIntakeExport = collectSourceIntakeOriginals(db, storagePath, dramaId, archive);

  // ---- 场景去重（数据库中可能存在同 location+time 的重复记录，导出时只保留第一条）----
  const seenSceneKeys = new Set();
  const dedupedScenes = [];
  for (const s of scenes) {
    const key = `${(s.location || '').trim()}|${(s.time || '').trim()}`;
    if (seenSceneKeys.has(key)) continue;
    seenSceneKeys.add(key);
    dedupedScenes.push(s);
  }
  // 为去重后被丢弃的重复场景 ID 建立到保留场景的映射，确保分镜 scene_index 仍指向保留的场景
  const sceneDedupeIdMap = new Map(); // 原 ID → 保留后的同 key 首个 ID
  for (const s of scenes) {
    const key = `${(s.location || '').trim()}|${(s.time || '').trim()}`;
    const kept = dedupedScenes.find(d => `${(d.location||'').trim()}|${(d.time||'').trim()}` === key);
    if (kept) sceneDedupeIdMap.set(s.id, kept.id);
  }

  // ---- 构建 ID → 导出数组下标 的映射（用于分镜 characters/scene_id/prop_ids 跨项目还原） ----
  const charIdToIndex = {};
  characters.forEach((c, idx) => { charIdToIndex[c.id] = idx; });
  const sceneIdToIndex = {};
  dedupedScenes.forEach((s, idx) => { sceneIdToIndex[s.id] = idx; });
  // 去重丢弃的重复场景 ID 也指向保留场景的下标
  for (const [origId, keptId] of sceneDedupeIdMap.entries()) {
    if (!(origId in sceneIdToIndex)) sceneIdToIndex[origId] = sceneIdToIndex[keptId];
  }
  const propIdToIndex = {};
  props.forEach((p, idx) => { propIdToIndex[p.id] = idx; });

  // ---- 读取所有分镜的道具关联（storyboard_props） ----
  const allSbIdsForProps = Object.values(storyboardsByEp).flat().map(s => s.id);
  const sbPropIds = {}; // storyboard_id → prop_id[]
  if (allSbIdsForProps.length > 0) {
    const placeholders = allSbIdsForProps.map(() => '?').join(',');
    const spRows = db.prepare(
      `SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`
    ).all(...allSbIdsForProps);
    for (const row of spRows) {
      if (!sbPropIds[row.storyboard_id]) sbPropIds[row.storyboard_id] = [];
      sbPropIds[row.storyboard_id].push(row.prop_id);
    }
  }

  // ---- 8. 组装 project.json ----
  // 收集 extra_images 需要打包的文件：{ localRelPath, zipPath }
  const extraFilesToPack = [];
  const panoramaFilesToPack = [];
  const referenceFilesToPack = [];

  const zipData = {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    drama: {
      title: drama.title,
      description: drama.description,
      genre: drama.genre,
      style: drama.style,
      status: drama.status,
      tags: drama.tags,
      metadata,
    },
    source_intake: sourceIntakeExport.manifest,
    episodes: episodes.map(ep => {
      const sbs = storyboardsByEp[ep.id] || [];
      return {
        episode_number: ep.episode_number,
        title: ep.title,
        description: ep.description,
        script_content: ep.script_content,
        duration: ep.duration,
        storyboards: sbs.map(sb => {
          const igsForThis = allImagesBySb[sb.id] || [];
          // 兼容：仍提供 image_file（指向首帧或最新一张），旧版导入器可继续工作
          let mainIg = igsForThis.find(g => g.id === sb.first_frame_image_id) || igsForThis[igsForThis.length - 1];
          const sbImageFile = mainIg?.local_path
            ? `media/storyboards/sb_${sb.id}_gen_${mainIg.id}${extOf(mainIg.local_path)}`
            : null;
          const vg = videosBySb[sb.id];
          const sbVideoFile = vg && vg.local_path ? `media/videos/sb_${sb.id}${extOf(vg.local_path)}` : null;
          const sbAudioFile = sb.audio_local_path
            ? `media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`
            : null;
          const sbNarrationAudioFile = sb.narration_audio_local_path
            ? `media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`
            : null;

          // characters: 存储角色在导出列表中的下标（而非原 ID），方便跨项目恢复
          const charIds = parseSbChars(sb.characters);
          const characterIndices = charIds
            .map(id => charIdToIndex[id])
            .filter(idx => idx !== undefined);

          // scene_id: 存储场景在导出列表中的下标
          const sceneIndex = sb.scene_id != null ? (sceneIdToIndex[sb.scene_id] ?? null) : null;

          // prop_ids: 存储道具在导出列表中的下标（storyboard_props 关联）
          const sbPropIdList = sbPropIds[sb.id] || [];
          const propIndices = sbPropIdList
            .map(id => propIdToIndex[id])
            .filter(idx => idx !== undefined);

          const referenceImages = parseStoryboardReferenceImages(sb.reference_images)
            .map((item, index) => {
              const localPath = String(item.local_path || '').trim();
              const imageUrl = String(item.image_url || item.url || '').trim() || null;
              const zipFile = localPath
                ? `media/storyboards/sb_${sb.id}_reference_${index}${extOf(localPath)}`
                : null;
              if (zipFile) referenceFilesToPack.push({ localRelPath: localPath, zipPath: zipFile });
              if (!zipFile && !imageUrl) return null;
              return {
                name: String(item.name || item.filename || `参考图 ${index + 1}`).slice(0, 200),
                image_url: imageUrl,
                zip_file: zipFile,
              };
            })
            .filter(Boolean);

          return {
            storyboard_number: sb.storyboard_number,
            title: sb.title,
            description: sb.description,
            location: sb.location,
            time: sb.time,
            dialogue: sb.dialogue,
            narration: sb.narration || null,
            action: sb.action,
            atmosphere: sb.atmosphere,
            result: sb.result,
            shot_type: sb.shot_type,
            angle: sb.angle,
            angle_h: sb.angle_h || null,
            angle_v: sb.angle_v || null,
            angle_s: sb.angle_s || null,
            movement: sb.movement,
            lighting_style: sb.lighting_style || null,
            depth_of_field: sb.depth_of_field || null,
            image_prompt: sb.image_prompt,
            polished_prompt: sb.polished_prompt || null,
            video_prompt: sb.video_prompt,
            duration: sb.duration,
            emotion: sb.emotion,
            emotion_intensity: sb.emotion_intensity,
            segment_index: sb.segment_index ?? 0,
            segment_title: sb.segment_title || null,
            continuity_snapshot: sb.continuity_snapshot || null,
            creation_mode: sb.creation_mode === 'universal' ? 'universal' : 'classic',
            universal_segment_text: sb.universal_segment_text || null,
            layout_description: sb.layout_description || null,
            // 用 original_id 记录首尾帧绑定的 image_generations 旧ID，导入时映射回新ID
            first_frame_image_original_id: sb.first_frame_image_id ?? null,
            last_frame_image_original_id: sb.last_frame_image_id ?? null,
            video_reference_image_original_id: sb.video_reference_image_id ?? null,
            reference_images: referenceImages,
            last_frame_image_url: sb.last_frame_image_url || null,
            last_frame_local_path: sb.last_frame_local_path || null,
            video_url: vg?.video_url || null,
            video_local_path: vg?.local_path || null,
            character_indices: characterIndices,
            scene_index: sceneIndex,
            prop_indices: propIndices,
            image_file: sbImageFile,
            video_file: sbVideoFile,
            audio_file: sbAudioFile,
            narration_audio_file: sbNarrationAudioFile,
            // 完整分镜图片历史（含首尾帧），导入后可恢复 getSbAllImages + 绑定
            image_generations: igsForThis.map(ig => ({
              original_id: ig.id,
              provider: ig.provider || 'imported',
              prompt: ig.prompt || null,
              negative_prompt: ig.negative_prompt || null,
              model: ig.model || null,
              frame_type: ig.frame_type || null,
              size: ig.size || null,
              quality: ig.quality || null,
              status: ig.status || 'completed',
              error_msg: ig.error_msg || null,
              image_url: ig.image_url || null,
              created_at: ig.created_at || null,
              updated_at: ig.updated_at || null,
              completed_at: ig.completed_at || null,
              zip_file: ig.local_path
                ? `media/storyboards/sb_${sb.id}_gen_${ig.id}${extOf(ig.local_path)}`
                : null,
            })),
            // 首尾帧提示词编辑器保存的专业提示词（含 layout）
            frame_prompts: framePromptsBySb[sb.id] || [],
          };
        }),
      };
    }),
    characters: characters.map((c, idx) => {
      // 收集 extra_images 文件
      const extras = parseExtraImages(c.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/characters/extra_char_${c.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: c.name,
        role: c.role,
        description: c.description,
        personality: c.personality,
        appearance: c.appearance,
        voice_style: c.voice_style,
        polished_prompt: c.polished_prompt || null,
        image_file: c.local_path ? `media/characters/char_${c.id}${extOf(c.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
    scenes: dedupedScenes.map(s => {
      const epIdx = episodeIds.indexOf(s.episode_id);
      const extras = parseExtraImages(s.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/scenes/extra_scene_${s.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      const panoramaImageFile = s.panorama_local_path
        ? `media/scenes/panorama_scene_${s.id}${extOf(s.panorama_local_path)}`
        : null;
      if (panoramaImageFile) {
        panoramaFilesToPack.push({ localRelPath: s.panorama_local_path, zipPath: panoramaImageFile });
      }
      return {
        location: s.location,
        time: s.time,
        prompt: s.prompt,
        polished_prompt: s.polished_prompt || null,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: s.local_path ? `media/scenes/scene_${s.id}${extOf(s.local_path)}` : null,
        panorama_image_url: s.panorama_image_url || null,
        panorama_local_path: s.panorama_local_path || null,
        panorama_image_id: s.panorama_image_id ?? null,
        panorama_image_file: panoramaImageFile,
        extra_image_files: extraFiles,
      };
    }),
    props: props.map(p => {
      const epIdx = episodeIds.indexOf(p.episode_id);
      const extras = parseExtraImages(p.extra_images);
      const extraFiles = extras.map((relPath, i) => {
        const zipPath = `media/props/extra_prop_${p.id}_${i}${extOf(relPath)}`;
        extraFilesToPack.push({ localRelPath: relPath, zipPath });
        return zipPath;
      });
      return {
        name: p.name,
        type: p.type,
        description: p.description,
        prompt: p.prompt,
        episode_index: epIdx >= 0 ? epIdx : null,
        image_file: p.local_path ? `media/props/prop_${p.id}${extOf(p.local_path)}` : null,
        extra_image_files: extraFiles,
      };
    }),
  };

  // ---- 9. 打包 ZIP ----
  const projectJson = JSON.stringify(sanitizeProjectExport(zipData), null, 2);
  const projectJsonBytes = Buffer.byteLength(projectJson, 'utf8');
  archive.assertCanAdd('project.json', projectJsonBytes);
  archive.addBuffer('project.json', Buffer.from(projectJson, 'utf8'));

  // 分镜图片完整历史（含首尾帧 first/last 专用图 + 所有历史生成）
  for (const { localRelPath, zipPath } of imageFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 分镜视频
  for (const [sbId, vg] of Object.entries(videosBySb)) {
    if (vg.local_path) {
      archive.addStorageFile(
        storagePath,
        vg.local_path,
        `media/videos/sb_${sbId}${extOf(vg.local_path)}`
      );
    }
  }

  // 分镜对白 TTS / 解说旁白 TTS（分字段存储）
  for (const ep of episodes) {
    for (const sb of storyboardsByEp[ep.id] || []) {
      if (sb.audio_local_path) {
        archive.addStorageFile(
          storagePath,
          sb.audio_local_path,
          `media/audio/sb_${sb.id}${extOf(sb.audio_local_path)}`
        );
      }
      if (sb.narration_audio_local_path) {
        archive.addStorageFile(
          storagePath,
          sb.narration_audio_local_path,
          `media/audio/sb_${sb.id}_narration${extOf(sb.narration_audio_local_path)}`
        );
      }
    }
  }

  // 角色主图
  for (const c of characters) {
    if (c.local_path) {
      archive.addStorageFile(
        storagePath,
        c.local_path,
        `media/characters/char_${c.id}${extOf(c.local_path)}`
      );
    }
  }

  // 场景主图
  for (const s of dedupedScenes) {
    if (s.local_path) {
      archive.addStorageFile(
        storagePath,
        s.local_path,
        `media/scenes/scene_${s.id}${extOf(s.local_path)}`
      );
    }
  }

  // 分镜自由参考图（独立于 image_generations）
  for (const { localRelPath, zipPath } of referenceFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 场景全景图
  for (const { localRelPath, zipPath } of panoramaFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  // 道具主图
  for (const p of props) {
    if (p.local_path) {
      archive.addStorageFile(
        storagePath,
        p.local_path,
        `media/props/prop_${p.id}${extOf(p.local_path)}`
      );
    }
  }

  // extra_images（角色/场景/道具的额外参考图）
  for (const { localRelPath, zipPath } of extraFilesToPack) {
    archive.addStorageFile(storagePath, localRelPath, zipPath);
  }

  log.info('Drama exported', {
    drama_id: dramaId,
    title: drama.title,
    source_original_count: sourceIntakeExport.manifest.sources.length,
    export_file_count: archive.fileCount,
    export_uncompressed_bytes: archive.totalUncompressedBytes,
  });
  return { buffer: archive.toBuffer(), title: drama.title };
}

module.exports = {
  DEFAULT_EXPORT_LIMITS,
  DramaExportError,
  exportDrama,
  normalizeExportLimits,
  resolveExportLimits,
};
