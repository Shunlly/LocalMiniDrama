<template>
  <div class="canvas-node-stack">
    <div
      class="canvas-media-node"
      :class="[
        'kind-' + data.kind,
        {
          highlighted: data.highlighted,
          dimmed: data.dimmed,
          focused: showPanel,
          processing: isNodeBusy,
          unknown: showMediaQueryWarning,
          pending: Boolean(pendingFrameCaption),
        },
      ]"
      role="button"
      tabindex="0"
      :aria-label="accessibleLabel"
      :aria-expanded="showPanel"
      @keydown.enter.stop.prevent="openPanel"
      @keydown.space.stop.prevent="openPanel"
    >
      <Handle type="target" :position="Position.Left" />
      <Handle v-if="data.kind !== 'video' && data.kind !== 'audio'" type="source" :position="Position.Right" />
      <CanvasNodeStatusOverlay :node-id="id" />
      <div class="tag">{{ kindLabel }}</div>
      <template v-if="data.kind === 'text'">
        <p class="text-body">{{ data.summary || '暂无脚本' }}</p>
      </template>
      <template v-else-if="data.kind === 'universal'">
        <p class="text-body universal-body">{{ data.summary || '暂无全能分镜词' }}</p>
      </template>
      <template v-else-if="data.kind === 'image'">
        <img v-if="imageUrl" :src="imageUrl" :alt="`${kindLabel}预览`" class="media-img" />
        <div v-else class="empty" :class="{ 'pending-frame': Boolean(pendingFrameCaption) }">{{ pendingFrameCaption || '无分镜图' }}</div>
      </template>
      <template v-else-if="data.kind === 'video'">
        <div v-if="data.url" class="media-video-wrap">
          <video
            :src="data.url"
            class="media-vid"
            :class="{ 'is-checking': videoState !== 'ready' }"
            muted
            playsinline
            preload="metadata"
            aria-hidden="true"
            @loadedmetadata="onVideoMetadata"
            @error="onVideoError"
          />
          <div v-if="videoState !== 'ready'" class="video-state" role="status">
            {{ videoState === 'invalid' ? '视频不可播放' : '正在校验视频' }}
          </div>
        </div>
        <div v-else class="empty">无视频</div>
      </template>
      <template v-else-if="data.kind === 'audio'">
        <div class="audio-wrap">
          <span>🎍</span>
          <span>{{ data.audioType === 'narration' ? '旁白' : '对白' }}</span>
        </div>
      </template>
      <div v-if="showMediaQueryWarning" class="unknown-pill">媒体未知</div>
    </div>
    <CanvasMediaPanel
      v-if="showPanel"
      :node-id="id"
      :kind="data.kind"
      :storyboard="data.storyboard"
      :summary="data.summary"
      :url="validatedMediaUrl"
      :audio-type="data.audioType"
      :frame-kind="data.frameKind"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasMediaPanel from './CanvasMediaPanel.vue'
import CanvasNodeStatusOverlay from './CanvasNodeStatusOverlay.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)
const videoState = ref('empty')

const isNodeBusy = computed(() => {
  const map = ctx?.nodeStatus?.map
  return map ? !!map[props.id] : false
})

const mediaQueryStatus = computed(() => ctx?.getStoryboardMediaQueryStatus?.(props.data.storyboard?.id) || {})
const showMediaQueryWarning = computed(() => (
  mediaQueryStatus.value?.state === 'unknown' && ['image', 'video', 'universal'].includes(props.data.kind)
))

const kindLabel = computed(() => {
  if (props.data.frameLabel) return props.data.frameLabel
  const map = { text: '脚本摘要', universal: '全能分镜词', image: '分镜图', video: '视频', audio: '音频' }
  return map[props.data.kind] || props.data.kind
})

const imageUrl = computed(() => String(props.data.url || '').trim())

const pendingFrameCaption = computed(() => {
  if (props.data.kind !== 'image' || imageUrl.value) return ''
  if (props.data.frameKind === 'first') return '待生成首帧'
  if (props.data.frameKind === 'last') return '待生成尾帧'
  return ''
})

const validatedMediaUrl = computed(() => (
  props.data.kind === 'video'
    ? (videoState.value === 'ready' ? props.data.url : '')
    : imageUrl.value
))

