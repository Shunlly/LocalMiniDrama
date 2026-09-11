// 协议探测、模型列表规范化、错误装配与生产生成见 providerSdkProtocol.js / providerSdkModels.js / providerSdkErrors.js / providerSdkProduction.js
const aiConfigService = require('./aiConfigService');
const dramaService = require('./dramaService');
const { toUserFacingProcessError } = require('./providerErrorSanitizer');
const { isProductionMode } = require('./providerSdkProtocol');
const { getActiveTtsConfig } = require('./providerSdkModels');
const { assembleProductionFailure } = require('./providerSdkErrors');
const {
  recordProviderInvocation,
  nowIso,
  getStoryboards,
  providerCallKey,
  parseJsonObject,
  latestMergeId,
  persistOwnedCompositorMerge,
  stageCurrentCompositorMerge,
  assertProductionReadiness,
  generateAssetBibleImagesProduction: generateAssetBibleImagesProductionImpl,
  generateStoryboardImagesProduction,
  generateStoryboardVideosProduction,
  generateStoryboardAudioProduction,
  compositeEpisodesProduction,
  buildProductionTimelineCompositePlan,
} = require('./providerSdkProduction');

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
  dramaService.assertDramaWritable(db, params.drama_id);
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let created = 0;
  let reused = 0;

  for (const sb of storyboards) {
    dramaService.assertDramaWritable(db, params.drama_id);
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
  dramaService.assertDramaWritable(db, params.drama_id);
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let created = 0;
  let reused = 0;

  for (const sb of storyboards) {
    dramaService.assertDramaWritable(db, params.drama_id);
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
  dramaService.assertDramaWritable(db, params.drama_id);
  const storyboards = getStoryboards(db, params.drama_id);
  const now = nowIso();
  let updated = 0;

  for (const sb of storyboards) {
    dramaService.assertDramaWritable(db, params.drama_id);
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

function compositeEpisodesMock(db, log, params) {
  const compose = db.transaction(() => {
  dramaService.assertDramaWritable(db, params.drama_id);
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

// 入口模块保留 fail-closed 模型解析调用形态，供运行时策略扫描锁定。
function configuredModel(config, preferred, fallback) {
  return aiConfigService.resolveConfiguredModel(config, preferred, fallback);
}

// 入口模块保留失败收口调用形态，供用户可见错误扫描锁定。
async function generateAssetBibleImagesProduction(db, log, params) {
  try {
    return await generateAssetBibleImagesProductionImpl(db, log, params);
  } catch (error) {
    const message = toUserFacingProcessError(error, '素材图生成失败，请检查图片服务配置后重试');
    if (message === error.message) throw error;
    throw assembleProductionFailure(
      '素材图生成失败',
      error,
      '请检查图片服务配置后重试',
    );
  }
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
