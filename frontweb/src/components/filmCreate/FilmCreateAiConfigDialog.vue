<template>
  <AccessibleDialog
    v-model="visible"
    title="AI 配置"
    width="90%"
    top="5vh"
    :show-close="true"
    destroy-on-close
    class="ai-config-workspace-dialog ai-config-overlay"
    :before-close="beforeClose"
  >
    <template #header="{ titleId, titleClass }">
      <div class="ai-config-dialog-header">
        <el-button class="ai-config-dialog-back" text @click="emit('back')">
          <el-icon><ArrowLeft /></el-icon>
          <span>返回制作</span>
        </el-button>
        <strong :id="titleId" :class="[titleClass, 'ai-config-dialog-title']">AI 配置</strong>
      </div>
    </template>
    <AIConfigContent
      ref="contentRef"
      v-if="visible"
      :initial-service-type="initialServiceType"
      @configuration-changed="emit('configuration-changed')"
    />
  </AccessibleDialog>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import AIConfigContent from '@/components/AIConfigContent.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  initialServiceType: { type: String, default: '' },
  beforeClose: { type: Function, default: undefined },
})

const visible = defineModel({ type: Boolean, default: false })
const emit = defineEmits(['back', 'configuration-changed'])
const contentRef = ref(null)

defineExpose({
  requestClose: (...args) => contentRef.value?.requestClose?.(...args),
  hasUnsavedChanges: (...args) => contentRef.value?.hasUnsavedChanges?.(...args),
})
</script>

<style scoped>
.ai-config-dialog-header {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 32px;
}
.ai-config-dialog-back {
  min-height: 32px;
  padding: 4px 8px;
}
.ai-config-dialog-title {
  color: var(--text-primary);
  font-size: 16px;
  line-height: 24px;
}
</style>
