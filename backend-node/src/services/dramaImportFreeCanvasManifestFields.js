'use strict';

const path = require('path');
const uploadService = require('./uploadService');
const { badRequest: freeCanvasBadRequest } = require('./freeCanvasValidation');
const {
  FREE_CANVAS_MEDIA_FORMATS,
} = require('./dramaImportValidation');

/** 自由画布导入清单字段标签与基本校验 */
const FREE_CANVAS_IMPORT_MANIFEST_VERSION = 1;
const FREE_CANVAS_VIDEO_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'cancelled']);

// 用户错误只展示中文标签，内部 JSON 字段名保持不变。
const FREE_CANVAS_IMPORT_FIELD_LABELS = Object.freeze({
  source_drama_id: '源项目',
  episode_ids: '剧集列表',
  storyboard_ids: '分镜列表',
  scene_refs: '场景引用',
  'scene_refs.export_index': '场景导出序号',
  'scene_refs.source_id': '场景源标识',
  assets: '素材列表',
  'assets.source_id': '素材源标识',
  'assets.source_path': '素材本地路径',
  'assets.name': '素材名称',
  'assets.type': '素材类型',
  'assets.category': '素材分类',
  'assets.file_size': '素材文件大小',
  'assets.mime_type': '素材媒体类型',
  'assets.width': '素材宽度',
  'assets.height': '素材高度',
  'assets.duration': '素材时长',
  'assets.image_gen_id': '素材图片生成引用',
  'assets.video_gen_id': '素材视频生成引用',
  video_generations: '视频生成记录',
  'video_generations.source_id': '视频生成源标识',
  'video_generations.storyboard_id': '视频生成分镜引用',
  'video_generations.scene_id': '视频生成场景引用',
  'video_generations.provider': '视频生成服务商',
  'video_generations.prompt': '视频生成提示词',
  'video_generations.model': '视频生成模型',
  'video_generations.duration': '视频生成时长',
  'video_generations.aspect_ratio': '视频生成画面比例',
  'video_generations.status': '视频生成状态',
  'video_generations.error_msg': '视频生成错误信息',
  'video_generations.source_path': '视频生成本地路径',
  media: '媒体记录',
  'media.archive_path': '媒体归档路径',
  'media.size': '媒体大小',
  'media.sha256': '媒体哈希',
  'media.source_path': '媒体本地路径',
  'media.detected_format': '媒体检测格式',
  'media.image_generation_id': '媒体图片生成引用',
  'media.video_generation_id': '媒体视频生成引用',
  'media.category': '媒体分类',
  projectId: '项目 ID',
  dramaId: '项目 ID',
  episodeId: '剧集 ID',
  assetId: '素材 ID',
  asset_ref: '素材引用',
  storyboardId: '分镜 ID',
  storyboard_ref: '分镜引用',
  sceneId: '场景 ID',
  content: '节点内容',
  storageKey: '节点存储路径',
  'node content': '节点内容',
  'node storageKey': '节点存储路径',
  'node media': '节点媒体',
});


function freeCanvasImportFieldLabel(field) {
  const raw = String(field || '').trim();
  if (FREE_CANVAS_IMPORT_FIELD_LABELS[raw]) return FREE_CANVAS_IMPORT_FIELD_LABELS[raw];
  const normalized = raw.replace(/\[\d+\]/g, '');
  if (FREE_CANVAS_IMPORT_FIELD_LABELS[normalized]) return FREE_CANVAS_IMPORT_FIELD_LABELS[normalized];
  const root = normalized.includes('.') ? normalized.slice(0, normalized.indexOf('.')) : normalized;
  if (FREE_CANVAS_IMPORT_FIELD_LABELS[root]) return FREE_CANVAS_IMPORT_FIELD_LABELS[root];
  return '数据';
}

function freeCanvasManifestArray(value, field) {
  if (!Array.isArray(value)) throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为数组`);
  return value;
}

function freeCanvasManifestId(value, field, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const id = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为正整数`);
  }
  return id;
}

