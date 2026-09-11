'use strict';

/**
 * 质量检查规则：媒体真实性判定、issue 记录，以及 runQaChecks 的各检查块。
 * 路由仍通过 qaService 调用，本模块不改变公开 API。
 */

const { issueMessage, PROCESS_ERROR_FALLBACKS } = require('./qaServiceMessages');

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function nowIso() {
  return new Date().toISOString();
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function isRealMediaPath(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^mock:\/\//i.test(text)) return false;
  if (/^placeholder:\/\//i.test(text)) return false;
  return true;
}

function isMockProviderName(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'mock' || text === 'mock-compositor' || text.startsWith('mock-');
}

function containsMockReference(value) {
  const parsed = parseJson(value, value);
  const stack = [parsed];
  while (stack.length) {
    const item = stack.pop();
    if (item == null) continue;
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    if (typeof item === 'object') {
      stack.push(...Object.values(item));
      continue;
    }
    if (typeof item === 'string' && /^(?:mock|placeholder):\/\//i.test(item.trim())) return true;
  }
  return false;
}

function hasRealMediaFieldKey(key) {
  const text = String(key || '').toLowerCase();
  return text === 'url' ||
    text === 'urls' ||
    text === 'files' ||
    text.endsWith('_url') ||
    text.endsWith('_urls') ||
    text.endsWith('_path') ||
    text.endsWith('_paths') ||
    text.includes('media') ||
    text.includes('asset') ||
    text.includes('file');
}

function outputHasRealValue(value) {
  const parsed = parseJson(value, null);
  const stack = parsed == null ? [{ key: 'output', value }] : [{ key: '', value: parsed }];
  while (stack.length) {
    const { key, value: item } = stack.pop();
    if (item == null) continue;
    if (Array.isArray(item)) {
      item.forEach((child) => stack.push({ key, value: child }));
      continue;
    }
    if (typeof item === 'object') {
      Object.entries(item).forEach(([childKey, child]) => stack.push({ key: childKey, value: child }));
      continue;
    }
    if (typeof item === 'string' && hasRealMediaFieldKey(key) && isRealMediaPath(item)) return true;
  }
  return false;
}

function isNonMockProviderRow(row) {
  const providerName = String(row.provider_name || '').trim().toLowerCase();
  const mode = String(row.mode || '').trim().toLowerCase();
  const status = String(row.status || '').trim().toLowerCase();
  if (status !== 'success' || mode === 'mock' || isMockProviderName(providerName)) return false;
  if (String(row.provider_type || '').trim().toLowerCase() === 'text') {
    const output = parseJson(row.output_json, {});
    return hasText(output?.response_text) && hasText(output?.response_sha256);
  }
  return status === 'success' &&
    mode !== 'mock' &&
    !isMockProviderName(providerName) &&
    outputHasRealValue(row.output_json);
}

function isNonMockGenerationRow(row) {
  const providerName = String(row.provider || '').trim().toLowerCase();
  return !!providerName &&
    !isMockProviderName(providerName) &&
    (isRealMediaPath(row.image_url) || isRealMediaPath(row.video_url) || isRealMediaPath(row.local_path));
}

function addIssue(issues, code, severity, message, target = {}) {
  issues.push({ code, severity, message, target });
}

function hasRealAsset(row, fields) {
  return fields.some((field) => isRealMediaPath(row?.[field]));
}

function applySourceIntakeCheck(ctx) {
  const { issues, checks, dramaId, sourceCount, sourceItemCount } = ctx;
  const hasSource = sourceCount > 0 && sourceItemCount > 0;
  if (hasSource) ctx.score += 10;
  else addIssue(issues, 'source_missing', 'error', issueMessage('source_missing'), { drama_id: dramaId });
  checks.push({ key: 'source_intake', passed: hasSource, weight: 10, source_count: sourceCount, source_item_count: sourceItemCount });
}

function applyStoryIrCheck(ctx) {
  const { issues, checks, dramaId, eventCount, planCount, edgeCount } = ctx;
  const graphOk = eventCount <= 1 || edgeCount >= eventCount - 1;
  const hasStoryIr = eventCount > 0 && planCount > 0 && graphOk;
  if (hasStoryIr) ctx.score += 10;
  else addIssue(issues, 'story_ir_missing', 'error', issueMessage('story_ir_missing'), { drama_id: dramaId });
  checks.push({ key: 'story_ir', passed: hasStoryIr, weight: 10, event_count: eventCount, event_edge_count: edgeCount, plan_count: planCount });
}

function applyEpisodesCheck(ctx) {
  const { issues, checks, dramaId, episodeId, episodes } = ctx;
  const episodesWithScript = episodes.filter((ep) => hasText(ep.script_content));
  const episodesOk = episodes.length > 0 && episodesWithScript.length === episodes.length;
  if (episodesOk) ctx.score += 15;
  else addIssue(issues, 'episodes_incomplete', 'error', issueMessage('episodes_incomplete'), { drama_id: dramaId, episode_id: episodeId });
  checks.push({ key: 'episodes', passed: episodesOk, weight: 15, episode_count: episodes.length, scripted_count: episodesWithScript.length });
}

function applyCharacterContinuityCheck(ctx) {
  const { issues, checks, dramaId, draftMode, characterRows } = ctx;
  const charactersWithContinuity = characterRows.filter((row) => (
    hasText(row.name) &&
    (hasText(row.appearance) || hasText(row.description) || hasText(row.identity_anchors)) &&
    (draftMode
      ? hasText(row.image_url) || hasText(row.local_path) || hasText(row.four_view_image_url) || hasText(row.seedance2_asset)
      : hasRealAsset(row, ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset'])) &&
    (draftMode || (!containsMockReference(row.identity_anchors) && !containsMockReference(row.stages)))
  ));
  const characterOk = characterRows.length > 0 && charactersWithContinuity.length === characterRows.length;
  if (characterOk) ctx.score += 10;
  else addIssue(issues, 'character_continuity_incomplete', 'warning', issueMessage('character_continuity_incomplete'), { drama_id: dramaId });
  checks.push({ key: 'character_continuity', passed: characterOk, weight: 10, character_count: characterRows.length, complete_count: charactersWithContinuity.length });
}

function applyAssetLibraryCheck(ctx) {
  const { issues, checks, dramaId, draftMode, sceneRows, propRows } = ctx;
  const sceneCount = sceneRows.length;
  const propCount = propRows.length;
  const assetLibraryOk = draftMode
    ? sceneCount > 0 || propCount > 0
    : sceneRows.some((row) => hasRealAsset(row, ['local_path', 'image_url', 'ref_image'])) ||
      propRows.some((row) => hasRealAsset(row, ['local_path', 'image_url', 'ref_image']));
  if (assetLibraryOk) ctx.score += 10;
  else addIssue(issues, 'asset_library_empty', 'warning', issueMessage('asset_library_empty'), { drama_id: dramaId });
  checks.push({ key: 'asset_library', passed: assetLibraryOk, weight: 10, scene_count: sceneCount, prop_count: propCount });
}

function applyStoryboardsCheck(ctx) {
  const { issues, checks, dramaId, episodeId, draftMode, storyboards } = ctx;
  const missingStoryboardFields = [];
  const completeStoryboards = storyboards.filter((sb) => {
    const missing = [];
    if (!hasText(sb.layout_description || sb.description || sb.action)) missing.push('visual');
    if (!hasText(sb.image_prompt)) missing.push('image_prompt');
    if (!hasText(sb.video_prompt)) missing.push('video_prompt');
    if (!(Number(sb.duration) > 0)) missing.push('duration');
    if (!draftMode && !hasText(sb.movement)) missing.push('movement');
    if (!draftMode && !hasText(sb.dialogue || sb.narration)) missing.push('subtitle_or_narration');
    if (missing.length) missingStoryboardFields.push({ storyboard_id: sb.id, fields: missing });
    return missing.length === 0;
  });
  const storyboardsOk = storyboards.length > 0 && completeStoryboards.length === storyboards.length;
  if (storyboardsOk) ctx.score += 20;
  else addIssue(
    issues,
    'storyboards_incomplete',
    'error',
    issueMessage('storyboards_incomplete', { draftMode }),
    { drama_id: dramaId, episode_id: episodeId, missing: missingStoryboardFields }
  );
  checks.push({
    key: 'storyboards',
    passed: storyboardsOk,
    weight: 20,
    storyboard_count: storyboards.length,
    complete_count: completeStoryboards.length,
    missing: missingStoryboardFields,
  });
}

function applyAssetReferencesCheck(ctx) {
  const { issues, checks, dramaId, draftMode, assetReferenceFailures } = ctx;
  const assetReferencesOk = draftMode || assetReferenceFailures.length === 0;
  if (!assetReferencesOk) {
    addIssue(
      issues,
      'production_asset_references_invalid',
      'error',
      issueMessage('production_asset_references_invalid'),
      { drama_id: dramaId, failures: assetReferenceFailures }
    );
  }
  checks.push({
    key: 'production_asset_references',
    passed: assetReferencesOk,
    weight: 0,
    failure_count: assetReferenceFailures.length,
  });
}

function applyMediaTimelineCheck(ctx) {
  const {
    issues,
    checks,
    dramaId,
    episodeId,
    draftMode,
    auditMode,
    storyboards,
    realMediaStoryboardIds,
    realImageStoryboardIds,
    realVideoStoryboardIds,
    generatedMediaRows,
    timeline,
  } = ctx;
  const realMediaCoverageCount = realMediaStoryboardIds.size;
  const realMediaOk = storyboards.length > 0 && realMediaCoverageCount > 0;
  const fullRealMediaCoverageOk = storyboards.length > 0 &&
    realImageStoryboardIds.size === storyboards.length &&
    realVideoStoryboardIds.size === storyboards.length;
  const mediaOk = draftMode
    ? storyboards.length > 0 && timeline.ok && (realMediaOk || timeline.itemCount >= storyboards.length)
    : storyboards.length > 0 && timeline.ok && fullRealMediaCoverageOk;
  const mediaIssueTarget = {
    drama_id: dramaId,
    episode_id: episodeId,
    track_types: timeline.trackTypes,
    storyboard_count: storyboards.length,
    real_media_storyboard_count: realMediaCoverageCount,
    episode_timeline: timeline.episodes,
  };
  if (!draftMode && storyboards.length > realMediaCoverageCount) {
    mediaIssueTarget.missing_real_media_storyboard_ids = storyboards
      .filter((sb) => !realMediaStoryboardIds.has(Number(sb.id)))
      .map((sb) => sb.id);
  }
  if (!draftMode) {
    mediaIssueTarget.missing_real_image_storyboard_ids = storyboards
      .filter((sb) => !realImageStoryboardIds.has(Number(sb.id)))
      .map((sb) => sb.id);
    mediaIssueTarget.missing_real_video_storyboard_ids = storyboards
      .filter((sb) => !realVideoStoryboardIds.has(Number(sb.id)))
      .map((sb) => sb.id);
  }
  if (mediaOk) ctx.score += 15;
  else addIssue(
    issues,
    'media_timeline_incomplete',
    draftMode ? 'warning' : 'error',
    issueMessage('media_timeline_incomplete', { draftMode }),
    mediaIssueTarget
  );
  checks.push({
    key: 'media_timeline',
    passed: mediaOk,
    weight: 15,
    mode: auditMode,
    media_storyboard_count: realMediaCoverageCount,
    image_storyboard_count: realImageStoryboardIds.size,
    video_storyboard_count: realVideoStoryboardIds.size,
    generated_media_count: generatedMediaRows.length,
    storyboard_count: storyboards.length,
    full_real_media_coverage: fullRealMediaCoverageOk,
    track_count: timeline.trackCount,
    timeline_item_count: timeline.itemCount,
    track_types: timeline.trackTypes,
    required_track_types: timeline.requiredTrackTypes,
    optional_track_types: timeline.optionalTrackTypes,
    episode_timeline: timeline.episodes,
  });
}

function applyWorkflowIntegrityCheck(ctx) {
  const { issues, checks, runId, stepRows } = ctx;
  let workflowOk = true;
  if (runId) {
    workflowOk = stepRows.length > 0 && stepRows.every((step) => (
      step.status === 'completed' || (step.step_key === 'qa_audit' && step.status === 'processing')
    ));
    if (!workflowOk) addIssue(issues, 'workflow_steps_incomplete', 'error', issueMessage('workflow_steps_incomplete'), { run_id: runId });
  }
  if (workflowOk) ctx.score += 10;
  checks.push({ key: 'workflow_integrity', passed: workflowOk, weight: 10, step_count: stepRows.length });
}

function applyProviderAuditCheck(ctx) {
  const { issues, checks, runId, draftMode, auditMode, providerCount, providerRows } = ctx;
  const requiredProviderTypes = ['text', 'asset_image', 'image', 'video', 'tts', 'compositor'];
  const productionProviderTypes = new Set(
    providerRows
      .filter(isNonMockProviderRow)
      .map((row) => String(row.provider_type || '').trim().toLowerCase())
  );
  const providerOk = draftMode
    ? (!runId || providerCount >= 4)
    : !!runId && requiredProviderTypes.every((type) => productionProviderTypes.has(type));
  if (!providerOk) addIssue(
    issues,
    'provider_audit_missing',
    draftMode ? 'warning' : 'error',
    issueMessage('provider_audit_missing', { draftMode }),
    {
      run_id: runId || null,
      provider_count: providerCount,
      required_provider_types: draftMode ? [] : requiredProviderTypes,
      production_provider_types: Array.from(productionProviderTypes),
    }
  );
  checks.push({
    key: 'provider_sdk_audit',
    passed: providerOk,
    weight: 0,
    mode: auditMode,
    provider_count: providerCount,
    required_provider_types: draftMode ? [] : requiredProviderTypes,
    production_provider_types: Array.from(productionProviderTypes),
  });
}

function applySkillAuditCheck(ctx) {
  const { issues, checks, runId, skillCount } = ctx;
  if (!runId) return;
  const skillOk = skillCount >= 4;
  if (!skillOk) addIssue(issues, 'skill_audit_missing', 'warning', issueMessage('skill_audit_missing'), { run_id: runId, skill_count: skillCount });
  checks.push({ key: 'skill_registry_audit', passed: skillOk, weight: 0, skill_count: skillCount });
}

function applySkillTemplateCheck(ctx) {
  const { issues, checks, dramaId, toUserFacingProcessError } = ctx;
  try {
    const skillRegistryService = require('./skillRegistryService');
    const templates = skillRegistryService.getSkillTemplates();
    const missingTemplates = templates.filter((template) => !template.exists);
    const templatesOk = templates.length >= 6 && missingTemplates.length === 0;
    if (!templatesOk) addIssue(issues, 'skill_templates_missing', 'warning', issueMessage('skill_templates_missing'), { missing: missingTemplates.map((item) => item.template_path) });
    checks.push({
      key: 'skill_template_audit',
      passed: templatesOk,
      weight: 0,
      template_count: templates.length,
      missing_count: missingTemplates.length,
    });
  } catch (err) {
    const skillTemplateError = toUserFacingProcessError(err, PROCESS_ERROR_FALLBACKS.skill_templates);
    addIssue(issues, 'skill_templates_missing', 'warning', skillTemplateError, { drama_id: dramaId });
    checks.push({ key: 'skill_template_audit', passed: false, weight: 0, error: skillTemplateError });
  }
}

function applyLegacyAsyncCheck(ctx) {
  const { issues, checks, dramaId, toUserFacingProcessError } = ctx;
  try {
    const asyncAuditService = require('./asyncAuditService');
    const asyncAudit = asyncAuditService.auditLegacyAsyncEntrypoints();
    if (!asyncAudit.passed) addIssue(issues, 'legacy_async_audit_failed', 'warning', issueMessage('legacy_async_audit_failed'), { issues: asyncAudit.issues });
    checks.push({
      key: 'legacy_async_audit',
      passed: asyncAudit.passed,
      weight: 0,
      tracked_file_count: Object.keys(asyncAudit.allowlist).length,
      usage_count: Object.values(asyncAudit.counts).reduce((sum, countValue) => sum + countValue, 0),
      issue_count: asyncAudit.issues.length,
    });
  } catch (err) {
    const asyncAuditError = toUserFacingProcessError(err, PROCESS_ERROR_FALLBACKS.legacy_async);
    addIssue(issues, 'legacy_async_audit_failed', 'warning', asyncAuditError, { drama_id: dramaId });
    checks.push({ key: 'legacy_async_audit', passed: false, weight: 0, error: asyncAuditError });
  }
}

module.exports = {
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
};
