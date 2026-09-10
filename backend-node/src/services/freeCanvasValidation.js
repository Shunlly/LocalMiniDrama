'use strict';

const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');

const FREE_CANVAS_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference']);
const FREE_CANVAS_MODES = new Set(['production', 'free', 'hybrid']);
const FREE_CANVAS_BACKGROUNDS = new Set(['dots', 'lines', 'none']);
const TEXT_NODE_FIELDS = new Set(['content', 'text', 'label', 'title', 'name', 'description', 'prompt']);
const BOOLEAN_NODE_FIELDS = new Set(['collapsed', 'locked']);
const CONFIG_NODE_STATUSES = new Set(['idle', 'running', 'failed', 'cancelled']);
const CONFIG_METADATA_FIELDS = new Map([
  ['lastError', 1000],
  ['operationId', 256],
  ['startedAt', 64],
  ['updatedAt', 64],
]);
const MAX_NODES = 500;
const MAX_EDGES = 1000;
const MAX_TEXT_LENGTH = 50000;
const MAX_DIMENSION = 10000;
const MAX_Z_INDEX = 1000000;

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

const FIELD_LABELS = Object.freeze({
  content: '节点内容',
  text: '节点文本',
  label: '节点标签',
  title: '标题',
  name: '名称',
  description: '节点描述',
  prompt: '节点提示词',
  collapsed: '折叠状态',
  locked: '锁定状态',
  lastError: '最近错误',
  operationId: '操作编号',
  startedAt: '开始时间',
  updatedAt: '更新时间',
  assetId: '素材 ID',
  asset_ref: '素材引用',
  asset: '素材',
  storyboardId: '分镜 ID',
  storyboard_ref: '分镜引用',
  storyboard: '分镜',
  episodeId: '剧集 ID',
  episode: '剧集',
  sceneId: '场景 ID',
  scene: '场景',
  projectId: '项目 ID',
  dramaId: '项目 ID',
  id: 'ID',
  type: '类型',
  position: '坐标',
  width: '宽度',
  height: '高度',
  zIndex: '层级',
  status: '状态',
  metadata: '元数据',
  storageKey: '存储路径',
  media: '媒体',
  source: '起点',
  target: '终点',
  animated: '动画',
  version: '版本',
  mode: '模式',
  background: '背景',
  viewport: '视口',
  'free_canvas node id': '节点 ID',
  'free_canvas node content': '节点内容',
  'free_canvas node text': '节点文本',
  'free_canvas node label': '节点标签',
  'free_canvas node title': '节点标题',
  'free_canvas node name': '节点名称',
  'free_canvas node description': '节点描述',
  'free_canvas node prompt': '节点提示词',
  'free_canvas node collapsed': '节点折叠状态',
  'free_canvas node locked': '节点锁定状态',
  'free_canvas node storageKey': '节点存储路径',
  'free_canvas node media': '节点媒体',
  'free_canvas node width': '节点宽度',
  'free_canvas node height': '节点高度',
  'free_canvas node zIndex': '节点层级',
  'free_canvas node status': '节点状态',
  'free_canvas node metadata': '节点元数据',
  'free_canvas node metadata.lastError': '最近错误',
  'free_canvas node metadata.operationId': '操作编号',
  'free_canvas node metadata.startedAt': '开始时间',
  'free_canvas node metadata.updatedAt': '更新时间',
  'free_canvas title': '自由画布标题',
  'free_canvas edge id': '连线 ID',
  'free_canvas edge source': '连线起点',
  'free_canvas edge target': '连线终点',
  'free_canvas edge type': '连线类型',
  'free_canvas edge label': '连线标签',
  'free_canvas edge animated': '连线动画',
});

function fieldLabel(field) {
  const raw = String(field || '').trim();
  if (FIELD_LABELS[raw]) return FIELD_LABELS[raw];
  const stripped = raw
    .replace(/^free_canvas node metadata\./, '')
    .replace(/^free_canvas node /, '')
    .replace(/^free_canvas edge /, '')
    .replace(/^free_canvas /, '');
  if (FIELD_LABELS[stripped]) return FIELD_LABELS[stripped];
  return '画布字段';
}


function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value, field, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw badRequest(`${fieldLabel(field)} 必须为受限字符串`);
  }
  return value;
}

function requiredString(value, field, maxLength = MAX_TEXT_LENGTH) {
  const result = optionalString(value, field, maxLength);
  if (!result) throw badRequest(`${fieldLabel(field)} 必填`);
  return result;
}

