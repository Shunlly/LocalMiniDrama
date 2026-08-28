<template>
  <div
    class="canvas-node-panel media-panel nodrag nopan nowheel"
    tabindex="-1"
    :class="['kind-' + kind, { unknown: showMediaQueryBlocker }]"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
  >
    <div class="panel-head">
      <span>{{ kindTitle }}</span>
      <div class="head-right">
        <span v-if="busyLabel" class="busy-tag">{{ busyLabel }}</span>
        <el-button link size="small" @click.stop="closePanel">收起</el-button>
      </div>
    </div>
    <div v-if="audioOutcomeUnknown" class="media-query-blocker" role="alert">
      <p class="media-query-title">配音结果待确认</p>
      <p class="media-query-note">服务端可能仍在合成并产生费用，请刷新分镜状态后再决定是否重试。</p>
      <el-button size="small" type="warning" plain @click.stop="refreshAfterUnknownAudio">刷新分镜状态</el-button>
    </div>

    <div
      v-if="showMediaQueryBlocker"
      class="media-query-blocker"
      role="alert"
    >
      <p class="media-query-title">媒体状态未知</p>
      <p class="media-query-message">{{ mediaQueryMessage }}</p>
      <p class="media-query-note">
        {{ mediaQueryPreservedData ? '已保留上次加载到的媒体结果。' : '当前没有可确认的媒体结果。' }}
        为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。
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

    <div class="panel-body">
      <template v-if="kind === 'text'">
        <p class="summary">{{ summary || '暂无脚本内容' }}</p>
        <el-button size="small" type="primary" plain @click.stop="focusStoryboard">编辑脚本</el-button>
      </template>

      <template v-else-if="kind === 'universal'">
        <p class="summary">{{ summary || '暂无全能分镜词' }}</p>
        <div class="panel-actions">
          <el-button size="small" plain @click.stop="focusStoryboard">编辑</el-button>
          <CanvasActionGate
            :reason="videoAction.reason"
            label="重新生成单镜视频"
            :description-id="videoReasonId"
            :config-service-type="videoAction.serviceType"
          >
            <el-button
              size="small"
              type="primary"
              :loading="busy"
              :disabled="Boolean(videoAction.reason)"
              @click.stop="runStep('video')"
            >重新生成视频</el-button>
          </CanvasActionGate>
        </div>
      </template>

      <template v-else-if="kind === 'image'">
        <div class="preview-wrap">
          <img v-if="url && !busy" :src="url" :alt="frameTitle ? `${frameTitle}预览` : ''" class="preview-img" />
          <div v-else-if="!busy" class="preview-empty">{{ frameTitle ? `无${frameTitle}` : '无分镜图' }}</div>
          <div v-if="busy" class="preview-loading"><span class="spinner" />{{ frameBusyLabel }}</div>
        </div>
        <el-button size="small" type="primary" :loading="busy" @click.stop="runStep('image')">{{ frameActionLabel }}</el-button>
      </template>

      <template v-else-if="kind === 'video'">
        <div class="preview-wrap">
          <video v-if="url && !busy" :src="url" class="preview-vid" controls playsinline aria-label="画布分镜视频预览" />
          <div v-else-if="!busy" class="preview-empty">无视频</div>
          <div v-if="busy" class="preview-loading"><span class="spinner" />生视频中...</div>
        </div>
        <CanvasActionGate
          :reason="videoAction.reason"
          label="重新生成单镜视频"
          :description-id="videoReasonId"
          :config-service-type="videoAction.serviceType"
        >
          <el-button
            size="small"
            type="primary"
            :loading="busy"
            :disabled="Boolean(videoAction.reason)"
            @click.stop="runStep('video')"
          >重新生成视频</el-button>
        </CanvasActionGate>
      </template>

      <template v-else-if="kind === 'audio'">
        <div class="audio-label">{{ audioType === 'narration' ? '旁白音频' : '对白音频' }}</div>
        <audio v-if="url" :src="url" controls class="preview-aud" />
        <CanvasActionGate
          :reason="ttsAction.reason"
          label="重新生成单镜配音"
          :description-id="ttsReasonId"
          :config-service-type="ttsAction.serviceType"
        >
          <el-button
            size="small"
            type="warning"
            :loading="busy"
            :disabled="Boolean(ttsAction.reason) || audioOutcomeUnknown"
            @click.stop="runStep('audio')"
          >重新配音</el-button>
        </CanvasActionGate>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'
