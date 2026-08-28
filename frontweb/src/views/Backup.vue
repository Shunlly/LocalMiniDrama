<template>
  <div class="backup-page">
    <header class="page-header">
      <div class="header-left">
        <el-button class="back-link" :aria-label="backButtonText" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          {{ backButtonText }}
        </el-button>
        <div class="title-wrap">
          <h1 class="page-title">数据备份与维护</h1>
          <p class="page-subtitle">全量备份默认不含 AI 密钥。恢复会覆盖当前数据。</p>
        </div>
      </div>
      <div class="header-actions">
        <el-button
          :loading="creating"
          :disabled="accessState.createLocked"
          aria-label="创建全量备份"
          @click="onCreateBackup"
        >
          <el-icon><Download /></el-icon>
          创建备份
        </el-button>
        <el-button
          type="primary"
          :disabled="accessState.writeLocked"
          aria-label="选择备份文件"
          @click="triggerFileSelect"
        >
          <el-icon><Upload /></el-icon>
          选择备份文件
        </el-button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".zip"
          style="display:none"
          :disabled="accessState.writeLocked"
          @change="onFileChange"
        >
      </div>
    </header>

    <section
      v-if="readinessError"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>{{ hasSuccessfulReadinessLoad ? '维护状态刷新失败' : '维护状态加载失败' }}</h2>
        <p>暂时无法确认维护租约。这不会删除已有备份。</p>
        <p v-if="hasSuccessfulReadinessLoad" class="data-load-state__stale">下方显示上次成功读取的维护状态，当前内容已过期。</p>
        <p v-else>维护正常空态不会在连接恢复前显示。</p>
        <p class="data-load-state__detail">错误详情：{{ readinessError }}</p>
      </div>
      <el-button type="primary" plain :loading="readinessLoading" aria-label="重试加载维护状态" @click="loadReadiness">
        <el-icon><Refresh /></el-icon>重试加载
      </el-button>
    </section>
    <section
      v-else-if="!readinessLoading && hasSuccessfulReadinessLoad && readiness"
      class="maintenance-status"
      :class="readiness.ready ? 'is-ready' : 'is-blocked'"
      :role="readiness.ready ? 'status' : 'alert'"
      aria-live="polite"
    >
      <strong>{{ readiness.ready ? '维护租约正常' : '维护租约不可用' }}</strong>
      <p v-if="!readiness.ready">{{ readiness.maintenanceError || '当前不能安全执行备份或恢复。' }}</p>
    </section>

    <section
      v-if="listError"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>{{ listIsStale ? '备份列表刷新失败' : '备份列表加载失败' }}</h2>
        <p>暂时无法确认服务器中的备份。已有备份文件没有被删除。</p>
        <p v-if="listIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能从列表恢复。</p>
        <p v-else>备份空态不会在连接恢复前显示。</p>
        <p class="data-load-state__detail">错误详情：{{ listError }}</p>
      </div>
      <el-button type="primary" plain :loading="loading" aria-label="重试加载备份列表" @click="loadBackups">
        <el-icon><Refresh /></el-icon>重试加载
      </el-button>
    </section>

    <section
      v-if="fileError"
      class="data-load-state import-failure-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>备份文件选择失败</h2>
        <p v-if="fileErrorName" class="import-failure-filename">文件：{{ fileErrorName }}</p>
        <p>{{ fileError }}</p>
      </div>
      <div class="import-failure-actions">
        <el-button type="primary" plain :disabled="accessState.writeLocked" aria-label="重新选择备份文件" @click="triggerFileSelect">
          <el-icon><Refresh /></el-icon>重新选择备份文件
        </el-button>
        <el-button plain :disabled="restoring" aria-label="关闭备份文件错误" @click="dismissFileError">关闭</el-button>
      </div>
    </section>

    <section
      v-if="actionError"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>备份操作失败</h2>
        <p>{{ actionError }}</p>
      </div>
    </section>

    <section v-if="selectedFile" class="selected-file" aria-live="polite">
      <p>已选择：{{ selectedFile.name }}</p>
      <el-button
        type="danger"
        plain
        :disabled="accessState.writeLocked"
        aria-label="恢复所选备份文件"
        @click="requestRestoreFromSelection"
      >
        恢复所选备份
      </el-button>
    </section>

    <div v-loading="loading" class="backup-list-wrap" :aria-busy="loading">
      <section
        v-if="accessState.showEmpty"
        class="empty-state"
        role="status"
        aria-live="polite"
      >
        <strong>还没有备份</strong>
        <span>可以创建新备份，或选择已有备份文件恢复。</span>
      </section>

      <ul v-else-if="hasSuccessfulListLoad && backups.length" class="backup-list">
        <li v-for="item in backups" :key="item.id" class="backup-item">
          <div class="backup-item-copy">
            <strong>{{ item.name }}</strong>
            <p>
              <span v-if="item.createdAt">{{ item.createdAt }}</span>
              <span v-if="formatBackupSize(item.bytes)"> · {{ formatBackupSize(item.bytes) }}</span>
            </p>
          </div>
          <el-button
            type="danger"
            plain
            size="small"
            :disabled="accessState.restoreFromListLocked"
            :aria-label="`恢复备份 ${item.name}`"
            @click="requestRestoreFromItem(item)"
          >
            恢复
          </el-button>
        </li>
      </ul>
    </div>

    <AccessibleDialog
      v-model="restoreDialogVisible"
      :title="restoreCopy.title"
      width="480px"
      :close-on-click-modal="false"
    >
      <p>{{ restoreCopy.body }}</p>
      <template #footer>
        <el-button :disabled="restoring" @click="cancelRestore">{{ restoreCopy.cancelButtonText }}</el-button>
        <el-button type="danger" :loading="restoring" aria-label="确认恢复备份" @click="onConfirmRestore">
          {{ restoreCopy.confirmButtonText }}
        </el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Download, Refresh, Upload } from '@element-plus/icons-vue'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import {
  formatBackupSize,
  normalizeBackupReturnTo,
  useBackupSettings,
} from '@/composables/useBackupSettings.js'

