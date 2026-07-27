<template>
  <article
    class="free-canvas-node"
    :class="[`type-${node.type}`, configStateClass, { readonly, loading: isLoading, failed: hasError }]"
    :data-free-node-id="String(node.id)"
    tabindex="-1"
    :aria-label="`${typeLabel}：${displayTitle}`"
  >
    <Handle v-if="isFreeMode" type="target" :position="Position.Left" />
    <header class="node-header">
      <span class="node-kind">{{ typeLabel }}</span>
      <span v-if="isConfigNode" class="node-state" :class="`state-${configRuntime.status}`" role="status">
        {{ configRuntime.statusLabel }}
      </span>
      <span v-else-if="isLoading" class="node-state" role="status">加载中</span>
      <span v-else-if="hasError" class="node-state error" role="alert" aria-live="assertive">加载失败</span>
    </header>

    <h3 class="node-title">{{ displayTitle }}</h3>
    <section v-if="isConfigNode" class="config-runtime nodrag nopan" :aria-label="configRuntime.statusLabel">
      <p class="config-input">{{ configRuntime.inputSummary }}</p>
      <p v-if="configRuntime.providerLabel" class="config-provider">
        {{ configRuntime.providerLabel }}<span v-if="configRuntime.modelLabel"> · {{ configRuntime.modelLabel }}</span>
      </p>
      <p class="config-reason" :class="`state-${configRuntime.status}`">{{ configRuntime.reason }}</p>
    </section>
    <div
      v-else-if="isMediaNode"
      class="node-media nodrag nopan nowheel"
      :class="{ 'is-loading': isLoading, 'is-error': hasError }"
      :aria-busy="isLoading"
    >
      <img
        v-if="node.type === 'image' && mediaUrl"
        :key="mediaRenderKey"
        :src="mediaUrl"
        :alt="`${displayTitle}预览图`"
        class="node-media-element"
        @load="markMediaReady"
        @error="markMediaFailed"
      />
      <video
        v-else-if="node.type === 'video' && mediaUrl"
        :key="mediaRenderKey"
        :src="mediaUrl"
        class="node-media-element"
        controls
        preload="metadata"
        :aria-label="`${displayTitle}视频预览`"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
        @dblclick.stop
        @loadedmetadata="markMediaReady"
        @error="markMediaFailed"
      />
      <span v-if="isLoading" class="media-state" role="status" aria-live="polite">正在加载预览</span>
      <span v-else-if="hasError" class="media-state error" role="alert" aria-live="assertive">
        {{ mediaUrl ? '素材预览失败' : '未找到可预览素材' }}
      </span>
    </div>
    <el-input
      v-else-if="isEditable"
      class="node-editor nodrag nopan"
      type="textarea"
      resize="none"
      :rows="4"
      :model-value="displayContent"
      :aria-label="`${typeLabel}内容`"
      @update:model-value="updateContent"
      @blur="finishEditing"
      @keydown.esc.stop.prevent="finishEditing"
    />
    <p v-else class="node-content">{{ displayContent || emptyLabel }}</p>

    <footer class="node-footer nodrag nopan">
      <el-tooltip v-if="isConfigNode && configRuntime.canConfigure && !readonly" content="打开 AI 配置" placement="bottom">
        <el-button size="small" circle aria-label="打开 AI 配置" title="打开 AI 配置" @click="emit('request-configure', node.id)">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="isConfigNode && configRuntime.canCancel && !readonly" content="停止等待" placement="bottom">
        <el-button size="small" circle aria-label="停止等待" title="停止等待" @click="emit('request-cancel-config', node.id)">
          <el-icon><CircleClose /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="isConfigNode && configRuntime.canRetry && !readonly" content="重试配置检查" placement="bottom">
        <el-button size="small" circle aria-label="重试配置检查" title="重试配置检查" @click="emit('request-retry-config', node.id)">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="hasError && !readonly" content="重试" placement="bottom">
        <el-button size="small" circle aria-label="重试" title="重试" @click="retryMedia">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="node.type === 'reference' && !readonly" content="转换为制作内容" placement="bottom">
        <el-button size="small" circle aria-label="转换为制作内容" title="转换为制作内容" @click="emit('request-convert', node.id)">
          <el-icon><Switch /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="!readonly" content="删除节点" placement="bottom">
        <el-button size="small" circle aria-label="删除节点" title="删除节点" @click="emit('request-delete', node.id)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </el-tooltip>
    </footer>
    <Handle v-if="isFreeMode" type="source" :position="Position.Right" />
  </article>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { CircleClose, Delete, RefreshRight, Setting, Switch } from '@element-plus/icons-vue'

const props = defineProps({
  node: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  freeMode: { type: Boolean, default: false },
  mediaUrl: { type: String, default: '' },
  editing: { type: Boolean, default: false },
  configRuntime: {
    type: Object,
    default: () => ({
      status: 'blocked',
      statusLabel: '需要配置',
      inputSummary: '尚未连接文本、图片、视频或制作引用',
      reason: '视频生成未就绪，请前往 AI 配置完成配置。',
      providerLabel: '',
      modelLabel: '',
      canConfigure: true,
      canCancel: false,
      canRetry: false,
    }),
  },
})

const emit = defineEmits([
  'update-content',
  'request-convert',
  'request-delete',
  'request-retry',
  'request-configure',
  'request-cancel-config',
  'request-retry-config',
  'request-finish-edit',
])

const labels = {
  text: '文本',
  image: '图片',
  video: '视频',
  config: '配置',
  reference: '引用',
}

