import { toUserFacingError } from '@/utils/userFacingError.js'

/** 资源类型常量 */
export const GEN_RESOURCE = {
  CHAR_IMAGE: 'char_image',
  PROP_IMAGE: 'prop_image',
  SCENE_IMAGE: 'scene_image',
  SB_IMAGE: 'sb_image',
  SB_FIRST_IMAGE: 'sb_first_image',
  SB_LAST_IMAGE: 'sb_last_image',
  SB_VIDEO: 'sb_video',
  EPISODE_MERGE: 'episode_merge',
  EXTRACT_CHARACTERS: 'extract_characters',
  EXTRACT_PROPS: 'extract_props',
  EXTRACT_SCENES: 'extract_scenes',
  GENERATE_STORYBOARD: 'generate_storyboard',
  GENERATE_STORY: 'generate_story',
}

/** 超过此时间仍为 running 且无进展则自动清理（毫秒） */
export const STALE_TASK_MS = 30 * 60 * 1000
/** 后端任务 updated_at 长时间不变，视为重启后僵尸任务（毫秒） */
export const ORPHAN_PROCESSING_MS = 10 * 60 * 1000

const LAST_FRAME_TYPES = new Set(['last', 'storyboard_last', 'tail', 'last_frame'])
const FIRST_FRAME_TYPES = new Set(['first', 'storyboard_first', 'head', 'first_frame'])

export function taskKey({ dramaId, episodeId, resourceType, resourceId }) {
  return `${dramaId}:${episodeId}:${resourceType}:${resourceId}`
}

export function isInvalidTaskKey(key) {
  return !key || key.includes('undefined') || key.includes('null')
}

export function resolveTaskLookupKey(meta) {
  return typeof meta === 'string' ? meta : taskKey(meta)
}

export function isLastFrameType(frameType) {
  if (frameType == null || frameType === '') return false
  return LAST_FRAME_TYPES.has(String(frameType).toLowerCase())
}

export function isFirstFrameType(frameType) {
  if (frameType == null || frameType === '') return false
  return FIRST_FRAME_TYPES.has(String(frameType).toLowerCase())
}

export function sbImageResourceType(frameType) {
  if (isLastFrameType(frameType)) return GEN_RESOURCE.SB_LAST_IMAGE
  if (isFirstFrameType(frameType)) return GEN_RESOURCE.SB_FIRST_IMAGE
  return GEN_RESOURCE.SB_IMAGE
}

export function isCanceledTaskStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  return normalized === 'cancelled' || normalized === 'canceled'
}

export function isCanceledOrCancellingTaskStatus(status) {
  return isCanceledTaskStatus(status) || String(status || '').trim().toLowerCase() === 'cancelling'
}

/** 取消或取消中的任务不得再被标成 completed。 */
export function shouldPreserveCanceledTask(existingStatus, nextStatus) {
  const next = String(nextStatus || '').trim().toLowerCase()
  if (next !== 'completed') return false
  return isCanceledOrCancellingTaskStatus(existingStatus)
}

export function isActiveTaskStatus(status) {
  return status === 'pending' || status === 'processing' || status === 'running' || status === 'cancelling'
}

/** 进行中集合：running 与 cancelling */
export function isInFlightTaskStatus(status) {
  return status === 'running' || status === 'cancelling'
}

export function isMarkedRunning(task) {
  return task?.status === 'running'
}

export function listInFlightTasks(taskMap) {
  return [...taskMap.values()].filter((t) => isInFlightTaskStatus(t.status))
}

export function listInFlightTasksForEpisode(inFlightTasks, dramaId, episodeId) {
  if (dramaId == null || episodeId == null) return []
  return inFlightTasks.filter(
    (t) => Number(t.dramaId) === Number(dramaId) && Number(t.episodeId) === Number(episodeId),
  )
}

export function findTaskKeysByTaskId(taskMap, taskId) {
  if (!taskId) return []
  return [...taskMap.entries()]
    .filter(([, t]) => t.taskId === taskId)
    .map(([k]) => k)
}

export function resolveFinishTaskKeys(taskMap, meta) {
  const key = resolveTaskLookupKey(meta)
  const existing = taskMap.get(key)
  const taskId = existing?.taskId || (typeof meta === 'object' ? meta?.taskId : null)
  const keys = taskId ? findTaskKeysByTaskId(taskMap, taskId) : [key]
  if (keys.length === 0 && key) keys.push(key)
  return keys
}

export function isOrphanedProcessingTask(remote, staleMs = ORPHAN_PROCESSING_MS) {
  if (!remote || remote.status === 'cancelling' || !isActiveTaskStatus(remote.status)) return false
  const updatedAt = remote.updated_at ? new Date(remote.updated_at).getTime() : 0
  if (!updatedAt) return false
  return Date.now() - updatedAt > staleMs
}

export function isStaleLocalRunningTask(task, now, staleMs = STALE_TASK_MS) {
  return Boolean(task?.startedAt && now - task.startedAt > staleMs)
}

export function taskFailMessage(t) {
  if (!t) return '任务失败'
  const raw = String(t.error || t.message || '').trim()
  if (!raw) return '任务失败'
  return toUserFacingError({ message: raw }, '任务失败')
}

export function finishCleanupDelayMs(status) {
  return status === 'failed' ? 8000 : 3000
}

export function normalizeRunningTask(meta, key, now = Date.now()) {
  return {
    ...meta,
    key,
    status: 'running',
    startedAt: now,
  }
}

export function normalizeFinishedTask(existing, status, error, now = Date.now()) {
  return {
    ...existing,
    status,
    error: error || '',
    finishedAt: now,
  }
}

export function normalizeCancellingTask(existing, error, code, details, now = Date.now()) {
  return {
    ...existing,
    status: 'cancelling',
    error: error || existing.error || '',
    cancelCode: code || existing.cancelCode || '',
    cancelDetails: details || existing.cancelDetails || null,
    cancelObservedAt: now,
  }
}

export function findAssetById(list, id) {
  return (list || []).find((item) => Number(item.id) === Number(id))
}

export function findCompletedLocalAsset(task, { characters = [], props = [], scenes = [] } = {}) {
  if (task.resourceId == null) return null
  if (task.resourceType === GEN_RESOURCE.CHAR_IMAGE) {
    const item = findAssetById(characters, task.resourceId)
    return item && (item.image_url || item.local_path) ? item : null
  }
  if (task.resourceType === GEN_RESOURCE.PROP_IMAGE) {
    const item = findAssetById(props, task.resourceId)
    return item && (item.image_url || item.local_path) ? item : null
  }
  if (task.resourceType === GEN_RESOURCE.SCENE_IMAGE) {
    const item = findAssetById(scenes, task.resourceId)
    return item && (item.image_url || item.local_path) ? item : null
  }
  return null
}
