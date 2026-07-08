const crypto = require('crypto');

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
  const info = db.prepare(
    `INSERT INTO provider_invocations
     (workflow_step_id, run_id, provider_type, provider_name, model, mode, input_hash, output_json, status, cost_estimate, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.workflow_step_id || null,
    params.run_id || null,
    params.provider_type,
    params.provider_name || 'mock',
    params.model || null,
    params.mode || 'mock',
    hashJson(params.input || {}),
    toJson(output),
    params.status || 'success',
    Number(params.cost_estimate) || 0,
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

function generateStoryboardImages(db, log, params) {
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
      input: { storyboard_id: sb.id, prompt: sb.image_prompt },
      output: { image_url: imageUrl },
    });
    created += 1;
  }

  log?.info?.('Mock storyboard images prepared', { drama_id: params.drama_id, created, reused });
  return { storyboard_count: storyboards.length, image_created: created, image_reused: reused };
}

function generateStoryboardVideos(db, log, params) {
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
    db.prepare('UPDATE storyboards SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(videoUrl, 'media_ready', now, sb.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'video',
      provider_name: 'mock',
      model: 'mock-video-v1',
      mode: 'mock',
      input: { storyboard_id: sb.id, prompt: sb.video_prompt, image_url: image?.image_url || sb.image_url },
      output: { video_url: videoUrl },
    });
    created += 1;
  }

  log?.info?.('Mock storyboard videos prepared', { drama_id: params.drama_id, created, reused });
  return { storyboard_count: storyboards.length, video_created: created, video_reused: reused };
}

function generateStoryboardAudio(db, log, params) {
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
      input: { storyboard_id: sb.id, dialogue: sb.dialogue, narration: sb.narration },
      output: { audio_local_path: voicePath, narration_audio_local_path: narrationPath },
    });
    updated += 1;
  }

  log?.info?.('Mock storyboard audio prepared', { drama_id: params.drama_id, updated });
  return { storyboard_count: storyboards.length, audio_updated: updated };
}

function compositeEpisodes(db, log, params) {
  const episodes = db.prepare(
    `SELECT id, episode_number, title
       FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL
      ORDER BY episode_number ASC, id ASC`
  ).all(Number(params.drama_id));
  const now = nowIso();
  let created = 0;
  let reused = 0;

  for (const episode of episodes) {
    const existing = db.prepare(
      `SELECT id FROM video_merges
        WHERE episode_id = ? AND provider = 'mock-compositor' AND status = 'completed' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`
    ).get(episode.id);
    if (existing) {
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
    db.prepare(
      `INSERT INTO video_merges
       (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, merged_url, duration, completed_at, created_at)
       VALUES (?, ?, ?, 'mock-compositor', 'mock-compositor-v1', 'completed', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      episode.id,
      params.drama_id,
      episode.title || `Episode ${episode.episode_number}`,
      toJson(scenes),
      toJson({ workflow: 'novel2anime', mode: 'mock' }),
      `mock-merge-${episode.id}`,
      mergedUrl,
      Math.round(duration) || null,
      now,
      now
    );
    db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(mergedUrl, 'completed', now, episode.id);
    recordProviderInvocation(db, {
      workflow_step_id: params.workflow_step_id,
      run_id: params.run_id,
      provider_type: 'compositor',
      provider_name: 'mock-compositor',
      model: 'mock-compositor-v1',
      mode: 'mock',
      input: { episode_id: episode.id, scenes },
      output: { merged_url: mergedUrl, duration },
    });
    created += 1;
  }

  log?.info?.('Mock episode composites prepared', { drama_id: params.drama_id, created, reused });
  return { episode_count: episodes.length, composite_created: created, composite_reused: reused };
}

module.exports = {
  recordProviderInvocation,
  generateStoryboardImages,
  generateStoryboardVideos,
  generateStoryboardAudio,
  compositeEpisodes,
};
