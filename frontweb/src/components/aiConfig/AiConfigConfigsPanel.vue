<template>
  <div
    id="ai-config-configs-panel"
    v-show="configWorkspaceView === 'configs'"
    class="config-workspace-panel config-management-panel"
    role="tabpanel"
    aria-labelledby="ai-config-mode-configs"
    tabindex="-1"
  >
    <AiConfigListToolbar
      :vendor-lock="vendorLock"
      :config-write-locked="configWriteLocked"
      :config-write-lock-reason="configWriteLockReason"
      :selected-rows="selectedRows"
      :batch-deleting="batchDeleting"
      :active-service-filter="activeServiceFilter"
      :filtered-count="filteredCount"
      v-model:import-file-ref="importFileRef"
      :open-add="openAdd"
      :export-configs="exportConfigs"
      :trigger-import="triggerImport"
      :import-configs="importConfigs"
      :open-one-key-volc="openOneKeyVolc"
      :open-one-key-agnes="openOneKeyAgnes"
      :open-one-key-tongyi="openOneKeyTongyi"
      :on-batch-delete="onBatchDelete"
      :open-bulk-key="openBulkKey"
      :clear-service-filter="clearServiceFilter"
    />
    <p class="default-tip">生成任务会优先使用同类服务中已启用的默认配置。即梦2角色认证、认证资产库、图片识别和语音转写属于扩展能力，不计入上方五类基础生成服务。</p>
    <div :ref="bindConfigListSectionRef" class="config-list-section">
      <AiConfigListTable
        :loading="loading"
        :vendor-lock-loading="vendorLockLoading"
        :rows="rows"
        :vendor-lock="vendorLock"
        :config-write-locked="configWriteLocked"
        :config-write-lock-reason="configWriteLockReason"
        :config-empty-title="configEmptyTitle"
        :config-empty-description="configEmptyDescription"
        :config-list-failed-empty="configListFailedEmpty"
        :config-list-pending-empty="configListPendingEmpty"
        :active-service-filter="activeServiceFilter"
        :is-config-row-selectable="isConfigRowSelectable"
        :on-selection-change="onSelectionChange"
        :open-test="openTest"
        :on-row-edit="onRowEdit"
        :on-delete="onDelete"
        :retry-config-dependencies="retryConfigDependencies"
        :open-add-for-service="openAddForService"
        :clear-service-filter="clearServiceFilter"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * AI 配置「配置管理」工作区面板。
 * 页面仍负责 loadList/openTest；这里只负责工具栏、说明和列表的 tabpanel 布局。
 */
import AiConfigListToolbar from '@/components/aiConfig/AiConfigListToolbar.vue'
import AiConfigListTable from '@/components/aiConfig/AiConfigListTable.vue'

defineProps({
  configWorkspaceView: { type: String, required: true },
  vendorLock: { type: Object, required: true },
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  selectedRows: { type: Array, default: () => [] },
  batchDeleting: { type: Boolean, default: false },
  activeServiceFilter: { type: String, default: '' },
  filteredCount: { type: Number, default: 0 },
  openAdd: { type: Function, required: true },
  exportConfigs: { type: Function, required: true },
  triggerImport: { type: Function, required: true },
  importConfigs: { type: Function, required: true },
  openOneKeyVolc: { type: Function, required: true },
  openOneKeyAgnes: { type: Function, required: true },
  openOneKeyTongyi: { type: Function, required: true },
  onBatchDelete: { type: Function, required: true },
  openBulkKey: { type: Function, required: true },
  clearServiceFilter: { type: Function, required: true },
  loading: { type: Boolean, default: false },
  vendorLockLoading: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  configEmptyTitle: { type: String, default: '' },
  configEmptyDescription: { type: String, default: '' },
  configListFailedEmpty: { type: Boolean, default: false },
  configListPendingEmpty: { type: Boolean, default: false },
  isConfigRowSelectable: { type: Function, required: true },
  onSelectionChange: { type: Function, required: true },
  openTest: { type: Function, required: true },
  onRowEdit: { type: Function, required: true },
  onDelete: { type: Function, required: true },
  retryConfigDependencies: { type: Function, required: true },
  openAddForService: { type: Function, required: true },
})

const importFileRef = defineModel('importFileRef')
const configListSectionRef = defineModel('configListSectionRef')

function bindConfigListSectionRef(el) {
  configListSectionRef.value = el
}
</script>

<style scoped>
.config-workspace-panel {
  min-width: 0;
}
.config-list-section {
  min-width: 0;
  max-width: 100%;
  scroll-margin-top: 88px;
}
.default-tip {
  min-width: 0;
  overflow-wrap: anywhere;
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-info-border, #bae6fd);
  background: var(--ai-config-info-surface, #f0f9ff);
  border-radius: 6px;
  font-size: 13px;
  color: var(--ai-config-info-text, #0369a1);
  line-height: 1.5;
}
.config-workspace-panel:focus-visible {
  outline: 2px solid var(--accent-text, var(--el-color-primary, #409eff));
  outline-offset: 2px;
}
@media (max-width: 1024px) {
  .config-workspace-panel,
  .config-list-section,
  .default-tip {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
}
@media (max-width: 760px) {
  .config-workspace-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
}
</style>
