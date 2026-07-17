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

const SHARP_IMPORT_VALIDATOR_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');

const [sharpModulePath, projectRoot, maxPixelsValue, maxFramesValue] = process.argv.slice(1);
const sharp = require(sharpModulePath);
const maxPixels = Number(maxPixelsValue);
const maxFrames = Number(maxFramesValue);
const categories = ['characters', 'scenes', 'props', 'images', 'references'];
const formats = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
};

function reject(code, mediaPath, reason, details = {}) {
  const error = new Error(reason);
  error.code = code;
  error.mediaPath = mediaPath;
  error.details = details;
  throw error;
}

async function validateImage(absolutePath, mediaPath, expectedFormat) {
  let image;
  let metadata;
  try {
    image = sharp(absolutePath, {
      animated: true,
      failOn: 'error',
      limitInputPixels: maxPixels,
      sequentialRead: true,
    });
    metadata = await image.metadata();
  } catch (error) {
    const limitFailure = /pixel limit/i.test(String(error && error.message));
    reject(
      limitFailure ? 'IMPORT_IMAGE_LIMIT_EXCEEDED' : 'INVALID_MEDIA_CONTENT',
      mediaPath,
      limitFailure ? 'image pixel limit exceeded' : 'Sharp could not decode image metadata'
    );
  }

  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    reject('INVALID_MEDIA_CONTENT', mediaPath, 'image content does not match its extension');
  }

  const frames = metadata.pages == null ? 1 : Number(metadata.pages);
  const frameHeight = Number(metadata.pageHeight || metadata.height);
  const pixels = Number(metadata.width) * frameHeight * frames;
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > maxFrames) {
    reject('IMPORT_IMAGE_LIMIT_EXCEEDED', mediaPath, 'image frame limit exceeded', {
      actual: frames,
      limit: maxFrames,
      kind: 'frames',
    });
  }
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > maxPixels) {
    reject('IMPORT_IMAGE_LIMIT_EXCEEDED', mediaPath, 'image pixel limit exceeded', {
      actual: Number.isSafeInteger(pixels) ? pixels : 'overflow',
      limit: maxPixels,
      kind: 'pixels',
    });
  }

  try {
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    if (!decoded || !Buffer.isBuffer(decoded.data) || decoded.data.length === 0) {
      reject('INVALID_MEDIA_CONTENT', mediaPath, 'Sharp produced no decoded pixels');
    }
  } catch (error) {
    if (error && error.mediaPath) throw error;
    reject('INVALID_MEDIA_CONTENT', mediaPath, 'Sharp could not fully decode image');
  }
}

async function main() {
  let count = 0;
  for (const category of categories) {
    const directory = path.join(projectRoot, category);
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const mediaPath = category + '/' + entry.name;
      if (!entry.isFile()) reject('INVALID_MEDIA_CONTENT', mediaPath, 'image staging entry is not a regular file');
      const expectedFormat = formats[path.extname(entry.name).toLowerCase()];
      if (!expectedFormat) reject('INVALID_MEDIA_CONTENT', mediaPath, 'image extension is not allowed');
      await validateImage(path.join(directory, entry.name), mediaPath, expectedFormat);
      count += 1;
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, count }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: error && error.code ? error.code : 'MEDIA_VALIDATION_UNAVAILABLE',
    mediaPath: error && error.mediaPath ? error.mediaPath : null,
    reason: error && error.message ? error.message : 'image validation failed',
    details: error && error.details ? error.details : null,
  }));
  process.exitCode = 1;
});
`;

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

function validateStagedImages(projectPath, limits) {
  const hasImages = IMPORT_IMAGE_CATEGORIES.some((category) => {
    try {
      return fs.readdirSync(path.join(projectPath, category)).length > 0;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
  if (!hasImages) return;

  let sharpModulePath;
  try {
    sharpModulePath = require.resolve('sharp');
  } catch (error) {
    throw invalidImportMedia('MEDIA_VALIDATION_UNAVAILABLE', null, 'Sharp is unavailable');
  }

  const result = spawnSync(
    process.execPath,
    [
      '-e',
      SHARP_IMPORT_VALIDATOR_SCRIPT,
      sharpModulePath,
      projectPath,
      String(limits.maxImagePixels),
      String(limits.maxImageFrames),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      maxBuffer: 128 * 1024,
      timeout: IMAGE_VALIDATION_TIMEOUT_MS,
      windowsHide: true,
    }
  );

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
}

function validateStagedImportMedia(stagingRoot, projectDir, limits) {
  const deadline = Date.now() + IMPORT_MEDIA_VALIDATION_TIMEOUT_MS;
  const resolvedStagingRoot = path.resolve(stagingRoot);
  const projectPath = path.resolve(stagingRoot, ...String(projectDir || '').split('/'));
  const relation = path.relative(resolvedStagingRoot, projectPath);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw importError('UNSAFE_IMPORT_TARGET', 'ZIP 格式不安全：媒体校验目录会逃逸 staging');
  }

  validateStagedImages(projectPath, limits);
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
      validateStagedAvFile(
        path.join(directory, entry.name),
        mediaPath,
        category,
        extension,
        limits,
        remainingMs
      );
    }
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
    validateStagedImportMedia(stagingRoot, result.project_dir, limits);
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

  // ---- 导入场景（带 episode_id，按 location+time 去重：同名场景只创建一条记录）----
  const sceneNewIds = []; // 按导出顺序保存新场景 id（含去重后的映射），用于恢复分镜 scene_index
  const sceneDedupeMap = new Map(); // key: "location|time" → 已创建的 scene id
  for (let i = 0; i < (data.scenes || []).length; i++) {
    const s = data.scenes[i];
    const dedupeKey = `${(s.location || '').trim()}|${(s.time || '').trim()}`;
    if (sceneDedupeMap.has(dedupeKey)) {
      // 同 location+time 已存在，直接复用，不重复插入
      sceneNewIds.push(sceneDedupeMap.get(dedupeKey));
      continue;
    }
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
    sceneDedupeMap.set(dedupeKey, sceneId);
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
              genOldToNew.set(Number(gen.original_id), {
                newId: newGenId,
                localPath: genLocalPath,
                imageUrl: genImageUrl,
                frameType: gen.frame_type || null,
                status: gen.status || 'completed',
              });
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
        db.prepare(
          `INSERT INTO video_generations
           (drama_id, storyboard_id, provider, prompt, status, video_url, local_path, created_at, updated_at, completed_at)
           VALUES (?, ?, 'imported', ?, 'completed', ?, ?, ?, ?, ?)`
        ).run(dramaId, sbId, sb.video_prompt || '', null, sbVideoLocalPath, now, now, now);
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
  importDrama,
  parseZip,
  resolveSourceOriginalQuotaBytes,
  validateImportComplexity,
};
