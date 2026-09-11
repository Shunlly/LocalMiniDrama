'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiClient = require('../src/services/aiClient');
const backgroundExtractionService = require('../src/services/backgroundExtractionService');
const dramaService = require('../src/services/dramaService');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');
const framePromptService = require('../src/services/framePromptService');
const imageClient = require('../src/services/imageClient');
const { getLegacyAsyncSchedulerState } = require('../src/services/legacyAsyncSchedulerService');
const propExtractionService = require('../src/services/propExtractionService');
const propImageGenerationService = require('../src/services/propImageGenerationService');
const qaService = require('../src/services/qaService');
const skillRegistryService = require('../src/services/skillRegistryService');
const sourceIntakeService = require('../src/services/sourceIntakeService');
const storyGenerationService = require('../src/services/storyGenerationService');
const taskService = require('../src/services/taskService');
const workflowService = require('../src/services/workflowService');

const log = { info() {}, warn() {}, error() {}, errorw() {} };

const SERVICE_FILES = [
  'storyGenerationService.js',
  'backgroundExtractionService.js',
  'framePromptService.js',
  'episodeStoryboardProcessGenerate.js',
  'propExtractionService.js',
  'propImageGenerationService.js',
  'qaService.js',
  'qaServiceChecks.js',
  'workflowService.js',
  'workflowQueue.js',
  'workflowStatus.js',
];

const FORBIDDEN_SOURCE = [
  "'AI 提取失败: ' +",
  "'AI提取场景失败: ' +",
  "'图片生成请求失败: ' +",
  "'解析分镜头结果失败: ' +",
  "err.message || '故事生成失败'",
  "err.message || '场景提取失败'",
  "err.message || '生成失败'",
  "err.message || '生成分镜头失败'",
  'error_message: `连接中断（${err.message}',
  'parseMeta.error_message = `AI输出含JSON格式缺陷（${e.message}',
];

function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function englishCases() {
  const sqlite = new Error('SQLITE_ERROR: no such table: episodes');
  sqlite.code = 'SQLITE_ERROR';
  const http = new Error('HTTP 502 Bad Gateway');
  http.status = 502;
  return [
    { name: 'fetch failed', error: new Error('fetch failed'), leak: /fetch failed/i },
    { name: 'SQLITE', error: sqlite, leak: /SQLITE_ERROR|no such table/i },
    { name: 'HTTP', error: http, leak: /HTTP 502|Bad Gateway/i },
  ];
}

function assertSafeUserText(text, leak) {
  const message = String(text || '');
  assert.equal(hasCjk(message), true, message);
  assert.doesNotMatch(message, leak);
  assert.doesNotMatch(message, /fetch failed|SQLITE_ERROR|no such table|HTTP 502|Bad Gateway|AbortError/i);
}

async function waitFor(predicate, message, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail(message);
}

async function waitForFailedTask(db, taskId) {
  await waitFor(
    () => taskService.getTask(db, taskId)?.status === 'failed',
    `任务 ${taskId} 未在超时前失败`
  );
  return taskService.getTask(db, taskId);
}

