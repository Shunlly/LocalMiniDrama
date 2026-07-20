const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const imageService = require('./imageService');
const videoService = require('./videoService');
const ttsService = require('./ttsService');
const videoMergeService = require('./videoMergeService');
const taskService = require('./taskService');
const timelineService = require('./timelineService');
const imageClient = require('./imageClient');
const videoClient = require('./videoClient');
const aiConfigService = require('./aiConfigService');
const providerCostService = require('./providerCostService');
const { getFfmpegPath, validateFfmpegTools } = require('../utils/ffmpegPath');

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function hashJson(value) {
  return crypto.createHash('sha256').update(toJson(value), 'utf8').digest('hex');
}

function recordProviderInvocation(db, params) {
  const output = params.output || {};
  const createdAt = nowIso();
  const invocationInput = params.idempotency_key
    ? { ...(params.input || {}), idempotency_key: String(params.idempotency_key) }
    : (params.input || {});
  const inputHash = hashJson(invocationInput);
  const costAudit = providerCostService.resolveInvocationCostAudit(db, params);
  if (params.idempotency_key) {
    const existing = db.prepare(
      `SELECT id, output_json FROM provider_invocations
        WHERE workflow_step_id = ? AND provider_type = ? AND input_hash = ? AND status = ?
        ORDER BY id ASC LIMIT 1`
    ).get(
      params.workflow_step_id || null,
      params.provider_type,
      inputHash,
      params.status || 'success'
    );
    if (existing) {
      if (params.refresh_existing_output === true) {
        const refresh = db.prepare('UPDATE provider_invocations SET output_json = ? WHERE id = ?')
          .run(toJson(output), existing.id);
        if (refresh.changes !== 1) {
          throw new Error(`Provider invocation output refresh changed ${refresh.changes} rows`);
        }
        return { id: Number(existing.id), output, reused: true };
      }
      let existingOutput = {};
      try { existingOutput = JSON.parse(existing.output_json || '{}'); } catch (_) {}
      return { id: Number(existing.id), output: existingOutput, reused: true };
    }
  }
  const info = db.prepare(
    `INSERT INTO provider_invocations
     (workflow_step_id, run_id, provider_type, provider_name, model, mode, input_hash, output_json, status, cost_estimate, cost_kind, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.workflow_step_id || null,
    params.run_id || null,
    params.provider_type,
    params.provider_name || 'mock',
    params.model || null,
    params.mode || 'mock',
    inputHash,
    toJson(output),
    params.status || 'success',
    costAudit.cost_estimate,
    costAudit.cost_kind,
    params.error_message || null,
    createdAt
  );
  return { id: Number(info.lastInsertRowid), output };
}

function getStoryboards(db, dramaId) {
  return db.prepare(
    `SELECT sb.*, ep.drama_id, ep.episode_number
       FROM storyboards sb
       INNER JOIN episodes ep ON ep.id = sb.episode_id
      WHERE ep.drama_id = ? AND ep.deleted_at IS NULL AND sb.deleted_at IS NULL
      ORDER BY ep.episode_number ASC, sb.storyboard_number ASC, sb.id ASC`
  ).all(Number(dramaId));
}

function findCompletedImage(db, storyboardId) {
  return db.prepare(
    `SELECT * FROM image_generations
      WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
      ORDER BY completed_at DESC, id DESC LIMIT 1`
  ).get(Number(storyboardId));
}

function findCompletedVideo(db, storyboardId) {
  return db.prepare(
    `SELECT * FROM video_generations
      WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
      ORDER BY completed_at DESC, id DESC LIMIT 1`
  ).get(Number(storyboardId));
}

function generateStoryboardImagesMock(db, log, params) {
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let created = 0;
  let reused = 0;

  for (const sb of storyboards) {
    const existing = findCompletedImage(db, sb.id);
    if (existing) {
      reused += 1;
      continue;
    }
    const imageUrl = `mock://dramas/${params.drama_id}/storyboards/${sb.id}/image.png`;
    db.prepare(
      `INSERT INTO image_generations
       (storyboard_id, drama_id, episode_id, provider, prompt, model, frame_type, size, quality, image_url, local_path, status, task_id, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'mock', ?, 'mock-image-v1', 'storyboard', ?, 'draft', ?, ?, 'completed', ?, ?, ?, ?)`
    ).run(
      sb.id,
      params.drama_id,
      sb.episode_id,
      sb.image_prompt || sb.description || sb.action || '',
      params.image_size || '1024x1024',
      imageUrl,
      imageUrl,
      `mock-image-${sb.id}`,
      now,
      now,
      now
    );
    db.prepare('UPDATE storyboards SET image_url = ?, updated_at = ? WHERE id = ?').run(imageUrl, now, sb.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'image',
      provider_name: 'mock',
      model: 'mock-image-v1',
      mode: 'mock',
      idempotency_key: providerCallKey(params, 'image', 'storyboard', sb.id),
      input: { call_key: params.call_key || null, storyboard_id: sb.id, prompt: sb.image_prompt },
      output: { image_url: imageUrl },
    });
    created += 1;
  }

  log?.info?.('Mock storyboard images prepared', { drama_id: params.drama_id, created, reused });
  return { storyboard_count: storyboards.length, image_created: created, image_reused: reused };
}

