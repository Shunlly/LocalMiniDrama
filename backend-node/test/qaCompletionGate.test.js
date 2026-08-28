const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workflowService = require('../src/services/workflowService');
const providerSdkService = require('../src/services/providerSdkService');
const taskService = require('../src/services/taskService');
const videoMergeService = require('../src/services/videoMergeService');
const configModule = require('../src/config');
const ffmpegPath = require('../src/utils/ffmpegPath');
const timelineService = require('../src/services/timelineService');
const { createProductionQaFixture } = require('./qaProductionFixture');

const log = { info() {}, warn() {}, error() {} };

function productionTimelineHash(db, episodeId) {
  const timeline = timelineService.getEpisodeTimeline(db, episodeId);
  const requiredTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  const tracks = timeline.tracks
    .filter((track) => requiredTypes.includes(track.type))
    .map((track) => ({
      id: Number(track.id),
      type: track.type,
      name: track.name || '',
      sort_order: Number(track.sort_order) || 0,
      status: track.status || 'pending',
      metadata: track.metadata || {},
      items: [...track.items]
        .sort((left, right) => Number(left.start_sec) - Number(right.start_sec) || Number(left.end_sec) - Number(right.end_sec) || Number(left.id) - Number(right.id))
        .map((item) => ({
          id: Number(item.id),
          storyboard_id: item.storyboard_id == null ? null : Number(item.storyboard_id),
          start_sec: Number(item.start_sec),
          end_sec: Number(item.end_sec),
          source_path: String(item.source_path || ''),
          metadata: item.metadata || {},
        })),
    }));
  return crypto.createHash('sha256').update(JSON.stringify({
    schema: 'localminidrama.production_timeline_composite.v1',
    episode_id: Number(episodeId),
    video_track_id: Number(tracks.find((track) => track.type === 'video').id),
    tracks,
  }), 'utf8').digest('hex');
}

function insertProductionReadinessConfigs(db) {
  const now = new Date().toISOString();
  for (const serviceType of ['image', 'storyboard_image', 'video', 'tts']) {
    db.prepare(
      `INSERT INTO ai_service_configs
         (service_type, provider, model, default_model, is_default, is_active, created_at, updated_at)
       VALUES (?, 'test-provider', '["test-model"]', 'test-model', 1, 1, ?, ?)`
    ).run(serviceType, now, now);
  }
}

test('passing QA completes the run-scoped staged merge and workflow states', async (t) => {
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
  assert.match(failed.error, /质量检查未通过，当前得分/);
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

test('an old run without merge evidence leaves a newer run merge and task untouched', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `UPDATE provider_invocations
        SET output_json = '{"merged_url":"videos/legacy.mp4"}'
      WHERE run_id = ? AND provider_type = 'compositor'`
  ).run(fixture.runId);
  fixture.db.prepare(
    `INSERT INTO workflow_runs
       (id, drama_id, type, status, progress, current_step, input_json, output_json, started_at, created_at, updated_at)
     VALUES ('newer-qa-run', 1, 'novel2anime', 'processing', 90, 'qa_audit', '{}', '{}', ?, ?, ?)`
  ).run(now, now, now);
  fixture.db.prepare(
    `INSERT INTO async_tasks
       (id, type, status, progress, message, result, resource_id, created_at, updated_at, completed_at)
     VALUES ('newer-qa-task', 'video_merge', 'completed', 100, '', ?, ?, ?, ?, ?)`
  ).run(JSON.stringify({ status: 'qa_pending' }), String(fixture.episodeId), now, now, now);
  const newer = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, task_id, merged_url, duration, created_at)
     VALUES (?, 1, 'ffmpeg', 'qa_pending', '[]', '{}', 'newer-qa-task', 'videos/newer-run.mp4', 7, ?)`
  ).run(fixture.episodeId, now);
  fixture.db.prepare(
    `INSERT INTO provider_invocations
       (workflow_step_id, run_id, provider_type, provider_name, model, mode, input_hash, output_json, status, cost_estimate, created_at)
     VALUES (NULL, 'newer-qa-run', 'compositor', 'ffmpeg', 'ffmpeg', 'production', 'newer-merge', ?, 'success', 0, ?)`
  ).run(JSON.stringify({ merge_id: Number(newer.lastInsertRowid) }), now);
  fixture.db.prepare(
    `UPDATE episodes SET status = 'qa_pending', video_url = 'videos/newer-run.mp4', updated_at = ? WHERE id = ?`
  ).run(now, fixture.episodeId);

  const completed = await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);

  assert.equal(completed.status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(newer.lastInsertRowid).status, 'qa_pending');
  assert.deepEqual(
    fixture.db.prepare('SELECT status, video_url FROM episodes WHERE id = ?').get(fixture.episodeId),
    { status: 'qa_pending', video_url: 'videos/newer-run.mp4' }
  );
  const task = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get('newer-qa-task');
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.result).status, 'qa_pending');
});

test('late QA completion cannot overwrite a newer merge output', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  const newer = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, title, provider, model, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 1, 'Replacement', 'ffmpeg', 'ffmpeg', 'completed', '[]', '{}', 'videos/newer.mp4', 7, ?, ?)`
  ).run(fixture.episodeId, now, now);
  fixture.db.prepare(
    `UPDATE episodes SET video_url = 'videos/newer.mp4', status = 'completed', updated_at = ? WHERE id = ?`
  ).run(now, fixture.episodeId);

  const completed = await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);

  assert.equal(completed.status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(fixture.mergeId).status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(newer.lastInsertRowid).status, 'completed');
  const episode = fixture.db.prepare('SELECT status, video_url FROM episodes WHERE id = ?').get(fixture.episodeId);
  assert.equal(episode.status, 'completed');
  assert.equal(episode.video_url, 'videos/newer.mp4');
});

