<template>
  <div class="canvas-warning-bar" role="alert">
    <span>上一次配音请求结果待确认，后台合成和供应商计费可能仍在继续。刷新项目状态后才能再次执行整组工作流。</span>
    <div class="canvas-warning-actions">
      <el-button link size="small" :loading="loading" :aria-label="loading ? '正在刷新项目状态' : '刷新项目状态'" @click="refreshUnknownWorkflowOutcome">刷新项目状态</el-button>
    </div>
  </div>
</template>

<script setup>
/** 工作流配音结果未知时的中文告警条，刷新后才能继续整组执行 */
defineProps({
  loading: { type: Boolean, default: false },
  refreshUnknownWorkflowOutcome: { type: Function, required: true },
})
</script>

<style scoped>
.canvas-warning-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px 12px;
  border-top: 1px solid rgba(251, 191, 36, 0.18);
  color: var(--canvas-amber-text, #fcd34d);
  font-size: 12px;
  background: rgba(251, 191, 36, 0.06);
}

.canvas-warning-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