function generateStoryboardVideosMock(db, log, params) {
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let created = 0;
  let reused = 0;

  for (const sb of storyboards) {
    const existing = findCompletedVideo(db, sb.id);
    if (existing) {
      reused += 1;
      continue;
    }
    const image = findCompletedImage(db, sb.id);
    const videoUrl = `mock://dramas/${params.drama_id}/storyboards/${sb.id}/video.mp4`;
    db.prepare(
      `INSERT INTO video_generations
       (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, image_url, first_frame_url, video_url, local_path, status, task_id, provider_task_id, completed_at, created_at, updated_at)
       VALUES (?, ?, 'mock', ?, 'mock-video-v1', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
    ).run(
      params.drama_id,
      sb.id,
      sb.video_prompt || sb.description || sb.action || '',
      Number(sb.duration) || 5,
      params.aspect_ratio || '16:9',
      image?.image_url || sb.image_url || null,
      image?.image_url || sb.image_url || null,
      videoUrl,
      videoUrl,
      `mock-video-${sb.id}`,
      `mock-provider-task-${sb.id}`,
      now,
      now,
      now
    );
    db.prepare('UPDATE storyboards SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(videoUrl, 'pending', now, sb.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'video',
      provider_name: 'mock',
      model: 'mock-video-v1',
      mode: 'mock',
      idempotency_key: providerCallKey(params, 'video', 'storyboard', sb.id),
      input: { call_key: params.call_key || null, storyboard_id: sb.id, prompt: sb.video_prompt, image_url: image?.image_url || sb.image_url },
      output: { video_url: videoUrl },
    });
    created += 1;
  }

  log?.info?.('Mock storyboard videos prepared', { drama_id: params.drama_id, created, reused });
  return { storyboard_count: storyboards.length, video_created: created, video_reused: reused };
}

function generateStoryboardAudioMock(db, log, params) {
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let updated = 0;

  for (const sb of storyboards) {
    const voicePath = `mock://dramas/${params.drama_id}/storyboards/${sb.id}/voice.wav`;
    const narrationPath = `mock://dramas/${params.drama_id}/storyboards/${sb.id}/narration.wav`;
    db.prepare(
      `UPDATE storyboards
          SET audio_local_path = COALESCE(audio_local_path, ?),
              narration_audio_local_path = COALESCE(narration_audio_local_path, ?),
              updated_at = ?
        WHERE id = ?`
    ).run(voicePath, narrationPath, now, sb.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'tts',
      provider_name: 'mock',
      model: 'mock-tts-v1',
      mode: 'mock',
      idempotency_key: providerCallKey(params, 'tts', 'storyboard', sb.id),
      input: { call_key: params.call_key || null, storyboard_id: sb.id, dialogue: sb.dialogue, narration: sb.narration },
      output: { audio_local_path: voicePath, narration_audio_local_path: narrationPath },
    });
    updated += 1;
  }

  log?.info?.('Mock storyboard audio prepared', { drama_id: params.drama_id, updated });
  return { storyboard_count: storyboards.length, audio_updated: updated };
}

function latestMergeId(db, episodeId) {
  const row = db.prepare(
    'SELECT id FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1'
  ).get(Number(episodeId));
  return row ? Number(row.id) : null;
}

function updateCompositorTaskResult(db, taskId, result) {
  if (!taskId) return;
  const task = taskService.getTask(db, taskId);
  if (!task) return;
  const updated = task.status === 'completed'
    ? taskService.refreshCompletedTaskResult(db, taskId, result)
    : taskService.updateTaskResult(db, taskId, result);
  if (!updated) throw new Error('Compositor task result was not persisted');
}