test('historical mock reuse creates current ownership without downgrading the old merge', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  const historical = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 1, 'mock-compositor', 'completed', '[]', '{}', 'mock://historical.mp4', 5, ?, ?)`
  ).run(fixture.episodeId, now, now);
  const newer = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/newer.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  fixture.db.prepare(
    `UPDATE episodes SET video_url = 'videos/newer.mp4', status = 'completed', updated_at = ? WHERE id = ?`
  ).run(now, fixture.episodeId);

  const result = await providerSdkService.compositeEpisodes(fixture.db, log, {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:mock-reuse`,
    mode: 'mock',
    defer_qa_completion: true,
  });

  assert.equal(result.composite_reused, 1);
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(historical.lastInsertRowid).status, 'completed');
  const current = fixture.db.prepare('SELECT * FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1').get(fixture.episodeId);
  assert.ok(Number(current.id) > Number(newer.lastInsertRowid));
  assert.equal(current.status, 'qa_pending');
  assert.equal(current.merged_url, 'mock://historical.mp4');
  assert.deepEqual(
    fixture.db.prepare('SELECT status, video_url FROM episodes WHERE id = ?').get(fixture.episodeId),
    { status: 'qa_pending', video_url: 'mock://historical.mp4' }
  );
  const task = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get(current.task_id);
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.result).merge_id, current.id);
  assert.equal(JSON.parse(task.result).status, 'qa_pending');
});

test('same-key compositor retry refreshes durable run evidence to the newest owned merge', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 1, 'mock-compositor', 'completed', '[]', '{}', 'mock://retry-source.mp4', 5, ?, ?)`
  ).run(fixture.episodeId, now, now);
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/retry-barrier-1.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  const params = {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:same-key-retry`,
    mode: 'mock',
    defer_qa_completion: true,
  };

  await providerSdkService.compositeEpisodes(fixture.db, log, params);
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/retry-barrier-2.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  await providerSdkService.compositeEpisodes(fixture.db, log, params);

  const current = fixture.db.prepare(
    'SELECT * FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1'
  ).get(fixture.episodeId);
  assert.equal(current.status, 'qa_pending');
  const evidencedMergeIds = fixture.db.prepare(
    `SELECT output_json FROM provider_invocations
      WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'`
  ).all(fixture.runId).map((row) => Number(JSON.parse(row.output_json || '{}').merge_id));
  assert.ok(evidencedMergeIds.includes(Number(current.id)));

  const completed = await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);
  assert.equal(completed.status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(current.id).status, 'completed');
  assert.equal(fixture.db.prepare('SELECT status FROM episodes WHERE id = ?').get(fixture.episodeId).status, 'completed');
  const task = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get(current.task_id);
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.result).status, 'completed');
});