function optionalPositiveId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw badRequest(`${fieldLabel(field)} 必须为正整数引用`);
  }
  return normalized;
}

function assertEpisodeScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${fieldLabel(field)} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
}

function assertStoryboardScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare(`
    SELECT e.drama_id
    FROM storyboards s
    JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL
  `).get(id);
  if (!row) throw badRequest(`${fieldLabel(field)} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
}

function assertSceneScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare('SELECT drama_id FROM scenes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${fieldLabel(field)} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
}

function assertAssetScope(db, dramaId, id, field) {
  if (id == null) return null;
  const row = db.prepare('SELECT drama_id, local_path FROM assets WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${fieldLabel(field)} 引用不存在`);
  if (Number(row.drama_id) === 0) {
    try {
      const relative = uploadService.normalizeStorageRelativeReference(row.local_path);
      if (relative === 'uploads' || relative.startsWith('uploads/')) {
        return { ...row, drama_id: null, local_path: relative };
      }
    } catch (_) {}
  }
  if (row.drama_id != null && Number(row.drama_id) !== Number(dramaId)) {
    throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
  }
  return row;
}

function scopedReferenceId(value, dramaId, field, kind) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    return optionalPositiveId(value, field);
  }
  if (typeof value !== 'string') throw badRequest(`${fieldLabel(field)} 必须为项目范围内的引用`);
  const direct = new RegExp(`^${kind}:(\\d+)$`).exec(value);
  if (direct) return optionalPositiveId(direct[1], field);
  const projectScoped = new RegExp(`^project:(\\d+):${kind}:(\\d+)$`).exec(value);
  if (projectScoped) {
    if (Number(projectScoped[1]) !== Number(dramaId)) {
      throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
    }
    return optionalPositiveId(projectScoped[2], field);
  }
  throw badRequest(`${fieldLabel(field)} 必须为项目范围内的引用`);
}

