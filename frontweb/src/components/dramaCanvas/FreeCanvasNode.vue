<template>
  <article class="free-canvas-node" :class="[`type-${node.type}`, { readonly, loading: isLoading, failed: hasError }]">
    <Handle v-if="isFreeMode" type="target" :position="Position.Left" />
    <header class="node-header">
      <span class="node-kind">{{ typeLabel }}</span>
      <span v-if="isLoading" class="node-state" role="status">加载中</span>
      <span v-else-if="hasError" class="node-state error" role="alert" aria-live="assertive">加载失败</span>
    </header>

    <h3 class="node-title">{{ displayTitle }}</h3>
    <el-input
      v-if="isEditable"
      class="node-editor nodrag nopan"
      type="textarea"
      resize="none"
      :rows="4"
      :model-value="displayContent"
      :aria-label="`${typeLabel}内容`"
      @update:model-value="updateContent"
    />
    <p v-else class="node-content">{{ displayContent || emptyLabel }}</p>

    <footer class="node-footer nodrag nopan">
      <el-tooltip v-if="hasError && !readonly" content="重试" placement="bottom">
        <el-button size="small" circle aria-label="重试" title="重试" @click="emit('request-retry', node.id)">
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
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Delete, RefreshRight, Switch } from '@element-plus/icons-vue'

const props = defineProps({
  node: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  freeMode: { type: Boolean, default: false },
})

const emit = defineEmits(['update-content', 'request-convert', 'request-delete', 'request-retry'])

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
const isEditable = computed(() => !props.readonly && ['text', 'config'].includes(props.node.type))
const isLoading = computed(() => props.node.status === 'loading' || props.node.loading === true)
const hasError = computed(() => Boolean(props.node.error) || props.node.status === 'error')
const emptyLabel = computed(() => isLoading.value ? '内容加载中' : (hasError.value ? '内容加载失败' : '暂无内容'))

function updateContent(content) {
  emit('update-content', { id: props.node.id, content })
}
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
