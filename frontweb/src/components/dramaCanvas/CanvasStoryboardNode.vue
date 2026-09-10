<template>
  <div class="canvas-node-stack">
    <div
      class="canvas-sb-node"
      :class="[
        `status-${statusState.key}`,
        {
          selected,
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          processing: isProcessing || isNodeBusy,
          focused: showPanel,
          unknown: mediaQueryUnknown,
        },
      ]"
      role="button"
      tabindex="0"
      :aria-label="accessibleLabel"
      :aria-expanded="showPanel"
      @keydown.enter.stop.prevent="openPanel"
      @keydown.space.stop.prevent="openPanel"
    >
      <Handle id="chain-in" type="target" :position="Position.Top" />
      <Handle type="target" :position="Position.Left" />
      <Handle type="source" :position="Position.Right" />
      <Handle id="chain-out" type="source" :position="Position.Bottom" />
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="head">
        <span class="num">#{{ data.storyboard?.storyboard_number ?? data.index }}</span>
        <span v-if="data.workflowGroup?.title" class="wf-badge">{{ data.workflowGroup.title }}</span>
        <span v-if="data.storyboard?.segment_title" class="seg">{{ data.storyboard.segment_title }}</span>
        <span v-if="data.storyboard?.creation_mode === 'universal'" class="mode-badge">全能</span>
      </div>
      <div class="title">{{ data.storyboard?.title || '分镜' }}</div>
      <div class="chips">
        <span v-if="data.storyboard?.shot_type">{{ storyboardShotTypeLabel(data.storyboard.shot_type) }}</span>
        <span v-if="data.storyboard?.duration">{{ data.storyboard.duration }} 秒</span>
        <span :class="'st-' + statusState.key">{{ statusState.label }}</span>
      </div>
      <div class="hint">
        {{ mediaQueryUnknown ? '媒体状态未知，重试查询后再继续生成' : (showPanel ? '右侧检查器可编辑与生成' : '单击展开操作，双击进入列表') }}
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'
import {
  storyboardShotTypeLabel,
} from '@/utils/canvasUiState'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

const isProcessing = computed(() => props.data.storyboard?.status === 'processing')

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const mediaQueryStatus = computed(() => props.data.mediaQueryStatus || ctx?.getStoryboardMediaQueryStatus?.(props.data.storyboard?.id) || {})
const mediaQueryUnknown = computed(() => mediaQueryStatus.value?.state === 'unknown')

const mediaAvailability = computed(() => {
  const base = props.data.mediaAvailability || {}
  const reportedVideoState = ctx?.mediaValidity?.[`sbvid:${props.data.storyboard?.id}`]
  const videoReady = reportedVideoState === 'invalid' || reportedVideoState === 'checking'
    ? false
    : Boolean(base.videoReady)
  return {
    imageReady: Boolean(base.imageReady),
    videoReady,
    ready: Boolean(base.imageReady) && videoReady,
    videoInvalid: reportedVideoState === 'invalid',
    videoChecking: reportedVideoState === 'checking',
  }
})

const statusState = computed(() => {
  const raw = props.data.storyboard?.status || 'pending'
  const media = mediaAvailability.value
  if (mediaQueryUnknown.value) return { key: 'unknown', label: '媒体状态未知' }
  if (isNodeBusy.value || raw === 'processing') return { key: 'processing', label: '生成中' }
  if (raw === 'failed') return { key: 'failed', label: '失败' }
  if (media.videoChecking) return { key: 'processing', label: '校验视频' }
  if (media.videoInvalid) return { key: 'missing', label: '视频不可播放' }
  if (media.ready) return { key: 'media-ready', label: '媒体就绪' }
  if (media.videoReady) return { key: 'video-ready', label: '视频就绪' }
  if (media.imageReady) return { key: 'image-ready', label: '图片就绪' }
  if (raw === 'media_ready') return { key: 'missing', label: '媒体缺失' }
  if (raw === 'completed') return { key: 'completed', label: '分镜已完成' }
  return { key: 'pending', label: '待处理' }
})

const accessibleLabel = computed(() => {
  const storyboard = props.data.storyboard || {}
  const number = storyboard.storyboard_number ?? props.data.index ?? '?'
  const unknownSuffix = mediaQueryUnknown.value ? '，媒体状态未知，可重试查询' : ''
  return `分镜 ${number}，${storyboard.title || '未命名'}，${statusState.value.label}${unknownSuffix}，按 Enter 或空格展开`
})

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

.canvas-sb-node {
  position: relative;
  width: 200px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--canvas-indigo-border, rgba(129, 140, 248, 0.35));
  background: var(--canvas-card-surface, var(--bg-card, #18181b));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.canvas-sb-node:hover,
.canvas-sb-node.selected,
.canvas-sb-node.focused {
  border-color: var(--canvas-indigo-strong, #818cf8);
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.35), var(--canvas-node-focus-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
}

.canvas-sb-node.unknown {
  border-color: var(--canvas-amber-strong, #fbbf24);
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.24), var(--canvas-node-focus-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.num {
  font-size: 14px;
  font-weight: 700;
  color: var(--canvas-indigo-text, #a5b4fc);
}

.wf-badge {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.18);
  color: var(--canvas-amber-text, #fcd34d);
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg {
  font-size: 12px;
  color: var(--canvas-text-subtle, #71717a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-badge {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(167, 139, 250, 0.2);
  color: var(--canvas-violet-text, #c4b5fd);
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-bright, #fafafa);
  margin-bottom: 6px;
  line-height: 1.35;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.chips span {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--canvas-chip-surface-soft, rgba(255, 255, 255, 0.06));
  color: var(--canvas-text-muted, #a1a1aa);
}

.st-completed,
.st-media-ready,
.st-video-ready,
.st-image-ready {
  color: var(--canvas-success-text, #34d399) !important;
  background: rgba(52, 211, 153, 0.12) !important;
}

.st-processing {
  color: var(--canvas-info-text, #60a5fa) !important;
}

.st-failed {
  color: var(--canvas-danger-text, #f87171) !important;
}

.st-missing,
.st-unknown {
  color: var(--canvas-amber-text, #fcd34d) !important;
  background: rgba(251, 191, 36, 0.12) !important;
}

.processing {
  animation: sb-pulse 1.4s ease-in-out infinite;
  border-color: var(--canvas-info-text, #60a5fa);
}

.highlighted {
  box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.75), 0 8px 28px rgba(99, 102, 241, 0.25);
}

.dimmed {
  opacity: 0.28;
}

@keyframes sb-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.35); }
  50% { box-shadow: 0 0 0 6px rgba(96, 165, 250, 0.08); }
}

.hint {
  font-size: 12px;
  color: var(--canvas-text-faint, #52525b);
}

.canvas-sb-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}

</style>
