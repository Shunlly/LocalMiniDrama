/** 固定行高列表窗口：只挂载视口附近的项，避免大列表整表渲染。 */

export const LIST_WINDOW_DEFAULT_ROW_HEIGHT = 32
export const LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT = 256
export const LIST_WINDOW_OVERSCAN = 4
export const LIST_WINDOW_MIN_RENDERED = 8

function toCount(value) {
  return Math.max(0, Number(value) || 0)
}

function toSize(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/** 把目标行滚进视口偏上位置，供高亮/定位时对齐窗口。 */
export function scrollTopForIndex(index, {
  rowHeight = LIST_WINDOW_DEFAULT_ROW_HEIGHT,
  viewportHeight = LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT,
} = {}) {
  const row = toSize(rowHeight, LIST_WINDOW_DEFAULT_ROW_HEIGHT)
  const view = toSize(viewportHeight, LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT)
  const i = Math.max(0, Number(index) || 0)
  return Math.max(0, i * row - Math.floor((view - row) / 3))
}

export function computeListWindow({
  total = 0,
  scrollTop = 0,
  viewportHeight = LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT,
  rowHeight = LIST_WINDOW_DEFAULT_ROW_HEIGHT,
  overscan = LIST_WINDOW_OVERSCAN,
  minRendered = LIST_WINDOW_MIN_RENDERED,
} = {}) {
  const count = toCount(total)
  if (count === 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, size: 0 }
  }

  const row = toSize(rowHeight, LIST_WINDOW_DEFAULT_ROW_HEIGHT)
  const minSize = Math.max(1, Math.min(count, Math.trunc(toSize(minRendered, LIST_WINDOW_MIN_RENDERED))))
  if (count <= minSize) {
    return { start: 0, end: count, topSpacer: 0, bottomSpacer: 0, size: count }
  }

  const viewport = toSize(viewportHeight, LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT)
  const extra = Math.max(0, Math.trunc(Number(overscan) || 0))
  const viewStart = Math.max(0, Number(scrollTop) || 0)
  let start = Math.max(0, Math.floor(viewStart / row) - extra)
  let end = Math.min(count, Math.ceil((viewStart + viewport) / row) + extra)

  if (end - start < minSize) {
    end = Math.min(count, start + minSize)
    start = Math.max(0, end - minSize)
  }

  return {
    start,
    end,
    topSpacer: start * row,
    bottomSpacer: (count - end) * row,
    size: end - start,
  }
}

export function visibleWindowItems(list, windowState) {
  const items = Array.isArray(list) ? list : []
  const start = Math.max(0, Number(windowState?.start) || 0)
  const end = Math.min(items.length, Number(windowState?.end) || 0)
  const visible = []
  for (let index = start; index < end; index++) {
    visible.push({ item: items[index], index })
  }
  return visible
}
