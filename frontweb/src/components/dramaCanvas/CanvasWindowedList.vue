<template>
  <div
    ref="rootRef"
    class="canvas-windowed-list"
    :data-window-name="name"
    :data-window-count="visibleItems.length"
    :data-window-total="items.length"
    :data-window-start="windowState.start"
    :style="{ maxHeight: viewport + 'px' }"
    @scroll.passive="onScroll"
  >
    <div
      v-if="windowState.topSpacer > 0"
      class="canvas-windowed-list-spacer"
      :style="{ height: windowState.topSpacer + 'px' }"
      aria-hidden="true"
    />
    <template v-for="entry in visibleItems" :key="entry.key">
      <slot name="item" :item="entry.item" :index="entry.index" />
    </template>
    <div
      v-if="windowState.bottomSpacer > 0"
      class="canvas-windowed-list-spacer"
      :style="{ height: windowState.bottomSpacer + 'px' }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  LIST_WINDOW_DEFAULT_ROW_HEIGHT,
  LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT,
  computeListWindow,
  scrollTopForIndex,
  visibleWindowItems,
} from '@/utils/listWindow.js'

/** 侧栏/素材列表的视口窗口：只挂载当前窗口内的行。 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  itemKey: { type: Function, default: (_item, index) => index },
  name: { type: String, default: '' },
  rowHeight: { type: Number, default: LIST_WINDOW_DEFAULT_ROW_HEIGHT },
  viewportHeight: { type: Number, default: LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT },
  forceIndex: { default: null },
})

const rootRef = ref(null)
const scrollTop = ref(0)
const measuredViewport = ref(0)

const viewport = computed(() => (
  measuredViewport.value > 0
    ? measuredViewport.value
    : Math.max(1, Number(props.viewportHeight) || LIST_WINDOW_DEFAULT_VIEWPORT_HEIGHT)
))

const windowState = computed(() => computeListWindow({
  total: props.items.length,
  scrollTop: scrollTop.value,
  viewportHeight: viewport.value,
  rowHeight: props.rowHeight,
}))

const visibleItems = computed(() => (
  visibleWindowItems(props.items, windowState.value).map(({ item, index }) => ({
    item,
    index,
    key: String(props.itemKey(item, index) ?? index),
  }))
))

function readScrollMetrics(el) {
  if (!el) return
  scrollTop.value = Math.max(0, Number(el.scrollTop) || 0)
  const height = Number(el.clientHeight)
  if (Number.isFinite(height) && height > 0) measuredViewport.value = height
}

function onScroll(event) {
  readScrollMetrics(event?.target)
}

function parsedForceIndex() {
  if (props.forceIndex == null || props.forceIndex === '') return null
  const next = Number(props.forceIndex)
  return Number.isInteger(next) ? next : null
}

function applyScrollTop(nextTop) {
  const top = Math.max(0, Number(nextTop) || 0)
  scrollTop.value = top
  nextTick(() => {
    if (rootRef.value) rootRef.value.scrollTop = top
  })
}

function revealIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= props.items.length) return
  applyScrollTop(scrollTopForIndex(index, {
    rowHeight: props.rowHeight,
    viewportHeight: viewport.value,
  }))
}

watch(() => props.items, () => {
  const index = parsedForceIndex()
  if (index == null) applyScrollTop(0)
  else revealIndex(index)
}, { flush: 'post' })

watch(() => parsedForceIndex(), (index) => {
  if (index != null) revealIndex(index)
}, { immediate: true, flush: 'post' })

onMounted(() => {
  const index = parsedForceIndex()
  if (index != null) revealIndex(index)
  else applyScrollTop(scrollTop.value)
})
</script>

<style scoped>
.canvas-windowed-list {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.canvas-windowed-list-spacer {
  flex-shrink: 0;
  pointer-events: none;
}
</style>
