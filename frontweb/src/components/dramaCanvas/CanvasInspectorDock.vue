<template>
  <aside
    class="canvas-inspector-dock"
    :aria-label="dockAriaLabel"
    @keydown.esc.stop.prevent="closeInspector"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
  >
    <div class="panel-wrap">
      <template v-if="isStoryboard">
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
              :title="inspectorNavigation.previousId ? '上一镜' : '已经是第一镜'"
              @click.stop="navigateInspector(inspectorNavigation.previousId)"
            />
            <el-button
              circle
              size="small"
              :icon="ArrowRight"
              :disabled="!inspectorNavigation.nextId"
              aria-label="下一镜"
              :title="inspectorNavigation.nextId ? '下一镜' : '已经是最后一镜'"
              @click.stop="navigateInspector(inspectorNavigation.nextId)"
            />
          </div>
        </div>
        <CanvasStoryboardPanel
          :storyboard="node.data.storyboard"
          :episode-id="node.data.episodeId"
          :node-id="node.id"
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
            :title="retryingMedia ? '正在重试媒体查询，请稍候' : undefined"
            :aria-label="retryingMedia ? '正在重试媒体查询，请稍候' : '重试媒体查询'" @click.stop="retryMedia"
          >
            {{ retryingMedia ? '重试中…' : '重试媒体查询' }}
          </button>
        </div>
      </template>
      <CanvasScriptPanel
        v-else-if="isScript"
        :episode="node.data.episode"
        :node-id="node.id"
      />
      <CanvasMediaPanel
        v-else-if="isMedia"
        :node-id="node.id"
        :kind="node.data.kind"
        :storyboard="node.data.storyboard"
        :summary="node.data.summary"
        :url="mediaPanelUrl"
        :audio-type="node.data.audioType"
        :frame-kind="node.data.frameKind"
      />
      <CanvasAssetPanel
        v-else-if="isAsset"
        :kind="node.data.kind"
        :entity="node.data.entity"
        :node-id="node.id"
      />
    </div>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { canvasUserError } from '@/composables/useCanvasUserError'
import { toCanvasChineseMessage } from './canvasExperienceCopy.js'
import {
  getStoryboardInspectorMediaSummary,
  getStoryboardInspectorNavigation,
} from '@/utils/canvasUiState'
import CanvasStoryboardPanel from './CanvasStoryboardPanel.vue'
import CanvasScriptPanel from './CanvasScriptPanel.vue'
import CanvasMediaPanel from './CanvasMediaPanel.vue'
import CanvasAssetPanel from './CanvasAssetPanel.vue'

const props = defineProps({
  node: { type: Object, required: true },
})

const ctx = useCanvasContext()
const retryingMedia = ref(false)

const nodeType = computed(() => props.node?.type || '')
const isStoryboard = computed(() => nodeType.value === 'canvasStoryboard')
const isScript = computed(() => nodeType.value === 'canvasScript')
const isMedia = computed(() => nodeType.value === 'canvasMedia')
const isAsset = computed(() => nodeType.value === 'canvasAsset')

const dockAriaLabel = computed(() => {
  if (isStoryboard.value) return '分镜编辑器'
  if (isScript.value) return '剧本编辑器'
  if (isMedia.value) return '媒体编辑器'
  if (isAsset.value) return '素材编辑器'
  return '节点检查器'
})

const mediaQueryStatus = computed(() => (
  props.node.data?.mediaQueryStatus
  || ctx?.getStoryboardMediaQueryStatus?.(props.node.data?.storyboard?.id)
  || {}
))
const mediaQueryUnknown = computed(() => mediaQueryStatus.value?.state === 'unknown')
const mediaQueryMessage = computed(() => toCanvasChineseMessage(mediaQueryStatus.value?.error, '媒体查询失败，请重试。'))
const mediaQueryPreservedData = computed(() => Boolean(mediaQueryStatus.value?.preservedData))

const inspectorNavigation = computed(() => getStoryboardInspectorNavigation(
  ctx?.drama?.value?.episodes,
  props.node.data?.episodeId,
  props.node.data?.storyboard?.id,
))

const mediaAvailability = computed(() => {
  const base = props.node.data?.mediaAvailability || {}
  const reportedVideoState = ctx?.mediaValidity?.[`sbvid:${props.node.data?.storyboard?.id}`]
  const videoReady = reportedVideoState === 'invalid' || reportedVideoState === 'checking'
    ? false
    : Boolean(base.videoReady)
  return {
    imageReady: Boolean(base.imageReady),
    videoReady,
  }
})

const mediaSummary = computed(() => {
  const storyboardId = props.node.data?.storyboard?.id
  const imageRecords = ctx?.imagesBySbId?.value?.[storyboardId]
  const videoRecords = ctx?.videosBySbId?.value?.[storyboardId]
  return getStoryboardInspectorMediaSummary({
    imageRecords,
    videoRecords,
    imageReady: mediaAvailability.value.imageReady,
    videoReady: mediaAvailability.value.videoReady,
    audioRecords: [
      props.node.data?.storyboard?.audio_local_path,
      props.node.data?.storyboard?.narration_audio_local_path,
    ],
  })
})

const mediaPanelUrl = computed(() => {
  const data = props.node.data || {}
  if (data.kind !== 'video') return data.url || ''
  const reported = ctx?.mediaValidity?.[props.node.id]
  if (reported === 'invalid' || reported === 'checking') return ''
  return data.url || ''
})

async function closeInspector() {
  await ctx?.clearFocusedNode?.({ restoreFocus: true })
}

async function navigateInspector(storyboardId) {
  if (storyboardId == null) return
  await ctx?.setFocusedNode?.(`sb:${storyboardId}`)
}

async function retryMedia() {
  const storyboardId = props.node.data?.storyboard?.id
  if (!storyboardId || retryingMedia.value) return
  retryingMedia.value = true
  try {
    const ok = await ctx?.retryStoryboardMedia?.(storyboardId)
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
.canvas-inspector-dock {
  --canvas-card-surface: var(--bg-card, #18181b);
  --canvas-panel-surface: var(--bg-card, #18181b);
  --canvas-media-well: var(--bg-inner, #09090b);
  --canvas-text-primary: var(--text-primary, #e4e4e7);
  --canvas-text-secondary: var(--text-secondary, #d4d4d8);
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
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
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

.canvas-inspector-dock :deep(.sb-panel),
.canvas-inspector-dock :deep(.script-panel),
.canvas-inspector-dock :deep(.media-panel),
.canvas-inspector-dock :deep(.asset-panel) {
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

@media (max-width: 769px) {
  .canvas-inspector-dock {
    top: 104px;
    right: 16px;
    width: calc(100vw - 32px);
    max-height: min(620px, calc(100vh - 120px));
  }
}
</style>
