const test = require('node:test');
const assert = require('node:assert/strict');

const qaService = require('../src/services/qaService');
const { createProductionQaFixture } = require('./qaProductionFixture');

function evaluate(fixture) {
  return qaService.evaluateDrama(fixture.db, {
    drama_id: 1,
    run_id: fixture.runId,
    mode: 'production',
  });
}

function assertProductionFailure(result, code) {
  assert.equal(result.passed, false);
  assert.ok(result.score < 80, `expected score below 80, received ${result.score}`);
  assert.equal(result.issues.some((issue) => issue.code === code), true);
}

test('production assets pass with real referenced characters/scenes and no fabricated optional props', (t) => {
  const fixture = createProductionQaFixture(t);
  const result = evaluate(fixture);

  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM props').get().count, 0);
  assert.equal(result.score, 100);
  assert.equal(result.passed, true);
  assert.equal(result.checks.find((check) => check.key === 'production_asset_references').passed, true);
});

test('production rejects mock continuity and storyboard reference URLs', (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('UPDATE characters SET identity_anchors = ? WHERE id = ?')
    .run(JSON.stringify({ reference_asset: 'mock://characters/aria.png' }), fixture.characterId);
  fixture.db.prepare('UPDATE storyboards SET reference_images = ? WHERE id = ?')
    .run(JSON.stringify(['mock://references/aria.png']), fixture.storyboardId);

  const result = evaluate(fixture);
  assertProductionFailure(result, 'production_asset_references_invalid');
  assert.equal(result.issues.some((issue) => issue.code === 'character_continuity_incomplete'), true);
});

test('production rejects missing character, scene, and prop references', (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('UPDATE storyboards SET characters = ?, scene_id = 999 WHERE id = ?')
    .run(JSON.stringify([{ id: 999, name: 'Missing' }]), fixture.storyboardId);
  fixture.db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, 999)')
    .run(fixture.storyboardId);

  const result = evaluate(fixture);
  assertProductionFailure(result, 'production_asset_references_invalid');
  const issue = result.issues.find((item) => item.code === 'production_asset_references_invalid');
  assert.deepEqual(new Set(issue.target.failures.map((failure) => failure.type)), new Set(['character', 'scene', 'prop']));
});

test('production rejects an existing referenced prop whose asset is mock-only', (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  const prop = fixture.db.prepare(
    `INSERT INTO props (drama_id, name, type, description, prompt, image_url, local_path, created_at, updated_at)
     VALUES (1, 'Letter', 'story', 'Sealed letter', 'letter', 'mock://props/letter.png', 'mock://props/letter.png', ?, ?)`
  ).run(now, now);
  fixture.db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)')
    .run(fixture.storyboardId, Number(prop.lastInsertRowid));

  assertProductionFailure(evaluate(fixture), 'production_asset_references_invalid');
});