function persistOwnedCompositorMerge(db, log, params) {
  const persist = db.transaction(() => {
    const task = taskService.createTask(db, log, 'video_merge', String(params.episode_id));
    const info = db.prepare(
      `INSERT INTO video_merges
       (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, merged_url, duration, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      Number(params.episode_id),
      Number(params.drama_id),
      params.title ?? null,
      params.provider,
      params.model ?? null,
      params.status,
      typeof params.scenes === 'string' ? params.scenes : toJson(params.scenes || []),
      typeof params.merge_options === 'string' ? params.merge_options : toJson(params.merge_options || {}),
      task.id,
      params.merged_url,
      params.duration ?? null,
      params.status === 'completed' ? params.now : null,
      params.now
    );
    const mergeId = Number(info.lastInsertRowid);
    const episodeUpdated = videoMergeService.updateCurrentMergeEpisodeOutput(
      db,
      mergeId,
      params.episode_id,
      params.merged_url,
      params.status,
      params.now
    );
    if (episodeUpdated.changes !== 1) throw new Error('Compositor merge did not acquire episode ownership');
    updateCompositorTaskResult(db, task.id, {
      merge_id: mergeId,
      video_url: params.merged_url,
      duration: params.duration ?? null,
      mode: params.mode,
      status: params.status,
    });
    return db.prepare('SELECT * FROM video_merges WHERE id = ?').get(mergeId);
  });
  return persist();
}

function stageCurrentCompositorMerge(db, merge, status, now, mode) {
  const stage = db.transaction(() => {
    db.prepare('UPDATE video_merges SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, status === 'completed' ? now : null, merge.id);
    const episodeUpdated = videoMergeService.updateCurrentMergeEpisodeOutput(
      db,
      merge.id,
      merge.episode_id,
      merge.merged_url,
      status,
      now
    );
    if (episodeUpdated.changes !== 1) throw new Error('Compositor merge no longer owns the episode');
    updateCompositorTaskResult(db, merge.task_id, {
      merge_id: Number(merge.id),
      video_url: merge.merged_url,
      duration: merge.duration ?? null,
      mode,
      status,
    });
    return db.prepare('SELECT * FROM video_merges WHERE id = ?').get(merge.id);
  });
  return stage();
}

function compositeEpisodesMock(db, log, params) {
  const compose = db.transaction(() => {
  const episodes = db.prepare(
    `SELECT id, episode_number, title
       FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL
      ORDER BY episode_number ASC, id ASC`
  ).all(Number(params.drama_id));
  const now = nowIso();
  let created = 0;
  let reused = 0;
  const completionStatus = params.defer_qa_completion ? 'qa_pending' : 'completed';

  for (const episode of episodes) {
    const existing = db.prepare(
      `SELECT * FROM video_merges
        WHERE episode_id = ? AND provider = 'mock-compositor' AND status IN ('completed', 'qa_pending') AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`
    ).get(episode.id);
    if (existing) {
      const historical = latestMergeId(db, episode.id) !== Number(existing.id);
      const ownedMerge = historical
        ? persistOwnedCompositorMerge(db, log, {
          episode_id: episode.id,
          drama_id: params.drama_id,
          title: existing.title || episode.title || `Episode ${episode.episode_number}`,
          provider: existing.provider || 'mock-compositor',
          model: existing.model || 'mock-compositor-v1',
          status: completionStatus,
          scenes: existing.scenes,
          merge_options: {
            ...parseJsonObject(existing.merge_options),
            reused_from_merge_id: Number(existing.id),
            defer_qa_completion: !!params.defer_qa_completion,
          },
          merged_url: existing.merged_url,
          duration: existing.duration,
          mode: 'mock',
          now,
        })
        : stageCurrentCompositorMerge(db, existing, completionStatus, now, 'mock');
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'compositor',
        provider_name: 'mock-compositor',
        model: 'mock-compositor-v1',
        mode: 'mock',
        refresh_existing_output: true,
        idempotency_key: providerCallKey(params, 'compositor', 'episode', episode.id),
        input: { call_key: params.call_key || null, episode_id: episode.id, reused: true },
        output: { merge_id: ownedMerge.id, merged_url: ownedMerge.merged_url, duration: ownedMerge.duration },
      });
      reused += 1;
      continue;
    }
    const storyboards = db.prepare(
      `SELECT id, duration, video_url
         FROM storyboards
        WHERE episode_id = ? AND deleted_at IS NULL
        ORDER BY storyboard_number ASC, id ASC`
    ).all(episode.id);
    const scenes = storyboards.map((sb) => ({
      storyboard_id: sb.id,
      duration: Number(sb.duration) || 5,
      video_url: sb.video_url || `mock://dramas/${params.drama_id}/storyboards/${sb.id}/video.mp4`,
    }));
    const duration = scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
    const mergedUrl = `mock://dramas/${params.drama_id}/episodes/${episode.id}/merged.mp4`;
    const ownedMerge = persistOwnedCompositorMerge(db, log, {
      episode_id: episode.id,
      drama_id: params.drama_id,
      title: episode.title || `Episode ${episode.episode_number}`,
      provider: 'mock-compositor',
      model: 'mock-compositor-v1',
      status: completionStatus,
      scenes,
      merge_options: { workflow: 'novel2anime', mode: 'mock', defer_qa_completion: !!params.defer_qa_completion },
      merged_url: mergedUrl,
      duration: Math.round(duration) || null,
      mode: 'mock',
      now,
    });
    const mergeId = Number(ownedMerge.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'compositor',
      provider_name: 'mock-compositor',
      model: 'mock-compositor-v1',
      mode: 'mock',
      refresh_existing_output: true,
      idempotency_key: providerCallKey(params, 'compositor', 'episode', episode.id),
      input: { call_key: params.call_key || null, episode_id: episode.id, scenes },
      output: { merge_id: mergeId, merged_url: mergedUrl, duration },
    });
    created += 1;
  }

  log?.info?.('Mock episode composites prepared', { drama_id: params.drama_id, created, reused });
  return { episode_count: episodes.length, composite_created: created, composite_reused: reused };
  });
  return compose();
}

function isProductionMode(params) {
  return params?.mode === 'production' || params?.qa_mode === 'production';
}

function isMockValue(value) {
  return /^(?:mock|placeholder):\/\//i.test(String(value || '').trim());
}

function isMockProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return !provider || provider === 'mock' || provider === 'mock-compositor' || provider.startsWith('mock-');
}

