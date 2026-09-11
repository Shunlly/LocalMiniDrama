<template>
    <section
      v-if="loadError"
      class="data-load-state"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div class="data-load-state__content">
        <h2>{{ mediaIsStale ? '素材列表刷新失败' : '素材数据加载失败' }}</h2>
        <p>暂时无法确认服务器中的最新素材。您的素材数据没有被删除。</p>
        <p v-if="mediaIsStale" class="data-load-state__stale">下方显示上次成功加载的数据，当前内容已过期；成功重试前不能上传、选择或删除素材。</p>
        <p v-else>素材空态不会在连接恢复前显示，也不会执行任何素材写操作。</p>
        <p class="data-load-state__detail">错误详情：{{ loadError }}</p>
      </div>
      <el-button type="primary" plain :loading="loading" :disabled="loading" :title="mediaRetryLoadDisableReason || undefined" @click="loadMedia">
        <el-icon><Refresh /></el-icon>重试加载
      </el-button>
    </section>

    <section v-if="mediaAccessState.showEntryStrip" class="entry-strip" aria-label="素材入口说明">
      <div class="entry-item">
        <span class="entry-label">上传到素材中心</span>
        <p class="entry-description">把不超过 100MB 的图片和视频放进全局素材，后续项目可以直接复用。</p>
        <el-button text class="entry-action" :disabled="mediaWriteLocked || uploading" :title="mediaUploadDisableReason || undefined" @click="triggerUpload">立即上传</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">网页 URL 导入</span>
        <p class="entry-description">网页 URL 导入会在选择项目后完成，本页不直接粘贴 URL。</p>
        <el-button
          type="primary"
          plain
          class="entry-action"
          :disabled="mediaAccessState.navigationLocked"
          :title="mediaAccessState.navigationLocked ? mediaNavigationLockReason : undefined"
          aria-label="选择项目后导入网页 URL"
          @click="goSourceImport"
        >进入项目选择后导入网页 URL</el-button>
      </div>
      <div class="entry-item">
        <span class="entry-label">角色 / 场景 / 道具入库</span>
        <p class="entry-description">在项目里点“加入素材库”后，会同步到首页里的分类素材入口。</p>
        <el-button text class="entry-action" @click="goHome">返回项目首页</el-button>
      </div>
    </section>


    <slot />

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress">
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
      </div>
    </section>

    <!-- 媒体网格 -->
    <div v-loading="loading" class="media-grid" :aria-busy="loading">
      <article
        v-for="item in mediaItems"
        :key="item.id"
        class="media-card"
        :class="{
          selected: selectedIds.has(item.id),
          'actions-visible': isActionLayerVisible(item.id),
        }"
        :aria-labelledby="`media-name-${item.id}`"
        @mouseenter="showPointerActions(item.id)"
        @mouseleave="hidePointerActions(item.id)"
        @focusin="showKeyboardActions(item.id)"
        @focusout="hideKeyboardActions(item.id, $event)"
      >
        <div class="media-thumb">
          <video
            v-if="item.type === 'video'"
            :src="itemUrl(item)"
            :aria-label="thumbnailAlt(item)"
            class="thumb-video"
            muted
          />
          <img v-else :src="itemUrl(item)" :alt="thumbnailAlt(item)" class="thumb-img" />
          <label class="selection-control" :title="mediaWriteLocked ? mediaWriteLockReason : selectionLabel(item)">
            <input
              type="checkbox"
              class="selection-input"
              :checked="selectedIds.has(item.id)"
              :disabled="mediaWriteLocked"
              :title="mediaWriteLocked ? mediaWriteLockReason : selectionLabel(item)"
              :aria-label="selectionLabel(item)"
              @change="setItemSelected(item, $event.target.checked)"
            />
            <span class="selection-indicator" aria-hidden="true">
              <el-icon class="selection-check"><CircleCheck /></el-icon>
            </span>
          </label>
          <div class="media-overlay" :aria-hidden="!isActionLayerVisible(item.id)">
            <div class="overlay-actions">
              <el-button
                size="small"
                plain
                class="preview-btn"
                :title="actionLabel('预览', item)"
                :aria-label="actionLabel('预览', item)"
                :tabindex="isActionLayerVisible(item.id) ? 0 : -1"
                @click="openPreview(item)"
              >
                <el-icon><ZoomIn /></el-icon>
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :title="mediaWriteLocked ? mediaWriteLockReason : actionLabel('删除', item)"
                :aria-label="actionLabel('删除', item)"
                :disabled="mediaWriteLocked"
                :tabindex="isActionLayerVisible(item.id) ? 0 : -1"
                @click="deleteItem(item)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
        <div class="media-info">
          <span :id="`media-name-${item.id}`" class="media-name" :title="item.name">{{ item.name || '未命名' }}</span>
          <span class="media-meta">{{ formatSize(mediaItemFileSize(item)) }}</span>
          <span class="media-origin">{{ mediaOriginLabel(item) }}</span>
        </div>
      </article>

      <div v-if="!loading && hasSuccessfulMediaLoad && !loadError && mediaItems.length === 0" class="empty-media">
        <el-icon class="empty-icon"><Files /></el-icon>
        <h2 class="empty-title">{{ hasActiveFilters ? '没有匹配的素材' : '素材中心还是空的' }}</h2>
        <p class="empty-description">{{ hasActiveFilters ? '调整关键词或素材类型后再试。' : '上传图片或视频，后续项目可以直接复用。' }}</p>
        <div class="empty-actions">
          <template v-if="hasActiveFilters">
            <el-button @click="clearFilters">清除筛选</el-button>
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
            aria-label="选择项目后导入网页 URL"
            @click="goSourceImport"
          >进入项目选择后导入网页 URL</el-button>
        </template>
      </div>
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
      <el-button size="small" @click="selectedIds.clear()">取消选择</el-button>
      <el-button size="small" type="danger" plain :disabled="mediaWriteLocked || visibleSelectedMediaCount <= 0" :title="mediaBatchDeleteDisableReason || undefined" @click="batchDelete">批量删除</el-button>
    </div>