const accessibleLabel = computed(() => {
  const storyboardNumber = props.data.storyboard?.storyboard_number
  const suffix = storyboardNumber != null ? `，分镜 ${storyboardNumber}` : ''
  const videoStatus = props.data.kind === 'video'
    ? `，${videoState.value === 'ready' ? '可播放' : videoState.value === 'invalid' ? '不可播放' : '校验中'}`
    : ''
  const unknownStatus = showMediaQueryWarning.value ? '，媒体状态未知，可重试查询' : ''
  const title = pendingFrameCaption.value || kindLabel.value
  return `${title}${suffix}${videoStatus}${unknownStatus}，按 Enter 或空格展开`
})

function reportVideoState(state) {
  videoState.value = state
  ctx?.setMediaValidity?.(props.id, state)
}

function onVideoMetadata(event) {
  const duration = Number(event?.currentTarget?.duration)
  reportVideoState(Number.isFinite(duration) && duration > 0 ? 'ready' : 'invalid')
}

function onVideoError() {
  reportVideoState('invalid')
}

async function openPanel() {
  await ctx?.setFocusedNode?.(props.id)
}

watch(
  () => [props.data.kind, props.data.url],
  ([kind, url]) => {
    if (kind === 'video' && url) reportVideoState('checking')
    else {
      videoState.value = 'empty'
      ctx?.clearMediaValidity?.(props.id)
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.canvas-node-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.canvas-media-node {
  position: relative;
  width: 168px;
  min-height: 100px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--border-muted, #3f3f46);
  background: var(--canvas-node-surface, rgba(24, 24, 27, 0.95));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.canvas-media-node.focused {
  border-color: var(--canvas-indigo-strong, #818cf8);
  box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.35);
}

.canvas-media-node.unknown {
  border-color: var(--canvas-amber-strong, #fbbf24);
}
.canvas-media-node.pending {
  border-style: dashed;
  border-color: var(--canvas-indigo-border, rgba(129, 140, 248, 0.62));
}

.tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--canvas-indigo-strong, #818cf8);
  margin-bottom: 6px;
}

.text-body {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--canvas-text-secondary, #d4d4d8);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.media-img {
  width: 100%;
  height: 92px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}

.media-vid {
  width: 100%;
  height: 92px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--canvas-video-well, #000000);
}

.audio-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 8px;
  font-size: 12px;
  color: var(--canvas-amber-strong, #fbbf24);
}

.empty {
  font-size: 11px;
  color: var(--canvas-text-subtle, #71717a);
  padding: 20px 0;
  text-align: center;
}

.pending-frame {
  min-height: 92px;
  display: grid;
  place-items: center;
  padding: 0 8px;
  border: 1px dashed var(--border-muted, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}

.universal-body {
  -webkit-line-clamp: 8;
}

.kind-text { background: var(--canvas-media-text-surface, var(--canvas-node-surface)); }

.kind-universal {
  border-color: var(--canvas-violet-border, rgba(167, 139, 250, 0.5));
  background: var(--canvas-media-universal-surface, var(--canvas-node-surface));
}

.media-video-wrap {
  position: relative;
  width: 100%;
  height: 92px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--canvas-media-well, #09090b);
}

.media-vid.is-checking {
  visibility: hidden;
}

.video-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--canvas-text-muted, #a1a1aa);
  font-size: 11px;
}

.unknown-pill {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.14);
  color: var(--canvas-amber-text, #fcd34d);
  font-size: 10px;
  font-weight: 600;
}

.kind-universal .tag { color: var(--canvas-violet-text, #c4b5fd); }

.kind-image {
  border-color: var(--canvas-indigo-border, rgba(129, 140, 248, 0.4));
  background: var(--canvas-media-image-surface, var(--canvas-node-surface));
}

.kind-video {
  border-color: var(--canvas-pink-border, rgba(244, 114, 182, 0.4));
  background: var(--canvas-media-video-surface, var(--canvas-node-surface));
}

.kind-video .tag { color: var(--canvas-pink-text, #f472b6); }

.kind-audio {
  border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.4));
  background: var(--canvas-media-audio-surface, var(--canvas-node-surface));
}

.kind-audio .tag { color: var(--canvas-amber-text, #fcd34d); }

.canvas-media-node.processing { border-color: var(--canvas-info-text, #60a5fa); }
.highlighted { box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.55); }
.dimmed { opacity: 0.28; }

.canvas-media-node:focus-visible {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 3px;
}
</style>
