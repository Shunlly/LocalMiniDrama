<template>
  <article
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
          :aria-describedby="mediaWriteLocked ? writeLockDescribedBy : undefined"
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
            :aria-describedby="mediaWriteLocked ? writeLockDescribedBy : undefined"
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
</template>

<script setup>
// 仅展示本地素材卡片；选择、预览和删除仍由素材中心页处理。
import { CircleCheck, Delete, ZoomIn } from '@element-plus/icons-vue'

defineProps({
  item: { type: Object, required: true },
  selectedIds: { type: Object, required: true },
  mediaWriteLocked: { type: Boolean, default: false },
  mediaWriteLockReason: { type: String, default: '' },
  writeLockDescribedBy: { type: String, default: 'media-write-lock-reason' },
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
})
</script>

<style scoped>
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
.overlay-actions :deep(.el-button:focus-visible) {
  outline: 2px solid var(--el-color-primary, #818cf8);
  outline-offset: 2px;
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
</style>
