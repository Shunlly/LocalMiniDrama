const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const workflowService = require('../src/services/workflowService');

function createDb(t) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, description, style, status, created_at, updated_at)
     VALUES (1, 'Cancel logs', 'Workflow cancel fixture', 'anime', 'draft', ?, ?)`
  ).run(now, now);
  t.after(() => db.close());
  return db;
}

test('cancelWorkflowRun 留下取消和已终结生命周期日志', (t) => {
  const db = createDb(t);
  const events = [];
  const log = {
    info() {},
    warn() {},
    error() {},
    operation(event) { events.push(event); },
  };
  const run = workflowService.createWorkflowRun(db, log, {
    drama_id: 1,
    type: 'novel2anime:cancel-log',
    steps: [{ key: 'text', label: 'Text' }],
  });

  const cancelled = workflowService.cancelWorkflowRun(db, log, run.id, 'test cancellation');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(
    events.some((event) => event.operation === 'workflow_cancel' && event.phase === 'cancel' && event.status === 'cancelled'),
    true,
    JSON.stringify(events),
  );

  workflowService.cancelWorkflowRun(db, log, run.id, 'again');
  assert.equal(
    events.some((event) => event.operation === 'workflow_cancel' && event.status === 'already_terminal'),
    true,
    JSON.stringify(events),
  );
});