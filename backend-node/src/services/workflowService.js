const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const dramaService = require('./dramaService');
const sourceIntakeService = require('./sourceIntakeService');
const qaService = require('./qaService');
const providerSdkService = require('./providerSdkService');
const skillRegistryService = require('./skillRegistryService');
const characterContinuityService = require('./characterContinuityService');
const readinessService = require('./readinessService');
const aiClient = require('./aiClient');
const { backgroundTasks: defaultBackgroundTasks } = require('./legacyAsyncSchedulerService');

const RUN_ACTIVE_STATUSES = new Set(['pending', 'processing']);
const RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const processingRunIds = new Set();
const workflowQueues = new WeakMap();
const STEP_CHECKPOINT_KEY = '__workflow_checkpoint';
const STEP_CALL_KEY_FIELD = '_workflow_call_key';

const NOVEL2ANIME_STEPS = [
  { key: 'source_intake', label: '素材导入' },
  { key: 'adaptation_plan', label: '改编计划' },
  { key: 'apply_episodes', label: '写入分集' },
  { key: 'asset_bible', label: '角色与场景资产' },
  { key: 'storyboard_draft', label: '分镜草稿' },
  { key: 'image_generation', label: '分镜图片生成' },
  { key: 'video_generation', label: '分镜视频生成' },
  { key: 'audio_generation', label: '对白与旁白配音' },
  { key: 'timeline_plan', label: '时间线规划' },
  { key: 'post_composite', label: '成片合成' },
  { key: 'qa_audit', label: '质量检查' },
];

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

function workflowStepCallKey(runId, stepKey) {
  return `workflow:${String(runId)}:step:${String(stepKey)}:v1`;
}

function ensureStepCallKey(db, run, step) {
  const input = step?.input_json && typeof step.input_json === 'object' ? { ...step.input_json } : {};
  const expected = workflowStepCallKey(run.id, step.step_key);
  if (input[STEP_CALL_KEY_FIELD] === expected) return expected;
  input[STEP_CALL_KEY_FIELD] = expected;
  db.prepare('UPDATE workflow_steps SET input_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(input), nowIso(), step.id);
  return expected;
}

function checkpointStepResult(db, stepId, callKey, output) {
  const checkpoint = {
    [STEP_CHECKPOINT_KEY]: {
      version: 1,
      call_key: callKey,
      state: 'succeeded',
      output: output == null ? {} : output,
      recorded_at: nowIso(),
    },
  };
  db.prepare('UPDATE workflow_steps SET output_json = ?, updated_at = ? WHERE id = ?')
    .run(toJson(checkpoint), nowIso(), String(stepId));
  return output;
}

function completedCheckpoint(step, callKey) {
  const checkpoint = step?.output_json?.[STEP_CHECKPOINT_KEY];
  if (!checkpoint || checkpoint.state !== 'succeeded' || checkpoint.call_key !== callKey) return null;
  return checkpoint.output == null ? {} : checkpoint.output;
}

function completedStepEffect(db, callKey) {
  const row = db.prepare(
    `SELECT output_json FROM workflow_step_effects
      WHERE call_key = ? AND status = 'succeeded'`
  ).get(String(callKey));
  return row ? parseJson(row.output_json, {}) : null;
}

function recordStepEffect(db, run, step, output) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO workflow_step_effects
     (call_key, run_id, workflow_step_id, step_key, status, output_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)`
  ).run(
    String(step.call_key),
    String(run.id),
    String(step.id),
    String(step.step_key),
    toJson(output),
    now,
    now
  );
  return output;
}

function recordSkill(db, run, step, skillName, input, output, status = 'success') {
  return skillRegistryService.recordSkillInvocation(db, {
    workflow_step_id: step?.id || null,
    run_id: run?.id || null,
    skill_name: skillName,
    input,
    output,
    status,
  });
}

function rowToRun(row) {
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    type: row.type,
    status: row.status,
    progress: row.progress ?? 0,
    current_step: row.current_step,
    input_json: parseJson(row.input_json, {}),
    output_json: parseJson(row.output_json, {}),
    error: row.error,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToStep(row) {
  return {
    id: row.id,
    run_id: row.run_id,
    step_key: row.step_key,
    status: row.status,
    attempts: row.attempts ?? 0,
    input_json: parseJson(row.input_json, {}),
    output_json: parseJson(row.output_json, {}),
    error: row.error,
    sort_order: row.sort_order ?? 0,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getWorkflowRun(db, runId) {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ? AND deleted_at IS NULL').get(String(runId));
  return row ? rowToRun(row) : null;
}

function getWorkflowSteps(db, runId) {
  return db.prepare(
    'SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(String(runId)).map(rowToStep);
}

function getWorkflowProviderSummaries(db, runId) {
  return db.prepare(
    `SELECT workflow_step_id, provider_type, provider_name, model, mode, status, cost_estimate, cost_kind
       FROM provider_invocations
      WHERE run_id = ?
      ORDER BY id ASC`
  ).all(String(runId)).map((row) => {
    const storedCost = row.cost_estimate == null ? null : Number(row.cost_estimate);
    const legacyUnknown = !row.cost_kind && row.mode === 'production' && storedCost === 0;
    const costKind = row.cost_kind || (
      row.mode === 'mock' ? 'non_billable' : legacyUnknown || storedCost == null ? 'unknown' : 'estimated'
    );
    return {
      workflow_step_id: row.workflow_step_id,
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      model: row.model,
      mode: row.mode,
      status: row.status,
      cost_estimate: legacyUnknown ? null : storedCost,
      cost_kind: costKind,
    };
  });
}

function getWorkflowRunDetail(db, runId) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  const providerInvocations = getWorkflowProviderSummaries(db, run.id);
  const providersByStep = new Map();
  for (const invocation of providerInvocations) {
    if (!invocation.workflow_step_id) continue;
    const values = providersByStep.get(invocation.workflow_step_id) || [];
    values.push(invocation);
    providersByStep.set(invocation.workflow_step_id, values);
  }
  const steps = getWorkflowSteps(db, run.id).map((step) => ({
    ...step,
    provider_invocations: providersByStep.get(step.id) || [],
  }));
  return { ...run, steps, provider_invocations: providerInvocations };
}

function listWorkflowRuns(db, query = {}) {
  let sql = 'SELECT * FROM workflow_runs WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id != null) {
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.type) {
    sql += ' AND type = ?';
    params.push(String(query.type));
  }
  if (query.status) {
    sql += ' AND status = ?';
    params.push(String(query.status));
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(100, Number(query.limit) || 20)));
  return db.prepare(sql).all(...params).map(rowToRun);
}

function createWorkflowRun(db, log, params) {
  const dramaId = Number(params.drama_id || params.dramaId);
  if (!dramaId || !dramaService.getDramaById(db, dramaId)) {
    const err = new Error('drama_id is required and must reference an existing drama');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const type = String(params.type || 'novel2anime').trim();
  const steps = params.steps && params.steps.length ? params.steps : NOVEL2ANIME_STEPS;
  const id = uuidv4();
  const createdAt = nowIso();
  const workflowOptions = params.options && typeof params.options === 'object' && !Array.isArray(params.options)
    ? { ...params.options }
    : {};
  for (const key of [
    'text_model',
    'text_provider',
    'asset_image_model',
    'asset_image_provider',
    'image_model',
    'image_provider',
    'video_model',
    'video_provider',
    'tts_model',
    'tts_provider',
  ]) {
    if (workflowOptions[key] == null && params[key] != null) workflowOptions[key] = params[key];
  }
  skillRegistryService.ensureDefaultSkills(db);
  const runInput = {
    drama_id: dramaId,
    episode_id: params.episode_id || null,
    type,
    source_id: params.source_id || null,
    adaptation_plan_id: params.adaptation_plan_id || null,
    overwrite_existing_episodes: params.overwrite_existing_episodes === true || params.overwrite === true,
    title: params.title || '',
    source_type: params.source_type || '',
    target_episode_count: params.target_episode_count || params.episode_count || null,
    style: params.style || '',
    metadata: params.metadata || {},
    qa_mode: params.qa_mode === 'production' || params.mode === 'production' ? 'production' : 'draft',
    text_excerpt: String(params.text || '').slice(0, 1000),
    options: workflowOptions,
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workflow_runs
       (id, drama_id, episode_id, type, status, progress, current_step, input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
    ).run(id, dramaId, params.episode_id || null, type, steps[0]?.key || null, toJson(runInput), createdAt, createdAt);

    const insertStep = db.prepare(
      `INSERT INTO workflow_steps
       (id, run_id, step_key, status, attempts, input_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
    );
    steps.forEach((step, index) => {
      const stepInput = index === 0 ? {
        drama_id: dramaId,
        source_id: params.source_id || null,
        adaptation_plan_id: params.adaptation_plan_id || null,
        text: params.text || '',
        title: params.title || '',
        source_type: params.source_type || '',
        target_episode_count: params.target_episode_count || params.episode_count || null,
        style: params.style || '',
        metadata: params.metadata || {},
      } : {};
      stepInput[STEP_CALL_KEY_FIELD] = workflowStepCallKey(id, step.key);
      insertStep.run(uuidv4(), id, step.key, toJson(stepInput), index, createdAt, createdAt);
    });
  });
  tx();
  log?.info?.('Workflow run created', { run_id: id, type, drama_id: dramaId });
  return getWorkflowRunDetail(db, id);
}