function getStorageRoot() {
  const cfg = require('../config').loadConfig();
  const configured = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function resolveLocalMediaPath(value) {
  const text = String(value || '').trim();
  if (!text || isMockValue(text)) return null;
  if (path.isAbsolute(text)) return text;
  const relative = text
    .replace(/^\/?static[\\/]/i, '')
    .replace(/^[/\\]+/, '')
    .replace(/[\\/]/g, path.sep);
  const root = path.resolve(getStorageRoot());
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function localMediaExists(value) {
  const target = resolveLocalMediaPath(value);
  return !!target && fs.existsSync(target) && fs.statSync(target).isFile();
}

function configuredModel(config, preferred, fallback) {
  if (preferred) return preferred;
  const models = Array.isArray(config?.model)
    ? config.model
    : (config?.model != null ? [config.model] : []);
  return config?.default_model || models[0] || fallback;
}

function getActiveTtsConfig(db, preferredModel, preferredProvider) {
  let active = aiConfigService.listConfigs(db, 'tts').filter((config) => config.is_active);
  if (preferredProvider) {
    const normalizedProvider = String(preferredProvider).trim().toLowerCase();
    active = active.filter((config) => String(config.provider || '').trim().toLowerCase() === normalizedProvider);
  }
  if (preferredModel) {
    const selectedModel = String(preferredModel).trim();
    active = active.filter((config) => {
      const models = Array.isArray(config.model) ? config.model : [config.model];
      return [...models, config.default_model].some((model) => String(model || '').trim() === selectedModel);
    });
  }
  return active.find((config) => config.is_default) || active[0] || null;
}

function assertProductionReadiness(db, params = {}) {
  const storyboards = getStoryboards(db, params.drama_id);
  const assetImageConfig = imageClient.getDefaultImageConfig(
    db,
    params.asset_image_model,
    params.asset_image_provider,
    'image'
  );
  const imageConfig = imageClient.getDefaultImageConfig(
    db,
    params.image_model,
    params.image_provider,
    'storyboard_image'
  );
  const videoConfig = videoClient.getDefaultVideoConfig(
    db,
    params.video_model,
    params.video_provider
  );
  const needsTts = true;
  const ttsConfig = getActiveTtsConfig(db, params.tts_model, params.tts_provider);
  const mediaTools = validateFfmpegTools();
  const missing = [];
  if (!storyboards.length) missing.push('storyboards');
  if (!assetImageConfig) missing.push('asset image provider');
  if (!imageConfig) missing.push('storyboard image provider');
  if (!videoConfig) missing.push('video provider');
  if (needsTts && !ttsConfig) missing.push('TTS provider');
  if (!mediaTools.ok) missing.push('FFmpeg/FFprobe');
  if (missing.length) {
    throw new Error(`Production workflow is not ready: missing ${missing.join(', ')}`);
  }
  return {
    storyboards,
    assetImageConfig,
    imageConfig,
    videoConfig,
    ttsConfig,
    ffmpegPath: mediaTools.ffmpeg.path,
    ffprobePath: mediaTools.ffprobe.path,
    needsTts,
  };
}

function findReusableImage(db, storyboardId) {
  return db.prepare(
    `SELECT * FROM image_generations
      WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
      ORDER BY completed_at DESC, id DESC`
  ).all(Number(storyboardId)).find((row) => (
    !isMockProvider(row.provider) && localMediaExists(row.local_path)
  )) || null;
}

function findReusableVideo(db, storyboardId) {
  return db.prepare(
    `SELECT * FROM video_generations
      WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
      ORDER BY completed_at DESC, id DESC`
  ).all(Number(storyboardId)).find((row) => (
    !isMockProvider(row.provider) && localMediaExists(row.local_path)
  )) || null;
}

function recordFailedInvocation(db, params, providerType, providerName, model) {
  return recordProviderInvocation(db, {
    workflow_step_id: params.workflow_step_id,
    run_id: params.run_id,
    provider_type: providerType,
    provider_name: providerName || 'unknown',
    model: model || null,
    mode: 'production',
    status: 'failed',
    idempotency_key: params.call_key ? `${params.call_key}:${providerType}:failed` : null,
    input: { drama_id: params.drama_id, call_key: params.call_key || null },
    output: {},
    error_message: `${providerType} provider request failed`,
  });
}

function providerCallKey(params, providerType, targetType, targetId) {
  const base = params.call_key || `workflow:${params.run_id || 'unscoped'}:step:${params.workflow_step_id || providerType}`;
  return `${base}:${providerType}:${targetType}:${String(targetId)}`;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function productionCompositeError(message) {
  const error = new Error(message);
  error.code = 'PRODUCTION_TIMELINE_INVALID';
  return error;
}

function sortedTimelineItems(track) {
  return [...(track?.items || [])].sort((left, right) => (
    Number(left.start_sec) - Number(right.start_sec) ||
    Number(left.end_sec) - Number(right.end_sec) ||
    Number(left.id) - Number(right.id)
  ));
}

function hasPositiveTimelineDuration(item) {
  return Number.isFinite(Number(item?.start_sec)) &&
    Number.isFinite(Number(item?.end_sec)) &&
    Number(item.end_sec) > Number(item.start_sec);
}

function hasRealTimelineSource(item) {
  const value = String(item?.source_path || '').trim();
  return !!value && !/^(?:mock|placeholder):\/\//i.test(value);
}

function normalizedTimelineTrack(track) {
  return {
    id: Number(track.id),
    type: track.type,
    name: track.name || '',
    sort_order: Number(track.sort_order) || 0,
    status: track.status || 'pending',
    metadata: track.metadata || {},
    items: sortedTimelineItems(track).map((item) => ({
      id: Number(item.id),
      storyboard_id: item.storyboard_id == null ? null : Number(item.storyboard_id),
      start_sec: Number(item.start_sec),
      end_sec: Number(item.end_sec),
      source_path: String(item.source_path || ''),
      metadata: item.metadata || {},
    })),
  };
}

function buildProductionTimelineCompositePlan(db, episodeId) {
  const timeline = timelineService.getEpisodeTimeline(db, episodeId);
  if (!timeline) throw productionCompositeError(`Episode ${episodeId} timeline was not found`);
  const requiredTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  const byType = new Map();
  for (const type of requiredTypes) {
    const matching = timeline.tracks.filter((track) => track.type === type);
    if (matching.length !== 1) {
      throw productionCompositeError(`Episode ${episodeId} requires exactly one ${type} timeline track`);
    }
    byType.set(type, matching[0]);
  }

  const videoItems = sortedTimelineItems(byType.get('video'));
  if (videoItems.length === 0) {
    throw productionCompositeError(`Episode ${episodeId} video timeline is empty`);
  }
  const seenStoryboardIds = new Set();
  const scenes = videoItems.map((item, order) => {
    const storyboardId = Number(item.storyboard_id);
    if (!Number.isInteger(storyboardId) || storyboardId <= 0 || !item.storyboard) {
      throw productionCompositeError(`Episode ${episodeId} video item ${item.id} has no valid storyboard`);
    }
    if (seenStoryboardIds.has(storyboardId)) {
      throw productionCompositeError(`Episode ${episodeId} video timeline repeats storyboard ${storyboardId}`);
    }
    if (!hasPositiveTimelineDuration(item) || !hasRealTimelineSource(item)) {
      throw productionCompositeError(`Episode ${episodeId} video item ${item.id} is not production-ready`);
    }
    seenStoryboardIds.add(storyboardId);
    const startSec = Number(item.start_sec);
    const endSec = Number(item.end_sec);
    return {
      order,
      timeline_item_id: Number(item.id),
      storyboard_id: storyboardId,
      start_sec: startSec,
      end_sec: endSec,
      duration: Number((endSec - startSec).toFixed(6)),
      source_path: String(item.source_path),
      video_url: String(item.source_path),
    };
  });

  const subtitleItems = sortedTimelineItems(byType.get('subtitle'));
  if (subtitleItems.length === 0 || subtitleItems.some((item) => (
    !hasPositiveTimelineDuration(item) || !String(item.source_path || '').trim()
  ))) {
    throw productionCompositeError(`Episode ${episodeId} subtitle timeline is incomplete`);
  }
  const voiceItems = sortedTimelineItems(byType.get('voice'));
  const dialogueItems = sortedTimelineItems(byType.get('dialogue'));
  if ([...voiceItems, ...dialogueItems].some((item) => (
    !hasPositiveTimelineDuration(item) || !hasRealTimelineSource(item)
  ))) {
    throw productionCompositeError(`Episode ${episodeId} voice/dialogue timeline contains invalid media`);
  }
  if (voiceItems.length + dialogueItems.length === 0) {
    throw productionCompositeError(`Episode ${episodeId} requires voice or dialogue timeline media`);
  }

  for (const type of ['effect', 'bgm', 'transition']) {
    const track = byType.get(type);
    const metadata = track.metadata || {};
    const items = sortedTimelineItems(track);
    if (items.length === 0 && !(
      track.status === 'unused' && metadata.optional === true && metadata.usage === 'unused'
    )) {
      throw productionCompositeError(`Episode ${episodeId} optional ${type} track must be explicitly unused`);
    }
  }

  const timelinePlan = {
    schema: 'localminidrama.production_timeline_composite.v1',
    episode_id: Number(episodeId),
    video_track_id: Number(byType.get('video').id),
    tracks: timeline.tracks
      .filter((track) => requiredTypes.includes(track.type))
      .map(normalizedTimelineTrack),
  };
  const timelinePlanHash = hashJson(timelinePlan);
  const filterPlan = videoMergeService.buildStrictSceneFilterPlan(scenes);
  return {
    scenes,
    timeline_plan: timelinePlan,
    timeline_plan_hash: timelinePlanHash,
    filter_plan: filterPlan,
  };
}

function firstLocalAsset(row, fields) {
  for (const field of fields) {
    if (localMediaExists(row?.[field])) return row[field];
  }
  return null;
}

async function generateAssetBibleImagesProduction(db, log, params) {
  const config = imageClient.getDefaultImageConfig(
    db,
    params.asset_image_model,
    params.asset_image_provider,
    'image'
  );
  if (!config) throw new Error('Production asset image provider is unavailable');
  const provider = config.provider || params.asset_image_provider || 'openai';
  const model = configuredModel(config, params.asset_image_model, 'image');
  const targets = [
    ...db.prepare(
      'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'character', row })),
    ...db.prepare(
      'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'scene', row })),
    ...db.prepare(
      'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
    ).all(Number(params.drama_id)).map((row) => ({ type: 'prop', row })),
  ];
  let created = 0;
  let reused = 0;
  const generatedByType = { character: 0, scene: 0, prop: 0 };

  for (const target of targets) {
    const fields = target.type === 'character'
      ? ['local_path', 'image_url', 'four_view_image_url', 'seedance2_asset']
      : ['local_path', 'image_url', 'ref_image'];
    let localPath = firstLocalAsset(target.row, fields);
    const wasReused = Boolean(localPath);
    let image = null;
    const callKey = providerCallKey(params, 'asset_image', target.type, target.row.id);
    try {
      if (localPath) {
        reused += 1;
      } else {
        const prompt = target.type === 'character'
          ? target.row.appearance || target.row.description || `${target.row.name} character reference`
          : target.type === 'scene'
            ? target.row.prompt || `${target.row.location} production environment reference`
            : target.row.prompt || target.row.description || `${target.row.name} production prop reference`;
        image = await imageService.createAndProcessImage(db, log, {
          drama_id: params.drama_id,
          scene_id: target.type === 'scene' ? target.row.id : null,
          character_id: target.type === 'character' ? target.row.id : null,
          provider,
          model,
          prompt,
          frame_type: `workflow_${target.type}_reference`,
          size: params.asset_image_size || params.image_size,
          require_local: true,
          idempotency_key: callKey,
        });
        localPath = image.local_path || image.image_url;
        const now = nowIso();
        if (target.type === 'character') {
          db.prepare('UPDATE characters SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?')
            .run(image.image_url, image.local_path, now, target.row.id);
        } else if (target.type === 'scene') {
          db.prepare("UPDATE scenes SET image_url = ?, local_path = ?, status = 'generated', updated_at = ? WHERE id = ?")
            .run(image.image_url, image.local_path, now, target.row.id);
        } else {
          db.prepare('UPDATE props SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?')
            .run(image.image_url, image.local_path, now, target.row.id);
        }
        created += 1;
        generatedByType[target.type] += 1;
      }
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'asset_image',
        provider_name: image?.provider || provider,
        model: image?.model || model,
        mode: 'production',
        billable: !wasReused,
        usage: { count: wasReused ? 0 : 1 },
        idempotency_key: callKey,
        input: { call_key: callKey, asset_type: target.type, asset_id: target.row.id },
        output: {
          asset_type: target.type,
          asset_id: target.row.id,
          ...(image?.id ? { image_generation_id: image.id } : {}),
          local_path: localPath,
        },
      });
    } catch (error) {
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'asset_image',
        provider_name: provider,
        model,
        mode: 'production',
        status: 'failed',
        idempotency_key: callKey,
        input: { call_key: callKey, asset_type: target.type, asset_id: target.row.id },
        output: {},
        error_message: error.message || 'Production asset image request failed',
      });
      throw new Error(`Production asset image generation failed for ${target.type} ${target.row.id}`);
    }
  }
  return {
    mode: 'production',
    asset_count: targets.length,
    asset_created: created,
    asset_reused: reused,
    generated_by_type: generatedByType,
  };
}

async function generateStoryboardImagesProduction(db, log, params) {
  const readiness = assertProductionReadiness(db, params);
  const config = readiness.imageConfig;
  const provider = config.provider || params.image_provider || 'openai';
  const model = configuredModel(config, params.image_model, 'image');
  let created = 0;
  let reused = 0;

  for (const storyboard of readiness.storyboards) {
    let image = findReusableImage(db, storyboard.id);
    const wasReused = Boolean(image);
    try {
      if (image) {
        reused += 1;
      } else {
        image = await imageService.createAndProcessImage(db, log, {
          drama_id: params.drama_id,
          storyboard_id: storyboard.id,
          provider,
          model,
          prompt: storyboard.image_prompt || storyboard.description || storyboard.action || '',
          frame_type: 'storyboard_first',
          size: params.image_size,
          require_local: true,
          idempotency_key: providerCallKey(params, 'image', 'storyboard', storyboard.id),
        });
        created += 1;
      }
      db.prepare(
        `UPDATE storyboards
            SET image_url = ?, local_path = ?, first_frame_image_id = COALESCE(first_frame_image_id, ?), updated_at = ?
          WHERE id = ?`
      ).run(image.image_url, image.local_path, image.id, nowIso(), storyboard.id);
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'image',
        provider_name: image.provider || provider,
        model: image.model || model,
        mode: 'production',
        billable: !wasReused,
        usage: { count: wasReused ? 0 : 1 },
        idempotency_key: providerCallKey(params, 'image', 'storyboard', storyboard.id),
        input: { call_key: params.call_key || null, storyboard_id: storyboard.id },
        output: { image_generation_id: image.id, local_path: image.local_path },
      });
    } catch (error) {
      recordFailedInvocation(db, params, 'image', provider, model);
      log?.error?.('Production storyboard image failed', {
        storyboard_id: storyboard.id,
        provider,
        error_type: error?.name || 'Error',
      });
      throw new Error(`Production image generation failed for storyboard ${storyboard.id}`);
    }
  }
  return { storyboard_count: readiness.storyboards.length, image_created: created, image_reused: reused, mode: 'production' };
}

