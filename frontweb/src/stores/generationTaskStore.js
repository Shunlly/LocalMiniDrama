import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { logOperation } from '@/utils/operationLog'
import {
  GEN_RESOURCE,
  STALE_TASK_MS,
  findCompletedLocalAsset,
  findTaskKeysByTaskId,
  finishCleanupDelayMs,
  isActiveTaskStatus,
  isInvalidTaskKey,
  isMarkedRunning,
  isOrphanedProcessingTask,
  isStaleLocalRunningTask,
  listInFlightTasks,
  listInFlightTasksForEpisode,
  normalizeCancellingTask,
  normalizeFinishedTask,
  normalizeRunningTask,
  resolveFinishTaskKeys,
  resolveTaskLookupKey,
  taskFailMessage,
  taskKey,
} from './generationTaskStore.helpers.js'
import {
  buildAssetResourceRecoveryLabel,
  buildCharacterExtractionRecovery,
  buildEpisodeBackendTaskRecovery,
  buildEpisodeRecoveryScope,
  buildPendingImageRecovery,
  buildPendingVideoRecovery,
  buildResourceTaskRecovery,
  buildStoryGenerationRecovery,
  resolveReconcileAssets,
  shouldRecoverDramaLevelTask,
} from './generationTaskStore.recovery.js'

export { GEN_RESOURCE }

const ORPHAN_TASK_MSG = '任务长时间无进展，可能因服务重启而中断，请重新操作'
const USER_CANCEL_TASK_MSG = '用户已取消'
const REMOTE_CANCEL_RECONCILE_CODES = new Set(['REMOTE_CANCEL_UNCERTAIN', 'REMOTE_CANCEL_EXHAUSTED'])

