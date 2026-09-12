<template>
  <div class="empty-media" role="status" aria-live="polite">
    <span v-if="mediaUploadDisableReason" id="media-empty-upload-reason" class="visually-hidden">{{ mediaUploadDisableReason }}</span>
    <span v-if="mediaSourceImportDisableReason" id="media-empty-import-reason" class="visually-hidden">{{ mediaSourceImportDisableReason }}</span>
    <el-icon class="empty-icon"><Files /></el-icon>
    <h2 class="empty-title">{{ hasActiveFilters ? '没有匹配的素材' : '素材中心还是空的' }}</h2>
    <p class="empty-description">{{ hasActiveFilters ? '调整关键词或素材类型后再试。' : '上传图片或视频，后续项目可以直接复用。' }}</p>
    <div class="empty-actions">
      <template v-if="hasActiveFilters">
        <el-button type="default" aria-label="清除筛选" @click="clearFilters">清除筛选</el-button>
        <el-button type="primary" :disabled="mediaWriteLocked || uploading" :title="mediaUploadDisableReason || undefined" :aria-describedby="mediaUploadDisableReason ? 'media-empty-upload-reason' : undefined" aria-label="上传素材" @click="triggerUpload">
          <el-icon><Upload /></el-icon>上传素材
        </el-button>
      </template>
      <template v-else>
        <el-button
          type="primary"
          :disabled="mediaWriteLocked || uploading"
          :title="mediaUploadDisableReason || undefined"
          :aria-describedby="mediaUploadDisableReason ? 'media-empty-upload-reason' : undefined"
          aria-label="上传素材"
          @click="triggerUpload"
        >
          <el-icon><Upload /></el-icon>上传素材
        </el-button>
        <el-button type="default" aria-label="去搜网络素材" @click="goSearchNetwork">去搜网络素材</el-button>
      </template>
    </div>
    <template v-if="!hasActiveFilters">
      <p class="empty-note">需要把角色、场景或道具沉淀到分类素材时，请先在项目内点“加入素材库”。</p>
      <el-button
        type="default"
        class="empty-secondary-action"
        :disabled="mediaWriteLocked || mediaAccessState.navigationLocked"
        :title="mediaSourceImportDisableReason || undefined"
        :aria-describedby="mediaSourceImportDisableReason ? 'media-empty-import-reason' : undefined"
        aria-label="选择目标项目后导入网页 URL"
        @click="goSourceImport"
      >选择目标项目后导入网页 URL</el-button>
    </template>
  </div>
</template>

<script setup>
// 仅展示本地素材空态；上传、筛选和导入仍由素材中心页处理。
import { Files, Upload } from '@element-plus/icons-vue'

defineProps({
  hasActiveFilters: { type: Boolean, default: false },
  mediaWriteLocked: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  mediaUploadDisableReason: { type: String, default: '' },
  mediaAccessState: { type: Object, required: true },
  mediaSourceImportDisableReason: { type: String, default: '' },
  clearFilters: { type: Function, required: true },
  triggerUpload: { type: Function, required: true },
  goSourceImport: { type: Function, required: true },
  goSearchNetwork: { type: Function, required: true },
})
</script>

<style scoped>
.empty-media {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 340px;
  padding: 16px 12px;
  color: var(--text-subtle);
  gap: 10px;
}

.empty-icon {
  font-size: 48px;
}

.empty-title,
.empty-description,
.empty-note {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: center;
}

.empty-title {
  margin: 4px 0 0;
  color: var(--text-bright);
  font-size: 18px;
}

.empty-description {
  margin: 0 0 8px;
  color: var(--text-subtle);
  font-size: 14px;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.empty-note {
  max-width: min(560px, 100%);
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-subtle);
}

.empty-actions :deep(.el-button),
.empty-secondary-action {
  white-space: normal;
  height: auto;
  max-width: 100%;
}

.empty-secondary-action {
  min-height: 28px;
  margin-top: -2px;
  padding: 0 4px;
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
.empty-actions :deep(.el-button:focus-visible),
.empty-secondary-action:focus-visible {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}
</style>
