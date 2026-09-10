/** 分镜列表排序：乐观调整顺序，经已有 update API 写入 storyboard_number，失败回滚。 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { storyboardsAPI as defaultStoryboardsAPI } from '@/api/storyboards'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'

export const STORYBOARD_REORDER_PREFIX = 'lmd-storyboard-index:'

export function encodeStoryboardReorderIndex(index) {
  return `${STORYBOARD_REORDER_PREFIX}${Number(index)}`
}

export function parseStoryboardReorderIndex(raw) {
  const text = String(raw || '')
  if (!text.startsWith(STORYBOARD_REORDER_PREFIX)) return null
  const index = Number(text.slice(STORYBOARD_REORDER_PREFIX.length))
  return Number.isInteger(index) && index >= 0 ? index : null
}

export function snapshotStoryboardOrder(list) {
  return (Array.isArray(list) ? list : []).map((sb) => ({
    ref: sb,
    storyboard_number: sb?.storyboard_number,
  }))
}

export function restoreStoryboardOrder(list, snapshot) {
  if (!Array.isArray(list) || !Array.isArray(snapshot)) return
  list.splice(0, list.length, ...snapshot.map((item) => item.ref))
  snapshot.forEach((item) => {
    if (item?.ref) item.ref.storyboard_number = item.storyboard_number
  })
}

export function applyStoryboardMove(list, fromIndex, toIndex) {
  if (!Array.isArray(list)) return false
  const from = Number(fromIndex)
  const to = Number(toIndex)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return false
  if (from === to) return false
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  list.forEach((sb, index) => {
    sb.storyboard_number = index + 1
  })
  return true
}

export function changedStoryboardNumberUpdates(before, after) {
  const previous = new Map(
    (Array.isArray(before) ? before : []).map((item) => [item.ref?.id, item.storyboard_number]),
  )
  return (Array.isArray(after) ? after : [])
    .filter((sb) => sb?.id != null && previous.get(sb.id) !== sb.storyboard_number)
    .map((sb) => ({ id: sb.id, storyboard_number: sb.storyboard_number }))
}

export async function persistStoryboardNumberUpdates(api, updates) {
  const storyboardsAPI = api
  if (!storyboardsAPI?.update) {
    throw new Error('无法保存分镜顺序，请稍后重试')
  }
  for (const item of updates) {
    await storyboardsAPI.update(item.id, { storyboard_number: item.storyboard_number })
  }
}

export async function runStoryboardReorder({
  list,
  fromIndex,
  toIndex,
  storyboardsAPI,
} = {}) {
  if (!Array.isArray(list)) return false
  const snapshot = snapshotStoryboardOrder(list)
  if (!applyStoryboardMove(list, fromIndex, toIndex)) return false
  const updates = changedStoryboardNumberUpdates(snapshot, list)
  try {
    await persistStoryboardNumberUpdates(storyboardsAPI, updates)
    return true
  } catch (error) {
    restoreStoryboardOrder(list, snapshot)
    try {
      await persistStoryboardNumberUpdates(
        storyboardsAPI,
        snapshot
          .filter((item) => item.ref?.id != null)
          .map((item) => ({ id: item.ref.id, storyboard_number: item.storyboard_number })),
      )
    } catch (_) { /* 尽力把服务端序号也滚回去，失败仍抛出原始错误 */ }
    throw error
  }
}


const REORDER_ENGLISH_FAIL_RE = /network error|could not be claimed|request failed|timeout of|failed to save|econnaborted/i

/** 把排序保存异常收成可展示的简体中文，英文后端/网络原文一律丢掉。 */
export function toStoryboardReorderUserError(error) {
  const message = toUserFacingError(error, '调整分镜顺序失败')
  if (!/[\u4e00-\u9fff]/.test(message) || REORDER_ENGLISH_FAIL_RE.test(message)) {
    return '调整分镜顺序失败'
  }
  return message
}

export function storyboardMoveButtonCopy({ actionLabel = '上移', index = 0, reason = '' } = {}) {
  const name = `${actionLabel}分镜${Number(index) + 1}`
  const disabledReason = String(reason || '')
  return {
    disabled: Boolean(disabledReason),
    title: disabledReason ? `${actionLabel}不可用：${disabledReason}` : actionLabel,
    ariaLabel: disabledReason ? `${name}不可用：${disabledReason}` : name,
  }
}