function projectStoragePrefixes(db, dramaId) {
  const drama = db.prepare(
    'SELECT id, title, created_at, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(dramaId));
  if (!drama) throw badRequest('当前项目不存在');
  return [storageLayout.buildProjectRelativeDir(drama), `dramas/${Number(drama.id)}`];
}

function assertMediaProjectScope(db, dramaId, relative, field, options = {}) {
  if (relative === 'library' || relative.startsWith('library/')) return relative;
  if (
    options.allowLegacyGlobalUploads
    && (relative === 'uploads' || relative.startsWith('uploads/'))
  ) {
    return relative;
  }
  const allowed = projectStoragePrefixes(db, dramaId).some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
  if (!allowed) throw badRequest(`${fieldLabel(field)} 不属于当前项目或公共素材库`);
  return relative;
}

function normalizeMediaReference(db, dramaId, value, field, options = {}) {
  if (typeof value !== 'string' || !value) throw badRequest(`${fieldLabel(field)} 必须为本地媒体引用`);
  if (/^https?:\/\//i.test(value)) {
    try {
      uploadService.assertPublicHttpUrlSyntax(value);
    } catch (_) {
      throw badRequest(`${fieldLabel(field)} 必须为安全的本地媒体引用`);
    }
    throw badRequest(`${fieldLabel(field)} 不支持外部媒体地址`);
  }
  try {
    const relative = value.startsWith('/static/') ? value.slice('/static/'.length) : value;
    return assertMediaProjectScope(
      db,
      dramaId,
      uploadService.normalizeStorageRelativeReference(relative),
      field,
      options,
    );
  } catch (_) {
    throw badRequest(`${fieldLabel(field)} 必须为安全的本地媒体引用`);
  }
}

function validateConfigMetadata(input) {
  if (!isPlainObject(input)) throw badRequest('节点元数据必须为对象');
  const unknownFields = Object.keys(input).filter((field) => !CONFIG_METADATA_FIELDS.has(field));
  if (unknownFields.length) throw badRequest('节点元数据包含不受支持的字段');
  const metadata = {};
  for (const [field, maxLength] of CONFIG_METADATA_FIELDS) {
    if (input[field] === undefined) continue;
    metadata[field] = optionalString(input[field], `free_canvas node metadata.${field}`, maxLength);
  }
  return metadata;
}

function canonicalAssetMediaReference(db, dramaId, asset, field) {
  if (!asset?.local_path) throw badRequest(`${fieldLabel(field)} 引用缺少本地媒体路径`);
  return normalizeMediaReference(db, dramaId, asset.local_path, field, {
    allowLegacyGlobalUploads: asset.drama_id == null,
  });
}

function normalizeFreeCanvasAssetReferences(input, dramaId) {
  if (!isPlainObject(input)) throw badRequest('自由画布节点必须为对象');
  const assetId = optionalPositiveId(input.assetId, 'assetId');
  const assetRefId = scopedReferenceId(input.asset_ref, dramaId, 'asset_ref', 'asset');
  if (assetId != null && assetRefId != null && assetId !== assetRefId) {
    throw badRequest('素材 ID 与素材引用必须指向同一素材');
  }
  return { assetId, assetRefId, resolvedId: assetId ?? assetRefId };
}

function normalizeFreeCanvasMediaReference(db, dramaId, value, options = {}) {
  return normalizeMediaReference(db, dramaId, value, 'free_canvas node media', options);
}

function validateNode(db, dramaId, input, nodeIds) {
  if (!isPlainObject(input)) throw badRequest('自由画布节点必须为对象');
  const id = requiredString(input.id, 'free_canvas node id');
  if (nodeIds.has(id)) throw badRequest('节点 ID 必须唯一');
  nodeIds.add(id);
  if (!FREE_CANVAS_NODE_TYPES.has(input.type)) throw badRequest('节点类型不受支持');
  if (!isPlainObject(input.position) || !Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    throw badRequest('节点坐标必须包含有限数值');
  }

  const node = { id, type: input.type, position: { x: input.position.x, y: input.position.y } };
  const { assetId, assetRefId, resolvedId: resolvedAssetId } = normalizeFreeCanvasAssetReferences(input, dramaId);
  const storyboardId = optionalPositiveId(input.storyboardId, 'storyboardId');
  const storyboardRefId = scopedReferenceId(input.storyboard_ref, dramaId, 'storyboard_ref', 'storyboard');
  if (storyboardId != null && storyboardRefId != null && storyboardId !== storyboardRefId) {
    throw badRequest('分镜 ID 与分镜引用必须指向同一分镜');
  }
  const episodeId = optionalPositiveId(input.episodeId, 'episodeId');
  const sceneId = optionalPositiveId(input.sceneId, 'sceneId');
  const asset = assertAssetScope(db, dramaId, resolvedAssetId, assetId != null ? 'asset' : 'asset_ref');
  assertStoryboardScope(db, dramaId, storyboardId, 'storyboard');
  assertStoryboardScope(db, dramaId, storyboardRefId, 'storyboard_ref');
  assertEpisodeScope(db, dramaId, episodeId, 'episode');
  assertSceneScope(db, dramaId, sceneId, 'scene');
  const mediaAssetPath = (input.type === 'image' || input.type === 'video') && asset
    ? canonicalAssetMediaReference(db, dramaId, asset, 'asset')
    : null;
  const mediaReferenceOptions = {
    allowLegacyGlobalUploads: Boolean(mediaAssetPath && asset?.drama_id == null),
  };
  for (const field of TEXT_NODE_FIELDS) {
    if (input[field] === undefined) continue;
    if ((input.type === 'image' || input.type === 'video') && field === 'content') {
      const content = normalizeMediaReference(
        db,
        dramaId,
        input.content,
        'free_canvas node content',
        mediaReferenceOptions,
      );
      if (mediaAssetPath && content !== mediaAssetPath) {
        throw badRequest('节点内容必须与素材本地路径一致');
      }
      node.content = mediaAssetPath || content;
    } else {
      node[field] = optionalString(input[field], `free_canvas node ${field}`);
    }
  }
  if (mediaAssetPath && input.content === undefined) node.content = mediaAssetPath;
  for (const field of ['width', 'height']) {
    if (input[field] === undefined) continue;
    if (!Number.isFinite(input[field]) || input[field] <= 0 || input[field] > MAX_DIMENSION) {
      throw badRequest(`${fieldLabel(`free_canvas node ${field}`)} 必须为正且受限的数值`);
    }
    node[field] = input[field];
  }
  if (input.zIndex !== undefined) {
    if (!Number.isFinite(input.zIndex) || Math.abs(input.zIndex) > MAX_Z_INDEX) {
      throw badRequest('节点层级必须为受限数值');
    }
    node.zIndex = input.zIndex;
  }
  for (const field of BOOLEAN_NODE_FIELDS) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') throw badRequest(`${fieldLabel(`free_canvas node ${field}`)} 必须为布尔值`);
    node[field] = input[field];
  }
  if (input.status !== undefined) {
    if (input.type !== 'config' || !CONFIG_NODE_STATUSES.has(input.status)) {
      throw badRequest('节点状态不受支持');
    }
    node.status = input.status;
  }
  if (input.metadata !== undefined) {
    if (input.type !== 'config') throw badRequest('节点元数据仅支持配置节点');
    node.metadata = validateConfigMetadata(input.metadata);
  }
  if (input.storageKey !== undefined) {
    const storageKey = normalizeMediaReference(
      db,
      dramaId,
      input.storageKey,
      'free_canvas node storageKey',
      mediaReferenceOptions,
    );
    if (mediaAssetPath && storageKey !== mediaAssetPath) {
      throw badRequest('节点存储路径必须与素材本地路径一致');
    }
    node.storageKey = mediaAssetPath || storageKey;
  }
  if (mediaAssetPath && input.storageKey === undefined) node.storageKey = mediaAssetPath;
  if (assetId != null) node.assetId = assetId;
  if (input.asset_ref !== undefined) node.asset_ref = input.asset_ref;
  if (storyboardId != null) node.storyboardId = storyboardId;
  if (input.storyboard_ref !== undefined) node.storyboard_ref = input.storyboard_ref;
  if (episodeId != null) node.episodeId = episodeId;
  if (sceneId != null) node.sceneId = sceneId;
  return node;
}

