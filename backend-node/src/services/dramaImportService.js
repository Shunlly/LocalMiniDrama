// 项目导入服务：解析 ZIP，还原剧集数据和媒体文件
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { spawnSync } = require('child_process');
const { createHash, randomUUID } = require('crypto');
const { getFfprobePath } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const storyboardService = require('./storyboardService');
const uploadService = require('./uploadService');
const sourceMediaExtractionService = require('./sourceMediaExtractionService');
const { IMPORT_IMAGE_VALIDATOR_FLAG } = require('./importImageValidator');
const { validateFreeCanvas, badRequest: freeCanvasBadRequest } = require('./freeCanvasValidation');

const DEFAULT_IMPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 5000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxMaterializedBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxProjectJsonBytes: 8 * 1024 * 1024,
  maxPathBytes: 512,
  maxPathDepth: 32,
  maxSourceOriginals: 1000,
  maxCharacters: 1000,
  maxEpisodes: 1000,
  maxScenes: 5000,
  maxProps: 5000,
  maxStoryboardsPerEpisode: 2000,
  maxStoryboards: 20000,
  maxFramePromptsPerStoryboard: 100,
  maxFramePrompts: 50000,
  maxImageGenerationsPerStoryboard: 500,
  maxImageGenerations: 50000,
  maxVideoGenerations: 20000,
  maxExtraImagesPerEntity: 100,
  maxStoryboardReferenceImages: 10,
  maxStoryboardCharacters: 500,
  maxStoryboardProps: 1000,
  maxMediaReferences: 100000,
  maxTotalEntities: 100000,
  maxEpisodeCharacterLinks: 100000,
  maxStoryboardCharacterLinks: 100000,
  maxStoryboardPropLinks: 100000,
  maxTotalRelationships: 250000,
  maxImagePixels: 64 * 1024 * 1024,
  maxImageFrames: 120,
  maxMediaStreams: 8,
  maxMediaDurationSeconds: 6 * 60 * 60,
  diskReserveBytes: 512 * 1024 * 1024,
});

const SOURCE_INTAKE_MANIFEST_VERSION = 1;
const FREE_CANVAS_IMPORT_MANIFEST_VERSION = 1;
const FREE_CANVAS_VIDEO_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'cancelled']);
const FREE_CANVAS_MEDIA_FORMATS = Object.freeze({
  images: new Set(['jpeg', 'png', 'webp', 'gif']),
  videos: new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']),
});
const MAX_SOURCE_METADATA_BYTES = 64 * 1024;
const SOURCE_TYPES = new Set(['novel', 'outline', 'script', 'storyboard', 'comic', 'transcript']);
const SENSITIVE_SOURCE_METADATA_KEY = /api[_-]?key|access[_-]?key|client[_-]?secret|secret|password|token|authorization|cookie|private[_-]?key|raw[_-]?text|full[_-]?text|extracted[_-]?text|ocr[_-]?text|transcript/i;

const IMPORT_MEDIA_EXTENSIONS = Object.freeze({
  characters: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  scenes: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  props: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  images: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  references: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
  videos: new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']),
});

const IMPORT_IMAGE_CATEGORIES = Object.freeze(['characters', 'scenes', 'props', 'images', 'references']);
const IMPORT_AV_CATEGORIES = Object.freeze(['videos', 'audio']);
const IMAGE_VALIDATION_TIMEOUT_MS = 2 * 60 * 1000;
const FFPROBE_VALIDATION_TIMEOUT_MS = 30 * 1000;
const IMPORT_MEDIA_VALIDATION_TIMEOUT_MS = 2 * 60 * 1000;
const IMPORT_MEDIA_CONTAINERS = Object.freeze({
  '.mp4': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.mov': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.webm': new Set(['matroska', 'webm']),
  '.mkv': new Set(['matroska', 'webm']),
  '.avi': new Set(['avi']),
  '.mp3': new Set(['mp3']),
  '.wav': new Set(['wav']),
  '.m4a': new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  '.aac': new Set(['aac']),
  '.ogg': new Set(['ogg']),
  '.flac': new Set(['flac']),
});
const IMPORT_MEDIA_MIME_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
});

class DramaImportError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DramaImportError';
    this.code = code;
  }
}

function importError(code, message, cause) {
  return new DramaImportError(code, message, cause);
}

function normalizeImportLimits(overrides = {}) {
  const limits = { ...DEFAULT_IMPORT_LIMITS };
  for (const key of Object.keys(DEFAULT_IMPORT_LIMITS)) {
    if (overrides[key] === undefined) continue;
    const value = Number(overrides[key]);
    if (!Number.isSafeInteger(value) || value <= 0) throw importError('INVALID_LIMIT', 'ZIP 格式限制必须是正整数');
    limits[key] = value;
  }
  return limits;
}

function structuredImportError(code, message, details, statusCode = 400) {
  const error = importError(code, message);
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function importArrayField(container, field, location = field) {
  const value = container?.[field];
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw structuredImportError(
      'INVALID_IMPORT_STRUCTURE',
      `project.json field ${location} must be an array.`,
      { field: location, expected: 'array' }
    );
  }
  return value;
}

function assertImportRecord(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw structuredImportError(
      'INVALID_IMPORT_STRUCTURE',
      `project.json entry ${location} must be an object.`,
      { field: location, expected: 'object' }
    );
  }
}

function assertImportLimit(code, kind, name, actual, limit) {
  if (actual <= limit) return;
  throw structuredImportError(
    code,
    `Project import ${kind} ${name} exceeds the configured limit.`,
    { kind, name, actual, limit },
    413
  );
}

function addBoundedCount(current, increment, code, kind, name, limit) {
  const next = current + increment;
  if (!Number.isSafeInteger(next)) {
    throw structuredImportError(
      code,
      `Project import ${kind} ${name} exceeds the safe integer range.`,
      { kind, name, actual: 'overflow', limit },
      413
    );
  }
  assertImportLimit(code, kind, name, next, limit);
  return next;
}

function validateImportComplexity(data, limits) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw structuredImportError(
      'INVALID_IMPORT_STRUCTURE',
      'project.json root must be an object.',
      { field: 'project.json', expected: 'object' }
    );
  }

  const characters = importArrayField(data, 'characters');
  const episodes = importArrayField(data, 'episodes');
  const scenes = importArrayField(data, 'scenes');
  const props = importArrayField(data, 'props');
  assertImportLimit('IMPORT_ENTITY_LIMIT_EXCEEDED', 'entity', 'characters', characters.length, limits.maxCharacters);
  assertImportLimit('IMPORT_ENTITY_LIMIT_EXCEEDED', 'entity', 'episodes', episodes.length, limits.maxEpisodes);
  assertImportLimit('IMPORT_ENTITY_LIMIT_EXCEEDED', 'entity', 'scenes', scenes.length, limits.maxScenes);
  assertImportLimit('IMPORT_ENTITY_LIMIT_EXCEEDED', 'entity', 'props', props.length, limits.maxProps);

  const counts = {
    storyboards: 0,
    framePrompts: 0,
    imageGenerations: 0,
    videoGenerations: 0,
    mediaReferences: 0,
    storyboardCharacterLinks: 0,
    storyboardPropLinks: 0,
  };

  function addMediaReferences(count, location) {
    counts.mediaReferences = addBoundedCount(
      counts.mediaReferences,
      count,
      'IMPORT_MEDIA_REFERENCE_LIMIT_EXCEEDED',
      'media_reference',
      location,
      limits.maxMediaReferences
    );
  }

  function inspectEntityMedia(entity, location, primaryFields) {
    assertImportRecord(entity, location);
    for (const field of primaryFields) {
      if (entity[field]) addMediaReferences(1, 'total');
    }
    const extraImages = importArrayField(entity, 'extra_image_files', `${location}.extra_image_files`);
    assertImportLimit(
      'IMPORT_MEDIA_REFERENCE_LIMIT_EXCEEDED',
      'media_reference',
      `${location}.extra_image_files`,
      extraImages.length,
      limits.maxExtraImagesPerEntity
    );
    addMediaReferences(extraImages.length, 'total');
  }

  characters.forEach((character, index) => {
    inspectEntityMedia(character, `characters[${index}]`, ['image_file']);
  });
  scenes.forEach((scene, index) => {
    inspectEntityMedia(scene, `scenes[${index}]`, ['image_file', 'panorama_image_file']);
    if (scene.panorama_image_file || scene.panorama_image_url) {
      counts.imageGenerations = addBoundedCount(
        counts.imageGenerations,
        1,
        'IMPORT_ENTITY_LIMIT_EXCEEDED',
        'entity',
        'image_generations',
        limits.maxImageGenerations
      );
    }
  });
  props.forEach((prop, index) => {
    inspectEntityMedia(prop, `props[${index}]`, ['image_file']);
  });

  episodes.forEach((episode, episodeIndex) => {
    assertImportRecord(episode, `episodes[${episodeIndex}]`);
    const storyboards = importArrayField(
      episode,
      'storyboards',
      `episodes[${episodeIndex}].storyboards`
    );
    assertImportLimit(
      'IMPORT_ENTITY_LIMIT_EXCEEDED',
      'entity',
      `episodes[${episodeIndex}].storyboards`,
      storyboards.length,
      limits.maxStoryboardsPerEpisode
    );
    counts.storyboards = addBoundedCount(
      counts.storyboards,
      storyboards.length,
      'IMPORT_ENTITY_LIMIT_EXCEEDED',
      'entity',
      'storyboards',
      limits.maxStoryboards
    );

    storyboards.forEach((storyboard, storyboardIndex) => {
      const location = `episodes[${episodeIndex}].storyboards[${storyboardIndex}]`;
      assertImportRecord(storyboard, location);

      const framePrompts = importArrayField(storyboard, 'frame_prompts', `${location}.frame_prompts`);
      assertImportLimit(
        'IMPORT_ENTITY_LIMIT_EXCEEDED',
        'entity',
        `${location}.frame_prompts`,
        framePrompts.length,
        limits.maxFramePromptsPerStoryboard
      );
      framePrompts.forEach((item, index) => assertImportRecord(item, `${location}.frame_prompts[${index}]`));
      counts.framePrompts = addBoundedCount(
        counts.framePrompts,
        framePrompts.length,
        'IMPORT_ENTITY_LIMIT_EXCEEDED',
        'entity',
        'frame_prompts',
        limits.maxFramePrompts
      );

      const imageGenerations = importArrayField(
        storyboard,
        'image_generations',
        `${location}.image_generations`
      );
      assertImportLimit(
        'IMPORT_ENTITY_LIMIT_EXCEEDED',
        'entity',
        `${location}.image_generations`,
        imageGenerations.length,
        limits.maxImageGenerationsPerStoryboard
      );
      imageGenerations.forEach((item, index) => {
        assertImportRecord(item, `${location}.image_generations[${index}]`);
        if (item.zip_file || item.file) addMediaReferences(1, 'total');
      });
      const legacyImageGeneration = imageGenerations.length === 0 && storyboard.image_file ? 1 : 0;
      if (legacyImageGeneration) addMediaReferences(1, 'total');
      counts.imageGenerations = addBoundedCount(
        counts.imageGenerations,
        imageGenerations.length + legacyImageGeneration,
        'IMPORT_ENTITY_LIMIT_EXCEEDED',
        'entity',
        'image_generations',
        limits.maxImageGenerations
      );

      const referenceImages = importArrayField(
        storyboard,
        'reference_images',
        `${location}.reference_images`
      );
      assertImportLimit(
        'IMPORT_MEDIA_REFERENCE_LIMIT_EXCEEDED',
        'media_reference',
        `${location}.reference_images`,
        referenceImages.length,
        limits.maxStoryboardReferenceImages
      );
      addMediaReferences(referenceImages.length, 'total');

      const characterIndices = importArrayField(
        storyboard,
        'character_indices',
        `${location}.character_indices`
      );
      assertImportLimit(
        'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
        'relationship',
        `${location}.characters`,
        characterIndices.length,
        limits.maxStoryboardCharacters
      );
      counts.storyboardCharacterLinks = addBoundedCount(
        counts.storyboardCharacterLinks,
        characterIndices.length,
        'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
        'relationship',
        'storyboard_characters',
        limits.maxStoryboardCharacterLinks
      );

      const propIndices = importArrayField(storyboard, 'prop_indices', `${location}.prop_indices`);
      assertImportLimit(
        'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
        'relationship',
        `${location}.props`,
        propIndices.length,
        limits.maxStoryboardProps
      );
      counts.storyboardPropLinks = addBoundedCount(
        counts.storyboardPropLinks,
        propIndices.length,
        'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
        'relationship',
        'storyboard_props',
        limits.maxStoryboardPropLinks
      );

      for (const field of ['audio_file', 'narration_audio_file', 'video_file']) {
        if (storyboard[field]) addMediaReferences(1, 'total');
      }
      if (storyboard.video_file) {
        counts.videoGenerations = addBoundedCount(
          counts.videoGenerations,
          1,
          'IMPORT_ENTITY_LIMIT_EXCEEDED',
          'entity',
          'video_generations',
          limits.maxVideoGenerations
        );
      }
    });
  });

  const episodeCharacterLinks = characters.length * episodes.length;
  if (!Number.isSafeInteger(episodeCharacterLinks)) {
    throw structuredImportError(
      'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
      'Project import relationship episode_characters exceeds the safe integer range.',
      {
        kind: 'relationship',
        name: 'episode_characters',
        actual: 'overflow',
        limit: limits.maxEpisodeCharacterLinks,
      },
      413
    );
  }
  assertImportLimit(
    'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
    'relationship',
    'episode_characters',
    episodeCharacterLinks,
    limits.maxEpisodeCharacterLinks
  );

  const totalRelationships = episodeCharacterLinks
    + counts.storyboardCharacterLinks
    + counts.storyboardPropLinks;
  assertImportLimit(
    'IMPORT_RELATIONSHIP_LIMIT_EXCEEDED',
    'relationship',
    'total',
    totalRelationships,
    limits.maxTotalRelationships
  );

  const sourceOriginals = Array.isArray(data.source_intake?.sources)
    ? data.source_intake.sources.length
    : 0;
  const totalEntities = 1
    + sourceOriginals
    + characters.length
    + episodes.length
    + scenes.length
    + props.length
    + counts.storyboards
    + counts.framePrompts
    + counts.imageGenerations
    + counts.videoGenerations;
  assertImportLimit(
    'IMPORT_TOTAL_ENTITY_LIMIT_EXCEEDED',
    'entity',
    'total',
    totalEntities,
    limits.maxTotalEntities
  );

  return {
    entities: {
      total: totalEntities,
      characters: characters.length,
      episodes: episodes.length,
      scenes: scenes.length,
      props: props.length,
      storyboards: counts.storyboards,
      frame_prompts: counts.framePrompts,
      image_generations: counts.imageGenerations,
      video_generations: counts.videoGenerations,
      source_originals: sourceOriginals,
    },
    relationships: {
      total: totalRelationships,
      episode_characters: episodeCharacterLinks,
      storyboard_characters: counts.storyboardCharacterLinks,
      storyboard_props: counts.storyboardPropLinks,
    },
    media_references: counts.mediaReferences,
  };
}