export const useGenerationTaskStore = defineStore('generationTask', () => {
  /** @type {Map<string, object>} */
  const tasks = ref(new Map())
  /** @type {Map<string, Promise>} taskId → poll promise */
  const pollPromises = ref(new Map())
  /** 本会话已处理过的恢复 taskId，避免切集重复注册 */
  const recoveredTaskIds = ref(new Set())
  /** 用户或系统主动停止轮询的 taskId */
  const cancelledPollTaskIds = ref(new Set())
  const pollStopStatuses = ref(new Map())

  const runningTasks = computed(() => listInFlightTasks(tasks.value))

  function _setTask(key, task) {
    const next = new Map(tasks.value)
    next.set(key, task)
    tasks.value = next
  }

  function _deleteTask(key) {
    const next = new Map(tasks.value)
    next.delete(key)
    tasks.value = next
  }

  function _findKeysByTaskId(taskId) {
    return findTaskKeysByTaskId(tasks.value, taskId)
  }

  function _finishKeys(keys, status, error) {
    for (const key of keys) {
      const existing = tasks.value.get(key)
      if (!existing) continue
      _setTask(key, normalizeFinishedTask(existing, status, error))
      setTimeout(() => _deleteTask(key), finishCleanupDelayMs(status))
    }
  }

  function markRunning(meta) {
    const key = taskKey(meta)
    if (isInvalidTaskKey(key)) return key
    _setTask(key, normalizeRunningTask(meta, key))
    return key
  }

  function markDone(meta) {
    _finishKeys(resolveFinishTaskKeys(tasks.value, meta), 'completed')
  }

  function markFailed(meta, error) {
    _finishKeys(resolveFinishTaskKeys(tasks.value, meta), 'failed', error)
  }

  function isRunning(meta) {
    return isMarkedRunning(tasks.value.get(taskKey(meta)))
  }

  function getRunningForEpisode(dramaId, episodeId) {
    return listInFlightTasksForEpisode(runningTasks.value, dramaId, episodeId)
  }

  function getAllRunningTasks() {
    return runningTasks.value
  }

  function markCancelling(taskId, meta, error, code, details) {
    const keys = _findKeysByTaskId(taskId)
    if (!keys.length && meta) {
      const key = taskKey({ ...meta, taskId })
      if (!isInvalidTaskKey(key)) keys.push(key)
    }
    for (const key of keys) {
      const existing = tasks.value.get(key)
      if (!existing) continue
      _setTask(key, normalizeCancellingTask(existing, error, code, details))
    }
  }

  /** 停止指定 taskId 的轮询并清除 store 中的活动状态 */
  function stopPollingTask(taskId, reason, terminalStatus = 'failed') {
    if (!taskId) return
    cancelledPollTaskIds.value = new Set([...cancelledPollTaskIds.value, taskId])
    pollStopStatuses.value = new Map([...pollStopStatuses.value, [taskId, terminalStatus]])
    if (terminalStatus === 'cancelled') {
      _finishKeys(_findKeysByTaskId(taskId), 'cancelled', reason || USER_CANCEL_TASK_MSG)
    } else {
      markFailed({ taskId }, reason || '任务已停止')
    }
  }

  /** 取消任务：确认取消后结束，远端不确定时保留 cancelling 并继续对账 */
  async function cancelTask(meta, options = {}) {
    const reason = options.reason || USER_CANCEL_TASK_MSG
    const taskId = typeof meta === 'string' ? meta : meta?.taskId
    if (taskId) {
      const startedAt = Date.now()
      logOperation({
        operation: 'generation_task_cancel',
        operationId: String(taskId),
        phase: 'start',
        taskId,
      })
      try {
        await taskAPI.cancel(taskId, { reason })
        stopPollingTask(taskId, reason, 'cancelled')
        logOperation({
          operation: 'generation_task_cancel',
          operationId: String(taskId),
          phase: 'cancel',
          status: 'cancelled',
          durationMs: Date.now() - startedAt,
          taskId,
        })
        return { status: 'cancelled' }
      } catch (e) {
        const code = e?.response?.data?.error?.code
        if (REMOTE_CANCEL_RECONCILE_CODES.has(code)) {
          const message = e?.response?.data?.error?.message || e?.message || '远端取消状态待确认'
          const details = e?.response?.data?.error?.details || null
          markCancelling(taskId, typeof meta === 'object' ? meta : null, message, code, details)
          if (!pollPromises.value.has(taskId) && typeof meta === 'object') {
            void pollTask(taskId, meta, options.onDone, {
              ...options,
              showErrorToast: false,
              showTimeoutToast: false,
            })
          }
          logOperation({
            operation: 'generation_task_cancel',
            operationId: String(taskId),
            phase: 'cancel',
            status: 'cancelling',
            durationMs: Date.now() - startedAt,
            taskId,
            error: message,
            code,
          })
          return { status: 'cancelling', code, error: message, details }
        }
        console.warn('[generationTaskStore] cancel API failed:', e?.message)
        stopPollingTask(taskId, e?.message || reason)
        logOperation({
          operation: 'generation_task_cancel',
          operationId: String(taskId),
          phase: 'error',
          durationMs: Date.now() - startedAt,
          taskId,
          error: e?.message || reason,
        })
        return { status: 'failed', error: e?.message || reason }
      }
    }
    const key = resolveTaskLookupKey(meta)
    markFailed(key, reason)
  }

  /** 清除所有 running 任务（页面级兜底） */
  function clearAllRunningTasks(reason) {
    for (const t of [...runningTasks.value]) {
      if (t.taskId) stopPollingTask(t.taskId, reason)
      else markFailed(t, reason || '已清除')
    }
  }

  /**
   * 校验 store 中 running 任务是否与后端一致；清理已完成/失败/超时的僵尸条目。
   */
  async function reconcileRunningTasks(ctx = {}) {
    const { characters = [], props = [], scenes = [], storyboards = [] } = ctx
    const running = [...runningTasks.value]
    const now = Date.now()

    for (const t of running) {
      if (isStaleLocalRunningTask(t, now, STALE_TASK_MS)) {
        markFailed(t, '任务等待超时，已自动清除（请刷新确认是否已完成）')
        continue
      }

      if (t.taskId) {
        try {
          const remote = await taskAPI.get(t.taskId)
          if (remote.status === 'completed') {
            markDone(t)
            continue
          }
          if (remote.status === 'failed') {
            markFailed(t, taskFailMessage(remote))
            continue
          }
          if (remote.status === 'cancelled') {
            stopPollingTask(t.taskId, taskFailMessage(remote) || USER_CANCEL_TASK_MSG, 'cancelled')
            continue
          }
          if (!isActiveTaskStatus(remote.status)) {
            markDone(t)
            continue
          }
          if (isOrphanedProcessingTask(remote)) {
            markFailed(t, ORPHAN_TASK_MSG)
          }
        } catch (_) {
          // 网络异常跳过，下次 reconcile 再试
        }
        continue
      }

      if (findCompletedLocalAsset(t, { characters, props, scenes })) markDone(t)
    }

    void storyboards
  }

  /**
   * 轮询异步任务；同一 taskId 只轮询一次，多路 await 共享结果。
   */
  function pollTask(taskId, meta, onDone, options = {}) {
    if (!taskId) return Promise.resolve({ status: 'failed', error: '缺少任务编号' })

    const existingKey = _findKeysByTaskId(taskId)[0]
    const key = existingKey || markRunning({ ...meta, taskId })

    if (pollPromises.value.has(taskId)) {
      return pollPromises.value.get(taskId)
    }

    const maxAttempts = options.maxAttempts ?? 450
    const interval = options.interval ?? 2000
    const showErrorToast = options.showErrorToast !== false
    const showTimeoutToast = options.showTimeoutToast !== false

    let attempts = 0
    let stopped = false
    const promise = new Promise((resolve) => {
      const tick = async () => {
        if (stopped || cancelledPollTaskIds.value.has(taskId)) {
          const terminalStatus = pollStopStatuses.value.get(taskId) || 'failed'
          if (terminalStatus === 'cancelled') _finishKeys(_findKeysByTaskId(taskId), 'cancelled', USER_CANCEL_TASK_MSG)
          else markFailed(key, '任务轮询已停止')
          return resolve({ status: terminalStatus, error: terminalStatus === 'cancelled' ? USER_CANCEL_TASK_MSG : '任务轮询已停止' })
        }
        attempts++
        try {
          const t = await taskAPI.get(taskId)
          if (isOrphanedProcessingTask(t)) {
            const errMsg = ORPHAN_TASK_MSG
            markFailed(key, errMsg)
            if (showErrorToast && options.ElMessage) {
              options.ElMessage.warning(errMsg)
            }
            return resolve({ status: 'failed', error: errMsg })
          }
          if (t.status === 'completed') {
            if (onDone) {
              try {
                await onDone()
              } catch (e) {
                console.warn('[generationTaskStore] onDone failed:', e?.message)
              }
            }
            markDone(key)
            return resolve({ status: 'completed', result: t.result })
          }
          if (t.status === 'failed') {
            const errMsg = taskFailMessage(t)
            markFailed(key, errMsg)
            if (showErrorToast && options.ElMessage) {
              options.ElMessage.error(errMsg)
            }
            return resolve({ status: 'failed', error: errMsg })
          }
          if (t.status === 'cancelled') {
            stopPollingTask(taskId, taskFailMessage(t) || USER_CANCEL_TASK_MSG, 'cancelled')
            return resolve({ status: 'cancelled', error: taskFailMessage(t) || USER_CANCEL_TASK_MSG })
          }
          if (t.status === 'cancelling') {
            markCancelling(taskId, meta, t.error || t.message || '远端取消待确认', t.cancel_state, {
              cancel_state: t.cancel_state,
              cancel_attempt: t.cancel_attempt,
              cancel_next_retry_at: t.cancel_next_retry_at,
              cancel_context: t.cancel_context,
            })
          }
        } catch (pollErr) {
          console.warn('[generationTaskStore] poll attempt failed:', pollErr?.message)
        }
        if (attempts < maxAttempts) {
          setTimeout(tick, interval)
        } else {
          const timeoutMsg = options.timeoutMessage
            || '生成任务已超时（超过15分钟），请刷新页面查看是否已完成'
          markFailed(key, timeoutMsg)
          if (showTimeoutToast && options.ElMessage) {
            options.ElMessage.warning(timeoutMsg)
          }
          resolve({ status: 'timeout', error: timeoutMsg })
        }
      }
      setTimeout(tick, interval)
    })

    const nextPolls = new Map(pollPromises.value)
    nextPolls.set(taskId, promise)
    pollPromises.value = nextPolls

    return promise.finally(() => {
      stopped = true
      cancelledPollTaskIds.value = new Set([...cancelledPollTaskIds.value, taskId])
      const cleaned = new Map(pollPromises.value)
      cleaned.delete(taskId)
      pollPromises.value = cleaned
    })
  }

  /**
   * 若 task 仍在运行且尚未轮询，则 attach 轮询（用于页面刷新/切集恢复）。
   */
  async function attachPollIfNeeded(taskId, meta, onDone, options = {}) {
    if (!taskId) return null

    if (pollPromises.value.has(taskId)) {
      markRunning({ ...meta, taskId })
      return pollPromises.value.get(taskId)
    }

    try {
      const t = await taskAPI.get(taskId)
      if (isOrphanedProcessingTask(t)) {
        markFailed({ ...meta, taskId }, ORPHAN_TASK_MSG)
        return { status: 'failed', error: ORPHAN_TASK_MSG }
      }
      if (t.status === 'completed') {
        if (onDone) await onDone()
        markDone({ ...meta, taskId })
        return { status: 'completed', result: t.result }
      }
      if (t.status === 'failed') {
        markFailed({ ...meta, taskId }, taskFailMessage(t))
        return { status: 'failed', error: taskFailMessage(t) }
      }
      if (!isActiveTaskStatus(t.status)) {
        markDone({ ...meta, taskId })
        return { status: 'completed', result: t.result }
      }
    } catch (_) {
      // 网络异常时仍尝试轮询
    }

    markRunning({ ...meta, taskId })
    return pollTask(taskId, meta, onDone, { ...options, showErrorToast: false, showTimeoutToast: false })
  }

  async function _recoverAttachTask(taskId, meta, onDone, pollOpts) {
    if (!taskId) return
    if (recoveredTaskIds.value.has(taskId)) {
      try {
        const t = await taskAPI.get(taskId)
        if (t.status === 'completed') markDone({ ...meta, taskId })
        else if (t.status === 'failed') markFailed({ ...meta, taskId }, taskFailMessage(t))
        else if (!isActiveTaskStatus(t.status)) markDone({ ...meta, taskId })
        else if (cancelledPollTaskIds.value.has(taskId)) markFailed({ ...meta, taskId }, '任务轮询已停止')
      } catch (_) {}
      return
    }
    recoveredTaskIds.value = new Set([...recoveredTaskIds.value, taskId])
    const res = await attachPollIfNeeded(taskId, meta, onDone, pollOpts)
    if (res?.status === 'failed' || res?.status === 'timeout') {
      markFailed({ ...meta, taskId }, res.error)
    }
  }

  /**
   * 从后端恢复当前集进行中的图片/视频/合成任务，并重新 attach 轮询。
   */
  async function recoverPendingForEpisode(ctx) {
    const {
      dramaId,
      episodeId,
      dramaTitle,
      episodeNumber,
      storyboards = [],
      characters = [],
      scenes = [],
      props = [],
      allCharacters = [],
      allProps = [],
      allScenes = [],
      callbacks = {},
      ElMessage,
    } = ctx

    if (dramaId == null || episodeId == null) return

    const reconcileAssets = resolveReconcileAssets({
      characters,
      props,
      scenes,
      allCharacters,
      allProps,
      allScenes,
      storyboards,
    })

    await reconcileRunningTasks(reconcileAssets)

    const scope = buildEpisodeRecoveryScope({
      dramaId,
      episodeId,
      dramaTitle,
      episodeNumber,
      storyboards,
      characters,
      scenes,
      props,
    })
    const pollOpts = { ElMessage, showErrorToast: false, showTimeoutToast: false }

    const attachRecovery = (taskId, recovered) => {
      if (!taskId || !recovered) return
      const onDone = recovered.refreshKind === 'storyboard'
        ? () => callbacks.onStoryboardMedia?.(recovered.meta.resourceId)
        : () => callbacks.onDramaRefresh?.()
      _recoverAttachTask(taskId, recovered.meta, onDone, pollOpts)
    }

    try {
      const [pendingImg, processingImg, processingVid, episodeTasks] = await Promise.all([
        imagesAPI.list({ drama_id: dramaId, status: 'pending', page_size: 100 }).catch(() => ({ items: [] })),
        imagesAPI.list({ drama_id: dramaId, status: 'processing', page_size: 100 }).catch(() => ({ items: [] })),
        videosAPI.list({ drama_id: dramaId, status: 'processing', page_size: 100 }).catch(() => ({ items: [] })),
        taskAPI.listByResource(String(episodeId), { drama_id: dramaId }).catch(() => []),
      ])

      const seenImg = new Set()
      for (const img of [...(pendingImg.items || []), ...(processingImg.items || [])]) {
        const dedupe = `${img.id}:${img.status}`
        if (seenImg.has(dedupe)) continue
        seenImg.add(dedupe)
        attachRecovery(img.task_id, buildPendingImageRecovery(img, scope))
      }

      for (const vid of processingVid.items || []) {
        attachRecovery(vid.task_id, buildPendingVideoRecovery(vid, scope))
      }

      for (const t of episodeTasks || []) {
        attachRecovery(t.id, buildEpisodeBackendTaskRecovery(t, scope))
      }

      // 角色提取 task 挂在 dramaId 上，同一 taskId 只恢复一次（避免多集重复显示）
      const dramaTasks = await taskAPI.listByResource(String(dramaId), { drama_id: dramaId }).catch(() => [])
      for (const t of dramaTasks || []) {
        if (!shouldRecoverDramaLevelTask(t, 'character_generation', recoveredTaskIds.value, pollPromises.value)) continue
        attachRecovery(t.id, buildCharacterExtractionRecovery(t, scope))
        break
      }

      for (const t of dramaTasks || []) {
        if (!shouldRecoverDramaLevelTask(t, 'story_generation', recoveredTaskIds.value, pollPromises.value)) continue
        attachRecovery(t.id, buildStoryGenerationRecovery(t, scope))
        break
      }

      const attachResourceTask = (resourceId, resourceType, label) => {
        return taskAPI.listByResource(String(resourceId), { drama_id: dramaId }).then((tasks) => {
          for (const t of tasks || []) {
            attachRecovery(t.id, buildResourceTaskRecovery(t, scope, resourceType, resourceId, label))
          }
        }).catch(() => {})
      }

      await Promise.all([
        ...[...scope.charIdSet].map((id) => attachResourceTask(
          id,
          GEN_RESOURCE.CHAR_IMAGE,
          buildAssetResourceRecoveryLabel(scope, GEN_RESOURCE.CHAR_IMAGE, id),
        )),
        ...[...scope.propIdSet].map((id) => attachResourceTask(
          id,
          GEN_RESOURCE.PROP_IMAGE,
          buildAssetResourceRecoveryLabel(scope, GEN_RESOURCE.PROP_IMAGE, id),
        )),
        ...[...scope.sceneIdSet].map((id) => attachResourceTask(
          id,
          GEN_RESOURCE.SCENE_IMAGE,
          buildAssetResourceRecoveryLabel(scope, GEN_RESOURCE.SCENE_IMAGE, id),
        )),
      ])

      await reconcileRunningTasks(reconcileAssets)
    } catch (e) {
      console.warn('[generationTaskStore] recoverPendingForEpisode failed:', e?.message)
    }
  }

  return {
    GEN_RESOURCE,
    tasks,
    runningTasks,
    markRunning,
    markDone,
    markFailed,
    isRunning,
    getRunningForEpisode,
    getAllRunningTasks,
    pollTask,
    attachPollIfNeeded,
    recoverPendingForEpisode,
    reconcileRunningTasks,
    stopPollingTask,
    cancelTask,
    clearAllRunningTasks,
    taskKey,
  }
})