const typeLabel = computed(() => labels[props.node.type] || '节点')
const displayTitle = computed(() => String(props.node.title || props.node.label || typeLabel.value))
const displayContent = computed(() => String(props.node.content ?? props.node.text ?? props.node.description ?? ''))
const isFreeMode = computed(() => props.freeMode)
const isConfigNode = computed(() => props.node.type === 'config')
const configStateClass = computed(() => isConfigNode.value ? `config-${props.configRuntime.status}` : '')
const isEditable = computed(() => props.editing && !props.readonly && props.node.type === 'text')
const isMediaNode = computed(() => ['image', 'video'].includes(props.node.type))
const mediaState = ref('idle')
const mediaAttempt = ref(0)
const mediaRenderKey = computed(() => `${props.node.id}:${props.mediaUrl}:${mediaAttempt.value}`)
const isLoading = computed(() => isMediaNode.value && mediaState.value === 'loading')
const hasError = computed(() => isMediaNode.value && mediaState.value === 'error')
const emptyLabel = computed(() => isLoading.value ? '内容加载中' : (hasError.value ? '内容加载失败' : '暂无内容'))

function updateContent(content) {
  emit('update-content', { id: props.node.id, content })
}

function finishEditing() {
  emit('request-finish-edit', props.node.id)
}

function markMediaReady() {
  mediaState.value = 'ready'
}

function markMediaFailed() {
  mediaState.value = 'error'
}

function retryMedia() {
  mediaAttempt.value += 1
  mediaState.value = props.mediaUrl ? 'loading' : 'error'
  emit('request-retry', props.node.id)
}

watch(
  () => `${props.node.id}\u0000${props.node.type}\u0000${props.mediaUrl}`,
  () => {
    mediaAttempt.value = 0
    mediaState.value = isMediaNode.value && props.mediaUrl ? 'loading' : (isMediaNode.value ? 'error' : 'idle')
  },
  { immediate: true },
)
</script>

<style scoped>
.free-canvas-node {
  box-sizing: border-box;
  display: grid;
  width: 280px;
  height: 208px;
  grid-template-rows: 24px 20px minmax(72px, 1fr) 24px;
  gap: 8px;
  overflow: hidden;
  padding: 12px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 6px;
  background: var(--canvas-card-surface, var(--bg-card, #18181b));
  color: var(--canvas-text-primary, var(--text-primary, #e4e4e7));
  box-shadow: var(--shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
}

.free-canvas-node.loading { border-color: var(--canvas-info-text, #60a5fa); }
.free-canvas-node.failed { border-color: var(--canvas-danger-text, #f87171); }
.free-canvas-node.type-reference { border-color: var(--canvas-amber-border, rgba(251, 191, 36, 0.5)); }
.free-canvas-node.config-blocked,
.free-canvas-node.config-error,
.free-canvas-node.config-failed { border-color: var(--canvas-danger-text, #f87171); }
.free-canvas-node.config-mock { border-color: var(--canvas-amber-border, #fbbf24); }
.free-canvas-node.config-ready { border-color: var(--canvas-success-text, #34d399); }
.free-canvas-node.config-running { border-color: var(--canvas-info-text, #60a5fa); }

.node-header,
.node-footer {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.node-kind,
.node-state {
  font-size: 12px;
  color: var(--canvas-text-subtle, var(--text-subtle, #a1a1aa));
}

.node-state.error { color: var(--canvas-danger-text, #f87171); }
.node-state.state-blocked,
.node-state.state-error,
.node-state.state-failed,
.config-reason.state-blocked,
.config-reason.state-error,
.config-reason.state-failed { color: var(--canvas-danger-text, #f87171); }
.node-state.state-mock,
.config-reason.state-mock { color: var(--canvas-amber-text, #fbbf24); }
.node-state.state-ready { color: var(--canvas-success-text, #34d399); }

.node-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text-bright, #fafafa);
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-content {
  display: -webkit-box;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  color: var(--canvas-text-muted, var(--text-muted, #a1a1aa));
  font-size: 12px;
  line-height: 18px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.config-runtime {
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 5px;
  overflow: hidden;
}

.config-runtime p {
  margin: 0;
  overflow: hidden;
  font-size: 11px;
  line-height: 16px;
}

.config-input {
  display: -webkit-box;
  color: var(--canvas-text-muted, var(--text-muted, #a1a1aa));
  white-space: pre-line;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.config-provider {
  color: var(--canvas-text-primary, var(--text-primary, #e4e4e7));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-reason {
  color: var(--canvas-text-subtle, var(--text-subtle, #a1a1aa));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-media {
  position: relative;
  min-height: 0;
  overflow: hidden;
  border-radius: 4px;
  background: var(--canvas-media-well, #09090b);
}

.node-media-element {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.node-media.is-loading .node-media-element { opacity: 0.4; }
.node-media.is-error .node-media-element { visibility: hidden; }

.media-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 8px;
  color: var(--canvas-text-secondary, #d4d4d8);
  font-size: 12px;
  text-align: center;
}

.media-state.error { color: var(--canvas-danger-text, #f87171); }

.node-editor {
  min-height: 0;
}

.node-editor :deep(textarea) {
  height: 72px;
  min-height: 72px !important;
  color: var(--canvas-text-primary, var(--text-primary, #e4e4e7));
  resize: none;
}

.node-footer {
  justify-content: flex-end;
}

.free-canvas-node :deep(.el-button:focus-visible),
.node-editor :deep(.el-textarea__inner:focus) {
  outline: 2px solid var(--canvas-focus-ring, #818cf8);
  outline-offset: 2px;
}
</style>
