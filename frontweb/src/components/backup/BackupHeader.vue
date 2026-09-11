<template>
  <header class="page-header">
    <div class="header-left">
      <el-button class="back-link" :aria-label="backButtonText" @click="goBack">
        <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
        {{ backButtonText }}
      </el-button>
      <div class="title-wrap">
        <h1 class="page-title">数据备份与维护</h1>
        <p class="page-subtitle">全量备份默认不含 AI 密钥。恢复会覆盖当前数据。</p>
      </div>
    </div>
    <span v-if="backupWriteLockReason" id="backup-header-lock-reason" class="visually-hidden">{{ backupWriteLockReason }}</span>
    <div class="header-actions">
      <el-button
        :loading="creating"
        :disabled="accessState.createLocked"
        :title="accessState.createLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.createLocked ? 'backup-header-lock-reason' : undefined"
        aria-label="创建全量备份"
        @click="onCreateBackup"
      >
        <el-icon aria-hidden="true"><Download /></el-icon>
        创建全量备份
      </el-button>
      <el-button
        type="primary"
        :disabled="accessState.writeLocked"
        :title="accessState.writeLocked ? backupWriteLockReason : undefined"
        :aria-describedby="accessState.writeLocked ? 'backup-header-lock-reason' : undefined"
        aria-label="选择备份文件"
        @click="triggerFileSelect"
      >
        <el-icon aria-hidden="true"><Upload /></el-icon>
        选择备份文件
      </el-button>
      <input
        ref="fileInputRef"
        type="file"
        accept=".zip"
        style="display:none"
        aria-hidden="true"
        tabindex="-1"
        :disabled="accessState.writeLocked"
        @change="onFileChange"
      >
    </div>
  </header>
</template>

<script setup>
import { ref } from 'vue'
import { ArrowLeft, Download, Upload } from '@element-plus/icons-vue'

defineProps({
  backButtonText: { type: String, required: true },
  creating: { type: Boolean, default: false },
  accessState: { type: Object, required: true },
  backupWriteLockReason: { type: String, default: '' },
  goBack: { type: Function, required: true },
  onCreateBackup: { type: Function, required: true },
  triggerFileSelect: { type: Function, required: true },
  onFileChange: { type: Function, required: true },
})

const fileInputRef = ref(null)

defineExpose({ fileInputRef })
</script>

<style scoped src="./backupPage.css"></style>