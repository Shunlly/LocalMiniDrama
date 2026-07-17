const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const qaService = require('../src/services/qaService');
const timelineService = require('../src/services/timelineService');
const timelineRoutes = require('../src/routes/timelines');
const { createProductionQaFixture } = require('./qaProductionFixture');

function evaluate(fixture) {
  return qaService.evaluateDrama(fixture.db, {
    drama_id: 1,
    run_id: fixture.runId,
    mode: 'production',
  });
}

function assertFailedBelow80(result, issueCode) {
  assert.equal(result.passed, false);
  assert.ok(result.score < 80, `expected score below 80, received ${result.score}`);
  assert.equal(result.issues.some((issue) => issue.code === issueCode), true);
}

for (const [label, update, expectedField] of [
  ['visual composition', "description = '', layout_description = '', action = ''", 'visual'],
  ['movement', "movement = ''", 'movement'],
  ['positive duration', 'duration = 0', 'duration'],
  ['subtitle or narration', "dialogue = '', narration = ''", 'subtitle_or_narration'],
  ['image prompt', "image_prompt = ''", 'image_prompt'],
  ['video prompt', "video_prompt = ''", 'video_prompt'],
]) {
  test(`production storyboard minimum standard requires ${label}`, (t) => {
    const fixture = createProductionQaFixture(t);
    fixture.db.prepare(`UPDATE storyboards SET ${update} WHERE id = ?`).run(fixture.storyboardId);
    const result = evaluate(fixture);

    assertFailedBelow80(result, 'storyboards_incomplete');
    const check = result.checks.find((item) => item.key === 'storyboards');
    assert.equal(check.missing[0].fields.includes(expectedField), true);
  });
}

test('optional effect/BGM/transition tracks may have zero items when explicitly marked unused', (t) => {
  const fixture = createProductionQaFixture(t);
  const result = evaluate(fixture);
  const timeline = result.checks.find((check) => check.key === 'media_timeline');

  assert.equal(result.passed, true);
  assert.equal(timeline.episode_timeline[0].optional_tracks_explicit, true);
  assert.equal(fixture.db.prepare(
    `SELECT COUNT(*) AS count FROM timeline_items
      WHERE track_id IN (?, ?, ?)`
  ).get(fixture.tracks.effect, fixture.tracks.bgm, fixture.tracks.transition).count, 0);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM timeline_tracks').get().count, 7);
  const episodeTimeline = timelineService.getEpisodeTimeline(fixture.db, fixture.episodeId);
  const effectTrack = episodeTimeline.tracks.find((track) => track.type === 'effect');
  assert.equal(effectTrack.status, 'unused');
  assert.deepEqual(effectTrack.metadata, { optional: true, usage: 'unused' });
  const manifest = timelineService.exportDramaManifest(fixture.db, 1);
  const manifestEffect = manifest.episodes[0].tracks.find((track) => track.type === 'effect');
  assert.equal(manifestEffect.status, 'unused');
  assert.deepEqual(manifestEffect.metadata, { optional: true, usage: 'unused' });
});

test('timeline API and manifest expose optional track status and metadata', async (t) => {
  const fixture = createProductionQaFixture(t);
  const handlers = timelineRoutes(fixture.db, { error() {} });
  const app = express();
  app.get('/api/v1/episodes/:episode_id/timeline', handlers.getEpisodeTimeline);
  app.get('/api/v1/dramas/:id/timeline/manifest', handlers.exportDramaManifest);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const timelineResponse = await fetch(`${baseUrl}/episodes/${fixture.episodeId}/timeline`);
    const timelineBody = await timelineResponse.json();
    assert.equal(timelineResponse.status, 200);
    const apiEffect = timelineBody.data.tracks.find((track) => track.type === 'effect');
    assert.equal(apiEffect.status, 'unused');
    assert.deepEqual(apiEffect.metadata, { optional: true, usage: 'unused' });

    const manifestResponse = await fetch(`${baseUrl}/dramas/1/timeline/manifest`);
    const manifestBody = await manifestResponse.json();
    assert.equal(manifestResponse.status, 200);
    const manifestEffect = manifestBody.data.episodes[0].tracks.find((track) => track.type === 'effect');
    assert.equal(manifestEffect.status, 'unused');
    assert.deepEqual(manifestEffect.metadata, { optional: true, usage: 'unused' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const [label, trackTypes] of [
  ['video item', ['video']],
  ['subtitle item', ['subtitle']],
  ['voice-or-dialogue item', ['voice', 'dialogue']],
]) {
  test(`production timeline requires a valid ${label} per episode`, (t) => {
    const fixture = createProductionQaFixture(t);
    const ids = trackTypes.map((type) => fixture.tracks[type]);
    fixture.db.prepare(
      `DELETE FROM timeline_items WHERE track_id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);

    const result = evaluate(fixture);
    assertFailedBelow80(result, 'media_timeline_incomplete');
    assert.equal(result.checks.find((check) => check.key === 'media_timeline').episode_timeline[0].passed, false);
  });
}

test('optional tracks must explicitly describe the unused state instead of relying on missing items', (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare("UPDATE timeline_tracks SET status = 'pending', metadata = '{}' WHERE id = ?")
    .run(fixture.tracks.effect);

  assertFailedBelow80(evaluate(fixture), 'media_timeline_incomplete');
});
