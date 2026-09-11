<template>
  <div class="workflow-mode-band">
    <div class="workflow-mode-head">
      <strong>启动模式</strong>
      <el-tag size="small" :type="workflowMode === 'production' ? 'danger' : 'info'">
        {{ workflowModeShortLabel }}
      </el-tag>
    </div>
    <el-radio-group
      v-model="workflowMode"
      class="workflow-mode-control"
      aria-label="工作流启动模式"
      :disabled="isWorkflowLaunchBusy"
      @change="$emit('change')"
    >
      <el-radio-button value="draft">草稿预演</el-radio-button>
      <el-radio-button value="production">正式制作</el-radio-button>
    </el-radio-group>
    <p v-if="isWorkflowLaunchBusy" class="action-reason">{{ sourceUploadBusyReason }}</p>
    <p>{{ workflowModeDescription }}</p>

    <div
      v-if="workflowMode === 'production' && (readinessChecking || productionReadiness)"
      class="production-readiness"
      :class="{ 'is-ready': productionReadiness?.ready, 'has-gaps': productionReadiness && !productionReadiness.ready }"
      :role="productionReadiness && !productionReadiness.ready ? 'alert' : 'status'"
      aria-live="polite"
    >
      <template v-if="readinessChecking">
        <strong>正在检查正式制作能力</strong>
        <span>正在核对文本、图像、视频、语音和本地合成能力…</span>
      </template>
      <template v-else-if="productionReadiness?.ready">
        <strong>正式制作能力已就绪</strong>
        <span>本次启动需要的服务与本地媒体工具均可用。</span>
      </template>
      <template v-else>
        <div class="readiness-gap-head">
          <strong>正式制作暂不能启动</strong>
          <el-button size="small" type="primary" plain aria-label="前往 AI 配置" @click="$emit('open-ai-config')">
            <el-icon><Setting /></el-icon>
            前往 AI 配置
          </el-button>
        </div>
        <ul class="readiness-gap-list">
          <li v-for="gap in productionReadiness?.missing_capabilities || []" :key="gap.key">
            <strong>{{ gap.label }}</strong>
            <span>{{ gap.detail }}</span>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { Setting } from '@element-plus/icons-vue'

defineProps({
  workflowModeShortLabel: { type: String, required: true },
  workflowModeDescription: { type: String, required: true },
  isWorkflowLaunchBusy: { type: Boolean, default: false },
  sourceUploadBusyReason: { type: String, default: '' },
  readinessChecking: { type: Boolean, default: false },
  productionReadiness: { type: Object, default: null },
})

defineEmits(['change', 'open-ai-config'])

const workflowMode = defineModel('workflowMode', { type: String, required: true })
</script>

<style scoped>
.workflow-mode-band {
  display: grid;
  gap: 9px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.7);
}
.workflow-mode-head,
.readiness-gap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.workflow-mode-head strong,
.production-readiness strong {
  color: #e4e4e7;
  font-size: 13px;
  font-weight: 600;
}
.workflow-mode-control {
  display: flex;
  width: 100%;
  max-width: 100%;
}
.workflow-mode-control :deep(.el-radio-button) {
  min-width: 0;
  flex: 1;
}
.workflow-mode-control :deep(.el-radio-button__inner) {
  width: 100%;
  min-height: 32px;
  padding-inline: 10px;
  white-space: normal;
}
.workflow-mode-band > p {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.action-reason {
  margin-top: 7px;
  color: var(--status-warning);
  font-size: 11px;
  line-height: 1.45;
}
.production-readiness {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.1);
  color: #fcd34d;
  font-size: 12px;
  line-height: 1.45;
}
.production-readiness.is-ready {
  border-left-color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
  color: #86efac;
}
.production-readiness.has-gaps strong {
  color: #fde68a;
}
.readiness-gap-list {
  display: grid;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.readiness-gap-list li {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  gap: 8px;
  align-items: baseline;
}
.readiness-gap-list li strong {
  font-size: 12px;
}
html.light .workflow-mode-band {
  border-bottom-color: #e5e7eb;
}
html.light .workflow-mode-head strong,
html.light .production-readiness strong {
  color: #18181b;
}
html.light .production-readiness {
  color: #854d0e;
  background: #fffbeb;
}
html.light .production-readiness.has-gaps strong {
  color: #713f12;
}
html.light .production-readiness.is-ready {
  color: #166534;
  background: #f0fdf4;
}
@media (max-width: 900px) {
  .readiness-gap-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .readiness-gap-list li {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