import { runImageStep, runFrameImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import CanvasActionGate from './CanvasActionGate.vue'

const props = defineProps({
  nodeId: { type: String, default: '' },
  kind: { type: String, required: true },
  storyboard: { type: Object, default: null },
  summary: { type: String, default: '' },
  url: { type: String, default: '' },
  audioType: { type: String, default: 'dialogue' },
  frameKind: { type: String, default: '' },
})

const ctx = useCanvasContext()
const busy = ref(false)
const retryingMedia = ref(false)
const audioOutcomeUnknown = ref(false)
let generationRun = null

onBeforeUnmount(() => {
  generationRun?.abort()
  generationRun = null
})

const sbNodeId = computed(() => (props.storyboard?.id ? `sb:${props.storyboard.id}` : ''))
const unavailableProductionAction = Object.freeze({
  ready: false,
  reason: '无法确认正式制作能力，请刷新后重试。',
  serviceType: '',
})
const videoAction = computed(() => ctx?.productionActions?.value?.video || unavailableProductionAction)
const ttsAction = computed(() => ctx?.productionActions?.value?.tts || unavailableProductionAction)
const videoReasonId = computed(() => `canvas-media-video-reason-${props.nodeId || props.storyboard?.id || 'unknown'}`)
const ttsReasonId = computed(() => `canvas-media-tts-reason-${props.nodeId || props.storyboard?.id || 'unknown'}`)
const mediaQueryStatus = computed(() => ctx?.getStoryboardMediaQueryStatus?.(props.storyboard?.id) || {})
const mediaQueryUnknown = computed(() => mediaQueryStatus.value?.state === 'unknown')
const mediaQueryMessage = computed(() => mediaQueryStatus.value?.error || '媒体查询失败，请重试。')
const mediaQueryPreservedData = computed(() => Boolean(mediaQueryStatus.value?.preservedData))
const showMediaQueryBlocker = computed(() => (
  mediaQueryUnknown.value && ['image', 'video', 'universal'].includes(props.kind)
))

const frameTitle = computed(() => {
  if (props.frameKind === 'first') return '首帧'
  if (props.frameKind === 'last') return '尾帧'
  return ''
})
const kindTitle = computed(() => {
  if (frameTitle.value) return frameTitle.value
  const map = { text: '脚本摘要', universal: '全能分镜词', image: '分镜图', video: '视频', audio: '音频' }
  return map[props.kind] || '媒体'
})
const frameActionLabel = computed(() => (
  frameTitle.value ? `重新生成${frameTitle.value}` : '重新生成图'
))
const frameBusyLabel = computed(() => (
  frameTitle.value ? `${frameTitle.value}生成中...` : '生图中...'
))

const busyLabel = computed(() => {
  const map = ctx?.nodeStatus?.map
  const id = props.nodeId || sbNodeId.value
  return id && map ? map[id]?.message : ''
})

function focusStoryboard() {
  if (sbNodeId.value) ctx?.setFocusedNode?.(sbNodeId.value)
}

function closePanel() {
  ctx?.clearFocusedNode?.()
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return
  if ((step === 'image' || step === 'video') && mediaQueryUnknown.value) {
    ElMessage.warning('当前媒体状态未知。为避免重复计费，请先重试媒体查询，再继续重新生成图片或视频。')
    return
  }
  if (step === 'video' || step === 'audio') {
    const allowed = ctx?.ensureProductionStepReady?.(step)
    if (allowed !== true) {
      if (allowed == null) ElMessage.warning('无法确认正式制作能力，请刷新后重试。')
      return
    }
  }
  if (step === 'audio' && audioOutcomeUnknown.value) {
    ElMessage.warning('请先刷新分镜状态，确认上一次配音结果后再重试')
    return
  }
  const nextRun = ctx?.beginNodeGeneration?.({ nodeId: props.nodeId || sbNodeId.value, step }) || null
  if (!nextRun) {
    ElMessage.warning('已有单节点生成正在执行，请等待完成后再试')
    return
  }
  generationRun = nextRun
  busy.value = true
  const statusMsg = CANVAS_NODE_STATUS_LABELS[step] || '处理中...'
  ctx?.nodeStatus?.set(props.nodeId, { step, message: statusMsg })
  ctx?.nodeStatus?.set(sbNodeId.value, { step, message: statusMsg })
  try {
    const found = findStoryboardInDrama(drama, sbId)
    const sb = found?.storyboard || props.storyboard
    const genOpts = ctx?.getGenerationOptions?.() || getDramaGenerationOptions(drama)
    if (step === 'image' && props.frameKind) {
      await runFrameImageStep(drama, sb, genOpts, props.frameKind, {
        signal: generationRun.signal,
        onWarning: (warning) => ElMessage.warning(warning?.message || '已改用本地帧提示词'),
      })
    }
    else if (step === 'image') await runImageStep(drama, sb, genOpts, { signal: generationRun.signal })
    else if (step === 'video') await runVideoStep(drama, sb, genOpts, { signal: generationRun.signal })
    else if (step === 'audio') {
      const res = await runAudioStep(sb, { signal: generationRun.signal })
      if (res?.skipped) {
        ElMessage.info(res.reason || '已跳过')
        return
      }
    }
    ElMessage.success('生成完成')
    await ctx?.refresh?.()
  } catch (error) {
    if (error?.code === 'SUBMISSION_OUTCOME_UNKNOWN') audioOutcomeUnknown.value = true
    if (error?.name !== 'AbortError' && !generationRun?.signal.aborted) {
      ElMessage.error(error?.message || '生成失败')
    }
  } finally {
    generationRun?.finish()
    generationRun = null
    busy.value = false
    ctx?.nodeStatus?.clear(props.nodeId)
    ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

async function refreshAfterUnknownAudio() {
  try {
    await ctx?.refresh?.()
    audioOutcomeUnknown.value = false
    ElMessage.success('分镜状态已刷新')
  } catch (error) {
    ElMessage.error(error?.message || '刷新失败，请稍后重试')
  }
}

async function retryMedia() {
  if (!props.storyboard?.id || retryingMedia.value) return
  retryingMedia.value = true
  try {
    const ok = await ctx?.retryStoryboardMedia?.(props.storyboard.id)
    if (ok) ElMessage.success('媒体查询已刷新')
    else ElMessage.warning('媒体查询仍未恢复，请稍后重试')
  } catch (error) {
    ElMessage.error(error?.message || '媒体查询重试失败')
  } finally {
    retryingMedia.value = false
  }
}
</script>

<style scoped>
.media-panel {
  margin-top: 10px;
  width: min(360px, 90vw);
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid var(--canvas-indigo-border, rgba(129, 140, 248, 0.4));
  background: var(--canvas-panel-surface, rgba(15, 15, 18, 0.96));
  box-shadow: var(--canvas-raised-shadow, 0 10px 28px rgba(0, 0, 0, 0.4));
}

.media-panel.unknown {
  border-color: rgba(251, 191, 36, 0.45);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  color: var(--canvas-indigo-text, #a5b4fc);
  margin-bottom: 8px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.busy-tag {
  font-size: 10px;
  color: var(--canvas-blue-text, #93c5fd);
}

.media-query-blocker {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.media-query-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--canvas-amber-text, #fcd34d);
}

.media-query-message,
.media-query-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--canvas-text-secondary, #d4d4d8);
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

.panel-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.summary {
  flex: 1;
  min-width: 180px;
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--canvas-text-secondary, #d4d4d8);
  max-height: 72px;
  overflow-y: auto;
}

.preview-wrap {
  position: relative;
  width: 120px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: var(--canvas-media-well, #09090b);
}

.preview-img,
.preview-vid {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--canvas-text-subtle, #71717a);
}

.preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--canvas-loading-surface, rgba(9, 9, 11, 0.85));
  font-size: 10px;
  color: #d4d4d8;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--canvas-spinner-track, rgba(255, 255, 255, 0.12));
  border-top-color: var(--canvas-indigo-strong, #818cf8);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

.preview-aud {
  flex: 1;
  min-width: 160px;
}

.audio-label {
  font-size: 11px;
  color: var(--canvas-amber-strong, #fbbf24);
  width: 100%;
}

.panel-actions {
  display: flex;
  gap: 8px;
}

.kind-video {
  border-color: var(--canvas-pink-border, rgba(244, 114, 182, 0.45));
}

.kind-video .panel-head {
  color: var(--canvas-pink-text, #f472b6);
}

.kind-universal {
  border-color: var(--canvas-violet-border, rgba(167, 139, 250, 0.45));
}

.kind-universal .panel-head {
  color: var(--canvas-violet-text, #c4b5fd);
}

.kind-audio {
  border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.45));
}

.kind-audio .panel-head {
  color: var(--canvas-amber-text, #fcd34d);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
