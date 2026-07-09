function nowIso() {
  return new Date().toISOString();
}

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

function count(db, sql, ...params) {
  return db.prepare(sql).get(...params).count || 0;
}

function getEpisodes(db, dramaId, episodeId) {
  if (episodeId) {
    return db.prepare(
      `SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC`
    ).all(Number(episodeId), Number(dramaId));
  }
  return db.prepare(
    `SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC`
  ).all(Number(dramaId));
}

function getStoryboardsForEpisodes(db, episodeIds) {
  if (!episodeIds.length) return [];
  const placeholders = episodeIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM storyboards
     WHERE episode_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY episode_id ASC, storyboard_number ASC, id ASC`
  ).all(...episodeIds);
}

function hasTimelineForEpisodes(db, episodeIds) {
  if (!episodeIds.length) return { ok: false, trackCount: 0, itemCount: 0, trackTypes: [] };
  const placeholders = episodeIds.map(() => '?').join(',');
  const tracks = db.prepare(
    `SELECT id, type FROM timeline_tracks WHERE episode_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).all(...episodeIds);
  const trackIds = tracks.map((track) => track.id);
  if (!trackIds.length) return { ok: false, trackCount: 0, itemCount: 0, trackTypes: [] };
  const itemPlaceholders = trackIds.map(() => '?').join(',');
  const itemCount = count(db, `SELECT COUNT(*) AS count FROM timeline_items WHERE track_id IN (${itemPlaceholders})`, ...trackIds);
  const trackTypes = Array.from(new Set(tracks.map((track) => track.type)));
  const requiredTrackTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  return {
    ok: requiredTrackTypes.every((type) => trackTypes.includes(type)) && itemCount > 0,
    trackCount: tracks.length,
    itemCount,
    trackTypes,
    requiredTrackTypes,
  };
}

