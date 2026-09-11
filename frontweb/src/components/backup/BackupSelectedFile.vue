<template>
  <section v-if="selectedFile" class="selected-file" role="status" aria-live="polite">
    <p>已选择：{{ selectedFile.name }}</p>
    <div class="import-failure-actions">
      <el-button
        type="danger"
        plain
        :disabled="accessState.restoreLocked"
        :title="accessState.restoreLocked ? backupWriteLockReason : undefined"
        aria-label="恢复所选备份文件"
        @click="requestRestoreFromSelection"
      >
        恢复所选备份
      </el-button>
      <el-button
        plain
        :disabled="accessState.writeLocked"
        :title="accessState.writeLocked ? backupWriteLockReason : undefined"
        aria-label="清除所选备份文件"
        @click="clearSelectedFile"
      >
        清除所选
      </el-button>
    </div>
  </section>
</template>

<script setup>
defineProps({
  selectedFile: { default: null },
  accessState: { type: Object, required: true },
  backupWriteLockReason: { type: String, default: '' },
  requestRestoreFromSelection: { type: Function, required: true },
  clearSelectedFile: { type: Function, required: true },
})
</script>

<style scoped src="./backupPage.css"></style>