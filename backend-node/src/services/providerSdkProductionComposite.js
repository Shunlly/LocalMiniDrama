'use strict';

// 从 providerSdkProduction 拆出的成片合成：按时间线计划严格合成整集。
// 保持原语义，不是新增真实厂商接入。

const path = require('path');
const videoMergeService = require('./videoMergeService');
const dramaService = require('./dramaService');
const ffmpegPath = require('../utils/ffmpegPath');
const {
  isMockProvider,
  localMediaExists,
} = require('./providerSdkProtocol');
const { assembleProductionFailure } = require('./providerSdkErrors');
const { buildProductionTimelineCompositePlan } = require('./providerSdkProductionTimeline');

async function compositeEpisodesProduction(db, log, params) {
  dramaService.assertDramaWritable(db, params.drama_id);
  assertProductionReadiness(db, params);
  const episodes = db.prepare(
    `SELECT id, episode_number, title FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL ORDER BY episode_number ASC, id ASC`
  ).all(Number(params.drama_id));
  let created = 0;
  let reused = 0;

  for (const episode of episodes) {
    dramaService.assertDramaWritable(db, params.drama_id);
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
      model: currentMerge.model || path.basename(ffmpegPath.getFfmpegPath()),
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
              model: merge.model || path.basename(ffmpegPath.getFfmpegPath()),
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
          throw new Error('该集缺少一个或多个已落盘的视频片段，请先完成分镜视频生成');
        }
        const createdMerge = videoMergeService.create(db, log, {
          episode_id: episode.id,
          drama_id: params.drama_id,
          title: episode.title || `Episode ${episode.episode_number}`,
          provider: 'ffmpeg',
          model: path.basename(ffmpegPath.getFfmpegPath()),
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
          throw new Error(merge?.error_msg || '严格模式视频合成未完成，请检查分镜视频与时间线后重试');
        }
        recordCompositeEvidence(merge);
        created += 1;
      }
    } catch (error) {
      recordFailedInvocation(db, params, 'compositor', 'ffmpeg', path.basename(ffmpegPath.getFfmpegPath()));
      log?.error?.('Production episode composite failed', {
        episode_id: episode.id,
        error_type: error?.name || 'Error',
      });
      throw assembleProductionFailure(`第 ${episode.id} 集整集合成失败`, error, '请检查视频合成环境后重试');
    }
  }
  return { episode_count: episodes.length, composite_created: created, composite_reused: reused, mode: 'production' };
}

module.exports = {
  compositeEpisodesProduction,
};

const {
  assertProductionReadiness,
  latestMergeId,
  persistOwnedCompositorMerge,
  stageCurrentCompositorMerge,
  parseJsonObject,
  nowIso,
  recordProviderInvocation,
  recordFailedInvocation,
  providerCallKey,
} = require('./providerSdkProduction');
