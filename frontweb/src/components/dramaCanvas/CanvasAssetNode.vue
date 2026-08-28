<template>
  <div class="canvas-node-stack">
    <div
      class="canvas-asset-node"
      :class="[
        'kind-' + data.kind,
        {
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          focused: showPanel,
          processing: isNodeBusy || entityStatus === 'processing',
        },
      ]"
      role="button"
      tabindex="0"
      :aria-label="accessibleLabel"
      :aria-expanded="showPanel"
      @keydown.enter.stop.prevent="openPanel"
      @keydown.space.stop.prevent="openPanel"
    >
      <Handle type="source" :position="Position.Right" />
      <div class="cover">
        <img v-if="thumbUrl && !isNodeBusy" :src="thumbUrl" :alt="`${displayName}${kindLabel}参考图`" />
        <div v-else-if="!isNodeBusy" class="cover-placeholder">
          <span class="cover-icon" aria-hidden="true">{{ kindIcon }}</span>
          <span class="cover-empty">暂无参考图</span>
        </div>
        <CanvasNodeStatusOverlay :node-id="id" />
      </div>
      <div class="info">
        <div class="name-row">
          <span class="name">{{ displayName }}</span>
          <span v-if="statusChip" class="status-chip" :class="'st-' + statusChip.key">{{ statusChip.label }}</span>
        </div>
        <div class="kind">{{ kindLabel }}</div>
      </div>
    </div>
    <CanvasAssetPanel
      v-if="showPanel"
      :kind="data.kind"
      :entity="data.entity"
      :node-id="id"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { assetImageUrl } from '@/utils/mediaUrl'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasAssetPanel from './CanvasAssetPanel.vue'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

const kindLabel = computed(() => {
  const map = { character: '角色', scene: '场景', prop: '道具' }
  return map[props.data.kind] || '素材'
})

const kindIcon = computed(() => {
  const map = { character: '👤', scene: '🏞', prop: '🎭' }
  return map[props.data.kind] || '📦'
})

const displayName = computed(() => {
  const e = props.data.entity || {}
  return e.name || e.location || '未命名'
})

const thumbUrl = computed(() => assetImageUrl(props.data.entity))
const entityStatus = computed(() => props.data.entity?.status || '')

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const statusChip = computed(() => {
  const map = ctx?.nodeStatus?.map
  const busy = map?.[props.id]
  if (busy) return { key: 'busy', label: busy.message?.slice(0, 8) || '处理中' }
  const s = entityStatus.value
  if (s === 'processing') return { key: 'processing', label: '生成中' }
  if (s === 'failed') return { key: 'failed', label: '失败' }
  if (thumbUrl.value) return { key: 'ready', label: '有图' }
  return { key: 'empty', label: '无图' }
})

const accessibleLabel = computed(() => (
  `${kindLabel.value}${displayName.value}，${statusChip.value?.label || '暂无图片'}，按 Enter 或空格展开`
))

async function openPanel() {
  await ctx?.setFocusedNode?.(props.id)
}
</script>

<style scoped>
.canvas-node-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.canvas-asset-node {
  position: relative;
  width: 176px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-muted, #3f3f46);
  background: var(--canvas-card-surface, var(--bg-card, #18181b));
  box-shadow: var(--shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.canvas-asset-node.focused {
  border-color: var(--canvas-success-text, #34d399);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.45), var(--canvas-node-focus-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
}
.canvas-asset-node.processing {
  border-color: var(--canvas-info-text, #60a5fa);
  animation: asset-pulse 1.4s ease-in-out infinite;
}
.cover {
  position: relative;
  height: 108px;
  background: var(--canvas-media-well, #09090b);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 8px;
  border: 1px dashed var(--border-muted, #3f3f46);
  box-sizing: border-box;
}
.cover-icon {
  font-size: 28px;
  opacity: 0.7;
}
.cover-empty {
  font-size: 11px;
  color: var(--canvas-text-muted, #a1a1aa);
}
.info {
  padding: 8px 10px 10px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright, #fafafa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-chip {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--canvas-chip-surface, rgba(255, 255, 255, 0.08));
  color: var(--canvas-text-muted, #a1a1aa);
}
.canvas-asset-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}
.status-chip.st-busy,
.status-chip.st-processing { color: var(--canvas-info-text, #60a5fa); background: rgba(96, 165, 250, 0.15); }
.status-chip.st-ready { color: var(--canvas-success-text, #34d399); background: rgba(52, 211, 153, 0.12); }
.status-chip.st-empty { color: var(--canvas-text-muted, #a1a1aa); background: var(--canvas-chip-surface, rgba(255, 255, 255, 0.08)); }
.status-chip.st-failed { color: var(--canvas-danger-text, #f87171); background: rgba(248, 113, 113, 0.12); }
.kind {
  font-size: 11px;
  color: var(--canvas-text-subtle, var(--text-subtle, #71717a));
  margin-top: 2px;
}
.kind-character { border-color: var(--canvas-emerald-border, rgba(52, 211, 153, 0.45)); }
.kind-scene { border-color: var(--canvas-blue-border, rgba(96, 165, 250, 0.45)); }
.kind-prop { border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.45)); }
.highlighted {
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.65), 0 8px 24px rgba(52, 211, 153, 0.2);
}
.dimmed {
  opacity: 0.28;
  filter: grayscale(0.35);
}
@keyframes asset-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.25); }
  50% { box-shadow: 0 0 0 5px rgba(96, 165, 250, 0.06); }
}
</style>
