<template>
  <div class="sidebar-section workflow-list">
    <div class="sec-label">工作流 {{ workflowGroups.length }}</div>
    <section
      v-for="group in workflowGroups"
      :key="group.id"
      class="sidebar-item workflow-item"
      :class="{ active: activeGroupId === group.id }"
    >
      <button
        type="button"
        class="workflow-group-select"
        :aria-pressed="activeGroupId === group.id"
        @click="emit('select-group', group.id)"
      >
        <span class="wf-item-title">{{ group.title }}</span>
        <span class="wf-item-meta">
          {{ (group.storyboard_ids || []).length }} 镜 · {{ (group.pipeline || []).join(' → ') }}
        </span>
      </button>

      <ol
        v-if="(group.storyboard_ids || []).length"
        class="workflow-storyboards"
        :aria-label="`${group.title || '工作流'}分镜执行顺序`"
        :aria-busy="reorderPending"
      >
        <li
          v-for="(storyboardId, index) in group.storyboard_ids"
          :key="storyboardId"
          class="workflow-storyboard"
          :class="{
            'is-dragging': isDraggedItem(group.id, index),
            'is-drag-target': isDragTarget(group.id, index),
          }"
          @dragover="onDragOver($event, group.id, index)"
          @drop.stop="onDrop($event, group.id, index)"
        >
          <span class="storyboard-order" aria-hidden="true">{{ index + 1 }}</span>
          <button
            type="button"
            class="storyboard-drag-handle"
            :draggable="!reorderDisabled"
            :disabled="reorderDisabled"
            :aria-label="dragHandleLabel(storyboardId, index, group.storyboard_ids.length)"
            title="拖动排序；按上下方向键移动"
            @click.stop
            @dragstart.stop="onDragStart($event, group.id, index)"
            @dragend="clearDragState"
            @keydown.up.prevent.stop="moveByKeyboard(group.id, index, -1, group.storyboard_ids.length)"
            @keydown.down.prevent.stop="moveByKeyboard(group.id, index, 1, group.storyboard_ids.length)"
          >
            <el-icon><Rank /></el-icon>
          </button>

          <div class="storyboard-summary">
            <span class="storyboard-title" :title="storyboardTitle(storyboardId)">
              {{ storyboardTitle(storyboardId) }}
            </span>
            <span class="storyboard-context">{{ storyboardContext(storyboardId) }}</span>
          </div>

          <div class="storyboard-order-actions">
            <button
              type="button"
              class="storyboard-order-button"
              :disabled="reorderDisabled || index === 0"
              :aria-label="`上移${storyboardTitle(storyboardId)}`"
              title="上移"
              @click.stop="requestMove(group.id, index, index - 1, group.storyboard_ids.length)"
            >
              <el-icon><ArrowUp /></el-icon>
            </button>
            <button
              type="button"
              class="storyboard-order-button"
              :disabled="reorderDisabled || index === group.storyboard_ids.length - 1"
              :aria-label="`下移${storyboardTitle(storyboardId)}`"
              title="下移"
              @click.stop="requestMove(group.id, index, index + 1, group.storyboard_ids.length)"
            >
              <el-icon><ArrowDown /></el-icon>
            </button>
          </div>
        </li>
      </ol>
    </section>
    <div v-if="!workflowGroups.length" class="sidebar-workflow-empty">
      <div class="workflow-empty-title">尚未创建工作流</div>
      <p>从顶部工作流工具中框选分镜后创建分组，分组会显示在这里。</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowDown, ArrowUp, Rank } from '@element-plus/icons-vue'

const props = defineProps({
  workflowGroups: { type: Array, default: () => [] },
  activeGroupId: { type: [String, Number], default: null },
  storyboardDetails: { type: Object, default: () => ({}) },
  reorderDisabled: { type: Boolean, default: false },
  reorderPending: { type: Boolean, default: false },
})

const emit = defineEmits(['select-group', 'reorder-storyboards'])
const draggedItem = ref(null)
const dragTarget = ref(null)

function storyboardDetail(storyboardId) {
  return props.storyboardDetails[String(storyboardId)] || {}
}

function storyboardTitle(storyboardId) {
  const detail = storyboardDetail(storyboardId)
  return detail.title || `分镜 #${detail.storyboardNumber ?? storyboardId}`
}

function storyboardContext(storyboardId) {
  const detail = storyboardDetail(storyboardId)
  const parts = []
  if (detail.episodeTitle) parts.push(detail.episodeTitle)
  parts.push(`#${detail.storyboardNumber ?? storyboardId}`)
  return parts.join(' · ')
}

function dragHandleLabel(storyboardId, index, total) {
  return `${storyboardTitle(storyboardId)}排序手柄，当前第 ${index + 1} 项，共 ${total} 项；按上下方向键移动`
}

function sameItem(item, groupId, index) {
  return item?.groupId === String(groupId) && item?.index === index
}

