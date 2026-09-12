<template>
  <div class="coverage-header-block">
    <div class="coverage-header">
      <div>
        <div class="coverage-title-row">
          <h2 id="ai-service-coverage-title">AI 服务配置与验证</h2>
          <el-tag
            v-if="!configListPendingEmpty && !configListFailedEmpty"
            :type="serviceCoverage.ready ? 'success' : 'warning'"
            size="small"
            effect="light"
          >
            {{ serviceCoverage.readyCount }}/{{ serviceCoverage.totalCount }} 类可用
          </el-tag>
        </div>
        <p>每类服务可用需启用默认配置；默认配置还需凭据、模型或工作流完整。上方统计只看五类正式制作服务。</p>
      </div>
      <span class="coverage-test-note">连接测试结果来自后端记录或此设备保存的最近结果</span>
    </div>
    <div
      v-if="configListPendingEmpty"
      class="coverage-unresolved-state"
      role="status"
      aria-live="polite"
    >
      正在读取 AI 配置...
    </div>
    <div
      v-else-if="configListFailedEmpty"
      class="coverage-unresolved-state coverage-unresolved-state--error"
      role="alert"
    >
      <div class="coverage-unresolved-copy">
        <strong>暂时无法确认服务状态</strong>
        <span>配置列表还没有成功加载，当前不能判断五类服务是否已配置。下一步：点击重新读取配置列表。</span>
      </div>
      <el-button size="small" type="primary" plain aria-label="重新读取配置列表" :loading="loading" @click="retryConfigDependencies">
        重新读取配置列表
      </el-button>
    </div>
    <div
      v-else
      class="coverage-summary-strip"
    >
      <div
        v-for="card in coverageSummaryCards"
        :key="card.key"
        class="coverage-summary-card"
        :class="`summary-${card.tone}`"
      >
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * AI 配置覆盖率面板表头：标题、未解析状态和汇总条。
 * 服务卡片仍由 AiConfigCoverageCards 渲染；列表加载与连接测试仍留在页面。
 */
defineProps({
  serviceCoverage: { type: Object, required: true },
  coverageSummaryCards: { type: Array, default: () => [] },
  configListPendingEmpty: { type: Boolean, default: false },
  configListFailedEmpty: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  retryConfigDependencies: { type: Function, required: true },
})
</script>

<style scoped>
.coverage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
  min-width: 0;
}
.coverage-header > :first-child {
  min-width: 0;
  flex: 1 1 auto;
}
.coverage-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coverage-title-row h2 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0;
}
.coverage-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-test-note {
  min-width: 0;
  max-width: 260px;
  flex: 0 1 260px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
  overflow-wrap: anywhere;
}
.coverage-unresolved-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 88px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-unresolved-state--error {
  border-color: var(--ai-config-danger-border, #fbc4c4);
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
}
.coverage-unresolved-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.coverage-unresolved-copy strong {
  font-size: 13px;
  line-height: 18px;
}
.coverage-unresolved-copy span {
  overflow-wrap: anywhere;
}
.coverage-unresolved-state :deep(.el-button) {
  min-width: 32px;
  min-height: 32px;
  flex: 0 0 auto;
}
.coverage-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.coverage-summary-card {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-blank, #fff);
}
.coverage-summary-card span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 18px;
}
.coverage-summary-card strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}
.coverage-summary-card.summary-success {
  border-color: var(--ai-config-success-border, rgba(16, 185, 129, 0.24));
  background: var(--ai-config-success-surface, #ecfdf5);
}
.coverage-summary-card.summary-warning {
  border-color: var(--ai-config-warning-border, rgba(245, 158, 11, 0.24));
  background: var(--ai-config-warning-surface, #fffbeb);
}
.coverage-summary-card.summary-danger {
  border-color: var(--ai-config-danger-border, rgba(239, 68, 68, 0.24));
  background: var(--ai-config-danger-surface, #fef2f2);
}
.coverage-summary-card.summary-info {
  border-color: var(--ai-config-info-border, rgba(59, 130, 246, 0.24));
  background: var(--ai-config-info-surface, #eff6ff);
}
.coverage-summary-card.summary-success strong { color: var(--ai-config-success-text, #047857); }
.coverage-summary-card.summary-warning strong { color: var(--ai-config-warning-text, #a16207); }
.coverage-summary-card.summary-danger strong { color: var(--ai-config-danger-text, #b91c1c); }
.coverage-summary-card.summary-info strong { color: var(--ai-config-info-text, #0369a1); }
@media (max-width: 1440px) {
  .coverage-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1024px) {
  .coverage-header {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }
  .coverage-test-note {
    max-width: none;
    flex: 1 1 auto;
    text-align: left;
  }
  .coverage-unresolved-state {
    align-items: stretch;
    flex-direction: column;
  }
}
@media (max-width: 760px) {
  .coverage-summary-strip {
    grid-template-columns: minmax(0, 1fr);
  }
  .coverage-header {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }
  .coverage-test-note {
    max-width: none;
    text-align: left;
  }
}
</style>
