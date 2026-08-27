const DEFAULT_MAX_ACTIVE = 10_000;
const DEFAULT_REMOTE_CANCEL_TIMEOUT_MS = 5_000;

function createOperationCancelledError(reason) {
  if (reason instanceof Error && reason.code === 'OPERATION_CANCELLED') return reason;
  const error = new Error(reason instanceof Error ? reason.message : String(reason || '操作已取消'));
  error.name = 'AbortError';
  error.code = 'OPERATION_CANCELLED';
  return error;
}

function isUncertainRemoteCancelError(error) {
  if (!error) return false;
  if (error.uncertain === true) return true;
  const code = String(error.code || error.cause?.code || '').toUpperCase();
  if (/^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_)/.test(code)) {
    return true;
  }
  const message = String(error.message || error.error || error);
  return /network|socket|fetch failed|connection reset|timed?\s*out|timeout|网络|连接重置|连接中断|传输失败|请求超时/i.test(message);
}

function normalizeRemoteCancelResult(result) {
  if (result?.outcome === 'unsupported') {
    return { outcome: 'unsupported', remote_supported: false };
  }
  if (result === true || result?.confirmed === true || result?.outcome === 'confirmed') {
    return { outcome: 'confirmed', remote_supported: true };
  }
  return {
    outcome: 'failed',
    remote_supported: true,
    uncertain: result?.uncertain === true || isUncertainRemoteCancelError(result?.error),
    error: result?.error || '远端取消未得到确认',
  };
}

