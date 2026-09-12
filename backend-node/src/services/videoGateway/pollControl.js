'use strict';

/**
 * 视频轮询的取消判定与可中断延迟。
 * 即梦同步短路仍留在 pollTask，这里不发真实厂商请求。
 */

const {
  isRequestCanceled,
  isRequestTimeout,
  operationCancelledError,
} = require('./requestError');

/** 本地 abort 与厂商 cancelled 都视为取消，不得落到超时。 */
const VIDEO_TASK_CANCELLED_MESSAGE = '视频任务已取消';

function isVideoPollCancelled(error, signal) {
  return !isRequestTimeout(error, signal)
    && (isRequestCanceled(error, signal) || signal?.aborted === true);
}

function throwVideoTaskCancelled() {
  throw operationCancelledError(VIDEO_TASK_CANCELLED_MESSAGE);
}

function throwIfVideoPollAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (isRequestTimeout(reason, signal)) throw reason;
  throwVideoTaskCancelled();
}

function delayVideoPoll(intervalMs, signal) {
  throwIfVideoPollAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const reason = signal.reason;
      if (isRequestTimeout(reason, signal)) {
        reject(reason);
        return;
      }
      reject(operationCancelledError(VIDEO_TASK_CANCELLED_MESSAGE));
    };
    const timer = setTimeout(finish, intervalMs);
    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = {
  isVideoPollCancelled,
  throwVideoTaskCancelled,
  throwIfVideoPollAborted,
  delayVideoPoll,
};
