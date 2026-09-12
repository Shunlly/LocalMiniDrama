'use strict';

// 从 providerSdkService 拆出的生产生成：调用记录、就绪检查，并再导出时间线计划/资产生图/分镜生成/成片合成。
// 时间线计划见 providerSdkProductionTimeline.js，资产生图见 providerSdkProductionAssets.js，
// 分镜图/视频/配音见 providerSdkProductionStoryboards.js，成片合成见 providerSdkProductionComposite.js。
// mock 与对外 generateStoryboardImages / Videos / Audio / compositeEpisodes 包装仍在 providerSdkService.js。
// 保持原语义，不是新增真实厂商接入。

const crypto = require('crypto');
const videoMergeService = require('./videoMergeService');
const taskService = require('./taskService');
const imageClient = require('./imageClient');
const videoClient = require('./videoClient');
const aiConfigService = require('./aiConfigService');
const providerCostService = require('./providerCostService');
const dramaWriteGuard = require('./dramaWriteGuard');
const ffmpegPath = require('../utils/ffmpegPath');
const { getActiveTtsConfig } = require('./providerSdkModels');
const { failedInvocationMessage } = require('./providerSdkErrors');

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
          throw new Error(`供应商调用记录刷新异常（变更行数：${refresh.changes}）`);
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
  if (!updated) throw new Error('合成任务结果未能保存，请重试整集合成');
}

function persistOwnedCompositorMerge(db, log, params) {
  const persist = db.transaction(() => {
    // episode_id 是合成结果的真实归属键，不能信任调用方单独传入的 drama_id。
    const episode = dramaWriteGuard.assertEpisodeWritable(db, params.episode_id, params.drama_id);
    const episodeId = Number(episode.id);
    const dramaId = Number(episode.drama_id);
    const task = taskService.createTask(db, log, 'video_merge', String(episodeId));
    const info = db.prepare(
      `INSERT INTO video_merges
       (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, merged_url, duration, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      episodeId,
      dramaId,
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
      episodeId,
      params.merged_url,
      params.status,
      params.now
    );
    if (episodeUpdated.changes !== 1) throw new Error('合成结果未能绑定到该集，请重试整集合成');
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
    if (episodeUpdated.changes !== 1) throw new Error('该集当前合成归属已变化，请刷新后重试整集合成');
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

function configuredModel(config, preferred, fallback) {
  return aiConfigService.resolveConfiguredModel(config, preferred, fallback);
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
  const mediaTools = ffmpegPath.validateFfmpegTools();
  const missing = [];
  if (!storyboards.length) missing.push('分镜');
  if (!assetImageConfig) missing.push('素材图供应商');
  if (!imageConfig) missing.push('分镜图供应商');
  if (!videoConfig) missing.push('视频供应商');
  if (needsTts && !ttsConfig) missing.push('配音供应商');
  if (!mediaTools.ok) missing.push('FFmpeg/FFprobe');
  if (missing.length) {
    throw new Error(`生产工作流尚未就绪，缺少：${missing.join('、')}`);
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
    error_message: failedInvocationMessage(providerType),
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

// 先导出共享辅助，供拆分模块在加载时引用；完整公开 API 在拆分模块加载完成后覆盖。
module.exports = {
  recordProviderInvocation,
  nowIso,
  getStoryboards,
  providerCallKey,
  parseJsonObject,
  latestMergeId,
  persistOwnedCompositorMerge,
  stageCurrentCompositorMerge,
  configuredModel,
  assertProductionReadiness,
  recordFailedInvocation,
};

const { buildProductionTimelineCompositePlan } = require('./providerSdkProductionTimeline');
const { generateAssetBibleImagesProduction } = require('./providerSdkProductionAssets');
const {
  generateStoryboardImagesProduction,
  generateStoryboardVideosProduction,
  generateStoryboardAudioProduction,
} = require('./providerSdkProductionStoryboards');
const { compositeEpisodesProduction } = require('./providerSdkProductionComposite');

module.exports = {
  recordProviderInvocation,
  nowIso,
  getStoryboards,
  providerCallKey,
  parseJsonObject,
  latestMergeId,
  persistOwnedCompositorMerge,
  stageCurrentCompositorMerge,
  configuredModel,
  assertProductionReadiness,
  generateAssetBibleImagesProduction,
  generateStoryboardImagesProduction,
  generateStoryboardVideosProduction,
  generateStoryboardAudioProduction,
  compositeEpisodesProduction,
  buildProductionTimelineCompositePlan,
};
