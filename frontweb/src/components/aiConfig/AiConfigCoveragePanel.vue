<template>
  <div
    id="ai-config-coverage-panel"
    v-show="configWorkspaceView === 'coverage'"
    class="config-workspace-panel"
    role="tabpanel"
    aria-labelledby="ai-config-mode-coverage"
    tabindex="-1"
  >
    <section class="coverage-panel" aria-labelledby="ai-service-coverage-title">
      <AiConfigCoverageHeader
        :service-coverage="serviceCoverage"
        :coverage-summary-cards="coverageSummaryCards"
        :config-list-pending-empty="configListPendingEmpty"
        :config-list-failed-empty="configListFailedEmpty"
        :loading="loading"
        :retry-config-dependencies="retryConfigDependencies"
      />
      <AiConfigCoverageCards
        v-if="!configListPendingEmpty && !configListFailedEmpty"
        :ordered-coverage-services="orderedCoverageServices"
        :ordered-extraction-coverage-services="orderedExtractionCoverageServices"
        :active-service-filter="activeServiceFilter"
        :coverage-actions="coverageActions"
        :is-coverage-action-testing="isCoverageActionTesting"
        :is-coverage-action-disabled="isCoverageActionDisabled"
        :set-coverage-card-ref="setCoverageCardRef"
        @select="$emit('select', $event)"
        @action="(item, action) => $emit('action', item, action)"
      />
    </section>
  </div>
</template>

<script setup>
/**
 * AI 配置「服务状态」工作区面板。
 * 列表加载与连接测试仍留在页面；这里只负责 tabpanel 布局和卡片接线。
 */
import AiConfigCoverageHeader from '@/components/aiConfig/AiConfigCoverageHeader.vue'
import AiConfigCoverageCards from '@/components/aiConfig/AiConfigCoverageCards.vue'

defineProps({
  configWorkspaceView: { type: String, required: true },
  serviceCoverage: { type: Object, required: true },
  coverageSummaryCards: { type: Array, default: () => [] },
  configListPendingEmpty: { type: Boolean, default: false },
  configListFailedEmpty: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  retryConfigDependencies: { type: Function, required: true },
  orderedCoverageServices: { type: Array, default: () => [] },
  orderedExtractionCoverageServices: { type: Array, default: () => [] },
  activeServiceFilter: { type: String, default: '' },
  coverageActions: { type: Function, required: true },
  isCoverageActionTesting: { type: Function, required: true },
  isCoverageActionDisabled: { type: Function, required: true },
  setCoverageCardRef: { type: Function, required: true },
})

defineEmits(['select', 'action'])
</script>

<style scoped>
.config-workspace-panel {
  min-width: 0;
}
.coverage-panel {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
}
.config-workspace-panel:focus-visible {
  outline: 2px solid var(--accent-text, var(--el-color-primary, #409eff));
  outline-offset: 2px;
}
@media (max-width: 760px) {
  .config-workspace-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
}
@media (max-width: 520px) {
  .coverage-panel {
    padding: 12px;
  }
}
</style>
