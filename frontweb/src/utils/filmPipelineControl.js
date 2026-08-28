import { createOperationId, logOperation } from './operationLog.js'

export function createPipelineAbortError(message = '全流程已取消') {
  return Object.assign(new Error(message), { pipelineAborted: true })
}

export function isPipelineAbortError(error) {
  return error?.pipelineAborted === true
}

export function createPipelinePauseGate({ isPaused, isAborted }) {
  if (typeof isPaused !== 'function' || typeof isAborted !== 'function') {
    throw new TypeError('pipeline pause gate requires state readers')
  }

  let resumePromise = null
  let resolveResume = null

  function throwIfAborted() {
    if (isAborted()) throw createPipelineAbortError()
  }

  function release() {
    const resolve = resolveResume
    resolveResume = null
    resumePromise = null
    resolve?.()
  }

  async function wait() {
    throwIfAborted()
    while (isPaused()) {
      if (!resumePromise) {
        resumePromise = new Promise((resolve) => {
          resolveResume = resolve
        })
      }
      await resumePromise
      throwIfAborted()
    }
  }

  return { release, wait }
}

export async function cancelPipelineTasksAroundRun({
  getTaskIds,
  runPromise,
  cancelTask,
  onCancelled = () => {},
}) {
  if (typeof getTaskIds !== 'function' || typeof cancelTask !== 'function') {
    throw new TypeError('pipeline cancellation requires task readers and a cancel function')
  }

  const cancelledTaskIds = new Set()
  const errors = new Map()

  const sweep = async () => {
    const taskIds = [...getTaskIds()].filter((taskId) => !cancelledTaskIds.has(taskId))
    await Promise.all(taskIds.map(async (taskId) => {
      try {
        await cancelTask(taskId)
        cancelledTaskIds.add(taskId)
        errors.delete(taskId)
        onCancelled(taskId)
      } catch (error) {
        errors.set(taskId, error)
      }
    }))
  }

  const operationId = createOperationId('pipeline_task_cancel')
  const startedAt = Date.now()
  logOperation({ operation: 'pipeline_task_cancel', operationId, phase: 'start' })
  try {
    await sweep()
    let runError = null
    if (runPromise) {
      await Promise.resolve(runPromise).catch((error) => {
        runError = error
      })
    }
    await sweep()

    const failedTaskIds = [...getTaskIds()].filter((taskId) => !cancelledTaskIds.has(taskId))
    const result = {
      cancelledTaskIds: [...cancelledTaskIds],
      complete: failedTaskIds.length === 0,
      errors,
      failedTaskIds,
      runError,
    }
    logOperation({
      operation: 'pipeline_task_cancel',
      operationId,
      phase: result.complete ? 'success' : 'error',
      status: result.complete ? 'cancelled' : 'partial',
      durationMs: Date.now() - startedAt,
      cancelledCount: result.cancelledTaskIds.length,
      failedCount: result.failedTaskIds.length,
    })
    return result
  } catch (error) {
    logOperation({
      operation: 'pipeline_task_cancel',
      operationId,
      phase: 'error',
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    })
    throw error
  }
}

export async function runPipelineTaskWithRetry({
  task,
  maxRetries = 3,
  rest = async () => {},
  isAborted = () => false,
  onFailure = () => {},
}) {
  if (typeof task !== 'function') throw new TypeError('pipeline task must be a function')
  const attempts = Math.max(1, Number(maxRetries) || 1)
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (isAborted()) throw createPipelineAbortError()
      const result = await task()
      if (result?.paused === true) return result
      return true
    } catch (error) {
      if (isPipelineAbortError(error)) throw error
      if (isAborted()) throw createPipelineAbortError()
      lastError = error
      if (attempt < attempts - 1) await rest()
    }
  }

  onFailure(lastError)
  return false
}