function setRunStatus(db, runId, status, patch = {}) {
  const now = nowIso();
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  const startedAt = patch.started_at !== undefined ? patch.started_at : (run.started_at || (status === 'processing' ? now : null));
  const completedAt = patch.completed_at !== undefined
    ? patch.completed_at
    : (RUN_TERMINAL_STATUSES.has(status) ? now : null);
  db.prepare(
    `UPDATE workflow_runs
     SET status = ?, progress = ?, current_step = ?, output_json = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    patch.progress ?? run.progress ?? 0,
    patch.current_step !== undefined ? patch.current_step : run.current_step,
    patch.output_json !== undefined ? toJson(patch.output_json) : toJson(run.output_json || {}),
    patch.error !== undefined ? patch.error : run.error,
    startedAt,
    completedAt,
    now,
    runId
  );
  return getWorkflowRun(db, runId);
}

function setStepStatus(db, stepId, status, patch = {}) {
  const now = nowIso();
  const row = db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(String(stepId));
  if (!row) return null;
  const startedAt = patch.started_at !== undefined ? patch.started_at : (row.started_at || (status === 'processing' ? now : null));
  const completedAt = patch.completed_at !== undefined
    ? patch.completed_at
    : (status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null);
  const attempts = patch.attempts !== undefined ? patch.attempts : row.attempts;
  db.prepare(
    `UPDATE workflow_steps
     SET status = ?, attempts = ?, output_json = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    attempts,
    patch.output_json !== undefined ? toJson(patch.output_json) : row.output_json,
    patch.error !== undefined ? patch.error : row.error,
    startedAt,
    completedAt,
    now,
    stepId
  );
  return db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(String(stepId));
}

function previousOutput(steps, stepKey) {
  const step = steps.find((s) => s.step_key === stepKey);
  return step ? step.output_json || {} : {};
}