async function generateStoryboardVideosProduction(db, log, params) {
  const readiness = assertProductionReadiness(db, params);
  const config = readiness.videoConfig;
  const provider = config.provider || params.video_provider || 'openai';
  const model = configuredModel(config, params.video_model, 'video');
  let created = 0;
  let reused = 0;

  for (const storyboard of readiness.storyboards) {
    let video = findReusableVideo(db, storyboard.id);
    const wasReused = Boolean(video);
    try {
      if (video) {
        reused += 1;
      } else {
        const image = findReusableImage(db, storyboard.id);
        if (!image) throw new Error('No durable storyboard image is available');
        const firstFrame = image.local_path || image.image_url;
        video = await videoService.createAndProcessVideo(db, log, {
          drama_id: params.drama_id,
          storyboard_id: storyboard.id,
          provider,
          model,
          prompt: storyboard.video_prompt || storyboard.description || storyboard.action || '',
          duration: Number(storyboard.duration) || 5,
          aspect_ratio: params.aspect_ratio,
          resolution: params.resolution,
          image_url: firstFrame,
          first_frame_url: firstFrame,
          require_local: true,
          idempotency_key: providerCallKey(params, 'video', 'storyboard', storyboard.id),
        });
        created += 1;
      }
      db.prepare(
        `UPDATE storyboards SET video_url = ?, video_local_path = ?, status = 'media_ready', updated_at = ? WHERE id = ?`
      ).run(video.video_url, video.local_path, nowIso(), storyboard.id);
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'video',
        provider_name: video.provider || provider,
        model: video.model || model,
        mode: 'production',
        billable: !wasReused,
        usage: { duration_seconds: wasReused ? 0 : Number(storyboard.duration) || 5 },
        idempotency_key: providerCallKey(params, 'video', 'storyboard', storyboard.id),
        input: { call_key: params.call_key || null, storyboard_id: storyboard.id },
        output: { video_generation_id: video.id, local_path: video.local_path },
      });
    } catch (error) {
      recordFailedInvocation(db, params, 'video', provider, model);
      log?.error?.('Production storyboard video failed', {
        storyboard_id: storyboard.id,
        provider,
        error_type: error?.name || 'Error',
      });
      throw new Error(`Production video generation failed for storyboard ${storyboard.id}`);
    }
  }
  return { storyboard_count: readiness.storyboards.length, video_created: created, video_reused: reused, mode: 'production' };
}

