<template>
  <div class="batch-import-footer">
    <el-button
      :disabled="Boolean(closeDisabledReason)"
      :title="closeDisabledReason"
      :aria-label="closeDisabledReason || '取消'"
      @click="emit('cancel')"
    >取消</el-button>
    <el-button
      v-if="activeTab === 'preview'"
      :disabled="importing"
      :title="importing ? '正在导入剧集，请完成后再返回。' : ''"
      :aria-label="importing ? '正在导入剧集，请完成后再返回。' : '上一步'" @click="emit('back')"
    >上一步</el-button>
    <el-button
      v-if="activeTab === 'config'"
      type="primary"
      :disabled="Boolean(configConfirmDisabledReason)"
      :title="configConfirmDisabledReason"
      :aria-label="configConfirmDisabledReason ? `确认导入配置不可用：${configConfirmDisabledReason}` : '确认导入配置'"
      @click="emit('confirm-config')"
    >确认导入配置</el-button>
    <el-button
      v-else
      type="primary"
      :disabled="Boolean(importConfirmDisabledReason)"
      :title="importConfirmDisabledReason"
      :aria-label="importConfirmDisabledReason ? `确认导入集数不可用：${importConfirmDisabledReason}` : '确认导入集数'"
      :loading="importing"
      @click="emit('confirm-import')"
    >确认导入集数</el-button>
    <span
      v-if="activeTab === 'config' ? configConfirmDisabledReason : importConfirmDisabledReason"
      class="batch-import-disabled-reason"
    >{{ activeTab === 'config' ? configConfirmDisabledReason : importConfirmDisabledReason }}</span>
  </div>
</template>

<script setup>
defineProps({
  activeTab: { type: String, default: 'config' },
  importing: { type: Boolean, default: false },
  closeDisabledReason: { type: String, default: '' },
  configConfirmDisabledReason: { type: String, default: '' },
  importConfirmDisabledReason: { type: String, default: '' },
})

const emit = defineEmits(['cancel', 'back', 'confirm-config', 'confirm-import'])
</script>

<style scoped>
.batch-import-footer { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.batch-import-disabled-reason { font-size: 12px; color: #a1a1aa; line-height: 1.4; }
</style>