async function waitForIdle() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && getLegacyAsyncSchedulerState().active !== 0) {
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function createFixture(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const drama = dramaService.createDrama(db, log, { title: '任务错误文案' });
  dramaService.saveEpisodes(db, log, drama.id, {
    episodes: [{ episode_number: 1, title: '第一集', script_content: '桌上放着一枚铜制钥匙。' }],
  });
  const episode = db.prepare(
    'SELECT * FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).get(drama.id);
  const now = new Date().toISOString();
  const storyboardId = Number(db.prepare(
    `INSERT INTO storyboards
       (episode_id, storyboard_number, title, description, status, created_at, updated_at)
     VALUES (?, 1, '第一镜', '角色拿起钥匙', 'pending', ?, ?)`
  ).run(episode.id, now, now).lastInsertRowid);
  const propId = Number(db.prepare(
    `INSERT INTO props
       (drama_id, episode_id, name, prompt, created_at, updated_at)
     VALUES (?, ?, '铜制钥匙', 'an antique brass key', ?, ?)`
  ).run(drama.id, episode.id, now, now).lastInsertRowid);
  t.after(async () => {
    await waitForIdle();
    db.close();
  });
  return { db, drama, episode, storyboardId, propId };
}

function insertSource(db, dramaId) {
  const now = new Date().toISOString();
  const source = db.prepare(
    `INSERT INTO story_sources (drama_id, source_type, title, content_hash, metadata, created_at)
     VALUES (?, 'storyboard', 'Fixture source', 'fixture-hash', '{}', ?)`
  ).run(dramaId, now);
  return Number(source.lastInsertRowid);
}

test('任务失败源码不再把 err.message 拼进用户可见文案', () => {
  for (const name of SERVICE_FILES) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services', name), 'utf8');
    for (const phrase of FORBIDDEN_SOURCE) {
      assert.equal(source.includes(phrase), false, `${name} 仍包含：${phrase}`);
    }
    assert.match(source, /toUserFacingProcessError|toUserFacingWorkflowError/);
    assert.equal(source.includes('episode_id must belong to drama_id'), false, name);
  }
});

test('toUserFacingProcessError 会去掉混在中文里的 SQLITE 英文', () => {
  const { toUserFacingProcessError } = require('../src/services/providerErrorSanitizer');
  const mixed = toUserFacingProcessError(new Error('保存失败: no such table: episodes'), '场景提取失败，请稍后重试');
  assert.equal(mixed, '场景提取失败，请稍后重试');
  assert.doesNotMatch(mixed, /no such table|SQLITE/i);
  assert.equal(toUserFacingProcessError(new Error('请先选择剧集'), '失败'), '请先选择剧集');
});

test('剧本生成失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, drama } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(aiClient, 'generateText', async () => { throw item.error; });
    const taskId = storyGenerationService.startStoryGeneration(db, log, {
      drama_id: drama.id,
      premise: '生成新剧本',
    });
    const task = await waitForFailedTask(db, taskId);
    assertSafeUserText(task.error, item.leak);
    t.mock.reset();
  }
  t.mock.method(aiClient, 'generateText', async () => { throw new Error('请先选择剧集'); });
  const taskId = storyGenerationService.startStoryGeneration(db, log, {
    drama_id: drama.id,
    premise: '生成新剧本',
  });
  const task = await waitForFailedTask(db, taskId);
  assert.equal(task.error, '请先选择剧集');
});

test('场景提取失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, episode } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(aiClient, 'generateText', async () => { throw item.error; });
    const taskId = backgroundExtractionService.extractBackgroundsForEpisode(db, {}, log, episode.id);
    const task = await waitForFailedTask(db, taskId);
    assertSafeUserText(task.error, item.leak);
    t.mock.reset();
  }
  t.mock.method(aiClient, 'generateText', async () => { throw new Error('请先选择剧集'); });
  const taskId = backgroundExtractionService.extractBackgroundsForEpisode(db, {}, log, episode.id);
  const task = await waitForFailedTask(db, taskId);
  assert.equal(task.error, '请先选择剧集');
});

test('道具提取失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, episode } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(aiClient, 'generateText', async () => { throw item.error; });
    const task = taskService.createTask(db, log, 'prop_extraction', String(episode.id));
    await propExtractionService.processPropExtraction(db, log, task.id, episode.id);
    const failed = taskService.getTask(db, task.id);
    assert.equal(failed.status, 'failed');
    assertSafeUserText(failed.error, item.leak);
    t.mock.reset();
  }
  t.mock.method(aiClient, 'generateText', async () => { throw new Error('请先选择剧集'); });
  const task = taskService.createTask(db, log, 'prop_extraction', String(episode.id));
  await propExtractionService.processPropExtraction(db, log, task.id, episode.id);
  assert.equal(taskService.getTask(db, task.id).error, '请先选择剧集');
});

test('道具图片失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, propId } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(imageClient, 'callImageApi', async () => { throw item.error; });
    const task = taskService.createTask(db, log, 'prop_image_generation', String(propId));
    await propImageGenerationService.processPropImageGeneration(db, log, task.id, propId, {});
    const failed = taskService.getTask(db, task.id);
    assert.equal(failed.status, 'failed');
    assertSafeUserText(failed.error, item.leak);
    const prop = db.prepare('SELECT error_msg FROM props WHERE id = ?').get(propId);
    assertSafeUserText(prop.error_msg, item.leak);
    t.mock.reset();
  }
  t.mock.method(imageClient, 'callImageApi', async () => { throw new Error('请先选择剧集'); });
  const task = taskService.createTask(db, log, 'prop_image_generation', String(propId));
  await propImageGenerationService.processPropImageGeneration(db, log, task.id, propId, {});
  assert.equal(taskService.getTask(db, task.id).error, '请先选择剧集');
});

