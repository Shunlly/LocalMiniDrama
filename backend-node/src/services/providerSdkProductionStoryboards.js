'use strict';

// 从 providerSdkProduction 拆出的分镜生产生成：分镜图、分镜视频与配音。
// 保持原语义，不是新增真实厂商接入。

const imageService = require('./imageService');
const videoService = require('./videoService');
const ttsService = require('./ttsService');
const dramaService = require('./dramaService');
const {
  isMockProvider,
  getStorageRoot,
  localMediaExists,
} = require('./providerSdkProtocol');
const { assembleProductionFailure } = require('./providerSdkErrors');

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

async function generateStoryboardImagesProduction(db, log, params) {
  dramaService.assertDramaWritable(db, params.drama_id);
  const readiness = assertProductionReadiness(db, params);
  const config = readiness.imageConfig;
  const provider = config.provider || params.image_provider || 'openai';
  const model = configuredModel(config, params.image_model, 'image');
  let created = 0;
  let reused = 0;

  for (const storyboard of readiness.storyboards) {
    dramaService.assertDramaWritable(db, params.drama_id);
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
      dramaService.assertDramaWritable(db, params.drama_id);
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
      throw assembleProductionFailure(`分镜 ${storyboard.id} 的图片生成失败`, error, '请检查图片服务配置后重试');
    }
  }
  return { storyboard_count: readiness.storyboards.length, image_created: created, image_reused: reused, mode: 'production' };
}

async function generateStoryboardVideosProduction(db, log, params) {
  dramaService.assertDramaWritable(db, params.drama_id);
  const readiness = assertProductionReadiness(db, params);
  const config = readiness.videoConfig;
  const provider = config.provider || params.video_provider || 'openai';
  const model = configuredModel(config, params.video_model, 'video');
  let created = 0;
  let reused = 0;

  for (const storyboard of readiness.storyboards) {
    dramaService.assertDramaWritable(db, params.drama_id);
    let video = findReusableVideo(db, storyboard.id);
    const wasReused = Boolean(video);
    try {
      if (video) {
        reused += 1;
      } else {
        const image = findReusableImage(db, storyboard.id);
        if (!image) throw new Error('没有可用的本地分镜图，请先完成分镜图生成并确认已保存到本地');
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
      dramaService.assertDramaWritable(db, params.drama_id);
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
      throw assembleProductionFailure(`分镜 ${storyboard.id} 的视频生成失败`, error, '请检查视频服务配置后重试');
    }
  }
  return { storyboard_count: readiness.storyboards.length, video_created: created, video_reused: reused, mode: 'production' };
}

async function generateStoryboardAudioProduction(db, log, params) {
  dramaService.assertDramaWritable(db, params.drama_id);
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
    dramaService.assertDramaWritable(db, params.drama_id);
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
        throw new Error('TTS 音频未保存到本地，请重新生成配音后再继续');
      }
      dramaService.assertDramaWritable(db, params.drama_id);
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
      throw assembleProductionFailure(`分镜 ${storyboard.id} 的配音生成失败`, error, '请检查配音服务配置后重试');
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

module.exports = {
  generateStoryboardImagesProduction,
  generateStoryboardVideosProduction,
  generateStoryboardAudioProduction,
};

const {
  assertProductionReadiness,
  configuredModel,
  nowIso,
  recordProviderInvocation,
  recordFailedInvocation,
  providerCallKey,
} = require('./providerSdkProduction');