const router = useRouter()
const route = useRoute()
const fileInputRef = ref(null)
const leaveProtection = inject('appRouteLeaveProtection', null)
let unregisterLeaveProtection = null
const {
  backups,
  loading,
  creating,
  restoring,
  hasSuccessfulListLoad,
  listError,
  listIsStale,
  fileError,
  fileErrorName,
  actionError,
  selectedFile,
  restoreDialogVisible,
  restoreCopy,
  accessState,
  readinessLoading,
  readinessError,
  hasSuccessfulReadinessLoad,
  readiness,
  loadBackups,
  loadReadiness,
  createBackup,
  selectBackupFile,
  requestRestoreFromSelection,
  requestRestoreFromItem,
  confirmRestore,
  cancelRestore,
  dismissFileError,
  dispose,
} = useBackupSettings({
  downloadBackup(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  },
})

const returnTo = computed(() => normalizeBackupReturnTo(route.query.returnTo))
const backButtonText = computed(() => (returnTo.value === '/ai-config' ? '返回 AI 配置' : '返回首页'))

async function goBack() {
  await router.replace(returnTo.value || { name: 'list' })
}

function triggerFileSelect() {
  if (accessState.value.writeLocked) return
  fileInputRef.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  selectBackupFile(file)
}

async function onCreateBackup() {
  const result = await createBackup()
  if (result.ok) ElMessage.success('备份已创建')
}

async function onConfirmRestore() {
  const result = await confirmRestore()
  if (result.ok) ElMessage.success(result.message || '备份已恢复')
}

function isBackupBusy() {
  return creating.value || restoring.value
}

onBeforeRouteLeave(async (_to, _from, next) => {
  if (!isBackupBusy()) {
    next()
    return
  }
  const allowed = window.confirm('正在备份或恢复，离开会中断当前操作。仍要离开吗？')
  next(allowed)
})

onMounted(() => {
  unregisterLeaveProtection = leaveProtection?.register?.('backup', {
    shouldBlockUnload: () => isBackupBusy(),
    confirmLeave: async () => {
      if (!isBackupBusy()) return true
      return window.confirm('正在备份或恢复，离开会中断当前操作。仍要离开吗？')
    },
  }) || null
  loadBackups()
  loadReadiness()
})

onBeforeUnmount(() => {
  unregisterLeaveProtection?.()
  unregisterLeaveProtection = null
  dispose()
})
</script>

<style scoped>
.backup-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  color: var(--text-primary);
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.header-left,
.header-actions,
.import-failure-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-left {
  min-width: 0;
}
.title-wrap {
  min-width: 0;
}
.page-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
  color: var(--text-bright, var(--text-primary));
}
.page-subtitle {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}
.back-link {
  flex: 0 0 auto;
}
.data-load-state,
.maintenance-status,
.selected-file,
.empty-state,
.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border: 1px solid var(--border-color, #3f3f46);
  border-radius: 8px;
  background: var(--bg-card, rgba(24, 24, 27, 0.75));
}
.data-load-state {
  border-color: var(--el-color-danger-light-5);
  border-left: 4px solid var(--el-color-danger);
}
.data-load-state__content,
.backup-item-copy,
.empty-state {
  min-width: 0;
}
.data-load-state h2,
.empty-state strong,
.backup-item-copy strong,
.maintenance-status strong {
  margin: 0 0 4px;
  font-size: 16px;
}
.data-load-state p,
.empty-state span,
.backup-item-copy p,
.maintenance-status p,
.selected-file p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}
.data-load-state__stale {
  color: #d97706;
}
.data-load-state__detail,
.import-failure-filename {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
.maintenance-status.is-blocked {
  border-left: 4px solid #d97706;
}
.maintenance-status.is-ready {
  border-left: 4px solid var(--el-color-success);
}
.empty-state {
  flex-direction: column;
  align-items: flex-start;
}
.backup-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.backup-list-wrap {
  min-height: 80px;
}
@media (max-width: 720px) {
  .page-header,
  .header-left,
  .header-actions,
  .data-load-state,
  .import-failure-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
