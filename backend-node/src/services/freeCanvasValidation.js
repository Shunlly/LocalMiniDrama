'use strict';

const uploadService = require('./uploadService');

const FREE_CANVAS_NODE_TYPES = new Set(['text', 'image', 'video', 'config', 'reference']);
const TEXT_NODE_FIELDS = new Set(['content', 'text', 'label', 'title', 'name', 'description', 'prompt']);
const BOOLEAN_NODE_FIELDS = new Set(['collapsed', 'locked']);
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

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value, field, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw badRequest(`${field} 必须为受限字符串`);
  }
  return value;
}

function requiredString(value, field, maxLength = MAX_TEXT_LENGTH) {
  const result = optionalString(value, field, maxLength);
  if (!result) throw badRequest(`${field} 必填`);
  return result;
}

function optionalPositiveId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw badRequest(`${field} 必须为正整数引用`);
  }
  return normalized;
}

function assertEpisodeScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${field} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${field} 不属于当前项目`);
}

function assertStoryboardScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare(`
    SELECT e.drama_id
    FROM storyboards s
    JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL
  `).get(id);
  if (!row) throw badRequest(`${field} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${field} 不属于当前项目`);
}

function assertSceneScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare('SELECT drama_id FROM scenes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${field} 引用不存在`);
  if (Number(row.drama_id) !== Number(dramaId)) throw badRequest(`${field} 不属于当前项目`);
}

function assertAssetScope(db, dramaId, id, field) {
  if (id == null) return;
  const row = db.prepare('SELECT drama_id FROM assets WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!row) throw badRequest(`${field} 引用不存在`);
  if (row.drama_id != null && Number(row.drama_id) !== Number(dramaId)) {
    throw badRequest(`${field} 不属于当前项目`);
  }
}

function scopedReferenceId(value, dramaId, field, kind) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    return optionalPositiveId(value, field);
  }
  if (typeof value !== 'string') throw badRequest(`${field} 必须为项目范围内的引用`);
  const direct = new RegExp(`^${kind}:(\\d+)$`).exec(value);
  if (direct) return optionalPositiveId(direct[1], field);
  const projectScoped = new RegExp(`^project:(\\d+):${kind}:(\\d+)$`).exec(value);
  if (projectScoped) {
    if (Number(projectScoped[1]) !== Number(dramaId)) {
      throw badRequest(`${field} 不属于当前项目`);
    }
    return optionalPositiveId(projectScoped[2], field);
  }
  throw badRequest(`${field} 必须为项目范围内的引用`);
}

function normalizeMediaReference(value, field) {
  if (typeof value !== 'string' || !value) throw badRequest(`${field} 必须为本地媒体引用`);
  if (/^https?:\/\//i.test(value)) {
    try {
      uploadService.assertPublicHttpUrlSyntax(value);
    } catch (_) {
      throw badRequest(`${field} 必须为安全的本地媒体引用`);
    }
    throw badRequest(`${field} 不支持外部媒体 URL`);
  }
  try {
    const relative = value.startsWith('/static/') ? value.slice('/static/'.length) : value;
    return uploadService.normalizeStorageRelativeReference(relative);
  } catch (_) {
    throw badRequest(`${field} 必须为安全的本地媒体引用`);
  }
}

