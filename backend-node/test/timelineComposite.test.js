const test = require('node:test');
const assert = require('node:assert/strict');

const providerSdkService = require('../src/services/providerSdkService');
const { createProductionQaFixture } = require('./qaProductionFixture');

function insertSecondStoryboard(fixture) {
  const now = new Date().toISOString();
  const storyboard = fixture.db.prepare(
    `INSERT INTO storyboards
     (episode_id, scene_id, storyboard_number, title, duration, dialogue, narration, action,
      image_prompt, video_prompt, movement, video_url, video_local_path, audio_local_path,
      status, created_at, updated_at)
     VALUES (?, ?, 2, 'Second shot', 4, '', 'Second narration', 'Second action',
      'Second image prompt', 'Second video prompt', 'pan right',
      '/static/videos/second.mp4', 'videos/second.mp4', 'audio/second.mp3',
      'media_ready', ?, ?)`
  ).run(fixture.episodeId, fixture.sceneId, now, now);
  const storyboardId = Number(storyboard.lastInsertRowid);
  const insertItem = fixture.db.prepare(
    `INSERT INTO timeline_items
     (track_id, storyboard_id, start_sec, end_sec, source_path, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const video = insertItem.run(
    fixture.tracks.video,
    storyboardId,
    5,
    9,
    'videos/second.mp4',
    JSON.stringify({ kind: 'video', production: true }),
    now,
    now
  );
  insertItem.run(
    fixture.tracks.subtitle,
    storyboardId,
    5,
    9,
    'Second narration',
    JSON.stringify({ kind: 'subtitle', production: true }),
    now,
    now
  );
  insertItem.run(
    fixture.tracks.voice,
    storyboardId,
    5,
    9,
    'audio/second.mp3',
    JSON.stringify({ kind: 'voice', production: true }),
    now,
    now
  );
  return { storyboardId, videoItemId: Number(video.lastInsertRowid) };
}

function getOnlyItemId(db, trackId, storyboardId) {
  return Number(db.prepare(
    'SELECT id FROM timeline_items WHERE track_id = ? AND storyboard_id = ?'
  ).get(trackId, storyboardId).id);
}

test('production compositor derives scene order and filter durations from the video timeline', (t) => {
  const fixture = createProductionQaFixture(t);
  const second = insertSecondStoryboard(fixture);
  const firstVideoItemId = getOnlyItemId(fixture.db, fixture.tracks.video, fixture.storyboardId);

  const initial = providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId);
  assert.deepEqual(initial.scenes.map((scene) => scene.storyboard_id), [fixture.storyboardId, second.storyboardId]);
  assert.deepEqual(initial.scenes.map((scene) => scene.source_path), ['videos/shot.mp4', 'videos/second.mp4']);
  assert.deepEqual(initial.scenes.map((scene) => scene.duration), [5, 4]);
  assert.match(initial.timeline_plan_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    initial.filter_plan.map((item) => item.video_filter),
    [
      'trim=duration=5.000000,setpts=PTS-STARTPTS',
      'trim=duration=4.000000,setpts=PTS-STARTPTS',
    ]
  );

  fixture.db.prepare('UPDATE timeline_items SET end_sec = 3 WHERE id = ?').run(firstVideoItemId);
  fixture.db.prepare('UPDATE timeline_items SET start_sec = 3, end_sec = 9 WHERE id = ?').run(second.videoItemId);
  const resized = providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId);
  assert.deepEqual(resized.scenes.map((scene) => scene.duration), [3, 6]);
  assert.notDeepEqual(resized.scenes, initial.scenes);
  assert.notDeepEqual(resized.filter_plan, initial.filter_plan);
  assert.notEqual(resized.timeline_plan_hash, initial.timeline_plan_hash);

  fixture.db.prepare('UPDATE timeline_items SET start_sec = 6, end_sec = 9 WHERE id = ?').run(firstVideoItemId);
  fixture.db.prepare('UPDATE timeline_items SET start_sec = 0, end_sec = 6 WHERE id = ?').run(second.videoItemId);
  const reordered = providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId);
  assert.deepEqual(reordered.scenes.map((scene) => scene.storyboard_id), [second.storyboardId, fixture.storyboardId]);
  assert.deepEqual(reordered.scenes.map((scene) => scene.source_path), ['videos/second.mp4', 'videos/shot.mp4']);
  assert.deepEqual(reordered.scenes.map((scene) => scene.duration), [6, 3]);
  assert.notDeepEqual(reordered.filter_plan, resized.filter_plan);
  assert.notEqual(reordered.timeline_plan_hash, resized.timeline_plan_hash);

  fixture.db.prepare(
    'UPDATE timeline_items SET source_path = ? WHERE track_id = ? AND storyboard_id = ?'
  ).run('Revised subtitle from the timeline', fixture.tracks.subtitle, fixture.storyboardId);
  const subtitleRevised = providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId);
  assert.deepEqual(subtitleRevised.scenes, reordered.scenes);
  assert.deepEqual(subtitleRevised.filter_plan, reordered.filter_plan);
  assert.notEqual(subtitleRevised.timeline_plan_hash, reordered.timeline_plan_hash);

  for (const type of ['effect', 'bgm', 'transition']) {
    const track = subtitleRevised.timeline_plan.tracks.find((item) => item.type === type);
    assert.equal(track.status, 'unused');
    assert.equal(track.metadata.optional, true);
    assert.equal(track.metadata.usage, 'unused');
    assert.deepEqual(track.items, []);
  }
});

test('production compositor rejects an episode without a valid subtitle timeline item', (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('DELETE FROM timeline_items WHERE track_id = ?').run(fixture.tracks.subtitle);

  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /subtitle timeline is incomplete/.test(error.message)
  );
});

test('production compositor rejects an episode without voice or dialogue media', (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('DELETE FROM timeline_items WHERE track_id IN (?, ?)')
    .run(fixture.tracks.voice, fixture.tracks.dialogue);

  assert.throws(
    () => providerSdkService.buildProductionTimelineCompositePlan(fixture.db, fixture.episodeId),
    (error) => error.code === 'PRODUCTION_TIMELINE_INVALID' && /requires voice or dialogue/.test(error.message)
  );
});