async function generateStoryboardAudioProduction(db, log, params) {
  const readiness = assertProductionReadiness(db, params);
  if (!readiness.needsTts) {
    return { storyboard_count: readiness.storyboards.length, audio_created: 0, audio_reused: 0, audio_skipped: readiness.storyboards.length, mode: 'production' };
  }
  const config = readiness.ttsConfig;
  const provider = config.provider || 'openai';
  const model = configuredModel(config, params.tts_model, 'tts');
  const storageBase = getStorageRoot();
  let created = 0;
  let reused = 0;
  let skipped = 0;

  for (const storyboard of readiness.storyboards) {
    const dialogue = String(storyboard.dialogue || '').trim();
    const narration = String(storyboard.narration || '').trim();
    if (!dialogue && !narration) {
      skipped += 1;
      continue;
    }
    let dialoguePath = localMediaExists(storyboard.audio_local_path) ? storyboard.audio_local_path : null;
    let narrationPath = localMediaExists(storyboard.narration_audio_local_path) ? storyboard.narration_audio_local_path : null;
    let billableCharacters = 0;
    try {
      if (dialogue && !dialoguePath) {
        dialoguePath = (await ttsService.synthesize(db, log, {
          text: dialogue,
          storyboard_id: storyboard.id,
          config,
          storage_base: storageBase,
          idempotency_key: providerCallKey(params, 'tts', 'storyboard-dialogue', storyboard.id),
        })).local_path;
        billableCharacters += dialogue.length;
        created += 1;
      } else if (dialoguePath) {
        reused += 1;
      }
      if (narration && !narrationPath) {
        narrationPath = (await ttsService.synthesize(db, log, {
          text: narration,
          storyboard_id: storyboard.id,
          config,
          storage_base: storageBase,
          idempotency_key: providerCallKey(params, 'tts', 'storyboard-narration', storyboard.id),
        })).local_path;
        billableCharacters += narration.length;
        created += 1;
      } else if (narrationPath) {
        reused += 1;
      }
      if ((dialogue && !localMediaExists(dialoguePath)) || (narration && !localMediaExists(narrationPath))) {
        throw new Error('TTS output was not persisted locally');
      }
      db.prepare(
        `UPDATE storyboards SET audio_local_path = ?, narration_audio_local_path = ?, updated_at = ? WHERE id = ?`
      ).run(dialoguePath, narrationPath, nowIso(), storyboard.id);
      recordProviderInvocation(db, {
        workflow_step_id: params.workflow_step_id,
        run_id: params.run_id,
        provider_type: 'tts',
        provider_name: provider,
        model,
        mode: 'production',
        billable: billableCharacters > 0,
        usage: { characters: billableCharacters },
        idempotency_key: providerCallKey(params, 'tts', 'storyboard', storyboard.id),
        input: { call_key: params.call_key || null, storyboard_id: storyboard.id },
        output: {
          ...(dialoguePath ? { audio_local_path: dialoguePath } : {}),
          ...(narrationPath ? { narration_audio_local_path: narrationPath } : {}),
        },
      });
    } catch (error) {
      recordFailedInvocation(db, params, 'tts', provider, model);
      log?.error?.('Production storyboard TTS failed', {
        storyboard_id: storyboard.id,
        provider,
        error_type: error?.name || 'Error',
      });
      throw new Error(`Production TTS generation failed for storyboard ${storyboard.id}`);
    }
  }
  return {
    storyboard_count: readiness.storyboards.length,
    audio_created: created,
    audio_reused: reused,
    audio_skipped: skipped,
    mode: 'production',
  };
}

