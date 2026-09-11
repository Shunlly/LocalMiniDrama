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
            :aria-label="networkLoading ? '正在搜索网络素材' : (networkSearchDisableReason || '搜索网络素材')" @click="searchNetworkMedia"
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
          :aria-label="networkLoading ? '正在搜索网络素材' : (networkSearchDisableReason || '搜索网络素材')" @click="searchNetworkMedia"
        >
          <el-icon><Refresh /></el-icon>重试
        </el-button>
      </section>

      <section v-if="networkNotice && !networkError" class="network-state" role="status">
        <p>{{ networkNotice }}</p>
      </section>

      <div v-loading="networkLoading" class="network-grid" :aria-busy="networkLoading">
        <MediaLibraryNetworkCard
          v-for="(item, index) in networkItems"
          :key="networkItemKey(item, index)"
          :item="item"
          :index="index"
          :network-import-button-text="networkImportButtonText"
          :network-item-title="networkItemTitle"
          :network-card-image-url="networkCardImageUrl"
          :open-network-preview="openNetworkPreview"
          :network-dimensions="networkDimensions"
          :network-item-source-label="networkItemSourceLabel"
          :network-item-importability="networkItemImportability"
          :safe-external-url="safeExternalUrl"
          :is-network-importing="isNetworkImporting"
          :import-network-item="importNetworkItem"
        />
        <MediaLibraryNetworkEmpty
          :network-loading="networkLoading"
          :network-error="networkError"
          :network-searched="networkSearched"
          :network-items="networkItems"
          :clear-network-search="clearNetworkSearch"
        />
      </div>
</template>

<script setup>

// 仅展示网络素材搜索区；卡片和空态拆到子组件，搜索、导入和预览仍由素材中心页处理。
import { Refresh, Search } from '@element-plus/icons-vue'
import MediaLibraryNetworkCard from './MediaLibraryNetworkCard.vue'
import MediaLibraryNetworkEmpty from './MediaLibraryNetworkEmpty.vue'

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