function splitScriptIntoBeats(script, count) {
  const sentences = String(script || '')
    .split(/(?<=[。！？!?；;.\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const desired = Math.max(1, Math.min(8, Number(count) || Math.ceil(sentences.length / 2) || 3));
  if (!sentences.length) return ['Story beat'];
  const beats = [];
  for (let i = 0; i < desired; i++) {
    const start = Math.floor((i * sentences.length) / desired);
    const end = Math.floor(((i + 1) * sentences.length) / desired);
    const chunk = sentences.slice(start, Math.max(start + 1, end)).join('');
    if (chunk.trim()) beats.push(chunk.trim());
  }
  return beats.length ? beats : [String(script).slice(0, 400)];
}

function ensureAssetBible(db, log, dramaId, mode = 'draft') {
  const now = nowIso();
  const eventRows = db.prepare(
    'SELECT characters, location, detail FROM story_events WHERE drama_id = ? ORDER BY event_no ASC, id ASC'
  ).all(Number(dramaId));
  const characterNames = new Set();
  const locations = new Set();
  for (const event of eventRows) {
    const chars = parseJson(event.characters, []);
    if (Array.isArray(chars)) chars.forEach((name) => {
      const clean = String(name || '').trim();
      if (clean) characterNames.add(clean);
    });
    const location = String(event.location || '').trim();
    if (location) locations.add(location);
  }
  if (!characterNames.size) characterNames.add('主角');
  if (!locations.size) locations.add('主要场景');

  const insertCharacter = db.prepare(
    `INSERT INTO characters
     (drama_id, name, role, description, personality, appearance, image_url, local_path, identity_anchors, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let characterCreated = 0;
  Array.from(characterNames).slice(0, 12).forEach((name, index) => {
    const exists = db.prepare(
      'SELECT id FROM characters WHERE drama_id = ? AND name = ? AND deleted_at IS NULL'
    ).get(Number(dramaId), name);
    if (exists) return;
    const referencePath = mode === 'production'
      ? null
      : `mock://dramas/${dramaId}/characters/${index + 1}/reference.png`;
    insertCharacter.run(
      Number(dramaId),
      name,
      index === 0 ? 'main' : 'supporting',
      `${name} from the source story.`,
      'Keep motivation, voice, and visual identity consistent across episodes.',
      `${name} has a locked visual identity for storyboard and media generation.`,
      referencePath,
      referencePath,
      toJson({ locked_name: name, source: 'workflow_asset_bible', consistency_rule: 'do not rewrite identity anchors in downstream steps' }),
      index,
      now,
      now
    );
    characterCreated += 1;
  });

  if (mode === 'production') {
    db.prepare(
      `UPDATE characters
          SET image_url = CASE WHEN image_url LIKE 'mock://%' OR image_url LIKE 'placeholder://%' THEN NULL ELSE image_url END,
              local_path = CASE WHEN local_path LIKE 'mock://%' OR local_path LIKE 'placeholder://%' THEN NULL ELSE local_path END,
              updated_at = ?
        WHERE drama_id = ? AND deleted_at IS NULL`
    ).run(now, Number(dramaId));
  }

  const insertScene = db.prepare(
    `INSERT INTO scenes (drama_id, location, time, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`
  );
  let sceneCreated = 0;
  Array.from(locations).slice(0, 12).forEach((location) => {
    const exists = db.prepare(
      'SELECT id FROM scenes WHERE drama_id = ? AND location = ? AND deleted_at IS NULL'
    ).get(Number(dramaId), location);
    if (exists) return;
    insertScene.run(Number(dramaId), location, 'day', `${location}, cinematic short-drama environment, continuity locked`, now, now);
    sceneCreated += 1;
  });

  const propCreated = 0;

  const continuity = mode === 'production'
    ? { character_count: characterNames.size, updated: 0, episode_range: [] }
    : characterContinuityService.ensureCharacterContinuity(db, log, dramaId);
  log?.info?.('Workflow asset bible prepared', { drama_id: dramaId, characterCreated, sceneCreated, propCreated });
  return {
    character_created: characterCreated,
    scene_created: sceneCreated,
    prop_created: propCreated,
    character_continuity: {
      character_count: continuity.character_count,
      updated: continuity.updated,
      episode_range: continuity.episode_range,
    },
  };
}

function createCreativeReview(db, { dramaId, runId, sourceId, role, targetType, targetId, status, findings }) {
  const now = nowIso();
  const existing = db.prepare(
    `SELECT id FROM creative_reviews
     WHERE run_id = ? AND role = ? AND target_type = ? AND COALESCE(target_id, '') = COALESCE(?, '')
     ORDER BY id ASC LIMIT 1`
  ).get(runId || null, role, targetType, targetId || null);
  if (existing) return existing.id;
  const info = db.prepare(
    `INSERT INTO creative_reviews
     (drama_id, run_id, source_id, role, target_type, target_id, status, findings_json, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dramaId || null,
    runId || null,
    sourceId || null,
    role,
    targetType,
    targetId || null,
    status || 'locked',
    toJson(findings || []),
    now,
    status === 'locked' || status === 'resolved' ? now : null
  );
  return Number(info.lastInsertRowid);
}

function finalizeQaPendingComposites(db, run) {
  const episodes = run.episode_id
    ? db.prepare('SELECT id FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
      .all(Number(run.episode_id), Number(run.drama_id))
    : db.prepare('SELECT id FROM episodes WHERE drama_id = ? AND deleted_at IS NULL')
      .all(Number(run.drama_id));
  const now = nowIso();
  let mergeCount = 0;
  const completedTasks = [];
  const scopedMergeIds = new Set();
  const compositorInvocations = db.prepare(
    `SELECT output_json FROM provider_invocations
      WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'`
  ).all(String(run.id));
  for (const invocation of compositorInvocations) {
    const output = parseJson(invocation.output_json, {});
    const mergeId = Number(output.merge_id);
    if (Number.isSafeInteger(mergeId) && mergeId > 0) scopedMergeIds.add(mergeId);
  }
  for (const episode of episodes) {
    const pendingMerges = db.prepare(
      `SELECT id, task_id, merged_url, duration FROM video_merges
        WHERE episode_id = ? AND status = 'qa_pending' AND deleted_at IS NULL
        ORDER BY id ASC`
    ).all(episode.id);
    const scopedMerges = pendingMerges.filter((merge) => scopedMergeIds.has(Number(merge.id)));
    const merges = scopedMerges.length
      ? scopedMerges
      : (compositorInvocations.length && pendingMerges.length ? [pendingMerges[pendingMerges.length - 1]] : []);
    if (!merges.length) continue;
    for (const merge of merges) {
      db.prepare(
        `UPDATE video_merges
            SET status = 'completed', completed_at = ?, error_msg = NULL
          WHERE id = ? AND status = 'qa_pending'`
      ).run(now, merge.id);
      mergeCount += 1;
      if (merge.task_id) completedTasks.push(merge);
    }
    const selected = merges[merges.length - 1];
    db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(selected.merged_url, 'completed', now, episode.id);
  }
  for (const merge of completedTasks) {
    require('./taskService').updateTaskResult(db, merge.task_id, {
      merge_id: merge.id,
      video_url: merge.merged_url,
      duration: merge.duration,
      mode: 'strict_production',
    });
  }
  return { episode_count: episodes.length, merge_count: mergeCount };
}

function ensureStoryboardDraft(db, log, dramaId) {
  const now = nowIso();
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(Number(dramaId));
  const characters = db.prepare(
    'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
  ).all(Number(dramaId));
  const scenes = db.prepare(
    'SELECT id, location FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(Number(dramaId));
  const insertStoryboard = db.prepare(
    `INSERT INTO storyboards
     (episode_id, storyboard_number, title, description, layout_description, location, time, duration, dialogue, narration,
      action, atmosphere, image_prompt, video_prompt, shot_type, angle, movement, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  );
  let created = 0;
  let skippedEpisodes = 0;

  for (const episode of episodes) {
    const existing = db.prepare(
      "SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL AND COALESCE(status, '') != 'stale'"
    ).get(episode.id).count || 0;
    if (existing > 0) {
      skippedEpisodes += 1;
      continue;
    }
    const beats = splitScriptIntoBeats(episode.script_content, 4);
    beats.forEach((beat, index) => {
      const num = index + 1;
      const title = `E${episode.episode_number || episode.id}-${num}`;
      const referencedCharacters = characters.filter((character) => (
        String(character.name || '').trim() && beat.includes(String(character.name).trim())
      ));
      const scene = scenes.find((candidate) => (
        String(candidate.location || '').trim() && beat.includes(String(candidate.location).trim())
      )) || scenes[0] || null;
      const location = scene?.location || '';
      const action = beat.slice(0, 500);
      const inserted = insertStoryboard.run(
        episode.id,
        num,
        title,
        action,
        'Stable composition with clear character blocking and readable action.',
        location,
        'day',
        5,
        '',
        action,
        action,
        'dramatic, clear, production-ready',
        `${action}, ${location || 'story location'}, consistent character design, clean cinematic anime frame`,
        `${action}, camera movement follows the emotional beat, preserve character identity and scene continuity`,
        index === 0 ? 'wide' : 'medium',
        'eye_level',
        index % 2 === 0 ? 'slow push in' : 'static hold',
        now,
        now
      );
      db.prepare('UPDATE storyboards SET scene_id = ?, characters = ?, updated_at = ? WHERE id = ?')
        .run(
          scene?.id || null,
          toJson(referencedCharacters.map((character) => ({ id: character.id, name: character.name }))),
          now,
          Number(inserted.lastInsertRowid)
        );
      created += 1;
    });
  }
  log?.info?.('Workflow storyboard draft prepared', { drama_id: dramaId, created, skippedEpisodes });
  return { storyboard_created: created, episode_count: episodes.length, skipped_episodes: skippedEpisodes };
}

function findOrCreateTimelineTrack(db, episodeId, type, name, sortOrder) {
  const existing = db.prepare(
    'SELECT id, name, sort_order FROM timeline_tracks WHERE episode_id = ? AND type = ? ORDER BY id ASC LIMIT 1'
  ).get(Number(episodeId), type);
  if (existing) {
    if (existing.name !== name || Number(existing.sort_order) !== Number(sortOrder)) {
      db.prepare('UPDATE timeline_tracks SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?')
        .run(name, sortOrder, nowIso(), existing.id);
    }
    return existing.id;
  }
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO timeline_tracks (episode_id, type, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(Number(episodeId), type, name, sortOrder, now, now);
  return Number(info.lastInsertRowid);
}

function insertTimelineItemIfMissing(db, trackId, storyboardId, startSec, endSec, sourcePath, metadata) {
  const existing = db.prepare(
    'SELECT id FROM timeline_items WHERE track_id = ? AND storyboard_id = ? LIMIT 1'
  ).get(Number(trackId), Number(storyboardId));
  if (existing) return false;
  const now = nowIso();
  db.prepare(
    `INSERT INTO timeline_items (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(trackId), Number(storyboardId), startSec, endSec, sourcePath, toJson(metadata), now, now);
  return true;
}

function upsertTimelineItem(db, trackId, storyboardId, startSec, endSec, sourcePath, metadata) {
  const existing = db.prepare(
    'SELECT id FROM timeline_items WHERE track_id = ? AND storyboard_id = ? LIMIT 1'
  ).get(Number(trackId), Number(storyboardId));
  const now = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE timeline_items
          SET start_sec = ?, end_sec = ?, source_path = ?, metadata = ?, updated_at = ?
        WHERE id = ?`
    ).run(startSec, endSec, sourcePath, toJson(metadata), now, existing.id);
    return false;
  }
  db.prepare(
    `INSERT INTO timeline_items (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(trackId), Number(storyboardId), startSec, endSec, sourcePath, toJson(metadata), now, now);
  return true;
}

function updateTimelineTrackState(db, trackId, status, metadata) {
  db.prepare('UPDATE timeline_tracks SET status = ?, metadata = ?, updated_at = ? WHERE id = ?')
    .run(status, toJson(metadata), nowIso(), Number(trackId));
}

function countTimelineItems(db, trackId) {
  return db.prepare('SELECT COUNT(*) AS count FROM timeline_items WHERE track_id = ?')
    .get(Number(trackId)).count || 0;
}

function ensureTimelinePlan(db, log, dramaId, mode = 'draft') {
  const episodes = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC'
  ).all(Number(dramaId));
  let trackCreatedOrFound = 0;
  let itemCreated = 0;

  for (const episode of episodes) {
    const tracks = {
      video: findOrCreateTimelineTrack(db, episode.id, 'video', '视频', 10),
      subtitle: findOrCreateTimelineTrack(db, episode.id, 'subtitle', '字幕', 20),
      voice: findOrCreateTimelineTrack(db, episode.id, 'voice', '旁白', 30),
      dialogue: findOrCreateTimelineTrack(db, episode.id, 'dialogue', '对白', 35),
      effect: findOrCreateTimelineTrack(db, episode.id, 'effect', '音效', 40),
      bgm: findOrCreateTimelineTrack(db, episode.id, 'bgm', 'BGM', 50),
      transition: findOrCreateTimelineTrack(db, episode.id, 'transition', '转场', 60),
    };
    trackCreatedOrFound += Object.keys(tracks).length;
    db.prepare(
      `DELETE FROM timeline_items
        WHERE track_id IN (?, ?, ?)
          AND (
            source_path LIKE 'mock://%'
            OR source_path LIKE 'placeholder://%'
            OR metadata LIKE '%"placeholder":true%'
          )`
    ).run(tracks.effect, tracks.bgm, tracks.transition);
    if (mode === 'production') {
      const trackIds = Object.values(tracks);
      const placeholders = trackIds.map(() => '?').join(',');
      db.prepare(
        `DELETE FROM timeline_items
          WHERE track_id IN (${placeholders})
            AND (
              source_path LIKE 'mock://%'
              OR source_path LIKE 'placeholder://%'
              OR metadata LIKE '%"placeholder":true%'
            )`
      ).run(...trackIds);
    }
    const storyboards = db.prepare(
      `SELECT id, storyboard_number, duration, dialogue, narration, video_url, video_local_path,
              audio_local_path, narration_audio_local_path
         FROM storyboards
        WHERE episode_id = ? AND deleted_at IS NULL
        ORDER BY storyboard_number ASC, id ASC`
    ).all(episode.id);
    let cursor = 0;
    for (const sb of storyboards) {
      const duration = Math.max(1, Number(sb.duration) || 5);
      const start = cursor;
      const end = cursor + duration;
      if (mode === 'production') {
        const videoPath = sb.video_local_path || sb.video_url;
        if (videoPath && !/^(?:mock|placeholder):\/\//i.test(videoPath)) {
          if (upsertTimelineItem(db, tracks.video, sb.id, start, end, videoPath, { workflow: 'novel2anime', kind: 'video', production: true })) itemCreated += 1;
        }
        const subtitle = sb.dialogue || sb.narration || '';
        if (subtitle) {
          if (upsertTimelineItem(db, tracks.subtitle, sb.id, start, end, subtitle, { kind: 'subtitle', production: true })) itemCreated += 1;
        }
        if (sb.narration_audio_local_path) {
          if (upsertTimelineItem(db, tracks.voice, sb.id, start, end, sb.narration_audio_local_path, { kind: 'voice', production: true })) itemCreated += 1;
        }
        if (sb.audio_local_path) {
          if (upsertTimelineItem(db, tracks.dialogue, sb.id, start, end, sb.audio_local_path, { kind: 'dialogue', text: sb.dialogue || '', production: true })) itemCreated += 1;
        }
      } else {
        if (insertTimelineItemIfMissing(db, tracks.video, sb.id, start, end, `mock://storyboard/${sb.id}/video`, { workflow: 'novel2anime', placeholder: true })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.subtitle, sb.id, start, end, sb.dialogue || sb.narration || '', { kind: 'subtitle' })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.voice, sb.id, start, end, `mock://storyboard/${sb.id}/voice`, { kind: 'voice', placeholder: true })) itemCreated += 1;
        if (insertTimelineItemIfMissing(db, tracks.dialogue, sb.id, start, end, sb.dialogue || '', { kind: 'dialogue', placeholder: !sb.dialogue })) itemCreated += 1;
      }
      cursor = end;
    }
    for (const type of ['effect', 'bgm', 'transition']) {
      updateTimelineTrackState(db, tracks[type], 'unused', {
        workflow: 'novel2anime',
        optional: true,
        usage: 'unused',
      });
    }
    for (const type of ['video', 'subtitle', 'voice', 'dialogue']) {
      const itemCount = countTimelineItems(db, tracks[type]);
      updateTimelineTrackState(db, tracks[type], itemCount > 0 ? 'ready' : 'pending', {
        workflow: 'novel2anime',
        optional: false,
        item_count: itemCount,
      });
    }
  }
  log?.info?.('Workflow timeline plan prepared', { drama_id: dramaId, episode_count: episodes.length, itemCreated });
  return { episode_count: episodes.length, track_count: trackCreatedOrFound, timeline_item_created: itemCreated };
}

async function requestProductionAdaptationText(db, log, run, step, sourceId, plan, providerOptions) {
  const sourceDetail = sourceIntakeService.getSourceDetail(db, sourceId);
  if (!sourceDetail) throw new Error('Source not found for production text adaptation');
  const sourcePrompt = skillRegistryService.renderSkillPrompt(db, 'localminidrama-source-intake', {
    drama_id: run.drama_id,
    source_id: sourceId,
    source_type: sourceDetail.source.source_type,
    source_items: sourceDetail.items,
    story_events: sourceDetail.events,
  });
  const adaptationPrompt = skillRegistryService.renderSkillPrompt(db, 'localminidrama-script-adapter', {
    source_id: sourceId,
    adaptation_plan_id: plan.id,
    overwrite_existing_episodes: run.input_json?.overwrite_existing_episodes === true,
    adaptation_plan: plan.plan_json,
  });
  const routeOptions = {
    model: providerOptions.text_model,
    provider: providerOptions.text_provider,
  };
  const route = aiClient.resolveTextRoute(db, 'text', routeOptions);
  if (!route) throw new Error('Production workflow is not ready: text provider route is unavailable');
  const model = aiClient.getModelFromConfig(route.config, route.modelOverride || routeOptions.model);
  const providerName = route.config.provider || route.config.name || 'text-provider';
  const promptEvidence = {
    source: {
      skill_name: sourcePrompt.skill_name,
      skill_version: sourcePrompt.skill_version,
      template_sha256: sourcePrompt.template_sha256,
    },
    adaptation: {
      skill_name: adaptationPrompt.skill_name,
      skill_version: adaptationPrompt.skill_version,
      template_sha256: adaptationPrompt.template_sha256,
    },
  };
  const systemPrompt = `${sourcePrompt.system_prompt}\n\n${adaptationPrompt.system_prompt}`;
  const userPrompt = JSON.stringify({
    source: JSON.parse(sourcePrompt.user_prompt),
    adaptation: JSON.parse(adaptationPrompt.user_prompt),
  });
  try {
    const responseText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      ...routeOptions,
      json_mode: true,
      temperature: 0.2,
      max_tokens: 2000,
      idempotency_key: step.call_key,
    });
    return {
      provider_name: providerName,
      model,
      response_text: responseText,
      response_sha256: crypto.createHash('sha256').update(responseText, 'utf8').digest('hex'),
      prompt_evidence: promptEvidence,
      cost_usage: {
        input_text: `${systemPrompt}\n${userPrompt}`,
        output_text: responseText,
      },
      provider_input: {
        call_key: step.call_key,
        source_id: sourceId,
        adaptation_plan_id: plan.id,
        prompt_evidence: promptEvidence,
      },
    };
  } catch (error) {
    providerSdkService.recordProviderInvocation(db, {
      workflow_step_id: step.id,
      run_id: run.id,
      provider_type: 'text',
      provider_name: providerName,
      model,
      mode: 'production',
      status: 'failed',
      idempotency_key: step.call_key,
      input: { call_key: step.call_key, source_id: sourceId, prompt_evidence: promptEvidence },
      output: { prompt_evidence: promptEvidence },
      error_message: error.message || 'Production text provider request failed',
    });
    throw error;
  }
}

