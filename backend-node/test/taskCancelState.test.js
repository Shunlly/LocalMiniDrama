'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANCEL_STATE_REQUESTED,
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_UNCERTAIN_MSG,
  parseCancelContext,
  serializeCancelContext,
  taskCancelContext,
  isProjectCancelContext,
  taskCancelDetails,
  buildCancelContext,
  shouldKeepExistingProjectContext,
  updateContextAfterUncertain,
  isUncertainOutcome,
  userFacingRemoteCancelError,
} = require('../src/services/taskCancelState');

test('取消上下文解析兼容对象、JSON 字符串和损坏值', () => {
  assert.equal(parseCancelContext(null), null);
  assert.equal(parseCancelContext(''), null);
  assert.deepEqual(parseCancelContext({ scope: 'task' }), { scope: 'task' });
  assert.deepEqual(parseCancelContext('{"scope":"drama_recycle"}'), { scope: 'drama_recycle' });
  assert.equal(parseCancelContext('{not-json'), null);
  assert.equal(parseCancelContext('1'), null);
  assert.deepEqual(taskCancelContext({ cancel_context: '{"reason":"用户已取消"}' }), { reason: '用户已取消' });
});

test('序列化取消上下文始终写出对象 JSON', () => {
  assert.equal(serializeCancelContext(null), '{}');
  assert.equal(serializeCancelContext({ scope: 'task' }), '{"scope":"task"}');
});

test('项目回收取消上下文必须同时具备 scope 和 recycle_operation_id', () => {
  assert.equal(isProjectCancelContext({ scope: 'drama_recycle', recycle_operation_id: 'op-1' }), true);
  assert.equal(isProjectCancelContext({ scope: 'drama_recycle', recycle_operation_id: '' }), false);
  assert.equal(isProjectCancelContext({ scope: 'task', recycle_operation_id: 'op-1' }), false);
  assert.equal(
    shouldKeepExistingProjectContext(
      { scope: 'drama_recycle', recycle_operation_id: 'op-1' },
      { scope: 'task' }
    ),
    true
  );
  assert.equal(
    shouldKeepExistingProjectContext(
      { scope: 'drama_recycle', recycle_operation_id: 'op-1' },
      { scope: 'drama_recycle', recycle_operation_id: 'op-2' }
    ),
    false
  );
});

test('取消详情装配读取状态字段并解析上下文', () => {
  const details = taskCancelDetails({
    cancel_operation_id: 'op-9',
    cancel_state: CANCEL_STATE_REQUESTED,
    cancel_attempt: '2',
    cancel_next_retry_at: '2026-09-11T00:00:00.000Z',
    cancel_context: '{"scope":"task"}',
  });
  assert.deepEqual(details, {
    operation_id: 'op-9',
    state: CANCEL_STATE_REQUESTED,
    attempt: 2,
    next_retry_at: '2026-09-11T00:00:00.000Z',
    context: { scope: 'task' },
  });
});

test('构建取消上下文时 drama_id 不相等不互相覆盖，且保留已有 original_error', () => {
  const existing = {
    scope: 'task',
    drama_id: 11,
    original_status: 'processing',
    original_error: null,
  };
  const built = buildCancelContext(
    existing,
    { scope: 'task', drama_id: 22 },
    { status: 'cancelling', error: '后续错误' },
    '用户取消'
  );
  assert.notEqual(11, 22);
  assert.equal(built.drama_id, 22);
  assert.equal(built.original_status, 'processing');
  assert.equal(built.original_error, null);
  assert.equal(built.reason, '用户取消');

  const fresh = buildCancelContext(null, null, { status: 'pending', error: '旧错误' }, '');
  assert.equal(fresh.reason, USER_CANCEL_TASK_MSG);
  assert.equal(fresh.original_status, 'pending');
  assert.equal(fresh.original_error, '旧错误');
});

test('超时和网络类不确定结果对外返回中文，已有中文错误保留', () => {
  assert.equal(isUncertainOutcome({ uncertain: true, error: 'anything' }), true);
  assert.equal(isUncertainOutcome({ error: 'timeout' }), true);
  assert.equal(isUncertainOutcome({ error: 'ECONNRESET' }), true);
  assert.equal(isUncertainOutcome({ error: '远端取消执行超时（15000ms）' }), true);
  assert.equal(isUncertainOutcome({ error: 'provider refused cancellation' }), false);

  assert.equal(
    userFacingRemoteCancelError({ uncertain: true, error: 'timeout' }),
    REMOTE_CANCEL_UNCERTAIN_MSG
  );
  assert.equal(
    userFacingRemoteCancelError({ uncertain: true, error: 'ETIMEDOUT: connection timed out' }),
    REMOTE_CANCEL_UNCERTAIN_MSG
  );
  assert.equal(
    userFacingRemoteCancelError({ uncertain: true, error: '远端取消执行超时（15000ms）' }),
    '远端取消执行超时（15000ms）'
  );
  assert.match(REMOTE_CANCEL_UNCERTAIN_MSG, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(REMOTE_CANCEL_UNCERTAIN_MSG, /timeout|ETIMEDOUT|timed out/i);

  const next = updateContextAfterUncertain(
    { cancel_context: '{"scope":"task"}' },
    { error: 'timeout' }
  );
  assert.equal(next.last_outcome, 'uncertain');
  assert.equal(next.last_error, REMOTE_CANCEL_UNCERTAIN_MSG);
});
