import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { requestCoreJson } from '@/utils/coreJsonRequest'
import { runConcurrently as runConcurrentQueue } from '@/utils/filmCreateConcurrency'
import {
  cancelPipelineTasksAroundRun,
  createPipelineAbortError,
  createPipelinePauseGate,
  isPipelineAbortError,
  runPipelineTaskWithRetry,
} from '@/utils/filmPipelineControl'
import { DEFAULT_POLL_TIMEOUT_MS } from '@/utils/requestError'
import { isStoryboardMediaStateError } from '@/utils/storyboardMedia'

export function useFilmCreatePipelineRun(options = {}) {
  const {
    store,
    videoClipDuration,
    taskAPI,
    genStore,
    trackFilmCreateAction,
    getStoryboardCountForApi,
    resolvePollMeta,
  } = options

  const pipelineRunning = ref(false)
  const pipelineStarting = ref(false)
  const pipelineStopping = ref(false)
  const pipelinePaused = ref(false)
  const pipelineAbortRequested = ref(false)
  const pipelineErrorLog = ref([])
  const pipelineCurrentStep = ref('')
  const pipelineStepIndex = ref(0)    // 当前步骤序号（1-based）
  /** 全流程 10 步；仅文本框架为前 4 步 */
  const pipelineStepTotal = ref(10)
  const pipelineOwnedTaskIds = new Set()
  const activePipelineRunPromise = ref(null)
  let pipelineRequiresStoryboardMedia = false
  const pipelinePauseGate = createPipelinePauseGate({
    isPaused: () => pipelinePaused.value,
    isAborted: () => pipelineAbortRequested.value,
  })
  // 倒计时（两个生成阶段之间的确认窗口）
  const pipelineCountdown = ref(0)      // 剩余秒数，0 表示不在倒计时
  const pipelineCountdownMsg = ref('')  // 倒计时说明文字
  const pipelineConcurrency = ref(3)
  const pipelineVideoConcurrency = ref(3)
  const pipelineActiveTasks = reactive(new Set())

  async function loadPipelineConcurrency() {
    try {
      const res = await requestCoreJson('/settings/generation')
      pipelineConcurrency.value = Math.max(1, Number(res?.concurrency) || 3)
      pipelineVideoConcurrency.value = Math.max(1, Number(res?.video_concurrency) || 3)
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * 带并发度的批量执行器。
   * @param {Array} items - 需要处理的项目列表
   * @param {number} concurrency - 最大并发数
   * @param {Function} fn - async (item, index) => void，内部可 throw
   * @param {{ getLabel?: (item) => string }} options
   * @returns {Promise<void>}
   */
  async function runConcurrently(items, concurrency, fn, options = {}) {
    return runConcurrentQueue(items, concurrency, fn, {
      ...options,
      activeTasks: pipelineActiveTasks,
    })
  }

  async function cancelPipelineRun() {
    if (pipelineStopping.value) return false
    if (!pipelineStarting.value && !pipelineRunning.value && !activePipelineRunPromise.value && pipelineOwnedTaskIds.size === 0) return true

    pipelineStopping.value = true
    pipelineAbortRequested.value = true
    pipelinePaused.value = false
    pipelinePauseGate.release()
    pipelineCurrentStep.value = '正在停止本地执行并结束前端等待...'
    trackFilmCreateAction('pipeline_stop_start')

    const runPromise = activePipelineRunPromise.value

    let cancellationComplete = false
    try {
      const cancellation = await cancelPipelineTasksAroundRun({
        getTaskIds: () => pipelineOwnedTaskIds,
        runPromise,
        cancelTask: async (taskId) => {
          try {
            await taskAPI.cancel(taskId, { reason: '用户停止全流程' }, { suppressErrorToast: true })
          } catch (error) {
            if (error?.response?.status !== 404) throw error
          }
        },
        onCancelled: (taskId) => {
          genStore.stopPollingTask(taskId, '已停止本地等待')
          pipelineOwnedTaskIds.delete(taskId)
        },
      })
      if (cancellation.runError && !isPipelineAbortError(cancellation.runError)) {
        console.warn('[pipeline] run failed while stopping:', cancellation.runError?.message)
      }
      cancellationComplete = cancellation.complete
      trackFilmCreateAction(cancellationComplete ? 'pipeline_stop_complete' : 'pipeline_stop_failed', {
        extra: {
          cancelled_count: cancellation.cancelledTaskIds.length,
          failed_count: cancellation.failedTaskIds.length,
        },
      })
      if (cancellationComplete) {
        ElMessage.warning('本地全流程已停止；已提交的供应商任务和计费可能继续，请稍后刷新任务状态')
      } else {
        ElMessage.error(`本地全流程已停止等待，但仍有 ${cancellation.failedTaskIds.length} 个任务状态未能标记为已停止；供应商任务和计费可能继续，请刷新后再处理`)
      }
    } catch (error) {
      trackFilmCreateAction('pipeline_stop_failed', { extra: { message: error?.message || '停止全流程失败' } })
      ElMessage.error(error?.message || '停止全流程失败，请重试')
    } finally {
      pipelineStarting.value = false
      pipelineStopping.value = false
      pipelinePaused.value = false
      pipelinePauseGate.release()
      pipelineActiveTasks.clear()
      if (cancellationComplete) {
        pipelineOwnedTaskIds.clear()
        pipelineRunning.value = false
        pipelineCurrentStep.value = '本地全流程已停止；供应商任务可能继续'
      } else {
        pipelineRunning.value = true
        pipelineCurrentStep.value = '停止未完成，请重试处理剩余本地任务'
      }
    }
    return cancellationComplete
  }

  /** 流水线轮询：暂停仅挂起，恢复后继续查询同一个 task_id。 */
  async function pollTaskWithPause(taskId, onDone, meta = {}) {
    const resolvedMeta = resolvePollMeta ? resolvePollMeta(meta) : { ...meta }
    const trackInStore = resolvedMeta.resourceType !== 'unknown' && resolvedMeta.resourceId != null
    if (trackInStore && taskId) {
      genStore.markRunning({ ...resolvedMeta, taskId })
    }
    pipelineOwnedTaskIds.add(taskId)
    const maxAttempts = 450  // 450 × 2s = 15 分钟
    const interval = 2000
    const finishStore = (status, error) => {
      if (!trackInStore || !taskId) return
      if (status === 'completed') genStore.markDone({ ...resolvedMeta, taskId })
      else genStore.markFailed({ ...resolvedMeta, taskId }, error || '任务失败')
    }

    try {
      for (let attempts = 0; attempts < maxAttempts; attempts += 1) {
        await new Promise((resolve) => setTimeout(resolve, interval))
        await pipelinePauseGate.wait()

        let task
        try {
          task = await taskAPI.get(taskId, { suppressErrorToast: true, timeout: DEFAULT_POLL_TIMEOUT_MS })
        } catch (pollErr) {
          if (pipelineAbortRequested.value) throw createPipelineAbortError()
          console.warn('[pollTaskWithPause] poll attempt failed:', pollErr?.message)
          continue
        }

        await pipelinePauseGate.wait()
        const status = String(task?.status || '').toLowerCase()
        if (status === 'completed') {
          if (onDone) await onDone()
          finishStore('completed')
          return { status: 'completed', result: task.result }
        }
        if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
          const errMsg = (task?.error || task?.message || (status === 'failed' ? '任务失败' : '任务已取消')).trim()
          finishStore('failed', errMsg)
          return { status, error: errMsg }
        }
      }

      const timeoutMsg = '任务查询超时（超过15分钟）'
      finishStore('failed', timeoutMsg)
      return { status: 'timeout', error: timeoutMsg }
    } catch (error) {
      if (isPipelineAbortError(error) || pipelineAbortRequested.value) {
        finishStore('failed', '全流程已取消')
        throw isPipelineAbortError(error) ? error : createPipelineAbortError()
      }
      throw error
    } finally {
      if (!pipelineAbortRequested.value) pipelineOwnedTaskIds.delete(taskId)
    }
  }

  function onPipelineResume() {
    pipelinePaused.value = false
    pipelinePauseGate.release()
  }

  function addPipelineError(step, message) {
    if (pipelineAbortRequested.value) throw createPipelineAbortError()
    const time = new Date().toLocaleTimeString('zh-CN')
    pipelineErrorLog.value = [...pipelineErrorLog.value, { time, step, message }]
  }

  async function checkPause() {
    await pipelinePauseGate.wait()
    const storyboardMediaActionReason = options.storyboardMediaActionReason
    if (pipelineRequiresStoryboardMedia && storyboardMediaActionReason.value) {
      throw new Error(storyboardMediaActionReason.value)
    }
  }

  /** 每生成好一个图片或内容后休息，防止任务队列过紧 */
  function pipelineRest() {
    return new Promise((r) => setTimeout(r, 1000))
  }

  /** 跳过倒计时，立即进入下一阶段 */
  function skipPipelineCountdown() {
    pipelineCountdown.value = 0
  }

  /** 阶段间倒计时，支持暂停冻结 + 立即跳过 */
  async function runPipelineCountdown(totalSeconds, msg) {
    pipelineCountdown.value = totalSeconds
    pipelineCountdownMsg.value = msg
    try {
      while (pipelineCountdown.value > 0) {
        await checkPause()                              // 暂停时冻结在此
        await new Promise((r) => setTimeout(r, 1000))  // 等 1 秒
        if (pipelineCountdown.value > 0) pipelineCountdown.value--
      }
    } finally {
      pipelineCountdown.value = 0
      pipelineCountdownMsg.value = ''
    }
  }

  /** 执行可失败步骤；普通错误按上限重试，流水线取消必须立即穿透。 */
  async function pipelineWithRetry(stepName, fn, maxRetries = 3) {
    let mediaStateError = null
    const result = await runPipelineTaskWithRetry({
      task: async () => {
        try {
          return await fn()
        } catch (error) {
          if (isStoryboardMediaStateError(error)) mediaStateError = error
          throw error
        }
      },
      maxRetries,
      rest: async () => {
        if (mediaStateError) throw mediaStateError
        await pipelineRest()
      },
      isAborted: () => pipelineAbortRequested.value,
      onFailure: (error) => {
        addPipelineError(stepName, `重试${maxRetries}次均失败: ${error?.message || String(error)}`)
      },
    })
    if (mediaStateError) throw mediaStateError
    return result
  }

  async function confirmProductionPipelineCost() {
    const configuredStoryboardCount = Number(getStoryboardCountForApi?.()) || 0
    const storyboardCount = Math.max(store.storyboards?.length || 0, configuredStoryboardCount)
    const clipSeconds = Math.max(1, Number(videoClipDuration.value) || 5)
    const expectedVideoSeconds = storyboardCount * clipSeconds
    const scope = storyboardCount > 0
      ? `当前按约 ${storyboardCount} 个分镜、最多约 ${expectedVideoSeconds} 秒分镜视频执行。`
      : '分镜数量将在文本阶段生成后确定。'
    const message = [
      '完整成片会按缺失内容依次调用文本、图片、视频与合成服务，可能产生多次计费。',
      scope,
      '已有可用素材会跳过；实际费用以当前 AI 配置中的服务商价格和最终调用结果为准。',
    ].join('\n')

    try {
      await ElMessageBox.confirm(message, '确认开始完整成片', {
        confirmButtonText: '确认调用并开始',
        cancelButtonText: '暂不开始',
        type: 'warning',
        distinguishCancelAndClose: true,
      })
      return true
    } catch (_) {
      return false
    }
  }

  async function executeOwnedPipelineRun(run, { requireStoryboardMedia = false } = {}) {
    pipelineRunning.value = true
    pipelinePaused.value = false
    pipelineRequiresStoryboardMedia = requireStoryboardMedia
    pipelinePauseGate.release()
    const runPromise = Promise.resolve().then(run)
    activePipelineRunPromise.value = runPromise

    try {
      await runPromise
    } catch (error) {
      if (!isPipelineAbortError(error)) throw error
    } finally {
      if (activePipelineRunPromise.value === runPromise) activePipelineRunPromise.value = null
      pipelineRequiresStoryboardMedia = false
      if (!pipelineStopping.value) {
        pipelineRunning.value = false
        pipelinePaused.value = false
        pipelineActiveTasks.clear()
        if (!pipelineAbortRequested.value) pipelineOwnedTaskIds.clear()
      }
    }
  }

  function setPipelineStep(idx, text) {
    pipelineStepIndex.value = idx
    pipelineCurrentStep.value = `[步骤 ${idx}/${pipelineStepTotal.value}] ${text}`
  }

  return {
    pipelineRunning,
    pipelineStarting,
    pipelineStopping,
    pipelinePaused,
    pipelineAbortRequested,
    pipelineErrorLog,
    pipelineCurrentStep,
    pipelineStepIndex,
    pipelineStepTotal,
    pipelineOwnedTaskIds,
    activePipelineRunPromise,
    pipelineCountdown,
    pipelineCountdownMsg,
    pipelineConcurrency,
    pipelineVideoConcurrency,
    pipelineActiveTasks,
    loadPipelineConcurrency,
    runConcurrently,
    cancelPipelineRun,
    pollTaskWithPause,
    onPipelineResume,
    addPipelineError,
    checkPause,
    pipelineRest,
    skipPipelineCountdown,
    runPipelineCountdown,
    pipelineWithRetry,
    confirmProductionPipelineCost,
    executeOwnedPipelineRun,
    setPipelineStep,
  }
}