function createOperationRegistry(options = {}) {
  const maxActive = Math.max(1, Number(options.maxActive) || DEFAULT_MAX_ACTIVE);
  const remoteCancelTimeoutMs = Math.max(
    1,
    Number(options.remoteCancelTimeoutMs) || DEFAULT_REMOTE_CANCEL_TIMEOUT_MS
  );
  const active = new Map();

  function operationKey(type, id) {
    return `${String(type)}:${String(id)}`;
  }

  function getOperation(type, id) {
    return active.get(operationKey(type, id))?.handle || null;
  }

  function registerOperation({ type, id, signal } = {}) {
    if (!type || id == null || id === '') throw new Error('操作类型和 ID 必填');
    const key = operationKey(type, id);
    const existing = active.get(key);
    if (existing) return existing.handle;
    if (active.size >= maxActive) {
      const error = new Error('操作注册表容量已满');
      error.code = 'OPERATION_REGISTRY_CAPACITY';
      throw error;
    }

    const controller = new AbortController();
    let remoteState = 'none';
    let remoteCancel = null;
    let remoteClosedResult = null;
    let remoteReadyResolve = null;
    let cancelResult = null;
    let finished = false;
    let remoteRegistrationTimeoutMs = remoteCancelTimeoutMs;
    const forwardAbort = () => controller.abort(createOperationCancelledError(signal?.reason));
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    const entry = { handle: null, cancel: null };
    const notifyRemoteReady = () => {
      remoteReadyResolve?.();
      remoteReadyResolve = null;
    };
    const waitForRemoteRegistration = () => new Promise((resolve) => {
      remoteReadyResolve = resolve;
    });

    const abortLocally = () => {
      if (!controller.signal.aborted) controller.abort(createOperationCancelledError());
    };

    const invokeRemoteCancel = async () => {
      let timer;
      const controller = new AbortController();
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            resolve({
              outcome: 'failed',
              remote_supported: true,
              uncertain: true,
              error: `远端取消执行超时（${remoteCancelTimeoutMs}ms）`,
            });
            controller.abort(createOperationCancelledError('远端取消执行超时'));
          }, remoteCancelTimeoutMs);
        });
        const invocation = Promise.resolve()
          .then(() => remoteCancel({ signal: controller.signal, timeout_ms: remoteCancelTimeoutMs }))
          .then(normalizeRemoteCancelResult);
        return await Promise.race([invocation, timeout]);
      } catch (error) {
        return {
          outcome: 'failed',
          remote_supported: true,
          // 回调抛错只说明本地没有拿到结果，不能据此断言 Provider 拒绝取消。
          uncertain: true,
          error: error?.message || String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    };

    const waitForRemoteCancel = async () => {
      if (remoteState === 'registered') return invokeRemoteCancel();
      if (remoteState === 'closed') return remoteClosedResult;
      if (remoteState !== 'pending') {
        return { outcome: 'unsupported', remote_supported: false };
      }

      let timer;
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve('timeout'), remoteRegistrationTimeoutMs);
        });
        const ready = waitForRemoteRegistration().then(() => 'ready');
        const state = await Promise.race([ready, timeout]);
        if (state === 'timeout') {
          return {
            outcome: 'failed',
            remote_supported: true,
            uncertain: true,
            error: `等待远端取消注册超时（${remoteRegistrationTimeoutMs}ms）`,
          };
        }
        if (remoteState === 'registered') return invokeRemoteCancel();
        return remoteClosedResult || {
          outcome: 'failed',
          remote_supported: true,
          uncertain: true,
          error: '远端取消注册窗口已关闭',
        };
      } finally {
        clearTimeout(timer);
      }
    };

    const handle = {
      type: String(type),
      id: String(id),
      signal: controller.signal,
      markRemoteCancelPending(options = {}) {
        const requestedTimeout = Number(options.timeout_ms);
        if (Number.isFinite(requestedTimeout) && requestedTimeout > 0) {
          remoteRegistrationTimeoutMs = Math.max(remoteCancelTimeoutMs, requestedTimeout);
        }
        if (options.reset === true && !controller.signal.aborted) {
          remoteCancel = null;
          remoteClosedResult = null;
          cancelResult = null;
          remoteState = 'pending';
        } else if (remoteState === 'none') {
          remoteState = 'pending';
        }
        return handle;
      },
      setRemoteCancel(fn) {
        if (typeof fn !== 'function') return handle;
        remoteCancel = fn;
        remoteState = 'registered';
        remoteClosedResult = null;
        notifyRemoteReady();
        return handle;
      },
      closeRemoteCancelWindow(result = { outcome: 'unsupported', remote_supported: false }) {
        if (remoteState === 'registered') return handle;
        remoteClosedResult = normalizeRemoteCancelResult(result);
        if (remoteClosedResult.outcome === 'failed') {
          remoteClosedResult = { ...remoteClosedResult, uncertain: true };
        }
        remoteState = 'closed';
        notifyRemoteReady();
        return handle;
      },
      hasRemoteCancel() {
        return remoteState === 'registered';
      },
      resetCancellation() {
        if (!controller.signal.aborted) cancelResult = null;
      },
      finish() {
        if (finished) return;
        finished = true;
        notifyRemoteReady();
        signal?.removeEventListener('abort', forwardAbort);
        if (active.get(key) === entry) active.delete(key);
      },
    };

    entry.handle = handle;
    entry.cancel = () => {
      if (cancelResult) return cancelResult;
      cancelResult = (async () => {
        const result = await waitForRemoteCancel();
        if (result.outcome !== 'failed') abortLocally();
        return result;
      })();
      return cancelResult;
    };
    active.set(key, entry);
    return handle;
  }

  function cancelOperation(type, id) {
    const entry = active.get(operationKey(type, id));
    if (!entry) return Promise.resolve({ outcome: 'unsupported', remote_supported: false });
    return entry.cancel();
  }

  function finishOperation(type, id) {
    getOperation(type, id)?.finish();
  }

  function getState() {
    return { active: active.size, capacity: maxActive };
  }

  return { cancelOperation, finishOperation, getOperation, getState, registerOperation };
}

const operationRegistry = createOperationRegistry();

module.exports = {
  cancelOperation: operationRegistry.cancelOperation,
  createOperationCancelledError,
  createOperationRegistry,
  finishOperation: operationRegistry.finishOperation,
  getOperation: operationRegistry.getOperation,
  getOperationRegistryState: operationRegistry.getState,
  registerOperation: operationRegistry.registerOperation,
};
