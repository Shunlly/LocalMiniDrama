const test = require('node:test');
const assert = require('node:assert/strict');

const workflowService = require('../src/services/workflowService');
const providerSdkService = require('../src/services/providerSdkService');
const { createProductionQaFixture } = require('./qaProductionFixture');

const log = { info() {}, warn() {}, error() {} };

test('passing QA atomically completes staged episode, merge, step, and workflow', async (t) => {
  const fixture = createProductionQaFixture(t);
  const completed = await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 100);
  assert.equal(completed.steps[0].status, 'completed');
  assert.equal(completed.steps[0].output_json.passed, true);
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(fixture.mergeId).status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM episodes WHERE id = ?').get(fixture.episodeId).status, 'completed');
});

test('QA below 80 leaves episode and merge uncompleted and fails the workflow', async (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare("UPDATE storyboards SET movement = '' WHERE id = ?").run(fixture.storyboardId);

  const failed = await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /QA gate failed with score/);
  assert.ok(failed.steps[0].output_json.score < 80);
  assert.equal(failed.steps[0].output_json.passed, false);
  assert.notEqual(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(fixture.mergeId).status, 'completed');
  assert.notEqual(fixture.db.prepare('SELECT status FROM episodes WHERE id = ?').get(fixture.episodeId).status, 'completed');
});

test('workflow compositor stages output as qa_pending before QA', async (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('DELETE FROM video_merges').run();
  fixture.db.prepare("UPDATE episodes SET status = 'draft', video_url = NULL WHERE id = ?").run(fixture.episodeId);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO workflow_steps
       (id, run_id, step_key, status, sort_order, created_at, updated_at)
     VALUES ('post-composite-step', ?, 'post_composite', 'processing', 1, ?, ?)`
  ).run(fixture.runId, now, now);

  const result = await providerSdkService.compositeEpisodes(fixture.db, log, {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: 'post-composite-step',
    call_key: `workflow:${fixture.runId}:step:post_composite:v1`,
    mode: 'draft',
    defer_qa_completion: true,
  });

  assert.equal(result.composite_created, 1);
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges ORDER BY id DESC LIMIT 1').get().status, 'qa_pending');
  assert.equal(fixture.db.prepare('SELECT status FROM episodes WHERE id = ?').get(fixture.episodeId).status, 'qa_pending');
});
