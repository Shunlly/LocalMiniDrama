<template>
      <section class="network-search-panel" aria-labelledby="network-search-title">
        <div>
          <h2 id="network-search-title" class="section-title">搜索网络素材</h2>
          <p class="section-description">
            导入目标：<strong>{{ networkImportTargetLabel }}</strong>。这些是公开许可素材，具体用途是否兼容仍需用户自行核对。只有来源和许可证据完整的素材才能导入。
          </p>
        </div>
        <div class="network-search-controls">
          <el-radio-group
            v-model="networkSource"
            aria-label="网络素材来源"
            @change="handleNetworkSourceChange"
          >
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="commons">Wikimedia Commons</el-radio-button>
            <el-radio-button value="openverse">Openverse</el-radio-button>
          </el-radio-group>
          <el-radio-group
            v-model="networkMediaType"
            aria-label="网络素材类型"
            @change="handleNetworkTypeChange"
          >
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="image">图片</el-radio-button>
            <el-radio-button value="video">视频</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="networkKeyword"
            class="network-search-input"
            clearable
            placeholder="输入关键词搜索网络素材"
            aria-label="网络素材关键词"
            @keyup.enter="searchNetworkMedia"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button
            type="primary"
            :loading="networkLoading"
            :disabled="!networkKeyword.trim() || networkLoading"
            :title="networkSearchDisableReason || undefined"
            @click="searchNetworkMedia"
          >
            <el-icon><Search /></el-icon>搜索
          </el-button>
        </div>
      </section>
      <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {{ networkSearchAnnouncement }}
      </p>

      <section v-if="networkError" class="network-state network-state--error" role="alert" aria-live="assertive">
        <div>
          <h2>网络素材搜索失败</h2>
          <p>{{ networkError }}</p>
        </div>
        <el-button
          type="primary"
          plain
          :loading="networkLoading"
          :disabled="!networkKeyword.trim() || networkLoading"
          :title="networkSearchDisableReason || undefined"
          aria-label="重试搜索网络素材"
          @click="searchNetworkMedia"
        >
          <el-icon><Refresh /></el-icon>重试
        </el-button>
      </section>

      <section v-if="networkNotice && !networkError" class="network-state" role="status">
        <p>{{ networkNotice }}</p>
      </section>

      <div v-loading="networkLoading" class="network-grid" :aria-busy="networkLoading">
        <article
          v-for="(item, index) in networkItems"
          :key="networkItemKey(item, index)"
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

        <div
          v-if="!networkLoading && !networkError && networkSearched && networkItems.length === 0"
          class="network-empty"
          role="status"
        >
          <el-icon><Files /></el-icon>
          <h2>没有找到匹配的网络素材</h2>
          <p>请更换关键词或素材类型后重试。</p>
          <el-button aria-label="清除网络素材搜索" @click="clearNetworkSearch">清除搜索</el-button>
        </div>
        <div v-else-if="!networkLoading && !networkError && !networkSearched" class="network-empty" role="status">
          <el-icon><Search /></el-icon>
          <h2>搜索可导入的网络素材</h2>
          <p>结果会在这里显示，并附带来源和许可信息。</p>
        </div>
      </div>
</template>

<script setup>

// 仅展示网络素材搜索区；搜索、导入和预览仍由素材中心页处理。
import { Files, Refresh, Search, ZoomIn } from '@element-plus/icons-vue'
import { MEDIA_LIBRARY_DISABLE_REASON } from '@/utils/mediaLibraryUserError'

const networkSource = defineModel('networkSource', { type: String, required: true })
const networkMediaType = defineModel('networkMediaType', { type: String, required: true })
const networkKeyword = defineModel('networkKeyword', { type: String, required: true })

defineProps({
  networkImportTargetLabel: { type: String, default: '' },
  networkSearchAnnouncement: { type: String, default: '' },
  networkLoading: { type: Boolean, default: false },
  networkSearchDisableReason: { type: String, default: '' },
  networkError: { type: String, default: '' },
  networkNotice: { type: String, default: '' },
  networkItems: { type: Array, default: () => [] },
  networkSearched: { type: Boolean, default: false },
  networkImportButtonText: { type: String, default: '' },
  handleNetworkSourceChange: { type: Function, required: true },
  handleNetworkTypeChange: { type: Function, required: true },
  searchNetworkMedia: { type: Function, required: true },
  networkItemKey: { type: Function, required: true },
  networkItemTitle: { type: Function, required: true },
  networkCardImageUrl: { type: Function, required: true },
  openNetworkPreview: { type: Function, required: true },
  networkDimensions: { type: Function, required: true },
  networkItemSourceLabel: { type: Function, required: true },
  networkItemImportability: { type: Function, required: true },
  safeExternalUrl: { type: Function, required: true },
  isNetworkImporting: { type: Function, required: true },
  importNetworkItem: { type: Function, required: true },
  clearNetworkSearch: { type: Function, required: true },
})
</script>

<style scoped>
.network-search-panel {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-color);
}

.section-title {
  margin: 0;
  color: var(--text-bright);
  font-size: 18px;
  line-height: 1.4;
}

.section-description {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.network-search-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.network-search-input {
  width: min(320px, 32vw);
}

.network-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--el-color-danger);
  border-radius: 8px;
  background: var(--bg-card);
}

.network-state h2,
.network-state p {
  margin: 0;
}

.network-state h2 {
  color: var(--text-bright);
  font-size: 15px;
}

.network-state p {
  margin-top: 4px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.network-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  min-height: 260px;
}

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

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.network-actions a {
  color: var(--el-color-primary);
}

.source-unavailable {
  color: var(--text-subtle);
}

.network-empty {
  grid-column: 1 / -1;
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-subtle);
  text-align: center;
}

.network-empty .el-icon {
  font-size: 42px;
}

.network-empty h2,
.network-empty p {
  margin: 0;
}

.network-empty .el-button {
  margin-top: 12px;
}

.network-empty h2 {
  color: var(--text-bright);
  font-size: 17px;
}

.network-state > .el-button {
  flex-shrink: 0;
}

@media (max-width: 840px) {
  .network-search-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .network-search-controls {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .network-search-input {
    width: 100%;
    flex: 1 1 240px;
  }
}

@media (max-width: 520px) {
  .network-search-controls > .el-button {
    margin-left: 0;
  }

  .network-search-controls > .el-radio-group,
  .network-search-input {
    flex-basis: 100%;
  }

  .network-grid {
    grid-template-columns: 1fr;
  }

  .network-state {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
