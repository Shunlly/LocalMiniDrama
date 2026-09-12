<template>
    <span v-if="mediaWriteLockReason" id="media-write-lock-reason" class="visually-hidden">{{ mediaWriteLockReason }}</span>
    <span v-if="mediaUploadDisableReason" id="media-grid-upload-reason" class="visually-hidden">{{ mediaUploadDisableReason }}</span>
    <span v-if="mediaNavigationLockReason" id="media-grid-nav-reason" class="visually-hidden">{{ mediaNavigationLockReason }}</span>
    <span v-if="mediaRetryLoadDisableReason" id="media-retry-load-reason" class="visually-hidden">{{ mediaRetryLoadDisableReason }}</span>
    <span v-if="mediaBatchDeleteDisableReason" id="media-batch-delete-reason" class="visually-hidden">{{ mediaBatchDeleteDisableReason }}</span>
    <section
      v-if="loadError"
      id="media-list-load-error"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>{{ mediaIsStale ? '素材列表刷新失败' : '素材数据加载失败' }}</h2>
        <p>暂时无法确认服务器中的最新素材。您的素材数据没有被删除。</p>
        <p v-if="mediaIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能上传、选择或删除素材。</p>
        <p v-else>加载失败时不会显示素材列表，也不会执行上传或删除。</p>
        <p class="data-load-state__detail">错误详情：{{ loadError }}</p>
        <p>下一步：请检查本机素材服务后点「重试加载」。</p>
      </div>
      <el-button type="primary" plain :loading="loading" :disabled="loading" :title="mediaRetryLoadDisableReason || undefined" :aria-describedby="mediaRetryLoadDisableReason ? 'media-retry-load-reason' : 'media-list-load-error'" :aria-label="loading ? '正在加载素材' : (mediaRetryLoadDisableReason || '重试加载素材')" @click="loadMedia">
        <el-icon><Refresh /></el-icon>重试加载
      </el-button>
    </section>

    <section v-if="mediaAccessState.showEntryStrip" class="entry-strip" aria-label="素材入口说明">
      <div class="entry-item">
        <span class="entry-label">上传到素材中心</span>
        <p class="entry-description">把不超过 100MB 的图片和视频放进全局素材，后续项目可以直接复用。</p>
        <el-button text class="entry-action" :disabled="mediaWriteLocked || uploading" :title="mediaUploadDisableReason || undefined" :aria-describedby="mediaUploadDisableReason ? 'media-grid-upload-reason' : undefined" aria-label="上传图片或视频到素材中心" @click="triggerUpload">立即上传</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">网页 URL 导入</span>
        <p class="entry-description">先在本页选择目标项目，再进入该项目完成网页 URL 导入。本页不直接粘贴 URL。</p>
        <el-button
          type="primary"
          plain
          class="entry-action"
          :disabled="mediaAccessState.navigationLocked"
          :title="mediaAccessState.navigationLocked ? mediaNavigationLockReason : undefined"
          :aria-describedby="mediaAccessState.navigationLocked ? 'media-grid-nav-reason' : undefined"
          aria-label="选择目标项目后导入网页 URL"
          @click="goSourceImport"
        >选择目标项目后导入网页 URL</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">角色 / 场景 / 道具入库</span>
        <p class="entry-description">在项目里点“加入素材库”后，会同步到首页里的分类素材入口。</p>
        <el-button text class="entry-action" :aria-label="returnTo ? '返回制作台' : '返回项目首页'" @click="goBack">{{ returnTo ? '返回制作台' : '返回项目首页' }}</el-button>
      </div>
    </section>


    <slot />

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress" role="status" aria-live="polite" aria-atomic="true">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在上传 {{ uploadProgress.current }}/{{ uploadProgress.total }}...</span>
    </div>

    <section
      v-if="uploadFeedback"
      class="upload-feedback"
      :class="`upload-feedback--${uploadFeedback.tone}`"
      :role="uploadFeedback.tone === 'error' ? 'alert' : 'status'"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div>
        <h2>{{ uploadFeedback.title }}</h2>
        <p>{{ uploadFeedback.detail }}</p>
        <p>下一步：请确认文件是图片或视频，单文件不超过 100MB，然后重新上传。</p>
      </div>
      <el-button
        type="primary"
        plain
        :disabled="mediaWriteLocked || uploading"
        :title="mediaUploadDisableReason || undefined"
        :aria-describedby="mediaUploadDisableReason ? 'media-grid-upload-reason' : undefined"
        aria-label="重新上传素材到素材中心"
        @click="triggerUpload"
      >重新上传</el-button>
    </section>

    <!-- 媒体网格 -->
    <div v-loading="loading" element-loading-text="正在加载素材" class="media-grid" :aria-busy="loading">
      <MediaLibraryCard
        v-for="item in mediaItems"
        :key="item.id"
        :item="item"
        :selected-ids="selectedIds"
        :media-write-locked="mediaWriteLocked"
        :media-write-lock-reason="mediaWriteLockReason"
        write-lock-described-by="media-write-lock-reason"
        :item-url="itemUrl"
        :thumbnail-alt="thumbnailAlt"
        :format-size="formatSize"
        :media-item-file-size="mediaItemFileSize"
        :media-origin-label="mediaOriginLabel"
        :is-action-layer-visible="isActionLayerVisible"
        :show-pointer-actions="showPointerActions"
        :hide-pointer-actions="hidePointerActions"
        :show-keyboard-actions="showKeyboardActions"
        :hide-keyboard-actions="hideKeyboardActions"
        :selection-label="selectionLabel"
        :set-item-selected="setItemSelected"
        :action-label="actionLabel"
        :open-preview="openPreview"
        :delete-item="deleteItem"
      />
      <MediaLibraryEmptyState
        v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems.length === 0"
        :has-active-filters="hasActiveFilters"
        :media-write-locked="mediaWriteLocked"
        :uploading="uploading"
        :media-upload-disable-reason="mediaUploadDisableReason"
        :media-access-state="mediaAccessState"
        :media-source-import-disable-reason="mediaSourceImportDisableReason"
        :clear-filters="clearFilters"
        :trigger-upload="triggerUpload"
        :go-source-import="goSourceImport"
      />
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        aria-label="素材列表分页"
        @current-change="loadMedia"
      />
    </div>

    <!-- 批量操作 -->
    <div v-if="selectedIds.size > 0" class="batch-bar">
      <span>已选 {{ selectedIds.size }} 项</span>
      <el-button size="small" aria-label="取消选择" @click="selectedIds.clear()">取消选择</el-button>
      <el-button size="small" type="danger" plain :disabled="mediaWriteLocked || visibleSelectedMediaCount <= 0" :title="mediaBatchDeleteDisableReason || undefined" :aria-describedby="mediaBatchDeleteDisableReason ? 'media-batch-delete-reason' : undefined" :aria-label="mediaBatchDeleteDisableReason || '批量删除素材'" @click="batchDelete">批量删除</el-button>
    </div>
