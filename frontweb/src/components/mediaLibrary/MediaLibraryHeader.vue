<template>
    <div class="page-header">
      <div class="header-left">
        <el-button text class="back-link" :aria-label="returnTo ? '返回制作台' : '返回项目首页'" @click="goBack">
          <el-icon aria-hidden="true"><ArrowLeft /></el-icon>
          {{ returnTo ? '返回制作台' : '返回项目首页' }}
        </el-button>
        <div class="title-wrap">
          <h1 class="page-title">素材中心</h1>
          <p class="page-subtitle">上传后的图片和视频会在所有项目里复用；单文件最大 100MB。</p>
        </div>
      </div>
      <span v-if="mediaNavigationLockReason" id="media-header-nav-reason" class="visually-hidden">{{ mediaNavigationLockReason }}</span>
      <span v-if="mediaUploadDisableReason" id="media-header-upload-reason" class="visually-hidden">{{ mediaUploadDisableReason }}</span>
      <div class="header-actions">
        <el-button :disabled="mediaAccessState.navigationLocked" aria-label="新建项目" :title="mediaAccessState.navigationLocked ? mediaNavigationLockReason : undefined" :aria-describedby="mediaAccessState.navigationLocked ? 'media-header-nav-reason' : undefined" @click="goNewProject">
          <el-icon aria-hidden="true"><Plus /></el-icon>
          新建项目
        </el-button>
        <el-button
          :type="mediaItems.length === 0 && !loading ? 'default' : 'primary'"
          :loading="uploading"
          :disabled="mediaWriteLocked || uploading"
          :title="mediaUploadDisableReason || undefined"
          :aria-describedby="mediaUploadDisableReason ? 'media-header-upload-reason' : undefined"
          aria-label="上传图片或视频到素材中心"
          @click="triggerUpload"
        >
          <el-icon aria-hidden="true"><Upload /></el-icon>
          上传素材
        </el-button>
        <input ref="uploadInput" type="file" accept="image/*,video/*" multiple style="display:none" @change="onUpload" />
      </div>
    </div>
</template>

<script setup>

// 仅展示页头；返回、新建、上传仍由素材中心页处理。
import { ref } from 'vue'
import { ArrowLeft, Plus, Upload } from '@element-plus/icons-vue'

defineProps({
  returnTo: { type: String, default: '' },
  mediaAccessState: { type: Object, required: true },
  mediaNavigationLockReason: { type: String, default: '' },
  mediaItems: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  mediaWriteLocked: { type: Boolean, default: false },
  mediaUploadDisableReason: { type: String, default: '' },
  goBack: { type: Function, required: true },
  goNewProject: { type: Function, required: true },
  triggerUpload: { type: Function, required: true },
  onUpload: { type: Function, required: true },
})

const uploadInput = ref(null)

defineExpose({ uploadInput })
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-color);
  gap: 20px;
  min-width: 0;
  overflow-x: clip;
}

.header-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.back-link {
  padding-left: 0;
}

.title-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-bright);
  margin: 0;
}

.page-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 840px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (max-width: 520px) {
  .header-actions > .el-button {
    margin-left: 0;
  }
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
.back-link:focus-visible,
.header-actions :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}
</style>