function resolveSourceOriginalQuotaBytes(cfg, options = {}) {
  const supplied = options.sourceOriginalQuotaBytes ?? options.quotaBytes
    ?? cfg?.storage?.story_source_original_quota_bytes
    ?? process.env.LOCALMINIDRAMA_SOURCE_ORIGINAL_QUOTA_BYTES
    ?? uploadService.DEFAULT_STORY_SOURCE_ORIGINAL_QUOTA_BYTES;
  const quotaBytes = Number(supplied);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
    throw importError(
      'INVALID_SOURCE_ORIGINAL_QUOTA',
      'Project import source-original quota must be a positive integer.'
    );
  }
  return quotaBytes;
}

function getStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureSafeDirectoryInside(root, directory) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体目录会逃逸 storage');
  }
  const rootReal = fs.realpathSync(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体目录不能包含符号链接');
    }
    const currentReal = fs.realpathSync(current);
    const realRelation = path.relative(rootReal, currentReal);
    if (realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation)) {
      throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体目录会逃逸 storage');
    }
  }
}

function removeEmptyParentsInside(root, startDirectory) {
  const resolvedRoot = path.resolve(root);
  let current = path.resolve(startDirectory);
  while (current !== resolvedRoot) {
    const relation = path.relative(resolvedRoot, current);
    if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) return;
    try {
      fs.rmdirSync(current);
    } catch (error) {
      if (['ENOENT'].includes(error.code)) {
        current = path.dirname(current);
        continue;
      }
      if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return;
      throw error;
    }
    current = path.dirname(current);
  }
}

/**
 * 解析 ZIP Buffer，返回 project.json 内容和媒体文件 Map
 * @returns {{ data: object, files: Map<string,Buffer> }}
 */
function readArchiveBuffer(source, limits) {
  if (Buffer.isBuffer(source)) {
    if (source.length > limits.maxArchiveBytes) throw importError('ARCHIVE_TOO_LARGE', 'ZIP 格式不安全：上传文件超过大小限制');
    return source;
  }
  if (typeof source !== 'string' || !source) throw importError('INVALID_ARCHIVE', 'ZIP 格式不正确：缺少归档数据');
  let fd;
  try {
    const before = fs.lstatSync(source);
    if (before.isSymbolicLink() || !before.isFile()) throw importError('INVALID_ARCHIVE', 'ZIP 格式不安全：上传文件不是普通文件');
    if (before.size > limits.maxArchiveBytes) throw importError('ARCHIVE_TOO_LARGE', 'ZIP 格式不安全：上传文件超过大小限制');
    fd = fs.openSync(source, 'r');
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw importError('ARCHIVE_CHANGED', 'ZIP 格式不安全：上传文件在读取时发生变化');
    }
    const buffer = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytes <= 0) throw importError('INVALID_ARCHIVE', 'ZIP 格式不正确：上传文件已截断');
      offset += bytes;
    }
    return buffer;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function validateZipEntryName(name, limits, isDirectory = false) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw importError('UNSAFE_ARCHIVE_PATH', 'ZIP 格式不安全：条目路径无效');
  }
  const normalizedName = isDirectory ? name.replace(/\/+$/, '') : name;
  const segments = normalizedName.split('/');
  if (!normalizedName || segments.length > limits.maxPathDepth || segments.some((part) => !part || part === '.' || part === '..')) {
    throw importError('UNSAFE_ARCHIVE_PATH', 'ZIP 格式不安全：条目路径会逃逸');
  }
  if (Buffer.byteLength(name, 'utf8') > limits.maxPathBytes || path.posix.normalize(normalizedName) !== normalizedName) {
    throw importError('UNSAFE_ARCHIVE_PATH', 'ZIP 格式不安全：条目路径过长或未规范化');
  }
  return normalizedName;
}

function assertRegularZipEntry(entry) {
  const attributes = Number(entry.attr || 0) >>> 0;
  const unixMode = (attributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  if (!entry.isDirectory && fileType !== 0 && fileType !== 0x8000) {
    throw importError('UNSAFE_ARCHIVE_ENTRY', 'ZIP 格式不安全：不允许符号链接或特殊文件');
  }
}

class LazyZipFiles {
  constructor(entries, limits) {
    this.entries = entries;
    this.limits = limits;
    this.materializedBytes = 0;
    this.materializationBudget = limits.maxMaterializedBytes;
  }

  setMaterializationBudget(bytes) {
    this.materializationBudget = Math.max(0, Math.min(this.limits.maxMaterializedBytes, Number(bytes)));
  }

  read(name) {
    if (!name) return null;
    const safeName = validateZipEntryName(String(name), this.limits);
    const entry = this.entries.get(safeName);
    if (!entry) return null;
    let data;
    try { data = entry.getData(); }
    catch (error) { throw importError('INVALID_ARCHIVE', 'ZIP 格式损坏：条目无法安全解压', error); }
    if (!Buffer.isBuffer(data) || data.length !== Number(entry.header.size) || data.length > this.limits.maxEntryBytes) {
      throw importError('INVALID_ARCHIVE', 'ZIP 格式损坏：条目解压大小不一致');
    }
    return data;
  }

  reserveMaterialized(bytes) {
    this.materializedBytes += Number(bytes);
    if (!Number.isSafeInteger(this.materializedBytes) || this.materializedBytes > this.materializationBudget) {
      throw importError('MATERIALIZED_SIZE_LIMIT', 'ZIP 格式不安全：导入媒体超过磁盘写入预算');
    }
  }
}

function parseZip(zipSource, options = {}) {
  const limits = normalizeImportLimits(options.limits || options);
  const zipBuffer = readArchiveBuffer(zipSource, limits);
  let zip;
  try {
    zip = new AdmZip(zipBuffer, { readEntries: false });
  } catch (e) {
    throw importError('INVALID_ARCHIVE', 'ZIP 文件损坏，无法解析', e);
  }

  const entryCount = zip.getEntryCount();
  if (!Number.isSafeInteger(entryCount) || entryCount < 1 || entryCount > limits.maxEntries) {
    throw importError('ENTRY_LIMIT_EXCEEDED', 'ZIP 格式不安全：条目数量超过限制');
  }
  const entries = zip.getEntries();
  const filesByName = new Map();
  const collisionNames = new Set();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    assertRegularZipEntry(entry);
    const name = validateZipEntryName(entry.entryName, limits, entry.isDirectory);
    const collisionKey = name.normalize('NFC').toLowerCase();
    if (collisionNames.has(collisionKey)) throw importError('DUPLICATE_ARCHIVE_PATH', 'ZIP 格式不安全：存在重复条目路径');
    collisionNames.add(collisionKey);
    if (entry.isDirectory) continue;
    const size = Number(entry.header.size);
    const compressedSize = Number(entry.header.compressedSize);
    const method = Number(entry.header.method);
    if ((Number(entry.header.flags) & 0x0001) !== 0 || ![0, 8].includes(method)) {
      throw importError('UNSUPPORTED_ARCHIVE', 'ZIP 格式不安全：不支持加密或未知压缩算法');
    }
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(compressedSize) || size < 0 || compressedSize < 0 || size > limits.maxEntryBytes) {
      throw importError('ENTRY_SIZE_LIMIT', 'ZIP 格式不安全：单个条目超过大小限制');
    }
    if (size > 0 && compressedSize === 0) throw importError('INVALID_ARCHIVE', 'ZIP 格式不安全：压缩条目大小无效');
    if (compressedSize > 0 && size / compressedSize > limits.maxCompressionRatio) {
      throw importError('COMPRESSION_RATIO_LIMIT', 'ZIP 格式不安全：条目压缩率超过限制');
    }
    totalUncompressedBytes += size;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw importError('TOTAL_SIZE_LIMIT', 'ZIP 格式不安全：解压总量超过限制');
    }
    filesByName.set(name, entry);
  }

  const projectEntry = filesByName.get('project.json');
  if (!projectEntry) {
    throw importError('PROJECT_JSON_MISSING', 'ZIP 格式不正确：缺少 project.json');
  }
  if (Number(projectEntry.header.size) > limits.maxProjectJsonBytes) {
    throw importError('PROJECT_JSON_TOO_LARGE', 'ZIP 格式不安全：project.json 超过大小限制');
  }

  let data;
  try {
    const projectData = projectEntry.getData();
    if (projectData.length !== Number(projectEntry.header.size)) throw new Error('size mismatch');
    data = JSON.parse(projectData.toString('utf8'));
  } catch (e) {
    throw importError('INVALID_PROJECT_JSON', 'project.json 格式错误，无法解析 JSON', e);
  }

  if (!data.drama || !data.drama.title) {
    throw new Error('project.json 格式不正确：缺少 drama.title 字段');
  }

  const complexity = validateImportComplexity(data, limits);

  filesByName.delete('project.json');
  return {
    data,
    files: new LazyZipFiles(filesByName, limits),
    limits,
    archiveBytes: zipBuffer.length,
    totalUncompressedBytes,
    complexity,
  };
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
    throw importError('INVALID_SOURCE_MANIFEST', 'Source Intake manifest must be an object.');
  }
  if (Number(manifest.manifest_version) !== SOURCE_INTAKE_MANIFEST_VERSION || manifest.hash_algorithm !== 'sha256') {
    throw importError('UNSUPPORTED_SOURCE_MANIFEST', 'Source Intake manifest version or hash algorithm is unsupported.');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length > limits.maxSourceOriginals) {
    throw importError('SOURCE_MANIFEST_LIMIT', 'Source Intake manifest contains too many source originals.');
  }

  const sourceRefs = new Set();
  const archivePaths = new Set();
  return manifest.sources.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw importError('INVALID_SOURCE_MANIFEST', `Source Intake entry ${index + 1} is invalid.`);
    }
    const sourceRef = String(source.source_ref || '');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sourceRef) || sourceRefs.has(sourceRef)) {
      throw importError('INVALID_SOURCE_MANIFEST', 'Source Intake source_ref is invalid or duplicated.');
    }
    sourceRefs.add(sourceRef);

    const original = source.original;
    if (!original || typeof original !== 'object' || Array.isArray(original)) {
      throw importError('INVALID_SOURCE_MANIFEST', `Source Intake ${sourceRef} has no original descriptor.`);
    }
    const archivePath = validateZipEntryName(String(original.archive_path || ''), limits);
    const extension = path.posix.extname(archivePath).toLowerCase();
    const expectedPath = `source-intake/originals/${sourceRef}/original${extension}`;
    if (!extension || archivePath !== expectedPath || archivePaths.has(archivePath)) {
      throw importError('UNSAFE_SOURCE_ORIGINAL_PATH', 'Source Intake original path is unsafe or mapped more than once.');
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
      throw importError('INVALID_SOURCE_ORIGINAL_INTEGRITY', 'Source Intake original size or SHA-256 is invalid.');
    }
    if (
      mime.length > 200 ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)
    ) {
      throw importError('INVALID_SOURCE_ORIGINAL_MIME', 'Source Intake original MIME type is invalid.');
    }

    const sourceType = String(source.source_type || '').trim().toLowerCase();
    if (!SOURCE_TYPES.has(sourceType)) {
      throw importError('INVALID_SOURCE_MANIFEST', `Source Intake ${sourceRef} has an unsupported source type.`);
    }
    const metadata = sanitizeSourceMetadataNode(source.metadata);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw importError('INVALID_SOURCE_MANIFEST', `Source Intake ${sourceRef} metadata is invalid.`);
    }
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_SOURCE_METADATA_BYTES) {
      throw importError('SOURCE_METADATA_LIMIT', `Source Intake ${sourceRef} metadata exceeds the safe import limit.`);
    }
    const contentHash = String(source.content_hash || '').toLowerCase();
    if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash)) {
      throw importError('INVALID_SOURCE_MANIFEST', `Source Intake ${sourceRef} content hash is invalid.`);
    }

    return {
      source_ref: sourceRef,
      source_type: sourceType,
      title: String(source.title || 'Imported source').trim().slice(0, 500) || 'Imported source',
      content_hash: contentHash || null,
      metadata,
      created_at: normalizeImportedDate(source.created_at, now),
      original: { archive_path: archivePath, extension, size, sha256, mime },
    };
  });
}