function isDraggedItem(groupId, index) {
  return sameItem(draggedItem.value, groupId, index)
}

function isDragTarget(groupId, index) {
  return sameItem(dragTarget.value, groupId, index)
}

function clearDragState() {
  draggedItem.value = null
  dragTarget.value = null
}

function onDragStart(event, groupId, index) {
  if (props.reorderDisabled) {
    event.preventDefault()
    return
  }
  draggedItem.value = { groupId: String(groupId), index }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${groupId}:${index}`)
  }
}

function onDragOver(event, groupId, index) {
  if (props.reorderDisabled || draggedItem.value?.groupId !== String(groupId)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragTarget.value = { groupId: String(groupId), index }
}

function onDrop(event, groupId, toIndex) {
  const source = draggedItem.value
  if (props.reorderDisabled || source?.groupId !== String(groupId)) {
    clearDragState()
    return
  }
  event.preventDefault()
  clearDragState()
  requestMove(groupId, source.index, toIndex)
}

function requestMove(groupId, fromIndex, toIndex, total = Number.POSITIVE_INFINITY) {
  if (
    props.reorderDisabled
    || fromIndex === toIndex
    || toIndex < 0
    || toIndex >= total
  ) return

  emit('select-group', groupId)
  emit('reorder-storyboards', { groupId, fromIndex, toIndex })
}

function moveByKeyboard(groupId, index, delta, total) {
  requestMove(groupId, index, index + delta, total)
}
</script>

<style scoped>
.sidebar-section {
  margin-bottom: 14px;
}

.sec-label {
  margin-bottom: 6px;
  color: var(--text-subtle, #71717a);
  font-size: 11px;
}

.sidebar-item {
  margin-bottom: 6px;
  overflow: hidden;
  border-radius: 6px;
  color: var(--text-primary, #e4e4e7);
  font-size: 12px;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: rgba(129, 140, 248, 0.12);
}

.sidebar-item.active {
  background: rgba(52, 211, 153, 0.16);
  color: var(--canvas-emerald-text, #6ee7b7);
}

.workflow-group-select {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.workflow-group-select:focus-visible,
.storyboard-drag-handle:focus-visible,
.storyboard-order-button:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: -2px;
}

.wf-item-title,
.wf-item-meta,
.storyboard-title,
.storyboard-context {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-item-title {
  font-weight: 600;
}

.wf-item-meta {
  margin-top: 2px;
  color: var(--canvas-text-faint, var(--text-faint, #52525b));
  font-size: 10px;
}

.workflow-storyboards {
  margin: 0;
  padding: 0 6px 6px;
  list-style: none;
}

.workflow-storyboard {
  display: grid;
  grid-template-columns: 14px 22px minmax(0, 1fr) auto;
  gap: 3px;
  align-items: center;
  min-height: 32px;
  padding: 2px;
  border-top: 1px solid var(--canvas-divider, rgba(63, 63, 70, 0.6));
  color: var(--canvas-text-secondary, #d4d4d8);
  transition: background 0.12s, opacity 0.12s, box-shadow 0.12s;
}

.workflow-storyboard.is-dragging {
  opacity: 0.45;
}

.workflow-storyboard.is-drag-target {
  background: rgba(129, 140, 248, 0.14);
  box-shadow: inset 0 0 0 1px var(--canvas-indigo-strong, #818cf8);
}

.storyboard-order {
  color: var(--canvas-text-faint, #71717a);
  font-size: 10px;
  text-align: center;
}

.storyboard-drag-handle,
.storyboard-order-button {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--canvas-text-muted, #a1a1aa);
  cursor: pointer;
}

.storyboard-drag-handle {
  cursor: grab;
}

.storyboard-drag-handle:active {
  cursor: grabbing;
}

.storyboard-drag-handle:hover:not(:disabled),
.storyboard-order-button:hover:not(:disabled) {
  background: var(--canvas-chip-surface, rgba(255, 255, 255, 0.08));
  color: var(--canvas-indigo-text, #a5b4fc);
}

.storyboard-drag-handle:disabled,
.storyboard-order-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.storyboard-summary {
  min-width: 0;
}

.storyboard-title {
  font-size: 11px;
  font-weight: 600;
}

.storyboard-context {
  color: var(--canvas-text-faint, #71717a);
  font-size: 9px;
}

.storyboard-order-actions {
  display: flex;
  flex: 0 0 auto;
}

.sidebar-workflow-empty {
  padding: 10px;
  border: 1px dashed var(--border-color, #3f3f46);
  border-radius: 6px;
  background: rgba(129, 140, 248, 0.05);
}

.workflow-empty-title {
  color: var(--text-primary, #e4e4e7);
  font-size: 12px;
  font-weight: 600;
}

.sidebar-workflow-empty p {
  margin: 4px 0 0;
  color: var(--canvas-text-subtle, var(--text-subtle, #71717a));
  font-size: 10px;
  line-height: 1.5;
}
</style>
