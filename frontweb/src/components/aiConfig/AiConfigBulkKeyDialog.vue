<template>
  <AccessibleDialog v-model="bulkKeyVisible" title="一键换密钥" width="440px" class="ai-config-overlay" :close-on-click-modal="false" :before-close="confirmBulkKeyClose">
    <el-alert
      type="warning"
      :closable="false"
      style="margin-bottom: 16px"
      title="此操作将替换所有配置的 API 密钥，请确认新密钥可用后再提交。"
      show-icon
    />
    <el-form label-width="80px">
      <el-form-item label="新 API 密钥">
        <el-input
          v-model="bulkKeyInput"
          type="password"
          show-password
          aria-label="新 API 密钥"
          placeholder="粘贴新的 API 密钥"
          clearable
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="requestBulkKeyClose">取消</el-button>
      <el-button type="primary" :loading="bulkKeySaving" :disabled="configWriteLocked || !bulkKeyInput.trim()" :title="configWriteLocked ? configWriteLockReason : (!bulkKeyInput.trim() ? '请先填写密钥' : undefined)" @click="submitBulkKey">确认替换</el-button>
    </template>
  </AccessibleDialog>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  configWriteLocked: { type: Boolean, default: false },
  configWriteLockReason: { type: String, default: '' },
  bulkKeySaving: { type: Boolean, default: false },
  confirmBulkKeyClose: { type: Function, required: true },
  requestBulkKeyClose: { type: Function, required: true },
  submitBulkKey: { type: Function, required: true },
})

const bulkKeyVisible = defineModel('bulkKeyVisible', { type: Boolean, default: false })
const bulkKeyInput = defineModel('bulkKeyInput', { type: String, default: '' })
</script>