function restoreSourceIntakeOriginals(db, storagePath, files, dramaId, entries, options = {}) {
  for (const entry of entries) {
    const buffer = files.read(entry.original.archive_path);
    if (!buffer) {
      throw importError('SOURCE_ORIGINAL_MISSING', `Source Intake original ${entry.source_ref} is missing from the archive.`);
    }
    if (buffer.length !== entry.original.size) {
      throw importError('SOURCE_ORIGINAL_SIZE_MISMATCH', `Source Intake original ${entry.source_ref} failed its size check.`);
    }
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== entry.original.sha256) {
      throw importError('SOURCE_ORIGINAL_HASH_MISMATCH', `Source Intake original ${entry.source_ref} failed its SHA-256 check.`);
    }

    let descriptor;
    try {
      descriptor = sourceMediaExtractionService.inspectUploadedFile({
        buffer,
        originalname: `original${entry.original.extension}`,
        mimetype: entry.original.mime,
        size: buffer.length,
      });
    } catch (error) {
      throw importError(
        'SOURCE_ORIGINAL_MIME_MISMATCH',
        `Source Intake original ${entry.source_ref} does not match its path or MIME type.`,
        error
      );
    }

    files.reserveMaterialized(buffer.length);
    const metadata = {
      ...entry.metadata,
      imported_via: 'project_archive',
      archive_source_ref: entry.source_ref,
    };
    const sourceInfo = db.prepare(
      `INSERT INTO story_sources
       (drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`
    ).run(
      dramaId,
      entry.source_type,
      entry.title,
      entry.content_hash,
      JSON.stringify(metadata),
      entry.created_at
    );
    const sourceId = Number(sourceInfo.lastInsertRowid);
    const artifact = uploadService.persistStorySourceOriginal(
      storagePath,
      dramaId,
      sourceId,
      {
        buffer,
        extension: descriptor.extension,
        format: descriptor.format,
        mime: descriptor.mime,
      },
      {
        maxBytes: sourceMediaExtractionService.MAX_SOURCE_UPLOAD_BYTES,
        quotaBytes: options.quotaBytes,
        reserveBytes: options.reserveBytes,
        getAvailableBytes: options.getAvailableBytes,
      }
    );
    metadata.original_file = artifact.metadata;
    db.prepare('UPDATE story_sources SET metadata = ? WHERE id = ?')
      .run(JSON.stringify(metadata), sourceId);
  }
}

/**
 * 生成不重名的剧集标题
 */
function resolveTitle(db, baseTitle) {
  const existing = db.prepare('SELECT title FROM dramas WHERE deleted_at IS NULL').all().map(r => r.title);
  if (!existing.includes(baseTitle)) return baseTitle;
  let i = 1;
  while (existing.includes(`${baseTitle} 导入${i}`)) i++;
  return `${baseTitle} 导入${i}`;
}

function invalidImportMedia(code, mediaPath, reason, details = null) {
  const limitExceeded = code === 'IMPORT_IMAGE_LIMIT_EXCEEDED';
  return structuredImportError(
    code,
    limitExceeded ? 'ZIP 格式不安全：图片解码资源超过限制' : 'ZIP 格式不安全：媒体内容无效',
    {
      archive_path: mediaPath || null,
      reason: String(reason || 'media validation failed').slice(0, 300),
      ...(details && typeof details === 'object' ? details : {}),
    },
    limitExceeded ? 413 : 400
  );
}

function createImageValidatorProcessSpec({
  execPath = process.execPath,
  electronVersion = process.versions.electron,
  defaultApp = process.defaultApp === true,
  appEntry = process.argv[1],
  environment = process.env,
  projectPath,
  maxImagePixels,
  maxImageFrames,
}) {
  const childEnvironment = { ...environment };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const normalizedAppEntry = String(appEntry || '').trim();
  if (electronVersion && defaultApp && !normalizedAppEntry) {
    const error = new Error('Electron image validation requires an application entry');
    error.code = 'MEDIA_VALIDATION_UNAVAILABLE';
    throw error;
  }
  const validatorArguments = [
    projectPath,
    String(maxImagePixels),
    String(maxImageFrames),
  ];
  return {
    executable: execPath,
    args: electronVersion
      ? [
          ...(defaultApp
            ? [normalizedAppEntry]
            : []),
          IMPORT_IMAGE_VALIDATOR_FLAG,
          ...validatorArguments,
        ]
      : [require.resolve('./importImageValidator'), ...validatorArguments],
    environment: childEnvironment,
  };
}

function validateStagedImages(projectPath, limits) {
  const hasImages = IMPORT_IMAGE_CATEGORIES.some((category) => {
    try {
      return fs.readdirSync(path.join(projectPath, category)).length > 0;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
  if (!hasImages) return [];

  try {
    require.resolve('sharp');
  } catch (error) {
    throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', null, 'Sharp is unavailable');
  }

  let processSpec;
  try {
    processSpec = createImageValidatorProcessSpec({
      projectPath,
      maxImagePixels: limits.maxImagePixels,
      maxImageFrames: limits.maxImageFrames,
    });
  } catch (error) {
    if (error?.code === 'MEDIA_VALIDATION_UNAVAILABLE') {
      throw invalidImportMedia(error.code, null, error.message);
    }
    throw error;
  }
  const result = spawnSync(processSpec.executable, processSpec.args, {
    encoding: 'utf8',
    env: processSpec.environment,
    maxBuffer: 2 * 1024 * 1024,
    timeout: IMAGE_VALIDATION_TIMEOUT_MS,
    windowsHide: true,
  });

  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout || ''));
  } catch (_) {}

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    throw invalidImportMedia(
      timedOut ? 'MEDIA_VALIDATION_TIMEOUT' : 'MEDIA_VALIDATION_UNAVAILABLE',
      payload?.mediaPath,
      timedOut ? 'Sharp image validation timed out' : 'Sharp image validation could not run'
    );
  }
  if (result.status !== 0 || !payload?.ok) {
    const code = ['INVALID_MEDIA_CONTENT', 'IMPORT_IMAGE_LIMIT_EXCEEDED'].includes(payload?.code)
      ? payload.code
      : 'MEDIA_VALIDATION_UNAVAILABLE';
    throw invalidImportMedia(code, payload?.mediaPath, payload?.reason, payload?.details);
  }
  if (!Array.isArray(payload.media)) {
    throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', null, 'Sharp image validation returned no metadata');
  }
  return payload.media;
}

function probeDurationSeconds(probe) {
  const candidates = [
    probe?.format?.duration,
    ...(Array.isArray(probe?.streams) ? probe.streams.map((stream) => stream.duration) : []),
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : NaN;
}

function validateContainerBrand(extension, probe, mediaPath) {
  const brand = String(probe?.format?.tags?.major_brand || '').trim().toLowerCase();
  if (extension === '.mov' && brand && brand !== 'qt') {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'QuickTime container brand does not match .mov');
  }
  if (extension === '.mp4' && ['qt', 'm4a', 'm4b', 'm4p'].includes(brand)) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ISO media container brand does not match .mp4');
  }
  if (extension === '.m4a' && brand === 'qt') {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'QuickTime container brand does not match .m4a');
  }
}

function validateStagedAvFile(absolutePath, mediaPath, category, extension, limits, timeoutMs) {
  const result = spawnSync(
    getFfprobePath(),
    [
      '-v', 'error',
      '-count_packets',
      '-show_entries',
      'format=format_name,duration:format_tags=major_brand:stream=index,codec_type,codec_name,width,height,duration,channels,sample_rate,nb_read_packets:stream_disposition=attached_pic',
      '-of', 'json',
      absolutePath,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: Math.max(1, Math.min(FFPROBE_VALIDATION_TIMEOUT_MS, timeoutMs)),
      windowsHide: true,
    }
  );

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    const unavailable = result.error.code === 'ENOENT';
    throw invalidImportMedia(
      unavailable ? 'MEDIA_VALIDATION_UNAVAILABLE' : timedOut ? 'MEDIA_VALIDATION_TIMEOUT' : 'INVALID_MEDIA_CONTENT',
      mediaPath,
      unavailable ? 'ffprobe is unavailable' : timedOut ? 'ffprobe timed out' : 'ffprobe could not inspect media'
    );
  }
  if (result.status !== 0 || String(result.stderr || '').trim()) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ffprobe rejected malformed media');
  }

  let probe;
  try {
    probe = JSON.parse(result.stdout || '{}');
  } catch (_) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'ffprobe returned invalid metadata');
  }

  const formatNames = String(probe?.format?.format_name || '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const allowedContainers = IMPORT_MEDIA_CONTAINERS[extension];
  if (!allowedContainers || !formatNames.some((name) => allowedContainers.has(name))) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'container does not match the media extension');
  }
  validateContainerBrand(extension, probe, mediaPath);

  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  if (streams.length < 1 || streams.length > limits.maxMediaStreams) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media stream count is outside the allowed range', {
      actual: streams.length,
      limit: limits.maxMediaStreams,
      kind: 'streams',
    });
  }
  if (streams.some((stream) => !['video', 'audio'].includes(stream.codec_type))) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media contains a disallowed stream type');
  }
  if (streams.some((stream) => {
    const packetCount = Number(stream.nb_read_packets);
    return !String(stream.codec_name || '').trim() || !Number.isSafeInteger(packetCount) || packetCount < 1;
  })) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media stream has no decodable packets');
  }

  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  if (category === 'videos') {
    if (
      videoStreams.length !== 1 ||
      Number(videoStreams[0]?.disposition?.attached_pic || 0) !== 0 ||
      !Number.isSafeInteger(Number(videoStreams[0]?.width)) || Number(videoStreams[0]?.width) < 1 ||
      !Number.isSafeInteger(Number(videoStreams[0]?.height)) || Number(videoStreams[0]?.height) < 1
    ) {
      throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'video must contain exactly one visual stream');
    }
  } else if (videoStreams.length !== 0 || audioStreams.length !== 1 || streams.length !== 1) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'audio must contain exactly one audio stream');
  }

  if (audioStreams.some((stream) => {
    const channels = Number(stream.channels);
    const sampleRate = Number(stream.sample_rate);
    return (
      !Number.isSafeInteger(channels) || channels < 1 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 1
    );
  })) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'audio stream metadata is invalid');
  }
  if (extension === '.webm') {
    const webmVideoCodecs = new Set(['vp8', 'vp9', 'av1']);
    const webmAudioCodecs = new Set(['vorbis', 'opus']);
    if (
      videoStreams.some((stream) => !webmVideoCodecs.has(stream.codec_name)) ||
      audioStreams.some((stream) => !webmAudioCodecs.has(stream.codec_name))
    ) {
      throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'WebM contains a codec outside the WebM profile');
    }
  }

  const duration = probeDurationSeconds(probe);
  if (!Number.isFinite(duration) || duration <= 0 || duration > limits.maxMediaDurationSeconds) {
    throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media duration is outside the allowed range', {
      actual: Number.isFinite(duration) ? duration : null,
      limit: limits.maxMediaDurationSeconds,
      kind: 'duration_seconds',
    });
  }
  return {
    format: extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension.slice(1),
    mimeType: IMPORT_MEDIA_MIME_TYPES[extension] || null,
    width: category === 'videos' ? Number(videoStreams[0].width) : null,
    height: category === 'videos' ? Number(videoStreams[0].height) : null,
    duration,
  };
}