</template>

<script setup>

// 仅展示本地素材网格；卡片和空态拆到子组件，写操作仍留在素材中心页。筛选栏通过默认插槽插入。
import { Loading, Refresh } from '@element-plus/icons-vue'
import MediaLibraryCard from './MediaLibraryCard.vue'
import MediaLibraryEmptyState from './MediaLibraryEmptyState.vue'

const page = defineModel('page', { type: Number, required: true })

defineProps({
  loadError: { type: String, default: '' },
  mediaIsStale: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  mediaRetryLoadDisableReason: { type: String, default: '' },
  mediaAccessState: { type: Object, required: true },
  mediaWriteLocked: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  mediaUploadDisableReason: { type: String, default: '' },
  mediaNavigationLockReason: { type: String, default: '' },
  mediaSourceImportDisableReason: { type: String, default: '' },
  mediaWriteLockReason: { type: String, default: '' },
  uploadProgress: { type: Object, required: true },
  uploadFeedback: { default: null },
  mediaItems: { type: Array, default: () => [] },
  selectedIds: { type: Object, required: true },
  hasSuccessfulMediaLoad: { type: Boolean, default: false },
  hasActiveFilters: { type: Boolean, default: false },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 30 },
  visibleSelectedMediaCount: { type: Number, default: 0 },
  mediaBatchDeleteDisableReason: { type: String, default: '' },
  loadMedia: { type: Function, required: true },
  triggerUpload: { type: Function, required: true },
  goSourceImport: { type: Function, required: true },
  goBack: { type: Function, required: true },
  returnTo: { type: String, default: '' },
  itemUrl: { type: Function, required: true },
  thumbnailAlt: { type: Function, required: true },
  formatSize: { type: Function, required: true },
  mediaItemFileSize: { type: Function, required: true },
  mediaOriginLabel: { type: Function, required: true },
  isActionLayerVisible: { type: Function, required: true },
  showPointerActions: { type: Function, required: true },
  hidePointerActions: { type: Function, required: true },
  showKeyboardActions: { type: Function, required: true },
  hideKeyboardActions: { type: Function, required: true },
  selectionLabel: { type: Function, required: true },
  setItemSelected: { type: Function, required: true },
  actionLabel: { type: Function, required: true },
  openPreview: { type: Function, required: true },
  deleteItem: { type: Function, required: true },
  clearFilters: { type: Function, required: true },
  batchDelete: { type: Function, required: true },
})
</script>

<style scoped>
.data-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
  padding: 16px 18px;
  border: 1px solid var(--el-color-danger-light-5);
  border-left: 4px solid var(--el-color-danger);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow);
}

.data-load-state__content {
  min-width: 0;
}

.data-load-state h2 {
  margin: 0 0 5px;
  color: var(--text-bright);
  font-size: 16px;
  line-height: 1.4;
}

.data-load-state p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.data-load-state .data-load-state__stale {
  color: #d97706;
}

.data-load-state .data-load-state__detail {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}

.entry-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  margin-bottom: 20px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--border-color);
  box-shadow: var(--shadow);
}

.entry-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 18px;
  background: var(--bg-card);
}

.entry-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.entry-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.entry-action {
  padding-left: 0;
}

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

.upload-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--el-color-primary);
  font-size: 14px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  min-height: 200px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  color: #fff;
  padding: 10px 20px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0,0,0,.2);
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
.data-load-state :deep(.el-button:focus-visible),
.entry-action:focus-visible,
.batch-bar :deep(.el-button:focus-visible),
.upload-feedback :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
}
</style>
