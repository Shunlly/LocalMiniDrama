<template>
  <div class="empty-media">
    <el-icon class="empty-icon"><Files /></el-icon>
    <h2 class="empty-title">{{ hasActiveFilters ? '没有匹配的素材' : '素材中心还是空的' }}</h2>
    <p class="empty-description">{{ hasActiveFilters ? '调整关键词或素材类型后再试。' : '上传图片或视频，后续项目可以直接复用。' }}</p>
    <div class="empty-actions">
      <template v-if="hasActiveFilters">
        <el-button aria-label="清除素材筛选" @click="clearFilters">清除筛选</el-button>
        <el-button type="primary" :disabled="mediaWriteLocked || uploading" :title="mediaUploadDisableReason || undefined" aria-label="上传图片或视频到素材中心" @click="triggerUpload">
          <el-icon><Upload /></el-icon>上传素材
        </el-button>
      </template>
      <template v-else>
        <el-button
          type="primary"
          :disabled="mediaWriteLocked || uploading"
          :title="mediaUploadDisableReason || undefined"
          aria-label="上传图片或视频到素材中心"
          @click="triggerUpload"
        >
          <el-icon><Upload /></el-icon>上传素材
        </el-button>
      </template>
    </div>
    <template v-if="!hasActiveFilters">
      <p class="empty-note">需要把角色、场景或道具沉淀到分类素材时，请先在项目内点“加入素材库”。</p>
      <el-button
        type="primary"
        plain
        class="empty-secondary-action"
        :disabled="mediaWriteLocked || mediaAccessState.navigationLocked"
        :title="mediaSourceImportDisableReason || undefined"
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
})
</script>

<style scoped>
.empty-media {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 340px;
  color: var(--text-subtle);
  gap: 10px;
}

.empty-icon {
  font-size: 48px;
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
}

.empty-note {
  max-width: 560px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-subtle);
  text-align: center;
}

.empty-secondary-action {
  min-height: 28px;
  margin-top: -2px;
  padding: 0 4px;
}
</style>