function validateStagedImportMedia(stagingRoot, projectDir, limits) {
  const deadline = Date.now() + IMPORT_MEDIA_VALIDATION_TIMEOUT_MS;
  const resolvedStagingRoot = path.resolve(stagingRoot);
  const projectPath = path.resolve(stagingRoot, ...String(projectDir || '').split('/'));
  const relation = path.relative(resolvedStagingRoot, projectPath);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体校验目录会逃逸 staging');
  }

  const trustedMetadata = new Map();
  for (const image of validateStagedImages(projectPath, limits)) {
    if (
      !image || typeof image !== 'object' || typeof image.mediaPath !== 'string'
      || !FREE_CANVAS_MEDIA_FORMATS.images.has(image.format)
      || !Number.isSafeInteger(image.width) || image.width <= 0
      || !Number.isSafeInteger(image.height) || image.height <= 0
      || typeof image.mimeType !== 'string'
    ) {
      throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', image?.mediaPath, 'Sharp returned invalid image metadata');
    }
    const imageAbsolutePath = path.resolve(projectPath, ...image.mediaPath.split('/'));
    const imageRelation = path.relative(projectPath, imageAbsolutePath);
    if (!imageRelation || imageRelation.startsWith(`..${path.sep}`) || path.isAbsolute(imageRelation)) {
      throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', image.mediaPath, 'Sharp returned an unsafe image path');
    }
    trustedMetadata.set(
      `${String(projectDir).replace(/\\/g, '/')}/${image.mediaPath}`,
      {
        format: image.format,
        mimeType: image.mimeType,
        fileSize: fs.statSync(imageAbsolutePath).size,
        width: image.width,
        height: image.height,
        duration: null,
      }
    );
  }
  for (const category of IMPORT_AV_CATEGORIES) {
    const directory = path.join(projectPath, category);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const mediaPath = `${category}/${entry.name}`;
      if (!entry.isFile()) {
        throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media staging entry is not a regular file');
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!IMPORT_MEDIA_EXTENSIONS[category]?.has(extension)) {
        throw invalidImportMedia('INVALID_MEDIA_CONTENT', mediaPath, 'media extension is not allowed');
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw invalidImportMedia('MEDIA_VALIDATION_TIMEOUT', mediaPath, 'import media validation timed out');
      }
      const metadata = validateStagedAvFile(
        path.join(directory, entry.name),
        mediaPath,
        category,
        extension,
        limits,
        remainingMs
      );
      trustedMetadata.set(
        `${String(projectDir).replace(/\\/g, '/')}/${mediaPath}`,
        { ...metadata, fileSize: fs.statSync(path.join(directory, entry.name)).size }
      );
    }
  }
  return trustedMetadata;
}

function applyTrustedImportedAssetMetadata(db, dramaId, trustedMetadata) {
  if (!(trustedMetadata instanceof Map) || trustedMetadata.size === 0) return;
  const update = db.prepare(
    `UPDATE assets
     SET file_size = ?, mime_type = ?, width = ?, height = ?, duration = ?
     WHERE drama_id = ? AND local_path = ? AND deleted_at IS NULL`
  );
  for (const [localPath, metadata] of trustedMetadata) {
    update.run(
      metadata.fileSize,
      metadata.mimeType,
      metadata.width,
      metadata.height,
      metadata.duration,
      dramaId,
      localPath
    );
  }
}

/**
 * 保存媒体文件到 storage，返回相对路径
 * @param {string} projectDir 如 projects/0001_20250324_剧名，与工程内其它媒体一致
 */
function saveMediaFile(storagePath, projectDir, category, files, zipPath, prefix) {
  if (!zipPath) return null;
  const buf = files.read(zipPath);
  if (!buf) return null;
  const ext = path.extname(String(zipPath)).toLowerCase();
  if (!IMPORT_MEDIA_EXTENSIONS[category]?.has(ext)) {
    throw importError('UNSUPPORTED_MEDIA_TYPE', 'ZIP 格式不安全：媒体扩展名不受支持');
  }
  files.reserveMaterialized(buf.length);
  const categoryPath = path.join(storagePath, projectDir, category);
  const storageRoot = path.resolve(storagePath);
  const resolvedCategory = path.resolve(categoryPath);
  const relation = path.relative(storageRoot, resolvedCategory);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体目标会逃逸 staging');
  }
  ensureDir(categoryPath);
  const name = `${prefix}_${randomUUID().slice(0, 8)}${ext}`;
  const abs = path.join(categoryPath, name);
  fs.writeFileSync(abs, buf, { flag: 'wx' });
  return `${projectDir}/${category}/${name}`.replace(/\\/g, '/');
}

/**
 * 批量保存 extra_image_files 数组，返回本地路径 JSON 字符串
 */
const IMPORT_FIRST_FRAME_TYPES = ['storyboard_first', 'first', 'first_frame'];
const IMPORT_LAST_FRAME_TYPES = ['storyboard_last', 'last', 'tail', 'last_frame'];

/** 老版 ZIP 或未写入 frame_prompts 时，从已导入的首尾帧图生记录回填提示词 */
function restoreFramePromptsFromImageGens(db, sbId, now, log) {
  const insFp = db.prepare(
    'INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const [types, frameType] of [[IMPORT_FIRST_FRAME_TYPES, 'first'], [IMPORT_LAST_FRAME_TYPES, 'last']]) {
    const has = db.prepare('SELECT id FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').get(sbId, frameType);
    if (has) continue;
    const ph = types.map(() => '?').join(',');
    const ig = db.prepare(
      `SELECT prompt FROM image_generations WHERE storyboard_id = ? AND deleted_at IS NULL
       AND frame_type IN (${ph}) AND prompt IS NOT NULL AND TRIM(prompt) != ''
       ORDER BY created_at DESC LIMIT 1`
    ).get(sbId, ...types);
    if (ig?.prompt?.trim()) {
      insFp.run(sbId, frameType, ig.prompt.trim(), null, null, now, now);
      try { log?.info?.('[导入] 从分镜图历史恢复帧提示词', { storyboard_id: sbId, frame_type: frameType }); } catch (_) {}
    }
  }
}

function saveExtraImages(storagePath, projectDir, category, files, zipPaths, prefix) {
  if (!Array.isArray(zipPaths) || zipPaths.length === 0) return null;
  const localPaths = [];
  for (const zipPath of zipPaths) {
    const localPath = saveMediaFile(storagePath, projectDir, category, files, zipPath, prefix);
    if (localPath) localPaths.push(localPath);
  }
  return localPaths.length > 0 ? JSON.stringify(localPaths) : null;
}

function restoreStoryboardReferenceImages(storagePath, projectDir, files, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const restored = [];
  for (let index = 0; index < Math.min(items.length, 10); index++) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const localPath = saveMediaFile(
      storagePath,
      projectDir,
      'references',
      files,
      item.zip_file || item.file,
      'sb_ref_imp'
    );
    if (!localPath) continue;
    restored.push({
      name: String(item.name || item.filename || `参考图 ${index + 1}`).slice(0, 200),
      local_path: localPath,
      image_url: null,
    });
  }
  if (restored.length === 0) return null;
  return storyboardService.normalizeReferenceImages(restored);
}

function freeCanvasManifestArray(value, field) {
  if (!Array.isArray(value)) throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为数组`);
  return value;
}

function freeCanvasManifestId(value, field, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const id = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为正整数`);
  }
  return id;
}

function freeCanvasManifestString(value, field, maxLength, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为受限字符串`);
  }
  return value;
}

function freeCanvasAssetCategory(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为受限字符串`);
  }
  if (value.length > 4096) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为受限字符串`);
  }
  if (!value.trimStart().startsWith('{')) {
    if (value.length <= 128) return value;
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为受限字符串`);
  }
  let metadata;
  try {
    metadata = JSON.parse(value);
  } catch (_) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 包含无效的网络素材元数据`);
  }
  const allowed = new Set([
    'kind',
    'source_provider',
    'source_url',
    'author',
    'license',
    'license_url',
    'commons_title',
    'commons_page_id',
    'commons_revision_timestamp',
    'commons_sha1',
    'resolved_download_url',
    'content_sha256',
  ]);
  if (metadata?.kind !== 'wikimedia_commons' && value.length <= 128) return value;
  if (
    !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || Object.keys(metadata).some((key) => !allowed.has(key))
    || metadata.kind !== 'wikimedia_commons'
    || metadata.source_provider !== 'Wikimedia Commons'
    || typeof metadata.commons_title !== 'string'
    || !metadata.commons_title.startsWith('File:')
    || typeof metadata.license !== 'string'
    || !metadata.license.trim()
    || metadata.license === '未注明'
    || !Number.isSafeInteger(metadata.commons_page_id)
    || metadata.commons_page_id <= 0
    || typeof metadata.commons_revision_timestamp !== 'string'
    || !metadata.commons_revision_timestamp
    || !Number.isFinite(Date.parse(metadata.commons_revision_timestamp))
    || !/^[a-f0-9]{40}$/i.test(String(metadata.commons_sha1 || ''))
    || !/^[a-f0-9]{64}$/i.test(String(metadata.content_sha256 || ''))
    || typeof metadata.resolved_download_url !== 'string'
    || !metadata.resolved_download_url
  ) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 包含无效的网络素材元数据`);
  }
  const boundedStrings = [
    ['source_url', 4096],
    ['author', 500],
    ['license', 200],
    ['license_url', 2048],
    ['commons_title', 600],
    ['commons_revision_timestamp', 64],
    ['commons_sha1', 40],
    ['resolved_download_url', 4096],
    ['content_sha256', 64],
  ];
  if (boundedStrings.some(([key, limit]) => (
    metadata[key] != null
    && (typeof metadata[key] !== 'string' || metadata[key].length > limit)
  ))) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 包含无效的网络素材元数据`);
  }
  try {
    const source = new URL(metadata.source_url);
    if (
      source.protocol !== 'https:'
      || source.origin !== 'https://commons.wikimedia.org'
      || source.username
      || source.password
    ) throw new Error('unsafe source');
    const sourceMatch = source.pathname.match(/^\/wiki\/(.+)$/);
    const sourceTitle = sourceMatch
      ? decodeURIComponent(sourceMatch[1]).replace(/_/g, ' ').normalize('NFC')
      : '';
    if (sourceTitle !== metadata.commons_title.normalize('NFC')) throw new Error('mismatched title');
    for (const key of ['license_url', 'resolved_download_url']) {
      if (!metadata[key]) continue;
      const url = new URL(metadata[key]);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL');
    }
  } catch (_) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 包含无效的网络素材元数据`);
  }
  return value;
}

function freeCanvasCommonsEvidence(category) {
  if (typeof category !== 'string' || !category.startsWith('{')) return null;
  try {
    const metadata = JSON.parse(category);
    if (metadata?.kind !== 'wikimedia_commons') return null;
    return {
      contentSha256: metadata.content_sha256.toLowerCase(),
      commonsSha1: metadata.commons_sha1.toLowerCase(),
    };
  } catch (_) {
    return null;
  }
}

function freeCanvasManifestNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为非负数值`);
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为安全整数`);
  }
  return value;
}

function normalizeFreeCanvasManifestSourcePath(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为本地媒体引用`);
  }
  const reference = value.trim().startsWith('/static/')
    ? value.trim().slice('/static/'.length)
    : value.trim();
  try {
    return uploadService.normalizeStorageRelativeReference(reference);
  } catch (_) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为安全的本地媒体引用`);
  }
}