function validateFreeCanvas(db, dramaId, input) {
  if (!isPlainObject(input)) throw badRequest('自由画布必须为对象');
  if (input.version !== 1) throw badRequest('自由画布版本不受支持');
  if (input.mode !== undefined && !FREE_CANVAS_MODES.has(input.mode)) {
    throw badRequest('自由画布模式不受支持');
  }
  if (input.background !== undefined && !FREE_CANVAS_BACKGROUNDS.has(input.background)) {
    throw badRequest('自由画布背景不受支持');
  }
  if (input.viewport !== undefined) {
    if (
      !isPlainObject(input.viewport)
      || !Number.isFinite(input.viewport.x)
      || !Number.isFinite(input.viewport.y)
      || !Number.isFinite(input.viewport.zoom)
      || input.viewport.zoom < 0.25
      || input.viewport.zoom > 2
    ) {
      throw badRequest('自由画布视口必须包含受限的有限坐标和缩放');
    }
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw badRequest('自由画布节点和连线必须为数组');
  }
  if (input.nodes.length > MAX_NODES || input.edges.length > MAX_EDGES) {
    throw badRequest('自由画布超出节点或连线数量限制');
  }

  const result = {
    version: 1,
    mode: input.mode || 'production',
    background: input.background || 'dots',
    viewport: input.viewport
      ? { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom }
      : { x: 0, y: 0, zoom: 0.9 },
  };
  for (const field of ['projectId', 'dramaId']) {
    if (input[field] === undefined) continue;
    const projectId = optionalPositiveId(input[field], field);
    if (projectId !== Number(dramaId)) throw badRequest(`${fieldLabel(field)} 不属于当前项目`);
    result[field] = projectId;
  }
  if (input.episodeId !== undefined) {
    const episodeId = optionalPositiveId(input.episodeId, 'episodeId');
    assertEpisodeScope(db, dramaId, episodeId, 'episodeId');
    result.episodeId = episodeId;
  }
  if (input.title !== undefined) result.title = optionalString(input.title, 'free_canvas title');

  const nodeIds = new Set();
  result.nodes = input.nodes.map((node) => validateNode(db, dramaId, node, nodeIds));
  const edgeIds = new Set();
  result.edges = input.edges.map((edge) => {
    if (!isPlainObject(edge)) throw badRequest('自由画布连线必须为对象');
    const id = requiredString(edge.id, 'free_canvas edge id');
    if (edgeIds.has(id)) throw badRequest('连线 ID 必须唯一');
    edgeIds.add(id);
    const source = requiredString(edge.source, 'free_canvas edge source');
    const target = requiredString(edge.target, 'free_canvas edge target');
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      throw badRequest('连线引用了不存在的节点');
    }
    const resultEdge = { id, source, target };
    if (edge.type !== undefined) resultEdge.type = optionalString(edge.type, 'free_canvas edge type', 128);
    if (edge.label !== undefined) resultEdge.label = optionalString(edge.label, 'free_canvas edge label');
    if (edge.animated !== undefined) {
      if (typeof edge.animated !== 'boolean') throw badRequest('连线动画必须为布尔值');
      resultEdge.animated = edge.animated;
    }
    return resultEdge;
  });
  return result;
}

module.exports = {
  validateFreeCanvas,
  badRequest,
  normalizeFreeCanvasAssetReferences,
  normalizeFreeCanvasMediaReference,
};
