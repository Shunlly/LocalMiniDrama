const assert = require('node:assert/strict');
const test = require('node:test');
const { applyWorkflowTypeFilter } = require('../src/services/workflowService');

test('workflow type filter treats unprefixed names as a family', () => {
  const params = [];
  const sql = applyWorkflowTypeFilter('SELECT * FROM workflow_runs WHERE 1=1', params, 'novel2anime');
  assert.equal(sql, 'SELECT * FROM workflow_runs WHERE 1=1 AND (type = ? OR type LIKE ?)');
  assert.deepEqual(params, ['novel2anime', 'novel2anime:%']);
});

test('workflow type filter keeps exact match for subtype keys', () => {
  const params = [];
  const sql = applyWorkflowTypeFilter(
    'SELECT run.* FROM workflow_runs run WHERE 1=1',
    params,
    'novel2anime:repair_storyboards',
    'run.type',
  );
  assert.equal(sql, 'SELECT run.* FROM workflow_runs run WHERE 1=1 AND run.type = ?');
  assert.deepEqual(params, ['novel2anime:repair_storyboards']);
});

test('workflow type filter ignores empty type', () => {
  const params = [];
  const sql = applyWorkflowTypeFilter('SELECT 1', params, '  ');
  assert.equal(sql, 'SELECT 1');
  assert.deepEqual(params, []);
});
