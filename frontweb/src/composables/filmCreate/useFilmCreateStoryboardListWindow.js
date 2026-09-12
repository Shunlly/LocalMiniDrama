import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT,
  buildStoryboardOffsets,
  computeStoryboardListWindow,
  estimateStoryboardBlockHeight,
  findStoryboardIndexByOffset,
  hasStoryboardSegmentHeader,
  pinStoryboardIndexes,
  subscribeStoryboardListReveal,
  visibleStoryboardItems,
} from '@/utils/storyboardListWindow.js'

function readWindow() {
  return typeof window !== 'undefined' ? window : null
}

/**
 * 分镜列表窗口：按滚动位置只渲染附近行，并钉住焦点/拖拽/插入位置。
 */
export function useFilmCreateStoryboardListWindow(options = {}) {
  const {
    getList,
    listRef,
    metrics,
  } = options

  const ownedMetrics = ref({
    scrollTop: 0,
    viewportHeight: STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT,
  })
  const scrollMetrics = metrics || ownedMetrics
  const measuredHeights = ref({})
  const pinnedIndexes = ref([])
  const focusedIndex = ref(null)
  const forceIndex = ref(null)
  const draggingIndex = ref(null)

  function list() {
    return typeof getList === 'function' ? (getList() || []) : []
  }

  function heightAt(index) {
    const boards = list()
    const sb = boards[index]
    const measured = sb?.id != null ? measuredHeights.value[sb.id] : null
    if (Number.isFinite(measured) && measured > 0) return measured
    return estimateStoryboardBlockHeight({
      hasSegmentHeader: hasStoryboardSegmentHeader(boards, index),
    })
  }

  const offsets = computed(() => buildStoryboardOffsets(list().map((_, index) => heightAt(index))))

  const windowState = computed(() => {
    const boards = list()
    const extras = pinStoryboardIndexes(boards.length, [
      focusedIndex.value,
      draggingIndex.value,
      forceIndex.value,
      ...pinnedIndexes.value,
    ].filter((index) => Number.isInteger(index)))
    return computeStoryboardListWindow({
      total: boards.length,
      scrollTop: scrollMetrics.value.scrollTop,
      viewportHeight: scrollMetrics.value.viewportHeight,
      offsets: offsets.value,
      pinnedIndexes: extras,
      forceIndex: forceIndex.value,
    })
  })

  const visibleItems = computed(() => visibleStoryboardItems(list(), windowState.value))

  function pinAround(index) {
    if (index == null || index === '') return
    const i = Number(index)
    if (!Number.isInteger(i) || i < 0) return
    pinnedIndexes.value = pinStoryboardIndexes(list().length, [i])
    focusedIndex.value = i
  }

  async function revealById(storyboardId) {
    const index = list().findIndex((sb) => String(sb?.id) === String(storyboardId))
    if (index < 0) return false
    forceIndex.value = index
    pinAround(index)
    await nextTick()
    return true
  }

  function onFocusIn(event) {
    const target = event?.target
    const item = typeof target?.closest === 'function'
      ? target.closest('[data-storyboard-index]')
      : null
    if (!item) return
    const index = Number(item.getAttribute?.('data-storyboard-index') ?? item.dataset?.storyboardIndex)
    if (Number.isInteger(index) && index >= 0) focusedIndex.value = index
  }

  function indexFromClientY(clientY) {
    const el = listRef?.value
    if (!el?.getBoundingClientRect || !Number.isFinite(Number(clientY))) return null
    const rect = el.getBoundingClientRect()
    if (!rect) return null
    return findStoryboardIndexByOffset(offsets.value, Number(clientY) - rect.top)
  }

  function autoScrollDuringDrag(clientY) {
    const win = readWindow()
    if (!win?.scrollBy || !Number.isFinite(Number(clientY))) return
    const edge = 56
    if (clientY < edge) win.scrollBy(0, -32)
    else if (clientY > (win.innerHeight || 0) - edge) win.scrollBy(0, 32)
  }

  function onContainerDragOver(event) {
    if (event?.dataTransfer?.files?.length) return null
    const index = indexFromClientY(event?.clientY)
    if (!Number.isInteger(index)) return null
    draggingIndex.value = Number.isInteger(draggingIndex.value) ? draggingIndex.value : index
    pinAround(index)
    autoScrollDuringDrag(event.clientY)
    return index
  }

  function onContainerDrop(event) {
    const index = indexFromClientY(event?.clientY)
    draggingIndex.value = null
    return index
  }

  function onDragEnd() {
    draggingIndex.value = null
  }

  function measureVisibleItems() {
    const root = listRef?.value
    if (!root?.querySelectorAll) return
    const next = { ...measuredHeights.value }
    let changed = false
    for (const node of root.querySelectorAll('[data-storyboard-id]')) {
      const id = node.getAttribute('data-storyboard-id')
      const height = node.getBoundingClientRect?.().height
      if (id && Number.isFinite(height) && height > 0 && next[id] !== height) {
        next[id] = height
        changed = true
      }
    }
    if (changed) measuredHeights.value = next
  }

  function readScrollMetrics() {
    if (metrics) return
    const el = listRef?.value
    const win = readWindow()
    if (!el?.getBoundingClientRect || !win) return
    const rect = el.getBoundingClientRect()
    const viewportHeight = Math.max(1, win.innerHeight || STORYBOARD_LIST_DEFAULT_VIEWPORT_HEIGHT)
    const nextScrollTop = Math.max(0, -rect.top)
    scrollMetrics.value = {
      scrollTop: nextScrollTop,
      viewportHeight,
    }
    if (forceIndex.value == null) return
    const idx = forceIndex.value
    const prefix = offsets.value
    if (!Number.isInteger(idx) || idx < 0 || idx >= prefix.length - 1) {
      forceIndex.value = null
      return
    }
    const itemTop = prefix[idx]
    const itemBottom = prefix[idx + 1]
    const viewEnd = nextScrollTop + viewportHeight
    if (itemBottom > nextScrollTop && itemTop < viewEnd) forceIndex.value = null
  }

  let frame = null
  function scheduleRead() {
    const win = readWindow()
    if (!win?.requestAnimationFrame) {
      readScrollMetrics()
      measureVisibleItems()
      return
    }
    if (frame != null) return
    frame = win.requestAnimationFrame(() => {
      frame = null
      readScrollMetrics()
      measureVisibleItems()
    })
  }

  watch(visibleItems, () => {
    nextTick(() => measureVisibleItems())
  })

  watch(() => list().length, (length) => {
    if (focusedIndex.value != null && focusedIndex.value >= length) {
      focusedIndex.value = length > 0 ? length - 1 : null
    }
    if (forceIndex.value != null && forceIndex.value >= length) forceIndex.value = null
  })

  let unsubscribeReveal = () => {}

  onMounted(() => {
    unsubscribeReveal = subscribeStoryboardListReveal(revealById)
    const win = readWindow()
    if (win?.addEventListener) {
      win.addEventListener('scroll', scheduleRead, { passive: true, capture: true })
      win.addEventListener('resize', scheduleRead)
    }
    scheduleRead()
  })

  onBeforeUnmount(() => {
    unsubscribeReveal()
    const win = readWindow()
    if (win?.removeEventListener) {
      win.removeEventListener('scroll', scheduleRead, { capture: true })
      win.removeEventListener('resize', scheduleRead)
      if (frame != null && win.cancelAnimationFrame) win.cancelAnimationFrame(frame)
    }
    frame = null
  })

  return {
    windowState,
    visibleItems,
    pinAround,
    revealById,
    onFocusIn,
    onContainerDragOver,
    onContainerDrop,
    onDragEnd,
    indexFromClientY,
    scheduleRead,
    scrollMetrics,
    focusedIndex,
    forceIndex,
    draggingIndex,
    pinnedIndexes,
  }
}