function freeCanvasManifestString(value, field, maxLength, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为受限字符串`);
  }
  return value;
}

function freeCanvasAssetCategory(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为受限字符串`);
  }
  if (value.length > 4096) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为受限字符串`);
  }
  if (!value.trimStart().startsWith('{')) {
    if (value.length <= 128) return value;
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为受限字符串`);
  }
  let metadata;
  try {
    metadata = JSON.parse(value);
  } catch (_) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
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
    'openverse_id',
    'landing_page',
    'source_site',
  ]);
  if (metadata?.kind !== 'wikimedia_commons' && metadata?.kind !== 'openverse' && value.length <= 128) return value;
  if (
    !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || Object.keys(metadata).some((key) => !allowed.has(key))
  ) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
  }
  if (metadata.kind === 'openverse') {
    const boundedOpenverse = [
      ['source_url', 4096],
      ['author', 500],
      ['license', 200],
      ['license_url', 2048],
      ['resolved_download_url', 4096],
      ['content_sha256', 64],
      ['openverse_id', 36],
      ['landing_page', 4096],
      ['source_site', 200],
    ];
    if (boundedOpenverse.some(([key, limit]) => (
      metadata[key] != null
      && (typeof metadata[key] !== 'string' || metadata[key].length > limit)
    ))) {
      throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
    }
    try {
      const source = new URL(metadata.source_url);
      const resolvedDownload = new URL(metadata.resolved_download_url);
      const landing = metadata.landing_page ? new URL(metadata.landing_page) : null;
      const id = String(metadata.openverse_id || '').toLowerCase();
      const sourceMatch = source.pathname.match(/^\/image\/([0-9a-f-]{36})\/?$/i);
      if (
        metadata.source_provider !== 'Openverse'
        || source.protocol !== 'https:'
        || source.origin !== 'https://openverse.org'
        || source.username
        || source.password
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        || !sourceMatch
        || sourceMatch[1].toLowerCase() !== id
        || typeof metadata.license !== 'string'
        || !metadata.license.trim()
        || metadata.license === '未注明'
        || !/^[a-f0-9]{64}$/i.test(String(metadata.content_sha256 || ''))
        || resolvedDownload.protocol !== 'https:'
        || resolvedDownload.username
        || resolvedDownload.password
        || (landing && (landing.protocol !== 'https:' || landing.username || landing.password))
      ) {
        throw new Error('invalid');
      }
    } catch (_) {
      throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
    }
    return value;
  }
  if (
    metadata.kind !== 'wikimedia_commons'
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
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
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
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
  }
  try {
    const source = new URL(metadata.source_url);
    if (
      source.protocol !== 'https:'
      || source.origin !== 'https://commons.wikimedia.org'
      || source.username
      || source.password
    ) throw new Error('素材源引用不安全，请检查项目包后重试');
    const sourceMatch = source.pathname.match(/^\/wiki\/(.+)$/);
    const sourceTitle = sourceMatch
      ? decodeURIComponent(sourceMatch[1]).replace(/_/g, ' ').normalize('NFC')
      : '';
    if (sourceTitle !== metadata.commons_title.normalize('NFC')) throw new Error('素材标题与清单不一致，请检查项目包后重试');
    for (const key of ['license_url', 'resolved_download_url']) {
      if (!metadata[key]) continue;
      const url = new URL(metadata[key]);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('素材 URL 不安全，仅支持不含凭据的 https 地址');
    }
  } catch (_) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}包含无效的网络素材元数据`);
  }
  return value;
}

function freeCanvasCommonsEvidence(category) {
  if (typeof category !== 'string' || !category.startsWith('{')) return null;
  try {
    const metadata = JSON.parse(category);
    if (metadata?.kind === 'openverse') {
      return {
        contentSha256: String(metadata.content_sha256 || '').toLowerCase(),
        commonsSha1: null,
      };
    }
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
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为非负数值`);
  }
  if (options.integer && !Number.isSafeInteger(value)) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为安全整数`);
  }
  return value;
}

function normalizeFreeCanvasManifestSourcePath(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为本地媒体引用`);
  }
  const reference = value.trim().startsWith('/static/')
    ? value.trim().slice('/static/'.length)
    : value.trim();
  try {
    return uploadService.normalizeStorageRelativeReference(reference);
  } catch (_) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为安全的本地媒体引用`);
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
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为安全归档路径`);
  }
  return archivePath;
}

function normalizeFreeCanvasDetectedFormat(value, category, archivePath, field) {
  const detectedFormat = freeCanvasManifestString(value, field, 32);
  if (!FREE_CANVAS_MEDIA_FORMATS[category]?.has(detectedFormat)) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}媒体格式不受支持`);
  }
  const extension = path.posix.extname(archivePath).toLowerCase();
  const expectedFormat = extension === '.jpg' || extension === '.jpeg'
    ? 'jpeg'
    : extension.slice(1);
  if (detectedFormat !== expectedFormat) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}与归档扩展名格式不一致`);
  }
  return detectedFormat;
}

function normalizeFreeCanvasVideoStatus(value, field) {
  const status = freeCanvasManifestString(value, field, 32);
  if (!FREE_CANVAS_VIDEO_STATUSES.has(status)) {
    throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}不受支持`);
  }
  return status;
}

function declaredFreeCanvasDramaId(canvas) {
  const rootIds = ['projectId', 'dramaId']
    .filter((field) => canvas[field] !== undefined)
    .map((field) => freeCanvasManifestId(canvas[field], field));
  if (rootIds.length === 0) return null;
  if (rootIds.some((id) => id !== rootIds[0])) {
    throw freeCanvasBadRequest('自由画布项目标识必须引用同一项目');
  }
  return rootIds[0];
}


function parseFreeCanvasReferenceId(value, sourceDramaId, field, kind) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  if (typeof value !== 'string') throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为项目范围内的引用`);
  const direct = new RegExp(`^${kind}:(\\d+)$`).exec(value);
  if (direct) return Number(direct[1]);
  const scoped = new RegExp(`^project:(\\d+):${kind}:(\\d+)$`).exec(value);
  if (scoped) {
    if (Number(scoped[1]) !== sourceDramaId) throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}不属于当前项目`);
    return Number(scoped[2]);
  }
  throw freeCanvasBadRequest(`自由画布导入${freeCanvasImportFieldLabel(field)}必须为项目范围内的引用`);
}

function freeCanvasSourceDramaId(canvas, dramaId) {
  const declaredDramaId = declaredFreeCanvasDramaId(canvas);
  if (declaredDramaId === Number(dramaId)) return null;
  return declaredDramaId;
}

module.exports = {
  FREE_CANVAS_IMPORT_MANIFEST_VERSION,
  declaredFreeCanvasDramaId,
  freeCanvasCommonsEvidence,
  freeCanvasAssetCategory,
  freeCanvasImportFieldLabel,
  freeCanvasManifestArray,
  freeCanvasManifestId,
  freeCanvasManifestNumber,
  freeCanvasManifestString,
  freeCanvasSourceDramaId,
  normalizeFreeCanvasArchivePath,
  normalizeFreeCanvasDetectedFormat,
  normalizeFreeCanvasManifestSourcePath,
  normalizeFreeCanvasVideoStatus,
  parseFreeCanvasReferenceId,
};