function evaluateDrama(db, { drama_id, episode_id, run_id, mode } = {}) {
  const dramaId = Number(drama_id);
  const episodeId = episode_id == null ? null : Number(episode_id);
  const auditMode = mode === 'draft' ? 'draft' : 'production';
  const draftMode = auditMode === 'draft';
  const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
  if (!drama) {
    return {
      score: 0,
      passed: false,
      issues: [{ code: 'drama_missing', severity: 'error', message: 'Drama does not exist', target: { drama_id: dramaId } }],
      checks: [],
      recommendations: ['Create or select a valid drama before running the workflow.'],
    };
  }

  const issues = [];
  const checks = [];
  let score = 0;

  const sourceCount = count(db, 'SELECT COUNT(*) AS count FROM story_sources WHERE drama_id = ? AND deleted_at IS NULL', dramaId);
  const sourceItemCount = sourceCount
    ? count(
      db,
      `SELECT COUNT(*) AS count FROM source_items si
       INNER JOIN story_sources ss ON ss.id = si.source_id
       WHERE ss.drama_id = ? AND ss.deleted_at IS NULL`,
      dramaId
    )
    : 0;
  const hasSource = sourceCount > 0 && sourceItemCount > 0;
  if (hasSource) score += 10;
  else addIssue(issues, 'source_missing', 'error', 'No traceable story source and source items found', { drama_id: dramaId });
  checks.push({ key: 'source_intake', passed: hasSource, weight: 10, source_count: sourceCount, source_item_count: sourceItemCount });

  const eventCount = count(db, 'SELECT COUNT(*) AS count FROM story_events WHERE drama_id = ?', dramaId);
  const planCount = count(db, 'SELECT COUNT(*) AS count FROM adaptation_plans WHERE drama_id = ?', dramaId);
  const edgeCount = count(db, 'SELECT COUNT(*) AS count FROM story_event_edges WHERE drama_id = ?', dramaId);
  const graphOk = eventCount <= 1 || edgeCount >= eventCount - 1;
  const hasStoryIr = eventCount > 0 && planCount > 0 && graphOk;
  if (hasStoryIr) score += 10;
  else addIssue(issues, 'story_ir_missing', 'error', 'Story events, event graph edges, or adaptation plans are missing', { drama_id: dramaId });
  checks.push({ key: 'story_ir', passed: hasStoryIr, weight: 10, event_count: eventCount, event_edge_count: edgeCount, plan_count: planCount });

  const episodes = getEpisodes(db, dramaId, episodeId);
  const episodesWithScript = episodes.filter((ep) => hasText(ep.script_content));
  const episodesOk = episodes.length > 0 && episodesWithScript.length === episodes.length;
  if (episodesOk) score += 15;
  else addIssue(issues, 'episodes_incomplete', 'error', 'Episodes are missing or some episodes have no script_content', { drama_id: dramaId, episode_id: episodeId });
  checks.push({ key: 'episodes', passed: episodesOk, weight: 15, episode_count: episodes.length, scripted_count: episodesWithScript.length });

  const characterRows = db.prepare(
    `SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC`
  ).all(dramaId);
  const charactersWithContinuity = characterRows.filter((row) => (
    hasText(row.name) &&
    (hasText(row.appearance) || hasText(row.description) || hasText(row.identity_anchors)) &&
    (hasText(row.image_url) || hasText(row.local_path) || hasText(row.four_view_image_url) || hasText(row.seedance2_asset))
  ));
  const characterOk = characterRows.length > 0 && charactersWithContinuity.length === characterRows.length;
  if (characterOk) score += 10;
  else addIssue(issues, 'character_continuity_incomplete', 'warning', 'Characters need names, visual anchors, and at least one image/reference asset', { drama_id: dramaId });
  checks.push({ key: 'character_continuity', passed: characterOk, weight: 10, character_count: characterRows.length, complete_count: charactersWithContinuity.length });

  const sceneCount = count(db, 'SELECT COUNT(*) AS count FROM scenes WHERE drama_id = ? AND deleted_at IS NULL', dramaId);
  const propCount = count(db, 'SELECT COUNT(*) AS count FROM props WHERE drama_id = ? AND deleted_at IS NULL', dramaId);
  const assetLibraryOk = sceneCount > 0 || propCount > 0;
  if (assetLibraryOk) score += 10;
  else addIssue(issues, 'asset_library_empty', 'warning', 'Scene or prop assets are missing', { drama_id: dramaId });
  checks.push({ key: 'asset_library', passed: assetLibraryOk, weight: 10, scene_count: sceneCount, prop_count: propCount });

  const episodeIds = episodes.map((ep) => ep.id);
  const storyboards = getStoryboardsForEpisodes(db, episodeIds);
  const completeStoryboards = storyboards.filter((sb) => (
    hasText(sb.description || sb.action || sb.dialogue || sb.narration) &&
    hasText(sb.image_prompt) &&
    hasText(sb.video_prompt) &&
    Number(sb.duration) > 0
  ));
  const storyboardsOk = storyboards.length > 0 && completeStoryboards.length === storyboards.length;
  if (storyboardsOk) score += 20;
  else addIssue(issues, 'storyboards_incomplete', 'error', 'Each storyboard needs visual action, duration, image prompt, and video prompt', { drama_id: dramaId, episode_id: episodeId });
  checks.push({ key: 'storyboards', passed: storyboardsOk, weight: 20, storyboard_count: storyboards.length, complete_count: completeStoryboards.length });

  const realMediaStoryboardIds = new Set();
  for (const sb of storyboards) {
    if (
      isRealMediaPath(sb.video_url) ||
      isRealMediaPath(sb.local_path) ||
      isRealMediaPath(sb.image_url) ||
      isRealMediaPath(sb.audio_local_path) ||
      isRealMediaPath(sb.narration_audio_local_path)
    ) {
      realMediaStoryboardIds.add(Number(sb.id));
    }
  }
  let generatedMediaRows = [];
  if (storyboards.length) {
    const sbIds = storyboards.map((sb) => sb.id);
    const placeholders = sbIds.map(() => '?').join(',');
    generatedMediaRows = db.prepare(
       `SELECT storyboard_id, provider, image_url, NULL AS video_url, local_path
          FROM image_generations
         WHERE storyboard_id IN (${placeholders})
           AND status = 'completed'
           AND deleted_at IS NULL`
    ).all(
      ...sbIds
    ).filter(isNonMockGenerationRow);
    const generatedVideoRows = db.prepare(
       `SELECT storyboard_id, provider, NULL AS image_url, video_url, local_path
          FROM video_generations
         WHERE storyboard_id IN (${placeholders})
           AND status = 'completed'
           AND deleted_at IS NULL`
    ).all(
      ...sbIds
    ).filter(isNonMockGenerationRow);
    generatedMediaRows.push(...generatedVideoRows);
    for (const row of generatedMediaRows) {
      realMediaStoryboardIds.add(Number(row.storyboard_id));
    }
  }
  const timeline = hasTimelineForEpisodes(db, episodeIds);
  const realMediaCoverageCount = realMediaStoryboardIds.size;
  const realMediaOk = storyboards.length > 0 && realMediaCoverageCount > 0;
  const fullRealMediaCoverageOk = storyboards.length > 0 && realMediaCoverageCount === storyboards.length;
  const mediaOk = draftMode
    ? storyboards.length > 0 && timeline.ok && (realMediaOk || timeline.itemCount >= storyboards.length)
    : storyboards.length > 0 && timeline.ok && fullRealMediaCoverageOk;
  const mediaIssueTarget = {
    drama_id: dramaId,
    episode_id: episodeId,
    track_types: timeline.trackTypes,
    storyboard_count: storyboards.length,
    real_media_storyboard_count: realMediaCoverageCount,
  };
  if (!draftMode && storyboards.length > realMediaCoverageCount) {
    mediaIssueTarget.missing_real_media_storyboard_ids = storyboards
      .filter((sb) => !realMediaStoryboardIds.has(Number(sb.id)))
      .map((sb) => sb.id);
  }
  if (mediaOk) score += 15;
  else addIssue(
    issues,
    'media_timeline_incomplete',
    draftMode ? 'warning' : 'error',
    draftMode
      ? 'Timeline plan is incomplete for draft workflow QA'
      : 'Final QA requires non-mock generated media for every storyboard, not only placeholders',
    mediaIssueTarget
  );
  checks.push({
    key: 'media_timeline',
    passed: mediaOk,
    weight: 15,
    mode: auditMode,
    media_storyboard_count: realMediaCoverageCount,
    generated_media_count: generatedMediaRows.length,
    storyboard_count: storyboards.length,
    full_real_media_coverage: fullRealMediaCoverageOk,
    track_count: timeline.trackCount,
    timeline_item_count: timeline.itemCount,
    track_types: timeline.trackTypes,
    required_track_types: timeline.requiredTrackTypes,
  });

  let workflowOk = true;
  let stepRows = [];
  if (run_id) {
    stepRows = db.prepare('SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sort_order ASC').all(String(run_id));
    workflowOk = stepRows.length > 0 && stepRows.every((step) => (
      step.status === 'completed' || (step.step_key === 'qa_audit' && step.status === 'processing')
    ));
    if (!workflowOk) addIssue(issues, 'workflow_steps_incomplete', 'error', 'Workflow has steps that are not completed', { run_id });
  }
  if (workflowOk) score += 10;
  checks.push({ key: 'workflow_integrity', passed: workflowOk, weight: 10, step_count: stepRows.length });

  const requiredProviderTypes = ['image', 'video', 'tts', 'compositor'];
  let providerCount = 0;
  let skillCount = 0;
  let providerRows = [];
  if (run_id) {
    providerCount = count(db, 'SELECT COUNT(*) AS count FROM provider_invocations WHERE run_id = ?', String(run_id));
    skillCount = count(db, 'SELECT COUNT(*) AS count FROM skill_invocations WHERE run_id = ?', String(run_id));
    try {
      providerRows = db.prepare(
        `SELECT provider_type, provider_name, mode, status, output_json
           FROM provider_invocations
          WHERE run_id = ?`
      ).all(String(run_id));
    } catch (_) {}
  }
  const productionProviderTypes = new Set(
    providerRows
      .filter(isNonMockProviderRow)
      .map((row) => String(row.provider_type || '').trim().toLowerCase())
  );
  const providerOk = draftMode
    ? (!run_id || providerCount >= 4)
    : !!run_id && requiredProviderTypes.every((type) => productionProviderTypes.has(type));
  if (!providerOk) addIssue(
    issues,
    'provider_audit_missing',
    draftMode ? 'warning' : 'error',
    draftMode
      ? 'Provider generation audit records are missing or incomplete'
      : 'Production QA requires successful non-mock provider audit records for image, video, tts, and compositor outputs',
    {
      run_id: run_id || null,
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
  if (run_id) {
    const skillOk = skillCount >= 4;
    if (!skillOk) addIssue(issues, 'skill_audit_missing', 'warning', 'Skill invocation audit records are missing or incomplete', { run_id, skill_count: skillCount });
    checks.push({ key: 'skill_registry_audit', passed: skillOk, weight: 0, skill_count: skillCount });
  }

  try {
    const skillRegistryService = require('./skillRegistryService');
    const templates = skillRegistryService.getSkillTemplates();
    const missingTemplates = templates.filter((template) => !template.exists);
    const templatesOk = templates.length >= 6 && missingTemplates.length === 0;
    if (!templatesOk) addIssue(issues, 'skill_templates_missing', 'warning', 'Local skill prompt templates are missing', { missing: missingTemplates.map((item) => item.template_path) });
    checks.push({
      key: 'skill_template_audit',
      passed: templatesOk,
      weight: 0,
      template_count: templates.length,
      missing_count: missingTemplates.length,
    });
  } catch (err) {
    addIssue(issues, 'skill_templates_missing', 'warning', err.message || 'Local skill prompt templates could not be audited', { drama_id: dramaId });
    checks.push({ key: 'skill_template_audit', passed: false, weight: 0, error: err.message });
  }

  try {
    const asyncAuditService = require('./asyncAuditService');
    const asyncAudit = asyncAuditService.auditLegacyAsyncEntrypoints();
    if (!asyncAudit.passed) addIssue(issues, 'legacy_async_audit_failed', 'warning', 'Untracked legacy setImmediate entrypoints were found', { issues: asyncAudit.issues });
    checks.push({
      key: 'legacy_async_audit',
      passed: asyncAudit.passed,
      weight: 0,
      tracked_file_count: Object.keys(asyncAudit.allowlist).length,
      usage_count: Object.values(asyncAudit.counts).reduce((sum, countValue) => sum + countValue, 0),
      issue_count: asyncAudit.issues.length,
    });
  } catch (err) {
    addIssue(issues, 'legacy_async_audit_failed', 'warning', err.message || 'Legacy async entrypoint audit failed', { drama_id: dramaId });
    checks.push({ key: 'legacy_async_audit', passed: false, weight: 0, error: err.message });
  }

  const passed = score >= 80 && !issues.some((issue) => issue.severity === 'error');
  const recommendations = issues.map((issue) => {
    if (issue.code === 'source_missing') return 'Import source material through Source Intake before production.';
    if (issue.code === 'story_ir_missing') return 'Create or regenerate the adaptation plan from the source.';
    if (issue.code === 'episodes_incomplete') return 'Apply the adaptation plan or fill missing episode scripts.';
    if (issue.code === 'character_continuity_incomplete') return 'Add character anchors and reference images before image/video generation.';
    if (issue.code === 'asset_library_empty') return 'Extract or add scenes and props for visual continuity.';
    if (issue.code === 'storyboards_incomplete') return 'Generate storyboard draft fields before media generation.';
    if (issue.code === 'media_timeline_incomplete') return 'Generate media and timeline tracks before final acceptance.';
    if (issue.code === 'workflow_steps_incomplete') return 'Retry failed workflow steps before final QA.';
    if (issue.code === 'provider_audit_missing') return 'Run provider generation through the workflow provider SDK so image/video/audio/compositor calls are auditable.';
    if (issue.code === 'skill_audit_missing') return 'Run workflow nodes through registered skills so creative and QA decisions are traceable.';
    if (issue.code === 'skill_templates_missing') return 'Restore local skill prompt templates before workflow audit.';
    if (issue.code === 'legacy_async_audit_failed') return 'Register or migrate legacy async entrypoints before adding more background work.';
    return issue.message;
  });
  const remediationActions = buildRemediationActionsV2(issues, {
    drama_id: dramaId,
    episode_id: episodeId,
    run_id,
    source_count: sourceCount,
    workflow_step_count: stepRows.length,
  });

  return {
    drama_id: dramaId,
    episode_id: episodeId,
    run_id: run_id || null,
    mode: auditMode,
    score,
    passed,
    issues,
    checks,
    recommendations,
    remediation_actions: remediationActions,
    evaluated_at: nowIso(),
  };
}

function buildRemediationActionsV2(issues, context) {
  const actions = [];
  const add = (code, label, automated, reason, payload = {}) => {
    if (actions.some((action) => action.code === code)) return;
    actions.push({ code, label, automated: !!automated, reason, payload });
  };

  for (const issue of issues) {
    if (issue.code === 'source_missing') {
      add('import_source', 'Import source material', false, 'A traceable source is required before automated remediation can run.');
      continue;
    }
    if (issue.code === 'story_ir_missing') {
      add(
        'start_or_retry_workflow',
        'Start or retry workflow',
        context.source_count > 0 || !!context.run_id,
        'Story IR or adaptation plan is missing and can be regenerated from the latest source.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'character_continuity_incomplete') {
      add(
        'refresh_asset_bible',
        'Refresh asset bible',
        context.source_count > 0 || !!context.run_id,
        'Character identity anchors, stages, or reference assets are incomplete.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'storyboards_incomplete') {
      add(
        'repair_storyboards',
        'Repair storyboards',
        context.source_count > 0 || !!context.run_id,
        'Storyboard drafts can be rebuilt, then mock media, timeline, composite, and QA can be rerun.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'media_timeline_incomplete') {
      add(
        'repair_timeline',
        'Repair timeline',
        context.source_count > 0 || !!context.run_id,
        'Timeline tracks/items and mock composite outputs can be rebuilt.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['episodes_incomplete', 'workflow_steps_incomplete'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        'Retry workflow',
        context.source_count > 0 || !!context.run_id,
        'Episodes or workflow steps are incomplete and should be repaired through the unified workflow.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['provider_audit_missing', 'skill_audit_missing'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        'Rerun workflow audit path',
        context.source_count > 0 || !!context.run_id,
        'Provider or skill audit records should be produced by the unified workflow entrypoint.',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
    }
  }

  return actions;
}

function saveQaReport(db, evaluation) {
  const createdAt = nowIso();
  const info = db.prepare(
    `INSERT INTO qa_reports (drama_id, episode_id, run_id, score, passed, report_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    evaluation.drama_id,
    evaluation.episode_id || null,
    evaluation.run_id || null,
    evaluation.score,
    evaluation.passed ? 1 : 0,
    toJson(evaluation),
    createdAt
  );
  return getQaReportById(db, Number(info.lastInsertRowid));
}

function auditDrama(db, log, params) {
  const evaluation = evaluateDrama(db, params);
  const report = saveQaReport(db, evaluation);
  log?.info?.('QA report created', {
    drama_id: evaluation.drama_id,
    run_id: evaluation.run_id,
    score: evaluation.score,
    passed: evaluation.passed,
  });
  return report;
}

function rowToQaReport(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    run_id: row.run_id,
    score: row.score,
    passed: !!row.passed,
    report_json: parseJson(row.report_json, {}),
    created_at: row.created_at,
  };
}

function getQaReportById(db, id) {
  const row = db.prepare('SELECT * FROM qa_reports WHERE id = ?').get(Number(id));
  return row ? rowToQaReport(row) : null;
}

function listQaReports(db, { drama_id, episode_id, run_id, limit } = {}) {
  let sql = 'SELECT * FROM qa_reports WHERE 1 = 1';
  const params = [];
  if (drama_id != null) {
    sql += ' AND drama_id = ?';
    params.push(Number(drama_id));
  }
  if (episode_id != null) {
    sql += ' AND episode_id = ?';
    params.push(Number(episode_id));
  }
  if (run_id != null) {
    sql += ' AND run_id = ?';
    params.push(String(run_id));
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  params.push(Math.max(1, Math.min(100, Number(limit) || 20)));
  return db.prepare(sql).all(...params).map(rowToQaReport);
}

function getLatestSourceForDrama(db, dramaId) {
  return db.prepare(
    `SELECT * FROM story_sources
     WHERE drama_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).get(Number(dramaId));
}

function remediateQaReport(db, log, reportId, options = {}) {
  const report = getQaReportById(db, reportId);
  if (!report) return null;
  if (report.passed) {
    return { report, skipped: true, reason: 'QA report already passed', actions_taken: [] };
  }

  const actions = Array.isArray(report.report_json?.remediation_actions)
    ? report.report_json.remediation_actions
    : [];
  const preferred = options.action_code || options.action || '';
  const automatedAction = actions.find((action) => action.automated && action.code === preferred) ||
    actions.find((action) => action.automated && ['refresh_asset_bible', 'repair_storyboards', 'repair_timeline'].includes(action.code)) ||
    actions.find((action) => action.automated);
  if (!automatedAction) {
    return {
      report,
      skipped: true,
      reason: 'No automated remediation is available',
      actions_taken: [],
      required_actions: actions,
    };
  }

  const workflowService = require('./workflowService');
  if (['refresh_asset_bible', 'repair_storyboards', 'repair_timeline'].includes(automatedAction.code)) {
    const run = workflowService.startNovel2AnimeRepairWorkflow(db, log, {
      drama_id: report.drama_id,
      episode_id: report.episode_id || null,
      mode: report.report_json?.mode === 'production' ? 'production' : 'draft',
      action: automatedAction.code,
      target_episode_count: options.target_episode_count || undefined,
      overwrite_existing_episodes: options.overwrite_existing_episodes === true,
      style: options.style || '',
      metadata: { remediation_report_id: report.id, remediation_action: automatedAction.code },
    });
    return {
      report,
      skipped: false,
      actions_taken: [{ code: automatedAction.code, run_id: run.id }],
      workflow_run: run,
    };
  }

  if (report.run_id) {
    const run = workflowService.getWorkflowRunDetail(db, report.run_id);
    if (run && run.status === 'failed') {
      const retried = workflowService.retryWorkflowRun(db, log, run.id, options.workflow_options || {});
      return {
        report,
        skipped: false,
        actions_taken: [{ code: 'retry_workflow', run_id: run.id }],
        workflow_run: retried,
      };
    }
    if (run && ['pending', 'processing', 'paused'].includes(run.status)) {
      return {
        report,
        skipped: true,
        reason: `Workflow run is already ${run.status}`,
        actions_taken: [],
        workflow_run: run,
      };
    }
  }

  const source = getLatestSourceForDrama(db, report.drama_id);
  if (!source) {
    return {
      report,
      skipped: true,
      reason: 'No story source exists for automated remediation',
      actions_taken: [],
      required_actions: actions,
    };
  }

  const run = workflowService.startNovel2AnimeWorkflow(db, log, {
    drama_id: report.drama_id,
    episode_id: report.episode_id || null,
    source_id: source.id,
    mode: report.report_json?.mode === 'production' ? 'production' : 'draft',
    title: source.title || '',
    source_type: source.source_type || '',
    target_episode_count: options.target_episode_count || undefined,
    overwrite_existing_episodes: options.overwrite_existing_episodes === true,
    style: options.style || '',
    metadata: { remediation_report_id: report.id },
  });

  return {
    report,
    skipped: false,
    actions_taken: [{ code: 'start_workflow_from_latest_source', source_id: source.id, run_id: run.id }],
    workflow_run: run,
  };
}

module.exports = {
  evaluateDrama,
  auditDrama,
  getQaReportById,
  listQaReports,
  remediateQaReport,
  rowToQaReport,
};
