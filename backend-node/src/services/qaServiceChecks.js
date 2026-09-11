'use strict';

/**
 * 质量检查编排：收集数据后套用规则，再把结果交给装配层。
 * 数据收集见 qaServiceCheckCollectors.js，规则判定见 qaServiceCheckRules.js。
 * 路由仍通过 qaService 调用，本模块不改变公开 API。
 */

const { toUserFacingProcessError: defaultToUserFacingProcessError } = require('./providerErrorSanitizer');
const {
  parseJson,
  toJson,
  nowIso,
  hasText,
  isRealMediaPath,
  isMockProviderName,
  containsMockReference,
  isNonMockProviderRow,
  isNonMockGenerationRow,
  addIssue,
  applySourceIntakeCheck,
  applyStoryIrCheck,
  applyEpisodesCheck,
  applyCharacterContinuityCheck,
  applyAssetLibraryCheck,
  applyStoryboardsCheck,
  applyAssetReferencesCheck,
  applyMediaTimelineCheck,
  applyWorkflowIntegrityCheck,
  applyProviderAuditCheck,
  applySkillAuditCheck,
  applySkillTemplateCheck,
  applyLegacyAsyncCheck,
} = require('./qaServiceCheckRules');
const {
  firstRealAsset,
  getEpisodes,
  getStoryboardsForEpisodes,
  hasTimelineForEpisodes,
  collectAssetReferenceFailures,
  collectGeneratedMedia,
  collectSourceIntake,
  collectStoryIr,
  collectCharacters,
  collectScenes,
  collectProps,
  collectWorkflowSteps,
  collectProviderAudit,
} = require('./qaServiceCheckCollectors');

function runQaChecks(db, { drama_id, episode_id, run_id, mode } = {}, toUserFacingProcessError = defaultToUserFacingProcessError) {
  const dramaId = Number(drama_id);
  const episodeId = episode_id == null ? null : Number(episode_id);
  const auditMode = mode === 'draft' ? 'draft' : 'production';
  const draftMode = auditMode === 'draft';
  const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
  if (!drama) {
    return { dramaMissing: true, dramaId };
  }

  const issues = [];
  const checks = [];
  const ctx = {
    db,
    dramaId,
    episodeId,
    runId: run_id || null,
    auditMode,
    draftMode,
    issues,
    checks,
    score: 0,
    toUserFacingProcessError,
  };

  Object.assign(ctx, collectSourceIntake(db, dramaId));
  applySourceIntakeCheck(ctx);

  Object.assign(ctx, collectStoryIr(db, dramaId));
  applyStoryIrCheck(ctx);

  ctx.episodes = getEpisodes(db, dramaId, episodeId);
  applyEpisodesCheck(ctx);

  ctx.characterRows = collectCharacters(db, dramaId);
  applyCharacterContinuityCheck(ctx);

  ctx.sceneRows = collectScenes(db, dramaId);
  ctx.propRows = collectProps(db, dramaId);
  applyAssetLibraryCheck(ctx);

  ctx.episodeIds = ctx.episodes.map((ep) => ep.id);
  ctx.storyboards = getStoryboardsForEpisodes(db, ctx.episodeIds);
  applyStoryboardsCheck(ctx);

  ctx.assetReferenceFailures = draftMode ? [] : collectAssetReferenceFailures(db, ctx.storyboards, ctx.characterRows, ctx.sceneRows);
  applyAssetReferencesCheck(ctx);

  Object.assign(ctx, collectGeneratedMedia(db, ctx.storyboards));
  ctx.timeline = hasTimelineForEpisodes(db, ctx.episodeIds, { production: !draftMode });
  applyMediaTimelineCheck(ctx);

  ctx.stepRows = collectWorkflowSteps(db, run_id);
  applyWorkflowIntegrityCheck(ctx);

  Object.assign(ctx, collectProviderAudit(db, run_id));
  applyProviderAuditCheck(ctx);
  applySkillAuditCheck(ctx);
  applySkillTemplateCheck(ctx);
  applyLegacyAsyncCheck(ctx);

  return {
    dramaMissing: false,
    dramaId,
    episodeId,
    runId: run_id || null,
    auditMode,
    draftMode,
    score: ctx.score,
    issues,
    checks,
    sourceCount: ctx.sourceCount,
    stepRows: ctx.stepRows,
  };
}

module.exports = {
  parseJson,
  toJson,
  nowIso,
  hasText,
  isRealMediaPath,
  isMockProviderName,
  containsMockReference,
  firstRealAsset,
  isNonMockProviderRow,
  isNonMockGenerationRow,
  addIssue,
  hasTimelineForEpisodes,
  runQaChecks,
};