async function compositeEpisodesProduction(db, log, params) {
  assertProductionReadiness(db, params);
  const episodes = db.prepare(
    `SELECT id, episode_number, title FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC, id ASC`
  ).all(Number(params.drama_id));
  let created = 0;
  let reused = 0;

  for (const episode of episodes) {
    const compositePlan = buildProductionTimelineCompositePlan(db, episode.id);
    const scenes = compositePlan.scenes;
    let merge = db.prepare(
      `SELECT * FROM video_merges
        WHERE episode_id = ? AND status IN ('completed', 'qa_pending') AND deleted_at IS NULL
        ORDER BY completed_at DESC, id DESC`
    ).all(episode.id).find((row) => (
      !isMockProvider(row.provider) &&
      localMediaExists(row.merged_url) &&
      parseJsonObject(row.merge_options).timeline_plan_hash === compositePlan.timeline_plan_hash
    ));
    const wasReused = Boolean(merge);
    const recordCompositeEvidence = (currentMerge) => recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'compositor',
      provider_name: currentMerge.provider || 'ffmpeg',
      model: currentMerge.model || path.basename(getFfmpegPath()),
      mode: 'production',
      refresh_existing_output: true,
      billable: !wasReused,
      pricing: params.compositor_pricing,
      usage: {
        duration_seconds: wasReused
          ? 0
          : scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0),
      },
      idempotency_key: providerCallKey(params, 'compositor', 'episode', episode.id),
      input: {
        call_key: params.call_key || null,
        episode_id: episode.id,
        scene_count: scenes.length,
        timeline_plan_hash: compositePlan.timeline_plan_hash,
      },
      output: {
        merge_id: currentMerge.id,
        merged_url: currentMerge.merged_url,
        timeline_plan_hash: compositePlan.timeline_plan_hash,
        timeline_plan: compositePlan.timeline_plan,
        filter_plan: compositePlan.filter_plan,
      },
    });
    try {
      if (merge) {
        const reuse = db.transaction(() => {
          const completionStatus = params.defer_qa_completion ? 'qa_pending' : 'completed';
          const now = nowIso();
          const ownedMerge = latestMergeId(db, episode.id) !== Number(merge.id)
            ? persistOwnedCompositorMerge(db, log, {
              episode_id: episode.id,
              drama_id: params.drama_id,
              title: merge.title || episode.title || `Episode ${episode.episode_number}`,
              provider: merge.provider || 'ffmpeg',
              model: merge.model || path.basename(getFfmpegPath()),
              status: completionStatus,
              scenes: merge.scenes,
              merge_options: {
                ...parseJsonObject(merge.merge_options),
                reused_from_merge_id: Number(merge.id),
                defer_qa_completion: !!params.defer_qa_completion,
              },
              merged_url: merge.merged_url,
              duration: merge.duration,
              mode: 'strict_production',
              now,
            })
            : stageCurrentCompositorMerge(db, merge, completionStatus, now, 'strict_production');
          recordCompositeEvidence(ownedMerge);
          return ownedMerge;
        });
        merge = reuse();
        reused += 1;
      } else {
        if (!scenes.length || scenes.some((scene) => !localMediaExists(scene.video_url))) {
          throw new Error('Episode is missing one or more durable video clips');
        }
        const createdMerge = videoMergeService.create(db, log, {
          episode_id: episode.id,
          drama_id: params.drama_id,
          title: episode.title || `Episode ${episode.episode_number}`,
          provider: 'ffmpeg',
          model: path.basename(getFfmpegPath()),
          scenes,
          merge_options: {
            strict_production: true,
            defer_qa_completion: !!params.defer_qa_completion,
            burn_narration_subtitles: params.burn_narration_subtitles !== false,
            burn_dialogue_audio: params.burn_dialogue_audio !== false,
            timeline_plan_hash: compositePlan.timeline_plan_hash,
            timeline_plan: compositePlan.timeline_plan,
            filter_plan: compositePlan.filter_plan,
          },
        });
        await videoMergeService.processVideoMerge(
          db,
          log,
          createdMerge.merge_id,
          require('../config').loadConfig().storage?.base_url || ''
        );
        merge = db.prepare('SELECT * FROM video_merges WHERE id = ?').get(createdMerge.merge_id);
        const expectedStatus = params.defer_qa_completion ? 'qa_pending' : 'completed';
        if (!merge || merge.status !== expectedStatus || !localMediaExists(merge.merged_url)) {
          throw new Error(merge?.error_msg || 'Strict video merge did not complete');
        }
        recordCompositeEvidence(merge);
        created += 1;
      }
    } catch (error) {
      recordFailedInvocation(db, params, 'compositor', 'ffmpeg', path.basename(getFfmpegPath()));
      log?.error?.('Production episode composite failed', {
        episode_id: episode.id,
        error_type: error?.name || 'Error',
      });
      throw new Error(`Production episode composite failed for episode ${episode.id}`);
    }
  }
  return { episode_count: episodes.length, composite_created: created, composite_reused: reused, mode: 'production' };
}

async function generateStoryboardImages(db, log, params) {
  return isProductionMode(params)
    ? generateStoryboardImagesProduction(db, log, params)
    : generateStoryboardImagesMock(db, log, params);
}

async function generateStoryboardVideos(db, log, params) {
  return isProductionMode(params)
    ? generateStoryboardVideosProduction(db, log, params)
    : generateStoryboardVideosMock(db, log, params);
}

async function generateStoryboardAudio(db, log, params) {
  return isProductionMode(params)
    ? generateStoryboardAudioProduction(db, log, params)
    : generateStoryboardAudioMock(db, log, params);
}

async function compositeEpisodes(db, log, params) {
  return isProductionMode(params)
    ? compositeEpisodesProduction(db, log, params)
    : compositeEpisodesMock(db, log, params);
}

module.exports = {
  recordProviderInvocation,
  assertProductionReadiness,
  generateAssetBibleImagesProduction,
  generateStoryboardImages,
  generateStoryboardVideos,
  generateStoryboardAudio,
  compositeEpisodes,
  buildProductionTimelineCompositePlan,
};
