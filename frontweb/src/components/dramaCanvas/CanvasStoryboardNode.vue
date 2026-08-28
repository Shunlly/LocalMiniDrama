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

    <Teleport to="body">
      <aside
        v-if="showPanel"
        class="canvas-inspector-dock"
        aria-label="分镜编辑器"
        @keydown.esc.stop.prevent="closeInspector"
      >
        <div class="panel-wrap">
          <div class="inspector-context" role="status" aria-live="polite">
            <div class="inspector-context-copy">
              <strong>镜头 {{ inspectorNavigation.index }} / {{ inspectorNavigation.total }}</strong>
              <span class="inspector-media-summary">
                图片 {{ mediaSummary.imageCount }}
                <span aria-hidden="true">·</span>
                视频 {{ mediaSummary.videoCount }}
                <span aria-hidden="true">·</span>
                配音 {{ mediaSummary.audioReady ? '就绪' : '缺失' }}
              </span>
            </div>
            <div class="inspector-navigation" aria-label="分镜导航">
              <el-button
                circle
                size="small"
                :icon="ArrowLeft"
                :disabled="!inspectorNavigation.previousId"
                aria-label="上一镜"
                title="上一镜"
                @click.stop="navigateInspector(inspectorNavigation.previousId)"
              />
              <el-button
                circle
                size="small"
                :icon="ArrowRight"
                :disabled="!inspectorNavigation.nextId"
                aria-label="下一镜"
                title="下一镜"
                @click.stop="navigateInspector(inspectorNavigation.nextId)"
              />
            </div>
          </div>
          <CanvasStoryboardPanel
            :storyboard="data.storyboard"
            :episode-id="data.episodeId"
            :node-id="id"
          />
          <div
            v-if="mediaQueryUnknown"
            class="media-query-blocker"
            role="alert"
            @pointerdown.stop
            @mousedown.stop
            @click.stop
            @mouseup.stop
          >
            <p class="media-query-title">媒体查询失败</p>
            <p class="media-query-message">{{ mediaQueryMessage }}</p>
            <p class="media-query-note">
              {{ mediaQueryPreservedData ? '已保留上次加载到的媒体结果。' : '当前没有可确认的媒体结果。' }}
              为避免重复计费，图片和视频重新生成已暂时阻断。
            </p>
            <button
              type="button"
              class="media-query-retry"
              :disabled="retryingMedia"
              @click.stop="retryMedia"
            >
              {{ retryingMedia ? '重试中...' : '重试媒体查询' }}
            </button>
          </div>
        </div>
      </aside>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ElMessage } from 'element-plus'
import { canvasUserError } from '@/composables/useCanvasUserError'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { useCanvasContext } from '@/composables/useCanvasContext'
import {
  getStoryboardInspectorMediaSummary,
  getStoryboardInspectorNavigation,
  storyboardShotTypeLabel,
} from '@/utils/canvasUiState'
import CanvasStoryboardPanel from './CanvasStoryboardPanel.vue'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const ctx = useCanvasContext()
const retryingMedia = ref(false)
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

const isProcessing = computed(() => props.data.storyboard?.status === 'processing')

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const mediaQueryStatus = computed(() => props.data.mediaQueryStatus || ctx?.getStoryboardMediaQueryStatus?.(props.data.storyboard?.id) || {})
const mediaQueryUnknown = computed(() => mediaQueryStatus.value?.state === 'unknown')
const mediaQueryMessage = computed(() => mediaQueryStatus.value?.error || '媒体查询失败，请重试。')
const mediaQueryPreservedData = computed(() => Boolean(mediaQueryStatus.value?.preservedData))

const inspectorNavigation = computed(() => getStoryboardInspectorNavigation(
  ctx?.drama?.value?.episodes,
  props.data.episodeId,
  props.data.storyboard?.id,
))

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

