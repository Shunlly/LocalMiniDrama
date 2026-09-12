<template>
  <div v-loading="loading" class="backup-list-wrap" :aria-busy="loading">
    <span v-if="backupWriteLockReason" id="backup-list-write-reason" class="visually-hidden">{{ backupWriteLockReason }}</span>
    <span v-if="backupRestoreLockReason" id="backup-list-restore-reason" class="visually-hidden">{{ backupRestoreLockReason }}</span>
    <section
      v-if="accessState.showEmpty"
      class="empty-state"
      role="status"
      aria-live="polite"
      data-testid="backup-empty-state"
    >
      <strong>还没有备份</strong>
      <span>可以创建新备份，或选择已有备份文件恢复。</span>
      <div class="empty-state-actions">
        <el-button
          type="primary"
          :loading="creating"
          :disabled="accessState.createLocked"
          :title="accessState.createLocked ? backupWriteLockReason : undefined"
          :aria-describedby="accessState.createLocked ? 'backup-list-write-reason' : undefined"
          aria-label="创建备份"
          @click="onCreateBackup"
        >创建备份</el-button>
        <el-button
          :disabled="accessState.writeLocked"
          :title="accessState.writeLocked ? backupWriteLockReason : undefined"
          :aria-describedby="accessState.writeLocked ? 'backup-list-write-reason' : undefined"
          aria-label="选择已有备份"
          @click="triggerFileSelect"
        >选择已有备份</el-button>
      </div>
    </section>

    <section
      v-else-if="loading && !hasSuccessfulListLoad"
      class="empty-state"
      role="status"
      aria-live="polite"
    >
      <strong>正在加载备份列表</strong>
      <span>请稍候，正在确认服务器中的备份。</span>
    </section>

    <ul v-else-if="hasSuccessfulListLoad && backups.length" class="backup-list">
      <li v-for="item in backups" :key="item.id" class="backup-item">
        <div class="backup-item-copy">
          <strong>{{ item.name }}</strong>
          <p>
            <span v-if="formatBackupTimestamp(item.createdAt)">{{ formatBackupTimestamp(item.createdAt) }}</span>
            <span v-if="formatBackupSize(item.bytes)"> · {{ formatBackupSize(item.bytes) }}</span>
          </p>
        </div>
        <el-button
          type="danger"
          plain
          size="small"
          :disabled="accessState.restoreFromListLocked"
          :title="accessState.restoreFromListLocked ? backupRestoreLockReason : undefined"
          :aria-describedby="accessState.restoreFromListLocked ? 'backup-list-restore-reason' : undefined"
          :aria-label="`恢复备份 ${item.name}`"
          @click="requestRestoreFromItem(item)"
        >
          恢复
        </el-button>
      </li>
    </ul>
  </div>
</template>

<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  creating: { type: Boolean, default: false },
  accessState: { type: Object, required: true },
  backupWriteLockReason: { type: String, default: '' },
  backupRestoreLockReason: { type: String, default: '' },
  hasSuccessfulListLoad: { type: Boolean, default: false },
  backups: { type: Array, default: () => [] },
  formatBackupTimestamp: { type: Function, required: true },
  formatBackupSize: { type: Function, required: true },
  onCreateBackup: { type: Function, required: true },
  triggerFileSelect: { type: Function, required: true },
  requestRestoreFromItem: { type: Function, required: true },
})
</script>

<style scoped src="./backupPage.css"></style>