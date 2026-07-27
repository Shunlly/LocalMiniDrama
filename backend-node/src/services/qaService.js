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

function firstRealAsset(row, fields) {
  return fields.map((field) => row?.[field]).find(isRealMediaPath) || null;
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

function hasTimelineForEpisodes(db, episodeIds, options = {}) {
  if (!episodeIds.length) return { ok: false, trackCount: 0, itemCount: 0, trackTypes: [], episodes: [] };
  const placeholders = episodeIds.map(() => '?').join(',');
  const tracks = db.prepare(
    `SELECT id, episode_id, type, status, metadata
       FROM timeline_tracks WHERE episode_id IN (${placeholders}) ORDER BY episode_id ASC, sort_order ASC`
  ).all(...episodeIds);
  const trackIds = tracks.map((track) => track.id);
  const items = trackIds.length
    ? db.prepare(
      `SELECT id, track_id, storyboard_id, start_sec, end_sec, source_path, metadata
         FROM timeline_items WHERE track_id IN (${trackIds.map(() => '?').join(',')})`
    ).all(...trackIds)
    : [];
  const trackTypes = Array.from(new Set(tracks.map((track) => track.type)));
  const requiredTrackTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  const optionalTrackTypes = ['effect', 'bgm', 'transition'];
  const validItemsForTrack = (track) => items.filter((item) => {
    if (Number(item.track_id) !== Number(track.id)) return false;
    const metadata = parseJson(item.metadata, {});
    if (metadata?.placeholder === true) return false;
    if (!(Number(item.end_sec) > Number(item.start_sec))) return false;
    if (track.type === 'subtitle') return hasText(item.source_path);
    if (options.production) return isRealMediaPath(item.source_path);
    return hasText(item.source_path);
  });
  const episodeResults = episodeIds.map((episodeId) => {
    const episodeTracks = tracks.filter((track) => Number(track.episode_id) === Number(episodeId));
    const byType = new Map(episodeTracks.map((track) => [track.type, track]));
    const explicitTracks = requiredTrackTypes.every((type) => byType.has(type));
    const videoItems = byType.has('video') ? validItemsForTrack(byType.get('video')) : [];
    const subtitleItems = byType.has('subtitle') ? validItemsForTrack(byType.get('subtitle')) : [];
    const voiceItems = byType.has('voice') ? validItemsForTrack(byType.get('voice')) : [];
    const dialogueItems = byType.has('dialogue') ? validItemsForTrack(byType.get('dialogue')) : [];
    const optionalTracksExplicitlyUnused = !options.production || optionalTrackTypes.every((type) => {
      const track = byType.get(type);
      if (!track) return false;
      const metadata = parseJson(track.metadata, {});
      const validCount = validItemsForTrack(track).length;
      return validCount > 0 || (track.status === 'unused' && metadata.optional === true && metadata.usage === 'unused');
    });
    return {
      episode_id: Number(episodeId),
      passed: explicitTracks && videoItems.length > 0 && subtitleItems.length > 0 &&
        (voiceItems.length > 0 || dialogueItems.length > 0) && optionalTracksExplicitlyUnused,
      explicit_tracks: explicitTracks,
      video_item_count: videoItems.length,
      subtitle_item_count: subtitleItems.length,
      voice_item_count: voiceItems.length,
      dialogue_item_count: dialogueItems.length,
      optional_tracks_explicit: optionalTracksExplicitlyUnused,
      track_types: episodeTracks.map((track) => track.type),
    };
  });
  return {
    ok: episodeResults.length === episodeIds.length && episodeResults.every((episode) => episode.passed),
    trackCount: tracks.length,
    itemCount: items.length,
    trackTypes,
    requiredTrackTypes,
    optionalTrackTypes,
    episodes: episodeResults,
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
      issues: [{ code: 'drama_missing', severity: 'error', message: '项目不存在', target: { drama_id: dramaId } }],
      checks: [],
      recommendations: ['请先创建或选择有效项目，再启动制作流程。'],
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
  else addIssue(issues, 'source_missing', 'error', '缺少可追溯的故事素材及素材片段', { drama_id: dramaId });
  checks.push({ key: 'source_intake', passed: hasSource, weight: 10, source_count: sourceCount, source_item_count: sourceItemCount });

  const eventCount = count(db, 'SELECT COUNT(*) AS count FROM story_events WHERE drama_id = ?', dramaId);
  const planCount = count(db, 'SELECT COUNT(*) AS count FROM adaptation_plans WHERE drama_id = ?', dramaId);
  const edgeCount = count(db, 'SELECT COUNT(*) AS count FROM story_event_edges WHERE drama_id = ?', dramaId);
  const graphOk = eventCount <= 1 || edgeCount >= eventCount - 1;
  const hasStoryIr = eventCount > 0 && planCount > 0 && graphOk;
  if (hasStoryIr) score += 10;
  else addIssue(issues, 'story_ir_missing', 'error', '故事事件、事件关系或改编计划不完整', { drama_id: dramaId });
  checks.push({ key: 'story_ir', passed: hasStoryIr, weight: 10, event_count: eventCount, event_edge_count: edgeCount, plan_count: planCount });

  const episodes = getEpisodes(db, dramaId, episodeId);
  const episodesWithScript = episodes.filter((ep) => hasText(ep.script_content));
  const episodesOk = episodes.length > 0 && episodesWithScript.length === episodes.length;
  if (episodesOk) score += 15;
  else addIssue(issues, 'episodes_incomplete', 'error', '缺少分集，或部分分集还没有剧本内容', { drama_id: dramaId, episode_id: episodeId });
  checks.push({ key: 'episodes', passed: episodesOk, weight: 15, episode_count: episodes.length, scripted_count: episodesWithScript.length });

  const characterRows = db.prepare(
    `SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC`
  ).all(dramaId);
  const charactersWithContinuity = characterRows.filter((row) => (
    hasText(row.name) &&
    (hasText(row.appearance) || hasText(row.description) || hasText(row.identity_anchors)) &&
    (draftMode
      ? hasText(row.image_url) || hasText(row.local_path) || hasText(row.four_view_image_url) || hasText(row.seedance2_asset)
      : !!firstRealAsset(row, ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset'])) &&
    (draftMode || (!containsMockReference(row.identity_anchors) && !containsMockReference(row.stages)))
  ));
  const characterOk = characterRows.length > 0 && charactersWithContinuity.length === characterRows.length;
  if (characterOk) score += 10;
  else addIssue(issues, 'character_continuity_incomplete', 'warning', '角色需要名称、视觉锚点和至少一项图片或参考素材', { drama_id: dramaId });
  checks.push({ key: 'character_continuity', passed: characterOk, weight: 10, character_count: characterRows.length, complete_count: charactersWithContinuity.length });

  const sceneRows = db.prepare('SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC').all(dramaId);
  const propRows = db.prepare('SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC').all(dramaId);
  const sceneCount = sceneRows.length;
  const propCount = propRows.length;
  const assetLibraryOk = draftMode
    ? sceneCount > 0 || propCount > 0
    : sceneRows.some((row) => firstRealAsset(row, ['local_path', 'image_url', 'ref_image'])) ||
      propRows.some((row) => firstRealAsset(row, ['local_path', 'image_url', 'ref_image']));
  if (assetLibraryOk) score += 10;
  else addIssue(issues, 'asset_library_empty', 'warning', '缺少场景或道具资产', { drama_id: dramaId });
  checks.push({ key: 'asset_library', passed: assetLibraryOk, weight: 10, scene_count: sceneCount, prop_count: propCount });

  const episodeIds = episodes.map((ep) => ep.id);
  const storyboards = getStoryboardsForEpisodes(db, episodeIds);
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
  if (storyboardsOk) score += 20;
  else addIssue(
    issues,
    'storyboards_incomplete',
    'error',
    draftMode
      ? '每个分镜都需要画面动作、时长、图片提示词和视频提示词'
      : '正式制作分镜需要画面构图、运镜、时长、对白或旁白、图片提示词和视频提示词',
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

  const characterById = new Map(characterRows.map((row) => [Number(row.id), row]));
  const characterByName = new Map(characterRows.map((row) => [String(row.name || '').trim().toLowerCase(), row]));
  const sceneById = new Map(sceneRows.map((row) => [Number(row.id), row]));
  const assetReferenceFailures = [];
  if (!draftMode) {
    for (const storyboard of storyboards) {
      const references = parseJson(storyboard.characters, []);
      if (storyboard.characters && !Array.isArray(references)) {
        assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'character', reason: 'invalid_reference_list' });
      }
      for (const reference of Array.isArray(references) ? references : []) {
        const id = Number(typeof reference === 'object' && reference ? reference.id : reference);
        const name = String(typeof reference === 'object' && reference ? reference.name || '' : reference || '').trim().toLowerCase();
        const character = (Number.isSafeInteger(id) && id > 0 ? characterById.get(id) : null) || characterByName.get(name);
        if (!character || !firstRealAsset(character, ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset']) ||
          containsMockReference(character.identity_anchors) || containsMockReference(character.stages)) {
          assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'character', reference });
        }
      }
      if (storyboard.scene_id != null) {
        const scene = sceneById.get(Number(storyboard.scene_id));
        if (!scene || !firstRealAsset(scene, ['local_path', 'image_url', 'ref_image'])) {
          assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'scene', reference: storyboard.scene_id });
        }
      }
      const propReferences = db.prepare(
        `SELECT sp.prop_id, p.id, p.image_url, p.local_path, p.ref_image
           FROM storyboard_props sp
           LEFT JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
          WHERE sp.storyboard_id = ?`
      ).all(storyboard.id);
      for (const prop of propReferences) {
        if (!prop.id || !firstRealAsset(prop, ['local_path', 'image_url', 'ref_image'])) {
          assetReferenceFailures.push({ storyboard_id: storyboard.id, type: 'prop', reference: prop.prop_id });
        }
      }
      for (const field of ['reference_images', 'continuity_snapshot']) {
        if (containsMockReference(storyboard[field])) {
          assetReferenceFailures.push({ storyboard_id: storyboard.id, type: field, reason: 'mock_reference' });
        }
      }
    }
  }
  const assetReferencesOk = draftMode || assetReferenceFailures.length === 0;
  if (!assetReferencesOk) {
    addIssue(
      issues,
      'production_asset_references_invalid',
      'error',
      '正式制作分镜引用必须指向现有且非占位的角色、场景和道具资产',
      { drama_id: dramaId, failures: assetReferenceFailures }
    );
  }
  checks.push({
    key: 'production_asset_references',
    passed: assetReferencesOk,
    weight: 0,
    failure_count: assetReferenceFailures.length,
  });

  const realMediaStoryboardIds = new Set();
  const realImageStoryboardIds = new Set();
  const realVideoStoryboardIds = new Set();
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
    const generatedImageRows = db.prepare(
       `SELECT storyboard_id, provider, image_url, NULL AS video_url, local_path
          FROM image_generations
         WHERE storyboard_id IN (${placeholders})
           AND status = 'completed'
           AND deleted_at IS NULL`
    ).all(
      ...sbIds
    ).filter(isNonMockGenerationRow);
    generatedMediaRows = generatedImageRows;
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
    generatedImageRows.forEach((row) => realImageStoryboardIds.add(Number(row.storyboard_id)));
    generatedVideoRows.forEach((row) => realVideoStoryboardIds.add(Number(row.storyboard_id)));
    generatedMediaRows.forEach((row) => realMediaStoryboardIds.add(Number(row.storyboard_id)));
  }
  const timeline = hasTimelineForEpisodes(db, episodeIds, { production: !draftMode });
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
  if (mediaOk) score += 15;
  else addIssue(
    issues,
    'media_timeline_incomplete',
    draftMode ? 'warning' : 'error',
    draftMode
      ? '草稿流程的时间线计划不完整'
      : '正式交付检查要求每个分镜都有非占位的真实生成媒体',
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

  let workflowOk = true;
  let stepRows = [];
  if (run_id) {
    stepRows = db.prepare('SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sort_order ASC').all(String(run_id));
    workflowOk = stepRows.length > 0 && stepRows.every((step) => (
      step.status === 'completed' || (step.step_key === 'qa_audit' && step.status === 'processing')
    ));
    if (!workflowOk) addIssue(issues, 'workflow_steps_incomplete', 'error', '制作流程仍有未完成步骤', { run_id });
  }
  if (workflowOk) score += 10;
  checks.push({ key: 'workflow_integrity', passed: workflowOk, weight: 10, step_count: stepRows.length });

  const requiredProviderTypes = ['text', 'asset_image', 'image', 'video', 'tts', 'compositor'];
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
      ? 'AI 服务生成审计记录缺失或不完整'
      : '正式交付检查需要文本、素材图片、分镜图片、视频、语音和合成器的成功非占位审计记录',
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
    if (!skillOk) addIssue(issues, 'skill_audit_missing', 'warning', '技能调用审计记录缺失或不完整', { run_id, skill_count: skillCount });
    checks.push({ key: 'skill_registry_audit', passed: skillOk, weight: 0, skill_count: skillCount });
  }

  try {
    const skillRegistryService = require('./skillRegistryService');
    const templates = skillRegistryService.getSkillTemplates();
    const missingTemplates = templates.filter((template) => !template.exists);
    const templatesOk = templates.length >= 6 && missingTemplates.length === 0;
    if (!templatesOk) addIssue(issues, 'skill_templates_missing', 'warning', '缺少本地技能提示词模板', { missing: missingTemplates.map((item) => item.template_path) });
    checks.push({
      key: 'skill_template_audit',
      passed: templatesOk,
      weight: 0,
      template_count: templates.length,
      missing_count: missingTemplates.length,
    });
  } catch (err) {
    addIssue(issues, 'skill_templates_missing', 'warning', err.message || '无法审计本地技能提示词模板', { drama_id: dramaId });
    checks.push({ key: 'skill_template_audit', passed: false, weight: 0, error: err.message });
  }

  try {
    const asyncAuditService = require('./asyncAuditService');
    const asyncAudit = asyncAuditService.auditLegacyAsyncEntrypoints();
    if (!asyncAudit.passed) addIssue(issues, 'legacy_async_audit_failed', 'warning', '发现未纳入追踪的旧版后台任务入口', { issues: asyncAudit.issues });
    checks.push({
      key: 'legacy_async_audit',
      passed: asyncAudit.passed,
      weight: 0,
      tracked_file_count: Object.keys(asyncAudit.allowlist).length,
      usage_count: Object.values(asyncAudit.counts).reduce((sum, countValue) => sum + countValue, 0),
      issue_count: asyncAudit.issues.length,
    });
  } catch (err) {
    addIssue(issues, 'legacy_async_audit_failed', 'warning', err.message || '后台任务入口审计失败', { drama_id: dramaId });
    checks.push({ key: 'legacy_async_audit', passed: false, weight: 0, error: err.message });
  }

  if (!draftMode && issues.some((issue) => issue.severity === 'error')) score = Math.min(score, 79);
  const passed = score >= 80 && !issues.some((issue) => issue.severity === 'error');
  const recommendations = issues.map((issue) => {
    if (issue.code === 'source_missing') return '请先在故事素材流程导入素材，再开始正式制作。';
    if (issue.code === 'story_ir_missing') return '请根据已导入素材创建或重新生成改编计划。';
    if (issue.code === 'episodes_incomplete') return '请应用改编计划，或补齐缺失的分集剧本。';
    if (issue.code === 'character_continuity_incomplete') return '请在图片或视频生成前补齐角色锚点和参考图。';
    if (issue.code === 'asset_library_empty') return '请提取或添加场景、道具，以保持画面连续性。';
    if (issue.code === 'storyboards_incomplete') return '请在生成媒体前补齐分镜草稿字段。';
    if (issue.code === 'production_asset_references_invalid') return '请用现有正式资产替换缺失或占位的分镜引用。';
    if (issue.code === 'media_timeline_incomplete') return '请在最终验收前生成完整媒体和时间线轨道。';
    if (issue.code === 'workflow_steps_incomplete') return '请在最终质量检查前重试失败的流程步骤。';
    if (issue.code === 'provider_audit_missing') return '请通过统一制作流程调用 AI 服务，确保图片、视频、音频和合成记录可审计。';
    if (issue.code === 'skill_audit_missing') return '请通过已注册技能运行流程节点，保留创作和质量决策记录。';
    if (issue.code === 'skill_templates_missing') return '请在流程审计前恢复本地技能提示词模板。';
    if (issue.code === 'legacy_async_audit_failed') return '请先登记或迁移旧版后台任务入口，再增加新的后台任务。';
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
      add('import_source', '导入故事素材', false, '自动修复前必须先有可追溯的故事素材。');
      continue;
    }
    if (issue.code === 'story_ir_missing') {
      add(
        'start_or_retry_workflow',
        '启动或重试流程',
        context.source_count > 0 || !!context.run_id,
        '故事结构或改编计划缺失，可根据最近导入的素材重新生成。',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'character_continuity_incomplete') {
      add(
        'refresh_asset_bible',
        '刷新资产设定',
        context.source_count > 0 || !!context.run_id,
        '角色身份锚点、阶段设定或参考资产不完整。',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'storyboards_incomplete') {
      add(
        'repair_storyboards',
        '修复分镜草稿',
        context.source_count > 0 || !!context.run_id,
        '可重建分镜草稿，然后重新运行媒体、时间线、合成和质量检查。',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (issue.code === 'media_timeline_incomplete') {
      add(
        'repair_timeline',
        '修复时间线',
        context.source_count > 0 || !!context.run_id,
        '可重建时间线轨道、条目和草稿合成产物。',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['episodes_incomplete', 'workflow_steps_incomplete'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        '重试制作流程',
        context.source_count > 0 || !!context.run_id,
        '分集或流程步骤不完整，应通过统一制作流程修复。',
        { drama_id: context.drama_id, run_id: context.run_id || null }
      );
      continue;
    }
    if (['provider_audit_missing', 'skill_audit_missing'].includes(issue.code)) {
      add(
        'start_or_retry_workflow',
        '重跑流程审计',
        context.source_count > 0 || !!context.run_id,
        'AI 服务或技能审计记录应由统一制作流程生成。',
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
    return { report, skipped: true, reason: '质量检查已通过，无需修复', actions_taken: [] };
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
      reason: '当前问题没有可自动执行的修复方案',
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
        reason: `制作流程当前为${({ pending: '等待中', processing: '运行中', paused: '已暂停' })[run.status] || '活动状态'}`,
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
      reason: '缺少可用于自动修复的故事素材',
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
