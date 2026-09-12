'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  operationCancelledError,
  throwIfAborted,
  describePostProcessFailure,
  isOperationCancelled,
  strictMergeError,
  describeInvalidProductionOutput,
} = require('../src/services/videoMergeErrors');

test('后处理哨兵码转成简体中文，NO_NARRATION 不得漏给用户', () => {
  assert.equal(describePostProcessFailure('NO_POST_OPTS'), '当前没有可执行的成片后处理项');
  assert.equal(describePostProcessFailure('NO_NARRATION'), '当前没有可烧录的旁白');
  assert.equal(describePostProcessFailure('编码器失败'), '编码器失败');
  assert.equal(describePostProcessFailure(''), '未生成输出文件');
  assert.equal(describePostProcessFailure(null), '未生成输出文件');
});

test('取消错误统一为 AbortError / OPERATION_CANCELLED', () => {
  const created = operationCancelledError('用户停止合成');
  assert.equal(created.name, 'AbortError');
  assert.equal(created.code, 'OPERATION_CANCELLED');
  assert.equal(created.message, '用户停止合成');

  const fromError = operationCancelledError(new Error('已取消'));
  assert.equal(fromError.message, '已取消');
  assert.equal(fromError.code, 'OPERATION_CANCELLED');

  const fallback = operationCancelledError();
  assert.equal(fallback.message, '视频合成已取消');

  const controller = new AbortController();
  throwIfAborted(controller.signal);
  controller.abort(created);
  assert.throws(() => throwIfAborted(controller.signal), { code: 'OPERATION_CANCELLED' });
  assert.equal(isOperationCancelled(created, undefined), true);
  assert.equal(isOperationCancelled({ name: 'AbortError' }, undefined), true);
  assert.equal(isOperationCancelled(new Error('other'), controller.signal), true);
  assert.equal(isOperationCancelled(new Error('other'), undefined), false);

  const timeout = Object.assign(new Error('视频合成超时'), { name: 'TimeoutError', isTimeout: true, code: 'ETIMEDOUT' });
  assert.equal(isOperationCancelled(timeout, undefined), false);
  const timeoutController = new AbortController();
  timeoutController.abort(timeout);
  assert.throws(() => throwIfAborted(timeoutController.signal), (error) => error === timeout);
  assert.equal(isOperationCancelled(new Error('other'), timeoutController.signal), false);
});

test('严格生产错误带固定错误码，无效成片探测优先使用缺音轨文案', () => {
  const error = strictMergeError('合成失败');
  assert.equal(error.code, 'STRICT_PRODUCTION_MERGE_FAILED');
  assert.equal(error.message, '合成失败');
  assert.equal(describeInvalidProductionOutput({ ok: true }, '最终视频缺少音轨'), '最终视频缺少音轨');
  assert.equal(describeInvalidProductionOutput({ ok: false, error: '没有可用的视频流' }, '最终视频缺少音轨'), '没有可用的视频流');
});