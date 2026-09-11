<template>
  <div class="pipeline-actions">
    <div class="pipeline-mode-action">
      <span class="pipeline-mode-label is-production">完整成片</span>
      <ActionGate label="一键生成成片" :reason="productionReason">
        <el-button
          type="primary"
          :loading="starting || (running && !paused && !stopping)"
          :disabled="Boolean(productionReason) || starting"
          :title="productionButtonTitle || undefined"
          :aria-label="productionButtonAriaLabel"
          @click="$emit('start-one-click')"
        >
          一键生成成片
        </el-button>
      </ActionGate>
    </div>
    <div class="pipeline-mode-action">
      <span class="pipeline-mode-label is-draft">草稿预演</span>
      <ActionGate label="仅生成文本框架" :reason="draftReason">
        <el-button
          :loading="starting || (running && !paused && !stopping)"
          :disabled="Boolean(draftReason) || starting"
          :title="draftButtonTitle || undefined"
          :aria-label="draftButtonAriaLabel"
          @click="$emit('start-text-framework')"
        >
          仅生成文本框架
        </el-button>
      </ActionGate>
    </div>
    <el-button
      v-if="showReadinessAction"
      link
      type="primary"
      class="pipeline-config-action"
      aria-label="前往 AI 配置"
      @click="$emit('open-ai-config', productionReadinessServiceType)"
    >前往 AI 配置</el-button>
    <el-button
      v-if="showReadinessRetry"
      plain
      type="primary"
      class="pipeline-config-action"
      aria-label="重试检查"
      @click="$emit('retry-readiness')"
    >重试检查</el-button>
    <template v-if="running">
      <ActionGate v-if="!stopRequired && !paused" label="暂停" :reason="pauseDisabledReason">
        <el-button type="warning" :disabled="Boolean(pauseDisabledReason)" :title="pauseDisabledReason || undefined" :aria-label="pauseDisabledReason || '暂停'" @click="$emit('pause')">暂停</el-button>
      </ActionGate>
      <ActionGate v-else-if="!stopRequired" label="继续" :reason="resumeDisabledReason">
        <el-button type="success" :disabled="Boolean(resumeDisabledReason)" :title="resumeDisabledReason || undefined" :aria-label="resumeDisabledReason || '继续'" @click="$emit('resume')">继续</el-button>
      </ActionGate>
      <ActionGate :label="stopRequired ? '重试停止' : '停止'" :reason="cancelDisabledReason">
        <el-button
          type="danger"
          plain
          :loading="stopping"
          :disabled="Boolean(cancelDisabledReason)"
          :title="cancelDisabledReason || (stopping ? '正在停止全流程，请稍候' : undefined)"
          :aria-label="cancelDisabledReason || (stopping ? '正在停止全流程，请稍候' : (stopRequired ? '重试停止' : '停止'))"
          @click="$emit('cancel')"
        >
          {{ stopRequired ? '重试停止' : '停止' }}
        </el-button>
      </ActionGate>
    </template>
  </div>
</template>

<script setup>
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineProps({
  starting: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  paused: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false },
  stopRequired: { type: Boolean, default: false },
  productionReason: { type: String, default: '' },
  draftReason: { type: String, default: '' },
  productionButtonTitle: { type: String, default: undefined },
  draftButtonTitle: { type: String, default: undefined },
  productionButtonAriaLabel: { type: String, default: '' },
  draftButtonAriaLabel: { type: String, default: '' },
  pauseDisabledReason: { type: String, default: '' },
  resumeDisabledReason: { type: String, default: '' },
  cancelDisabledReason: { type: String, default: '' },
  showReadinessAction: { type: Boolean, default: false },
  showReadinessRetry: { type: Boolean, default: false },
  productionReadinessServiceType: { type: String, default: '' },
})

defineEmits([
  'start-one-click',
  'start-text-framework',
  'open-ai-config',
  'retry-readiness',
  'pause',
  'resume',
  'cancel',
])
</script>

<style scoped>
.pipeline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
}

.pipeline-config-action {
  align-self: center;
}

.pipeline-mode-action {
  display: inline-grid;
  gap: 4px;
  justify-items: stretch;
}

.pipeline-mode-label {
  color: var(--el-text-color-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  text-align: center;
}

.pipeline-mode-label.is-production {
  color: var(--el-color-danger);
}

.pipeline-mode-label.is-draft {
  color: var(--el-color-info);
}
</style>
