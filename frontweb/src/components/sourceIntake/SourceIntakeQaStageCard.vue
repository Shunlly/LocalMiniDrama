<template>
  <div class="status-block">
    <div class="stage-heading stage-heading--compact">
      <div>
        <strong>{{ qaPresentation.scopeLabel }}</strong>
        <span>检查项目结构、产物完整性和流程状态。</span>
      </div>
      <el-tag v-if="latestQa.id" size="small" :type="latestQa.passed ? 'success' : 'warning'">
        {{ qaPresentation.scoreLabel }}
      </el-tag>
    </div>

    <div class="stage-action-row">
      <ActionGate label="执行质量检查" :reason="qaReason">
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="Boolean(qaReason)"
          :loading="qaRunning"
          :aria-label="qaRunning ? '正在执行质量检查' : (qaReason || '执行质量检查')" @click="$emit('run-qa')"
        >
          执行质量检查
        </el-button>
      </ActionGate>
      <span v-if="qaReason" class="action-reason action-reason--inline">{{ qaReason }}</span>
    </div>

    <template v-if="latestQa.id">
      <div v-if="qaPresentation.notice" class="placeholder-note">
        {{ qaPresentation.notice }}
      </div>
      <div class="qa-line" :class="{ passed: latestQa.passed }">
        {{ qaPresentation.statusLabel }} / {{ latestQa.issueCount }} 个问题
      </div>
      <div v-if="displayedQaIssues.length" class="qa-issues">
        <div v-for="issue in displayedQaIssues" :key="issue.code + issue.message" class="qa-issue">
          {{ issue.message }}
        </div>
      </div>
      <div v-else-if="latestQa.issueCount" class="stage-empty">检查结果已记录，暂无可以展示的说明。</div>

      <details class="qa-detail">
        <summary>完整质量检查明细</summary>
        <div class="qa-detail-title">检查项</div>
        <div v-for="check in latestQa.checks" :key="check.key" class="qa-issue">
          {{ qaCheckLabel(check.key) }}：{{ check.passed ? '通过' : '未通过' }}
        </div>
        <div class="qa-detail-title">建议</div>
        <div v-if="displayedQaRecommendations.length">
          <div v-for="item in displayedQaRecommendations" :key="item" class="qa-issue">
            {{ item }}
          </div>
        </div>
        <div v-else class="stage-empty">暂无可以展示的修复建议。</div>
      </details>
      <div v-if="!latestQa.passed" class="source-extraction-next-step">
        <span class="next-step-kicker">下一步</span>
        <el-button size="small" type="primary" plain aria-label="去查看修复建议" @click="$emit('select-step', 'remediation')">
          去查看修复建议
        </el-button>
      </div>
    </template>
    <div v-else class="stage-empty stage-empty--actionable">
      <span>还没有质量检查结果。完成处理后点击「执行质量检查」，问题和建议会显示在这里。</span>
      <el-button type="primary" plain aria-label="去启动处理" @click="$emit('select-step', 'process')">去启动处理</el-button>
    </div>
  </div>
</template>

<script setup>
import ActionGate from '@/components/filmCreate/ActionGate.vue'
import { qaCheckLabel } from '@/utils/qaReport'

defineProps({
  qaPresentation: { type: Object, required: true },
  latestQa: { type: Object, required: true },
  qaReason: { type: String, default: '' },
  qaRunning: { type: Boolean, default: false },
  displayedQaIssues: { type: Array, default: () => [] },
  displayedQaRecommendations: { type: Array, default: () => [] },
})

defineEmits(['run-qa', 'select-step'])
</script>

<style scoped>
.status-block {
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 8px;
  padding: 14px;
  background: rgba(18, 18, 22, 0.58);
}
.stage-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-heading--compact {
  margin-bottom: 12px;
}
.stage-heading > div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.stage-heading strong {
  color: #f4f4f5;
  font-size: 14px;
  font-weight: 600;
}
.stage-heading div span {
  color: var(--source-text-muted, #a1a1aa);
  font-size: 11px;
  line-height: 1.4;
}
.stage-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  margin-bottom: 10px;
}
.action-reason {
  margin-top: 7px;
  color: var(--status-warning, #fbbf24);
  font-size: 11px;
  line-height: 1.45;
}
.action-reason--inline {
  margin-top: 0;
}
.placeholder-note {
  margin: 8px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: #fde68a;
  background: rgba(245, 158, 11, 0.12);
  font-size: 12px;
  line-height: 1.45;
}
.qa-line {
  font-size: 13px;
  color: #facc15;
  margin-bottom: 8px;
}
.qa-line.passed {
  color: var(--status-success, #4ade80);
}
.qa-issues {
  display: grid;
  gap: 6px;
}
.qa-issue,
.stage-empty {
  font-size: 12px;
  color: var(--source-text-muted, #a1a1aa);
  line-height: 1.45;
}
.stage-empty {
  padding: 10px 0;
  line-height: 1.5;
}
.stage-empty--actionable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}
.qa-detail {
  margin-top: 10px;
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.qa-detail summary {
  cursor: pointer;
  color: #93c5fd;
  margin-bottom: 8px;
}
.qa-detail-title {
  margin-top: 8px;
  color: #e4e4e7;
  font-weight: 600;
}
.source-extraction-next-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  color: var(--source-text-secondary, #d4d4d8);
  font-size: 12px;
}
.next-step-kicker {
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--accent-text, #a78bfa);
  background: rgba(139, 92, 246, 0.2);
  font-size: 11px;
}
.source-extraction-next-step :deep(.el-button:focus-visible) {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}
html.light .status-block {
  background: #f8fafc;
  border-color: #e5e7eb;
}
html.light .stage-heading strong,
html.light .qa-detail-title {
  color: #18181b;
}
</style>
