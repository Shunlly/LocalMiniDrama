<template>
  <div class="backup-page">
    <BackupHeader ref="headerRef" v-bind="headerBindings" />
    <BackupReadiness v-bind="readinessBindings" />
    <BackupFailureBanners v-bind="failureBindings" />
    <BackupSelectedFile v-bind="selectedFileBindings" />
    <BackupList v-bind="listBindings" />
    <BackupRestoreDialog v-bind="restoreDialogBindings" />
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/elementPlusFeedback.js'
import {
  formatBackupSize,
  formatBackupTimestamp,
  normalizeBackupReturnTo,
  useBackupSettings,
} from '@/composables/useBackupSettings.js'
import BackupHeader from '@/components/backup/BackupHeader.vue'
import BackupReadiness from '@/components/backup/BackupReadiness.vue'
import BackupFailureBanners from '@/components/backup/BackupFailureBanners.vue'
import BackupSelectedFile from '@/components/backup/BackupSelectedFile.vue'
import BackupList from '@/components/backup/BackupList.vue'
import BackupRestoreDialog from '@/components/backup/BackupRestoreDialog.vue'
import {
  confirmBackupLeave,
  getBackupRestoreLockReason,
  getBackupWriteLockReason,
  isBackupBusy,
} from '@/components/backup/backupPageCopy.js'

const router = useRouter()
const route = useRoute()
const headerRef = ref(null)
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
  lastFailedAction,
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
  retryRestore,
  cancelRestore,
  dismissFileError,
  dismissActionError,
  clearSelectedFile,
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
const backupWriteLockReason = computed(() => getBackupWriteLockReason({
  creating: creating.value,
  restoring: restoring.value,
  loading: loading.value,
  hasSuccessfulReadinessLoad: hasSuccessfulReadinessLoad.value,
  readiness: readiness.value,
}))
const backupRestoreLockReason = computed(() => getBackupRestoreLockReason({
  writeLockReason: backupWriteLockReason.value,
  listError: listError.value,
  listIsStale: listIsStale.value,
  hasSuccessfulListLoad: hasSuccessfulListLoad.value,
}))

async function goBack() {
  await router.replace(returnTo.value || { name: 'list' })
}

function onRestoreDialogVisible(visible) {
  if (visible) {
    restoreDialogVisible.value = true
    return
  }
  if (restoring.value) {
    restoreDialogVisible.value = true
    return
  }
  cancelRestore()
}

function triggerFileSelect() {
  if (accessState.value.writeLocked) return
  headerRef.value?.fileInputRef?.click()
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

async function onRetryRestore() {
  const result = await retryRestore()
  if (result.ok) ElMessage.success(result.message || '备份已恢复')
}

function backupBusyNow() {
  return isBackupBusy({ creating: creating.value, restoring: restoring.value })
}

const headerBindings = computed(() => ({
  backButtonText: backButtonText.value,
  creating: creating.value,
  accessState: accessState.value,
  backupWriteLockReason: backupWriteLockReason.value,
  goBack,
  onCreateBackup,
  triggerFileSelect,
  onFileChange,
}))

const readinessBindings = computed(() => ({
  readinessError: readinessError.value,
  readinessLoading: readinessLoading.value,
  hasSuccessfulReadinessLoad: hasSuccessfulReadinessLoad.value,
  readiness: readiness.value,
  loadReadiness,
}))

const failureBindings = computed(() => ({
  listError: listError.value,
  listIsStale: listIsStale.value,
  loading: loading.value,
  fileError: fileError.value,
  fileErrorName: fileErrorName.value,
  actionError: actionError.value,
  lastFailedAction: lastFailedAction.value,
  creating: creating.value,
  restoring: restoring.value,
  accessState: accessState.value,
  backupWriteLockReason: backupWriteLockReason.value,
  loadBackups,
  triggerFileSelect,
  dismissFileError,
  onRetryRestore,
  onCreateBackup,
  dismissActionError,
}))

const selectedFileBindings = computed(() => ({
  selectedFile: selectedFile.value,
  accessState: accessState.value,
  backupWriteLockReason: backupWriteLockReason.value,
  requestRestoreFromSelection,
  clearSelectedFile,
}))

const listBindings = computed(() => ({
  loading: loading.value,
  creating: creating.value,
  accessState: accessState.value,
  backupWriteLockReason: backupWriteLockReason.value,
  backupRestoreLockReason: backupRestoreLockReason.value,
  hasSuccessfulListLoad: hasSuccessfulListLoad.value,
  backups: backups.value,
  formatBackupTimestamp,
  formatBackupSize,
  onCreateBackup,
  triggerFileSelect,
  requestRestoreFromItem,
}))

const restoreDialogBindings = computed(() => ({
  restoreDialogVisible: restoreDialogVisible.value,
  restoreCopy: restoreCopy.value,
  restoring: restoring.value,
  accessState: accessState.value,
  backupWriteLockReason: backupWriteLockReason.value,
  onRestoreDialogVisible,
  cancelRestore,
  onConfirmRestore,
}))

onBeforeRouteLeave(async (_to, _from, next) => {
  next(confirmBackupLeave(backupBusyNow()))
})

onMounted(() => {
  unregisterLeaveProtection = leaveProtection?.register?.('backup', {
    shouldBlockUnload: () => backupBusyNow(),
    confirmLeave: async () => confirmBackupLeave(backupBusyNow()),
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
</style>