function validateNode(db, dramaId, input, nodeIds) {
  if (!isPlainObject(input)) throw badRequest('free_canvas 节点必须为对象');
  const id = requiredString(input.id, 'free_canvas node id');
  if (nodeIds.has(id)) throw badRequest('free_canvas node id 必须唯一');
  nodeIds.add(id);
  if (!FREE_CANVAS_NODE_TYPES.has(input.type)) throw badRequest('free_canvas node type 不受支持');
  if (!isPlainObject(input.position) || !Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    throw badRequest('free_canvas node position 必须包含有限坐标');
  }

  const node = { id, type: input.type, position: { x: input.position.x, y: input.position.y } };
  for (const field of TEXT_NODE_FIELDS) {
    if (input[field] === undefined) continue;
    if ((input.type === 'image' || input.type === 'video') && field === 'content') {
      node.content = normalizeMediaReference(input.content, 'free_canvas node content');
    } else {
      node[field] = optionalString(input[field], `free_canvas node ${field}`);
    }
  }
  for (const field of ['width', 'height']) {
    if (input[field] === undefined) continue;
    if (!Number.isFinite(input[field]) || input[field] <= 0 || input[field] > MAX_DIMENSION) {
      throw badRequest(`free_canvas node ${field} 必须为正且受限的数值`);
    }
    node[field] = input[field];
  }
  if (input.zIndex !== undefined) {
    if (!Number.isFinite(input.zIndex) || Math.abs(input.zIndex) > MAX_Z_INDEX) {
      throw badRequest('free_canvas node zIndex 必须为受限数值');
    }
    node.zIndex = input.zIndex;
  }
  for (const field of BOOLEAN_NODE_FIELDS) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') throw badRequest(`free_canvas node ${field} 必须为布尔值`);
    node[field] = input[field];
  }
  if (input.storageKey !== undefined) {
    node.storageKey = normalizeMediaReference(input.storageKey, 'free_canvas node storageKey');
  }

  const assetId = optionalPositiveId(input.assetId, 'assetId');
  const assetRefId = scopedReferenceId(input.asset_ref, dramaId, 'asset_ref', 'asset');
  const storyboardId = optionalPositiveId(input.storyboardId, 'storyboardId');
  const storyboardRefId = scopedReferenceId(input.storyboard_ref, dramaId, 'storyboard_ref', 'storyboard');
  const episodeId = optionalPositiveId(input.episodeId, 'episodeId');
  const sceneId = optionalPositiveId(input.sceneId, 'sceneId');
  assertAssetScope(db, dramaId, assetId, 'asset');
  assertAssetScope(db, dramaId, assetRefId, 'asset_ref');
  assertStoryboardScope(db, dramaId, storyboardId, 'storyboard');
  assertStoryboardScope(db, dramaId, storyboardRefId, 'storyboard_ref');
  assertEpisodeScope(db, dramaId, episodeId, 'episode');
  assertSceneScope(db, dramaId, sceneId, 'scene');
  if (assetId != null) node.assetId = assetId;
  if (input.asset_ref !== undefined) node.asset_ref = input.asset_ref;
  if (storyboardId != null) node.storyboardId = storyboardId;
  if (input.storyboard_ref !== undefined) node.storyboard_ref = input.storyboard_ref;
  if (episodeId != null) node.episodeId = episodeId;
  if (sceneId != null) node.sceneId = sceneId;
  return node;
}

function validateFreeCanvas(db, dramaId, input) {
  if (!isPlainObject(input)) throw badRequest('free_canvas 必须为对象');
  if (input.version !== 1) throw badRequest('free_canvas version 不受支持');
  if (input.mode !== undefined) optionalString(input.mode, 'free_canvas mode', 64);
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw badRequest('free_canvas nodes 和 edges 必须为数组');
  }
  if (input.nodes.length > MAX_NODES || input.edges.length > MAX_EDGES) {
    throw badRequest('free_canvas 超出节点或边数量限制');
  }

  const result = { version: 1, mode: input.mode || 'production' };
  for (const field of ['projectId', 'dramaId']) {
    if (input[field] === undefined) continue;
    const projectId = optionalPositiveId(input[field], field);
    if (projectId !== Number(dramaId)) throw badRequest(`free_canvas ${field} 不属于当前项目`);
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
    if (!isPlainObject(edge)) throw badRequest('free_canvas edge 必须为对象');
    const id = requiredString(edge.id, 'free_canvas edge id');
    if (edgeIds.has(id)) throw badRequest('free_canvas edge id 必须唯一');
    edgeIds.add(id);
    const source = requiredString(edge.source, 'free_canvas edge source');
    const target = requiredString(edge.target, 'free_canvas edge target');
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      throw badRequest('free_canvas edge 引用了不存在的节点');
    }
    const resultEdge = { id, source, target };
    if (edge.type !== undefined) resultEdge.type = optionalString(edge.type, 'free_canvas edge type', 128);
    if (edge.label !== undefined) resultEdge.label = optionalString(edge.label, 'free_canvas edge label');
    if (edge.animated !== undefined) {
      if (typeof edge.animated !== 'boolean') throw badRequest('free_canvas edge animated 必须为布尔值');
      resultEdge.animated = edge.animated;
    }
    return resultEdge;
  });
  return result;
}

module.exports = { validateFreeCanvas, badRequest };