test('same-key retry rolls back ownership when durable evidence refresh changes zero rows', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 1, 'mock-compositor', 'completed', '[]', '{}', 'mock://zero-row-source.mp4', 5, ?, ?)`
  ).run(fixture.episodeId, now, now);
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/zero-row-barrier-1.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  const params = {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:zero-row-refresh`,
    mode: 'mock',
    defer_qa_completion: true,
  };
  await providerSdkService.compositeEpisodes(fixture.db, log, params);
  const ownedBeforeRetry = fixture.db.prepare(
    'SELECT * FROM video_merges WHERE episode_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'
  ).get(fixture.episodeId);
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/zero-row-barrier-2.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  const mergeCountBeforeRetry = fixture.db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count;
  const taskCountBeforeRetry = fixture.db.prepare("SELECT COUNT(*) AS count FROM async_tasks WHERE type = 'video_merge'").get().count;
  fixture.db.exec(`
    CREATE TRIGGER ignore_compositor_evidence_refresh
    BEFORE UPDATE OF output_json ON provider_invocations
    WHEN OLD.provider_type = 'compositor'
    BEGIN
      SELECT RAISE(IGNORE);
    END;
  `);

  await assert.rejects(
    providerSdkService.compositeEpisodes(fixture.db, log, params),
    /供应商调用记录刷新异常（变更行数：0）/
  );

  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, mergeCountBeforeRetry);
  assert.equal(
    fixture.db.prepare("SELECT COUNT(*) AS count FROM async_tasks WHERE type = 'video_merge'").get().count,
    taskCountBeforeRetry
  );
  assert.deepEqual(
    fixture.db.prepare('SELECT status, video_url FROM episodes WHERE id = ?').get(fixture.episodeId),
    { status: 'qa_pending', video_url: ownedBeforeRetry.merged_url }
  );
  const ownedTask = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get(ownedBeforeRetry.task_id);
  assert.equal(ownedTask.status, 'completed');
  assert.equal(JSON.parse(ownedTask.result).merge_id, ownedBeforeRetry.id);
  assert.equal(fixture.db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(fixture.runId).status, 'processing');
  const evidencedMergeIds = fixture.db.prepare(
    `SELECT output_json FROM provider_invocations
      WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'`
  ).all(fixture.runId).map((row) => Number(JSON.parse(row.output_json || '{}').merge_id));
  assert.ok(evidencedMergeIds.includes(Number(ownedBeforeRetry.id)));
});

test('historical production reuse creates current ownership without downgrading the old merge', async (t) => {
  const fixture = createProductionQaFixture(t);
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-production-reuse-'));
  const originalLoadConfig = configModule.loadConfig;
  const originalValidateFfmpegTools = ffmpegPath.validateFfmpegTools;
  configModule.loadConfig = () => ({ storage: { local_path: storageRoot } });
  ffmpegPath.validateFfmpegTools = () => ({
    ok: true,
    ffmpeg: { path: 'ffmpeg' },
    ffprobe: { path: 'ffprobe' },
  });
  delete require.cache[require.resolve('../src/services/providerSdkService')];
  const productionProviderSdkService = require('../src/services/providerSdkService');
  t.after(() => {
    configModule.loadConfig = originalLoadConfig;
    ffmpegPath.validateFfmpegTools = originalValidateFfmpegTools;
    delete require.cache[require.resolve('../src/services/providerSdkService')];
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
  insertProductionReadinessConfigs(fixture.db);
  for (const relativePath of ['videos/shot.mp4', 'audio/shot.mp3', 'videos/historical.mp4']) {
    const absolutePath = path.join(storageRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'fixture');
  }
  const now = new Date().toISOString();
  const timelinePlanHash = productionTimelineHash(fixture.db, fixture.episodeId);
  const historical = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', ?, 'videos/historical.mp4', 5, ?, ?)`
  ).run(fixture.episodeId, JSON.stringify({ timeline_plan_hash: timelinePlanHash }), now, now);
  const newer = fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/newer.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  fixture.db.prepare(
    `UPDATE episodes SET video_url = 'videos/newer.mp4', status = 'completed', updated_at = ? WHERE id = ?`
  ).run(now, fixture.episodeId);

  const params = {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:production-reuse`,
    mode: 'production',
    defer_qa_completion: true,
  };
  const result = await productionProviderSdkService.compositeEpisodes(fixture.db, log, params);

  assert.equal(result.composite_reused, 1);
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(historical.lastInsertRowid).status, 'completed');
  const current = fixture.db.prepare('SELECT * FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1').get(fixture.episodeId);
  assert.ok(Number(current.id) > Number(newer.lastInsertRowid));
  assert.equal(current.status, 'qa_pending');
  assert.equal(current.merged_url, 'videos/historical.mp4');
  assert.deepEqual(
    fixture.db.prepare('SELECT status, video_url FROM episodes WHERE id = ?').get(fixture.episodeId),
    { status: 'qa_pending', video_url: 'videos/historical.mp4' }
  );
  const task = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get(current.task_id);
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.result).merge_id, current.id);
  assert.equal(JSON.parse(task.result).status, 'qa_pending');

  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/production-retry-barrier.mp4', 7, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);
  await productionProviderSdkService.compositeEpisodes(fixture.db, log, params);

  const retriedCurrent = fixture.db.prepare(
    'SELECT * FROM video_merges WHERE episode_id = ? ORDER BY id DESC LIMIT 1'
  ).get(fixture.episodeId);
  const evidencedMergeIds = fixture.db.prepare(
    `SELECT output_json FROM provider_invocations
      WHERE run_id = ? AND provider_type = 'compositor' AND status = 'success'`
  ).all(fixture.runId).map((row) => Number(JSON.parse(row.output_json || '{}').merge_id));
  assert.ok(evidencedMergeIds.includes(Number(retriedCurrent.id)));

  await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);
  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(retriedCurrent.id).status, 'completed');
});

test('QA completion refreshes the terminal async task result to completed', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO async_tasks
       (id, type, status, progress, message, result, resource_id, created_at, updated_at, completed_at)
     VALUES ('qa-terminal-task', 'video_merge', 'completed', 100, '', ?, ?, ?, ?, ?)`
  ).run(JSON.stringify({ merge_id: fixture.mergeId, status: 'qa_pending' }), String(fixture.episodeId), now, now, now);
  fixture.db.prepare('UPDATE video_merges SET task_id = ? WHERE id = ?')
    .run('qa-terminal-task', fixture.mergeId);

  await workflowService.processWorkflowRun(fixture.db, log, fixture.runId);

  const task = fixture.db.prepare('SELECT status, result FROM async_tasks WHERE id = ?').get('qa-terminal-task');
  assert.equal(task.status, 'completed');
  assert.equal(JSON.parse(task.result).status, 'completed');
});

test('QA completion rolls back when the completed task result cannot be refreshed', (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO async_tasks
       (id, type, status, progress, message, result, resource_id, created_at, updated_at, completed_at)
     VALUES ('qa-refresh-false', 'video_merge', 'completed', 100, '', ?, ?, ?, ?, ?)`
  ).run(JSON.stringify({ merge_id: fixture.mergeId, status: 'qa_pending' }), String(fixture.episodeId), now, now, now);
  fixture.db.prepare('UPDATE video_merges SET task_id = ? WHERE id = ?').run('qa-refresh-false', fixture.mergeId);
  const originalRefresh = taskService.refreshCompletedTaskResult;
  taskService.refreshCompletedTaskResult = () => false;
  t.after(() => {
    taskService.refreshCompletedTaskResult = originalRefresh;
  });

  assert.throws(() => videoMergeService.completeQaPendingMerge(fixture.db, fixture.mergeId, now));

  assert.equal(fixture.db.prepare('SELECT status FROM video_merges WHERE id = ?').get(fixture.mergeId).status, 'qa_pending');
  assert.equal(fixture.db.prepare('SELECT status FROM episodes WHERE id = ?').get(fixture.episodeId).status, 'qa_pending');
  assert.equal(JSON.parse(fixture.db.prepare('SELECT result FROM async_tasks WHERE id = ?').get('qa-refresh-false').result).status, 'qa_pending');
});

test('mock compositor rolls back a new merge when the episode update fails', async (t) => {
  const fixture = createProductionQaFixture(t);
  fixture.db.prepare('DELETE FROM video_merges').run();
  fixture.db.exec(`
    CREATE TRIGGER fail_mock_episode_update
    BEFORE UPDATE ON episodes
    BEGIN
      SELECT RAISE(ABORT, 'forced episode update failure');
    END;
  `);

  await assert.rejects(providerSdkService.compositeEpisodes(fixture.db, log, {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:mock-insert-rollback`,
    mode: 'mock',
    defer_qa_completion: true,
  }), /forced episode update failure/);

  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM video_merges').get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM async_tasks WHERE type = 'video_merge'").get().count, 0);
});

