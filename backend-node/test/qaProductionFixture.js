const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');

function createProductionQaFixture(t, options = {}) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  if (t?.after) t.after(() => db.close());
  const now = new Date().toISOString();
  const runId = options.runId || 'qa-production-run';

  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'QA Production', 'Production QA fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  const source = db.prepare(
    `INSERT INTO story_sources (drama_id, source_type, title, content_hash, metadata, created_at)
     VALUES (1, 'storyboard', 'QA source', 'qa-source-hash', '{}', ?)`
  ).run(now);
  const sourceId = Number(source.lastInsertRowid);
  const sourceItem = db.prepare(
    `INSERT INTO source_items (source_id, item_type, item_no, title, raw_text, summary, status, created_at, updated_at)
     VALUES (?, 'storyboard', 1, 'Gate', 'Aria enters the Gate.', 'Aria enters the Gate.', 'ready', ?, ?)`
  ).run(sourceId, now, now);
  db.prepare(
    `INSERT INTO story_events
     (drama_id, source_item_id, event_no, title, detail, characters, location, tension, hook_score, created_at)
     VALUES (1, ?, 1, 'Gate', 'Aria enters the Gate.', '["Aria"]', 'Gate', 2, 2, ?)`
  ).run(Number(sourceItem.lastInsertRowid), now);
  db.prepare(
    `INSERT INTO adaptation_plans
     (drama_id, source_id, target_episode_count, style, plan_json, status, created_at, updated_at)
     VALUES (1, ?, 1, 'anime', ?, 'applied', ?, ?)`
  ).run(sourceId, JSON.stringify({ episodes: [{ episode_number: 1, beat_summary: 'Aria enters the Gate.' }] }), now, now);

  const episode = db.prepare(
    `INSERT INTO episodes
     (drama_id, episode_number, title, script_content, video_url, status, created_at, updated_at)
     VALUES (1, 1, 'Episode 1', 'Aria enters the Gate.', 'videos/merged.mp4', 'qa_pending', ?, ?)`
  ).run(now, now);
  const episodeId = Number(episode.lastInsertRowid);
  const character = db.prepare(
    `INSERT INTO characters
     (drama_id, name, role, description, appearance, image_url, local_path, identity_anchors, stages, sort_order, created_at, updated_at)
     VALUES (1, 'Aria', 'main', 'Lead', 'Red coat', '/static/characters/aria.png', 'characters/aria.png', ?, ?, 0, ?, ?)`
  ).run(
    JSON.stringify({ locked_name: 'Aria', reference_asset: 'characters/aria.png' }),
    JSON.stringify([{ version: 'v1', reference_asset: 'characters/aria.png' }]),
    now,
    now
  );
  const characterId = Number(character.lastInsertRowid);
  const scene = db.prepare(
    `INSERT INTO scenes
     (drama_id, location, time, prompt, image_url, local_path, status, created_at, updated_at)
     VALUES (1, 'Gate', 'day', 'Stone gate', '/static/scenes/gate.png', 'scenes/gate.png', 'generated', ?, ?)`
  ).run(now, now);
  const sceneId = Number(scene.lastInsertRowid);
  const storyboard = db.prepare(
    `INSERT INTO storyboards
     (episode_id, scene_id, storyboard_number, title, description, layout_description, location, time, duration,
      dialogue, narration, action, atmosphere, image_prompt, video_prompt, characters, shot_type, angle, movement,
      image_url, local_path, video_url, video_local_path, audio_local_path, status, created_at, updated_at)
     VALUES (?, ?, 1, 'Gate arrival', 'Aria enters frame', 'Wide composition at the gate', 'Gate', 'day', 5,
      '', 'Aria enters the Gate.', 'Aria walks forward', 'tense', 'Aria at a stone gate',
      'Slow push toward Aria at the gate', ?, 'wide', 'eye_level', 'slow push in',
      '/static/images/shot.png', 'images/shot.png', '/static/videos/shot.mp4', 'videos/shot.mp4',
      'audio/shot.mp3', 'media_ready', ?, ?)`
  ).run(episodeId, sceneId, JSON.stringify([{ id: characterId, name: 'Aria' }]), now, now);
  const storyboardId = Number(storyboard.lastInsertRowid);

  db.prepare(
    `INSERT INTO image_generations
     (storyboard_id, drama_id, character_id, provider, prompt, model, frame_type, image_url, local_path, status, completed_at, created_at, updated_at)
     VALUES (?, 1, ?, 'real-image', 'prompt', 'image-model', 'storyboard_first', '/static/images/shot.png', 'images/shot.png', 'completed', ?, ?, ?)`
  ).run(storyboardId, characterId, now, now, now);
  db.prepare(
    `INSERT INTO video_generations
     (drama_id, storyboard_id, provider, prompt, model, video_url, local_path, status, completed_at, created_at, updated_at)
     VALUES (1, ?, 'real-video', 'prompt', 'video-model', '/static/videos/shot.mp4', 'videos/shot.mp4', 'completed', ?, ?, ?)`
  ).run(storyboardId, now, now, now);
  const merge = db.prepare(
    `INSERT INTO video_merges
     (episode_id, drama_id, title, provider, model, status, scenes, merge_options, merged_url, duration, created_at)
     VALUES (?, 1, 'Episode 1', 'ffmpeg', 'ffmpeg', 'qa_pending', '[]', '{"defer_qa_completion":true}', 'videos/merged.mp4', 5, ?)`
  ).run(episodeId, now);
  const mergeId = Number(merge.lastInsertRowid);

  const tracks = {};
  const trackDefinitions = [
    ['video', 'Video', 10, 'ready', { optional: false }],
    ['subtitle', 'Subtitles', 20, 'ready', { optional: false }],
    ['voice', 'Voice', 30, 'ready', { optional: false }],
    ['dialogue', 'Dialogue', 35, 'pending', { optional: false }],
    ['effect', 'Effects', 40, 'unused', { optional: true, usage: 'unused' }],
    ['bgm', 'BGM', 50, 'unused', { optional: true, usage: 'unused' }],
    ['transition', 'Transitions', 60, 'unused', { optional: true, usage: 'unused' }],
  ];
  for (const [type, name, order, status, metadata] of trackDefinitions) {
    const result = db.prepare(
      `INSERT INTO timeline_tracks (episode_id, type, name, sort_order, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(episodeId, type, name, order, status, JSON.stringify(metadata), now, now);
    tracks[type] = Number(result.lastInsertRowid);
  }
  const insertItem = db.prepare(
    `INSERT INTO timeline_items
     (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, 0, 5, ?, ?, ?, ?)`
  );
  insertItem.run(tracks.video, storyboardId, 'videos/shot.mp4', '{"production":true}', now, now);
  insertItem.run(tracks.subtitle, storyboardId, 'Aria enters the Gate.', '{"production":true}', now, now);
  insertItem.run(tracks.voice, storyboardId, 'audio/shot.mp3', '{"production":true}', now, now);

  db.prepare(
    `INSERT INTO workflow_runs
     (id, drama_id, type, status, progress, current_step, input_json, output_json, started_at, created_at, updated_at)
     VALUES (?, 1, 'novel2anime', 'processing', 90, 'qa_audit', '{"qa_mode":"production"}', '{}', ?, ?, ?)`
  ).run(runId, now, now, now);
  const qaStepId = `${runId}:qa`;
  db.prepare(
    `INSERT INTO workflow_steps
     (id, run_id, step_key, status, attempts, input_json, output_json, sort_order, started_at, created_at, updated_at)
     VALUES (?, ?, 'qa_audit', 'processing', 0, ?, '{}', 0, ?, ?, ?)`
  ).run(qaStepId, runId, JSON.stringify({ _workflow_call_key: `workflow:${runId}:step:qa_audit:v1` }), now, now, now);

  const providerOutputs = {
    text: { response_text: '{"approved":true}', response_sha256: 'a'.repeat(64) },
    asset_image: { local_path: 'characters/aria.png' },
    image: { local_path: 'images/shot.png' },
    video: { local_path: 'videos/shot.mp4' },
    tts: { audio_local_path: 'audio/shot.mp3' },
    compositor: { merged_url: 'videos/merged.mp4' },
  };
  for (const [providerType, output] of Object.entries(providerOutputs)) {
    db.prepare(
      `INSERT INTO provider_invocations
       (workflow_step_id, run_id, provider_type, provider_name, model, mode, input_hash, output_json, status, cost_estimate, created_at)
       VALUES (?, ?, ?, 'real-provider', 'model', 'production', ?, ?, 'success', 0, ?)`
    ).run(qaStepId, runId, providerType, `${providerType}-input`, JSON.stringify(output), now);
  }
  for (let index = 0; index < 4; index += 1) {
    db.prepare(
      `INSERT INTO skill_invocations
       (workflow_step_id, run_id, skill_name, skill_version, template_sha256, input_hash, output_hash, status, created_at)
       VALUES (?, ?, ?, '1.0.0', ?, ?, ?, 'success', ?)`
    ).run(qaStepId, runId, `fixture-skill-${index}`, 'b'.repeat(64), `in-${index}`, `out-${index}`, now);
  }

  return {
    db,
    runId,
    qaStepId,
    episodeId,
    characterId,
    sceneId,
    storyboardId,
    mergeId,
    tracks,
  };
}

module.exports = { createProductionQaFixture };