test('帧提示词失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, storyboardId } = createFixture(t);
  t.mock.method(aiClient, 'generateText', async () => JSON.stringify({ prompt: 'p', description: 'd' }));
  for (const item of englishCases()) {
    t.mock.method(taskService, 'runTaskMutation', () => { throw item.error; });
    const task = taskService.createTask(db, log, 'frame_prompt_generation', String(storyboardId));
    await framePromptService.processFramePromptGeneration(db, log, task.id, storyboardId, 'first', 0, null);
    const failed = taskService.getTask(db, task.id);
    assert.equal(failed.status, 'failed');
    assertSafeUserText(failed.error, item.leak);
    t.mock.reset();
    t.mock.method(aiClient, 'generateText', async () => JSON.stringify({ prompt: 'p', description: 'd' }));
  }
  t.mock.method(taskService, 'runTaskMutation', () => { throw new Error('请先选择剧集'); });
  const task = taskService.createTask(db, log, 'frame_prompt_generation', String(storyboardId));
  await framePromptService.processFramePromptGeneration(db, log, task.id, storyboardId, 'first', 0, null);
  assert.equal(taskService.getTask(db, task.id).error, '请先选择剧集');
});

test('分镜生成失败对英文错误给出中文任务文案并保留可信中文', async (t) => {
  const { db, episode } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(aiClient, 'generateText', async () => { throw item.error; });
    const created = episodeStoryboardService.generateStoryboard(db, log, episode.id);
    const task = await waitForFailedTask(db, created.task_id);
    assertSafeUserText(task.error, item.leak);
    t.mock.reset();
  }
  t.mock.method(aiClient, 'generateText', async () => { throw new Error('请先选择剧集'); });
  const created = episodeStoryboardService.generateStoryboard(db, log, episode.id);
  const task = await waitForFailedTask(db, created.task_id);
  assert.equal(task.error, '请先选择剧集');
});

test('QA 用户可见 issue 文案对英文错误给出中文并保留可信中文', (t) => {
  const { db, drama } = createFixture(t);
  for (const item of englishCases()) {
    t.mock.method(skillRegistryService, 'getSkillTemplates', () => { throw item.error; });
    const report = qaService.evaluateDrama(db, { drama_id: drama.id, mode: 'draft' });
    const issue = report.issues.find((entry) => entry.code === 'skill_templates_missing');
    const check = report.checks.find((entry) => entry.key === 'skill_template_audit');
    assert.ok(issue, '应有技能模板 issue');
    assertSafeUserText(issue.message, item.leak);
    assertSafeUserText(check.error, item.leak);
    t.mock.reset();
  }
  t.mock.method(skillRegistryService, 'getSkillTemplates', () => { throw new Error('请先选择剧集'); });
  const report = qaService.evaluateDrama(db, { drama_id: drama.id, mode: 'draft' });
  const issue = report.issues.find((entry) => entry.code === 'skill_templates_missing');
  assert.equal(issue.message, '请先选择剧集');
});

test('工作流失败对英文错误给出中文 run/step.error 并保留可信中文', async (t) => {
  const { db, drama } = createFixture(t);
  const sourceId = insertSource(db, drama.id);
  async function runWithThrow(error) {
    t.mock.method(sourceIntakeService, 'getSourceDetail', () => { throw error; });
    const run = workflowService.createWorkflowRun(db, log, {
      drama_id: drama.id,
      source_id: sourceId,
      steps: [{ key: 'source_intake', label: '素材导入' }],
    });
    const detail = await workflowService.processWorkflowRun(db, log, run.id);
    t.mock.reset();
    return detail;
  }
  for (const item of englishCases()) {
    const detail = await runWithThrow(item.error);
    assert.equal(detail.status, 'failed');
    assertSafeUserText(detail.error, item.leak);
    const failedStep = detail.steps.find((step) => step.status === 'failed');
    assert.ok(failedStep);
    assertSafeUserText(failedStep.error, item.leak);
  }
  const kept = await runWithThrow(new Error('请先选择剧集'));
  assert.equal(kept.error, '请先选择剧集');
  const failedStep = kept.steps.find((step) => step.status === 'failed');
  assert.equal(failedStep.error, '请先选择剧集');
});