test('historical compositor metadata cannot move a new merge into another project', async (t) => {
  const fixture = createProductionQaFixture(t);
  const now = new Date().toISOString();
  fixture.db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at)
     VALUES (2, 'Other project', 'draft', ?, ?)`
  ).run(now, now);
  fixture.db.prepare('DELETE FROM video_merges').run();
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at)
     VALUES (?, 2, 'mock-compositor', 'completed', '[]', '{}', 'mock://historical-cross-project.mp4', 5, ?, ?)`
  ).run(fixture.episodeId, now, now);
  fixture.db.prepare(
    `INSERT INTO video_merges
       (episode_id, drama_id, provider, status, scenes, merge_options, merged_url, duration, completed_at, created_at, deleted_at)
     VALUES (?, 1, 'ffmpeg', 'completed', '[]', '{}', 'videos/newer-deleted.mp4', 5, ?, ?, ?)`
  ).run(fixture.episodeId, now, now, now);

  const result = await providerSdkService.compositeEpisodes(fixture.db, log, {
    drama_id: 1,
    run_id: fixture.runId,
    workflow_step_id: fixture.qaStepId,
    call_key: `${fixture.runId}:cross-project-history`,
    mode: 'mock',
    defer_qa_completion: true,
  });

  assert.equal(result.composite_reused, 1);
  const current = fixture.db.prepare(
    'SELECT episode_id, drama_id, status FROM video_merges ORDER BY id DESC LIMIT 1'
  ).get();
  assert.deepEqual(current, { episode_id: fixture.episodeId, drama_id: 1, status: 'qa_pending' });
});
