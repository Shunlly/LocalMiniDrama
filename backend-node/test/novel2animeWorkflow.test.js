const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const sourceIntakeService = require('../src/services/sourceIntakeService');
const workflowService = require('../src/services/workflowService');
const qaService = require('../src/services/qaService');
const timelineService = require('../src/services/timelineService');
const asyncAuditService = require('../src/services/asyncAuditService');
const skillRegistryService = require('../src/services/skillRegistryService');
const storySourceRoutes = require('../src/routes/storySources');

const log = {
  info() {},
  warn() {},
  error() {},
};

function createDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Workflow Test', 'A test drama', 'anime style', 'draft', ?, ?)`
  ).run(now, now);
  return db;
}

function sampleStoryboardText() {
  return [
    'shot 1 wide exterior gate. Characters: Aria, Bo. Location: Mountain Gate. Aria receives a sealed letter.',
    'shot 2 close letter on stone. Characters: Aria. Location: Mountain Gate. The seal cracks and reveals a warning.',
    'shot 3 medium tea house. Characters: Aria, Bo. Location: Tea House. Bo says the map must be stolen tonight.',
    'shot 4 high angle alley. Characters: Aria, Bo. Location: Alley. They escape as guards arrive.',
  ].join('\n');
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function waitForTerminalRun(db, runId, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = workflowService.getWorkflowRunDetail(db, runId);
    if (detail && ['completed', 'failed', 'cancelled'].includes(detail.status)) return detail;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return workflowService.getWorkflowRunDetail(db, runId);
}

describe('sourceIntakeService', () => {
  it('keeps inline heading content for storyboard and transcript splits', () => {
    const storyboardItems = sourceIntakeService.splitSourceItems(
      'storyboard',
      'shot 1 wide exterior gate action\nshot 2 close letter on stone',
      'Storyboard'
    );
    const transcriptItems = sourceIntakeService.splitSourceItems(
      'transcript',
      '[00:00] Aria: Did you hear it?\n[00:03] Bo: Someone is outside the gate.',
      'Transcript'
    );

    assert.equal(storyboardItems.length, 2);
    assert.equal(storyboardItems[0].raw_text.includes('exterior gate'), true);
    assert.equal(transcriptItems.length, 2);
    assert.equal(transcriptItems[1].raw_text.includes('outside the gate'), true);
  });

  it('imports all supported source types into traceable Story IR', () => {
    const db = createDb();
    const samples = [
      ['novel', 'Chapter 1\nCharacters: Aria, Bo\nLocation: Mountain Gate\nAria finds a secret letter and the crisis begins.'],
      ['outline', 'A young runner searches for her missing mentor and discovers the map he left behind.'],
      ['script', 'Episode 1\nINT. Tea House\nAria: We must leave tonight.\nBo nods and hides the map.'],
      ['storyboard', sampleStoryboardText()],
      ['comic', 'comic panel 1 Aria opens the gate. panel 2 Bo looks shocked.'],
      ['transcript', '[00:00] Aria: Did you hear it?\n[00:03] Bo: Someone is outside.'],
    ];

    for (const [sourceType, text] of samples) {
      const result = sourceIntakeService.createStorySource(db, log, {
        drama_id: 1,
        source_type: sourceType,
        title: `${sourceType} sample`,
        text,
        target_episode_count: 2,
      });
      assert.equal(result.source.source_type, sourceType);
      assert.equal(result.source.raw_text_path.startsWith('data/story_sources/1/'), true);
      assert.ok(result.items.length >= 1);
      assert.ok(result.events.length >= 1);
      if (result.events.length > 1) {
        assert.equal(result.event_edges.length >= result.events.length - 1, true);
      }
      assert.ok(result.adaptation_plan.id > 0);
      assert.equal(result.adaptation_plan.plan_json.source_type, sourceType);
    }
  });

  it('appends adaptation episodes by default instead of overwriting existing episodes', () => {
    const db = createDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (1, 1, 'Existing', 'Do not overwrite', 'draft', ?, ?)`
    ).run(now, now);

    const result = sourceIntakeService.createStorySource(db, log, {
      drama_id: 1,
      source_type: 'outline',
      title: 'New source',
      text: 'Characters: Aria\nLocation: Mountain Gate\nAria decides to leave.',
      target_episode_count: 1,
    });

    const applied = sourceIntakeService.applyAdaptationPlanToEpisodes(db, log, result.adaptation_plan.id);
    assert.equal(applied.overwrite, false);
    const episodes = db.prepare(
      'SELECT episode_number, title, script_content FROM episodes WHERE drama_id = 1 AND deleted_at IS NULL ORDER BY episode_number ASC'
    ).all();
    assert.equal(episodes.length, 2);
    assert.equal(episodes[0].script_content, 'Do not overwrite');
    assert.equal(episodes[1].episode_number, 2);
  });

  it('adds semantic Story IR edges beyond linear next links when heuristics match', () => {
    const db = createDb();
    const result = sourceIntakeService.createStorySource(db, log, {
      drama_id: 1,
      source_type: 'storyboard',
      title: 'semantic edges',
      text: [
        'shot 1 Aria finds a secret letter at the gate.',
        'shot 2 Because the warning reveals a hidden enemy, Bo starts a fight.',
        'shot 3 Suddenly the map is stolen and the episode ends on a cliffhanger.',
      ].join('\n'),
      target_episode_count: 1,
    });

    const relationTypes = result.event_edges.map((edge) => edge.relation_type);
    assert.equal(relationTypes.includes('next'), true);
    assert.equal(relationTypes.includes('cause'), true);
    assert.equal(relationTypes.includes('conflict'), true);
    assert.equal(relationTypes.includes('reveal'), true);
    assert.equal(relationTypes.includes('hook'), true);
  });

  it('extracts readable Chinese Story IR signals and richer episode plan fields', () => {
    const db = createDb();
    const result = sourceIntakeService.createStorySource(db, log, {
      drama_id: 1,
      source_type: 'storyboard',
      title: '中文分镜',
      text: [
        '镜头一 角色：林夏、顾言。地点：旧码头。林夏发现一封秘密警告信。',
        '镜头二 因此顾言与守卫发生冲突，二人逃亡。',
        '镜头三 突然地图被偷走，最后留下悬念。',
      ].join('\n'),
      target_episode_count: 1,
      metadata: '{"source_language":"zh"}',
    });

    assert.equal(result.source.metadata.source_language, 'zh');
    assert.equal(result.source.source_type, 'storyboard');
    assert.equal(result.events.some((event) => event.characters.includes('林夏')), true);
    assert.equal(result.events.some((event) => event.characters.includes('顾言')), true);
    assert.equal(result.events.some((event) => event.location === '旧码头'), true);
    const relationTypes = result.event_edges.map((edge) => edge.relation_type);
    assert.equal(relationTypes.includes('conflict'), true);
    assert.equal(relationTypes.includes('reveal'), true);
    assert.equal(relationTypes.includes('hook'), true);
    const episode = result.adaptation_plan.plan_json.episodes[0];
    assert.equal(Array.isArray(episode.source_trace), true);
    assert.equal(Array.isArray(episode.beats), true);
    assert.equal(episode.beats.length >= 1, true);
    assert.equal(Array.isArray(episode.continuity_notes.characters), true);
  });

  it('accepts text upload metadata JSON but rejects deferred multimedia intake', () => {
    const db = createDb();
    const routes = storySourceRoutes(db, log);

    const okRes = mockResponse();
    routes.uploadForDrama({
      params: { id: 1 },
      body: { metadata: '{"source_language":"zh"}' },
      file: {
        originalname: 'outline.txt',
        mimetype: 'text/plain',
        size: 32,
        buffer: Buffer.from('Characters: Aria\nLocation: Gate\nAria finds a clue.', 'utf8'),
      },
    }, okRes);
    assert.equal(okRes.statusCode, 201);
    assert.equal(okRes.body.data.source.metadata.source_language, 'zh');

    const badRes = mockResponse();
    routes.uploadForDrama({
      params: { id: 1 },
      body: {},
      file: {
        originalname: 'source.pdf',
        mimetype: 'application/pdf',
        size: 16,
        buffer: Buffer.from('%PDF'),
      },
    }, badRes);
    assert.equal(badRes.statusCode, 400);
    assert.match(badRes.body.error.message, /deferred/i);
  });
});

describe('workflowService novel2anime', () => {
  it('runs a recoverable source-to-animatic workflow and writes production QA output', async () => {
    const db = createDb();
    const run = workflowService.createWorkflowRun(db, log, {
      drama_id: 1,
      type: 'novel2anime',
      text: sampleStoryboardText(),
      source_type: 'storyboard',
      title: 'Gate Letter',
      target_episode_count: 2,
      style: 'anime style',
      options: { aspect_ratio: '16:9', image_size: '1024x1024' },
    });

    const completed = await workflowService.processWorkflowRun(db, log, run.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.progress, 100);
    assert.equal(completed.steps.length, workflowService.NOVEL2ANIME_STEPS.length);
    assert.deepEqual(
      completed.steps.map((step) => step.step_key),
      [
        'source_intake',
        'adaptation_plan',
        'apply_episodes',
        'asset_bible',
        'storyboard_draft',
        'image_generation',
        'video_generation',
        'audio_generation',
        'timeline_plan',
        'post_composite',
        'qa_audit',
      ]
    );
    assert.equal(completed.steps.every((step) => step.status === 'completed'), true);

    const eventCount = db.prepare('SELECT COUNT(*) AS c FROM story_events').get().c;
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM story_sources').get().c, 1);
    assert.equal(eventCount >= 2, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM story_event_edges').get().c >= eventCount - 1, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM episodes WHERE drama_id = 1 AND deleted_at IS NULL').get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM characters WHERE drama_id = 1 AND deleted_at IS NULL').get().c >= 1, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM scenes WHERE drama_id = 1 AND deleted_at IS NULL').get().c >= 1, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM storyboards WHERE deleted_at IS NULL').get().c >= 2, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM image_generations WHERE status = 'completed'").get().c >= 2, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM video_generations WHERE status = 'completed'").get().c >= 2, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM video_merges WHERE status = 'completed'").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM episodes WHERE drama_id = 1 AND status = 'completed'").get().c, 2);

    const trackTypes = db.prepare('SELECT DISTINCT type FROM timeline_tracks ORDER BY type ASC').all().map((row) => row.type);
    for (const type of ['bgm', 'dialogue', 'effect', 'subtitle', 'transition', 'video', 'voice']) {
      assert.equal(trackTypes.includes(type), true);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM timeline_tracks').get().c >= 14, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM timeline_items').get().c >= 14, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM creative_reviews WHERE run_id = ?').get(run.id).c >= 4, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM provider_invocations WHERE run_id = ?').get(run.id).c >= 4, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM skill_invocations WHERE run_id = ?').get(run.id).c >= 10, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM skill_registry WHERE enabled = 1').get().c >= 12, true);
    const stagedCharacters = db.prepare("SELECT COUNT(*) AS c FROM characters WHERE stages IS NOT NULL AND stages != ''").get().c;
    assert.equal(stagedCharacters >= 1, true);

    const reports = qaService.listQaReports(db, { drama_id: 1, run_id: run.id });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].passed, true);
    assert.equal(reports[0].score >= 80, true);
    assert.equal(reports[0].report_json.mode, 'draft');
    assert.equal(reports[0].report_json.checks.some((check) => check.key === 'provider_sdk_audit' && check.passed), true);
    assert.equal(reports[0].report_json.checks.some((check) => check.key === 'skill_registry_audit' && check.passed), true);
    assert.equal(reports[0].report_json.checks.some((check) => check.key === 'skill_template_audit' && check.passed), true);
    assert.equal(reports[0].report_json.checks.some((check) => check.key === 'legacy_async_audit' && check.passed), true);

    const productionReport = qaService.auditDrama(db, log, {
      drama_id: 1,
      run_id: run.id,
      mode: 'production',
    });
    assert.equal(productionReport.passed, false);
    assert.equal(productionReport.report_json.mode, 'production');
    assert.equal(productionReport.report_json.issues.some((issue) => issue.code === 'media_timeline_incomplete'), true);

    const dramaTimeline = timelineService.getDramaTimeline(db, 1);
    assert.equal(dramaTimeline.summary.episode_count, 2);
    assert.equal(dramaTimeline.summary.track_types.includes('subtitle'), true);
    const manifest = timelineService.exportDramaManifest(db, 1);
    assert.equal(manifest.schema, 'localminidrama.timeline_manifest.v1');
    assert.equal(manifest.episodes.length, 2);
    const srt = timelineService.exportEpisodeSrt(db, dramaTimeline.episodes[0].episode.id);
    assert.equal(srt.content.includes('-->'), true);
  });

  it('can retry a failed workflow step without rerunning completed steps', async () => {
    const db = createDb();
    const run = workflowService.createWorkflowRun(db, log, {
      drama_id: 1,
      type: 'novel2anime',
      text: '',
      source_type: 'outline',
      title: 'bad input',
    });

    const failed = await workflowService.processWorkflowRun(db, log, run.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.steps[0].status, 'failed');

    db.prepare(
      `UPDATE workflow_steps
       SET input_json = ?, status = 'pending', error = NULL
       WHERE run_id = ? AND step_key = 'source_intake'`
    ).run(JSON.stringify({
      drama_id: 1,
      text: sampleStoryboardText(),
      source_type: 'storyboard',
      title: 'fixed input',
      target_episode_count: 1,
    }), run.id);

    workflowService.retryWorkflowRun(db, log, run.id);
    const completed = await waitForTerminalRun(db, run.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.steps[0].attempts, 2);
  });

  it('can pause and resume a pending workflow run', async () => {
    const db = createDb();
    const run = workflowService.createWorkflowRun(db, log, {
      drama_id: 1,
      type: 'novel2anime',
      text: sampleStoryboardText(),
      source_type: 'storyboard',
      title: 'pause resume',
      target_episode_count: 1,
    });

    const paused = workflowService.pauseWorkflowRun(db, log, run.id, 'test pause');
    assert.equal(paused.status, 'paused');
    assert.equal(paused.steps.every((step) => step.status === 'pending'), true);

    const resumed = workflowService.resumeWorkflowRun(db, log, run.id);
    assert.equal(resumed.status, 'pending');
    const completed = await waitForTerminalRun(db, run.id);
    assert.equal(completed.status, 'completed');
  });

  it('can remediate a failed QA report by starting a workflow from the latest source', async () => {
    const db = createDb();
    sourceIntakeService.createStorySource(db, log, {
      drama_id: 1,
      source_type: 'storyboard',
      title: 'qa remediation source',
      text: sampleStoryboardText(),
      target_episode_count: 1,
    });

    const report = qaService.auditDrama(db, log, {
      drama_id: 1,
      mode: 'production',
    });
    assert.equal(report.passed, false);
    assert.equal(report.report_json.remediation_actions.some((action) => action.automated), true);

    const remediation = qaService.remediateQaReport(db, log, report.id, { action_code: 'start_or_retry_workflow' });
    assert.equal(remediation.skipped, false);
    assert.equal(remediation.actions_taken[0].code, 'start_workflow_from_latest_source');
    assert.ok(remediation.workflow_run.id);

    const completed = await waitForTerminalRun(db, remediation.workflow_run.id);
    assert.equal(completed.status, 'completed');
    const reports = qaService.listQaReports(db, { drama_id: 1, run_id: remediation.workflow_run.id });
    assert.equal(reports[0].passed, true);
  });

  it('can run granular QA remediation workflows for asset bible and timeline repairs', async () => {
    const db = createDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (1, 1, 'Existing', 'A short scene', 'draft', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO characters (drama_id, name, role, description, created_at, updated_at)
       VALUES (1, 'Aria', 'main', 'No visual asset yet', ?, ?)`
    ).run(now, now);
    sourceIntakeService.createStorySource(db, log, {
      drama_id: 1,
      source_type: 'outline',
      title: 'repair source',
      text: 'Characters: Aria\nLocation: Gate\nAria discovers a secret.',
      target_episode_count: 1,
    });

    const characterReport = qaService.auditDrama(db, log, { drama_id: 1, mode: 'draft' });
    assert.equal(characterReport.report_json.remediation_actions.some((action) => action.code === 'refresh_asset_bible'), true);
    const characterRepair = qaService.remediateQaReport(db, log, characterReport.id, { action_code: 'refresh_asset_bible' });
    assert.equal(characterRepair.actions_taken[0].code, 'refresh_asset_bible');
    const characterRepairDone = await waitForTerminalRun(db, characterRepair.workflow_run.id);
    assert.equal(['completed', 'failed'].includes(characterRepairDone.status), true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM characters WHERE stages IS NOT NULL AND stages != ''").get().c >= 1, true);

    const timelineReport = qaService.auditDrama(db, log, { drama_id: 1, mode: 'draft' });
    const timelineRepair = qaService.remediateQaReport(db, log, timelineReport.id, { action_code: 'repair_timeline' });
    assert.equal(timelineRepair.actions_taken[0].code, 'repair_timeline');
    const timelineRepairDone = await waitForTerminalRun(db, timelineRepair.workflow_run.id);
    assert.equal(['completed', 'failed'].includes(timelineRepairDone.status), true);
  });

  it('audits legacy async entrypoints and skill templates', () => {
    const asyncAudit = asyncAuditService.auditLegacyAsyncEntrypoints();
    assert.equal(asyncAudit.passed, true);

    const templates = skillRegistryService.getSkillTemplates();
    assert.equal(templates.length >= 6, true);
    assert.equal(templates.every((template) => template.exists), true);
  });
});
