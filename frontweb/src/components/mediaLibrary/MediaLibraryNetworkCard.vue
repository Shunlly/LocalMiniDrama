<template>
  <article
    class="network-card"
    :aria-labelledby="`network-name-${index}`"
  >
    <button
      type="button"
      class="network-thumb"
      :aria-label="`预览网络素材：${networkItemTitle(item)}`"
      @click="openNetworkPreview(item)"
    >
      <img
        v-if="networkCardImageUrl(item)"
        :src="networkCardImageUrl(item)"
        :alt="`网络素材缩略图：${networkItemTitle(item)}`"
      />
      <span v-else class="network-thumb-placeholder" aria-hidden="true">
        <el-icon><Files /></el-icon>
        <span>暂无缩略图</span>
      </span>
      <span class="network-preview-label"><el-icon><ZoomIn /></el-icon>预览</span>
    </button>
    <div class="network-info">
      <h3 :id="`network-name-${index}`" :title="networkItemTitle(item)">{{ networkItemTitle(item) }}</h3>
      <p class="network-detail">
        <span>{{ item.author || '作者未知' }}</span>
        <span>{{ networkDimensions(item) }}</span>
      </p>
      <p class="network-source" :title="networkItemSourceLabel(item)">来源：{{ networkItemSourceLabel(item) }}</p>
      <p class="network-license" :title="item.license || '未注明许可'">许可：{{ item.license || '未注明许可' }}</p>
      <p
        v-if="!networkItemImportability(item).allowed"
        class="network-license-warning"
        role="status"
      >{{ networkItemImportability(item).reason }}</p>
      <div class="network-actions">
        <a
          v-if="safeExternalUrl(item.source_url)"
          :href="safeExternalUrl(item.source_url)"
          :aria-label="`查看来源：${networkItemTitle(item)}`"
          target="_blank"
          rel="noopener noreferrer"
        >查看来源</a>
        <span v-else class="source-unavailable">来源链接不可用</span>
        <a
          v-if="safeExternalUrl(item.license_url, true)"
          :href="safeExternalUrl(item.license_url, true)"
          :aria-label="`查看许可：${networkItemTitle(item)}`"
          target="_blank"
          rel="noopener noreferrer"
        >查看许可</a>
        <el-button
          size="small"
          type="primary"
          :loading="isNetworkImporting(item)"
          :disabled="isNetworkImporting(item) || !networkItemImportability(item).allowed"
          :title="isNetworkImporting(item) ? MEDIA_LIBRARY_DISABLE_REASON.importing : (networkItemImportability(item).reason || networkImportButtonText)"
          :aria-label="`${networkImportButtonText}：${networkItemTitle(item)}`"
          @click="importNetworkItem(item)"
        >{{ networkImportButtonText }}</el-button>
      </div>
    </div>
  </article>
</template>

<script setup>
// 仅展示网络素材卡片；预览和导入仍由素材中心页处理。
import { Files, ZoomIn } from '@element-plus/icons-vue'
import { MEDIA_LIBRARY_DISABLE_REASON } from '@/utils/mediaLibraryUserError'

defineProps({
  item: { type: Object, required: true },
  index: { type: Number, required: true },
  networkImportButtonText: { type: String, default: '' },
  networkItemTitle: { type: Function, required: true },
  networkCardImageUrl: { type: Function, required: true },
  openNetworkPreview: { type: Function, required: true },
  networkDimensions: { type: Function, required: true },
  networkItemSourceLabel: { type: Function, required: true },
  networkItemImportability: { type: Function, required: true },
  safeExternalUrl: { type: Function, required: true },
  isNetworkImporting: { type: Function, required: true },
  importNetworkItem: { type: Function, required: true },
})
</script>

<style scoped>
.network-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow);
}

.network-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: var(--bg-inner);
  color: #fff;
  cursor: pointer;
}

.network-thumb img,
.network-thumb video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.network-thumb-placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.network-thumb-placeholder .el-icon {
  font-size: 28px;
}

.network-thumb:focus-visible {
  outline: 3px solid var(--el-color-primary);
  outline-offset: -3px;
}

.network-preview-label {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, .78);
  font-size: 12px;
}

.network-info {
  min-width: 0;
  padding: 12px;
}

.network-info h3 {
  margin: 0;
  overflow: hidden;
  color: var(--text-bright);
  font-size: 14px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-detail {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.network-detail span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-source,
.network-license {
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--text-subtle);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-license-warning {
  margin: 6px 0 0;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.45;
}

.network-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}

.network-actions a,
.source-unavailable {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.network-actions a {
  color: var(--el-color-primary);
}

.source-unavailable {
  color: var(--text-subtle);
}
</style>
