/**
 * 分镜路由校验：ID、帧类型、润色草稿，以及权限失败即拒绝。
 * 对用户文案不得夹裸英文字段名。
 */
const response = require('../response');
const {
  assertResourceWritable,
  assertEpisodeWritable,
  isBoundaryError,
} = require('../services/dramaWriteGuard');
const { toUserFacingProcessError } = require('../services/providerErrorSanitizer');
const M = require('./storyboardsMessages');

const FRAME_TYPES = Object.freeze(['first', 'key', 'last', 'panel', 'action']);

function parsePositiveId(value, missingMessage, invalidMessage) {
  if (value == null || String(value).trim() === '') {
    return { ok: false, message: missingMessage };
  }
  const id = Number(value);
  if (!Number.isFinite(id) || id === 0) {
    return { ok: false, message: missingMessage };
  }
  if (!Number.isInteger(id) || id < 0) {
    return { ok: false, message: invalidMessage };
  }
  return { ok: true, id };
}

function parseStoryboardId(value) {
  return parsePositiveId(value, M.MISSING_STORYBOARD_ID, M.INVALID_STORYBOARD_ID);
}

function parseEpisodeId(value, options = {}) {
  return parsePositiveId(
    value,
    options.missingMessage || M.MISSING_EPISODE_ID,
    M.INVALID_EPISODE_ID
  );
}

function parseFrameType(frameType) {
  if (!FRAME_TYPES.includes(frameType)) {
    return { ok: false, message: M.UNSUPPORTED_FRAME_TYPE };
  }
  return { ok: true, frameType };
}

function parseFramePromptBody(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  const description = typeof body?.description === 'string' ? body.description : null;
  const layout = typeof body?.layout === 'string' ? body.layout : null;
  if (!prompt.trim()) return { ok: false, message: M.PROMPT_REQUIRED };
  return { ok: true, prompt, description, layout };
}

function validatePolishableContent(sb) {
  if (!sb || (!sb.image_prompt && !sb.action && !sb.dialogue)) {
    return { ok: false, message: M.NOTHING_TO_POLISH };
  }
  return { ok: true };
}

function parseUniversalDraft(body) {
  const draftRaw = body && body.draft_universal_segment_text != null
    ? String(body.draft_universal_segment_text)
    : '';
  const draft = draftRaw.trim();
  if (!draft) return { ok: false, message: M.UNIVERSAL_DRAFT_REQUIRED };
  return { ok: true, draftRaw, draft };
}

function parseClassicCreationMode(sbRow) {
  const mode = sbRow && sbRow.creation_mode === 'universal' ? 'universal' : 'classic';
  if (mode === 'universal') {
    return { ok: false, mode, message: M.CLASSIC_POLISH_WRONG_MODE };
  }
  return { ok: true, mode };
}

function parseClassicVideoAnchor(draftRaw, dbVideoPrompt, autoComposed) {
  const draftTrim = draftRaw != null ? String(draftRaw).trim() : '';
  const dbVp = dbVideoPrompt != null ? String(dbVideoPrompt).trim() : '';
  const currentDraft = draftTrim || dbVp;
  const anchor = currentDraft || String(autoComposed || '').trim();
  if (!anchor || anchor.length < 4) {
    return { ok: false, message: M.CLASSIC_DRAFT_REQUIRED };
  }
  return { ok: true, draftTrim, currentDraft, anchor };
}

function createUnavailableError(message) {
  const error = new Error(message);
  error.code = 'RESOURCE_NOT_FOUND';
  error.statusCode = 404;
  return error;
}

function assertStoryboardWritableFailClosed(db, storyboardId) {
  const row = assertResourceWritable(db, 'storyboards', storyboardId);
  const episodeId = Number(row.episode_id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw createUnavailableError(M.STORYBOARD_UNAVAILABLE);
  }
  assertEpisodeWritable(db, episodeId);
  return row;
}

function assertEpisodeWritableFailClosed(db, episodeId) {
  return assertEpisodeWritable(db, episodeId);
}

function sendStoryboardBoundaryFailure(res, error, notFoundMessage = M.STORYBOARD_UNAVAILABLE) {
  if (!isBoundaryError(error)) return false;
  if (error.code === 'BAD_REQUEST' || error.code === 'CROSS_PROJECT_REFERENCE') {
    response.badRequest(res, toUserFacingProcessError(error, M.REQUEST_INVALID));
    return true;
  }
  if (error.code === 'DRAMA_RECYCLE_IN_PROGRESS') {
    response.error(res, 409, error.code, toUserFacingProcessError(error, M.DRAMA_RECYCLING));
    return true;
  }
  response.notFound(res, notFoundMessage);
  return true;
}

function sendPromptBundleFailure(res, built) {
  if (!built || built.ok) return false;
  if (built.code === 'not_found') {
    response.notFound(res, built.message);
    return true;
  }
  response.badRequest(res, built.message);
  return true;
}

module.exports = {
  FRAME_TYPES,
  parseStoryboardId,
  parseEpisodeId,
  parseFrameType,
  parseFramePromptBody,
  validatePolishableContent,
  parseUniversalDraft,
  parseClassicCreationMode,
  parseClassicVideoAnchor,
  assertStoryboardWritableFailClosed,
  assertEpisodeWritableFailClosed,
  sendStoryboardBoundaryFailure,
  sendPromptBundleFailure,
};
