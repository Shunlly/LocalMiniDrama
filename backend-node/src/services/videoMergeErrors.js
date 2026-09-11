'use strict';

// 视频合成错误装配：取消、严格生产失败和后处理哨兵码转成用户可见中文。

function operationCancelledError(reason) {
  const error = reason instanceof Error ? reason : new Error(String(reason || '视频合成已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw operationCancelledError(signal.reason);
}

function describePostProcessFailure(error) {
  if (error === 'NO_POST_OPTS') return '当前没有可执行的成片后处理项';
  if (error === 'NO_NARRATION') return '当前没有可烧录的旁白';
  return error || '未生成输出文件';
}

function isOperationCancelled(error, signal) {
  return signal?.aborted || error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError';
}

function strictMergeError(message) {
  const error = new Error(message);
  error.code = 'STRICT_PRODUCTION_MERGE_FAILED';
  return error;
}

function describeInvalidProductionOutput(outputProbe, missingAudioMessage) {
  return outputProbe.ok ? missingAudioMessage : outputProbe.error;
}

module.exports = {
  operationCancelledError,
  throwIfAborted,
  describePostProcessFailure,
  isOperationCancelled,
  strictMergeError,
  describeInvalidProductionOutput,
};
