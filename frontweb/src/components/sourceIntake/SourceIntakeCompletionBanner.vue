<template>
  <div class="workflow-complete-heading">
    <strong>{{ completionTitle }}</strong>
    <span>{{ qaPresentation.scoreLabel }}</span>
  </div>
  <div v-if="completionSummaryReady" class="workflow-complete-metrics" aria-label="完成摘要">
    <span><small>QA</small><strong>{{ qaPresentation.statusLabel }}</strong></span>
    <span><small>分集</small><strong>{{ completionEpisodeCount }} 集</strong></span>
    <span><small>轨道</small><strong>{{ timelineSummary.trackCount }} 轨</strong></span>
    <span><small>时长</small><strong>{{ formatDuration(timelineSummary.durationSec) }}</strong></span>
    <span><small>占位</small><strong>{{ completionPlaceholderCount }} 项</strong></span>
  </div>
  <p v-else class="workflow-complete-pending" role="status" aria-live="polite">
    交付摘要整理中，轨道、时长和占位统计将在时间线加载后显示。
  </p>
  <div class="workflow-complete-actions">
    <el-button type="primary" aria-label="进入制作" @click="$emit('enter-production')">进入制作</el-button>
    <el-button plain aria-label="查看分集" @click="$emit('focus-episode-list')">查看分集</el-button>
    <el-button
      class="workflow-history-toggle"
      text
      :aria-controls="'source-workflow-history'"
      :aria-expanded="workflowHistoryExpanded"
      :aria-label="workflowHistoryExpanded ? '收起流程记录' : '展开流程记录'" @click="workflowHistoryExpanded = !workflowHistoryExpanded"
    >
      <el-icon><ArrowUp v-if="workflowHistoryExpanded" /><ArrowDown v-else /></el-icon>
      流程记录
    </el-button>
  </div>
</template>

<script setup>
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'

defineProps({
  completionTitle: { type: String, required: true },
  qaPresentation: { type: Object, required: true },
  completionSummaryReady: { type: Boolean, default: false },
  completionEpisodeCount: { type: Number, default: 0 },
  timelineSummary: { type: Object, required: true },
  formatDuration: { type: Function, required: true },
  completionPlaceholderCount: { type: Number, default: 0 },
})

defineEmits(['enter-production', 'focus-episode-list'])

const workflowHistoryExpanded = defineModel('workflowHistoryExpanded', { type: Boolean, default: false })
</script>

<style scoped>
.workflow-complete-heading,
.workflow-complete-metrics,
.workflow-complete-actions {
  min-width: 0;
}

.workflow-complete-heading {
  display: grid;
  gap: 4px;
}

.workflow-complete-heading strong {
  font-size: 15px;
  color: var(--source-text-primary);
}

.workflow-complete-heading span,
.workflow-complete-metrics small {
  color: var(--source-text-muted);
  font-size: 12px;
}

.workflow-complete-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.workflow-complete-metrics span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.workflow-complete-metrics strong {
  overflow: hidden;
  color: var(--source-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-complete-pending {
  margin: 0;
  color: var(--source-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.workflow-complete-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.workflow-history-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>