const mediaSummary = computed(() => {
  const storyboardId = props.data.storyboard?.id
  const imageRecords = ctx?.imagesBySbId?.value?.[storyboardId]
  const videoRecords = ctx?.videosBySbId?.value?.[storyboardId]
  return getStoryboardInspectorMediaSummary({
    imageRecords,
    videoRecords,
    imageReady: mediaAvailability.value.imageReady,
    videoReady: mediaAvailability.value.videoReady,
    audioRecords: [
      props.data.storyboard?.audio_local_path,
      props.data.storyboard?.narration_audio_local_path,
    ],
  })
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

async function closeInspector() {
  await ctx?.clearFocusedNode?.({ restoreFocus: true })
}

async function navigateInspector(storyboardId) {
  if (storyboardId == null) return
  await ctx?.setFocusedNode?.(`sb:${storyboardId}`)
}

async function retryMedia() {
  if (!props.data.storyboard?.id || retryingMedia.value) return
  retryingMedia.value = true
  try {
    const ok = await ctx?.retryStoryboardMedia?.(props.data.storyboard.id)
    if (ok) ElMessage.success('媒体查询已刷新')
    else ElMessage.warning('媒体查询仍未恢复，请稍后重试')
  } catch (error) {
    ElMessage.error(canvasUserError(error, '媒体查询重试失败'))
  } finally {
    retryingMedia.value = false
  }
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

.canvas-inspector-dock {
  --canvas-card-surface: var(--bg-card, #18181b);
  --canvas-panel-surface: var(--bg-card, #18181b);
  --canvas-media-well: var(--bg-inner, #09090b);
  --canvas-text-primary: var(--text-primary, #e4e4e7);
  --canvas-text-secondary: var(--text-primary, #d4d4d8);
  --canvas-text-muted: var(--text-muted, #a1a1aa);
  --canvas-text-subtle: var(--text-subtle, #71717a);
  --canvas-text-faint: var(--text-faint, #52525b);
  --canvas-indigo-text: var(--accent-text, #a5b4fc);
  --canvas-indigo-strong: #818cf8;
  --canvas-indigo-border: var(--border-muted, rgba(129, 140, 248, 0.45));
  --canvas-amber-text: var(--status-warning, #fcd34d);
  --canvas-amber-strong: var(--status-warning, #fbbf24);
  --canvas-blue-text: #93c5fd;
  --canvas-success-text: var(--status-success, #34d399);
  --canvas-info-text: #60a5fa;
  --canvas-danger-text: #f87171;
  --canvas-chip-surface-soft: rgba(255, 255, 255, 0.06);
  --canvas-divider-strong: var(--border-muted, rgba(63, 63, 70, 0.8));
  --canvas-raised-shadow: var(--shadow, 0 12px 32px rgba(0, 0, 0, 0.45));
  position: fixed;
  top: 150px;
  right: 20px;
  z-index: 1200;
  width: min(460px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 174px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-radius: 10px;
  pointer-events: auto;
}

:global(html.light) .canvas-inspector-dock {
  --canvas-panel-surface: var(--bg-card, #ffffff);
  --canvas-media-well: var(--bg-inner, #fafafa);
  --canvas-text-primary: var(--text-primary, #27272a);
  --canvas-text-secondary: #374151;
  --canvas-text-muted: var(--text-muted, #4b5563);
  --canvas-text-subtle: var(--text-subtle, #6b7280);
  --canvas-text-faint: var(--text-subtle, #6b7280);
  --canvas-indigo-text: #4338ca;
  --canvas-indigo-strong: #4f46e5;
  --canvas-indigo-border: rgba(67, 56, 202, 0.48);
  --canvas-amber-text: #92400e;
  --canvas-amber-strong: #b45309;
  --canvas-blue-text: #1d4ed8;
  --canvas-success-text: #047857;
  --canvas-info-text: #1d4ed8;
  --canvas-danger-text: #b91c1c;
  --canvas-chip-surface-soft: rgba(15, 23, 42, 0.06);
  --canvas-divider-strong: #d4d4d8;
  --canvas-raised-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  color-scheme: light;
}

.panel-wrap {
  position: relative;
}

.inspector-context {
  display: flex;
  min-height: 50px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--canvas-divider-strong);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--canvas-panel-surface);
  color: var(--canvas-text-primary);
}

.inspector-context-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
  font-size: 12px;
}

.inspector-media-summary {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
  color: var(--canvas-text-muted);
  font-size: 11px;
}

.inspector-navigation {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.inspector-context + :deep(.sb-panel) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.canvas-inspector-dock :deep(.sb-panel) {
  width: 100%;
  max-width: none;
  margin-top: 0;
}

.media-query-blocker {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(9, 9, 11, 0.94);
  color: var(--canvas-text-primary, #e4e4e7);
  z-index: 2;
}

.media-query-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--canvas-amber-text, #fcd34d);
}

.media-query-message,
.media-query-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.media-query-note {
  color: var(--canvas-text-muted, #a1a1aa);
}

.media-query-retry {
  justify-self: flex-start;
  min-width: 112px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(251, 191, 36, 0.42);
  border-radius: 6px;
  background: rgba(251, 191, 36, 0.12);
  color: var(--canvas-amber-text, #fcd34d);
  font: inherit;
  cursor: pointer;
}

.media-query-retry:disabled {
  cursor: wait;
  opacity: 0.7;
}

.canvas-sb-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  .canvas-inspector-dock {
    top: 104px;
    right: 16px;
    width: calc(100vw - 32px);
    max-height: min(620px, calc(100vh - 120px));
  }
}
</style>
