'use strict';

/**
 * 帧提示词作用域校验：storyboard_id / episode_id / drama_id 不得互换。
 * 路由和服务仍通过 framePromptService 调用，本模块不改变公开 API。
 */

const { FRAME_PROMPT_MESSAGES } = require('./framePromptErrors');

const FRAME_TYPES = ['first', 'key', 'last', 'panel', 'action'];

function isSupportedFrameType(frameType) {
  return FRAME_TYPES.includes(frameType);
}

function assertSupportedFrameType(frameType) {
  if (!isSupportedFrameType(frameType)) {
    throw new Error(FRAME_PROMPT_MESSAGES.UNSUPPORTED_FRAME_TYPE);
  }
}

function findExistingStoryboardId(db, storyboardId) {
  const sid = Number(storyboardId);
  const row = db.prepare(
    'SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(sid);
  return row ? row.id : null;
}

function assertStoryboardExists(db, storyboardId) {
  const id = findExistingStoryboardId(db, storyboardId);
  if (id == null) {
    throw new Error(FRAME_PROMPT_MESSAGES.STORYBOARD_NOT_FOUND);
  }
  return id;
}

/**
 * 按分镜主键解析所属剧集与项目。
 * 必须走 storyboards.id → episode_id → episodes.drama_id，禁止把三个 ID 互相套用。
 */
function resolveStoryboardScope(db, storyboardId) {
  const sid = Number(storyboardId);
  if (!Number.isInteger(sid) || sid <= 0) return null;
  let row;
  try {
    row = db.prepare(
      `SELECT s.id AS storyboard_id,
              s.episode_id AS episode_id,
              e.drama_id AS drama_id
         FROM storyboards s
         JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
        WHERE s.id = ? AND s.deleted_at IS NULL`
    ).get(sid);
  } catch (_) {
    return null;
  }
  if (!row) return null;
  const resolvedStoryboardId = Number(row.storyboard_id);
  const episodeId = Number(row.episode_id);
  const dramaId = Number(row.drama_id);
  if (!Number.isInteger(resolvedStoryboardId) || resolvedStoryboardId <= 0) return null;
  if (!Number.isInteger(episodeId) || episodeId <= 0) return null;
  if (!Number.isInteger(dramaId) || dramaId <= 0) return null;
  if (resolvedStoryboardId !== sid) return null;
  return {
    storyboardId: resolvedStoryboardId,
    episodeId,
    dramaId,
  };
}

function loadDramaStyleRowForStoryboard(db, storyboardId) {
  const scope = resolveStoryboardScope(db, storyboardId);
  if (!scope) return null;
  return db.prepare(
    'SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(scope.dramaId) || null;
}

function loadLayoutNeighborStoryboards(db, episodeId, storyboardNumber) {
  const eid = Number(episodeId);
  if (!Number.isInteger(eid) || eid <= 0) return { prev: null, next: null };
  if (storyboardNumber == null) return { prev: null, next: null };
  const prev = db.prepare(`
    SELECT storyboard_number, action, result, layout_description
      FROM storyboards
     WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
     ORDER BY storyboard_number DESC LIMIT 1
  `).get(eid, storyboardNumber);
  const next = db.prepare(`
    SELECT storyboard_number, action, result, layout_description
      FROM storyboards
     WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC LIMIT 1
  `).get(eid, storyboardNumber);
  return { prev: prev || null, next: next || null };
}

module.exports = {
  FRAME_TYPES,
  isSupportedFrameType,
  assertSupportedFrameType,
  findExistingStoryboardId,
  assertStoryboardExists,
  resolveStoryboardScope,
  loadDramaStyleRowForStoryboard,
  loadLayoutNeighborStoryboards,
};