export function storyboardMoveDisabledReason({
  index,
  length,
  offset,
  generating = false,
  polishing = false,
  busy = false,
} = {}) {
  if (generating) return '正在生成分镜，请等待完成'
  if (polishing) return '正在润色全能分镜提示词，请等待完成'
  if (busy) return '正在调整分镜顺序'
  if (Number(length) < 2) return '至少两条分镜才能调整顺序'
  const i = Number(index)
  const dir = Number(offset)
  if (dir < 0 && i === 0) return '已经是第一条分镜'
  if (dir > 0 && i === Number(length) - 1) return '已经是最后一条分镜'
  return ''
}

export function useFilmCreateStoryboardReorder(deps = {}) {
  const {
    getList,
    getStoryboardsAPI,
    storyboardsAPI = defaultStoryboardsAPI,
    isBlocked = () => false,
  } = deps

  function resolveStoryboardsAPI() {
    if (typeof getStoryboardsAPI === 'function') {
      return getStoryboardsAPI() || defaultStoryboardsAPI
    }
    return storyboardsAPI || defaultStoryboardsAPI
  }

  const storyboardReorderBusy = ref(false)
  const draggingStoryboardIndex = ref(null)
  const dropTargetStoryboardIndex = ref(null)

  function currentList() {
    if (typeof getList === 'function') return getList() || []
    return []
  }

  function resolveIndex(sb, index) {
    if (Number.isInteger(index) && index >= 0) return index
    const list = currentList()
    return list.findIndex((item) => Number(item?.id) === Number(sb?.id))
  }

  async function moveStoryboardByOffset(sb, offset, index) {
    if (storyboardReorderBusy.value || isBlocked()) return false
    const list = currentList()
    const fromIndex = resolveIndex(sb, index)
    const toIndex = fromIndex + Number(offset || 0)
    if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) return false
    storyboardReorderBusy.value = true
    dropTargetStoryboardIndex.value = null
    try {
      return await runStoryboardReorder({
        list,
        fromIndex,
        toIndex,
        storyboardsAPI: resolveStoryboardsAPI(),
      })
    } catch (error) {
      if (!isUserFacingAbort(error)) {
        ElMessage.error(toStoryboardReorderUserError(error))
      }
      return false
    } finally {
      storyboardReorderBusy.value = false
      draggingStoryboardIndex.value = null
    }
  }

  function onMoveStoryboardUp(sb, index) {
    return moveStoryboardByOffset(sb, -1, index)
  }

  function onMoveStoryboardDown(sb, index) {
    return moveStoryboardByOffset(sb, 1, index)
  }

  function onReorderDragStart(event, index) {
    if (storyboardReorderBusy.value || isBlocked() || currentList().length < 2) {
      event?.preventDefault?.()
      return
    }
    draggingStoryboardIndex.value = index
    dropTargetStoryboardIndex.value = index
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', encodeStoryboardReorderIndex(index))
    }
  }

  function onReorderDragOver(event, index) {
    if (event?.dataTransfer?.files?.length) return
    const fromIndex = draggingStoryboardIndex.value
    if (!Number.isInteger(fromIndex)) return
    event?.preventDefault?.()
    if (event?.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTargetStoryboardIndex.value = index
  }

  function onReorderDragEnd() {
    draggingStoryboardIndex.value = null
    dropTargetStoryboardIndex.value = null
  }

  async function onReorderDrop(event, index) {
    if (event?.dataTransfer?.files?.length) return
    event?.preventDefault?.()
    const encoded = event?.dataTransfer?.getData?.('text/plain')
    const fromIndex = draggingStoryboardIndex.value ?? parseStoryboardReorderIndex(encoded)
    const list = currentList()
    const sb = Number.isInteger(fromIndex) ? list[fromIndex] : null
    draggingStoryboardIndex.value = null
    dropTargetStoryboardIndex.value = null
    if (!sb) return false
    return moveStoryboardByOffset(sb, Number(index) - fromIndex, fromIndex)
  }

  return {
    storyboardReorderBusy,
    draggingStoryboardIndex,
    dropTargetStoryboardIndex,
    moveStoryboardByOffset,
    onMoveStoryboard: moveStoryboardByOffset,
    onMoveStoryboardUp,
    onMoveStoryboardDown,
    onReorderDragStart,
    onReorderDragOver,
    onReorderDragEnd,
    onReorderDrop,
  }
}
