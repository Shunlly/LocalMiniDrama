'use strict';

/**
 * 从 comfyUiClient 拆出的轮询控制：取消、超时与可中断等待。
 * 本模块不发真实 ComfyUI 请求。
 */

const { createAbortError } = require('./comfyUiErrors');
const { interpretHistoryPoll } = require('./comfyUiProtocol');

function throwIfComfyPollAborted(signal, promptId) {
  if (signal?.aborted) throw createAbortError('COMFYUI_CANCELLED', promptId);
}

function throwIfComfyPollTimedOut(deadline, promptId) {
  if (Date.now() >= deadline) throw createAbortError('COMFYUI_TIMEOUT', promptId);
}

function abortableDelay(ms, signal, promptId) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createAbortError('COMFYUI_CANCELLED', promptId));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError('COMFYUI_CANCELLED', promptId));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForComfyUiCompletion({ promptId, context, settings, queryHistory }) {
  while (true) {
    throwIfComfyPollAborted(context.signal, promptId);
    throwIfComfyPollTimedOut(context.deadline, promptId);
    context.promptId = promptId;
    const history = await queryHistory();
    const interpreted = interpretHistoryPoll(history, promptId, settings, context.secrets);
    if (interpreted.status === 'failed') throw interpreted.error;
    if (interpreted.status === 'completed') return interpreted.images;
    await abortableDelay(context.pollIntervalMs, context.signal, promptId);
  }
}

module.exports = {
  abortableDelay,
  throwIfComfyPollAborted,
  throwIfComfyPollTimedOut,
  waitForComfyUiCompletion,
};
