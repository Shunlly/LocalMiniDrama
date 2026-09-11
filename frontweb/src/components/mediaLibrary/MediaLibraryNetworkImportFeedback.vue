<template>
  <section
    v-if="networkImportFeedback"
    class="upload-feedback"
    :class="`upload-feedback--${networkImportFeedback.tone}`"
    :role="networkImportFeedback.tone === 'error' ? 'alert' : 'status'"
    aria-live="assertive"
    aria-atomic="true"
  >
    <div>
      <h2>{{ networkImportFeedback.title }}</h2>
      <p>{{ networkImportFeedback.detail }}</p>
      <p
        v-if="networkImportRetryItem && (isNetworkImporting(networkImportRetryItem) || !networkItemImportability(networkImportRetryItem).allowed)"
        id="media-network-import-retry-reason"
        class="visually-hidden"
      >{{ isNetworkImporting(networkImportRetryItem) ? MEDIA_LIBRARY_DISABLE_REASON.importing : networkItemImportability(networkImportRetryItem).reason }}</p>
    </div>
    <el-button
      v-if="networkImportRetryItem"
      type="primary"
      plain
      :loading="isNetworkImporting(networkImportRetryItem)"
      :disabled="isNetworkImporting(networkImportRetryItem) || !networkItemImportability(networkImportRetryItem).allowed"
      :title="isNetworkImporting(networkImportRetryItem) ? MEDIA_LIBRARY_DISABLE_REASON.importing : (networkItemImportability(networkImportRetryItem).reason || undefined)"
      :aria-describedby="(isNetworkImporting(networkImportRetryItem) || (networkItemImportability(networkImportRetryItem).reason && !networkItemImportability(networkImportRetryItem).allowed)) ? 'media-network-import-retry-reason' : undefined"
      aria-label="重试导入该网络素材"
      @click="importNetworkItem(networkImportRetryItem)"
    >
      <el-icon><Refresh /></el-icon>重试导入
    </el-button>
  </section>
</template>

<script setup>
// 仅展示网络素材导入反馈；重试导入仍由素材中心页处理。
import { Refresh } from '@element-plus/icons-vue'
import { MEDIA_LIBRARY_DISABLE_REASON } from '@/utils/mediaLibraryUserError.js'

defineProps({
  networkImportFeedback: { default: null },
  networkImportRetryItem: { default: null },
  isNetworkImporting: { type: Function, required: true },
  networkItemImportability: { type: Function, required: true },
  importNetworkItem: { type: Function, required: true },
})
</script>

<style scoped>
.upload-feedback {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--el-color-warning);
  border-radius: 8px;
  background: var(--bg-card);
}

.upload-feedback--error {
  border-left-color: var(--el-color-danger);
}

.upload-feedback > .el-button {
  flex-shrink: 0;
}

.upload-feedback h2,
.upload-feedback p {
  margin: 0;
}

.upload-feedback h2 {
  color: var(--text-bright);
  font-size: 15px;
}

.upload-feedback p {
  margin-top: 4px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.upload-feedback :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}
</style>