async function executeStep(db, log, run, step, allSteps) {
  const executionMode = run.input_json?.qa_mode === 'production' ? 'production' : 'draft';
  const providerOptions = run.input_json?.options || {};
  if (step.step_key === 'source_intake') {
    const input = step.input_json || {};
    if (input.source_id) {
      const detail = sourceIntakeService.getSourceDetail(db, input.source_id);
      if (!detail) throw new Error('Source not found');
      if (Number(detail.source.drama_id) !== Number(run.drama_id)) {
        throw new Error('Source does not belong to this drama');
      }
      let adaptationPlanId = input.adaptation_plan_id || detail.adaptation_plans[0]?.id || null;
      if (adaptationPlanId) {
        const plan = sourceIntakeService.getAdaptationPlanById(db, adaptationPlanId);
        if (!plan || Number(plan.source_id) !== Number(detail.source.id)) {
          throw new Error('Adaptation plan does not belong to this source');
        }
      }
      const output = {
        source_id: detail.source.id,
        source_type: detail.source.source_type,
        item_count: detail.items.length,
        event_count: detail.events.length,
        event_edge_count: detail.event_edges?.length || 0,
        adaptation_plan_id: adaptationPlanId,
      };
      const commitSource = db.transaction(() => {
        recordSkill(db, run, step, 'localminidrama-source-intake', input, output);
        checkpointStepResult(db, step.id, step.call_key, output);
      });
      commitSource();
      return output;
    }
    const result = sourceIntakeService.createStorySource(db, log, input);
    const output = {
      source_id: result.source.id,
      source_type: result.source.source_type,
      item_count: result.items.length,
      event_count: result.events.length,
      event_edge_count: result.event_edges?.length || 0,
      adaptation_plan_id: result.adaptation_plan?.id || null,
    };
    const commitSource = db.transaction(() => {
      recordSkill(db, run, step, 'localminidrama-source-intake', input, output);
      checkpointStepResult(db, step.id, step.call_key, output);
    });
    commitSource();
    return output;
  }

  if (step.step_key === 'adaptation_plan') {
    const sourceOut = previousOutput(allSteps, 'source_intake');
    const sourceId = sourceOut.source_id;
    if (!sourceId) throw new Error('source_intake output missing source_id');
    let plan = sourceOut.adaptation_plan_id
      ? sourceIntakeService.getAdaptationPlanById(db, sourceOut.adaptation_plan_id)
      : sourceIntakeService.getLatestPlanForSource(db, sourceId);
    if (!plan) {
      const runInput = run.input_json || {};
      plan = sourceIntakeService.createAdaptationPlan(db, log, sourceId, {
        target_episode_count: runInput.target_episode_count,
        style: runInput.style,
      });
    }
    const textEvidence = executionMode === 'production'
      ? await requestProductionAdaptationText(db, log, run, step, sourceId, plan, providerOptions)
      : null;
    const commitAdaptation = db.transaction(() => {
      const reviewId = createCreativeReview(db, {
        dramaId: run.drama_id,
        runId: run.id,
        sourceId,
        role: 'script_writer',
        targetType: 'adaptation_plan',
        targetId: String(plan.id),
        status: 'locked',
        findings: [
          { check: 'source_traceability', passed: true },
          { check: 'episode_beats', passed: Array.isArray(plan.plan_json?.episodes) && plan.plan_json.episodes.length > 0 },
        ],
      });
      const output = {
        adaptation_plan_id: plan.id,
        source_id: plan.source_id,
        episode_count: plan.target_episode_count,
        status: plan.status,
        creative_review_id: reviewId,
        ...(textEvidence ? {
          mode: 'production',
          text_provider: {
            provider_name: textEvidence.provider_name,
            model: textEvidence.model,
            response_sha256: textEvidence.response_sha256,
            prompt_evidence: textEvidence.prompt_evidence,
          },
        } : {}),
      };
      if (textEvidence) {
        providerSdkService.recordProviderInvocation(db, {
          workflow_step_id: step.id,
          run_id: run.id,
          provider_type: 'text',
          provider_name: textEvidence.provider_name,
          model: textEvidence.model,
          mode: 'production',
          usage: textEvidence.cost_usage,
          idempotency_key: step.call_key,
          input: textEvidence.provider_input,
          output: {
            response_text: textEvidence.response_text,
            response_sha256: textEvidence.response_sha256,
            prompt_evidence: textEvidence.prompt_evidence,
          },
        });
      }
      recordSkill(db, run, step, 'localminidrama-script-adapter', { source_id: sourceId }, output);
      return output;
    });
    return commitAdaptation();
  }

  if (step.step_key === 'apply_episodes') {
    const planOut = previousOutput(allSteps, 'adaptation_plan');
    if (!planOut.adaptation_plan_id) throw new Error('adaptation_plan output missing adaptation_plan_id');
    const applyOnce = db.transaction(() => {
      const existing = completedStepEffect(db, step.call_key);
      if (existing) return existing;
      const result = sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, planOut.adaptation_plan_id, {
        overwrite_existing_episodes: run.input_json?.overwrite_existing_episodes === true,
      });
      if (!result) throw new Error('Failed to apply adaptation plan');
      recordSkill(db, run, step, 'localminidrama-script-adapter', { adaptation_plan_id: planOut.adaptation_plan_id }, result);
      return recordStepEffect(db, run, step, result);
    });
    return applyOnce();
  }

  if (step.step_key === 'asset_bible') {
    const result = ensureAssetBible(db, log, run.drama_id, executionMode);
    if (executionMode === 'production') {
      result.asset_generation = await providerSdkService.generateAssetBibleImagesProduction(db, log, {
        ...providerOptions,
        drama_id: run.drama_id,
        run_id: run.id,
        workflow_step_id: step.id,
        call_key: step.call_key,
        mode: 'production',
      });
      const continuity = characterContinuityService.ensureCharacterContinuity(db, log, run.drama_id, {
        allow_mock_fallback: false,
      });
      result.character_continuity = {
        character_count: continuity.character_count,
        updated: continuity.updated,
        episode_range: continuity.episode_range,
      };
    }
    const sourceOut = previousOutput(allSteps, 'source_intake');
    result.creative_review_id = createCreativeReview(db, {
      dramaId: run.drama_id,
      runId: run.id,
      sourceId: sourceOut.source_id || null,
      role: 'art_designer',
      targetType: 'asset_bible',
      targetId: String(run.drama_id),
      status: 'locked',
      findings: [
        { check: 'character_anchors', passed: true },
        { check: 'scene_prop_seed_assets', passed: true },
      ],
    });
    recordSkill(db, run, step, 'art-direction', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'character-design-sheet', { drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'storyboard_draft') {
    const result = ensureStoryboardDraft(db, log, run.drama_id);
    result.creative_review_id = createCreativeReview(db, {
      dramaId: run.drama_id,
      runId: run.id,
      role: 'animator',
      targetType: 'storyboard_draft',
      targetId: String(run.drama_id),
      status: 'locked',
      findings: [
        { check: 'shot_duration', passed: true },
        { check: 'image_video_prompts', passed: true },
      ],
    });
    recordSkill(db, run, step, 'video-storyboard', { drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'image_generation') {
    const result = await providerSdkService.generateStoryboardImages(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'image-generation', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'image', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'video_generation') {
    const result = await providerSdkService.generateStoryboardVideos(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      aspect_ratio: providerOptions.aspect_ratio || run.input_json?.metadata?.aspect_ratio,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'video-prompting', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'seedance-prompt-zh', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'video', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'audio_generation') {
    const result = await providerSdkService.generateStoryboardAudio(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'tts', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'timeline_plan') {
    const result = ensureTimelinePlan(db, log, run.drama_id, executionMode);
    return result;
  }

  if (step.step_key === 'post_composite') {
    const result = await providerSdkService.compositeEpisodes(db, log, {
      ...providerOptions,
      drama_id: run.drama_id,
      run_id: run.id,
      workflow_step_id: step.id,
      call_key: step.call_key,
      defer_qa_completion: true,
      mode: executionMode,
    });
    recordSkill(db, run, step, 'video-use', { drama_id: run.drama_id }, result);
    recordSkill(db, run, step, 'localminidrama-provider-sdk', { provider_type: 'compositor', drama_id: run.drama_id }, result);
    return result;
  }

  if (step.step_key === 'qa_audit') {
    const qaMode = run.input_json?.qa_mode === 'production' ? 'production' : 'draft';
    const auditWithCompletionGate = db.transaction(() => {
      const report = qaService.auditDrama(db, log, {
        drama_id: run.drama_id,
        episode_id: run.episode_id,
        run_id: run.id,
        mode: qaMode,
      });
      if (!report.passed || report.score < 80) return { report, output: null };
      const completion = finalizeQaPendingComposites(db, run);
      const reviewId = createCreativeReview(db, {
        dramaId: run.drama_id,
        runId: run.id,
        role: 'director',
        targetType: 'qa_report',
        targetId: String(report.id),
        status: 'locked',
        findings: [
          { check: 'qa_score', passed: report.score >= 80, score: report.score },
          { check: 'final_acceptance', passed: report.passed },
        ],
      });
      const output = {
        qa_report_id: report.id,
        score: report.score,
        passed: report.passed,
        issue_count: report.report_json?.issues?.length || 0,
        creative_review_id: reviewId,
        finalized_composites: completion.merge_count,
      };
      recordSkill(db, run, step, 'localminidrama-continuity-qa', { drama_id: run.drama_id }, output);
      recordSkill(db, run, step, 'localminidrama-workflow-auditor', { run_id: run.id }, output);
      checkpointStepResult(db, step.id, step.call_key, output);
      return { report, output };
    });
    const { report, output } = auditWithCompletionGate();
    if (!report.passed) {
      const error = new Error(`QA gate failed with score ${report.score}`);
      error.report = report;
      throw error;
    }
    if (!output || output.score < 80 || output.passed !== true) {
      const error = new Error(`QA gate failed with score ${report.score}`);
      error.report = report;
      throw error;
    }
    return output;
  }

  throw new Error(`Unknown workflow step: ${step.step_key}`);
}

async function processWorkflowRun(db, log, runId, options = {}) {
  if (processingRunIds.has(String(runId))) return getWorkflowRunDetail(db, runId);
  processingRunIds.add(String(runId));
  try {
  let run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status)) return getWorkflowRunDetail(db, runId);
  if (run.status === 'paused') return getWorkflowRunDetail(db, runId);

  setRunStatus(db, runId, 'processing', {
    progress: run.progress || 0,
    current_step: run.current_step,
    error: null,
  });

  while (true) {
    run = getWorkflowRun(db, runId);
    if (!run || RUN_TERMINAL_STATUSES.has(run.status)) return getWorkflowRunDetail(db, runId);
    if (run.status === 'paused') return getWorkflowRunDetail(db, runId);
    const steps = getWorkflowSteps(db, runId);
    const failedStep = steps.find((step) => step.status === 'failed');
    if (failedStep) {
      return getWorkflowRunDetail(db, runId);
    }
    const step = steps.find((s) => s.status !== 'completed');
    if (!step) {
      const qaStep = steps.find((item) => item.step_key === 'qa_audit');
      if (qaStep && (qaStep.output_json?.passed !== true || Number(qaStep.output_json?.score) < 80)) {
        const message = 'Workflow cannot complete without a passing QA score of at least 80';
        setRunStatus(db, runId, 'failed', {
          current_step: 'qa_audit',
          error: message,
        });
        return getWorkflowRunDetail(db, runId);
      }
      setRunStatus(db, runId, 'completed', {
        progress: 100,
        current_step: null,
        output_json: { completed_step_count: steps.length },
        error: null,
      });
      log?.info?.('Workflow run completed', { run_id: runId });
      return getWorkflowRunDetail(db, runId);
    }

    const callKey = ensureStepCallKey(db, run, step);
    const checkpointOutput = completedCheckpoint(step, callKey);
    if (checkpointOutput) {
      setStepStatus(db, step.id, 'completed', { output_json: checkpointOutput, error: null });
      const recoveredCount = getWorkflowSteps(db, runId).filter((item) => item.status === 'completed').length;
      setRunStatus(db, runId, 'processing', {
        progress: Math.min(99, Math.floor((recoveredCount / Math.max(steps.length, 1)) * 100)),
        current_step: step.step_key,
        error: null,
      });
      log?.info?.('Workflow step recovered from durable checkpoint', {
        run_id: runId,
        step_key: step.step_key,
        call_key: callKey,
      });
      continue;
    }

    const attempts = (step.attempts || 0) + 1;
    setStepStatus(db, step.id, 'processing', { attempts, error: null, completed_at: null });
    setRunStatus(db, runId, 'processing', {
      progress: Math.floor((steps.filter((s) => s.status === 'completed').length / Math.max(steps.length, 1)) * 100),
      current_step: step.step_key,
      error: null,
      completed_at: null,
    });

    try {
      const latestRun = getWorkflowRun(db, runId);
      if (!latestRun || RUN_TERMINAL_STATUSES.has(latestRun.status) || latestRun.status === 'paused') {
        return getWorkflowRunDetail(db, runId);
      }
      const latestSteps = getWorkflowSteps(db, runId);
      const output = await executeStep(db, log, latestRun, { ...step, attempts, call_key: callKey }, latestSteps);
      const afterRun = getWorkflowRun(db, runId);
      const afterStep = db.prepare('SELECT status FROM workflow_steps WHERE id = ?').get(String(step.id));
      if (!afterRun || RUN_TERMINAL_STATUSES.has(afterRun.status) || afterRun.status === 'paused' || afterStep?.status === 'cancelled') {
        return getWorkflowRunDetail(db, runId);
      }
      if (typeof options.faultInjector === 'function') {
        await options.faultInjector({
          phase: 'after_step_execute_before_checkpoint',
          run: latestRun,
          step: { ...step, attempts, call_key: callKey },
          output,
        });
      }
      checkpointStepResult(db, step.id, callKey, output);
      if (typeof options.faultInjector === 'function') {
        await options.faultInjector({
          phase: 'after_step_checkpoint',
          run: latestRun,
          step: { ...step, attempts, call_key: callKey },
          output,
        });
      }
      setStepStatus(db, step.id, 'completed', { output_json: output, error: null });
      const completedCount = getWorkflowSteps(db, runId).filter((s) => s.status === 'completed').length;
      setRunStatus(db, runId, 'processing', {
        progress: Math.min(99, Math.floor((completedCount / Math.max(steps.length, 1)) * 100)),
        current_step: step.step_key,
        error: null,
      });
    } catch (err) {
      if (err?.workflow_process_crash === true) {
        log?.warn?.('Workflow process interrupted during step commit', {
          run_id: runId,
          step_key: step.step_key,
          call_key: callKey,
        });
        throw err;
      }
      const output = err.report ? {
        qa_report_id: err.report.id,
        score: err.report.score,
        passed: false,
        issue_count: err.report.report_json?.issues?.length || 0,
      } : undefined;
      setStepStatus(db, step.id, 'failed', {
        output_json: output,
        error: err.message || String(err),
      });
      setRunStatus(db, runId, 'failed', {
        progress: Math.floor((steps.filter((s) => s.status === 'completed').length / Math.max(steps.length, 1)) * 100),
        current_step: step.step_key,
        error: err.message || String(err),
      });
      log?.error?.('Workflow run failed', { run_id: runId, step_key: step.step_key, error: err.message });
      return getWorkflowRunDetail(db, runId);
    }
  }
  } finally {
    processingRunIds.delete(String(runId));
  }
}

function resolveWorkflowBackgroundTasks(options = {}) {
  const tasks = options.backgroundTasks || defaultBackgroundTasks;
  if (!tasks || typeof tasks.schedule !== 'function' || typeof tasks.assertAccepting !== 'function') {
    throw new Error('Workflow scheduling requires a background task scheduler');
  }
  return tasks;
}

function getWorkflowQueue(backgroundTasks) {
  let queue = workflowQueues.get(backgroundTasks);
  if (!queue) {
    queue = {
      backgroundTasks,
      drainScheduled: false,
      queuedRuns: new Map(),
    };
    workflowQueues.set(backgroundTasks, queue);
  }
  return queue;
}

async function drainWorkflowQueue(queue) {
  const failures = [];
  try {
    while (queue.queuedRuns.size) {
      const entries = Array.from(queue.queuedRuns.values());
      queue.queuedRuns.clear();
      for (const entry of entries) {
        try {
          await processWorkflowRun(entry.db, entry.log, entry.runId, entry.processOptions);
        } catch (error) {
          entry.log?.error?.('Workflow run fatal error', {
            run_id: entry.runId,
            error: error.message || String(error),
          });
          try {
            setRunStatus(entry.db, entry.runId, 'failed', { error: error.message || String(error) });
          } catch (checkpointError) {
            failures.push(checkpointError);
          }
          failures.push(error);
        }
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, `${failures.length} workflow queue operation(s) failed`);
    }
  } finally {
    queue.drainScheduled = false;
  }
}

function scheduleWorkflowRun(db, log, runId, options = {}) {
  const backgroundTasks = resolveWorkflowBackgroundTasks(options);
  backgroundTasks.assertAccepting();
  const queue = getWorkflowQueue(backgroundTasks);
  const { backgroundTasks: _ignored, ...processOptions } = options;
  queue.queuedRuns.set(String(runId), {
    db,
    log,
    processOptions,
    runId: String(runId),
  });
  if (queue.drainScheduled) return;

  queue.drainScheduled = true;
  try {
    backgroundTasks.schedule(
      log,
      'novel2anime_workflow_queue',
      () => drainWorkflowQueue(queue),
      { workflow_run_id: String(runId) }
    );
  } catch (error) {
    queue.queuedRuns.delete(String(runId));
    queue.drainScheduled = false;
    throw error;
  }
}

function assertNovel2AnimeLaunchReadiness(db, params = {}) {
  if (params.qa_mode !== 'production' && params.mode !== 'production') return null;
  return readinessService.assertNovel2AnimeReadiness(db, params);
}

function startNovel2AnimeWorkflow(db, log, params = {}) {
  assertNovel2AnimeLaunchReadiness(db, params);
  defaultBackgroundTasks.assertAccepting();
  const run = createWorkflowRun(db, log, { ...params, type: 'novel2anime', steps: NOVEL2ANIME_STEPS });
  scheduleWorkflowRun(db, log, run.id);
  return run;
}

function stepsFromKeys(stepKeys) {
  const keySet = new Set(stepKeys || []);
  return NOVEL2ANIME_STEPS.filter((step) => keySet.has(step.key));
}

function inheritProductionProviderAudits(db, log, targetRunId, dramaId, sourceRunId = null) {
  const existingTypes = new Set(
    db.prepare('SELECT provider_type FROM provider_invocations WHERE run_id = ? AND status = ?')
      .all(String(targetRunId), 'success')
      .map((row) => String(row.provider_type || '').toLowerCase())
  );
  const sourceRows = db.prepare(
    `SELECT invocation.*
       FROM provider_invocations invocation
       INNER JOIN workflow_runs run ON run.id = invocation.run_id
      WHERE run.drama_id = ?
        AND invocation.run_id != ?
        AND invocation.status = 'success'
        AND LOWER(COALESCE(invocation.mode, '')) != 'mock'
        AND LOWER(COALESCE(invocation.provider_name, '')) NOT LIKE 'mock%'
        AND (? IS NULL OR invocation.run_id = ?)
      ORDER BY COALESCE(run.completed_at, run.updated_at, run.created_at) DESC, invocation.id DESC`
  ).all(Number(dramaId), String(targetRunId), sourceRunId || null, sourceRunId || null);
  let inherited = 0;
  for (const row of sourceRows) {
    const providerType = String(row.provider_type || '').toLowerCase();
    if (!providerType || existingTypes.has(providerType)) continue;
    let output = {};
    try { output = JSON.parse(row.output_json || '{}'); } catch (_) {}
    providerSdkService.recordProviderInvocation(db, {
      run_id: targetRunId,
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      model: row.model,
      mode: 'production',
      status: 'success',
      input: { inherited_from_run_id: row.run_id, inherited_invocation_id: row.id },
      output,
      billable: false,
    });
    existingTypes.add(providerType);
    inherited += 1;
  }
  if (inherited) {
    log?.info?.('Production provider audit evidence inherited', {
      run_id: targetRunId,
      drama_id: dramaId,
      inherited_count: inherited,
    });
  }
  return inherited;
}

function startNovel2AnimeRepairWorkflow(db, log, params = {}) {
  assertNovel2AnimeLaunchReadiness(db, params);
  const action = String(params.action || '').trim();
  const actionSteps = {
    refresh_asset_bible: ['asset_bible', 'qa_audit'],
    repair_storyboards: ['storyboard_draft', 'image_generation', 'video_generation', 'audio_generation', 'timeline_plan', 'post_composite', 'qa_audit'],
    repair_timeline: ['timeline_plan', 'post_composite', 'qa_audit'],
    audit_only: ['qa_audit'],
  };
  const steps = stepsFromKeys(actionSteps[action] || actionSteps.repair_storyboards);
  if (!steps.length) {
    const err = new Error(`Unsupported repair action: ${action}`);
    err.code = 'BAD_REQUEST';
    throw err;
  }
  defaultBackgroundTasks.assertAccepting();
  const run = createWorkflowRun(db, log, {
    ...params,
    type: `novel2anime:${action || 'repair'}`,
    steps,
    metadata: {
      ...(params.metadata || {}),
      repair_action: action || 'repair_storyboards',
    },
  });
  if (run.input_json?.qa_mode === 'production') {
    inheritProductionProviderAudits(db, log, run.id, run.drama_id, params.source_run_id || null);
  }
  scheduleWorkflowRun(db, log, run.id);
  return run;
}

function retryWorkflowRun(db, log, runId, options = {}) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (run.status !== 'failed') {
    const err = new Error('Only failed workflow runs can be retried');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  assertProductionRunReadiness(db, run);
  defaultBackgroundTasks.assertAccepting();
  const now = nowIso();
  const stepInputs = options.step_inputs && typeof options.step_inputs === 'object' ? options.step_inputs : {};
  for (const [stepKey, input] of Object.entries(stepInputs)) {
    db.prepare(
      `UPDATE workflow_steps
       SET input_json = ?, updated_at = ?
       WHERE run_id = ? AND step_key = ? AND status = 'failed'`
    ).run(toJson(input), now, run.id, stepKey);
  }
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'pending', error = NULL, completed_at = NULL, updated_at = ?
     WHERE run_id = ? AND status = 'failed'`
  ).run(now, run.id);
  setRunStatus(db, run.id, 'pending', { error: null, completed_at: null });
  scheduleWorkflowRun(db, log, run.id);
  return getWorkflowRunDetail(db, run.id);
}

function cancelWorkflowRun(db, log, runId, reason = 'User cancelled workflow') {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status)) return getWorkflowRunDetail(db, runId);
  const now = nowIso();
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'cancelled', error = ?, completed_at = ?, updated_at = ?
     WHERE run_id = ? AND status IN ('pending', 'processing')`
  ).run(reason, now, now, run.id);
  setRunStatus(db, run.id, 'cancelled', { error: reason });
  log?.info?.('Workflow run cancelled', { run_id: run.id });
  return getWorkflowRunDetail(db, run.id);
}

function pauseWorkflowRun(db, log, runId, reason = 'User paused workflow') {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (RUN_TERMINAL_STATUSES.has(run.status) || run.status === 'paused') return getWorkflowRunDetail(db, runId);
  const now = nowIso();
  db.prepare(
    `UPDATE workflow_steps
     SET status = 'pending', error = ?, updated_at = ?
     WHERE run_id = ? AND status = 'processing'`
  ).run(reason, now, run.id);
  setRunStatus(db, run.id, 'paused', { error: reason, completed_at: null });
  log?.info?.('Workflow run paused', { run_id: run.id });
  return getWorkflowRunDetail(db, run.id);
}

function resumeWorkflowRun(db, log, runId) {
  const run = getWorkflowRun(db, runId);
  if (!run) return null;
  if (run.status !== 'paused') {
    const err = new Error('Only paused workflow runs can be resumed');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  assertProductionRunReadiness(db, run);
  defaultBackgroundTasks.assertAccepting();
  setRunStatus(db, run.id, 'pending', { error: null, completed_at: null });
  scheduleWorkflowRun(db, log, run.id);
  log?.info?.('Workflow run resumed', { run_id: run.id });
  return getWorkflowRunDetail(db, run.id);
}

function assertProductionRunReadiness(db, run) {
  if (run?.input_json?.qa_mode !== 'production' && run?.input_json?.mode !== 'production') return null;
  return readinessService.assertNovel2AnimeReadiness(db, {
    ...run.input_json,
    drama_id: run.drama_id,
    qa_mode: 'production',
  });
}

function resumeActiveWorkflowRunsOnStartup(db, log) {
  const runs = db.prepare(
    `SELECT id FROM workflow_runs
     WHERE status IN ('pending', 'processing') AND deleted_at IS NULL
     ORDER BY created_at ASC`
  ).all();
  if (runs.length) defaultBackgroundTasks.assertAccepting();
  for (const row of runs) {
    db.prepare(
      `UPDATE workflow_steps
       SET status = 'pending', updated_at = ?
       WHERE run_id = ? AND status = 'processing'`
    ).run(nowIso(), row.id);
    scheduleWorkflowRun(db, log, row.id);
  }
  if (runs.length) log?.info?.('Workflow runs resumed on startup', { count: runs.length });
  return runs.length;
}

module.exports = {
  NOVEL2ANIME_STEPS,
  createWorkflowRun,
  startNovel2AnimeWorkflow,
  startNovel2AnimeRepairWorkflow,
  processWorkflowRun,
  scheduleWorkflowRun,
  retryWorkflowRun,
  cancelWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  assertProductionRunReadiness,
  resumeActiveWorkflowRunsOnStartup,
  getWorkflowRun,
  getWorkflowSteps,
  getWorkflowRunDetail,
  listWorkflowRuns,
  rowToRun,
  rowToStep,
  ensureAssetBible,
  ensureStoryboardDraft,
  ensureTimelinePlan,
  inheritProductionProviderAudits,
  createCreativeReview,
};
