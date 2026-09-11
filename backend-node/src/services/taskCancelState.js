'use strict';

// 从 taskService 拆出的取消状态：上下文解析、状态常量和用户可见取消/超时文案。

const CANCEL_STATE_REQUESTED = 'requested';
const CANCEL_STATE_ATTEMPTING = 'attempting';
const CANCEL_STATE_RETRY_WAIT = 'retry_wait';
const CANCEL_STATE_CONFIRMED = 'confirmed';
const CANCEL_STATE_EXHAUSTED = 'exhausted';
const CANCEL_STATE_REJECTED = 'rejected';

const USER_CANCEL_TASK_MSG = '用户已取消';
const REMOTE_CANCEL_EXHAUSTED_MSG = '远端取消多次未确认，任务已停止本地接收结果，请在供应商控制台核验';
const REMOTE_CANCEL_SUPERSEDED_MSG = '取消请求已由更新的操作接管，请查看最新任务状态';
const REMOTE_CANCEL_UNCERTAIN_MSG = '远端取消结果不确定';
const REMOTE_CANCEL_WAIT_MSG = '远端取消结果仍在确认或退避等待中';
const REMOTE_CANCEL_FAILED_MSG = '远端取消失败';
const REMOTE_CANCEL_REJECTED_MSG = '远端拒绝取消';
const REMOTE_CANCEL_MISSING_ORIGINAL_STATUS_MSG = '远端拒绝取消，原任务状态缺失，已转为明确失败终态';

function parseCancelContext(value) {
  if (!value) return null;
  if (typeof value === 'object') return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function serializeCancelContext(context) {
  return JSON.stringify(context || {});
}

function taskCancelContext(row) {
  return parseCancelContext(row?.cancel_context);
}

function isProjectCancelContext(context) {
  return context?.scope === 'drama_recycle' && String(context.recycle_operation_id || '') !== '';
}

function taskCancelDetails(row) {
  return {
    operation_id: row?.cancel_operation_id || null,
    state: row?.cancel_state || null,
    attempt: Number(row?.cancel_attempt) || 0,
    next_retry_at: row?.cancel_next_retry_at || null,
    context: taskCancelContext(row),
  };
}

function buildCancelContext(existing, incoming, task, reason) {
  const current = existing || {};
  const scope = incoming?.scope || current.scope || 'task';
  const originalStatus = current.original_status || (
    task.status === 'pending' || task.status === 'processing' ? task.status : null
  );
  const originalError = Object.prototype.hasOwnProperty.call(current, 'original_error')
    ? current.original_error
    : task.error || null;
  return {
    ...current,
    scope,
    drama_id: incoming?.drama_id ?? current.drama_id ?? null,
    recycle_operation_id: incoming?.recycle_operation_id || current.recycle_operation_id || null,
    original_status: originalStatus,
    original_error: originalError,
    reason: reason || current.reason || USER_CANCEL_TASK_MSG,
    last_error: current.last_error || null,
    last_outcome: current.last_outcome || null,
  };
}

function shouldKeepExistingProjectContext(existing, incoming) {
  return isProjectCancelContext(existing) && incoming?.scope !== 'drama_recycle';
}

function updateContextAfterUncertain(row, outcome) {
  const context = taskCancelContext(row) || {};
  return {
    ...context,
    last_error: userFacingRemoteCancelError(outcome, REMOTE_CANCEL_UNCERTAIN_MSG),
    last_outcome: 'uncertain',
  };
}

function isUncertainOutcome(outcome) {
  if (outcome?.uncertain === true) return true;
  const message = String(outcome?.error || '');
  return /超时|timeout|timed?\s*out|network|socket|ECONN|EAI_AGAIN|连接|传输|调度/i.test(message);
}

function userFacingRemoteCancelError(outcome, fallback = REMOTE_CANCEL_UNCERTAIN_MSG) {
  const message = String(outcome?.error || '').trim();
  if (/[\u4e00-\u9fff]/.test(message)) return message.slice(0, 2000);
  if (isUncertainOutcome(outcome)) return fallback;
  return (message || fallback).slice(0, 2000);
}

module.exports = {
  CANCEL_STATE_REQUESTED,
  CANCEL_STATE_ATTEMPTING,
  CANCEL_STATE_RETRY_WAIT,
  CANCEL_STATE_CONFIRMED,
  CANCEL_STATE_EXHAUSTED,
  CANCEL_STATE_REJECTED,
  USER_CANCEL_TASK_MSG,
  REMOTE_CANCEL_EXHAUSTED_MSG,
  REMOTE_CANCEL_SUPERSEDED_MSG,
  REMOTE_CANCEL_UNCERTAIN_MSG,
  REMOTE_CANCEL_WAIT_MSG,
  REMOTE_CANCEL_FAILED_MSG,
  REMOTE_CANCEL_REJECTED_MSG,
  REMOTE_CANCEL_MISSING_ORIGINAL_STATUS_MSG,
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
};
