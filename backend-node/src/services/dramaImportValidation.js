// 项目导入校验：复杂度上限、压缩包路径和暂存媒体内容
const path = require('path');

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

const IMPORT_FIELD_LABELS = Object.freeze({
  characters: '角色',
  episodes: '剧集',
  scenes: '场景',
  props: '道具',
  extra_image_files: '附加图片',
  storyboards: '分镜',
  frame_prompts: '分镜提示词',
  image_generations: '图片生成记录',
  video_generations: '视频生成记录',
  reference_images: '参考图',
  character_indices: '角色引用',
  prop_indices: '道具引用',
  episode_characters: '剧集角色关联',
  source_intake: '故事素材',
  media_references: '媒体引用',
  media_reference: '媒体引用',
});

function importFieldLabel(field) {
  const raw = String(field || '').trim();
  if (IMPORT_FIELD_LABELS[raw]) return IMPORT_FIELD_LABELS[raw];
  const last = raw.split('.').pop().replace(/\[\d+\]/g, '');
  if (IMPORT_FIELD_LABELS[last]) return IMPORT_FIELD_LABELS[last];
  return '该数据';
}

function importKindLabel(kind) {
  if (kind === 'entity') return '实体';
  if (kind === 'media_reference') return '媒体引用';
  if (kind === 'relationship') return '关联';
  return String(kind || '项目');
}

function normalizeImportLimits(overrides = {}) {
  const limits = { ...DEFAULT_IMPORT_LIMITS };
  for (const key of Object.keys(DEFAULT_IMPORT_LIMITS)) {
    if (overrides[key] === undefined) continue;
    const value = Number(overrides[key]);
    if (!Number.isSafeInteger(value) || value <= 0) throw importError('INVALID_LIMIT', '压缩包限制必须是正整数');
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
      `项目清单中的${importFieldLabel(location)}必须是数组`,
      { field: location, expected: 'array' }
    );
  }
  return value;
}

function assertImportRecord(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw structuredImportError(
      'INVALID_IMPORT_STRUCTURE',
      `项目清单中的${importFieldLabel(location)}必须是对象`,
      { field: location, expected: 'object' }
    );
  }
}

function assertImportLimit(code, kind, name, actual, limit) {
  if (actual <= limit) return;
  throw structuredImportError(
    code,
    `项目导入${importKindLabel(kind)}${importFieldLabel(name)}超过配置上限`,
    { kind, name, actual, limit },
    413
  );
}

function addBoundedCount(current, increment, code, kind, name, limit) {
  const next = current + increment;
  if (!Number.isSafeInteger(next)) {
    throw structuredImportError(
      code,
      `项目导入${importKindLabel(kind)}${importFieldLabel(name)}超出安全整数范围`,
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
      '项目清单根节点必须是对象',
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
      '项目导入关联的剧集角色超出安全整数范围',
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

function validateZipEntryName(name, limits, isDirectory = false) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw importError('UNSAFE_ARCHIVE_PATH', '压缩包不安全：条目路径无效');
  }
  const normalizedName = isDirectory ? name.replace(/\/+$/, '') : name;
  const segments = normalizedName.split('/');
  if (!normalizedName || segments.length > limits.maxPathDepth || segments.some((part) => !part || part === '.' || part === '..')) {
    throw importError('UNSAFE_ARCHIVE_PATH', '压缩包不安全：条目路径会逃逸');
  }
  if (Buffer.byteLength(name, 'utf8') > limits.maxPathBytes || path.posix.normalize(normalizedName) !== normalizedName) {
    throw importError('UNSAFE_ARCHIVE_PATH', '压缩包不安全：条目路径过长或未规范化');
  }
  return normalizedName;
}

// 先挂上错误构造函数，再加载媒体校验，避免循环 require 时解构到空对象
module.exports.DramaImportError = DramaImportError;
module.exports.importError = importError;
module.exports.structuredImportError = structuredImportError;

const {
  FREE_CANVAS_MEDIA_FORMATS,
  IMPORT_MEDIA_EXTENSIONS,
  createImageValidatorProcessSpec,
  validateStagedImportMedia,
} = require('./dramaImportMediaValidation');

module.exports = {
  DEFAULT_IMPORT_LIMITS,
  DramaImportError,
  FREE_CANVAS_MEDIA_FORMATS,
  IMPORT_MEDIA_EXTENSIONS,
  createImageValidatorProcessSpec,
  importError,
  normalizeImportLimits,
  structuredImportError,
  validateImportComplexity,
  validateStagedImportMedia,
  validateZipEntryName,
};