</template>

<script setup>

// 仅展示本地素材网格与空态；写操作和列表状态仍留在素材中心页。筛选栏通过默认插槽插入。
import {
  CircleCheck, Delete, Files, Loading, Refresh, Upload, ZoomIn,
} from '@element-plus/icons-vue'

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
  goHome: { type: Function, required: true },
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

.media-card {
  background: var(--bg-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  cursor: default;
  transition: all .2s;
  box-shadow: var(--shadow);
}

.media-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}

.media-card.selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary), var(--shadow);
}

.media-thumb {
  aspect-ratio: 1;
  background: var(--bg-inner);
  overflow: hidden;
  position: relative;
}

.thumb-img,
.thumb-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-card.actions-visible .media-overlay {
  opacity: 1;
  pointer-events: auto;
}

.selection-control {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  cursor: pointer;
}

.selection-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.selection-indicator {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: transparent;
  background: rgba(255, 255, 255, .92);
  border: 2px solid rgba(31, 41, 55, .55);
  border-radius: 50%;
  transition: border-color .2s, box-shadow .2s, color .2s;
}

.selection-check {
  font-size: 20px;
}

.selection-input:checked + .selection-indicator {
  color: var(--el-color-primary);
  border-color: #fff;
}

.selection-input:focus-visible + .selection-indicator {
  outline: 3px solid var(--el-color-primary);
  outline-offset: 2px;
}

.selection-input:disabled + .selection-indicator {
  cursor: not-allowed;
  opacity: 0.5;
}

.overlay-actions {
  display: flex;
  gap: 6px;
}

.media-info {
  padding: 8px;
}

.media-name {
  display: block;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-meta {
  font-size: 11px;
  color: var(--text-subtle);
}

.media-origin {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

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
</style>
