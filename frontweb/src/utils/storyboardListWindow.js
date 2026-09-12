/** 分镜列表渲染窗口：只挂载视口附近的行，避免大列表整表重绘。 */

export const STORYBOARD_LIST_DEFAULT_ROW_HEIGHT = 420
export const STORYBOARD_LIST_SEGMENT_HEADER_HEIGHT = 56
export const STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT = 960
export const STORYBOARD_LIST_OVERSCAN = 3
export const STORYBOARD_LIST_MIN_RENDERED = 8

const revealListeners = new Set()

export function resetStoryboardListRevealListeners() {
  revealListeners.clear()
}

export function isStoryboardDomId(id) {
  const text = String(id || '')
  return text.startsWith('sb-') && text.length > 3
}

export function parseStoryboardRevealId(id) {
  const text = String(id ?? '').trim()
  if (!text) return null
  return text.startsWith('sb-') ? text.slice(3) : text
}

export function subscribeStoryboardListReveal(listener) {
  if (typeof listener !== 'function') return () => {}
  revealListeners.add(listener)
  return () => {
    revealListeners.delete(listener)
  }
}

export async function revealStoryboardListTarget(id) {
  const storyboardId = parseStoryboardRevealId(id)
  if (storyboardId == null || storyboardId === '') return false
  let revealed = false
  for (const listener of [...revealListeners]) {
    const result = await listener(storyboardId)
    if (result) revealed = true
  }
  return revealed
}

export function hasStoryboardSegmentHeader(list, index) {
  const boards = Array.isArray(list) ? list : []
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= boards.length) return false
  const sb = boards[i]
  if (!sb?.segment_title) return false
  return i === 0 || sb.segment_index !== boards[i - 1]?.segment_index
}

export function estimateStoryboardBlockHeight({
  hasSegmentHeader = false,
  rowHeight = STORYBOARD_LIST_DEFAULT_ROW_HEIGHT,
} = {}) {
  const row = Math.max(1, Number(rowHeight) || STORYBOARD_LIST_DEFAULT_ROW_HEIGHT)
  return row + (hasSegmentHeader ? STORYBOARD_LIST_SEGMENT_HEADER_HEIGHT : 0)
}

export function buildStoryboardOffsets(heights) {
  const list = Array.isArray(heights) ? heights : []
  const offsets = new Array(list.length + 1)
  offsets[0] = 0
  for (let i = 0; i < list.length; i++) {
    const height = Number(list[i])
    offsets[i + 1] = offsets[i] + Math.max(1, Number.isFinite(height) ? height : STORYBOARD_LIST_DEFAULT_ROW_HEIGHT)
  }
  return offsets
}

export function findStoryboardIndexByOffset(offsets, offset) {
  const prefix = Array.isArray(offsets) ? offsets : [0]
  const total = prefix.length - 1
  if (total <= 0) return 0
  const y = Number(offset)
  const point = Number.isFinite(y) ? y : 0
  if (point <= 0) return 0
  if (point >= prefix[total]) return total - 1
  let lo = 0
  let hi = total - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (prefix[mid] <= point) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function windowAroundIndex(total, index, size) {
  const count = Math.max(0, Number(total) || 0)
  if (count === 0) return { start: 0, end: 0 }
  const span = Math.max(1, Math.min(count, Number(size) || STORYBOARD_LIST_MIN_RENDERED))
  const i = Math.min(count - 1, Math.max(0, Number(index) || 0))
  const half = Math.floor(span / 2)
  let start = Math.max(0, i - half)
  let end = Math.min(count, start + span)
  start = Math.max(0, end - span)
  return { start, end }
}

export function mergeIndexesIntoWindow(start, end, total, extraIndexes) {
  const count = Math.max(0, Number(total) || 0)
  let nextStart = Math.max(0, Math.min(count, Number(start) || 0))
  let nextEnd = Math.max(nextStart, Math.min(count, Number(end) || 0))
  for (const raw of extraIndexes || []) {
    if (raw == null || raw === '') continue
    const i = Number(raw)
    if (!Number.isInteger(i) || i < 0 || i >= count) continue
    if (i < nextStart) nextStart = i
    if (i + 1 > nextEnd) nextEnd = i + 1
  }
  return { start: nextStart, end: nextEnd }
}

export function pinStoryboardIndexes(total, indexes) {
  const count = Math.max(0, Number(total) || 0)
  const pinned = []
  for (const raw of indexes || []) {
    if (raw == null || raw === '') continue
    const i = Number(raw)
    if (!Number.isInteger(i) || i < 0 || i >= count) continue
    if (i > 0) pinned.push(i - 1)
    pinned.push(i)
    if (i + 1 < count) pinned.push(i + 1)
  }
  return [...new Set(pinned)]
}

export function computeStoryboardListWindow({
  total = 0,
  scrollTop = 0,
  viewportHeight = STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT,
  offsets = null,
  overscan = STORYBOARD_LIST_OVERSCAN,
  pinnedIndexes = [],
  minRendered = STORYBOARD_LIST_MIN_RENDERED,
  forceIndex = null,
} = {}) {
  const count = Math.max(0, Number(total) || 0)
  if (count === 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, size: 0 }
  }

  const prefix = Array.isArray(offsets) && offsets.length === count + 1
    ? offsets
    : buildStoryboardOffsets(Array.from({ length: count }, () => STORYBOARD_LIST_DEFAULT_ROW_HEIGHT))
  const totalHeight = prefix[count]
  const viewport = Math.max(1, Number(viewportHeight) || STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT)
  const extra = Math.max(0, Number(overscan) || 0)
  const minSize = Math.max(1, Math.min(count, Number(minRendered) || STORYBOARD_LIST_MIN_RENDERED))

  if (count <= minSize) {
    return { start: 0, end: count, topSpacer: 0, bottomSpacer: 0, size: count }
  }

  const viewStart = Math.max(0, Number(scrollTop) || 0)
  let start = Math.max(0, findStoryboardIndexByOffset(prefix, viewStart) - extra)
  let end = Math.min(count, findStoryboardIndexByOffset(prefix, viewStart + viewport) + 1 + extra)

  if (Number.isInteger(forceIndex) && forceIndex >= 0 && forceIndex < count) {
    const around = windowAroundIndex(count, forceIndex, Math.max(minSize, end - start))
    start = around.start
    end = around.end
  }

  const merged = mergeIndexesIntoWindow(start, end, count, pinnedIndexes)
  start = merged.start
  end = merged.end

  if (end - start < minSize) {
    end = Math.min(count, start + minSize)
    start = Math.max(0, end - minSize)
  }

  return {
    start,
    end,
    topSpacer: prefix[start],
    bottomSpacer: totalHeight - prefix[end],
    size: end - start,
  }
}

export function visibleStoryboardItems(list, windowState) {
  const boards = Array.isArray(list) ? list : []
  const start = Math.max(0, Number(windowState?.start) || 0)
  const end = Math.min(boards.length, Number(windowState?.end) || 0)
  const items = []
  for (let i = start; i < end; i++) items.push({ sb: boards[i], i })
  return items
}
