<template>
  <AccessibleDialog
    :model-value="restoreDialogVisible"
    :title="restoreCopy.title"
    width="480px"
    :close-on-click-modal="false"
    :close-on-press-escape="!restoring"
    :show-close="!restoring"
    @update:model-value="onRestoreDialogVisible"
  >
    <p>{{ restoreCopy.body }}</p>
    <template #footer>
      <span v-if="restoring" id="backup-dialog-restoring-reason" class="visually-hidden">正在恢复备份，请稍候</span>
      <span v-if="backupWriteLockReason" id="backup-dialog-lock-reason" class="visually-hidden">{{ backupWriteLockReason }}</span>
      <el-button
        :disabled="restoring"
        :title="restoring ? '正在恢复备份，请稍候' : undefined"
        :aria-describedby="restoring ? 'backup-dialog-restoring-reason' : undefined"
        aria-label="取消恢复备份"
        @click="cancelRestore"
      >取消恢复备份</el-button>
      <el-button
        type="danger"
        :loading="restoring"
        :disabled="accessState.restoreLocked"
        :title="accessState.restoreLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.restoreLocked ? 'backup-dialog-lock-reason' : undefined"
        aria-label="确认恢复备份"
        @click="onConfirmRestore"
      >
        {{ restoreCopy.confirmButtonText }}
      </el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
defineProps({
  restoreDialogVisible: { type: Boolean, default: false },
  restoreCopy: {
    type: Object,
    default: () => ({ title: '', body: '', confirmButtonText: '确认恢复' }),
  },
  restoring: { type: Boolean, default: false },
  accessState: { type: Object, required: true },
  backupWriteLockReason: { type: String, default: '' },
  onRestoreDialogVisible: { type: Function, required: true },
  cancelRestore: { type: Function, required: true },
  onConfirmRestore: { type: Function, required: true },
})
</script>

<style scoped src="./backupPage.css"></style>