function normalizeFreeCanvasArchivePath(value, field) {
  const archivePath = freeCanvasManifestString(value, field, 512);
  if (
    !archivePath
    || archivePath.includes('\\')
    || archivePath.includes('\0')
    || archivePath.startsWith('/')
    || /^[a-zA-Z]:/.test(archivePath)
    || path.posix.normalize(archivePath) !== archivePath
    || archivePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 必须为安全归档路径`);
  }
  return archivePath;
}

function normalizeFreeCanvasDetectedFormat(value, category, archivePath, field) {
  const detectedFormat = freeCanvasManifestString(value, field, 32);
  if (!FREE_CANVAS_MEDIA_FORMATS[category]?.has(detectedFormat)) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 媒体格式不受支持`);
  }
  const extension = path.posix.extname(archivePath).toLowerCase();
  const expectedFormat = extension === '.jpg' || extension === '.jpeg'
    ? 'jpeg'
    : extension.slice(1);
  if (detectedFormat !== expectedFormat) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} 与归档扩展名格式不一致`);
  }
  return detectedFormat;
}

function normalizeFreeCanvasVideoStatus(value, field) {
  const status = freeCanvasManifestString(value, field, 32);
  if (!FREE_CANVAS_VIDEO_STATUSES.has(status)) {
    throw freeCanvasBadRequest(`free_canvas_import ${field} status 不受支持`);
  }
  return status;
}

function declaredFreeCanvasDramaId(canvas) {
  const rootIds = ['projectId', 'dramaId']
    .filter((field) => canvas[field] !== undefined)
    .map((field) => freeCanvasManifestId(canvas[field], field));
  if (rootIds.length === 0) return null;
  if (rootIds.some((id) => id !== rootIds[0])) {
    throw freeCanvasBadRequest('free_canvas projectId 和 dramaId 必须引用同一项目');
  }
  return rootIds[0];
}

function normalizeFreeCanvasImportManifest(data, canvas) {
  const input = data.free_canvas_import;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw freeCanvasBadRequest('free_canvas_import 必须为对象');
  }
  if (input.manifest_version !== FREE_CANVAS_IMPORT_MANIFEST_VERSION) {
    throw freeCanvasBadRequest('free_canvas_import manifest_version 不受支持');
  }
  if (
    input.hash_algorithm !== undefined && input.hash_algorithm !== 'sha256'
    || (Array.isArray(input.media) && input.media.length > 0 && input.hash_algorithm !== 'sha256')
  ) {
    throw freeCanvasBadRequest('free_canvas_import hash_algorithm 不受支持');
  }

  const sourceDramaId = freeCanvasManifestId(input.source_drama_id, 'source_drama_id');
  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (declaredDramaId != null && declaredDramaId !== sourceDramaId) {
    throw freeCanvasBadRequest('free_canvas_import source_drama_id 与画布项目引用不一致');
  }

  const episodeIds = freeCanvasManifestArray(input.episode_ids, 'episode_ids')
    .map((id, index) => freeCanvasManifestId(id, `episode_ids[${index}]`));
  const expectedEpisodeCount = Array.isArray(data.episodes) ? data.episodes.length : 0;
  if (episodeIds.length !== expectedEpisodeCount || new Set(episodeIds).size !== episodeIds.length) {
    throw freeCanvasBadRequest('free_canvas_import episode_ids 与导出剧集不一致');
  }

  const storyboardIds = freeCanvasManifestArray(input.storyboard_ids, 'storyboard_ids')
    .map((id, index) => freeCanvasManifestId(id, `storyboard_ids[${index}]`));
  const expectedStoryboardCount = (data.episodes || []).reduce(
    (count, episode) => count + (Array.isArray(episode?.storyboards) ? episode.storyboards.length : 0),
    0
  );
  if (storyboardIds.length !== expectedStoryboardCount || new Set(storyboardIds).size !== storyboardIds.length) {
    throw freeCanvasBadRequest('free_canvas_import storyboard_ids 与导出分镜不一致');
  }

  const sceneRefs = freeCanvasManifestArray(input.scene_refs, 'scene_refs').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest(`free_canvas_import scene_refs[${index}] 必须为对象`);
    }
    const exportIndex = entry.export_index;
    if (
      !Number.isSafeInteger(exportIndex)
      || exportIndex < 0
      || exportIndex >= (Array.isArray(data.scenes) ? data.scenes.length : 0)
    ) {
      throw freeCanvasBadRequest(`free_canvas_import scene_refs[${index}].export_index 无效`);
    }
    return {
      sourceId: freeCanvasManifestId(entry.source_id, `scene_refs[${index}].source_id`),
      exportIndex,
    };
  });
  if (new Set(sceneRefs.map((entry) => entry.sourceId)).size !== sceneRefs.length) {
    throw freeCanvasBadRequest('free_canvas_import scene_refs 包含重复源 ID');
  }

  const referencedAssetIds = new Set();
  const assetCategories = new Map();
  const expectedMediaCategories = new Map();
  const registerExpectedMedia = (value, category, field) => {
    if (value === undefined || value === null || value === '') return null;
    const sourcePath = normalizeFreeCanvasManifestSourcePath(value, field);
    const existing = expectedMediaCategories.get(sourcePath);
    if (existing && existing !== category) {
      throw freeCanvasBadRequest('free_canvas_import 同一本地媒体不能同时作为图片和视频');
    }
    expectedMediaCategories.set(sourcePath, category);
    return sourcePath;
  };
  const registerAssetCategory = (sourceId, category) => {
    const existing = assetCategories.get(sourceId);
    if (existing && existing !== category) {
      throw freeCanvasBadRequest('free_canvas asset 不能同时作为图片和视频');
    }
    assetCategories.set(sourceId, category);
  };

  for (const node of canvas.nodes || []) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    for (const field of ['assetId', 'asset_ref']) {
      if (node[field] === undefined) continue;
      const sourceId = parseFreeCanvasReferenceId(node[field], sourceDramaId, field, 'asset');
      referencedAssetIds.add(sourceId);
      if (node.type === 'image') registerAssetCategory(sourceId, 'images');
      if (node.type === 'video') registerAssetCategory(sourceId, 'videos');
    }
    const mediaCategory = node.type === 'image' ? 'images' : node.type === 'video' ? 'videos' : null;
    if (!mediaCategory) continue;
    for (const field of ['content', 'storageKey']) {
      if (node[field] !== undefined) registerExpectedMedia(node[field], mediaCategory, `node ${field}`);
    }
  }

  const assets = freeCanvasManifestArray(input.assets, 'assets').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest(`free_canvas_import assets[${index}] 必须为对象`);
    }
    const sourceId = freeCanvasManifestId(entry.source_id, `assets[${index}].source_id`);
    const mediaCategory = assetCategories.get(sourceId)
      || (String(entry.type || '').toLowerCase() === 'video' ? 'videos' : 'images');
    const sourcePath = entry.source_path == null
      ? null
      : registerExpectedMedia(entry.source_path, mediaCategory, `assets[${index}].source_path`);
    if (assetCategories.has(sourceId) && !sourcePath) {
      throw freeCanvasBadRequest('free_canvas_import 画布媒体素材缺少本地路径');
    }
    return {
      sourceId,
      name: freeCanvasManifestString(entry.name, `assets[${index}].name`, 500, '导入素材'),
      type: freeCanvasManifestString(entry.type, `assets[${index}].type`, 64, mediaCategory === 'videos' ? 'video' : 'image'),
      category: freeCanvasAssetCategory(entry.category, `assets[${index}].category`),
      sourcePath,
      fileSize: freeCanvasManifestNumber(entry.file_size, `assets[${index}].file_size`, { integer: true }),
      mimeType: freeCanvasManifestString(entry.mime_type, `assets[${index}].mime_type`, 256),
      width: freeCanvasManifestNumber(entry.width, `assets[${index}].width`, { integer: true }),
      height: freeCanvasManifestNumber(entry.height, `assets[${index}].height`, { integer: true }),
      duration: freeCanvasManifestNumber(entry.duration, `assets[${index}].duration`),
      imageGenId: freeCanvasManifestId(entry.image_gen_id, `assets[${index}].image_gen_id`, true),
      videoGenId: freeCanvasManifestId(entry.video_gen_id, `assets[${index}].video_gen_id`, true),
    };
  });
  const assetIds = assets.map((asset) => asset.sourceId);
  if (
    new Set(assetIds).size !== assetIds.length
    || assetIds.some((id) => !referencedAssetIds.has(id))
    || [...referencedAssetIds].some((id) => !assetIds.includes(id))
  ) {
    throw freeCanvasBadRequest('free_canvas_import assets 与画布素材引用不一致');
  }

  const expectedVideoGenerationIds = new Set(
    assets.map((asset) => asset.videoGenId).filter((id) => id != null)
  );
  const videoGenerations = freeCanvasManifestArray(input.video_generations, 'video_generations')
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw freeCanvasBadRequest(`free_canvas_import video_generations[${index}] 必须为对象`);
      }
      return {
        sourceId: freeCanvasManifestId(entry.source_id, `video_generations[${index}].source_id`),
        storyboardId: freeCanvasManifestId(entry.storyboard_id, `video_generations[${index}].storyboard_id`, true),
        sceneId: freeCanvasManifestId(entry.scene_id, `video_generations[${index}].scene_id`, true),
        provider: freeCanvasManifestString(entry.provider, `video_generations[${index}].provider`, 128, 'imported'),
        prompt: freeCanvasManifestString(entry.prompt, `video_generations[${index}].prompt`, 50000),
        model: freeCanvasManifestString(entry.model, `video_generations[${index}].model`, 500),
        duration: freeCanvasManifestNumber(entry.duration, `video_generations[${index}].duration`),
        aspectRatio: freeCanvasManifestString(entry.aspect_ratio, `video_generations[${index}].aspect_ratio`, 64),
        status: normalizeFreeCanvasVideoStatus(entry.status, `video_generations[${index}].status`),
        errorMsg: freeCanvasManifestString(entry.error_msg, `video_generations[${index}].error_msg`, 2000),
        sourcePath: registerExpectedMedia(
          entry.source_path,
          'videos',
          `video_generations[${index}].source_path`
        ),
      };
    });
  const videoGenerationIds = videoGenerations.map((generation) => generation.sourceId);
  if (
    new Set(videoGenerationIds).size !== videoGenerationIds.length
    || videoGenerationIds.some((id) => !expectedVideoGenerationIds.has(id))
    || [...expectedVideoGenerationIds].some((id) => !videoGenerationIds.includes(id))
  ) {
    throw freeCanvasBadRequest('free_canvas_import video_generations 与素材引用不一致');
  }
  const videoGenerationById = new Map(
    videoGenerations.map((generation) => [generation.sourceId, generation])
  );
  for (const asset of assets) {
    if (asset.videoGenId == null) continue;
    const generation = videoGenerationById.get(asset.videoGenId);
    if (!asset.sourcePath || !generation || generation.sourcePath !== asset.sourcePath) {
      throw freeCanvasBadRequest('free_canvas_import asset 与 video generation media 必须一致');
    }
  }

  const media = freeCanvasManifestArray(input.media, 'media').map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw freeCanvasBadRequest(`free_canvas_import media[${index}] 必须为对象`);
    }
    if (!['images', 'videos'].includes(entry.category)) {
      throw freeCanvasBadRequest(`free_canvas_import media[${index}].category 不受支持`);
    }
    const archivePath = normalizeFreeCanvasArchivePath(
      entry.archive_path,
      `media[${index}].archive_path`
    );
    const size = freeCanvasManifestNumber(entry.size, `media[${index}].size`, { integer: true });
    const sha256 = freeCanvasManifestString(entry.sha256, `media[${index}].sha256`, 64);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw freeCanvasBadRequest(`free_canvas_import media[${index}].size 必须为正整数`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(sha256 || ''))) {
      throw freeCanvasBadRequest(`free_canvas_import media[${index}].sha256 无效`);
    }
    return {
      sourcePath: normalizeFreeCanvasManifestSourcePath(entry.source_path, `media[${index}].source_path`),
      archivePath,
      category: entry.category,
      size,
      sha256,
      detectedFormat: normalizeFreeCanvasDetectedFormat(
        entry.detected_format,
        entry.category,
        archivePath,
        `media[${index}].detected_format`
      ),
      imageGenerationId: freeCanvasManifestId(
        entry.image_generation_id,
        `media[${index}].image_generation_id`,
        true
      ),
      videoGenerationId: freeCanvasManifestId(
        entry.video_generation_id,
        `media[${index}].video_generation_id`,
        true
      ),
    };
  });
  const mediaByPath = new Map();
  const archivePaths = new Set();
  for (const entry of media) {
    if (mediaByPath.has(entry.sourcePath)) {
      throw freeCanvasBadRequest('free_canvas_import media 包含重复源路径');
    }
    const archiveCollisionKey = entry.archivePath.normalize('NFC').toLowerCase();
    if (archivePaths.has(archiveCollisionKey)) {
      throw freeCanvasBadRequest('free_canvas_import media 包含重复 archive path');
    }
    archivePaths.add(archiveCollisionKey);
    const expectedCategory = expectedMediaCategories.get(entry.sourcePath);
    if (!expectedCategory || expectedCategory !== entry.category) {
      throw freeCanvasBadRequest('free_canvas_import media 与画布媒体引用不一致');
    }
    if (entry.videoGenerationId != null) {
      const generation = videoGenerationById.get(entry.videoGenerationId);
      if (generation && generation.sourcePath !== entry.sourcePath) {
        throw freeCanvasBadRequest('free_canvas_import video generation media 绑定不一致');
      }
    }
    mediaByPath.set(entry.sourcePath, entry);
  }
  if ([...expectedMediaCategories].some(([sourcePath]) => !mediaByPath.has(sourcePath))) {
    throw freeCanvasBadRequest('free_canvas_import 缺少画布引用的媒体归档');
  }
  for (const asset of assets) {
    if (!asset.sourcePath) continue;
    const evidence = freeCanvasCommonsEvidence(asset.category);
    if (!evidence) continue;
    const archivedMedia = mediaByPath.get(asset.sourcePath);
    if (evidence.contentSha256 !== archivedMedia?.sha256?.toLowerCase()) {
      throw freeCanvasBadRequest('free_canvas_import 网络素材内容哈希与媒体归档不一致');
    }
    if (archivedMedia.commonsSha1 && archivedMedia.commonsSha1 !== evidence.commonsSha1) {
      throw freeCanvasBadRequest('free_canvas_import 同一媒体包含冲突的 Commons SHA-1');
    }
    archivedMedia.commonsSha1 = evidence.commonsSha1;
  }

  return {
    sourceDramaId,
    episodeIds,
    storyboardIds,
    sceneRefs,
    assets,
    videoGenerations,
    media,
    mediaByPath,
  };
}

function parseFreeCanvasReferenceId(value, sourceDramaId, field, kind) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  if (typeof value !== 'string') throw freeCanvasBadRequest(`${field} 必须为项目范围内的引用`);
  const direct = new RegExp(`^${kind}:(\\d+)$`).exec(value);
  if (direct) return Number(direct[1]);
  const scoped = new RegExp(`^project:(\\d+):${kind}:(\\d+)$`).exec(value);
  if (scoped) {
    if (Number(scoped[1]) !== sourceDramaId) throw freeCanvasBadRequest(`${field} 不属于当前项目`);
    return Number(scoped[2]);
  }
  throw freeCanvasBadRequest(`${field} 必须为项目范围内的引用`);
}

function freeCanvasSourceDramaId(canvas, dramaId) {
  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (declaredDramaId === Number(dramaId)) return null;
  return declaredDramaId;
}

function mapImportedFreeCanvasId(value, map, sourceDramaId, field, kind) {
  if (value === undefined) return undefined;
  if (sourceDramaId == null) {
    throw freeCanvasBadRequest(`${field} 缺少可验证的源项目引用`);
  }
  const sourceId = parseFreeCanvasReferenceId(value, sourceDramaId, field, kind);
  const mapped = map.get(sourceId);
  if (mapped == null) throw freeCanvasBadRequest(`${field} 引用无法映射到导入项目`);
  return mapped;
}

function mapImportedFreeCanvasPath(value, pathMap) {
  if (typeof value !== 'string') return value;
  try {
    const normalized = normalizeFreeCanvasManifestSourcePath(value, 'node media');
    return pathMap.get(normalized) || value;
  } catch (_) {
    return value;
  }
}

function restoreImportedFreeCanvas(db, dramaId, metadata, maps, now) {
  const canvas = metadata?.free_canvas;
  if (canvas === undefined) return metadata;
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas) || canvas.version !== 1) {
    // This preserves the save-path error contract for malformed and unknown schemas.
    metadata.free_canvas = validateFreeCanvas(db, dramaId, canvas);
    return metadata;
  }

  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (maps.sourceDramaId != null && declaredDramaId != null && maps.sourceDramaId !== declaredDramaId) {
    throw freeCanvasBadRequest('free_canvas_import source_drama_id 与画布项目引用不一致');
  }
  const sourceDramaId = maps.sourceDramaId ?? freeCanvasSourceDramaId(canvas, dramaId);
  const remapped = { ...canvas, projectId: dramaId, dramaId };
  if (canvas.episodeId !== undefined) {
    remapped.episodeId = mapImportedFreeCanvasId(
      canvas.episodeId,
      maps.episodes,
      sourceDramaId,
      'episodeId',
      'episode'
    );
  }
  remapped.nodes = canvas.nodes?.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const next = { ...node };
    const sourceAssetValue = node.assetId !== undefined ? node.assetId : node.asset_ref;
    const sourceAssetId = sourceAssetValue === undefined || sourceDramaId == null
      ? null
      : parseFreeCanvasReferenceId(
        sourceAssetValue,
        sourceDramaId,
        node.assetId !== undefined ? 'assetId' : 'asset_ref',
        'asset'
      );
    if (node.assetId !== undefined) {
      next.assetId = mapImportedFreeCanvasId(node.assetId, maps.assets, sourceDramaId, 'assetId', 'asset');
    }
    if (node.asset_ref !== undefined) {
      next.asset_ref = mapImportedFreeCanvasId(node.asset_ref, maps.assets, sourceDramaId, 'asset_ref', 'asset');
    }
    if (node.storyboardId !== undefined) {
      next.storyboardId = mapImportedFreeCanvasId(
        node.storyboardId,
        maps.storyboards,
        sourceDramaId,
        'storyboardId',
        'storyboard'
      );
    }
    if (node.storyboard_ref !== undefined) {
      next.storyboard_ref = mapImportedFreeCanvasId(
        node.storyboard_ref,
        maps.storyboards,
        sourceDramaId,
        'storyboard_ref',
        'storyboard'
      );
    }
    if (node.episodeId !== undefined) {
      next.episodeId = mapImportedFreeCanvasId(node.episodeId, maps.episodes, sourceDramaId, 'episodeId', 'episode');
    }
    if (node.sceneId !== undefined) {
      next.sceneId = mapImportedFreeCanvasId(node.sceneId, maps.scenes, sourceDramaId, 'sceneId', 'scene');
    }
    next.content = mapImportedFreeCanvasPath(next.content, maps.paths);
    next.storageKey = mapImportedFreeCanvasPath(next.storageKey, maps.paths);
    const assetId = next.assetId ?? next.asset_ref;
    const asset = assetId == null ? null : maps.importedAssets.get(Number(assetId));
    if ((next.type === 'image' || next.type === 'video') && asset?.local_path) {
      const sourceAssetPath = maps.sourceAssetPaths.get(sourceAssetId);
      for (const field of ['content', 'storageKey']) {
        if (node[field] === undefined) continue;
        const sourceValue = normalizeFreeCanvasManifestSourcePath(node[field], `node ${field}`);
        if (sourceValue !== sourceAssetPath) {
          throw freeCanvasBadRequest(`free_canvas node ${field} 必须与素材本地路径一致`);
        }
      }
      next.content = asset.local_path;
      next.storageKey = asset.local_path;
    }
    return next;
  });
  metadata.free_canvas = validateFreeCanvas(db, dramaId, remapped);
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(metadata), now, dramaId);
  return metadata;
}

function createImportedFreeCanvasMaps(sourceDramaId = null) {
  return {
    sourceDramaId,
    episodes: new Map(),
    storyboards: new Map(),
    scenes: new Map(),
    assets: new Map(),
    videos: new Map(),
    paths: new Map(),
    importedAssets: new Map(),
    sourceAssetPaths: new Map(),
  };
}

function verifyFreeCanvasArchiveMedia(files, media) {
  let buffer;
  try {
    buffer = files.read(media.archivePath);
  } catch (_) {
    throw freeCanvasBadRequest('free_canvas_import media archive path 无效');
  }
  if (!buffer) throw freeCanvasBadRequest('free_canvas_import 缺少画布引用的媒体归档文件');
  if (buffer.length !== media.size) {
    throw freeCanvasBadRequest('free_canvas_import media size 与归档实际大小不一致');
  }
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== media.sha256) {
    throw freeCanvasBadRequest('free_canvas_import media SHA-256 hash 校验失败');
  }
  if (media.commonsSha1) {
    const actualSha1 = createHash('sha1').update(buffer).digest('hex');
    if (actualSha1 !== media.commonsSha1) {
      throw freeCanvasBadRequest('free_canvas_import media Commons SHA-1 校验失败');
    }
  }

  let detected;
  try {
    detected = uploadService.assertAllowedUpload(
      buffer,
      media.category === 'videos' ? 'video' : 'image'
    );
  } catch (_) {
    throw freeCanvasBadRequest('free_canvas_import media format 或类型无效');
  }
  const detectedFormat = detected.extension === '.jpg' || detected.extension === '.jpeg'
    ? 'jpeg'
    : String(detected.extension || '').replace(/^\./, '');
  if (detectedFormat !== media.detectedFormat) {
    throw freeCanvasBadRequest('free_canvas_import media detected format 与归档内容不一致');
  }
  return {
    fileSize: buffer.length,
    mimeType: detected.mimeType,
    detectedFormat,
  };
}

function buildPortableImportedFreeCanvasMaps(db, dramaId, imported, now) {
  const manifest = normalizeFreeCanvasImportManifest(imported.data, imported.metadata.free_canvas);
  const maps = createImportedFreeCanvasMaps(manifest.sourceDramaId);

  manifest.episodeIds.forEach((sourceId, index) => {
    const targetId = imported.episodeIds[index];
    if (targetId == null) throw freeCanvasBadRequest('free_canvas_import episode_ids 无法映射');
    maps.episodes.set(sourceId, Number(targetId));
  });
  manifest.storyboardIds.forEach((sourceId, index) => {
    const targetId = imported.storyboardIds[index];
    if (targetId == null) throw freeCanvasBadRequest('free_canvas_import storyboard_ids 无法映射');
    maps.storyboards.set(sourceId, Number(targetId));
  });
  for (const sceneRef of manifest.sceneRefs) {
    const targetId = imported.sceneIds[sceneRef.exportIndex];
    if (targetId == null) throw freeCanvasBadRequest('free_canvas_import scene_refs 无法映射');
    maps.scenes.set(sceneRef.sourceId, Number(targetId));
  }

  for (const media of manifest.media) {
    media.trustedMetadata = verifyFreeCanvasArchiveMedia(imported.files, media);
    let restored = null;
    if (media.imageGenerationId != null) {
      const candidate = imported.images.get(media.imageGenerationId);
      if (candidate?.archivePath === media.archivePath && candidate.localPath) restored = candidate.localPath;
    }
    if (media.videoGenerationId != null) {
      const candidate = imported.videos.get(media.videoGenerationId);
      if (candidate?.archivePath === media.archivePath && candidate.localPath) {
        if (restored && restored !== candidate.localPath) {
          throw freeCanvasBadRequest('free_canvas_import media 生成记录映射不一致');
        }
        restored = candidate.localPath;
      }
    }
    if (!restored) {
      try {
        restored = saveMediaFile(
          imported.storagePath,
          imported.projectDir,
          media.category,
          imported.files,
          media.archivePath,
          media.category === 'videos' ? 'canvas_vid_imp' : 'canvas_img_imp'
        );
      } catch (error) {
        if (['UNSAFE_ARCHIVE_PATH', 'UNSUPPORTED_MEDIA_TYPE'].includes(error?.code)) {
          throw freeCanvasBadRequest('free_canvas_import media 归档引用无效');
        }
        throw error;
      }
    }
    if (!restored) throw freeCanvasBadRequest('free_canvas_import 缺少画布媒体归档文件');
    maps.paths.set(media.sourcePath, restored);
  }

  const insertVideo = db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, status,
      video_url, local_path, scene_id, completed_at, error_msg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  );
  const updateVideo = db.prepare(
    `UPDATE video_generations
     SET drama_id = ?, storyboard_id = ?, provider = ?, prompt = ?, model = ?, duration = ?,
         aspect_ratio = ?, status = ?, video_url = NULL, local_path = ?, scene_id = ?,
         completed_at = ?, error_msg = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  );
  for (const generation of manifest.videoGenerations) {
    const storyboardId = generation.storyboardId == null
      ? null
      : maps.storyboards.get(generation.storyboardId);
    const sceneId = generation.sceneId == null ? null : maps.scenes.get(generation.sceneId);
    if (generation.storyboardId != null && storyboardId == null) {
      throw freeCanvasBadRequest('free_canvas_import video generation storyboard 引用无法映射');
    }
    if (generation.sceneId != null && sceneId == null) {
      throw freeCanvasBadRequest('free_canvas_import video generation scene 引用无法映射');
    }
    const localPath = maps.paths.get(generation.sourcePath);
    if (!localPath) throw freeCanvasBadRequest('free_canvas_import video generation 媒体无法映射');

    const media = manifest.mediaByPath.get(generation.sourcePath);
    const candidate = imported.videos.get(generation.sourceId);
    const canReuse = Boolean(
      candidate?.newId
      && candidate.localPath === localPath
      && candidate.archivePath === media?.archivePath
      && (
        (candidate.storyboardId == null && storyboardId == null)
        || (
          candidate.storyboardId != null
          && storyboardId != null
          && Number(candidate.storyboardId) === Number(storyboardId)
        )
      )
    );
    const completedAt = generation.status === 'completed' ? now : null;
    if (candidate?.newId) {
      if (!canReuse) {
        throw freeCanvasBadRequest('free_canvas_import video generation authoritative record 不一致');
      }
      updateVideo.run(
        dramaId,
        storyboardId,
        generation.provider,
        generation.prompt,
        generation.model,
        generation.duration,
        generation.aspectRatio,
        generation.status,
        localPath,
        sceneId,
        completedAt,
        generation.errorMsg,
        now,
        candidate.newId
      );
      maps.videos.set(generation.sourceId, Number(candidate.newId));
      continue;
    }

    const info = insertVideo.run(
      dramaId,
      storyboardId,
      generation.provider,
      generation.prompt,
      generation.model,
      generation.duration,
      generation.aspectRatio,
      generation.status,
      localPath,
      sceneId,
      completedAt,
      generation.errorMsg,
      now,
      now
    );
    maps.videos.set(generation.sourceId, Number(info.lastInsertRowid));
  }

  const insertAsset = db.prepare(
    `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type,
                         width, height, duration, image_gen_id, video_gen_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const sourceAsset of manifest.assets) {
    const localPath = sourceAsset.sourcePath == null ? null : maps.paths.get(sourceAsset.sourcePath);
    if (sourceAsset.sourcePath != null && !localPath) {
      throw freeCanvasBadRequest('free_canvas_import asset 媒体无法映射');
    }
    const image = sourceAsset.imageGenId == null ? null : imported.images.get(sourceAsset.imageGenId);
    const videoGenerationId = sourceAsset.videoGenId == null
      ? null
      : maps.videos.get(sourceAsset.videoGenId);
    if (sourceAsset.videoGenId != null && videoGenerationId == null) {
      throw freeCanvasBadRequest('free_canvas_import asset 视频生成引用无法映射');
    }
    const trustedMedia = sourceAsset.sourcePath == null
      ? null
      : manifest.mediaByPath.get(sourceAsset.sourcePath)?.trustedMetadata;
    const info = insertAsset.run(
      dramaId,
      sourceAsset.name,
      sourceAsset.type,
      sourceAsset.category,
      localPath ? `/static/${localPath}` : null,
      localPath,
      trustedMedia?.fileSize ?? null,
      trustedMedia?.mimeType ?? null,
      null,
      null,
      null,
      image?.newId || null,
      videoGenerationId,
      now,
      now
    );
    const newId = Number(info.lastInsertRowid);
    maps.assets.set(sourceAsset.sourceId, newId);
    maps.importedAssets.set(newId, { id: newId, drama_id: dramaId, local_path: localPath });
    maps.sourceAssetPaths.set(sourceAsset.sourceId, sourceAsset.sourcePath);
  }
  return maps;
}

function buildLegacyImportedFreeCanvasMaps(sourceDramaId, imported) {
  const maps = createImportedFreeCanvasMaps(sourceDramaId);
  const canvas = imported.metadata?.free_canvas;
  if (canvas === undefined) return maps;

  const hasProjectId = canvas?.projectId !== undefined;
  const hasDramaId = canvas?.dramaId !== undefined;
  if (hasProjectId !== hasDramaId) {
    throw freeCanvasBadRequest('旧版 ZIP free_canvas 缺少一致的项目身份声明');
  }
  const hasRootReference = canvas?.episodeId !== undefined;
  const hasNodeReference = Array.isArray(canvas?.nodes) && canvas.nodes.some((node) => (
    node && typeof node === 'object' && !Array.isArray(node) && (
      node.assetId !== undefined
      || node.asset_ref !== undefined
      || node.storyboardId !== undefined
      || node.storyboard_ref !== undefined
      || node.episodeId !== undefined
      || node.sceneId !== undefined
      || node.storageKey !== undefined
      || (['image', 'video'].includes(node.type) && node.content !== undefined)
    )
  ));
  if (hasRootReference || hasNodeReference) {
    throw freeCanvasBadRequest('旧版 ZIP free_canvas 包含无法验证的引用，缺少 free_canvas_import');
  }
  return maps;
}

/**
 * 导入 ZIP，创建剧集并还原所有数据
 * @param {Buffer} zipBuffer
 * @returns {{ drama_id: number, title: string }}
 */
function importDrama(db, cfg, log, zipSource, options = {}) {
  const storagePath = getStoragePath(cfg);
  ensureDir(storagePath);
  const storageStat = fs.lstatSync(storagePath);
  if (storageStat.isSymbolicLink() || !storageStat.isDirectory()) {
    throw importError('UNSAFE_STORAGE', 'ZIP 格式不安全：storage 根目录不是普通目录');
  }
  const parsed = parseZip(zipSource, { limits: options.limits });
  const { data, files, limits } = parsed;
  const capacity = uploadService.assertUploadDiskCapacity(
    storagePath,
    parsed.totalUncompressedBytes,
    limits.diskReserveBytes,
    options.getAvailableBytes || uploadService.getAvailableDiskBytes
  );
  const availableForImport = Number.isFinite(capacity.availableBytes)
    ? Math.max(0, capacity.availableBytes - limits.diskReserveBytes)
    : limits.maxMaterializedBytes;
  files.setMaterializationBudget(availableForImport);

  const d = data.drama;
  const title = resolveTitle(db, d.title || '导入项目');
  const now = new Date().toISOString();
  const sourceIntakeEntries = normalizeSourceIntakeManifest(data, limits, now);
  const sourceOriginalQuotaBytes = sourceIntakeEntries.length
    ? resolveSourceOriginalQuotaBytes(cfg, options)
    : null;

  let metadata = d.metadata || {};
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (_) {
      metadata = {};
    }
  }
  metadata.storage_folder_label = storageLayout.sanitizeFolderLabel(title);
  const metaStr = JSON.stringify(metadata);

  const stagingRoot = fs.mkdtempSync(path.join(storagePath, '.import-staging-'));
  let result;
  const movedFinalPaths = [];
  const runImport = db.transaction(() => {
    result = _doImport(
      db,
      stagingRoot,
      files,
      data,
      d,
      title,
      metaStr,
      now,
      log,
      sourceIntakeEntries,
      {
        quotaBytes: sourceOriginalQuotaBytes,
        reserveBytes: limits.diskReserveBytes,
        getAvailableBytes: options.getAvailableBytes || uploadService.getAvailableDiskBytes,
      }
    );
    if (typeof options.faultInjector === 'function') options.faultInjector('before-file-commit', result);
    const trustedMediaMetadata = validateStagedImportMedia(stagingRoot, result.project_dir, limits);
    applyTrustedImportedAssetMetadata(db, result.drama_id, trustedMediaMetadata);
    const commitDirectories = [result.project_dir, ...(result.source_original_dir ? [result.source_original_dir] : [])];
    for (const relativeDirectory of commitDirectories) {
      const segments = String(relativeDirectory || '').split('/');
      const stagedPath = path.resolve(stagingRoot, ...segments);
      const finalPath = path.resolve(storagePath, ...segments);
      const stageRelation = path.relative(path.resolve(stagingRoot), stagedPath);
      const finalRelation = path.relative(path.resolve(storagePath), finalPath);
      if (
        !stageRelation || stageRelation.startsWith(`..${path.sep}`) || path.isAbsolute(stageRelation) ||
        !finalRelation || finalRelation.startsWith(`..${path.sep}`) || path.isAbsolute(finalRelation)
      ) {
        throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：导入目录会逃逸 storage');
      }
      if (relativeDirectory === result.project_dir) ensureDir(stagedPath);
      if (!fs.existsSync(stagedPath) || !fs.lstatSync(stagedPath).isDirectory()) {
        throw importError('IMPORT_STAGE_MISSING', 'ZIP 格式导入失败：staging 目录不完整');
      }
      ensureSafeDirectoryInside(storagePath, path.dirname(finalPath));
      if (fs.existsSync(finalPath)) {
        throw importError('IMPORT_TARGET_EXISTS', '导入目标目录已存在，拒绝覆盖');
      }
      fs.renameSync(stagedPath, finalPath);
      movedFinalPaths.push(finalPath);
    }
    if (typeof options.faultInjector === 'function') options.faultInjector('after-file-commit', result);
  });
  try {
    runImport();
    return { drama_id: result.drama_id, title: result.title };
  } catch (error) {
    for (const finalPath of movedFinalPaths.reverse()) {
      fs.rmSync(finalPath, { recursive: true, force: true });
      removeEmptyParentsInside(storagePath, path.dirname(finalPath));
    }
    if (error?.code === 'ENOSPC') throw importError('INSUFFICIENT_STORAGE', 'ZIP 格式导入失败：磁盘空间不足', error);
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function _doImport(
  db,
  storagePath,
  files,
  data,
  d,
  title,
  metaStr,
  now,
  log,
  sourceIntakeEntries = [],
  sourceStorageOptions = {}
) {

  // ---- 创建 drama ----
  const dramaInfo = db.prepare(
    `INSERT INTO dramas (title, description, genre, style, status, tags, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title,
    d.description || null,
    d.genre || null,
    d.style || null,
    d.status || 'draft',
    d.tags || null,
    metaStr,
    now,
    now
  );
  const dramaId = dramaInfo.lastInsertRowid;
  const projectDir = storageLayout.buildProjectRelativeDir({
    id: dramaId,
    title,
    created_at: now,
    metadata: metaStr,
  });
  const importedMetadata = JSON.parse(metaStr);
  const importedStoryboardIds = [];
  const importedImages = new Map();
  const importedVideos = new Map();

  restoreSourceIntakeOriginals(
    db,
    storagePath,
    files,
    dramaId,
    sourceIntakeEntries,
    sourceStorageOptions
  );

  // ---- 导入角色 ----
  const charNewIds = []; // 按导出顺序保存新角色 id，用于恢复分镜 character_indices
  for (let i = 0; i < (data.characters || []).length; i++) {
    const c = data.characters[i];
    if (!c.name) { charNewIds.push(null); continue; }
    const localPath = saveMediaFile(storagePath, projectDir, 'characters', files, c.image_file, 'char_imp');
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'characters', files, c.extra_image_files, 'char_extra_imp');
    const info = db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, personality, appearance, voice_style, polished_prompt, local_path, extra_images, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, c.name, c.role || null, c.description || null, c.personality || null, c.appearance || null, c.voice_style || null, c.polished_prompt || null, localPath, extraImagesJson, i, now, now);
    charNewIds.push(info.lastInsertRowid);
  }

  // ---- 导入剧集（先建好所有集，再关联角色/场景/道具） ----
  const episodeIdList = []; // 按顺序保存新集 id
  for (const ep of (data.episodes || [])) {
    const epInfo = db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, description, script_content, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, ep.episode_number || 1, ep.title || `第${ep.episode_number || 1}集`, ep.description || null, ep.script_content || null, ep.duration || 0, now, now);
    episodeIdList.push(epInfo.lastInsertRowid);
  }

  // ---- 关联角色到所有集（episode_characters） ----
  if (charNewIds.length > 0 && episodeIdList.length > 0) {
    const insEC = db.prepare('INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)');
    for (const charId of charNewIds) {
      if (!charId) continue;
      for (const epId of episodeIdList) {
        try { insEC.run(epId, charId); } catch (_) {}
      }
    }
  }

  // ---- 导入场景（逐条保留实体身份，供分镜 scene_index 精确恢复）----
  const sceneNewIds = [];
  for (let i = 0; i < (data.scenes || []).length; i++) {
    const s = data.scenes[i];
    const epIdx = s.episode_index;
    const epId = (epIdx != null && epIdx >= 0 && episodeIdList[epIdx])
      ? episodeIdList[epIdx]
      : (episodeIdList[0] || null);
    const localPath = saveMediaFile(storagePath, projectDir, 'scenes', files, s.image_file, 'scene_imp');
    const panoramaLocalPath = saveMediaFile(
      storagePath, projectDir, 'scenes', files, s.panorama_image_file, 'scene_panorama_imp'
    );
    const panoramaImageUrl = panoramaLocalPath
      ? `/static/${panoramaLocalPath.replace(/^\//, '')}`
      : null;
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'scenes', files, s.extra_image_files, 'scene_extra_imp');
    const info = db.prepare(
      `INSERT INTO scenes
       (drama_id, episode_id, location, time, prompt, polished_prompt, local_path,
        panorama_image_url, panorama_local_path, panorama_image_id, extra_images, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    ).run(
      dramaId, epId, s.location || '', s.time || '', s.prompt || '', s.polished_prompt || null,
      localPath, panoramaImageUrl, panoramaLocalPath, extraImagesJson, now, now
    );
    const sceneId = info.lastInsertRowid;
    if (panoramaImageUrl || panoramaLocalPath) {
      const generation = db.prepare(
        `INSERT INTO image_generations
         (drama_id, scene_id, provider, prompt, frame_type, image_url, local_path,
          status, completed_at, created_at, updated_at)
         VALUES (?, ?, 'imported', ?, 'scene_panorama', ?, ?, 'completed', ?, ?, ?)`
      ).run(
        dramaId, sceneId, 'Imported scene panorama', panoramaImageUrl, panoramaLocalPath,
        now, now, now
      );
      db.prepare('UPDATE scenes SET panorama_image_id = ? WHERE id = ?').run(generation.lastInsertRowid, sceneId);
    }
    sceneNewIds.push(sceneId);
  }

  // ---- 导入道具（带 episode_id） ----
  const propNewIds = []; // 按导出顺序保存新道具 id，用于恢复 storyboard_props
  for (const p of (data.props || [])) {
    if (!p.name) { propNewIds.push(null); continue; }
    const epIdx = p.episode_index;
    const epId = (epIdx != null && epIdx >= 0 && episodeIdList[epIdx])
      ? episodeIdList[epIdx]
      : (episodeIdList[0] || null);
    const localPath = saveMediaFile(storagePath, projectDir, 'props', files, p.image_file, 'prop_imp');
    const extraImagesJson = saveExtraImages(storagePath, projectDir, 'props', files, p.extra_image_files, 'prop_extra_imp');
    const pInfo = db.prepare(
      `INSERT INTO props (drama_id, episode_id, name, type, description, prompt, local_path, extra_images, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(dramaId, epId, p.name, p.type || null, p.description || null, p.prompt || null, localPath, extraImagesJson, now, now);
    propNewIds.push(pInfo.lastInsertRowid);
  }

  // ---- 导入分镜 ----
  for (let epIdx = 0; epIdx < (data.episodes || []).length; epIdx++) {
    const ep = data.episodes[epIdx];
    const episodeId = episodeIdList[epIdx];
    if (!episodeId) continue;

    for (const sb of (ep.storyboards || [])) {
      const sbAudioPath = saveMediaFile(storagePath, projectDir, 'audio', files, sb.audio_file, 'sb_audio_imp');
      const sbNarrationAudioPath = saveMediaFile(storagePath, projectDir, 'audio', files, sb.narration_audio_file, 'sb_narr_audio_imp');
      const sbVideoLocalPath = saveMediaFile(storagePath, projectDir, 'videos', files, sb.video_file, 'vid_imp');
      const sbReferenceImages = restoreStoryboardReferenceImages(
        storagePath,
        projectDir,
        files,
        sb.reference_images
      );

      // 还原 characters：从导出时记录的下标映射回新 ID
      const charIndices = Array.isArray(sb.character_indices) ? sb.character_indices : [];
      const sbCharIds = charIndices
        .map(idx => charNewIds[idx])
        .filter(id => id != null);
      const charactersJson = JSON.stringify(sbCharIds);

      // 还原 scene_id：从导出时记录的下标映射回新 ID
      const sbSceneId = (sb.scene_index != null && sceneNewIds[sb.scene_index])
        ? sceneNewIds[sb.scene_index]
        : null;

      // 还原 prop_ids：从导出时记录的下标映射回新 ID
      const propIndices = Array.isArray(sb.prop_indices) ? sb.prop_indices : [];
      const sbPropNewIds = propIndices
        .map(idx => propNewIds[idx])
        .filter(id => id != null);

      // 先插入分镜（首尾帧绑定ID、layout 稍后更新；image_url/local_path 由绑定逻辑设置）
      // 使用并行数组维护列名与值，确保列数与传参数量永远一致，避免“44 values for 43 columns”类错误
      const sbCols = [
        'episode_id', 'scene_id', 'storyboard_number', 'title', 'description', 'location', 'time',
        'dialogue', 'narration', 'action', 'atmosphere', 'result', 'shot_type', 'angle', 'angle_h', 'angle_v', 'angle_s',
        'movement', 'lighting_style', 'depth_of_field', 'image_prompt', 'polished_prompt', 'video_prompt', 'duration',
        'emotion', 'emotion_intensity', 'segment_index', 'segment_title', 'continuity_snapshot', 'creation_mode',
        'universal_segment_text', 'layout_description', 'first_frame_image_id', 'last_frame_image_id',
        'last_frame_image_url', 'last_frame_local_path', 'image_url', 'local_path', 'video_url', 'video_local_path',
        'reference_images', 'video_reference_image_id', 'characters',
        'audio_local_path', 'narration_audio_local_path', 'created_at', 'updated_at'
      ];
      const sbVals = [
        episodeId,
        sbSceneId,
        sb.storyboard_number || 1,
        sb.title || null,
        sb.description || null,
        sb.location || null,
        sb.time || null,
        sb.dialogue || null,
        sb.narration || null,
        sb.action || null,
        sb.atmosphere || null,
        sb.result || null,
        sb.shot_type || null,
        sb.angle || null,
        sb.angle_h || null,
        sb.angle_v || null,
        sb.angle_s || null,
        sb.movement || null,
        sb.lighting_style || null,
        sb.depth_of_field || null,
        sb.image_prompt || null,
        sb.polished_prompt || null,
        sb.video_prompt || null,
        sb.duration || 0,
        sb.emotion || null,
        sb.emotion_intensity != null ? sb.emotion_intensity : null,
        sb.segment_index ?? 0,
        sb.segment_title || null,
        sb.continuity_snapshot || null,
        sb.creation_mode === 'universal' ? 'universal' : 'classic',
        sb.universal_segment_text || null,
        sb.layout_description || null,
        null, // first_frame_image_id 后设
        null, // last_frame_image_id 后设
        null, // 仅从 ZIP 内实际尾帧绑定恢复
        null,
        null, // image_url 由首帧绑定设置
        null, // local_path 由首帧绑定设置
        null, // 不信任归档中未携带本地副本的远程视频
        sbVideoLocalPath || null,
        sbReferenceImages,
        null, // video_reference_image_id 后按 image_generations 新 ID 恢复
        charactersJson,
        sbAudioPath || null,
        sbNarrationAudioPath || null,
        now,
        now
      ];
      if (sbCols.length !== sbVals.length) {
        throw new Error(`storyboards 导入列数不匹配: cols=${sbCols.length}, vals=${sbVals.length}`);
      }
      const sbInfo = db.prepare(
        `INSERT INTO storyboards (${sbCols.join(', ')})
         VALUES (${sbCols.map(() => '?').join(', ')})`
      ).run(...sbVals);
      const sbId = sbInfo.lastInsertRowid;
      importedStoryboardIds.push(Number(sbId));

      // 还原 storyboard_props（分镜与道具的关联）
      if (sbPropNewIds.length > 0) {
        const insSP = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of sbPropNewIds) insSP.run(sbId, pid);
      }

      // 还原帧提示词（首尾帧/关键帧专用提示词 + layout 合同，必须恢复）
      if (Array.isArray(sb.frame_prompts) && sb.frame_prompts.length > 0) {
        const insFp = db.prepare('INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const fp of sb.frame_prompts) {
          insFp.run(sbId, fp.frame_type || 'first', fp.prompt || '', fp.description || null, fp.layout || null, fp.created_at || now, fp.updated_at || now);
        }
        try { require('../logger').info?.('[导入] 已恢复帧提示词', { storyboard_id: sbId, count: sb.frame_prompts.length }); } catch (_) {}
      }

      // 导入分镜图片完整历史（新版 v1.4+ 的 image_generations 数组；老版回退单张）
      const genOldToNew = new Map(); // original_id -> {newId, localPath}
      if (Array.isArray(sb.image_generations) && sb.image_generations.length > 0) {
        for (const gen of sb.image_generations) {
          const genLocalPath = saveMediaFile(storagePath, projectDir, 'images', files, gen.zip_file || gen.file, 'sb_imp_gen');
          const genImageUrl = null;
          if (genLocalPath) {
            const genInfo = db.prepare(
              `INSERT INTO image_generations (drama_id, storyboard_id, provider, prompt, negative_prompt, model, frame_type, size, quality, status, error_msg, image_url, local_path, created_at, updated_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              dramaId,
              sbId,
              gen.provider || 'imported',
              gen.prompt || sb.image_prompt || '',
              gen.negative_prompt || null,
              gen.model || null,
              gen.frame_type || null,
              gen.size || null,
              gen.quality || null,
              gen.status || 'completed',
              gen.error_msg || null,
              genImageUrl,
              genLocalPath,
              gen.created_at || now,
              now,
              gen.completed_at || now
            );
            const newGenId = genInfo.lastInsertRowid;
            if (gen.original_id != null) {
              const restoredGeneration = {
                newId: newGenId,
                localPath: genLocalPath,
                archivePath: gen.zip_file || gen.file || null,
                imageUrl: genImageUrl,
                frameType: gen.frame_type || null,
                status: gen.status || 'completed',
              };
              genOldToNew.set(Number(gen.original_id), restoredGeneration);
              importedImages.set(Number(gen.original_id), restoredGeneration);
            }
          }
        }
      } else {
        // 老版兼容：仅单张 image_file（导入后只有这一个历史图，首尾帧绑定丢失是旧行为）
        const sbImagePath = saveMediaFile(storagePath, projectDir, 'images', files, sb.image_file, 'sb_imp');
        if (sbImagePath) {
          db.prepare(
            `INSERT INTO image_generations (drama_id, storyboard_id, provider, prompt, status, local_path, created_at, updated_at)
             VALUES (?, ?, 'imported', ?, 'completed', ?, ?, ?)`
          ).run(dramaId, sbId, sb.image_prompt || '', sbImagePath, now, now);
        }
      }

      // 导入视频（仍保持单条最新，视频首尾帧 URL 由生成时绑定）
      if (sbVideoLocalPath) {
        const videoInfo = db.prepare(
          `INSERT INTO video_generations
           (drama_id, storyboard_id, provider, prompt, status, video_url, local_path, created_at, updated_at, completed_at)
           VALUES (?, ?, 'imported', ?, 'completed', ?, ?, ?, ?, ?)`
        ).run(dramaId, sbId, sb.video_prompt || '', null, sbVideoLocalPath, now, now, now);
        const sourceVideoGenerationId = Number(sb.video_generation_original_id);
        if (Number.isSafeInteger(sourceVideoGenerationId) && sourceVideoGenerationId > 0) {
          importedVideos.set(sourceVideoGenerationId, {
            newId: Number(videoInfo.lastInsertRowid),
            localPath: sbVideoLocalPath,
            archivePath: sb.video_file || null,
            storyboardId: Number(sbId),
          });
        }
      }

      // 绑定首尾帧到 storyboards（关键：恢复 first_frame_image_id + image_url/local_path，以及 last_*）
      const now2 = new Date().toISOString();
      const firstOld = sb.first_frame_image_original_id ?? sb.first_frame_image_id;
      const lastOld = sb.last_frame_image_original_id ?? sb.last_frame_image_id;
      let boundFirst = false, boundLast = false;
      if (firstOld != null && genOldToNew.has(Number(firstOld))) {
        const { newId, localPath, imageUrl } = genOldToNew.get(Number(firstOld));
        db.prepare(
          `UPDATE storyboards SET image_url = ?, local_path = ?, first_frame_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).run(imageUrl, localPath, newId, now2, sbId);
        boundFirst = true;
      }
      if (lastOld != null && genOldToNew.has(Number(lastOld))) {
        const { newId, localPath, imageUrl } = genOldToNew.get(Number(lastOld));
        db.prepare(
          `UPDATE storyboards SET last_frame_image_url = ?, last_frame_local_path = ?, last_frame_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).run(imageUrl, localPath, newId, now2, sbId);
        boundLast = true;
      }
      const videoReferenceOld = sb.video_reference_image_original_id;
      if (videoReferenceOld != null && genOldToNew.has(Number(videoReferenceOld))) {
        const restoredReference = genOldToNew.get(Number(videoReferenceOld));
        if (
          restoredReference.status === 'completed' &&
          ['quad_grid', 'nine_grid'].includes(restoredReference.frameType)
        ) {
          db.prepare(
            'UPDATE storyboards SET video_reference_image_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
          ).run(restoredReference.newId, now2, sbId);
        }
      }
      if ((sb.image_generations && sb.image_generations.length) || boundFirst || boundLast) {
        try {
          require('../logger').info?.('[导入] 分镜图片历史+首尾帧绑定完成', {
            storyboard_id: sbId,
            gens_restored: genOldToNew.size,
            first_bound: boundFirst,
            last_bound: boundLast,
            had_original_first: firstOld != null,
            had_original_last: lastOld != null
          });
        } catch (_) {}
      }

      // 兼容老工程：ZIP 无 frame_prompts 时，用已导入的首/尾帧图生 prompt 回填
      restoreFramePromptsFromImageGens(db, sbId, now2, log);
    }
  }

  if (importedMetadata.free_canvas !== undefined) {
    if (
      importedMetadata.free_canvas
      && typeof importedMetadata.free_canvas === 'object'
      && !Array.isArray(importedMetadata.free_canvas)
      && importedMetadata.free_canvas.version === 1
      && Array.isArray(importedMetadata.free_canvas.nodes)
      && Array.isArray(importedMetadata.free_canvas.edges)
    ) {
      const sourceDramaId = freeCanvasSourceDramaId(importedMetadata.free_canvas, dramaId);
      const imported = {
        data,
        metadata: importedMetadata,
        storagePath,
        projectDir,
        files,
        episodeIds: episodeIdList,
        storyboardIds: importedStoryboardIds,
        sceneIds: sceneNewIds,
        images: importedImages,
        videos: importedVideos,
      };
      const maps = data.free_canvas_import !== undefined
        ? buildPortableImportedFreeCanvasMaps(db, dramaId, imported, now)
        : buildLegacyImportedFreeCanvasMaps(sourceDramaId, imported);
      restoreImportedFreeCanvas(db, dramaId, importedMetadata, maps, now);
    } else {
      restoreImportedFreeCanvas(db, dramaId, importedMetadata, createImportedFreeCanvasMaps(), now);
    }
  }

  log.info('Drama imported', { drama_id: dramaId, title });
  return {
    drama_id: dramaId,
    title,
    project_dir: projectDir,
    source_original_dir: sourceIntakeEntries.length ? `story_sources/${dramaId}` : null,
  };
}

module.exports = {
  DEFAULT_IMPORT_LIMITS,
  DramaImportError,
  createImageValidatorProcessSpec,
  importDrama,
  parseZip,
  resolveSourceOriginalQuotaBytes,
  validateImportComplexity,
};
