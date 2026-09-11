<template>
  <div class="ai-config-list-toolbar">
    <!-- 普通模式操作栏 -->
    <div v-if="!vendorLock.enabled" class="content-actions">
      <div class="actions-left">
        <el-button type="primary" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="openAdd">
          <el-icon><Plus /></el-icon>
          添加配置
        </el-button>
        <el-button plain @click="exportConfigs">
          <el-icon><Download /></el-icon>
          导出配置
        </el-button>
        <el-button plain :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="triggerImport">
          <el-icon><Upload /></el-icon>
          导入配置
        </el-button>
        <input :ref="bindImportFileRef" type="file" accept=".json" style="display:none" aria-hidden="true" tabindex="-1" :disabled="configWriteLocked" @change="importConfigs" />
        <el-button type="success" plain :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="openOneKeyVolc">
          <el-icon><MagicStick /></el-icon>
          一键配置火山
        </el-button>
        <el-button type="success" plain :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="openOneKeyAgnes">
          <el-icon><MagicStick /></el-icon>
          一键配置 Agnes
        </el-button>
        <el-button type="info" plain :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="openOneKeyTongyi">
          <el-icon><MagicStick /></el-icon>
          一键配置通义
          <span class="one-key-not-recommended">不推荐</span>
        </el-button>
      </div>
      <div class="actions-right">
        <transition name="fade-slide">
          <el-button
            v-if="selectedRows.length > 0"
            type="danger"
            :loading="batchDeleting"
            :disabled="configWriteLocked"
            :title="configWriteLocked ? configWriteLockReason : undefined"
            @click="onBatchDelete"
          >
            <el-icon><Delete /></el-icon>
            删除选中 ({{ selectedRows.length }})
          </el-button>
        </transition>
      </div>
    </div>
    <!-- 锁定模式提示栏 -->
    <div v-else class="vendor-lock-bar">
      <el-alert
        type="info"
        :closable="false"
        class="vendor-lock-tip"
      >
        <template #title>
          <span>🔒 当前为厂商锁定模式，AI 服务由管理员统一配置。你只能修改 <b>API 密钥</b> 和 <b>默认模型</b>。</span>
        </template>
      </el-alert>
      <el-button plain size="small" @click="exportConfigs">
        <el-icon><Download /></el-icon>
        导出配置
      </el-button>
      <el-button type="primary" size="small" class="vendor-bulk-key-btn" :disabled="configWriteLocked" :title="configWriteLocked ? configWriteLockReason : undefined" @click="openBulkKey">
        <el-icon><Key /></el-icon>
        一键换密钥
      </el-button>
    </div>
    <div v-if="activeServiceFilter" class="config-filter-bar">
      <span>
        当前只看：<strong>{{ serviceTypeLabel(activeServiceFilter) }}</strong>
        <span class="filter-count">{{ filteredCount }} 条</span>
      </span>
      <el-button link type="primary" @click="clearServiceFilter">查看全部配置</el-button>
    </div>
  </div>
</template>

<script setup>
import { Plus, MagicStick, Download, Upload, Delete, Key } from '@element-plus/icons-vue'
import { serviceTypeLabel } from '@/utils/aiConfigLabels.js'

defineProps({
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
})

const importFileRef = defineModel('importFileRef')

function bindImportFileRef(el) {
  importFileRef.value = el
}
</script>

<style scoped>
.content-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}
.actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
.one-key-not-recommended {
  margin-left: 4px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
  border-radius: 4px;
  color: var(--el-color-warning, #e6a23c);
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-7, #f5dab1);
  vertical-align: middle;
}
.config-filter-bar {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 6px 10px;
  border: 1px solid var(--el-color-primary-light-7, #c6e2ff);
  border-radius: 6px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}
.filter-count {
  margin-left: 6px;
  color: var(--el-text-color-secondary, #909399);
}
.vendor-lock-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.vendor-lock-bar .vendor-lock-tip {
  flex: 1;
  margin-bottom: 0;
}
.vendor-bulk-key-btn {
  white-space: nowrap;
  flex-shrink: 0;
  color: #fff !important;
}
.vendor-lock-tip {
  margin-bottom: 16px;
}
@media (max-width: 760px) {
  .content-actions,
  .vendor-lock-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .actions-right {
    flex-wrap: wrap;
    flex-shrink: 1;
    max-width: 100%;
  }
  .config-filter-bar {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 520px) {
  .actions-right {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }
  .actions-right :deep(.el-button) {
    margin-left: 0;
    width: 100%;
  }
}
</style>
